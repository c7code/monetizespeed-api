import getPool, { initDatabase } from './db.js';

async function checkData() {
  try {
    console.log('🔍 Inicializando banco de dados...');
    await initDatabase();

    const pool = getPool();

    console.log('\n📊 Verificando dados no banco...\n');

    const users = await pool.query('SELECT id, email, name, created_at FROM users ORDER BY id');
    console.log(`👥 Usuários encontrados: ${users.rows.length}`);
    users.rows.forEach(user => {
      console.log(`  - ID: ${user.id}, Email: ${user.email}, Nome: ${user.name || 'N/A'}, Criado em: ${user.created_at}`);
    });

    const transactions = await pool.query('SELECT id, user_id, type, amount, description, date FROM transactions ORDER BY created_at DESC LIMIT 10');
    console.log(`\n💰 Transações encontradas: ${transactions.rows.length} (mostrando últimas 10)`);
    transactions.rows.forEach(t => {
      console.log(`  - ID: ${t.id}, User ID: ${t.user_id}, Tipo: ${t.type}, Valor: R$ ${t.amount}, Data: ${t.date}, Descrição: ${t.description || 'N/A'}`);
    });

    const budgets = await pool.query('SELECT id, user_id, category, limit_amount FROM budgets ORDER BY id');
    console.log(`\n📋 Orçamentos encontrados: ${budgets.rows.length}`);
    budgets.rows.forEach(b => {
      console.log(`  - ID: ${b.id}, User ID: ${b.user_id}, Categoria: ${b.category}, Limite: R$ ${b.limit_amount}`);
    });

    const goals = await pool.query('SELECT id, user_id, name, target, saved FROM goals ORDER BY id');
    console.log(`\n🎯 Metas encontradas: ${goals.rows.length}`);
    goals.rows.forEach(g => {
      console.log(`  - ID: ${g.id}, User ID: ${g.user_id}, Nome: ${g.name}, Meta: R$ ${g.target}, Economizado: R$ ${g.saved}`);
    });

    const creditCards = await pool.query('SELECT id, user_id, name, limit_amount, total_spent FROM credit_cards ORDER BY id');
    console.log(`\n💳 Cartões de crédito encontrados: ${creditCards.rows.length}`);
    creditCards.rows.forEach(c => {
      console.log(`  - ID: ${c.id}, User ID: ${c.user_id}, Nome: ${c.name}, Limite: R$ ${c.limit_amount}, Gasto: R$ ${c.total_spent}`);
    });

    console.log('\n📈 Estatísticas por usuário:');
    for (const user of users.rows) {
      const userTrans = await pool.query('SELECT COUNT(*) as count, SUM(amount) as total FROM transactions WHERE user_id = $1', [user.id]);
      const userBudgets = await pool.query('SELECT COUNT(*) as count FROM budgets WHERE user_id = $1', [user.id]);
      const userGoals = await pool.query('SELECT COUNT(*) as count FROM goals WHERE user_id = $1', [user.id]);
      const userCards = await pool.query('SELECT COUNT(*) as count FROM credit_cards WHERE user_id = $1', [user.id]);

      console.log(`\n  Usuário ${user.id} (${user.email}):`);
      console.log(`    - Transações: ${userTrans.rows[0].count} (Total: R$ ${userTrans.rows[0].total || 0})`);
      console.log(`    - Orçamentos: ${userBudgets.rows[0].count}`);
      console.log(`    - Metas: ${userGoals.rows[0].count}`);
      console.log(`    - Cartões: ${userCards.rows[0].count}`);
    }

    console.log('\n✅ Verificação concluída!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao verificar dados:', error);
    process.exit(1);
  }
}

checkData();
