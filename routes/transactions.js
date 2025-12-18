import express from 'express';
import getPool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar transações do usuário
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar transações:', error);
    res.status(500).json({ error: 'Erro ao buscar transações' });
  }
});

// Criar transação
router.post('/', async (req, res) => {
  try {
    const { type, category, amount, date, description, recurring, status, receipt_url } = req.body;
    
    if (!type || !category || !amount || !date) {
      return res.status(400).json({ error: 'Campos obrigatórios: type, category, amount, date' });
    }

    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO transactions (user_id, type, category, amount, date, description, recurring, status, receipt_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user.userId, type, category, amount, date, description || null, recurring || false, status || (type === 'expense' ? 'paid' : 'received'), receipt_url || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar transação:', error);
    res.status(500).json({ error: 'Erro ao criar transação' });
  }
});

// Atualizar transação
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, category, amount, date, description, recurring, status, receipt_url } = req.body;

    const pool = getPool();
    // Verificar se a transação pertence ao usuário
    const check = await pool.query('SELECT id FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    const result = await pool.query(
      `UPDATE transactions 
       SET type = $1, category = $2, amount = $3, date = $4, description = $5, recurring = $6, status = $7, receipt_url = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND user_id = $10
       RETURNING *`,
      [type, category, amount, date, description || null, recurring || false, status, receipt_url || null, id, req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar transação:', error);
    res.status(500).json({ error: 'Erro ao atualizar transação' });
  }
});

// Deletar transação
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    res.json({ message: 'Transação deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar transação:', error);
    res.status(500).json({ error: 'Erro ao deletar transação' });
  }
});

export default router;




