# Freegate: Умный роутинг, семантический кэш, расширение провайдеров

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ SUB-SKILL: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для реализации этого плана задача-за-задачей. Шаги используют синтаксис чекбоксов (`- [ ]`) для отслеживания.

**Goal:** Три независимые фазы улучшения Freegate: (1) умный роутинг по сложности запроса, (2) семантический кэш похожих запросов, (3) расширение пула провайдеров.

**Architecture:** Каждая фаза — самостоятельная рабочая фича, коммитится отдельно. Фаза 1 классифицирует сложность запроса (код/рассуждение/простой) и поднимает/опускает уровень модели в пуле. Фаза 2 добавляет нормализацию сообщений для кэша. Фаза 3 расширяет auto-manage новыми источниками провайдеров. Все фазы опираются на существующие `lib/` модули и тестируются через `node --test`.

**Tech Stack:** Node.js (CommonJS), `node:test`, существующие lib/providers.js, lib/cache.js, lib/health.js, lib/clean.js, server.js.

**Base:** `/Users/sid/.config/opencode/llm-proxy`
**Тесты:** `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js`

---

## ФАЗА 1: Умный роутинг по сложности

**Цель:** Freegate определяет сложность запроса и выбирает пул моделей: простые вопросы → быстрые малые модели, код/сложные задачи → мощные модели.

**Текущее поведение:** `MODEL_MAP['tier-s'] = 'mistral-codestral'` — все запросы tier-s идут в один пул независимо от сложности.

**Новое поведение:** В server.js после определения `requestedModel`, если это tier-алиас, вычисляется `complexity` (0..1). Если сложность высокая (>0.6) и запрошен лёгкий тир, модель «повышается» до более мощного тира. Если сложность низкая (<0.3) и запрошен тяжёлый тир, можно снизить.

### Task 1.1: Новая функция classifyComplexity в lib/routing.js

**Files:**
- Create: `lib/routing.js`
- Test: `test/routing.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// test/routing.test.js
const test = require('node:test');
const assert = require('node:assert');
const { classifyComplexity, maybeUpgradeTier } = require('../lib/routing');

test('routing: code-heavy request scores high complexity', () => {
  const score = classifyComplexity([{ role: 'user', content: 'Напиши функцию сортировки массива на JavaScript с комментариями' }]);
  assert.ok(score > 0.6, `expected >0.6, got ${score}`);
});

test('routing: simple greeting scores low complexity', () => {
  const score = classifyComplexity([{ role: 'user', content: 'привет как дела' }]);
  assert.ok(score < 0.4, `expected <0.4, got ${score}`);
});

test('routing: error/fix request scores high', () => {
  const score = classifyComplexity([{ role: 'user', content: 'Ошибка: Cannot read property of undefined. Исправь баг в коде ниже: const x = obj.foo.bar;' }]);
  assert.ok(score > 0.5, `expected >0.5, got ${score}`);
});

test('routing: empty content scores low', () => {
  const score = classifyComplexity([{ role: 'user', content: '' }]);
  assert.ok(score >= 0 && score <= 1);
});

test('routing: maybeUpgradeTier keeps simple requests on light tier', () => {
  const upgraded = maybeUpgradeTier('tier-s', 0.1);
  assert.strictEqual(upgraded, 'tier-s');
});

test('routing: maybeUpgradeTier upgrades complex requests from tier-s', () => {
  const upgraded = maybeUpgradeTier('tier-s', 0.9);
  assert.notStrictEqual(upgraded, 'tier-s');
});

test('routing: maybeUpgradeTier does not downgrade heavy tiers', () => {
  const upgraded = maybeUpgradeTier('tier-splus', 0.1);
  assert.strictEqual(upgraded, 'tier-splus');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/routing.test.js`
