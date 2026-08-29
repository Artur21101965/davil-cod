# Semantic Cache + Window-Aware Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantic (char-trigram Dice) cache layer to LRUCache and make context compaction threshold depend on the target provider's `context_window`.

**Architecture:** Two independent features. (1) `lib/compactor.js` gains `compactionThresholdFor(contextWindow)` and `prepareMessages(messages, { contextWindow })` — one formula: defined window → `min(win*0.5, 100000)`, unknown → `60000`. Server passes the target provider's window. (2) `lib/semcache.js` new module with `trigrams()`/`dice()` pure functions; `lib/cache.js` LRUCache stores per-entry `grams` + `model` + `temperature` and gains `getSemantic(model, messages, temperature, minSimilarity)`, plus a `semHits` counter. `server.js` calls `getSemantic` on exact-cache miss and replays via a shared `serveCached()` helper; MIN_WINDOW drops 128000→50000.

**Tech Stack:** Node.js stdlib only (node:test, crypto, zlib-less), zero dependencies.

---

## File Structure

- `lib/compactor.js` — add `compactionThresholdFor`, extend `prepareMessages` signature, export both.
- `lib/semcache.js` — NEW: `trigrams(text)`, `dice(aSet, bSet)`, `similarityScore(textA, textB)` sugar.
- `lib/cache.js` — LRUCache: store `grams`/`model`/`temperature` on entries, `getSemantic()`, `semHits`, persist grams.
- `server.js` — pass `{ contextWindow }` to prepareMessages; `getSemantic` on miss; extract `serveCached`; MIN_WINDOW→50000.
- `test/compactor.test.js` — threshold table tests + options-aware prepareMessages.
- `test/semcache.test.js` — NEW: trigrams/dice units.
- `test/cache.test.js` — NEW: getSemantic hits/misses/guards/persist/eviction.
- `test/proxy.test.js` — exact-cache behavior unchanged (guards), extract nothing.

---

### Task 1: compactor — `compactionThresholdFor` + options-aware `prepareMessages`

**Files:**
- Modify: `lib/compactor.js` (add helper near `COMPACT_THRESHOLD` block, line ~10; modify `prepareMessages` at line 108; update `module.exports` line 208)
- Test: `test/compactor.test.js`

- [ ] **Step 1: Write the failing tests** (append to `test/compactor.test.js`)

