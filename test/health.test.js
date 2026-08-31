// test/health.test.js — units для почасового буфера (sparkline 24ч).
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.STATE_PATH = process.env.STATE_PATH || path.join(os.tmpdir(), 'freegate-health-test-state.json');

function loadFresh() {
  try { delete require.cache[require.resolve('../lib/health')]; } catch {}
  const mod = require('../lib/health');
  // Каждый пересозданный модуль заводит свой _saveTimer; глушим прежний,
  // чтобы не копить таймеры между тестами.
  if (mod._stopTimers) mod._stopTimers();
  return require('../lib/health');
}

describe('health hourly buffer', () => {
  it('getHourly returns bins for elapsed UTC hours of today', () => {
    const h = loadFresh();
    const bins = h.getHourly();
    assert.ok(Array.isArray(bins), 'is array');
    assert.ok(bins.length >= 1, 'at least current hour');
    const last = bins[bins.length - 1];
    assert.ok(last.hour, 'has hour key');
    assert.equal(typeof last.total, 'number', 'total numeric');
  });

  it('recordRequest feeds hourly bin counters', () => {
    const h = loadFresh();
    h.recordRequest('prov-x', true);   // success
    h.recordRequest('prov-x', false);  // fail
    const bins = h.getHourly();
    const last = bins[bins.length - 1];
    assert.equal(last.total, 2, 'two requests in current hour');
    assert.equal(last.ok, 1, 'one success');
  });

  it('success rate degrades when failures dominate', () => {
    const h = loadFresh();
    for (let i = 0; i < 3; i++) h.recordRequest('prov-x', true);
    for (let i = 0; i < 7; i++) h.recordRequest('prov-x', false);
    const bins = h.getHourly();
    const last = bins[bins.length - 1];
    assert.equal(last.total, 10);
    assert.equal(last.ok, 3);
  });
});

after(() => {
  try { require('fs').unlinkSync(process.env.STATE_PATH); } catch {}
  require('../lib/health')._stopTimers && require('../lib/health')._stopTimers();
});
