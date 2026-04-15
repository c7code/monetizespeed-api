import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Função para sanitizar e validar DATABASE_URL
function sanitizeDatabaseUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('DATABASE_URL deve ser uma string válida');
  }

  let cleanUrl = url.trim();

  cleanUrl = cleanUrl.replace(/\s+/g, '');

  if (!cleanUrl.startsWith('postgres://') && !cleanUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL deve começar com postgres:// ou postgresql://');
  }

  try {
    const urlParts = cleanUrl.match(/^(postgresql?):\/\/(.+?)@(.+)$/);
    if (!urlParts) {
      throw new Error('Formato inválido da DATABASE_URL. Formato esperado: postgresql://user:password@host:port/database');
    }

    const [, protocol, credentials, rest] = urlParts;

    const credParts = credentials.split(':');
    if (credParts.length < 2) {
      throw new Error('Formato inválido: usuário e senha não encontrados');
    }

    const user = credParts[0];
    const password = credParts.slice(1).join(':');


    let finalPassword = password;
    if (!password.includes('%') || decodeURIComponent(password) !== password) {
      finalPassword = encodeURIComponent(password);
      console.log('✅ Senha codificada para URL');
    }

    cleanUrl = `${protocol}://${user}:${finalPassword}@${rest}`;

    const hostMatch = cleanUrl.match(/@([^:]+):/);
    if (!hostMatch) {
      throw new Error('Hostname não encontrado após sanitização da URL');
    }

    console.log('✅ URL sanitizada com sucesso');
    console.log('📋 Hostname:', hostMatch[1]);

    return cleanUrl;
  } catch (error) {
    console.error('⚠️ Erro ao sanitizar DATABASE_URL:', error.message);
    console.error('⚠️ URL original:', cleanUrl.substring(0, 50) + '...');
    throw error;
  }
}


if (!process.env.DATABASE_URL) {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) {
    console.error('❌ Arquivo .env não encontrado em:', envPath);
    console.log('📝 Crie um arquivo .env na pasta server com a string de conexão');
    console.log('⚠️ Ou configure as variáveis de ambiente no Vercel');
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
  } else {
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

    if (databaseUrl) {
      try {
        databaseUrl = sanitizeDatabaseUrl(databaseUrl);
      } catch (error) {
        console.error('⚠️ Erro ao sanitizar DATABASE_URL do .env:', error.message);
      }
    }

    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = port;
  }
}

const { Pool } = pg;

if (process.env.DATABASE_URL) {
  try {
    process.env.DATABASE_URL = sanitizeDatabaseUrl(process.env.DATABASE_URL);
  } catch (error) {
    console.error('❌ Erro ao processar DATABASE_URL:', error.message);
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
  }
} else {
  console.error('❌ DATABASE_URL não encontrada');
  console.log('📝 Configure DATABASE_URL nas variáveis de ambiente do Vercel ou no arquivo .env');
  if (process.env.VERCEL !== '1') {
    process.exit(1);
  }
}

