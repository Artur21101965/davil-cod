// Снятие периодических срезов метрик для сравнения «до/после».
// Каждые INTERVAL_MS пишет точку {ts, successRate, requests, errors, compactCount,
// poolActive, poolTotal, errorsByClass, version} в diag_history.json. Данные
// переживают перезапуск (пишутся на диск) — можно строить тренд по времени.
const fs = require('fs');
const path = require('path');
const { getStats, getHealth, getContextStats } = require('./health');

const HISTORY_PATH = process.env.DIAG_HISTORY_PATH || path.join(__dirname, '..', 'diag_history.json');
const INTERVAL_MS = 30 * 60 * 1000; // 30 мин
const MAX_POINTS = 2000;

function classifyErrors(errors) {
  // Грубая классификация по статусу провайдера в health (без сетевых вызовов):
  // 429 → limit; 401/402/403 → auth; прочее/нет данных → invalid.
  const health = getHealth();
  const out = { limit: 0, auth: 0, invalid: 0, timeout: 0 };
  for (const [key, cnt] of Object.entries(errors || {})) {
    const h = health[key] || {};
    if (h.statusCode === 429) out.limit += cnt;
    else if ([401, 402, 403].includes(h.statusCode)) out.auth += cnt;
    else if (h.statusCode === 0) out.timeout += cnt;
    else out.invalid += cnt;
  }
  return out;
}

function snapshot() {
  const stats = getStats() || {};
  const ctx = getContextStats() || {};
  const health = getHealth() || {};
  const errors = stats.errors || {};
  const today = todayStat(stats);
  const active = Object.values(health).filter((h) => h.status === 'up' || h.status === 'ratelimited').length;
  return {
    ts: Date.now(),
    version: process.env.FREEGATE_VERSION || currentVersion(),
    requests: today.requests,
    success: today.success,
    failed: today.failed,
    successRate: today.successRate,
    compactCount: ctx.compactCount || 0,
    upgradedCount: ctx.upgradedCount || 0,
    poolActive: active,
    poolTotal: Object.keys(health).length,
    errorsByClass: classifyErrors(errors),
  };
}

function todayStat(stats) {
  // Дневные счётчики из stats.today (вычисляется сервером) с fallback на общие.
  const day = stats.today || {};
  const total = day.requests || 0;
  return {
    requests: total,
    success: day.success || 0,
    failed: day.failed || 0,
    successRate: total > 0 ? Math.round(((day.success || 0) / total) * 100) : null,
  };
}

function currentVersion() {
  try { return require('../package.json').version; } catch { return 'dev'; }
}

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); }
  catch { return []; }
}

function recordSnapshot() {
  const hist = loadHistory();
  hist.push(snapshot());
  while (hist.length > MAX_POINTS) hist.shift();
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(hist, null, 2));
  } catch {}
  return hist.length;
}

let _timer = null;
function startMonitor(intervalMs = INTERVAL_MS) {
  stopMonitor();
  recordSnapshot(); // сразу фиксируем стартовую точку
  _timer = setInterval(recordSnapshot, intervalMs);
}

function stopMonitor() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { snapshot, recordSnapshot, loadHistory, startMonitor, stopMonitor, INTERVAL_MS };
