// lib/compactor.js
// Detects when a conversation exceeds the context window of free models and
// compresses old messages into a single summary via a long-context model.
// Zero deps: pure Node built-ins + existing callProvider/lib.

const crypto = require('crypto');
const path = require('path');
const { PROVIDERS, callProvider } = require('./providers');

const COMPACT_THRESHOLD = 50000;  // tokens — compact above this
const KEEP_RECENT_TOKENS = 10000; // tokens — recent messages kept untouched
const SUMMARY_MAX_TOKENS = 1000;  // tokens — summary length cap
const CHARS_PER_TOKEN = 3.6;      // heuristic chars→tokens

// Reliability-ordered long-context summarizers (OpenRouter + HF).
const SUMMARIZERS = [
  'or-nemotron-550b', 'or-nemotron-120b', 'or-nemotron-35',
  'or-dots-3', 'hf-DeepSeek-V4-Pro',
];

// Summary cache: hash of compacted messages → summary string.
// In-memory only (like the main cache) — survives across requests, not restarts.
const summaryCache = new Map();
const SUMMARY_CACHE_MAX = 300;

// --- Estimate tokens from messages array ---
function estimateTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c && typeof c === 'object') {
          if (typeof c.text === 'string') chars += c.text.length;
          else if (c.image_url && c.image_url.url) chars += 1000; // images count a lot
        }
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// --- Build the compaction algorithm structure (logic filled in Task 2) ---
async function prepareMessages(messages) {
  // Compact if above threshold; otherwise return unchanged.
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const total = estimateTokens(messages);
  if (total <= COMPACT_THRESHOLD) return messages;
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
  const summary = await summarizeViaChain(messages);
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
  const system = 'Ты сжимаешь старую часть диалога в краткое резюме. Сохрани ключевые факты, решения и выводы. Не выдумывай. Верни только текст резюме, до 1000 токенов, без вступлений.';
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

module.exports = { estimateTokens, prepareMessages, compactOld, getSummary, summaryCache, COMPACT_THRESHOLD, KEEP_RECENT_TOKENS, SUMMARY_MAX_TOKENS, SUMMARIZERS };
