// lib/doctor.js — автономная диагностика Freegate.
// Читает .env (ключи), валидирует их, смотрит модели из models-db.json и собирает
// «что включить». Не требует запущенного сервера. Используется `freegate doctor`.
const fs = require('fs');
const path = require('path');
const setup = require('./setup');
const { ModelDB } = require('./modeldb');

const ROOT = path.join(__dirname, '..');

// Провайдер, с которого удобно начинать (быстрый старт).
function easyStartKey() {
  return { envVar: 'PROVIDER_OPENROUTER_APIKEY', name: 'OpenRouter', count: 15 };
}

// Сгруппировать провайдеры каталога по envVar (как в init).
function groupByEnv(catalog) {
  const groups = new Map();
  for (const [name, p] of Object.entries(catalog || {})) {
    if (!p.envVar) continue;
    if (!groups.has(p.envVar)) groups.set(p.envVar, []);
    groups.get(p.envVar).push(name);
  }
  return groups;
}

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'providers.json'), 'utf8'));
  } catch { return {}; }
}

function loadModelDb() {
  try {
    const p = path.join(ROOT, 'models-db.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return {}; }
}

function statusOf(status) {
  return status === 'active' ? 'up' : status === 'user-disabled' ? 'disabled' : status || 'unknown';
}

// Собрать снимок состояния: ключи, каталог, модели.
function snapshot({ catalog = loadCatalog(), modelDb = loadModelDb(), keysSource = null } = {}) {
  const { keys, envPath } = keysSource || setup.readKeys();
  const groups = groupByEnv(catalog);
  const models = (modelDb.models && typeof modelDb.models === 'object') ? modelDb.models : {};

  const keyState = {};
  for (const [envVar, providers] of groups) {
    const meta = setup.KEY_GROUPS[envVar];
    keyState[envVar] = {
      envVar,
      name: meta ? (meta.name) : envVar,
      url: meta ? meta.url : '',
      key: (keys[envVar] || ''), // маскируем при выводе
      providers,
      count: providers.length,
      hasKey: !!(keys[envVar] || '').trim(),
    };
  }

  // Модели по статусу + источнику.
  const byStatus = { active: 0, disabled: 0, unknown: 0 };
  const bySource = {};
  const dead = [];   // disabled/мёртвые
  const working = []; // active
  for (const [key, m] of Object.entries(models)) {
    const st = statusOf(m.status); // up/disabled/unknown
    const bucket = st === 'up' ? 'active' : st === 'disabled' ? 'disabled' : 'unknown';
    byStatus[bucket] = (byStatus[bucket] || 0) + 1;
    const src = m.source || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;
    if (st === 'up') working.push(key);
    else if (st === 'disabled' || st === 'unknown') dead.push(key);
  }

  return { envPath, keyState, models, byStatus, bySource, working, dead, catalogCount: Object.keys(catalog).length };
}

// «Что включить»: по аналогии с дашбордом и модель-менеджером.
// - disabledByUser: user-disabled, но free/локальные — «можно вернуть» (пользователь сам выключил).
// - deadOrUntested: dead/untested — проверь/удали.
// - paid: платные-подозрительные (маленький лимит): их держать выключенными.
function recommend(models) {
  const all = Object.entries(models).map(([key, m]) => ({ key, model: m.model || key, source: m.source || '', status: m.status || 'unknown' }));
  const disabledByUser = [];
  const dead = [];
  const paid = [];
  const local = [];
  for (const m of all) {
    const isLocal = /local|ollama|lmstudio/i.test(m.source);
    const isPaid = /deepseek|glm-5|ox-alpha|minimax-m2/i.test(m.model);
    if (m.status === 'active') continue; // уже работает
    if (m.status === 'dead' || m.status === 'untested') { dead.push(m.key); continue; }
    if (isLocal) { local.push(m.key); continue; }
    if (isPaid) { paid.push(m.key); continue; }
    if (m.status === 'user-disabled') { disabledByUser.push(m.key); continue; }
    // иначе — unknown, не трогаем
  }
  return { disabledByUser, dead, paid, local };
}

module.exports = { snapshot, recommend, easyStartKey, groupByEnv };
