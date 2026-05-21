import { OPENAI_MODEL, GROQ_MODEL, GEMINI_MODEL, BRIEFING_ITEMS_PER_SECTION } from './config.js';

// ─── JSON Schema for Structured Output ─────────────────────────────

function briefingSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'sections', 'whyItMatters'],
    properties: {
      headline: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' }
        }
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'items'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'context', 'source', 'link'],
                properties: {
                  title: { type: 'string' },
                  context: { type: 'string' },
                  source: { type: 'string' },
                  link: { type: 'string' }
                }
              }
            }
          }
        }
      },
      whyItMatters: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'string' }
      }
    }
  };
}

// ─── JSON Extraction ───────────────────────────────────────────────

function extractJsonObject(text = '') {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('Resposta da IA nao contem JSON valido');
}

// ─── Response Normalization ────────────────────────────────────────

function findBriefingRoot(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  if (value.headline || value.manchete || value.manchete_do_dia || value.mancheteDoDia) return value;

  const known = value.briefing
    || value.daily_briefing
    || value.dailyBriefing
    || value.resumo
    || value.briefing_diario
    || value.briefingDiario
    || value.daily;
  const knownRoot = findBriefingRoot(known, depth + 1);
  if (knownRoot) return knownRoot;

  for (const child of Object.values(value)) {
    const root = findBriefingRoot(child, depth + 1);
    if (root) return root;
  }
  return value;
}

function normalizeAIBriefing(generated) {
  const root = findBriefingRoot(generated);

  const headline = root?.headline || root?.manchete || root?.manchete_do_dia || root?.mancheteDoDia;
  const headlineTitle = headline?.title || headline?.titulo || headline?.manchete;
  const headlineSummary = headline?.summary || headline?.resumo || headline?.contexto || headline?.descricao;
  const sections = root?.sections || root?.secoes || root?.categorias;
  const whyItMatters = root?.whyItMatters
    || root?.why_it_matters
    || root?.porQueIssoImporta
    || root?.porQueImporta
    || root?.por_que_isso_importa
    || root?.por_que_importa
    || root?.porque_importa
    || root?.importancia
    || root?.importância;

  if (!headlineTitle || !headlineSummary) {
    throw new Error('Resposta da IA sem headline.title/headline.summary');
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('Resposta da IA sem secoes');
  }

  const normalizedSections = sections.map(section => {
    const rawItems = section.items || section.topicos || section.noticias || [];
    const items = (Array.isArray(rawItems) ? rawItems : [])
      .map(item => ({
        title: cleanPortugueseText(item.title || item.titulo || ''),
        context: cleanPortugueseText(item.context || item.contexto || item.description || item.descricao || item.resumo || ''),
        source: String(item.source || item.fonte || ''),
        link: String(item.link || item.url || item.fonte_url || '')
      }))
      .filter(item => item.title && item.context)
      .slice(0, BRIEFING_ITEMS_PER_SECTION);

    return {
      id: String(section.id || ''),
      name: String(section.name || section.nome || section.id || 'Secao'),
      items
    };
  });

  return {
    headline: {
      title: cleanPortugueseText(headlineTitle),
      summary: cleanPortugueseText(headlineSummary)
    },
    sections: normalizedSections,
    whyItMatters: normalizeWhyItMatters(whyItMatters, normalizedSections)
  };
}

// ─── "Why It Matters" Quality Control ──────────────────────────────

function normalizeWhyItMatters(whyItMatters, sections) {
  const items = Array.isArray(whyItMatters)
    ? whyItMatters.map(item => String(item).trim()).filter(Boolean)
    : [];

  if (items.length >= 3 && !items.some(isGenericWhyBullet)) {
    return items.slice(0, 3);
  }

  return buildSpecificWhyItMatters(sections);
}

const GENERIC_PATTERNS = [
  'acompanhe as noticias',
  'estar informado',
  'principais eventos',
  'podem afetar sua vida',
  'sua comunidade',
  'mantenha-se atualizado',
  'ultimas noticias',
  'tendencias para tomar decisoes',
  'tomar decisoes informadas',
  'separar sinais relevantes',
  'ruido diario',
  'merecem acompanhamento mais profundo'
];

