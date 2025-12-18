import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carregar variáveis de ambiente
// No Vercel, as variáveis já vêm de process.env
// Localmente, tentamos carregar do arquivo .env
if (!process.env.DATABASE_URL) {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) {
    console.error('❌ Arquivo .env não encontrado em:', envPath);
    console.log('📝 Crie um arquivo .env na pasta server com a string de conexão');
    console.log('⚠️ Ou configure as variáveis de ambiente no Vercel');
    // Não fazer process.exit(1) aqui para permitir que o Vercel tente usar variáveis de ambiente
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
  } else {
    // Carregar .env manualmente para evitar problemas com caracteres especiais
    const envContent = readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));

    let databaseUrl = '';
    let jwtSecret = '';
    let port = '3000';

    envLines.forEach(line => {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();
      if (key.trim() === 'DATABASE_URL') {
        databaseUrl = value;
      } else if (key.trim() === 'JWT_SECRET') {
        jwtSecret = value;
      } else if (key.trim() === 'PORT') {
        port = value;
      }
    });

    // Fazer URL encoding da senha se necessário (para caracteres especiais como $, #, etc)
    if (databaseUrl) {
      try {
        // Tentar fazer parse da URL e re-encodar a senha
        const urlMatch = databaseUrl.match(/postgresql?:\/\/([^:]+):([^@]+)@(.+)/);
        if (urlMatch) {
          const [, user, password, rest] = urlMatch;
          // Fazer encode apenas da senha para preservar caracteres especiais
          const encodedPassword = encodeURIComponent(password);
          databaseUrl = `postgresql://${user}:${encodedPassword}@${rest}`;
          console.log('✅ Senha codificada para URL');
        }
      } catch (error) {
        console.log('⚠️ Usando URL original (sem encoding)');
      }
    }

    // Definir variáveis de ambiente manualmente
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = port;
  }
}

const { Pool } = pg;

// Verificar se a variável de ambiente está definida
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não encontrada');
  console.log('📝 Configure DATABASE_URL nas variáveis de ambiente do Vercel ou no arquivo .env');
  // Não fazer exit no Vercel, deixar que o erro seja tratado quando tentar usar o pool
  if (process.env.VERCEL !== '1') {
    process.exit(1);
  }
}

// Criar pool apenas quando necessário (lazy initialization)
let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL não está configurada');
    }
    
    console.log('🔗 Criando conexão com banco de dados Supabase...');
    console.log('📋 Host:', process.env.DATABASE_URL.match(/@([^:]+):/)?.[1] || 'não encontrado');

    // Configurar pool com connection string
    const poolConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
    };

    pool = new Pool(poolConfig);

    // Testar conexão
    pool.on('connect', () => {
      console.log('✅ Conectado ao banco de dados Supabase');
    });

    pool.on('error', (err) => {
      console.error('❌ Erro na conexão com o banco:', err);
    });
  }
  return pool;
}

// Testar conexão antes de criar tabelas
export async function testConnection() {
  try {
    const dbPool = getPool();
    const result = await dbPool.query('SELECT NOW()');
    console.log('✅ Conexão com banco de dados estabelecida:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar ao banco de dados:', error.message);
    throw error;
  }
}

// Criar tabelas se não existirem
export async function initDatabase() {
  try {
    const dbPool = getPool();
    // Tabela de usuários
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        whatsapp_number VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Adicionar coluna whatsapp_number se não existir (para bancos já criados)
    await dbPool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='whatsapp_number'
        ) THEN
          ALTER TABLE users ADD COLUMN whatsapp_number VARCHAR(20);
        END IF;
      END $$;
    `);

    // Tabela de transações
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
        category VARCHAR(100) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        date DATE NOT NULL,
        description TEXT,
        recurring BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'paid' CHECK (status IN ('paid', 'received', 'pending_payment', 'pending_receipt')),
        receipt_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela de orçamentos
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        limit_amount DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category)
      )
    `);

    // Tabela de metas
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        target DECIMAL(10, 2) NOT NULL,
        saved DECIMAL(10, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Tabelas criadas/verificadas com sucesso');
  } catch (error) {
    console.error('❌ Erro ao criar tabelas:', error);
    throw error;
  }
}

// Exportar função para obter o pool
export default getPool;

