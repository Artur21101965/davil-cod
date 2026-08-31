// test/compress.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function loadFresh() {
  delete require.cache[require.resolve('../lib/compress')];
  return require('../lib/compress');
}

describe('compress.compressText', () => {
  it('strips English pleasantries', () => {
    const c = loadFresh();
    const out = c.compressText('Sure, here is the function: x = 1');
    assert.ok(!/^sure/i.test(out), 'strips "Sure"');
    assert.ok(out.includes('function'), 'keeps substance');
  });

  it('strips polite framing in Russian', () => {
    const c = loadFresh();
    const out = c.compressText('Пожалуйста, напиши функцию на js');
    assert.ok(!/^пожалуйста/i.test(out), 'strips «Пожалуйста»');
    assert.ok(out.includes('напиши'), 'keeps verb');
  });

  it('strips hedging/fillers', () => {
    const c = loadFresh();
    const out = c.compressText('I think that basically we just need sort');
    assert.ok(!/(i think that|basically|just)/i.test(out), 'strips fillers');
  });

  it('does not simulate code as prose', () => {
    const c = loadFresh();
    const out = c.compressText('export const a = 1; function b(){ return a }');
    // looksLikeCode → shouldCompress false, но compressText сам по себе может
    // тронуть «a the» — проверим, что код в целом уцелел.
    assert.ok(out.includes('export const'), 'code intact');
  });
});

describe('compress.compressMessages', () => {
  it('compresses only the last user message when enabled', () => {
    const c = loadFresh();
    const msgs = [
      { role: 'user', content: 'Привет, пожалуйста подскажи погоду' },
    ];
    const out = c.compressMessages(msgs, { enabled: true, minLen: 5 });
    assert.notEqual(out, msgs, 'mutated copy');
    assert.ok(!/^привет/i.test(out[0].content), 'greeting stripped');
  });

  it('returns original when disabled', () => {
    const c = loadFresh();
    const msgs = [{ role: 'user', content: 'Привет мир' }];
    assert.equal(c.compressMessages(msgs, { enabled: false }), msgs);
  });

  it('does not touch short or code messages', () => {
    const c = loadFresh();
    const msgs = [{ role: 'user', content: 'x' }];
    assert.equal(c.compressMessages(msgs, { enabled: true, minLen: 60 }), msgs, 'too short skipped');
    const code = [{ role: 'user', content: 'const a=1' }];
    assert.equal(c.compressMessages(code, { enabled: true, minLen: 5 }), code, 'code skipped');
  });
});

describe('compress.shouldCompress', () => {
  it('respects enabled + minLen + code guard', () => {
    const c = loadFresh();
    assert.equal(c.shouldCompress({ enabled: true, minLen: 10 }, 'Привет, пожалуйста добавь сортировку'), true, 'long enough non-code');
    assert.equal(c.shouldCompress({ enabled: false, minLen: 5 }, 'длинный текст проверки'), false, 'disabled');
    assert.equal(c.shouldCompress({ enabled: true, minLen: 5 }, 'const a=1'), false, 'code skipped');
    assert.equal(c.shouldCompress({ enabled: true, minLen: 200 }, 'короткий текст'), false, 'below minLen');
  });
});
