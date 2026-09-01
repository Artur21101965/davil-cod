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

// Виртуальный провайдер категорий моделей. Вся полезная инфа для онбординга.
const EASY_START_PROVIDER = 'PROVIDER_OPENROUTER_APIKEY';
const EASY_START_NAME = 'OpenRouter';

async function initWizard() {
  const ask = makeReader();

  // 0. Объяснение + выбор режима (quick / full).
  console.log('\n=== Freegate — настройка ===');
  console.log('Почему Freegate бесплатный? Он маршрутизирует запросы между бесплатными моделями.');
  console.log('  • Минимум: 1 ключ OpenRouter → сразу 15+ бесплатных моделей (быстрый старт).');
  console.log('  • Максимум: ключи всех провайдеров → 8 источников, максимум скорости и надёжности.\n');
  const mode = (await ask('Режим [q]uick (1 ключ OpenRouter) или [f]ull (все ключи)? (q/f): ')).trim().toLowerCase();
  const full = mode === 'f' || mode === 'full';

  // 1. Auth key for the proxy
  const auth = await ask('Пароль для доступа к прокси (Enter = сгенерировать): ');
  const authKey = auth.trim() || 'dc_' + Math.random().toString(36).slice(2, 14);

  // 2. Collect provider keys from the catalog (unique env vars).
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
    // В quick-режиме OpenRouter просим обязательно-первым, остальные пропускаем.
    if (!full && envVar !== EASY_START_PROVIDER) continue;
    if (!full && envVar === EASY_START_PROVIDER) {
      console.log(`\n👉 ${EASY_START_NAME} — самый большой источник бесплатных моделей.`);
      console.log(`   Не хватает мощности? Позже добавь остальные ключи в дашборде (Настройки).`);
    } else {
      console.log(`\n${providers.join(', ')}`);
    }
    const answer = await ask(`  Ключ (${hint}) — пусто = пропустить: `);
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
  if (full) {
    console.log(`\nГотово! Провайдеров с ключами: ${filled} из ${envVars.size} (полный режим)`);
  } else {
    const hasEasy = !!keys[EASY_START_PROVIDER];
    console.log(`\nГотово! Режим quick: ${hasEasy ? 'OpenRouter добавлен' : 'ключей не введено'}.`);
    console.log('  Провайдеров с ключами: ' + filled + '. Добавить больше ключей можно в дашборде → Настройки.');
  }
  console.log(`Запуск: npx freegate start  (пароль: ${authKey})`);
  console.log('Подключить к Cursor: Настройки Cursor → Models → OpenAI-compatible → http://localhost:4000/v1');
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
} else if (cmd === 'doctor') {
  const doctor = require(path.join(ROOT, 'lib', 'doctor'));
  const setup = require(path.join(ROOT, 'lib', 'setup'));

  console.log('\n🩺 Freegate doctor');
  console.log('────────────────────');

  const snap = doctor.snapshot();

  // 1. Ключи — что задано.
  const keyGroups = Object.values(snap.keyState);
  const withKey = keyGroups.filter((k) => k.hasKey);
  const noKey = keyGroups.filter((k) => !k.hasKey);
  console.log(`Провайдеров в каталоге: ${snap.catalogCount}, групп провайдеров: ${keyGroups.length}`);
  console.log(`Ключей задано: ${withKey.length}/${keyGroups.length}`);
  if (withKey.length) {
    console.log('\n✅ Ключи установлены:');
    for (const k of withKey) {
      const masked = k.key.slice(0, 4) + '…' + (k.key.length > 8 ? k.key.slice(-4) : '');
      console.log(`   ${k.name.padEnd(18)} (${k.count.toString().padStart(2)} мод.)  ${masked}`);
    }
  }
  if (noKey.length) {
    console.log('\n⬜ Ключи не заданы (модели недоступны):');
    for (const k of noKey) console.log(`   ${k.name.padEnd(18)} (${k.count.toString().padStart(2)} мод.)`);
  }

  // 2. Модели — живое.
  const models = Object.keys(snap.models).length;
  console.log(`\nМоделей в базе: ${models}`);
  console.log(`   активных: ${snap.byStatus.active} · отключено: ${snap.byStatus.disabled} · неизвестно: ${snap.byStatus.unknown}`);
  if (snap.byStatus.active === 0 && models === 0) {
    console.log('   ⚠️ База пуста — запусти сервер, чтобы автопоиск нашёл модели.');
  }

  // 3. Рекомендации «что включить».
  const rec = doctor.recommend(snap.models);
  if (rec.disabledByUser.length || rec.paid.length || rec.local.length || rec.dead.length) {
    console.log('\n🔮 Что проверить:');
    if (rec.disabledByUser.length) console.log('   ✅ Выключенные free (можно вернуть): ' + rec.disabledByUser.join(', '));
    if (rec.paid.length) console.log('   🟠 Платные/малый лимит (держать выключенными): ' + rec.paid.join(', '));
    if (rec.local.length) console.log('   🏠 Локальные (слабый Mac): ' + rec.local.join(', '));
    if (rec.dead.length) console.log('   ⚠️ Мёртвые/непроверенные (чистить): ' + rec.dead.join(', '));
  }

  // 4. Быстрый старт.
  const easy = doctor.easyStartKey();
  const easyHas = snap.keyState[easy.envVar] && snap.keyState[easy.envVar].hasKey;
  if (!easyHas) {
    console.log(`\n💡 Быстрый старт: добавь ключ ${easy.name} — сразу ${easy.count}+ бесплатных моделей.`);
    console.log('   `npx freegate init -i` или дашборд → Настройки.');
  } else {
    console.log(`\n💡 Всё настроено. Запуск: npx freegate start · дашборд: http://localhost:4000`);
  }

  // Опциональная валидация ключей (медленная — по флагу).
  if (process.argv.includes('--validate')) {
    console.log('\n⏳ Проверяю ключи (может занять ~10с)...');
    let n = 0;
    (async () => {
      for (const k of keyGroups) {
        if (!k.hasKey) continue;
        const r = await setup.validateKey(k.envVar, k.key);
        n++;
        if (r.valid) console.log(`   ✅ ${k.name}`);
        else console.log(`   ❌ ${k.name}: ${r.error || 'неверный'}`);
      }
      process.exit(0);
    })();
  } else if (cmd === 'doctor') {
    // (validate-ветка уже вышла через process.exit выше — здесь просто тишина)
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
  const label = 'com.freegate.proxy';

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
} else if (cmd === 'themes') {
  console.log('🎨 Темы дашборда Freegate');
  console.log('-----------------------------');
  const themes = [
    ['poly', 'PolyCopy — тёмный, фиолетовый акцент (по умолчанию)'],
    ['warm', 'Тёплый — янтарный, уютный ламповый'],
    ['cosmic', 'Космос — глубокий синий, мягкий голубой'],
    ['paper', 'Бумага — светлый, инженерный чертёж'],
  ];
  for (const [id, desc] of themes) console.log('  ' + id.padEnd(8) + desc);
  console.log('-----------------------------');
  console.log('Как включить:');
  console.log('  ?theme=cosmic   — открыть дашборд в теме вручную');
  console.log('  Кнопка «Тема» в шапке дашборда — переключать по кругу');
  console.log('  Памятка: `--theme` не нужен, тема хранится в localStorage браузера.');
} else if (cmd === 'connect') {
  const onboarding = require(path.join(ROOT, 'lib', 'onboarding'));
  const setup = require(path.join(ROOT, 'lib', 'setup'));
  const { keys } = setup.readKeys();
  let AUTH = keys.AUTH || process.env.AUTH || '';
  if (!AUTH) {
    try { AUTH = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8')).auth) || ''; } catch {}
  }
  const port = process.env.PORT || '4000';
  const baseUrl = `http://localhost:${port}`;
  const apiKey = AUTH || 'твой_пароль';

  console.log('\n🔌 Подключить Freegate к клиенту');
  console.log('────────────────────────────────');
  console.log(`Base URL: ${baseUrl}/v1`);

  // Определяем, какой профиль выбрать: смотрим, какие модели уже активны.
  const doctor = require(path.join(ROOT, 'lib', 'doctor'));
  const snap = doctor.snapshot();
  const rec = doctor.recommend(snap.models);
  const activeCount = snap.byStatus.active || 0;

  console.log('\nВыбери профиль (подсказка по активным моделям):');
  for (const p of onboarding.profiles()) {
    console.log(`   ${p.id.padEnd(11)} ${p.name} — ${p.hint}`);
  }
  console.log('\nПрофиль не влияет на прокси — это подсказка, какую модель выбрать в клиенте.');

  console.log('\n─── Cursor ───');
  console.log(onboarding.snippetCursor(baseUrl, apiKey));
  console.log('\n─── opencode ───');
  console.log(onboarding.snippetOpencode(baseUrl, apiKey));
  console.log('\n─── Cline (VS Code) ───');
  console.log(onboarding.snippetCline(baseUrl, apiKey));
  console.log('\nСовет: модели с категорией coding → coder, design → designer и т.д.');
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
} else if (cmd === 'diag' || cmd === 'diagnose') {
  const http = require('http');
  const base = `http://127.0.0.1:${process.env.PORT || 4000}`;
  const diag = require(path.join(ROOT, 'lib', 'diag'));
  const g = (p) => new Promise((resolve) => {
    http.get(base + p, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
  (async () => {
    const [stats, recent] = await Promise.all([g('/v1/stats'), g('/v1/recent')]);
    if (!stats) { console.log('❌ Прокси не отвечает на ' + base + ' (запусти `npx freegate start`)'); process.exit(1); }
    const r = diag.buildReport(stats, recent?.data || []);
    const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) + '%' : '—';
    console.log('🔬 Freegate diag  (v' + r.version + ', uptime ' + Math.round((r.uptime || 0) / 60) + 'м)');
    console.log('────────────────────────────────');
    console.log('Сегодня: ' + r.today.requests + ' запросов → ' + r.today.success + ' успех, ' + r.today.failed + ' ошибок (' + (r.today.successRate ?? '—') + '%)');
    console.log('Провайдеры: ' + r.providers.up + ' up · ' + r.providers.ratelimited + ' ratelimited · ' + r.providers.down + ' error (из ' + r.providers.total + ')');
    console.log('Недавние: ' + r.recent.total + ' записей (' + r.recent.ok + ' ок, ' + r.recent.err + ' err, ' + r.recent.cached + ' из кэша), активно провайдеров: ' + r.recent.providersActive);
    console.log('Контекст: ' + r.context.status + ' · компакций ' + r.context.compactCount + ' · over-window ' + r.context.overWindow + ' · апгрейдов ' + r.context.upgradedCount);
    console.log('');
    console.log('Ошибки по классам:');
    for (const [cls, cnt] of Object.entries(r.classes)) {
      console.log('  ' + (cnt > 0 ? '🟠' : '  ') + ' ' + cls.padEnd(9) + String(cnt).padStart(4) + '  ' + diag.LABELS[cls]);
      if (cnt > 0 && diag.FIXES[cls]) console.log('     └→ ' + diag.FIXES[cls]);
    }
    console.log('');
    const topErrors = Object.entries(r.errors).sort((a, b) => b[1].errors - a[1].errors).slice(0, 10);
    if (topErrors.length) {
      console.log('Топ провайдеров по ошибкам:');
      for (const [k, v] of topErrors) {
        console.log('  ' + String(v.errors).padStart(3) + '  ' + k.padEnd(34) + ' [' + v.status + '] ' + (v.reason || '').slice(0, 40));
      }
    }
  })();
} else {
  console.log('Freegate — бесплатный LLM-прокси с failover');
  console.log('Команды:');
  console.log('  npx freegate init       интерактивная настройка (quick/full режим, пароль)');
  console.log('  npx freegate start      запустить прокси');
  console.log('  npx freegate status     диагностика: провайдеры, лимиты, ошибки');
  console.log('  npx freegate diag       отчёт: успешность, классы ошибок, смена провайдеров');
  console.log('  npx freegate test       проверить, что прокси работает');
  console.log('  npx freegate dashboard  открыть дашборд');
  console.log('  npx freegate install-service  автозапуск при старте системы');
}
