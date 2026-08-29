// test/cache.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { LRUCache } = require('../lib/cache');

function freshCache() {
  return new LRUCache(20, 60000, true, true); // skip load, useNormalize on
}

describe('LRUCache.getSemantic', () => {
  it('hits a near-duplicate rephrase of a cached dialog', () => {
    const c = freshCache();
    c.set('codestral', [{ role: 'user', content: 'исправь ошибку в коде ниже' }], 0.2, { answer: 'fixed' });
    const hit = c.getSemantic('codestral', [{ role: 'user', content: 'исправь ошибку в коде ниже пожалуйста' }], 0.2, 0.5);
    assert.ok(hit, 'expected a semantic hit');
    assert.deepEqual(hit.value, { answer: 'fixed' });
    assert.ok(hit.similarity >= 0.5);
  });

  it('misses when similarity below threshold', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'как дела' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: 'напиши стих' }], 0, 0.9);
    assert.equal(miss, null);
  });

  it('misses when model differs', () => {
    const c = freshCache();
    c.set('model-a', [{ role: 'user', content: 'привет мир как дела' }], 0, { a: 1 });
    const miss = c.getSemantic('model-b', [{ role: 'user', content: 'привет мир как дела' }], 0, 0.5);
    assert.equal(miss, null);
  });

  it('misses when temperature differs', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'привет мир как дела' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: 'привет мир как дела ' }], 1.0, 0.5);
    assert.equal(miss, null);
  });

  it('skips code-looking requests', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'исправь function foo() { return 1; }' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: 'исправь function foo() { return 2; }' }], 0, 0.5);
    assert.equal(miss, null);
  });

  it('skips tool-state messages', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'hello world today' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [
      { role: 'user', content: 'hello world today' },
      { role: 'tool', content: '{report: "x"}', tool_call_id: 't1' },
    ], 0, 0.5);
    assert.equal(miss, null);
  });

  it('skips non-string content arrays', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'hello world today' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [
      { role: 'user', content: [{ type: 'text', text: 'hello world today' }] },
    ], 0, 0.5);
    assert.equal(miss, null);
  });

  it('returns null when normalized text is empty', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } }] }], 0, 0.5);
    assert.equal(miss, null);
  });

  it('bumps semHits and stats', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'продолжай работу над проектом пожалуйста' }], 0.1, { ok: true });
    c.getSemantic('m', [{ role: 'user', content: 'продолжай работу над проектом' }], 0.1, 0.5);
    assert.equal(c.stats().semHits, 1);
  });

  it('increments misses (not hits) on a semantic miss', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'hello world foo bar baz' }], 0, { ok: true });
    c.getSemantic('m', [{ role: 'user', content: 'совершенно другая тема' }], 0, 0.99);
    const s = c.stats();
    assert.equal(s.semHits, 0);
    assert.equal(s.misses, 1);
  });
});

describe('LRUCache grams persistence', () => {
  it('persists grams/model/temperature and restores them on load', () => {
    // Write through the module's own CACHE_PATH (same pattern as proxy.test.js).
    const c = new LRUCache(20, 60000, true, true);
    c.set('persist-model', [{ role: 'user', content: 'напиши резюме проекта полностью' }], 0.7, { ok: true });
    c.persist();

    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache.json'), 'utf8'));
    const entry = (data.entries || []).find(e => e.model === 'persist-model');
    assert.ok(entry, 'entry persisted with model');
    assert.equal(entry.temperature, 0.7);
    assert.ok(Array.isArray(entry.grams) && entry.grams.length > 0, 'grams persisted');

    try { fs.unlinkSync(path.join(__dirname, '..', 'cache.json')); } catch {}
  });
});

// The auto-persist interval keeps the event loop alive; stop it so the
// process can exit (same pattern as proxy.test.js).
require('../lib/cache')._stopTimers();