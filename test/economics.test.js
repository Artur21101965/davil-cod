// test/economics.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let econ;

beforeEach(() => {
  delete require.cache[require.resolve('../lib/economics')];
  econ = require('../lib/economics');
});

describe('economics.costOfTokens', () => {
  it('0 tokens → $0', () => {
    const c = econ.costOfTokens(0, 0);
    assert.equal(c.usd, 0);
  });

  it('1M input @$3/M → $3', () => {
    const c = econ.costOfTokens(1000000, 0);
    assert.equal(c.inputUsd, 3);
    assert.equal(c.usd, 3);
  });

  it('1M output @$15/M → $15', () => {
    const c = econ.costOfTokens(0, 1000000);
    assert.equal(c.outputUsd, 15);
    assert.equal(c.usd, 15);
  });

  it('$500K in + 100K out', () => {
    const c = econ.costOfTokens(500000, 100000);
    assert.ok(Math.abs(c.usd - (1.5 + 1.5)) < 1e-9, 'вход 1.5 + выход 1.5');
  });
});

describe('economics.aggregateSavings', () => {
  it('empty tokenUsage → zeros', () => {
    const s = econ.aggregateSavings({});
    assert.equal(s.totalTokens, 0);
    assert.equal(s.savedUsd, 0);
  });

  it('sums across providers and returns money saved', () => {
    const s = econ.aggregateSavings({
      'groq-gpt': { promptTokens: 1000000, completionTokens: 0, totalTokens: 1000000 },
      'mistral-codestral': { promptTokens: 0, completionTokens: 1000000, totalTokens: 1000000 },
    });
    assert.equal(s.totalTokens, 2000000);
    // $3 (in) + $15 (out)
    assert.ok(Math.abs(s.savedUsd - 18) < 1e-9);
  });

  it('exposes pricing basis', () => {
    const s = econ.aggregateSavings({ x: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 } });
    assert.ok(s.basis.includes('input $3/M'), 'basis назван');
    assert.ok(s.costPerMOutput > 0);
  });
});
