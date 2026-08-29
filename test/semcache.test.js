// test/semcache.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { trigrams, dice, similarityScore } = require('../lib/semcache');

describe('semcache.trigrams', () => {
  it('returns lowercase char-3-grams', () => {
    const t = trigrams('Привет');
    assert.ok(t.length >= 3, 'has grams');
    assert.ok(t.some(g => g === 'при'), 'contains lowercase gram "при"');
  });

  it('returns empty for too-short or non-string input', () => {
    assert.deepEqual(trigrams(''), []);
    assert.deepEqual(trigrams('a'), []);
    assert.deepEqual(trigrams(null), []);
  });
});

describe('semcache.dice', () => {
  it('is 1 for identical sets, 0 for disjoint non-empty', () => {
    assert.equal(dice(new Set(['ab', 'cd']), new Set(['ab', 'cd'])), 1);
    assert.equal(dice(new Set(['ab', 'cd']), new Set(['xy', 'zw'])), 0);
  });

  it('partial overlap lands between 0 and 1', () => {
    const d = dice(new Set(['ab', 'cd']), new Set(['cd', 'ef']));
    // |A∩B|=1, |A|=|B|=2 → (2*1)/(2+2)=0.5
    assert.ok(Math.abs(d - 0.5) < 1e-9);
  });
});

describe('semcache.similarityScore', () => {
  it('high for near-duplicate short text', () => {
    const s = similarityScore('исправь ошибку в коде ниже', 'исправь ошибку в коде ниже пожалуйста');
    assert.ok(s > 0.5, 'got ' + s);
  });

  it('low for different text', () => {
    const s = similarityScore('как дела', 'напиши стих про зиму');
    assert.ok(s < 0.3, 'got ' + s);
  });
});