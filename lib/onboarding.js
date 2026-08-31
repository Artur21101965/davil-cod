// lib/onboarding.js — готовые сниппеты подключения и профили моделей.
// Чистые функции: не трогают диск, возвращают текст конфига. Для doctor/init.
function snippetCursor(baseUrl, apiKey) {
  return [
    '// Cursor → Settings → Models',
    '// Включи провайдер «OpenAI-compatible» и впиши:',
    'Model:        openai/gpt-oss-120b   (или любая из каталога)',
    'Base URL:     ' + baseUrl + '/v1',
    'API Key:      ' + apiKey,
    'Add model:    столько бесплатных моделей, сколько захочешь.',
    '',
    'Совет: открыть дашборд → ' + baseUrl + ' (пароль = API Key).',
  ].join('\n');
}

function snippetOpencode(baseUrl, apiKey) {
  return [
    '// opencode — добавь провайдер в opencode.json',
    '{',
    '  "$schema": "https://opencode.ai/config.json",',
    '  "provider": {',
    '    "freegate": {',
    '      "npm": "@ai-sdk/openai-compatible",',
    '      "name": "Freegate",',
    '      "options": {',
    '        "baseURL": "' + baseUrl + '/v1",',
    '        "apiKey": "' + apiKey + '"',
    '      }',
    '    }',
    '  },',
    '  "model": "freegate/openai/gpt-oss-120b"',
    '}',
    '',
    'Затем: npx opencode (выбери модель freegate).',
  ].join('\n');
}

function snippetCline(baseUrl, apiKey) {
  return [
    '// Cline (VS Code) → Settings → API Provider: OpenAI Compatible',
    'Base URL: ' + baseUrl + '/v1',
    'API Key: ' + apiKey,
    'Model: openai/gpt-oss-120b',
    '',
    'Убедись, что в Cline включён "OpenAI Compatible" провайдер.',
  ].join('\n');
}

// Профили: пресеты под разные роли (каких моделей больше в роутинге).
function profiles() {
  return [
    {
      id: 'chat',
      name: 'Чат-ассистент',
      hint: 'Общие вопросы, переписка. Категория chat.',
      prefer: ['general', 'chat'],
    },
    {
      id: 'coder',
      name: 'Кодер',
      hint: 'Код, рефакторинг, тесты. Категория coding.',
      prefer: ['coding', 'reasoning'],
    },
    {
      id: 'designer',
      name: 'Дизайнер',
      hint: 'UI/UX, фронтенд. Категория design.',
      prefer: ['coding', 'design'],
    },
    {
      id: 'researcher',
      name: 'Исследователь',
      hint: 'Поиск фактов, веб-поиск. Категория search.',
      prefer: ['search', 'reasoning'],
    },
  ];
}

module.exports = { snippetCursor, snippetOpencode, snippetCline, profiles };
