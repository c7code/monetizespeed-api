import { initDatabase, testConnection } from './db.js';

async function test() {
  try {
    console.log('🧪 Testando conexão com o banco de dados...\n');
    await testConnection();
    console.log('\n✅ Teste de conexão bem-sucedido!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erro no teste de conexão:', error.message);
    console.error('\nDetalhes:', error);
    process.exit(1);
  }
}

test();




