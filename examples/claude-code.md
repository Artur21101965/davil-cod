# Как подключить DAVIL Cod к Claude Code

Claude Code (CLI от Anthropic) поддерживает OpenAI-совместимые прокси
через переменные окружения.

## Настройка

1. Запусти прокси: `npx davil-cod start`
2. Задай переменные окружения перед запуском `claude`:

```bash
export ANTHROPIC_BASE_URL="http://localhost:4000/v1"
export ANTHROPIC_API_KEY="твой_пароль_из_init"
export ANTHROPIC_MODEL="tier-splus"
claude
```

## Альтернатива: через settings.json

Добавь в `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4000/v1",
    "ANTHROPIC_API_KEY": "твой_пароль",
    "ANTHROPIC_MODEL": "tier-splus"
  }
}
```
