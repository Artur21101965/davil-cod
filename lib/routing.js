// Классификация сложности запроса. Возвращает 0..1.
// Признаки кода: ключевые слова, символы, длина сообщения, спец-слова.
// Внимание: \b в JS учитывает только ASCII-символы, поэтому для русских
// основ (словоформы склоняются: «функцию», «сортировки») используется
// префиксное совпадение без границ слова, а для латинских слов — \b.
const CODE_WORDS_EN = /\b(?:function|class|const|let|var|import|export|return|await|async|def|int|void|throw|try|catch)\b/;
const CODE_WORDS_RU = /(?:функци|сортировк|массив|код|переменн|цикл|класс|скрипт|комментари)/gi;
const CODE_SYMBOLS = /[{}\[\]]|=>/;
const FIX_WORDS = /(?:ошибк|баг|не работает|рефакторинг|исправь|почини|оптимизир)|\b(?:fix|bug|error|exception|refactor|debug)\b/i;
const REASONING_WORDS = /(?:объясни|почему|зачем|проанализируй|сравни|докажи|спроектируй|архитектур)/i;

const CODE_MATCH_WEIGHT = 0.15;
const CODE_MATCH_MAX = 0.6;

function classifyComplexity(messages) {
  if (!Array.isArray(messages)) return 0;
  // Берем только последнее пользовательское сообщение
  const last = [...messages].reverse().find(m => m && m.role === 'user');
  if (!last) return 0;
  let text = '';
  if (typeof last.content === 'string') text = last.content;
  else if (Array.isArray(last.content)) {
    text = last.content.filter(c => c && c.type === 'text').map(c => c.text || '').join(' ');
  }
  text = (text || '').trim();
  if (text.length === 0) return 0;

  let score = 0;
  // 1. Длина — длинные запросы сложнее (до +0.3)
  score += Math.min(text.length / 2000, 0.3);
  // 2. Код-признаки (до +0.6)
  let codeMatches = (text.match(CODE_WORDS_EN) || []).length;
  codeMatches += (text.match(CODE_WORDS_RU) || []).length;
  if (CODE_SYMBOLS.test(text)) codeMatches += 1;
  score += Math.min(codeMatches * CODE_MATCH_WEIGHT, CODE_MATCH_MAX);
  // 3. Слова об исправлении/ошибках (до +0.2)
  if (FIX_WORDS.test(text)) score += 0.2;
  // 4. Слова о рассуждениях (до +0.2)
  if (REASONING_WORDS.test(text)) score += 0.2;
  // 5. Наличие блоков кода ``` (до +0.2)
  if ((text.match(/```/g) || []).length >= 2) score += 0.2;
  return Math.min(score, 1);
}

// Поднятие тира при высокой сложности. Простые остаются на месте.
const UPGRADE_MAP = {
  'tier-s': 'tier-l',      // лёгкий → кодинг
  'tier-a': 'tier-s',      // лёгкий → быстрый
  'tier-b': 'tier-s',      // лёгкий → быстрый
};
const COMPLEX_THRESHOLD = 0.55;

function maybeUpgradeTier(requestedModel, complexity) {
  if (complexity >= COMPLEX_THRESHOLD && UPGRADE_MAP[requestedModel]) {
    return UPGRADE_MAP[requestedModel];
  }
  return requestedModel;
}

module.exports = { classifyComplexity, maybeUpgradeTier, COMPLEX_THRESHOLD };
