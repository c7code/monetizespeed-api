// Serviço de integração com Pagar.me API V5
const PAGARME_API_URL = 'https://api.pagar.me/core/v5';

function getAuthHeader() {
  const secretKey = process.env.PAGARME_SECRET_KEY;
  if (!secretKey) {
    throw new Error('PAGARME_SECRET_KEY não está configurada');
  }
  const encoded = Buffer.from(`${secretKey}:`).toString('base64');
  return `Basic ${encoded}`;
}

async function pagarmeRequest(method, path, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const url = `${PAGARME_API_URL}${path}`;
  console.log(`📡 Pagar.me ${method} ${path}`);

  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('❌ Pagar.me resposta não-JSON:', text);
    throw new Error('Resposta inválida do Pagar.me');
  }

  if (!response.ok) {
    console.error('❌ Pagar.me erro:', JSON.stringify(data, null, 2));
    const msg = data.message || data.errors?.map(e => e.message).join(', ') || 'Erro na API Pagar.me';
    const error = new Error(msg);
    error.statusCode = response.status;
    error.pagarmeData = data;
    throw error;
  }

  return data;
}

// ====== TOKENIZAÇÃO DO CARTÃO (server-side) ======

export async function tokenizeCard({ number, holder_name, exp_month, exp_year, cvv }) {
  const publicKey = process.env.PAGARME_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error('PAGARME_PUBLIC_KEY não está configurada');
  }

  const url = `${PAGARME_API_URL}/tokens?appId=${publicKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      type: 'card',
      card: {
        number: String(number).replace(/\s/g, ''),
        holder_name,
        exp_month: parseInt(exp_month),
        exp_year: parseInt(exp_year),
        cvv: String(cvv),
      },
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('❌ Tokenização resposta não-JSON:', text);
    throw new Error('Erro ao tokenizar cartão');
  }

  if (!response.ok) {
    console.error('❌ Tokenização erro:', JSON.stringify(data, null, 2));
    throw new Error(data.message || 'Erro ao tokenizar cartão. Verifique os dados.');
  }

  console.log('✅ Cartão tokenizado:', data.id);
  return data.id;
}

// ====== CUSTOMERS ======

export async function createCustomer({ name, email, document, phone }) {
  const cleanDoc = document ? document.replace(/\D/g, '') : '';
  console.log(`📋 Criando customer: name=${name}, email=${email}, document=${cleanDoc}, docLength=${cleanDoc.length}`);
  
  const payload = {
    name,
    email,
    type: 'individual',
    document: cleanDoc,
    phones: phone ? {
      mobile_phone: {
        country_code: '55',
        area_code: phone.substring(0, 2),
        number: phone.substring(2),
      }
    } : undefined,
  };

  return pagarmeRequest('POST', '/customers', payload);
}

export async function getCustomer(customerId) {
  return pagarmeRequest('GET', `/customers/${customerId}`);
}

// ====== CARDS ======

export async function createCard(customerId, cardToken, billingAddress) {
  console.log(`📋 Criando card para customer ${customerId} com token ${cardToken}`);
  
  const payload = {
    token: cardToken,
  };

  // Billing address é necessário para passar na verificação de cartão
  if (billingAddress) {
    payload.billing_address = billingAddress;
  }

  return pagarmeRequest('POST', `/customers/${customerId}/cards`, payload);
}

// ====== SUBSCRIPTIONS ======

export async function createSubscription({ customerId, cardToken, billingAddress, planAmount = 2990 }) {
  // Primeiro, registrar o cartão no customer para evitar "card verification failed"
  let cardId;
  try {
    const card = await createCard(customerId, cardToken, billingAddress);
    cardId = card.id;
    console.log('✅ Cartão registrado no customer:', cardId);
  } catch (cardErr) {
    console.warn('⚠️ Erro ao registrar cartão no customer, tentando com token direto:', cardErr.message);
    // Fallback: tentar com card_token direto
  }

  const payload = {
    payment_method: 'credit_card',
    interval: 'month',
    interval_count: 1,
    billing_type: 'prepaid',
    minimum_price: planAmount,
    customer_id: customerId,
    ...(cardId ? { card_id: cardId } : { card_token: cardToken }),
    pricing_scheme: {
      scheme_type: 'unit',
      price: planAmount,
    },
    quantity: 1,
    description: 'Assinatura Tudo no Azul - Plano Mensal',
    statement_descriptor: 'TUDONOAZUL',
  };

  console.log('📋 Payload de assinatura:', JSON.stringify(payload, null, 2));
  const result = await pagarmeRequest('POST', '/subscriptions', payload);
  console.log('📋 Resposta completa do Pagar.me (subscription):', JSON.stringify(result, null, 2));
  
  // Log detalhado da cobrança
  if (result.charges) {
    result.charges.forEach((charge, i) => {
      console.log(`📋 Charge[${i}] status: ${charge.status}`);
      if (charge.last_transaction) {
        console.log(`📋 Charge[${i}] last_transaction:`, JSON.stringify(charge.last_transaction, null, 2));
      }
    });
  }
  
  return result;
}

export async function cancelSubscription(subscriptionId) {
  return pagarmeRequest('DELETE', `/subscriptions/${subscriptionId}`);
}

export async function getSubscription(subscriptionId) {
  return pagarmeRequest('GET', `/subscriptions/${subscriptionId}`);
}

// ====== ORDERS (para compra de múltiplos acessos) ======

export async function createOrder({ customerId, cardToken, cardId, billingAddress, quantity, unitPrice = 2990 }) {
  const totalAmount = quantity * unitPrice;

  // Se não temos cardId, tentar registrar o cartão primeiro
  if (!cardId && cardToken) {
    try {
      const card = await createCard(customerId, cardToken, billingAddress);
      cardId = card.id;
      console.log('✅ Cartão registrado para order:', cardId);
    } catch (cardErr) {
      console.warn('⚠️ Erro ao registrar cartão para order, tentando com token:', cardErr.message);
    }
  }

  const creditCardPayload = cardId
    ? { card_id: cardId, operation_type: 'auth_and_capture', installments: 1, statement_descriptor: 'TUDONOAZUL' }
    : { card_token: cardToken, operation_type: 'auth_and_capture', installments: 1, statement_descriptor: 'TUDONOAZUL' };

  const payload = {
    customer_id: customerId,
    items: [
      {
        amount: unitPrice,
        description: `Código de Acesso Tudo no Azul (${quantity}x)`,
        quantity,
        code: `ACCESS_CODE_${quantity}x`,
      }
    ],
    payments: [
      {
        payment_method: 'credit_card',
        credit_card: creditCardPayload,
        amount: totalAmount,
      }
    ],
  };

  return pagarmeRequest('POST', '/orders', payload);
}

export async function getOrder(orderId) {
  return pagarmeRequest('GET', `/orders/${orderId}`);
}
