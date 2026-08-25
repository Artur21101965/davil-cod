# Freegate: Thompson Sampling Bandit для выбора провайдера

> Дата: 2026-08-25

## Goal

Заменить эвристический весовой выбор провайдера (score/latency + множители reliability) на **Thompson sampling bandit** (Beta-Bernoulli) с бакетами по сложности. Модель реально «обучается» под задачи пользователя: простые запросы → быстрые модели, сложные → мощные, с учётом качества ответа.

## Мотивация

Текущий выбор (server.js:272-318) использует `weight = score/latency` + ручные множители (reliability ×1.3 / ×0.5, todayFails ×0.4/×0.05). Проблемы:
- **Одна оценка успеха на все задачи** — модель хорошая для кода, но плохая для рассуждений усредняется в один показатель.
- **Эвристические пороги** (5 фейлов, 20 фейлов, ratio 1.0) — произвольные, не адаптируются.
- **Нет учёта качества ответа** — success = HTTP 200, а не «ответ не мусор».

Bandit решает: **отдельные приоры на бакет сложности**, **математически обоснованный выбор** (Thompson sampling), **учёт качества** (success = не пустой и не мусорный ответ).

## Архитектура

### 1. `lib/bandit.js` — чистый алгоритм (без зависимостей, тестируемый)

```javascript
// Бакеты сложности (как в Ruflo model-router).
function bucket(complexity) {
  if (complexity < 0.4) return 'low';
  if (complexity < 0.7) return 'med';
  return 'high';
}

// Thompson sampling: сэмпл из Beta(alpha, beta).
// Beta(1,1) = uniform (холодный старт, равновероятно).
function sampleBeta(alpha, beta) {
  if (alpha <= 0 || beta <= 0) return 0.5;
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  const denom = x + y;
  return denom > 0 ? x / denom : 0.5;
}

// Для каждого провайдера в бакете рисуем сэмпл Beta(a+1, b+1),
// выбираем провайдера с максимальным сэмплом.
function pick(scored, bucketPriors) {
  let best = null;
  let bestVal = -Infinity;
  for (const { key, weight } of scored) {
    const prior = bucketPriors[key] || { a: 1, b: 1 };
    const sample = sampleBeta(prior.a + weight, prior.b + 1);
    if (sample > bestVal) { bestVal = sample; best = key; }
  }
  return best;
}

// Обновление приоров после исхода.
function recordOutcome(bucketPriors, key, success) {
  bucketPriors[key] = bucketPriors[key] || { a: 1, b: 1 };
  if (success) bucketPriors[key].a += 1;
  else bucketPriors[key].b += 1;
}
```

**`sampleGamma`** — стандартный алгоритм Марсальи-Цанга (Marsaglia-Tsang) для γ-распределения:
```javascript
function sampleGamma(shape) {
  // Marsaglia-Tsang: для shape >= 1
  let d, c, x, v, u;
  d = shape - 1/3;
  c = 1 / Math.sqrt(9*d);
  while (true) {
    do { x = Math.random(); v = -1 + 1.2 * x; } while (v <= 0);
    v = v * v * v;
    u = Math.random();
    if (u < 1 - 0.0331 * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
```
(Для shape < 1 можно использовать подъём: sampleGamma(shape+1) * Math.pow(Math.random(), 1/shape).)

### 2. `lib/health.js` — bandit-приоры в state

Добавить в `stats`:
```javascript
bandit: { low: {}, med: {}, high: {} }   // { [key]: { a, b } }
```

Функции:
```javascript
function getBandit() { return stats.bandit; }
function recordBandit(bucket, key, success) {
  stats.bandit[bucket] = stats.bandit[bucket] || {};
  stats.bandit[bucket][key] = stats.bandit[bucket][key] || { a: 1, b: 1 };
  if (success) stats.bandit[bucket][key].a += 1;
  else stats.bandit[bucket][key].b += 1;
}
```

Персист — через существующий `saveState()` (state.json сохраняет stats целиком).

### 3. `server.js` — интеграция

**Выбор:**
- `classifyComplexity(body.messages)` → `complexity` → `bucket`
- Вместо `weight = score/latency + множители reliability` → для каждого провайдера `sampleBeta(prior.a + weight, prior.b + 1)` где `prior` из bandit-бакета.
- **Сохранить safety-слои** (не заменяются bandit'ом):
  - ratelimited штраф ×0.05 (умножается на weight до сэмпла)
  - target буст ×1.15
  - dailyLimit фильтр (underLimit пул)
  - circuit breaker (исключение из пула)
- `weight` = базовый `score/latency` (используется как добавка к alpha в sampleBeta: `a + weight`), НЕ множители reliability (их заменяет bandit).

**Запись исхода:**
- В местах `recordRequest(key, true)` / `recordRequest(key, false)` добавить `recordBandit(bucket, key, success)`.
- success = HTTP 200 И ответ не мусор (не `isTooShort`). Обратите внимание: ранний guard уже делает `continue` на мусор — там записываем `recordBandit(bucket, key, false)`.
- В `allSoft` retry блоке тоже записать.

## Тестирование

- **`test/bandit.test.js`**: sampleBeta в [0,1], bucket границы (0.39→low, 0.4→med, 0.7→high), pick после обучения смещается к лучшему, бакеты изолированы (успех в low не влияет на high), recordOutcome увеличивает a/b.
- **Интеграция**: существующие 61+ тестов проходят; симуляция сходимости (как ruflo router-bandit.test).

## Критерии успеха

- Пул реально «обучается»: после серии запросов одной сложности выбирает провайдера, дающего не-мусорные ответы.
- Бакеты изолированы (простая задача не наказывает провайдера за фейлы на сложной).
- Safety-слои (circuit breaker, dailyLimit, vision, target буст) не сломаны.
- 61+ тестов, npm publish, Docker push.
