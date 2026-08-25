# Freegate: Умный vision-роутинг, авто-ретраи, параллельный пробинг

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ SUB-SKILL: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для реализации этого плана задача-за-задачей. Шаги используют синтаксис чекбоксов (`- [ ]`) для отслеживания.

**Goal:** Три независимые фичи: (1) сложные скриншоты поднимаются на тяжёлый тир, (2) пустые ответы провайдера не блокируют запрос — fallback к следующему, (3) health-пробинг провайдеров выполняется параллельно.

**Architecture:** Каждая фича — отдельная задача с коммитом. Фича 1 добавляет `classifyVisionComplexity` в lib/routing.js и использует её после vision-распознавания. Фича 2 — авто-ретрай при пустом ответе в цикле провайдеров server.js. Фича 3 — `Promise.allSettled` в `healthCheck()`.

**Tech Stack:** Node.js (CommonJS), `node:test`, существующие lib/routing.js, lib/clean.js, server.js.

**Base:** `/Users/sid/.config/opencode/llm-proxy/.worktrees/vision-autoretry/`
**Тесты:** `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`

---

### Task 1: classifyVisionComplexity в lib/routing.js

**Files:**
- Modify: `lib/routing.js` (add function + export)
- Test: `test/routing.test.js`

- [ ] **Step 1: Write failing tests**

Add to `test/routing.test.js`:

