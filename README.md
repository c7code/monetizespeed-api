# MonetizeSpeed Backend API

Backend da aplicação MonetizeSpeed usando Node.js, Express e PostgreSQL (Supabase).

## Instalação

```bash
npm install
```

## Configuração

Crie um arquivo `.env` na raiz do projeto com:

```
DATABASE_URL=sua_string_de_conexao_postgresql
JWT_SECRET=seu_secret_key_jwt
PORT=3000
```

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




