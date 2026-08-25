#!/usr/bin/env node
// bin/freegate.js — CLI wrapper + interactive setup wizard
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
  const envLines = ['# Freegate — API ключи. Сгенерировано ' + new Date().toISOString().slice(0, 10)];
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
  console.log(`Запуск: npx freegate start  (пароль: ${authKey})`);
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
    console.log('\nГотово! Заполни .env ключами, затем: npx freegate start');
    console.log('Совет: npx freegate init -i — интерактивный мастер с вопросами.');
  }
} else if (cmd === 'start') {
  // Spawn from the user's cwd (not package dir) so server.js picks up their
  // config.json / .env created by `init`.
  const child = spawn(process.execPath, [SERVER], { stdio: 'inherit' });
  child.on('close', (c) => process.exit(c || 0));
} else if (cmd === 'install-service') {
  const os = require('os');
  const { execSync } = require('child_process');
  const isMac = process.platform === 'darwin';
  const launchDir = process.cwd();
  const label = 'com.davilcod.proxy';

  if (isMac) {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${SERVER}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${launchDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>`;
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', label + '.plist');
    fs.writeFileSync(plistPath, plist);
    execSync(`launchctl unload ${plistPath} 2>/dev/null; launchctl load ${plistPath}`);
    console.log('✅ Служба автозапуска установлена (launchd)');
    console.log('   Прокси будет запускаться при включении компьютера');
  } else {
    // Linux: systemd user service
    const unit = `[Unit]
Description=Freegate LLM proxy
After=network.target

[Service]
WorkingDirectory=${launchDir}
ExecStart=${process.execPath} ${SERVER}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
    const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', 'freegate.service');
    fs.mkdirSync(path.dirname(unitPath), { recursive: true });
    fs.writeFileSync(unitPath, unit);
    execSync(`systemctl --user daemon-reload && systemctl --user enable freegate && systemctl --user start freegate`);
    console.log('✅ Служба автозапуска установлена (systemd)');
  }
} else if (cmd === 'dashboard') {
  console.log('Открой http://localhost:4000/ (запусти start сначала)');
} else if (cmd === 'test') {
  const http = require('http');
  const base = `http://127.0.0.1:${process.env.PORT || 4000}`;
  http.get(base + '/health', (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Прокси работает: ' + data);
      } else {
        console.log('❌ Прокси ответил ' + res.statusCode + ': ' + data);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.log('❌ Прокси не запущен на ' + base);
    console.log('   Запусти: npx freegate start');
    process.exit(1);
  });
} else if (cmd === 'status') {
  const http = require('http');
  const base = `http://127.0.0.1:${process.env.PORT || 4000}`;
  const pkg = require(path.join(ROOT, 'package.json'));
  console.log('Freegate v' + pkg.version);
  console.log('-----------------------------');
  http.get(base + '/v1/stats', (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.log('❌ Прокси не отвечает (HTTP ' + res.statusCode + ')');
        console.log('   Запусти: npx freegate start');
        process.exit(1);
      }
      try {
        const s = JSON.parse(data);
        console.log(`Запросов: ${s.total_requests} (успех ${s.successful_requests}, ошибок ${s.failed_requests})`);
        console.log(`Кэш: ${s.cache.size}/${s.cache.maxSize}, точность ${s.cache.hitRate}%`);
        const up = Object.values(s.health).filter(h => h.status === 'up').length;
        console.log(`Провайдеры: ${up}/${Object.keys(s.health).length} в строю`);
        for (const [k, h] of Object.entries(s.health)) {
          const icon = h.status === 'up' ? '✅' : '❌';
          const limit = s.limits?.[k];
          const limitStr = limit ? ` · лимит ${limit.used}/${limit.limit}` : '';
          console.log(`  ${icon} ${k} (${h.latency_ms}ms)${limitStr}${h.reason ? ' · ' + h.reason : ''}`);
        }
      } catch (e) {
        console.log('❌ Не удалось разобрать ответ: ' + e.message);
        process.exit(1);
      }
    });
  }).on('error', () => {
    console.log('❌ Прокси не запущен на ' + base);
    console.log('   Запусти: npx freegate start');
    process.exit(1);
  });
} else if (cmd === 'version' || cmd === '-v' || cmd === '--version') {
  const pkg = require(path.join(ROOT, 'package.json'));
  console.log(pkg.version);
} else {
  console.log('Freegate — бесплатный LLM-прокси с failover');
  console.log('Команды:');
  console.log('  npx freegate init       интерактивная настройка (ключи, пароль)');
  console.log('  npx freegate start      запустить прокси');
  console.log('  npx freegate status     диагностика: провайдеры, лимиты, ошибки');
  console.log('  npx freegate test       проверить, что прокси работает');
  console.log('  npx freegate dashboard  открыть дашборд');
  console.log('  npx freegate install-service  автозапуск при старте системы');
}
