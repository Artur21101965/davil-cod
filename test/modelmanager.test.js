// test/modelmanager.test.js — оркестратор: сеть мокается, файлы во временных папках.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ModelManager, ModelDB, isAutoAddable;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'modelmanager-test-'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function makeCatalog() {
  return {
    'or-known:free': {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'vendor/known:free',
      priority: 7, dailyLimit: 50, envVar: 'PROVIDER_OPENROUTER_APIKEY', category: 'general',
    },
    'or-dying:free': {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'vendor/dying:free',
      priority: 9, dailyLimit: 50, envVar: 'PROVIDER_OPENROUTER_APIKEY', category: 'coding',
    },
  };
}

describe('ModelManager', () => {
  let dir, dbPath, catalogPath, configPath, now;

  beforeEach(() => {
    delete require.cache[require.resolve('../lib/modelmanager')];
    ({ ModelManager, isAutoAddable } = require('../lib/modelmanager'));
    ({ ModelDB } = require('../lib/modeldb'));
    dir = tmpDir();
    dbPath = path.join(dir, 'models-db.json');
    catalogPath = path.join(dir, 'providers.json');
    configPath = path.join(dir, 'config.json');
    writeJson(catalogPath, makeCatalog());
    writeJson(configPath, { providers: {} });
    now = 1756500000000; // фиксированное «сейчас»
  });

  function makeManager({ fetchImpl, config = {}, reloadCalls } = {}) {
    return new ModelManager({
      dbPath, catalogPath, configPath,
      keys: { openrouter: 'or_key' },
      fetchImpl: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
      config: { autoAdd: true, recheckDisabledDays: 7, ...config },
      reload: () => { if (reloadCalls) reloadCalls.push(1); },
      now: () => now,
      log: () => {},
    });
  }

  it('seed: enabled→untested, disabled→user-disabled (выбор пользователя уважается)', () => {
    writeJson(configPath, { providers: { 'or-known:free': { enabled: false } } });
    const mgr = makeManager();
    mgr.seed();
    assert.equal(mgr.db.all().length, 2);
    assert.equal(mgr.db.get('or-known:free').status, 'user-disabled', 'user choice respected');
    assert.equal(mgr.db.get('or-dying:free').status, 'untested');
    assert.equal(mgr.db.get('or-known:free').seeded, true, 'seeded flag для write-back');
  });

  it('checkExisting: 404 → dead + disabled in config.json', async () => {
    const fetchImpl = async (url, opts = {}) => {
      if (opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        if (body.model === 'vendor/dying:free') return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr = makeManager({ fetchImpl });
    await mgr.runCycle();
    assert.equal(mgr.db.get('or-dying:free').status, 'dead');
    const cfg = readJson(configPath);
    assert.equal(cfg.providers['or-dying:free'].enabled, false, 'disabled in config');
    assert.equal(cfg.providers['or-known:free'], undefined, 'healthy untouched');
    // статус в db — dead, перепроверится позже
  });

  it('recheckDisabled: dead + старше N дней + тест ok → активирован, enabled снят', async () => {
    // 1-й цикл: dying умирает (404)
    const failFetch = async (url, opts = {}) => {
      if (opts.method === 'POST') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr1 = makeManager({ fetchImpl: failFetch });
    await mgr1.runCycle();
    assert.equal(mgr1.db.get('or-dying:free').status, 'dead');

    // имитируем прошлое время: lastCheckedAt = now - 8 дней
    const dbRaw = readJson(dbPath);
    dbRaw.models['or-dying:free'].lastCheckedAt = now - 8 * 86400000;
    writeJson(dbPath, dbRaw);

    // 2-й цикл: модель ожила
    const okFetch = async (url, opts = {}) => {
      if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr2 = makeManager({ fetchImpl: okFetch });
    await mgr2.runCycle();
    assert.equal(mgr2.db.get('or-dying:free').status, 'active', 're-enabled');
    const cfg = readJson(configPath);
    assert.notEqual(cfg.providers?.['or-dying:free']?.enabled, false, 'enabled:false снят');
  });

  it('recheckDisabled: свежий dead не перепроверяется, user-disabled не трогается', async () => {
    // dying умирает сейчас (свежий lastCheckedAt)
    const failFetch = async (url, opts = {}) => {
      if (opts.method === 'POST') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr1 = makeManager({ fetchImpl: failFetch });
    await mgr1.runCycle();

    // known — user-disabled
    const dbRaw = readJson(dbPath);
    dbRaw.models['or-known:free'].status = 'user-disabled';
    writeJson(dbPath, dbRaw);

    let postCalls = 0;
    const okFetch = async (url, opts = {}) => {
      if (opts.method === 'POST') postCalls++;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const mgr2 = makeManager({ fetchImpl: okFetch });
    await mgr2.runCycle();
    assert.equal(postCalls, 0, 'ни один POST не сделан: dead свежий, user-disabled не проверяется');
    assert.equal(mgr2.db.get('or-known:free').status, 'user-disabled');
  });

  it('scanAndAdd: новый кандидат ok → в db + каталог; 429 → мимо', async () => {
    const fetchImpl = async (url, opts = {}) => {
      if (opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return body.model === 'vendor/new1:free'
          ? { ok: true, status: 200, json: async () => ({}) }
          : { ok: false, status: 429, json: async () => ({}) };
      }
      if (url.includes('openrouter')) return {
        ok: true, status: 200,
        json: async () => ({ data: [
          { id: 'vendor/new1:free', context_length: 128000 },
          { id: 'vendor/new2:free', context_length: 32000 },
        ] }),
      };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr = makeManager({ fetchImpl });
    const summary = await mgr.runCycle();
    assert.equal(summary.added, 1);
    assert.ok(mgr.db.get('or-new1-free'), 'new1 в db');
    assert.equal(mgr.db.get('or-new1-free').status, 'active');
    assert.equal(mgr.db.get('or-new1-free').contextWindow, 128000);
    assert.equal(mgr.db.get('or-new2-free'), null, '429 не добавлен');

    const catalog = readJson(catalogPath);
    const entry = catalog['or-new1-free'];
    assert.ok(entry, 'в каталоге');
    assert.equal(entry.model, 'vendor/new1:free');
    assert.equal(entry.dailyLimit, 50);
    assert.equal(entry.envVar, 'PROVIDER_OPENROUTER_APIKEY');
    assert.equal(entry.free, true);
    assert.ok(entry.category);
  });

  it('autoAdd=false: тестирует, но ничего не пишет', async () => {
    const fetchImpl = async (url, opts = {}) => {
      if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({}) };
      if (url.includes('openrouter')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'vendor/newx:free', context_length: 64000 }] }) };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr = makeManager({ fetchImpl, config: { autoAdd: false } });
    const summary = await mgr.runCycle();
    assert.equal(summary.added, 0, 'не добавлено');
    assert.equal(mgr.db.all().length, 2, 'db не выросла');
    const catalog = readJson(catalogPath);
    assert.equal(Object.keys(catalog).length, 2, 'каталог не вырос');
  });

  it('runCycle single-flight: второй вызов во время первого → skipped', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const fetchImpl = async (url, opts = {}) => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr = makeManager({ fetchImpl });
    const first = mgr.runCycle();
    const second = await mgr.runCycle();
    assert.equal(second.skipped, true, 'второй пропущен');
    release();
    const s1 = await first;
    assert.ok(!s1.skipped);
  });

  it('writeBackPriorities: сортировка по скору в категории, чужие priority не тронуты', async () => {
    // db: два coding-моделя с разными скорами + один manual в каталоге
    const mgr = makeManager();
    await mgr.runCycle(); // seed
    mgr.db.upsert({ key: 'or-strong', model: 'v/strong:free', endpoint: 'https://openrouter.ai/api/v1/chat/completions', source: 'openrouter', category: 'coding', contextWindow: 1000000, status: 'active' });
    mgr.db.upsert({ key: 'or-weak', model: 'v/weak:free', endpoint: 'https://openrouter.ai/api/v1/chat/completions', source: 'openrouter', category: 'coding', contextWindow: 8000, status: 'active' });
    mgr.db.markChecked('or-strong', { ok: true, status: 200, latencyMs: 100 }, { now });
    mgr.db.markChecked('or-weak', { ok: true, status: 200, latencyMs: 4000 }, { now });
    // managed-ключи присутствуют и в каталоге (как после scanAndAdd)
    const cat0 = readJson(catalogPath);
    cat0['or-strong'] = { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'v/strong:free', priority: 99, envVar: 'PROVIDER_OPENROUTER_APIKEY' };
    cat0['or-weak'] = { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'v/weak:free', priority: 99, envVar: 'PROVIDER_OPENROUTER_APIKEY' };
    // manual-ключ в каталоге без db-записи
    cat0['manual-model'] = { endpoint: 'https://x', model: 'm/x', priority: 42 };
    writeJson(catalogPath, cat0);

    const changed = mgr.writeBackPriorities();
    assert.equal(changed, true);
    const after = readJson(catalogPath);
    const strong = after['or-strong'].priority, weak = after['or-weak'].priority;
    assert.ok(strong < weak, `strong(${strong}) < weak(${weak})`);
    assert.equal(after['manual-model'].priority, 42, 'manual не тронут');
    assert.equal(after['or-known:free'].priority, 7, 'seeded ключ сохранил priority до пересчёта своей категории');
  });

  it('reload вызывается только при изменениях', async () => {
    const reloadCalls = [];
    // цикл без изменений: всё ок, новых нет
    const okFetch = async (url, opts = {}) => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
    const mgr1 = makeManager({ fetchImpl: okFetch, reloadCalls });
    await mgr1.runCycle();
    assert.equal(reloadCalls.length, 0, 'ничего не изменилось → reload не нужен');

    // цикл с новым моделью → reload
    const scanFetch = async (url, opts = {}) => {
      if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({}) };
      if (url.includes('openrouter')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'vendor/fresh:free' }] }) };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const mgr2 = makeManager({ fetchImpl: scanFetch, reloadCalls });
    await mgr2.runCycle();
    assert.equal(reloadCalls.length, 1, 'добавление → reload');
  });
});

