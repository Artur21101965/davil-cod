// Автообновление Freegate на лету: периодически проверяет новую версию
// (git fetch) и при наличии апстрима делает fast-forward pull + перезапускает
// сервис (launchd), не требуя действия от пользователя. Никогда не трогает
// .env/config.json (gitignored) и не переживает локальные незакоммиченные
// правки: при грязном рабочем дереве pull пропускается.
const { execFile } = require('child_process');

const DEFAULT_INTERVAL_HOURS = 12;
const AUTO_UPDATE = () => {
  const cfg = {};
  try { Object.assign(cfg, require('../config.json').autoUpdate); } catch {}
  return {
    enabled: process.env.FREEGATE_AUTO_UPDATE ? process.env.FREEGATE_AUTO_UPDATE === '1' : !!cfg.enabled,
    intervalMs: cfg.intervalHours ? cfg.intervalHours * 3600e3 : cfg.intervalMs || (DEFAULT_INTERVAL_HOURS * 3600e3),
  };
};

function git(root, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, out: (stderr || stdout || '').trim() });
      else resolve({ ok: true, out: (stdout || '').trim() });
    });
  });
}

async function checkForUpdate(root, log) {
  const cfg = AUTO_UPDATE();
  if (!cfg.enabled) return { skipped: true };
  const fetch = await git(root, ['fetch', 'origin']);
  if (!fetch.ok) return { ok: false, reason: 'fetch: ' + fetch.out };
  // Рабочее дерево должно быть чистым, иначе pull может конфликтовать.
  const status = await git(root, ['status', '--porcelain']);
  if (status.out) return { ok: false, reason: 'грязное дерево (' + status.out.split('\n').length + ' файлов)' };
  const diff = await git(root, ['rev-list', '--count', 'HEAD..@{u}']);
  if (!diff.ok || diff.out.trim() === '0') return { ok: false, reason: 'нет новых коммитов' };
  const ahead = Number(diff.out.trim());
  const pull = await git(root, ['pull', '--ff-only', 'origin']);
  if (!pull.ok) return { ok: false, reason: 'pull: ' + pull.out };
  log('autoUpdate: pulled ' + ahead + ' commits, restarting service');
  return { ok: true, pulled: ahead };
}

function restartService() {
  const { execFileSync } = require('child_process');
  try { execFileSync('launchctl', ['kickstart', '-k', 'gui/' + process.getuid() + '/com.free-llm-proxy']); }
  catch (e) { try { execFileSync('kill', ['-HUP', String(process.pid)]); } catch {} }
}

function startAutoUpdate({ root, log }) {
  const cfg = AUTO_UPDATE();
  if (!cfg.enabled) return;
  const tick = () => {
    checkForUpdate(root, log).then((r) => {
      if (r.ok) {
        setTimeout(() => { restartService(); }, 800);
      }
    }).catch(() => {});
  };
  setTimeout(() => tick(), 60e3); // первый цикл через 1 мин, дальше по расписанию
  setInterval(tick, cfg.intervalMs);
}

module.exports = { startAutoUpdate, checkForUpdate, DEFAULT_INTERVAL_HOURS };