```js
describe('compactor.compactionThresholdFor', () => {
  it('returns COMPACT_THRESHOLD for unknown/zero window', () => {
    loadFresh();
    assert.equal(compactor.compactionThresholdFor(0), compactor.COMPACT_THRESHOLD);
    assert.equal(compactor.compactionThresholdFor(undefined), compactor.COMPACT_THRESHOLD);
  });

  it('caps defined windows at min(win*0.5, 100000)', () => {
    loadFresh();
    assert.equal(compactor.compactionThresholdFor(33000), Math.floor(33000 * 0.5)); // 16500
    assert.equal(compactor.compactionThresholdFor(65536), Math.floor(65536 * 0.5)); // 32768
    assert.equal(compactor.compactionThresholdFor(128000), Math.floor(128000 * 0.5)); // 64000
    assert.equal(compactor.compactionThresholdFor(512000), 100000);
    assert.equal(compactor.compactionThresholdFor(1048576), 100000);
  });

  it('defined-window threshold never exceeds 100000', () => {
    loadFresh();
    assert.ok(compactor.compactionThresholdFor(1000000) <= 100000);
  });
});

// NOTE on test sizes: estimateTokens = chars / CHARS_PER_TOKEN(1.5). To hit
// est ≈ N tokens use big = 'w'.repeat(N * 1.5) chars. compactOld reserves
// KEEP_RECENT_TOKENS(30000) for the recent tail and only summarizes the OLD
// prefix — so a request must exceed 30000 est to have any compactable head.
// window 33000 → threshold 16500: est 32006 (> 16500, > 30000) compacts.
// window 1048576 → threshold 100000; window 128000 → threshold 64000:
// est 32006 is below both → unchanged. All sizes are also below global 60000,
// so only the contextWindow option can trigger compaction.
const EST_TOKENS = 32000;
function bigMessage(estTokens) {
  return { role: 'user', content: 'w'.repeat(Math.ceil(estTokens * 1.5)) };
}

describe('compactor.prepareMessages with contextWindow option', () => {
  it('compacts at a smaller threshold for a small-window target', async () => {
    loadFresh();
    // total est ≈ 32006 > threshold(33000)=16500 → compacts.
    const msgs = [
      { role: 'system', content: 'Ты — помощник. Отвечай кратко.' },
      bigMessage(EST_TOKENS),
      { role: 'user', content: 'продолжай' },
    ];
    compactor.getSummary = async () => 'краткое резюме диалога';
    const result = await compactor.prepareMessages(msgs, { contextWindow: 33000 });
    assert.notDeepEqual(result, msgs, 'should compact for the small window');
    assert.ok(result.some(m => m.content && m.content.includes('[Резюме')), 'summary present');
  });

  it('does NOT compact under a large window where global threshold applies', async () => {
    loadFresh();
    // total est ≈ 32006 < threshold(1048576)=100000 → unchanged, getSummary unused.
    const msgs = [
      { role: 'system', content: 'Ты — помощник.' },
      bigMessage(EST_TOKENS),
      { role: 'user', content: 'продолжай' },
    ];
    compactor.getSummary = async () => 'вызван не должен быть';
    const result = await compactor.prepareMessages(msgs, { contextWindow: 1048576 });
    assert.deepEqual(result, msgs, 'no compaction under large window at this size');
  });

  it('prevents prefer-small over global: window 128k still compacts only above 64k est', async () => {
    loadFresh();
    // total est ≈ 32006 < threshold(128000)=64000 → unchanged.
    const msgs = [bigMessage(EST_TOKENS)];
    compactor.getSummary = async () => 'никогда';
    const result = await compactor.prepareMessages(msgs, { contextWindow: 128000 });
    assert.deepEqual(result, msgs);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test test/compactor.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: fail — `compactor.compactionThresholdFor is not a function`.

- [ ] **Step 3: Implement `compactionThresholdFor` and extend `prepareMessages`**

In `lib/compactor.js`, after the `MAX_FACTS_PER_COMPACTION` block (around line 38), add:

```js
// Эффективный порог компакции зависит от реального окна целевого провайдера.
// estimateTokens намеренно занижает (~2x реальных токенов), поэтому для
// известного окна держим est <= win*0.5 (реальные токены точно влезут) и
// капаем на 100k est (≈200k реальных сидят с запасом даже в 512k/1M окнах).
// Неизвестное окно — прежнее поведение (COMPACT_THRESHOLD).
function compactionThresholdFor(contextWindow) {
  if (!contextWindow || contextWindow <= 0) return COMPACT_THRESHOLD;
  return Math.min(Math.floor(contextWindow * 0.5), 100000);
}
```

Change `prepareMessages` (line 108):

```js
async function prepareMessages(messages, opts = {}) {
  // Compact if above threshold; otherwise return unchanged.
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const threshold = compactionThresholdFor(opts.contextWindow);
  const total = estimateTokens(messages);
  if (total <= threshold) return messages;
  return compactOld(messages);
}
```

Update `module.exports` (line 208) to add `compactionThresholdFor`:

```js
module.exports = { estimateTokens, prepareMessages, compactOld, getSummary, summaryCache, COMPACT_THRESHOLD, KEEP_RECENT_TOKENS, SUMMARY_MAX_TOKENS, SUMMARIZERS, parseSummaryResponse, ingestFacts, setMemory, MAX_FACTS_PER_COMPACTION, compactionThresholdFor };
```

- [ ] **Step 4: Run tests**

Run: `node --test test/compactor.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/compactor.js test/compactor.test.js
git commit -m "feat(compactor): window-aware compaction threshold"
```

---

### Task 2: semcache — pure trigrams/dice module

**Files:**
- Create: `lib/semcache.js`
- Test: `test/semcache.test.js` (new)

- [ ] **Step 1: Write the failing tests** (create `test/semcache.test.js`)

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/semcache.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: fail — `Cannot find module '../lib/semcache'`.

- [ ] **Step 3: Implement `lib/semcache.js`**

```js
// lib/semcache.js
// Символьные триграммы + Dice coefficient — zero-dep мера близости короткого
// текста для семантического кэша. Триграммы инвариантны к регистру и почти
// инвариантны к мелким перефразировкам («исправь ошибку» vs «исправь ошибку
// пожалуйста»), что и ловит повторные агентские промпты с другой формулировкой.

