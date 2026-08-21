// lib/dashboard.js
const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DAVIL Cod — Панель управления</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
    h1 { color: #00d4ff; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { background: #16213e; border-radius: 8px; padding: 20px; border: 1px solid #0f3460; }
    .card h2 { color: #00d4ff; font-size: 14px; margin-bottom: 15px; text-transform: uppercase; }
    .stat { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .stat-label { color: #888; }
    .stat-value { color: #fff; font-weight: bold; }
    .provider { display: flex; align-items: center; margin-bottom: 10px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; }
    .status-up { background: #00ff88; }
    .status-error { background: #ff4444; }
    .status-unknown { background: #888; }
    .latency { color: #888; margin-left: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #0f3460; }
    th { color: #00d4ff; font-size: 12px; }
    td { font-size: 12px; }
    .refresh { color: #888; font-size: 12px; margin-top: 10px; }
    canvas { width: 100%; height: 120px; background: #0f3460; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>DAVIL Cod — Панель управления</h1>
  <div class="grid">
    <div class="card"><h2>Провайдеры</h2><div id="providers">Загрузка...</div></div>
    <div class="card"><h2>Статистика</h2><div id="stats">Загрузка...</div></div>
    <div class="card"><h2>Кэш</h2><div id="cache">Загрузка...</div></div>
    <div class="card"><h2>Токены</h2><div id="tokens">Загрузка...</div></div>
    <div class="card"><h2>Очередь</h2><div id="pool">Загрузка...</div></div>
    <div class="card" style="grid-column: span 2;"><h2>Лимиты (остаток за сегодня)</h2><div id="limits">Загрузка...</div></div>
    <div class="card" style="grid-column: span 2;"><h2>График запросов (в минуту)</h2><canvas id="rpmChart"></canvas></div>
    <div class="card" style="grid-column: span 2;">
      <h2>Недавние запросы</h2>
      <table id="recentTable"><tr><th>Время</th><th>Модель</th><th>Провайдер</th><th>Статус</th><th>Задержка</th></tr></table>
    </div>
  </div>
  <div class="refresh">Автообновление: 5 сек</div>
  <script>
    // Carry the ?key= param from the dashboard URL to API calls
    var _key = new URLSearchParams(location.search).get('key') || '';
    function _api(path) {
      return _key ? path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(_key) : path;
    }
    async function refresh() {
      try {
        const [statsRes, recentRes, rpmRes] = await Promise.all([
          fetch(_api('/v1/stats')), fetch(_api('/v1/recent')), fetch(_api('/v1/rpm'))
        ]);
        const data = await statsRes.json();
        const recent = (await recentRes.json()).data;
        const rpmData = (await rpmRes.json()).data;
        renderProviders(data.health);
        renderStats(data);
        renderCache(data.cache);
        renderTokens(data.token_usage || {});
        renderPool(data.pool || {});
        renderLimits(data.limits || {});
        renderRpm(rpmData);
        renderRecent(recent);
      } catch (e) { console.error('Ошибка обновления:', e); }
    }

    function renderProviders(health) {
      let html = '';
      for (const [key, h] of Object.entries(health)) {
        const cls = h.status === 'up' ? 'status-up' : h.status === 'error' ? 'status-error' : 'status-unknown';
        const rel = h.reliability !== null && h.reliability !== undefined ? ' | стаб. ' + h.reliability + '%' : '';
        html += '<div class="provider"><div class="status-dot ' + cls + '"></div>';
        html += '<span>' + key + '</span><span class="latency">' + h.latency_ms + 'ms · ' + (h.reason || '—') + rel + '</span></div>';
      }
      document.getElementById('providers').innerHTML = html || '<div>Нет провайдеров</div>';
    }

    function renderStats(data) {
      document.getElementById('stats').innerHTML =
        '<div class="stat"><span class="stat-label">Запросов</span><span class="stat-value">' + data.total_requests + '</span></div>' +
        '<div class="stat"><span class="stat-label">Успешно</span><span class="stat-value">' + data.successful_requests + '</span></div>' +
        '<div class="stat"><span class="stat-label">Ошибок</span><span class="stat-value">' + data.failed_requests + '</span></div>' +
        '<div class="stat"><span class="stat-label">Время работы</span><span class="stat-value">' + Math.floor(data.uptime_seconds / 60) + ' мин</span></div>';
    }

    function renderCache(cache) {
      if (!cache) return;
      document.getElementById('cache').innerHTML =
        '<div class="stat"><span class="stat-label">Хиты</span><span class="stat-value">' + cache.hits + '</span></div>' +
        '<div class="stat"><span class="stat-label">Промахи</span><span class="stat-value">' + cache.misses + '</span></div>' +
        '<div class="stat"><span class="stat-label">Размер</span><span class="stat-value">' + cache.size + '/' + cache.maxSize + '</span></div>' +
        '<div class="stat"><span class="stat-label">Точность</span><span class="stat-value">' + cache.hitRate + '%</span></div>';
    }

    function renderTokens(tokens) {
      let html = '';
      for (const [key, t] of Object.entries(tokens)) {
        html += '<div class="stat"><span class="stat-label">' + key + '</span><span class="stat-value">' + t.totalTokens + ' ток.</span></div>';
      }
      document.getElementById('tokens').innerHTML = html || '<div>Нет данных</div>';
    }

    function renderPool(pool) {
      let html = '';
      let totalQueued = 0;
      for (const [key, s] of Object.entries(pool)) {
        totalQueued += s.queued || 0;
        if (s.queued > 0) {
          html += '<div class="stat"><span class="stat-label">' + key + '</span><span class="stat-value">активных ' + s.active + ', ждут ' + s.queued + '</span></div>';
        }
      }
      if (!html) html = '<div class="stat"><span class="stat-label">Все провайдеры</span><span class="stat-value">без очереди</span></div>';
      document.getElementById('pool').innerHTML = html;
    }

    function renderLimits(limits) {
      let html = '';
      const keys = Object.keys(limits).sort((a, b) => (limits[a].percent || 0) - (limits[b].percent || 0));
      for (const key of keys) {
        const l = limits[key];
        const color = l.percent > 90 ? '#ff4444' : l.percent > 60 ? '#ffaa00' : '#00ff88';
        html += '<div class="stat"><span class="stat-label">' + key + '</span>' +
          '<span class="stat-value" style="color:' + color + '">' + l.used + '/' + l.limit + ' (ост. ' + l.remaining + ', ' + l.percent + '%)</span></div>';
      }
      document.getElementById('limits').innerHTML = html || '<div>Нет данных</div>';
    }

    function renderRpm(rpmData) {
      const canvas = document.getElementById('rpmChart');
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!rpmData || rpmData.length === 0) return;
      const max = Math.max.apply(null, rpmData.map(r => r.count), 1);
      const w = canvas.width, h = canvas.height;
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      rpmData.forEach((r, i) => {
        const x = w - (rpmData.length - 1 - i) * (w / 60);
        const y = h - (r.count / max) * (h - 20) - 10;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    function renderRecent(recent) {
      const table = document.getElementById('recentTable');
      table.innerHTML = '<tr><th>Время</th><th>Модель</th><th>Провайдер</th><th>Статус</th><th>Задержка</th></tr>';
      recent.forEach(r => {
        const row = table.insertRow();
        row.insertCell().textContent = new Date(r.timestamp).toLocaleTimeString('ru-RU');
        row.insertCell().textContent = r.model || '-';
        row.insertCell().textContent = r.provider || '-';
        row.insertCell().textContent = r.status || '-';
        row.insertCell().textContent = (r.latency || 0) + 'ms';
      });
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;

function handleDashboard(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

module.exports = { handleDashboard };
