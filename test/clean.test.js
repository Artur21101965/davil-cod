// test/clean.test.js — tests for think-block stripping
const test = require('node:test');
const assert = require('node:assert');
const { stripThink, cleanMessage, cleanDelta, hasContent } = require('../lib/clean');

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

test('clean: streaming delta keeps boundary spaces (no trim)', () => {
  const { stripThink } = require('../lib/clean');
  // Simulate a chunk that STARTS with a space (word boundary)
  const chunk = ' привет';
  assert.strictEqual(stripThink(chunk, false), ' привет');
});

test('clean: full message IS trimmed', () => {
  const { stripThink } = require('../lib/clean');
  assert.strictEqual(stripThink('  привет  '), 'привет');
});

test('clean: fixReasoningMessage surfaces reasoning when content empty', () => {
  const { fixReasoningMessage } = require('../lib/clean');
  const msg = { role: 'assistant', content: '', reasoning: 'The user says hi. Reply friendly.' };
  fixReasoningMessage(msg);
  assert.strictEqual(msg.content, 'The user says hi. Reply friendly.');
});

test('clean: fixReasoningMessage keeps content when present', () => {
  const { fixReasoningMessage } = require('../lib/clean');
  const msg = { role: 'assistant', content: 'Hello!', reasoning: 'hidden reasoning' };
  fixReasoningMessage(msg);
  assert.strictEqual(msg.content, 'Hello!');
});

test('clean: hasContent true for real answer', () => {
  assert.strictEqual(hasContent({ choices: [{ message: { role: 'assistant', content: 'Ответ' } }] }), true);
});

test('clean: hasContent false for empty content', () => {
  assert.strictEqual(hasContent({ choices: [{ message: { role: 'assistant', content: '' } }] }), false);
});

test('clean: hasContent true when only reasoning present', () => {
  assert.strictEqual(hasContent({ choices: [{ message: { role: 'assistant', content: '', reasoning: 'размышление' } }] }), true);
});

test('clean: hasContent false for whitespace-only content', () => {
  assert.strictEqual(hasContent({ choices: [{ message: { role: 'assistant', content: '   \n  ' } }] }), false);
});

test('clean: hasContent false for missing choices', () => {
  assert.strictEqual(hasContent({}), false);
  assert.strictEqual(hasContent(null), false);
});

test('clean: isTooShort true for empty/1-char answers', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: '' } }] }), true);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'a' } }] }), true);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'abcd' } }] }), true);
});

test('clean: isTooShort false for 5+ char answers', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'abcde' } }] }), false);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'Ответ на вопрос' } }] }), false);
});

test('clean: isTooShort counts reasoning as content', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: '', reasoning: 'длинное размышление тут' } }] }), false);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: '', reasoning: 'ab' } }] }), true);
});

test('clean: isTooShort NOT short for tool_calls (agent инструмент — не мусор)', () => {
  const { isTooShort, hasContent } = require('../lib/clean');
  const toolRes = { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }] } }] };
  assert.strictEqual(isTooShort(toolRes, 'исправь foo на bar'), false, 'tool_calls-ответ не должен отбрасываться как пустой');
  assert.strictEqual(hasContent(toolRes), true);
});

test('clean: isTooShort true for missing choices', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({}), true);
  assert.strictEqual(isTooShort(null), true);
});
