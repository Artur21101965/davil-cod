// lib/strategy.js — дополнительные стратегии роутинга (по мотивам OmniRoute).
// Базовый выбор в Freegate — weighted (скор/латентность + категория + лимиты).
// Здесь — опциональные модификаторы, которые НЕ заменяют основной скоринг, а
// подмешивают к нему равномерность использования (round-robin / least-used),
// чтобы не «прилипать» к одному провайдеру и ровнее расходовать free-лимиты.
//
// Управление: config.routing.strategy = 'weighted' | 'weighted-roundrobin' | 'weighted-least'.
// Всегда остаётся fallback на weighted (стратегия лишь меняет вес, не исключает).

const STRATEGIES = ['weighted', 'weighted-roundrobin', 'weighted-least'];

const ROUND_ROBIN_BOOST = 1.6;   // во сколько раз поднимаем «следующего по кругу»
const LEAST_USED_BOOST = 1.5;    // поднимаем провайдеров с наименьшим использованием

// Кольцевой счётчик round-robin по совокупности провайдеров.
let rrCursor = 0;

function normalizeStrategy(value) {
  const s = String(value || 'weighted').toLowerCase();
  return STRATEGIES.includes(s) ? s : 'weighted';
}

// Вернуть функцию-модификатор веса для конкретного провайдера.
// ctx: { key, provider, usedTodayList } — usedTodayList: {key: count} за день.
function makeWeightModifier(strategy, ctx = {}) {
  const s = normalizeStrategy(strategy);
  if (s === 'weighted') {
    return () => 1; // ничего не меняем
  }

  const usedTodayList = ctx.usedTodayList || {};

  if (s === 'weighted-roundrobin') {
    // Поднимаем провайдера, который «следующий по кругу». Простейшая реализация:
    // модуль хранит курсор; при выборе провайдера cursor == его позиции — буст.
    const keys = ctx.keys || [];
    const nextKey = keys.length > 0 ? keys[rrCursor % keys.length] : null;
    rrCursor++;
    return (key) => (key === nextKey ? ROUND_ROBIN_BOOST : 1);
  }

  if (s === 'weighted-least') {
    // Поднимаем тех, кто использован меньше среднего.
    const counts = Object.values(usedTodayList);
    const avg = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
    return (key) => {
      const used = usedTodayList[key] || 0;
      return used < avg ? LEAST_USED_BOOST : 1;
    };
  }

  return () => 1;
}

function resetRoundRobin() { rrCursor = 0; }

module.exports = { STRATEGIES, normalizeStrategy, makeWeightModifier, resetRoundRobin, ROUND_ROBIN_BOOST, LEAST_USED_BOOST };
