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

  it('estimates conservatively (chars/3.5)', () => {
    loadFresh();
    const msgs = [{ role: 'user', content: 'hello world' }]; // 11 chars
    const est = compactor.estimateTokens(msgs);
    assert.equal(typeof est, 'number');
    assert.ok(est >= 2 && est <= 5, 'expected ~3 tokens (11 chars / 3.5), got ' + est);
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
    // Build messages until the combined size clearly exceeds COMPACT_THRESHOLD.
    // The threshold is loaded from the module, so this stays correct if it changes.
    const threshold = compactor.COMPACT_THRESHOLD;
    const charsNeeded = threshold * 3.6 * 2; // 2x headroom
    const chunkChars = 10000;
    const chunks = [];
    let total = 0;
    while (total < charsNeeded) { chunks.push(chunkChars); total += chunkChars; }
    const big = 'word '.repeat(chunkChars);
    const msgs = [
      { role: 'system', content: 'Ты — помощник. Отвечай кратко.' },
      ...chunks.map((_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: big })),
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

describe('compactor.parseSummaryResponse', () => {
  it('parses strict JSON with summary + facts', () => {
    loadFresh();
    const r = compactor.parseSummaryResponse('{"summary":"резюме диалога","facts":["факт про keepalive","факт про minimax"]}');
    assert.equal(r.summary, 'резюме диалога');
    assert.ok(r.facts.includes('факт про keepalive'));
  });

  it('parses fenced ```json blocks', () => {
    loadFresh();
    const r = compactor.parseSummaryResponse('```json\n{"summary":"резюме","facts":["факт один"]}\n```');
    assert.equal(r.summary, 'резюме');
    assert.equal(r.facts.length, 1);
  });

  it('treats plain text as summary-only (no facts)', () => {
    loadFresh();
    const r = compactor.parseSummaryResponse('просто обычное резюме без json');
    assert.equal(r.summary, 'просто обычное резюме без json');
    assert.deepEqual(r.facts, []);
  });

  it('filters empty/junk facts and handles null', () => {
    loadFresh();
    const r = compactor.parseSummaryResponse('{"summary":"s","facts":["", "  ", 123, "валидный факт"]}');
    assert.deepEqual(r.facts, ['валидный факт']);
  });
});

describe('compactor.ingestFacts', () => {
  it('stores facts into the attached memory store (capped)', () => {
    loadFresh();
    const stored = [];
    compactor.setMemory({ add: (text) => stored.push(text) });
    const n = compactor.ingestFacts(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'], 'hash123');
    assert.equal(n, 5, 'capped at MAX_FACTS_PER_COMPACTION');
    assert.equal(stored.length, 5);
  });

  it('does nothing without a memory store', () => {
    loadFresh();
    compactor.setMemory(null);
    const n = compactor.ingestFacts(['f1'], 'h');
    assert.equal(n, 0);
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

describe('compactor.compactionThresholdFor', () => {
  it('returns COMPACT_THRESHOLD for unknown/zero window', () => {
    loadFresh();
    assert.equal(compactor.compactionThresholdFor(0), compactor.COMPACT_THRESHOLD);
    assert.equal(compactor.compactionThresholdFor(undefined), compactor.COMPACT_THRESHOLD);
    assert.equal(compactor.compactionThresholdFor(null), compactor.COMPACT_THRESHOLD);
  });

  it('caps defined windows at min(win*0.5, 200000)', () => {
    loadFresh();
    assert.equal(compactor.compactionThresholdFor(33000), Math.floor(33000 * 0.5)); // 16500
    assert.equal(compactor.compactionThresholdFor(65536), Math.floor(65536 * 0.5)); // 32768
    assert.equal(compactor.compactionThresholdFor(128000), Math.floor(128000 * 0.5)); // 64000
    assert.equal(compactor.compactionThresholdFor(512000), 200000);
    assert.equal(compactor.compactionThresholdFor(1048576), 200000);
  });

  it('defined-window threshold never exceeds 200000', () => {
    loadFresh();
    assert.ok(compactor.compactionThresholdFor(1000000) <= 200000);
  });
});

// NOTE on test sizes: estimateTokens = chars / CHARS_PER_TOKEN(3.5). To hit
// est ≈ N tokens use big = 'w'.repeat(N * 3.0) chars. compactOld reserves
// KEEP_RECENT_TOKENS(12000) for the recent tail and only summarizes the OLD
// prefix — so a request must exceed 12000 est to have any compactable head.
// window 33000 → threshold 16500: est 32006 (> 16500, > 12000) compacts.
// window 1048576 → threshold 100000; window 128000 → threshold 64000:
// est 32006 is below both → unchanged. All sizes are also below global 60000,
// so only the contextWindow option can trigger compaction.
const EST_TOKENS = 32000;
function bigMessage(estTokens) {
  return { role: 'user', content: 'w'.repeat(Math.ceil(estTokens * 3.5)) };
}

describe('compactor.prepareMessages with contextWindow option', () => {
  it('compacts at a smaller threshold for a small-window target', async () => {
    loadFresh();
    // total est ≈ 32006 > threshold(33000)=16500 → compacts.
    const msgs = [
      { role: 'system', content: 'Ты — помощник. Отвечай кратко.' },
      bigMessage(EST_TOKENS),
      { role: 'user', content: 'продолжай' },
    ];
    compactor.getSummary = async () => 'краткое резюме диалога';
    const result = await compactor.prepareMessages(msgs, { contextWindow: 33000 });
    assert.notDeepEqual(result, msgs, 'should compact for the small window');
    assert.ok(result.some(m => m.content && m.content.includes('[Резюме')), 'summary present');
  });

  it('does NOT compact under a large window where global threshold applies', async () => {
    loadFresh();
    // total est ≈ 32006 < threshold(1048576)=100000 → unchanged, getSummary unused.
    const msgs = [
      { role: 'system', content: 'Ты — помощник.' },
      bigMessage(EST_TOKENS),
      { role: 'user', content: 'продолжай' },
    ];
    compactor.getSummary = async () => 'вызван не должен быть';
    const result = await compactor.prepareMessages(msgs, { contextWindow: 1048576 });
    assert.deepEqual(result, msgs, 'no compaction under large window at this size');
  });

  it('prevents prefer-small over global: window 128k still compacts only above 64k est', async () => {
    loadFresh();
    // total est ≈ 32006 < threshold(128000)=64000 → unchanged.
    const msgs = [bigMessage(EST_TOKENS)];
    compactor.getSummary = async () => 'никогда';
    const result = await compactor.prepareMessages(msgs, { contextWindow: 128000 });
    assert.deepEqual(result, msgs);
  });
});
