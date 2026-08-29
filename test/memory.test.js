// test/memory.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
let mem;

function loadFresh() {
  delete require.cache[require.resolve('../lib/memory')];
  mem = require('../lib/memory');
}

describe('memory.tokenize', () => {
  it('lowercases, splits words, removes short tokens and stopwords', () => {
    loadFresh();
    const tokens = mem.tokenize('Как нам сделать keepAlive в providers.js?');
    assert.ok(tokens.includes('keepalive'), 'keepAlive → keepalive');
    assert.ok(tokens.includes('providers'), 'providers present');
    assert.ok(!tokens.includes('как'), 'stopword "как" removed');
    assert.ok(!tokens.includes('нам'), 'stopword "нам" removed');
    assert.ok(!tokens.includes('js'), 'short token "js" (<3) removed');
  });

  it('adds suffix-trigrams for russian morphology', () => {
    loadFresh();
    const tokens = mem.tokenize('работаем с отчётами');
    assert.ok(tokens.includes('отчётами'), 'full token present');
    assert.ok(tokens.some(t => t.startsWith('_')), 'some trigram tokens present');
  });

  it('duplicate token contribution is bounded (counting once per doc)', () => {
    loadFresh();
    const tokens = mem.tokenize('test test test');
    assert.equal(tokens.filter(t => t === 'test').length, 1, 'token counted once');
  });
});

describe('memory.MemStore', () => {
  it('add stores a fact and recall finds it by similar query', () => {
    loadFresh();
    const store = new mem.MemStore();
    store.add('keepAlive агенты добавлены в providers.js (maxSockets 64, выигрыш 0.5s→0.016s)');
    const found = store.recall('почему повторные запросы идут так быстро через keepalive?', {}).map(f => f.text);
    assert.ok(found.some(f => f.includes('keepAlive')), 'recall should find the keepAlive fact');
  });

  it('recall returns empty for unrelated query', () => {
    loadFresh();
    const store = new mem.MemStore();
    store.add('keepAlive агенты добавлены в providers.js');
    const found = store.recall('что мы делали с погодой на улице вчера', {});
    assert.deepEqual(found, []);
  });

  it('recall respects topK and minSimilarity', () => {
    loadFresh();
    const store = new mem.MemStore();
    store.add('починено: const→let в сервере');  // не связано
    store.add('tier-splus перемаплен на minimax-m3');
    store.add('nemotron 404 — модель мёртва, отключён');
    const found = store.recall('на какой тир перемаплен minimax?', { topK: 1, minSimilarity: 0.15 });
    assert.equal(found.length, 1, 'topK=1');
    assert.ok(found[0].text.includes('minimax'), 'should pick the minimax fact');
  });

  it('deduplicates identical facts by hash', () => {
    loadFresh();
    const store = new mem.MemStore();
    store.add('keepAlive агенты добавлены в providers.js');
    store.add('keepAlive агенты добавлены в providers.js');
    assert.equal(store.size(), 1, 'identical text stored once');
  });

  it('evict removes least-accessed facts past capacity', () => {
    loadFresh();
    const store = new mem.MemStore(2); // capacity 2
    store.add('факт номер один');
    store.add('факт номер два');
    const firstId = store._facts[0].id;
    // access the second more: recall it twice
    store.recall('факт номер два');
    store.recall('факт номер два');
    store.recall('факт номер два');
    store.add('факт номер три'); // evicts least-accessed → firstId
    assert.ok(!store._facts.some(f => f.id === firstId), 'least-accessed fact evicted');
    assert.equal(store.size(), 2);
  });

  it('export/import round-trips facts preserving id+text', () => {
    loadFresh();
    const store = new mem.MemStore();
    store.add('keepAlive агенты добавлены в providers.js');
    store.add('tier-splus перемаплен на minimax-m3');
    const exported = store.export();
    const store2 = new mem.MemStore();
    store2.import(exported);
    assert.equal(store2.size(), 2);
    const found = store2.recall('на какой тир перемаплен minimax?', { topK: 1, minSimilarity: 0.1 });
    assert.ok(found.length === 1 && found[0].text.includes('minimax'));
  });
});