# Configuração do Webhook WhatsApp - MonetizeSpeed

## Visão Geral

Este webhook permite que você envie mensagens pelo WhatsApp para criar transações automaticamente. Por exemplo:
- "gastei 300 reais no almoço" → cria uma despesa de R$ 300 na categoria Alimentação
- "recebi 5000 de salário" → cria uma receita de R$ 5000 na categoria Salário

## Pré-requisitos

Para usar este webhook, você precisa de:

1. **Serviço de WhatsApp Business API** ou **Evolution API** ou **Baileys**
   - Opções recomendadas:
     - **Twilio WhatsApp API** (pago, oficial)
     - **Evolution API** (open source, self-hosted)
     - **Baileys** (biblioteca Node.js, não oficial)

2. **Número de telefone cadastrado** no sistema
3. **URL pública** do seu servidor (para receber webhooks)

## Configuração

### 1. Adicionar número do WhatsApp ao usuário

Você precisa associar seu número do WhatsApp ao seu usuário no sistema. Isso pode ser feito de duas formas:

**Opção A: Via API (recomendado)**
```bash
# Criar endpoint para atualizar número do WhatsApp
POST /api/user/whatsapp
Authorization: Bearer SEU_TOKEN
Content-Type: application/json

{
  "whatsapp_number": "5511999999999"
}
```

**Opção B: Diretamente no banco**
```sql
UPDATE users SET whatsapp_number = '5511999999999' WHERE email = 'seu@email.com';
```

### 2. Configurar variáveis de ambiente

Adicione no arquivo `.env` do servidor:

```env
WEBHOOK_SECRET=sua-chave-secreta-aqui-muito-segura
```

### 3. Configurar seu serviço de WhatsApp

#### Opção 1: Evolution API (Recomendado para testes)

1. Instale Evolution API:
```bash
docker run -d \
  --name evolution-api \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=sua-chave-aqui \
  atendai/evolution-api:latest
```

2. Configure o webhook no Evolution API:
```bash
POST http://localhost:8080/webhook/set/YOUR_INSTANCE_NAME
{
  "url": "https://seu-servidor.com/api/webhook/whatsapp",
  "webhook_by_events": false,
  "webhook_base64": false,
  "events": ["MESSAGES_UPSERT"],
  "headers": {
    "X-Webhook-Secret": "sua-chave-secreta-aqui-muito-segura"
  }
}
```

#### Opção 2: Twilio WhatsApp API

1. Crie uma conta no Twilio
2. Configure o webhook no Twilio Console:
   - URL: `https://seu-servidor.com/api/webhook/whatsapp`
   - Método: POST
   - Headers: `X-Webhook-Secret: sua-chave-secreta-aqui-muito-segura`

#### Opção 3: Baileys (Self-hosted)

Use a biblioteca Baileys para criar seu próprio servidor WhatsApp e enviar requisições para o webhook.

## Formato do Webhook

### Endpoint
```
POST /api/webhook/whatsapp
```

### Headers
```
X-Webhook-Secret: sua-chave-secreta-aqui-muito-segura
Content-Type: application/json
```

### Body (Evolution API)
```json
{
  "from": "5511999999999",
  "message": "gastei 300 reais no almoço"
}
```

### Body (Twilio)
```json
{
  "From": "whatsapp:+5511999999999",
  "Body": "gastei 300 reais no almoço"
}
```

## Processamento de Mensagens

O sistema processa mensagens em português e identifica:

### Tipos de Transação
- **Despesa**: "gastei", "paguei", "comprei", "despesa", "gasto", "pago"
- **Receita**: "recebi", "ganhei", "entrou", "receita", "recebido"

### Valores
Reconhece valores em formatos como:
- "300 reais"
- "R$ 300"
- "300,50"
- "300.50"

### Categorias
Identifica automaticamente:
- **Alimentação**: almoço, jantar, lanche, comida, restaurante
- **Transporte**: uber, táxi, combustível, gasolina, ônibus
- **Lazer**: cinema, show, festa, viagem
- **Saúde**: médico, farmácia, hospital
- **Educação**: curso, livro, escola
- **Moradia**: aluguel, condomínio, luz, água, internet
- **Compras**: supermercado, mercado
- **Salário**: salário, freelance, venda

## Exemplos de Mensagens

```
✅ "gastei 300 reais no almoço"
✅ "paguei R$ 50 de uber"
✅ "recebi 5000 de salário"
✅ "comprei comida no mercado, 150 reais"
✅ "gastei 200 no cinema"
```

## Teste do Parser

Você pode testar o parser sem criar transação:

```bash
POST /api/webhook/test-parse
Content-Type: application/json

{
  "message": "gastei 300 reais no almoço"
}
```

Resposta:
```json
{
  "original": "gastei 300 reais no almoço",
  "parsed": {
    "type": "expense",
    "amount": 300,
    "category": "Alimentação",
    "date": "2024-12-13",
    "description": "gastei 300 reais no almoço",
    "status": "paid"
  }
}
```

## Segurança

1. **Webhook Secret**: Sempre use um secret forte no header `X-Webhook-Secret`
2. **HTTPS**: Use HTTPS em produção para proteger as requisições
3. **Validação**: O sistema valida o secret antes de processar mensagens
4. **Rate Limiting**: Considere adicionar rate limiting para evitar spam

## Próximos Passos

1. Escolha um serviço de WhatsApp (Evolution API recomendado para começar)
2. Configure o número do WhatsApp no seu usuário
3. Configure o webhook no serviço escolhido
4. Teste enviando uma mensagem!

## Suporte

Se precisar de ajuda, verifique:
- Logs do servidor: `server/logs/`
- Teste o parser: `POST /api/webhook/test-parse`
- Verifique se o número está cadastrado no banco




