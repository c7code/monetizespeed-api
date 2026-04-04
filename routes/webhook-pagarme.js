import express from 'express';
import crypto from 'crypto';
import getPool from '../db.js';
import { sendAccessCodesEmail, sendSubscriptionConfirmEmail } from '../services/emailService.js';

const router = express.Router();

// Função para gerar código de acesso
function generateAccessCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase().substring(0, 8);
}

// Verificar autenticação do webhook do Pagar.me (HTTP Basic Auth)
function verifyWebhookAuth(req) {
  const webhookUser = process.env.PAGARME_WEBHOOK_USER;
  const webhookPass = process.env.PAGARME_WEBHOOK_PASSWORD;

  // Se não há credenciais configuradas, aceitar (dev/testing)
  if (!webhookUser || !webhookPass) {
    console.warn('⚠️ PAGARME_WEBHOOK_USER/PASSWORD não configurados — aceitando webhook sem verificação');
    return true;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.error('❌ Webhook sem header Authorization Basic');
    return false;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [user, pass] = credentials.split(':');

  return user === webhookUser && pass === webhookPass;
}

// POST /webhooks/pagarme — Receber eventos do Pagar.me
router.post('/', async (req, res) => {
  try {
    // Responder 200 imediatamente para não ultrapassar timeout
    res.status(200).json({ received: true });

    // Verificar assinatura
    if (!verifyWebhookAuth(req)) {
      console.error('❌ Webhook com assinatura inválida');
      return;
    }

    const event = req.body;
    console.log(`📩 Webhook Pagar.me: ${event.type}`);

    const pool = getPool();
    
    // Testar conexão antes de processar (evita timeout em conexões mortas)
    try {
      await pool.query('SELECT 1');
    } catch (connErr) {
      console.warn('⚠️ Conexão com banco falhou, tentando novamente...', connErr.message);
      await pool.query('SELECT 1'); // segunda tentativa após pool reconectar
    }

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

      // ====== CHARGE/INVOICE EVENTS ======
      case 'charge.paid':
      case 'invoice.paid': {
        const data = event.data;
        const subscriptionId = data.subscription_id || data.subscription?.id;
        const orderId = data.order_id || data.order?.id;

        console.log(`📋 charge.paid — subscriptionId: ${subscriptionId}, orderId: ${orderId}`);

        if (subscriptionId) {
          // Renovação/pagamento de assinatura por cartão
          const subRow = await pool.query(
            'SELECT user_id FROM subscriptions WHERE pagarme_subscription_id = $1',
            [subscriptionId]
          );

          if (subRow.rows.length > 0) {
            const userId = subRow.rows[0].user_id;
            const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await pool.query(
              `UPDATE users SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
              [newExpires, userId]
            );
            await pool.query(
              `UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = NOW()
               WHERE pagarme_subscription_id = $2`,
              [newExpires, subscriptionId]
            );

            try {
              const userRow = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
              if (userRow.rows.length > 0) {
                sendSubscriptionConfirmEmail(userRow.rows[0].email, userRow.rows[0].name, newExpires).catch(() => {});
              }
            } catch (emailErr) {
              console.warn('⚠️ Erro ao enviar email no webhook:', emailErr.message);
            }
          }
        } else if (orderId) {
          // PIX pago para um Order — verificar se é assinatura PIX ou compra de códigos
          console.log(`📋 charge.paid para order ${orderId} — verificando se é assinatura PIX...`);

          // Buscar user pelo customer_id
          const customerId = data.customer?.id;
          let userId = null;
          if (customerId) {
            const userRes = await pool.query('SELECT id FROM users WHERE pagarme_customer_id = $1', [customerId]);
            if (userRes.rows.length > 0) userId = userRes.rows[0].id;
          }

          // Verificar se é "assinatura PIX" pendente
          const pixSubCheck = await pool.query(
            `SELECT id, user_id FROM subscriptions WHERE pagarme_subscription_id = $1 AND status = 'pending'`,
            [orderId]
          );

          if (pixSubCheck.rows.length > 0) {
            const subUserId = pixSubCheck.rows[0].user_id;
            const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await pool.query(
              `UPDATE users SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
              [newExpires, subUserId]
            );
            await pool.query(
              `UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = NOW()
               WHERE pagarme_subscription_id = $2`,
              [newExpires, orderId]
            );

            try {
              const userRow = await pool.query('SELECT email, name FROM users WHERE id = $1', [subUserId]);
              if (userRow.rows.length > 0) {
                sendSubscriptionConfirmEmail(userRow.rows[0].email, userRow.rows[0].name, newExpires).catch(() => {});
              }
            } catch (emailErr) {
              console.warn('⚠️ Erro ao enviar email de assinatura PIX:', emailErr.message);
            }
            console.log(`✅ Assinatura PIX ativada via charge.paid para order ${orderId}`);
          } else if (userId) {
            // Compra de códigos via PIX — gerar códigos
            const existingCodes = await pool.query('SELECT id FROM access_codes WHERE order_id = $1', [orderId]);
            if (existingCodes.rows.length === 0) {
              // Precisamos saber a quantidade — buscar do order via API ou assumir 1
              console.log(`📋 Gerando códigos para order PIX ${orderId}...`);
              const code = generateAccessCode();
              await pool.query(
                `INSERT INTO access_codes (code, purchaser_user_id, order_id, status, duration_days)
                 VALUES ($1, $2, $3, 'active', 30)`,
                [code, userId, orderId]
              );
              try {
                const userRow = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
                if (userRow.rows.length > 0) {
                  sendAccessCodesEmail(userRow.rows[0].email, userRow.rows[0].name, [code]).catch(() => {});
                }
              } catch (emailErr) {
                console.warn('⚠️ Erro email:', emailErr.message);
              }
              console.log(`✅ Código gerado via charge.paid para order ${orderId}`);
            }
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

      // ====== ORDER EVENTS (compra de códigos ou assinatura PIX) ======
      case 'order.paid': {
        const order = event.data;
        if (!order?.id) break;

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

        // Verificar se é uma "assinatura PIX" (order salvo na tabela subscriptions)
        const pixSubCheck = await pool.query(
          `SELECT id FROM subscriptions WHERE pagarme_subscription_id = $1 AND status = 'pending'`,
          [order.id]
        );

        if (pixSubCheck.rows.length > 0) {
          // É uma assinatura PIX — ativar plano por 30 dias
          const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await pool.query(
            `UPDATE users SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
            [newExpires, userId]
          );
          await pool.query(
            `UPDATE subscriptions SET status = 'active', current_period_end = $1, updated_at = NOW()
             WHERE pagarme_subscription_id = $2`,
            [newExpires, order.id]
          );

          // Enviar email de confirmação
          try {
            const userRow = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
            if (userRow.rows.length > 0) {
              sendSubscriptionConfirmEmail(userRow.rows[0].email, userRow.rows[0].name, newExpires).catch(() => {});
            }
          } catch (emailErr) {
            console.warn('⚠️ Erro ao enviar email de assinatura PIX:', emailErr.message);
          }

          console.log(`✅ Assinatura PIX ativada para user ${userId}, order ${order.id}`);
          break;
        }

        // Não é assinatura PIX — é compra de códigos
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

        // Gerar códigos
        const generatedCodes = [];
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
          generatedCodes.push(code);
        }

        // Enviar codes por email
        try {
          const userRow = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
          if (userRow.rows.length > 0 && generatedCodes.length > 0) {
            sendAccessCodesEmail(userRow.rows[0].email, userRow.rows[0].name, generatedCodes).catch(() => {});
          }
        } catch (emailErr) {
          console.warn('⚠️ Erro ao enviar email de códigos no webhook:', emailErr.message);
        }

        console.log(`✅ ${totalItems} código(s) gerado(s) para order ${order.id}`);
        break;
      }

      default:
        console.log(`ℹ️ Evento não tratado: ${event.type}`, JSON.stringify(event.data, null, 2).substring(0, 500));
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
