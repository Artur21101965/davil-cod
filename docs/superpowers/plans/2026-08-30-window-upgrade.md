# Window-Aware Auto-Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запросы, которые не влезают в окно запрошенной модели (после vision-апгрейда target), автоматически уходят на здорового провайдера с подходящим окном; target исключается; компакция пропускается; телеметрия считает апгрейды.

**Architecture:** Решение `oversized` принимается в server.js ДО компакции: `needsWindowUpgrade(targetWin, requestTokens)` с `WINDOW_FIT_FACTOR=1.5` в `lib/routing.js`. В upgrade-режиме `prepareMessages` не вызывается, window-фильтр пула применяется без гейта MIN_WINDOW, `target-first` пропускается. Счётчик `upgradedCount` добавляется в contextstats (бакет + summary + per-provider), вывод — в CLI и dashboard.

**Tech Stack:** Node.js (CommonJS), `node:test`, без внешних зависимостей.

---

### Task 1: routing.js — `WINDOW_FIT_FACTOR` + `needsWindowUpgrade`

**Files:**
- Modify: `lib/routing.js` (низ файла, перед `module.exports`)
- Create: `test/routing.test.js`
- Test: `test/routing.test.js`

- [ ] **Step 1: Write the failing test**

Создать `test/routing.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { needsWindowUpgrade, WINDOW_FIT_FACTOR } = require('../lib/routing');

test('routing: WINDOW_FIT_FACTOR экспортируется (>1)', () => {
  assert.equal(typeof WINDOW_FIT_FACTOR, 'number');
  assert.ok(WINDOW_FIT_FACTOR > 1);
});

test('routing: needsWindowUpgrade решает по фактору 1.5', () => {
  assert.equal(needsWindowUpgrade(33000, 100000), true, 'est 100k поверх 33k×1.5');
  assert.equal(needsWindowUpgrade(33000, 45000), false, 'est 45k < 49.5k — влезает');
  assert.equal(needsWindowUpgrade(33000, 49500), false, 'est == win×1.5 — не поверх');
  assert.equal(needsWindowUpgrade(33000, 49501), true, 'чуть выше порога');
});

test('routing: needsWindowUpgrade при неизвестном окне не апгрейдит', () => {
  assert.equal(needsWindowUpgrade(0, 100000), false);
  assert.equal(needsWindowUpgrade(-5, 100000), false);
  assert.equal(needsWindowUpgrade(33000, 0), false);
});

test('routing: needsWindowUpgrade с кастомным фактором', () => {
  assert.equal(needsWindowUpgrade(33000, 50000, 2), false);
  assert.equal(needsWindowUpgrade(33000, 70000, 2), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routing.test.js`
Expected: FAIL — `Cannot find module '../lib/routing'` / `needsWindowUpgrade is not a function`.

- [ ] **Step 3: Write minimal implementation**

В `lib/routing.js`, перед `module.exports` (сейчас строка 80):

```js
// Window-aware upgrade: если запрос не влезает в окно целевой модели
// (est > win × factor), роутим на провайдера с подходящим окном.
// factor 1.5: estimateTokens завышает real в ~1.7× (кириллица) — при
// est > 1.5×win реальные токены почти гарантированно поверх окна.
const WINDOW_FIT_FACTOR = 1.5;

function needsWindowUpgrade(targetWin, requestTokens, factor = WINDOW_FIT_FACTOR) {
  if (!targetWin || targetWin <= 0) return false;
  if (!requestTokens || requestTokens <= 0) return false;
  return requestTokens > targetWin * factor;
}
```

Заменить строку 80 на:

```js
module.exports = { classifyComplexity, maybeUpgradeTier, COMPLEX_THRESHOLD, classifyVisionComplexity, needsWindowUpgrade, WINDOW_FIT_FACTOR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/routing.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/routing.js test/routing.test.js
git commit -m "feat(routing): needsWindowUpgrade — окно-осознанное решение об апгрейде"
```

---

### Task 2: contextstats.js — агрегат `upgradedCount`

