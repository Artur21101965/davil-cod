# Freegate — Project Memory

Ключевые решения и знания. Читай перед изменениями в прокси.

## Архитектура
- **Прокси**: Node.js, zero-dependency, модули в `lib/` (cache, clean, compactor, dashboard, health, logger, memory, memory-store, providers, rateLimit, vision)
- **Провайдеры**: каталог в `providers.json`, пользовательские в `config.json` (overlay). Ключи ТОЛЬКО в `.env`
- **Память**: `memStore` (lib/memory.js + memory-store.js) — векторные факты в `memory.json`, автосейв 60с + на SIGTERM
- **Отдельно**: прокси логика (server.js + lib/) и генератор шортс (tools/, Python)

## Ключевые решения
- **Health-проверки через `/models`** (не реальный запрос) — иначе сжигаются дневные лимиты провайдеров (Groq лимитит по запросам/день). НЕ возвращать обратно без крайней нужды.
- **Ретраи не при 429/401/404** — только жгут лимит.
- **Кап latency 60s** — зависшие запросы не должны «отравлять» выбор провайдера.
- **tier-алиасы маршрутизируются на целевую модель первой** — иначе агент попадает на Nemotron-120b (думает вслух, слитный ответ).
- **Провайдеры с >20 ошибок сегодня** почти исключаются из выбора (восстанавливаются на следующий день).
- **Стриминг кэшируется** — повторные промпты из кэша за ~50ms.
- **Семантический кэш** (lib/semcache.js): char-trigram dice 0.85 — ловит перефразы только ДЛИННЫХ диалогов; короткие (0.80-0.84) неотличимы от опасных подмен фактов, сознательно не кэшируются. `provider: semcache` в логе.
- **Контекстная телеметрия** (lib/contextstats.js): бакеты `час|провайдер`, aggregates в `stats.context` (state.json, автосейв 30с). Экспозиция: `context` в `/health`, `context_summary` в `/v1/stats`, карточка «Контекст» в dashboard, CLI `node tools/context-diag.js --hours N [--json]`. Статус: `OVERFLOW > SYS_HEAVY > NARROW > OK`. Один measure на запрос (записывается только в терминальных точках: кэш/успех/стрим/финальные ошибки).
- **Окно-осознанный авто-апгрейд** (server.js + lib/routing.js `needsWindowUpgrade`): запрос с `est > win×1.5` (WINDOW_FIT_FACTOR) не влезает в окно target → компакция пропускается, target исключается из цепочки, провайдер выбирается из capable-пула (`win >= requestTokens || win === 0`). Считается `upgradedCount` в телеметрии.
- **Компакция** (lib/compactor.js): порог 60k токенов, `CHARS_PER_TOKEN=1.5` (намеренно консервативно; opencode «264k» ≈ ~2× прокси-оценки), keep_recent 30k. Оценка по символам, сжимает слишком большие диалоги.
- **Долговременная память**: при компакции summarizer отдаёт JSON `{summary, facts}` — факты автоматически в `memory.json` (0 доп. LLM-вызовов). Перед кэшем запрос анализируется, релевантные факты добавляются **user-сообщением** `[Память: ...]` после system (кэш-ключ строится из user → разные факты = разные ключи, без отравления кэша).
- **Productive Agent Layer** (30.08): инженерная дисциплина в запросе — `lib/taskclassify.js` классифицирует задачу (coding/reasoning/search/chat без LLM), `lib/methodology.js` вставляет короткий системный промпт-методолог после памяти/до кэша (system игнорируется normalize → кэш не отравляется), `server.js` бустит вес моделей под категорию. Метрика `tasks`/`taskTotal` в contextstats → `/health` и `/v1/stats`, карточка «Контекст» + `tools/context-diag.js`. Toggle: `config.methodology.enabled` (по умолчанию true). Промпты настраиваются: `config.methodology.prompts.{category}` переопределяет дефолт для категории. Тексты-методологи — производный сжатый текст по мотивам superpowers (MIT, атрибуция в `docs/methodology/README.md`).
- **Самообновляющаяся база моделей** (30.08): планировщик встроен в server.js (`config.modelManager`, дефолт 6ч, ±10мин джиттер, первый цикл через 2мин; crontab-строка удалена). Модули: `lib/modeldb.js` (ModelDB + computeScore: successRate 0.4/латентность 0.3/окно 0.2/свежесть 0.1, models-db.json — атомарный tmp+rename), `lib/modelscan.js` (адаптеры источников; весь fetch injectable — тесты без сети; параллельный тест concurrency 5; **SOURCES без mistral/deepseek** — там платные модели), `lib/modelmanager.js` (single-flight цикл; seed каталога с флагом `seeded`; dead только при 404/402; перепроверка dead через `recheckDisabledDays`=7 → реактивация; user-disabled не трогается никогда; write-back priority ТОЛЬКО для не-seeded ключей; **isAutoAddable — автодобавляет только гарантированно-бесплатные**: `:free` или free-семейства по источнику, платные (mistral-medium/deepseek-v4-pro/GLM-5.2) отбрасываются). Ручные приоритеты в providers.json не перезаписываются. Экспозиция: `/v1/models-db` (auth), карточка «База моделей» в dashboard, CLI `tools/models-db.js`, `scripts/auto-manage-models.js` = тонкая обёртка над циклом.
- **Анти-спираль 429** (30.08): target-first цепочка пропускает target-модель, если она `ratelimited` или дневной лимит ≥90% (`targetBurned`) — иначе каждый запрос жёг бесполезную 429-попытку и каскадом валил пул. Каталог ужат с 82 до 34 проверенных free-моделей (убраны mistral-*-дубли, hf-дубли, платные deepseek-v4-pro/mistral-medium/magistral, локальные ollama/lmstudio); models-db приведена к каталогу (stale-записи удалены).
- **Крутящийся пул по дневным лимитам** (30.08): `usedTodayFor(key)` из `dailyUsage[..][today]`; провайдер, исчерпавший дневной лимит, исключается из выбора (`exemptables`), возвращается в `windowPool` только если живы все выгорели. Исчерпанные штрафуются ×0.03 (резерв), ≥90% — ×0.4. Исправлен баг: раньше штраф считался по всевременному `providerUsage` (всегда ~0.5, не отражал лимит) и при всех выгоревших пул не сужался. Live: с 18:30 ни одного 429, 8/8 стресс-запросов 200. Метрика `today` в `/v1/stats` (successRate по `reliability` за день).
- **Дашборд** (lib/dashboard.js): редизайн 30.08 — sticky KPI-полоска + 5 табов (Обзор/Провайдеры/Модели/Контекст/Настройки). Zero-dep, инлайн CSS/JS, **двухязычный RU/EN** (словарь I18N, `setLang`, localStorage, автодетект). Провайдеры — таблица с поиском/фильтрами-чипсами/сортировкой/лимит-барами; Модели — таблица из /v1/models-db + **тумблер вкл/выкл + «Тест» из UI + блок «Что включить»** (рекомендации); Обзор — алерты + RPM-график + недавние + кэш/токены/очередь; Контекст — телеметрия + категории задач прогресс-барами; Настройки — setup-панель /v1/setup/* (двухязычные KEY_GROUPS: name/desc/steps + _en). Endpoints: `/v1/models/{key}/toggle` (flip enabled в config.json → hot-reload → статус untested/user-disabled), `/v1/models/{key}/test` (живой hi-тест → markChecked). Обновление 5с (модели 30с).
- **Тир-маппинг**: tier-s→codestral, tier-splus/tier-l→minimax-m3, tier-xl→dots-3, Best→minimax-m3.
- **404**: «does not exist» → permanent disable; «Provider returned error» → короткий circuit-breaker 70с, не отключает провайдера.
- **Bandit-прогрев**: холодные приоры {1,1} или ≤4 испытаний → {a:6,b:2} при старте сервера.

## Известные проблемы
- **НЕ компактится одиночное гигантское сообщение** (compactor.js `compactOld`, `old.length===0`): крупный user-промпт >30k токенов уходит целиком — `kodestral` (win 33k) получает 120k+ prompt_tokens. В телеметрии виден как `OVERFLOW` c `compactCount:0`. Фикс: суммировать одиночный промпт/режется хвост, а НЕ полный диалог.
- ~~Window-aware роутинг обходит primary-target~~ **ИСПРАВЛЕНО 30.08**: `target-first` пропускается при `windowUpgraded`, target исключается, апгрейд идёт на capable-пул (см. окно-осознанный авто-апгрейд).
- **Gemini** часто в квоте (429) — формат правильный, но лимит. Восстанавливается.
- **Nemotron-120b/550b** отвечают думанием вслух — отключены в активном конфиге.
- **Локальные модели (Ollama)** — на слабом Mac не использовать (9GB RAM).
- ~~Mojibake в русском ответе~~ **ИСПРАВЛЕНО 26.08**: `data += chunk` / `chunk.toString()` дробили multi-byte UTF-8 на '' (символ `р` резался по байтам). Теперь везде `StringDecoder('utf8')` (providers.js + server.js, streams/cache/retry).
- **Категория minimax-m3**: `or-minimax-m3-free` была `vision` (ложная классификация из старого автопоиска, 'multimodal' в описании OpenRouter) — исправлено на `general`. Иначе методолог/роутинг штрафовали основную рабочую лошадку tier-splus/tier-l/Best.
- **Простая задача ≠ reasoning-модель** (30.08): при `taskCategory`=chat/search weighted-selection штрафует reasoning ×0.15 и vision ×0.3 — простой факт/поиск идёт на быстрые general, а не «думает вслух» на дорогих reasoning-моделях. E2E: «столица Франции» на tier-s → «Париж» за 0.46с.
- **Поисковая категория** (30.08): SEARCH_PREFIX_RE (`что (такое/значит/означает)|расскажи|объясни|как|где|кто|найди`) ловится ДО reasoning — «что означает X» больше не уходит в «рассуждай пошагово». Расширены SEARCH_HINTS («как работает», «расскажи про»). Категория search теперь наполняется, а не всегда 0.

## Тесты
- 255 тестов: `node --test test/*.test.js` (proxy, clean, compactor, memory, memory-store, vision, dashboard, semcache, contextstats, taskclassify, methodology, modeldb, modelscan, modelmanager)
- Перед публикацией: тесты + `node --check server.js lib/*.js`
- `POST /v1/cache/clear` и `POST /v1/reload` требуют auth (Bearer); память чистится/сейвится автоматически

## Мультиагентность (opencode)
Глобальные субагенты в `~/.config/opencode/agent/`:
- **reviewer** — код-ревью (tier-splus = Ox Alpha, edit запрещён)
- **researcher** — исследование кода (tier-s, edit запрещён)
- **tester** — тесты и поиск багов (tier-s, edit разрешён)
- **content** — генерация шортс/постов (tier-s, через tools/)

Запускаются параллельно через Task tool — каждый в изолированном контексте.

## Онбординг (Итерация 2, 30.08)
- `freegate init -i` — два режима: **quick** (1 ключ OpenRouter → 15+ free-моделей) / **full** (все ключи → 8 источников). Объяснение разницы + подсказка «добавь остальные ключи в дашборде → Настройки».
- `freegate init` (неинтерактивный) — копирует config.example.json + .env.example без перезаписи (как раньше).
- Вывод wizard'а: «Подключить к Cursor: ... http://localhost:4000/v1» — стартовый сниппет.
- README.ru/README: quick-start с режимами + «Cursor в 2 клика».

## Виральность + экономия + чистка (30.08)
- **Экономия ($)**: `lib/economics.js` (aggregateSavings: input $3/M, output $15/M репрезентативно), поле `savings` в `/v1/stats`, карточка «Экономия» в дашборде (Обзор, акцентная сумма). Live: $35.10 на 10.6M токенов.
- **Бейджи README**: «One endpoint — all agents» (#00d4ff), «price $0» (#00ff88), «runs locally — private» (#00ff88). Секция «🔒 Работает локально» (localhost свой у каждого, ключи/переписки не уходят) + скриншоты нового дашборда (assets/dashboard.png, assets/dashboard-models.png, 1372×800). Число моделей обновлено 25→34.
- **Чистка бренда**: label launchd `com.davilcod.proxy`→`com.freegate.proxy`; тестовый tmp `davil-init-`→`freegate-init-`; титл дашборда уже «Freegate». DAVIL Cod остался только в исторических логах (gitignored).
- **Удалена дублирующая launchd-служба** `com.davilcod.model-manager` (каждые 6ч запускала scripts/auto-manage-models.js parallel со встроенным ModelManager → двойной спам проб → перерасход лимитов). Теперь только встроенный планировщик в server.js.


## Публикация
- npm: `npm version patch && npm publish` (ключ в ~/.npmrc, bypass 2FA)
- Docker: `docker build -t nik951751/freegate . && docker push`
- GitHub: `git push` (CI сам гоняет тесты + Docker)
