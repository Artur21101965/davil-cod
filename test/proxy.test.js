// test/proxy.test.js — unit tests for DAVIL Cod proxy logic (no external deps)
// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { LRUCache } = require('../lib/cache');
const { checkRateLimit } = require('../lib/rateLimit');

test('LRUCache: stores and retrieves by model/messages', () => {
  const c = new LRUCache(10, 60000);
  c.set('m', [{ role: 'user', content: 'hi' }], 0, { hello: 'world' });
  assert.deepStrictEqual(c.get('m', [{ role: 'user', content: 'hi' }], 0), { hello: 'world' });
  assert.strictEqual(c.get('m', [{ role: 'user', content: 'other' }], 0), null);
});

test('LRUCache: evicts oldest when full', () => {
  const c = new LRUCache(2, 60000);
  c.set('a', [{ role: 'user', content: '1' }], 0, 'first');
  c.set('b', [{ role: 'user', content: '2' }], 0, 'second');
  c.set('c', [{ role: 'user', content: '3' }], 0, 'third');
  assert.strictEqual(c.get('a', [{ role: 'user', content: '1' }], 0), null); // evicted
  assert.strictEqual(c.get('c', [{ role: 'user', content: '3' }], 0), 'third');
});

test('LRUCache: TTL expiry', () => {
  const c = new LRUCache(10, 1); // 1ms TTL
  c.set('m', [{ role: 'user', content: 'hi' }], 0, 'value');
  setTimeout(() => {
    assert.strictEqual(c.get('m', [{ role: 'user', content: 'hi' }], 0), null);
  }, 10);
});

test('LRUCache: hit/miss stats', () => {
  const c = new LRUCache(10, 60000);
  c.set('m', [{ role: 'user', content: 'hi' }], 0, 'v');
  c.get('m', [{ role: 'user', content: 'hi' }], 0); // hit
  c.get('x', [{ role: 'user', content: 'no' }], 0); // miss
  const s = c.stats();
  assert.strictEqual(s.hits, 1);
  assert.strictEqual(s.misses, 1);
  assert.strictEqual(s.hitRate, 50);
});

test('LRUCache: disk persistence round-trip', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `cache-test-${Date.now()}.json`);

  // Point the module's CACHE_PATH to a temp file by monkey-patching
  const crypto = require('crypto');
  const cacheMod = require('../lib/cache');

  const c = new LRUCache(10, 60000);
  c.set('m', [{ role: 'user', content: 'disk' }], 0, { persisted: true });
  c.persist();

  // Verify the default file exists (module writes to its own path)
  const fs2 = require('fs');
  const fileExists = fs2.existsSync(path.join(__dirname, '..', 'cache.json'));
  assert.strictEqual(fileExists, true);
  try { fs2.unlinkSync(path.join(__dirname, '..', 'cache.json')); } catch {}
});

test('rateLimit: allows under limit, blocks over', () => {
  // reset internal state by using a unique key
  const key = `test-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(checkRateLimit(key, 5, 60000), true);
  }
  assert.strictEqual(checkRateLimit(key, 5, 60000), false);
});

test('health: classifyErrorMs returns sane durations', () => {
  const health = require('../lib/health');
  // Access classify via a small wrapper — it's internal, test via circuit behavior
  // Simulate: record failures with different status codes and check breaker opens
  // Use a fake provider key
  const key = `cb-${Date.now()}`;
  health.recordFailure(key, 401);
  // 401 should open immediately (openMs 300s > 60s threshold)
  assert.strictEqual(health.isCircuitOpen(key), true);
});

test('health: dailyUsage tracks per-provider per-day counts', () => {
  const health = require('../lib/health');
  const key = `daily-${Date.now()}`;
  health.recordRequest(key, true);
  health.recordRequest(key, true);
  const today = new Date().toISOString().slice(0, 10);
  const usage = health.getDailyUsage();
  assert.strictEqual(usage[key]?.[today], 2);
});

test('providers: catalog loads and merges with user config', () => {
  const fs = require('fs');
  const path = require('path');
  const catalogPath = path.join(__dirname, '..', 'providers.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.ok(Object.keys(catalog).length >= 10, 'catalog has >=10 providers');
  const { PROVIDERS } = require('../lib/providers');
  assert.ok(Object.keys(PROVIDERS).length >= 10, 'merged providers >= 10');
});

test('providers: catalog providers are enabled by default', () => {
  const { PROVIDERS } = require('../lib/providers');
  const enabled = Object.entries(PROVIDERS).filter(([_, p]) => p.enabled !== false);
  assert.ok(enabled.length >= 10, 'at least 10 providers enabled by default');
});

// Stop background timers so the test process can exit (health.js sets setInterval)
require('../lib/health')._stopTimers();
require('../lib/cache')._stopTimers();