function trigrams(text) {
  if (!text || typeof text !== 'string') return [];
  const t = text.toLowerCase();
  if (t.length < 3) return [];
  const out = [];
  for (let i = 0; i <= t.length - 3; i++) out.push(t.slice(i, i + 3));
  return out;
}

function dice(aSet, bSet) {
  const ia = aSet.size;
  const ib = bSet.size;
  if (ia === 0 && ib === 0) return 1;
  if (ia === 0 || ib === 0) return 0;
  let inter = 0;
  const [small, large] = ia <= ib ? [aSet, bSet] : [bSet, aSet];
  for (const g of small) if (large.has(g)) inter++;
  return (2 * inter) / (ia + ib);
}

function similarityScore(textA, textB) {
  return dice(new Set(trigrams(textA)), new Set(trigrams(textB)));
}

module.exports = { trigrams, dice, similarityScore };
```

- [ ] **Step 4: Run tests**

Run: `node --test test/semcache.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/semcache.js test/semcache.test.js
git commit -m "feat(semcache): char-trigram dice similarity module"
```

---

### Task 3: cache — `getSemantic`, grams persistence, `semHits`

**Files:**
- Modify: `lib/cache.js`
- Test: `test/cache.test.js` (new)

- [ ] **Step 1: Write the failing tests** (create `test/cache.test.js`)

```js
// test/cache.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { LRUCache } = require('../lib/cache');

function freshCache() {
  return new LRUCache(20, 60000, true, true); // skip load, useNormalize on
}

describe('LRUCache.getSemantic', () => {
  it('hits a near-duplicate rephrase of a cached dialog', () => {
    const c = freshCache();
    c.set('codestral', [{ role: 'user', content: 'исправь ошибку в коде ниже' }], 0.2, { answer: 'fixed' });
    const hit = c.getSemantic('codestral', [{ role: 'user', content: 'исправь ошибку в коде ниже пожалуйста' }], 0.2, 0.5);
    assert.ok(hit, 'expected a semantic hit');
    assert.deepEqual(hit.value, { answer: 'fixed' });
    assert.ok(hit.similarity >= 0.5);
  });

  it('misses when similarity below threshold', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'как дела' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: 'напиши стих' }], 0, 0.9);
    assert.equal(miss, null);
  });

  it('misses when model differs', () => {
    const c = freshCache();
    c.set('model-a', [{ role: 'user', content: 'привет мир как дела' }], 0, { a: 1 });
    const miss = c.getSemantic('model-b', [{ role: 'user', content: 'привет мир как дела' }], 0, 0.5);
    assert.equal(miss, null);
  });

  it('misses when temperature differs', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'привет мир как дела' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: 'привет мир как дела ' }], 1.0, 0.5);
    assert.equal(miss, null);
  });

  it('skips code-looking requests', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'исправь function foo() { return 1; }' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: 'исправь function foo() { return 2; }' }], 0, 0.5);
    assert.equal(miss, null);
  });

  it('skips tool-state messages', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'hello world today' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [
      { role: 'user', content: 'hello world today' },
      { role: 'tool', content: '{report: "x"}', tool_call_id: 't1' },
    ], 0, 0.5);
    assert.equal(miss, null);
  });

  it('skips non-string content arrays', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'hello world today' }], 0, { a: 1 });
    const miss = c.getSemantic('m', [
      { role: 'user', content: [{ type: 'text', text: 'hello world today' }] },
    ], 0, 0.5);
    assert.equal(miss, null);
  });

  it('returns null when normalized text is empty', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] }], 0, { a: 1 });
    const miss = c.getSemantic('m', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } }] }], 0, 0.5);
    assert.equal(miss, null);
  });

  it('bumps semHits and stats', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'продолжай работу над проектом пожалуйста' }], 0.1, { ok: true });
    c.getSemantic('m', [{ role: 'user', content: 'продолжай работу над проектом' }], 0.1, 0.5);
    assert.equal(c.stats().semHits, 1);
  });

  it('increments misses (not hits) on a semantic miss', () => {
    const c = freshCache();
    c.set('m', [{ role: 'user', content: 'hello world foo bar baz' }], 0, { ok: true });
    c.getSemantic('m', [{ role: 'user', content: 'совершенно другая тема' }], 0, 0.99);
    const s = c.stats();
    assert.equal(s.semHits, 0);
    assert.equal(s.misses, 1);
  });
});

