# Как подключить Freegate к Cursor

Cursor поддерживает любые OpenAI-совместимые API.

## Настройка

1. Запусти прокси: `npx freegate start`
2. Открой Cursor: **Settings → Models** (или Cursor Settings → Models)
3. Добавь новый provider:

| Поле | Значение |
|------|----------|
| Provider | OpenAI Compatible |
| Base URL | `http://localhost:4000/v1` |
| API Key | твой пароль из `npx freegate init` |
| Model ID | `tier-s` (быстрая) или `tier-splus` (мощная) |

## Готово

Cursor будет использовать бесплатные модели через Freegate.
Если провайдер упадёт — запрос сам уйдёт на следующий, Cursor не заметит.
