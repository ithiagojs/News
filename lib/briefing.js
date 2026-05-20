import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEFINGS_DIR, SOURCES_PATH, BRIEFING_ITEMS_PER_SECTION } from './config.js';
import { todayISO, truncateText } from './utils.js';
import { collectNews } from './rss.js';
import { enrichWithGroq, enrichWithGemini, enrichWithOpenAI, buildSpecificWhyItMatters } from './ai.js';

// ─── Sources I/O ───────────────────────────────────────────────────

export async function readSources() {
  return JSON.parse(await readFile(SOURCES_PATH, 'utf8'));
}

export async function writeSources(sources) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(SOURCES_PATH, JSON.stringify(sources, null, 2) + '\n', 'utf8');
}

// ─── Briefing Persistence ──────────────────────────────────────────

export function briefingMarkdownPath(date) {
  return join(BRIEFINGS_DIR, `${date}.md`);
}

function briefingJsonPath(date) {
  return join(BRIEFINGS_DIR, `${date}.json`);
}

export async function listBriefings() {
  const files = await readdir(BRIEFINGS_DIR).catch(() => []);
  return files
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace(/\.json$/, ''))
    .sort()
    .reverse();
}

export async function loadBriefing(date) {
  const path = briefingJsonPath(date);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

// ─── Fallback Briefing (sem IA) ────────────────────────────────────

function buildFallbackBriefing(date, sections, errors) {
  const allItems = sections.flatMap(s => s.items);
  const lead = allItems[0];

  const headline = {
    title: lead?.title || 'Briefing sem manchete dominante',
    summary: lead?.description
      ? truncateText(lead.description, 160)
      : 'As fontes foram consultadas, mas nao houve contexto suficiente para montar uma manchete editorial.'
  };

  const sourceLinks = [];
  const seenLinks = new Set();
  sections.forEach(section => {
    section.items.forEach(item => {
      if (!item.link || seenLinks.has(item.link)) return;
      seenLinks.add(item.link);
      sourceLinks.push({ source: item.source, title: item.title, url: item.link });
    });
  });

  const fallbackSections = sections.map(section => ({
    id: section.id,
    name: section.name,
    items: section.items.slice(0, BRIEFING_ITEMS_PER_SECTION).map(item => ({
      title: item.title,
      context: truncateText(item.description || 'Contexto indisponivel no feed.', 120),
      source: item.source,
      link: item.link,
      publishedAt: item.publishedAt
    }))
  }));

  return {
    date,
    generatedAt: new Date().toISOString(),
    mode: 'fallback',
    headline,
    sections: fallbackSections,
    whyItMatters: buildSpecificWhyItMatters(fallbackSections),
    sourceLinks,
    errors
  };
}

// ─── Pipeline Principal ────────────────────────────────────────────

export async function generateBriefing(date = todayISO(), force = false) {
  if (!force) {
    const cached = await loadBriefing(date);
    if (cached) return cached;
  }

  const sources = await readSources();
  const collected = await collectNews(sources);
  collected.preferences = sources.preferences || '';

  let briefing;
  try {
    // Tenta Groq primeiro (mais rápido e gratuito)
    briefing = await enrichWithGroq(date, collected);
  } catch (error) {
    console.error('Erro na geração via Groq, tentando Gemini:', error.message);
    collected.errors.push({ source: 'Groq', message: error.message });
  }

  if (!briefing) {
    try {
      // Tenta Gemini como segunda opção gratuita
      briefing = await enrichWithGemini(date, collected);
    } catch (error) {
      console.error('Erro na geração via Gemini:', error.message);
      collected.errors.push({ source: 'Gemini', message: error.message });
    }
  }

  if (!briefing) {
    try {
      // Fallback para OpenAI se os modelos gratuitos falharem ou não estiverem configurados
      briefing = await enrichWithOpenAI(date, collected);
    } catch (error) {
      console.error('Erro na geração via OpenAI:', error.message);
      collected.errors.push({ source: 'OpenAI', message: error.message });
    }
  }

  if (!briefing) {
    briefing = buildFallbackBriefing(date, collected.sections, collected.errors);
  }

  // Serverless (Vercel): filesystem é read-only; persistência desativada
  console.log('Pipeline concluido. Modo:', briefing.mode);
  return briefing;
}
