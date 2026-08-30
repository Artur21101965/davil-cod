// Классификатор типа задачи для выбора методологии и приоритетной категории.
// Без LLM — чистые эвристики по последнему user-сообщению.
// Категории: coding | reasoning | search | chat.

const { looksLikeCode } = require('./normalize');

const CODING_HINTS = [
  'напиши', 'исправь', 'пофикси', 'функци', 'отлади', 'пиши', 'верстк',
  'класс', 'импорт', 'экспорт', 'компонент', 'обработку ошибок',
  'refactor', 'debug', 'bug', 'test', 'fix', 'npm', 'git ', 'css', 'html',
];
const REASONING_HINTS = [
  'посчитай', 'сколько будет', 'почему', 'рассчитай', 'вероятност',
  'логик', 'math', 'формул', 'процен', 'объясни причины', 'вычисл',
  'знач', 'средн', 'сумм', 'объясни поче', 'рассуждай',
];
const SEARCH_HINTS = [
  'что такое', 'найди', 'где находится', 'как называется', 'что означает',
  'объясни термин', 'find', 'search', 'lookup', 'что за', 'кто такой',
];

function lastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  const users = messages.filter(m => m && m.role === 'user');
  const last = users[users.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return last.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ');
  }
  return '';
}

function classify(messages) {
  const text = lastUserText(messages).trim();
  if (!text) return 'chat';
  const lower = text.toLowerCase();

  // Код — сильный сигнал: читаем/пишем код, чиним, рефакторим.
  if (looksLikeCode(messages)) return 'coding';
  if (CODING_HINTS.some(h => lower.includes(h))) return 'coding';

  // Рассуждения — числа, подсчёт, объяснение причин.
  if (/\d/.test(text) && /[+\-*/%]|сколько|посчитай|рассчитай/.test(lower)) return 'reasoning';
  if (REASONING_HINTS.some(h => lower.includes(h))) return 'reasoning';

  // Поиск — спрашивают, что это такое, где найти.
  if (SEARCH_HINTS.some(h => lower.includes(h))) return 'search';

  return 'chat';
}

module.exports = { classify, lastUserText };
