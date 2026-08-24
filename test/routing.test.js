const test = require('node:test');
const assert = require('node:assert');
const { classifyComplexity, maybeUpgradeTier } = require('../lib/routing');

test('routing: code-heavy request scores high complexity', () => {
  const score = classifyComplexity([{ role: 'user', content: 'Напиши функцию сортировки массива на JavaScript с комментариями' }]);
  assert.ok(score > 0.6, `expected >0.6, got ${score}`);
});

test('routing: simple greeting scores low complexity', () => {
  const score = classifyComplexity([{ role: 'user', content: 'привет как дела' }]);
  assert.ok(score < 0.4, `expected <0.4, got ${score}`);
});

test('routing: error/fix request scores high', () => {
  const score = classifyComplexity([{ role: 'user', content: 'Ошибка: Cannot read property of undefined. Исправь баг в коде ниже: const x = obj.foo.bar;' }]);
  assert.ok(score > 0.5, `expected >0.5, got ${score}`);
});

test('routing: empty content scores low', () => {
  const score = classifyComplexity([{ role: 'user', content: '' }]);
  assert.ok(score >= 0 && score <= 1);
});

test('routing: maybeUpgradeTier keeps simple requests on light tier', () => {
  const upgraded = maybeUpgradeTier('tier-s', 0.1);
  assert.strictEqual(upgraded, 'tier-s');
});

test('routing: maybeUpgradeTier upgrades complex requests from tier-s', () => {
  const upgraded = maybeUpgradeTier('tier-s', 0.9);
  assert.notStrictEqual(upgraded, 'tier-s');
});

test('routing: maybeUpgradeTier does not downgrade heavy tiers', () => {
  const upgraded = maybeUpgradeTier('tier-splus', 0.1);
  assert.strictEqual(upgraded, 'tier-splus');
});