describe('isAutoAddable', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../lib/modelmanager')];
    ({ isAutoAddable } = require('../lib/modelmanager'));
  });

  it('accepts :free models always', () => {
    assert.equal(isAutoAddable({ model: 'vendor/foo:free', source: 'openrouter' }), true);
    assert.equal(isAutoAddable({ model: 'minimax/minimax-m3:free', source: 'openrouter' }), true);
  });

  it('accepts known free families from native sources', () => {
    assert.equal(isAutoAddable({ model: 'qwen/qwen3.8-27b', source: 'groq' }), true);
    assert.equal(isAutoAddable({ model: 'google/gemma-4-31b-it', source: 'cerebras' }), true);
    assert.equal(isAutoAddable({ model: 'nvidia/nemotron-3-super-120b-a12b', source: 'nim' }), true);
  });

  it('rejects paid models (deepseek-v4-pro, glm paid)', () => {
    assert.equal(isAutoAddable({ model: 'deepseek-v4-pro', source: 'deepseek' }), false, 'deepseek-v4-pro платная');
    assert.equal(isAutoAddable({ model: 'zai-org/GLM-5.2', source: 'huggingface' }), false, 'GLM-5.2 платная (не family)');
    assert.equal(isAutoAddable({ model: 'mistral-medium', source: 'huggingface' }), false, 'mistral-medium платная');
  });

  it('rejects unknown/opaque models from low-limit sources', () => {
    assert.equal(isAutoAddable({ model: 'something/opaque-model', source: 'huggingface' }), false);
    assert.equal(isAutoAddable({ model: 'weird/unknown-xl', source: 'nim' }), false);
  });
});

