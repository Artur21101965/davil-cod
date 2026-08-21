// lib/rateLimit.js
const rateLimits = {};

function checkRateLimit(serviceKey, limit, windowMs) {
  const now = Date.now();
  if (!rateLimits[serviceKey] || now - rateLimits[serviceKey].windowStart > windowMs) {
    rateLimits[serviceKey] = { count: 1, windowStart: now };
    return true;
  }
  rateLimits[serviceKey].count++;
  return rateLimits[serviceKey].count <= limit;
}

function getStats() { return rateLimits; }

module.exports = { checkRateLimit, getStats };
