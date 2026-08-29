# Context Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Измерить и показать, где Freegate теряет контекст — контекстная телеметрия (агрегаты по `час|провайдер`), аналитика «узкого места» (`contextSummary`), блок в dashboard, CLI-отчёт.

**Architecture:** Zero-dep модуль `lib/contextstats.js` — класс `ContextStats`, который `record(measure)`-записи складывает в бакеты `isoHour|provider`. **Единственный экземпляр живёт в `lib/health.js`** (там же load/save через `loadState`/`saveState` → `stats.context` в `state.json`, автосохранение каждые 30с). Наследует прошлые сессии: `loadState()` в server.js вызывается на старте (server.js:21) и читает `saved.context`. server.js заполняет `measure` по ходу запроса и зовёт `commit(status)` **только в терминальных точках** (одна запись = один ответ). `/v1/stats` и `/health` отдают `context_summary`; dashboard рендерит блок; `tools/context-diag.js` читает `state.json`.

**Tech Stack:** Node.js stdlib (node:test, crypto, fs, path). Zero дополнительных npm-зависимостей.

## File Structure

- `lib/contextstats.js` — NEW: класс `ContextStats` (record/snapshot/summary/serialize/load/prune).
- `lib/health.js` — MODIFY: singleton `contextStats`, load/save в `loadState`/`saveState`, экспорт `getContextStats`.
- `server.js` — MODIFY: импорт `getContextStats`, `measure` + `commit(status)`, точки в терминальных ответах, `context_summary` в `/health` и `/v1/stats`.
- `lib/dashboard.js` — MODIFY: HTML-карточка `#ctxBlock` + `renderContext(data.context_summary)`.
- `tools/context-diag.js` — NEW: CLI-отчёт из `state.json`.
- `test/contextstats.test.js` — NEW: unit-тесты ContextStats.
- `test/proxy.test.js` — MODIFY: round-trip через health.saveState/loadState (с восстановлением `state.json`), экспорт `getContextStats`.

## Контракт данных (везде один формат)

Бакет (в `serialize()` / `state.json`):
```
{ key: "2026-08-29T20:00|mistral-codestral", hour: "2026-08-29T20:00", provider: "mistral-codestral",
  ts: <epoch начало часа>, requests: 0, sumEst: 0, sumReal: 0, ratioSum: 0, ratioMax: 0,
  nearWindow: 0, overWindow: 0, compactCount: 0, memoryCount: 0, cacheExact: 0, cacheSem: 0,
  status200: 0, status400: 0, status429: 0, statusOther: 0, sysShareSum: 0 }
```

`measure` (вход в `record`):
```
{ ts, provider, est, real, win, compacted, memory, cacheType:'miss|exact|semcache', sysShare, status }
```

`summary()` (в `/health` `context`, в `/v1/stats` `context_summary`, в dashboard):
```
{ status, totalRequests, ratePerHour, avgRatio, ratioMax, nearWindow, overWindow,
  narrowProviders:[...], compactCount, cacheHits, cacheHitRate, avgSysShare,
  providers:{ [key]: { requests, nearWindow, overWindow, compactCount } } }
```

`isoHour`: `YYYY-MM-DDTHH:00`, валидируется regex `^\d{4}-\d{2}-\d{2}T\d{2}:00$`.

Правила агрегации:
- `nearWindow`/`overWindow`/`ratio*` считаются **только если `real>0 && win>0`**; `ratio = real/win`; `nearWindow` при `ratio >= 0.9`; `overWindow` при `real > win`.
- `cacheType` → `cacheExact`/`cacheSem`; всё остальное → провал.
- `sysShare` копится в `sysShareSum` (доля), средняя считается по запросам с sysShare.
- retention 7 суток (`b.ts`), `record()` и `load()` никогда не бросают.

---

### Task 1: `lib/contextstats.js` + unit-тесты

**Files:** Create `lib/contextstats.js`, Create `test/contextstats.test.js`

- [ ] **Step 1: Write failing tests** — `test/contextstats.test.js`:

