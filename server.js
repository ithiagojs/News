import { createServer } from 'node:http';
import { loadEnv, PORT, GROQ_MODEL, OPENAI_MODEL } from './lib/config.js';
import { send } from './lib/utils.js';
import { routeApi, serveStatic } from './lib/routes.js';

await loadEnv();

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url.pathname);
    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message || 'Erro interno' });
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} ja em uso. Feche o outro processo ou use PORT=outra porta.`);
  } else {
    console.error('Erro no servidor:', error.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Daily Briefing local em http://localhost:${PORT}`);
  if (process.env.GROQ_API_KEY) {
    console.log(`Modo IA: ativo via Groq (${GROQ_MODEL})`);
  } else if (process.env.GEMINI_API_KEY) {
    console.log(`Modo IA: ativo via Gemini (${process.env.GEMINI_MODEL || 'gemini-1.5-flash'})`);
  } else if (process.env.OPENAI_API_KEY) {
    console.log(`Modo IA: ativo via OpenAI (${OPENAI_MODEL})`);
  } else {
    console.log('Modo IA: inativo; usando fallback RSS');
  }
});

function shutdown() {
  console.log('\nEncerrando servidor...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
