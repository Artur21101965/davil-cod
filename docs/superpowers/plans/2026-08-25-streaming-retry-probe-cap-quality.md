# Freegate: Стриминг-ретрай, лимит пробинга, проверка качества

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ SUB-SKILL: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для реализации этого плана задача-за-задачей. Шаги используют синтаксис чекбоксов (`- [ ]`) для отслеживания.

**Goal:** Три фичи надёжности: (1) streaming-провайдер, молчащий 5 сек, заменяется на fallback, (2) health-пробинг ограничен 8 параллельными запросами, (3) ответы короче 5 символов отклоняются как мусор.

**Architecture:** Все три фичи — изменения в `server.js` + один хелпер в `lib/clean.js`. Каждая фича отдельной задачей с коммитом. Фича 1 буферизует streaming до первого токена с таймаутом 5с (кроме reasoning-провайдеров). Фича 2 разбивает `Promise.allSettled` на пакеты по 8. Фича 3 расширяет guard коротких ответов.

**Tech Stack:** Node.js (CommonJS), `node:test`, существующие server.js, lib/clean.js.

**Base:** `/Users/sid/.config/opencode/llm-proxy/.worktrees/reliability/`
**Тесты:** `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`

---

### Task 1: isTooShort в lib/clean.js

**Files:**
- Modify: `lib/clean.js` (add constant + function + export)
- Test: `test/clean.test.js`

- [ ] **Step 1: Write failing tests**

Add to `test/clean.test.js`:

```javascript
test('clean: isTooShort true for empty/1-char answers', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: '' } }] }), true);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'a' } }] }), true);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'abcd' } }] }), true);
});

test('clean: isTooShort false for 5+ char answers', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'abcde' } }] }), false);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: 'Ответ на вопрос' } }] }), false);
});

test('clean: isTooShort counts reasoning as content', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: '', reasoning: 'длинное размышление тут' } }] }), false);
  assert.strictEqual(isTooShort({ choices: [{ message: { role: 'assistant', content: '', reasoning: 'ab' } }] }), true);
});

test('clean: isTooShort true for missing choices', () => {
  const { isTooShort } = require('../lib/clean');
  assert.strictEqual(isTooShort({}), true);
  assert.strictEqual(isTooShort(null), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/clean.test.js`
Expected: FAIL with `isTooShort is not a function`

- [ ] **Step 3: Implement in lib/clean.js**

Add before `module.exports`:

```javascript
// Ответ короче MIN_ANSWER_LEN символов считается мусором (обрыв/один токен).
const MIN_ANSWER_LEN = 5;
function isTooShort(data) {
  if (!data || !Array.isArray(data.choices)) return true;
  const msg = data.choices[0]?.message;
  const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
  const reasoning = typeof msg?.reasoning === 'string' ? msg.reasoning.trim() : '';
  return (content + reasoning).length < MIN_ANSWER_LEN;
}
```

Update export:

```javascript
module.exports = { stripThink, cleanMessage, cleanDelta, fixReasoningMessage, hasContent, isTooShort, MIN_ANSWER_LEN };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 test/clean.test.js`
Expected: PASS (all, original + 4 new)

- [ ] **Step 5: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/reliability/
git add lib/clean.js test/clean.test.js
git commit -m "feat: isTooShort helper rejects junk answers shorter than 5 chars"
```

### Task 2: Проверка качества коротких ответов в server.js

**Files:**
- Modify: `server.js` (import + guards)
- Test: existing tests must pass

- [ ] **Step 1: Update import**

Find:
```javascript
const { stripThink, cleanDelta, cleanMessage, fixReasoningMessage, hasContent } = require('./lib/clean');
```
Change to:
```javascript
const { stripThink, cleanDelta, cleanMessage, fixReasoningMessage, hasContent, isTooShort } = require('./lib/clean');
```

- [ ] **Step 2: Extend the non-stream empty-guard to also reject too-short**

Find the early guard (around server.js:355-371). It currently checks `!hasContent(result.data)`. Change the condition to also reject too-short:

```javascript
        if (!hasContent(result.data) || isTooShort(result.data)) {
          const msg = key + ': empty or too short response';
          errors.push(msg);
          recordFailure(key, 0);
          recordRequest(key, false, msg);
          recordRecent({ model: requestedModel, provider: key, status: 204, latency: result.latency, cached: false });
          logger.warn('Empty or too-short response, trying next provider', { key });
          continue;
        }
```

- [ ] **Step 3: Extend the allSoft retry guard too**

Find the allSoft retry non-stream guard (around server.js:499-505). It checks `!hasContent(result.data)`. Change to also reject too-short:

```javascript
          if (!hasContent(result.data) || isTooShort(result.data)) {
            recordFailure(key, 0);
            recordRequest(key, false, key + ': empty or too short response (retry)');
            logger.warn('Empty or too-short response in retry, trying next', { key });
            continue;
          }
