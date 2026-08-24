// lib/providers.js
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Load .env if present — prefer cwd (user's project) then package dir
const ENV_CANDIDATES = [path.join(process.cwd(), '.env'), path.join(__dirname, '..', '.env')];
for (const envPath of ENV_CANDIDATES) {
  try {
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
      }
    }
  } catch {}
}

// Config candidates: cwd first (user's project), then package dir
const CONFIG_CANDIDATES = [path.join(process.cwd(), 'config.json'), path.join(__dirname, '..', 'config.json')];
const CONFIG_PATH = CONFIG_CANDIDATES.find(p => fs.existsSync(p)) || CONFIG_CANDIDATES[1];

const PROVIDERS_CATALOG_PATH = path.join(__dirname, '..', 'providers.json');
const DEFAULT_CONFIG = { port: 4000, auth: '', rateLimit: { maxRequests: 100, windowMs: 60000 }, providers: {} };

function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  // 1. Start from the catalog
  try {
    const catalog = JSON.parse(fs.readFileSync(PROVIDERS_CATALOG_PATH, 'utf8'));
    cfg.providers = { ...catalog };
  } catch { /* no catalog — empty providers */ }
  // 2. Overlay user config.json
  try {
    const userCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (userCfg && typeof userCfg === 'object') {
      cfg.port = userCfg.port || cfg.port;
      cfg.auth = userCfg.auth || cfg.auth;
      if (userCfg.rateLimit) cfg.rateLimit = { ...cfg.rateLimit, ...userCfg.rateLimit };
      if (userCfg.providers) {
        for (const [k, v] of Object.entries(userCfg.providers)) {
          if (v.enabled === false) { delete cfg.providers[k]; continue; }
          cfg.providers[k] = { ...(cfg.providers[k] || {}), ...v, key: k };
        }
      }
    }
  } catch (err) {
    console.error(`config.json invalid, using catalog only: ${err.message}`);
  }
  // 3. Default catalog providers to enabled=true (they may lack the field)
  for (const [k, p] of Object.entries(cfg.providers)) {
    if (p.enabled === undefined) p.enabled = true;
  }
  return cfg;
}

const config = loadConfig();
const PROVIDERS = config.providers;

// Add key to each provider from env
for (const [key, provider] of Object.entries(PROVIDERS)) {
  provider.key = key;
  // Honor explicit envVar from the catalog/config first
  const explicitVar = provider.envVar;
  const derivedVar = `PROVIDER_${key.toUpperCase().replace(/-/g, '_')}_APIKEY`;
  const prefix = key.split('-')[0].toUpperCase();
  // Map known prefixes to their real env vars
  const prefixMap = { OR: 'OPENROUTER', NIM: 'NIM', GROQ: 'GROQ', MISTRAL: 'MISTRAL', GEMINI: 'GEMINI', ZAI: 'ZAI' };
  const resolvedPrefix = prefixMap[prefix] || prefix;
  const envKey = process.env[explicitVar] || process.env[derivedVar] || process.env[`PROVIDER_${resolvedPrefix}_APIKEY`];
  if (envKey) provider.apiKey = envKey;
}

