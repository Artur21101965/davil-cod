#!/usr/bin/env node
// bin/davil-cod.js — thin CLI wrapper
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');

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
  copyExample('config.json', 'config.example.json');
  copyExample('.env', '.env.example');
  console.log('\nГотово! Заполни .env ключами, затем: npx davil-cod start');
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
  console.log('  npx davil-cod init       создать config.json и .env');
  console.log('  npx davil-cod start      запустить прокси');
  console.log('  npx davil-cod dashboard  открыть дашборд');
}
