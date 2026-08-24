#!/usr/bin/env node
// scripts/auto-manage-models.js — automated model management for Freegate.
//
// What it does:
//   1. Scans OpenRouter for free models NOT yet in the catalog
//   2. Tests each new model with a real request (working or not)
//   3. Adds working new models to providers.json automatically
//   4. Re-tests EXISTING providers and disables dead ones (health)
//   5. Classifies each provider into a category (reasoning/coding/general/vision/local)
//
// Run manually:  node scripts/auto-manage-models.js
// Run scheduled: add to crontab / launchd every 6h.
//
// Env: OPENROUTER_API_KEY required (or loaded from llm-proxy/.env).
//      AUTO_ADD=true (default) auto-adds working new models. AUTO_ADD=false only reports.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'providers.json');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const AUTO_ADD = process.env.AUTO_ADD !== 'false';

// ── load ALL keys from .env ──
function loadEnv() {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of env.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq > 0) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch {}
}
loadEnv();
const OPENROUTER_KEY = process.env.PROVIDER_OPENROUTER_APIKEY || '';
const HF_TOKEN = process.env.HF_TOKEN || process.env.PROVIDER_HF_APIKEY || '';

// ── category classification from model id + description ──
function classifyModel(model, desc = '') {
  const m = model.toLowerCase();
  const d = desc.toLowerCase();
  if (m.includes('vision') || m.includes('-vl') || m.includes('omni') || d.includes('image input') || d.includes('multimodal')) return 'vision';
  if (m.includes('codestral') || m.includes('north-mini') || m.includes('laguna') || d.includes('coding') || d.includes('code')) return 'coding';
  if (m.includes('reasoning') || d.includes('reasoning') || d.includes('agentic') || d.includes('thinking')) return 'reasoning';
  if (m.includes('llama') || m.includes('qwen') || m.includes('glm') || m.includes('gpt-oss') || m.includes('gemma')) return 'general';
  return 'general';
}

