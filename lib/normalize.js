// Нормализация сообщений для семантического кэша.
// Сравниваются только пользовательские текстовые сообщения, без system.

const MAX_LEN = 2000;

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return '';
  const userTexts = messages
    .filter(m => m && m.role === 'user')
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ');
      }
      return '';
    })
    .join('\n');
  return normalizeText(userTexts);
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')   // пунктуация и символы → пробел
    .replace(/\s+/g, ' ')               // сжать пробелы
    .trim()
    .slice(0, MAX_LEN);
}

module.exports = { normalizeMessages, normalizeText, MAX_LEN };
