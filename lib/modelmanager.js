// lib/modelmanager.js — оркестратор самообновляющейся базы моделей.
// Цикл: seed каталога → проверка существующих → перепроверка мёртвых (старше N
// дней) → скан источников → параллельный тест новых → добавление рабочих →
// скор → write-back priority (только auto-managed ключи) → hot-reload.
// Single-flight: циклы не перекрываются. Никогда не бросает исключений наружу.

const fs = require('fs');
const { ModelDB, computeScore } = require('./modeldb');
const modelscan = require('./modelscan');

const DEFAULTS = {
  enabled: true,
  intervalHours: 6,
  autoAdd: true,
  maxTestParallel: 5,
  maxTestPerCycle: 80,
  recheckDisabledDays: 7,
  testTimeoutMs: 20000,
};

function readJsonSafe(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return {}; }
}

function inferSource(providerEntry) {
  const env = providerEntry.envVar || '';
  if (env.includes('OPENROUTER')) return 'openrouter';
  if (env.includes('HF')) return 'huggingface';
  const ep = providerEntry.endpoint || '';
  if (ep.includes('api.groq.com')) return 'groq';
  if (ep.includes('api.mistral.ai')) return 'mistral';
  if (ep.includes('generativelanguage')) return 'gemini';
  if (ep.includes('api.cerebras.ai')) return 'cerebras';
  if (ep.includes('api.deepseek.com')) return 'deepseek';
  if (ep.includes('integrate.api.nvidia')) return 'nim';
  return 'unknown';
}

function keyFor(source, model) {
  const prefixMap = { openrouter: 'or-', huggingface: 'hf-' };
  const prefix = prefixMap[source] || source + '-';
  return prefix + String(model).split('/').pop().replace(/[:.]/g, '-').slice(0, 30);
}

class ModelManager {
  constructor({ dbPath, catalogPath, configPath, keys = {}, fetchImpl, config = {}, reload = null, now = () => Date.now(), log = () => {} }) {
    this.dbPath = dbPath;
    this.catalogPath = catalogPath;
    this.configPath = configPath;
    this.keys = keys;
    this.fetchImpl = fetchImpl;
    this.config = { ...DEFAULTS, ...config };
    this.reload = reload;
    this.now = now;
    this.log = log;
    this.db = new ModelDB(dbPath);
    this.db.load();
    this._running = false;
  }

  // Наполнение db из providers.json (idempotent: только отсутствующие ключи).
  // enabled:false в config.json = выбор пользователя → статус user-disabled,
  // такие никогда не перепроверяются и не реактивируются автоматически.
  seed() {
    const catalog = readJsonSafe(this.catalogPath);
    const userCfg = readJsonSafe(this.configPath);
    let added = 0;
    for (const [key, p] of Object.entries(catalog)) {
      if (!p || !p.model || !p.endpoint) continue;
      if (this.db.get(key)) continue;
      const userDisabled = userCfg.providers?.[key]?.enabled === false;
      this.db.upsert({
        key,
        model: p.model,
        endpoint: p.endpoint,
        source: inferSource(p),
        category: p.category || modelscan.classifyModel(p.model),
        contextWindow: p.context_window || 0,
        dailyLimit: p.dailyLimit || 0,
        status: userDisabled ? 'user-disabled' : 'untested',
        seeded: true,
      });
      added++;
    }
    if (added > 0) this.db.save();
    return added;
  }

  apiKeyFor(source) {
    return this.keys[source] || process.env[modelscan.SOURCE_META[source]?.envVar] || '';
  }