function isGenericWhyBullet(text) {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return text.length < 45 || GENERIC_PATTERNS.some(p => normalized.includes(p));
}

export function buildSpecificWhyItMatters(sections = []) {
  const byId = Object.fromEntries((sections || []).map(s => [s.id, s]));
  const brasil = byId.brasil?.items?.[0];
  const mundo = byId.mundo?.items?.[0];
  const economia = byId.economia?.items?.[0];
  const tech = byId.tech?.items?.[0];

  const bullets = [];

  if (brasil && mundo) {
    bullets.push(`O dia cruza agenda interna e geopolítica: "${shortTitle(brasil.title)}" divide atenção com "${shortTitle(mundo.title)}", então vale separar impacto local de ruído internacional.`);
  } else if (brasil) {
    bullets.push(`No Brasil, "${shortTitle(brasil.title)}" merece atenção porque pode ter efeitos práticos em serviços públicos, segurança ou debate político local.`);
  } else if (mundo) {
    bullets.push(`No exterior, "${shortTitle(mundo.title)}" pode influenciar diplomacia, segurança e mercados, especialmente se houver reação de governos ou investidores.`);
  }

  if (economia) {
    bullets.push(`Em economia, "${shortTitle(economia.title)}" é o item para monitorar porque pode afetar expectativas de empresas, regulação, preços ou decisões de investimento.`);
  }

  if (tech) {
    bullets.push(`Em tecnologia, "${shortTitle(tech.title)}" sinaliza risco ou oportunidade operacional: segurança digital, IA e plataformas podem exigir atualização rápida.`);
  }

  const allItems = sections.flatMap(s => s.items || []);
  while (bullets.length < 3 && allItems[bullets.length]) {
    const item = allItems[bullets.length];
    bullets.push(`Acompanhe os desdobramentos de "${shortTitle(item.title)}" e abra a fonte se o tema afetar suas decisões hoje.`);
  }

  while (bullets.length < 3) {
    bullets.push('O briefing de hoje tem pouca profundidade nas fontes; use os links originais para validar prioridade antes de tomar decisão.');
  }

  return bullets.slice(0, 3).map(cleanPortugueseText);
}

function shortTitle(title = '') {
  const clean = String(title).replace(/\s+/g, ' ').trim();
  if (clean.length <= 80) return clean;
  return `${clean.slice(0, 77).trim()}...`;
}

// ─── Portuguese Text Cleanup ───────────────────────────────────────

const TRANSLATION_MAP = [
  [/\bceasefire\b/gi, 'cessar-fogo'],
  [/\bbackdoor\b/gi, 'acesso oculto'],
  [/\bpatchar\b/gi, 'corrigir'],
  [/\bpatch\b/gi, 'correção'],
  [/\bmassive life support\b/gi, 'suporte crítico'],
  [/\bsuporte de vida m[aá]ssic[oa]\b/gi, 'suporte crítico'],
  [/\bsuporte de vida massivo\b/gi, 'suporte crítico'],
  [/\bstakeholders?\b/gi, 'partes interessadas'],
  [/\bbriefing\b/gi, 'resumo'],
  [/\bdeadline\b/gi, 'prazo']
];

function cleanPortugueseText(value = '') {
  let text = String(value);
  for (const [pattern, replacement] of TRANSLATION_MAP) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, ' ').trim();
}

// ─── Shared Prompt Rules ───────────────────────────────────────────

