# Como Implementar Envio de Email na API

## Passo 1: Escolher um Serviço

**Recomendação:** Resend (mais fácil) ou SendGrid (mais popular)

## Passo 2: Instalar a Biblioteca

### Opção A: Resend (Recomendado)
```bash
npm install resend
```

### Opção B: SendGrid
```bash
npm install @sendgrid/mail
```

### Opção C: Nodemailer (Gmail - apenas testes)
```bash
npm install nodemailer
```

## Passo 3: Obter API Key

### Resend:
1. Acesse: https://resend.com
2. Crie uma conta gratuita
3. Vá em "API Keys"
4. Crie uma nova chave
5. Copie a chave

### SendGrid:
1. Acesse: https://sendgrid.com
2. Crie uma conta gratuita
3. Vá em Settings → API Keys
4. Crie uma nova chave
5. Copie a chave

## Passo 4: Adicionar Variável de Ambiente

Adicione no seu `.env`:

```env
# Para Resend
RESEND_API_KEY=re_xxxxxxxxxxxxx

# Para SendGrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx

# URL do frontend (para links em emails)
FRONTEND_URL=http://localhost:5173
```

**No Vercel:**
1. Vá em Settings → Environment Variables
2. Adicione a variável `RESEND_API_KEY` ou `SENDGRID_API_KEY`
3. Faça um novo deploy

## Passo 5: Criar Arquivo de Serviço de Email

Crie `services/email.js` com o código do exemplo:
- `EMAIL_RESEND_EXAMPLE.js` → copie para `services/email.js`
- Ou use `EMAIL_SENDGRID_EXAMPLE.js`

## Passo 6: Integrar no Endpoint de Registro

Veja o exemplo em `routes/auth.js.example` (será criado)

## Casos de Uso Prontos

1. ✅ Email de boas-vindas (registro)
2. ✅ Recuperação de senha
3. ✅ Notificações de orçamento
4. ✅ Alertas financeiros

## Testando

Após implementar, teste enviando um email:

```bash
# Via Postman ou curl
POST http://localhost:3000/api/auth/register
{
  "email": "teste@email.com",
  "password": "senha123",
  "name": "Teste"
}
```

Verifique se o email chegou na caixa de entrada!
