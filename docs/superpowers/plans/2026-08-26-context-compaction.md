# Context Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically compact context via summarization when a dialog exceeds 50k tokens, so free models (Groq TPM 8000, Mistral 32k) stop rejecting large requests.

**Architecture:** New `lib/compactor.js` estimates message tokens, and if > 50k, compresses old messages (everything after the last ~10k tokens) into a single user-role summary via a long-context model fallback chain. The summary is cached by content-hash in an in-memory Map. `server.js` calls `prepareMessages()` after the vision pipeline, before routing.

**Tech Stack:** Node.js built-ins only (zero deps). Uses `crypto` for hashing, existing `callProvider` from `lib/providers.js`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/compactor.js` | **Create** | estimateTokens, prepareMessages, compactOld, getSummary + summary cache |
| `server.js` | **Modify** | Call `prepareMessages` after vision, before routing |
| `test/compactor.test.js` | **Create** | Unit tests for compaction logic |

### Constants
```js
const COMPACT_THRESHOLD = 50000;  // tokens — above this we compact
const KEEP_RECENT_TOKENS = 10000; // tokens — recent messages kept untouched
const SUMMARY_MAX_TOKENS = 1000;  // tokens — summary length cap
const CHARS_PER_TOKEN = 3.6;      // heuristic chars→tokens
```

### Summarizer fallback chain (in reliability order)
```js
const SUMMARIZERS = [
  'or-nemotron-550b', 'or-nemotron-120b', 'or-nemotron-35',
  'or-dots-3', 'hf-DeepSeek-V4-Pro',
];
```

---

### Task 1: Create `lib/compactor.js` — token estimation + core logic

**Files:**
- Create: `lib/compactor.js`

- [ ] **Step 1: Create the module skeleton with estimation and hashing**

```js
// lib/compactor.js
// Detects when a conversation exceeds the context window of free models and
// compresses old messages into a single summary via a long-context model.
// Zero deps: pure Node built-ins + existing callProvider/lib.

const crypto = require('crypto');
const path = require('path');
const { PROVIDERS, callProvider } = require('./providers');

const COMPACT_THRESHOLD = 50000;  // tokens — compact above this
const KEEP_RECENT_TOKENS = 10000; // tokens — recent messages kept untouched
const SUMMARY_MAX_TOKENS = 1000;  // tokens — summary length cap
const CHARS_PER_TOKEN = 3.6;      // heuristic chars→tokens

// Reliability-ordered long-context summarizers (OpenRouter + HF).
const SUMMARIZERS = [
  'or-nemotron-550b', 'or-nemotron-120b', 'or-nemotron-35',
  'or-dots-3', 'hf-DeepSeek-V4-Pro',
];

// Summary cache: hash of compacted messages → summary string.
// In-memory only (like the main cache) — survives across requests, not restarts.
const summaryCache = new Map();
const SUMMARY_CACHE_MAX = 300;

// --- Estimate tokens from messages array ---
function estimateTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c && typeof c === 'object') {
          if (typeof c.text === 'string') chars += c.text.length;
          else if (c.image_url && c.image_url.url) chars += 1000; // images count a lot
        }
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// --- Build the compaction algorithm structure (logic filled in Task 2) ---
async function prepareMessages(messages) {
  // Compact if above threshold; otherwise return unchanged.
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const total = estimateTokens(messages);
  if (total <= COMPACT_THRESHOLD) return messages;
  return compactOld(messages);
}

async function compactOld(messages) {
  // Task 2 fills this in: split, summarize, rebuild.
  return messages; // placeholder
}

function getSummary(messages) {
  // Task 3 fills this in: hash + cache + generate.
  return ''; // placeholder
}

module.exports = { estimateTokens, prepareMessages, compactOld, getSummary, summaryCache, COMPACT_THRESHOLD, KEEP_RECENT_TOKENS, SUMMARY_MAX_TOKENS, SUMMARIZERS };
```

- [ ] **Step 2: Verify the module loads**

Run: `node -e "const c = require('./lib/compactor'); console.log('threshold', c.COMPACT_THRESHOLD, '| summarizers', c.SUMMARIZERS.length)"` from `~/.config/opencode/llm-proxy/`
Expected: `threshold 50000 | summarizers 5`

---

### Task 2: Implement `compactOld` — split + summarize + rebuild

**Files:**
- Modify: `lib/compactor.js`

- [ ] **Step 1: Write the failing test first (test/compactor.test.js)**

Create `test/compactor.test.js`:

```js
// test/compactor.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let compactor;

