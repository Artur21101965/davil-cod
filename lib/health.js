// lib/health.js
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATE_PATH = path.join(__dirname, '..', 'state.json');

let health = {};
let circuitBreakers = {};
let stats = { totalRequests: 0, successfulRequests: 0, failedRequests: 0, providerUsage: {}, errors: {}, startTime: Date.now(), tokenUsage: {} };

const MAX_RECENT = 50;
let recent = [];
let rpm = [];
let currentRpmMinute = 0;

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    health = data.health || {};
    circuitBreakers = data.circuitBreakers || {};
    const saved = data.stats || {};
    stats = {
      totalRequests: saved.totalRequests || 0,
      successfulRequests: saved.successfulRequests || 0,
      failedRequests: saved.failedRequests || 0,
      providerUsage: saved.providerUsage || {},
      errors: saved.errors || {},
      startTime: saved.startTime || Date.now(),
      tokenUsage: saved.tokenUsage || {},
    };
    logger.info('State loaded', { healthKeys: Object.keys(health) });
  } catch {
    logger.info('No state file, starting fresh');
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ health, circuitBreakers, stats }, null, 2));
  } catch (err) {
    logger.error('Failed to save state', { error: err.message });
  }
}

function initHealth(key) {
  if (!health[key]) {
    health[key] = { score: 50, latency: 0, lastCheck: 0, status: 'unknown', quota: '--' };
  }
}

function isCircuitOpen(key) {
  const cb = circuitBreakers[key];
  if (!cb || !cb.openUntil) return false;
  if (Date.now() > cb.openUntil) {
    cb.openUntil = null;
    cb.failures = 0;
    return false;
  }
  return true;
}

function recordSuccess(key) {
  circuitBreakers[key] = { failures: 0, lastFailure: 0, openUntil: null };
  initHealth(key);
  health[key].status = 'up';
  health[key].score = Math.min(100, health[key].score + 10);
}

function recordFailure(key) {
  if (!circuitBreakers[key]) circuitBreakers[key] = { failures: 0, lastFailure: 0, openUntil: null };
  const cb = circuitBreakers[key];
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= 3) {
    cb.openUntil = Date.now() + 60000;
    cb.failures = 0;
    logger.warn('Circuit breaker opened', { key });
  }
}

function recordRequest(providerKey, success, error = null) {
  recordRpm();
  stats.totalRequests++;
  if (success) {
    stats.successfulRequests++;
    stats.providerUsage[providerKey] = (stats.providerUsage[providerKey] || 0) + 1;
  } else {
    stats.failedRequests++;
    if (error) stats.errors[providerKey] = (stats.errors[providerKey] || 0) + 1;
  }
}

function recordTokens(providerKey, usage) {
  if (!usage) return;
  const tu = stats.tokenUsage[providerKey] || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  tu.promptTokens += usage.prompt_tokens || 0;
  tu.completionTokens += usage.completion_tokens || 0;
  tu.totalTokens += usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  stats.tokenUsage[providerKey] = tu;
}

function getHealth() { return health; }
function getStats() { return stats; }

function recordRecent(entry) {
  recent.unshift({ timestamp: Date.now(), ...entry });
  if (recent.length > MAX_RECENT) recent.pop();
}

function recordRpm() {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  if (minute !== currentRpmMinute) {
    currentRpmMinute = minute;
    rpm.unshift({ timestamp: now, count: 1 });
    if (rpm.length > 60) rpm.pop();
  } else if (rpm.length > 0) {
    rpm[0].count++;
  } else {
    rpm.unshift({ timestamp: now, count: 1 });
  }
}

function getRecent() { return recent; }
function getRpm() { return rpm; }

// Auto-save every 30 seconds
setInterval(saveState, 30000);

module.exports = {
  loadState, saveState, initHealth, isCircuitOpen,
  recordSuccess, recordFailure, recordRequest, recordTokens,
  getHealth, getStats,
  recordRecent, recordRpm, getRecent, getRpm,
};
