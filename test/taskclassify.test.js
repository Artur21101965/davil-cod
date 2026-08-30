// test/taskclassify.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
let classify;

function loadFresh() {
  delete require.cache[require.resolve('../lib/taskclassify')];
  classify = require('../lib/taskclassify');
}

describe('taskclassify.classify', () => {
  it('returns chat for plain conversation', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'привет, как дела?' }]), 'chat');
  });

  it('returns chat for simple question', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'что такое HTTP?' }]), 'search');
  });

  it('returns coding when user asks to write code', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'напиши функцию, которая сортирует массив' }]), 'coding');
  });

  it('returns coding for fenced code block', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'объясни этот код:\n```js\nconst x = 1;\n```' }]), 'coding');
  });

  it('returns coding for file paths + import', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'посмотри src/app.js и исправь import' }]), 'coding');
  });

  it('returns reasoning for numbers and estimation', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'посчитай сколько будет 128 * 3.14' }]), 'reasoning');
  });

  it('returns reasoning for logical/explanation words', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'почему небо синее? объясни причины' }]), 'reasoning');
  });

  it('uses only the last user message', () => {
    loadFresh();
    const msgs = [
      { role: 'user', content: 'привет' },
      { role: 'user', content: 'напиши верстку на css' },
    ];
    assert.equal(classify.classify(msgs), 'coding');
  });

  it('returns chat for empty/no messages', () => {
    loadFresh();
    assert.equal(classify.classify([]), 'chat');
    assert.equal(classify.classify(null), 'chat');
  });

  it('handles array content (multimodal) by extracting text', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: [{ type: 'text', text: 'добавь обработку ошибок в JS' }] }]), 'coding');
  });
});
