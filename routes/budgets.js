import express from 'express';
import pool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar orçamentos do usuário
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, category, limit_amount as limit FROM budgets WHERE user_id = $1 ORDER BY category',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar orçamentos:', error);
    res.status(500).json({ error: 'Erro ao buscar orçamentos' });
  }
});

// Criar orçamento
router.post('/', async (req, res) => {
  try {
    const { category, limit } = req.body;
    
    if (!category || !limit) {
      return res.status(400).json({ error: 'Campos obrigatórios: category, limit' });
    }

    // Verificar se já existe orçamento para essa categoria
    const existing = await pool.query(
      'SELECT id FROM budgets WHERE user_id = $1 AND category = $2',
      [req.user.userId, category]
    );

    let result;
    if (existing.rows.length > 0) {
      // Atualizar existente
      result = await pool.query(
        'UPDATE budgets SET limit_amount = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING id, category, limit_amount as limit',
        [limit, existing.rows[0].id, req.user.userId]
      );
    } else {
      // Criar novo
      result = await pool.query(
        'INSERT INTO budgets (user_id, category, limit_amount) VALUES ($1, $2, $3) RETURNING id, category, limit_amount as limit',
        [req.user.userId, category, limit]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar/atualizar orçamento:', error);
    res.status(500).json({ error: 'Erro ao salvar orçamento' });
  }
});

// Atualizar orçamento
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { category, limit } = req.body;

    // Verificar se o orçamento pertence ao usuário
    const check = await pool.query('SELECT id FROM budgets WHERE id = $1 AND user_id = $2', [id, req.user.userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Orçamento não encontrado' });
    }

    const result = await pool.query(
      `UPDATE budgets 
       SET category = $1, limit_amount = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4
       RETURNING id, category, limit_amount as limit`,
      [category, limit, id, req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar orçamento:', error);
    res.status(500).json({ error: 'Erro ao atualizar orçamento' });
  }
});

// Deletar orçamento
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM budgets WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orçamento não encontrado' });
    }

    res.json({ message: 'Orçamento deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar orçamento:', error);
    res.status(500).json({ error: 'Erro ao deletar orçamento' });
  }
});

export default router;




