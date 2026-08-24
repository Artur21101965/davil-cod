// test/clean.test.js — tests for think-block stripping
const test = require('node:test');
const assert = require('node:assert');
const { stripThink, cleanMessage, cleanDelta } = require('../lib/clean');

test('clean: strips <think> blocks from text', () => {
  const input = '<think>Let me reason about this carefully.</think>The answer is 42.';
  assert.strictEqual(stripThink(input), 'The answer is 42.');
});

test('clean: strips <thinking> blocks (variant tag)', () => {
  const input = '<thinking>Step 1: analyze.\nStep 2: solve.</thinking>Result: done';
  assert.strictEqual(stripThink(input), 'Result: done');
});

test('clean: leaves clean text unchanged', () => {
  const input = 'Just a normal answer without reasoning.';
  assert.strictEqual(stripThink(input), input);
});

test('clean: handles no content', () => {
  assert.strictEqual(stripThink(null), null);
  assert.strictEqual(stripThink(''), '');
});

test('clean: cleanMessage strips think from message content', () => {
  const msg = { role: 'assistant', content: '<think>hidden</think>visible' };
  cleanMessage(msg);
  assert.strictEqual(msg.content, 'visible');
});

test('clean: cleanDelta strips think from streaming delta', () => {
  const delta = { role: 'assistant', content: '<think>hidden</think>visible' };
  cleanDelta(delta);
  assert.strictEqual(delta.content, 'visible');
});
