# Setup Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings page to the Freegate dashboard where users can input, validate, and save API keys for all 9 provider platforms, with step-by-step instructions for obtaining each key.

**Architecture:** New `lib/setup.js` module handles .env read/write and key validation. New `/v1/setup/*` API routes in `server.js`. Settings tab added to the inline HTML dashboard in `lib/dashboard.js`. Instructions stored as a static map in `lib/setup.js` (not in providers.json to avoid bloating it).

**Tech Stack:** Node.js built-ins only (zero deps). Vanilla JS in browser. No frameworks.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/setup.js` | **Create** | .env read/write, key validation, instruction data |
| `lib/dashboard.js` | **Modify** | Add Settings tab UI (inputs + instructions + save) |
| `server.js` | **Modify** | Add `/v1/setup/keys` GET/POST, `/v1/setup/validate` GET routes |
| `test/setup.test.js` | **Create** | Tests for .env read/write and key validation |

---

## Key Groups (9 unique API keys)

Each key unlocks multiple providers:

| Key Name | Env Var | Providers Unlocked | Setup URL |
|----------|---------|-------------------|-----------|
| Groq | `PROVIDER_GROQ_APIKEY` | groq-gpt, groq-qwen, groq-allam, groq-compound | console.groq.com |
| Mistral | `PROVIDER_MISTRAL_APIKEY` | mistral-codestral, mistral-small | console.mistral.ai |
| Google Gemini | `PROVIDER_GEMINI_APIKEY` | gemini-flash, gemini-vision | aistudio.google.com |
| NVIDIA NIM | `PROVIDER_NIM_APIKEY` | nim-deepseek, nim-llama, nim-vision | build.nvidia.com |
| ZAI (BigModel) | `PROVIDER_ZAI_APIKEY` | zai | open.bigmodel.cn |
| OpenRouter | `PROVIDER_OPENROUTER_APIKEY` | openrouter-hermes, openrouter-mistral, or-nemotron-550b, or-nemotron-120b, or-gpt-oss-20b, or-ox-alpha, or-nemotron-35, or-laguna-s, or-dots-3, or-lfm, or-laguna-xs, or-nemotron-3-nano-omni-30b-a3b-r, or-minimax-m3-free, or-minimax-m2-7-free, or-gemma-4-31b-it-free | openrouter.ai |
| Cerebras | `PROVIDER_CEREBRAS_APIKEY` | cerebras-gpt, cerebras-gemma | cloud.cerebras.ai |
| DeepSeek | `PROVIDER_DEEPSEEK_APIKEY` | deepseek, deepseek-vision | platform.deepseek.com |
| HuggingFace | `PROVIDER_HF_APIKEY` | hf-Qwen3-8-2-4T-A95B, hf-GLM-5-2, hf-gemma-4-31B-it, hf-DeepSeek-V4-Pro, hf-gemma-4-26B-A4B-it, hf-Llama-3-1-8B-Instruct, hf-DeepSeek-V4-Flash | huggingface.co |

---

### Task 1: Create `lib/setup.js` — env read/write + instructions

**Files:**
- Create: `lib/setup.js`

- [ ] **Step 1: Create the setup module with instruction data and .env read/write**

```js
// lib/setup.js
// Handles .env key reading, writing, and validation for the setup dashboard.

const fs = require('fs');
const path = require('path');

