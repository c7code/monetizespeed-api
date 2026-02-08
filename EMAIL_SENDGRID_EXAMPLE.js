// Exemplo de implementação com SendGrid
// Documentação: https://docs.sendgrid.com/

import sgMail from '@sendgrid/mail';

// Configurar API key do SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Enviar email de boas-vindas
 */
export async function sendWelcomeEmail(userEmail, userName) {
  const msg = {
    to: userEmail,
    from: 'noreply@monetizespeed.com', // Substitua pelo seu email verificado no SendGrid
    subject: 'Bem-vindo ao MonetizeSpeed!',
    html: `
      <h1>Olá, ${userName}!</h1>
      <p>Bem-vindo ao MonetizeSpeed. Sua conta foi criada com sucesso!</p>
      <p>Agora você pode começar a gerenciar suas finanças de forma inteligente.</p>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('Email enviado com sucesso');
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    if (error.response) {
      console.error('Detalhes do erro:', error.response.body);
    }
    throw error;
  }
}

/**
 * Enviar email de recuperação de senha
 */
export async function sendPasswordResetEmail(userEmail, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  const msg = {
    to: userEmail,
    from: 'noreply@monetizespeed.com',
    subject: 'Recuperação de Senha - MonetizeSpeed',
    html: `
      <h1>Recuperação de Senha</h1>
      <p>Você solicitou a recuperação de senha.</p>
      <p>Clique no link abaixo para criar uma nova senha:</p>
      <a href="${resetUrl}">${resetUrl}</a>
      <p>Este link expira em 1 hora.</p>
    `,
  };

  try {
    await sgMail.send(msg);
  } catch (error) {
    console.error('Erro ao enviar email de recuperação:', error);
    throw error;
  }
}

// Para instalar SendGrid:
// npm install @sendgrid/mail