  // 1. Проверка активных/untested моделей. dead (404/402) → enabled:false в конфиге.
  async checkExisting() {
    let checked = 0, disabledNow = 0, configChanged = false;
    const userCfg = readJsonSafe(this.configPath);
    for (const m of this.db.all()) {
      if (m.status !== 'active' && m.status !== 'untested') continue;
      const test = await modelscan.testModel(m.endpoint, m.model, this.apiKeyFor(m.source), { timeout: this.config.testTimeoutMs, fetchImpl: this.fetchImpl });
      const before = m.status;
      this.db.markChecked(m.key, test, { now: this.now() });
      checked++;
      if (before !== 'dead' && this.db.get(m.key).status === 'dead') {
        if (!userCfg.providers) userCfg.providers = {};
        userCfg.providers[m.key] = { ...(userCfg.providers[m.key] || {}), enabled: false };
        configChanged = true;
        disabledNow++;
        this.log(`  ❌ ${m.key} (${m.model}): ${test.status} — отключаю`);
      }
    }
    if (configChanged) fs.writeFileSync(this.configPath, JSON.stringify(userCfg, null, 2));
    return { checked, disabledNow, configChanged };
  }

  // 2. Перепроверка мёртвых старше recheckDisabledDays. Ожил → active + enabled:true.
  async recheckDisabled() {
    let rechecked = 0, reenabled = 0, configChanged = false;
    const cutoff = this.config.recheckDisabledDays * 86400000;
    const now = this.now();
    const userCfg = readJsonSafe(this.configPath);
    for (const m of this.db.all()) {
      if (m.status !== 'dead') continue;
      if (!m.lastCheckedAt || now - m.lastCheckedAt < cutoff) continue;
      rechecked++;
      const test = await modelscan.testModel(m.endpoint, m.model, this.apiKeyFor(m.source), { timeout: this.config.testTimeoutMs, fetchImpl: this.fetchImpl });
      this.db.markChecked(m.key, test, { now: this.now() });
      if (test.ok) {
        if (!userCfg.providers) userCfg.providers = {};
        userCfg.providers[m.key] = { ...(userCfg.providers[m.key] || {}), enabled: true };
        configChanged = true;
        reenabled++;
        this.log(`  ♻️ ${m.key}: ожил — реактивирован`);
      }
    }
    if (configChanged) fs.writeFileSync(this.configPath, JSON.stringify(userCfg, null, 2));
    return { rechecked, reenabled, configChanged };
  }

