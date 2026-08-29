// lib/memory.js
// Долговременная память Freegate: факты, извлечённые при компакции контекста,
// с поиском по лёгкому вектору в стиле TF-IDF/Jaccard (без внешних зависимостей).
// Токенизация учитывает русскую морфологию через суффикс-триграммы.

const crypto = require('crypto');

// Минимальный стоп-лист (рус + англ). Токены короче 3 символов и пунктуация
// выпадают вместе с ними — это снимает большинство «служебного» шума.
const STOP_WORDS = new Set([
  'как', 'что', 'чем', 'кому', 'кем', 'где', 'куда', 'откуда', 'когда', 'почему',
  'зачем', 'кто', 'наш', 'нам', 'нами', 'вам', 'все', 'всё', 'это', 'этот', 'эта',
  'при', 'про', 'без', 'для', 'до', 'из', 'на', 'над', 'не', 'ни', 'но', 'и', 'или',
  'о', 'об', 'от', 'по', 'под', 'с', 'со', 'у', 'в', 'во', 'же', 'бы', 'был', 'быть',
  'есть', 'будет', 'будем', 'было', 'его', 'её', 'их', 'my', 'the', 'and', 'for',
  'with', 'does', 'what', 'how', 'why', 'when', 'from', 'into', 'would',
]);

// Suffix-trigram-маркер: последние 3 символа слова, чтобы русские словоформы
// («отчёт», «отчётами») пересекались. Префикс '_' исключает конфликт с токенами.
function trigram(word) {
  if (word.length < 4) return '';
  return '_' + word.slice(-3);
}

// wordCounts: частоты токенов в тексте (схлопывает «keepAlive» → «keepalive»).
function tokenize(text) {
  const counts = {};
  const add = (t) => { if (t && t.length >= 3 && !STOP_WORDS.has(t)) { counts[t] = (counts[t] || 0) + 1; } };
  const words = String(text).toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  for (const w of words) {
    add(w);
    const tr = trigram(w);
    if (tr) add(tr);
  }
  return Object.keys(counts);
}

// Хранилище фактов. capacity → вытеснение least-accessed.
class MemStore {
  constructor(capacity = 800) {
    this.capacity = capacity;
    this._facts = [];        // { id, text, tokens:Set<string>, access, created, sourceHash }
    this._docFreq = {};      // token → сколько фактов его содержит
    this._hashIndex = new Map(); // textHash → id
  }

  size() { return this._facts.length; }

  _refreshDocFreq() {
    this._docFreq = {};
    for (const f of this._facts) {
      for (const t of f.tokens) this._docFreq[t] = (this._docFreq[t] || 0) + 1;
    }
  }

  // idf влазит в [0, ln(пул+1)] — редкие токены важнее частых.
  _idf(token) {
    const n = this._docFreq[token] || 0;
    if (n === 0) return Math.log(this._facts.length + 1) || 1;
    return Math.log((this._facts.length + 1) / n);
  }

  add(text, meta = {}) {
    const normalized = String(text).trim().replace(/\s+/g, ' ');
    if (!normalized) return null;
    const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
    if (this._hashIndex.has(hash)) return null; // дедупликация
    const tokens = new Set(tokenize(normalized));
    // Prefix-expand: «запросы» покрывает «запрос», «погодный» → «погод» и т.п.
    // Даёт словоформам/словосочетаниям пересекаться без стеммера. Минимум 4
    // символа, чтобы не плодить ложные «год» из «погода».
    const expanded = new Set(tokens);
    for (const t of tokens) {
      if (t.startsWith('_') || t.length < 4) continue;
      for (let L = 4; L < t.length; L++) expanded.add(t.slice(0, L));
    }
    if (expanded.size === 0) return null;
    const fact = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: normalized,
      tokens: expanded,
      access: 0,
      created: Date.now(),
      sourceHash: meta.sourceHash || null,
    };
    this._facts.push(fact);
    this._hashIndex.set(hash, fact.id);
    for (const t of expanded) this._docFreq[t] = (this._docFreq[t] || 0) + 1;
    this._evictIfNeeded();
    return fact;
  }

  _evictIfNeeded() {
    if (this._facts.length <= this.capacity) return;
    // least-accessed, при равенстве — старейший
    this._facts.sort((a, b) => (a.access - b.access) || (a.created - b.created));
    const victims = this._facts.slice(0, this._facts.length - this.capacity);
    for (const v of victims) this._remove(v.id);
  }

  _remove(id) {
    const idx = this._facts.findIndex(f => f.id === id);
    if (idx === -1) return;
    const [f] = this._facts.splice(idx, 1);
    // убрать из hashIndex: нужен исходный hash — пересчитаем по тексту
    const h = crypto.createHash('sha1').update(f.text).digest('hex').slice(0, 16);
    if (this._hashIndex.get(h) === id) this._hashIndex.delete(h);
    for (const t of f.tokens) this._docFreq[t] = Math.max(0, (this._docFreq[t] || 1) - 1);
  }

  // recall: скор = сумма idf по общим токенам (полные слова вес 1, триграммы 0.5),
  // нормализованный по sqrt(len запроса) — масштаб одинаков внутри одного вызова
  // (не зависит от длины факта). 0 общих токенов → 0, unrelated отсекается любым
  // порогом > 0.
  recall(query, opts = {}) {
    const topK = opts.topK ?? 3;
    const minSimilarity = opts.minSimilarity ?? 0.05;
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];
    const qSet = new Set(qTokens);
    const norm = Math.sqrt(qTokens.length);
    const scored = [];
    for (const f of this._facts) {
      let score = 0;
      for (const t of qSet) {
        if (f.tokens.has(t)) {
          const w = t.startsWith('_') ? 0.5 : 1;
          score += w * this._idf(t);
        }
      }
      const final = score / norm;
      if (final >= minSimilarity) scored.push({ text: f.text, score: final });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  // Дедупликация при подмешивании: факт не нужен, если его текст почти весь
  // покрыт другим текстом (например, резюме компактора в этой же сессии).
  isCovered(text, others) {
    const words = tokenize(text).filter(t => !t.startsWith('_'));
    if (words.length === 0) return false;
    for (const other of others) {
      const foreign = tokenize(other);
      const overlap = words.filter(w => foreign.includes(w)).length;
      if (overlap / words.length >= 0.6) return true;
    }
    return false;
  }

  export() {
    return this._facts.map(f => ({ text: f.text, sourceHash: f.sourceHash, created: f.created, access: f.access }));
  }

  import(entries) {
    if (!Array.isArray(entries)) return 0;
    let added = 0;
    for (const e of entries) {
      if (e && typeof e.text === 'string' && this.add(e.text, { sourceHash: e.sourceHash })) added++;
    }
    if (added > 0) this._refreshDocFreq();
    return added;
  }
}

module.exports = { tokenize, MemStore };