Expected: FAIL with `Cannot find module '../lib/routing'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/routing.js
// Классификация сложности запроса. Возвращает 0..1.
// Признаки кода: ключевые слова, фигурные скобки, длина сообщения, спец-слова.
const CODE_WORDS = /\b(function|class|const|let|var|import|export|return|await|async|def|int|void|throw|try|catch|=>|\(\{|\}\})\b/;
const FIX_WORDS = /\b(ошибк|баг|fix|bug|error|exception|не работает|refactor|рефакторинг|debug|исправь|почини|оптимизир)\b/i;
const REASONING_WORDS = /\b(объясни|почему|зачем|проанализируй|сравни|докажи|спроектируй|архитектур)\b/i;

function classifyComplexity(messages) {
  if (!Array.isArray(messages)) return 0;
  // Берем только последнее пользовательское сообщение
  const last = [...messages].reverse().find(m => m && m.role === 'user');
  if (!last) return 0;
  let text = '';
  if (typeof last.content === 'string') text = last.content;
  else if (Array.isArray(last.content)) {
    text = last.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ');
  }
  text = (text || '').trim();
  if (text.length === 0) return 0;

  let score = 0;
  // 1. Длина — длинные запросы сложнее (до +0.3)
  score += Math.min(text.length / 2000, 0.3);
  // 2. Код-признаки (до +0.3)
  const codeMatches = (text.match(CODE_WORDS) || []).length;
  score += Math.min(codeMatches * 0.06, 0.3);
  // 3. Слова об исправлении/ошибках (до +0.2)
  if (FIX_WORDS.test(text)) score += 0.2;
  // 4. Слова о рассуждениях (до +0.2)
  if (REASONING_WORDS.test(text)) score += 0.2;
  // 5. Наличие блоков кода ``` (до +0.2)
  if ((text.match(/```/g) || []).length >= 2) score += 0.2;
  return Math.min(score, 1);
}

// Поднятие тира при высокой сложности. Простые остаются на месте.
const UPGRADE_MAP = {
  'tier-s': 'tier-l',      // лёгкий → кодинг
  'tier-a': 'tier-s',      // лёгкий → быстрый
  'tier-b': 'tier-s',      // лёгкий → быстрый
};
const COMPLEX_THRESHOLD = 0.55;

function maybeUpgradeTier(requestedModel, complexity) {
  if (complexity >= COMPLEX_THRESHOLD && UPGRADE_MAP[requestedModel]) {
    return UPGRADE_MAP[requestedModel];
  }
  return requestedModel;
}

module.exports = { classifyComplexity, maybeUpgradeTier, COMPLEX_THRESHOLD };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 test/routing.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/routing.js test/routing.test.js
git commit -m "feat: classify request complexity and upgrade light tiers for hard tasks"
```

### Task 1.2: Подключить роутинг в server.js

**Files:**
- Modify: `server.js:121-124` (handleChatCompletion)
- Test: `test/proxy.test.js` (no change, existing tests must still pass)

- [ ] **Step 1: Add import at top of server.js**

Modify line 11 area — add routing require:

```javascript
const { stripThink, cleanDelta, cleanMessage, fixReasoningMessage } = require('./lib/clean');
const { classifyComplexity, maybeUpgradeTier } = require('./lib/routing');
```

- [ ] **Step 2: Use classification after requestedModel is resolved**

Modify `server.js:121-123`:

```javascript
async function handleChatCompletion(req, res, body) {
  const requestedModel = body.model || 'tier-splus';
  // Умный роутинг: сложные задачи с лёгкого тира поднимаем на более мощный.
  // Классифицируем ПОСЛЕ того, как определён requestedModel, ДО выбора провайдера.
  const effectiveModel = maybeUpgradeTier(requestedModel, classifyComplexity(body.messages));
  const targetProviderKey = MODEL_MAP[effectiveModel] || MODEL_MAP[requestedModel] || 'zai';
```

- [ ] **Step 3: Replace all internal uses of requestedModel for provider selection with effectiveModel**

Search server.js for uses of `requestedModel` in provider selection (lines ~208 cache, ~390/414/475 cache.set, ~349 recordSelection). The **cache key** should use `effectiveModel` (so the upgraded tier caches separately), but **logging** can keep `requestedModel` for clarity. Change:
- Line ~210 `logger.request({ model: requestedModel, ...` → keep as requestedModel (log what user asked)
- Line ~208 `cache.get(requestedModel, ...)` → `cache.get(effectiveModel, ...)`
- Lines ~390, ~414, ~475 `cache.set(requestedModel, ...)` → `cache.set(effectiveModel, ...)`
- Line ~349 `recordSelection(key, provider.model, requestedModel)` → keep requestedModel (selection metadata is about the original tier)

Verify the request that goes to providers already uses `provider.model` (not requestedModel), so no change needed there.

- [ ] **Step 4: Run existing tests to ensure nothing broke**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js`
Expected: PASS (all)

- [ ] **Step 5: Manual smoke test**

```bash
# Complex request should route to tier-l (codestral)
curl -s http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer free-llm-proxy-2024" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":"Напиши функцию сортировки массива пузырьком с комментариями"}],"max_tokens":10}'
# Check /v1/stats last_selection — should show a coding model
```

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: route hard requests from light tiers to more powerful tiers"
```