  // 3. Скан новых + параллельный тест + добавление рабочих.
  async scanAndAdd() {
    const catalog = readJsonSafe(this.catalogPath);
    const existing = new Set(Object.values(catalog).map(p => p.model));
    for (const m of this.db.all()) existing.add(m.model);

    const candidates = await modelscan.scanSources({
      keys: this.keys, fetchImpl: this.fetchImpl, existing, log: this.log,
    });
    let added = 0, catalogChanged = false;
    if (candidates.length === 0) return { scanned: 0, tested: 0, added, catalogChanged };

    if (!this.config.autoAdd) {
      this.log(`  ⏭ AUTO_ADD=false — ${candidates.length} кандидатов не тестирую`);
      return { scanned: candidates.length, tested: 0, added, catalogChanged };
    }

    // Кап тестов за цикл: не жжём лимиты, если источник отдал сотни кандидатов.
    // Сначала тестируем гарантированно-бесплатных (:free), затем остальных.
    const freeFirst = [...candidates].sort((a, b) =>
      ((b.model.includes(':free') ? 1 : 0) - (a.model.includes(':free') ? 1 : 0)));
    const toTest = freeFirst.slice(0, this.config.maxTestPerCycle);
    const tested = await modelscan.testCandidates(toTest, {
      keys: this.keys, fetchImpl: this.fetchImpl,
      concurrency: this.config.maxTestParallel, timeout: this.config.testTimeoutMs, log: this.log,
    });
    for (const c of tested) {
      if (!c.test.ok) continue; // 429/сбой — не добавляем
      const key = keyFor(c.source, c.model);
      this.db.upsert({
        key, model: c.model, endpoint: c.endpoint, source: c.source,
        category: c.category || modelscan.classifyModel(c.model),
        contextWindow: c.contextWindow || 0, dailyLimit: c.dailyLimit || 0,
        meta: c.meta || {},
      });
      this.db.markChecked(key, c.test, { now: this.now() });
      catalog[key] = {
        endpoint: c.endpoint,
        model: c.model,
        priority: 99, // writeBackPriorities проставит ранг по скору
        dailyLimit: c.dailyLimit || 0,
        keyHint: `${c.source} → Keys (автодобавлено, ${c.category})`,
        envVar: modelscan.SOURCE_META[c.source]?.envVar || '',
        free: true,
        category: c.category || 'general',
      };
      added++;
      catalogChanged = true;
    }
    if (catalogChanged) {
      fs.writeFileSync(this.catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    }
    return { scanned: candidates.length, tested: tested.length, added, catalogChanged };
  }

  // 4. Скор по истории проверок (successRate + латентность + окно + свежесть).
  updateScores() {
    const now = this.now();
    for (const m of this.db.all()) {
      const history = m.checkHistory || [];
      let successRate = 0.5;
      if (history.length > 0) {
        successRate = history.filter(h => h.ok).length / history.length;
      }
      const okLat = history.filter(h => h.ok && h.latencyMs > 0);
      const latencyEma = okLat.length > 0
        ? okLat.reduce((a, h) => a + h.latencyMs, 0) / okLat.length
        : 0;
      m.score = computeScore({ successRate, latencyEma, contextWindow: m.contextWindow, lastOkAt: m.lastOkAt, now });
    }
  }

  // 5. Priority write-back: только auto-managed ключи (не seeded). Ранг в
    // категории по скору (1 = лучший). Ручные записи каталога не трогаем.
  writeBackPriorities() {
    const catalog = readJsonSafe(this.catalogPath);
    const byCategory = {};
    for (const m of this.db.all()) {
      if (m.seeded) continue;
      if (!catalog[m.key]) continue;
      (byCategory[m.category] || (byCategory[m.category] = [])).push(m);
    }
    let changed = false;
    for (const entries of Object.values(byCategory)) {
      entries.sort((a, b) => (b.score || 0) - (a.score || 0));
      entries.forEach((m, i) => {
        const p = i + 1;
        if (catalog[m.key].priority !== p) {
          catalog[m.key].priority = p;
          changed = true;
        }
      });
    }
    if (changed) fs.writeFileSync(this.catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    return changed;
  }

  // Полный цикл. Single-flight.
  async runCycle() {
    if (this._running) return { skipped: true };
    this._running = true;
    try {
      const summary = { checkedExisting: 0, disabledNow: 0, rechecked: 0, reenabled: 0, scanned: 0, tested: 0, added: 0, priorityUpdated: false };
      this.seed();

      const ex = await this.checkExisting();
      summary.checkedExisting = ex.checked;
      summary.disabledNow = ex.disabledNow;

      const rc = await this.recheckDisabled();
      summary.rechecked = rc.rechecked;
      summary.reenabled = rc.reenabled;

      const sa = await this.scanAndAdd();
      summary.scanned = sa.scanned;
      summary.tested = sa.tested;
      summary.added = sa.added;

      this.updateScores();
      this.db.save();

      const prioritiesChanged = this.writeBackPriorities();
      summary.priorityUpdated = prioritiesChanged;

      const catalogChanged = sa.catalogChanged || prioritiesChanged;
      if (catalogChanged || rc.configChanged || ex.configChanged) {
        if (this.reload) {
          try { this.reload(); } catch {}
        }
      }
      return summary;
    } catch (err) {
      this.log(`  цикл прерван: ${err.message}`);
      return { error: err.message };
    } finally {
      this._running = false;
    }
  }

  // «Всегда»: стартовый отложенный прогон + интервал с джиттером.
  start() {
    if (!this.config.enabled) return null;
    const jitter = (min, max) => min + Math.random() * (max - min);
    const intervalMs = this.config.intervalHours * 3600000;
    this._timer = setInterval(() => {
      this.runCycle().catch(() => {});
    }, intervalMs + jitter(-600000, 600000)); // ±10 мин джиттер
    this._timer.unref?.();
    // Первый прогон через 2 минуты после старта (пусть сервер поднимется).
    this._initial = setTimeout(() => {
      this.runCycle().catch(() => {});
    }, 120000);
    this._initial.unref?.();
    return this;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._initial) clearTimeout(this._initial);
    this._timer = this._initial = null;
  }
}

module.exports = { ModelManager, keyFor, inferSource, DEFAULTS };