describe('inferSource', () => {
  let inferSource;
  beforeEach(() => {
    ({ inferSource } = require('../lib/modelmanager'));
  });

  it('maps new providers by envVar', () => {
    assert.equal(inferSource({ envVar: 'PROVIDER_SAMBANOVA_APIKEY' }), 'sambanova');
    assert.equal(inferSource({ envVar: 'PROVIDER_SILICONFLOW_APIKEY' }), 'siliconflow');
    assert.equal(inferSource({ envVar: 'PROVIDER_DEEPINFRA_APIKEY' }), 'deepinfra');
    assert.equal(inferSource({ envVar: 'PROVIDER_HYPERBOLIC_APIKEY' }), 'hyperbolic');
    assert.equal(inferSource({ envVar: 'PROVIDER_COHERE_APIKEY' }), 'cohere');
    assert.equal(inferSource({ envVar: 'PROVIDER_LLM7_APIKEY' }), 'llm7');
    assert.equal(inferSource({ envVar: 'PROVIDER_NARA_APIKEY' }), 'nara');
  });

  it('maps new providers by endpoint', () => {
    assert.equal(inferSource({ endpoint: 'https://api.sambanova.ai/v1/chat/completions' }), 'sambanova');
    assert.equal(inferSource({ endpoint: 'https://api.siliconflow.com/v1/chat/completions' }), 'siliconflow');
    assert.equal(inferSource({ endpoint: 'https://api.deepinfra.com/v1/openai/chat/completions' }), 'deepinfra');
    assert.equal(inferSource({ endpoint: 'https://api.hyperbolic.xyz/v1/chat/completions' }), 'hyperbolic');
  });

  it('keeps legacy sources', () => {
    assert.equal(inferSource({ endpoint: 'https://api.groq.com/openai/v1/chat/completions' }), 'groq');
    assert.equal(inferSource({ envVar: 'PROVIDER_OPENROUTER_APIKEY' }), 'openrouter');
  });

  it('falls back to unknown', () => {
    assert.equal(inferSource({ endpoint: 'https://something.else/v1' }), 'unknown');
  });
});
