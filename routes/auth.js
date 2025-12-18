import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import getPool from '../db.js';

const router = express.Router();

// Cadastro de usuário
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validações
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    // Verificar se o usuário já existe
    const pool = getPool();
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    // Hash da senha
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Criar usuário
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email.toLowerCase(), passwordHash, name || null]
    );

    const user = result.rows[0];

    // Gerar token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Erro no cadastro:', error);
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validações
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    // Buscar usuário
    let pool;
    try {
      pool = getPool();
    } catch (poolError) {
      console.error('Erro ao obter pool de conexão:', poolError);
      return res.status(500).json({ 
        error: 'Erro ao conectar ao banco de dados',
        message: poolError.message 
      });
    }
    
    let result;
    try {
      result = await pool.query(
        'SELECT id, email, password_hash, name FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
    } catch (queryError) {
      console.error('Erro ao executar query:', queryError);
      console.error('Stack:', queryError.stack);
      return res.status(500).json({ 
        error: 'Erro ao buscar usuário',
        message: queryError.message || 'Erro ao consultar banco de dados'
      });
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    
    // Verificar se o usuário tem password_hash
    if (!user.password_hash) {
      console.error('Usuário sem password_hash:', user.id);
      return res.status(500).json({ 
        error: 'Erro interno do servidor',
        message: 'Dados do usuário inválidos'
      });
    }

    // Verificar senha
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Verificar se JWT_SECRET está configurado
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET não está configurado');
      return res.status(500).json({ 
        error: 'Erro de configuração do servidor',
        message: 'JWT_SECRET não está configurado'
      });
    }

    // Gerar token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    console.error('Stack:', error.stack);
    console.error('Mensagem:', error.message);
    
    // Retornar mensagem de erro mais detalhada
    res.status(500).json({ 
      error: 'Erro ao fazer login',
      message: error.message || 'Erro desconhecido',
      // Em desenvolvimento, mostrar mais detalhes
      ...(process.env.NODE_ENV !== 'production' && { 
        stack: error.stack,
        details: error.toString()
      })
    });
  }
});

// Verificar token (middleware para outras rotas)
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    req.user = user;
    next();
  });
}

// Rota para verificar token válido
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, email, name FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Erro ao verificar token:', error);
    res.status(500).json({ error: 'Erro ao verificar token' });
  }
});

export default router;