// --- Setup instructions for each key group ---
const KEY_GROUPS = {
  PROVIDER_GROQ_APIKEY: {
    name: 'Groq',
    url: 'https://console.groq.com/keys',
    description: 'Быстрый инференс: GPT-OSS-120B, Qwen 3.6, Allam-2. Бесплатно, без кредитки.',
    steps: [
      'Зайди на console.groq.com и войди через Google/GitHub',
      'Нажми "Create API Key"',
      'Скопируй ключ (начинается на gsk_)',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_MISTRAL_APIKEY: {
    name: 'Mistral',
    url: 'https://console.mistral.ai/keys',
    description: 'Codestral (кодинг) + Mistral Small. Бесплатно, без кредитки.',
    steps: [
      'Зайди на console.mistral.ai и войди через Google/GitHub',
      'Перейди в раздел API Keys',
      'Нажми "Create new API key"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_GEMINI_APIKEY: {
    name: 'Google Gemini',
    url: 'https://aistudio.google.com/apikey',
    description: 'Gemini 3.6 Flash + Vision. Бесплатно, 1500 req/день.',
    steps: [
      'Зайди на aistudio.google.com',
      'Нажми "Get API key" (левое меню)',
      'Создай ключ в любом Google-проекте',
      'Скопируй ключ (AIza...)',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_NIM_APIKEY: {
    name: 'NVIDIA NIM',
    url: 'https://build.nvidia.com/settings/api-key',
    description: 'DeepSeek V4 Flash, Llama 3.1, Vision. 40 req/день бесплатно.',
    steps: [
      'Зайди на build.nvidia.com и войди через Google/GitHub',
      'Перейди в Settings → API Keys',
      'Нажми "Generate Key"',
      'Скопируй ключ (nvapi-...)',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_ZAI_APIKEY: {
    name: 'ZAI (BigModel)',
    url: 'https://open.bigmodel.cn/usercenter/apikeys',
    description: 'GLM-4.7 Flash. Бесплатно, китайский провайдер.',
    steps: [
      'Зайди на open.bigmodel.cn и зарегистрируйся',
      'Перейди в API Keys',
      'Нажми "Создать ключ"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_OPENROUTER_APIKEY: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/keys',
    description: '15+ бесплатных моделей: Nemotron, Ox Alpha, Gemma, MiniMax. Универсальный провайдер.',
    steps: [
      'Зайди на openrouter.ai и войди через Google/GitHub',
      'Перейди в раздел Keys (левое меню)',
      'Нажми "Create Key"',
      'Скопируй ключ (sk-or-...)',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_CEREBRAS_APIKEY: {
    name: 'Cerebras',
    url: 'https://cloud.cerebras.ai/overview',
    description: 'GPT-OSS-120B + Gemma-4-31B. Очень быстрый инференс, бесплатно.',
    steps: [
      'Зайди на cloud.cerebras.ai и войди через Google/GitHub',
      'Перейди в API Keys (левое меню)',
      'Нажми "Create API Key"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_DEEPSEEK_APIKEY: {
    name: 'DeepSeek',
    url: 'https://platform.deepseek.com/api_keys',
    description: 'DeepSeek V4 Flash + Vision. Бесплатно (新开户赠送额度).',
    steps: [
      'Зайди на platform.deepseek.com и зарегистрируйся',
      'Перейди в раздел API Keys',
      'Нажми "Создать ключ"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
  },
  PROVIDER_HF_APIKEY: {
    name: 'HuggingFace',
    url: 'https://huggingface.co/settings/tokens',
    description: '7+ моделей: Qwen3.8, DeepSeek V4, Gemma-4, GLM-5.2. Бесплатно, 200 req/день.',
    steps: [
      'Зайди на huggingface.co и зарегистрируйся',
      'Перейди в Settings → Access Tokens',
      'Нажми "New token" → тип "Read"',
      'Скопируй ключ (hf_...)',
      'Вставь в поле ниже',
    ],
  },
};

// --- .env file path resolution (mirrors lib/providers.js logic) ---
function getEnvPath() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

// --- Read current keys from .env (returns { ENV_VAR: 'value' }) ---
function readKeys() {
  const envPath = getEnvPath();
  const keys = {};
  // Initialize all known keys as empty
  for (const envVar of Object.keys(KEY_GROUPS)) {
    keys[envVar] = '';
  }
  if (!fs.existsSync(envPath)) return { keys, envPath };
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim();
    if (keys.hasOwnProperty(k)) {
      keys[k] = v;
    }
  }
  return { keys, envPath };
}

// --- Save keys to .env (upsert, preserves other vars) ---
function saveKeys(newKeys) {
  const envPath = getEnvPath();
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf8').split('\n');
  }
  const existingKeys = new Set();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    if (newKeys.hasOwnProperty(k)) {
      lines[i] = `${k}=${newKeys[k]}`;
      existingKeys.add(k);
    }
  }
  // Append new keys that weren't in the file
  for (const [k, v] of Object.entries(newKeys)) {
    if (!existingKeys.has(k) && v) {
      lines.push(`${k}=${v}`);
    }
  }
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
  return { envPath, saved: Object.keys(newKeys).filter((k) => newKeys[k]) };
}

// --- Validate a key by calling the provider's /models endpoint ---
async function validateKey(envVar, apiKey) {
  const group = KEY_GROUPS[envVar];
  if (!group) return { valid: false, error: 'Unknown key group' };

  // Map env var to a test endpoint
  const testEndpoints = {
    PROVIDER_GROQ_APIKEY: 'https://api.groq.com/openai/v1/models',
    PROVIDER_MISTRAL_APIKEY: 'https://api.mistral.ai/v1/models',
    PROVIDER_GEMINI_APIKEY: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    PROVIDER_NIM_APIKEY: 'https://integrate.api.nvidia.com/v1/models',
    PROVIDER_ZAI_APIKEY: 'https://open.bigmodel.cn/api/paas/v4/models',
    PROVIDER_OPENROUTER_APIKEY: 'https://openrouter.ai/api/v1/models',
    PROVIDER_CEREBRAS_APIKEY: 'https://api.cerebras.ai/v1/models',
    PROVIDER_DEEPSEEK_APIKEY: 'https://api.deepseek.com/models',
    PROVIDER_HF_APIKEY: 'https://router.huggingface.co/v1/models',
  };

  const url = testEndpoints[envVar];
  if (!url) return { valid: false, error: 'No test endpoint' };

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, error: 'Неверный ключ (HTTP ' + res.status + ')' };
    return { valid: false, error: 'HTTP ' + res.status };
  } catch (err) {
    return { valid: false, error: err.message.slice(0, 100) };
  }
}

module.exports = { KEY_GROUPS, readKeys, saveKeys, validateKey, getEnvPath };
```

- [ ] **Step 2: Verify the module loads without errors**

Run: `node -e "const s = require('./lib/setup.js'); console.log(Object.keys(s.KEY_GROUPS).length, 'key groups'); const {keys} = s.readKeys(); console.log(Object.keys(keys).length, 'keys read')"` from `~/.config/opencode/llm-proxy/`
Expected: `9 key groups` and `9 keys read`

---

### Task 2: Add setup API routes to `server.js`

**Files:**
- Modify: `server.js:1-14` (imports)
- Modify: `server.js:892-893` (before 404 handler)

- [ ] **Step 1: Add setup require to server.js imports**

After line 13 (`const logger = require('./lib/logger');`), add:
```js
const { KEY_GROUPS, readKeys, saveKeys, validateKey } = require('./lib/setup');
```

- [ ] **Step 2: Add GET /v1/setup/keys route**

Before the 404 handler (line 892), add:
```js
  // --- Setup Dashboard API ---
  if (parsedUrl.pathname === '/v1/setup/keys' && req.method === 'GET') {
    const { keys } = readKeys();
    // Mask keys: show first 4 + last 4 chars, mask middle
    const masked = {};
    for (const [k, v] of Object.entries(keys)) {
      if (!v) { masked[k] = ''; continue; }
      if (v.length <= 10) { masked[k] = v.slice(0, 2) + '***' + v.slice(-2); continue; }
      masked[k] = v.slice(0, 4) + '***' + v.slice(-4);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ groups: KEY_GROUPS, keys: masked }));
    return;
  }
```

- [ ] **Step 3: Add POST /v1/setup/keys route (save keys)**

Right after the GET route:
```js
  if (parsedUrl.pathname === '/v1/setup/keys' && req.method === 'POST') {
    if (AUTH_KEY) {
      const apiKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const keyFromQuery = parsedUrl.searchParams.get('key');
      if (apiKey !== AUTH_KEY && keyFromQuery !== AUTH_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
    }
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try {
        const newKeys = JSON.parse(body);
        // Only accept known env vars
        const filtered = {};
        for (const k of Object.keys(KEY_GROUPS)) {
          if (typeof newKeys[k] === 'string') filtered[k] = newKeys[k];
        }
        const result = saveKeys(filtered);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid request: ' + e.message } }));
      }
    });
    return;
  }
```

- [ ] **Step 4: Add GET /v1/setup/validate route**

Right after the POST route:
```js
  if (parsedUrl.pathname === '/v1/setup/validate') {
    if (AUTH_KEY) {
      const apiKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const keyFromQuery = parsedUrl.searchParams.get('key');
      if (apiKey !== AUTH_KEY && keyFromQuery !== AUTH_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
    }
    const envVar = parsedUrl.searchParams.get('envVar');
    const testKey = parsedUrl.searchParams.get('apiKey');
    if (!envVar || !testKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'envVar and apiKey required' } }));
      return;
    }
    validateKey(envVar, testKey).then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }
```

- [ ] **Step 5: Verify server starts without errors**

Run: `cd ~/.config/opencode/llm-proxy && timeout 5 node server.js 2>&1 || true`
Expected: `Dashboard: http://localhost:4000/` in output, no crashes.

---

### Task 3: Add Settings tab to dashboard HTML

**Files:**
- Modify: `lib/dashboard.js:2-171` (HTML template)

- [ ] **Step 1: Add Settings tab CSS and nav**

In the `<style>` block (after line 29), add:
```css
    .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab { padding: 8px 16px; border-radius: 6px; cursor: pointer; background: #16213e; color: #888; border: 1px solid #0f3460; font-size: 13px; }
    .tab.active { color: #00d4ff; border-color: #00d4ff; }
    .tab:hover { color: #ccc; }
    .setup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 16px; }
    .key-card { background: #16213e; border-radius: 8px; padding: 16px; border: 1px solid #0f3460; }
    .key-card h3 { color: #00d4ff; font-size: 14px; margin-bottom: 8px; }
    .key-card .desc { color: #888; font-size: 12px; margin-bottom: 10px; }
    .key-card ol { color: #aaa; font-size: 11px; padding-left: 18px; margin-bottom: 10px; }
    .key-card li { margin-bottom: 4px; }
    .key-card a { color: #00d4ff; text-decoration: none; }
    .key-card a:hover { text-decoration: underline; }
    .key-input-row { display: flex; gap: 8px; align-items: center; }
    .key-input { flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #0f3460; background: #0a0a1a; color: #fff; font-size: 12px; font-family: monospace; }
    .btn { padding: 8px 14px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px; font-weight: bold; }
    .btn-validate { background: #0f3460; color: #00d4ff; }
    .btn-validate:hover { background: #1a4a7a; }
    .btn-save { background: #00d4ff; color: #000; }
    .btn-save:hover { background: #00b8d4; }
    .btn-test-all { background: #0f3460; color: #00ff88; margin-bottom: 16px; }
    .status-ok { color: #00ff88; font-size: 11px; }
    .status-err { color: #ff4444; font-size: 11px; }
    .status-wait { color: #888; font-size: 11px; }
    .hidden { display: none; }
```

- [ ] **Step 2: Add tab navigation and Settings panel**

Replace line 33 (`<h1>Freegate — Панель управления</h1>`) with:
```html
  <h1>Freegate — Панель управления</h1>
  <div class="tabs">
    <div class="tab active" onclick="showTab('dashboard')">Dashboard</div>
    <div class="tab" onclick="showTab('setup')">Settings (API Keys)</div>
  </div>
```

After line 46 (closing `</div>` of the grid), before `<div class="refresh">`, add:
```html
  <div id="setup-panel" class="hidden">
    <div style="margin-bottom: 16px;">
      <button class="btn btn-test-all" onclick="validateAll()">Проверить все ключи</button>
      <button class="btn btn-save" onclick="saveAllKeys()" style="margin-left: 8px;">Сохранить все ключи</button>
      <span id="save-status" class="status-wait" style="margin-left: 12px;"></span>
    </div>
    <div id="setup-grid" class="setup-grid">Загрузка...</div>
  </div>
```

- [ ] **Step 3: Add Settings JavaScript**

In the `<script>` block, after `setInterval(refresh, 5000);` (line 168), add:
```js
    // --- Setup Dashboard ---
    let _setupData = null;

    function showTab(tab) {
      document.querySelectorAll('.tab').forEach((t, i) => {
        t.classList.toggle('active', (i === 0 && tab === 'dashboard') || (i === 1 && tab === 'setup'));
      });
      document.querySelector('.grid').classList.toggle('hidden', tab !== 'dashboard');
      document.querySelector('.refresh').classList.toggle('hidden', tab !== 'dashboard');
      document.getElementById('setup-panel').classList.toggle('hidden', tab !== 'setup');
      if (tab === 'setup' && !_setupData) loadSetup();
    }

    async function loadSetup() {
      try {
        const res = await fetch(_api('/v1/setup/keys'));
        _setupData = await res.json();
        renderSetup(_setupData);
      } catch (e) { console.error('Setup load error:', e); }
    }

    function renderSetup(data) {
      const grid = document.getElementById('setup-grid');
      let html = '';
      for (const [envVar, info] of Object.entries(data.groups)) {
        const currentVal = data.keys[envVar] || '';
        const stepsHtml = info.steps.map((s) => '<li>' + s + '</li>').join('');
        html += '<div class="key-card" id="card-' + envVar + '">';
        html += '<h3>' + info.name + '</h3>';
        html += '<div class="desc">' + info.description + '</div>';
        html += '<ol>' + stepsHtml + '</ol>';
        html += '<div class="key-input-row">';
        html += '<input class="key-input" id="input-' + envVar + '" type="password" placeholder="Вставь API ключ..." value="' + currentVal + '" autocomplete="off">';
        html += '<button class="btn btn-validate" onclick="validateKey(\'' + envVar + '\')">Проверить</button>';
        html += '</div>';
        html += '<div id="status-' + envVar + '" class="status-wait" style="margin-top: 6px;">' + (currentVal ? 'ключ установлен' : 'не задан') + '</div>';
        html += '<a href="' + info.url + '" target="_blank" style="font-size: 11px;">' + info.url + '</a>';
        html += '</div>';
      }
      grid.innerHTML = html;
    }

    async function validateKey(envVar) {
      const input = document.getElementById('input-' + envVar);
      const status = document.getElementById('status-' + envVar);
      const key = input.value.trim();
      if (!key) { status.className = 'status-err'; status.textContent = 'Введите ключ'; return; }
      status.className = 'status-wait'; status.textContent = 'Проверка...';
      try {
        const res = await fetch(_api('/v1/setup/validate?envVar=' + encodeURIComponent(envVar) + '&apiKey=' + encodeURIComponent(key)));
        const result = await res.json();
        if (result.valid) {
          status.className = 'status-ok'; status.textContent = 'Ключ валиден';
        } else {
          status.className = 'status-err'; status.textContent = result.error || 'Неверный ключ';
        }
      } catch (e) {
        status.className = 'status-err'; status.textContent = 'Ошибка проверки: ' + e.message;
      }
    }

    async function validateAll() {
      for (const envVar of Object.keys(_setupData.groups)) {
        const input = document.getElementById('input-' + envVar);
        if (input && input.value.trim()) {
          await validateKey(envVar);
        }
      }
    }

    async function saveAllKeys() {
      const status = document.getElementById('save-status');
      status.className = 'status-wait'; status.textContent = 'Сохранение...';
      const keys = {};
      for (const envVar of Object.keys(_setupData.groups)) {
        const input = document.getElementById('input-' + envVar);
        if (input) keys[envVar] = input.value.trim();
      }
      try {
        const res = await fetch(_api('/v1/setup/keys'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(keys),
        });
        const result = await res.json();
        if (result.ok) {
          status.className = 'status-ok'; status.textContent = 'Сохранено! Перезапусти Freegate для применения.';
        } else {
          status.className = 'status-err'; status.textContent = result.error || 'Ошибка сохранения';
        }
      } catch (e) {
        status.className = 'status-err'; status.textContent = 'Ошибка: ' + e.message;
      }
    }
```

- [ ] **Step 4: Verify dashboard loads in browser**

Start the proxy and open `http://localhost:4000/` → verify the "Settings (API Keys)" tab appears, shows all 9 key groups with instructions and input fields.

---

### Task 4: Tests for setup module

**Files:**
- Create: `test/setup.test.js`

- [ ] **Step 1: Write tests**

```js
// test/setup.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test with a temp .env file
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freegate-setup-test-'));
const TMP_ENV = path.join(TMP_DIR, '.env');

// Override getEnvPath for testing
let setup;
function loadSetup() {
  // Clear require cache
  delete require.cache[require.resolve('../lib/setup')];
  setup = require('../lib/setup');
  // Patch getEnvPath to use our temp file
  setup.getEnvPath = () => TMP_ENV;
}

describe('setup.readKeys', () => {
  it('returns empty keys when .env does not exist', () => {
    fs.rmSync(TMP_ENV, { force: true });
    loadSetup();
    const { keys } = setup.readKeys();
    assert.equal(typeof keys, 'object');
    assert.equal(Object.keys(keys).length, 9);
    for (const v of Object.values(keys)) {
      assert.equal(v, '');
    }
  });

  it('reads keys from .env file', () => {
    fs.writeFileSync(TMP_ENV, 'PROVIDER_GROQ_APIKEY=gsk_test123\nPROVIDER_MISTRAL_APIKEY=ms_test456\nOTHER_VAR=ignored\n');
    loadSetup();
    const { keys } = setup.readKeys();
    assert.equal(keys.PROVIDER_GROQ_APIKEY, 'gsk_test123');
    assert.equal(keys.PROVIDER_MISTRAL_APIKEY, 'ms_test456');
    assert.equal(keys.PROVIDER_GEMINI_APIKEY, '');
  });

  it('skips comments and blank lines', () => {
    fs.writeFileSync(TMP_ENV, '# comment\n\nPROVIDER_GROQ_APIKEY=gsk_abc\n\n# another comment\n');
    loadSetup();
    const { keys } = setup.readKeys();
    assert.equal(keys.PROVIDER_GROQ_APIKEY, 'gsk_abc');
  });
});

describe('setup.saveKeys', () => {
  it('creates .env with new keys', () => {
    fs.rmSync(TMP_ENV, { force: true });
    loadSetup();
    const result = setup.saveKeys({ PROVIDER_GROQ_APIKEY: 'gsk_new', PROVIDER_MISTRAL_APIKEY: 'ms_new' });
    assert.ok(result.saved.includes('PROVIDER_GROQ_APIKEY'));
    const content = fs.readFileSync(TMP_ENV, 'utf8');
    assert.ok(content.includes('PROVIDER_GROQ_APIKEY=gsk_new'));
    assert.ok(content.includes('PROVIDER_MISTRAL_APIKEY=ms_new'));
  });

  it('updates existing keys in .env', () => {
    fs.writeFileSync(TMP_ENV, 'PROVIDER_GROQ_APIKEY=old_value\nOTHER=keep\n');
    loadSetup();
    setup.saveKeys({ PROVIDER_GROQ_APIKEY: 'new_value' });
    const content = fs.readFileSync(TMP_ENV, 'utf8');
    assert.ok(content.includes('PROVIDER_GROQ_APIKEY=new_value'));
    assert.ok(!content.includes('old_value'));
    assert.ok(content.includes('OTHER=keep'));
  });

  it('does not write empty keys', () => {
    fs.writeFileSync(TMP_ENV, 'EXISTING=val\n');
    loadSetup();
    setup.saveKeys({ PROVIDER_GROQ_APIKEY: '' });
    const content = fs.readFileSync(TMP_ENV, 'utf8');
    assert.ok(!content.includes('PROVIDER_GROQ_APIKEY'));
  });
});

describe('setup.KEY_GROUPS', () => {
  it('has 9 key groups', () => {
    loadSetup();
    assert.equal(Object.keys(setup.KEY_GROUPS).length, 9);
  });

  it('each group has name, url, description, steps', () => {
    loadSetup();
    for (const [envVar, group] of Object.entries(setup.KEY_GROUPS)) {
      assert.ok(group.name, `${envVar} missing name`);
      assert.ok(group.url, `${envVar} missing url`);
      assert.ok(group.description, `${envVar} missing description`);
      assert.ok(Array.isArray(group.steps) && group.steps.length >= 3, `${envVar} missing steps`);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd ~/.config/opencode/llm-proxy && node --test test/setup.test.js`
Expected: all tests pass

- [ ] **Step 3: Run full test suite to ensure no regressions**

Run: `cd ~/.config/opencode/llm-proxy && node --test --test-concurrency=1 test/proxy.test.js test/clean.test.js test/routing.test.js test/normalize.test.js test/bandit.test.js test/setup.test.js`
Expected: all tests pass

---

### Task 5: Final verification

- [ ] **Step 1: Start the proxy and verify dashboard**

Run: `cd ~/.config/opencode/llm-proxy && node server.js`
Open `http://localhost:4000/` in browser:
- Dashboard tab shows existing data (providers, stats, cache, etc.)
- Settings tab shows 9 key cards with instructions
- Input fields show masked existing keys
- "Проверить" button validates a key
- "Сохранить" button writes to .env

- [ ] **Step 2: Verify API routes**

```bash
# Read keys
curl http://localhost:4000/v1/setup/keys | jq '.groups | keys'

# Save a test key
curl -X POST http://localhost:4000/v1/setup/keys \
  -H 'Content-Type: application/json' \
  -d '{"PROVIDER_GROQ_APIKEY":"test"}' | jq

# Validate (should fail with test key)
curl 'http://localhost:4000/v1/setup/validate?envVar=PROVIDER_GROQ_APIKEY&apiKey=test' | jq
```

- [ ] **Step 3: Clean up test**

Stop the proxy (Ctrl+C). Remove test key from .env if needed.
