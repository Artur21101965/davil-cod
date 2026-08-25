# Freegate: Thompson Sampling Bandit для выбора провайдера

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ SUB-SKILL: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для реализации этого плана задача-за-задачей. Шаги используют синтаксис чекбоксов (`- [ ]`) для отслеживания.

**Goal:** Заменить эвристический весовой выбор провайдера на Thompson sampling bandit (Beta-Bernoulli) с бакетами по сложности, учитывающий качество ответа.

**Architecture:** Новый чистый модуль `lib/bandit.js` (алгоритм), расширение `lib/health.js` (персистентные приоры), интеграция в `server.js` (выбор через bandit + запись исходов). Safety-слои (circuit breaker, dailyLimit, vision, target буст) сохраняются.

**Tech Stack:** Node.js (CommonJS), `node:test`, существующие server.js, lib/health.js, lib/routing.js (classifyComplexity).

**Base:** `/Users/sid/.config/opencode/llm-proxy/.worktrees/bandit/`
**Тесты:** `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js`

---

### Task 1: lib/bandit.js — алгоритм

**Files:**
- Create: `lib/bandit.js`
- Test: `test/bandit.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// test/bandit.test.js
const test = require('node:test');
const assert = require('node:assert');
const { bucket, sampleBeta, pick, recordOutcome } = require('../lib/bandit');

test('bandit: bucket boundaries', () => {
  assert.strictEqual(bucket(0), 'low');
  assert.strictEqual(bucket(0.39), 'low');
  assert.strictEqual(bucket(0.4), 'med');
  assert.strictEqual(bucket(0.69), 'med');
  assert.strictEqual(bucket(0.7), 'high');
  assert.strictEqual(bucket(1), 'high');
});

test('bandit: sampleBeta returns values in [0,1]', () => {
  for (let i = 0; i < 100; i++) {
    const s = sampleBeta(2 + Math.random() * 10, 2 + Math.random() * 10);
    assert.ok(s >= 0 && s <= 1, `sample ${s} out of range`);
  }
});

test('bandit: sampleBeta with equal priors is symmetric around 0.5', () => {
  // Beta(2,2) mean is 0.5; many samples average near 0.5
  let sum = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) sum += sampleBeta(2, 2);
  assert.ok(Math.abs(sum / N - 0.5) < 0.1, `avg ${sum / N}`);
});

test('bandit: pick chooses the trained-best provider', () => {
  // Provider A: mostly successes. Provider B: mostly failures.
  const priors = { A: { a: 20, b: 2 }, B: { a: 2, b: 20 } };
  let aWins = 0;
  for (let i = 0; i < 200; i++) {
    if (pick([{ key: 'A' }, { key: 'B' }], priors) === 'A') aWins++;
  }
  assert.ok(aWins > 150, `A should win most, got ${aWins}/200`);
});

test('bandit: buckets are isolated (success in low does not affect high)', () => {
  const lowPriors = { X: { a: 10, b: 1 } };
  // high bucket should still be cold (uniform) for X
  const highPriors = { X: { a: 1, b: 1 } };
  // Different priors objects = isolated. Verify pick behaves differently:
  // with lowPriors X has high alpha, sample near 1. With highPriors uniform.
  let lowAvg = 0, highAvg = 0, N = 500;
  for (let i = 0; i < N; i++) {
    lowAvg += sampleBeta(lowPriors.X.a + 1, lowPriors.X.b + 1);
    highAvg += sampleBeta(highPriors.X.a + 1, highPriors.X.b + 1);
  }
  assert.ok(lowAvg / N > 0.7, `low bucket trained, got ${lowAvg / N}`);
  assert.ok(highAvg / N < 0.6, `high bucket cold, got ${highAvg / N}`);
});

test('bandit: recordOutcome increments alpha on success, beta on failure', () => {
  const priors = {};
  recordOutcome(priors, 'A', true);
  recordOutcome(priors, 'A', true);
  recordOutcome(priors, 'A', false);
  assert.strictEqual(priors.A.a, 3); // 1 initial + 2 success
  assert.strictEqual(priors.A.b, 2); // 1 initial + 1 failure
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/bandit.test.js`
Expected: FAIL with `Cannot find module '../lib/bandit'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/bandit.js
// Thompson sampling (Beta-Bernoulli) bandit для выбора провайдера.
// Каждый провайдер в каждом бакете сложности имеет приоры Beta(a, b).
// Выбор: рисуем сэмпл из Beta(a, b) для каждого, берём максимум.
// Исход: успех → a+=1, фейл → b+=1.

const BUCKET_THRESHOLDS = [0.4, 0.7];

function bucket(complexity) {
  if (complexity < BUCKET_THRESHOLDS[0]) return 'low';
  if (complexity < BUCKET_THRESHOLDS[1]) return 'med';
  return 'high';
}

// Marsaglia-Tsang sampling of Gamma(shape, scale=1). Valid for shape >= 1.
function sampleGamma(shape) {
  if (shape < 1) {
    // Подъём: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = Math.random(); v = -1 + 1.2 * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// Сэмпл из Beta(alpha, beta). Beta(1,1) = uniform.
function sampleBeta(alpha, beta) {
  if (alpha <= 0 || beta <= 0) return 0.5;
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  const denom = x + y;
  return denom > 0 ? x / denom : 0.5;
}

// Выбор провайдера: максимум сэмплов. weight добавляется к alpha (скорость/score).
// prior = { a, b } из бакета. sample = Beta(a + weight, b + 1).
function pick(scored, bucketPriors) {
  let best = null;
  let bestVal = -Infinity;
  for (const item of scored) {
    const key = item.key;
    const weight = typeof item.weight === 'number' ? item.weight : 1;
    const prior = (bucketPriors && bucketPriors[key]) || { a: 1, b: 1 };
    const sample = sampleBeta(prior.a + weight, prior.b + 1);
    if (sample > bestVal) { bestVal = sample; best = key; }
  }
  return best;
}

// Обновление приоров после исхода.
function recordOutcome(bucketPriors, key, success) {
  bucketPriors[key] = bucketPriors[key] || { a: 1, b: 1 };
  if (success) bucketPriors[key].a += 1;
  else bucketPriors[key].b += 1;
}

module.exports = { bucket, sampleBeta, pick, recordOutcome, BUCKET_THRESHOLDS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 test/bandit.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/bandit/
git add lib/bandit.js test/bandit.test.js
git commit -m "feat: Thompson sampling bandit (bucket/sampleBeta/pick/recordOutcome)"
```

