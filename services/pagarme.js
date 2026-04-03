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
  const payload = {
    name,
    email,
    type: 'individual',
    document,
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

// ====== SUBSCRIPTIONS ======

export async function createSubscription({ customerId, cardToken, planAmount = 2990 }) {
  const payload = {
    payment_method: 'credit_card',
    interval: 'month',
    interval_count: 1,
    billing_type: 'prepaid',
    minimum_price: planAmount,
    customer_id: customerId,
    card_token: cardToken,
    pricing_scheme: {
      scheme_type: 'unit',
      price: planAmount,
    },
    quantity: 1,
    description: 'Assinatura Tudo no Azul - Plano Mensal',
    statement_descriptor: 'TUDONOAZUL',
  };

  return pagarmeRequest('POST', '/subscriptions', payload);
}

export async function cancelSubscription(subscriptionId) {
  return pagarmeRequest('DELETE', `/subscriptions/${subscriptionId}`);
}

export async function getSubscription(subscriptionId) {
  return pagarmeRequest('GET', `/subscriptions/${subscriptionId}`);
}

// ====== ORDERS (para compra de múltiplos acessos) ======

export async function createOrder({ customerId, cardToken, quantity, unitPrice = 2990 }) {
  const totalAmount = quantity * unitPrice;

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
        credit_card: {
          card_token: cardToken,
          operation_type: 'auth_and_capture',
          installments: 1,
          statement_descriptor: 'TUDONOAZUL',
        },
        amount: totalAmount,
      }
    ],
  };

  return pagarmeRequest('POST', '/orders', payload);
}

export async function getOrder(orderId) {
  return pagarmeRequest('GET', `/orders/${orderId}`);
}
