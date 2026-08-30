// test/contextstats.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ContextStats } = require('../lib/contextstats');

function fresh() { return new ContextStats(); }

describe('ContextStats.record', () => {
  it('records a measure into hour|provider bucket', () => {
    const cs = fresh();
    cs.record({ ts: Date.parse('2026-08-29T20:33:00Z'), provider: 'mistral-codestral', est: 5000, real: 10000, win: 33000, status: 200 });
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 1);
    const b = snap.buckets[0];
    assert.equal(b.provider, 'mistral-codestral');
    assert.equal(b.hour, '2026-08-29T20:00');
    assert.equal(b.requests, 1);
    assert.equal(b.sumEst, 5000);
    assert.equal(b.sumReal, 10000);
    assert.ok(Math.abs(b.ratioMax - (10000 / 33000)) < 1e-9);
  });

  it('never throws on garbage input', () => {
    const cs = fresh();
    cs.record(null);
    cs.record({});
    cs.record({ ts: 'не число', provider: 123 });
    cs.record({ ts: Date.now(), provider: '', real: 'abc' });
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 1);
    assert.equal(snap.buckets[0].provider, 'unknown');
  });

  it('counts near/over window only when real and win are present', () => {
    const cs = fresh();
    const t = Date.parse('2026-08-29T21:00:00Z');
    cs.record({ ts: t, provider: 'a', real: 29700, win: 33000, status: 200 }); // ratio 0.9 → near
    cs.record({ ts: t, provider: 'a', real: 34000, win: 33000, status: 400 }); // real > win → over
    cs.record({ ts: t, provider: 'a', real: 500, win: 0, status: 200 });        // без win → без ratio
    const b = cs.snapshot().buckets[0];
    assert.equal(b.nearWindow, 1);
    assert.equal(b.overWindow, 1);
    assert.equal(b.requests, 3);
    assert.equal(b.status200, 2);
    assert.equal(b.status400, 1);
  });

  it('accumulates events (compacted, memory, cache, sysShare)', () => {
    const cs = fresh();
    const t = Date.parse('2026-08-29T22:00:00Z');
    cs.record({ ts: t, provider: 'b', compacted: true, memory: true, cacheType: 'semcache', sysShare: 0.4, status: 200 });
    cs.record({ ts: t, provider: 'b', cacheType: 'exact', status: 200 });
    const b = cs.snapshot().buckets[0];
    assert.equal(b.compactCount, 1);
    assert.equal(b.memoryCount, 1);
    assert.equal(b.cacheSem, 1);
    assert.equal(b.cacheExact, 1);
    assert.ok(Math.abs(b.sysShareSum - 0.4) < 1e-9);
  });
});

describe('ContextStats.bucketing', () => {
  it('buckets by hour across providers', () => {
    const cs = fresh();
    cs.record({ ts: Date.parse('2026-08-29T20:10:00Z'), provider: 'a', status: 200 });
    cs.record({ ts: Date.parse('2026-08-29T20:40:00Z'), provider: 'a', status: 200 });
    cs.record({ ts: Date.parse('2026-08-29T21:05:00Z'), provider: 'b', status: 200 });
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 2, 'same hour+provider merge; new hour/provider = new bucket');
    assert.equal(snap.buckets.find(b => b.provider === 'a').requests, 2);
  });
});

describe('ContextStats persistence', () => {
  it('serialize → load round-trips aggregates (not raw)', () => {
    const cs = fresh();
    cs.record({ ts: Date.parse('2026-08-29T20:10:00Z'), provider: 'x', real: 1000, win: 2000, status: 200 });
    const ser = cs.serialize();
    assert.ok(Array.isArray(ser.buckets));
    const cs2 = new ContextStats();
    cs2.load(ser);
    const b = cs2.snapshot().buckets.find(x => x.provider === 'x');
    assert.ok(b, 'bucket survives reload');
    assert.equal(b.real, undefined, 'raw real not stored — aggregates only');
    assert.equal(b.requests, 1);
    assert.equal(b.sumReal, 1000);
  });

  it('rejects corrupt data on load', () => {
    const cs = new ContextStats();
    cs.load(null);
    cs.load({ buckets: 'junk' });
    cs.load({ buckets: [{ bad: true }] });
    cs.load({ buckets: [{ key: 'not-a-bucket', requests: 5 }] });
    assert.equal(cs.snapshot().buckets.length, 0);
  });
});

