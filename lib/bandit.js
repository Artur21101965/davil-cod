// Thompson sampling (Beta-Bernoulli) bandit для выбора провайдера.
// Каждый провайдер в каждом бакете сложности имеет приоры Beta(a, b).
// Выбор: рисуем сэмпл из Beta(a, b) для каждого, берём максимум.
// Исход: успех → a+=1, фейл → b+=1.

const BUCKET_THRESHOLDS = [0.4, 0.7];

function bucket(complexity) {
  if (complexity < BUCKET_THRESHOLDS[0]) return 'low';
  if (complexity < BUCKET_THRESHOLDS[1]) return 'med';
  return 'high';
}

// Standard normal via polar method (Box-Muller).
function stdNormal() {
  let u1, u2, s;
  do { u1 = Math.random() * 2 - 1; u2 = Math.random() * 2 - 1; s = u1 * u1 + u2 * u2; } while (s >= 1 || s === 0);
  return u1 * Math.sqrt(-2 * Math.log(s) / s);
}

// Marsaglia-Tsang sampling of Gamma(shape, scale=1). Valid for shape >= 1.
function sampleGamma(shape) {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = stdNormal(); } while (1 + c * x <= 0);
    v = 1 + c * x;
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// Сэмпл из Beta(alpha, beta). Beta(1,1) = uniform.
function sampleBeta(alpha, beta) {
  if (alpha <= 0 || beta <= 0) return 0.5;
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  const denom = x + y;
  return denom > 0 ? x / denom : 0.5;
}

// Выбор провайдера: максимум сэмплов. weight добавляется к alpha.
// prior = { a, b } из бакета. sample = Beta(a + weight, b + 1).
function pick(scored, bucketPriors) {
  let best = null;
  let bestVal = -Infinity;
  for (const item of scored) {
    const key = item.key;
    const weight = typeof item.weight === 'number' ? item.weight : 1;
    const prior = (bucketPriors && bucketPriors[key]) || { a: 1, b: 1 };
    const sample = sampleBeta(prior.a + weight, prior.b + 1);
    if (sample > bestVal) { bestVal = sample; best = key; }
  }
  return best;
}

// Обновление приоров после исхода.
function recordOutcome(bucketPriors, key, success) {
  bucketPriors[key] = bucketPriors[key] || { a: 1, b: 1 };
  if (success) bucketPriors[key].a += 1;
  else bucketPriors[key].b += 1;
}

module.exports = { bucket, sampleBeta, pick, recordOutcome, BUCKET_THRESHOLDS };
