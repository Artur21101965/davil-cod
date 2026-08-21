#!/usr/bin/env node
// bin/davil-cod.js — CLI wrapper + interactive setup wizard
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'providers.json'), 'utf8'));

// Sequential stdin reader (works with both TTY and piped input)
function makeReader() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const queue = [];
  let buffer = '';
  rl.on('line', (line) => {
    const q = queue.shift();
    if (q) q(line);
    else buffer += line + '\n';
  });
  return function ask(question) {
    process.stdout.write(question);
    if (buffer.length) {
      const idx = buffer.indexOf('\n');
      const line = idx >= 0 ? buffer.slice(0, idx) : buffer;
      buffer = idx >= 0 ? buffer.slice(idx + 1) : '';
      return Promise.resolve(line);
    }
    return new Promise((resolve) => queue.push(resolve));
  };
}

async function initWizard() {
  const ask = makeReader();

  // 1. Auth key for the proxy
  const auth = await ask('Пароль для доступа к прокси (Enter = сгенерировать): ');
  const authKey = auth.trim() || 'dc_' + Math.random().toString(36).slice(2, 14);

  // 2. Collect provider keys from the catalog (unique env vars)
  const envVars = new Map(); // envVar -> [providerNames]
  for (const [name, p] of Object.entries(CATALOG)) {
    if (!p.envVar) continue;
    if (!envVars.has(p.envVar)) envVars.set(p.envVar, []);
    envVars.get(p.envVar).push(name);
  }

  const keys = {};
  for (const [envVar, providers] of envVars) {
    const sample = providers[0];
    const hint = CATALOG[sample].keyHint || '';
    const answer = await ask(`\n${providers.join(', ')}\n  Ключ (${hint}) — пусто = пропустить: `);
    if (answer.trim()) keys[envVar] = answer.trim();
  }

  // 3. Write .env
  const envLines = ['# DAVIL Cod — API ключи. Сгенерировано ' + new Date().toISOString().slice(0, 10)];
  for (const envVar of envVars.keys()) {
    envLines.push(`${envVar}=${keys[envVar] || ''}`);
  }
  fs.writeFileSync(path.join(process.cwd(), '.env'), envLines.join('\n') + '\n');
  console.log('✓ .env создан');

  // 4. Write config.json
  const config = {
    port: 4000,
    auth: authKey,
    rateLimit: { maxRequests: 100, windowMs: 60000 },
    providers: {},
  };
  fs.writeFileSync(path.join(process.cwd(), 'config.json'), JSON.stringify(config, null, 2));
  console.log('✓ config.json создан');

  const filled = Object.values(keys).filter(Boolean).length;
  console.log(`\nГотово! Провайдеров с ключами: ${filled} из ${envVars.size}`);
  console.log(`Запуск: npx davil-cod start  (пароль: ${authKey})`);
}

function copyExample(name, example) {
  const src = path.join(ROOT, example || name + '.example');
  const dst = path.join(process.cwd(), name);
  if (fs.existsSync(dst)) { console.log('✓ ' + name + ' уже есть'); return; }
  if (!fs.existsSync(src)) { console.log('✗ ' + example + ' не найден в пакете'); return; }
  fs.copyFileSync(src, dst);
  console.log('✓ создан ' + name + ' — заполни ключи');
}

const cmd = process.argv[2];

if (cmd === 'init') {
  if (process.argv.includes('--interactive') || process.argv.includes('-i')) {
    initWizard().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
  } else {
    // Non-interactive fallback: plain copy (safe — never overwrites)
    copyExample('config.json', 'config.example.json');
    copyExample('.env', '.env.example');
    console.log('\nГотово! Заполни .env ключами, затем: npx davil-cod start');
    console.log('Совет: npx davil-cod init -i — интерактивный мастер с вопросами.');
  }
} else if (cmd === 'start') {
  // Spawn from the user's cwd (not package dir) so server.js picks up their
  // config.json / .env created by `init`.
  const child = spawn(process.execPath, [SERVER], { stdio: 'inherit' });
  child.on('close', (c) => process.exit(c || 0));
} else if (cmd === 'dashboard') {
  console.log('Открой http://localhost:4000/ (запусти start сначала)');
} else if (cmd === 'version' || cmd === '-v' || cmd === '--version') {
  const pkg = require(path.join(ROOT, 'package.json'));
  console.log(pkg.version);
} else {
  console.log('DAVIL Cod — бесплатный LLM-прокси с failover');
  console.log('Команды:');
  console.log('  npx davil-cod init       интерактивная настройка (ключи, пароль)');
  console.log('  npx davil-cod start      запустить прокси');
  console.log('  npx davil-cod dashboard  открыть дашборд');
}