```js
// test/contextstats.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ContextStats } = require('../lib/contextstats');

function fresh() { return new ContextStats(); }

describe('ContextStats.record', () => {
  it('records a measure into hour|provider bucket', () => {
    const cs = fresh();
    cs.record({ ts: Date.parse('2026-08-29T20:33:00Z'), provider: 'mistral-codestral', est: 5000, real: 10000, win: 33000, status: 200 });
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 1);
    const b = snap.buckets[0];
    assert.equal(b.provider, 'mistral-codestral');
    assert.equal(b.hour, '2026-08-29T20:00');
    assert.equal(b.requests, 1);
    assert.equal(b.sumEst, 5000);
    assert.equal(b.sumReal, 10000);
    assert.ok(Math.abs(b.ratioMax - (10000 / 33000)) < 1e-9);
  });

  it('never throws on garbage input', () => {
    const cs = fresh();
    cs.record(null);
    cs.record({});
    cs.record({ ts: 'не число', provider: 123 });
    cs.record({ ts: Date.now(), provider: '', real: 'abc' });
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 1);
    assert.equal(snap.buckets[0].provider, 'unknown');
  });

  it('counts near/over window only when real and win are present', () => {
    const cs = fresh();
    const t = Date.parse('2026-08-29T21:00:00Z');
    cs.record({ ts: t, provider: 'a', real: 29700, win: 33000, status: 200 }); // ratio 0.9 → near
    cs.record({ ts: t, provider: 'a', real: 34000, win: 33000, status: 400 }); // real > win → over
    cs.record({ ts: t, provider: 'a', real: 500, win: 0, status: 200 });        // без win → без ratio
    const b = cs.snapshot().buckets[0];
    assert.equal(b.nearWindow, 1);
    assert.equal(b.overWindow, 1);
    assert.equal(b.requests, 3);
    assert.equal(b.status200, 2);
    assert.equal(b.status400, 1);
  });

  it('accumulates events (compacted, memory, cache, sysShare)', () => {
    const cs = fresh();
    const t = Date.parse('2026-08-29T22:00:00Z');
    cs.record({ ts: t, provider: 'b', compacted: true, memory: true, cacheType: 'semcache', sysShare: 0.4, status: 200 });
    cs.record({ ts: t, provider: 'b', cacheType: 'exact', status: 200 });
    const b = cs.snapshot().buckets[0];
    assert.equal(b.compactCount, 1);
    assert.equal(b.memoryCount, 1);
    assert.equal(b.cacheSem, 1);
    assert.equal(b.cacheExact, 1);
    assert.ok(Math.abs(b.sysShareSum - 0.4) < 1e-9);
  });
});

describe('ContextStats.bucketing', () => {
  it('buckets by hour, merging same hour+provider', () => {
    const cs = fresh();
    cs.record({ ts: Date.parse('2026-08-29T20:10:00Z'), provider: 'a', status: 200 });
    cs.record({ ts: Date.parse('2026-08-29T20:40:00Z'), provider: 'a', status: 200 });
    cs.record({ ts: Date.parse('2026-08-29T21:05:00Z'), provider: 'b', status: 200 });
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 2, 'same hour+provider merge; new hour/provider = new bucket');
    assert.equal(snap.buckets.find(b => b.provider === 'a').requests, 2);
  });
});

describe('ContextStats persistence', () => {
  it('serialize → load round-trips aggregates (not raw)', () => {
    const cs = fresh();
    cs.record({ ts: Date.parse('2026-08-29T20:10:00Z'), provider: 'x', real: 1000, win: 2000, status: 200 });
    const ser = cs.serialize();
    assert.ok(Array.isArray(ser.buckets));
    const cs2 = new ContextStats();
    cs2.load(ser);
    const b = cs2.snapshot().buckets.find(x => x.provider === 'x');
    assert.ok(b, 'bucket survives reload');
    assert.equal(b.real, undefined, 'raw real not stored — aggregates only');
    assert.equal(b.requests, 1);
    assert.equal(b.sumReal, 1000);
  });

  it('rejects corrupt data on load', () => {
    const cs = new ContextStats();
    cs.load(null);
    cs.load({ buckets: 'junk' });
    cs.load({ buckets: [{ bad: true }] });
    cs.load({ buckets: [{ key: 'not-a-bucket', requests: 5 }] });
    assert.equal(cs.snapshot().buckets.length, 0);
  });
});

describe('ContextStats.summary', () => {
  it('flags NARROW when a provider is often at the window edge', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 20; i++) {
      cs.record({ ts: t, provider: 'codestral', real: 30000, win: 33000, status: 200 });
    }
    const s = cs.summary();
    assert.equal(s.status, 'NARROW');
    assert.deepEqual(s.narrowProviders, ['codestral']);
  });

  it('status is OK below all thresholds', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 20; i++) {
      cs.record({ ts: t, provider: 'zai', real: 5000, win: 128000, status: 200 });
    }
    const s = cs.summary();
    assert.equal(s.status, 'OK');
    assert.deepEqual(s.narrowProviders, []);
  });

  it('OVERFLOW wins over NARROW', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 20; i++) {
      cs.record({ ts: t, provider: 'codestral', real: 34000, win: 33000, status: 400 });
    }
    const s = cs.summary();
    assert.equal(s.status, 'OVERFLOW');
  });

  it('counts cache hits and rate', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    for (let i = 0; i < 5; i++) cs.record({ ts: t, provider: 'zai', cacheType: 'exact', status: 200 });
    for (let i = 0; i < 5; i++) cs.record({ ts: t, provider: 'zai', cacheType: 'semcache', status: 200 });
    for (let i = 0; i < 10; i++) cs.record({ ts: t, provider: 'zai', cacheType: 'miss', status: 200 });
    const s = cs.summary();
    assert.equal(s.totalRequests, 20);
    assert.equal(s.cacheHits, 10);
    assert.equal(s.cacheHitRate, 50);
  });

  it('keeps per-provider rows', () => {
    const cs = fresh();
    const t = Date.now() - 3600 * 1000;
    cs.record({ ts: t, provider: 'zai', real: 5000, win: 128000, status: 200 });
    cs.record({ ts: t, provider: 'lost-prompt', real: 85000, win: 100000, status: 200 }); // ratio 0.85 → не у края
    const s = cs.summary();
    assert.equal(s.providers['lost-prompt'].nearWindow, 0);
    assert.equal(s.providers['zai'].requests, 1);
  });
});

describe('ContextStats retention', () => {
  it('prunes buckets older than 7 days', () => {
    const cs = fresh();
    cs.record({ ts: Date.now() - 8 * 24 * 3600 * 1000, provider: 'old', status: 200 });
    cs.record({ ts: Date.now() - 3600 * 1000, provider: 'new', status: 200 });
    cs.prune();
    const snap = cs.snapshot();
    assert.equal(snap.buckets.length, 1);
    assert.equal(snap.buckets[0].provider, 'new');
  });
});
```

