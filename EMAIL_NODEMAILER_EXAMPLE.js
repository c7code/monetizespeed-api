// Exemplo de implementação com Nodemailer (Gmail)
// ⚠️ Apenas para desenvolvimento/testes - NÃO recomendado para produção

import nodemailer from 'nodemailer';

// Configurar transporter do Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // Seu email Gmail
    pass: process.env.GMAIL_APP_PASSWORD, // App Password do Gmail (não sua senha normal!)
  },
});

/**
 * Enviar email de boas-vindas
 */
export async function sendWelcomeEmail(userEmail, userName) {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: userEmail,
    subject: 'Bem-vindo ao MonetizeSpeed!',
    html: `
      <h1>Olá, ${userName}!</h1>
      <p>Bem-vindo ao MonetizeSpeed. Sua conta foi criada com sucesso!</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email enviado:', info.messageId);
    return info;
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    throw error;
  }
}

/**
 * Configurar App Password do Gmail:
 * 
 * 1. Acesse: https://myaccount.google.com/apppasswords
 * 2. Selecione "Mail" e "Other (Custom name)"
 * 3. Digite um nome (ex: "MonetizeSpeed API")
 * 4. Copie a senha gerada
 * 5. Use essa senha no GMAIL_APP_PASSWORD (não sua senha normal!)
 * 
 * Variáveis de ambiente necessárias:
 * GMAIL_USER=seuemail@gmail.com
 * GMAIL_APP_PASSWORD=senha-gerada-pelo-google
 */

// Para instalar Nodemailer:
// npm install nodemailer
