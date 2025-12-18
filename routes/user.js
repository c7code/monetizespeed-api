import express from 'express';
import getPool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Atualizar número do WhatsApp
router.put('/whatsapp', async (req, res) => {
  try {
    const { whatsapp_number } = req.body;
    
    if (!whatsapp_number) {
      return res.status(400).json({ error: 'Número do WhatsApp é obrigatório' });
    }
    
    // Validar formato básico (apenas números, pode ter + no início)
    const cleanNumber = whatsapp_number.replace(/[^\d+]/g, '');
    if (cleanNumber.length < 10) {
      return res.status(400).json({ error: 'Número inválido' });
    }
    
    const pool = getPool();
    const result = await pool.query(
      'UPDATE users SET whatsapp_number = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, email, whatsapp_number',
      [cleanNumber, req.user.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    res.json({
      message: 'Número do WhatsApp atualizado com sucesso',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Erro ao atualizar WhatsApp:', error);
    res.status(500).json({ error: 'Erro ao atualizar número do WhatsApp' });
  }
});

// Obter informações do usuário
router.get('/me', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, email, name, whatsapp_number, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar informações do usuário' });
  }
});

export default router;