- [ ] **Step 2: Run to verify fail**

`timeout 30 node --test test/contextstats.test.js 2>&1 | grep -E "Cannot find module|^ℹ (tests|pass|fail)"`
Expected: FAIL — `Cannot find module '../lib/contextstats'`.

- [ ] **Step 3: Implement `lib/contextstats.js`** (единственная версия кода, чистая и финальная):

```js
// lib/contextstats.js
// Контекстная телеметрия: агрегаты «где теряется контекст» по бакетам
// isoHour|provider. Zero-dep, никогда не бросает, переживает рестарты через
// stats.context в state.json (см. lib/health.js).

const ISO_HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:00$/;
const RETENTION_MS = 7 * 24 * 3600 * 1000;

function isoHourOf(ts) {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13) + ':00'; // "2026-08-29T20:00"
}

function tsOfHour(hour) {
  return Date.parse(hour + ':00Z');
}

function emptyBucket(hour, provider) {
  return {
    key: hour + '|' + provider,
    hour,
    provider,
    ts: tsOfHour(hour),
    requests: 0,
    sumEst: 0,
    sumReal: 0,
    ratioSum: 0,
    ratioMax: 0,
    nearWindow: 0,
    overWindow: 0,
    compactCount: 0,
    memoryCount: 0,
    cacheExact: 0,
    cacheSem: 0,
    status200: 0,
    status400: 0,
    status429: 0,
    statusOther: 0,
    sysShareSum: 0,
  };
}

class ContextStats {
  constructor() {
    this.buckets = new Map(); // key -> bucket
  }

  record(m) {
    try {
      if (!m || typeof m !== 'object') return;
      const provider = (typeof m.provider === 'string' && m.provider.length > 0) ? m.provider : 'unknown';
      const hour = isoHourOf(typeof m.ts === 'number' && m.ts > 0 ? m.ts : Date.now());
      const key = hour + '|' + provider;
      let b = this.buckets.get(key);
      if (!b) { b = emptyBucket(hour, provider); this.buckets.set(key, b); }

      b.requests++;
      if (typeof m.est === 'number' && m.est > 0) b.sumEst += m.est;
      if (typeof m.real === 'number' && m.real > 0) {
        b.sumReal += m.real;
        const win = (typeof m.win === 'number' && m.win > 0) ? m.win : 0;
        if (win > 0) {
          const ratio = m.real / win;
          b.ratioSum += ratio;
          if (ratio > b.ratioMax) b.ratioMax = ratio;
          // Впритык (near) и поверх (over) — взаимоисключающие, чтобы счётчики
          // не пересекались: overWindow = реально пробили окно, nearWindow = 90-100% без пробоя.
          if (m.real > win) b.overWindow++;
          else if (ratio >= 0.9) b.nearWindow++;
        }
      }
      if (m.compacted) b.compactCount++;
      if (m.memory) b.memoryCount++;
      if (m.cacheType === 'exact') b.cacheExact++;
      else if (m.cacheType === 'semcache') b.cacheSem++;
      if (typeof m.sysShare === 'number' && m.sysShare > 0 && m.sysShare <= 1) b.sysShareSum += m.sysShare;
      const st = typeof m.status === 'number' ? m.status : 0;
      if (st === 200) b.status200++;
      else if (st === 400) b.status400++;
      else if (st === 429) b.status429++;
      else if (st > 0) b.statusOther++;
    } catch (err) {
      // Никогда не валим запрос из-за телеметрии.
    }
  }

  prune() {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [key, b] of this.buckets) {
      if (b.ts < cutoff) this.buckets.delete(key);
    }
  }

  snapshot(windowMs = RETENTION_MS) {
    this.prune();
    const cutoff = Date.now() - windowMs;
    const out = [];
    for (const b of this.buckets.values()) {
      if (b.ts < cutoff) continue;
      out.push(b);
    }
    out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    return { buckets: out };
  }

  serialize() {
    this.prune();
    return { buckets: [...this.buckets.values()] };
  }

  load(saved) {
    try {
      this.buckets = new Map();
      if (!saved || !Array.isArray(saved.buckets)) return;
      const now = Date.now();
      for (const raw of saved.buckets) {
        if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string') continue;
        const sep = raw.key.indexOf('|');
        if (sep < 0) continue;
        const hour = raw.key.slice(0, sep);
        const provider = raw.key.slice(sep + 1);
        if (!ISO_HOUR_RE.test(hour) || provider.length === 0) continue;
        const b = emptyBucket(hour, provider);
        for (const f of Object.keys(b)) {
          if (f === 'key' || f === 'hour' || f === 'provider' || f === 'ts') continue;
          if (typeof raw[f] === 'number' && raw[f] >= 0) b[f] = raw[f];
        }
        if (b.ts > now - RETENTION_MS) this.buckets.set(b.key, b);
      }
    } catch (err) {
      this.buckets = new Map();
    }
  }

  summary(now = Date.now()) {
    const winMs = 24 * 3600 * 1000;
    const cutoff = now - winMs;
    let totalRequests = 0;
    let ratioSum = 0;
    let ratioMax = 0;
    let nearWindow = 0;
    let overWindow = 0;
    let compactCount = 0;
    let cacheHits = 0;
    let sysShareSum = 0;
    let sysShareRequests = 0;
    const providers = {};

    for (const b of this.buckets.values()) {
      if (b.ts < cutoff) continue;
      totalRequests += b.requests;
      ratioSum += b.ratioSum;
      if (b.ratioMax > ratioMax) ratioMax = b.ratioMax;
      nearWindow += b.nearWindow;
      overWindow += b.overWindow;
      compactCount += b.compactCount;
      cacheHits += b.cacheExact + b.cacheSem;
      if (b.sysShareSum > 0) { sysShareSum += b.sysShareSum; sysShareRequests += b.requests; }
      const p = providers[b.provider] || (providers[b.provider] = { requests: 0, nearWindow: 0, overWindow: 0, compactCount: 0 });
      p.requests += b.requests;
      p.nearWindow += b.nearWindow;
      p.overWindow += b.overWindow;
      p.compactCount += b.compactCount;
    }

    const narrowProviders = Object.keys(providers)
      .filter(k => providers[k].requests >= 20 && providers[k].nearWindow / providers[k].requests >= 0.2)
      .sort();

    let status = 'OK';
    if (overWindow > 0) status = 'OVERFLOW';
    else if (sysShareRequests > 0 && sysShareSum / sysShareRequests >= 0.5) status = 'SYS_HEAVY';
    else if (narrowProviders.length > 0) status = 'NARROW';

    return {
      status,
      totalRequests,
      ratePerHour: Math.round((totalRequests / 24) * 10) / 10,
      avgRatio: totalRequests > 0 && ratioSum > 0 ? Math.round((ratioSum / totalRequests) * 1000) / 1000 : 0,
      ratioMax: Math.round(ratioMax * 1000) / 1000,
      nearWindow,
      overWindow,
      narrowProviders,
      compactCount,
      cacheHits,
      cacheHitRate: totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 100) : 0,
      avgSysShare: sysShareRequests > 0 ? Math.round((sysShareSum / sysShareRequests) * 1000) / 1000 : 0,
      providers,
    };
  }
}

module.exports = { ContextStats, isoHourOf, tsOfHour };
```

