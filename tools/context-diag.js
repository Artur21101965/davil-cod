#!/usr/bin/env node
// tools/context-diag.js
// Отчёт по контекстной телеметрии из state.json — без обращения к серверу.
// Использование: node tools/context-diag.js [--hours N] [--json]
// (N по умолчанию 24, максимум 24*7)
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const hours = (() => {
  const i = args.indexOf('--hours');
  const n = i >= 0 ? parseInt(args[i + 1], 10) : 24;
  return Number.isFinite(n) && n > 0 && n <= 24 * 7 ? n : 24;
})();
const asJson = args.includes('--json');

function loadContext() {
  const p = path.join(__dirname, '..', 'state.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).stats?.context || null;
  } catch {
    return null;
  }
}

const ctx = loadContext();
if (!ctx || !Array.isArray(ctx.buckets)) {
  console.error('Нет данных контекстной телеметрии (state.json). Сервер ещё не собрал замеры.');
  process.exit(1);
}

const cutoff = Date.now() - hours * 3600 * 1000;
const buckets = ctx.buckets.filter(b => b && typeof b.ts === 'number' && b.ts >= cutoff);

let total = 0, near = 0, over = 0, compact = 0, upgraded = 0, cacheHits = 0, sumReal = 0, realCount = 0, sumEst = 0, estCount = 0, ratioMax = 0;
const byProvider = {};
const tasks = { coding: 0, reasoning: 0, search: 0, chat: 0 };
for (const b of buckets) {
  total += b.requests || 0;
  near += b.nearWindow || 0;
  over += b.overWindow || 0;
  compact += b.compactCount || 0;
  upgraded += b.upgradedCount || 0;
  cacheHits += (b.cacheExact || 0) + (b.cacheSem || 0);
  if (b.sumReal > 0) { sumReal += b.sumReal; realCount += b.requests || 0; }
  if (b.sumEst > 0) { sumEst += b.sumEst; estCount += b.requests || 0; }
  if ((b.ratioMax || 0) > ratioMax) ratioMax = b.ratioMax;
  if (b.tasks && typeof b.tasks === 'object') {
    for (const k of Object.keys(tasks)) tasks[k] += b.tasks[k] || 0;
  }
  const p = byProvider[b.provider] || (byProvider[b.provider] = { requests: 0, nearWindow: 0, overWindow: 0, compactCount: 0, upgradedCount: 0 });
  p.requests += b.requests || 0;
  p.nearWindow += b.nearWindow || 0;
  p.overWindow += b.overWindow || 0;
  p.compactCount += b.compactCount || 0;
  p.upgradedCount += b.upgradedCount || 0;
}
const narrow = Object.keys(byProvider).filter(k => byProvider[k].requests >= 20 && byProvider[k].nearWindow / byProvider[k].requests >= 0.2);
let status = 'OK';
if (over > 0) status = 'OVERFLOW';
else if (narrow.length > 0) status = 'NARROW';

if (asJson) {
  console.log(JSON.stringify({ hours, status, total, near, over, compact, upgraded, cacheHits, cacheHitRate: total ? Math.round((cacheHits / total) * 100) : 0, avgReal: realCount ? Math.round(sumReal / realCount) : 0, avgEst: estCount ? Math.round(sumEst / estCount) : 0, ratioMax, narrow, tasks, providers: byProvider }, null, 2));
  process.exit(0);
}

const AVG_REAL = realCount ? Math.round(sumReal / realCount) : 0;
const AVG_EST = estCount ? Math.round(sumEst / estCount) : 0;
console.log(`Контекстная телеметрия за ${hours}ч`);
console.log('-------------------------------');
console.log(`Статус узкого места: ${status}`);
console.log(`Запросов: ${total}  Кэш-hit: ${cacheHits} (${total ? Math.round((cacheHits / total) * 100) : 0}%)`);
console.log(`Впритык к окну: ${near}  Поверх окна: ${over}  Компакций: ${compact}  Апгрейдов (окно): ${upgraded}`);
console.log(`Средний real/запрос: ${AVG_REAL} токенов  Средний est/запрос: ${AVG_EST} токенов  Max ratio: ${ratioMax}`);
const taskParts = Object.entries(tasks).filter(([k, v]) => v > 0).map(([k, v]) => `${k}=${v}`);
if (taskParts.length > 0) console.log(`Категории задач: ${taskParts.join('  ')}`);
if (narrow.length > 0) console.log(`Узкие провайдеры: ${narrow.join(', ')}`);
console.log('');
if (Object.keys(byProvider).length === 0) { console.log('(замеров за период нет — пошлите запросы через прокси)'); process.exit(0); }
console.log('Провайдеры:');
for (const [k, p] of Object.entries(byProvider)) {
  console.log(`  ${k.padEnd(24)} запросов=${p.requests} впритык=${p.nearWindow} поверх=${p.overWindow} компакций=${p.compactCount} апгрейд=${p.upgradedCount}`);
}