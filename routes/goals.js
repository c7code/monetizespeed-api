import express from 'express';
import pool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar metas do usuário
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, target, saved FROM goals WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar metas:', error);
    res.status(500).json({ error: 'Erro ao buscar metas' });
  }
});

// Criar meta
router.post('/', async (req, res) => {
  try {
    const { name, target, saved } = req.body;
    
    if (!name || !target) {
      return res.status(400).json({ error: 'Campos obrigatórios: name, target' });
    }

    const result = await pool.query(
      'INSERT INTO goals (user_id, name, target, saved) VALUES ($1, $2, $3, $4) RETURNING id, name, target, saved',
      [req.user.userId, name, target, saved || 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar meta:', error);
    res.status(500).json({ error: 'Erro ao criar meta' });
  }
});

// Atualizar meta
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, target, saved } = req.body;

    // Verificar se a meta pertence ao usuário
    const check = await pool.query('SELECT id FROM goals WHERE id = $1 AND user_id = $2', [id, req.user.userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Meta não encontrada' });
    }

    const result = await pool.query(
      `UPDATE goals 
       SET name = $1, target = $2, saved = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND user_id = $5
       RETURNING id, name, target, saved`,
      [name, target, saved || 0, id, req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar meta:', error);
    res.status(500).json({ error: 'Erro ao atualizar meta' });
  }
});

// Deletar meta
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM goals WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meta não encontrada' });
    }

    res.json({ message: 'Meta deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar meta:', error);
    res.status(500).json({ error: 'Erro ao deletar meta' });
  }
});

export default router;