### Task 2: lib/health.js — bandit-приоры в state

**Files:**
- Modify: `lib/health.js`
- Test: `test/bandit.test.js` (extend)

- [ ] **Step 1: Write failing test**

Add to `test/bandit.test.js`:

```javascript
test('health: bandit priors persist and update', () => {
  const health = require('../lib/health');
  health.recordBandit('med', 'test-key', true);
  health.recordBandit('med', 'test-key', false);
  const b = health.getBandit();
  assert.strictEqual(b.med['test-key'].a, 2); // 1 initial + 1 success
  assert.strictEqual(b.med['test-key'].b, 2); // 1 initial + 1 failure
  // low bucket untouched (isolation)
  assert.ok(!b.low['test-key'], 'low bucket isolated');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/bandit.test.js`
Expected: FAIL with `recordBandit is not a function`

- [ ] **Step 3: Modify lib/health.js**

Read lib/health.js. Add bandit to the initial `stats` object (line 10) and to `loadState` restore (lines 23-33). Add functions and exports.

In the initial stats object (line 10):
```javascript
let stats = { totalRequests: 0, successfulRequests: 0, failedRequests: 0, providerUsage: {}, errors: {}, startTime: Date.now(), tokenUsage: {}, bandit: { low: {}, med: {}, high: {} } };
```