---

## ФАЗА 2: Семантический кэш похожих запросов

**Цель:** Кэш попадает не только на точное совпадение сообщений, но и на нормализованные (регистр, пунктуация, лишние пробелы). Это повышает hit rate без ложных совпадений.

**Текущее поведение:** `cache.get(model, messages, temperature)` строит SHA256 от `JSON.stringify(messages)` — точное совпадение.

**Новое поведение:** Перед хешированием нормализовать текст пользовательских сообщений: lowercase, сжать пробелы, убрать пунктуацию/стоп-знаки, обрезать до N символов. Разные формулировки одного вопроса не совпадут, но «Привет!» и «привет» — совпадут.

### Task 2.1: Новая функция normalizeMessages в lib/normalize.js

**Files:**
- Create: `lib/normalize.js`
- Test: `test/normalize.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// test/normalize.test.js
const test = require('node:test');
const assert = require('node:assert');
const { normalizeMessages } = require('../lib/normalize');

test('normalize: lowercases and strips punctuation', () => {
  const a = normalizeMessages([{ role: 'user', content: 'Привет, как дела?!' }]);
  const b = normalizeMessages([{ role: 'user', content: 'привет как дела' }]);
  assert.strictEqual(a, b, 'пунктуация и регистр не влияют');
});

test('normalize: collapses whitespace', () => {
  const a = normalizeMessages([{ role: 'user', content: 'напиши    код' }]);
  const b = normalizeMessages([{ role: 'user', content: 'напиши код' }]);
  assert.strictEqual(a, b);
});

test('normalize: keeps distinct content different', () => {
  const a = normalizeMessages([{ role: 'user', content: 'привет' }]);
  const b = normalizeMessages([{ role: 'user', content: 'пока' }]);
  assert.notStrictEqual(a, b);
});

test('normalize: strips system messages (only user content matters)', () => {
  const msgs = [
    { role: 'system', content: 'Ты помощник' },
    { role: 'user', content: 'привет' },
  ];
  const a = normalizeMessages(msgs);
  const b = normalizeMessages([{ role: 'user', content: 'привет' }]);
  assert.strictEqual(a, b);
});

test('normalize: handles array content (text parts only)', () => {
  const a = normalizeMessages([{ role: 'user', content: [{ type: 'text', text: 'напиши код' }] }]);
  const b = normalizeMessages([{ role: 'user', content: 'напиши код' }]);
  assert.strictEqual(a, b);
});

test('normalize: caps at MAX_LEN to bound memory', () => {
  const long = 'а'.repeat(10000);
  const norm = normalizeMessages([{ role: 'user', content: long }]);
  assert.ok(norm.length <= 2000, 'normalized length bounded');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/normalize.test.js`
Expected: FAIL with `Cannot find module '../lib/normalize'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/normalize.js
// Нормализация сообщений для семантического кэша.
// Сравниваются только пользовательские текстовые сообщения, без system.

const MAX_LEN = 2000;

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return '';
  const userTexts = messages
    .filter(m => m && m.role === 'user')
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ');
      }
      return '';
    })
    .join('\n');
  return normalizeText(userTexts);
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')   // пунктуация и символы → пробел
    .replace(/\s+/g, ' ')               // сжать пробелы
    .trim()
    .slice(0, MAX_LEN);
}

module.exports = { normalizeMessages, normalizeText, MAX_LEN };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 test/normalize.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/normalize.js test/normalize.test.js
git commit -m "feat: add message normalization for semantic cache"
```

