import express from 'express';
import OpenAI from 'openai';
import getPool from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar OpenAI
let openai;
function getOpenAI() {
    if (!openai && process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
}

// Prompt do sistema para extração de transações
const SYSTEM_PROMPT = `Você é um assistente financeiro. Analise o texto do usuário e extraia os dados da transação em formato JSON.
Campos requeridos:
- type: 'income' ou 'expense'
- category: Uma das seguintes: 'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Mercado', 'Contas', 'Outros', 'Salário', 'Investimentos', 'Vendas', 'Freela'. Se não se encaixar perfeitamente, use 'Outros' ou a mais próxima.
- amount: valor numérico (number).
- date: data no formato YYYY-MM-DD. Se o usuário disser "hoje", use a data atual. Se não disser data, use a data atual.
- description: breve descrição do gasto/ganho.

Se NÃO for possível identificar uma transação financeira, retorne:
{ "error": "Não consegui identificar uma transação. Tente algo como: Gastei 50 reais no almoço" }

Retorne APENAS o JSON, sem markdown ou explicações adicionais.`;

// Gerar resposta TwiML
function twimlResponse(message) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}

// Buscar usuário pelo número do WhatsApp
async function findUserByPhone(phoneNumber) {
    const pool = getPool();
    // Remove "whatsapp:" prefix e tudo que não é dígito
    const digitsOnly = phoneNumber.replace(/\D/g, '');

    console.log('🔍 Buscando usuário pelo número:', phoneNumber, '→ dígitos:', digitsOnly);

    // Extrair variações do número para busca
    const withoutCountry = digitsOnly.replace(/^55/, ''); // Remove código do Brasil
    const variations = [
        digitsOnly,                   // 5581983662726
        withoutCountry,               // 81983662726
        `+${digitsOnly}`,             // +5581983662726
        `+55${withoutCountry}`,       // +5581983662726
    ];

    // Primeiro tenta match exato com várias variações
    for (const variation of variations) {
        const result = await pool.query(
            'SELECT id, name, email FROM users WHERE whatsapp_number = $1',
            [variation]
        );
        if (result.rows.length > 0) {
            console.log('✅ Usuário encontrado com match exato:', variation);
            return result.rows[0];
        }
    }

    // Fallback: busca por LIKE nos últimos 8-9 dígitos (mais confiável)
    const lastDigits = withoutCountry.slice(-9); // Últimos 9 dígitos (sem DDD do país)
    if (lastDigits.length >= 8) {
        console.log('🔍 Tentando busca por sufixo:', lastDigits);
        const result = await pool.query(
            "SELECT id, name, email FROM users WHERE REPLACE(REPLACE(whatsapp_number, '+', ''), ' ', '') LIKE $1",
            [`%${lastDigits}`]
        );
        if (result.rows.length > 0) {
            console.log('✅ Usuário encontrado com match por sufixo:', result.rows[0].email);
            return result.rows[0];
        }
    }

    console.log('❌ Nenhum usuário encontrado para:', digitsOnly, 'variações testadas:', variations);
    return null;
}

// Criar transação no banco
async function createTransaction(userId, data) {
    const pool = getPool();
    const result = await pool.query(
        `INSERT INTO transactions (user_id, type, category, amount, date, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
        [
            userId,
            data.type,
            data.category,
            data.amount,
            data.date || new Date().toISOString().split('T')[0],
            data.description,
            data.type === 'expense' ? 'paid' : 'received'
        ]
    );
    return result.rows[0];
}

// Formatar mensagem de confirmação
function formatConfirmation(data, transaction) {
    const typeEmoji = data.type === 'expense' ? '📉' : '📈';
    const typeLabel = data.type === 'expense' ? 'Despesa' : 'Receita';
    return (
        `✅ Transação registrada!\n\n` +
        `${typeEmoji} Tipo: ${typeLabel}\n` +
        `💰 Valor: R$ ${Number(data.amount).toFixed(2)}\n` +
        `📂 Categoria: ${data.category}\n` +
        `📝 Descrição: ${data.description}\n` +
        `📅 Data: ${data.date || new Date().toISOString().split('T')[0]}`
    );
}

// ==================== HANDLERS ====================

// Processar mensagem de texto com GPT-4o
async function handleTextMessage(messageBody) {
    const ai = getOpenAI();
    if (!ai) throw new Error('OpenAI não configurada');

    const completion = await ai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Data atual: ${new Date().toISOString().split('T')[0]}. Texto: "${messageBody}"` }
        ],
        response_format: { type: 'json_object' }
    });

    return JSON.parse(completion.choices[0].message.content);
}

// Baixar mídia do Twilio
async function downloadTwilioMedia(mediaUrl) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    const response = await fetch(mediaUrl, {
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
        }
    });

    if (!response.ok) {
        throw new Error(`Erro ao baixar mídia: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

// Processar áudio: Whisper → GPT-4o
async function handleAudioMessage(mediaUrl) {
    const ai = getOpenAI();
    if (!ai) throw new Error('OpenAI não configurada');

    // Baixar o áudio do Twilio
    const audioBuffer = await downloadTwilioMedia(mediaUrl);
    const tmpPath = path.join('/tmp', `whatsapp_audio_${Date.now()}.ogg`);
    fs.writeFileSync(tmpPath, audioBuffer);

    try {
        // 1. Transcrever com Whisper
        const transcription = await ai.audio.transcriptions.create({
            file: fs.createReadStream(tmpPath),
            model: 'whisper-1',
            language: 'pt',
        });

        const text = transcription.text;
        console.log('📝 Transcrição WhatsApp:', text);

        // 2. Extrair dados com GPT-4o
        const completion = await ai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Data atual: ${new Date().toISOString().split('T')[0]}. Texto transcrito de áudio: "${text}"` }
            ],
            response_format: { type: 'json_object' }
        });

        const data = JSON.parse(completion.choices[0].message.content);
        data._transcription = text;
        return data;
    } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
}

