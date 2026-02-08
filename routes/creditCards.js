import express from 'express';
import getPool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar cartões do usuário
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM credit_cards WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar cartões:', error);
    res.status(500).json({ error: 'Erro ao buscar cartões' });
  }
});

// Criar cartão
router.post('/', async (req, res) => {
  try {
    const { name, limit_amount, total_spent, closing_day, due_day } = req.body;
    
    if (!name || !limit_amount) {
      return res.status(400).json({ error: 'Campos obrigatórios: name, limit_amount' });
    }

    // Validar dias
    if (closing_day && (closing_day < 1 || closing_day > 31)) {
      return res.status(400).json({ error: 'Dia de fechamento deve estar entre 1 e 31' });
    }
    if (due_day && (due_day < 1 || due_day > 31)) {
      return res.status(400).json({ error: 'Dia de vencimento deve estar entre 1 e 31' });
    }

    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO credit_cards (user_id, name, limit_amount, total_spent, closing_day, due_day)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.user.userId,
        name,
        limit_amount,
        total_spent || 0,
        closing_day || null,
        due_day || null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar cartão:', error);
    res.status(500).json({ error: 'Erro ao criar cartão' });
  }
});

// Atualizar cartão
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, limit_amount, total_spent, closing_day, due_day } = req.body;

    // Validar dias se fornecidos
    if (closing_day !== undefined && closing_day !== null && (closing_day < 1 || closing_day > 31)) {
      return res.status(400).json({ error: 'Dia de fechamento deve estar entre 1 e 31' });
    }
    if (due_day !== undefined && due_day !== null && (due_day < 1 || due_day > 31)) {
      return res.status(400).json({ error: 'Dia de vencimento deve estar entre 1 e 31' });
    }

    const pool = getPool();
    // Verificar se o cartão pertence ao usuário
    const check = await pool.query('SELECT id FROM credit_cards WHERE id = $1 AND user_id = $2', [id, req.user.userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Cartão não encontrado' });
    }

    // Construir query dinamicamente baseado nos campos fornecidos
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (limit_amount !== undefined) {
      updates.push(`limit_amount = $${paramIndex++}`);
      values.push(limit_amount);
    }
    if (total_spent !== undefined) {
      updates.push(`total_spent = $${paramIndex++}`);
      values.push(total_spent);
    }
    if (closing_day !== undefined) {
      updates.push(`closing_day = $${paramIndex++}`);
      values.push(closing_day);
    }
    if (due_day !== undefined) {
      updates.push(`due_day = $${paramIndex++}`);
      values.push(due_day);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, req.user.userId);

    const result = await pool.query(
      `UPDATE credit_cards 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
       RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar cartão:', error);
    res.status(500).json({ error: 'Erro ao atualizar cartão' });
  }
});

// Deletar cartão
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM credit_cards WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cartão não encontrado' });
    }

    res.json({ message: 'Cartão deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar cartão:', error);
    res.status(500).json({ error: 'Erro ao deletar cartão' });
  }
});

export default router;
