// lib/compress.js — лёгкое сжатие промпта (по мотивам OmniRoute Caveman).
// Удаляет вежливость/хеджирование/заполнители из ПОСЛЕДНЕГО user-сообщения,
// экономя токены free-лимитов. Только для plain-text сообщений; код/контент-
// массивы/инструменты не трогаем. Опционально: config.compress.enabled.
const logger = require('./logger');

const COMPRESS_DEFAULTS = { enabled: false, minLen: 60 };

// Пары «регэксп → замена». Намеренно бережно: не ломаем смысл, только пустые
// фразы. Артикли EN убираем только когда после них буква (не ломать код/URL).
const RULES = [
  // English pleasantries / polite framing / hedging / fillers
  [/^(?:sure|certainly|of course|happy to|absolutely)\s*[,!.]?\s+/i, ''],
  [/^(?:thanks|thank you|thanks in advance|i really appreciate)\s*[,!.]?\s+/i, ''],
  [/^(?:please|kindly|could you please|would you please|can you please)\s+/i, ''],
  [/^(?:i want you to|i need you to|i'd like you to)\s+/i, ''],
  [/^(?:i am trying to|i am working on|i have been)\s+/i, ''],
  [/\b(?:it seems like|it appears that|i think that|i believe that|probably|possibly|maybe it)\s+/gi, ''],
  [/\b(?:basically|essentially|actually|literally|simply|currently|just)\s+/gi, ''],
  [/\b(?:i want to|i need to|i'd like to|i'm looking for)\s+/gi, ''],
  [/^(?:hi there|hello|hey|good morning|good afternoon)\s*[,!.]?\s+/i, ''],
  [/\b(?:a bit|a little|somewhat|kind of|sort of)\s+/gi, ''],
  // English hedgy / filler requests
  [/\b(?:i was wondering|would it be possible|if possible|when you get a chance|at your convenience)\s*,?\s+/gi, ''],
  // English articles (only plain prose, not URLs/code)
  [/\b(?:an|a|the)\s+(?=[a-z])/gi, ''],
  // Russian fillers and polite framing
  [/^(?:пожалуйста|будьте добры|если можно|не могли бы вы)\s*[,!.]?\s+/i, ''],
  [/^(?:привет|здравствуйте|добрый день|добрый вечер)\s*[,!.]?\s+/i, ''],
  [/\b(?:просто|кстати|вообще|скажем|по сути|по-хорошему|честно говоря)\s+/gi, ''],
  [/\b(?:как бы|вроде бы|в принципе|наверное|возможно|пожалуй)\s+/gi, ''],
  [/^(?:я хочу|мне нужно|я бы хотел|я пытаюсь|я работаю)\s+/i, ''],
  [/\b(?:спасибо|заранее спасибо|очень благодарен)\s*[,!.]?\s+/gi, ''],
];

// Не сжимаем, если сообщение похоже на код.
function looksLikeCode(text) {
  return /[{}\[\]]|=>|\bdef\b|\bfunction\b|\bconst\b|\bimport\b|\bfrom\b\s+["']|<\/?[a-z][^>]*>/i.test(text);
}

// Убрать «шапку» polite-prose из текста.
function compressText(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const [re, rep] of RULES) {
    out = out.replace(re, rep);
  }
  // подчистить возможные двойные пробелы после сокращений
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return out;
}

function shouldCompress(cfg, text) {
  if (!cfg || cfg.enabled === false) return false;
  if (!text || typeof text !== 'string') return false;
  if (text.trim().length < (cfg.minLen || COMPRESS_DEFAULTS.minLen)) return false;
  if (looksLikeCode(text)) return false;
  return true;
}

// Сжать последний user-message (только plain string content).
function compressMessages(messages, options = {}) {
  const cfg = Object.assign({}, COMPRESS_DEFAULTS, options);
  if (!messages || !Array.isArray(messages) || messages.length === 0) return messages;
  if (cfg.enabled === false) return messages;

  let mutated = false;
  const copy = messages.slice();
  for (let i = copy.length - 1; i >= 0; i--) {
    const m = copy[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content !== 'string') continue; // не трогаем массивы/инструменты
    if (!shouldCompress(cfg, m.content)) continue;
    const compressed = compressText(m.content);
    if (compressed !== m.content && compressed.length > 0) {
      copy[i] = { ...m, content: compressed };
      mutated = true;
      break; // только последнее user-сообщение
    }
  }
  if (mutated) logger.info('prompt compressed', { freed: 0 });
  return mutated ? copy : messages;
}

module.exports = { compressText, compressMessages, shouldCompress, looksLikeCode, RULES, COMPRESS_DEFAULTS };
