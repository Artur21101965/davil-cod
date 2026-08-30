// lib/setup.js
// Handles .env key reading, writing, and validation for the setup dashboard.

const fs = require('fs');
const path = require('path');

// --- Setup instructions for each key group ---
const KEY_GROUPS = {
  PROVIDER_GROQ_APIKEY: {
    name: 'Groq',
    name_en: 'Groq',
    url: 'https://console.groq.com/keys',
    description: 'Быстрый инференс: GPT-OSS-120B, Qwen 3.6, Allam-2. Бесплатно, без кредитки.',
    description_en: 'Fast inference: GPT-OSS-120B, Qwen 3.6, Allam-2. Free, no credit card.',
    steps: [
      'Зайди на console.groq.com и войди через Google/GitHub',
      'Нажми "Create API Key"',
      'Скопируй ключ (начинается на gsk_)',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to console.groq.com and sign in with Google/GitHub',
      'Click "Create API Key"',
      'Copy the key (starts with gsk_)',
      'Paste it into the field below',
    ],
  },
  PROVIDER_MISTRAL_APIKEY: {
    name: 'Mistral',
    name_en: 'Mistral',
    url: 'https://console.mistral.ai/keys',
    description: 'Codestral (кодинг) + Mistral Small. Бесплатно, без кредитки.',
    description_en: 'Codestral (coding) + Mistral Small. Free, no credit card.',
    steps: [
      'Зайди на console.mistral.ai и войди через Google/GitHub',
      'Перейди в раздел API Keys',
      'Нажми "Create new API key"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to console.mistral.ai and sign in with Google/GitHub',
      'Go to the API Keys section',
      'Click "Create new API key"',
      'Copy the key',
      'Paste it into the field below',
    ],
  },
  PROVIDER_GEMINI_APIKEY: {
    name: 'Google Gemini',
    name_en: 'Google Gemini',
    url: 'https://aistudio.google.com/apikey',
    description: 'Gemini 3.6 Flash + Vision. Бесплатно, 1500 req/день.',
    description_en: 'Gemini 3.6 Flash + Vision. Free, 1500 req/day.',
    steps: [
      'Зайди на aistudio.google.com',
      'Нажми "Get API key" (левое меню)',
      'Создай ключ в любом Google-проекте',
      'Скопируй ключ (AIza...)',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to aistudio.google.com',
      'Click "Get API key" (left menu)',
      'Create a key in any Google project',
      'Copy the key (AIza...)',
      'Paste it into the field below',
    ],
  },
  PROVIDER_NIM_APIKEY: {
    name: 'NVIDIA NIM',
    name_en: 'NVIDIA NIM',
    url: 'https://build.nvidia.com/settings/api-key',
    description: 'DeepSeek V4 Flash, Llama 3.1, Vision. 40 req/день бесплатно.',
    description_en: 'DeepSeek V4 Flash, Llama 3.1, Vision. 40 req/day free.',
    steps: [
      'Зайди на build.nvidia.com и войди через Google/GitHub',
      'Перейди в Settings → API Keys',
      'Нажми "Generate Key"',
      'Скопируй ключ (nvapi-...)',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to build.nvidia.com and sign in with Google/GitHub',
      'Go to Settings → API Keys',
      'Click "Generate Key"',
      'Copy the key (nvapi-...)',
      'Paste it into the field below',
    ],
  },
  PROVIDER_ZAI_APIKEY: {
    name: 'ZAI (BigModel)',
    name_en: 'ZAI (BigModel)',
    url: 'https://open.bigmodel.cn/usercenter/apikeys',
    description: 'GLM-4.7 Flash. Бесплатно, китайский провайдер.',
    description_en: 'GLM-4.7 Flash. Free, Chinese provider.',
    steps: [
      'Зайди на open.bigmodel.cn и зарегистрируйся',
      'Перейди в API Keys',
      'Нажми "Создать ключ"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to open.bigmodel.cn and register',
      'Go to API Keys',
      'Click "Create key"',
      'Copy the key',
      'Paste it into the field below',
    ],
  },
  PROVIDER_OPENROUTER_APIKEY: {
    name: 'OpenRouter',
    name_en: 'OpenRouter',
    url: 'https://openrouter.ai/keys',
    description: '15+ бесплатных моделей: Nemotron, Ox Alpha, Gemma, MiniMax. Универсальный провайдер.',
    description_en: '15+ free models: Nemotron, Ox Alpha, Gemma, MiniMax. Universal provider.',
    steps: [
      'Зайди на openrouter.ai и войди через Google/GitHub',
      'Перейди в раздел Keys (левое меню)',
      'Нажми "Create Key"',
      'Скопируй ключ (sk-or-...)',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to openrouter.ai and sign in with Google/GitHub',
      'Go to the Keys section (left menu)',
      'Click "Create Key"',
      'Copy the key (sk-or-...)',
      'Paste it into the field below',
    ],
  },
  PROVIDER_CEREBRAS_APIKEY: {
    name: 'Cerebras',
    name_en: 'Cerebras',
    url: 'https://cloud.cerebras.ai/overview',
    description: 'GPT-OSS-120B + Gemma-4-31B. Очень быстрый инференс, бесплатно.',
    description_en: 'GPT-OSS-120B + Gemma-4-31B. Very fast inference, free.',
    steps: [
      'Зайди на cloud.cerebras.ai и войди через Google/GitHub',
      'Перейди в API Keys (левое меню)',
      'Нажми "Create API Key"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to cloud.cerebras.ai and sign in with Google/GitHub',
      'Go to API Keys (left menu)',
      'Click "Create API Key"',
      'Copy the key',
      'Paste it into the field below',
    ],
  },
  PROVIDER_DEEPSEEK_APIKEY: {
    name: 'DeepSeek',
    name_en: 'DeepSeek',
    url: 'https://platform.deepseek.com/api_keys',
    description: 'DeepSeek V4 Flash + Vision. Бесплатно (新开户赠送额度).',
    description_en: 'DeepSeek V4 Flash + Vision. Free (new-account credit).',
    steps: [
      'Зайди на platform.deepseek.com и зарегистрируйся',
      'Перейди в раздел API Keys',
      'Нажми "Создать ключ"',
      'Скопируй ключ',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to platform.deepseek.com and register',
      'Go to the API Keys section',
      'Click "Create key"',
      'Copy the key',
      'Paste it into the field below',
    ],
  },
  PROVIDER_HF_APIKEY: {
    name: 'HuggingFace',
    name_en: 'HuggingFace',
    url: 'https://huggingface.co/settings/tokens',
    description: '7+ моделей: Qwen3.8, DeepSeek V4, Gemma-4, GLM-5.2. Бесплатно, 200 req/день.',
    description_en: '7+ models: Qwen3.8, DeepSeek V4, Gemma-4, GLM-5.2. Free, 200 req/day.',
    steps: [
      'Зайди на huggingface.co и зарегистрируйся',
      'Перейди в Settings → Access Tokens',
      'Нажми "New token" → тип "Read"',
      'Скопируй ключ (hf_...)',
      'Вставь в поле ниже',
    ],
    steps_en: [
      'Go to huggingface.co and register',
      'Go to Settings → Access Tokens',
      'Click "New token" → type "Read"',
      'Copy the key (hf_...)',
      'Paste it into the field below',
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
      // Пустые значения не затирают существующий ключ — сохраняем старый.
      if (newKeys[k]) {
        lines[i] = `${k}=${newKeys[k]}`;
      }
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

// --- Get the real (unmasked) key from .env by envVar ---
function getStoredKey(envVar) {
  const { keys } = readKeys();
  return keys[envVar] || '';
}

// --- Validate a key by calling the provider's /models endpoint ---
async function validateKey(envVar, apiKey) {
  const group = KEY_GROUPS[envVar];
  if (!group) return { valid: false, error: 'Unknown key group' };

  // Map env var to a test endpoint
  const testEndpoints = {
    PROVIDER_GROQ_APIKEY: 'https://api.groq.com/openai/v1/models',
    PROVIDER_MISTRAL_APIKEY: 'https://api.mistral.ai/v1/models',
    PROVIDER_GEMINI_APIKEY: 'https://generativelanguage.googleapis.com/v1beta/models',
    PROVIDER_NIM_APIKEY: 'https://integrate.api.nvidia.com/v1/models',
    PROVIDER_ZAI_APIKEY: 'https://open.bigmodel.cn/api/paas/v4/models',
    PROVIDER_OPENROUTER_APIKEY: 'https://openrouter.ai/api/v1/models',
    PROVIDER_CEREBRAS_APIKEY: 'https://api.cerebras.ai/v1/models',
    PROVIDER_DEEPSEEK_APIKEY: 'https://api.deepseek.com/models',
    PROVIDER_HF_APIKEY: 'https://router.huggingface.co/v1/models',
  };

  const url = testEndpoints[envVar];
  if (!url) return { valid: false, error: 'No test endpoint' };

  // Gemini uses ?key= query param instead of Bearer token
  const isGemini = envVar === 'PROVIDER_GEMINI_APIKEY';
  const fetchUrl = isGemini ? url + '?key=' + encodeURIComponent(apiKey) : url;
  const headers = isGemini ? {} : { 'Authorization': `Bearer ${apiKey}` };

  try {
    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, error: 'Неверный ключ (HTTP ' + res.status + ')' };
    return { valid: false, error: 'HTTP ' + res.status };
  } catch (err) {
    return { valid: false, error: err.message.slice(0, 100) };
  }
}

module.exports = { KEY_GROUPS, readKeys, saveKeys, validateKey, getEnvPath, getStoredKey };