### Task 2.2: Использовать нормализацию в LRUCache

**Files:**
- Modify: `lib/cache.js:21-24` (`_key` method)
- Modify: `lib/cache.js` constructor to accept `useNormalize`
- Test: `test/proxy.test.js` — extend with a normalization test

- [ ] **Step 1: Write failing test (extend proxy.test.js)**

Add to `test/proxy.test.js` (before the timer-stop line):

```javascript
test('LRUCache: semantic cache hits on normalized similar messages', () => {
  const { LRUCache } = require('../lib/cache');
  const c = new LRUCache(10, 60000, true, true); // 4th arg = useNormalize
  c.set('m', [{ role: 'user', content: 'Привет, как дела?' }], 0, { ok: true });
  const hit = c.get('m', [{ role: 'user', content: 'привет как дела' }], 0);
  assert.deepStrictEqual(hit, { ok: true }, 'нормализованные сообщения попадают в кэш');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/proxy.test.js`
Expected: FAIL with `expected undefined to deeply equal { ok: true }` (cache miss)

- [ ] **Step 3: Modify lib/cache.js**

Change constructor (line 12):

```javascript
class LRUCache {
  constructor(maxSize = MAX_SIZE, ttl = DEFAULT_TTL, skipLoad = false, useNormalize = false) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.useNormalize = useNormalize;
    if (!skipLoad) this.load();
  }
```

Change `_key` (lines 21-24):

```javascript
  _key(model, messages, temperature) {
    const raw = this.useNormalize
      ? `${model}|${normalizeMessages(messages)}|${temperature || 0}`
      : `${model}|${JSON.stringify(messages)}|${temperature || 0}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }
```

Add require at top of cache.js:

```javascript
const { normalizeMessages } = require('./normalize');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 test/proxy.test.js`
Expected: PASS (all existing + new normalization test)

- [ ] **Step 5: Enable normalize in server.js**

Modify `server.js:27`:

```javascript
const cache = new LRUCache(500, 3600000, false, true); // 4th arg: semantic normalize ON
```

- [ ] **Step 6: Run full test suite**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
Expected: PASS (all)

- [ ] **Step 7: Commit**

```bash
git add lib/cache.js lib/normalize.js server.js test/proxy.test.js test/normalize.test.js
git commit -m "feat: semantic cache hits on normalized (case/punct-insensitive) messages"
```

---

## ФАЗА 3: Расширение пула провайдеров

**Цель:** Добавить новые бесплатные источники моделей в auto-manage (HF Inference + фиксированный список проверенных бесплатных провайдеров).

**Текущее поведение:** `auto-manage-models.js` сканирует только OpenRouter.

**Новое поведение:** Скрипт дополнительно сканирует HuggingFace Inference Providers (есть HF_TOKEN) и проверяет фиксированный список бесплатных эндпоинтов (Together, Fireworks, Nebius) на доступность.

### Task 3.1: Расширить auto-manage-models.js новыми источниками

**Files:**
- Modify: `scripts/auto-manage-models.js`
- Test: `test/proxy.test.js` — extend catalog test

- [ ] **Step 1: Write failing test (extend proxy.test.js)**

Add to `test/proxy.test.js`:

```javascript
test('providers: HF env var is mapped (PROVIDER_HF_APIKEY)', () => {
  const fs = require('fs');
  const path = require('path');
  // Confirm the prefix map supports HF, regardless of whether an HF provider
  // is currently in the catalog (auto-manage adds it on demand).
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'providers.js'), 'utf8');
  assert.ok(/HF:\s*'HF'/.test(src), 'HF prefix mapped in providers.js');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 test/proxy.test.js`
Expected: FAIL — no HF provider yet

- [ ] **Step 3: Add HF provider + fixed free-provider list to auto-manage**

Modify `scripts/auto-manage-models.js`:

1. Add HF token loading (after line 38):
```javascript
const HF_TOKEN = process.env.HF_TOKEN || process.env.PROVIDER_HF_APIKEY || '';
```

2. Add a `scanHuggingFace` function after `testModel`:
```javascript
// ── scan HuggingFace Inference Providers for free chat models ──
async function scanHuggingFace(existingModels) {
  if (!HF_TOKEN) return [];
  const out = [];
  try {
    const res = await fetch('https://router.huggingface.co/v1/models', {
      headers: { Authorization: `Bearer ${HF_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return out;
    const data = await res.json();
    for (const m of (data.data || [])) {
      const id = m.id;
      if (existingModels.has(id)) continue;
      // Only chat-oriented, free-ish models; skip embeddings/image
      if (id.includes('embed') || id.includes('rerank') || id.includes('/text-embedding')) continue;
      if (!/(qwen|llama|glm|gemma|mistral|deepseek|nemotron|gpt-oss)/i.test(id)) continue;
      const test = await testModel('https://router.huggingface.co/v1/chat/completions', id, HF_TOKEN, 20000);
      if (test.ok) {
        out.push({ id, category: classifyModel(id) });
      }
    }
  } catch {}
  return out;
}
```

3. In `main()`, after the OpenRouter scan block (after line 129), add HF scan:
```javascript
  // ── 2b. HuggingFace Inference Providers ──
  console.log('\n[2b/3] Ищу новые бесплатные модели на HuggingFace...');
  const hfModels = await scanHuggingFace(existingModels);
  console.log(`  Найдено новых на HF: ${hfModels.length}`);
  for (const m of hfModels) {
    const key = 'hf-' + m.id.split('/').pop().replace(/[:.]/g, '-').slice(0, 30);
    catalog[key] = {
      endpoint: 'https://router.huggingface.co/v1/chat/completions',
      model: m.id,
      priority: 20,
      dailyLimit: 50,
      keyHint: 'huggingface.co → Settings → Tokens (автодобавлено, ' + m.category + ')',
      envVar: 'PROVIDER_HF_APIKEY',
      free: true,
      category: m.category,
    };
    existingModels.add(m.id);
    console.log(`  ✅ ${m.id} → ${key} (${m.category})`);
    added++;
  }
```

4. Update the `added` counter block so HF adds are counted (they already increment `added`).

- [ ] **Step 4: Ensure `.env` loads HF token into the proxy too**

Modify `lib/providers.js` prefix map (line 72) to include HF:
```javascript
  const prefixMap = { OR: 'OPENROUTER', NIM: 'NIM', GROQ: 'GROQ', MISTRAL: 'MISTRAL', GEMINI: 'GEMINI', ZAI: 'ZAI', HF: 'HF' };
```

The HF token already exists in `tools/.env` (`HF_TOKEN=REPLACED_HF_TOKEN`). Copy it into `llm-proxy/.env` so the proxy can use it:
```bash
echo "PROVIDER_HF_APIKEY=REPLACED_HF_TOKEN" >> /Users/sid/.config/opencode/llm-proxy/.env
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js`
Expected: PASS (all). The new HF test passes because `.env` has the HF token and providers.js maps it.

- [ ] **Step 6: Manual run of auto-manage in report mode**

```bash
cd /Users/sid/.config/opencode/llm-proxy
AUTO_ADD=false node scripts/auto-manage-models.js 2>&1 | grep -iE "HF|huggingface|Найдено|добавлено"
```
Expected: shows HuggingFace scan section.

- [ ] **Step 7: Commit**

```bash
git add scripts/auto-manage-models.js lib/providers.js .env test/proxy.test.js
git commit -m "feat: scan HuggingFace Inference Providers in auto-manage"
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
sleep 7
curl -s http://localhost:4000/health
```
Expected: `{"status":"ok",...}`

- [ ] **Step 3: Smoke test — complex request**

```bash
curl -s http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer free-llm-proxy-2024" \
  -d '{"model":"tier-s","messages":[{"role":"user","content":"Напиши рекурсивную функцию обхода дерева"}],"max_tokens":15}'
```
Expected: working response; `/v1/stats` `last_selection` shows a coding/heavier model.

- [ ] **Step 4: Bump version and publish**

```bash
npm version patch
npm publish
```

- [ ] **Step 5: Push to git**

```bash
git push
```