let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      const errorMsg = 'DATABASE_URL não está configurada. Configure esta variável de ambiente no Vercel (Settings > Environment Variables).';
      console.error('❌', errorMsg);
      throw new Error(errorMsg);
    }

    const databaseUrl = process.env.DATABASE_URL;

    console.log('🔗 Criando conexão com banco de dados...');
    try {
      const urlMatch = databaseUrl.match(/@([^:]+):(\d+)\/(.+)$/);
      if (urlMatch) {
        const [, host, port, database] = urlMatch;
        console.log('📋 Host:', host);
        console.log('📋 Port:', port);
        console.log('📋 Database:', database);
      } else {
        const urlMatch2 = databaseUrl.match(/@([^/]+)\/(.+)$/);
        if (urlMatch2) {
          const [, host, database] = urlMatch2;
          console.log('📋 Host:', host);
          console.log('📋 Database:', database);
        } else {
          console.log('⚠️ Não foi possível extrair informações completas da URL');
          console.log('📋 URL (primeiros 80 caracteres):', databaseUrl.substring(0, 80) + '...');
        }
      }
      console.log('📋 Database URL válida: Sim');
    } catch (e) {
      console.log('⚠️ Não foi possível extrair informações da URL:', e.message);
    }

    const isServerless = process.env.VERCEL === '1';

    const poolConfig = {
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      },
      max: isServerless ? 3 : 20,
      idleTimeoutMillis: isServerless ? 10000 : 30000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: isServerless,
    };

    try {
      pool = new Pool(poolConfig);
    } catch (error) {
      console.error('❌ Erro ao criar Pool:');
      console.error('   Mensagem:', error.message);
      console.error('   Stack:', error.stack);

      if (error.message && error.message.includes('searchParams')) {
        throw new Error('Formato inválido da DATABASE_URL. Verifique se a URL está correta e se caracteres especiais estão codificados (use encodeURIComponent para senhas com caracteres especiais).');
      }

      throw new Error(`Erro ao criar pool de conexões: ${error.message}`);
    }

    pool.on('connect', () => {
      console.log('✅ Conectado ao banco de dados Supabase');
    });

    pool.on('error', (err) => {
      console.error('❌ Erro na conexão com o banco:', err);
    });
  }
  return pool;
}

export async function testConnection() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL não está configurada');
    }

    const dbPool = getPool();
    console.log('🔄 Executando query de teste...');
    const result = await dbPool.query('SELECT NOW()');
    console.log('✅ Conexão com banco de dados estabelecida:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar ao banco de dados:');
    console.error('   Mensagem:', error.message);
    console.error('   Código:', error.code);
    console.error('   Tipo:', error.constructor.name);

    if (error.code === 'ENOTFOUND') {
      const hostMatch = error.message?.match(/getaddrinfo ENOTFOUND (.+)/);
      const host = hostMatch ? hostMatch[1] : 'host desconhecido';
      console.error(`❌ DNS não conseguiu resolver o hostname: ${host}`);
      console.error(`❌ Verifique se o hostname está correto na DATABASE_URL`);
      throw new Error(`Host do banco de dados não encontrado (${host}). Verifique se a DATABASE_URL está correta e se o hostname do Supabase está acessível. Se você está usando Supabase, verifique se o projeto ainda está ativo e se a URL de conexão está atualizada.`);
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error(`Conexão recusada pelo banco de dados. Verifique se o servidor está acessível e se o firewall permite conexões.`);
    } else if (error.code === '28P01') {
      throw new Error(`Falha na autenticação. Verifique usuário e senha na DATABASE_URL.`);
    } else if (error.code === '3D000') {
      throw new Error(`Banco de dados não existe. Verifique o nome do banco na DATABASE_URL.`);
    }

    throw error;
  }
}

