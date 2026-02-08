// Exemplo de implementação com Resend (Recomendado)
// Documentação: https://resend.com/docs

import Resend from 'resend';

// Inicializar Resend com sua API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Enviar email de boas-vindas
 */
export async function sendWelcomeEmail(userEmail, userName) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'MonetizeSpeed <onboarding@resend.dev>', // Substitua pelo seu domínio
      to: [userEmail],
      subject: 'Bem-vindo ao MonetizeSpeed!',
      html: `
        <h1>Olá, ${userName}!</h1>
        <p>Bem-vindo ao MonetizeSpeed. Sua conta foi criada com sucesso!</p>
        <p>Agora você pode começar a gerenciar suas finanças de forma inteligente.</p>
        <p>Se você não criou esta conta, ignore este email.</p>
      `,
    });

    if (error) {
      console.error('Erro ao enviar email:', error);
      throw error;
    }

    console.log('Email enviado com sucesso:', data);
    return data;
  } catch (error) {
    console.error('Erro ao enviar email de boas-vindas:', error);
    throw error;
  }
}

/**
 * Enviar email de recuperação de senha
 */
export async function sendPasswordResetEmail(userEmail, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'MonetizeSpeed <onboarding@resend.dev>',
      to: [userEmail],
      subject: 'Recuperação de Senha - MonetizeSpeed',
      html: `
        <h1>Recuperação de Senha</h1>
        <p>Você solicitou a recuperação de senha.</p>
        <p>Clique no link abaixo para criar uma nova senha:</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>Este link expira em 1 hora.</p>
        <p>Se você não solicitou esta recuperação, ignore este email.</p>
      `,
    });

    if (error) {
      console.error('Erro ao enviar email de recuperação:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Erro ao enviar email de recuperação:', error);
    throw error;
  }
}

/**
 * Enviar notificação de orçamento ultrapassado
 */
export async function sendBudgetAlertEmail(userEmail, category, spent, limit) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'MonetizeSpeed <onboarding@resend.dev>',
      to: [userEmail],
      subject: `⚠️ Orçamento ultrapassado: ${category}`,
      html: `
        <h1>Alerta de Orçamento</h1>
        <p>Atenção! Você ultrapassou o orçamento da categoria <strong>${category}</strong>.</p>
        <ul>
          <li>Limite: R$ ${limit.toFixed(2)}</li>
          <li>Gasto: R$ ${spent.toFixed(2)}</li>
          <li>Excedente: R$ ${(spent - limit).toFixed(2)}</li>
        </ul>
        <p>Considere revisar seus gastos nesta categoria.</p>
      `,
    });

    if (error) {
      console.error('Erro ao enviar alerta:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Erro ao enviar alerta de orçamento:', error);
    throw error;
  }
}

// Exemplo de uso em uma rota:
/*
import { sendWelcomeEmail } from './EMAIL_RESEND_EXAMPLE.js';

router.post('/auth/register', async (req, res) => {
  // ... código de registro ...
  
  // Enviar email de boas-vindas
  try {
    await sendWelcomeEmail(user.email, user.name);
  } catch (emailError) {
    // Não falhar o registro se o email falhar
    console.error('Erro ao enviar email, mas usuário foi criado:', emailError);
  }
  
  res.json({ token, user });
});
*/
