// lib/pool.js — per-provider concurrency limiting.
// Ensures at most N requests hit a provider simultaneously, so burst traffic
// can't burn daily limits in seconds or trip provider rate limits (429).
// Requests beyond the limit wait in a FIFO queue until a slot frees up.

const DEFAULT_CONCURRENCY = 6;

const slots = {};   // providerKey -> { active, queue: [] }

function acquire(key, max = DEFAULT_CONCURRENCY) {
  if (!slots[key]) slots[key] = { active: 0, queue: [] };
  const s = slots[key];
  if (s.active < max) {
    s.active++;
    return Promise.resolve(() => release(key));
  }
  return new Promise((resolve) => {
    s.queue.push(resolve);
  }).then(() => {
    s.active++;
    return () => release(key);
  });
}

function release(key) {
  const s = slots[key];
  if (!s) return;
  s.active = Math.max(0, s.active - 1);
  const next = s.queue.shift();
  if (next) next();
}

function stats() {
  const out = {};
  for (const [key, s] of Object.entries(slots)) {
    out[key] = { active: s.active, queued: s.queue.length };
  }
  return out;
}

module.exports = { acquire, release, stats };
