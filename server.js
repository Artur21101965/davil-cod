// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { LRUCache } = require('./lib/cache');
const { PROVIDERS, MODEL_MAP, callProvider } = require('./lib/providers');
const { loadState, initHealth, isCircuitOpen, recordSuccess, recordFailure, recordRequest, recordTokens, getHealth, getStats, recordRecent, recordRpm, getRecent, getRpm } = require('./lib/health');
const { checkRateLimit } = require('./lib/rateLimit');
const { handleDashboard } = require('./lib/dashboard');
const { acquire, stats: poolStats } = require('./lib/pool');
const logger = require('./lib/logger');

// Load persisted state
loadState();

// Drop stale health entries for providers that no longer exist (e.g. auto-disabled)
const activeKeys = new Set(Object.keys(PROVIDERS));
const stale = Object.keys(getHealth()).filter(k => !activeKeys.has(k));
if (stale.length > 0) {
  for (const k of stale) {
    delete getHealth()[k];
  }
  logger.info('Cleaned stale health entries', { removed: stale });
}

const cache = new LRUCache(500, 3600000);
require('./lib/cache')._activeCache = cache;

// Load config (with fallback so a corrupt config never crashes the server)
// Prefer cwd config.json (user's project) over the package dir.
const CONFIG_CANDIDATES = [path.join(process.cwd(), 'config.json'), path.join(__dirname, 'config.json')];
const CONFIG_PATH = CONFIG_CANDIDATES.find(p => fs.existsSync(p)) || CONFIG_CANDIDATES[1];
let config = { port: 4000, auth: '', rateLimit: { maxRequests: 100, windowMs: 60000 } };
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
const PORT = parseInt(process.env.PORT || getArg('port', config.port || '4000'));
const AUTH_KEY = process.env.AUTH || getArg('auth', config.auth || '');
const RATE_LIMIT = config.rateLimit || { maxRequests: 100, windowMs: 60000 };

// Health check
const healthIntervals = {}; // key -> { nextCheck, backoff }

