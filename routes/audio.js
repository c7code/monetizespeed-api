import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Configurar OpenAI
// Configurar OpenAI
let openai;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.post('/transaction', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo de áudio enviado.' });
    }

    const audioPath = req.file.path;
    const newPath = audioPath + '.mp3'; // Whisper precisa de extensão

    try {
        if (!openai) {
            openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
        }

        // Renomear para ter extensão (multer salva sem extensão)
        fs.renameSync(audioPath, newPath);

        // 1. Transcrever áudio com Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(newPath),
            model: 'whisper-1',
            language: 'pt', // Forçar português se possível, ou deixar auto
        });

        const text = transcription.text;
        console.log('Transcrição:', text);

        // 2. Extrair dados com GPT
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `Você é um assistente financeiro. Analise o texto transacionado e extraia os dados da transação em formato JSON.
          Campos requeridos:
          - type: 'income' ou 'expense'
          - category: Uma das seguintes: 'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Outros', 'Salário', 'Investimentos', 'Vendas', 'Freela'. Se não se encaixar perfeitamente, use 'Outros' ou a mais próxima.
          - amount: valor numérico (number).
          - date: data no formato YYYY-MM-DD. Se o usuário disser "hoje", use a data atual. Se não disser data, use a data atual.
          - description: breve descrição do gasto/ganho.

          Retorne APENAS o JSON, sem markdown ou explicações adicionais.`
                },
                {
                    role: "user",
                    content: `Data atual: ${new Date().toISOString().split('T')[0]}. Texto: "${text}"`
                }
            ],
            response_format: { type: "json_object" }
        });

        const content = completion.choices[0].message.content;
        const transactionData = JSON.parse(content);

        // Limpar arquivo temporário
        fs.unlinkSync(newPath);

        res.json({
            text: text,
            data: transactionData
        });

    } catch (error) {
        console.error('Erro no processamento de áudio:', error);
        // Tentar limpar arquivo em caso de erro
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

        res.status(500).json({ error: 'Erro ao processar áudio.' });
    }
});

export default router;
