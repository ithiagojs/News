import { SECTION_LIMITS } from './config.js';
import { stripHtml, decodeEntities } from './utils.js';

// ─── XML Parsing Helpers ───────────────────────────────────────────

function tagValue(block, tag) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i');
  const match = block.match(pattern);
  return match ? stripHtml(match[1]) : '';
}

function atomLink(block) {
  const alternate = block.match(/<link\b(?=[^>]*rel=["']alternate["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i);
  if (alternate) return decodeEntities(alternate[1]);
  const href = block.match(/<link\b(?=[^>]*href=["']([^"']+)["'])[^>]*>/i);
  if (href) return decodeEntities(href[1]);
  return tagValue(block, 'link');
}

// ─── Content Filter ────────────────────────────────────────────────

/** Normaliza texto para comparação: remove acentos e lowercase */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Palavras-chave de esportes e entretenimento irrelevantes */
const NOISE_KEYWORDS = [
  'onde assistir', 'escalacao', 'jogo de hoje', 'transmissao',
  'libertadores', 'brasileirao', 'copa do brasil', 'champions league',
  'futebol', 'partida ao vivo', 'placar', 'tabela de classificacao',
  'treino do', 'desfalque', 'rodada do', 'arbitragem', 'gols de', 'gol de',
  'serie a', 'serie b', 'copa america', 'copa do mundo'
];

/** Palavras-chave extras de ruído para seções não-entretenimento */
const ECONOMY_NOISE = ['novela', 'capitulo', 'horoscopo', 'receita de', 'reality show'];

function isOffTopic(title, categoryId) {
  const lower = normalize(title);

  if (NOISE_KEYWORDS.some(kw => lower.includes(kw))) return true;

  if (categoryId === 'economia' || categoryId === 'tech') {
    if (ECONOMY_NOISE.some(kw => lower.includes(kw))) return true;
  }

  return false;
}

// ─── Feed Parsing ──────────────────────────────────────────────────

function parseFeed(xmlText, feed, category) {
  const items = [];
  const rssItems = [...xmlText.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => m[0]);
  const atomEntries = [...xmlText.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(m => m[0]);
  const blocks = rssItems.length ? rssItems : atomEntries;

  for (const block of blocks) {
    const isAtom = block.toLowerCase().startsWith('<entry');
    const title = tagValue(block, 'title');
    if (!title) continue;

    // Rejeita ruído antes de criar o objeto (economia de memória e tokens)
    if (isOffTopic(title, category.id)) continue;

    const description = tagValue(block, 'description') || tagValue(block, 'summary') || tagValue(block, 'content');
    const link = isAtom ? atomLink(block) : tagValue(block, 'link') || atomLink(block);
    const publishedAt = tagValue(block, 'pubDate') || tagValue(block, 'published') || tagValue(block, 'updated');

    items.push({
      title,
      description: description.slice(0, 320),
      link,
      publishedAt,
      source: feed.name,
      sourceUrl: feed.url,
      categoryId: category.id,
      categoryName: category.name
    });
  }

  return items;
}

// ─── Feed Fetching ─────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 4000;

async function fetchFeed(feed, category) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'DailyBriefing/1.0 (+https://github.com/ithiagojs/News)',
        'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim() || 'utf-8';
    const buffer = await response.arrayBuffer();
    const xml = new TextDecoder(charset).decode(buffer);
    return parseFeed(xml, feed, category).slice(0, feed.maxItems || 5);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Ranking & Deduplication ───────────────────────────────────────

function normalizeTitle(title) {
  return normalize(title)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemScore(item) {
  const published = Date.parse(item.publishedAt || '');
  const recencyScore = Number.isFinite(published) ? published / 100000000 : 0;
  const descriptionScore = item.description ? 10 : 0;
  return recencyScore + descriptionScore;
}

function selectItems(items, limit) {
  const seen = new Set();
  return items
    .sort((a, b) => itemScore(b) - itemScore(a))
    .filter(item => {
      const key = normalizeTitle(item.title).slice(0, 90);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

// ─── Public API ────────────────────────────────────────────────────

export async function collectNews(sources) {
  const errors = [];

  // Todas as categorias e seus feeds são buscados em paralelo
  const categoryPromises = sources.categories.map(async (category) => {
    const results = await Promise.allSettled(
      category.feeds.map(feed => fetchFeed(feed, category))
    );
    const items = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        items.push(...result.value);
      } else {
        errors.push({
          source: category.feeds[index]?.name || 'Fonte desconhecida',
          message: result.reason?.message || 'Falha ao buscar feed'
        });
      }
    });

    return {
      id: category.id,
      name: category.name,
      items: selectItems(items, SECTION_LIMITS[category.id] || 4)
    };
  });

  const sections = await Promise.all(categoryPromises);
  return { sections, errors };
}