async function checkProvider(key, provider) {
  initHealth(key);
  const start = Date.now();
  const dailyLimit = provider.dailyLimit || 1000;
  // Providers with tight daily limits (e.g. 40-50) would burn quota on probes.
  // Use a cheap /models GET for them; real latency probe for generous ones.
  const cheap = dailyLimit < 100;
  try {
    const body = cheap ? null : JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    });
    const url = cheap ? provider.endpoint.replace('/chat/completions', '/models') : provider.endpoint;
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - start;
    if (res.ok) {
      recordSuccess(key);
      getHealth()[key].status = 'up';
      // Only record latency for real generation probes (non-cheap). /models GET
      // latency (30-100ms) does not reflect generation speed and would wrongly
      // dominate the weighted selection.
      if (!cheap) getHealth()[key].latency = latency;
      getHealth()[key].lastCheck = Date.now();
      healthIntervals[key] = { nextCheck: Date.now() + 300000, backoff: 60000 };
      return true;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    const latency = Date.now() - start;
    getHealth()[key].status = 'error';
    getHealth()[key].latency = latency;
    getHealth()[key].score = Math.max(0, (getHealth()[key].score ?? 50) - 5);
    recordFailure(key);
    // 404 means the model/function isn't available for this account — auto-disable
    // so we stop probing it forever. Re-enable by setting enabled:true in config.
    if (String(err.message).includes('404')) {
      provider.enabled = false;
      getHealth()[key].status = 'disabled';
      getHealth()[key].reason = 'отключён автоматически (404)';
      logger.warn('Provider auto-disabled (404)', { key, model: provider.model });
    } else {
      const backoff = Math.min((healthIntervals[key]?.backoff || 60000) * 2, 600000);
      healthIntervals[key] = { nextCheck: Date.now() + backoff, backoff };
    }
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
  let targetProviderKey = MODEL_MAP[requestedModel] || 'zai';
  const isStreaming = body.stream === true;

  // Vision detection: if the request contains images, route to a vision provider
  const hasImage = Array.isArray(body.messages) && body.messages.some((m) => {
    if (Array.isArray(m.content)) {
      return m.content.some((c) => c && (c.type === 'image_url' || c.type === 'image'));
    }
    return false;
  });
  if (hasImage) {
    targetProviderKey = 'gemini-vision';
    logger.info('Vision request detected', { model: requestedModel, target: targetProviderKey });
  }

  // Check cache (works for both streaming and non-streaming)
  const cached = cache.get(requestedModel, body.messages, body.temperature);
  if (cached) {
    logger.request({ model: requestedModel, provider: 'cache', status: 200, cached: true });
    recordRecent({ model: requestedModel, provider: 'cache', status: 200, latency: 0, cached: true });
    if (isStreaming) {
      // Replay cached answer as an SSE stream
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const content = cached.choices?.[0]?.message?.content || '';
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-cached', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: cached.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-cached', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: cached.model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-cached', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: cached.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cached));
    return;
  }

  // Weighted selection among healthy providers
  const today = new Date().toISOString().slice(0, 10);
  const healthyProviders = Object.entries(PROVIDERS)
    .filter(([_, p]) => p.enabled && !isCircuitOpen(p.key) && getHealth()[p.key]?.status === 'up');

  // Prefer providers below 90% of their daily limit; only fall back to
  // near-exhausted ones if that leaves nothing (avoids avoidable 429s).
  let pool = healthyProviders;
  const underLimit = healthyProviders.filter(([_, p]) => {
    const limit = p.dailyLimit || 1000;
    const used = (getStats().dailyUsage?.[p.key]?.[today]) || 0;
    return used < limit * 0.9;
  });
  if (underLimit.length > 0) pool = underLimit;

  let selected = [];
  if (pool.length > 0) {
    const scored = pool.map(([key, provider]) => {
      const h = getHealth()[key];
      let score = h.score || 50;
      // Latency is only reliable after real requests; unmeasured/zero latency
      // must NOT balloon a provider's weight. Treat <100ms as neutral.
      const rawLat = h.latency || 0;
      const lat = rawLat > 0 ? Math.max(rawLat, 100) : 500;
      let weight = score / lat;
      if (key === targetProviderKey) weight *= 2;
      const dailyLimit = provider.dailyLimit || 1000;
      const usedToday = getStats().providerUsage[key] || 0;
      if (usedToday >= dailyLimit * 0.9) weight *= 0.5;
      // Providers with a history of failures lose weight (stability first)
      const errorCount = getStats().errors[key] || 0;
      if (errorCount > 5) weight *= 0.4;
      // Today's reliability: providers that have been 100% successful get a boost
      const rel = getStats().reliability?.[key];
      if (rel && rel.success + rel.fail >= 3) {
        const ratio = rel.success / (rel.success + rel.fail);
        if (ratio === 1) weight *= 1.3;
        else if (ratio < 0.5) weight *= 0.5;
      }
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
      const release = await acquire(key);
      let result;
      try {
        result = await callProvider(provider, providerBody);
      } finally {
        release();
      }
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
        // Accumulate content deltas so we can cache the final answer for
        // identical repeat prompts (opencode always streams).
        const chunks = [];
        const cleaner = new Transform({
          transform(chunk, encoding, callback) {
            const str = chunk.toString();
            // Collect SSE JSON payloads for caching
            const lines = str.split('\n');
            for (const line of lines) {
              const m = line.match(/^data: (.+)$/);
              if (!m || m[1].trim() === '[DONE]') continue;
              try {
                const obj = JSON.parse(m[1]);
                const delta = obj.choices?.[0]?.delta?.content;
                if (typeof delta === 'string') chunks.push(delta);
              } catch {}
            }
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
        result.stream.on('end', () => {
          // Cache the assembled answer for repeat prompts (only if complete)
          if (chunks.length > 0) {
            const full = chunks.join('');
            cache.set(requestedModel, body.messages, body.temperature, {
              id: 'chatcmpl-cached',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: provider.model,
              choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
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
      // 404 = model not available for this account — disable permanently
      if (statusCode === 404) {
        provider.enabled = false;
        getHealth()[key].status = 'disabled';
        getHealth()[key].reason = 'отключён автоматически (404)';
        logger.warn('Provider auto-disabled (404)', { key, model: provider.model });
      }
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
        const release = await acquire(key);
        let result;
        try {
          result = await callProvider(provider, { ...body, model: provider.model });
        } finally {
          release();
        }
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

  if (parsedUrl.pathname === '/') {
    // Protect the dashboard with auth if one is configured.
    // Browser-friendly: accept ?key= or Authorization header.
    if (AUTH_KEY) {
      const keyFromQuery = parsedUrl.searchParams.get('key');
      const keyFromHeader = (req.headers.authorization || '').replace('Bearer ', '').trim();
      if (keyFromQuery !== AUTH_KEY && keyFromHeader !== AUTH_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key', code: 'invalid_api_key' } }));
        return;
      }
    }
    handleDashboard(req, res);
    return;
  }

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
    const today = new Date().toISOString().slice(0, 10);
    const limits = {};
    for (const [key, p] of Object.entries(PROVIDERS)) {
      const limit = p.dailyLimit;
      if (!limit) continue;
      const used = (s.dailyUsage?.[key]?.[today]) || 0;
      limits[key] = { limit, used, remaining: Math.max(0, limit - used), percent: Math.min(100, Math.round((used / limit) * 100)) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total_requests: s.totalRequests, successful_requests: s.successfulRequests, failed_requests: s.failedRequests,
      provider_usage: s.providerUsage, token_usage: s.tokenUsage, errors: s.errors, uptime_seconds: Math.floor((Date.now() - s.startTime) / 1000),
      health: Object.fromEntries(Object.entries(getHealth()).map(([k, v]) => {
        const limit = limits[k];
        const err = s.errors[k] || 0;
        let reason = '';
        if (v.status !== 'up') reason = v.status === 'ratelimited' ? 'лимит провайдера (429)' : 'не отвечает';
        else if (limit && limit.percent >= 100) reason = 'дневной лимит исчерпан';
        else if (err > 10) reason = 'много ошибок (' + err + ')';
        else reason = 'работает';
        const rel = s.reliability?.[k];
        let reliability = null;
        if (rel && rel.success + rel.fail >= 3) reliability = Math.round((rel.success / (rel.success + rel.fail)) * 100);
        return [k, { status: v.status, score: v.score, latency_ms: v.latency, reason, reliability }];
      })),
      cache: cache.stats(),
      limits,
      pool: poolStats(),
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
        const requestBody = JSON.parse(body);
        // Validate minimal structure — reject junk before it burns provider limits
        if (!requestBody || typeof requestBody !== 'object' ||
            !Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'messages is required and must be a non-empty array', type: 'invalid_request_error', code: 'invalid_messages' } }));
          return;
        }
        await handleChatCompletion(req, res, requestBody);
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

server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  logger.info('DAVIL Cod started', { port: PORT });
  console.log('Dashboard: http://localhost:' + PORT + '/');
});

process.on('SIGINT', () => { require('./lib/health').saveState(); cache.persist(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { require('./lib/health').saveState(); cache.persist(); server.close(() => process.exit(0)); });