- [ ] **Step 4: Run tests**

`timeout 30 node --test test/contextstats.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → все PASS (12 тестов).

- [ ] **Step 5: Commit**

```bash
git add lib/contextstats.js test/contextstats.test.js
git commit -m "feat(contextstats): контекстная телеметрия — агрегаты по час|провайдер"
```

---

### Task 2: health.js — singleton + персист `stats.context`

**Files:** Modify `lib/health.js`

Точки кода (факт, проверено чтением):
- импорты: после строки 4 `const logger = require('./logger');`
- состояние: строка 10 `let stats = {...}` — ниже добавить `const contextStats = new ContextStats();`
- `loadState()`: строки 24-36 собирают `stats` — в конце добавить `contextStats.load(saved.context);`
- `saveState()`: строка 63 `fs.writeFileSync(STATE_PATH, JSON.stringify({ health, circuitBreakers, stats }, null, 2));` — переписать с сериализацией context, не мутировав живой `stats`
- экспорт: блок `module.exports` (235-244) — добавить `getContextStats`

- [ ] **Step 1: Реальные проверяемые тесты** — дописать в `test/proxy.test.js` (паттерн из bandit.test.js:68: модуль уже require'ится, `_stopTimers()` в конце файла уже есть, строка 268):

```js
test('health: getContextStats returns a working ContextStats singleton', () => {
  const health = require('../lib/health');
  const cs = health.getContextStats();
  assert.ok(cs && typeof cs.record === 'function' && typeof cs.serialize === 'function', 'singleton API');
  const key = 'telemetry-export-test|' + Date.now();
  cs.record({ ts: Date.now(), provider: 'test-provider', real: 1000, win: 2000, status: 200 });
  const s = cs.snapshot().buckets.find(b => b.provider === 'test-provider');
  assert.ok(s && s.requests >= 1, 'record landed in singleton');
});

test('health: saveState writes stats.context as buckets array (state restored)', () => {
  const fs = require('fs');
  const path = require('path');
  const statePath = path.join(__dirname, '..', 'state.json');
  const orig = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null;
  try {
    const health = require('../lib/health');
    health.getContextStats().record({ ts: Date.now(), provider: 'roundtrip-ctx', real: 1000, win: 2000, status: 200 });
    health.saveState();
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.ok(saved.stats && Array.isArray(saved.stats.context.buckets), 'stats.context persisted as buckets array');
    health.getContextStats().load(saved.stats.context);
    assert.ok(health.getContextStats().snapshot().buckets.find(b => b.provider === 'roundtrip-ctx'), 'bucket survives save→load');
  } finally {
    if (orig === null) { try { fs.unlinkSync(statePath); } catch {} }
    else { try { fs.writeFileSync(statePath, orig); } catch {} }
  }
});
```

- [ ] **Step 2: Run to verify fail**

`timeout 30 node --test test/proxy.test.js 2>&1 | grep -E "not a function|not a |^ℹ (tests|pass|fail)"`
Expected: FAIL — `getContextStats is not a function` (он ещё не экспортируется).

- [ ] **Step 3: Implement** — правки в `lib/health.js`:

**Импорт** (после строки 4):

```diff
 const path = require('path');
 const logger = require('./logger');
+const { ContextStats } = require('./contextstats');
```

**Состояние** (после строки 10):

```diff
 let stats = { totalRequests: 0, ... bandit: { low: {}, med: {}, high: {} } };
+const contextStats = new ContextStats();
```

**loadState()** (после строки 36, перед комментарием «Reset the error counter»):

```diff
       bandit: saved.bandit || { low: {}, med: {}, high: {} },
     };
