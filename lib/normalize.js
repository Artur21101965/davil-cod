// Нормализация сообщений для семантического кэша.
// Сравниваются только пользовательские текстовые сообщения, без system.

const MAX_LEN = 2000;

const CODE_SYMBOLS = new Set(['{', '}', '[', ']', '=>', ';', '=', '+', '-', '*', '/', '<', '>']);
const CODE_KEYWORDS = new Set([
  'function', 'const', 'let', 'var', 'return', 'import', 'export',
  'class', 'def', '=>', 'await', 'async', 'try', 'catch', 'throw',
]);

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

function looksLikeCode(messages) {
  const text = lastUserText(messages);
  if (!text) return false;
  if (text.includes('```')) return true;

  const hasKeyword = [...CODE_KEYWORDS].some(kw => new RegExp(`\\b${kw}\\b`).test(text));

  // Считаем операторы/символы; стрелку `=>` учитываем как отдельный символ,
  // чтобы `=` и `>` внутри неё не задваивались.
  let symbolCount = 0;
  const rest = text.replace(/=>/g, '');
  if (text.includes('=>')) symbolCount += 1;
  for (const ch of CODE_SYMBOLS) {
    if (ch === '=>') continue;
    symbolCount += rest.split(ch).length - 1;
  }

  if (hasKeyword && symbolCount >= 1) return true;
  if (symbolCount >= 3) return true;
  return false;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return '';
  const dialog = messages.filter(m => m && (m.role === 'user' || m.role === 'assistant'));
  if (looksLikeCode(messages)) {
    // Код: точное совпадение, чтобы операторы не схлопывались в один ключ.
    return JSON.stringify(dialog);
  }
  // Включаем ВЕСЬ диалог (user + assistant), но НЕ system-промпт: короткие
  // команды («продолжай») из разных диалогов с разным контекстом не должны
  // схлопываться в один кэш-ключ и возвращать чужой ответ.
  const texts = dialog
    .map(m => {
      const role = m.role === 'user' ? 'u' : 'a';
      let body = '';
      if (typeof m.content === 'string') body = m.content;
      else if (Array.isArray(m.content)) {
        body = m.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ');
      }
      return role + ':' + body;
    })
    .join('\n');
  // Нет извлекаемого текста (только картинки/инструменты) → пусто, чтобы cache
  // упал на точное совпадение (иначе image-only запросы схлопнутся в один ключ).
  const rawText = dialog
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ');
      return '';
    })
    .join('\n');
  if (!rawText.trim()) return '';
  return normalizeText(texts);
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')   // пунктуация и символы → пробел
    .replace(/\s+/g, ' ')               // сжать пробелы
    .trim()
    .slice(0, MAX_LEN);
}

module.exports = { normalizeMessages, normalizeText, looksLikeCode, MAX_LEN };
