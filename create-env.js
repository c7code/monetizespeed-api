import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envContent = `DATABASE_URL=postgresql://postgres:CA8627058090@db.msuthinujxghpoygotqh.supabase.co:5432/postgres
JWT_SECRET=monetize-speed-secret-key-change-in-production
PORT=3000
`;

const envPath = join(__dirname, '.env');

try {
  writeFileSync(envPath, envContent, 'utf8');
  console.log('✅ Arquivo .env criado com sucesso!');
  console.log('📁 Localização:', envPath);
} catch (error) {
  console.error('❌ Erro ao criar arquivo .env:', error.message);
  console.log('\n📝 Crie manualmente o arquivo .env na pasta server com:');
  console.log(envContent);
}




