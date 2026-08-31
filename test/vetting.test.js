// test/vetting.test.js
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

function loadFresh() {
  delete require.cache[require.resolve('../lib/vetting')];
  return require('../lib/vetting');
}

describe('vetting.shouldVet', () => {
  it('respects enabled flag', () => {
    const v = loadFresh();
    assert.equal(v.shouldVet({ config: { enabled: false }, answerLen: 500, category: 'coding', complexity: 0.9 }), false);
    assert.equal(v.shouldVet({ config: { enabled: true }, answerLen: 500, category: 'coding', complexity: 0.9 }), true);
  });

  it('skips short answers', () => {
    const v = loadFresh();
    assert.equal(v.shouldVet({ config: { enabled: true }, answerLen: 10, category: 'coding', complexity: 0.9 }), false);
  });

  it('complexityOnly: vets coding/design/reasoning, skips chat/search', () => {
    const v = loadFresh();
    const cfg = { enabled: true, complexityOnly: true, minAnswerLen: 120 };
    assert.equal(v.shouldVet({ config: cfg, answerLen: 500, category: 'coding', complexity: 0.2 }), true, 'coding always');
    assert.equal(v.shouldVet({ config: cfg, answerLen: 500, category: 'design', complexity: 0.2 }), true);
    assert.equal(v.shouldVet({ config: cfg, answerLen: 500, category: 'chat', complexity: 0.2 }), false, 'chat skipped');
    assert.equal(v.shouldVet({ config: cfg, answerLen: 500, category: 'search', complexity: 0.2 }), false, 'search skipped');
    assert.equal(v.shouldVet({ config: cfg, answerLen: 500, category: 'general', complexity: 0.9 }), true, 'high complexity vets even unknown cat');
  });
});

describe('vetting.parseVerdict', () => {
  it('OK → ok, no note', () => {
    const v = loadFresh();
    assert.deepEqual(v.parseVerdict('OK'), { ok: true, note: '' });
  });

  it('Замечание → not ok with note', () => {
    const v = loadFresh();
    const r = v.parseVerdict('Замечание: ответ неверно называет столицу Франции');
    assert.equal(r.ok, false);
    assert.ok(r.note.includes('столицу'));
  });

  it('garbled → treat as ok (never block)', () => {
    const v = loadFresh();
    assert.equal(v.parseVerdict('какая-то бессвязица').ok, true);
  });
});

describe('vetting.vetAnswer', () => {
  it('uses a pick provider and returns verdict', async () => {
    const v = loadFresh();
    v.resetThrottle();
    const callProvider = async () => ({
      data: { choices: [{ message: { content: 'Замечание: в ответе ошибка в примере кода' } }] },
    });
    const picks = [{ key: 'prov2', model: 'm2' }];
    const r = await v.vetAnswer({ answer: 'длинный содержательный ответ для проверки', callProvider, picks, config: { enabled: true, maxChecksPerMin: 4 } });
    assert.equal(r.checked, true);
    assert.equal(r.ok, false);
    assert.ok(r.note.length > 0);
  });

  it('returns checked:false when no picks', async () => {
    const v = loadFresh();
    v.resetThrottle();
    const r = await v.vetAnswer({ answer: 'x', callProvider: async () => ({}), picks: [], config: { enabled: true } });
    assert.equal(r.checked, false);
  });

  it('throttles: respects maxChecksPerMin', async () => {
    const v = loadFresh();
    v.resetThrottle();
    const callProvider = async () => ({ data: { choices: [{ message: { content: 'OK' } }] } });
    const picks = [{ key: 'p', model: 'm' }];
    let checkedCount = 0;
    for (let i = 0; i < 10; i++) {
      const r = await v.vetAnswer({ answer: 'очень длинный ответ для проверки ' + i, callProvider, picks, config: { enabled: true, maxChecksPerMin: 4 } });
      if (r.checked) checkedCount++;
    }
    assert.ok(checkedCount <= 4, 'no more than maxChecksPerMin');
  });
});

after(() => { require('../lib/vetting').resetThrottle(); });
