// lib/semcache.js
// Символьные триграммы + Dice coefficient — zero-dep мера близости короткого
// текста для семантического кэша. Триграммы инвариантны к регистру и почти
// инвариантны к мелким перефразировкам («исправь ошибку» vs «исправь ошибку
// пожалуйста»), что и ловит повторные агентские промпты с другой формулировкой.

function trigrams(text) {
  if (!text || typeof text !== 'string') return [];
  const t = text.toLowerCase();
  if (t.length < 3) return [];
  const out = [];
  for (let i = 0; i <= t.length - 3; i++) out.push(t.slice(i, i + 3));
  return out;
}

function dice(aSet, bSet) {
  const ia = aSet.size;
  const ib = bSet.size;
  if (ia === 0 && ib === 0) return 1;
  if (ia === 0 || ib === 0) return 0;
  let inter = 0;
  const [small, large] = ia <= ib ? [aSet, bSet] : [bSet, aSet];
  for (const g of small) if (large.has(g)) inter++;
  return (2 * inter) / (ia + ib);
}

function similarityScore(textA, textB) {
  return dice(new Set(trigrams(textA)), new Set(trigrams(textB)));
}

module.exports = { trigrams, dice, similarityScore };