import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '.env');
if (!existsSync(envPath)) {
  console.error('❌ Arquivo .env não encontrado!');
  console.log('📝 Crie um arquivo .env na pasta server com:');
  console.log('DATABASE_URL=sua_string_de_conexao');
  console.log('JWT_SECRET=seu_secret_key');
  console.log('PORT=3000');
  process.exit(1);
}

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não encontrada no arquivo .env');
  process.exit(1);
}

console.log('✅ Arquivo .env encontrado');
console.log('✅ DATABASE_URL configurada');
console.log('✅ JWT_SECRET configurado:', process.env.JWT_SECRET ? 'Sim' : 'Não');
console.log('✅ PORT:', process.env.PORT || 3000);