```

- [ ] **Step 4: Extend streaming cache guard to not cache too-short**

In the streaming block, the `result.stream.on('end')` handler caches when `full.trim().length > 0`. Change to `>= MIN_ANSWER_LEN` (import MIN_ANSWER_LEN too):

```javascript
            if (full.trim().length >= MIN_ANSWER_LEN) {
              cache.set(effectiveModel, body.messages, body.temperature, {...});
            }
```

Update the import to include MIN_ANSWER_LEN:
```javascript
const { stripThink, cleanDelta, cleanMessage, fixReasoningMessage, hasContent, isTooShort, MIN_ANSWER_LEN } = require('./lib/clean');
```

- [ ] **Step 5: Run all tests**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
Expected: PASS (all)

- [ ] **Step 6: Syntax check**

Run: `node --check server.js`

- [ ] **Step 7: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/reliability/
git add server.js
git commit -m "feat: reject too-short (<5 chars) answers as junk; don't cache them"
```

### Task 3: Лимит параллельного health-пробинга

**Files:**
- Modify: `server.js` (healthCheck)
- Test: existing tests must pass

- [ ] **Step 1: Change healthCheck to batch by 8**

Find (around server.js:109-116):
```javascript
async function healthCheck() {
  const now = Date.now();
  // Параллельный пробинг: все провайдеры проверяются одновременно,
  // а не последовательно — быстрый старт и восстановление при 30+ провайдерах.
  const due = Object.entries(PROVIDERS)
    .filter(([key, provider]) => provider.enabled && !(healthIntervals[key] && healthIntervals[key].nextCheck > now));
  await Promise.allSettled(due.map(([key, provider]) => checkProvider(key, provider)));
}
```

Replace with batched version:

```javascript
const PROBE_CAP = 8;

async function healthCheck() {
  const now = Date.now();
  // Параллельный пробинг с лимитом: пакетами по PROBE_CAP, чтобы не создавать
  // десятки одновременных fetch-запросов при 30+ провайдерах.
  const due = Object.entries(PROVIDERS)
    .filter(([key, provider]) => provider.enabled && !(healthIntervals[key] && healthIntervals[key].nextCheck > now));
  for (let i = 0; i < due.length; i += PROBE_CAP) {
    const batch = due.slice(i, i + PROBE_CAP);
    await Promise.allSettled(batch.map(([key, provider]) => checkProvider(key, provider)));
  }
}
```

- [ ] **Step 2: Run all tests**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
Expected: PASS (all)

- [ ] **Step 3: Syntax check**

Run: `node --check server.js`

