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

// Categorias padrão do sistema
const DEFAULT_CATEGORIES = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Mercado', 'Contas', 'Salário', 'Investimentos', 'Vendas', 'Freela'];

// Buscar categorias customizadas do usuário no banco
async function getUserCategories(userId) {
    const pool = getPool();
    try {
        const result = await pool.query(
            'SELECT name, type FROM categories WHERE user_id = $1 ORDER BY name',
            [userId]
        );
        return result.rows;
    } catch (error) {
        console.error('⚠️ Erro ao buscar categorias do usuário:', error.message);
        return [];
    }
}

// Montar a lista de categorias incluindo as do usuário
function buildCategoryList(userCategories) {
    const allCategoryNames = [...DEFAULT_CATEGORIES];
    for (const cat of userCategories) {
        if (!allCategoryNames.some(c => c.toLowerCase() === cat.name.toLowerCase())) {
            allCategoryNames.push(cat.name);
        }
    }
    // 'Outros' sempre por último como fallback
    allCategoryNames.push('Outros');
    return allCategoryNames;
}

// Prompt do sistema para extração de transações ou perguntas (dinâmico por usuário)
function buildSystemPrompt(userCategories) {
    const categoryList = buildCategoryList(userCategories);
    const categoryString = categoryList.map(c => `'${c}'`).join(', ');

    // Destacar as categorias personalizadas para a IA dar prioridade
    const customCats = userCategories.filter(
        cat => !DEFAULT_CATEGORIES.some(d => d.toLowerCase() === cat.name.toLowerCase()) && cat.name.toLowerCase() !== 'outros'
    );
    const customCatHint = customCats.length > 0
        ? `\n\nATENÇÃO: O usuário criou categorias personalizadas: ${customCats.map(c => `'${c.name}'`).join(', ')}. Dê PRIORIDADE a essas categorias antes de usar 'Outros'. Só use 'Outros' se realmente nenhuma outra categoria se encaixar.`
        : '';

    return `Você é um assistente financeiro da plataforma Tudo no Azul. Analise o texto do usuário e identifique a intenção. Retorne no formato JSON.

Intenções possíveis:
1. 'register': O usuário está informando um gasto, ganho, conta a pagar ou conta a receber.
2. 'query': O usuário está perguntando sobre seus gastos, ganhos ou saldo (ex: "quanto gastei com X?", "qual meu saldo?").

Se a intenção for 'register', extraia os campos:
- intent: 'register'
- type: 'income' ou 'expense'
- destination: Onde registrar. Use uma destas opções:
  - 'transaction': gasto ou receita JÁ REALIZADA (ex: "gastei", "paguei", "recebi", "comprei"). Algo que já aconteceu.
  - 'bill': conta a pagar FUTURA, algo que ainda não foi pago (ex: "tenho que pagar", "conta de luz vence dia 15", "boleto de 200 reais pra dia 10", "preciso pagar", "vou pagar dia X"). Uma obrigação financeira futura.
  - 'receivable': conta a receber FUTURA, algo que ainda não foi recebido (ex: "fulano me deve", "vou receber", "tenho a receber", "cliente vai pagar"). Um valor que alguém deve ao usuário.
- category: Uma das seguintes: ${categoryString}. Escolha a categoria que MELHOR se encaixa na descrição. Só use 'Outros' como ÚLTIMO recurso, quando nenhuma outra categoria se aplicar.${customCatHint}
- amount: valor numérico (number). Se houver múltiplos itens, use o valor total.
- date: data no formato YYYY-MM-DD. Para 'transaction', use a data do evento (default: hoje). Para 'bill' e 'receivable', use a data de VENCIMENTO mencionada (default: hoje).
- description: breve descrição do gasto/ganho/conta.
- supplier_name: (apenas para 'bill') nome do fornecedor se mencionado, senão null.
- customer_name: (apenas para 'receivable') nome do cliente/devedor se mencionado, senão null.

DICAS para decidir o destination:
- Verbos no passado (gastei, paguei, comprei, recebi) → 'transaction'
- Verbos no futuro ou obrigação (tenho que pagar, vence, preciso pagar, vai vencer) → 'bill'
- Alguém deve ao usuário (me deve, vou receber de, fulano vai pagar) → 'receivable'
- Se não for claro, use 'transaction' como padrão.

Se a intenção for 'query', extraia:
- intent: 'query'
- query_text: a pergunta original formatada ou resumida.
- period: 'current_month', 'last_month', 'today', 'all' (tente inferir; default é 'current_month').
- category_filter: se a pergunta focar numa categoria específica, coloque o nome dela aqui (ex: 'Alimentação'), senão null.

Se nenhuma das duas for aplicável, retorne:
{ "error": "Não entendi sua mensagem. Você pode registrar gastos, contas a pagar/receber, ou perguntar sobre suas finanças." }

Retorne APENAS o JSON, sem markdown ou explicações adicionais.`;
}

