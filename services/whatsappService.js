import twilio from 'twilio';

// Inicializar cliente Twilio (lazy)
let twilioClient;
function getTwilioClient() {
    if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
    return twilioClient;
}

/**
 * Envia uma mensagem via WhatsApp usando Twilio
 * @param {string} to - Número do destinatário (apenas dígitos, ex: 5581999999999)
 * @param {string} body - Corpo da mensagem
 */
export async function sendWhatsAppMessage(to, body) {
    const client = getTwilioClient();
    if (!client) {
        throw new Error('Twilio não configurado. Verifique TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN.');
    }

    const from = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!from) {
        throw new Error('TWILIO_WHATSAPP_NUMBER não configurado.');
    }

    // Garantir formato whatsapp:+XXXXXXXXXXX
    const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace(/^\+/, '')}`;

    const message = await client.messages.create({
        from,
        to: toFormatted,
        body,
    });

    console.log(`📨 WhatsApp enviado para ${toFormatted} | SID: ${message.sid}`);
    return message;
}

/**
 * Envia mensagem de boas-vindas ao Tudo no Azul
 * @param {string} phoneNumber - Número do WhatsApp (apenas dígitos)
 * @param {string} userName - Nome do usuário (pode ser null)
 */
export async function sendWelcomeMessage(phoneNumber, userName) {
    const greeting = userName ? `Bem-vindo(a) ao Tudo no Azul, ${userName}!` : 'Bem-vindo(a) ao Tudo no Azul!';

    const body =
        `🎉 ${greeting}\n\n` +
        `Seu WhatsApp foi conectado com sucesso! ✅\n\n` +
        `Agora você pode registrar seus gastos e receitas diretamente por aqui. É só me enviar uma mensagem como:\n\n` +
        `💬 "Gastei 50 reais no almoço"\n` +
        `🎤 Um áudio descrevendo o gasto\n` +
        `📷 Uma foto do recibo ou nota fiscal\n\n` +
        `Vamos juntos manter suas finanças no azul! 💙`;

    return sendWhatsAppMessage(phoneNumber, body);
}
