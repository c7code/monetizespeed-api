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

// Middleware
app.use(cors());
app.use(express.json());

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/user', userRoutes);

// Rota raiz
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
      webhook: '/api/webhook'
    }
  });
});

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MonetizeSpeed API está funcionando' });
});

// Inicializar banco de dados
let dbInitialized = false;
let dbInitializing = false;

async function initDbIfNeeded() {
  if (dbInitialized) {
    return;
  }
  
  if (dbInitializing) {
    // Aguardar enquanto está inicializando (com timeout de 10 segundos)
    const startTime = Date.now();
    while (dbInitializing && (Date.now() - startTime < 10000)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (dbInitializing) {
      throw new Error('Timeout ao inicializar banco de dados');
    }
    return;
  }
  
  try {
    dbInitializing = true;
    // Timeout de 10 segundos para inicialização
    const initPromise = initDatabase();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout ao inicializar banco de dados')), 10000)
    );
    
    await Promise.race([initPromise, timeoutPromise]);
    dbInitialized = true;
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error);
    throw error;
  } finally {
    dbInitializing = false;
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
  // No Vercel, inicializar DB apenas uma vez quando o handler for chamado
  // Usar um middleware que só inicializa se necessário e trata erros
  app.use(async (req, res, next) => {
    try {
      // Pular inicialização para rotas de health check
      if (req.path === '/api/health' || req.path === '/') {
        return next();
      }
      
      await initDbIfNeeded();
      next();
    } catch (error) {
      console.error('❌ Erro ao inicializar banco:', error);
      // Garantir que sempre retornamos uma resposta para evitar loops
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Erro ao conectar ao banco de dados',
          message: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor' : error.message 
        });
      }
    }
  });
}

// Exportar para Vercel
export default app;

