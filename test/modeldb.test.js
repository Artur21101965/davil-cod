// test/modeldb.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ModelDB, computeScore;

function tmpPath() {
  return path.join(os.tmpdir(), `modeldb-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('ModelDB', () => {
  let dbPath;

  beforeEach(() => {
    delete require.cache[require.resolve('../lib/modeldb')];
    ({ ModelDB, computeScore } = require('../lib/modeldb'));
    dbPath = tmpPath();
  });

  it('starts empty when file missing', () => {
    const db = new ModelDB(dbPath);
    db.load();
    assert.equal(db.all().length, 0);
  });

  it('upsert + save + load round-trip preserves fields', () => {
    let db = new ModelDB(dbPath);
    db.load();
    db.upsert({
      key: 'or-foo', model: 'vendor/foo:free', source: 'openrouter',
      endpoint: 'https://x/chat', category: 'coding', contextWindow: 128000, dailyLimit: 50,
    });
    db.save();

    const db2 = new ModelDB(dbPath);
    db2.load();
    const m = db2.get('or-foo');
    assert.equal(m.model, 'vendor/foo:free');
    assert.equal(m.source, 'openrouter');
    assert.equal(m.category, 'coding');
    assert.equal(m.contextWindow, 128000);
    assert.equal(m.status, 'untested');
    assert.ok(m.addedAt > 0);
    assert.deepEqual(m.checkHistory, []);
  });

  it('upsert preserves existing fields on update (merge)', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e1', source: 'openrouter', category: 'coding' });
    db.markChecked('a', { ok: true, status: 200 }, { now: 500 });
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e1', source: 'openrouter', contextWindow: 32000 });
    const m = db.get('a');
    assert.equal(m.status, 'active', 'status preserved on merge');
    assert.equal(m.contextWindow, 32000);
    assert.equal(m.checkHistory.length, 1, 'history preserved');
  });

  it('upsert rejects invalid entries (no key/model/endpoint)', () => {
    const db = new ModelDB(dbPath);
    db.load();
    assert.equal(db.upsert(null), null);
    assert.equal(db.upsert({ key: 'x' }), null);
    assert.equal(db.upsert({ key: 'x', model: 'm' }), null);
    assert.equal(db.all().length, 0);
  });

  it('markChecked ok → active + lastOkAt + history entry', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e', source: 'openrouter' });
    db.markChecked('a', { ok: true, status: 200, latencyMs: 300 }, { now: 1000 });
    const m = db.get('a');
    assert.equal(m.status, 'active');
    assert.equal(m.lastOkAt, 1000);
    assert.equal(m.lastCheckedAt, 1000);
    assert.equal(m.checkHistory.length, 1);
    assert.equal(m.checkHistory[0].ok, true);
    assert.equal(m.checkHistory[0].latencyMs, 300);
  });

  it('markChecked 404/402 → dead', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e', source: 'openrouter' });
    db.markChecked('a', { ok: false, status: 404 }, { now: 1000 });
    assert.equal(db.get('a').status, 'dead');
    db.upsert({ key: 'b', model: 'm/b', endpoint: 'e', source: 'openrouter' });
    db.markChecked('b', { ok: false, status: 402 }, { now: 1000 });
    assert.equal(db.get('b').status, 'dead');
  });

  it('markChecked 429/transient keeps status, records failure', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e', source: 'openrouter' });
    db.markChecked('a', { ok: true, status: 200 }, { now: 500 });
    db.markChecked('a', { ok: false, status: 429 }, { now: 1000 });
    const m = db.get('a');
    assert.equal(m.status, 'active', '429 is transient');
    assert.equal(m.checkHistory.length, 2);
    assert.equal(m.checkHistory[1].ok, false);
  });

  it('markChecked never flips user-disabled status', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e', source: 'openrouter' });
    db.setStatus('a', 'user-disabled');
    db.markChecked('a', { ok: true, status: 200 }, { now: 1000 });
    assert.equal(db.get('a').status, 'user-disabled');
  });

  it('checkHistory capped at 20 entries', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e', source: 'openrouter' });
    for (let i = 1; i <= 25; i++) {
      db.markChecked('a', { ok: true, status: 200 }, { now: i * 1000 });
    }
    const m = db.get('a');
    assert.equal(m.checkHistory.length, 20);
    assert.equal(m.checkHistory[0].ts, 6000, 'oldest trimmed');
    assert.equal(m.checkHistory[19].ts, 25000);
  });

  it('markChecked on unknown key returns null', () => {
    const db = new ModelDB(dbPath);
    db.load();
    assert.equal(db.markChecked('ghost', { ok: true, status: 200 }), null);
  });

  it('save is atomic (no .tmp left behind, valid JSON after reload)', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e', source: 'openrouter' });
    db.save();
    db.save();
    assert.ok(!fs.existsSync(dbPath + '.tmp'), 'no tmp file left');
    const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(Object.keys(raw.models).length, 1);
    assert.ok(raw.updatedAt > 0);
  });

  it('corrupted file → empty db (no throw)', () => {
    fs.writeFileSync(dbPath, '{not json');
    const db = new ModelDB(dbPath);
    db.load();
    assert.equal(db.all().length, 0);
  });

  it('stats() counts by category/status/source', () => {
    const db = new ModelDB(dbPath);
    db.load();
    db.upsert({ key: 'a', model: 'm/a', endpoint: 'e', source: 'openrouter', category: 'coding' });
    db.upsert({ key: 'b', model: 'm/b', endpoint: 'e', source: 'groq', category: 'general' });
    db.markChecked('a', { ok: true, status: 200 }, { now: 1000 });
    const s = db.stats();
    assert.equal(s.total, 2);
    assert.equal(s.byCategory.coding, 1);
    assert.equal(s.byCategory.general, 1);
    assert.equal(s.byStatus.active, 1);
    assert.equal(s.byStatus.untested, 1);
    assert.equal(s.bySource.openrouter, 1);
    assert.equal(s.bySource.groq, 1);
  });
});

describe('computeScore', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../lib/modeldb')];
    ({ computeScore } = require('../lib/modeldb'));
  });

  it('perfect model scores 100', () => {
    const s = computeScore({ successRate: 1, latencyEma: 0, contextWindow: 1000000, lastOkAt: Date.now() });
    assert.equal(s, 100);
  });

  it('dead/never-ok/stale model scores low', () => {
    const s = computeScore({ successRate: 0, latencyEma: 5000, contextWindow: 0, lastOkAt: 1 });
    assert.equal(s, 0);
  });

  it('never-checked model gets freshness 0 but base weights apply', () => {
    const s = computeScore({ successRate: 1, latencyEma: 0, contextWindow: 500000, lastOkAt: 0 });
    // 0.4 + 0.3 + 0.1 + 0 = 0.8
    assert.equal(s, 80);
  });

  it('freshness decays over 14 days', () => {
    const now = Date.now();
    const fresh = computeScore({ successRate: 1, latencyEma: 0, contextWindow: 1000000, lastOkAt: now });
    const old = computeScore({ successRate: 1, latencyEma: 0, contextWindow: 1000000, lastOkAt: now - 7 * 86400000 });
    const ancient = computeScore({ successRate: 1, latencyEma: 0, contextWindow: 1000000, lastOkAt: now - 20 * 86400000 });
    assert.ok(fresh > old, 'fresh > 7d old');
    assert.ok(old > ancient, '7d > 20d');
    assert.equal(ancient, 90, '20d old → freshness 0 → 0.9');
  });

  it('clamps out-of-range inputs', () => {
    const s = computeScore({ successRate: 5, latencyEma: -100, contextWindow: 99999999, lastOkAt: Date.now() });
    assert.equal(s, 100);
  });
});
