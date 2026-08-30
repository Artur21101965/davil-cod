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

## Тесты
- 150 тестов: `node --test test/*.test.js` (proxy, clean, compactor, memory, memory-store, vision, dashboard, semcache, contextstats)
- Перед публикацией: тесты + `node --check server.js lib/*.js`
- `POST /v1/cache/clear` и `POST /v1/reload` требуют auth (Bearer); память чистится/сейвится автоматически

## Мультиагентность (opencode)
Глобальные субагенты в `~/.config/opencode/agent/`:
- **reviewer** — код-ревью (tier-splus = Ox Alpha, edit запрещён)
- **researcher** — исследование кода (tier-s, edit запрещён)
- **tester** — тесты и поиск багов (tier-s, edit разрешён)
- **content** — генерация шортс/постов (tier-s, через tools/)

Запускаются параллельно через Task tool — каждый в изолированном контексте.

## Публикация
- npm: `npm version patch && npm publish` (ключ в ~/.npmrc, bypass 2FA)
- Docker: `docker build -t nik951751/freegate . && docker push`
- GitHub: `git push` (CI сам гоняет тесты + Docker)
