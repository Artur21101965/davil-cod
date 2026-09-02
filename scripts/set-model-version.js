#!/usr/bin/env node
// Обновляет версию в имени модели Freegate в opencode.jsonc при релизе.
// Читает актуальную версию из package.json и подставляет её в "Freegate (Best · vX)".
// Чтобы имя модели всегда показывало текущую версию Freegate.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ver = pkg.version;

const candidatePaths = [
  path.join(process.env.HOME, '.config', 'opencode', 'opencode.jsonc'),
  path.join(ROOT, 'opencode.jsonc'),
];
const cfgPath = candidatePaths.find((p) => fs.existsSync(p));
if (!cfgPath) {
  console.log('opencode.jsonc не найден — пропуск');
  process.exit(0);
}

let cfg = fs.readFileSync(cfgPath, 'utf8');
if (!cfg.includes('Freegate (')) {
  console.log('Моделей Freegate в opencode.jsonc нет — пропуск');
  process.exit(0);
}

// "Freegate (Best · v0.6.22)" → "Freegate (Best · v0.6.23)" (и прочие варианты).
let replaced = 0;
cfg = cfg.replace(/"name": "Freegate \(([^·)]*?)(?: · v\d+\.\d+\.\d+)?\)"/g, (m, label) => {
  const labelTrim = label.trim();
  const suffix = labelTrim ? ` ${labelTrim} · v${ver}` : `· v${ver}`;
  replaced++;
  return `"name": "Freegate (${labelTrim ? labelTrim + ' · v' + ver : '· v' + ver})"`;
});

if (replaced > 0) {
  fs.writeFileSync(cfgPath, cfg);
  console.log(`Обновлено моделей Freegate: ${replaced} → v${ver} (${cfgPath})`);
} else {
  console.log('Не удалось сопоставить имена моделей — проверь вручную');
}
