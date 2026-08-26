// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { LRUCache } = require('./lib/cache');
const { PROVIDERS, MODEL_MAP, callProvider, reloadProviders } = require('./lib/providers');
const { loadState, initHealth, isCircuitOpen, recordSuccess, recordFailure, recordRequest, recordTokens, getHealth, getStats, recordRecent, recordRpm, getRecent, getRpm, recordSelection, getLastSelection, getBandit, recordBandit } = require('./lib/health');
const { checkRateLimit } = require('./lib/rateLimit');
const { handleDashboard } = require('./lib/dashboard');
const { acquire, stats: poolStats } = require('./lib/pool');
const { stripThink, cleanDelta, cleanMessage, fixReasoningMessage, isTooShort, MIN_ANSWER_LEN } = require('./lib/clean');
const { classifyComplexity, maybeUpgradeTier, classifyVisionComplexity } = require('./lib/routing');
const { bucket, pick: banditPick, isTransientLimit } = require('./lib/bandit');
const { StringDecoder } = require('string_decoder');
const logger = require('./lib/logger');
const { KEY_GROUPS, readKeys, saveKeys, validateKey, getStoredKey } = require('./lib/setup');
const { prepareMessages } = require('./lib/compactor');

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

const cache = new LRUCache(500, 3600000, false, true); // 4th arg: semantic normalize ON
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
  // CRITICAL: always use cheap /models GET for health checks. Sending real LLM
  // requests just to "check health" burns provider daily request limits (Groq
  // limits by requests/day, not tokens). 18 providers × every 5 min = 288
  // wasted requests/day. Real latency comes from actual user requests instead.
  try {
    const url = provider.endpoint.replace('/chat/completions', '/models');
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...(provider.apiKey ? { 'Authorization': `Bearer ${provider.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    const latency = Date.now() - start;
    if (res.ok) {
      recordSuccess(key);
      getHealth()[key].status = 'up';
      // Do NOT record /models latency as generation speed (it's 30-100ms, not
      // representative). Keep existing real latency from actual requests.
      getHealth()[key].lastCheck = Date.now();
      healthIntervals[key] = { nextCheck: Date.now() + 300000, backoff: 60000 };
      return true;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    const latency = Date.now() - start;
    const is429 = String(err.message).includes('429');
    // 429 = temporary rate limit (provider is alive, just limited). Don't mark it
    // as dead — it will recover when the limit resets. Keep it visible to clients.
    getHealth()[key].status = is429 ? 'ratelimited' : 'error';
    getHealth()[key].latency = latency;
    getHealth()[key].reason = is429 ? 'лимит провайдера (429)' : 'не отвечает';
    getHealth()[key].score = Math.max(0, (getHealth()[key].score ?? 50) - (is429 ? 2 : 5));
    recordFailure(key);
    // 404 means the model/function isn't available for this account — auto-disable
    // so we stop probing it forever. Re-enable by setting enabled:true in config.
    if (String(err.message).includes('404')) {
      provider.enabled = false;
      getHealth()[key].status = 'disabled';
      getHealth()[key].reason = 'отключён автоматически (404)';
      logger.warn('Provider auto-disabled (404)', { key, model: provider.model });
    } else {
      // Re-check soon after a transient failure so the provider recovers quickly.
      // Growing backoff (up to 10 min) would leave it 'dead' too long for users.
      healthIntervals[key] = { nextCheck: Date.now() + 60000, backoff: 60000 };
    }
    return false;
  }
}

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
setInterval(healthCheck, 30000);
setTimeout(healthCheck, 1000);

// Извлекает все значения content из SSE-чанка. Возвращает true, если есть
// хотя бы одно непустое (реальный токен, а не пустая дельта).
function chunkHasToken(str) {
  const re = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m[1].trim().length > 0) return true;
  }
  return false;
}

// Chat completion handler
async function handleChatCompletion(req, res, body) {
  const requestedModel = body.model || 'tier-splus';
  // Умный роутинг: сложные задачи с лёгкого тира поднимаем на более мощный.
  // Классифицируем ПОСЛЕ того, как определён requestedModel, ДО выбора провайдера.
  const complexity = classifyComplexity(body.messages);
  let complexityBucket = bucket(complexity);
  let effectiveModel = maybeUpgradeTier(requestedModel, complexity);
  let targetProviderKey = MODEL_MAP[effectiveModel] || MODEL_MAP[requestedModel] || 'zai';
  const isStreaming = body.stream === true;

  // Vision detection: if the request contains images, route to a vision provider.
  // TWO-STAGE pipeline:
  //   Stage 1: vision model reads the screenshot, extracts text/description.
  //   Stage 2: the requested (coding/general) model answers using the extracted
  //            text as context — so a coding model handles the fix, not vision.
  const hasImage = Array.isArray(body.messages) && body.messages.some((m) => {
    if (Array.isArray(m.content)) {
      return m.content.some((c) => c && (c.type === 'image_url' || c.type === 'image' || c.type === 'file' || c.type === 'input_image'));
    }
    return false;
  });
  // Log any message that LOOKS like it carries an image (any field), so we can
  // adapt detection to opencode's actual format.
  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      const suspicious = m && (
        m.attachments || m.image || m.file ||
        (Array.isArray(m.content) && m.content.some(c => c && (c.image || c.image_url || c.file || c.data || c.type === 'file')))
      );
      if (suspicious) {
        logger.info('Vision format detected', {
          keys: Object.keys(m || {}),
          contentTypes: Array.isArray(m.content) ? m.content.map(c => c && (c.type || 'plain')) : null,
          contentKeys: Array.isArray(m.content) ? m.content.map(c => c && Object.keys(c).slice(0,5)) : null,
        });
        break;
      }
    }
  }
  if (hasImage) {
    // Two-stage pipeline: try vision providers in order until one extracts text.
    const visionChain = ['gemini-vision', 'nim-vision', 'deepseek-vision']
      .map((k) => PROVIDERS[k])
      .filter((p) => p && p.enabled);
    if (visionChain.length > 0) {
      logger.info('Vision pipeline: распознаю скриншот', { chain: visionChain.map(p => p.key).join(',') });
      let extracted = '';
      for (const visionProvider of visionChain) {
        try {
          const visionBody = {
            model: visionProvider.model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Распознай и извлеки ВЕСЬ текст с изображения (ошибка, код, сообщение). Верни только содержимое, без комментариев. Если это код — верни код как есть.' },
                ...(Array.isArray(body.messages) ? body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((c) => c && (c.type === 'image_url' || c.type === 'image' || c.type === 'input_image')).map((c) => {
                  // Normalize any image part to the universal image_url format
                  const url = c.image_url?.url || c.image?.url || c.image?.data || (c.image && typeof c.image === 'string' ? c.image : null) || c.url;
                  return url ? { type: 'image_url', image_url: { url } } : null;
                }).filter(Boolean) : [])) : []),
              ],
            }],
            max_tokens: 2000,
          };
          const visionRes = await callProvider(visionProvider, visionBody);
          extracted = visionRes.data?.choices?.[0]?.message?.content || visionRes.data?.choices?.[0]?.message?.reasoning || '';
          if (extracted) { logger.info('Vision pipeline: распознал ' + visionProvider.key); break; }
        } catch (err) {
          logger.warn('Vision pipeline: ' + visionProvider.key + ' не сработал', { error: err.message.slice(0, 80) });
        }
      }
      const cleaned = stripThink(extracted, true);
      logger.info('Vision pipeline: скриншот распознан', { chars: cleaned.length });
      if (cleaned) {
        // Умный vision-роутинг: скриншот с кодом/ошибкой поднимает тир.
        const vc = classifyVisionComplexity(cleaned);
        if (vc > 0) effectiveModel = maybeUpgradeTier(effectiveModel, vc);
        // Vision-текст может изменить сложность — пересчитываем бакет.
        complexityBucket = bucket(classifyVisionComplexity(cleaned));
        // Пересчитываем target-провайдера — vision-апгрейд мог сменить тир.
        targetProviderKey = MODEL_MAP[effectiveModel] || MODEL_MAP[requestedModel] || 'zai';
        // Replace image content with the extracted text as context,
        // so the coding/general model (not vision) answers the question.
        const userMsgs = Array.isArray(body.messages) ? body.messages : [];
        body = {
          ...body,
          messages: userMsgs.map((m) => {
            if (Array.isArray(m.content) && m.content.some((c) => c && (c.type === 'image_url' || c.type === 'image' || c.type === 'input_image'))) {
              const textPart = m.content.find((c) => c && c.type === 'text')?.text || '';
              return { role: 'user', content: `${textPart}\n\n[Содержимое скриншота]\n${cleaned}` };
            }
            return m;
          }),
        };
      }
    }
  }

  // Compact overly large conversations so free models don't reject on context.
  // Runs AFTER the vision pipeline (images already converted to text above).
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    body.messages = await prepareMessages(body.messages);
  }

  // Check cache (works for both streaming and non-streaming)
  const cached = cache.get(effectiveModel, body.messages, body.temperature);
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
  // 'ratelimited' providers are alive but temporarily limited — include them
  // (weighted down) so the pool never looks empty when many limits are hot.
  // Vision providers are ONLY used for image requests (two-stage pipeline),
  // never for plain text — otherwise they dominate the weighted selection.
  const healthyProviders = Object.entries(PROVIDERS)
    .filter(([_, p]) => p.enabled && !isCircuitOpen(p.key) && p.vision !== true &&
      (getHealth()[p.key]?.status === 'up' || getHealth()[p.key]?.status === 'ratelimited'));

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
      const rawLat = h.latency || 0;
      const lat = rawLat > 0 ? Math.max(rawLat, 100) : 500;
      let weight = score / lat;
      if (h.status === 'ratelimited') weight *= 0.05;
      if (key === targetProviderKey) weight *= 1.15;
      const dailyLimit = provider.dailyLimit || 1000;
      const usedToday = getStats().providerUsage[key] || 0;
      if (usedToday >= dailyLimit * 0.9) weight *= 0.5;
      return { key, provider, weight };
    });

    // Bandit weight contract: bandit's pick() multiplies the Beta sample by
    // `weight`, so safety-штрафы (ratelimited ×0.05, target ×1.15) действуют и
    // при холодном старте. score/latency держит вес ~0.01-1.0; приоры bandit'а
    // (a,b ~1+) со временем начинают доминировать. Не добавляй нормализацию
    // здесь, пока измеренные веса не превысят ~5.
    // Thompson sampling: рисуем сэмпл Beta(a+1, b+1) для каждого, умножаем на
    // weight, выбираем максимум. Приоры из бакета сложности (bandit обучается).
    const priors = getBandit()[complexityBucket] || {};
    const bestKey = banditPick(scored, priors);
    const bestProvider = scored.find((p) => p.key === bestKey);
    if (bestProvider) selected = [bestProvider];
    else if (scored.length > 0) selected = [scored[0]];
  }

  // Weighted-random picked ONE provider as the primary; append the rest of the
  // healthy pool (by weight) as fallbacks so a failing pick still recovers.
  const restOfPool = selected.length > 0 && pool.length > 0
    ? pool.map(([k, p]) => ({ key: k, provider: p })).filter(s => s.key !== selected[0].key)
      .sort((a, b) => (getHealth()[b.key]?.score || 0) - (getHealth()[a.key]?.score || 0))
    : [];
  const enabledProviders = selected.length > 0
    ? [selected[0]].concat(restOfPool).map(s => [s.key, s.provider])
    : Object.entries(PROVIDERS).filter(([_, p]) => p.enabled)
      .sort((a, b) => (getHealth()[b[0]]?.score || 50) - (getHealth()[a[0]]?.score || 50));

  // Ensure the requested model's mapped provider is at least IN the candidate
  // list (it may have been filtered out), but DON'T force it to the front —
  // the weighted selection above should pick the fastest/healthiest provider.
  if (MODEL_MAP[requestedModel] && PROVIDERS[targetProviderKey]) {
    if (!enabledProviders.some(([k]) => k === targetProviderKey)) {
      enabledProviders.unshift([targetProviderKey, PROVIDERS[targetProviderKey]]);
    }
  }

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
      // Cap recorded latency — values >60s mean the request hung, not real
      // provider speed. Huge latency would poison the weighted selection.
      getHealth()[key].latency = Math.min(result.latency || 0, 60000);
      getHealth()[key].lastCheck = Date.now();

      // For non-stream, verify the response isn't empty BEFORE recording success.
      if (!isStreaming && result.data) {
        delete result.data.nvext;
        if (result.data.choices?.[0]) {
          fixReasoningMessage(result.data.choices[0].message);
          cleanMessage(result.data.choices[0].message);
        }
        if (isTooShort(result.data)) {
          // Пустой/мусорный ответ (провайдер-глитч) НЕ считается успехом — пробуем следующего.
          const msg = key + ': empty or too short response';
          errors.push(msg);
          recordFailure(key, 0);
          recordRequest(key, false, msg);
          recordBandit(complexityBucket, key, false);
          recordRecent({ model: requestedModel, provider: key, status: 204, latency: result.latency, cached: false });
          logger.warn('Empty or too-short response, trying next provider', { key });
          continue;
        }
      }

      if (isStreaming && result.stream) {
        const chunks = [];

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
        // Успех записываем ДО любого токена намеренно: fallback по таймауту 5с
        // нанёс бы лишний дабл-счёт, если бы success фиксировался после первого токена.
        if (provider.reasoning) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          recordSuccess(key);
          recordRequest(key, true);
          logger.request({ model: requestedModel, provider: key, status: 200, latency: result.latency, stream: isStreaming });
          recordRecent({ model: requestedModel, provider: key, status: 200, latency: result.latency, cached: false });
          recordSelection(key, provider.model, requestedModel);
          const { Transform } = require('stream');
          const reasonDec = new StringDecoder('utf8');
          const cleaner = new Transform({
            transform(chunk, encoding, callback) {
              const str = reasonDec.write(chunk);
              collect(str);
              callback(null, cleanStr(str));
            },
            flush(callback) {
              const tail = reasonDec.end();
              if (tail) { collect(tail); const tailStr = cleanStr(tail); if (tailStr) this.push(tailStr); }
              callback();
            }
          });
          result.stream.on('end', () => {
            const full = chunks.join('');
            // Bandit учится по качеству: пустой/мусорный стрим = фейл.
            recordBandit(complexityBucket, key, full.trim().length >= MIN_ANSWER_LEN);
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
            if (!isTransientLimit(err.statusCode)) recordBandit(complexityBucket, key, false);
            res.end();
          });
          result.stream.pipe(cleaner).pipe(res);
          return;
        }

        // Обычные модели: буферизуем до первого токена (макс 5 сек).
        // Заголовки не пишем сразу — если токена нет за 5 сек, fallback.
        // StringDecoder держит частично пришедший multi-byte UTF-8 между чанками —
        // иначе русский текст дробится на '' символ.
        const rawBuf = [];
        const streamDec = new StringDecoder('utf8');
        const firstToken = new Promise((resolve) => {
          let done = false;
          const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 5000);
          const finish = (ok) => { if (!done) { done = true; clearTimeout(timer); resolve(ok); } };
          result.stream.on('data', (chunk) => {
            const str = streamDec.write(chunk);
            rawBuf.push(str);
            collect(str);
            // Первый контент-токен: хотя бы одно непустое `"content":"..."` в чанке.
            if (chunkHasToken(str)) {
              finish(true);
            }
          });
          result.stream.once('end', () => finish(false));
          result.stream.once('error', () => finish(false));
        });

        // Клиент отключился во время ожидания первого токена — прерываем.
        const onClientClose = () => {
          try { result.stream.destroy(); } catch {}
        };
        req.once('close', onClientClose);

        const gotFirst = await firstToken;
        if (!gotFirst) {
          const msg = key + ': no first token within 5s';
          errors.push(msg);
          recordFailure(key, 0);
          recordRequest(key, false, msg);
          recordBandit(complexityBucket, key, false);
          recordRecent({ model: requestedModel, provider: key, status: 204, latency: result.latency, cached: false });
          logger.warn('Streaming fallback: no first token', { key });
          try { result.stream.destroy(); } catch {}
          continue; // РАБОТАЕТ — мы внутри for-цикла провайдеров.
        }

        // Первый токен пришёл: пишем заголовки, промываем буфер, дальше стримим.
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        recordSuccess(key);
        recordRequest(key, true);
        logger.request({ model: requestedModel, provider: key, status: 200, latency: result.latency, stream: isStreaming });
        recordRecent({ model: requestedModel, provider: key, status: 200, latency: result.latency, cached: false });
        recordSelection(key, provider.model, requestedModel);
        res.on('error', (err) => {
          logger.error('Client stream error', { key, error: err.message });
          try { result.stream.destroy(); } catch {}
        });
        for (const b of rawBuf) res.write(cleanStr(b));
        rawBuf.length = 0;

        // Убираем наш 'data'-слушатель (он больше не нужен — данные уже
        // буферизованы в rawBuf и промыты). Дальше обрабатываем вручную.
        // Продолжаем использовать ТОТ ЖЕ streamDec — иначе multi-byte UTF-8,
        // разделённый границей буфера, превратится в '' .
        result.stream.removeAllListeners('data');
        result.stream.on('data', (chunk) => {
          const str = streamDec.write(chunk);
          collect(str);
          res.write(cleanStr(str));
        });
        result.stream.on('end', () => {
          const tail = streamDec.end();
          if (tail) {
            collect(tail);
            res.write(cleanStr(tail));
          }
          const full = chunks.join('');
          // Bandit учится по качеству: обрыв/мусорный стрим = фейл.
          recordBandit(complexityBucket, key, full.trim().length >= MIN_ANSWER_LEN);
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
          if (!isTransientLimit(err.statusCode)) recordBandit(complexityBucket, key, false);
          res.end();
        });
        return;
      }

      if (!isStreaming && result.data) {
        // content already verified non-empty above
        recordSuccess(key);
        recordRequest(key, true);
        recordBandit(complexityBucket, key, true);
        logger.request({ model: requestedModel, provider: key, status: 200, latency: result.latency, stream: isStreaming });
        recordRecent({ model: requestedModel, provider: key, status: 200, latency: result.latency, cached: false });
        recordSelection(key, provider.model, requestedModel);
        cache.set(effectiveModel, body.messages, body.temperature, result.data);
        recordTokens(key, result.usage);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.data));
        return;
      }
    } catch (err) {
      const statusCode = err.statusCode || 502;
      errors.push(err.message);
      recordRequest(key, false, err.message);
      // Временные лимиты (429/403/402) — не наказываем провайдера в bandit.
      if (!isTransientLimit(statusCode)) recordBandit(complexityBucket, key, false);
      recordRecent({ model: requestedModel, provider: key, status: statusCode, latency: 0, cached: false });
      initHealth(key);
      // Do NOT flip provider to 'error' on a single failed request — transient
      // failures (timeout, 5xx, one-off 429) shouldn't kill a healthy provider.
      // The circuit breaker (3 failures) and periodic health-check handle that.
      // Only a 429 marks it ratelimited (informational); 404 disables entirely.
      if (statusCode === 429) {
        getHealth()[key].status = 'ratelimited';
        getHealth()[key].reason = 'лимит провайдера (429)';
      } else if (statusCode !== 404 && getHealth()[key].status === 'up') {
        // keep 'up' — it may just be a transient blip; health-check re-verifies
      } else {
        getHealth()[key].status = 'error';
        getHealth()[key].reason = 'не отвечает';
      }
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
        if (!body.stream && result.data) {
          delete result.data.nvext;
          if (result.data.choices?.[0]) {
            fixReasoningMessage(result.data.choices[0].message);
            cleanMessage(result.data.choices[0].message);
          }
          if (isTooShort(result.data)) {
            recordFailure(key, 0);
            recordRequest(key, false, key + ': empty or too short response (retry)');
            recordBandit(complexityBucket, key, false);
            logger.warn('Empty or too-short response in retry, trying next', { key });
            continue;
          }
          recordSuccess(key);
          recordRequest(key, true);
          recordBandit(complexityBucket, key, true);
          recordRecent({ model: requestedModel, provider: key, status: 200, latency: result.latency, cached: false });
          recordSelection(key, provider.model, requestedModel);
          cache.set(effectiveModel, body.messages, body.temperature, result.data);
          recordTokens(key, result.usage);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.data));
          return;
        }
        if (body.stream && result.stream) {
          recordSuccess(key);
          recordRequest(key, true);
          recordRecent({ model: requestedModel, provider: key, status: 200, latency: result.latency, cached: false });
          recordSelection(key, provider.model, requestedModel);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          const chunks = [];
          const collectRetry = (str) => {
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
          const cleanRetry = (str) => str.replace(/^data: (.+)$/gm, (match, jsonStr) => {
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
          const retryDec = new StringDecoder('utf8');
          result.stream.on('data', (chunk) => {
            const str = retryDec.write(chunk);
            collectRetry(str);
            res.write(cleanRetry(str));
          });
          result.stream.on('end', () => {
            const tail = retryDec.end();
            if (tail) { collectRetry(tail); res.write(cleanRetry(tail)); }
            const full = chunks.join('');
            // Bandit учится по качеству в ретрае тоже.
            recordBandit(complexityBucket, key, full.trim().length >= MIN_ANSWER_LEN);
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
            logger.error('Stream error (retry)', { key, error: err.message });
            if (!isTransientLimit(err.statusCode)) recordBandit(complexityBucket, key, false);
            res.end();
          });
          return;
        }
      } catch (err2) {
        recordRequest(key, false, err2.message);
        if (!isTransientLimit(err2.statusCode)) recordBandit(complexityBucket, key, false);
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

  if (parsedUrl.pathname === '/v1/reload' && req.method === 'POST') {
    // Hot-reload providers.json + config.json without restarting the server.
    // Auth-protected like the other admin endpoints.
    if (AUTH_KEY) {
      const apiKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const keyFromQuery = parsedUrl.searchParams.get('key');
      if (apiKey !== AUTH_KEY && keyFromQuery !== AUTH_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
    }
    try {
      const result = reloadProviders();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Reload failed: ' + err.message } }));
    }
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
      last_selection: getLastSelection(),
      bandit: getBandit(),
    }));
    return;
  }

  if (parsedUrl.pathname === '/v1/models') {
    const models = Object.entries(PROVIDERS)
      .filter(([_, p]) => p.enabled)
      .map(([key, p]) => ({
        id: p.model,
        object: 'model',
        owned_by: key,
        category: p.category || 'general',
        vision: p.vision === true,
        latency_ms: getHealth()[key]?.latency || null,
      }));
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

  // POST /v1/shorts — generate a vertical short video via the tools generator.
  // Body: { prompt, duration?, format? ("9:16"/"16:9"/"1:1"), steps? }
  if (parsedUrl.pathname === '/v1/shorts' && req.method === 'POST') {
    if (AUTH_KEY) {
      const apiKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
      if (apiKey !== AUTH_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
    }
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        if (!params.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'prompt is required' } }));
          return;
        }
        const { execFile } = require('child_process');
        const toolsDir = path.join(__dirname, 'tools');
        const py = path.join(toolsDir, '.venv', 'bin', 'python');
        const script = path.join(toolsDir, 'generate_shorts.py');
        const args = [script, params.prompt];
        if (params.duration) args.push('--duration', String(params.duration));
        if (params.format) args.push('--format', params.format);
        if (params.steps) args.push('--steps', String(params.steps));
        logger.info('Shorts generation requested', { prompt: params.prompt.slice(0, 60) });
        execFile(py, args, { cwd: toolsDir, timeout: 600000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            logger.error('Shorts generation failed', { error: err.message, stderr: String(stderr).slice(0, 300) });
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Generation failed: ' + err.message, detail: String(stderr).slice(0, 300) } }));
            return;
          }
          // Parse absolute .mp4 paths from stdout
          const files = String(stdout).split('\n')
            .map(l => l.trim())
            .filter(l => l.includes('.mp4') && l.startsWith('/'))
            .map(l => l.split(' ').pop().trim());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, files, stdout: String(stdout).slice(0, 2000) }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid request: ' + e.message } }));
      }
    });
    return;
  }

  // --- Setup Dashboard API ---
  if (parsedUrl.pathname === '/v1/setup/keys' && req.method === 'GET') {
    const { keys } = readKeys();
    // Mask keys for display; inputs stay EMPTY so we never send masked values back.
    const masked = {};
    const empty = {};
    for (const [k, v] of Object.entries(keys)) {
      empty[k] = '';
      if (!v) { masked[k] = ''; continue; }
      if (v.length <= 10) { masked[k] = v.slice(0, 2) + '***' + v.slice(-2); continue; }
      masked[k] = v.slice(0, 4) + '***' + v.slice(-4);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ groups: KEY_GROUPS, keys: empty, masked }));
    return;
  }

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
    let testKey = parsedUrl.searchParams.get('apiKey');
    if (!envVar) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'envVar required' } }));
      return;
    }
    // If apiKey param is empty/absent, validate the real stored key from .env.
    if (!testKey) {
      testKey = getStoredKey(envVar);
    }
    if (!testKey) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ valid: false, error: 'Нет сохранённого ключа' }));
      return;
    }
    validateKey(envVar, testKey).then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  logger.info('Freegate started', { port: PORT });
  console.log('Dashboard: http://localhost:' + PORT + '/');
});

process.on('SIGINT', () => { require('./lib/health').saveState(); cache.persist(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { require('./lib/health').saveState(); cache.persist(); server.close(() => process.exit(0)); });
