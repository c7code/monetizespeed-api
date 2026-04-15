import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDatabase } from './db.js';
import authRoutes, { authenticateToken, requirePremium } from './routes/auth.js';
import transactionsRoutes from './routes/transactions.js';
import budgetsRoutes from './routes/budgets.js';
import goalsRoutes from './routes/goals.js';
import webhookRoutes from './routes/webhook.js';
import userRoutes from './routes/user.js';
import creditCardsRoutes from './routes/creditCards.js';
import walletsRoutes from './routes/wallets.js';
import streamingsRoutes from './routes/streamings.js';
import billsRoutes from './routes/bills.js';
import receivablesRoutes from './routes/receivables.js';
import audioRoutes from './routes/audio.js';
import imageRoutes from './routes/image.js';
import whatsappWebhookRoutes from './routes/whatsappWebhook.js';
import paymentsRoutes from './routes/payments.js';
import webhookPagarmeRoutes from './routes/webhook-pagarme.js';
import categoriesRoutes from './routes/categories.js';
import plansRoutes from './routes/plans.js';
import couponsRoutes from './routes/coupons.js';

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'https://monetizespeed-client-black.vercel.app',
      'https://monetizespeed-client.vercel.app',
      'https://www.monetizespeed.com',
      'https://monetizespeed.com',
      'https://www.tudonoazul.com.br',
      'https://tudonoazul.com.br',
    ];

    if (origin.includes('.vercel.app')) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Em desenvolvimento, permite todas (pode restringir em produção)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400, // 24 horas
  preflightContinue: false,
  optionsSuccessStatus: 204
};


app.options('*', (req, res) => {
  const origin = req.headers.origin;

  const isAllowed = !origin ||
    origin.includes('.vercel.app') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin === 'https://www.monetizespeed.com' ||
    origin === 'https://monetizespeed.com' ||
    origin === 'https://www.tudonoazul.com.br' ||
    origin === 'https://tudonoazul.com.br';

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  res.status(204).end();
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'MonetizeSpeed API está funcionando',
    endpoints: {
      auth: '/api/auth',
      transactions: '/api/transactions',
      budgets: '/api/budgets',
      goals: '/api/goals',
      user: '/api/user',
      webhook: '/api/webhook',
      creditCards: '/api/credit-cards',
      wallets: '/api/wallets',
      streamings: '/api/streamings',
      bills: '/api/bills',
      payments: '/api/payments',
      health: '/api/health'
    }
  });
});

// Rotas livres (não requerem plano premium)
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/user', userRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/coupons', couponsRoutes);
app.use('/webhooks/twilio', whatsappWebhookRoutes);
app.use('/webhooks/pagarme', webhookPagarmeRoutes);

// Rotas premium (requerem plano ativo)
app.use('/api/credit-cards', authenticateToken, requirePremium, creditCardsRoutes);
app.use('/api/wallets', authenticateToken, requirePremium, walletsRoutes);
app.use('/api/streamings', authenticateToken, requirePremium, streamingsRoutes);
app.use('/api/bills', authenticateToken, requirePremium, billsRoutes);
app.use('/api/receivables', authenticateToken, requirePremium, receivablesRoutes);
app.use('/api/audio', authenticateToken, requirePremium, audioRoutes);
app.use('/api/image', authenticateToken, requirePremium, imageRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MonetizeSpeed API está funcionando' });
});

let dbInitialized = false;
async function initDbIfNeeded() {
  if (!dbInitialized) {
    await initDatabase();
    dbInitialized = true;
  }
}

if (process.env.VERCEL !== '1') {
  async function startServer() {
    try {
      await initDatabase();
      app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📡 API disponível em http://localhost:${PORT}/api`);
      });
    } catch (error) {
      console.error('❌ Erro ao iniciar servidor:', error);
      process.exit(1);
    }
  }
  startServer();
} else {
  app.use(async (req, res, next) => {
    if (req.method === 'OPTIONS' || req.path === '/api/health' || req.path === '/') {
      return next();
    }

    try {
      await initDbIfNeeded();
      next();
    } catch (error) {
      console.error('❌ Erro ao inicializar banco:', error);
      console.error('❌ Stack:', error.stack);
      if (!res.headersSent) {
        const errorMessage = error.message || 'Erro desconhecido';
        const errorType = error.constructor.name;

        res.status(500).json({
          error: 'Erro ao conectar ao banco de dados',
          message: errorMessage,
          type: errorType,
          hasDatabaseUrl: !!process.env.DATABASE_URL,
          ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
        });
      }
    }
  });
}

export default app;

