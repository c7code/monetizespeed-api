import sgMail from '@sendgrid/mail';

// Configurar SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@tudonoazul.com.br';

/**
 * Enviar email com os códigos de acesso após compra
 */
export async function sendAccessCodesEmail(userEmail, userName, codes) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️ SENDGRID_API_KEY não configurada, email não enviado');
    return;
  }

  const codesHtml = codes.map(code => `
    <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 12px; text-align: center;">
      <span style="font-family: 'Courier New', monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #22d3ee;">
        ${code}
      </span>
      <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b;">30 dias de acesso completo</p>
    </div>
  `).join('');

  const msg = {
    to: userEmail,
    from: { email: fromEmail, name: 'Tudo no Azul' },
    subject: `🎟️ Seus ${codes.length} código${codes.length > 1 ? 's' : ''} de acesso — Tudo no Azul`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #7c3aed, #06b6d4); padding: 32px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 8px;">🎟️</div>
          <h1 style="margin: 0; font-size: 22px; color: #ffffff;">Seus Códigos de Acesso</h1>
          <p style="margin: 8px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.8);">Compra realizada com sucesso!</p>
        </div>
        <div style="padding: 32px;">
          <p style="font-size: 16px; margin-bottom: 8px;">Olá${userName ? `, ${userName}` : ''}! 👋</p>
          <p style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">
            Sua compra de <strong style="color: #22d3ee;">${codes.length} código${codes.length > 1 ? 's' : ''} de acesso</strong> foi confirmada.
            Cada código dá <strong>30 dias</strong> de acesso completo ao Tudo no Azul.
          </p>

          <h2 style="font-size: 16px; color: #a5b4fc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 2px;">
            ${codes.length > 1 ? 'Seus Códigos' : 'Seu Código'}
          </h2>

          ${codesHtml}

          <div style="background-color: #1e293b; border-radius: 12px; padding: 20px; margin-top: 24px;">
            <h3 style="font-size: 14px; color: #a5b4fc; margin: 0 0 12px 0;">📋 Como usar</h3>
            <ol style="margin: 0; padding-left: 20px; font-size: 13px; color: #94a3b8; line-height: 1.8;">
              <li>Compartilhe o código com quem desejar</li>
              <li>A pessoa acessa <strong style="color: #22d3ee;">tudonoazul.com.br</strong> e faz login</li>
              <li>Vai em <strong>Assinatura & Planos</strong> → <strong>Resgatar Código</strong></li>
              <li>Insere o código e pronto! ✨</li>
            </ol>
          </div>

          <div style="background-color: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: 8px; padding: 12px; margin-top: 16px;">
            <p style="margin: 0; font-size: 12px; color: #eab308;">
              ⚠️ <strong>Importante:</strong> Cada código só pode ser resgatado uma única vez. Guarde-os em segurança!
            </p>
          </div>

          <hr style="border: none; border-top: 1px solid #1e293b; margin: 24px 0;" />
          <p style="font-size: 12px; color: #475569; text-align: center;">
            Tudo no Azul — Gestão Financeira Inteligente 💙
          </p>
        </div>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Email com ${codes.length} código(s) enviado para: ${userEmail}`);
  } catch (error) {
    console.error('❌ Erro ao enviar email com códigos:', error);
    if (error.response) {
      console.error('Detalhes:', error.response.body);
    }
    // Não lançar erro — o email é complementar, não deve bloquear a compra
  }
}

/**
 * Enviar email de confirmação de assinatura
 */
export async function sendSubscriptionConfirmEmail(userEmail, userName, expiresAt) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️ SENDGRID_API_KEY não configurada, email não enviado');
    return;
  }

  const expiresDate = new Date(expiresAt).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  const msg = {
    to: userEmail,
    from: { email: fromEmail, name: 'Tudo no Azul' },
    subject: '✅ Assinatura ativada — Tudo no Azul',
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #059669, #06b6d4); padding: 32px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 8px;">🎉</div>
          <h1 style="margin: 0; font-size: 22px; color: #ffffff;">Assinatura Ativada!</h1>
        </div>
        <div style="padding: 32px;">
          <p style="font-size: 16px; margin-bottom: 8px;">Olá${userName ? `, ${userName}` : ''}! 👋</p>
          <p style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">
            Sua assinatura do <strong style="color: #22d3ee;">Tudo no Azul</strong> foi ativada com sucesso!
          </p>

          <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 12px; padding: 20px; text-align: center;">
            <p style="margin: 0 0 4px 0; font-size: 13px; color: #64748b;">Plano válido até</p>
            <p style="margin: 0; font-size: 20px; font-weight: 700; color: #34d399;">${expiresDate}</p>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #64748b;">R$ 29,90/mês • Renovação automática</p>
          </div>

          <p style="font-size: 14px; color: #94a3b8; margin-top: 24px;">
            Agora você tem acesso completo a todas as funcionalidades:
          </p>
          <ul style="font-size: 13px; color: #94a3b8; line-height: 2; padding-left: 16px;">
            <li>💬 Chat financeiro com IA</li>
            <li>📱 Integração WhatsApp</li>
            <li>📊 Relatórios detalhados</li>
            <li>💳 Gestão de cartões e carteiras</li>
            <li>📋 Contas a pagar e receber</li>
          </ul>

          <hr style="border: none; border-top: 1px solid #1e293b; margin: 24px 0;" />
          <p style="font-size: 12px; color: #475569; text-align: center;">
            Tudo no Azul — Gestão Financeira Inteligente 💙
          </p>
        </div>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Email de confirmação de assinatura enviado para: ${userEmail}`);
  } catch (error) {
    console.error('❌ Erro ao enviar email de assinatura:', error);
  }
}
