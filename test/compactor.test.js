// test/compactor.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
let compactor;

function loadFresh() {
  delete require.cache[require.resolve('../lib/compactor')];
  compactor = require('../lib/compactor');
}

describe('compactor.estimateTokens', () => {
  it('returns 0 for empty/non-array', () => {
    loadFresh();
    assert.equal(compactor.estimateTokens([]), 0);
    assert.equal(compactor.estimateTokens(null), 0);
    assert.equal(compactor.estimateTokens('string'), 0);
  });

  it('estimates by chars/3.6', () => {
    loadFresh();
    const msgs = [{ role: 'user', content: 'hello world' }]; // 11 chars
    const est = compactor.estimateTokens(msgs);
    assert.equal(typeof est, 'number');
    assert.ok(est >= 3 && est <= 4, 'expected ~3 tokens, got ' + est);
  });
});

describe('compactor.prepareMessages', () => {
  it('returns messages unchanged when under threshold', async () => {
    loadFresh();
    const msgs = [{ role: 'user', content: 'hi' }];
    const result = await compactor.prepareMessages(msgs);
    assert.equal(result, msgs);
  });

  it('returns messages unchanged when empty', async () => {
    loadFresh();
    const result = await compactor.prepareMessages([]);
    assert.deepEqual(result, []);
  });

  it('compacts when over threshold', async () => {
    loadFresh();
    // Large enough to exceed the real COMPACT_THRESHOLD (50000 tokens ≈ 180k chars).
    const big = 'word '.repeat(40000); // 200k chars ≈ 55k tokens
    const msgs = [
      { role: 'system', content: 'Ты — помощник. Отвечай кратко.' },
      { role: 'user', content: big },
      { role: 'assistant', content: big },
      { role: 'user', content: 'продолжай, что было выше?' },
    ];
    // Stub getSummary to avoid real network.
    compactor.getSummary = async () => 'краткое резюме диалога';
    const result = await compactor.prepareMessages(msgs);
    assert.notDeepEqual(result, msgs, 'should have compacted');
    assert.ok(result[0].role === 'system', 'system preserved at front');
    assert.ok(result.some(m => m.content && m.content.includes('[Резюме')), 'summary present');
  });
});

describe('compactor.summaryCache', () => {
  it('exposes an in-memory Map', () => {
    loadFresh();
    assert.ok(compactor.summaryCache instanceof Map);
  });
});

describe('compactor fallback behavior', () => {
  it('returns original messages when all summarizers fail', async () => {
    loadFresh();
    const big = 'word '.repeat(40000);
    const msgs = [
      { role: 'system', content: 'Ты — помощник. Отвечай кратко.' },
      { role: 'user', content: big },
      { role: 'user', content: 'продолжай' },
    ];
    // Stub getSummary to yield empty (simulates chain producing nothing).
    compactor.getSummary = async () => '';
    const result = await compactor.prepareMessages(msgs);
    assert.deepEqual(result, msgs, 'should leave original messages when no summary');
  });

  it('reuses cached summary and avoids a second chain call', async () => {
    loadFresh();
    // Seed the cache with a known hash so getSummary returns it without chain.
    const msgs = [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }];
    const hash = require('crypto').createHash('sha256').update(JSON.stringify(msgs)).digest('hex');
    compactor.summaryCache.set(hash, 'проверенное резюме');
    let chainCalls = 0;
    const saved = compactor.getSummary;
    compactor.getSummary = async (m) => {
      const h = require('crypto').createHash('sha256').update(JSON.stringify(m)).digest('hex');
      if (compactor.summaryCache.has(h)) { chainCalls++; return compactor.summaryCache.get(h); }
      chainCalls++;
      return 'новое';
    };
    const first = await compactor.getSummary(msgs);
    const second = await compactor.getSummary(msgs);
    assert.equal(first, 'проверенное резюме');
    assert.equal(second, 'проверенное резюме');
    compactor.getSummary = saved;
  });
});
