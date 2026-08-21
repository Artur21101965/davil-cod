// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { LRUCache } = require('./lib/cache');
const { PROVIDERS, MODEL_MAP, callProvider } = require('./lib/providers');
const { loadState, initHealth, isCircuitOpen, recordSuccess, recordFailure, recordRequest, recordTokens, getHealth, getStats, recordRecent, recordRpm, getRecent, getRpm } = require('./lib/health');
const { checkRateLimit } = require('./lib/rateLimit');
const { handleDashboard } = require('./lib/dashboard');
const logger = require('./lib/logger');

// Load persisted state
loadState();

const cache = new LRUCache(500, 3600000);
require('./lib/cache')._activeCache = cache;

// Load config (with fallback so a corrupt config never crashes the server)
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = { port: 4000, auth: 'free-llm-proxy-2024', rateLimit: { maxRequests: 100, windowMs: 60000 } };
try {
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (parsed && typeof parsed === 'object') config = { ...config, ...parsed };
} catch (err) {
  console.error(`Config corrupt, using defaults: ${err.message}`);
}

// CLI args (override config)
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const PORT = parseInt(getArg('port', config.port || '4000'));
const AUTH_KEY = getArg('auth', config.auth || '');
const RATE_LIMIT = config.rateLimit || { maxRequests: 100, windowMs: 60000 };

// Health check
const healthIntervals = {}; // key -> { nextCheck, backoff }

function providerModelsEndpoint(endpoint) {
  return endpoint.replace('/chat/completions', '/models');
}

async function checkProvider(key, provider) {
  initHealth(key);
  try {
    const url = new URL(providerModelsEndpoint(provider.endpoint));
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      recordSuccess(key);
      getHealth()[key].status = 'up';
      healthIntervals[key] = { nextCheck: Date.now() + 300000, backoff: 60000 };
      return true;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    getHealth()[key].status = 'error';
    getHealth()[key].score = Math.max(0, (getHealth()[key].score ?? 50) - 5);
    recordFailure(key);
    const backoff = Math.min((healthIntervals[key]?.backoff || 60000) * 2, 600000);
    healthIntervals[key] = { nextCheck: Date.now() + backoff, backoff };
    return false;
  }
}

async function healthCheck() {
  const now = Date.now();
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    if (!provider.enabled) continue;
    const interval = healthIntervals[key];
    if (interval && interval.nextCheck > now) continue;
    await checkProvider(key, provider);
  }
}
setInterval(healthCheck, 30000);
setTimeout(healthCheck, 1000);

// Chat completion handler
async function handleChatCompletion(req, res, body) {
  const requestedModel = body.model || 'tier-splus';
  const targetProviderKey = MODEL_MAP[requestedModel] || 'zai';
  const isStreaming = body.stream === true;

  // Check cache for non-streaming
  if (!isStreaming) {
    const cached = cache.get(requestedModel, body.messages, body.temperature);
    if (cached) {
      logger.request({ model: requestedModel, provider: 'cache', status: 200, cached: true });
      recordRecent({ model: requestedModel, provider: 'cache', status: 200, latency: 0, cached: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
      return;
    }
  }

  // Weighted selection among healthy providers
  const healthyProviders = Object.entries(PROVIDERS)
    .filter(([_, p]) => p.enabled && !isCircuitOpen(p.key) && getHealth()[p.key]?.status === 'up');

  let selected = [];
  if (healthyProviders.length > 0) {
    const scored = healthyProviders.map(([key, provider]) => {
      const h = getHealth()[key];
      let score = h.score || 50;
      const lat = Math.max(h.latency || 100, 50);
      let weight = score / lat;
      if (key === targetProviderKey) weight *= 2;
      const dailyLimit = provider.dailyLimit || 1000;
      const usedToday = getStats().providerUsage[key] || 0;
      if (usedToday >= dailyLimit * 0.9) weight *= 0.5;
      return { key, provider, weight };
    }).sort((a, b) => b.weight - a.weight);

    const totalWeight = scored.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * totalWeight;
    for (const p of scored) {
      r -= p.weight;
      if (r <= 0) { selected = scored; break; }
    }
    if (selected.length === 0) selected = scored;
  }

  const enabledProviders = selected.length > 0 ? selected.map(s => [s.key, s.provider]) :
    Object.entries(PROVIDERS).filter(([_, p]) => p.enabled)
      .sort((a, b) => (getHealth()[b[0]]?.score || 50) - (getHealth()[a[0]]?.score || 50));

  if (enabledProviders.length === 0) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No providers available' }));
    return;
  }

  const errors = [];

  for (const [key, provider] of enabledProviders) {
    if (isCircuitOpen(key)) {
      errors.push(key + ': circuit breaker open');
      continue;
    }

    const providerBody = { ...body, model: provider.model };

    try {
      const result = await callProvider(provider, providerBody);
      initHealth(key);
      getHealth()[key].latency = result.latency;
      getHealth()[key].lastCheck = Date.now();
      recordSuccess(key);
      recordRequest(key, true);
      logger.request({ model: requestedModel, provider: key, status: 200, latency: result.latency, stream: isStreaming });
      recordRecent({ model: requestedModel, provider: key, status: 200, latency: result.latency, cached: false });

      if (isStreaming && result.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        const { Transform } = require('stream');
        const cleaner = new Transform({
          transform(chunk, encoding, callback) {
            const str = chunk.toString();
            const cleaned = str.replace(/^data: (.+)$/gm, (match, jsonStr) => {
              if (jsonStr.trim() === '[DONE]') return match;
              try {
                const obj = JSON.parse(jsonStr);
                delete obj.nvext;
                if (obj.choices?.[0]) delete obj.choices[0].logprobs;
                return 'data: ' + JSON.stringify(obj);
              } catch { return match; }
            });
            callback(null, cleaned);
          }
        });
        result.stream.on('error', (err) => {
          logger.error('Stream error', { key, error: err.message });
          res.end();
        });
        result.stream.pipe(cleaner).pipe(res);
        return;
      }

      if (!isStreaming && result.data) {
        delete result.data.nvext;
        cache.set(requestedModel, body.messages, body.temperature, result.data);
        recordTokens(key, result.usage);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.data));
        return;
      }
    } catch (err) {
      const statusCode = err.statusCode || 502;
      errors.push(err.message);
      recordRequest(key, false, err.message);
      recordRecent({ model: requestedModel, provider: key, status: statusCode, latency: 0, cached: false });
      initHealth(key);
      getHealth()[key].status = statusCode === 429 ? 'ratelimited' : 'error';
      getHealth()[key].score = Math.max(0, (getHealth()[key].score || 50) - (statusCode === 429 ? 5 : 10));
      recordFailure(key, statusCode);
    }
  }

  // If every provider failed with transient errors (5xx/timeout), give them one
  // more pass after a short pause — many overloads clear in 1-2 seconds.
  const allSoft = errors.length > 0 && errors.every(e => !/429|401|403|404/.test(e));
  if (allSoft && enabledProviders.length > 1) {
    await new Promise(r => setTimeout(r, 1500));
    for (const [key, provider] of enabledProviders) {
      if (isCircuitOpen(key)) continue;
      try {
        const result = await callProvider(provider, { ...body, model: provider.model });
        recordSuccess(key);
        recordRequest(key, true);
        recordRecent({ model: requestedModel, provider: key, status: 200, latency: result.latency, cached: false });
        if (!body.stream && result.data) {
          delete result.data.nvext;
          cache.set(requestedModel, body.messages, body.temperature, result.data);
          recordTokens(key, result.usage);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.data));
          return;
        }
        if (body.stream && result.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          result.stream.pipe(res);
          return;
        }
      } catch (err2) {
        recordRequest(key, false, err2.message);
        recordFailure(key, err2.statusCode);
      }
    }
  }

  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'All providers failed', type: 'api_error', code: 'all_providers_failed', details: errors } }));
}

// Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = new URL(req.url, 'http://localhost:' + PORT);

  if (parsedUrl.pathname === '/') { handleDashboard(req, res); return; }

  if (parsedUrl.pathname === '/health') {
    const h = getHealth();
    const upCount = Object.values(h).filter(v => v.status === 'up').length;
    const totalCount = Object.entries(PROVIDERS).filter(([_, p]) => p.enabled).length;
    res.writeHead(upCount > 0 ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: upCount > 0 ? 'ok' : 'degraded', providers: { up: upCount, total: totalCount } }));
    return;
  }

  if (parsedUrl.pathname === '/v1/stats') {
    const s = getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total_requests: s.totalRequests, successful_requests: s.successfulRequests, failed_requests: s.failedRequests,
      provider_usage: s.providerUsage, token_usage: s.tokenUsage, errors: s.errors, uptime_seconds: Math.floor((Date.now() - s.startTime) / 1000),
      health: Object.fromEntries(Object.entries(getHealth()).map(([k, v]) => [k, { status: v.status, score: v.score, latency_ms: v.latency }])),
      cache: cache.stats(),
    }));
    return;
  }

  if (parsedUrl.pathname === '/v1/models') {
    const models = Object.entries(PROVIDERS).filter(([_, p]) => p.enabled).map(([key, p]) => ({ id: p.model, object: 'model', owned_by: key }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: models }));
    return;
  }

  if (parsedUrl.pathname === '/v1/chat/completions' && req.method === 'POST') {
    if (AUTH_KEY) {
      const apiKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
      if (apiKey !== AUTH_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
    }

    const serviceKey = req.socket.remoteAddress;
    if (!checkRateLimit(serviceKey, RATE_LIMIT.maxRequests, RATE_LIMIT.windowMs)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
      return;
    }

    let body = '';
    const MAX_BODY = 2 * 1024 * 1024; // 2MB cap
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Request body too large' } }));
        req.destroy();
      }
    });
    req.on('error', () => {});
    req.on('end', async () => {
      try {
        await handleChatCompletion(req, res, JSON.parse(body));
      } catch (err) {
        logger.error('Chat handler error', { message: err.message, stack: err.stack });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid request body' } }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/v1/recent') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: getRecent() }));
    return;
  }

  if (parsedUrl.pathname === '/v1/rpm') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: getRpm() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  logger.info('DAVIL Cod started', { port: PORT });
  console.log('Dashboard: http://localhost:' + PORT + '/');
});

process.on('SIGINT', () => { require('./lib/health').saveState(); cache.persist(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { require('./lib/health').saveState(); cache.persist(); server.close(() => process.exit(0)); });
