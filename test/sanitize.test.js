const { describe, it } = require('node:test');
const assert = require('node:assert');
const { sanitizeBody } = require('../lib/providers');

describe('sanitizeBody', () => {
  it('удаляет только поля из unsupportedFields', () => {
    const out = sanitizeBody(
      { unsupportedFields: ['reasoning_effort', 'thinking'] },
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high', tools: [{ type: 'function' }] }
    );
    assert.deepStrictEqual(Object.keys(out).sort(), ['messages', 'model', 'tools']);
    assert.strictEqual(out.model, 'm');
  });

  it('не мутирует исходный body', () => {
    const body = { model: 'm', reasoning_effort: 'high' };
    const out = sanitizeBody({ unsupportedFields: ['reasoning_effort'] }, body);
    assert.strictEqual(out.reasoning_effort, undefined);
    assert.strictEqual(body.reasoning_effort, 'high');
  });

  it('без unsupportedFields возвращает body как есть', () => {
    const body = { model: 'm', reasoning_effort: 'low' };
    assert.strictEqual(sanitizeBody({}, body).reasoning_effort, 'low');
  });

  it('ложсируется, если поля нет — не падает', () => {
    const out = sanitizeBody({ unsupportedFields: ['nonexistent'] }, { model: 'm' });
    assert.strictEqual(out.model, 'm');
  });
});
