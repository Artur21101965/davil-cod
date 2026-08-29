# Freegate — Context Telemetry (design)

**Date:** 2026-08-29
**Status:** Approved design
**Scope:** измерить, где Freegate теряет контекст — на модели (упирается в context window), на прокси (компакция запаздывает/нервет), на кэше, или на системном промпте opencode. По итогам замера — только потом решать, что строить (виртуальный контекст, окно, и т.п.). Это диагностика, не фича-продукт.

## Problem

Точный замер контекста сейчас невозможен:
- REQ-лог пишет только `latency/stream`, не размеры.
- `tokenUsage` агрегируется по провайдеру без привязки к запросу.
- Компакция/память/кэш-хиты логируются редко и бессистемно.
- Нет связи «запрос → сколько реальных токенов → какое окно модели → что произошло».

Без этих данных нельзя ответить «где узкое место» и нельзя проверить эффект будущих фич.

## Part 1 — Метрика на запрос

Единый объект `measure`, собирается по ходу обработки запроса в server.js:

| field | источник | когда |
|---|---|---|
| `origTokens` | `estimateTokens(body.messages)` | до компакции (сколько opencode прислал) |
| `sentTokens` | `estimateTokens` после `prepareMessages` | после компакции |
| `compacted` | `origTokens > afterTokens` | компакция сработала |
| `memory` | вставка фактов памяти | memory recall нашёл факты |
| `cacheType` | `miss \| exact \| semcache` | точка кэша |
| `real` | `result.data.usage?.prompt_tokens ?? sentTokens` | после ответа провайдера |
| `win` | `PROVIDERS[selectedKey].context_window \|\| 0` | после выбора провайдера |
| `sysShare` | est(system-сообщений) / sentTokens | если systemMessages > 0 |
| `status` | HTTP-статус ответа | финал |

`ratio = real / win` вычисляется при агрегировании, если `win > 0`.

## Part 2 — Агрегаторы (`lib/contextstats.js`, новый)

Единственное хранилище агрегатов, zero-dep, не бросает исключений:

- `record(measure)` — обновляет бакет; пустые поля пропускаются (запрос без `real`/`win` попадает в `requests`, но не в `ratio`).
- Бакет: `isoHour|providerKey`, где `isoHour = YYYY-MM-DDTHH:00`.
- Кумулятивные поля бакета: `requests, sumReal, sumEst, ratioSum, ratioMax, nearWindow, overWindow, compactCount, memoryCount, cacheExact, cacheSem, status200, status400, status429, statusOther, sysShareSum`.
  - `nearWindow` — запросов с `ratio >= 0.9`.
  - `overWindow` — запросов с `real > win` (фактический отказ по контексту).
- `snapshot()` → читаемый объект для dashboard/CLI.
- `load(snapshot)` / данные хранятся в `stats.context` (state.json, персист каждые 30с через `health.saveState`); `health.js` хранит ссылку на `context`-объект.
- **Retention:** prune бакетов старше 7 дней при save (168h × 21 провайдер ≈ 3.5k бакетов — ~350KB).
- Анти-коррапт: `load()` валидирует `isoHour` (regex `^\d{4}-\d{2}-\d{2}T\d{2}:00$`) и `provider` (непустая строка); битые поля отбрасываются. `stats.context` отсутствует/корраптен → пустые агрегаты.

## Part 3 — Аналитика «узкого места» (`contextSummary`)

В `/health` добавляется `contextSummary`:

- `totalRequests`, `ratePerHour` (windowed: последние 24ч).
- **Ближний флаг провайдеров:** для провайдера с `requests >= 20` считаем `pNear = nearWindow/requests`. `pNear >= 0.2` → `NARROW` (компакция запаздывает), иначе `OK`.
- **Глобальные аномалии:** `overWindow > 0` → `OVERFLOW` (эстимейты/компакция всё ещё пропускают запросы за окно); `avgSysShare >= 0.5` → флаг `SYS_HEAVY` (контекст съедает системный промпт opencode, не диалог).
- Итоговая строка-статус: приоритет `OVERFLOW > SYS_HEAVY > NARROW > OK` — отвечает «где теряется контекст».

## Part 4 — Вывод

**Dashboard (HTML, `lib/dashboard.js`):** новый блок `#ctxBlock`:
- карточки: запросов, средний ratio, max ratio, впритык (%), поверх окна, компакций, кэш-hit% (exact+sem), итоговый статус (цветная метка).
- таблица провайдеров: `провайдер | запросы | сред.% окна | макс% | впритык% | компакций`.

**CLI `tools/context-diag.js`:** тот же вывод текстом из `state.json` (без HTTP), флаг `--hours N` (по умолчанию 24).

## Part 5 — server.js интеграция

Одна переменная `measure` на запрос; `contextstats.record(measure)` вызывается в единой точке завершения (общий хелпер/finally), чтобы никакой return не потерял замер независимо от пути (кэш-хит, ошибка, успех, стрим). Точки заполнения:
1. до компакции — `origTokens`;
2. после `prepareMessages` — `sentTokens`/`compacted`;
3. в блоке памяти — `measure.memory = true`;
4. в точках кэша — `cacheType`;
5. после ответа провайдера — `real`/`win`; `status` в финале.

## Testing (TDD)

- `test/contextstats.test.js` (новый): record/snapshot, бакет по часу, ratioMax/nearWindow/overWindow, retention-prune (7 дней), load/save round-trip, устойчивость к мусору (`record({})`, коррапт-файл), логика `contextSummary` (NARROW/OK/OVERFLOW/SYS_HEAVY).
- `test/proxy.test.js` (+): интеграция — запрос через обработчик делает запись в `snapshot()` (кэш-хит и успешный ответ).
- Весь набор `node --test test/*.test.js` зелёный + `node --check server.js lib/contextstats.js`.
- Live: несколько запросов → блок в `/health`, `node tools/context-diag.js --hours 24` показывает данные.

Коммит: `feat(contextstats): контекстная телеметрия + dashboard-блок + CLI`.

## Limits

- Это диагностика «всё впереди»: ничего не оптимизируем, только записываем и показываем.
- `est` — не-точностная метрика (занижает ~2x); используем `est` для `origTokens`/`sentTokens`/`sysShare`, но `ratio`/`near`/`over` считаем по реальным `prompt_tokens` провайдера.
- Retention 7 дней — история глубже теряется; для трендов этого достаточно.
- Dashboard остаётся текстовым HTML (без графиков) — по желанию позже.