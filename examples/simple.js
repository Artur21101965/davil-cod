// Простой Node.js скрипт через Freegate.
// Запуск: node examples/simple.js
// Прокси должен быть запущен: npx freegate start

const AUTH = process.env.FREEGATE_AUTH || 'твой_пароль';

async function main() {
  const res = await fetch('http://localhost:4000/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH}`,
    },
    body: JSON.stringify({
      model: 'tier-s',               // быстрая; tier-splus — мощная
      stream: false,
      messages: [{ role: 'user', content: 'Привет! Расскажи анекдот' }],
    }),
  });

  const data = await res.json();
  console.log('Провайдер ответил:', data.model);
  console.log('Ответ:', data.choices?.[0]?.message?.content);
}

main().catch((e) => {
  console.error('Ошибка:', e.message);
  console.error('Запусти прокси: npx freegate start');
  process.exit(1);
});