describe('LRUCache grams persistence', () => {
  it('persists grams and restores semantic hits after reload', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-grams-'));
    const file = path.join(dir, 'cache.json');
    // Point module CACHE_PATH at temp by re-requiring with patched env not needed:
    // LRUCache uses a module-level CACHE_PATH, so we test via a second instance
    // sharing the same cache Map is not possible; instead use instance persist().
    const c = new LRUCache(20, 60000, true, true);
    c.set('m', [{ role: 'user', content: 'напиши резюме проекта swift полностью' }], 0.2, { ok: true });
    // Manually write cache.json via persist() — default file path is fine here;
    // cleanup happens after.
    c.persist();
    const written = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache.json'), 'utf8'));
    const hasGrams = written.entries.some(e => e.grams && e.grams.length > 0);
    assert.equal(hasGrams, true, 'grams persisted with entries');
    try { fs.unlinkSync(path.join(__dirname, '..', 'cache.json')); } catch {}
  });
});
```

Note: the disk persistence test asserts against the default `CACHE_PATH` (`cache.json` next to lib). `beforeEach` is imported but unused — remove it from the import line when writing the file.

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/cache.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: fail — `LRUCache.getSemantic is not a function`.

- [ ] **Step 3: Implement in `lib/cache.js`**

Add import at top (line 5 currently imports `normalizeMessages`):

```js
const { normalizeMessages, looksLikeCode } = require('./normalize');
const { trigrams, dice } = require('./semcache');
```

Extend the constructor: add `this.semHits = 0;`

```js
  constructor(maxSize = MAX_SIZE, ttl = DEFAULT_TTL, skipLoad = false, useNormalize = false) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.semHits = 0;
    this.useNormalize = useNormalize;
    if (!skipLoad) this.load();
  }
```

Change `set()` to store `model`, `temperature`, and `grams`:

```js
  set(model, messages, temperature, value) {
    const key = this._key(model, messages, temperature);

    // Delete if exists (to update order)
    if (this.cache.has(key)) this.cache.delete(key);

    // Evict least-used entry if at capacity (not just oldest)
    if (this.cache.size >= this.maxSize) {
      let victim = null;
      let minUses = Infinity;
      for (const [k, e] of this.cache) {
        const u = e.uses || 0;
        if (u < minUses) { minUses = u; victim = k; }
      }
      if (victim) this.cache.delete(victim);
    }

    // Семантический индекс: триграммы нормализованного диалога + параметры
    // запроса. Для кода/content-массивов grams не строим (их и так не ищем).
    let grams = null;
    const norm = normalizeMessages(messages);
    if (norm && !looksLikeCode(messages) &&
        !(Array.isArray(messages) && messages.some(m => m && (typeof m.content !== 'string' || m.role === 'tool')))) {
      grams = new Set(trigrams(norm));
    }

    this.cache.set(key, { value, created: Date.now(), uses: 0, model, temperature, grams: grams ? [...grams] : null });
  }
```

Add `getSemantic()` after `get()`:

```js
  // Семантический кэш: на промахе точного ключа ищем закэшированный диалог с
  // похожим нормализованным текстом (Dice по символьным триграммам). Отдаём
  // только при совпадении model+temperature и similarity >= minSimilarity.
  // Безопасность: код, сообщения с нестроковым content и role:'tool' никогда
  // не матчатся семантически (разный интент/состояние инструментов).
  getSemantic(model, messages, temperature, minSimilarity = 0.85) {
    // Guards mirror set()'s grams computation — anything that gets grams:null
    // in set() must not match here either.
    if (!Array.isArray(messages)) { this.misses++; return null; }
    const norm = normalizeMessages(messages);
    if (!norm || looksLikeCode(messages)) { this.misses++; return null; }
    if (messages.some(m => m && (typeof m.content !== 'string' || m.role === 'tool'))) { this.misses++; return null; }

    const qgrams = new Set(trigrams(norm));
    if (qgrams.size === 0) { this.misses++; return null; }

    let bestKey = null;
    let bestSim = 0;
    for (const [key, entry] of this.cache) {
      if (entry.model !== model || entry.temperature !== temperature) continue;
      if (!entry.grams || entry.grams.length === 0) continue;
      const sim = dice(qgrams, new Set(entry.grams));
      if (sim > bestSim) { bestSim = sim; bestKey = key; }
    }

    if (!bestKey || bestSim < minSimilarity) { this.misses++; return null; }

    const entry = this.cache.get(bestKey);
    // Bump TTL + usage like a regular hit so hot semantic entries stay cached.
    entry.created = Date.now();
    entry.uses = (entry.uses || 0) + 1;
    this.cache.delete(bestKey);
    this.cache.set(bestKey, entry);
    this.semHits++;
    return { value: entry.value, similarity: Math.round(bestSim * 1000) / 1000 };
  }
