import { WHATSAPP_MAX_LENGTH } from './config.js';

// ─── WhatsApp Delivery via CallMeBot ───────────────────────────────

/**
 * Monta a mensagem completa do briefing formatada para WhatsApp.
 * Retorna a string bruta (antes de sanitização/truncamento).
 */
function buildWhatsAppMessage(briefing) {
  let msg = `_${briefing.date}_\n\n`;
  msg += `*Manchete:* ${briefing.headline.title}\n${briefing.headline.summary}\n\n`;

  for (const sec of briefing.sections) {
    if (!sec.items?.length) continue;
    msg += `\n*${sec.name.toUpperCase()}*\n`;
    for (const item of sec.items) {
      const title = item.title.trim().replace(/\*/g, ''); // evita quebrar formatação do WhatsApp
      const context = item.context.trim().replace(/_/g, '');
      msg += `- *${title}*\n_${context}_\n\n`;
    }
  }

  if (briefing.whyItMatters?.length) {
    msg += `\n*POR QUE ISSO IMPORTA*\n`;
    for (const item of briefing.whyItMatters) {
      msg += `• ${item}\n`;
    }
  }

  return msg.trim();
}

/**
 * Sanitiza a mensagem para envio via CallMeBot.
 * - Substitui '%' por ' por cento' para evitar decodificação de URL
 */
function sanitize(text) {
  return text.replace(/%/g, ' por cento');
}

/**
 * Divide a mensagem em partes que cabem no limite do CallMeBot.
 * Tenta dividir por seções para evitar cortar no meio de uma notícia.
 */
function splitMessage(fullMessage, maxLen) {
  if (fullMessage.length <= maxLen) return [fullMessage];

  const parts = [];
  const paragraphs = fullMessage.split('\n\n');
  
  let currentPart = '';

  for (const para of paragraphs) {
    if (!para.trim()) continue;
    
    // Se adicionar este paragrafo vai exceder o limite (com alguma folga)
    if (currentPart && (currentPart + '\n\n' + para).length > maxLen * 0.9) {
      parts.push(currentPart.trim());
      currentPart = para;
    } else {
      currentPart = currentPart ? currentPart + '\n\n' + para : para;
    }
  }
  
  if (currentPart.trim()) {
    // Caso de seguranca extremo se um unico paragrafo for maior que maxLen
    if (currentPart.length > maxLen) {
      parts.push(currentPart.slice(0, maxLen - 50) + '\n\n...');
    } else {
      parts.push(currentPart.trim());
    }
  }

  // Adiciona indicador de continuação
  if (parts.length > 1) {
    for (let i = 0; i < parts.length; i++) {
      const tag = `[${i + 1}/${parts.length}]`;
      if (i === 0) {
        parts[i] = parts[i] + `\n\n_${tag} continua..._`;
      } else if (i === parts.length - 1) {
        parts[i] = `_${tag}_\n\n` + parts[i];
      } else {
        parts[i] = `_${tag}_\n\n` + parts[i] + `\n\n_continua..._`;
      }
    }
  }

  return parts;
}

/**
 * Envia uma única parte da mensagem via CallMeBot.
 */
async function sendPart(phone, apikey, text) {
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.append('phone', phone);
  url.searchParams.append('text', text);
  url.searchParams.append('apikey', apikey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errText = await res.text();
    console.error('Falha ao enviar WhatsApp. Status:', res.status, errText);
    return false;
  }
  return true;
}

/**
 * Delay entre envios para não sobrecarregar o CallMeBot.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Public API ────────────────────────────────────────────────────

export async function sendWhatsApp(briefing) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_API_KEY;

  if (!phone || !apikey) {
    console.log('Credenciais do WhatsApp nao configuradas. Pulando entrega.');
    return;
  }

  const rawMessage = buildWhatsAppMessage(briefing);
  const sanitized = sanitize(rawMessage);
  const parts = splitMessage(sanitized, WHATSAPP_MAX_LENGTH);

  console.log(`Mensagem total: ${sanitized.length} chars → ${parts.length} parte(s)`);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Truncamento de segurança final por parte (não deveria acontecer, mas protege)
    let finalPart = part;
    if (finalPart.length > WHATSAPP_MAX_LENGTH) {
      console.log(`Aviso: Parte ${i + 1} com ${finalPart.length} chars excede limite. Truncando.`);
      finalPart = finalPart.slice(0, WHATSAPP_MAX_LENGTH - 50) + '\n\n... [resumo continua no painel]';
    }

    console.log(`Enviando parte ${i + 1}/${parts.length} (${finalPart.length} chars) para ${phone}...`);
    const ok = await sendPart(phone, apikey, finalPart);

    if (ok) {
      console.log(`Parte ${i + 1} entregue com sucesso!`);
    } else {
      console.error(`Falha na parte ${i + 1}. Abortando envio das demais.`);
      return;
    }

    // Espera entre partes para não sobrecarregar o gateway
    if (i < parts.length - 1) {
      console.log('Aguardando 3s antes da próxima parte...');
      await delay(3000);
    }
  }

  console.log('Briefing completo entregue com sucesso!');
}
