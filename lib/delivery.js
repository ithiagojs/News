export async function sendWhatsApp(briefing) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apikey) {
    console.log('Credenciais do WhatsApp não configuradas. Pulando entrega.');
    return;
  }

  let msg = `*Daily Briefing* 🗞️\n_${briefing.date}_\n\n*Manchete:* ${briefing.headline.title}\n${briefing.headline.summary}\n\n`;

  // 2. Seções
  briefing.sections.forEach(sec => {
    if (sec.items && sec.items.length > 0) {
      msg += `*--- ${sec.name.toUpperCase()} ---*\n`;
      sec.items.forEach(item => {
        msg += `▪️ *${item.title}*\n_${item.context}_\n\n`;
      });
    }
  });

  // 3. Porque importa
  msg += `*--- POR QUE ISSO IMPORTA ---*\n`;
  briefing.whyItMatters.forEach(item => {
    msg += `• ${item}\n`;
  });

  console.log('Enviando briefing consolidado via WhatsApp para', phone, '...');
  
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.append('phone', phone);
  url.searchParams.append('text', msg.trim());
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
