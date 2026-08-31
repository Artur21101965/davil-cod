// test/websearch.test.js — парсер DuckDuckGo, сеть мокается через fetchImpl.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let ws;

beforeEach(() => {
  delete require.cache[require.resolve('../lib/websearch')];
  ws = require('../lib/websearch');
});

// Минимальный фрагмент DDG HTML, эмулирующий результат.
function fakeDdgHtml() {
  return `<html><body>
  <div class="result results_links links_deep">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.minimax.io%2F&amp;rut=abc">MiniMax</a>
    <a class="result__snippet">Chinese AI company — LLM, video, audio.</a>
  </div>
  <div class="result results_links links_deep">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fminimax-ai.ru%2F&amp;rut=def">MiniMax AI нейросеть на русском</a>
  </div>
  </body></html>`;
}

describe('websearch.decodeUrl', () => {
  beforeEach(() => { ws = require('../lib/websearch'); });
  it('decodes DDG obfuscated uddg URL', () => {
    const u = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.minimax.io%2F&amp;rut=abc';
    assert.equal(ws.decodeUrl(u), 'https://www.minimax.io/');
  });
  it('returns as-is for normal URL', () => {
    assert.equal(ws.decodeUrl('https://example.com/x'), 'https://example.com/x');
  });
});

describe('websearch.parseDdg', () => {
  beforeEach(() => { ws = require('../lib/websearch'); });
  it('extracts title, url, snippet from results', () => {
    const r = ws.parseDdg(fakeDdgHtml());
    assert.equal(r.length, 2);
    assert.equal(r[0].title, 'MiniMax');
    assert.equal(r[0].url, 'https://www.minimax.io/');
    assert.match(r[0].snippet, /Chinese AI company/);
    assert.equal(r[1].url, 'https://minimax-ai.ru/');
  });
  it('handles empty html gracefully', () => {
    assert.deepEqual(ws.parseDdg('<html></html>'), []);
  });
});

describe('websearch.search', () => {
  beforeEach(() => { ws = require('../lib/websearch'); });
  it('returns results using fetchImpl', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => fakeDdgHtml() });
    const r = await ws.search('minimax нейросеть', { fetchImpl, limit: 3 });
    assert.equal(r.length, 2);
    assert.ok(r[0].url.includes('minimax'));
  });
  it('returns [] on fetch failure (no throw)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, text: async () => '' });
    const r = await ws.search('x', { fetchImpl });
    assert.deepEqual(r, []);
  });
  it('returns [] on network error (no throw)', async () => {
    const fetchImpl = async () => { throw new Error('network down'); };
    const r = await ws.search('x', { fetchImpl });
    assert.deepEqual(r, []);
  });
  it('respects limit param', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => fakeDdgHtml() });
    const r = await ws.search('x', { fetchImpl, limit: 1 });
    assert.equal(r.length, 1);
  });
});
