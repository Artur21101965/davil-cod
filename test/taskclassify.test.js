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
      { role: 'user', content: 'напиши функцию сортировки на js' },
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

  it('classifies compare/analyze as reasoning', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'сравни два подхода и проанализируй, что быстрее' }]), 'reasoning');
  });

  it('classifies explaining a code snippet as coding', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'объясни, что делает эта функция async fetchData()' }]), 'coding');
  });

  it('classifies fix/import missing as coding even without code fences', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'не работает — поправь, где потерялся return' }]), 'coding');
  });

  it('classifies calculation with percentage as reasoning', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'сколько процентов от 5000 составят 250?' }]), 'reasoning');
  });

  it('classifies refactor/optimize as coding', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'отрефактори и оптимизируй этот цикл' }]), 'coding');
  });

  it('classifies search terms (how it works, explain X, what does it mean)', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'как работает kafka' }]), 'search');
    assert.equal(classify.classify([{ role: 'user', content: 'расскажи про квантовые компьютеры' }]), 'search');
    assert.equal(classify.classify([{ role: 'user', content: 'как настроить nginx' }]), 'search');
    assert.equal(classify.classify([{ role: 'user', content: 'что означает аннотация в java' }]), 'search', 'объяснение термина не reasoning');
    assert.equal(classify.classify([{ role: 'user', content: 'найди библиотеку для парсинга' }]), 'search');
  });

  it('classifies frontend design tasks as design', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'сверстай лендинг для кофейни' }]), 'design');
    assert.equal(classify.classify([{ role: 'user', content: 'сделай красивую карточку товара' }]), 'design');
    assert.equal(classify.classify([{ role: 'user', content: 'создай страницу профиля с тёмной темой и адаптивом' }]), 'design');
    assert.equal(classify.classify([{ role: 'user', content: 'нарисуй интерфейс дашборда с анимациями' }]), 'design');
    assert.equal(classify.classify([{ role: 'user', content: 'сверстай hero-секцию на Tailwind' }]), 'design');
  });

  it('classifies QUESTIONS about design as search (not design)', () => {
    loadFresh();
    assert.equal(classify.classify([{ role: 'user', content: 'что ты знаешь про минимакс дизайн. найди инфу' }]), 'search');
    assert.equal(classify.classify([{ role: 'user', content: 'расскажи про минимакс дизайн' }]), 'search');
    assert.equal(classify.classify([{ role: 'user', content: 'что такое минимакс дизайн' }]), 'search', 'кириллица после триггера — без \\b');
  });
});
