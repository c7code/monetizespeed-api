import express from 'express';
import getPool from '../db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar carteiras do usuário
router.get('/', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM wallets WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar carteiras:', error);
        res.status(500).json({ error: 'Erro ao buscar carteiras' });
    }
});

// Obter saldo total de todas as carteiras
router.get('/total', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query(
            'SELECT COALESCE(SUM(balance), 0) as total_balance FROM wallets WHERE user_id = $1',
            [req.user.userId]
        );
        res.json({ total_balance: parseFloat(result.rows[0].total_balance) });
    } catch (error) {
        console.error('Erro ao calcular saldo total:', error);
        res.status(500).json({ error: 'Erro ao calcular saldo total' });
    }
});

// Obter carteira por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM wallets WHERE id = $1 AND user_id = $2',
            [id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Carteira não encontrada' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao buscar carteira:', error);
        res.status(500).json({ error: 'Erro ao buscar carteira' });
    }
});

// Criar carteira
router.post('/', async (req, res) => {
    try {
        const { name, bank_name, account_type, initial_balance, bank_logo_url } = req.body;

        if (!name || !account_type) {
            return res.status(400).json({ error: 'Campos obrigatórios: name, account_type' });
        }

        // Validar tipo de conta
        const validAccountTypes = ['conta_corrente', 'poupanca', 'investimento', 'carteira', 'outro'];
        if (!validAccountTypes.includes(account_type)) {
            return res.status(400).json({
                error: 'Tipo de conta inválido. Valores aceitos: conta_corrente, poupanca, investimento, carteira, outro'
            });
        }

        const pool = getPool();
        const result = await pool.query(
            `INSERT INTO wallets (user_id, name, bank_name, account_type, balance, bank_logo_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
            [
                req.user.userId,
                name,
                bank_name || null,
                account_type,
                initial_balance || 0,
                bank_logo_url || null
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao criar carteira:', error);
        res.status(500).json({ error: 'Erro ao criar carteira' });
    }
});

// Atualizar carteira
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, bank_name, account_type, balance, bank_logo_url } = req.body;

        // Validar tipo de conta se fornecido
        const validAccountTypes = ['conta_corrente', 'poupanca', 'investimento', 'carteira', 'outro'];
        if (account_type !== undefined && !validAccountTypes.includes(account_type)) {
            return res.status(400).json({
                error: 'Tipo de conta inválido. Valores aceitos: conta_corrente, poupanca, investimento, carteira, outro'
            });
        }

        const pool = getPool();
        // Verificar se a carteira pertence ao usuário
        const check = await pool.query('SELECT id FROM wallets WHERE id = $1 AND user_id = $2', [id, req.user.userId]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Carteira não encontrada' });
        }

        // Construir query dinamicamente baseado nos campos fornecidos
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (bank_name !== undefined) {
            updates.push(`bank_name = $${paramIndex++}`);
            values.push(bank_name);
        }
        if (account_type !== undefined) {
            updates.push(`account_type = $${paramIndex++}`);
            values.push(account_type);
        }
        if (balance !== undefined) {
            updates.push(`balance = $${paramIndex++}`);
            values.push(balance);
        }
        if (bank_logo_url !== undefined) {
            updates.push(`bank_logo_url = $${paramIndex++}`);
            values.push(bank_logo_url);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id, req.user.userId);

        const result = await pool.query(
            `UPDATE wallets 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
       RETURNING *`,
            values
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao atualizar carteira:', error);
        res.status(500).json({ error: 'Erro ao atualizar carteira' });
    }
});

// Atualizar saldo da carteira (adicionar ou subtrair)
router.patch('/:id/balance', async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, operation } = req.body;

        if (amount === undefined || !operation) {
            return res.status(400).json({ error: 'Campos obrigatórios: amount, operation (add/subtract)' });
        }

        if (!['add', 'subtract'].includes(operation)) {
            return res.status(400).json({ error: 'Operação inválida. Use: add ou subtract' });
        }

        const pool = getPool();
        // Verificar se a carteira pertence ao usuário
        const check = await pool.query('SELECT id, balance FROM wallets WHERE id = $1 AND user_id = $2', [id, req.user.userId]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Carteira não encontrada' });
        }

        const currentBalance = parseFloat(check.rows[0].balance);
        const newBalance = operation === 'add'
            ? currentBalance + parseFloat(amount)
            : currentBalance - parseFloat(amount);

        const result = await pool.query(
            `UPDATE wallets 
       SET balance = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
            [newBalance, id, req.user.userId]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao atualizar saldo:', error);
        res.status(500).json({ error: 'Erro ao atualizar saldo' });
    }
});

// Deletar carteira
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const pool = getPool();
        const result = await pool.query(
            'DELETE FROM wallets WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Carteira não encontrada' });
        }

        res.json({ message: 'Carteira deletada com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar carteira:', error);
        res.status(500).json({ error: 'Erro ao deletar carteira' });
    }
});

export default router;
