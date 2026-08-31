// test/onboarding.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function loadFresh() {
  delete require.cache[require.resolve('../lib/onboarding')];
  return require('../lib/onboarding');
}

describe('onboarding', () => {
  it('snippetCursor builds valid OpenAI-compatible config', () => {
    const o = loadFresh();
    const s = o.snippetCursor('http://localhost:4000', 'secret');
    assert.ok(s.includes('http://localhost:4000/v1'), 'base url present');
    assert.ok(s.includes('secret'), 'api key present');
  });

  it('snippetOpencode builds valid opencode.json block', () => {
    const o = loadFresh();
    const s = o.snippetOpencode('http://localhost:4000', 'secret');
    assert.ok(s.includes('@ai-sdk/openai-compatible'), 'provider npm present');
    assert.ok(s.includes('"baseURL": "http://localhost:4000/v1"'), 'base url correct');
    assert.ok(s.includes('"apiKey": "secret"'), 'api key present');
    assert.ok(s.includes('"$schema"'), 'schema present');
  });

  it('snippetCline sets OpenAI-compatible provider', () => {
    const o = loadFresh();
    const s = o.snippetCline('http://localhost:4000', 'secret');
    assert.ok(s.includes('OpenAI Compatible'), 'provider mode');
    assert.ok(s.includes('http://localhost:4000/v1'), 'base url');
  });

  it('profiles covers 4 roles with prefer categories', () => {
    const o = loadFresh();
    const p = o.profiles();
    assert.equal(p.length, 4);
    assert.ok(p.some((x) => x.id === 'coder' && x.prefer.includes('coding')));
    assert.ok(p.some((x) => x.id === 'designer' && x.prefer.includes('design')));
  });
});
