// test/modelscan.test.js — все сетевые вызовы мокаются через fetchImpl.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let scan;

function loadFresh() {
  delete require.cache[require.resolve('../lib/modelscan')];
  scan = require('../lib/modelscan');
}

function mockFetch(responses) {
  // responses: Map url → { ok, status, body } | Error; body — что вернёт res.json()
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    const r = responses.get ? responses.get(url) : responses[url];
    if (r instanceof Error) throw r;
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

describe('modelscan.isJunkModel', () => {
  beforeEach(loadFresh);

  it('flags embeddings/rerank/audio/guardrail/image junk', () => {
    for (const id of [
      'vendor/text-embedding-3', 'vendor/rerank-v2', 'openai/whisper-large',
      'vendor/guard-model', 'nvidia/content-safety', 'vendor/tts-1',
      'stability/sd-xl', 'black-forest/flux', 'vendor/image-gen',
      'models/gemini-3.5-transcribe', 'nvidia/riva-translate-4b',
      'models/lyria-3-clip-preview', 'models/nano-banana-pro-preview',
      'models/gemini-robotics-er-1.6-preview', 'models/gemini-2.5-computer-use-preview',
      'nvidia/ising-calibration-1.5-31b', 'vendor/realtime-audio',
    ]) {
      assert.equal(scan.isJunkModel(id), true, id + ' should be junk');
    }
  });

  it('keeps normal chat models', () => {
    for (const id of [
      'qwen/qwen3.6-27b:free', 'mistralai/codestral-latest', 'deepseek/deepseek-v4',
      'meta-llama/llama-3.1-8b-instruct', 'openai/gpt-oss-120b',
      'moonshotai/kimi-k3', 'devstral-2512', 'poolside/laguna-xs-2.1',
    ]) {
      assert.equal(scan.isJunkModel(id), false, id + ' should be kept');
    }
  });

  it('normalizeModelId strips models/ prefix for gemini only', () => {
    assert.equal(scan.normalizeModelId('models/gemini-3.6-flash', 'gemini'), 'gemini-3.6-flash');
    assert.equal(scan.normalizeModelId('vendor/foo', 'openrouter'), 'vendor/foo');
    assert.equal(scan.normalizeModelId('models/foo', 'nim'), 'models/foo');
  });
});

describe('modelscan.classifyModel', () => {
  beforeEach(loadFresh);

  it('coding by id (codestral/coder/code/devstral)', () => {
    assert.equal(scan.classifyModel('mistralai/codestral-latest'), 'coding');
    assert.equal(scan.classifyModel('qwen/qwen3-coder-30b'), 'coding');
  });

  it('reasoning by id (r1/qwq/think/reason)', () => {
    assert.equal(scan.classifyModel('deepseek/deepseek-r1:free'), 'reasoning');
    assert.equal(scan.classifyModel('qwen/qwq-32b'), 'reasoning');
  });

  it('vision by id (-vl/vision/omni) or description', () => {
    assert.equal(scan.classifyModel('qwen/qwen3-vl-30b'), 'vision');
    assert.equal(scan.classifyModel('vendor/omni-chat'), 'vision');
    assert.equal(scan.classifyModel('vendor/plain', 'supports image input'), 'vision');
  });

  it('default general', () => {
    assert.equal(scan.classifyModel('vendor/plain-chat'), 'general');
  });
});

describe('modelscan.scanSources', () => {
  beforeEach(loadFresh);

  it('openrouter adapter returns only :free non-existing models with normalized fields', async () => {
    const fetchImpl = mockFetch({
      'https://openrouter.ai/api/v1/models': {
        body: { data: [
          { id: 'vendor/new-free:free', context_length: 64000, description: 'chat model' },
          { id: 'vendor/paid', context_length: 32000 },
          { id: 'vendor/known:free', context_length: 8000 },
        ] },
      },
    });
    const out = await scan.scanSources({
      sources: ['openrouter'],
      keys: {},
      fetchImpl,
      existing: new Set(['vendor/known:free']),
    });
    assert.equal(out.length, 1);
    const c = out[0];
    assert.equal(c.model, 'vendor/new-free:free');
    assert.equal(c.source, 'openrouter');
    assert.equal(c.contextWindow, 64000);
    assert.equal(c.dailyLimit, 50);
    assert.ok(c.endpoint.includes('/chat/completions'));
  });

  it('native source adapter (groq) uses key header and default limits', async () => {
    const fetchImpl = mockFetch({
      'https://api.groq.com/openai/v1/models': {
        body: { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }] },
      },
    });
    const out = await scan.scanSources({ sources: ['groq'], keys: { groq: 'gk_test' }, fetchImpl, existing: new Set() });
    assert.equal(out.length, 1, 'whisper filtered as junk');
    assert.equal(out[0].model, 'llama-3.3-70b-versatile');
    assert.equal(out[0].source, 'groq');
    const call = fetchImpl.calls.find(c => c.url.includes('groq'));
    assert.equal(call.headers.Authorization, 'Bearer gk_test');
  });

  it('dedups same model id across sources (first source wins)', async () => {
    const fetchImpl = mockFetch({
      'https://api.groq.com/openai/v1/models': { body: { data: [{ id: 'dup/model-x' }] } },
      'https://api.mistral.ai/v1/models': { body: { data: [{ id: 'dup/model-x' }] } },
    });
    const out = await scan.scanSources({ sources: ['groq', 'mistral'], keys: { groq: 'g', mistral: 'm' }, fetchImpl, existing: new Set() });
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'groq');
  });

  it('HF adapter without key returns [] without throwing', async () => {
    const out = await scan.scanSources({ sources: ['huggingface'], keys: {}, fetchImpl: mockFetch({}), existing: new Set() });
    assert.deepEqual(out, []);
  });

  it('source fetch failure → skipped, others still scanned', async () => {
    const fetchImpl = mockFetch({
      'https://api.groq.com/openai/v1/models': new Error('network down'),
      'https://api.mistral.ai/v1/models': { body: { data: [{ id: 'mistralai/small' }] } },
    });
    const out = await scan.scanSources({ sources: ['groq', 'mistral'], keys: { groq: 'g', mistral: 'm' }, fetchImpl, existing: new Set() });
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'mistral');
  });

  it('unknown source name is ignored', async () => {
    const out = await scan.scanSources({ sources: ['nope'], keys: {}, fetchImpl: mockFetch({}), existing: new Set() });
    assert.deepEqual(out, []);
  });
});