// Gerar resposta TwiML
function twimlResponse(message) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}

// Buscar usuário pelo número do WhatsApp
async function findUserByPhone(phoneNumber) {
    const pool = getPool();
    // Remove tudo que não é dígito
    const digitsOnly = phoneNumber.replace(/\D/g, '');

    console.log('🔍 Buscando usuário pelo número:', phoneNumber, '→ dígitos:', digitsOnly);

    // Extrair DDD e número local
    const withoutCountry = digitsOnly.replace(/^55/, ''); // Remove código do Brasil
    const ddd = withoutCountry.slice(0, 2);
    const localNumber = withoutCountry.slice(2);

    // Gerar variação com/sem o 9 na frente (migração BR 8→9 dígitos)
    let localWith9 = localNumber;
    let localWithout9 = localNumber;
    if (localNumber.length === 8) {
        localWith9 = '9' + localNumber;     // Adiciona o 9
    } else if (localNumber.length === 9 && localNumber.startsWith('9')) {
        localWithout9 = localNumber.slice(1); // Remove o 9
    }

    // Gerar todas as variações possíveis
    const variations = [
        digitsOnly,                             // 558183662726
        withoutCountry,                         // 8183662726
        `+${digitsOnly}`,                       // +558183662726
        `+55${withoutCountry}`,                 // +558183662726
        `55${ddd}${localWith9}`,                // 5581983662726
        `${ddd}${localWith9}`,                  // 81983662726
        `+55${ddd}${localWith9}`,               // +5581983662726
        `55${ddd}${localWithout9}`,             // 558183662726
        `${ddd}${localWithout9}`,               // 8183662726
        `+55${ddd}${localWithout9}`,            // +558183662726
    ];

    // Remover duplicatas
    const uniqueVariations = [...new Set(variations)];

    console.log('🔍 Variações a testar:', uniqueVariations);

    // Tenta match exato com cada variação
    for (const variation of uniqueVariations) {
        const result = await pool.query(
            'SELECT id, name, email FROM users WHERE whatsapp_number = $1',
            [variation]
        );
        if (result.rows.length > 0) {
            console.log('✅ Usuário encontrado com match exato:', variation);
            return result.rows[0];
        }
    }

    // Fallback: busca por LIKE nos últimos 8 dígitos (ignora formatação e 9°dígito)
    const last8 = localWithout9.slice(-8);
    if (last8.length === 8) {
        console.log('🔍 Tentando busca por últimos 8 dígitos:', last8);
        const result = await pool.query(
            "SELECT id, name, email FROM users WHERE REPLACE(REPLACE(whatsapp_number, '+', ''), ' ', '') LIKE $1",
            [`%${last8}`]
        );
        if (result.rows.length > 0) {
            console.log('✅ Usuário encontrado com match por sufixo:', result.rows[0].email);
            return result.rows[0];
        }
    }

    console.log('❌ Nenhum usuário encontrado para:', digitsOnly);
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

// Criar conta a pagar no banco
async function createBill(userId, data) {
    const pool = getPool();
    const result = await pool.query(
        `INSERT INTO bills (user_id, description, amount, due_date, status, category, supplier_name)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     RETURNING *`,
        [
            userId,
            data.description,
            data.amount,
            data.date || new Date().toISOString().split('T')[0],
            data.category || 'Outros',
            data.supplier_name || null
        ]
    );
    return result.rows[0];
}

// Criar conta a receber no banco
async function createReceivable(userId, data) {
    const pool = getPool();
    const result = await pool.query(
        `INSERT INTO receivables (user_id, description, amount, due_date, status, category, customer_name)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     RETURNING *`,
        [
            userId,
            data.description,
            data.amount,
            data.date || new Date().toISOString().split('T')[0],
            data.category || 'Outros',
            data.customer_name || null
        ]
    );
    return result.rows[0];
}

// Formatar mensagem de confirmação
function formatConfirmation(data, record) {
    const destination = data.destination || 'transaction';
    const baseUrl = 'https://www.tudonoazul.com.br/app';

    if (destination === 'bill') {
        return (
            `✅ Conta a Pagar registrada!\n\n` +
            `📋 Descrição: ${data.description}\n` +
            `💰 Valor: R$ ${Number(data.amount).toFixed(2)}\n` +
            `📅 Vencimento: ${data.date || new Date().toISOString().split('T')[0]}\n` +
            `📂 Categoria: ${data.category}\n` +
            (data.supplier_name ? `🏢 Fornecedor: ${data.supplier_name}\n` : '') +
            `\n📌 Status: Pendente\n` +
            `Acesse o app para marcar como paga quando efetuar o pagamento.\n` +
            `🔗 Ver no app: ${baseUrl}/bills`
        );
    }

    if (destination === 'receivable') {
        return (
            `✅ Conta a Receber registrada!\n\n` +
            `📋 Descrição: ${data.description}\n` +
            `💰 Valor: R$ ${Number(data.amount).toFixed(2)}\n` +
            `📅 Vencimento: ${data.date || new Date().toISOString().split('T')[0]}\n` +
            `📂 Categoria: ${data.category}\n` +
            (data.customer_name ? `👤 Cliente: ${data.customer_name}\n` : '') +
            `\n📌 Status: Pendente\n` +
            `Acesse o app para marcar como recebida quando o valor entrar.\n` +
            `🔗 Ver no app: ${baseUrl}/receivables`
        );
    }

    // transaction (default)
    const typeEmoji = data.type === 'expense' ? '📉' : '📈';
    const typeLabel = data.type === 'expense' ? 'Despesa' : 'Receita';
    return (
        `✅ Transação registrada!\n\n` +
        `${typeEmoji} Tipo: ${typeLabel}\n` +
        `💰 Valor: R$ ${Number(data.amount).toFixed(2)}\n` +
        `📂 Categoria: ${data.category}\n` +
        `📝 Descrição: ${data.description}\n` +
        `📅 Data: ${data.date || new Date().toISOString().split('T')[0]}\n\n` +
        `🔗 Ver no app: ${baseUrl}/transactions`
    );
}

// Consultar transações para uma pergunta
async function getUserTransactionsForQuery(userId, period, categoryFilter) {
    const pool = getPool();
    let query = 'SELECT type, category, amount, date, description FROM transactions WHERE user_id = $1';
    let params = [userId];
    let paramIndex = 2;
    
    if (period === 'current_month') {
        query += ` AND date >= date_trunc('month', current_date) AND date < date_trunc('month', current_date) + interval '1 month'`;
    } else if (period === 'last_month') {
        query += ` AND date >= date_trunc('month', current_date) - interval '1 month' AND date < date_trunc('month', current_date)`;
    } else if (period === 'today') {
        query += ` AND date = current_date`;
    } // If 'all', no date filter
    
    if (categoryFilter) {
        query += ` AND category ILIKE $${paramIndex}`;
        params.push(`%${categoryFilter}%`);
        paramIndex++;
    }
    
    query += ' ORDER BY date DESC LIMIT 200'; // Limit results slightly higher but bounded

    const result = await pool.query(query, params);
    return result.rows;
}

// Obter a resposta da IA para a pergunta baseada nas transações
async function answerFinancialQueryWithAI(question, transactions) {
    const ai = getOpenAI();
    if (!ai) throw new Error('OpenAI não configurada');

    const txText = transactions.length > 0 
        ? JSON.stringify(transactions) 
        : "Nenhuma transação encontrada para este período/filtro.";

    const completion = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { 
                role: 'system', 
                content: 'Você é um assistente financeiro amigável do app "Tudo no Azul". ' +
                         'Responda à pergunta do usuário usando APENAS as transações fornecidas, ' +
                         'fazendo as contas (somas) necessárias. Formate sua resposta de forma clara ' +
                         'para ser lida no WhatsApp, utilizando emojis e negrito quando apropriado. ' +
                         'Seja conciso mas informativo.' 
            },
            { 
                role: 'user', 
                content: `Pergunta do usuário: "${question}"\n\nTransações no banco de dados:\n${txText}` 
            }
        ]
    });
    return completion.choices[0].message.content;
}