const MODEL_MAP = {
  'glm-4.7-flash': 'zai', 'glm-4.5': 'zai', 'glm-4.5-air': 'zai',
  'glm-4.7': 'zai', 'glm-5': 'zai', 'glm-5-turbo': 'zai',
  'deepseek-ai/deepseek-v4-flash-0731': 'nim-deepseek',
  'meta/llama-3.1-8b-instruct': 'nim-llama',
  'openai/gpt-oss-120b': 'groq-gpt', 'qwen/qwen3.6-27b': 'groq-qwen',
  'gemini-3.6-flash': 'gemini-flash',
  'codestral-latest': 'mistral-codestral', 'mistral-small-latest': 'mistral-small',
  'mistral-medium-latest': 'mistral-small', 'mistral-large-latest': 'mistral-small',
  'tier-splus': 'or-ox-alpha', 'tier-s': 'mistral-codestral',
  'tier-a': 'mistral-small', 'tier-b': 'groq-qwen',
  'tier-xl': 'or-nemotron-550b', 'tier-l': 'mistral-codestral',
  'openrouter-hermes': 'openrouter-hermes',
  'openrouter-mistral': 'openrouter-mistral',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 'nim-nemotron',
  'cohere/north-mini-code:free': 'openrouter-hermes',
  'z-ai/glm-5.2:free': 'openrouter-mistral',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'or-nemotron-550b',
  'nvidia/nemotron-3-super-120b-a12b:free': 'or-nemotron-120b',
  'openai/gpt-oss-20b:free': 'or-gpt-oss-20b',
  'stealth/ox-alpha': 'or-ox-alpha',
  'nvidia/nemotron-3.5-lightning:free': 'or-nemotron-35',
  'poolside/laguna-s-2.1:free': 'or-laguna-s',
  'gemini-3.6-flash:vision': 'gemini-vision',
  'meta/llama-3.2-11b-vision-instruct': 'nim-vision',
  'ollama/llama3.2': 'ollama',
  'llama3.2': 'ollama',
  'ollama/qwen2.5:0.5b': 'ollama',
  'qwen2.5:0.5b': 'ollama',
  'lmstudio/local-model': 'lmstudio',
  'dots-studio/dots-3-note-preview:free': 'or-dots-3',
  'liquid/lfm-2.5-2.6b:free': 'or-lfm',
  'poolside/laguna-xs-2.1:free': 'or-laguna-xs',
};

function callProvider(provider, body, timeout = 30000, retries = 1) {
  const isStreaming = body.stream === true;

  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const startTime = Date.now();
      const postData = JSON.stringify(body);
      const url = new URL(provider.endpoint);

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        timeout,
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey ? { 'Authorization': `Bearer ${provider.apiKey}` } : {}),
          'Content-Length': Buffer.byteLength(postData),
          ...(isStreaming ? { 'Accept': 'text/event-stream' } : {}),
        },
      };

      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        const latency = Date.now() - startTime;

        if (res.statusCode !== 200) {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            let errorMsg;
            try {
              const errData = JSON.parse(data);
              errorMsg = errData.error?.message || errData.message || data.slice(0, 200);
            } catch {
              errorMsg = data.slice(0, 200);
            }
            const err = new Error(`${provider.key}: ${res.statusCode} — ${errorMsg}`);
            err.statusCode = res.statusCode;
            err.providerKey = provider.key;
            handleRetry(err, remaining);
          });
          return;
        }

        if (isStreaming) {
          resolve({ stream: res, statusCode: 200, latency });
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ data: parsed, statusCode: 200, latency, usage: parsed.usage });
          } catch (err) {
            handleRetry(new Error(`${provider.key}: Invalid JSON from provider`), remaining);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        handleRetry(new Error(`${provider.key}: timeout`), remaining);
      });

      req.on('error', (err) => {
        handleRetry(new Error(`${provider.key}: ${err.message}`), remaining);
      });

      req.write(postData);
      req.end();

      function handleRetry(err, remaining) {
        // Never retry rate limits (429) — it just burns quota faster.
        // Also skip 401/404 (auth/model errors won't fix themselves).
        const status = err.statusCode || 0;
        const noRetry = status === 429 || status === 401 || status === 403 || status === 404;
        if (remaining > 0 && !isStreaming && !noRetry) {
          const delay = remaining === 2 ? 1000 : 2000;
          logger.warn('Retrying provider call', { key: provider.key, attempt: retries - remaining + 2, error: err.message });
          setTimeout(() => attempt(remaining - 1), delay);
        } else {
          reject(err);
        }
      }
    };

    attempt(retries);
  });
}

module.exports = { PROVIDERS, MODEL_MAP, callProvider };
