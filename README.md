# DAVIL Cod

[![CI](https://github.com/Artur21101965/davil-cod/actions/workflows/ci.yml/badge.svg)](https://github.com/Artur21101965/davil-cod/actions)
[![Docker Hub](https://img.shields.io/docker/pulls/nik951751/davil-cod.svg)](https://hub.docker.com/r/nik951751/davil-cod)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/davil-cod.svg)](https://www.npmjs.com/package/davil-cod)
[![GitHub stars](https://img.shields.io/github/stars/Artur21101965/davil-cod?style=social)](https://github.com/Artur21101965/davil-cod)

## Зачем платить за LLM, когда есть бесплатные?

Твой AI-агент, бот или скрипт использует один OpenAI-совместимый endpoint.
За ним DAVIL Cod автоматически распределяет запросы между **13 бесплатными
моделями** — Groq, Mistral, Gemini, NVIDIA NIM, OpenRouter, ZAI. Если один
провайдер упал, перегружен или сжёг дневной лимит — запрос **мгновенно
уходит на следующий**. Ты никогда не видишь «rate limit», и никогда не
платишь.

**Результат:** полноценный LLM-доступ для повседневной работы по цене $0.

![Дашборд DAVIL Cod](assets/dashboard.png)

## Возможности

| | |
|---|---|
| 🔀 **Автопереключение** | 13 провайдеров в одной цепочке. Провайдер упал? Следующий уже отвечает. |
| 💰 **Бесплатно** | Только free-модели. Дашборд показывает остаток лимита каждого провайдера. |
| ⚡ **Умный выбор** | Прокси сам находит самый быстрый и стабильный провайдер для каждого запроса. |
| 🛡️ **Надёжность** | Circuit breaker, очередь запросов, автоотключение мёртвых провайдеров, watchdog. |
| 📊 **Дашборд** | Статус, скорость, лимиты, история, токены, RPM-график — на русском. |
| 💾 **Кэш на диске** | Повторные промпты не тратят лимиты вообще. |
| 🔌 **Совместимость** | Любой OpenAI-клиент: opencode, Cursor, ChatGPT-аналоги, твои скрипты. |

## Быстрый старт — 30 секунд

```bash
npx davil-cod init -i     # мастер спросит: пароль + ключи каждого провайдера
npx davil-cod start       # прокси на http://localhost:4000
```

Или через Docker:

```bash
docker run -d --name davil-cod -p 4000:4000 \
  -e PROVIDER_GROQ_APIKEY=... \
  -e PROVIDER_MISTRAL_APIKEY=... \
  -e AUTH=your-secret-key \
  nik951751/davil-cod
```

### Подключение к любому OpenAI-клиенту

| Поле | Значение |
|------|----------|
| Base URL | `http://localhost:4000/v1` |
| API Key | твой пароль из `init` |
| Модель | `tier-s` (быстрая) / `tier-splus` (мощная) |

Пример для opencode (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "provider": {
    "free-proxy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DAVIL Cod",
      "options": {
        "baseURL": "http://localhost:4000/v1",
        "apiKey": "your-secret-key-here"
      },
      "models": {
        "tier-splus": { "name": "DAVIL Cod (Best)", "input": ["text"] },
        "tier-s": { "name": "DAVIL Cod (Fast)", "input": ["text"] }
      }
    }
  }
}
```

## Поддерживаемые провайдеры

| Провайдер | Модели | Где ключ | Лимит/день |
|-----------|--------|----------|------------|
| Groq | gpt-oss-120b, qwen-27b | console.groq.com | 1000 |
| Mistral | codestral, small | console.mistral.ai | 500K ток. |
| NVIDIA NIM | deepseek, llama | build.nvidia.com | 40 |
| Gemini | gemini-3.6-flash | aistudio.google.com | 1500 |
| OpenRouter | cohere-north, glm, nemotron | openrouter.ai | 50 |
| ZAI | glm-4.7-flash | open.bigmodel.cn | 1000 |

> Каталог расширяемый: добавь модель в `providers.json` — и она попадёт в пул.
> Провайдеры, недоступные твоему ключу (404), отключаются автоматически.

## Как это работает

1. Приходит запрос на `/v1/chat/completions` (формат OpenAI).
2. DAVIL Cod выбирает лучший провайдер: здоровый, под лимитом, самый быстрый сегодня.
3. Если запрос не прошёл — мгновенно пробует следующий из цепочки.
4. Ответ возвращается клиенту в том же формате — клиент ничего не замечает.

## Разработка

```bash
npm test          # unit-тесты (10 шт.)
node server.js    # запуск из исходников
```

## FAQ

**Это законно?** Да. Ты подключаешь **свои** бесплатные ключи провайдеров —
просто получаешь единый надёжный доступ к ним всем.

**Сколько это стоит?** $0. Только лимиты бесплатных тарифов провайдеров.

**Какие модели самые быстрые?** Прокси сам измеряет и выбирает. Сейчас
лидируют Qwen (Groq, ~300ms) и cohere-north (OpenRouter).

**Могу добавить свой провайдер?** Да — впиши его в `config.json` или
`providers.json`.

**Это только для opencode?** Нет. Любой OpenAI-совместимый клиент.

## Лицензия

MIT
