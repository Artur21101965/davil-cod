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

test('routing: vision complexity medium for long prose without code', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  // Длинный прозаический текст без кода/ошибок — средняя сложность по длине.
  const text = ('Это подробное описание встречи команды. Обсудили планы на квартал, ' +
    'распределили задачи между участниками, договорились о сроках. ' +
    'Затронули вопросы бюджета и приоритетов. Решили повторить через неделю. ').repeat(10);
  const score = classifyVisionComplexity(text);
  assert.ok(score >= 0.15 && score <= 0.5, `expected medium [0.15,0.5], got ${score}`);
});

const { needsWindowUpgrade, WINDOW_FIT_FACTOR } = require('../lib/routing');

test('routing: WINDOW_FIT_FACTOR экспортируется (>1)', () => {
  assert.equal(typeof WINDOW_FIT_FACTOR, 'number');
  assert.ok(WINDOW_FIT_FACTOR > 1);
});

test('routing: needsWindowUpgrade решает по фактору 1.5', () => {
  assert.equal(needsWindowUpgrade(33000, 100000), true, 'est 100k поверх 33k×1.5');
  assert.equal(needsWindowUpgrade(33000, 45000), false, 'est 45k < 49.5k — влезает');
  assert.equal(needsWindowUpgrade(33000, 49500), false, 'est == win×1.5 — не поверх');
  assert.equal(needsWindowUpgrade(33000, 49501), true, 'чуть выше порога');
});

test('routing: needsWindowUpgrade при неизвестном окне не апгрейдит', () => {
  assert.equal(needsWindowUpgrade(0, 100000), false);
  assert.equal(needsWindowUpgrade(-5, 100000), false);
  assert.equal(needsWindowUpgrade(33000, 0), false);
});

test('routing: needsWindowUpgrade с кастомным фактором', () => {
  assert.equal(needsWindowUpgrade(33000, 50000, 2), false);
  assert.equal(needsWindowUpgrade(33000, 70000, 2), true);
});
