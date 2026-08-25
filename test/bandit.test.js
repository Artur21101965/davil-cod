const test = require('node:test');
const assert = require('node:assert');
const { bucket, sampleBeta, pick, recordOutcome, isTransientLimit } = require('../lib/bandit');

test('bandit: bucket boundaries', () => {
  assert.strictEqual(bucket(0), 'low');
  assert.strictEqual(bucket(0.39), 'low');
  assert.strictEqual(bucket(0.4), 'med');
  assert.strictEqual(bucket(0.69), 'med');
  assert.strictEqual(bucket(0.7), 'high');
  assert.strictEqual(bucket(1), 'high');
});

test('bandit: sampleBeta returns values in [0,1]', () => {
  for (let i = 0; i < 100; i++) {
    const s = sampleBeta(2 + Math.random() * 10, 2 + Math.random() * 10);
    assert.ok(s >= 0 && s <= 1, `sample ${s} out of range`);
  }
});

test('bandit: sampleBeta with equal priors is symmetric around 0.5', () => {
  let sum = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) sum += sampleBeta(2, 2);
  assert.ok(Math.abs(sum / N - 0.5) < 0.1, `avg ${sum / N}`);
});

test('bandit: pick chooses the trained-best provider', () => {
  const priors = { A: { a: 20, b: 2 }, B: { a: 2, b: 20 } };
  let aWins = 0;
  for (let i = 0; i < 200; i++) {
    if (pick([{ key: 'A' }, { key: 'B' }], priors) === 'A') aWins++;
  }
  assert.ok(aWins > 150, `A should win most, got ${aWins}/200`);
});

test('bandit: pick prefers higher-weight provider at cold start', () => {
  // Без накопленных приоров safety-вес (скорость/штрафы) должен влиять на выбор.
  const priors = {}; // cold start
  let fastWins = 0;
  for (let i = 0; i < 300; i++) {
    if (pick([{ key: 'fast', weight: 1.0 }, { key: 'slow', weight: 0.1 }], priors) === 'fast') fastWins++;
  }
  assert.ok(fastWins > 220, `fast should win most at cold start, got ${fastWins}/300`);
});

test('bandit: buckets are isolated (success in low does not affect high)', () => {
  const lowPriors = { X: { a: 10, b: 1 } };
  const highPriors = { X: { a: 1, b: 1 } };
  let lowAvg = 0, highAvg = 0, N = 500;
  for (let i = 0; i < N; i++) {
    lowAvg += sampleBeta(lowPriors.X.a + 1, lowPriors.X.b + 1);
    highAvg += sampleBeta(highPriors.X.a + 1, highPriors.X.b + 1);
  }
  assert.ok(lowAvg / N > 0.7, `low bucket trained, got ${lowAvg / N}`);
  assert.ok(highAvg / N < 0.6, `high bucket cold, got ${highAvg / N}`);
});

test('bandit: recordOutcome increments alpha on success, beta on failure', () => {
  const priors = {};
  recordOutcome(priors, 'A', true);
  recordOutcome(priors, 'A', true);
  recordOutcome(priors, 'A', false);
  assert.strictEqual(priors.A.a, 3); // 1 initial + 2 success
  assert.strictEqual(priors.A.b, 2); // 1 initial + 1 failure
});

test('health: bandit priors persist and update', () => {
  const health = require('../lib/health');
  health.recordBandit('med', 'test-key', true);
  health.recordBandit('med', 'test-key', false);
  const b = health.getBandit();
  assert.strictEqual(b.med['test-key'].a, 2); // 1 initial + 1 success
  assert.strictEqual(b.med['test-key'].b, 2); // 1 initial + 1 failure
  assert.ok(!b.low['test-key'], 'low bucket isolated');
});

test('bandit: isTransientLimit identifies rate limits', () => {
  assert.strictEqual(isTransientLimit(429), true);
  assert.strictEqual(isTransientLimit(403), true);
  assert.strictEqual(isTransientLimit(402), true);
  assert.strictEqual(isTransientLimit(401), true);
  assert.strictEqual(isTransientLimit(500), false);
  assert.strictEqual(isTransientLimit(502), false);
  assert.strictEqual(isTransientLimit(0), false);
  assert.strictEqual(isTransientLimit(null), false);
  assert.strictEqual(isTransientLimit(undefined), false);
});

require('../lib/health')._stopTimers();
