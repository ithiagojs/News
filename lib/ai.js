import { OPENAI_MODEL, GROQ_MODEL } from './config.js';

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
  const normalizedSections = sections.map(section => ({
    id: String(section.id || ''),
    name: String(section.name || section.nome || section.id || 'Secao'),
    items: Array.isArray(section.items || section.topicos || section.noticias)
      ? (section.items || section.topicos || section.noticias).map(item => ({
      title: cleanPortugueseText(item.title || item.titulo || ''),
      context: cleanPortugueseText(item.context || item.contexto || item.description || item.descricao || item.resumo || ''),
      source: String(item.source || item.fonte || ''),
      link: String(item.link || item.url || item.fonte_url || '')
    })).filter(item => item.title && item.context) : []
  }));

  return {
    headline: {
      title: cleanPortugueseText(headlineTitle),
      summary: cleanPortugueseText(headlineSummary)
    },
    sections: normalizedSections,
    whyItMatters: normalizeWhyItMatters(whyItMatters, normalizedSections)
  };
}

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

function normalizeWhyItMatters(whyItMatters, sections) {
  const items = Array.isArray(whyItMatters)
    ? whyItMatters.map(item => String(item).trim()).filter(Boolean)
    : [];

  if (items.length >= 3 && !items.some(isGenericWhyBullet)) {
    return items.slice(0, 3);
  }

  return buildSpecificWhyItMatters(sections);
}

function isGenericWhyBullet(text) {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const genericPatterns = [
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

  return text.length < 45 || genericPatterns.some(pattern => normalized.includes(pattern));
}

export function buildSpecificWhyItMatters(sections = []) {
  const byId = Object.fromEntries((sections || []).map(section => [section.id, section]));
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
    bullets.push(`Em tecnologia, "${shortTitle(tech.title)}" sinaliza risco ou oportunidade operacional: segurança digital, IA e plataformas podem exigir atualização rápida de ferramentas e políticas.`);
  }

  const allItems = sections.flatMap(section => section.items || []);
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
  if (clean.length <= 90) return clean;
  return `${clean.slice(0, 87).trim()}...`;
}

function cleanPortugueseText(value = '') {
  return String(value)
    .replace(/\b[Cc]easefire\b/g, 'cessar-fogo')
    .replace(/\b[Bb]ackdoor\b/g, 'acesso oculto')
    .replace(/\b[Pp]atchar\b/g, 'corrigir')
    .replace(/\b[Pp]atch\b/g, 'correção')
    .replace(/\b[Mm]assive life support\b/g, 'suporte crítico')
    .replace(/\b[Ss]uporte de [Vv]ida [Mm][áa]ssico\b/g, 'suporte crítico')
    .replace(/\b[Ss]uporte de [Vv]ida [Mm]assivo\b/g, 'suporte crítico')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function enrichWithOpenAI(date, collected) {
  if (!process.env.OPENAI_API_KEY) return null;

  const prompt = {
    date,
    instruction: [
      'MANDATÓRIO: TODO o conteúdo de texto gerado (title, summary, context, whyItMatters) DEVE ser traduzido e escrito em Português do Brasil.',
      'É terminantemente proibido manter títulos ou resumos em inglês. TRADUZA TUDO.',
      'Monte um briefing diario em portugues do Brasil.',
      'Use apenas os itens fornecidos, sem inventar fatos.',
      'Escolha uma manchete do dia em 2 a 5 linhas.',
      'Brasil e Mundo devem ter 3 a 5 topicos cada quando houver material.',
      'Economia/mercados deve ter ate 3 topicos.',
      'Tecnologia/ciencia/cultura deve ter ate 4 topicos.',
      'Cada contexto deve ser curto, util e editorial, nao uma copia do titulo.',
      'Traduza para portugues do Brasil todos os titulos e contextos de fontes em ingles ou outros idiomas.',
      'Preserve nomes proprios, siglas, marcas, veiculos, cargos e locais quando a traducao literal piorar a clareza.',
      'Nao deixe campos title/context em ingles, exceto nomes proprios e termos tecnicos sem equivalente natural.',
      'Por que isso importa deve ter 3 bullets praticos.'
    ],
    sections: collected.sections
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
          content: [
            {
              type: 'input_text',
              text: 'Você é um editor sênior de briefing jornalístico no Brasil. O IDIOMA DE SAÍDA DEVE SER ESTRITAMENTE PORTUGUÊS DO BRASIL. É TERMINANTEMENTE PROIBIDO DEIXAR TEXTO EM INGLÊS. Seja conciso, rigoroso e útil. Preserve links e fontes.'
            }
          ]
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
      .find(content => content.type === 'output_text')?.text;
  if (!outputText) throw new Error('Resposta da OpenAI sem output_text');

  const generated = JSON.parse(outputText);

  return {
    date,
    generatedAt: new Date().toISOString(),
    mode: 'ai',
    headline: generated.headline,
    sections: generated.sections,
    whyItMatters: generated.whyItMatters,
    sourceLinks: collectSourceLinks(collected.sections),
    errors: collected.errors
  };
}

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
      'MANDATÓRIO: TODO o conteúdo de texto (title, summary, context, whyItMatters) DEVE ser traduzido e escrito em Português do Brasil. NUNCA DEIXE EM INGLÊS.',
      'Responda somente com JSON valido, sem markdown.',
      'Nao traduza os nomes das chaves JSON: use exatamente headline, title, summary, sections, id, name, items, context, source, link, whyItMatters.',
      'Use portugues do Brasil.',
      'Traduza para portugues do Brasil todos os titulos e contextos de fontes estrangeiras.',
      'O campo title deve ser uma manchete natural em portugues do Brasil, nao uma copia do titulo original em ingles.',
      'O campo context deve explicar a noticia em portugues do Brasil.',
      'Preserve nomes proprios, siglas, marcas, veiculos, cargos, locais e links originais.',
      'Use apenas os itens fornecidos, sem inventar fatos.',
      'A manchete do dia deve ter titulo e resumo de 2 a 5 linhas.',
      'Devolva no MÁXIMO 3 tópicos para CADA seção (Brasil, Mundo, Economia, Tecnologia).',
      'É estritamente proibido passar de 3 notícias por seção. Seja cirúrgico na escolha.',
      'A manchete do dia deve ter titulo e resumo de 2 a 5 linhas.',
      'Cada contexto deve ser curto, claro e editorial.',
      'Preserve fonte e link de cada item.'
    ],
    sections: collected.sections
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
        {
          role: 'system',
          content: 'Você é um editor sênior de briefing jornalístico no Brasil. O IDIOMA DE SAÍDA DEVE SER ESTRITAMENTE PORTUGUÊS DO BRASIL. É TERMINANTEMENTE PROIBIDO DEIXAR TEXTO EM INGLÊS. Seja conciso, rigoroso e útil. Retorne somente JSON válido.'
        },
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

function collectSourceLinks(sections) {
  const sourceLinks = [];
  const seenLinks = new Set();
  sections.forEach(section => {
    section.items.forEach(item => {
      if (!item.link || seenLinks.has(item.link)) return;
      seenLinks.add(item.link);
      sourceLinks.push({ source: item.source, title: item.title, url: item.link });
    });
  });
  return sourceLinks;
}

function buildAIBriefing(date, generated, collected, mode) {
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
