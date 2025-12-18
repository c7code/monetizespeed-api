import express from 'express';
import pool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Processar mensagem e extrair informações da transação
function parseTransactionMessage(message) {
  const text = message.toLowerCase().trim();
  
  // Padrões para identificar tipo de transação
  const expenseKeywords = ['gastei', 'paguei', 'comprei', 'despesa', 'gasto', 'pago'];
  const incomeKeywords = ['recebi', 'ganhei', 'entrou', 'receita', 'recebido'];
  
  const isExpense = expenseKeywords.some(keyword => text.includes(keyword));
  const isIncome = incomeKeywords.some(keyword => text.includes(keyword));
  
  const type = isExpense ? 'expense' : isIncome ? 'income' : 'expense'; // default é despesa
  
  // Extrair valor (procura por números com "reais", "r$", ou apenas números)
  const valuePatterns = [
    /(\d+[\.,]?\d*)\s*(?:reais?|r\$|rs)/gi,
    /r\$\s*(\d+[\.,]?\d*)/gi,
    /(\d+[\.,]?\d*)/g
  ];
  
  let amount = null;
  for (const pattern of valuePatterns) {
    const match = text.match(pattern);
    if (match) {
      // Pegar o primeiro número encontrado
      const valueStr = match[0].replace(/[^\d,.]/g, '').replace(',', '.');
      amount = parseFloat(valueStr);
      if (amount && amount > 0) break;
    }
  }
  
  // Extrair categoria (procura por palavras-chave de categorias)
  const categories = [
    'alimentação', 'almoço', 'jantar', 'lanche', 'comida', 'restaurante',
    'transporte', 'uber', 'táxi', 'combustível', 'gasolina', 'ônibus',
    'lazer', 'cinema', 'show', 'festa', 'viagem',
    'saúde', 'médico', 'farmácia', 'hospital',
    'educação', 'curso', 'livro', 'escola',
    'moradia', 'aluguel', 'condomínio', 'luz', 'água', 'internet',
    'compras', 'supermercado', 'mercado',
    'salário', 'freelance', 'venda'
  ];
  
  let category = 'Outros';
  for (const cat of categories) {
    if (text.includes(cat)) {
      // Mapear para categorias padrão
      if (['alimentação', 'almoço', 'jantar', 'lanche', 'comida', 'restaurante'].includes(cat)) {
        category = 'Alimentação';
      } else if (['transporte', 'uber', 'táxi', 'combustível', 'gasolina', 'ônibus'].includes(cat)) {
        category = 'Transporte';
      } else if (['lazer', 'cinema', 'show', 'festa', 'viagem'].includes(cat)) {
        category = 'Lazer';
      } else if (['saúde', 'médico', 'farmácia', 'hospital'].includes(cat)) {
        category = 'Saúde';
      } else if (['educação', 'curso', 'livro', 'escola'].includes(cat)) {
        category = 'Educação';
      } else if (['moradia', 'aluguel', 'condomínio', 'luz', 'água', 'internet'].includes(cat)) {
        category = 'Moradia';
      } else if (['compras', 'supermercado', 'mercado'].includes(cat)) {
        category = 'Compras';
      } else if (['salário', 'freelance', 'venda'].includes(cat)) {
        category = 'Salário';
      }
      break;
    }
  }
  
  // Data padrão é hoje
  const date = new Date().toISOString().split('T')[0];
  
  // Descrição é a mensagem original
  const description = message.trim();
  
  return {
    type,
    amount,
    category,
    date,
    description,
    status: type === 'expense' ? 'paid' : 'received'
  };
}

// Webhook para receber mensagens do WhatsApp
router.post('/whatsapp', async (req, res) => {
  try {
    // Verificar autenticação via token ou webhook secret
    const authHeader = req.headers['authorization'];
    const webhookSecret = req.headers['x-webhook-secret'];
    
    // Se não tiver token Bearer, verificar webhook secret
    if (!authHeader && !webhookSecret) {
      return res.status(401).json({ error: 'Não autorizado' });
    }
    
    let userId = null;
    
    // Se tiver token Bearer, usar autenticação normal
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch (error) {
        return res.status(401).json({ error: 'Token inválido' });
      }
    }
    
    // Se tiver webhook secret, buscar usuário pelo número do WhatsApp
    if (webhookSecret && webhookSecret === process.env.WEBHOOK_SECRET) {
      // Suportar diferentes formatos de webhook
      let phoneNumber = null;
      let messageText = null;
      
      // Evolution API format
      if (req.body.from) {
        phoneNumber = req.body.from.replace(/[^\d]/g, '');
        messageText = req.body.message || req.body.text || req.body.body;
      }
      // Twilio format
      else if (req.body.From) {
        phoneNumber = req.body.From.replace(/[^\d]/g, '');
        messageText = req.body.Body || req.body.Body;
      }
      // Generic format
      else if (req.body.phone || req.body.phoneNumber) {
        phoneNumber = (req.body.phone || req.body.phoneNumber).replace(/[^\d]/g, '');
        messageText = req.body.message || req.body.text || req.body.body;
      }
      
      if (!phoneNumber) {
        return res.status(400).json({ error: 'Número do WhatsApp não fornecido' });
      }
      
      // Buscar usuário pelo número do WhatsApp
      const userResult = await pool.query(
        'SELECT id FROM users WHERE whatsapp_number = $1 OR whatsapp_number = $2',
        [phoneNumber, phoneNumber.replace(/^55/, '')] // Tenta com e sem código do país
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Usuário não encontrado para este número',
          phoneNumber: phoneNumber,
          hint: 'Cadastre seu número em /api/user/whatsapp'
        });
      }
      
      userId = userResult.rows[0].id;
      
      // Usar a mensagem encontrada
      if (!messageText) {
        return res.status(400).json({ error: 'Mensagem não fornecida' });
      }
      
      // Processar mensagem
      const transactionData = parseTransactionMessage(messageText);
      
      if (!transactionData.amount || transactionData.amount <= 0) {
        return res.status(400).json({ 
          error: 'Não foi possível identificar o valor na mensagem',
          parsed: transactionData,
          message: messageText
        });
      }
      
      // Criar transação
      const result = await pool.query(
        `INSERT INTO transactions (user_id, type, category, amount, date, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          userId,
          transactionData.type,
          transactionData.category,
          transactionData.amount,
          transactionData.date,
          transactionData.description,
          transactionData.status
        ]
      );
      
      return res.json({
        success: true,
        message: 'Transação criada com sucesso',
        transaction: result.rows[0]
      });
    }
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não identificado' });
    }
    
    // Processar mensagem (quando autenticado via token)
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Mensagem não fornecida' });
    }
    
    // Parsear mensagem
    const transactionData = parseTransactionMessage(message);
    
    if (!transactionData.amount || transactionData.amount <= 0) {
      return res.status(400).json({ 
        error: 'Não foi possível identificar o valor na mensagem',
        parsed: transactionData
      });
    }
    
    // Criar transação
    const result = await pool.query(
      `INSERT INTO transactions (user_id, type, category, amount, date, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        transactionData.type,
        transactionData.category,
        transactionData.amount,
        transactionData.date,
        transactionData.description,
        transactionData.status
      ]
    );
    
    res.json({
      success: true,
      message: 'Transação criada com sucesso',
      transaction: result.rows[0]
    });
    
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

// Endpoint para testar o parser
router.post('/test-parse', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Mensagem não fornecida' });
    }
    
    const parsed = parseTransactionMessage(message);
    
    res.json({
      original: message,
      parsed
    });
  } catch (error) {
    console.error('Erro ao testar parser:', error);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

export default router;