**Files:**
- Modify: `lib/contextstats.js` (emptyBucket, record, summary)
- Test: `test/contextstats.test.js`

- [ ] **Step 1: Write the failing test**

Добавить в `test/contextstats.test.js` (в конец файла, до конца `describe`):

```js
describe('ContextStats.upgradedCount', () => {
  it('aggregates upgraded from record into bucket/summary', () => {
    const t = Date.parse('2026-08-30T10:00:00Z');
    const cs = new ContextStats();
    cs.record({ ts: t, provider: 'a', upgraded: 1, status: 200 });
    cs.record({ ts: t, provider: 'a', upgraded: true, status: 200 });
    cs.record({ ts: t, provider: 'a', status: 400 });
    const b = cs.snapshot().buckets[0];
    assert.equal(b.upgradedCount, 2);
    const s = cs.summary(t + 3600000);
    assert.equal(s.upgradedCount, 2);
    assert.equal(s.providers.a.upgradedCount, 2);
  });

  it('round-trips upgradedCount through serialize → load', () => {
    const t = Date.parse('2026-08-30T10:00:00Z');
    const cs = new ContextStats();
    cs.record({ ts: t, provider: 'x', upgraded: 1, status: 200 });
    const cs2 = new ContextStats();
    cs2.load(cs.serialize());
    const b = cs2.snapshot().buckets.find(x => x.provider === 'x');
    assert.equal(b.upgradedCount, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contextstats.test.js`
Expected: FAIL — `b.upgradedCount` / `s.upgradedCount` equals `undefined`.

- [ ] **Step 3: Write minimal implementation**

В `lib/contextstats.js`:

a) `emptyBucket` (после `compactCount: 0,` строка 32):

```js
    upgradedCount: 0,
```

b) `record` (после `if (m.compacted) b.compactCount++;` строка 71):

```js
      if (m.upgraded) b.upgradedCount++;
```

c) `summary`: переменные (после `let compactCount = 0;` строка 142):

```js
    let upgradedCount = 0;
```

В цикле (после `compactCount += b.compactCount;` строка 155):

```js
      upgradedCount += b.upgradedCount;
```

Мапа провайдеров (строка 158):

```js
      const p = providers[b.provider] || (providers[b.provider] = { requests: 0, nearWindow: 0, overWindow: 0, compactCount: 0, upgradedCount: 0 });
```

и в цикле (после `p.compactCount += b.compactCount;` строка 162):

```js
      p.upgradedCount += b.upgradedCount;
```

В return-объекте (после `compactCount,` строка 183):

```js
      upgradedCount,
```