+    contextStats.load(saved.context);
     // Reset the error counter for a new day. ...
```

**saveState()** (переписать строки 61-67):

```js
function saveState() {
  try {
    const context = contextStats.serialize();
    fs.writeFileSync(STATE_PATH, JSON.stringify({ health, circuitBreakers, stats: { ...stats, context } }, null, 2));
  } catch (err) {
    logger.error('Failed to save state', { error: err.message });
  }
}
```

**module.exports** (добавить к списку):

```diff
   getDailyUsage, getReliability,
   recordSelection, getLastSelection,
   getBandit, recordBandit, warmBanditPriors,
+  getContextStats: () => contextStats,
   _stopTimers,
 };
```

- [ ] **Step 4: Run tests**

`node --check lib/health.js && timeout 60 node --test test/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/health.js test/proxy.test.js
git commit -m "feat(health): stats.context — контекстная телеметрия в state.json"
```

---

### Task 3: server.js — measure + commit + summary в эндпоинтах

**Files:** Modify `server.js`

**Важно:** `record()` вызывается ОДИН раз на запрос — **только из терминальных точек** (там, где формируется финальный `res.end`). Ошибки внутри фолбэк-цикла (catch, строка 753) НЕ пишут — контекст замеряется на итог запроса.

Точки кода (факт, проверено):
- импорт health: строка 7 `const { loadState, ... } = require('./lib/health');`
- `const isStreaming = body.stream === true;` — строка 213
- компакция: строки 315-319 (блок `if (Array.isArray(body.messages) && body.messages.length > 0) { ... prepareMessages ... }`)
- memory recall: успешное вкрапление фактов — строки 345-354 (внутри `if (fresh.length > 0)`)
- кэш exact: строки 380-386; семач-кэш: 389-397
- успешный не-стрим: строки 739-751; стрим end/error: 709-730 / 731-735
- retry (allSoft): не-стрим успех 812-834; стрим end/error 873-895
- все упали: строки 906-907 (502)
- `/health`: 958-964; `/v1/stats`: 967-1000

- [ ] **Step 1: Bridge-тест** — в `test/proxy.test.js` (проверяет, что `contextStats` из health доступен и summary-контракт не сломан; сам статический анализ сервера — live-шаг):

```js
test('contextstats: summary contract used by /health and /v1/stats', () => {
  const { ContextStats } = require('../lib/contextstats');
  const s = new ContextStats().summary();
  assert.equal(typeof s.status, 'string');
  assert.equal(typeof s.totalRequests, 'number');
  assert.equal(typeof s.cacheHitRate, 'number');
  assert.equal(typeof s.ratePerHour, 'number');
  assert.ok(Array.isArray(s.providers) === false && typeof s.providers === 'object', 'providers rows map');
});

test('server: getContextStats exported by health (wiring anchor)', () => {
  const health = require('../lib/health');
  assert.equal(typeof health.getContextStats, 'function');
});
```

- [ ] **Step 2: Run to verify baseline**

`timeout 30 node --test test/proxy.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → PASS (структурные проверки валидны уже после Task 2).

- [ ] **Step 3: Implement**

**Импорт** (строка 7) — добавить `getContextStats`:

```js
const { loadState, initHealth, isCircuitOpen, recordSuccess, recordFailure, recordRequest, recordTokens, getHealth, getStats, recordRecent, recordRpm, getRecent, getRpm, recordSelection, getLastSelection, getBandit, recordBandit, warmBanditPriors, getContextStats } = require('./lib/health');
```

**Синглтон** (после строки 21 `loadState();`):

```js
const contextStats = getContextStats();
```

**measure + commit** (после строки 213):

```js
  const isStreaming = body.stream === true;
  // --- Контекстная телеметрия: один measure на запрос, record только в терминальной точке. ---
  const measure = { ts: Date.now(), provider: targetProviderKey, cacheType: 'miss', status: 0, win: PROVIDERS[targetProviderKey]?.context_window || 0 };
  const commit = (status) => {
    measure.status = status;
    contextStats.record(measure);
  };
```

**measure.origTokens** (СРАЗУ перед блоком компакции, строка 315 — компакция уже положена на сервере, второй раз prepareMessages НЕ зовём):

```js
  // Контекстная телеметрия: токены до компакции.
  if (Array.isArray(body.messages)) measure.origTokens = estimateTokens(body.messages);
  // Compact overly large conversations so free models don't reject on context.
  // Runs AFTER the vision pipeline (images already converted to text above).
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    body.messages = await prepareMessages(body.messages, { contextWindow: PROVIDERS[targetProviderKey]?.context_window || 0 });
  }
  // Контекстная телеметрия: токены после компакции + sysShare.
  if (Array.isArray(body.messages)) {
    measure.sentTokens = estimateTokens(body.messages);
    measure.compacted = measure.sentTokens < measure.origTokens;
    const sysChars = body.messages.filter(m => m && m.role === 'system').reduce((a, m) => a + (typeof m.content === 'string' ? m.content.length : 0), 0);
    const allChars = body.messages.reduce((a, m) => a + (typeof (m && m.content) === 'string' ? m.content.length : 0), 0);
    if (allChars > 0) measure.sysShare = sysChars / allChars;
  }
```

**measure.memory** (внутри `if (fresh.length > 0)` после блока вставки фактов, строка ~354):

