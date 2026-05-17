export async function sendWhatsApp(briefing) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apikey) {
    console.log('Credenciais do WhatsApp não configuradas. Pulando entrega.');
    return;
  }

  // Formatting message - Part 1
  let msg1 = `*Daily Briefing* 🗞️\n_${briefing.date}_\n\n`;
  msg1 += `*Manchete:* ${briefing.headline.title}\n`;
  msg1 += `${briefing.headline.summary}\n\n`;

  const topicos = [];
  briefing.sections.forEach(sec => {
    if (sec.items && sec.items.length > 0) {
      topicos.push(`*${sec.name}*: ${sec.items[0].title}`);
    }
  });
  if (topicos.length > 0) {
    msg1 += `*Radar de hoje:*\n${topicos.map(t => '• ' + t).join('\n')}`;
  }

  // Formatting message - Part 2
  let msg2 = `*Por que isso importa:*\n`;
  briefing.whyItMatters.forEach(item => {
    msg2 += `• ${item}\n\n`;
  });
  
  msg2 += `_Acesse o painel da nuvem para ler a matéria completa._`;

  console.log('Enviando briefing via WhatsApp para', phone, '...');
  
  const msgs = [msg1, msg2];
  for (const textPart of msgs) {
    const url = new URL('https://api.callmebot.com/whatsapp.php');
    url.searchParams.append('phone', phone);
    url.searchParams.append('text', textPart);
    url.searchParams.append('apikey', apikey);

    try {
      const res = await fetch(url.toString());
      if (res.ok) {
        console.log('Parte do WhatsApp enviada!');
      } else {
        const errText = await res.text();
        console.error('Falha ao enviar WhatsApp. Status:', res.status, errText);
      }
    } catch (err) {
      console.error('Erro de rede ao enviar WhatsApp:', err.message);
    }
    // Prevenir rate limit do CallMeBot
    await new Promise(r => setTimeout(r, 2000));
  }
}
