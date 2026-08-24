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

test('normalize: caps at MAX_LEN to bound memory', () => {
  const long = 'а'.repeat(10000);
  const norm = normalizeMessages([{ role: 'user', content: long }]);
  assert.ok(norm.length <= 2000, 'normalized length bounded');
});
