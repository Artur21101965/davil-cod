# Freegate: Умный vision-роутинг, авто-ретраи, параллельный пробинг

> Дата: 2026-08-25

## Goal

Три независимые фичи прокачки Freegate-прокси:
1. **Умный vision-роутинг** — сложные скриншоты (код/ошибки) поднимаются на тяжёлый тир.
2. **Авто-ретрай при пустом ответе** — провайдер, вернувший пустой ответ, не блокирует запрос; переходим к следующему.
3. **Параллельный health-пробинг** — чекеры провайдеров запускаются параллельно вместо последовательного ожидания.

## Архитектура

Все три фичи — изменения в `server.js` + одна новая функция в `lib/routing.js`. Каждая фича самостоятельна, тестируется отдельно, коммитится отдельно.

### Фича 1: Умный vision-роутинг

**Файлы:**
- Modify: `lib/routing.js` — новая функция `classifyVisionComplexity(text)`
- Modify: `server.js:192` — после vision-распознавания поднять тир

**Логика `classifyVisionComplexity(text)`:**
- Возвращает 0..1, переиспользует эвристику `classifyComplexity` (код-слова, error/fix-слова, длина, `looksLikeCode`).
- Скриншот с кодом/ошибкой → высокая сложность → `maybeUpgradeTier` поднимет с tier-s на tier-splus.

**Интеграция в server.js:**
```javascript
// после vision-распознавания (строка ~192), если cleaned непустой:
const vc = classifyVisionComplexity(cleaned);
if (vc > 0) effectiveModel = maybeUpgradeTier(effectiveModel, vc);
```
`effectiveModel` уже в scope (строка 126), переопределяется до выбора провайдера.

### Фича 2: Авто-ретрай при пустом non-stream ответе

**Файлы:**
- Modify: `server.js` — цикл провайдеров (строки ~328-449)
- Modify: `lib/clean.js` — уже есть `hasContent()`, переиспользуем

**Логика:**
- Non-stream: если `!hasContent(result.data)` — не отправляем ответ, фиксируем как ошибку, `continue` к следующему провайдеру.
- Streaming: если стрим завершился с `chunks.length === 0` (ни одного токена) — не считаем успехом, переходим к следующему провайдеру.
- Максимум 2 дополнительных попытки после пустых ответов (потом 502).

### Фича 3: Параллельный health-пробинг

**Файлы:**
- Modify: `server.js:109-117` — `healthCheck()`

**Логика:**
```javascript
async function healthCheck() {
  const now = Date.now();
  const due = Object.entries(PROVIDERS)
    .filter(([key, p]) => p.enabled && !(healthIntervals[key]?.nextCheck > now));
  await Promise.allSettled(due.map(([key, provider]) => checkProvider(key, provider)));
}
```

## Тестирование

- **Фича 1:** юнит-тест `classifyVisionComplexity` в `test/routing.test.js` (код-скриншот > 0.6, фото < 0.4).
- **Фича 2:** тест `hasContent` уже есть; добавить юнит-тест на решение «пустой → continue» (через выделенную функцию-хелпер, если нужна).
- **Фича 3:** тест, что `healthCheck` вызывается параллельно (mock Promise.allSettled), либо просто регрессионный прогон.

Все существующие тесты (53) должны проходить.

## Критерии успеха

- Сложный скриншот (код с ошибкой) на tier-s → отвечает тяжёлая модель (tier-splus).
- Провайдер, вернувший пустой ответ, не «съедает» запрос — fallback к следующему.
- Health-чек 30+ провайдеров завершается за время одного запроса (не последовательно).
- 53+ тестов, npm publish, Docker push.
