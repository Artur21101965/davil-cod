// lib/modelscan.js — многоисточниковый сканер бесплатных моделей для Freegate.
// Каждый источник — адаптер, отдающий нормализованных кандидатов:
// { model, source, endpoint, contextWindow, dailyLimit, category }.
// Вся сеть через injectable fetchImpl — юнит-тесты ходят в моки, не в сеть.

// Источники для автопоиска. Исключены mistral/deepseek: их каталог включает
// платные модели, и авто-тест может «пройти» на платной модели, после чего
// она попадает в роутинг и жжёт деньги/ломается. Надёжно-бесплатные: openrouter
// (только :free), groq, cerebras, gemini (free tier), nim (малый лимит, но
// стабильно бесплатный), huggingface. Каталог расширяется вручную через
// config.json/providers.json.
const SOURCES = ['openrouter', 'huggingface', 'groq', 'gemini', 'cerebras', 'nim'];

// Endpoints списков моделей и chat-completions по источникам.
const SOURCE_META = {
  openrouter: { list: 'https://openrouter.ai/api/v1/models', chat: 'https://openrouter.ai/api/v1/chat/completions', envVar: 'PROVIDER_OPENROUTER_APIKEY', dailyLimit: 50 },
  huggingface: { list: 'https://router.huggingface.co/v1/models', chat: 'https://router.huggingface.co/v1/chat/completions', envVar: 'PROVIDER_HF_APIKEY', dailyLimit: 200 },
  groq: { list: 'https://api.groq.com/openai/v1/models', chat: 'https://api.groq.com/openai/v1/chat/completions', envVar: 'PROVIDER_GROQ_APIKEY', dailyLimit: 1000 },
  mistral: { list: 'https://api.mistral.ai/v1/models', chat: 'https://api.mistral.ai/v1/chat/completions', envVar: 'PROVIDER_MISTRAL_APIKEY', dailyLimit: 500 },
  gemini: { list: 'https://generativelanguage.googleapis.com/v1beta/openai/models', chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', envVar: 'PROVIDER_GEMINI_APIKEY', dailyLimit: 1500 },
  cerebras: { list: 'https://api.cerebras.ai/v1/models', chat: 'https://api.cerebras.ai/v1/chat/completions', envVar: 'PROVIDER_CEREBRAS_APIKEY', dailyLimit: 1000 },
  deepseek: { list: 'https://api.deepseek.com/models', chat: 'https://api.deepseek.com/chat/completions', envVar: 'PROVIDER_DEEPSEEK_APIKEY', dailyLimit: 1000 },
  nim: { list: 'https://integrate.api.nvidia.com/v1/models', chat: 'https://integrate.api.nvidia.com/v1/chat/completions', envVar: 'PROVIDER_NIM_APIKEY', dailyLimit: 40 },
};

// Мусор: эмбеддинги, реранки, аудио/речь/музыка, guardrail, картинки/видео,
// робототехника, computer-use, калибровки. Всё, что не plain-chat.
const JUNK_RE = /embed|rerank|whisper|tts|audio|transcrib|speech|riva|lyria|guard|safety|moder|diffusion|stable-|\/sd[-_]|flux|image|img|banana|veo|imagen|robot|computer-use|calibrat|bert|clip\b|live|realtime|dubbing/i;
// HF: только известные chat-семейства (иначе сотни нерелевантных репо).
const HF_FAMILY_RE = /(qwen|llama|glm|gemma|mistral|deepseek|nemotron|gpt-oss|phi|command|aya|falcon|olmo)/i;

function isJunkModel(id) {
  if (!id) return true;
  return JUNK_RE.test(id);
}

// Gemini отдаёт id с префиксом 'models/' — нормализуем (OpenAI-compat endpoint
// принимает id без префикса, и это же устраняет ложный dedup с каталогом).
function normalizeModelId(id, source) {
  let out = String(id || '');
  if (source === 'gemini') out = out.replace(/^models\//, '');
  return out;
}

// Категория по id/описанию: vision > coding > reasoning > general.
function classifyModel(id, desc = '') {
  const m = String(id || '').toLowerCase();
  const d = String(desc || '').toLowerCase();
  if (/-vl\b|vision|omni|multimodal/.test(m) || /image input|multimodal/.test(d)) return 'vision';
  if (/codestral|coder|code\b|devstral|starcoder/.test(m) || /coding/.test(d)) return 'coding';
  if (/r1\b|qwq|think|reason/.test(m) || /reasoning|agentic/.test(d)) return 'reasoning';
  return 'general';
}

function fetchModelsList(url, apiKey, fetchImpl, timeout = 15000) {
  return fetchImpl(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(timeout),
  });
}

// Адаптеры: list-ответ ({data:[{id, context_length?, description?}]}) → кандидаты.
const ADAPTERS = {
  openrouter: async (ctx) => {
    const res = await fetchModelsList(SOURCE_META.openrouter.list, '', ctx.fetch);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const out = [];
    for (const m of (data.data || [])) {
      const id = normalizeModelId(m.id, 'openrouter');
      if (!id || !id.endsWith(':free')) continue;
      if (ctx.existing.has(id) || isJunkModel(id)) continue;
      out.push({
        model: id, source: 'openrouter', endpoint: SOURCE_META.openrouter.chat,
        contextWindow: m.context_length || 0, dailyLimit: SOURCE_META.openrouter.dailyLimit,
        category: classifyModel(id, m.description || ''), meta: { description: (m.description || '').slice(0, 200) },
      });
    }
    return out;
  },

  huggingface: async (ctx) => {
    const key = ctx.keys.huggingface || '';
    if (!key) return [];
    const res = await fetchModelsList(SOURCE_META.huggingface.list, key, ctx.fetch);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const out = [];
    for (const m of (data.data || [])) {
      const id = normalizeModelId(m.id, 'huggingface');
      if (!id || ctx.existing.has(id) || isJunkModel(id)) continue;
      if (!HF_FAMILY_RE.test(id)) continue;
      out.push({
        model: id, source: 'huggingface', endpoint: SOURCE_META.huggingface.chat,
        contextWindow: m.context_length || 0, dailyLimit: SOURCE_META.huggingface.dailyLimit,
        category: classifyModel(id),
      });
    }
    return out;
  },
};

// Нативные OpenAI-совместимые списки: один паттерн на все источники.
for (const name of ['groq', 'mistral', 'gemini', 'cerebras', 'deepseek', 'nim']) {
  ADAPTERS[name] = async (ctx) => {
    const meta = SOURCE_META[name];
    const key = ctx.keys[name] || process.env[meta.envVar] || '';
    if (!key) return [];
    const res = await fetchModelsList(meta.list, key, ctx.fetch);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const out = [];
    for (const m of (data.data || [])) {
      const id = normalizeModelId(typeof m === 'string' ? m : m.id, name);
      if (!id || ctx.existing.has(id) || isJunkModel(id)) continue;
      out.push({
        model: id, source: name, endpoint: meta.chat,
        contextWindow: (typeof m === 'object' && m.context_length) || 0,
        dailyLimit: meta.dailyLimit,
        category: classifyModel(id),
      });
    }
    return out;
  };
}

// Скан источников: кандидаты, dedup по model id (первый источник в списке выигрывает).
async function scanSources({ sources = SOURCES, keys = {}, fetchImpl, existing = new Set(), log = () => {} } = {}) {
  if (!fetchImpl) throw new Error('modelscan: fetchImpl is required');
  const seen = new Set(existing);
  const out = [];
  for (const name of sources) {
    const adapter = ADAPTERS[name];
    if (!adapter) continue;
    try {
      const candidates = await adapter({ keys, fetch: fetchImpl, existing: seen });
      let fresh = 0;
      for (const c of candidates) {
        if (seen.has(c.model)) continue; // dedup между источниками
        seen.add(c.model);
        out.push(c);
        fresh++;
      }
      if (fresh > 0) log(`  ${name}: ${fresh} новых кандидатов`);
    } catch (e) {
      log(`  ${name}: ошибка скана — ${e.message}`);
    }
  }
  return out;
}

// Реальный тест модели: chat/completions "hi", max_tokens 5. HTTP 200 = жива.
async function testModel(endpoint, model, apiKey, { timeout = 20000, fetchImpl } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return { ok: false, status: res.status, latencyMs: Date.now() - t0 };
    await res.json().catch(() => {});
    return { ok: true, status: res.status, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, status: 0, latencyMs: Date.now() - t0 };
  }
}

// Параллельный тест кандидатов с ограничением одновременности (worker pool).
async function testCandidates(candidates, { keys = {}, fetchImpl, concurrency = 5, timeout = 20000, log = () => {} } = {}) {
  if (!fetchImpl) throw new Error('modelscan: fetchImpl is required');
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < candidates.length) {
      const c = candidates[idx++];
      const apiKey = keys[c.source] || process.env[SOURCE_META[c.source]?.envVar] || '';
      const test = await testModel(c.endpoint, c.model, apiKey, { timeout, fetchImpl });
      if (test.ok) log(`  ✅ ${c.model} (${c.category})`);
      else if (test.status === 429) log(`  ⏳ ${c.model}: 429 (лимит)`);
      results.push({ ...c, test });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return results;
}

module.exports = { SOURCES, SOURCE_META, ADAPTERS, isJunkModel, classifyModel, normalizeModelId, scanSources, testModel, testCandidates };