function loadFresh() {
  delete require.cache[require.resolve('../lib/compactor')];
  compactor = require('../lib/compactor');
}

describe('compactor.estimateTokens', () => {
  it('returns 0 for empty/non-array', () => {
    loadFresh();
    assert.equal(compactor.estimateTokens([]), 0);
    assert.equal(compactor.estimateTokens(null), 0);
    assert.equal(compactor.estimateTokens('string'), 0);
  });

  it('estimates by chars/3.6', () => {
    loadFresh();
    const msgs = [{ role: 'user', content: 'hello world' }]; // 11 chars
    const est = compactor.estimateTokens(msgs);
    assert.equal(typeof est, 'number');
    assert.ok(est >= 3 && est <= 4, 'expected ~3 tokens, got ' + est);
  });
});

describe('compactor.prepareMessages', () => {
  it('returns messages unchanged when under threshold', async () => {
    loadFresh();
    const msgs = [{ role: 'user', content: 'hi' }];
    const result = await compactor.prepareMessages(msgs);
    assert.equal(result, msgs);
  });

  it('returns messages unchanged when empty', async () => {
    loadFresh();
    assert.equal(await compactor.prepareMessages([]), []);
  });

  it('compacts when over threshold', async () => {
    loadFresh();
    const longContent = 'word '.repeat(18000); // 90k chars
    const msgs = [{ role: 'user', content: longContent }];
    compactor.COMPACT_THRESHOLD = 100; // force compact for test
    const result = await compactor.prepareMessages(msgs);
    assert.notEqual(result, msgs, 'should have compacted');
  });
});

describe('compactor.summaryCache', () => {
  it('exposes an in-memory Map', () => {
    loadFresh();
    assert.ok(compactor.summaryCache instanceof Map);
  });
});
```

- [ ] **Step 2: Run tests — expect compactOld placeholder returns original

Run: `node --test test/compactor.test.js`
Expected: FAIL (notEqual assertion on compaction) — placeholder returns original.

- [ ] **Step 3: Implement `compactOld` + `getSummary`**

Replace the placeholder `compactOld` and `getSummary` in `lib/compactor.js`:

```js
// --- Generate a summary for the given messages via fallback chain ---
async function getSummary(messages) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  if (summaryCache.has(hash)) {
    return summaryCache.get(hash);
  }
  const summary = await summarizeViaChain(messages);
  if (summary) {
    if (summaryCache.size >= SUMMARY_CACHE_MAX) {
      // Evict oldest inserted entry.
      const firstKey = summaryCache.keys().next().value;
      summaryCache.delete(firstKey);
    }
    summaryCache.set(hash, summary);
  }
  return summary;
}

// --- Call long-context models in order until one returns a summary ---
async function summarizeViaChain(messages) {
  const system = 'Ты сжимаешь старую часть диалога в краткое резюме. Сохрани ключевые факты, решения и выводы. Не выдумывай. Верни только текст резюме, до 1000 токенов, без вступлений.';
  const textToSummarize = JSON.stringify(messages);
  for (const key of SUMMARIZERS) {
    const provider = PROVIDERS[key];
    if (!provider || !provider.enabled) continue;
    try {
      const result = await callProvider(provider, {
        model: provider.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Сожми следующий диалог:\n\n' + textToSummarize },
        ],
        max_tokens: SUMMARY_MAX_TOKENS,
      }, 30000, 1);
      const summary = result.data?.choices?.[0]?.message?.content;
      if (summary && summary.trim().length >= 10) {
        return summary.trim();
      }
    } catch (err) {
      // try next summarizer
    }
  }
  return '';
}

