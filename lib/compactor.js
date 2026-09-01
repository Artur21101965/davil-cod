// lib/compactor.js
// Detects when a conversation exceeds the context window of free models and
// compresses old messages into a single summary via a long-context model.
// Zero deps: pure Node built-ins + existing callProvider/lib.

const crypto = require('crypto');
const path = require('path');
const { PROVIDERS, callProvider } = require('./providers');

const COMPACT_THRESHOLD = 60000;  // tokens — compact above 60k. estimateTokens intentionally
                                  // UNDERCOUNTS (only text content we can see), while opencode's
                                  // session counter includes cache/role tokens + huge system prompt.
                                  // Empirically opencode reads ~2x our estimate on real sessions,
                                  // so 60k est ≈ 120-160k real — safely below free-model windows
                                  // while keeping context summaries fresh.
const KEEP_RECENT_TOKENS = 30000; // tokens — recent messages kept untouched (preserve session context)
const MAX_COMPACT_THRESHOLD = 100000; // est tokens — cap for window-aware thresholds (≈200k real,
                                      // sits safely inside even 512k/1M windows without compacting too early)
const SUMMARY_MAX_TOKENS = 2000;  // tokens — summary length cap (detailed enough to not lose the work)
const CHARS_PER_TOKEN = 1.0;      // heuristic chars→tokens. Прежнее 1.5 ДВАЖДЫ завышало
                                  // оценку (реально ~0.75-0.8 chars/token) → компакции
                                  // срабатывали почти на каждый второй запрос (53%),
                                  // каждый — доп. LLM-вызов = медленно + риск «замирания».
                                  // 1.0 всё ещё с запасом, но почти вдвое меньше лишних
                                  // компакций. keep-recent и оконные пороги не меняем.

// Reliability-ordered long-context summarizers (OpenRouter + HF).
const SUMMARIZERS = [
  'or-nemotron-35', 'or-dots-3', 'or-minimax-m2-7-free',
  'or-lfm', 'deepseek',
];

// Summary cache: hash of compacted messages → summary string.
// In-memory only (like the main cache) — survives across requests, not restarts.
const summaryCache = new Map();
const SUMMARY_CACHE_MAX = 300;

// --- Долговременная память (vector memory) ---
// Компактор извлекает факты попутно с резюме — НЕ добавляя ни одного лишнего
// LLM-вызова. Память инжектируется из server.js (setMemory), чтобы не заводить
// жёсткую связанность между модулями.
let memoryStore = null;
const MAX_FACTS_PER_COMPACTION = 5;

function setMemory(store) {
  memoryStore = store;
}

// Summarizer запрашивается вернуть JSON вида {"summary": "...", "facts": [...]}.
// Многие модели вернут чистый текст — тогда берём только текст (старое
// поведение, никаких потерь). Парсим оба варианта + fenced json.
function parseSummaryResponse(text) {
  if (!text) return { summary: '', facts: [] };
  const trimmed = String(text).trim();
  const attempt = (s) => {
    try {
      const obj = JSON.parse(s);
      if (!obj || typeof obj !== 'object') return null;
      const summary = typeof obj.summary === 'string' ? obj.summary : '';
      const facts = Array.isArray(obj.facts)
        ? obj.facts.filter(f => typeof f === 'string' && f.trim().length > 2)
        : [];
      return { summary, facts };
    } catch { return null; }
  };
  let parsed = attempt(trimmed);
  if (!parsed) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) parsed = attempt(fenced[1].trim());
  }
  if (parsed) return parsed;
  return { summary: trimmed, facts: [] };
}

// Сохранить факты в долговременную память (если она подключена).
function ingestFacts(facts, sourceHash) {
  if (!memoryStore || !Array.isArray(facts) || facts.length === 0) return 0;
  let n = 0;
  for (const f of facts.slice(0, MAX_FACTS_PER_COMPACTION)) {
    if (memoryStore.add(f, { sourceHash })) n++;
  }
  return n;
}

// --- Estimate tokens from messages array ---
// Conservative: counts text + images + tool calls + attachments, and uses a
// lower chars-per-token ratio so the estimate is closer to real provider usage
// (which also counts role/formatting tokens). Undercounting means we compact
// too late and the free models reject the request.
function estimateTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    // Tool calls / attachments / function results add a lot.
    if (Array.isArray(m.tool_calls)) chars += 200 * m.tool_calls.length;
    if (Array.isArray(m.attachments)) chars += 300 * m.attachments.length;
    if (Array.isArray(m.file)) chars += 500;
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (!c || typeof c !== 'object') continue;
        if (typeof c.text === 'string') chars += c.text.length;
        else if (c.image_url && typeof c.image_url === 'object') chars += 800; // images/vision count a lot
        else if (c.image || c.type === 'image' || c.type === 'input_image') chars += 800;
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// Эффективный порог компакции зависит от реального окна целевого провайдера.
// estimateTokens намеренно занижает (~2x реальных токенов), поэтому для
// известного окна держим est <= win*0.5 (реальные токены точно влезут) и
// капаем на MAX_COMPACT_THRESHOLD — большие окна (512k/1M) не заставляют
// компактировать раньше необходимости. Неизвестное окно — прежнее поведение.
function compactionThresholdFor(contextWindow) {
  if (!contextWindow || contextWindow <= 0) return COMPACT_THRESHOLD;
  return Math.min(Math.floor(contextWindow * 0.5), MAX_COMPACT_THRESHOLD);
}