const SHARED_RULES = [
  // ── IDIOMA ──────────────────────────────────────────────────────────
  'REGRA ABSOLUTA DE IDIOMA: TODO o conteúdo de texto (headline.title, headline.summary, items[].title, items[].context, whyItMatters[]) DEVE ser escrito 100% em Português do Brasil. É TERMINANTEMENTE PROIBIDO deixar qualquer frase, título ou contexto em inglês.',
  'TRADUÇÃO OBRIGATÓRIA: Se a notícia original estiver em inglês, TRADUZA o título e o contexto para Português do Brasil. Exemplo: "Child survivor of mosque shooting describes ordeal" → "Criança sobrevivente de tiroteio em mesquita descreve o que viveu". Nenhuma exceção.',
  'Preserve nomes próprios, siglas (FBI, WHO, DRC), marcas, veículos de imprensa e locais quando a tradução literal piorar a clareza. Mas a FRASE deve estar em português.',

  // ── MANCHETE ────────────────────────────────────────────────────────
  'MANCHETE EDITORIAL: A headline.title deve ser uma frase editorial específica que capture o fato mais relevante do dia. PROIBIDO usar títulos genéricos como "Notícias do Dia", "Resumo do Dia", "Destaques" ou qualquer variação vaga. Exemplo bom: "Justiça obriga frota integral em Teresina enquanto Ebola avança na RDC". Exemplo ruim: "Notícias do Dia".',
  'A headline.summary deve ter 2 a 3 frases contextualizando por que a manchete importa, com tom analítico.',

  // ── CONTEÚDO ────────────────────────────────────────────────────────
  'Use apenas os itens fornecidos, sem inventar fatos.',
  `Devolva EXATAMENTE ${BRIEFING_ITEMS_PER_SECTION} tópicos para CADA seção (Brasil, Mundo, Economia, Tecnologia). Nem mais, nem menos. Se houver menos itens disponíveis, use todos os disponíveis.`,
  'REGRA DE CONTEXTO: Cada campo "context" DEVE ser uma frase factual e analítica de 1 a 2 linhas (entre 80 e 180 caracteres). É PROIBIDO: (a) copiar ou parafrasear o título; (b) usar frases vagas como "é um tema importante", "vale acompanhar", "é um assunto relevante"; (c) deixar o campo vazio ou genérico. O contexto deve explicar o impacto ou detalhe mais relevante da notícia.',
  'whyItMatters deve ter exatamente 3 bullets práticos, específicos e ancorados nos fatos do dia. PROIBIDO bullets genéricos como "mantenha-se informado", "é importante acompanhar" ou qualquer variação. Cada bullet deve citar um fato ou implicação concreta do briefing.',

  // ── LINKS ───────────────────────────────────────────────────────────
  'LINKS: O campo "link" de cada item DEVE conter a URL HTTP original do artigo (começando com http:// ou https://). NUNCA substitua a URL por texto descritivo. Copie a URL exatamente como fornecida nos dados de entrada.',
  'Preserve "source" (nome do veículo) de cada item.'
];

const SYSTEM_PROMPT = 'Você é um editor-chefe sênior de um briefing jornalístico premium no Brasil. REGRAS INVIOLÁVEIS: (1) IDIOMA: 100% Português do Brasil, PROIBIDO deixar texto em inglês; (2) MANCHETE: deve ser uma frase editorial específica, NUNCA genérica; (3) LINKS: preserve as URLs HTTP originais no campo link. Retorne somente JSON válido, sem markdown.';

// ─── English Detection & Pre-processing ───────────────────────────

const ENGLISH_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'for', 'and', 'but', 'not',
  'with', 'from', 'that', 'this', 'into', 'after', 'before', 'says',
  'said', 'about', 'over', 'than', 'more', 'been', 'being', 'its',
  'warns', 'amid', 'faces', 'here', 'there', 'their', 'they', 'what',
  'who', 'how', 'why', 'when', 'where', 'which', 'outbreak', 'crackdown',
  'deadly', 'dangerous', 'spreading', 'survivor', 'describes'
]);

/** Detecta se um texto parece estar em inglês (heurística rápida) */
function looksEnglish(text) {
  if (!text || text.length < 10) return false;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  if (words.length < 3) return false;
  const englishCount = words.filter(w => ENGLISH_WORDS.has(w)).length;
  return (englishCount / words.length) > 0.3;
}

/** Fontes sabidamente em inglês */
const FOREIGN_SOURCES = ['bbc world', 'al jazeera', 'the guardian', 'the verge', 'ars technica', 'mit tech review'];

