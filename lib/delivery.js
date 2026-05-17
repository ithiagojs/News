export async function sendWhatsApp(briefing) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apikey) {
    console.log('Credenciais do WhatsApp não configuradas. Pulando entrega.');
    return;
  }

  // 1. Manchete (Mensagem 1)
  const msgs = [];
  msgs.push(`*Daily Briefing* 🗞️\n_${briefing.date}_\n\n*Manchete:* ${briefing.headline.title}\n${briefing.headline.summary}`);

  // 2. Uma mensagem dedicada para cada categoria (Brasil, Mundo, etc)
  // Removemos os links (URLs) porque inflam absurdamente o limite da API e poluem a leitura.
  briefing.sections.forEach(sec => {
    if (sec.items && sec.items.length > 0) {
      let secMsg = `*--- ${sec.name.toUpperCase()} ---*\n\n`;
      sec.items.forEach(item => {
        secMsg += `▪️ *${item.title}*\n_${item.context}_\n\n`;
      });
      msgs.push(secMsg.trim());
    }
  });

  // 3. Por que isso importa (Última Mensagem)
  let whyMsg = `*--- POR QUE ISSO IMPORTA ---*\n\n`;
  briefing.whyItMatters.forEach(item => {
    whyMsg += `• ${item}\n\n`;
  });
  msgs.push(whyMsg.trim());

  console.log(`Enviando briefing completo via WhatsApp dividido em ${msgs.length} partes...`);
  
  // 3. Disparar com espaçamento de 2.5s para não tomar rate limit
  for (const [index, textPart] of msgs.entries()) {
    const url = new URL('https://api.callmebot.com/whatsapp.php');
    url.searchParams.append('phone', phone);
    url.searchParams.append('text', textPart);
    url.searchParams.append('apikey', apikey);

    try {
      const res = await fetch(url.toString());
      if (res.ok) {
        console.log(`Parte ${index + 1}/${msgs.length} enviada!`);
      } else {
        const errText = await res.text();
        console.error(`Falha ao enviar parte ${index + 1}. Status:`, res.status, errText);
      }
    } catch (err) {
      console.error(`Erro de rede na parte ${index + 1}:`, err.message);
    }
    await new Promise(r => setTimeout(r, 2500));
  }
}
