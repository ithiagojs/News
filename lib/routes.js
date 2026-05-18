import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { ROOT, MIME, GROQ_MODEL, OPENAI_MODEL } from './config.js';
import { send, readJson, todayISO } from './utils.js';
import { readSources, writeSources, listBriefings, loadBriefing, briefingMarkdownPath, generateBriefing } from './briefing.js';

// ─── API Routes ────────────────────────────────────────────────────

export async function routeApi(req, res, pathname) {
  // Health check
  if (req.method === 'GET' && pathname === '/api/health') {
    const provider = process.env.GROQ_API_KEY ? 'groq' : process.env.OPENAI_API_KEY ? 'openai' : 'rss';
    const model = provider === 'groq' ? GROQ_MODEL : provider === 'openai' ? OPENAI_MODEL : null;
    return send(res, 200, { ok: true, provider, model });
  }

  // Sources CRUD
  if (req.method === 'GET' && pathname === '/api/sources') {
    return send(res, 200, await readSources());
  }

  if (req.method === 'POST' && pathname === '/api/sources') {
    const body = await readJson(req);
    if (!body?.categories?.length) return send(res, 400, { error: 'sources.categories vazio ou invalido' });
    await writeSources(body);
    return send(res, 200, body);
  }

  // Briefings list
  if (req.method === 'GET' && pathname === '/api/briefings') {
    return send(res, 200, { dates: await listBriefings() });
  }

  // Generate briefing
  if (req.method === 'POST' && pathname === '/api/briefings') {
    const body = await readJson(req);
    const briefing = await generateBriefing(body.date || todayISO(), Boolean(body.force));
    return send(res, 200, briefing);
  }

  // Get specific briefing by date
  const briefingMatch = pathname.match(/^\/api\/briefings\/(\d{4}-\d{2}-\d{2})(\.md)?$/);
  if (req.method === 'GET' && briefingMatch) {
    const [, date, md] = briefingMatch;
    if (md) {
      const path = briefingMarkdownPath(date);
      if (!existsSync(path)) return send(res, 404, { error: 'Briefing nao encontrado' });
      return send(res, 200, await readFile(path, 'utf8'), 'text/markdown; charset=utf-8');
    }
    const briefing = await loadBriefing(date);
    if (!briefing) return send(res, 404, { error: 'Briefing nao encontrado' });
    return send(res, 200, briefing);
  }

  return send(res, 404, { error: 'Rota nao encontrada' });
}

// ─── Static File Server ────────────────────────────────────────────

export async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);

  // Bloqueia path traversal (../ e acesso a .env, .git, etc.)
  if (relative.includes('..') || relative.startsWith('.')) {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }

  const filePath = resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  if (!existsSync(filePath)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');

  const type = MIME[extname(filePath)] || 'application/octet-stream';
  send(res, 200, await readFile(filePath), type);
}
