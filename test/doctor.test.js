// test/doctor.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function loadFresh() {
  delete require.cache[require.resolve('../lib/doctor')];
  return require('../lib/doctor');
}

const catalog = {
  'groq-gpt': { envVar: 'PROVIDER_GROQ_APIKEY' },
  'groq-qwen': { envVar: 'PROVIDER_GROQ_APIKEY' },
  'openrouter-hermes': { envVar: 'PROVIDER_OPENROUTER_APIKEY' },
  'mistral-codestral': { envVar: 'PROVIDER_MISTRAL_APIKEY' },
};

const modelDb = {
  models: {
    'groq-gpt': { status: 'active', source: 'groq', model: 'llama-3.3-70b' },
    'groq-qwen': { status: 'active', source: 'groq', model: 'qwen/qwen3-6.27b' },
    'or-nemotron-550b': { status: 'user-disabled', source: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    'nim-deepseek': { status: 'user-disabled', source: 'nim', model: 'deepseek-ai/deepseek-v4-flash-0731' },
    'dead-model': { status: 'dead', source: 'groq', model: 'x' },
  },
};

const keys = { PROVIDER_GROQ_APIKEY: 'gsk_abcdef', PROVIDER_OPENROUTER_APIKEY: '', PROVIDER_MISTRAL_APIKEY: 'AiXyz' };

describe('doctor', () => {
  it('snapshot groups providers by envVar and reads keys', () => {
    const d = loadFresh();
    const snap = d.snapshot({ catalog, modelDb, keysSource: { keys, envPath: '.env' } });
    assert.ok(snap.keyState['PROVIDER_GROQ_APIKEY'].hasKey, 'groq key present');
    assert.ok(!snap.keyState['PROVIDER_OPENROUTER_APIKEY'].hasKey, 'openrouter key missing');
    assert.equal(snap.catalogCount, 4);
    assert.equal(snap.keyState['PROVIDER_GROQ_APIKEY'].count, 2);
  });

  it('snapshot counts by status: active/disabled/unknown', () => {
    const d = loadFresh();
    const snap = d.snapshot({ catalog, modelDb, keysSource: { keys, envPath: '.env' } });
    assert.equal(snap.byStatus.active, 2, 'two active');
    assert.equal(snap.byStatus.disabled, 2, 'two user-disabled');
    assert.equal(snap.byStatus.unknown, 1, 'dead counts as unknown');
  });

  it('recommend: disabled free vs dead vs paid', () => {
    const d = loadFresh();
    const rec = d.recommend(modelDb.models);
    assert.deepEqual(rec.disabledByUser, ['or-nemotron-550b'], 'only free disabledByUser');
    assert.deepEqual(rec.dead, ['dead-model'], 'dead flagged');
    assert.deepEqual(rec.paid, ['nim-deepseek'], 'paid flagged');
  });

  it('easyStartKey points to OpenRouter', () => {
    const d = loadFresh();
    assert.equal(d.easyStartKey().envVar, 'PROVIDER_OPENROUTER_APIKEY');
  });
});
