import express from 'express';
import crypto from 'crypto';
import getPool from '../db.js';

const router = express.Router();

// Função para gerar código de acesso
function generateAccessCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase().substring(0, 8);
}

// Verificar assinatura do webhook do Pagar.me (HMAC SHA256)
function verifyWebhookSignature(req) {
  const signature = req.headers['x-hub-signature'];
  if (!signature || !process.env.PAGARME_WEBHOOK_SECRET) {
    // Se não há segredo configurado, aceitar (dev/testing)
    console.warn('⚠️ Webhook sem verificação de assinatura (PAGARME_WEBHOOK_SECRET não configurado)');
    return true;
  }

  const body = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', process.env.PAGARME_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return signature === expectedSignature;
}

// POST /webhooks/pagarme — Receber eventos do Pagar.me
router.post('/', async (req, res) => {
  try {
    // Responder 200 imediatamente para não ultrapassar timeout
    res.status(200).json({ received: true });

    // Verificar assinatura
    if (!verifyWebhookSignature(req)) {
      console.error('❌ Webhook com assinatura inválida');
      return;
    }

    const event = req.body;
    console.log(`📩 Webhook Pagar.me: ${event.type}`);

    const pool = getPool();

    switch (event.type) {
      // ====== SUBSCRIPTION EVENTS ======
      case 'subscription.created':
      case 'subscription.updated': {
        const sub = event.data;
        if (!sub?.id) break;

        await pool.query(
          `UPDATE subscriptions 
           SET status = $1, current_period_end = $2, updated_at = NOW()
           WHERE pagarme_subscription_id = $3`,
          [
            mapSubscriptionStatus(sub.status),
            sub.current_cycle?.end_at || null,
            sub.id,
          ]
        );

        // Atualizar plan_status do usuário
        if (sub.status === 'active') {
          const subRow = await pool.query(
            'SELECT user_id FROM subscriptions WHERE pagarme_subscription_id = $1',
            [sub.id]
          );
          if (subRow.rows.length > 0) {
            await pool.query(
              `UPDATE users SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
              [sub.current_cycle?.end_at, subRow.rows[0].user_id]
            );
          }
        }
        break;
      }

      case 'subscription.canceled': {
        const sub = event.data;
        if (!sub?.id) break;

        await pool.query(
          `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
           WHERE pagarme_subscription_id = $1`,
          [sub.id]
        );
        // Não remover acesso imediatamente — deixar expirar no plan_expires_at
        break;
      }

      // ====== CHARGE/INVOICE EVENTS (renovação de assinatura) ======
      case 'charge.paid':
      case 'invoice.paid': {
        const data = event.data;
        const subscriptionId = data.subscription_id || data.subscription?.id;

        if (subscriptionId) {
          // Renovação de assinatura paga — estender período
          const subRow = await pool.query(
            'SELECT user_id FROM subscriptions WHERE pagarme_subscription_id = $1',
            [subscriptionId]
          );

          if (subRow.rows.length > 0) {
            const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await pool.query(
              `UPDATE users SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
              [newExpires, subRow.rows[0].user_id]
            );
            await pool.query(
              `UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = NOW()
               WHERE pagarme_subscription_id = $2`,
              [newExpires, subscriptionId]
            );
          }
        }
        break;
      }

      case 'charge.payment_failed':
      case 'invoice.payment_failed': {
        const data = event.data;
        const subscriptionId = data.subscription_id || data.subscription?.id;

        if (subscriptionId) {
          await pool.query(
            `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
             WHERE pagarme_subscription_id = $1`,
            [subscriptionId]
          );
        }
        break;
      }

      // ====== ORDER EVENTS (compra de códigos de acesso) ======
      case 'order.paid': {
        const order = event.data;
        if (!order?.id) break;

        // Verificar se já foram gerados códigos para este order
        const existingCodes = await pool.query(
          'SELECT id FROM access_codes WHERE order_id = $1',
          [order.id]
        );

        if (existingCodes.rows.length > 0) {
          console.log('⚠️ Códigos já gerados para order', order.id);
          break;
        }

        // Buscar quantidade do pedido
        const totalItems = order.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 1;

        // Buscar user pelo customer_id do Pagar.me
        const userResult = await pool.query(
          'SELECT id FROM users WHERE pagarme_customer_id = $1',
          [order.customer?.id]
        );

        if (userResult.rows.length === 0) {
          console.error('❌ Usuário não encontrado para customer', order.customer?.id);
          break;
        }

        const userId = userResult.rows[0].id;

        // Gerar códigos
        for (let i = 0; i < totalItems; i++) {
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
            [code, userId, order.id]
          );
        }

        console.log(`✅ ${totalItems} código(s) gerado(s) para order ${order.id}`);
        break;
      }

      default:
        console.log(`ℹ️ Evento não tratado: ${event.type}`);
    }
  } catch (error) {
    console.error('❌ Erro no webhook Pagar.me:', error);
    // Não reenviar erro — já respondemos 200
  }
});

function mapSubscriptionStatus(pagarmeStatus) {
  const map = {
    active: 'active',
    canceled: 'canceled',
    past_due: 'past_due',
    pending: 'pending',
    ended: 'ended',
  };
  return map[pagarmeStatus] || 'pending';
}

export default router;