```js
              if (insertAt === -1) body.messages.unshift(block);
              else body.messages.splice(insertAt, 0, block);
              measure.memory = true;
              logger.info('Memory recall', { facts: fresh.length, covered: hits.length - fresh.length });
```

**Терминаль 1 — exact cache hit** (строка 381):

```js
  if (cached) {
    logger.request({ model: requestedModel, provider: 'cache', status: 200, cached: true });
    recordRecent({ model: requestedModel, provider: 'cache', status: 200, latency: 0, cached: true });
    measure.cacheType = 'exact';
    commit(200);
    serveCached(res, cached, isStreaming);
    return;
  }
```

**Терминаль 2 — semcache hit** (строка 391):

```js
    if (semantic) {
      logger.request({ model: requestedModel, provider: 'semcache', status: 200, cached: true });
      recordRecent({ model: requestedModel, provider: 'semcache', status: 200, latency: 0, cached: true });
      measure.cacheType = 'semcache';
      commit(200);
      serveCached(res, semantic.value, isStreaming);
      return;
    }
```

**Терминаль 3 — «No providers available» 503** (строка 490):

```js
  if (enabledProviders.length === 0) {
    measure.provider = targetProviderKey;
    commit(503);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No providers available' }));
    return;
  }
```

**Терминаль 4 — стрим (основной цикл)**: measure.provider перед стримом (`if (isStreaming && result.stream) {` → `measure.provider = key;`), в `end` (строка 729) перед `res.end()` → `commit(200);`, в `error` (строка 734) перед `res.end()` → `commit(err.statusCode || 502);`:

```js
      if (isStreaming && result.stream) {
        measure.provider = key; // вставить первой строкой после открытия блока
        ...
        result.stream.on('end', () => {
          ...
          commit(200);
          res.end();
        });
        result.stream.on('error', (err) => {
          logger.error('Stream error', { key, error: err.message });
          if (!isTransientLimit(err.statusCode)) recordBandit(complexityBucket, key, false);
          commit(err.statusCode || 502);
          res.end();
        });
        return;
      }
```

**Терминаль 5 — не-стрим успех (основной цикл, строка 739)**:

```js
      if (!isStreaming && result.data) {
        measure.provider = key;
        measure.real = (result.data.usage && result.data.usage.prompt_tokens) ? result.data.usage.prompt_tokens : measure.sentTokens || 0;
        measure.win = PROVIDERS[key]?.context_window || 0;
        recordSuccess(key);
        ...
        commit(200);
        cache.set(effectiveModel, body.messages, body.temperature, result.data);
        recordTokens(key, result.usage);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.data));
        return;
      }
```

**Терминаль 6 — retry не-стрим успех** (строка 812, в `if (!body.stream && result.data) {` после `recordSelection(key, provider.model, requestedModel);` → `measure.provider = key; measure.real = ...; measure.win = ...;` и `commit(200);` перед `cache.set`).

**Терминаль 7 — retry стрим** (строки 836-896): `measure.provider = key;` после `if (body.stream && result.stream) {`; в `end` (889) перед `res.end()` → `commit(200);`; в `error` (894) перед `res.end()` → `commit(err.statusCode || 502);`.

**Терминаль 8 — все упали (502, строка 906)**:

```js
  commit(502);
  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'All providers failed', type: 'api_error', code: 'all_providers_failed', details: errors } }));
```

- [ ] **Step 4: `/health` и `/v1/stats`**

**`/health`** (строка 962-963) — добавить `context`:

```js
    const contextSummary = (() => { try { return contextStats.summary(); } catch (err) { return null; } })();
    res.end(JSON.stringify({ status: upCount > 0 ? 'ok' : 'degraded', providers: { up: upCount, total: totalCount }, context: contextSummary }));
```

**`/v1/stats`** (после `bandit: getBandit(),` строка 998) — добавить `context_summary`:

```js
      last_selection: getLastSelection(),
      bandit: getBandit(),
      context_summary: (() => { try { return contextStats.summary(); } catch (err) { return null; } })(),
```

- [ ] **Step 5: Синтаксис + тесты**

`node --check server.js && timeout 60 node --test test/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → PASS.

- [ ] **Step 6: Live — summary появляется**

`launchctl kickstart -k gui/$(id -u)/com.free-llm-proxy` затем послать 2-3 запроса (включая кэш-хит через повтор), затем `curl -s http://localhost:4000/health | python3 -m json.tool | head -25` → поле `context` с `status`/`totalRequests`.

- [ ] **Step 7: Commit**

```bash
git add server.js test/proxy.test.js
git commit -m "feat(server): контекстная телеметрия — measure/commit + summary в /health и /v1/stats"
```

---

### Task 4: dashboard — блок «Контекст»

**Files:** Modify `lib/dashboard.js`

Точки кода (факт, проверено):
- HTML-карточки: строки 62-74 (`<div class="card"><h2>Очередь</h2>...` на 67)
- `refresh()`: строки 90-107 (рендеры после `renderPool(data.pool || {});` на 102)
- `renderProviders` на строке 109 — рендеры вставлять перед ней

- [ ] **Step 1: Структурный тест** — в `test/proxy.test.js`:

```js
test('dashboard: renders context block', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dashboard.js'), 'utf8');
  assert.ok(html.includes('ctxBlock'), 'есть элемент #ctxBlock');
  assert.ok(html.includes('renderContext'), 'есть рендер renderContext');
  assert.ok(html.includes('context_summary'), 'refresh читает context_summary');
});
```

- [ ] **Step 2: Run to verify fail**

