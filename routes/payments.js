import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from './auth.js';
import getPool from '../db.js';
import {
  createCustomer,
  createSubscription,
  cancelSubscription,
  getSubscription,
  createOrder,
} from '../services/pagarme.js';

const router = express.Router();

// ====== HELPERS ======

function generateAccessCode() {
  // Gera código de 8 caracteres alfanuméricos (maiúsculos)
  return crypto.randomBytes(5).toString('hex').toUpperCase().substring(0, 8);
}

async function ensurePagarmeCustomer(pool, userId) {
  // Busca ou cria customer no Pagar.me para o usuário
  const userResult = await pool.query(
    'SELECT id, email, name, pagarme_customer_id FROM users WHERE id = $1',
    [userId]
  );
  if (userResult.rows.length === 0) throw new Error('Usuário não encontrado');

  const user = userResult.rows[0];

  if (user.pagarme_customer_id) {
    return user.pagarme_customer_id;
  }

  // Criar customer no Pagar.me
  const customer = await createCustomer({
    name: user.name || user.email.split('@')[0],
    email: user.email,
    document: '00000000000', // CPF placeholder — será pedido no checkout
  });

  await pool.query(
    'UPDATE users SET pagarme_customer_id = $1 WHERE id = $2',
    [customer.id, userId]
  );

  return customer.id;
}

// ====== GET /api/payments/status — Status do plano do usuário ======

router.get('/status', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const userResult = await pool.query(
      'SELECT plan_status, plan_expires_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];

    // Buscar assinatura ativa
    const subResult = await pool.query(
      `SELECT id, pagarme_subscription_id, status, current_period_end 
       FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.userId]
    );

    // Buscar códigos comprados pelo usuário
    const codesResult = await pool.query(
      `SELECT code, status, redeemed_by_user_id, created_at, redeemed_at 
       FROM access_codes WHERE purchaser_user_id = $1 ORDER BY created_at DESC`,
      [req.user.userId]
    );

    res.json({
      plan_status: user.plan_status,
      plan_expires_at: user.plan_expires_at,
      subscription: subResult.rows[0] || null,
      access_codes: codesResult.rows,
    });
  } catch (error) {
    console.error('Erro ao buscar status do plano:', error);
    res.status(500).json({ error: 'Erro ao buscar status do plano' });
  }
});

// ====== POST /api/payments/subscribe — Criar assinatura mensal ======

router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { cardToken, document, name } = req.body;

    if (!cardToken) {
      return res.status(400).json({ error: 'Token do cartão é obrigatório' });
    }

    const pool = getPool();

    // Atualizar CPF do usuário se fornecido
    if (document) {
      // Limpar CPF existente no Pagar.me — vamos recriar
      await pool.query(
        'UPDATE users SET pagarme_customer_id = NULL WHERE id = $1',
        [req.user.userId]
      );
    }

    // Atualizar nome se fornecido
    if (name) {
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.userId]);
    }

    // Criar ou buscar customer no Pagar.me (com CPF atualizado)
    let customerId;
    if (document) {
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [req.user.userId]
      );
      const user = userResult.rows[0];

      const customer = await createCustomer({
        name: name || user.name || user.email.split('@')[0],
        email: user.email,
        document: document.replace(/\D/g, ''),
      });

      customerId = customer.id;
      await pool.query(
        'UPDATE users SET pagarme_customer_id = $1 WHERE id = $2',
        [customerId, req.user.userId]
      );
    } else {
      customerId = await ensurePagarmeCustomer(pool, req.user.userId);
    }

    // Cancelar assinatura anterior se existir
    const existingSub = await pool.query(
      `SELECT pagarme_subscription_id FROM subscriptions 
       WHERE user_id = $1 AND status = 'active'`,
      [req.user.userId]
    );
    if (existingSub.rows.length > 0) {
      try {
        await cancelSubscription(existingSub.rows[0].pagarme_subscription_id);
      } catch (e) {
        console.warn('⚠️ Erro ao cancelar assinatura anterior:', e.message);
      }
    }

    // Criar assinatura no Pagar.me
    const subscription = await createSubscription({
      customerId,
      cardToken,
      planAmount: 2990, // R$ 29,90
    });

    // Salvar no banco
    await pool.query(
      `INSERT INTO subscriptions (user_id, pagarme_subscription_id, status, current_period_end)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pagarme_subscription_id) DO UPDATE 
       SET status = $3, current_period_end = $4, updated_at = NOW()`,
      [
        req.user.userId,
        subscription.id,
        subscription.status === 'active' ? 'active' : 'pending',
        subscription.current_cycle?.end_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ]
    );

    // Atualizar status do usuário
    const expiresAt = subscription.current_cycle?.end_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
      [expiresAt, req.user.userId]
    );

    res.json({
      message: 'Assinatura criada com sucesso!',
      subscription: {
        id: subscription.id,
        status: subscription.status,
      },
      plan_status: 'active',
      plan_expires_at: expiresAt,
    });
  } catch (error) {
    console.error('Erro ao criar assinatura:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Erro ao criar assinatura',
    });
  }
});

// ====== POST /api/payments/cancel-subscription — Cancelar assinatura ======

router.post('/cancel-subscription', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();

    const subResult = await pool.query(
      `SELECT pagarme_subscription_id FROM subscriptions 
       WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [req.user.userId]
    );

    if (subResult.rows.length === 0) {
      return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada' });
    }

    const pagarmeSubId = subResult.rows[0].pagarme_subscription_id;

    // Cancelar no Pagar.me
    await cancelSubscription(pagarmeSubId);

    // Atualizar no banco
    await pool.query(
      `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() 
       WHERE pagarme_subscription_id = $1`,
      [pagarmeSubId]
    );

    // Manter o acesso até o fim do período pago
    // Não altera plan_status e plan_expires_at agora
    // O webhook ou cron atualizará quando expirar

    res.json({ message: 'Assinatura cancelada. O acesso permanece ativo até o fim do período pago.' });
  } catch (error) {
    console.error('Erro ao cancelar assinatura:', error);
    res.status(500).json({ error: 'Erro ao cancelar assinatura' });
  }
});

