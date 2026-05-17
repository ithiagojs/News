export async function sendWhatsApp(briefing) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apikey) {
    console.log('Credenciais do WhatsApp não configuradas. Pulando entrega.');
    return;
  }

  // Formatting message
  let msg = `*Daily Briefing* 🗞️\n_${briefing.date}_\n\n`;
  msg += `*Manchete:* ${briefing.headline.title}\n`;
  msg += `${briefing.headline.summary}\n\n`;

  const topicos = [];
  briefing.sections.forEach(sec => {
    if (sec.items && sec.items.length > 0) {
      topicos.push(`*${sec.name}*: ${sec.items[0].title}`);
    }
  });
  if (topicos.length > 0) {
    msg += `*Radar de hoje:*\n${topicos.map(t => '• ' + t).join('\n')}\n\n`;
  }

  msg += `*Por que isso importa:*\n`;
  briefing.whyItMatters.forEach(item => {
    msg += `• ${item}\n`;
  });
  
  msg += `\n_Acesse o painel local para ler o briefing completo e abrir as fontes._`;

  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.append('phone', phone);
  url.searchParams.append('text', msg);
  url.searchParams.append('apikey', apikey);

  console.log('Enviando briefing via WhatsApp para', phone, '...');
  try {
    const res = await fetch(url.toString());
    if (res.ok) {
      console.log('WhatsApp enviado com sucesso!');
    } else {
      const errText = await res.text();
      console.error('Falha ao enviar WhatsApp. Status:', res.status, errText);
    }
  } catch (err) {
    console.error('Erro de rede ao enviar WhatsApp:', err.message);
  }
}