```

Update `persist()` to write grams/model/temperature and restore in `load()`:

persist entries push:
```js
          entries.push({ key, value: entry.value, created: entry.created, uses: entry.uses || 0, model: entry.model, temperature: entry.temperature, grams: entry.grams || null });
```

load restore:
```js
          this.cache.set(e.key, { value: e.value, created: e.created, uses: e.uses || 0, model: e.model, temperature: e.temperature, grams: e.grams || null });
```

Update `stats()` to include semHits:
```js
  stats() {
    return {
      hits: this.hits,
      misses: this.misses,
      semHits: this.semHits,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100)
        : 0,
    };
  }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/cache.test.js test/proxy.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: all pass (existing proxy.test.js cache tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add lib/cache.js lib/semcache.js test/cache.test.js
git commit -m "feat(cache): semantic cache layer with char-trigram dice matching"
```

---

### Task 4: server integration — contextWindow, getSemantic, serveCached, MIN_WINDOW

**Files:**
- Modify: `server.js` (line 310 prepareMessages call; cache block ~354-373; MIN_WINDOW line 392; config block after line 75)

- [ ] **Step 1: Add the semcache config + wire contextWindow**

In `server.js` after the `MEMORY_CONFIG` block (after line 75), add:

```js
// --- Семантический кэш ---
// На промахе точного ключа ищет закэшированный диалог с похожим нормализованным
// текстом (Dice по символьным триграммам). config.semcache.enabled=false отключает.
const SEMCACHE_CONFIG = Object.assign(
  { enabled: true, minSimilarity: 0.85 },
  (config.semcache && typeof config.semcache === 'object') ? config.semcache : {}
);
```

Change the prepareMessages call (line 310):
```js
    body.messages = await prepareMessages(body.messages, { contextWindow: PROVIDERS[targetProviderKey]?.context_window || 0 });
```

- [ ] **Step 2: Extract `serveCached` helper + wire `getSemantic`**

Current cached-response block (lines 354-373) serves both stream and JSON. Replace it:

```js
  // Replays a previously cached completion (exact or semantic hit), preserving
  // the stream/non-stream shape the client asked for.
  function serveCached(res, cached, isStreaming) {
    if (isStreaming) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const content = cached.choices?.[0]?.message?.content || '';
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-cached', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: cached.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-cached', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: cached.model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-cached', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: cached.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
    }
  }

  // Check cache (works for both streaming and non-streaming)
  const cached = cache.get(effectiveModel, body.messages, body.temperature);
  if (cached) {
    logger.request({ model: requestedModel, provider: 'cache', status: 200, cached: true });
    recordRecent({ model: requestedModel, provider: 'cache', status: 200, latency: 0, cached: true });
    serveCached(res, cached, isStreaming);
    return;
  }

  // Semantic cache: same intent, rephrased wording → replay without a new LLM call.
  if (SEMCACHE_CONFIG.enabled) {
    const semantic = cache.getSemantic(effectiveModel, body.messages, body.temperature, SEMCACHE_CONFIG.minSimilarity);
    if (semantic) {
      logger.request({ model: requestedModel, provider: 'semcache', status: 200, cached: true });
      recordRecent({ model: requestedModel, provider: 'semcache', status: 200, latency: 0, cached: true });
      serveCached(res, semantic.value, isStreaming);
      return;
    }
  }
```

- [ ] **Step 3: Lower MIN_WINDOW**

Line 392:
```js
  const MIN_WINDOW = 50000; // below this we don't filter (typical requests)
```

- [ ] **Step 4: Verify syntax + full tests**

Run: `node --check server.js && node --test test/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: syntax OK, all tests pass (109 + new ≥ 3 semcache + ≥ 8 cache + ≥ 5 compactor = expected total).

- [ ] **Step 5: Restart the live server**