// ── test a model with a real request ──
async function testModel(endpoint, model, apiKey, timeout = 25000) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const has = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning;
    return { ok: Boolean(has), status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ── scan HuggingFace Inference Providers for free chat models ──
async function scanHuggingFace(existingModels) {
  if (!HF_TOKEN) return [];
  const out = [];
  try {
    const res = await fetch('https://router.huggingface.co/v1/models', {
      headers: { Authorization: `Bearer ${HF_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return out;
    const data = await res.json();
    for (const m of (data.data || [])) {
      const id = m.id;
      if (existingModels.has(id)) continue;
      // Only chat-oriented models; skip embeddings/image
      if (id.includes('embed') || id.includes('rerank') || id.includes('/text-embedding')) continue;
      if (!/(qwen|llama|glm|gemma|mistral|deepseek|nemotron|gpt-oss)/i.test(id)) continue;
      const test = await testModel('https://router.huggingface.co/v1/chat/completions', id, HF_TOKEN, 20000);
      if (test.ok) {
        out.push({ id, category: classifyModel(id) });
      }
    }
  } catch {}
  return out;
}

async function main() {
  console.log('=== Freegate: автоуправление моделями ===');
  console.log('Режим:', AUTO_ADD ? 'AUTO-ADD (добавляю рабочие)' : 'только отчёт');

  // Load current catalog + config
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  let userCfg = {};
  try { userCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  const disabled = new Set(Object.entries(userCfg.providers || {}).filter(([_, v]) => v.enabled === false).map(([k]) => k));
  const existingModels = new Set(Object.values(catalog).map((p) => p.model));

  if (!OPENROUTER_KEY) {
    console.error('Нет PROVIDER_OPENROUTER_APIKEY в .env — проверка существующих пропущена.');
  }

  // ── 1. Check EXISTING providers health ──
  console.log('\n[1/3] Проверяю существующие провайдеры...');
  let disabledNow = 0;
  for (const [key, p] of Object.entries(catalog)) {
    if (disabled.has(key)) continue; // user already disabled
    const res = await testModel(p.endpoint, p.model, p.envVar ? process.env[p.envVar] || OPENROUTER_KEY : '');
    if (!res.ok && res.status === 404) {
      // Model no longer available — mark for disable
      if (!userCfg.providers) userCfg.providers = {};
      if (!userCfg.providers[key]) userCfg.providers[key] = {};
      userCfg.providers[key].enabled = false;
      console.log(`  ❌ ${key} (${p.model}): 404 — отключаю`);
      disabledNow++;
    } else if (!res.ok && res.status === 402) {
      console.log(`  ⚠️ ${key}: 402 no balance — оставляю (может ожить)`);
    } else if (res.ok) {
      // ok, keep
    } else {
      console.log(`  ⚠️ ${key}: ${res.status} — оставляю (временное)`);
    }
  }
  if (disabledNow > 0) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(userCfg, null, 2));
    console.log(`  → Отключено мёртвых: ${disabledNow}`);
  } else {
    console.log('  → Все существующие рабочие (или не критичные сбои)');
  }

  // ── 2. Find NEW free models ──
  console.log('\n[2/3] Ищу новые бесплатные модели на OpenRouter...');
  let free = [];
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const data = await res.json();
    free = data.data.filter((m) => m.id.endsWith(':free') && !existingModels.has(m.id));
  } catch (e) {
    console.error('  Не удалось получить список OpenRouter:', e.message);
  }
  console.log(`  Найдено новых: ${free.length}`);
  let added = 0;

  // ── 2b. HuggingFace Inference Providers ──
  console.log('\n[2b/3] Ищу новые бесплатные модели на HuggingFace...');
  const hfModels = await scanHuggingFace(existingModels);
  console.log(`  Найдено новых на HF: ${hfModels.length}`);
  for (const m of hfModels) {
    const key = 'hf-' + m.id.split('/').pop().replace(/[:.]/g, '-').slice(0, 30);
    catalog[key] = {
      endpoint: 'https://router.huggingface.co/v1/chat/completions',
      model: m.id,
      priority: 20,
      dailyLimit: 50,
      keyHint: 'huggingface.co → Settings → Tokens (автодобавлено, ' + m.category + ')',
      envVar: 'PROVIDER_HF_APIKEY',
      free: true,
      category: m.category,
    };
    existingModels.add(m.id);
    console.log(`  ✅ ${m.id} → ${key} (${m.category})`);
    added++;
  }

  // ── 3. Test and add working new models ──
  console.log('\n[3/3] Проверяю и добавляю рабочие...');
  for (const m of free) {
    const category = classifyModel(m.id, m.description || '');
    // Skip guardrail/content-safety models — not useful for chat
    if (m.id.includes('safety') || m.id.includes('guard')) {
      console.log(`  ⏭ ${m.id}: guardrail — пропуск`);
      continue;
    }
    const test = await testModel('https://openrouter.ai/api/v1/chat/completions', m.id, OPENROUTER_KEY);
    if (test.ok) {
      const key = 'or-' + m.id.split('/').pop().replace(/[:.]/g, '-').slice(0, 30);
      catalog[key] = {
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: m.id,
        priority: 20,
        dailyLimit: 50,
        keyHint: 'openrouter.ai → Keys (автодобавлено, ' + category + ')',
        envVar: 'PROVIDER_OPENROUTER_APIKEY',
        free: true,
        category,
      };
      console.log(`  ✅ ${m.id} → ${key} (${category})`);
      added++;
    } else {
      console.log(`  ❌ ${m.id}: не прошёл тест`);
    }
  }

  if (added > 0 && AUTO_ADD) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
    console.log(`\n  → Добавлено рабочих: ${added}. Каталог обновлён.`);
  } else if (added > 0 && !AUTO_ADD) {
    console.log(`\n  → Найдено рабочих: ${added} (AUTO_ADD=false — не добавляю)`);
  } else {
    console.log('\n  → Новых рабочих моделей нет.');
  }

  console.log('\n=== Готово ===');
}

main().catch((e) => { console.error('Ошибка:', e); process.exit(1); });