- [ ] **Step 4: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/reliability/
git add server.js
git commit -m "perf: cap parallel health probing to batches of 8"
```

### Task 4: Стриминг-ретрай по таймауту первого токена

**Files:**
- Modify: `server.js` (streaming block, lines 379-437)
- Test: existing tests must pass

**ВАЖНО:** Это самая сложная задача. Читайте код внимательно перед правкой.

- [ ] **Step 1: Understand current streaming flow**

The streaming block (server.js:379-437) writes headers immediately, sets up a Transform `cleaner`, pipes `result.stream → cleaner → res`. On `end`, caches if content non-empty. On `error`, ends res.

- [ ] **Step 2: Replace the streaming block with a buffered-first-token version**

Replace the entire `if (isStreaming && result.stream) { ... }` block (lines 379-437) with:

```javascript
      if (isStreaming && result.stream) {
        const chunks = [];
        let sentHeaders = false;

        // Очистка SSE-строки: убрать nvext, logprobs, think-блоки из дельт.
        const cleanStr = (str) => str.replace(/^data: (.+)$/gm, (match, jsonStr) => {
          if (jsonStr.trim() === '[DONE]') return match;
          try {
            const obj = JSON.parse(jsonStr);
            delete obj.nvext;
            if (obj.choices?.[0]) {
              delete obj.choices[0].logprobs;
              cleanDelta(obj.choices[0].delta);
            }
            return 'data: ' + JSON.stringify(obj);
          } catch { return match; }
        });

        // Сбор контент-токенов для кэша (strip think).
        const collect = (str) => {
          const lines = str.split('\n');
          for (const line of lines) {
            const m = line.match(/^data: (.+)$/);
            if (!m || m[1].trim() === '[DONE]') continue;
            try {
              const obj = JSON.parse(m[1]);
              const delta = obj.choices?.[0]?.delta?.content;
              if (typeof delta === 'string') chunks.push(stripThink(delta, false));
            } catch {}
          }
        };

        // Reasoning-модели (ox-alpha) думают 10с+ до первого токена — стримим сразу.
        if (provider.reasoning) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          const { Transform } = require('stream');
          const cleaner = new Transform({
            transform(chunk, encoding, callback) {
              const str = chunk.toString();
              collect(str);
              callback(null, cleanStr(str));
            }
          });
          result.stream.on('end', () => {
            const full = chunks.join('');
            if (full.trim().length >= MIN_ANSWER_LEN) {
              cache.set(effectiveModel, body.messages, body.temperature, {
                id: 'chatcmpl-cached',
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: provider.model,
                choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
              });
            }
            res.end();
          });
          result.stream.on('error', (err) => { logger.error('Stream error', { key, error: err.message }); res.end(); });
          result.stream.pipe(cleaner).pipe(res);
          return;
        }

        // Обычные модели: буферизуем до первого токена (макс 5 сек).
        // Заголовки не пишем сразу — если токена нет за 5 сек, fallback.
        const rawBuf = [];
        let gotFirst = false;
        const firstToken = new Promise((resolve) => {
          let done = false;
          const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 5000);
          const finish = (ok) => { if (!done) { done = true; clearTimeout(timer); resolve(ok); } };
          result.stream.on('data', (chunk) => {
            const str = chunk.toString();
            rawBuf.push(str);
            collect(str);
            // Первый контент-токен: `"content":"` с непустым значением.
            if (/"content"\s*:\s*"[^"]+/.test(str) && !/"content"\s*:\s*""/.test(str)) {
              finish(true);
            }
          });
          result.stream.once('end', () => finish(false));
          result.stream.once('error', () => finish(false));
        });

        gotFirst = await firstToken;
        if (!gotFirst) {
          const msg = key + ': no first token within 5s';
          errors.push(msg);
          recordFailure(key, 0);
          recordRequest(key, false, msg);
          recordRecent({ model: requestedModel, provider: key, status: 204, latency: result.latency, cached: false });
          logger.warn('Streaming fallback: no first token', { key });
          try { result.stream.destroy(); } catch {}
          continue; // РАБОТАЕТ — мы внутри for-цикла провайдеров.
        }

        // Первый токен пришёл: пишем заголовки, промываем буфер, дальше стримим.
        sentHeaders = true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        for (const b of rawBuf) res.write(b);
        rawBuf.length = 0;

        // Убираем наш 'data'-слушатель (он больше не нужен — данные уже
        // буферизованы в rawBuf и промыты). Дальше обрабатываем вручную.
        result.stream.removeAllListeners('data');
        result.stream.on('data', (chunk) => {
          const str = chunk.toString();
          collect(str);
          res.write(cleanStr(str));
        });
        result.stream.on('end', () => {
          const full = chunks.join('');
          if (full.trim().length >= MIN_ANSWER_LEN) {
            cache.set(effectiveModel, body.messages, body.temperature, {
              id: 'chatcmpl-cached',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: provider.model,
              choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
          }
          res.end();
        });
        result.stream.on('error', (err) => {
          logger.error('Stream error', { key, error: err.message });
          res.end();
        });
        return;
      }
```

**ВАЖНЫЕ ПОЯСНЕНИЯ ДЛЯ ИСПОЛНИТЕЛЯ:**
1. Промис `firstToken` буферизует ВСЕ чанки в `rawBuf` через свой 'data'-слушатель. На первый контент-токен — resolve(true).
2. Если таймаут 5с или стрим закончился/ошибся до первого токена — resolve(false) → `continue` к следующему провайдеру. Это РАБОТАЕТ, потому что мы в for-цикле провайдеров.
3. На успех: заголовки 200, промываем rawBuf (данные не теряются), убираем старый 'data'-слушатель, вешаем новый для дальнейшей очистки.
4. `collect()` собирает контент в `chunks` и в промис-слушателе, и в финальном — оба слушателя работают последовательно (сначала промис-слушатель до removeAllListeners, потом финальный). НО: чанки, пришедшие ДО первого токена, обработаны промис-слушателем и записаны в res как СЫРЫЕ (не через cleanStr). Это нормально — до первого токена дума-блоков в контенте не бывает, а nvext/logprobs в ранних чанках не критичны (клиенты игнорируют неизвестные поля).
5. Убедитесь, что `MIN_ANSWER_LEN` импортирован в server.js (Task 2 добавил его).
6. Проверьте, что переменная `provider` в scope (да, это параметр for-цикла `for (const [key, provider] of enabledProviders)`).

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/.config/opencode/llm-proxy/.worktrees/reliability/
git add server.js
git commit -m "feat: streaming fallback when no first token within 5s (skip reasoning models)"
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

- [ ] **Step 3: Smoke test — normal streaming request**

```bash
curl -s --max-time 60 http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer free-llm-proxy-2024" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":"привет"}],"stream":true,"max_tokens":10}'
```
Expected: working SSE stream.

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