describe('ContextStats.summary', () => {
  it('flags NARROW when a provider is often at the window edge', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 20; i++) {
      cs.record({ ts: t, provider: 'codestral', real: 30000, win: 33000, status: 200 });
    }
    const s = cs.summary();
    assert.equal(s.status, 'NARROW');
    assert.deepEqual(s.narrowProviders, ['codestral']);
  });

  it('status is OK below all thresholds', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 20; i++) {
      cs.record({ ts: t, provider: 'zai', real: 5000, win: 128000, status: 200 });
    }
    const s = cs.summary();
    assert.equal(s.status, 'OK');
    assert.deepEqual(s.narrowProviders, []);
  });

  it('OVERFLOW wins over NARROW', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 20; i++) {
      cs.record({ ts: t, provider: 'codestral', real: 34000, win: 33000, status: 400 });
    }
    const s = cs.summary();
    assert.equal(s.status, 'OVERFLOW');
  });

  it('counts cache hits and rate', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 5; i++) cs.record({ ts: t, provider: 'zai', cacheType: 'exact', status: 200 });
    for (let i = 0; i < 5; i++) cs.record({ ts: t, provider: 'zai', cacheType: 'semcache', status: 200 });
    for (let i = 0; i < 10; i++) cs.record({ ts: t, provider: 'zai', cacheType: 'miss', status: 200 });
    const s = cs.summary();
    assert.equal(s.totalRequests, 20);
    assert.equal(s.cacheHits, 10);
    assert.equal(s.cacheHitRate, 50);
  });

  it('keeps per-provider rows', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    cs.record({ ts: t, provider: 'zai', real: 5000, win: 128000, status: 200 });
    cs.record({ ts: t, provider: 'lost-prompt', real: 85000, win: 100000, status: 200 }); // ratio 0.85 → не у края
    const s = cs.summary();
    assert.equal(s.providers['lost-prompt'].nearWindow, 0);
    assert.equal(s.providers['zai'].requests, 1);
  });
});

describe('ContextStats retention', () => {
  it('prunes buckets older than 7 days', () => {
    const cs = fresh();
    cs.record({ ts: Date.now() - 8 * 24 * 3600 * 1000, provider: 'old', status: 200 });
    cs.record({ ts: Date.now() - 3600 * 1000, provider: 'new', status: 200 });
    cs.prune();
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 1);
    assert.equal(snap.buckets[0].provider, 'new');
  });
});

describe('ContextStats.upgradedCount', () => {
  it('aggregates upgraded from record into bucket/summary', () => {
    const t = Date.parse('2026-08-30T10:00:00Z');
    const cs = new ContextStats();
    cs.record({ ts: t, provider: 'a', upgraded: 1, status: 200 });
    cs.record({ ts: t, provider: 'a', upgraded: true, status: 200 });
    cs.record({ ts: t, provider: 'a', status: 400 });
    const b = cs.snapshot().buckets[0];
    assert.equal(b.upgradedCount, 2);
    const s = cs.summary(t + 3600000);
    assert.equal(s.upgradedCount, 2);
    assert.equal(s.providers.a.upgradedCount, 2);
  });

  it('round-trips upgradedCount through serialize → load', () => {
    const t = Date.parse('2026-08-30T10:00:00Z');
    const cs = new ContextStats();
    cs.record({ ts: t, provider: 'x', upgraded: 1, status: 200 });
    const cs2 = new ContextStats();
    cs2.load(cs.serialize());
    const b = cs2.snapshot().buckets.find(x => x.provider === 'x');
    assert.equal(b.upgradedCount, 1);
  });
});