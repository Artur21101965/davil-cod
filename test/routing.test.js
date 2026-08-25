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

test('routing: empty content scores zero', () => {
  const score = classifyComplexity([{ role: 'user', content: '' }]);
  assert.strictEqual(score, 0);
});

test('routing: maybeUpgradeTier keeps simple requests on light tier', () => {
  const upgraded = maybeUpgradeTier('tier-s', 0.1);
  assert.strictEqual(upgraded, 'tier-s');
});

test('routing: maybeUpgradeTier upgrades complex requests from tier-s', () => {
  const upgraded = maybeUpgradeTier('tier-s', 0.9);
  assert.strictEqual(upgraded, 'tier-splus');
});

test('routing: maybeUpgradeTier does not downgrade heavy tiers', () => {
  const upgraded = maybeUpgradeTier('tier-splus', 0.1);
  assert.strictEqual(upgraded, 'tier-splus');
});

test('routing: vision complexity high for code screenshot text', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  const text = 'const x = obj.foo.bar;\nfunction handleError(err) { return err.message; }\nОшибка: TypeError';
  assert.ok(classifyVisionComplexity(text) > 0.6, `expected >0.6, got ${classifyVisionComplexity(text)}`);
});

test('routing: vision complexity low for plain photo description', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  const text = 'На фото красивая гора и озеро, небо голубое, люди отдыхают на берегу';
  assert.ok(classifyVisionComplexity(text) < 0.4, `expected <0.4, got ${classifyVisionComplexity(text)}`);
});

test('routing: vision complexity empty text is 0', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  assert.strictEqual(classifyVisionComplexity(''), 0);
  assert.strictEqual(classifyVisionComplexity(null), 0);
});

test('routing: vision complexity medium for mixed text', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  const text = 'Скриншот чата: привет, как дела? Идём гулять завтра.';
  const score = classifyVisionComplexity(text);
  assert.ok(score >= 0 && score <= 1, `score in range, got ${score}`);
});
