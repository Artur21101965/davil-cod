# Freegate — Window-Aware Auto-Upgrade (design)

**Date:** 2026-08-30
**Status:** Approved design
**Scope:** по результатам контекстной телеметрии (2026-08-29) найдено фактическое «узкое место»: запросы, которые не влезают в окно запрошенной модели, всё равно уходят на неё и молча обрезаются. Данный дизайн добавляет авто-апгрейд: когда запрос не помещается — роутим на здорового провайдера с подходящим окном, target исключается из цепочки для этого запроса.

## Background

Live-замер телеметрии (2026-08-30) дал статус `OVERFLOW`:
- `mistral-codestral` (окно 33k) получил **120k/169k prompt_tokens** при `compactCount: 0` — один крупный запрос ушёл целиком.
- Две причины:
  1. `compactOld` (compactor.js:149) ничего не сжимает, когда `old.length === 0`, т.е. **одиночное гигантское сообщение никогда не компактится** (компакция — только про многосообщные диалоги).
  2. `target-first` (server.js:504-509) безусловно ставит провайдера запрошенной модели первым — window-фильтр (server.js:439, `MIN_WINDOW 50000`) применяется только к fallback-пулу, не к target.

Следствие: пользователь запросил `tier-s` с 200k-сообщением → codestral (33k) принял запрос и ответил, **тихо потеряв контекст** — это ровно то, ради чего строилась телеметрия.

## Non-goals

- НЕ переделывать компакцию одиночных сообщений (новая фича суммаризации «головы» одиночного сообщения отдельно, если понадобится).
- НЕ менять семантику тиров/bandit-бакетов.
- НЕ калибровать `estimateTokens` (завышает реальные токены: ~1.7× кириллица, ~2.7× ASCII) — консервативная оценка на стороне fit-решения допустима и безопасна; калибровку отложить до накопления телеметрии `real/sentTokens`.

## Decision

1. **Авто-апгрейд:** если запрос не влезает в окно target → пул из здоровых провайдеров с `context_window >= requestTokens` (или `win === 0`), primary по bandit-скорингу внутри пула. Ничего не теряется, ноль доп. LLM-вызовов.
2. **Target полностью исключается** из цепочки для ЭТОГО запроса — недопустимо «тихо отдать» усечённый ответ с потерянным контекстом.
3. **Компакция пропускается в upgrade-режиме:** суммаризатор не должен сжимать контекст, который большой провайдер возьмёт целиком (своё одиночное гигантское сообщение и так не компактится — см. Background).

## Part 1 — Decision point (server.js, до компакции)

Сразу после vision-пайплайна (перед текущим блоком `prepareMessages`, строка ~324), но **после** возможного vision-апгрейда target:

```js
const requestTokens = estimateTokens(body.messages);
const targetWin = PROVIDERS[targetProviderKey]?.context_window || 0;
const oversized = targetWin > 0 && requestTokens > targetWin * WINDOW_FIT_FACTOR;
```

Константа `WINDOW_FIT_FACTOR = 1.5` (server.js). Обоснование: est завышает real в ~1.7× (кириллица) — при `est > 1.5 × win` реальные токены на проводе почти гарантированно превышают окно; ниже — реально влезает, остаёмся на запрошенной модели. Консервативная граница: часть ASCII-запросов будет поднята «лишний раз», это дешёво (minimax 1M), и телеметрия `upgradedCount` даст данные для калибровки.

В upgrade-режиме:
- `prepareMessages` не вызывается (существующие строки 324-335 запишут `origTokens === sentTokens` как есть).
- Заметка: у target `win > 0` и (из условия) `win < requestTokens` → target **уже не проходит** capable-фильтр; «пропуск target-first» лишь не возвращает его обратно в цепочку.

## Part 2 — Routing (server.js)

- `windowPool` вычисляется как сейчас (строка 439), но при `oversized` фильтр `win >= requestTokens || win === 0` применяется **без гейта** `MIN_WINDOW`.
- **`target-first` блок (строка 504) пропускается**, если `oversized`.
- `enabledProviders` строится как сейчас (selected по bandit внутри capable-пула + restOfPool по health-score): target в пул не входит, т.к. его `win < requestTokens`.
- **Capable-пул пуст** (ни один здоровый провайдер не держит запрос): best-effort на самый большой `context_window` среди здоровых, `measure.upgraded = true` (сигнал OVERFLOW ловится существующим статусом). Target остаётся исключён (он всё равно не держит).

## Part 3 — Телеметрия (дополнение)

- Новое поле меры `upgraded` (1/0) → агрегат **`upgradedCount`** в бакете `contextstats` (добавляется в whitelist числовых полей `load()` для анти-коррапта + `snapshot`/`summary`).
- Выводы: строка `Апгрейдов (окно): N` в `tools/context-diag.js`; бейдж/счётчик в `#ctxBlock` dashboard (`upgraded` в `context_summary`).
- `measure.win` и `measure.provider` по-прежнему переписываются на фактически ответившего провайдера в терминальных точках (строки ~782/869) — при апгрейде отображают реальную модель.
- Статус `OVERFLOW` не меняется: он теперь означает «даже best-effort не поместился» либо «компакция всё ещё пропускает».

## Edge cases

| Случай | Поведение |
|---|---|
| `targetWin === 0` (окно неизвестно) | апгрейд не срабатывает, как сейчас |
| `requestTokens <= 1.5×winT` | обычный путь: компакция с окном target + target-first |
| `win === 0` у провайдера в capable-пуле | держится в пуле (эвристика «лучше попробовать»), идёт после known-capable |
| Память вспомнила факты в upgrade-режиме | чуть увеличивает отправляемый объём сверх `requestTokens` — запас есть (фильтр по `win >= requestTokens` + фактор 1.5) |
| Все trim/стрим-точки | апгрейд прозрачен: `commit()` уже пишет фактического провайдера |

## Testing (TDD)

1. **`lib/routing.js`**: новый экспорт `WINDOW_FIT_FACTOR`; хелпер `needsWindowUpgrade(targetWin, requestTokens, factor)` (возвращает bool; `targetWin <= 0` → false). Юнит-тесты `test/routing.test.js` (новый файл): детерминированно, без сети.
2. **`test/proxy.test.js`** (структурный): в обработчике `server.js` при `oversized` (гигантский одиночный промпт на `tier-s`) — `prepareMessages` не вызывается, `target-first` пропущен, `measure.upgraded === true`, компакция не считалась.
3. **`test/contextstats.test.js`**: агрегация `upgradedCount` в `snapshot()`/`summary()`, whitelist в `load()` (round-trip с `upgraded`), строка в CLI-рендере (если он покрыт тестом).
4. **Live-проверка** (после деплоя): 120k-запрос на `tier-s` → ответ приходит от minimax/dots (не codestral), `/health` показывает `upgradedCount > 0`, в бакетах codestral больше не появляются `overWindow` на больших запросах.

## Files

- `server.js` — decision point + routing (удаление/скип target-first при oversized), константа.
- `lib/routing.js` — хелпер `needsWindowUpgrade` + `WINDOW_FIT_FACTOR`.
- `lib/contextstats.js` — поле `upgradedCount` (record/snapshot/summary/load-whitelist).
- `tools/context-diag.js` — строка апгрейдов.
- `lib/dashboard.js` — счётчик в `#ctxBlock`.
- `test/routing.test.js`, `test/proxy.test.js`, `test/contextstats.test.js`.
- `PROJECT_MEMORY.md` — заметка в «Ключевые решения» / удалить пункт из «Известные проблемы».