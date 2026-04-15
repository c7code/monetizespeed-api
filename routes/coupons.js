import express from 'express';
import { authenticateToken, requireAdmin } from './auth.js';
import getPool from '../db.js';

const router = express.Router();

// ====== GET /api/coupons — Listar cupons (admin) ======
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar cupons:', error);
    res.status(500).json({ error: 'Erro ao listar cupons' });
  }
});

// ====== POST /api/coupons — Criar cupom (admin) ======
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { code, discount_type, discount_value, applies_to, status, valid_until } = req.body;

    if (!code || !discount_type || discount_value === undefined) {
      return res.status(400).json({ error: 'Código, tipo e valor do desconto são obrigatórios' });
    }

    if (!['percentage', 'fixed'].includes(discount_type)) {
      return res.status(400).json({ error: 'Tipo de desconto deve ser percentage ou fixed' });
    }

    if (discount_type === 'percentage' && (discount_value < 1 || discount_value > 100)) {
      return res.status(400).json({ error: 'Percentual de desconto deve ser entre 1 e 100' });
    }

    const pool = getPool();

    // Verificar se código já existe
    const existing = await pool.query('SELECT id FROM coupons WHERE UPPER(code) = UPPER($1)', [code]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Já existe um cupom com este código' });
    }

    const result = await pool.query(
      `INSERT INTO coupons (code, discount_type, discount_value, applies_to, status, valid_until)
       VALUES (UPPER($1), $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        code,
        discount_type,
        discount_value,
        applies_to || 'both',
        status || 'active',
        valid_until || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar cupom:', error);
    res.status(500).json({ error: 'Erro ao criar cupom' });
  }
});

// ====== PUT /api/coupons/:id — Editar cupom (admin) ======
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { code, discount_type, discount_value, applies_to, status, valid_until } = req.body;

    const pool = getPool();

    const existing = await pool.query('SELECT id FROM coupons WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cupom não encontrado' });
    }

    // Se mudou o código, verificar unicidade
    if (code) {
      const codeExists = await pool.query(
        'SELECT id FROM coupons WHERE UPPER(code) = UPPER($1) AND id != $2',
        [code, req.params.id]
      );
      if (codeExists.rows.length > 0) {
        return res.status(400).json({ error: 'Já existe outro cupom com este código' });
      }
    }

    const result = await pool.query(
      `UPDATE coupons SET 
        code = COALESCE(UPPER($1), code),
        discount_type = COALESCE($2, discount_type),
        discount_value = COALESCE($3, discount_value),
        applies_to = COALESCE($4, applies_to),
        status = COALESCE($5, status),
        valid_until = $6,
        updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        code || null,
        discount_type || null,
        discount_value !== undefined ? discount_value : null,
        applies_to || null,
        status || null,
        valid_until !== undefined ? valid_until : null,
        req.params.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar cupom:', error);
    res.status(500).json({ error: 'Erro ao atualizar cupom' });
  }
});

// ====== DELETE /api/coupons/:id — Deletar cupom (admin) ======
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.query('DELETE FROM coupons WHERE id = $1 RETURNING id', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cupom não encontrado' });
    }

    res.json({ message: 'Cupom excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar cupom:', error);
    res.status(500).json({ error: 'Erro ao deletar cupom' });
  }
});

// ====== POST /api/coupons/validate — Validar cupom (autenticado, usado no checkout) ======
router.post('/validate', authenticateToken, async (req, res) => {
  try {
    const { code, billing_type } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Código do cupom é obrigatório' });
    }

    const pool = getPool();

    const result = await pool.query(
      `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) AND status = 'active'`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cupom não encontrado ou inativo' });
    }

    const coupon = result.rows[0];

    // Verificar validade
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      return res.status(400).json({ error: 'Cupom expirado' });
    }

    // Verificar se aplica ao tipo de plano
    if (billing_type && coupon.applies_to !== 'both' && coupon.applies_to !== billing_type) {
      return res.status(400).json({
        error: `Este cupom é válido apenas para planos ${coupon.applies_to === 'monthly' ? 'mensais' : 'anuais'}`,
      });
    }

    res.json({
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        applies_to: coupon.applies_to,
      },
    });
  } catch (error) {
    console.error('Erro ao validar cupom:', error);
    res.status(500).json({ error: 'Erro ao validar cupom' });
  }
});

export default router;
