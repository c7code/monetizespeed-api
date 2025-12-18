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
  
  // Remover espaços e quebras de linha
  cleanUrl = cleanUrl.replace(/\s+/g, '');
  
  // Verificar se começa com postgres:// ou postgresql://
  if (!cleanUrl.startsWith('postgres://') && !cleanUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL deve começar com postgres:// ou postgresql://');
  }
  
  // Tentar fazer parse da URL para validar formato e codificar senha
  try {
    // Dividir a URL em partes: protocolo, credenciais, resto
    const urlParts = cleanUrl.match(/^(postgresql?):\/\/(.+?)@(.+)$/);
    if (!urlParts) {
      throw new Error('Formato inválido da DATABASE_URL. Formato esperado: postgresql://user:password@host:port/database');
    }
    
    const [, protocol, credentials, rest] = urlParts;
    
    // Separar usuário e senha (a senha pode conter qualquer caractere exceto @)
    const credParts = credentials.split(':');
    if (credParts.length < 2) {
      throw new Error('Formato inválido: usuário e senha não encontrados');
    }
    
    const user = credParts[0];
    // A senha é tudo depois do primeiro : até o @
    const password = credParts.slice(1).join(':');
    
    // SEMPRE codificar a senha para evitar problemas com caracteres especiais
    // Verificar se já está codificada (contém %)
    let finalPassword = password;
    if (!password.includes('%') || decodeURIComponent(password) !== password) {
      // Se não está codificada ou a decodificação muda o valor, codificar
      finalPassword = encodeURIComponent(password);
      console.log('✅ Senha codificada para URL');
    }
    
    // Reconstruir a URL com a senha codificada
    cleanUrl = `${protocol}://${user}:${finalPassword}@${rest}`;
    
    // Validar que o hostname ainda está presente após a reconstrução
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

    // Sanitizar a URL do .env
    if (databaseUrl) {
      try {
        databaseUrl = sanitizeDatabaseUrl(databaseUrl);
      } catch (error) {
        console.error('⚠️ Erro ao sanitizar DATABASE_URL do .env:', error.message);
        // Continuar com a URL original
      }
    }

    // Definir variáveis de ambiente manualmente
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = jwtSecret;
    process.env.PORT = port;
  }
}

const { Pool } = pg;

// Verificar se a variável de ambiente está definida e sanitizar
if (process.env.DATABASE_URL) {
  try {
    process.env.DATABASE_URL = sanitizeDatabaseUrl(process.env.DATABASE_URL);
  } catch (error) {
    console.error('❌ Erro ao processar DATABASE_URL:', error.message);
    // Não fazer exit no Vercel
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
  }
} else {
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
      const errorMsg = 'DATABASE_URL não está configurada. Configure esta variável de ambiente no Vercel (Settings > Environment Variables).';
      console.error('❌', errorMsg);
      throw new Error(errorMsg);
    }
    
    // A DATABASE_URL já foi sanitizada no início do arquivo
    const databaseUrl = process.env.DATABASE_URL;
    
    console.log('🔗 Criando conexão com banco de dados...');
    try {
      // Extrair informações da URL para debug
      const urlMatch = databaseUrl.match(/@([^:]+):(\d+)\/(.+)$/);
      if (urlMatch) {
        const [, host, port, database] = urlMatch;
        console.log('📋 Host:', host);
        console.log('📋 Port:', port);
        console.log('📋 Database:', database);
      } else {
        // Tentar formato alternativo sem porta explícita
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

    // Configurar pool com connection string
    const poolConfig = {
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
    };

    try {
      pool = new Pool(poolConfig);
    } catch (error) {
      console.error('❌ Erro ao criar Pool:');
      console.error('   Mensagem:', error.message);
      console.error('   Stack:', error.stack);
      
      // Se o erro menciona searchParams, pode ser problema com formato da URL
      if (error.message && error.message.includes('searchParams')) {
        throw new Error('Formato inválido da DATABASE_URL. Verifique se a URL está correta e se caracteres especiais estão codificados (use encodeURIComponent para senhas com caracteres especiais).');
      }
      
      throw new Error(`Erro ao criar pool de conexões: ${error.message}`);
    }

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
    
    // Mensagens de erro mais específicas
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

// Criar tabelas se não existirem
export async function initDatabase() {
  try {
    // Verificar se DATABASE_URL está configurada
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL não está configurada. Configure esta variável de ambiente no Vercel.');
    }
    
    const dbPool = getPool();
    
    // Testar conexão primeiro antes de criar tabelas
    console.log('🔍 Testando conexão com banco de dados...');
    try {
      await testConnection();
      console.log('✅ Conexão testada com sucesso');
    } catch (error) {
      console.error('❌ Falha ao testar conexão:', error.message);
      throw new Error(`Falha ao conectar ao banco de dados: ${error.message}`);
    }
    
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

