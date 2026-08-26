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
  const envPath = module.exports.getEnvPath();
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
  const envPath = module.exports.getEnvPath();
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
