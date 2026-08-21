# DAVIL Cod

[![CI](https://github.com/Artur21101965/davil-cod/actions/workflows/ci.yml/badge.svg)](https://github.com/Artur21101965/davil-cod/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/davil-cod.svg)](https://www.npmjs.com/package/davil-cod)

Бесплатный multi-provider LLM-прокси с автоматическим failover. Один
OpenAI-совместимый endpoint — а за ним ротация бесплатных моделей Groq,
Mistral, NVIDIA NIM, Gemini, OpenRouter и ZAI. Если один провайдер упал
или сжёг дневной лимит — запрос автоматически уходит на другой.

![Дашборд DAVIL Cod](assets/dashboard.png)

## Возможности

- **Безотказность** — до 10+ провайдеров в цепочке, circuit breaker,
  умный выбор самого быстрого и стабильного.
- **Экономия** — бесплатные модели вместо дорогих API. Дашборд показывает
  остаток лимита каждого провайдера.
- **Дашборд** — http://localhost:4000/ : статус провайдеров, RPM-график,
  история запросов, токены, лимиты.
- **Кэш на диске** — повторные одинаковые промпты не тратят лимиты.
- **Совместимость** — любой OpenAI-совместимый клиент (opencode, ChatGPT,
  Cursor, ваши скрипты).

## Быстрый старт

```bash
npx davil-cod init        # создаст config.json и .env
# заполни .env ключами (подсказки в providers.json)
npx davil-cod start       # прокси на http://localhost:4000
```

Удобнее — интерактивный мастер, он спросит пароль и ключи каждого провайдера:

```bash
npx davil-cod init -i     # пошагово: пароль → ключи Groq/Mistral/NIM/...
npx davil-cod start
```

Или в Docker:

```bash
docker build -t davil-cod .
docker run -p 4000:4000 \
  -e PROVIDER_GROQ_APIKEY=... \
  -e PROVIDER_MISTRAL_APIKEY=... \
  davil-cod
```

## Подключение к opencode

В `~/.config/opencode/opencode.jsonc`:

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

| Провайдер | Модели | Где ключ |
|-----------|--------|----------|
| Groq | gpt-oss-120b, qwen-27b | console.groq.com |
| Mistral | codestral, small | console.mistral.ai |
| NVIDIA NIM | deepseek, llama | build.nvidia.com |
| Gemini | gemini-3.6-flash | aistudio.google.com |
| OpenRouter | cohere-north, glm | openrouter.ai |
| ZAI | glm-4.7-flash | open.bigmodel.cn |

Больше моделей — через каталог `providers.json` или свой `config.json`.

## Разработка

```bash
npm test          # unit-тесты
node server.js    # запуск из исходников
```

## Лицензия

MIT
