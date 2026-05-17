export async function sendWhatsApp(briefing) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apikey) {
    console.log('Credenciais do WhatsApp não configuradas. Pulando entrega.');
    return;
  }

  // 1. Coletar TODAS as linhas do briefing completo
  const rawLines = [];
  rawLines.push(`*Daily Briefing* 🗞️\n_${briefing.date}_\n`);
  rawLines.push(`*Manchete:* ${briefing.headline.title}`);
  rawLines.push(`${briefing.headline.summary}\n`);

  briefing.sections.forEach(sec => {
    if (sec.items && sec.items.length > 0) {
      rawLines.push(`*--- ${sec.name.toUpperCase()} ---*`);
      sec.items.forEach(item => {
        rawLines.push(`▪️ *${item.title}*`);
        rawLines.push(`_${item.context}_`);
        if (item.link) rawLines.push(`Fonte: ${item.link}`);
        rawLines.push(''); // blank line
      });
    }
  });

  rawLines.push(`*--- POR QUE ISSO IMPORTA ---*`);
  briefing.whyItMatters.forEach(item => {
    rawLines.push(`• ${item}`);
  });

  // 2. Agrupar em pacotes seguros para o tamanho da URL do CallMeBot (aprox max 1800 url-encoded)
  const msgs = [];
  let currentMsg = '';

  for (const line of rawLines) {
    const encodedLineLen = encodeURIComponent(line + '\n').length;
    const encodedCurrentLen = encodeURIComponent(currentMsg).length;
    
    // Se adicionar esta linha estourar o limite, empacota e começa um novo
    if (encodedCurrentLen + encodedLineLen > 1800) {
      msgs.push(currentMsg.trim());
      currentMsg = line + '\n';
    } else {
      currentMsg += line + '\n';
    }
  }
  if (currentMsg.trim().length > 0) {
    msgs.push(currentMsg.trim());
  }

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