Замечание: whitelist `load()` строится из `Object.keys(emptyBucket)` — новое поле попадёт в него автоматически (см. строку 123).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/contextstats.test.js`
Expected: PASS (существующие + 2 новых).

- [ ] **Step 5: Commit**

```bash
git add lib/contextstats.js test/contextstats.test.js
git commit -m "feat(contextstats): upgradedCount в бакетах и summary"
```

---

### Task 3: server.js — decision point, компакция, роутинг, target-first

**Files:**
- Modify: `server.js` (импорт строка 12, measure init строка 216, блок перед строкой 322, пул строки 436-446, target-first строка 504)
- Test: `test/proxy.test.js`

- [ ] **Step 1: Write the failing test**

Добавить в `test/proxy.test.js` (в конец файла):

```js
test('server: window-aware upgrade wiring (structural)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes('needsWindowUpgrade'), 'импорт хелпера из routing');
  assert.ok(/windowUpgraded\s*=\s*Array\.isArray/.test(src), 'decision point перед компакцией');
  assert.ok(src.includes('measure.upgraded = 1'), 'мера апгрейда ставится');
  assert.ok(/&&\s*!\s*windowUpgraded\s*\)\s*\{[\s\S]*prepareMessages/.test(src), 'prepareMessages пропускается при апгрейде');
  assert.ok(src.includes('if (requestTokens > MIN_WINDOW || windowUpgraded)'), 'window-фильтр без гейта при апгрейде');
  assert.ok(src.includes('!windowUpgraded && MODEL_MAP[requestedModel]'), 'target-first пропускается при апгрейде');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/proxy.test.js`
Expected: FAIL — первый же `assert.ok(...needsWindowUpgrade...)` (строк в server.js пока нет).

- [ ] **Step 3: Write minimal implementation**

В `server.js`:

a) Импорт (строка 12):

```js
const { classifyComplexity, maybeUpgradeTier, classifyVisionComplexity, needsWindowUpgrade } = require('./lib/routing');
```

b) measure init (строка 216) — добавить `upgraded: 0`:

```js
  const measure = { ts: Date.now(), provider: targetProviderKey, cacheType: 'miss', status: 0, win: PROVIDERS[targetProviderKey]?.context_window || 0, upgraded: 0 };
```

c) Decision point ДО блокировки компакции. Заменить блок строк 322-327:

```js
  // Window-aware upgrade: если запрос не влезает в окно целевой модели (после
  // vision-апгрейда target), компакция НЕ запускается — суммаризатор не должен
  // сжимать контекст, который провайдер с большим окном возьмёт целиком.
  const windowUpgraded = Array.isArray(body.messages) && body.messages.length > 0 &&
    needsWindowUpgrade(PROVIDERS[targetProviderKey]?.context_window || 0, estimateTokens(body.messages));
  if (windowUpgraded) measure.upgraded = 1;

  // Compact overly large conversations so free models don't reject on context.
  // Runs AFTER the vision pipeline (images already converted to text above).
  // Skipped in window-upgrade mode — the big provider takes the raw context.
  if (Array.isArray(body.messages)) measure.origTokens = estimateTokens(body.messages);
  if (Array.isArray(body.messages) && body.messages.length > 0 && !windowUpgraded) {
    body.messages = await prepareMessages(body.messages, { contextWindow: PROVIDERS[targetProviderKey]?.context_window || 0 });
  }
```

d) Window-пул (строки 436-446) — заменить:

```js
  const requestTokens = estimateTokens(body.messages);
  const MIN_WINDOW = 50000; // below this we don't filter (typical requests)
  let windowPool = healthyProviders;
  if (requestTokens > MIN_WINDOW || windowUpgraded) {
    const capable = healthyProviders.filter(([_, p]) => {
      const win = p.context_window || 0;
      // Unknown/0 window providers are kept (heuristic) — better to try than drop.
      return win === 0 || win >= requestTokens;
    });
    if (capable.length > 0) {
      windowPool = capable;
    } else if (windowUpgraded) {
      // Ни один здоровый провайдер не держит запрос — best-effort на самый
      // большой window (target исключён; OVERFLOW поймает телеметрия).
      windowPool = [...healthyProviders].sort((a, b) => (b[1].context_window || 0) - (a[1].context_window || 0));
    }
  }
```

e) target-first (строка 504) — заменить условие и комментарий:

```js
  // Put the requested model's mapped provider FIRST. It's the only provider
  // guaranteed to accept this tier/model — the rest are fallbacks (many reject
  // tier-* requests with 400/422). Skipped when the request is being upgraded
  // to a window-capable provider (target doesn't fit anyway).
  if (!windowUpgraded && MODEL_MAP[requestedModel] && PROVIDERS[targetProviderKey]) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/proxy.test.js`
Expected: PASS (структурный тест + существующие).

- [ ] **Step 5: Full suite + commit**

Run: `node --check server.js && node --test test/*.test.js`
Expected: `node --check` тихо (SYNTAX_OK), `ℹ tests N` / `ℹ pass N` / `ℹ fail 0` (порядок: существующие 150 + 4 routing + 2 contextstats + 1 proxy = 157).

```bash
git add server.js test/proxy.test.js
git commit -m "feat(server): окно-осознанный авто-апгрейд — target исключён, компакция пропущена"
```

---

### Task 4: вывод апгрейдов — CLI, dashboard, PROJECT_MEMORY

**Files:**
- Modify: `tools/context-diag.js` (строки 35, 41, 45, 49, 57, 66, 73)
- Modify: `lib/dashboard.js` (renderContext, после строки 121)
- Modify: `PROJECT_MEMORY.md` (Ключевые решения + Известные проблемы)
- Test: `test/proxy.test.js` (structural для dashboard)

- [ ] **Step 1: Write the failing test**

В `test/proxy.test.js` найти тест `'context-telemetry: dashboard блок и context_summary'` (или аналогичный структурный для dashboard) и добавить туда же:

```js
  assert.ok(html.includes('upgradedCount'), 'renderContext читает апгрейды');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/proxy.test.js`
Expected: FAIL — `html.includes('upgradedCount')` false.

- [ ] **Step 3: Implement CLI (tools/context-diag.js)**

a) Строка 35 — добавить счётчик:

```js
let total = 0, near = 0, over = 0, compact = 0, upgraded = 0, cacheHits = 0, sumReal = 0, realCount = 0, ratioMax = 0;
```

b) Строка 41 — после `compact += b.compactCount || 0;`:

```js
  upgraded += b.upgradedCount || 0;
```

c) Строка 45 — мапа провайдеров:

```js
  const p = byProvider[b.provider] || (byProvider[b.provider] = { requests: 0, nearWindow: 0, overWindow: 0, compactCount: 0, upgradedCount: 0 });
```

d) Строка 49 — после `p.compactCount += b.compactCount || 0;`:

```js
  p.upgradedCount += b.upgradedCount || 0;
```

e) Строка 57 (JSON-ветка) — добавить `upgraded` в объект:

```js
  console.log(JSON.stringify({ hours, status, total, near, over, compact, upgraded, cacheHits, cacheHitRate: total ? Math.round((cacheHits / total) * 100) : 0, avgReal: realCount ? Math.round(sumReal / realCount) : 0, ratioMax, narrow, providers: byProvider }, null, 2));
```

f) Строка 66 (текст) — заменить:

```js
console.log(`Впритык к окну: ${near}  Поверх окна: ${over}  Компакций: ${compact}  Апгрейдов (окно): ${upgraded}`);
```

g) Строка 73 (per-provider) — заменить:

```js
  console.log(`  ${k.padEnd(24)} запросов=${p.requests} впритык=${p.nearWindow} поверх=${p.overWindow} компакций=${p.compactCount} апгрейд=${p.upgradedCount}`);
```

- [ ] **Step 4: Implement dashboard (lib/dashboard.js)**

В `renderContext` после строки 121 (Компакций) добавить:

```js
      html += '<div class="stat"><span class="stat-label">Апгрейдов (окно)</span><span class="stat-value">' + (sum.upgradedCount || 0) + '</span></div>';
```

- [ ] **Step 5: Run test to verify it passes + CLI smoke**

Run: `node --test test/proxy.test.js`
Expected: PASS.

Run: `node tools/context-diag.js --hours 24`
Expected: строка `Впритык к окну: ... Апгрейдов (окно): 0` (state.json ещё без апгрейдов — до live-проверки; главное — не падает при отсутствии поля).

- [ ] **Step 6: Update PROJECT_MEMORY.md**

a) В секции «Ключевые решения» после строки про контекстную телеметрию добавить:

```markdown
- **Окно-осознанный авто-апгрейд** (server.js + lib/routing.js `needsWindowUpgrade`): запрос с `est > win×1.5` (WINDOW_FIT_FACTOR) не влезает в окно target → компакция пропускается, target исключается из цепочки, провайдер выбирается из capable-пула (`win >= requestTokens || win === 0`). Считается `upgradedCount` в телеметрии.
```

b) В секции «Известные проблемы» пункт про window-aware роутинг (обход primary-target) обрезать до положения «ИСПРАВЛЕНО 30.08»:

```markdown
- ~~Window-aware роутинг обходит primary-target~~ **ИСПРАВЛЕНО 30.08**: target-first пропускается при `windowUpgraded`, target в таких случаях исключается (см. авто-апгрейд).
```

- [ ] **Step 7: Commit**

```bash
git add tools/context-diag.js lib/dashboard.js test/proxy.test.js PROJECT_MEMORY.md
git commit -m "feat: апгрейды (окно) в CLI, dashboard и PROJECT_MEMORY"
```

---

### Task 5: Верификация + live-проверка

**Files:** (нет изменений)

- [ ] **Step 1: Полный прогон**

Run: `node --check server.js lib/routing.js lib/contextstats.js && node --test test/*.test.js`
Expected: SYNTAX_OK; `ℹ pass 157` / `ℹ fail 0`.

- [ ] **Step 2: Рестарт сервера**

```bash
launchctl kickstart -k gui/$(id -u)/com.free-llm-proxy
sleep 3
curl -s http://localhost:4000/health | python3 -m json.tool | grep -A2 '"context"' | head -20
```
Expected: `/health` отвечает, `context.overWindow` сохранился из прошлых замеров (2).

- [ ] **Step 3: Гигантский запрос на tier-s (должен уйти не на codestral)**

```bash
python3 -c "
import json, urllib.request
body=json.dumps({'model':'tier-s','messages':[{'role':'user','content':'Основание: '+'Контекст. '*30000}],'stream':False}).encode()
req=urllib.request.Request('http://localhost:4000/v1/chat/completions',data=body,headers={'Authorization':'Bearer free-llm-proxy-2024','Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=180) as r: print(r.status, r.read()[:200])
"
sleep 32
curl -s http://localhost:4000/health | python3 -c "import json,sys; d=json.load(sys.stdin)['context']; print('status',d['status'],'upgraded',d.get('upgradedCount'),'overWindow',d.get('overWindow')); print({k:v['requests'] for k,v in d['providers'].items()})"
```
Expected: ответ пришёл (200), в `/health` `upgradedCount >= 1`, провайдер ответа — НЕ `or-minimax-m3-free` (minimax 1M тоже capable → мог ответить он; важно: **не codestral**, и `overWindow` для codestral не вырос).

- [ ] **Step 4: CLI подтверждает**

Run: `node tools/context-diag.js --hours 24`
Expected: строка `Апгрейдов (окно): N` (N ≥ 1), в блоке провайдера ответа `апгрейд=1`.

- [ ] **Step 5: Финальный коммит (если были правки)**

```bash
git add -A
git commit -m "verification: окно-осознанный апгрейд — live-подтверждение" || echo "nothing to commit"
```

---

## Self-review

**Spec coverage:**
- Part 1 (decision point, WINDOW_FIT_FACTOR=1.5, skip compaction) → Task 1 + Task 3 (a-c). ✓
- Part 2 (windowPool без гейта, target-first skip, empty-capable best-effort) → Task 3 (d-e). ✓
- Part 3 (upgradedCount в бакете + summary + per-provider; CLI строка; dashboard бейдж) → Task 2 + Task 4. ✓
- Edge cases (targetWin 0, win 0 в пуле, память, commit-точки) → Task 1 тесты + Task 3 (существующий код не трогается). ✓
- Testing section (routing unit, proxy structural, contextstats, live) → Tasks 1-5. ✓

**Placeholders:** нет TBD/«добавь валидацию»; все шаги с кодом и командами. ✓

**Type consistency:** `needsWindowUpgrade(targetWin, requestTokens, factor)` — сигнатура едина (Task 1 → Task 3); `WINDOW_FIT_FACTOR` один; `upgradedCount` (int) — в emptyBucket/record/summary/CLI/dashboard; `measure.upgraded` (0/1) — только мера. ✓

**Примечание (вне скоупа):** `record()` ждёт `m.est` для `sumEst`, но server пишет `sentTokens` — `sumEst` не накапливается в live. Не влияет на ratio/overWindow/upgradedCount; не трогаем (отдельная чистка).