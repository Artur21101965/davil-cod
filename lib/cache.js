// lib/cache.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeMessages } = require('./normalize');

const MAX_SIZE = 500;
const DEFAULT_TTL = 3600000; // 1 hour in ms
const MAX_ENTRY_BYTES = 256 * 1024; // don't persist responses larger than 256KB
const CACHE_PATH = path.join(__dirname, '..', 'cache.json');

class LRUCache {
  constructor(maxSize = MAX_SIZE, ttl = DEFAULT_TTL, skipLoad = false, useNormalize = false) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.useNormalize = useNormalize;
    if (!skipLoad) this.load();
  }

  _key(model, messages, temperature) {
    let raw;
    if (this.useNormalize) {
      const norm = normalizeMessages(messages);
      // Пустая нормализация (только картинки/инструменты без текста) НЕ должна
      // схлопывать разные запросы в один ключ — fallback на точное совпадение.
      raw = norm
        ? `${model}|${norm}|${temperature || 0}`
        : `${model}|${JSON.stringify(messages)}|${temperature || 0}`;
    } else {
      raw = `${model}|${JSON.stringify(messages)}|${temperature || 0}`;
    }
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  load() {
    // Restore persisted cache from disk (survives restarts)
    try {
      const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      if (data && Array.isArray(data.entries)) {
        const now = Date.now();
        for (const e of data.entries) {
          if (now - e.created > this.ttl) continue;
          this.cache.set(e.key, { value: e.value, created: e.created, uses: e.uses || 0 });
        }
        // Restore hit/miss counters so hitRate survives restarts
        if (typeof data.hits === 'number') this.hits = data.hits;
        if (typeof data.misses === 'number') this.misses = data.misses;
      }
    } catch {}
  }

  persist() {
    try {
      const now = Date.now();
      const entries = [];
      for (const [key, entry] of this.cache) {
        if (now - entry.created > this.ttl) continue;
        try {
          const size = Buffer.byteLength(JSON.stringify(entry.value));
          if (size > MAX_ENTRY_BYTES) continue;
          entries.push({ key, value: entry.value, created: entry.created, uses: entry.uses || 0 });
        } catch {}
      }
      // Keep only the most recent 300 on disk to bound file size
      const trimmed = entries.slice(-300);
      fs.writeFileSync(CACHE_PATH, JSON.stringify({
        saved: Date.now(),
        hits: this.hits,
        misses: this.misses,
        entries: trimmed,
      }));
    } catch {}
  }

  get(model, messages, temperature) {
    const key = this._key(model, messages, temperature);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() - entry.created > this.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Hot entries: bump TTL + usage count so frequently-used responses
    // stay cached longer (mirrors DeepSeek-style high cache-hit rates).
    entry.created = Date.now();
    entry.uses = (entry.uses || 0) + 1;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(model, messages, temperature, value) {
    const key = this._key(model, messages, temperature);

    // Delete if exists (to update order)
    if (this.cache.has(key)) this.cache.delete(key);

    // Evict least-used entry if at capacity (not just oldest)
    if (this.cache.size >= this.maxSize) {
      let victim = null;
      let minUses = Infinity;
      for (const [k, e] of this.cache) {
        const u = e.uses || 0;
        if (u < minUses) { minUses = u; victim = k; }
      }
      if (victim) this.cache.delete(victim);
    }

    this.cache.set(key, { value, created: Date.now(), uses: 0 });
  }

  stats() {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100)
        : 0,
    };
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    try { fs.unlinkSync(CACHE_PATH); } catch {}
  }
}

// Auto-persist every 60 seconds
const _persistTimer = setInterval(() => {
  const c = module.exports._activeCache;
  if (c) c.persist();
}, 60000);

module.exports = { LRUCache, _stopTimers: () => clearInterval(_persistTimer) };
