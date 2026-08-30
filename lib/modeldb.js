// lib/modeldb.js — структурированная база моделей Freegate.
// Паспорт каждой модели: источник, категория, контекст-окно, латентность,
// success-rate, скор, статус, история проверок. Хранение: models-db.json
// (атомарная запись через tmp+rename). Zero-dependency.
//
// Статусы: untested → active | dead (404/402) | disabled (авто-отключён,
// перепроверяется) | user-disabled (решение пользователя, не трогаем).

const fs = require('fs');

const CHECK_HISTORY_MAX = 20;
const SCORE_WEIGHTS = { success: 0.4, latency: 0.3, context: 0.2, freshness: 0.1 };
const LATENCY_PENALTY_MS = 5000;   // латентность ≥5s → latencyScore 0
const FRESH_DECAY_DAYS = 14;       // после 14 дней без успеха freshness 0
const CONTEXT_REF_MS = 1000000;    // 1M окна достаточно для contextScore 1

function clamp01(v) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(1, n));
}

// Технический скор 0..100: success-rate + латентность + окно + свежесть.
function computeScore({ successRate = 0.5, latencyEma = 0, contextWindow = 0, lastOkAt = 0, now = Date.now() } = {}) {
  const sSuccess = clamp01(successRate);
  const sLatency = 1 - clamp01((Number(latencyEma) || 0) / LATENCY_PENALTY_MS);
  const sContext = clamp01((Number(contextWindow) || 0) / CONTEXT_REF_MS);
  const days = (Number(lastOkAt) > 0) ? Math.max(0, (now - lastOkAt) / 86400000) : FRESH_DECAY_DAYS + 1;
  const sFresh = days <= 1 ? 1 : Math.max(0, 1 - days / FRESH_DECAY_DAYS);
  const raw = sSuccess * SCORE_WEIGHTS.success +
    sLatency * SCORE_WEIGHTS.latency +
    sContext * SCORE_WEIGHTS.context +
    sFresh * SCORE_WEIGHTS.freshness;
  return Math.round(clamp01(raw) * 100);
}

class ModelDB {
  constructor(filePath) {
    this.filePath = filePath;
    this.models = new Map(); // key -> entry
  }

  load() {
    this.models = new Map();
    try {
      if (!fs.existsSync(this.filePath)) return this;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      for (const [key, m] of Object.entries(raw.models || {})) {
        if (m && typeof m === 'object' && m.model && m.endpoint) this.models.set(key, m);
      }
    } catch {
      // повреждённый файл → пустая база, перезапишется при первом save
    }
    return this;
  }

  save() {
    const out = { version: 1, updatedAt: Date.now(), models: Object.fromEntries(this.models) };
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
    fs.renameSync(tmp, this.filePath); // атомарно: читатели не видят полузапись
    return this;
  }

  get(key) { return this.models.get(key) || null; }

  all() { return [...this.models.values()]; }

  // Слияние: новые поля поверх старых, существующие (status/history) сохраняются.
  upsert(entry) {
    if (!entry || !entry.key || !entry.model || !entry.endpoint) return null;
    const prev = this.models.get(entry.key) || {};
    const merged = {
      status: 'untested',
      category: 'general',
      source: 'unknown',
      contextWindow: 0,
      dailyLimit: 0,
      checkHistory: [],
      score: 0,
      addedAt: Date.now(),
      ...prev,
      ...entry,
    };
    this.models.set(entry.key, merged);
    return merged;
  }

  // Результат проверки модели. dead только для 404/402 (перманентно для аккаунта).
  // 429 и прочее — транзитное, статус не меняет. user-disabled не трогаем никогда.
  markChecked(key, result, opts = {}) {
    const m = this.models.get(key);
    if (!m) return null;
    const now = opts.now || Date.now();
    const ok = !!(result && result.ok);
    m.lastCheckedAt = now;
    if (m.status !== 'user-disabled') {
      if (ok) { m.status = 'active'; m.lastOkAt = now; }
      else if (result.status === 404 || result.status === 402) m.status = 'dead';
    } else if (ok) {
      m.lastOkAt = now;
    }
    const history = Array.isArray(m.checkHistory) ? m.checkHistory : [];
    history.push({ ts: now, ok, status: (result && result.status) || 0, latencyMs: (result && result.latencyMs) || 0 });
    m.checkHistory = history.slice(-CHECK_HISTORY_MAX);
    return m;
  }

  setStatus(key, status) {
    const m = this.models.get(key);
    if (m && status) m.status = status;
    return m;
  }

  stats() {
    const byCategory = {}, byStatus = {}, bySource = {};
    for (const m of this.models.values()) {
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
      bySource[m.source] = (bySource[m.source] || 0) + 1;
    }
    return { total: this.models.size, byCategory, byStatus, bySource };
  }
}

module.exports = { ModelDB, computeScore, SCORE_WEIGHTS };