/**
 * Pré-processa os dados coletados antes de enviar para a IA.
 * - Marca itens estrangeiros com instrução de tradução
 * - Remove campos desnecessários para reduzir tokens
 * - Trunca descrições longas
 */
function prepareForAI(sections) {
  return sections.map(section => ({
    id: section.id,
    name: section.name,
    items: section.items.map(item => {
      const slim = {
        title: item.title,
        description: (item.description || '').slice(0, 150),
        link: item.link,
        source: item.source
      };
      const isForeign = FOREIGN_SOURCES.some(s => (item.source || '').toLowerCase().includes(s));
      if (isForeign || looksEnglish(item.title)) {
        slim._TRADUZIR = 'SIM - traduzir título e contexto para PT-BR';
      }
      return slim;
    })
  }));
}

// ─── Source Links Collector ────────────────────────────────────────

function collectSourceLinks(sections) {
  const sourceLinks = [];
  const seen = new Set();
  for (const section of sections) {
    for (const item of section.items) {
      if (!item.link || seen.has(item.link)) continue;
      seen.add(item.link);
      sourceLinks.push({ source: item.source, title: item.title, url: item.link });
    }
  }
  return sourceLinks;
}

function buildAIBriefing(date, generated, collected, mode) {
  // Repara links que a IA substituiu por texto descritivo
  const collectedItems = collected.sections.flatMap(s => s.items || []);
  for (const section of generated.sections) {
    for (const item of section.items) {
      // Se o link não começa com http, tenta encontrar o original nos dados coletados
      if (item.link && !item.link.startsWith('http')) {
        const match = collectedItems.find(ci =>
          ci.title && item.title &&
          ci.title.toLowerCase().includes(item.title.toLowerCase().slice(0, 30))
        ) || collectedItems.find(ci =>
          ci.link && ci.source === item.source
        );
        if (match?.link) {
          console.log(`Link reparado: "${item.link}" → "${match.link}"`);
          item.link = match.link;
        }
      }
    }
  }

  // Detecta e loga itens que permaneceram em inglês após processamento da IA
  for (const section of generated.sections) {
    for (const item of section.items) {
      if (looksEnglish(item.title)) {
        console.warn(`⚠️ Título em inglês detectado na seção "${section.id}": "${item.title}"`);
        // Tenta encontrar o item correspondente nos dados coletados e usar a descrição em PT se disponível
        const original = collectedItems.find(ci =>
          ci.title === item.title || (ci.link && ci.link === item.link)
        );
        if (original?.description && !looksEnglish(original.description)) {
          // Usa a descrição como contexto se estiver em português
          item.context = cleanPortugueseText(original.description.slice(0, 140));
        }
      }
    }
  }

  // Detecta manchete genérica e tenta criar uma melhor a partir dos dados
  const genericPatterns = ['notícias do dia', 'resumo do dia', 'destaques', 'manchetes do dia', 'principais notícias'];
  const titleLower = (generated.headline.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const headlineIsGeneric = genericPatterns.some(p => titleLower.includes(p)) || titleLower.length < 15;
  const headlineIsEnglish = looksEnglish(generated.headline.title);
  
  if (headlineIsGeneric || headlineIsEnglish) {
    const topItems = generated.sections.flatMap(s => s.items).slice(0, 2);
    if (topItems.length >= 2) {
      generated.headline.title = `${topItems[0].title} e ${topItems[1].title}`;
      console.log('Manchete substituída:', generated.headline.title);
    }
  }

  return {
    date,
    generatedAt: new Date().toISOString(),
    mode,
    headline: generated.headline,
    sections: generated.sections,
    whyItMatters: normalizeWhyItMatters(generated.whyItMatters, generated.sections),
    sourceLinks: collectSourceLinks(collected.sections),
    errors: collected.errors
  };
}

// ─── OpenAI Provider ───────────────────────────────────────────────

export async function enrichWithOpenAI(date, collected) {
  if (!process.env.OPENAI_API_KEY) return null;
  console.log(`Gerando briefing com OpenAI (${OPENAI_MODEL}) para ${date}`);

  const prompt = {
    date,
    instruction: SHARED_RULES,
    sections: prepareForAI(collected.sections)
  };

  if (collected.preferences) {
    prompt.userPreferences = `Siga ESTRITAMENTE as seguintes preferências pessoais do usuário ao filtrar assuntos e redigir a resposta: ${collected.preferences}`;
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: SYSTEM_PROMPT }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(prompt) }]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'daily_briefing',
          strict: true,
          schema: briefingSchema()
        }
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${message.slice(0, 300)}`);
  }

  const payload = await response.json();
  const outputText = payload.output_text
    || payload.output?.flatMap(item => item.content || [])
      .find(c => c.type === 'output_text')?.text;
  if (!outputText) throw new Error('Resposta da OpenAI sem output_text');

  // OpenAI com json_schema retorna JSON limpo, mas normalizamos por segurança
  const generated = normalizeAIBriefing(JSON.parse(outputText));
  console.log(`Briefing gerado com OpenAI para ${date}`);
  return buildAIBriefing(date, generated, collected, 'ai');
}

// ─── Groq Provider ─────────────────────────────────────────────────

export async function enrichWithGroq(date, collected) {
  if (!process.env.GROQ_API_KEY) return null;
  console.log(`Gerando briefing com Groq (${GROQ_MODEL}) para ${date}`);

  const prompt = {
    date,
    outputContract: {
      note: 'Use exatamente estes nomes de campos em ingles no JSON final.',
      headline: { title: 'string', summary: 'string' },
      sections: [
        {
          id: 'brasil|mundo|economia|tech',
          name: 'string',
          items: [{ title: 'string', context: 'string', source: 'string', link: 'string' }]
        }
      ],
      whyItMatters: ['3 bullets praticos']
    },
    rules: [
      ...SHARED_RULES,
      'Responda somente com JSON valido, sem markdown.',
      'Nao traduza os nomes das chaves JSON: use exatamente headline, title, summary, sections, id, name, items, context, source, link, whyItMatters.'
    ],
    sections: prepareForAI(collected.sections)
  };

  if (collected.preferences) {
    prompt.userPreferences = `Siga ESTRITAMENTE as seguintes preferências pessoais do usuário ao filtrar assuntos e redigir a resposta: ${collected.preferences}`;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(prompt) }
      ]
    })
  });

  if (!response.ok) {
    const message = await response.text();
    try {
      const errorPayload = JSON.parse(message);
      const failedGeneration = errorPayload?.error?.failed_generation;
      if (failedGeneration) {
        const generated = normalizeAIBriefing(extractJsonObject(failedGeneration));
        return buildAIBriefing(date, generated, collected, 'groq');
      }
    } catch {
      // Fall through to the explicit error below.
    }
    throw new Error(`Groq HTTP ${response.status}: ${message.slice(0, 500)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('Resposta da Groq sem conteudo');

  const parsed = extractJsonObject(content);
  const generated = normalizeAIBriefing(parsed);
  console.log(`Briefing gerado com Groq para ${date}`);
  return buildAIBriefing(date, generated, collected, 'groq');
}

// ─── Gemini Provider ───────────────────────────────────────────────

export async function enrichWithGemini(date, collected) {
  if (!process.env.GEMINI_API_KEY) return null;
  console.log(`Gerando briefing com Gemini (${GEMINI_MODEL}) para ${date}`);

  const prompt = {
    date,
    instruction: SHARED_RULES,
    sections: prepareForAI(collected.sections)
  };

  if (collected.preferences) {
    prompt.userPreferences = `Siga ESTRITAMENTE as seguintes preferências pessoais do usuário ao filtrar assuntos e redigir a resposta: ${collected.preferences}`;
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [{
        role: 'user',
        parts: [{ text: JSON.stringify(prompt) }]
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${message.slice(0, 300)}`);
  }

  const payload = await response.json();
  const content = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Resposta do Gemini sem conteudo válido');

  const generated = normalizeAIBriefing(extractJsonObject(content));
  console.log(`Briefing gerado com Gemini para ${date}`);
  return buildAIBriefing(date, generated, collected, 'gemini');
}
