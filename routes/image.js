import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';

const router = express.Router();
const upload = multer({ dest: '/tmp/uploads/' });

// Configurar OpenAI
let openai;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
}

router.post('/transaction', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }

    const imagePath = req.file.path;

    try {
        if (!openai) {
            openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
        }

        // Ler imagem e converter para base64
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';

        // Enviar para GPT-4o Vision
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `Você é um assistente financeiro especialista em analisar imagens de recibos, notas fiscais, cupons, comprovantes, boletos e fotos de produtos/serviços.

Analise a imagem enviada e extraia os dados da transação em formato JSON.

Campos requeridos:
- type: 'income' ou 'expense' (na maioria dos casos será 'expense' para recibos e compras)
- category: Uma das seguintes: 'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Mercado', 'Contas', 'Outros', 'Salário', 'Investimentos', 'Vendas', 'Freela'. Se não se encaixar perfeitamente, use 'Outros' ou a mais próxima.
- amount: valor numérico total (number). Se houver múltiplos itens, use o valor TOTAL.
- date: data no formato YYYY-MM-DD. Se visível no recibo, use essa data. Caso contrário, use a data atual.
- description: breve descrição do gasto/ganho baseado no conteúdo da imagem (ex: "Compras no Supermercado X", "Almoço no Restaurante Y").

Se não for possível identificar uma transação financeira na imagem, retorne:
{ "error": "Não foi possível identificar uma transação financeira nesta imagem." }

Retorne APENAS o JSON, sem markdown ou explicações adicionais.`
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Data atual: ${new Date().toISOString().split('T')[0]}. Analise esta imagem e extraia os dados da transação.`
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`,
                                detail: "high"
                            }
                        }
                    ]
                }
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000
        });

        const content = completion.choices[0].message.content;
        const transactionData = JSON.parse(content);

        // Limpar arquivo temporário
        fs.unlinkSync(imagePath);

        if (transactionData.error) {
            return res.json({
                analysis: transactionData.error,
                data: null
            });
        }

        res.json({
            analysis: `Transação identificada: ${transactionData.description}`,
            data: transactionData
        });

    } catch (error) {
        console.error('Erro no processamento de imagem:', error);
        // Tentar limpar arquivo em caso de erro
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

        res.status(500).json({ error: 'Erro ao processar imagem.' });
    }
});

export default router;