```javascript
test('routing: vision complexity high for code screenshot text', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  const text = 'const x = obj.foo.bar;\nfunction handleError(err) { return err.message; }\nОшибка: TypeError';
  assert.ok(classifyVisionComplexity(text) > 0.6, `expected >0.6, got ${classifyVisionComplexity(text)}`);
});

test('routing: vision complexity low for plain photo description', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  const text = 'На фото красивая гора и озеро, небо голубое, люди отдыхают на берегу';
  assert.ok(classifyVisionComplexity(text) < 0.4, `expected <0.4, got ${classifyVisionComplexity(text)}`);
});

test('routing: vision complexity empty text is 0', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  assert.strictEqual(classifyVisionComplexity(''), 0);
  assert.strictEqual(classifyVisionComplexity(null), 0);
});

test('routing: vision complexity medium for mixed text', () => {
  const { classifyVisionComplexity } = require('../lib/routing');
  const text = 'Скриншот чата: привет, как дела? Идём гулять завтра.';
  const score = classifyVisionComplexity(text);
  assert.ok(score >= 0 && score <= 1, `score in range, got ${score}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/routing.test.js`
Expected: FAIL with `classifyVisionComplexity is not a function`

- [ ] **Step 3: Implement classifyVisionComplexity in lib/routing.js**

Add before `module.exports` (after `maybeUpgradeTier`):

```javascript
// Сложность СКРИНШОТА по распознанному тексту. Скриншоты с кодом/ошибками
// должны поднимать тир (тяжёлая модель), простые фото — оставаться на лёгком.
function classifyVisionComplexity(text) {
  if (!text || typeof text !== 'string') return 0;
  const t = text.trim();
  if (t.length === 0) return 0;
  let score = 0;
  // Длина распознанного текста (до +0.2)
  score += Math.min(t.length / 3000, 0.2);
  // Код-признаки (до +0.4)
  const codeMatches = (t.match(CODE_WORDS_EN) || []).length;
  const ruMatches = (t.match(CODE_WORDS_RU) || []).length;
  score += Math.min((codeMatches + ruMatches) * 0.08, 0.4);
  // Error/fix слова (до +0.3)
  if (FIX_WORDS.test(t)) score += 0.3;
  // Символы кода { } [ ] => (до +0.3)
  if (CODE_SYMBOLS.test(t)) score += 0.3;
  return Math.min(score, 1);
}
```

Update exports:

```javascript
module.exports = { classifyComplexity, maybeUpgradeTier, COMPLEX_THRESHOLD, classifyVisionComplexity };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 test/routing.test.js`
Expected: PASS (all, 7 original + 4 new = 11)

- [ ] **Step 5: Commit**

```bash
git add lib/routing.js test/routing.test.js
git commit -m "feat: classifyVisionComplexity for screenshot content (code screenshots upgrade tier)"
```

### Task 2: Подключить vision-роутинг в server.js

**Files:**
- Modify: `server.js` (import + use after vision)
- Test: existing tests must pass

- [ ] **Step 1: Update import in server.js**

Change line 12:

```javascript
const { classifyComplexity, maybeUpgradeTier, classifyVisionComplexity } = require('./lib/routing');
```

- [ ] **Step 2: Use classifyVisionComplexity after vision extraction**

In the vision block, after `const cleaned = stripThink(extracted, true);` (around line 191-193), add:

```javascript
      const cleaned = stripThink(extracted, true);
      logger.info('Vision pipeline: скриншот распознан', { chars: cleaned.length });
      if (cleaned) {
        // Умный vision-роутинг: скриншот с кодом/ошибкой поднимает тир.
        const vc = classifyVisionComplexity(cleaned);
        if (vc > 0) effectiveModel = maybeUpgradeTier(effectiveModel, vc);
        // Replace image content with the extracted text as context,
        // so the coding/general model (not vision) answers the question.
```

- [ ] **Step 3: Run all tests to ensure nothing broke**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
Expected: PASS (all)

- [ ] **Step 4: Syntax check**

Run: `node --check server.js`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: route code/error screenshots to heavier tier via vision routing"
```

### Task 3: Авто-ретрай при пустом non-stream ответе

**Files:**
- Modify: `server.js` (provider loop, non-stream branch)
- Test: existing tests must pass

- [ ] **Step 1: Add empty-response guard in non-stream branch**

In the provider loop, in the `if (!isStreaming && result.data)` branch (around line 416), before caching/sending, add a guard. Change:

```javascript
      if (!isStreaming && result.data) {
        delete result.data.nvext;
        if (result.data.choices?.[0]) {
          fixReasoningMessage(result.data.choices[0].message);
          cleanMessage(result.data.choices[0].message);
        }
        // Пустой ответ (провайдер-глитч) НЕ считается успехом — пробуем следующего.
        if (!hasContent(result.data)) {
          const msg = key + ': empty response';
          errors.push(msg);
          recordFailure(key, 0);
          recordRequest(key, false, msg);
          recordRecent({ model: requestedModel, provider: key, status: 204, latency: result.latency, cached: false });
          logger.warn('Empty response, trying next provider', { key });
          continue;
        }
        if (hasContent(result.data)) cache.set(effectiveModel, body.messages, body.temperature, result.data);
```

- [ ] **Step 2: Streaming path — do NOT restructure**

For streaming requests, headers are already sent to the client before we know the stream is empty, so retrying is impossible without buffering the entire stream (which kills first-token latency). **Keep the original streaming block unchanged.** Empty streams are already not cached (the `full.trim().length > 0` guard added earlier). The autoretry applies ONLY to non-stream responses (Step 1). No changes to the streaming branch in this task.

- [ ] **Step 3: Run all tests**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
Expected: PASS (all)

- [ ] **Step 4: Syntax check**

Run: `node --check server.js`

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: empty non-stream provider response no longer blocks request (falls through to next provider)"
```

### Task 4: Параллельный health-пробинг

**Files:**
- Modify: `server.js:109-117` (healthCheck)
- Test: existing tests must pass

- [ ] **Step 1: Replace sequential loop with Promise.allSettled**

Change `healthCheck()`:

```javascript
async function healthCheck() {
  const now = Date.now();
  const due = Object.entries(PROVIDERS)
    .filter(([key, provider]) => provider.enabled && !(healthIntervals[key] && healthIntervals[key].nextCheck > now));
  await Promise.allSettled(due.map(([key, provider]) => checkProvider(key, provider)));
}
```

- [ ] **Step 2: Run all tests**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
Expected: PASS (all)

- [ ] **Step 3: Syntax check**

Run: `node --check server.js`

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "perf: parallel health probing with Promise.allSettled"
```

---

## Финальная проверка

- [ ] **Step 1: Full test suite**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
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

- [ ] **Step 3: Smoke test — code screenshot via proxy**

```bash
curl -s http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer free-llm-proxy-2024" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":[{"type":"text","text":"что на скриншоте?"},{"type":"image_url","image_url":{"url":"data:image/png;base64,AAA"}}]}],"max_tokens":15}'
```
Expected: working response; vision routing ran.

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
