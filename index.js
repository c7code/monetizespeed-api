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

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MonetizeSpeed API está funcionando' });
});

// Inicializar banco de dados e servidor
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