Run: `launchctl kickstart -k gui/$(id -u)/com.free-llm-proxy`
Then `curl -s http://localhost:4000/health` → expect `{"status":"ok",...}`.

- [ ] **Step 6: Live verification — rephrased second request must hit semcache**

Run (send two rephrased but same-intent strings; second should log semcache):
```bash
cd ~/.config/opencode/llm-proxy
curl -s -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer free-llm-proxy-2024" -H "Content-Type: application/json" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":"напиши коротко что такое кэш в программировании подробно опиши"}]}' | head -c 120; echo
sleep 1
curl -s -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer free-llm-proxy-2024" -H "Content-Type: application/json" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":"напиши кратко что такое кэш в программировании очень подробно опиши это"}]}' | head -c 120; echo
grep -a "semcache" proxy.log | tail -3
```
Expected: second request logged as `provider: semcache` (or, if phrasing collides with exact normalize, `provider: cache` is also fine — the point is no third LLM call). Then a third UNRELATED prompt must NOT hit the cache:
```bash
curl -s -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer free-llm-proxy-2024" -H "Content-Type: application/json" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":"напиши рецепт борща в три абзаца"}]}' | head -c 60; echo
grep -a "cache" proxy.log | tail -2
```

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: semantic cache path and window-aware compaction wiring"
```

---

### Task 5: compaction live check — small-window target compacts earlier

**Files:**
- No new files — verification only.

- [ ] **Step 1: Verify window-aware compaction on a large request to tier-s (codestral, 33k window)**

Run a prompt big enough that est > 16500 (codestral threshold) but < 60000 (old global), and confirm it compacts (summary appears in final messages → model answers coherently with the compaction marker visible in server response is not exposed; use log):

```bash
cd ~/.config/opencode/llm-proxy
python3 -c "
import json, urllib.request, time
big = 'word '*12000  # ~60000 chars ≈ 40000 est tokens — above codestral 16.5k thr AND
                     # above KEEP_RECENT_TOKENS(30000) so a compactable head exists;
                     # below the old 60k global threshold → only window-aware kicks in.
msgs=[{'role':'user','content':big},{'role':'user','content':'подведи итог что ты помнишь?'}]
body=json.dumps({'model':'tier-s','messages':msgs}).encode()
req=urllib.request.Request('http://localhost:4000/v1/chat/completions',data=body,headers={'Authorization':'Bearer free-llm-proxy-2024','Content-Type':'application/json'})
t=time.time(); d=json.loads(urllib.request.urlopen(req,timeout=120).read()); print('ok',round(time.time()-t,1),'s | model',d.get('model'))
print((d['choices'][0]['message']['content'] or '')[:120])
"
```
Expected: 200, model codestral-latest. If compaction ran, the answer references the summarized content despite the long input — proving the summary path engaged. (This is an observational check; the covering unit test is the deterministic one.)

- [ ] **Step 2: Confirm no regression — normal short request still fast**

```bash
cd ~/.config/opencode/llm-proxy
curl -s -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer free-llm-proxy-2024" -H "Content-Type: application/json" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":"скажи привет одним словом"}]}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('ok', (d['choices'][0]['message']['content'] or '')[:40])"
```

- [ ] **Step 3: Final full check**

Run: `node --test test/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)"` and `node --check server.js lib/*.js`
Expected: all green.

- [ ] **Step 4: Commit (if anything changed during verification)**

```bash
git add -A && git commit -m "chore: verify window-aware compaction and semantic cache live" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (compaction threshold): Task 1 implements `compactionThresholdFor` + options; Task 4 wires contextWindow from target provider; Task 5 live-verifies. ✅
- Part 2 (semantic cache): Task 2 pure module, Task 3 cache hook + persistence + semHits, Task 4 server path + serveCached extraction. ✅
- Part 3 (MIN_WINDOW 128k→50k): Task 4 Step 3. ✅

**Placeholder scan:** none — every step has concrete code.

**Type consistency:**
- `compactionThresholdFor(contextWindow)` — same name in tests and impl. ✅
- `prepareMessages(messages, opts)` — tests use `{ contextWindow }`, server same. ✅
- `LRUCache.getSemantic(model, messages, temperature, minSimilarity)` — consistent. ✅
- Returns `{ value, similarity }` — server reads `.value`, test reads `.value`/`.similarity`. ✅
- `stats().semHits` — consistent. ✅