In loadState restore (lines 23-33), add `bandit: saved.bandit || { low: {}, med: {}, high: {} },`.

Add functions before `module.exports`:
```javascript
function getBandit() { return stats.bandit; }
function recordBandit(bucketName, key, success) {
  stats.bandit[bucketName] = stats.bandit[bucketName] || {};
  stats.bandit[bucketName][key] = stats.bandit[bucketName][key] || { a: 1, b: 1 };
  if (success) stats.bandit[bucketName][key].a += 1;
  else stats.bandit[bucketName][key].b += 1;
}
```

Add to module.exports:
```javascript
  getBandit, recordBandit,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 test/bandit.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Run full suite to ensure no regression**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/bandit/
git add lib/health.js test/bandit.test.js
git commit -m "feat: persistent bandit priors per complexity bucket in health state"
```

### Task 3: server.js — выбор через bandit

**Files:**
- Modify: `server.js`
- Test: existing tests must pass

- [ ] **Step 1: Add imports**

At top of server.js, add bandit and routing imports. Find the existing imports:
```javascript
const { classifyComplexity, maybeUpgradeTier, classifyVisionComplexity } = require('./lib/routing');
```
Add after it:
```javascript
const { bucket, sampleBeta, pick: banditPick } = require('./lib/bandit');
```
And add `getBandit` to the health import:
```javascript
const { loadState, initHealth, isCircuitOpen, recordSuccess, recordFailure, recordRequest, recordTokens, getHealth, getStats, recordRecent, recordRpm, getRecent, getRpm, recordSelection, getLastSelection, getBandit, recordBandit } = require('./lib/health');
```

- [ ] **Step 2: Compute complexity bucket in handleChatCompletion**

At the top of `handleChatCompletion` (where `effectiveModel` is computed, ~line 126), add:
```javascript
  const complexity = classifyComplexity(body.messages);
  const complexityBucket = bucket(complexity);
```
Use the existing `classifyComplexity(body.messages)` — note it's already called there. Reuse the result.

- [ ] **Step 3: Replace the weighted selection score block**

In the provider selection (server.js:272-318), the `scored` mapping currently computes `weight = score/latency` with reliability multipliers. **Replace the reliability multipliers with bandit.** Keep the base `weight = score/latency` and the safety multipliers (ratelimited, target, dailyLimit).

Change lines 298-304 (the reliability ratio block) — REMOVE it entirely (bandit replaces it).

The scored mapping becomes:
```javascript
    const scored = pool.map(([key, provider]) => {
      const h = getHealth()[key];
      let score = h.score || 50;
      const rawLat = h.latency || 0;
      const lat = rawLat > 0 ? Math.max(rawLat, 100) : 500;
      let weight = score / lat;
      if (h.status === 'ratelimited') weight *= 0.05;
      if (key === targetProviderKey) weight *= 1.15;
      const dailyLimit = provider.dailyLimit || 1000;
      const usedToday = getStats().providerUsage[key] || 0;
      if (usedToday >= dailyLimit * 0.9) weight *= 0.5;
      return { key, provider, weight };
    }).sort((a, b) => b.weight - a.weight);
```

- [ ] **Step 4: Replace weightedRandom with bandit pick**

Replace the weighted-random loop (lines 308-317):
```javascript
    const totalWeight = scored.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * totalWeight;
    for (const p of scored) {
      r -= p.weight;
      if (r <= 0) { selected = [p]; break; }
    }
    if (selected.length === 0) selected = [scored[0]];
```
with bandit pick:
```javascript
    // Thompson sampling: рисуем сэмпл Beta(a+weight, b+1) для каждого,
    // выбираем максимум. Приоры из бакета сложности (bandit обучается).
    const priors = getBandit()[complexityBucket] || {};
    const bestKey = banditPick(scored, priors);
    const bestProvider = scored.find((p) => p.key === bestKey);
    if (bestProvider) selected = [bestProvider];
    else if (scored.length > 0) selected = [scored[0]];
```

