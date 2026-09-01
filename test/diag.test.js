const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildReport, classifyErr } = require('../lib/diag');

describe('diag.buildReport', () => {
  it('накопительный отчёт по кодам и классам', () => {
    const stats = {
      version: '0.6.21', uptime_seconds: 3600,
      today: { requests: 100, success: 70, failed: 30 },
      errors: { 'a': 10, 'b': 10, 'c': 10 },
      health: {
        'a': { status: 'ratelimited', reason: 'лимит провайдера (429)', statusCode: 429 },
        'b': { status: 'up', reason: 'много ошибок (10)' },
        'c': { status: 'up', reason: 'не отвечает', statusCode: 0 },
      },
      context_summary: { status: 'OK', compactCount: 5, overWindow: 0, upgradedCount: 0, cacheHitRate: 0, taskTotal: 10 },
    };
    const r = buildReport(stats, []);
    assert.strictEqual(r.today.successRate, 70);
    assert.strictEqual(r.classes.limit, 20);   // a: 429 + b: «много ошибок» → limit
    assert.strictEqual(r.classes.timeout, 10); // c: statusCode 0 → timeout
    assert.strictEqual(r.classes.invalid, 0);
    assert.strictEqual(r.providers.ratelimited, 1);
    assert.strictEqual(r.context.status, 'OK');
  });

  it('401/402 → auth класс', () => {
    assert.strictEqual(classifyErr(401), 'auth');
    assert.strictEqual(classifyErr(402), 'auth');
    assert.strictEqual(classifyErr(403), 'auth');
    assert.strictEqual(classifyErr(429), 'limit');
    assert.strictEqual(classifyErr(422), 'invalid');
    assert.strictEqual(classifyErr(400), 'invalid');
    assert.strictEqual(classifyErr(0), 'timeout');
  });

  it('recent: кэш учитывается отдельно', () => {
    const r = buildReport({ today: {}, errors: {}, health: {}, context_summary: {} }, [
      { provider: 'a', status: 200 }, { provider: 'cache', status: 200, cached: true }, { provider: 'a', status: 500 },
    ]);
    assert.strictEqual(r.recent.cached, 1);
    assert.strictEqual(r.recent.ok, 2);
    assert.strictEqual(r.recent.err, 1);
    assert.strictEqual(r.recent.providersActive, 1); // только 'a', cache исключён
  });
});
