import express from 'express';
import crypto from 'crypto';
import { authenticateToken, requireAdmin } from './auth.js';
import getPool from '../db.js';

const router = express.Router();

// Helper: gerar código de acesso
function generateAccessCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase().substring(0, 8);
}

// ====== GET /api/plans — Listar planos (público: só ativos, admin: todos) ======
router.get('/', async (req, res) => {
  try {
    const pool = getPool();

    // Verificar se é admin para retornar todos ou só ativos
    let isAdmin = false;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try {
        const jwt = await import('jsonwebtoken');
        const token = authHeader.split(' ')[1];
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        isAdmin = adminEmails.includes(decoded.email?.toLowerCase());
      } catch { /* not admin */ }
    }

    const query = isAdmin
      ? 'SELECT * FROM plans ORDER BY billing_type ASC, created_at ASC'
      : `SELECT * FROM plans WHERE status = 'active' ORDER BY billing_type ASC, created_at ASC`;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar planos:', error);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
});

// ====== CÓDIGOS DE ACESSO (Admin) — rotas antes de /:id para evitar conflito ======

// GET /api/plans/access-codes — Listar todos os códigos de acesso
router.get('/access-codes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        ac.*,
        u_purchaser.email as purchaser_email,
        u_purchaser.name as purchaser_name,
        u_redeemed.email as redeemed_by_email,
        u_redeemed.name as redeemed_by_name
      FROM access_codes ac
      LEFT JOIN users u_purchaser ON ac.purchaser_user_id = u_purchaser.id
      LEFT JOIN users u_redeemed ON ac.redeemed_by_user_id = u_redeemed.id
      ORDER BY ac.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar códigos:', error);
    res.status(500).json({ error: 'Erro ao listar códigos de acesso' });
  }
});

// POST /api/plans/access-codes — Gerar códigos de acesso (admin, sem pagamento)
router.post('/access-codes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { quantity, duration_days } = req.body;

    const qty = parseInt(quantity) || 1;
    if (qty < 1 || qty > 100) {
      return res.status(400).json({ error: 'Quantidade deve ser entre 1 e 100' });
    }

    const days = parseInt(duration_days) || 30;
    if (days < 1 || days > 3650) {
      return res.status(400).json({ error: 'Duração deve ser entre 1 e 3650 dias' });
    }

    const pool = getPool();
    const codes = [];

    for (let i = 0; i < qty; i++) {
      let code;
      let unique = false;
      while (!unique) {
        code = generateAccessCode();
        const exists = await pool.query('SELECT id FROM access_codes WHERE code = $1', [code]);
        if (exists.rows.length === 0) unique = true;
      }

      await pool.query(
        `INSERT INTO access_codes (code, purchaser_user_id, order_id, status, duration_days)
         VALUES ($1, NULL, 'ADMIN_GENERATED', 'active', $2)`,
        [code, days]
      );
      codes.push(code);
    }

    res.status(201).json({
      message: `${qty} código(s) de acesso gerado(s) com sucesso!`,
      codes,
      duration_days: days,
    });
  } catch (error) {
    console.error('Erro ao gerar códigos:', error);
    res.status(500).json({ error: 'Erro ao gerar códigos de acesso' });
  }
});

// DELETE /api/plans/access-codes/:id — Deletar código de acesso (admin)
router.delete('/access-codes/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM access_codes WHERE id = $1 RETURNING id, code',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Código não encontrado' });
    }

    res.json({ message: `Código "${result.rows[0].code}" excluído` });
  } catch (error) {
    console.error('Erro ao deletar código:', error);
    res.status(500).json({ error: 'Erro ao deletar código' });
  }
});

// ====== GET /api/plans/:id — Detalhes de um plano ======
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM plans WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar plano:', error);
    res.status(500).json({ error: 'Erro ao buscar plano' });
  }
});

// ====== POST /api/plans — Criar plano (admin) ======
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description, billing_type, status, price_card, price_pix, promo_price_card, promo_price_pix } = req.body;

    if (!name || !billing_type) {
      return res.status(400).json({ error: 'Nome e tipo de cobrança são obrigatórios' });
    }

    if (!['monthly', 'yearly'].includes(billing_type)) {
      return res.status(400).json({ error: 'Tipo de cobrança deve ser monthly ou yearly' });
    }

    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO plans (name, description, billing_type, status, price_card, price_pix, promo_price_card, promo_price_pix)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        description || null,
        billing_type,
        status || 'active',
        price_card || 0,
        price_pix || 0,
        promo_price_card || null,
        promo_price_pix || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar plano:', error);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
});

// ====== PUT /api/plans/:id — Editar plano (admin) ======
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description, billing_type, status, price_card, price_pix, promo_price_card, promo_price_pix } = req.body;

    const pool = getPool();

    // Verificar se existe
    const existing = await pool.query('SELECT id FROM plans WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    const result = await pool.query(
      `UPDATE plans SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        billing_type = COALESCE($3, billing_type),
        status = COALESCE($4, status),
        price_card = COALESCE($5, price_card),
        price_pix = COALESCE($6, price_pix),
        promo_price_card = $7,
        promo_price_pix = $8,
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        name || null,
        description !== undefined ? description : null,
        billing_type || null,
        status || null,
        price_card !== undefined ? price_card : null,
        price_pix !== undefined ? price_pix : null,
        promo_price_card !== undefined ? promo_price_card : null,
        promo_price_pix !== undefined ? promo_price_pix : null,
        req.params.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar plano:', error);
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
});

// ====== DELETE /api/plans/:id — Deletar plano (admin) ======
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.query('DELETE FROM plans WHERE id = $1 RETURNING id', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    res.json({ message: 'Plano excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar plano:', error);
    res.status(500).json({ error: 'Erro ao deletar plano' });
  }
});

export default router;