`timeout 30 node --test test/proxy.test.js 2>&1 | grep -E "AssertionError|^ℹ (tests|pass|fail)"`
Expected: FAIL — `ctxBlock` ещё нет.

- [ ] **Step 3: Implement**

**HTML-карточка** (после карточки «Очередь», строка 67):

```html
    <div class="card" style="grid-column: span 2;"><h2>Контекст (узкое место)</h2><div id="ctxBlock">Загрузка...</div></div>
```

**refresh()** (в Promise.all уже читают `/v1/stats`, строка 93; после `renderPool(data.pool || {});`):

```js
        renderContext(data.context_summary || {});
```

**Рендер** (перед `renderProviders`, строка 109):

```js
    function renderContext(sum) {
      if (!sum || typeof sum !== 'object') { document.getElementById('ctxBlock').innerHTML = 'Нет данных'; return; }
      const fmt3 = (v) => (typeof v === 'number' && v > 0 ? v.toFixed(3) : '—');
      let html = '<div class="stat"><span class="stat-label">Статус</span><span class="stat-value">' + (sum.status || 'OK') + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Запросов (24ч)</span><span class="stat-value">' + (sum.totalRequests || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Rate (1/ч)</span><span class="stat-value">' + (sum.ratePerHour || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Avg ratio / окно</span><span class="stat-value">' + fmt3(sum.avgRatio) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Max ratio</span><span class="stat-value">' + fmt3(sum.ratioMax) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Впритык к окну</span><span class="stat-value">' + (sum.nearWindow || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Поверх окна</span><span class="stat-value">' + (sum.overWindow || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Компакций</span><span class="stat-value">' + (sum.compactCount || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">Кэш-hit %</span><span class="stat-value">' + (typeof sum.cacheHitRate === 'number' ? sum.cacheHitRate : 0) + '%</span></div>';
      html += '<div class="stat"><span class="stat-label">System-доля</span><span class="stat-value">' + (sum.avgSysShare ? (sum.avgSysShare * 100).toFixed(0) + '%' : '—') + '</span></div>';
      if (sum.narrowProviders && sum.narrowProviders.length > 0) {
        html += '<div class="stat"><span class="stat-label">Узкие</span><span class="stat-value">' + sum.narrowProviders.join(', ') + '</span></div>';
      }
      document.getElementById('ctxBlock').innerHTML = html + '<div style="margin-top:8px;font-size:11px;color:#888;">для recap: node tools/context-diag.js</div>';
    }
```

- [ ] **Step 3b: verify**

`node --check lib/dashboard.js && timeout 30 node --test test/proxy.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → PASS.

- [ ] **Step 4: Live view**

Restart, открыть `http://localhost:4000/` → карточка «Контекст (узкое место)».

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard.js test/proxy.test.js
git commit -m "feat(dashboard): блок «Контекст» — узкое место контекста"
```

---

### Task 5: CLI `tools/context-diag.js`

**Files:** Create `tools/context-diag.js`

- [ ] **Step 1: Create CLI**

```js
#!/usr/bin/env node
// tools/context-diag.js
// Отчёт по контекстной телеметрии из state.json — без обращения к серверу.
// Использование: node tools/context-diag.js [--hours N] [--json]
// (N по умолчанию 24, максимум 24*7)
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const hours = (() => {
  const i = args.indexOf('--hours');
  const n = i >= 0 ? parseInt(args[i + 1], 10) : 24;
  return Number.isFinite(n) && n > 0 && n <= 24 * 7 ? n : 24;
})();
const asJson = args.includes('--json');

function loadContext() {
  const p = path.join(__dirname, '..', 'state.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).stats?.context || null;
  } catch {
    return null;
  }
}

const ctx = loadContext();
if (!ctx || !Array.isArray(ctx.buckets)) {
  console.error('Нет данных контекстной телеметрии (state.json). Сервер ещё не собрал замеры.');
  process.exit(1);
}

const cutoff = Date.now() - hours * 3600 * 1000;
const buckets = ctx.buckets.filter(b => b && typeof b.ts === 'number' && b.ts >= cutoff);

let total = 0, near = 0, over = 0, compact = 0, cacheHits = 0, sumReal = 0, realCount = 0, ratioMax = 0;
const byProvider = {};
for (const b of buckets) {
  total += b.requests || 0;
  near += b.nearWindow || 0;
  over += b.overWindow || 0;
  compact += b.compactCount || 0;
  cacheHits += (b.cacheExact || 0) + (b.cacheSem || 0);
  if (b.sumReal > 0) { sumReal += b.sumReal; realCount += b.requests || 0; }
  if ((b.ratioMax || 0) > ratioMax) ratioMax = b.ratioMax;
  const p = byProvider[b.provider] || (byProvider[b.provider] = { requests: 0, nearWindow: 0, overWindow: 0, compactCount: 0 });
  p.requests += b.requests || 0;
  p.nearWindow += b.nearWindow || 0;
  p.overWindow += b.overWindow || 0;
  p.compactCount += b.compactCount || 0;
}
const narrow = Object.keys(byProvider).filter(k => byProvider[k].requests >= 20 && byProvider[k].nearWindow / byProvider[k].requests >= 0.2);
let status = 'OK';
if (over > 0) status = 'OVERFLOW';
else if (narrow.length > 0) status = 'NARROW';

