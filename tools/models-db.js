#!/usr/bin/env node
// tools/models-db.js — отчёт по структурированной базе моделей.
// Использование: node tools/models-db.js [--json] [--status active|dead|...]

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'models-db.json');
const asJson = process.argv.includes('--json');
const statusFilterIdx = process.argv.indexOf('--status');
const statusFilter = statusFilterIdx > -1 ? process.argv[statusFilterIdx + 1] : null;

let db;
try {
  db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
} catch {
  console.error('models-db.json не найден или повреждён. Запусти прокси — база создастся автоматически.');
  process.exit(1);
}

const models = Object.values(db.models || {});
const filtered = statusFilter ? models.filter(m => m.status === statusFilter) : models;
const sorted = [...filtered].sort((a, b) => (b.score || 0) - (a.score || 0));

const stats = { total: models.length, byStatus: {}, byCategory: {}, bySource: {} };
for (const m of models) {
  stats.byStatus[m.status] = (stats.byStatus[m.status] || 0) + 1;
  stats.byCategory[m.category] = (stats.byCategory[m.category] || 0) + 1;
  stats.bySource[m.source] = (stats.bySource[m.source] || 0) + 1;
}

if (asJson) {
  console.log(JSON.stringify({ updatedAt: db.updatedAt, stats, models: sorted }, null, 2));
  process.exit(0);
}

console.log('База моделей Freegate');
console.log('-------------------------------');
console.log(`Обновлено: ${db.updatedAt ? new Date(db.updatedAt).toLocaleString('ru-RU') : '—'}`);
console.log(`Моделей: ${stats.total}`);
const fmt = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('  ');
console.log(`Статусы: ${fmt(stats.byStatus) || '—'}`);
console.log(`Категории: ${fmt(stats.byCategory) || '—'}`);
console.log(`Источники: ${fmt(stats.bySource) || '—'}`);
console.log('');
if (sorted.length === 0) {
  console.log(statusFilter ? `(нет моделей со статусом ${statusFilter})` : '(база пуста — дождись первого цикла ModelManager)');
  process.exit(0);
}
console.log('Топ по скору:');
for (const m of sorted.slice(0, 15)) {
  const checked = m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleDateString('ru-RU') : '—';
  console.log(`  ${String(m.score).padStart(3)}  ${m.key.padEnd(28)} ${m.category.padEnd(10)} ${m.status.padEnd(14)} пров=${checked}`);
}
