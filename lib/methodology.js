// Методолог — краткий системный промпт, дающий модели «инженерную дисциплину»
// по мотивам superpowers (plan-before-code, tests-first, reasoning). Не является
// копией — это сжатый производный текст, встроенный в запрос к провайдеру.
// Механика субагентов/инструментов работает на стороне клиента (opencode, Cursor),
// здесь — только стиль ответа.

const METHODOLOGIES = {
  coding: [
    'Методолог (craft): перед тем как давать код — составь план в 1-2 строки.',
    'Сначала набросай approach, потом пиши реализации. Не выдумывай API.',
    'Предложи (или опиши) короткий тест, который проверит поведение.',
    'Если правишь код — укажи файл и строку; если есть сомнение — спроси.',
    'После решения дай в одну строку, как это проверить.',
  ].join('\n'),
  reasoning: [
    'Методолог (thinking): рассуждай пошагово, прежде чем дать вывод.',
    'Покажи ключевые предположения, чтобы ответ можно было проверить.',
    'Сначала краткий ход мысли, затем краткий ответ.',
  ].join('\n'),
  search: [
    'Методолог (search): дай короткий фактологичный ответ по существу.',
    'Если отвечаешь по внешнему источнику — не выдумывай, укажи источник или скажи, что не уверен.',
    'Без воды и лишних вступлений.',
  ].join('\n'),
  chat: [
    'Методолог (chat): отвечай по существу и кратко, по-русски.',
    'Если просят код или план — переключись на соответствующий стиль.',
  ].join('\n'),
  design: [
    'Методолог (design): перед кодом — определи смелую эстетическую идею. Не делай «generic AI-шаблон».',
    'Выбери тон: минимализм / максимализм / ретро-футуризм / лакшери / брутализм / мягкий пастельный и т.д. — и держись его.',
    'Типографика: подбери характерные шрифты (не Arial/Inter/Roboto), связка display + body.',
    'Цвет: единая палитра через CSS-переменные, доминанта + резкий акцент.',
    'Движение: одна хорошо срежиссированная загрузка (staggered reveals) и микро-взаимодействия; приоритет CSS-only.',
    'Композиция и фон: асимметрия, наложение, негативное пространство, текстуры/градиенты/шум — вместо плоских заливок.',
    'Реализуй рабочий код (HTML/CSS/JS, React, Vue). Адаптив mobile-first, доступность (контраст, aria).',
    'Каждый дизайн — разный. Не повторяйся между проектами и не ходи в Space Grotesk по умолчанию.',
  ].join('\n'),
};

// Общий блок «поведение»: прививает модели сверхспособности — не сдаваться, а
// искать обходной путь, как DeepSeek. Применяется ко всем категориям независимо
// от переопределения промптов (config.methodology.prompts).
const BEHAVIOR = [
  'Поведение (не сдавайся): если не находишь нужный инструмент/файл/скилл там, где ожидал —',
  'не говори «не могу». Ищи обходной путь: читай файлы с диска напрямую (cat), проверь node_modules,',
  'посмотри доступные инструменты, попробуй альтернативу. Сначала попробуй — потом решай.',
  'Если всё же не выходит — одной строкой: что искал, где, и что предлагаешь сделать.',
].join('\n');

function getMethodology(category, options) {
  const opts = options || {};
  const prompts = (opts.prompts && typeof opts.prompts === 'object') ? opts.prompts : {};
  if (prompts[category] && typeof prompts[category] === 'string' && prompts[category].trim().length > 0) {
    return prompts[category];
  }
  return METHODOLOGIES[category] || METHODOLOGIES.chat;
}

function enabledByDefault() {
  return true;
}

// Вставляет системное сообщение-методолог после системного промпта клиента и
// после memory-инъекции, но перед первым активным user-сообщением.
function injectMethodology(messages, category, options) {
  const opts = options || {};
  if (opts.enabled === false) return messages;
  const text = getMethodology(category, opts);
  if (!messages || !Array.isArray(messages)) return messages;

  // Конец вводных: после последнего system и после исчерпания «заголовочных»
  // user-вставок вида [Память: ...] / [Факты: ...].
  let insertAt = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === 'system') { insertAt = i + 1; continue; }
    if (m.role === 'user' && typeof m.content === 'string' && /^\[(Память|Факты|Memory|Facts)[:\]]/.test(m.content)) {
      insertAt = i + 1; continue;
    }
    break;
  }

  const copy = messages.slice();
  const full = text + '\n\n' + BEHAVIOR;
  copy.splice(insertAt, 0, { role: 'system', content: full });
  return copy;
}

module.exports = { getMethodology, injectMethodology, enabledByDefault, METHODOLOGIES, BEHAVIOR };
