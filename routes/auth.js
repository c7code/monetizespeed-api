import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import sgMail from '@sendgrid/mail';
import getPool from '../db.js';

// Configurar SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

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

// Esqueci minha senha - Enviar email de recuperação
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const pool = getPool();

    // Buscar usuário pelo email
    const userResult = await pool.query(
      'SELECT id, email, name FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Sempre retorna sucesso para não revelar se o email existe
    if (userResult.rows.length === 0) {
      return res.json({ message: 'Se o email estiver cadastrado, você receberá um link de recuperação.' });
    }

    const user = userResult.rows[0];

    // Criar tabela de password_resets se não existir
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Invalidar tokens anteriores do usuário
    await pool.query(
      'UPDATE password_resets SET used = true WHERE user_id = $1 AND used = false',
      [user.id]
    );

    // Gerar token seguro
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Salvar hash do token
    await pool.query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );

    // Montar link de reset
    const frontendUrl = process.env.FRONTEND_URL || 'https://tudonoazul.com.br';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Enviar email via SendGrid
    if (!process.env.SENDGRID_API_KEY) {
      console.error('SENDGRID_API_KEY não configurada');
      return res.status(500).json({ error: 'Serviço de email não configurado' });
    }

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@tudonoazul.com.br';

    const msg = {
      to: user.email,
      from: { email: fromEmail, name: 'Tudo no Azul' },
      subject: 'Recuperação de Senha - Tudo no Azul',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #7c3aed, #3b82f6); padding: 32px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #ffffff;">🔐 Recuperação de Senha</h1>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; margin-bottom: 8px;">Olá${user.name ? `, ${user.name}` : ''}!</p>
            <p style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">
              Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha:
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetLink}" 
                 style="display: inline-block; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Redefinir Minha Senha
              </a>
            </div>
            <p style="font-size: 13px; color: #64748b; margin-top: 24px;">
              ⏱️ Este link é válido por <strong>1 hora</strong> e pode ser usado apenas uma vez.
            </p>
            <p style="font-size: 13px; color: #64748b;">
              Se você não solicitou esta recuperação, ignore este email. Sua senha permanecerá inalterada.
            </p>
            <hr style="border: none; border-top: 1px solid #1e293b; margin: 24px 0;" />
            <p style="font-size: 12px; color: #475569; text-align: center;">
              Tudo no Azul — Gestão Financeira Inteligente
            </p>
          </div>
        </div>
      `
    };

    await sgMail.send(msg);
    console.log(`Email de recuperação enviado para: ${user.email}`);

    res.json({ message: 'Se o email estiver cadastrado, você receberá um link de recuperação.' });
  } catch (error) {
    console.error('Erro ao enviar email de recuperação:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação de recuperação de senha' });
  }
});

// Redefinir senha com token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    const pool = getPool();

    // Hash do token recebido para comparar com o armazenado
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Buscar token válido
    const resetResult = await pool.query(
      `SELECT pr.id, pr.user_id, pr.expires_at 
       FROM password_resets pr 
       WHERE pr.token_hash = $1 AND pr.used = false AND pr.expires_at > NOW()`,
      [tokenHash]
    );

    if (resetResult.rows.length === 0) {
      return res.status(400).json({ error: 'Link de recuperação inválido ou expirado. Solicite um novo.' });
    }

    const resetRecord = resetResult.rows[0];

    // Hash da nova senha
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Atualizar senha do usuário
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, resetRecord.user_id]
    );

    // Marcar token como usado
    await pool.query(
      'UPDATE password_resets SET used = true WHERE id = $1',
      [resetRecord.id]
    );

    console.log(`Senha redefinida com sucesso para user_id: ${resetRecord.user_id}`);

    res.json({ message: 'Senha redefinida com sucesso! Faça login com sua nova senha.' });
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
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