describe('modelscan.testModel', () => {
  beforeEach(loadFresh);

  it('200 → ok true with latency', async () => {
    const fetchImpl = mockFetch({ 'https://x/chat': { data: {} } });
    const r = await scan.testModel('https://x/chat', 'm', 'key', { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.ok(r.latencyMs >= 0);
  });

  it('non-200 → ok false with status', async () => {
    const fetchImpl = mockFetch({ 'https://x/chat': { ok: false, status: 429, data: {} } });
    const r = await scan.testModel('https://x/chat', 'm', 'key', { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.status, 429);
  });

  it('network error/timeout → ok false status 0', async () => {
    const fetchImpl = mockFetch({ 'https://x/chat': new Error('boom') });
    const r = await scan.testModel('https://x/chat', 'm', 'key', { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
  });
});

describe('modelscan.testCandidates', () => {
  beforeEach(loadFresh);

  it('tests all candidates respecting concurrency limit', async () => {
    let inFlight = 0, maxInFlight = 0;
    const fetchImpl = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      model: 'm/' + i, source: 'openrouter', endpoint: 'https://x/chat', dailyLimit: 50,
    }));
    const results = await scan.testCandidates(candidates, { keys: {}, fetchImpl, concurrency: 3 });
    assert.equal(results.length, 7);
    assert.ok(results.every(r => r.test.ok));
    assert.ok(maxInFlight <= 3, 'max in-flight ' + maxInFlight + ' <= 3');
    assert.ok(maxInFlight > 1, 'actually parallel');
  });

  it('empty candidates → []', async () => {
    const results = await scan.testCandidates([], { keys: {}, fetchImpl: mockFetch({}), concurrency: 3 });
    assert.deepEqual(results, []);
  });
});
