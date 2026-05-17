import { generateBriefing } from '../lib/briefing.js';
import { sendWhatsApp } from '../lib/delivery.js';

export default async function handler(req, res) {
  try {
    console.log('Iniciando geração de briefing na nuvem (Vercel Cron)...');
    // Para no Vercel não buscar arquivo local se não for forçado
    const briefing = await generateBriefing(undefined, true);
    await sendWhatsApp(briefing);
    return res.status(200).json({ success: true, message: 'Briefing processado e enviado.' });
  } catch (error) {
    console.error('Erro fatal no Cron:', error);
    return res.status(500).json({ error: error.message });
  }
}