- [ ] **Step 5: Run tests**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js`
Expected: PASS (all)

- [ ] **Step 6: Syntax check**

Run: `node --check server.js`

- [ ] **Step 7: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/bandit/
git add server.js
git commit -m "feat: select provider via Thompson sampling bandit (bucket-aware)"
```

### Task 4: server.js — запись исходов в bandit

**Files:**
- Modify: `server.js`
- Test: existing tests must pass

- [ ] **Step 1: Record bandit outcome on success**

Find where `recordSelection(key, provider.model, requestedModel)` is called after a successful request (in the non-stream and streaming success paths, ~lines 485-525). After `recordRequest(key, true)` add:
```javascript
        recordBandit(complexityBucket, key, true);
```
Add it in ALL success paths:
- Non-stream success branch (before cache.set, where recordSuccess/recordRequest are)
- Streaming reasoning branch (after recordSuccess/recordRequest)
- Streaming normal branch (after recordSuccess/recordRequest)
- allSoft retry non-stream and streaming branches

- [ ] **Step 2: Record bandit outcome on failure**

Where the empty/too-short guard records `recordRequest(key, false, msg)` (the isTooShort guard ~line 366), add:
```javascript
          recordBandit(complexityBucket, key, false);
```
In the streaming timeout fallback (no first token, ~line 468), add:
```javascript
          recordBandit(complexityBucket, key, false);
```
In the allSoft retry isTooShort guard, add:
```javascript
            recordBandit(complexityBucket, key, false);
```

- [ ] **Step 3: Record bandit outcome on catch errors**

In the provider loop `catch (err)` block (where `recordRequest(key, false, err.message)` is called, ~line 430), add:
```javascript
      recordBandit(complexityBucket, key, false);
```

- [ ] **Step 4: Verify complexityBucket is in scope at all these sites**

`complexityBucket` is declared at the top of handleChatCompletion (Task 3 Step 2). All these sites are inside handleChatCompletion, so it's in scope. Verify by reading.

- [ ] **Step 5: Run all tests**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js`
Expected: PASS (all)

- [ ] **Step 6: Syntax check**

Run: `node --check server.js`

- [ ] **Step 7: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/bandit/
git add server.js
git commit -m "feat: feed success/failure outcomes into bandit per complexity bucket"
```

---

## Финальная проверка

- [ ] **Step 1: Full test suite**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js`
Expected: ALL PASS

- [ ] **Step 2: Restart proxy and verify health**

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.free-llm-proxy.plist 2>/dev/null
pkill -9 -f "server.js" 2>/dev/null
sleep 3
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.free-llm-proxy.plist 2>/dev/null
sleep 8
curl -s http://localhost:4000/health
```
Expected: `{"status":"ok",...}`

- [ ] **Step 3: Smoke test — bandit selects providers**

```bash
# Несколько запросов разной сложности
curl -s --max-time 40 http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer free-llm-proxy-2024" -d '{"model":"tier-s","messages":[{"role":"user","content":"привет"}],"max_tokens":10}'
curl -s --max-time 60 http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer free-llm-proxy-2024" -d '{"model":"tier-s","messages":[{"role":"user","content":"Напиши функцию сортировки массива с комментариями"}],"max_tokens":10}'
# Проверить, что bandit-приоры обновились
curl -s http://localhost:4000/v1/stats | python3 -c "import sys,json; d=json.load(sys.stdin); print('bandit:', json.dumps(d.get('bandit',{}), indent=2)[:500])"
```
Expected: bandit priors populated.

- [ ] **Step 4: Bump version and publish**

```bash
npm version patch
npm publish
```

- [ ] **Step 5: Push to git + Docker**

```bash
git push
docker build -t nik951751/freegate:latest .
docker push nik951751/freegate:latest
```
