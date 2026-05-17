import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEFINGS_DIR, SOURCES_PATH } from './config.js';
import { todayISO, truncateText } from './utils.js';
import { collectNews } from './rss.js';
import { enrichWithOpenAI, enrichWithGroq, buildSpecificWhyItMatters } from './ai.js';

export async function readSources() {
  return JSON.parse(await readFile(SOURCES_PATH, 'utf8'));
}

export async function writeSources(sources) {
  await writeFile(SOURCES_PATH, JSON.stringify(sources, null, 2) + '\n', 'utf8');
}

export function briefingMarkdownPath(date) {
  return join(BRIEFINGS_DIR, `${date}.md`);
}

function briefingJsonPath(date) {
  return join(BRIEFINGS_DIR, `${date}.json`);
}

export async function listBriefings() {
  const files = await readdir(BRIEFINGS_DIR).catch(() => []);
  const dates = files
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace(/\.json$/, ''))
    .sort()
    .reverse();
  return dates;
}

export async function loadBriefing(date) {
  const path = briefingJsonPath(date);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function saveBriefing(briefing) {
  // Desativado para Vercel Serverless (Read-Only File System)
  console.log('Arquitetura serverless: pulando persistência local em disco.');
}

function buildFallbackBriefing(date, sections, errors) {
  const firstStrongItem = sections.flatMap(section => section.items)[0];
  const headlineTitle = firstStrongItem?.title || 'Briefing sem manchete dominante';
  const headlineSummary = firstStrongItem?.description
    ? truncateText(firstStrongItem.description, 280)
    : 'As fontes foram consultadas, mas nao houve contexto suficiente para montar uma manchete editorial forte.';

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
    items: section.items.slice(0, 3).map(item => ({
      title: item.title,
      context: truncateText(item.description || 'Contexto curto indisponivel no feed original.', 260),
      source: item.source,
      link: item.link,
      publishedAt: item.publishedAt
    }))
  }));

  return {
    date,
    generatedAt: new Date().toISOString(),
    mode: 'fallback',
    headline: {
      title: headlineTitle,
      summary: headlineSummary
    },
    sections: fallbackSections,
    whyItMatters: buildSpecificWhyItMatters(fallbackSections),
    sourceLinks,
    errors
  };
}

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
    briefing = await enrichWithGroq(date, collected) || await enrichWithOpenAI(date, collected);
  } catch (error) {
    collected.errors.push({ source: 'IA', message: error.message });
  }

  if (!briefing) briefing = buildFallbackBriefing(date, collected.sections, collected.errors);
  await saveBriefing(briefing);
  return briefing;
}

function toMarkdown(briefing) {
  const headline = briefing.headline || { title: 'Sem manchete', summary: '' };
  const sections = Array.isArray(briefing.sections) ? briefing.sections : [];
  const whyItMatters = Array.isArray(briefing.whyItMatters) ? briefing.whyItMatters : [];
  const sourceLinks = Array.isArray(briefing.sourceLinks) ? briefing.sourceLinks : [];
  const lines = [];
  lines.push(`# Daily Briefing - ${briefing.date}`);
  lines.push('');
  lines.push(`Gerado em ${new Date(briefing.generatedAt).toLocaleString('pt-BR')}`);
  lines.push(`Modo: ${briefing.mode === 'fallback' ? 'fallback RSS' : 'IA'}`);
  lines.push('');
  lines.push('## Manchete do dia');
  lines.push('');
  lines.push(`**${headline.title}**`);
  lines.push('');
  lines.push(headline.summary);
  lines.push('');

  sections.forEach(section => {
    lines.push(`## ${section.name}`);
    lines.push('');
    (section.items || []).forEach(item => {
      const link = item.link ? ` ([fonte](${item.link}))` : '';
      lines.push(`- **${item.title}** - ${item.context}${link}`);
    });
    lines.push('');
  });

  lines.push('## Por que isso importa');
  lines.push('');
  whyItMatters.forEach(item => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## Links das fontes');
  lines.push('');
  sourceLinks.forEach(source => lines.push(`- [${source.source} - ${source.title}](${source.url})`));
  lines.push('');
  return lines.join('\n');
}