// ==================== HANDLERS ====================

// Processar mensagem de texto com GPT-4o
async function handleTextMessage(messageBody, userCategories) {
    const ai = getOpenAI();
    if (!ai) throw new Error('OpenAI não configurada');

    const systemPrompt = buildSystemPrompt(userCategories);

    const completion = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
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
async function handleAudioMessage(mediaUrl, userCategories) {
    const ai = getOpenAI();
    if (!ai) throw new Error('OpenAI não configurada');

    // Baixar o áudio do Twilio
    const audioBuffer = await downloadTwilioMedia(mediaUrl);
    const tmpPath = path.join('/tmp', `whatsapp_audio_${Date.now()}.ogg`);
    fs.writeFileSync(tmpPath, audioBuffer);

    const systemPrompt = buildSystemPrompt(userCategories);

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
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
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
async function handleImageMessage(mediaUrl, contentType, userCategories) {
    const ai = getOpenAI();
    if (!ai) throw new Error('OpenAI não configurada');

    const imageBuffer = await downloadTwilioMedia(mediaUrl);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = contentType || 'image/jpeg';

    const categoryList = buildCategoryList(userCategories);
    const categoryString = categoryList.map(c => `'${c}'`).join(', ');

    // Destacar categorias personalizadas para a IA
    const customCats = userCategories.filter(
        cat => !DEFAULT_CATEGORIES.some(d => d.toLowerCase() === cat.name.toLowerCase()) && cat.name.toLowerCase() !== 'outros'
    );
    const customCatHint = customCats.length > 0
        ? `\n\nATENÇÃO: O usuário criou categorias personalizadas: ${customCats.map(c => `'${c.name}'`).join(', ')}. Dê PRIORIDADE a essas categorias antes de usar 'Outros'. Só use 'Outros' se realmente nenhuma outra categoria se encaixar.`
        : '';

    const completion = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: `Você é um assistente financeiro especialista em analisar imagens de recibos, notas fiscais, cupons, comprovantes, boletos e fotos de produtos/serviços.

Analise a imagem enviada e identifique o tipo de registro financeiro. Retorne no formato JSON com:
- intent: 'register'
- type: 'income' ou 'expense' (na maioria dos casos será 'expense' para recibos e compras)
- destination: Onde registrar:
  - 'transaction': se for um COMPROVANTE DE PAGAMENTO já realizado (recibo, cupom fiscal, comprovante PIX enviado)
  - 'bill': se for um BOLETO, FATURA ou conta a pagar que AINDA NÃO FOI PAGA
  - 'receivable': se for um comprovante de venda ou valor a receber
  - Na dúvida, use 'transaction'.
- category: Uma das seguintes: ${categoryString}. Escolha a categoria que MELHOR se encaixa. Só use 'Outros' como ÚLTIMO recurso.${customCatHint}
- amount: valor numérico total (number). Se houver múltiplos itens, use o valor TOTAL.
- date: data no formato YYYY-MM-DD. Para boletos/faturas, use a data de VENCIMENTO. Para comprovantes, use a data do pagamento. Caso contrário, use a data atual.
- description: breve descrição baseada no conteúdo da imagem.
- supplier_name: (para 'bill') nome do fornecedor/empresa se visível, senão null.
- customer_name: (para 'receivable') nome do cliente se visível, senão null.

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

        // Buscar categorias personalizadas do usuário
        const userCategories = await getUserCategories(user.id);
        console.log(`📂 Categorias do usuário: ${DEFAULT_CATEGORIES.length} padrão + ${userCategories.filter(c => !DEFAULT_CATEGORIES.some(d => d.toLowerCase() === c.name.toLowerCase())).length} personalizadas`);

        const numMedia = parseInt(NumMedia || '0', 10);
        let transactionData;
        let extraInfo = '';

        // Determinar tipo de mensagem
        if (numMedia > 0 && MediaUrl0) {
            const contentType = (MediaContentType0 || '').toLowerCase();

            if (contentType.startsWith('audio/') || contentType.includes('ogg') || contentType.includes('opus')) {
                // ÁUDIO
                console.log('🎤 Processando áudio do WhatsApp...');
                transactionData = await handleAudioMessage(MediaUrl0, userCategories);
                if (transactionData._transcription) {
                    extraInfo = `🎙️ Transcrição: "${transactionData._transcription}"\n\n`;
                    delete transactionData._transcription;
                }
            } else if (contentType.startsWith('image/')) {
                // IMAGEM
                console.log('📷 Processando imagem do WhatsApp...');
                transactionData = await handleImageMessage(MediaUrl0, contentType, userCategories);
            } else {
                res.type('text/xml');
                return res.send(twimlResponse(
                    '⚠️ Formato de arquivo não suportado.\n\nEnvie texto, áudio ou foto de recibo/nota fiscal.'
                ));
            }
        } else if (Body && Body.trim()) {
            // TEXTO
            console.log('💬 Processando texto do WhatsApp...');
            transactionData = await handleTextMessage(Body.trim(), userCategories);
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

        // Se for uma pergunta em vez de registro
        if (transactionData.intent === 'query') {
            console.log('🔍 Executando modo Pergunta (Query)...');
            const txs = await getUserTransactionsForQuery(
                user.id, 
                transactionData.period, 
                transactionData.category_filter
            );
            const answer = await answerFinancialQueryWithAI(transactionData.query_text, txs);
            res.type('text/xml');
            return res.send(twimlResponse(answer));
        }

        // Se cheguei aqui (e não tem error/query), assumiremos 'register' by default
        // Validar dados
        if (!transactionData.amount || transactionData.amount <= 0) {
            res.type('text/xml');
            return res.send(twimlResponse(
                '⚠️ Não consegui identificar o valor.\n\n' +
                'Tente novamente com mais detalhes, ex:\n' +
                '"Gastei 50 reais no almoço"\n' +
                '"Tenho uma conta de 200 pra pagar dia 15"\n' +
                '"João me deve 500 reais"'
            ));
        }

        // Rotear para o destino correto
        const destination = transactionData.destination || 'transaction';
        let record;

        if (destination === 'bill') {
            record = await createBill(user.id, transactionData);
            console.log('✅ Conta a Pagar criada via WhatsApp:', record.id);
        } else if (destination === 'receivable') {
            record = await createReceivable(user.id, transactionData);
            console.log('✅ Conta a Receber criada via WhatsApp:', record.id);
        } else {
            record = await createTransaction(user.id, transactionData);
            console.log('✅ Transação criada via WhatsApp:', record.id);
        }

        // Responder com confirmação
        const confirmation = extraInfo + formatConfirmation(transactionData, record);
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
