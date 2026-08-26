const test = require('node:test');
const assert = require('node:assert');
const { normalizeMessages } = require('../lib/normalize');

test('normalize: lowercases and strips punctuation', () => {
  const a = normalizeMessages([{ role: 'user', content: 'Привет, как дела?!' }]);
  const b = normalizeMessages([{ role: 'user', content: 'привет как дела' }]);
  assert.strictEqual(a, b, 'пунктуация и регистр не влияют');
});

test('normalize: collapses whitespace', () => {
  const a = normalizeMessages([{ role: 'user', content: 'напиши    код' }]);
  const b = normalizeMessages([{ role: 'user', content: 'напиши код' }]);
  assert.strictEqual(a, b);
});

test('normalize: keeps distinct content different', () => {
  const a = normalizeMessages([{ role: 'user', content: 'привет' }]);
  const b = normalizeMessages([{ role: 'user', content: 'пока' }]);
  assert.notStrictEqual(a, b);
});

test('normalize: strips system messages (only user content matters)', () => {
  const msgs = [
    { role: 'system', content: 'Ты помощник' },
    { role: 'user', content: 'привет' },
  ];
  const a = normalizeMessages(msgs);
  const b = normalizeMessages([{ role: 'user', content: 'привет' }]);
  assert.strictEqual(a, b);
});

test('normalize: handles array content (text parts only)', () => {
  const a = normalizeMessages([{ role: 'user', content: [{ type: 'text', text: 'напиши код' }] }]);
  const b = normalizeMessages([{ role: 'user', content: 'напиши код' }]);
  assert.strictEqual(a, b);
});

test('normalize: caps at MAX_LEN+TAIL_LEN to bound memory', () => {
  const long = 'а'.repeat(10000);
  const norm = normalizeMessages([{ role: 'user', content: long }]);
  const { MAX_LEN, TAIL_LEN } = require('../lib/normalize');
  assert.ok(norm.length <= MAX_LEN + TAIL_LEN, 'normalized length bounded to MAX_LEN+TAIL_LEN');
});

test('normalize: code with operators is NOT collapsed (exact match for code)', () => {
  const a = normalizeMessages([{ role: 'user', content: 'return a+b;' }]);
  const b = normalizeMessages([{ role: 'user', content: 'return a-b;' }]);
  assert.notStrictEqual(a, b, 'код с разными операторами не должен коллизировать');
});

test('normalize: prose still normalizes (case/punct insensitive)', () => {
  const a = normalizeMessages([{ role: 'user', content: 'Привет, как дела?!' }]);
  const b = normalizeMessages([{ role: 'user', content: 'привет как дела' }]);
  assert.strictEqual(a, b);
});

test('normalize: same short command in DIFFERENT dialogs differs (context included)', () => {
  // «продолжай» в разных диалогах с разным ассистентским контекстом НЕ должен
  // схлопываться в один кэш-ключ — иначе вернётся чужой старый ответ.
  const dialogA = [
    { role: 'user', content: 'как работает phoneinfoga?' },
    { role: 'assistant', content: 'PhoneInfoga сканирует номера.' },
    { role: 'user', content: 'продолжай' },
  ];
  const dialogB = [
    { role: 'user', content: 'статус PH-лаунча?' },
    { role: 'assistant', content: 'Итоговая таблица готова.' },
    { role: 'user', content: 'продолжай' },
  ];
  assert.notStrictEqual(
    normalizeMessages(dialogA),
    normalizeMessages(dialogB),
    'одинаковая команда в разных диалогах должна давать разные ключи'
  );
});

test('normalize: same command in SAME dialog matches', () => {
  const dialog = [
    { role: 'user', content: 'что происходит?' },
    { role: 'assistant', content: 'Идёт лаунч PolyCopy.' },
    { role: 'user', content: 'продолжай' },
  ];
  const same = JSON.parse(JSON.stringify(dialog));
  assert.strictEqual(
    normalizeMessages(dialog),
    normalizeMessages(same),
    'одинаковый диалог даёт одинаковый ключ'
  );
});