// Processar imagem: GPT-4o Vision
async function handleImageMessage(mediaUrl, contentType) {
    const ai = getOpenAI();
    if (!ai) throw new Error('OpenAI não configurada');

    const imageBuffer = await downloadTwilioMedia(mediaUrl);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = contentType || 'image/jpeg';

    const completion = await ai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            {
                role: 'system',
                content: `Você é um assistente financeiro especialista em analisar imagens de recibos, notas fiscais, cupons, comprovantes, boletos e fotos de produtos/serviços.

Analise a imagem enviada e extraia os dados da transação em formato JSON.

Campos requeridos:
- type: 'income' ou 'expense' (na maioria dos casos será 'expense' para recibos e compras)
- category: Uma das seguintes: 'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Mercado', 'Contas', 'Outros', 'Salário', 'Investimentos', 'Vendas', 'Freela'. Se não se encaixar perfeitamente, use 'Outros' ou a mais próxima.
- amount: valor numérico total (number). Se houver múltiplos itens, use o valor TOTAL.
- date: data no formato YYYY-MM-DD. Se visível no recibo, use essa data. Caso contrário, use a data atual.
- description: breve descrição do gasto/ganho baseado no conteúdo da imagem.

Se não for possível identificar uma transação financeira na imagem, retorne:
{ "error": "Não foi possível identificar uma transação financeira nesta imagem." }

Retorne APENAS o JSON, sem markdown ou explicações adicionais.`
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: `Data atual: ${new Date().toISOString().split('T')[0]}. Analise esta imagem e extraia os dados da transação.` },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' } }
                ]
            }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000
    });

    return JSON.parse(completion.choices[0].message.content);
}

// ==================== WEBHOOK PRINCIPAL ====================

router.post('/whatsapp/inbound', async (req, res) => {
    try {
        const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

        console.log('📱 Webhook WhatsApp recebido:', { From, Body, NumMedia: NumMedia || '0' });

        if (!From) {
            res.type('text/xml');
            return res.send(twimlResponse('❌ Número não identificado.'));
        }

        // Buscar usuário
        const user = await findUserByPhone(From);
        if (!user) {
            res.type('text/xml');
            return res.send(twimlResponse(
                '❌ Seu número não está cadastrado no Tudo no Azul.\n\n' +
                'Para usar o WhatsApp, cadastre seu número no app ou site primeiro em Configurações → WhatsApp.'
            ));
        }

        console.log(`👤 Usuário encontrado: ${user.name || user.email} (ID: ${user.id})`);

        const numMedia = parseInt(NumMedia || '0', 10);
        let transactionData;
        let extraInfo = '';

        // Determinar tipo de mensagem
        if (numMedia > 0 && MediaUrl0) {
            const contentType = (MediaContentType0 || '').toLowerCase();

            if (contentType.startsWith('audio/') || contentType.includes('ogg') || contentType.includes('opus')) {
                // ÁUDIO
                console.log('🎤 Processando áudio do WhatsApp...');
                transactionData = await handleAudioMessage(MediaUrl0);
                if (transactionData._transcription) {
                    extraInfo = `🎙️ Transcrição: "${transactionData._transcription}"\n\n`;
                    delete transactionData._transcription;
                }
            } else if (contentType.startsWith('image/')) {
                // IMAGEM
                console.log('📷 Processando imagem do WhatsApp...');
                transactionData = await handleImageMessage(MediaUrl0, contentType);
            } else {
                res.type('text/xml');
                return res.send(twimlResponse(
                    '⚠️ Formato de arquivo não suportado.\n\nEnvie texto, áudio ou foto de recibo/nota fiscal.'
                ));
            }
        } else if (Body && Body.trim()) {
            // TEXTO
            console.log('💬 Processando texto do WhatsApp...');
            transactionData = await handleTextMessage(Body.trim());
        } else {
            res.type('text/xml');
            return res.send(twimlResponse(
                '🤔 Não recebi nenhuma mensagem.\n\n' +
                'Envie um texto como "Gastei 50 reais no almoço", um áudio ou uma foto de recibo.'
            ));
        }

        // Verificar se houve erro na extração
        if (transactionData.error) {
            res.type('text/xml');
            return res.send(twimlResponse(`⚠️ ${transactionData.error}`));
        }

        // Validar dados
        if (!transactionData.amount || transactionData.amount <= 0) {
            res.type('text/xml');
            return res.send(twimlResponse(
                '⚠️ Não consegui identificar o valor da transação.\n\n' +
                'Tente novamente com mais detalhes, ex:\n' +
                '"Gastei 50 reais no almoço"\n' +
                '"Recebi 2000 de salário"'
            ));
        }

        // Criar transação
        const transaction = await createTransaction(user.id, transactionData);
        console.log('✅ Transação criada via WhatsApp:', transaction.id);

        // Responder com confirmação
        const confirmation = extraInfo + formatConfirmation(transactionData, transaction);
        res.type('text/xml');
        return res.send(twimlResponse(confirmation));

    } catch (error) {
        console.error('❌ Erro no webhook WhatsApp:', error);
        res.type('text/xml');
        return res.send(twimlResponse(
            '❌ Ocorreu um erro ao processar sua mensagem. Tente novamente em alguns instantes.'
        ));
    }
});

// Health check do webhook
router.get('/whatsapp/status', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Tudo no Azul - WhatsApp Webhook',
        features: ['text', 'audio', 'image'],
        timestamp: new Date().toISOString()
    });
});

export default router;