export async function initDatabase() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL não está configurada. Configure esta variável de ambiente no Vercel.');
    }

    const dbPool = getPool();

    console.log('🔍 Testando conexão com banco de dados...');
    try {
      await testConnection();
      console.log('✅ Conexão testada com sucesso');
    } catch (error) {
      console.error('❌ Falha ao testar conexão:', error.message);
      throw new Error(`Falha ao conectar ao banco de dados: ${error.message}`);
    }

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

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS credit_cards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        limit_amount DECIMAL(10, 2) NOT NULL,
        total_spent DECIMAL(10, 2) DEFAULT 0,
        closing_day INTEGER CHECK (closing_day >= 1 AND closing_day <= 31),
        due_day INTEGER CHECK (due_day >= 1 AND due_day <= 31),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        bank_name VARCHAR(255),
        account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('conta_corrente', 'poupanca', 'investimento', 'carteira', 'outro')),
        balance DECIMAL(12, 2) DEFAULT 0,
        bank_logo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS streamings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        monthly_price DECIMAL(10, 2) NOT NULL,
        color VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS bills (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        description VARCHAR(255) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        due_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
        category VARCHAR(100),
        supplier_name VARCHAR(255),
        supplier_document VARCHAR(50),
        supplier_contact VARCHAR(255),
        supplier_phone VARCHAR(50),
        payment_method VARCHAR(50) DEFAULT 'pix',
        pix_key VARCHAR(255),
        wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
        is_recurring BOOLEAN DEFAULT FALSE,
        notes TEXT,
        paid_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS receivables (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        description VARCHAR(255) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        due_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'overdue')),
        category VARCHAR(100),
        customer_name VARCHAR(255),
        customer_document VARCHAR(50),
        wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
        is_recurring BOOLEAN DEFAULT FALSE,
        notes TEXT,
        received_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Adicionar campo plan_status na tabela users
    await dbPool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='plan_status'
        ) THEN
          ALTER TABLE users ADD COLUMN plan_status VARCHAR(20) DEFAULT 'free';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='plan_expires_at'
        ) THEN
          ALTER TABLE users ADD COLUMN plan_expires_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='pagarme_customer_id'
        ) THEN
          ALTER TABLE users ADD COLUMN pagarme_customer_id VARCHAR(255);
        END IF;
      END $$;
    `);

    // Atualizar CHECK constraint para incluir status 'failed' (migração)
    try {
      await dbPool.query(`ALTER TABLE IF EXISTS subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check`);
      await dbPool.query(`ALTER TABLE IF EXISTS subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('pending', 'active', 'canceled', 'past_due', 'ended', 'failed'))`);
    } catch (e) { /* tabela ainda não existe, será criada abaixo */ }

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pagarme_subscription_id VARCHAR(255) UNIQUE,
        status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'canceled', 'past_due', 'ended', 'failed')),
        current_period_end TIMESTAMP,
        plan_amount INTEGER DEFAULT 2990,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS access_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        purchaser_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        order_id VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'redeemed')),
        redeemed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        duration_days INTEGER DEFAULT 30,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        redeemed_at TIMESTAMP
      )
    `);

    // Migração: tornar purchaser_user_id nullable (para códigos gerados pelo admin)
    await dbPool.query(`
      ALTER TABLE access_codes ALTER COLUMN purchaser_user_id DROP NOT NULL
    `).catch(() => { /* já é nullable */ });

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) DEFAULT 'both' CHECK (type IN ('expense', 'income', 'both')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      )
    `);

    // Tabela de planos de assinatura
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        billing_type VARCHAR(20) NOT NULL CHECK (billing_type IN ('monthly', 'yearly')),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        price_card INTEGER NOT NULL DEFAULT 0,
        price_pix INTEGER NOT NULL DEFAULT 0,
        promo_price_card INTEGER,
        promo_price_pix INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela de cupons de desconto
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
        discount_value INTEGER NOT NULL,
        applies_to VARCHAR(20) DEFAULT 'both' CHECK (applies_to IN ('monthly', 'yearly', 'both')),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        valid_until TIMESTAMP,
        duration_months INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migração: adicionar duration_months se não existir
    await dbPool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='coupons' AND column_name='duration_months'
        ) THEN
          ALTER TABLE coupons ADD COLUMN duration_months INTEGER;
        END IF;
      END $$;
    `);

    // Inserir plano mensal padrão se não existir nenhum
    const existingPlans = await dbPool.query('SELECT id FROM plans LIMIT 1');
    if (existingPlans.rows.length === 0) {
      await dbPool.query(`
        INSERT INTO plans (name, description, billing_type, status, price_card, price_pix)
        VALUES 
          ('Mensal', 'Acesso completo a todas as funcionalidades', 'monthly', 'active', 2990, 2990),
          ('Anual', 'Acesso completo com desconto anual', 'yearly', 'active', 29900, 29900)
      `);
      console.log('✅ Planos padrão criados');
    }

    console.log('✅ Tabelas criadas/verificadas com sucesso');
  } catch (error) {
    console.error('❌ Erro ao criar tabelas:', error);
    throw error;
  }
}

export default getPool;

