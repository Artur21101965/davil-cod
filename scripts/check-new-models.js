#!/usr/bin/env node
// scripts/check-new-models.js — check OpenRouter for NEW free models not in the catalog.
// Run: node scripts/check-new-models.js
// Prints new free models so you can add them to providers.json.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'providers.json'), 'utf8'));
const existingModels = new Set(Object.values(CATALOG).map((p) => p.model));

async function main() {
  console.log('Проверяю новые бесплатные модели на OpenRouter...\n');
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const data = await res.json();
  const free = data.data.filter((m) => m.id.endsWith(':free'));

  const known = new Set(existingModels);
  const newOnes = free.filter((m) => !known.has(m.id));

  if (newOnes.length === 0) {
    console.log('Новых бесплатных моделей нет. Каталог актуален.');
    return;
  }

  console.log(`Найдено новых: ${newOnes.length}\n`);
  for (const m of newOnes) {
    const ctx = m.context_length ? (m.context_length / 1024).toFixed(0) + 'K' : '?';
    console.log(`  ${m.id}`);
    console.log(`    ctx=${ctx}  ${(m.description || '').slice(0, 120)}`);
    console.log('');
  }

  console.log('Чтобы добавить в каталог, впиши в providers.json:');
  for (const m of newOnes.slice(0, 5)) {
    const key = 'or-' + m.id.split('/').pop().replace(/[:.]/g, '-');
    console.log(JSON.stringify({
      [key]: {
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: m.id,
        priority: 20,
        dailyLimit: 50,
        keyHint: 'openrouter.ai → Keys',
        envVar: 'PROVIDER_OPENROUTER_APIKEY',
        free: true,
      },
    }, null, 2));
  }
}

main().catch((e) => {
  console.error('Ошибка:', e.message);
  process.exit(1);
});
