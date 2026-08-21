// lib/cache.js
const crypto = require('crypto');

const MAX_SIZE = 500;
const DEFAULT_TTL = 3600000; // 1 hour in ms

class LRUCache {
  constructor(maxSize = MAX_SIZE, ttl = DEFAULT_TTL) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  _key(model, messages, temperature) {
    const raw = `${model}|${JSON.stringify(messages)}|${temperature || 0}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
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

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, created: Date.now() });
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
  }
}

module.exports = { LRUCache };
