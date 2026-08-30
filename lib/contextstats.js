// lib/contextstats.js
// Контекстная телеметрия: агрегаты «где теряется контекст» по бакетам
// isoHour|provider. Zero-dep, никогда не бросает, переживает рестарты через
// stats.context в state.json (см. lib/health.js).

const ISO_HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:00$/;
const RETENTION_MS = 7 * 24 * 3600 * 1000;

function isoHourOf(ts) {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13) + ':00'; // "2026-08-29T20:00"
}

function tsOfHour(hour) {
  return Date.parse(hour + ':00Z');
}

function emptyBucket(hour, provider) {
  return {
    key: hour + '|' + provider,
    hour,
    provider,
    ts: tsOfHour(hour),
    requests: 0,
    sumEst: 0,
    sumReal: 0,
    ratioSum: 0,
    ratioMax: 0,
    nearWindow: 0,
    overWindow: 0,
    compactCount: 0,
    upgradedCount: 0,
    memoryCount: 0,
    cacheExact: 0,
    cacheSem: 0,
    status200: 0,
    status400: 0,
    status429: 0,
    statusOther: 0,
    sysShareSum: 0,
  };
}

class ContextStats {
  constructor() {
    this.buckets = new Map(); // key -> bucket
  }

  record(m) {
    try {
      if (!m || typeof m !== 'object') return;
      const provider = (typeof m.provider === 'string' && m.provider.length > 0) ? m.provider : 'unknown';
      const hour = isoHourOf(typeof m.ts === 'number' && m.ts > 0 ? m.ts : Date.now());
      const key = hour + '|' + provider;
      let b = this.buckets.get(key);
      if (!b) { b = emptyBucket(hour, provider); this.buckets.set(key, b); }

      b.requests++;
      if (typeof m.est === 'number' && m.est > 0) b.sumEst += m.est;
      if (typeof m.real === 'number' && m.real > 0) {
        b.sumReal += m.real;
        const win = (typeof m.win === 'number' && m.win > 0) ? m.win : 0;
        if (win > 0) {
          const ratio = m.real / win;
          b.ratioSum += ratio;
          if (ratio > b.ratioMax) b.ratioMax = ratio;
          if (m.real > win) b.overWindow++;
          else if (ratio >= 0.9) b.nearWindow++;
        }
      }
      if (m.compacted) b.compactCount++;
      if (m.upgraded) b.upgradedCount++;
      if (m.memory) b.memoryCount++;
      if (m.cacheType === 'exact') b.cacheExact++;
      else if (m.cacheType === 'semcache') b.cacheSem++;
      if (typeof m.sysShare === 'number' && m.sysShare > 0 && m.sysShare <= 1) b.sysShareSum += m.sysShare;
      const st = typeof m.status === 'number' ? m.status : 0;
      if (st === 200) b.status200++;
      else if (st === 400) b.status400++;
      else if (st === 429) b.status429++;
      else if (st > 0) b.statusOther++;
    } catch (err) {
      // Никогда не валим запрос из-за телеметрии.
    }
  }

  prune() {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [key, b] of this.buckets) {
      if (b.ts < cutoff) this.buckets.delete(key);
    }
  }

  snapshot(windowMs = RETENTION_MS) {
    this.prune();
    const cutoff = Date.now() - windowMs;
    const out = [];
    for (const b of this.buckets.values()) {
      if (b.ts < cutoff) continue;
      out.push(b);
    }
    out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    return { buckets: out };
  }

  serialize() {
    this.prune();
    return { buckets: [...this.buckets.values()] };
  }

  load(saved) {
    try {
      this.buckets = new Map();
      if (!saved || !Array.isArray(saved.buckets)) return;
      const now = Date.now();
      for (const raw of saved.buckets) {
        if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string') continue;
        const sep = raw.key.indexOf('|');
        if (sep < 0) continue;
        const hour = raw.key.slice(0, sep);
        const provider = raw.key.slice(sep + 1);
        if (!ISO_HOUR_RE.test(hour) || provider.length === 0) continue;
        const b = emptyBucket(hour, provider);
        for (const f of Object.keys(b)) {
          if (f === 'key' || f === 'hour' || f === 'provider' || f === 'ts') continue;
          if (typeof raw[f] === 'number' && raw[f] >= 0) b[f] = raw[f];
        }
        if (b.ts > now - RETENTION_MS) this.buckets.set(b.key, b);
      }
    } catch (err) {
      this.buckets = new Map();
    }
  }

  summary(now = Date.now()) {
    const winMs = 24 * 3600 * 1000;
    const cutoff = now - winMs;
    let totalRequests = 0;
    let ratioSum = 0;
    let ratioMax = 0;
    let nearWindow = 0;
    let overWindow = 0;
    let compactCount = 0;
    let upgradedCount = 0;
    let cacheHits = 0;
    let sysShareSum = 0;
    let sysShareRequests = 0;
    const providers = {};

    for (const b of this.buckets.values()) {
      if (b.ts < cutoff) continue;
      totalRequests += b.requests;
      ratioSum += b.ratioSum;
      if (b.ratioMax > ratioMax) ratioMax = b.ratioMax;
      nearWindow += b.nearWindow;
      overWindow += b.overWindow;
      compactCount += b.compactCount;
      upgradedCount += b.upgradedCount;
      cacheHits += b.cacheExact + b.cacheSem;
      if (b.sysShareSum > 0) { sysShareSum += b.sysShareSum; sysShareRequests += b.requests; }
      const p = providers[b.provider] || (providers[b.provider] = { requests: 0, nearWindow: 0, overWindow: 0, compactCount: 0, upgradedCount: 0 });
      p.requests += b.requests;
      p.nearWindow += b.nearWindow;
      p.overWindow += b.overWindow;
      p.compactCount += b.compactCount;
      p.upgradedCount += b.upgradedCount;
    }

    const narrowProviders = Object.keys(providers)
      .filter(k => providers[k].requests >= 20 && providers[k].nearWindow / providers[k].requests >= 0.2)
      .sort();

    let status = 'OK';
    if (overWindow > 0) status = 'OVERFLOW';
    else if (sysShareRequests > 0 && sysShareSum / sysShareRequests >= 0.5) status = 'SYS_HEAVY';
    else if (narrowProviders.length > 0) status = 'NARROW';

    return {
      status,
      totalRequests,
      ratePerHour: Math.round((totalRequests / 24) * 10) / 10,
      avgRatio: totalRequests > 0 && ratioSum > 0 ? Math.round((ratioSum / totalRequests) * 1000) / 1000 : 0,
      ratioMax: Math.round(ratioMax * 1000) / 1000,
      nearWindow,
      overWindow,
      narrowProviders,
      compactCount,
      upgradedCount,
      cacheHits,
      cacheHitRate: totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 100) : 0,
      avgSysShare: sysShareRequests > 0 ? Math.round((sysShareSum / sysShareRequests) * 1000) / 1000 : 0,
      providers,
    };
  }
}

module.exports = { ContextStats, isoHourOf, tsOfHour };