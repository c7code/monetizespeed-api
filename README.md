# MonetizeSpeed Backend API

Backend da aplicação MonetizeSpeed usando Node.js, Express e PostgreSQL (Supabase).

## Instalação

```bash
npm install
```

## Configuração

### Localmente

Crie um arquivo `.env` na raiz do projeto com:

```
DATABASE_URL=sua_string_de_conexao_postgresql
JWT_SECRET=seu_secret_key_jwt
PORT=3000
```

### No Vercel

1. Acesse o painel do Vercel: https://vercel.com/dashboard
2. Selecione seu projeto
3. Vá em **Settings** → **Environment Variables**
4. Adicione as seguintes variáveis:
   - `DATABASE_URL`: Sua string de conexão PostgreSQL (ex: `postgresql://user:password@host:port/database`)
   - `JWT_SECRET`: Uma chave secreta para assinar tokens JWT (ex: `monetize-speed-secret-key-change-in-production`)
5. Faça um novo deploy após adicionar as variáveis

**Importante**: Certifique-se de que a `DATABASE_URL` está correta e que o banco de dados permite conexões externas (SSL pode ser necessário).

## Executar

```bash
# Desenvolvimento (com watch)
npm run dev

# Produção
npm start
```

## Endpoints

### Autenticação

- `POST /api/auth/register` - Cadastro de usuário
- `POST /api/auth/login` - Login
- `GET /api/auth/verify` - Verificar token (requer autenticação)

### Exemplo de cadastro:

```json
POST /api/auth/register
{
  "email": "usuario@email.com",
  "password": "senha123",
  "name": "Nome do Usuário"
}
```

### Exemplo de login:

```json
POST /api/auth/login
{
  "email": "usuario@email.com",
  "password": "senha123"
}
```




