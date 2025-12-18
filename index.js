import express from 'express';
import cors from 'cors';
// Carregar db.js primeiro para garantir que as variáveis de ambiente sejam carregadas
import { initDatabase } from './db.js';
import authRoutes from './routes/auth.js';
import transactionsRoutes from './routes/transactions.js';
import budgetsRoutes from './routes/budgets.js';
import goalsRoutes from './routes/goals.js';
import webhookRoutes from './routes/webhook.js';
import userRoutes from './routes/user.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware CORS - Configurado para aceitar requisições do frontend
const corsOptions = {
  origin: function (origin, callback) {
    // Permite requisições sem origin (mobile apps, Postman, etc)
    if (!origin) return callback(null, true);
    
    // Lista de origens permitidas
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'https://monetizespeed-client-black.vercel.app',
      'https://monetizespeed-client.vercel.app',
    ];
    
    // Permite qualquer subdomínio do Vercel
    if (origin.includes('.vercel.app')) {
      return callback(null, true);
    }
    
    // Verifica se a origem está na lista permitida
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

// IMPORTANTE: Tratar OPTIONS ANTES de qualquer outro middleware
// Isso evita problemas com redirects em requisições preflight
app.options('*', cors(corsOptions), (req, res) => {
  res.sendStatus(204);
});

app.use(cors(corsOptions));
app.use(express.json());

// Rota raiz (antes das rotas de API)
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
      health: '/api/health'
    }
  });
});

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/user', userRoutes);

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MonetizeSpeed API está funcionando' });
});

// Inicializar banco de dados
let dbInitialized = false;
async function initDbIfNeeded() {
  if (!dbInitialized) {
    await initDatabase();
    dbInitialized = true;
  }
}

// Inicializar banco de dados e servidor (apenas em ambiente local)
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
  // No Vercel, inicializar DB quando o handler for chamado
  // Pular para requisições OPTIONS (preflight) e rotas de health check
  app.use(async (req, res, next) => {
    // Não inicializar banco para requisições OPTIONS ou health check
    if (req.method === 'OPTIONS' || req.path === '/api/health' || req.path === '/') {
      return next();
    }
    
    try {
      await initDbIfNeeded();
      next();
    } catch (error) {
      console.error('❌ Erro ao inicializar banco:', error);
      console.error('❌ Stack:', error.stack);
      // Garantir que sempre retornamos uma resposta para evitar loops
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

// Exportar para Vercel
export default app;

