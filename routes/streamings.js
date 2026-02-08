import express from 'express';
import getPool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

router.use(authenticateToken);

const streamingColors = [
    '#E50914', // Netflix red
    '#1DB954', // Spotify green
    '#00A8E1', // Prime Video blue
    '#6B5CE7', // Twitch purple
    '#FF0050', // YouTube red
    '#1877F2', // Facebook blue
    '#E1306C', // Instagram pink
    '#000000', // Apple black
    '#0078D4', // Microsoft blue
    '#00B2FF', // Disney+ blue
    '#8B5CF6', // HBO Max purple
    '#F97316', // Crunchyroll orange
    '#14B8A6', // Generic teal
    '#EC4899', // Generic pink
    '#8B5CF6', // Generic purple
];

// Função para gerar cor baseada no nome
function generateColor(name, existingColors = []) {
    // Primeiro tenta encontrar uma cor que não foi usada
    const availableColors = streamingColors.filter(c => !existingColors.includes(c));

    if (availableColors.length > 0) {
        // Usa hash do nome para escolher uma cor consistente
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % availableColors.length;
        return availableColors[index];
    }

    // Se todas as cores foram usadas, gera uma cor baseada no hash do nome
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

// Listar streamings do usuário
router.get('/', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM streamings WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar streamings:', error);
        res.status(500).json({ error: 'Erro ao buscar streamings' });
    }
});

// Obter total de gastos com streamings
router.get('/total', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query(
            'SELECT COALESCE(SUM(monthly_price), 0) as total_monthly FROM streamings WHERE user_id = $1',
            [req.user.userId]
        );
        res.json({
            total_monthly: parseFloat(result.rows[0].total_monthly),
            total_yearly: parseFloat(result.rows[0].total_monthly) * 12
        });
    } catch (error) {
        console.error('Erro ao calcular total de streamings:', error);
        res.status(500).json({ error: 'Erro ao calcular total de streamings' });
    }
});

// Criar streaming
router.post('/', async (req, res) => {
    try {
        const { name, monthly_price } = req.body;

        if (!name || !monthly_price) {
            return res.status(400).json({ error: 'Campos obrigatórios: name, monthly_price' });
        }

        const pool = getPool();

        const existingResult = await pool.query(
            'SELECT color FROM streamings WHERE user_id = $1',
            [req.user.userId]
        );
        const existingColors = existingResult.rows.map(r => r.color);

        const color = generateColor(name, existingColors);

        const result = await pool.query(
            `INSERT INTO streamings (user_id, name, monthly_price, color)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
            [req.user.userId, name, monthly_price, color]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao criar streaming:', error);
        res.status(500).json({ error: 'Erro ao criar streaming' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, monthly_price, color } = req.body;

        const pool = getPool();

        const check = await pool.query(
            'SELECT id FROM streamings WHERE id = $1 AND user_id = $2',
            [id, req.user.userId]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Streaming não encontrado' });
        }

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (monthly_price !== undefined) {
            updates.push(`monthly_price = $${paramIndex++}`);
            values.push(monthly_price);
        }
        if (color !== undefined) {
            updates.push(`color = $${paramIndex++}`);
            values.push(color);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id, req.user.userId);

        const result = await pool.query(
            `UPDATE streamings 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
       RETURNING *`,
            values
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao atualizar streaming:', error);
        res.status(500).json({ error: 'Erro ao atualizar streaming' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const pool = getPool();
        const result = await pool.query(
            'DELETE FROM streamings WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Streaming não encontrado' });
        }

        res.json({ message: 'Streaming deletado com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar streaming:', error);
        res.status(500).json({ error: 'Erro ao deletar streaming' });
    }
});

export default router;