// --- Build the compaction algorithm structure (logic filled in Task 2) ---
async function prepareMessages(messages, opts = {}) {
  // Compact if above threshold; otherwise return unchanged.
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const total = estimateTokens(messages);
  if (total <= compactionThresholdFor(opts.contextWindow)) return messages;
  return compactOld(messages);
}

// --- Split messages: recent kept, old summarized ---
async function compactOld(messages) {
  // System messages (opencode AGENTS.md, plugin skills) are huge and critical —
  // NEVER summarize or drop them. Split them off first.
  const systemMsgs = messages.filter(m => m && m.role === 'system');
  const rest = messages.filter(m => !m || m.role !== 'system');

  // Walk from the end accumulating tokens until we fill KEEP_RECENT_TOKENS.
  const recent = [];
  let recentTokens = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i];
    const tokens = estimateTokens([m]);
    if (recentTokens + tokens > KEEP_RECENT_TOKENS && recent.length > 0) {
      break;
    }
    recent.unshift(m);
    recentTokens += tokens;
  }
  // old = everything before the recent tail (non-system); never summarize system.
  const old = rest.slice(0, rest.length - recent.length);
  if (old.length === 0) return messages; // nothing compactable (single huge msg → keep all)

  const summary = await module.exports.getSummary(old);
  const finalLength = estimateTokens(systemMsgs) + estimateTokens(recent) + (summary ? Math.ceil(summary.length / CHARS_PER_TOKEN) : 0);
  if (!summary || finalLength >= estimateTokens(messages)) {
    // No summary produced or compaction didn't help — return unchanged.
    return messages;
  }
  return [
    ...systemMsgs,
    { role: 'user', content: '[Резюме предыдущего диалога]\n' + summary },
    ...recent,
  ];
}

// --- Generate a summary for the given messages via fallback chain ---
async function getSummary(messages) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  if (summaryCache.has(hash)) {
    return summaryCache.get(hash);
  }
  const raw = await summarizeViaChain(messages);
  const { summary, facts } = parseSummaryResponse(raw);
  // Long-term memory: keep facts as a side effect of the same LLM call (no extra cost).
  if (facts.length > 0) ingestFacts(facts, hash);
  if (summary) {
    if (summaryCache.size >= SUMMARY_CACHE_MAX) {
      // Evict oldest inserted entry.
      const firstKey = summaryCache.keys().next().value;
      summaryCache.delete(firstKey);
    }
    summaryCache.set(hash, summary);
  }
  return summary;
}

// --- Call long-context models in order until one returns a summary ---
async function summarizeViaChain(messages) {
  const system = 'Ты — система компактизации контекста. Сожми старую часть диалога в ПОДРОБНОЕ резюме, чтобы читатель мог продолжить работу без потери контекста.\n\n' +
    'Обязательно сохрани:\n' +
    '1. ЦЕЛЬ задачи и над чем работали (проект, файлы, функции)\n' +
    '2. Принятые РЕШЕНИЯ и почему\n' +
    '3. Достигнутый ПРОГРЕСС и текущий статус (что готово, что нет)\n' +
    '4. Ключевые факты, найденные ошибки, исправления\n' +
    '5. Следующие шаги / что осталось сделать\n\n' +
    'Пиши структурированно и подробно (до ' + SUMMARY_MAX_TOKENS + ' токенов). Не выдумывай. Верни только текст резюме, без вступлений.\n\n' +
    'Идеально — сразу JSON вида {"summary": "<резюме>", "facts": ["<факт1>", "<факт2>"]}, где facts — до 5 коротких фактов (имена файлов/функций, принятые решения, найденные ошибки, текущий статус). Если JSON неудобен — просто текст резюме; он будет использован как есть.';
  const textToSummarize = JSON.stringify(messages);
  for (const key of SUMMARIZERS) {
    const provider = PROVIDERS[key];
    if (!provider || !provider.enabled) continue;
    try {
      const result = await callProvider(provider, {
        model: provider.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Сожми следующий диалог:\n\n' + textToSummarize },
        ],
        max_tokens: SUMMARY_MAX_TOKENS,
      }, 30000, 1);
      const summary = result.data?.choices?.[0]?.message?.content;
      if (summary && summary.trim().length >= 10) {
        return summary.trim();
      }
    } catch (err) {
      // try next summarizer
    }
  }
  return '';
}

module.exports = { estimateTokens, prepareMessages, compactOld, getSummary, summaryCache, COMPACT_THRESHOLD, KEEP_RECENT_TOKENS, SUMMARY_MAX_TOKENS, SUMMARIZERS, parseSummaryResponse, ingestFacts, setMemory, MAX_FACTS_PER_COMPACTION, compactionThresholdFor, MAX_COMPACT_THRESHOLD };
