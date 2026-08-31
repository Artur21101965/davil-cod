// lib/vetting.js — самопроверка ответа второй моделью.
// После получения ответа от free-модели (не-stream) отправляем краткий чек
// другой модели: выявить фактические/логические ошибки. Экономит free-лимиты:
// включается только по конфигу и только когда ответ достаточно содержательный.
const logger = require('./logger');

const VETTING_DEFAULTS = {
  enabled: false,        // выкл по умолчанию — жжёт 2-й лимит на каждый запрос
  minAnswerLen: 120,     // мельче — нечего проверять
  maxChecksPerMin: 4,    // троттлинг: не больше N проверок в минуту
  complexityOnly: true,  // только сложные/кодинг-задачи
};

const SYSTEM = 'Ты — строгий проверяльщик. Перечитай ответ, который дал другой ИИ, и найди ФАКТИЧЕСКИЕ или ЛОГИЧЕСКИЕ ошибки. Отвечай ТОЛЬКО одним из: "OK" (если ошибок нет) или "Замечание: <кратко, 1 фраза>" (если есть реальная ошибка). Не выдумывай — проверяй только то, что очевидно неверно. Не хвали и не повторяй ответ.';

// Проверить, стоит ли вообще запускать проверку.
function shouldVet({ config = {}, complexity = 0, answerLen = 0, category = '' } = {}) {
  const cfg = Object.assign({}, VETTING_DEFAULTS, config);
  if (!cfg.enabled) return false;
  if (answerLen < cfg.minAnswerLen) return false;
  // complexityOnly: vetting только для coding/design/reasoning (сложных задач);
  // поиск/чат не тратим лишний лимит.
  if (cfg.complexityOnly) {
    const complexCats = new Set(['coding', 'design', 'reasoning']);
    if (complexCats.has(category)) return true;
    if (complexity >= 0.5) return true;
    return false;
  }
  return true;
}

// Разобрать ответ проверяльщика → { ok:boolean, note:string }
function parseVerdict(text) {
  const s = String(text || '').trim();
  if (!s) return { ok: true, note: '' };
  if (/^\s*ok\b/i.test(s)) return { ok: true, note: '' };
  const m = s.match(/замечание\s*[:\-]?\s*(.*)/i);
  if (m && m[1] && m[1].trim()) return { ok: false, note: m[1].trim().slice(0, 200) };
  // Иначе считаем OK (неопределённый ответ не блокируем).
  return { ok: true, note: '' };
}

// Троттлинг: кольцевой буфер времени последних проверок.
let lastChecks = [];

function allowCheck(now = Date.now(), maxPerMin = VETTING_DEFAULTS.maxChecksPerMin) {
  if (!Array.isArray(lastChecks)) lastChecks = [];
  const cutoff = now - 60000;
  lastChecks = lastChecks.filter((t) => t > cutoff);
  if (lastChecks.length >= maxPerMin) return false;
  lastChecks.push(now);
  return true;
}

function resetThrottle() { lastChecks = []; }

// Запустить проверку: body = второй вызов к провайдеру (callProvider).
// Вернёт { checked:boolean, ok:boolean, note:string }.
async function vetAnswer({ answer, callProvider, picks = [], config = {}, now = Date.now() }) {
  const cfg = Object.assign({}, VETTING_DEFAULTS, config);
  if (!answer || typeof answer !== 'string') return { checked: false, ok: true, note: '' };
  if (!picks || picks.length === 0) return { checked: false, ok: true, note: '' };
  if (!allowCheck(now, cfg.maxChecksPerMin)) return { checked: false, ok: true, note: '' };

  // Пробуем других провайдеров (не тот, что дал ответ), пока один не проверит.
  for (const provider of picks) {
    try {
      const result = await callProvider(provider, {
        model: provider.model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: 'Проверь этот ответ на ошибки. Ответ:\n\n' + answer.slice(0, 4000) },
        ],
        temperature: 0,
        max_tokens: 120,
      }, 20000, 1);
      const text = result && result.data && result.data.choices && result.data.choices[0] &&
        result.data.choices[0].message && result.data.choices[0].message.content;
      if (text && text.trim()) {
        const verdict = parseVerdict(text);
        return { checked: true, ok: verdict.ok, note: verdict.note, by: provider.key || provider.model };
      }
    } catch (err) {
      // пробуем следующего
      logger.debug('vetting failed', { provider: provider.key, error: err.message });
    }
  }
  return { checked: false, ok: true, note: '' };
}

module.exports = { shouldVet, parseVerdict, vetAnswer, allowCheck, resetThrottle, VETTING_DEFAULTS, SYSTEM };
