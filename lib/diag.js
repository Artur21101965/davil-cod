// Диагностика работы Freegate: успешность, классы ошибок, смена провайдеров.
// Собирает отчёт из живых данных прокси (/v1/stats + /v1/recent). Читает только
// публичные эндпоинты — можно гонять из любого окружения с доступом к порту.
function classifyErr(statusCode, reason, providerSide) {
  if (statusCode === 429) return 'limit';
  if (statusCode === 401 || statusCode === 402 || statusCode === 403) return 'auth';
  if (statusCode >= 400 && statusCode < 500) return 'invalid'; // 400/422 и т.п. — формат запроса
  if (statusCode === 0) return 'timeout'; // соединение/таймаут
  if (providerSide) return 'upstream'; // провайдер временно недоступен (5xx/404 upstream)
  // health-статусы без атрибутов кода: reason подсказывает класс.
  if (/много ошибок|лимит|429/i.test(reason || '')) return 'limit';
  if (/не отвечает|недоступен|флап|timeout/i.test(reason || '')) return 'timeout';
  return 'invalid';
}

function buildReport(stats, recent) {
  const today = stats.today || {};
  const errors = stats.errors || {};
  const health = stats.health || {};
  const ctx = stats.context_summary || {};
  const total = today.requests || 0;
  const success = today.success || 0;

  const classes = { limit: 0, auth: 0, invalid: 0, timeout: 0, upstream: 0, other: 0 };
  const byClass = {};
  for (const [key, cnt] of Object.entries(errors)) {
    const h = health[key] || {};
    const cls = classifyErr(h.statusCode, h.reason, h.providerSide);
    classes[cls] += cnt;
    byClass[key] = { errors: cnt, status: h.status || '?', reason: h.reason || '' };
  }

  const up = Object.values(health).filter((h) => h.status === 'up').length;
  const ratelimited = Object.values(health).filter((h) => h.status === 'ratelimited').length;
  const down = Object.values(health).filter((h) => h.status === 'error').length;

  // Недавние запросы — смена провайдеров / кэш.
  let recentOk = 0, recentErr = 0, cached = 0;
  const recentRows = Array.isArray(recent) ? recent : [];
  for (const r of recentRows) {
    if (r.cached) cached++;
    if (r.status === 200 || r.status === undefined) recentOk++;
    else recentErr++;
  }

  const switches = new Set();
  for (const r of recentRows) if (r.provider && r.provider !== 'cache' && r.provider !== 'semcache') switches.add(r.provider);

  return {
    version: stats.version,
    uptime: stats.uptime_seconds,
    today: { requests: total, success, failed: today.failed || 0, successRate: total > 0 ? Math.round((success / total) * 100) : null },
    classes,
    errors: byClass,
    providers: { total: Object.keys(health).length, up, ratelimited, down },
    context: { status: ctx.status, compactCount: ctx.compactCount || 0, overWindow: ctx.overWindow || 0, upgradedCount: ctx.upgradedCount || 0, cacheHitRate: ctx.cacheHitRate || 0, taskTotal: ctx.taskTotal || 0 },
    recent: { total: recentRows.length, ok: recentOk, err: recentErr, cached, providersActive: switches.size },
    provider_usage: stats.provider_usage,
    bandit: stats.bandit,
    last_selection: stats.last_selection,
  };
}

const LABELS = {
  limit: 'лимит/429 (выгорание дневных лимитов)',
  auth: '401/402/403 (неверный ключ или нет баланса)',
  invalid: '400/422 (несовместимый формат запроса)',
  timeout: 'таймаут/сетевое (провайдер не ответил)',
  upstream: 'провайдер временно недоступен (5xx/upstream 404)',
  other: 'прочее',
};
const FIXES = {
  limit: 'предохранитель выгорания / расширить пул',
  auth: 'проверить ключ/баланс в .env',
  invalid: 'санитизация unsupported-полей (reasoning_effort и т.п.)',
  timeout: 'увеличить backoff / дольше холдить флап-провайдеров',
  upstream: 'обрабатывается автоматически (circuit breaker)',
  other: 'смотреть логи',
};

module.exports = { buildReport, classifyErr, LABELS, FIXES };
