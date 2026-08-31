// test/methodology.test.js
let methodology;

function loadFresh() {
  delete require.cache[require.resolve('../lib/methodology')];
  methodology = require('../lib/methodology');
}

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('methodology', () => {
  it('has fields for all categories', () => {
    loadFresh();
    for (const cat of ['coding', 'reasoning', 'search', 'chat']) {
      assert.ok(methodology.getMethodology(cat), 'no methodology for ' + cat);
      assert.ok(methodology.getMethodology(cat).length > 0);
    }
  });

  it('is enabled by default in settings', () => {
    loadFresh();
    assert.equal(methodology.enabledByDefault(), true);
  });

  it('coding methodology mentions plan-before-code and tests', () => {
    loadFresh();
    const text = methodology.getMethodology('coding');
    assert.match(text, /план/i);
    assert.match(text, /тест|test/i);
  });

  it('reasoning methodology asks to reason step by step', () => {
    loadFresh();
    const text = methodology.getMethodology('reasoning');
    assert.match(text, /пош/gi);
  });

  it('injectMethodology inserts a system message after user memory/other system, before user', () => {
    loadFresh();
    const messages = [
      { role: 'system', content: 'Ты помощник' },
      { role: 'user', content: '[Память: ...]' },
      { role: 'user', content: 'напиши функцию' },
    ];
    const result = methodology.injectMethodology(messages, 'coding');
    const sysIdx = result.findIndex(m => m.role === 'system' && /методолог/i.test(m.content));
    assert.ok(sysIdx > 0, 'methodology system message inserted');
    assert.ok(sysIdx < result.findIndex(m => m.role === 'user' && m.content === 'напиши функцию'), 'inserted before last user');
  });

  it('injectMethodology returns copy without mutating input', () => {
    loadFresh();
    const messages = [{ role: 'user', content: 'hi' }];
    const result = methodology.injectMethodology(messages, 'chat');
    assert.notEqual(result, messages);
    assert.equal(messages.length, 1, 'input not mutated');
  });

  it('injectMethodology no-ops when disabled', () => {
    loadFresh();
    const messages = [{ role: 'user', content: 'hi' }];
    const result = methodology.injectMethodology(messages, 'chat', { enabled: false });
    assert.deepEqual(result, messages);
  });

  it('uses custom prompt from config.prompts for a category', () => {
    loadFresh();
    const options = { enabled: true, prompts: { coding: 'КАСТОМНЫЙ КОДЕР: сначала тест.' } };
    const text = methodology.getMethodology('coding', options);
    assert.ok(text.includes('КАСТОМНЫЙ КОДЕР'));
    assert.ok(!text.includes('Методолог (craft)'), 'default replaced');
  });

  it('falls back to default prompt when category not customized', () => {
    loadFresh();
    const options = { enabled: true, prompts: { coding: 'КАСТОМНЫЙ КОДЕР' } };
    const text = methodology.getMethodology('reasoning', options);
    assert.ok(text.includes('Методолог (thinking)'), 'unmatched category keeps default');
  });

  it('injectMethodology passes custom prompts through', () => {
    loadFresh();
    const messages = [{ role: 'user', content: 'напиши функцию' }];
    const result = methodology.injectMethodology(messages, 'coding', { enabled: true, prompts: { coding: 'КАСТОМ КОД' } });
    const sysMsg = result.find(m => m.role === 'system');
    assert.ok(sysMsg.content.includes('КАСТОМ КОД'), 'custom prompt injected');
  });

  it('injectMethodology always attaches «не сдавайся» behavior, even with custom prompt', () => {
    loadFresh();
    const messages = [{ role: 'user', content: 'найди скилл' }];
    const result = methodology.injectMethodology(messages, 'design', { enabled: true, prompts: { design: 'ТОЛЬКО КАСТОМ' } });
    const sysMsg = result.find(m => m.role === 'system');
    assert.ok(sysMsg.content.includes('не сдавайся'), 'behavior block attached');
    assert.ok(sysMsg.content.includes('обходной путь'), 'behavior mentions workaround');
  });
});
