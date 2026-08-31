// test/strategy.test.js
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

function loadFresh() {
  delete require.cache[require.resolve('../lib/strategy')];
  return require('../lib/strategy');
}

describe('strategy.normalizeStrategy', () => {
  it('maps unknown to weighted', () => {
    const s = loadFresh();
    assert.equal(s.normalizeStrategy('bogus'), 'weighted');
    assert.equal(s.normalizeStrategy(undefined), 'weighted');
  });
  it('accepts known strategies', () => {
    const s = loadFresh();
    assert.equal(s.normalizeStrategy('weighted-roundrobin'), 'weighted-roundrobin');
    assert.equal(s.normalizeStrategy('weighted-least'), 'weighted-least');
    assert.equal(s.normalizeStrategy('weighted'), 'weighted');
  });
});

describe('strategy.makeWeightModifier', () => {
  it('weighted → always 1', () => {
    const s = loadFresh();
    const m = s.makeWeightModifier('weighted', { keys: ['a', 'b'] });
    assert.equal(m('a'), 1);
    assert.equal(m('b'), 1);
  });

  it('round-robin boosts the next key once', () => {
    const s = loadFresh();
    s.resetRoundRobin();
    const keys = ['a', 'b', 'c'];
    const m = s.makeWeightModifier('weighted-roundrobin', { keys });
    // первый вызов курсора: 'a' получает буст
    assert.ok(m('a') > 1, 'a boosted first');
    assert.equal(m('b'), 1);
  });

  it('round-robin advances cursor across calls', () => {
    const s = loadFresh();
    s.resetRoundRobin();
    const keys = ['a', 'b'];
    const m1 = s.makeWeightModifier('weighted-roundrobin', { keys });
    assert.ok(m1('a') > 1, 'a boosted');
    const m2 = s.makeWeightModifier('weighted-roundrobin', { keys });
    assert.ok(m2('b') > 1, 'b boosted next');
  });

  it('least-used boosts below-average keys', () => {
    const s = loadFresh();
    const usedTodayList = { a: 10, b: 0, c: 5 };
    const m = s.makeWeightModifier('weighted-least', { keys: ['a', 'b', 'c'], usedTodayList });
    // среднее = 5 → b(0) < 5 boosted, a(10) не boosted
    assert.ok(m('b') > 1, 'b boosted');
    assert.equal(m('a'), 1, 'a not boosted');
    assert.equal(m('c'), 1, 'c equals avg, not boosted');
  });
});

after(() => { require('../lib/strategy').resetRoundRobin(); });