// ====== POST /api/payments/buy-access-codes — Comprar códigos de acesso ======

router.post('/buy-access-codes', authenticateToken, async (req, res) => {
  try {
    const { cardToken, document, name, quantity } = req.body;

    if (!cardToken) {
      return res.status(400).json({ error: 'Token do cartão é obrigatório' });
    }

    const qty = parseInt(quantity);
    if (!qty || qty < 1 || qty > 50) {
      return res.status(400).json({ error: 'Quantidade deve ser entre 1 e 50' });
    }

    const pool = getPool();

    // Atualizar CPF se fornecido
    if (document) {
      await pool.query('UPDATE users SET pagarme_customer_id = NULL WHERE id = $1', [req.user.userId]);
    }
    if (name) {
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.userId]);
    }

    // Customer
    let customerId;
    if (document) {
      const userResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.userId]);
      const user = userResult.rows[0];

      const customer = await createCustomer({
        name: name || user.name || user.email.split('@')[0],
        email: user.email,
        document: document.replace(/\D/g, ''),
      });
      customerId = customer.id;
      await pool.query('UPDATE users SET pagarme_customer_id = $1 WHERE id = $2', [customerId, req.user.userId]);
    } else {
      customerId = await ensurePagarmeCustomer(pool, req.user.userId);
    }

    // Criar order no Pagar.me
    const order = await createOrder({
      customerId,
      cardToken,
      quantity: qty,
      unitPrice: 2990, // R$ 29,90 cada
    });

    // Se o pagamento foi aprovado, gerar os códigos
    const isPaid = order.status === 'paid' ||
      order.charges?.some(c => c.status === 'paid' || c.last_transaction?.status === 'captured');

    const codes = [];
    if (isPaid) {
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
           VALUES ($1, $2, $3, 'active', 30)`,
          [code, req.user.userId, order.id]
        );
        codes.push(code);
      }
    }

    res.json({
      message: isPaid
        ? `${qty} código(s) de acesso gerado(s) com sucesso!`
        : 'Pedido criado, aguardando confirmação de pagamento.',
      order_id: order.id,
      order_status: order.status,
      codes: isPaid ? codes : [],
    });
  } catch (error) {
    console.error('Erro ao comprar códigos de acesso:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Erro ao processar compra',
    });
  }
});

// ====== POST /api/payments/redeem-code — Resgatar código de acesso ======

router.post('/redeem-code', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Código é obrigatório' });
    }

    const cleanCode = code.trim().toUpperCase();

    const pool = getPool();

    // Buscar código
    const codeResult = await pool.query(
      `SELECT id, purchaser_user_id, status, duration_days FROM access_codes WHERE code = $1`,
      [cleanCode]
    );

    if (codeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Código inválido ou não encontrado' });
    }

    const accessCode = codeResult.rows[0];

    if (accessCode.status === 'redeemed') {
      return res.status(400).json({ error: 'Este código já foi utilizado' });
    }

    if (accessCode.purchaser_user_id === req.user.userId) {
      return res.status(400).json({ error: 'Você não pode resgatar um código comprado por você mesmo' });
    }

    // Marcar código como resgatado
    await pool.query(
      `UPDATE access_codes SET status = 'redeemed', redeemed_by_user_id = $1, redeemed_at = NOW()
       WHERE id = $2`,
      [req.user.userId, accessCode.id]
    );

    // Atualizar plano do usuário
    const durationDays = accessCode.duration_days || 30;
    const currentExpires = await pool.query(
      'SELECT plan_expires_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    // Se já tem plano ativo, adicionar dias ao vencimento atual
    let newExpires;
    const currentExp = currentExpires.rows[0]?.plan_expires_at;
    if (currentExp && new Date(currentExp) > new Date()) {
      newExpires = new Date(new Date(currentExp).getTime() + durationDays * 24 * 60 * 60 * 1000);
    } else {
      newExpires = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    }

    await pool.query(
      `UPDATE users SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
      [newExpires, req.user.userId]
    );

    res.json({
      message: `Código resgatado com sucesso! Acesso ativo até ${newExpires.toLocaleDateString('pt-BR')}.`,
      plan_status: 'active',
      plan_expires_at: newExpires,
    });
  } catch (error) {
    console.error('Erro ao resgatar código:', error);
    res.status(500).json({ error: 'Erro ao resgatar código' });
  }
});

export default router;
