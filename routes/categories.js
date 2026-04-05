import express from 'express';
import getPool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// GET /api/categories — Listar categorias do usuário
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, name, type, created_at FROM categories WHERE user_id = $1 ORDER BY name',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar categorias:', error);
    res.status(500).json({ error: 'Erro ao listar categorias' });
  }
});

// POST /api/categories — Criar categoria
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, type } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
    }

    const categoryType = ['expense', 'income', 'both'].includes(type) ? type : 'both';

    const pool = getPool();

    // Verificar duplicata
    const exists = await pool.query(
      'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
      [req.user.userId, name.trim()]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Categoria já existe' });
    }

    const result = await pool.query(
      'INSERT INTO categories (user_id, name, type) VALUES ($1, $2, $3) RETURNING id, name, type, created_at',
      [req.user.userId, name.trim(), categoryType]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

// PUT /api/categories/:id — Atualizar categoria
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
    }

    const pool = getPool();
    const categoryType = ['expense', 'income', 'both'].includes(type) ? type : 'both';

    const result = await pool.query(
      'UPDATE categories SET name = $1, type = $2 WHERE id = $3 AND user_id = $4 RETURNING id, name, type, created_at',
      [name.trim(), categoryType, id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

// DELETE /api/categories/:id — Excluir categoria
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    res.json({ message: 'Categoria excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir categoria:', error);
    res.status(500).json({ error: 'Erro ao excluir categoria' });
  }
});

export default router;
