import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = process.cwd();
export const DATA_DIR = join(ROOT, 'data');
export const BRIEFINGS_DIR = join(DATA_DIR, 'briefings');
export const SOURCES_PATH = join(ROOT, 'sources.json');
export const ENV_PATH = join(ROOT, '.env');
export const PORT = Number(process.env.PORT || 4173);
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
export const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'America/Sao_Paulo';

// Limite de itens coletados do RSS por seção (antes de enviar para IA).
// Alimenta a IA com variedade; ela escolhe os 4 melhores por seção.
// Ajustado para entregar mais notícias ao usuário.
export const SECTION_LIMITS = {
  brasil: 6,
  mundo: 6,
  economia: 5,
  tech: 5
};

// Limite de itens que a IA/fallback deve ENTREGAR por seção no briefing final.
export const BRIEFING_ITEMS_PER_SECTION = 4;

// Limite de caracteres por PARTE da mensagem WhatsApp (CallMeBot GET URL constraint).
// Mensagens maiores são divididas automaticamente em múltiplas partes.
export const WHATSAPP_MAX_LENGTH = 1800;

export async function loadEnv() {
  if (!existsSync(ENV_PATH)) return;
  const content = await readFile(ENV_PATH, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export async function saveEnv(key, value) {
  let lines = [];
  if (existsSync(ENV_PATH)) {
    const content = await readFile(ENV_PATH, 'utf8');
    lines = content.split('\n').filter(line => {
      const trimmed = line.replace(/\r$/, '').trim();
      return !trimmed.startsWith(`${key}=`);
    });
  }
  lines.push(`${key}=${value}`);
  await writeFile(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};