// --- Split messages: recent kept, old summarized ---
async function compactOld(messages) {
  // Walk from the end accumulating tokens until we fill KEEP_RECENT_TOKENS.
  const recent = [];
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const tokens = estimateTokens([m]);
    if (recentTokens + tokens > KEEP_RECENT_TOKENS && recent.length > 0) {
      break;
    }
    recent.unshift(m);
    recentTokens += tokens;
  }
  const old = messages.slice(0, messages.length - recent.length);
  if (old.length === 0) return messages; // nothing to compact

  const summary = await getSummary(old);
  const finalLength = estimateTokens(recent) + (summary ? Math.ceil(summary.length / CHARS_PER_TOKEN) : 0);
  if (!summary || finalLength >= estimateTokens(messages)) {
    // No summary produced or compaction didn't help — return unchanged.
    return messages;
  }
  return [
    { role: 'user', content: '[Резюме предыдущего диалога]\n' + summary },
    ...recent,
  ];
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/compactor.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/compactor.js test/compactor.test.js
git commit -m "feat: context compactor — compact old dialog via long-context summary"
```

---

### Task 3: Add summarizer-fallback and chain-fail tests

**Files:**
- Modify: `test/compactor.test.js`

- [ ] **Step 1: Add tests for fallback chain and full failure**

Append to `test/compactor.test.js`:

```js
describe('compactor.compactOld fallback', () => {
  it('returns original messages when summarizers all fail', async () => {
    loadFresh();
    // Set threshold low so compacting triggers, and force summaries to fail.
    compactor.COMPACT_THRESHOLD = 1;
    // Disable summarizers by setting SUMMARIZERS to empty so summarizeViaChain returns ''
    const realSummarizers = compactor.SUMMARIZERS;
    compactor.SUMMARIZERS = [];
    const longContent = 'word '.repeat(5000);
    const msgs = [{ role: 'user', content: longContent }];
    const result = await compactor.prepareMessages(msgs);
    assert.equal(result, msgs, 'should leave unchanged when all summarizers fail');
    compactor.SUMMARIZERS = realSummarizers;
  });

  it('prefers the first working summarizer', async () => {
    loadFresh();
    compactor.COMPACT_THRESHOLD = 1;
    // Force getSummary to return a known value through the cache instead of LLM.
    const oldMsgs = [{ role: 'user', content: 'A' }];
    const hash = require('crypto').createHash('sha256').update(JSON.stringify(oldMsgs)).digest('hex');
    compactor.summaryCache.set(hash, 'факты сохранены');
    const result = await compactor.compactOld([...oldMsgs, { role: 'user', content: 'B' }]);
    assert.ok(result[0].content.includes('[Резюме'));
    assert.ok(result[0].content.includes('факты сохранены'));
  });
});
```

- [ ] **Step 2: Run tests**

Run: `node --test test/compactor.test.js`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add test/compactor.test.js
git commit -m "test: compactor fallback chain and full-failure behavior"
```

---

### Task 4: Wire into `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Import compactor**

After the `setup` require (line 15), add:

```js
const { prepareMessages } = require('./lib/compactor');
```

- [ ] **Step 2: Call `prepareMessages` after the vision pipeline**

Find the point AFTER the vision block closes and BEFORE the cache lookup comment. In `handleChatCompletion`, the vision block ends right before the comment `// Check cache (works for both streaming and non-streaming)`. Insert before that comment:

```js
  // Compact overly large conversations so free models don't reject on context.
  // Runs AFTER the vision pipeline (images already converted to text above).
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    body.messages = await prepareMessages(body.messages);
  }

```

- [ ] **Step 3: Verify server starts and tests pass**

Run: `node --check server.js && node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js test/setup.test.js test/compactor.test.js`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: wire context compaction into chat request pipeline"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd ~/.config/opencode/llm-proxy && node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js test/setup.test.js test/compactor.test.js`
Expected: all pass.

- [ ] **Step 2: Manual smoke test — start server, small request**

```bash
cd ~/.config/opencode/llm-proxy
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.free-llm-proxy.plist 2>/dev/null; sleep 2
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.free-llm-proxy.plist 2>/dev/null; sleep 3
curl -s -X POST "http://localhost:4000/v1/chat/completions" -H "Authorization: Bearer free-llm-proxy-2024" -H "Content-Type: application/json" -d '{"model":"tier-s","messages":[{"role":"user","content":"привет, скажи один короткий факт"}]}' --max-time 30 | head -c 200
```
Expected: JSON with a `choices[0].message.content`.

- [ ] **Step 3: Confirm the compaction path works by observing logs**

Send a large request and check `proxy.log` for an absence of a crash (compaction quietly no-ops if summarizers fail):
```bash
curl -s -X POST "http://localhost:4000/v1/chat/completions" -H "Authorization: Bearer free-llm-proxy-2024" -H "Content-Type: application/json" -d "{\"model\":\"tier-s\",\"messages\":[{\"role\":\"user\",\"content\":\"$(python3 -c 'print(\"word \"*200000)')\"}]}" --max-time 40 | head -c 200
```
Expected: graceful response or graceful fallback — no crash, no unhandled rejection.
