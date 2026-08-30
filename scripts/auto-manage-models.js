#!/usr/bin/env node
// scripts/auto-manage-models.js — ручной прогон цикла самообновляющейся базы.
// Планировщик теперь встроен в server.js (config.modelManager), этот скрипт —
// тонкая обёртка для запуска того же цикла вручную:
//   node scripts/auto-manage-models.js              # полный цикл
//   AUTO_ADD=false node scripts/auto-manage-models.js  # только отчёт
//
// Использует lib/modeldb + lib/modelscan + lib/modelmanager (те же модули,
// что и встроенный планировщик).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Ключи из .env → process.env (как делает сервер).
function loadEnv() {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of env.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq > 0 && !process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch {}
}
loadEnv();

const { ModelManager } = require(path.join(ROOT, 'lib', 'modelmanager'));

const AUTO_ADD = process.env.AUTO_ADD !== 'false';

async function main() {
  console.log('=== Freegate: цикл автоуправления моделями (ручной) ===');
  console.log('Режим:', AUTO_ADD ? 'AUTO-ADD (добавляю рабочие)' : 'только отчёт');

  const mgr = new ModelManager({
    dbPath: path.join(ROOT, 'models-db.json'),
    catalogPath: path.join(ROOT, 'providers.json'),
    configPath: path.join(ROOT, 'config.json'),
    keys: {
      openrouter: process.env.PROVIDER_OPENROUTER_APIKEY || '',
      huggingface: process.env.HF_TOKEN || process.env.PROVIDER_HF_APIKEY || '',
      groq: process.env.PROVIDER_GROQ_APIKEY || '',
      mistral: process.env.PROVIDER_MISTRAL_APIKEY || '',
      gemini: process.env.PROVIDER_GEMINI_APIKEY || '',
      cerebras: process.env.PROVIDER_CEREBRAS_APIKEY || '',
      deepseek: process.env.PROVIDER_DEEPSEEK_APIKEY || '',
      nim: process.env.PROVIDER_NIM_APIKEY || '',
    },
    config: { autoAdd: AUTO_ADD },
    fetchImpl: (url, opts) => fetch(url, opts),
    reload: () => {
      const port = process.env.PORT || '4000';
      const auth = process.env.AUTH || 'free-llm-proxy-2024';
      fetch(`http://localhost:${port}/v1/reload?key=${encodeURIComponent(auth)}`, { method: 'POST' })
        .then(() => console.log('  → Прокси перезагружен на горячую.'))
        .catch(() => {});
    },
    log: (msg) => console.log(msg),
  });

  const summary = await mgr.runCycle();
  if (summary.skipped) {
    console.log('Цикл уже выполняется — пропущено.');
    return;
  }
  console.log('\n=== Итог ===');
  console.log(`Проверено существующих: ${summary.checkedExisting} (отключено: ${summary.disabledNow})`);
  console.log(`Перепроверено мёртвых: ${summary.rechecked} (ожили: ${summary.reenabled})`);
  console.log(`Сканировано кандидатов: ${summary.scanned}, протестировано: ${summary.tested}, добавлено: ${summary.added}`);
  console.log(`Priority write-back: ${summary.priorityUpdated ? 'обновлён' : 'без изменений'}`);
  console.log('\n=== Готово ===');
}

main().catch((e) => { console.error('Ошибка:', e); process.exit(1); });