if (asJson) {
  console.log(JSON.stringify({ hours, windowHours: hours, status, total, near, over, compact, cacheHits, cacheHitRate: total ? Math.round((cacheHits / total) * 100) : 0, avgReal: realCount ? Math.round(sumReal / realCount) : 0, ratioMax, narrow, providers: byProvider }, null, 2));
  process.exit(0);
}

const AVG_REAL = realCount ? Math.round(sumReal / realCount) : 0;
console.log(`Контекстная телеметрия за ${hours}ч`);
console.log('-------------------------------');
console.log(`Статус узкого места: ${status}`);
console.log(`Запросов: ${total}  Кэш-hit: ${cacheHits} (${total ? Math.round((cacheHits / total) * 100) : 0}%)`);
console.log(`Впритык к окну: ${near}  Поверх окна: ${over}  Компакций: ${compact}`);
console.log(`Средний real/запрос: ${AVG_REAL} токенов  Max ratio: ${ratioMax}`);
if (narrow.length > 0) console.log(`Узкие провайдеры: ${narrow.join(', ')}`);
console.log('');
if (Object.keys(byProvider).length === 0) { console.log('(замеров за период нет — пошлите запросы через прокси)'); process.exit(0); }
console.log('Провайдеры:');
for (const [k, p] of Object.entries(byProvider)) {
  console.log(`  ${k.padEnd(24)} запросов=${p.requests} впритык=${p.nearWindow} поверх=${p.overWindow} компакций=${p.compactCount}`);
}
```

- [ ] **Step 2: CLI работает**

`node tools/context-diag.js --hours 24` → либо отчёт, либо «Нет данных...» (до накопления замеров). `node tools/context-diag.js --hours 24 --json | python3 -m json.tool >/dev/null` → exit 0.

- [ ] **Step 3: Live + накопленные данные**

После запросов из Task 3: `node tools/context-diag.js --hours 24` → строки провайдеров с счётчиками и статус.

- [ ] **Step 4: Commit**

```bash
git add tools/context-diag.js
git commit -m "feat(tools): контекст-диагностика из state.json"
```

---

### Task 6: Интеграция и вердикт по «узкому месту»

**Files:** возможная правка `PROJECT_MEMORY.md`/`README.md`

- [ ] **Step 1: Полная верификация**

```bash
cd ~/.config/opencode/llm-proxy
node --check server.js lib/health.js lib/contextstats.js lib/dashboard.js tools/context-diag.js
timeout 90 node --test test/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: синтаксис OK, все тесты PASS (132 существующих + ~15 новых).

- [ ] **Step 2: Live-смок**

```bash
launchctl kickstart -k gui/$(id -u)/com.free-llm-proxy
sleep 3
curl -s http://localhost:4000/health | python3 -m json.tool | grep -A8 '"context"'
curl -s http://localhost:4000/v1/stats | python3 -c "import sys,json;d=json.load(sys.stdin);print('ctx_summary:',d.get('context_summary',{}).get('status'),'req:',d.get('context_summary',{}).get('totalRequests'))"
node tools/context-diag.js --hours 24
```
Expected: `context` в `/health`, `context_summary` в `/v1/stats`, отчёт CLI печатается.

- [ ] **Step 3: Снять первые данные для отчёта**

Послать 3-4 реальных запроса через прокси (разные провайдеры, минимум один крупный промпт и один повтор для кэша), подождать ~40с (автосохранение state каждые 30с), затем `node tools/context-diag.js --hours 24` — зафиксировать строки для итога в PROJECT_MEMORY.md.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: контекстная телеметрия — первые данные об узком месте" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (метрика measure): Task 3 — origTokens/sentTokens/compacted/memory/cacheType/real/win/sysShare/status. ✅
- Part 2 (агрегаторы, retention, анти-коррапт): Task 1. ✅
- Part 3 (contextSummary: OVERFLOW > SYS_HEAVY > NARROW > OK): Task 1 `summary()` + Task 3 эндпоинты. ✅
- Part 4 (dashboard + CLI): Task 4 + Task 5. ✅
- Part 5 (server интеграция, запись в терминальных точках): Task 3 `commit()`. ✅
- Тесты: Tasks 1-6. ✅

**Placeholder scan:** в коде задач нет плейсхолдеров/«TODO»; каждый шаг — конкретный diff и команда.

**Type/контракт проверки:**
- `getContextStats()` экспортируется (Task 2) → используется в server.js (Task 3). ✅
- `record`/`serialize`/`load`/`summary` сигнатуры совпадают в тестах и вызовах. ✅
- `cacheType` литералы `'miss'|'exact'|'semcache'` — Task 3 ставит `'exact'`/`'semcache'`, Task 1 считает `cacheExact`/`cacheSem`. ✅
- Поля summary совпадают у `summary()`, dashboard `renderContext`, `/v1/stats` `context_summary`, `/health` `context`. ✅
- CLI читает `states.stats.context.buckets` = вывод `serialize()`. ✅

**Нюанс спеки, зафиксированный в плане:** summary отдаётся в `/v1/stats` (dashboard читает именно его, а не `/health`) **и** в `/health`; в `state.json` пишется только сериализованный `context`, живой `stats` не загрязняется классом.

## Out of Scope (сознательно)
- Автоматические действия по «увеличению контекста» (апгрейд окон, новые провайдеры) — только после данных телеметрии.
- Пер-провайдерный avg ratio в summary (нужен win на бакет, которого нет в агрегате) — в CLI считается средний real/запрос глобально.
- Стриминговые реальные токены (usage) — для стримов `real` остаётся `sentTokens`-оценкой; точный usage только у не-стрима.