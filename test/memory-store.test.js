// test/memory-store.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
let store;
let tmpFile;

function loadFresh() {
  delete require.cache[require.resolve('../lib/memory-store')];
  delete require.cache[require.resolve('../lib/memory')];
  store = require('../lib/memory-store');
}

beforeEach(() => {
  loadFresh();
  tmpFile = path.join(os.tmpdir(), 'memory-store-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
});

afterEach(() => {
  try { fs.unlinkSync(tmpFile); } catch {}
});

describe('memory-store', () => {
  it('saves facts and reloads them (round trip)', () => {
    const a = store.create({ filePath: tmpFile });
    a.add('keepAlive агенты добавлены в providers.js');
    a.add('tier-splus перемаплен на minimax-m3');
    const r1 = a.save();
    assert.ok(r1, 'save returns truthy');

    const b = store.create({ filePath: tmpFile });
    assert.equal(b.size(), 2, 'reloaded 2 facts');
    const found = b.recall('на какой тир перемаплен minimax?', { topK: 1, minSimilarity: 0.1 });
    assert.ok(found.length === 1 && found[0].text.includes('minimax'), 'recall works after reload');
  });

  it('missing file loads empty without crash', () => {
    const a = store.create({ filePath: path.join(os.tmpdir(), 'nonexistent-' + Date.now() + '.json') });
    assert.equal(a.size(), 0);
  });

  it('corrupt file loads empty without crash', () => {
    fs.writeFileSync(tmpFile, '{not valid json!!');
    const a = store.create({ filePath: tmpFile });
    assert.equal(a.size(), 0);
  });

  it('auto-evicts over capacity and persists the trimmed set', () => {
    const a = store.create({ filePath: tmpFile, capacity: 3 });
    for (let i = 0; i < 5; i++) a.add('факт номер ' + i + ' с уникальным словом слово' + i);
    assert.equal(a.size(), 3, 'trimmed to capacity 3');
    a.save();

    const b = store.create({ filePath: tmpFile, capacity: 3 });
    assert.equal(b.size(), 3, 'reloaded trimmed size');
  });

  it('save writes valid JSON with version + facts', () => {
    const a = store.create({ filePath: tmpFile });
    a.add('простой факт для проверки формата джейсон');
    a.save();
    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    assert.equal(raw.version, 1);
    assert.ok(Array.isArray(raw.facts));
    assert.equal(raw.facts.length, 1);
    assert.ok(raw.facts[0].text.includes('проверки формата'));
  });
});