import express from 'express';
import getPool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar contas a pagar do usuário
router.get('/', async (req, res) => {
    try {
        const { status, category, month, year } = req.query;
        const pool = getPool();

        let query = 'SELECT * FROM bills WHERE user_id = $1';
        const params = [req.user.userId];
        let paramIndex = 2;

        // Filtro por status
        if (status && status !== 'all') {
            query += ` AND status = $${paramIndex++}`;
            params.push(status);
        }

        // Filtro por categoria
        if (category) {
            query += ` AND category = $${paramIndex++}`;
            params.push(category);
        }

        // Filtro por mês/ano
        if (month && year) {
            query += ` AND EXTRACT(MONTH FROM due_date) = $${paramIndex++}`;
            params.push(parseInt(month));
            query += ` AND EXTRACT(YEAR FROM due_date) = $${paramIndex++}`;
            params.push(parseInt(year));
        }

        query += ' ORDER BY due_date ASC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar contas:', error);
        res.status(500).json({ error: 'Erro ao buscar contas' });
    }
});

// Obter resumo de contas
router.get('/summary', async (req, res) => {
    try {
        const { month, year } = req.query;
        const pool = getPool();

        let dateFilter = '';
        const params = [req.user.userId];
        let paramIndex = 2;

        if (month && year) {
            dateFilter = ` AND EXTRACT(MONTH FROM due_date) = $${paramIndex++} AND EXTRACT(YEAR FROM due_date) = $${paramIndex++}`;
            params.push(parseInt(month), parseInt(year));
        }

        // Total pendente
        const pendingResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
       FROM bills WHERE user_id = $1 AND status = 'pending'${dateFilter}`,
            params
        );

        // Total atrasado
        const overdueResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
       FROM bills WHERE user_id = $1 AND status = 'overdue'${dateFilter}`,
            params
        );

        // Total pago
        const paidResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
       FROM bills WHERE user_id = $1 AND status = 'paid'${dateFilter}`,
            params
        );

        res.json({
            pending: {
                total: parseFloat(pendingResult.rows[0].total),
                count: parseInt(pendingResult.rows[0].count)
            },
            overdue: {
                total: parseFloat(overdueResult.rows[0].total),
                count: parseInt(overdueResult.rows[0].count)
            },
            paid: {
                total: parseFloat(paidResult.rows[0].total),
                count: parseInt(paidResult.rows[0].count)
            }
        });
    } catch (error) {
        console.error('Erro ao calcular resumo:', error);
        res.status(500).json({ error: 'Erro ao calcular resumo' });
    }
});

// Criar conta a pagar
router.post('/', async (req, res) => {
    try {
        const {
            description,
            amount,
            due_date,
            category,
            supplier_name,
            supplier_document,
            supplier_contact,
            supplier_phone,
            payment_method,
            pix_key,
            wallet_id,
            is_recurring,
            notes
        } = req.body;

        if (!description || !amount || !due_date) {
            return res.status(400).json({ error: 'Campos obrigatórios: description, amount, due_date' });
        }

        const pool = getPool();

        // Determinar status inicial baseado na data de vencimento
        const dueDate = new Date(due_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const status = dueDate < today ? 'overdue' : 'pending';

        const result = await pool.query(
            `INSERT INTO bills (
        user_id, description, amount, due_date, status, category,
        supplier_name, supplier_document, supplier_contact, supplier_phone,
        payment_method, pix_key, wallet_id, is_recurring, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
            [
                req.user.userId, description, amount, due_date, status, category || null,
                supplier_name || null, supplier_document || null, supplier_contact || null, supplier_phone || null,
                payment_method || 'pix', pix_key || null, wallet_id || null, is_recurring || false, notes || null
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao criar conta:', error);
        res.status(500).json({ error: 'Erro ao criar conta' });
    }
});

// Atualizar conta
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = getPool();

        // Verificar se a conta pertence ao usuário
        const check = await pool.query(
            'SELECT id FROM bills WHERE id = $1 AND user_id = $2',
            [id, req.user.userId]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        const fields = [
            'description', 'amount', 'due_date', 'status', 'category',
            'supplier_name', 'supplier_document', 'supplier_contact', 'supplier_phone',
            'payment_method', 'pix_key', 'wallet_id', 'is_recurring', 'notes', 'paid_date'
        ];

        const updates = [];
        const values = [];
        let paramIndex = 1;

        for (const field of fields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = $${paramIndex++}`);
                values.push(req.body[field]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id, req.user.userId);

        const result = await pool.query(
            `UPDATE bills SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
       RETURNING *`,
            values
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao atualizar conta:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta' });
    }
});

// Marcar como paga
router.patch('/:id/pay', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = getPool();

        const result = await pool.query(
            `UPDATE bills 
       SET status = 'paid', paid_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
            [id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao marcar como paga:', error);
        res.status(500).json({ error: 'Erro ao marcar como paga' });
    }
});

// Deletar conta
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = getPool();

        const result = await pool.query(
            'DELETE FROM bills WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        res.json({ message: 'Conta deletada com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar conta:', error);
        res.status(500).json({ error: 'Erro ao deletar conta' });
    }
});

export default router;
