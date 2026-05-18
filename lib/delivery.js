import { WHATSAPP_MAX_LENGTH } from './config.js';

// ─── WhatsApp Delivery via CallMeBot ───────────────────────────────

export async function sendWhatsApp(briefing) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apikey) {
    console.log('Credenciais do WhatsApp nao configuradas. Pulando entrega.');
    return;
  }

  // Monta a mensagem formatada para WhatsApp
  let msg = `*Daily Briefing* 🗞️\n_${briefing.date}_\n\n`;
  msg += `*Manchete:* ${briefing.headline.title}\n${briefing.headline.summary}\n\n`;

  for (const sec of briefing.sections) {
    if (!sec.items?.length) continue;
    msg += `*--- ${sec.name.toUpperCase()} ---*\n`;
    for (const item of sec.items) {
      msg += `▪️ *${item.title}*\n_${item.context}_\n\n`;
    }
  }

  msg += `*--- POR QUE ISSO IMPORTA ---*\n`;
  for (const item of briefing.whyItMatters) {
    msg += `• ${item}\n`;
  }

  // Sanitiza '%' para evitar que decodificadores de URL do CallMeBot
  // interpretem sequências como %20, %0A etc. e corrompam a mensagem
  let finalMsg = msg.trim().replace(/%/g, ' por cento');

  // Limite de segurança: trunca com elegância se ultrapassar o limite do gateway
  if (finalMsg.length > WHATSAPP_MAX_LENGTH) {
    console.log(`Aviso: Mensagem com ${finalMsg.length} chars excede limite de ${WHATSAPP_MAX_LENGTH}. Truncando.`);
    finalMsg = finalMsg.slice(0, WHATSAPP_MAX_LENGTH - 60) + '\n\n... [resumo completo no painel] 🗞️';
  }

  console.log(`Enviando briefing (${finalMsg.length} chars) via WhatsApp para ${phone}...`);

  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.append('phone', phone);
  url.searchParams.append('text', finalMsg);
  url.searchParams.append('apikey', apikey);

  try {
    const res = await fetch(url.toString());
    if (res.ok) {
      console.log('Briefing entregue com sucesso!');
    } else {
      const errText = await res.text();
      console.error('Falha ao enviar WhatsApp. Status:', res.status, errText);
    }
  } catch (err) {
    console.error('Erro de rede ao enviar WhatsApp:', err.message);
  }
}
