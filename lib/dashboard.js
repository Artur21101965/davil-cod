// lib/dashboard.js — панель управления Freegate.
// Каркас: sticky KPI-полоска + 5 табов (Обзор / Провайдеры / Модели / Контекст /
// Настройки). Zero-dependency: весь HTML/CSS/JS инлайн. Таблицы с сортировкой,
// фильтрами и поиском на vanilla JS. Данные: /v1/stats, /v1/recent, /v1/rpm,
// /v1/models-db, /v1/setup/keys.
const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%2300d4ff'/%3E%3C/svg%3E">
  <title>Freegate — Панель управления</title>
  <style>
    :root {
      --bg: #0d1117; --panel: #161b22; --panel2: #1c2330; --border: #232a3d;
      --accent: #00d4ff; --ok: #00ff88; --warn: #ffaa00; --err: #ff4444;
      --text: #e6e6e6; --muted: #8b949e;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; background: var(--bg); color: var(--text); padding-bottom: 40px; }

    /* ── Sticky KPI-полоска ── */
    #topbar { position: sticky; top: 0; z-index: 10; background: rgba(13,17,23,.95); backdrop-filter: blur(6px);
      border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .brand { font-size: 17px; font-weight: bold; color: var(--accent); display: flex; align-items: center; gap: 8px; margin-right: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; background: var(--muted); }
    .dot.ok { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
    .dot.bad { background: var(--err); box-shadow: 0 0 6px var(--err); }
    .kpi { display: flex; flex-wrap: wrap; gap: 8px; }
    .kpi-chip { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 12px; }
    .kpi-chip b { color: var(--accent); font-size: 13px; margin-left: 6px; }
    .kpi-chip.warn b { color: var(--warn); }
    .kpi-chip.err b { color: var(--err); }

    /* ── Табы ── */
    #tabs { display: flex; gap: 6px; padding: 12px 20px 0; flex-wrap: wrap; }
    .tab { padding: 9px 18px; border-radius: 8px 8px 0 0; cursor: pointer; background: var(--panel);
      color: var(--muted); border: 1px solid var(--border); border-bottom: none; font-size: 13px; user-select: none; }
    .tab.active { color: var(--accent); background: var(--panel2); border-color: var(--accent); }
    .tab:hover { color: var(--text); }

    main { padding: 0 20px; }
    .panel { display: none; padding-top: 16px; }
    .panel.active { display: block; }

    /* ── Переключатель языка ── */
    .lang-switch { margin-left: auto; display: flex; gap: 4px; }
    .lang-btn { padding: 5px 11px; border-radius: 6px; background: var(--panel); border: 1px solid var(--border);
      color: var(--muted); font-size: 11px; font-weight: bold; cursor: pointer; }
    .lang-btn.active { color: var(--accent); border-color: var(--accent); }
    .lang-btn:hover { color: var(--text); }

    /* ── Карточки/сетки ── */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .card { background: var(--panel); border-radius: 10px; padding: 16px 18px; border: 1px solid var(--border); }
    .card h2 { color: var(--accent); font-size: 12px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: .5px; }
    .stat { display: flex; justify-content: space-between; margin-bottom: 7px; gap: 10px; }
    .stat-label { color: var(--muted); }
    .stat-value { color: #fff; font-weight: bold; text-align: right; }

    /* ── Алерты ── */
    #alerts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .alert { padding: 10px 14px; border-radius: 8px; font-size: 13px; border: 1px solid; }
    .alert.err { background: rgba(255,68,68,.08); border-color: var(--err); color: #ffb3b3; }
    .alert.warn { background: rgba(255,170,0,.07); border-color: var(--warn); color: #ffd999; }
    .alert.ok { background: rgba(0,255,136,.06); border-color: var(--ok); color: #b3ffd9; }

    /* ── Тулбар: поиск + фильтры ── */
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
    .search { flex: 1; min-width: 200px; max-width: 340px; padding: 8px 12px; border-radius: 8px;
      border: 1px solid var(--border); background: var(--panel); color: #fff; font-size: 13px; outline: none; }
    .search:focus { border-color: var(--accent); }
    select.filter { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel); color: var(--text); font-size: 12px; outline: none; cursor: pointer; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { padding: 6px 12px; border-radius: 999px; background: var(--panel); border: 1px solid var(--border);
      color: var(--muted); font-size: 12px; cursor: pointer; user-select: none; }
    .chip.active { color: var(--accent); border-color: var(--accent); }
    .count-hint { color: var(--muted); font-size: 12px; margin-left: auto; }

    /* ── Таблицы ── */
    .table-wrap { overflow-x: auto; background: var(--panel); border-radius: 10px; border: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 12.5px; white-space: nowrap; }
    th { color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .4px; cursor: pointer; user-select: none; }
    th:hover { color: #fff; }
    th .arr { font-size: 9px; margin-left: 3px; }
    td { color: var(--text); }
    tr:hover td { background: rgba(0,212,255,.03); }
    .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: bold; display: inline-block; }
    .badge.up, .badge.active { background: rgba(0,255,136,.12); color: var(--ok); }
    .badge.ratelimited { background: rgba(255,170,0,.12); color: var(--warn); }
    .badge.error, .badge.dead { background: rgba(255,68,68,.12); color: var(--err); }
    .badge.unknown, .badge.untested { background: rgba(139,148,158,.15); color: var(--muted); }
    .badge.disabled, .badge.user-disabled { background: rgba(139,148,158,.1); color: var(--muted); }
    .limit-bar { width: 110px; height: 6px; background: var(--panel2); border-radius: 4px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 7px; }
    .limit-fill { height: 100%; border-radius: 4px; }
    .score { font-weight: bold; color: var(--accent); }
    .mono { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; }

    /* ── Действия над моделями ── */
    .model-actions { display: flex; gap: 6px; align-items: center; white-space: nowrap; }
    .mini-btn { padding: 4px 9px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel2);
      color: var(--text); font-size: 11px; cursor: pointer; }
    .mini-btn:hover { border-color: var(--accent); color: var(--accent); }
    .mini-btn.off { color: var(--warn); }

    /* ── Рекомендации ── */
    .rec { font-size: 12px; margin-bottom: 7px; line-height: 1.5; }
    .rec-badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: bold; margin-right: 6px; }
    .rec-badge.ok { background: rgba(0,255,136,.12); color: var(--ok); }
    .rec-badge.warn { background: rgba(255,170,0,.12); color: var(--warn); }
    .rec-badge { background: rgba(139,148,158,.15); color: var(--muted); }

    /* ── Экономия ── */
    .savings .savings-usd { color: var(--ok); font-size: 24px; }

    canvas { width: 100%; height: 160px; background: var(--panel); border-radius: 10px; border: 1px solid var(--border); }
    .refresh { color: var(--muted); font-size: 11px; margin-top: 14px; }
    .task-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; font-size: 12px; }
    .task-bar .name { width: 90px; color: var(--muted); }
    .task-bar .bar { flex: 1; height: 8px; background: var(--panel2); border-radius: 5px; overflow: hidden; }
    .task-bar .fill { height: 100%; background: var(--accent); border-radius: 5px; }
    .task-bar .num { width: 74px; text-align: right; }

    /* ── Setup ── */
    .setup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
    .key-card { background: var(--panel); border-radius: 10px; padding: 16px; border: 1px solid var(--border); }
    .key-card h3 { color: var(--accent); font-size: 14px; margin-bottom: 8px; }
    .key-card .desc { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
    .key-card ol { color: #aaa; font-size: 11px; padding-left: 18px; margin-bottom: 10px; }
    .key-card li { margin-bottom: 4px; }
    .key-card a { color: var(--accent); text-decoration: none; }
    .key-input-row { display: flex; gap: 8px; align-items: center; }
    .key-input { flex: 1; padding: 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: #fff; font-size: 12px; font-family: monospace; }
    .btn { padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: bold; }
    .btn-validate { background: var(--panel2); color: var(--accent); }
    .btn-save { background: var(--accent); color: #000; }
    .btn-test-all { background: var(--panel2); color: var(--ok); }
    .status-ok { color: var(--ok); font-size: 11px; }
    .status-err { color: var(--err); font-size: 11px; }
    .status-wait { color: var(--muted); font-size: 11px; }
    .hidden { display: none; }

    @media (max-width: 640px) {
      #topbar { padding: 10px 12px; }
      main, #tabs { padding-left: 12px; padding-right: 12px; }
      .kpi-chip { font-size: 11px; padding: 5px 9px; }
    }
  </style>
</head>
<body>
  <header id="topbar">
    <div class="brand"><span id="statusDot" class="dot"></span>Freegate</div>
    <div class="kpi" id="kpiBar"></div>
    <div class="lang-switch">
      <button class="lang-btn" data-lang="ru" onclick="setLang('ru')">RU</button>
      <button class="lang-btn" data-lang="en" onclick="setLang('en')">EN</button>
    </div>
  </header>

  <nav id="tabs">
    <div class="tab active" data-i18n="tabOverview" onclick="showTab('overview')"></div>
    <div class="tab" data-i18n="tabProviders" onclick="showTab('providers')"></div>
    <div class="tab" data-i18n="tabModels" onclick="showTab('models')"></div>
    <div class="tab" data-i18n="tabContext" onclick="showTab('context')"></div>
    <div class="tab" data-i18n="tabSetup" onclick="showTab('setup')"></div>
  </nav>

  <main>
    <!-- ═══ ОБЗОР ═══ -->
    <section id="panel-overview" class="panel active">
      <div id="alerts"></div>
      <div class="grid">
        <div class="card"><h2 data-i18n="cardCache"></h2><div id="cache" data-i18n="loading"></div></div>
        <div class="card"><h2 data-i18n="cardTokens"></h2><div id="tokens" data-i18n="loading"></div></div>
        <div class="card"><h2 data-i18n="cardPool"></h2><div id="pool" data-i18n="loading"></div></div>
        <div class="card"><h2 data-i18n="cardSavings"></h2><div id="savings" data-i18n="loading"></div></div>
      </div>
      <div class="card" style="margin-top:16px;"><h2 data-i18n="cardRpm"></h2><canvas id="rpmChart"></canvas></div>
      <div class="card" style="margin-top:16px;">
        <h2 data-i18n="cardRecent"></h2>
        <div class="table-wrap"><table id="recentTable"></table></div>
      </div>
    </section>

    <!-- ═══ ПРОВАЙДЕРЫ ═══ -->
    <section id="panel-providers" class="panel">
      <div class="toolbar">
        <input id="providerSearch" class="search" type="text" placeholder="" data-i18n-ph="searchProvider" oninput="renderProvidersTable()">
        <div class="chips" id="providerChips">
          <div class="chip active" data-i18n="filterAll" onclick="setProviderFilter('all', this)"></div>
          <div class="chip" data-i18n="filterUp" onclick="setProviderFilter('up', this)"></div>
          <div class="chip" data-i18n="filterLimit" onclick="setProviderFilter('ratelimited', this)"></div>
          <div class="chip" data-i18n="filterError" onclick="setProviderFilter('error', this)"></div>
          <div class="chip" data-i18n="filterUnknown" onclick="setProviderFilter('unknown', this)"></div>
        </div>
        <span class="count-hint" id="providerCount"></span>
      </div>
      <div class="table-wrap">
        <table id="providerTable"></table>
      </div>
    </section>

    <!-- ═══ МОДЕЛИ ═══ -->
    <section id="panel-models" class="panel">
      <div class="toolbar">
        <input id="modelSearch" class="search" type="text" placeholder="" data-i18n-ph="searchModel" oninput="renderModelsTable()">
        <select id="modelCategoryFilter" class="filter" data-i18n="allCategories" onchange="renderModelsTable()"><option value="all"></option></select>
        <select id="modelStatusFilter" class="filter" data-i18n="allStatuses" onchange="renderModelsTable()"><option value="all"></option></select>
        <select id="modelSourceFilter" class="filter" data-i18n="allSources" onchange="renderModelsTable()"><option value="all"></option></select>
        <span class="count-hint" id="modelCount"></span>
      </div>
      <div class="card" style="margin-bottom:14px;"><h2 data-i18n="recBlock"></h2><div id="modelRecommend"></div></div>
      <div class="table-wrap">
        <table id="modelTable"></table>
      </div>
      <div class="refresh" id="modelManagerInfo"></div>
    </section>

    <!-- ═══ КОНТЕКСТ ═══ -->
    <section id="panel-context" class="panel">
      <div class="grid">
        <div class="card"><h2 data-i18n="cardCtx"></h2><div id="ctxBlock" data-i18n="loading"></div></div>
        <div class="card"><h2 data-i18n="cardTasks"></h2><div id="taskBars" data-i18n="loading"></div></div>
      </div>
    </section>

    <!-- ═══ НАСТРОЙКИ ═══ -->
    <section id="panel-setup" class="panel">
      <div style="margin-bottom: 16px;">
        <button class="btn btn-test-all" data-i18n="validateAll" onclick="validateAll()"></button>
        <button class="btn btn-save" data-i18n="saveAllKeys" onclick="saveAllKeys()" style="margin-left: 8px;"></button>
        <span id="save-status" class="status-wait" style="margin-left: 12px;"></span>
      </div>
      <div id="setup-grid" class="setup-grid" data-i18n="loading"></div>
    </section>
  </main>

  <div class="refresh" style="padding: 0 20px;" data-i18n="autoRefresh"></div>

  <script>
    // Carry the ?key= param from the dashboard URL to API calls
    var _key = new URLSearchParams(location.search).get('key') || '';
    function _api(path) {
      return _key ? path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(_key) : path;
    }

    // ── i18n: RU/EN ──
    var I18N = {
      ru: {
        tabOverview: 'Обзор', tabProviders: 'Провайдеры', tabModels: 'Модели',
        tabContext: 'Контекст', tabSetup: 'Настройки (ключи)',
        kpiProviders: 'Провайдеры', kpiRequests: 'Запросы', kpiRpm: 'RPM', kpiCache: 'Кэш',
        kpiToday: 'Успех сегодня', kpiLimit: 'Лимит', kpiModels: 'Модели', kpiUptime: 'Аптайм',
        cardSavings: 'Экономия (против платных API)', savings: 'Сэкономлено', tokens: 'токенов',
        savingsBasis: 'расчёт: input $3/M, output $15/M (репрезентативно)',
        cardCache: 'Кэш', cardTokens: 'Токены', cardPool: 'Очередь',
        cardRpm: 'Запросов в минуту', cardRecent: 'Недавние запросы',
        cardCtx: 'Контекст (узкое место)', cardTasks: 'Категории задач (24ч)',
        loading: 'Загрузка...', noData: 'Нет данных',
        cacheHits: 'Хиты', cacheMisses: 'Промахи', cacheSize: 'Размер', cacheRate: 'Точность',
        poolAll: 'без очереди', poolActive: 'активных', poolWait: 'ждут',
        searchProvider: 'Поиск провайдера...', searchModel: 'Поиск модели...',
        filterAll: 'Все', filterUp: 'Up', filterLimit: 'Лимит', filterError: 'Ошибка', filterUnknown: 'Неизвестно',
        thStatus: 'Статус', thProvider: 'Провайдер', thLatency: 'Задержка', thReliability: 'Стабильность',
        thLimit: 'Лимит', thReason: 'Причина', dot: '—',
        thScore: 'Скор', thKey: 'Ключ', thModel: 'Модель', thSource: 'Источник', thCategory: 'Категория',
        thWindow: 'Окно', thDayLimit: 'Лимит/день', thStatus2: 'Статус', thChecked: 'Проверка', thAction: 'Действие',
        thRecentTime: 'Время', thRecentModel: 'Модель', thRecentProvider: 'Провайдер', thRecentStatus: 'Статус', thRecentLatency: 'Задержка',
        allCategories: 'Все категории', allStatuses: 'Все статусы', allSources: 'Все источники',
        enable: 'Вкл', disable: 'Выкл', testNow: 'Тест', testing: 'Проверка...',
        recBlock: 'Что включить', recActiveFree: 'Рабочие free — включи', recPaid: 'Платные/нестабильные', recLocal: 'Локальные (слабый Mac)',
        modelManagerInfo: 'Автопоиск', every: 'каждые', off: 'выключен', cycleRunning: 'цикл выполняется...',
        overviewLineOk: 'Всё работает штатно', overviewDown: 'Упали', overviewLimit: 'Лимит исчерпан',
        overviewRisky: 'Лимит близок к исчерпанию', overviewCtx: 'Контекст',
        autoRefresh: 'Автообновление: 5 сек · модели: 30 сек',
        validateAll: 'Проверить все ключи', saveAllKeys: 'Сохранить все ключи',
        keySet: 'ключ установлен', keyMissing: 'не задан', checkKey: 'Проверить', valid: 'Ключ валиден', invalid: 'Неверный ключ',
        saving: 'Сохранение...', savedMsg: 'Сохранено! Перезапусти Freegate для применения.', saveErr: 'Ошибка сохранения',
        ctxStatus: 'Статус', ctxReq: 'Запросов (24ч)', ctxRate: 'Rate (1/ч)', ctxAvgRatio: 'Avg ratio / окно',
        ctxMaxRatio: 'Max ratio', ctxNear: 'Впритык к окну', ctxOver: 'Поверх окна', ctxCompact: 'Компакций',
        ctxUpgrade: 'Апгрейдов (окно)', ctxCacheRate: 'Кэш-hit %', ctxSys: 'System-доля', ctxNarrow: 'Узкие',
        ctxRecap: 'для recap: node tools/context-diag.js', ctxNoTask: 'Категорий пока нет',
        noModels: 'База пуста — дождись первого цикла автопоиска', tipsRecap: 'для recap',
      },
      en: {
        tabOverview: 'Overview', tabProviders: 'Providers', tabModels: 'Models',
        tabContext: 'Context', tabSetup: 'Settings (keys)',
        kpiProviders: 'Providers', kpiRequests: 'Requests', kpiRpm: 'RPM', kpiCache: 'Cache',
        kpiToday: 'Success today', kpiLimit: 'Limit', kpiModels: 'Models', kpiUptime: 'Uptime',
        cardSavings: 'Savings (vs paid APIs)', savings: 'Saved', tokens: 'tokens',
        savingsBasis: 'estimate: input $3/M, output $15/M (representative)',
        cardCache: 'Cache', cardTokens: 'Tokens', cardPool: 'Queue',
        cardRpm: 'Requests per minute', cardRecent: 'Recent requests',
        cardCtx: 'Context (bottleneck)', cardTasks: 'Task categories (24h)',
        loading: 'Loading...', noData: 'No data',
        cacheHits: 'Hits', cacheMisses: 'Misses', cacheSize: 'Size', cacheRate: 'Rate',
        poolAll: 'no queue', poolActive: 'active', poolWait: 'waiting',
        searchProvider: 'Search provider...', searchModel: 'Search model...',
        filterAll: 'All', filterUp: 'Up', filterLimit: 'Limit', filterError: 'Error', filterUnknown: 'Unknown',
        thStatus: 'Status', thProvider: 'Provider', thLatency: 'Latency', thReliability: 'Reliability',
        thLimit: 'Limit', thReason: 'Reason', dot: '—',
        thScore: 'Score', thKey: 'Key', thModel: 'Model', thSource: 'Source', thCategory: 'Category',
        thWindow: 'Window', thDayLimit: 'Limit/day', thStatus2: 'Status', thChecked: 'Checked', thAction: 'Action',
        thRecentTime: 'Time', thRecentModel: 'Model', thRecentProvider: 'Provider', thRecentStatus: 'Status', thRecentLatency: 'Latency',
        allCategories: 'All categories', allStatuses: 'All statuses', allSources: 'All sources',
        enable: 'On', disable: 'Off', testNow: 'Test', testing: 'Testing...',
        recBlock: 'What to enable', recActiveFree: 'Working free — enable', recPaid: 'Paid/unstable', recLocal: 'Local (weak Mac)',
        modelManagerInfo: 'Auto-discovery', every: 'every', off: 'off', cycleRunning: 'cycle running...',
        overviewLineOk: 'All systems operational', overviewDown: 'Down', overviewLimit: 'Limit exhausted',
        overviewRisky: 'Limit near exhaustion', overviewCtx: 'Context',
        autoRefresh: 'Auto-refresh: 5s · models: 30s',
        validateAll: 'Validate all keys', saveAllKeys: 'Save all keys',
        keySet: 'key set', keyMissing: 'not set', checkKey: 'Validate', valid: 'Key valid', invalid: 'Invalid key',
        saving: 'Saving...', savedMsg: 'Saved! Restart Freegate to apply.', saveErr: 'Save error',
        ctxStatus: 'Status', ctxReq: 'Requests (24h)', ctxRate: 'Rate (1/h)', ctxAvgRatio: 'Avg ratio / window',
        ctxMaxRatio: 'Max ratio', ctxNear: 'Near window', ctxOver: 'Over window', ctxCompact: 'Compactions',
        ctxUpgrade: 'Upgrades (window)', ctxCacheRate: 'Cache-hit %', ctxSys: 'System share', ctxNarrow: 'Narrow',
        ctxRecap: 'for recap: node tools/context-diag.js', ctxNoTask: 'No categories yet',
        noModels: 'Base is empty — wait for the first auto-discovery cycle', tipsRecap: 'for recap',
      },
    };
    var _lang = localStorage.getItem('fg_lang') || (navigator.language && navigator.language.toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en');
    function t(key) { return (I18N[_lang] && I18N[_lang][key]) || (I18N.ru[key]) || key; }
    function setLang(lang) { _lang = lang; localStorage.setItem('fg_lang', lang); applyLang(); refresh(); }
    function applyLang() {
      document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
      document.querySelectorAll('input[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
      var btns = document.querySelectorAll('.lang-btn');
      btns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-lang') === _lang); });
    }

    // ── состояние клиента ──
    var _health = {}, _limits = {}, _cache = null, _pool = {}, _statsData = null, _ctxSummary = null;
    var _rpmData = [], _recent = [];
    var _models = [], _modelStats = null, _modelManager = null, _modelsFetchedAt = 0;
    var _savings = null;
    var _providerFilter = 'all', _providerQuery = '';
    var _provSort = { key: null, dir: 1 };
    var _modelSort = { key: 'score', dir: -1 };

    // ── табы ──
    var _tabByKey = { overview: 'tabOverview', providers: 'tabProviders', models: 'tabModels', context: 'tabContext', setup: 'tabSetup' };
    function showTab(tab) {
      var key = _tabByKey[tab];
      document.querySelectorAll('#tabs .tab').forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-i18n') === key);
      });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      document.getElementById('panel-' + tab).classList.add('active');
      // Шаринг вкладки по хэшу (#models и т.д.)
      if (location.hash !== '#' + tab) { try { history.replaceState(null, '', '#' + tab); } catch (e) {} }
      if (tab === 'setup' && !_setupData) loadSetup();
      if (tab === 'models') fetchModels();
    }

    // ── форматтеры ──
    function fmtTokens(n) {
      if (!n || n < 1000) return String(n || 0);
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/, '') + 'M';
      var k = n / 1000;
      var s = k < 10 ? (Math.round(k * 10) / 10).toFixed(1).replace(/\\.0$/, '') : Math.round(k).toString();
      return s + 'K';
    }
    function fmtUptime(sec) {
      if (!sec || sec < 0) return '—';
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h > 0 ? h + 'ч ' + m + 'м' : m + 'м';
    }
    function fmtDate(ts) { return ts ? new Date(ts).toLocaleString('ru-RU') : '—'; }
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function limitColor(p) { return p > 90 ? 'var(--err)' : p > 60 ? 'var(--warn)' : 'var(--ok)'; }

    // ── главный цикл обновления ──
    function refresh() {
      Promise.all([
        fetch(_api('/v1/stats')).then(function (r) { return r.json(); }),
        fetch(_api('/v1/recent')).then(function (r) { return r.json(); }),
        fetch(_api('/v1/rpm')).then(function (r) { return r.json(); })
      ]).then(function (res) {
        _statsData = res[0];
        _recent = (res[1].data) || [];
        _rpmData = (res[2].data) || [];
        _health = _statsData.health || {};
        _limits = _statsData.limits || {};
        _cache = _statsData.cache || null;
        _pool = _statsData.pool || {};
        _ctxSummary = _statsData.context_summary || null;
        _savings = _statsData.savings || null;
        renderKpi();
        renderAlerts();
        renderOverviewCards();
        renderRpm(_rpmData);
        renderRecent(_recent);
        renderProvidersTable();
        renderContext(_ctxSummary);
      }).catch(function (e) { console.error('Ошибка обновления:', e); });
    }

    // ── KPI-полоска ──
    function renderKpi() {
      var up = 0, total = 0;
      for (var k in _health) { total++; if (_health[k].status === 'up') up++; }
      var rpm = _rpmData.length ? _rpmData[_rpmData.length - 1].count : 0;
      var cacheRate = _cache ? (_cache.hitRate || 0) : 0;
      var riskKey = null, riskPct = 0;
      for (var lk in _limits) {
        var p = _limits[lk].percent || 0;
        if (p > riskPct) { riskPct = p; riskKey = lk; }
      }
      var html = '';
      html += '<div class="kpi-chip">' + t('kpiProviders') + '<b>' + up + '/' + total + '</b></div>';
      html += '<div class="kpi-chip">' + t('kpiRequests') + '<b>' + (_statsData ? _statsData.total_requests : 0) + '</b></div>';
      html += '<div class="kpi-chip">' + t('kpiRpm') + '<b>' + rpm + '</b></div>';
      html += '<div class="kpi-chip">' + t('kpiCache') + '<b>' + cacheRate + '%</b></div>';
      // Успех сегодня — главная метрика ценности. Зелёная при высоком, жёлтая/красная при деградации.
      if (_statsData && _statsData.today) {
        var td = _statsData.today;
        var tbCls = td.successRate >= 80 ? '' : td.successRate >= 50 ? ' warn' : ' err';
        html += '<div class="kpi-chip' + tbCls + '">' + t('kpiToday') + '<b>' + td.successRate + '%</b></div>';
      }
      if (riskKey) {
        var cls = riskPct > 90 ? ' err' : riskPct > 60 ? ' warn' : '';
        html += '<div class="kpi-chip' + cls + '">' + t('kpiLimit') + ': ' + esc(riskKey) + '<b>' + riskPct + '%</b></div>';
      }
      if (_modelStats) html += '<div class="kpi-chip">' + t('kpiModels') + '<b>' + (_modelStats.byStatus.active || 0) + '/' + _modelStats.total + '</b></div>';
      html += '<div class="kpi-chip">' + t('kpiUptime') + '<b>' + fmtUptime(_statsData ? _statsData.uptime_seconds : 0) + '</b></div>';
      document.getElementById('kpiBar').innerHTML = html;
      var dot = document.getElementById('statusDot');
      dot.className = 'dot ' + (up > 0 ? 'ok' : 'bad');
    }

    // ── алерты ──
    function renderAlerts() {
      var alerts = [];
      var down = [], limited = [];
      for (var k in _health) {
        var h = _health[k];
        if (h.status === 'error') down.push(k + (h.reason ? ' (' + h.reason + ')' : ''));
        else if (h.status === 'ratelimited') limited.push(k);
      }
      if (down.length) alerts.push('<div class="alert err">' + t('overviewDown') + ': ' + esc(down.join(', ')) + '</div>');
      if (limited.length) alerts.push('<div class="alert warn">' + t('overviewLimit') + ': ' + esc(limited.join(', ')) + '</div>');
      var risky = [];
      for (var lk in _limits) { if ((_limits[lk].percent || 0) > 90) risky.push(lk + ' ' + _limits[lk].percent + '%'); }
      if (risky.length) alerts.push('<div class="alert warn">' + t('overviewRisky') + ': ' + esc(risky.join(', ')) + '</div>');
      if (_ctxSummary && _ctxSummary.status && _ctxSummary.status !== 'OK') {
        alerts.push('<div class="alert warn">' + t('overviewCtx') + ': ' + esc(_ctxSummary.status) + ' (' + t('ctxNarrow') + ': ' + esc((_ctxSummary.narrowProviders || []).join(', ') || '—') + ')</div>');
      }
      if (alerts.length === 0) alerts.push('<div class="alert ok">' + t('overviewLineOk') + '</div>');
      document.getElementById('alerts').innerHTML = alerts.join('');
    }

    // ── карточки обзора ──
    function renderOverviewCards() {
      if (_cache) {
        document.getElementById('cache').innerHTML =
          '<div class="stat"><span class="stat-label">' + t('cacheHits') + '</span><span class="stat-value">' + _cache.hits + '</span></div>' +
          '<div class="stat"><span class="stat-label">' + t('cacheMisses') + '</span><span class="stat-value">' + _cache.misses + '</span></div>' +
          '<div class="stat"><span class="stat-label">' + t('cacheSize') + '</span><span class="stat-value">' + _cache.size + '/' + _cache.maxSize + '</span></div>' +
          '<div class="stat"><span class="stat-label">' + t('cacheRate') + '</span><span class="stat-value">' + _cache.hitRate + '%</span></div>';
      }
      var tokens = _statsData.token_usage || {};
      var th = '';
      for (var tk in tokens) th += '<div class="stat"><span class="stat-label">' + esc(tk) + '</span><span class="stat-value">' + fmtTokens(tokens[tk].totalTokens) + ' ток.</span></div>';
      document.getElementById('tokens').innerHTML = th || '<div>' + t('noData') + '</div>';
      var ph = '', anyQueue = false;
      for (var pk in _pool) {
        var s = _pool[pk];
        if (s.queued > 0) { anyQueue = true; ph += '<div class="stat"><span class="stat-label">' + esc(pk) + '</span><span class="stat-value">' + t('poolActive') + ' ' + s.active + ', ' + t('poolWait') + ' ' + s.queued + '</span></div>'; }
      }
      document.getElementById('pool').innerHTML = anyQueue ? ph : '<div class="stat"><span class="stat-label">' + t('tabProviders') + '</span><span class="stat-value">' + t('poolAll') + '</span></div>';

      // Карточка экономии: сколько стоил бы этот трафик у платных API.
      var sv = document.getElementById('savings');
      if (sv) {
        if (_savings && _savings.totalTokens > 0) {
          var td = _statsData && _statsData.today;
          var todayHtml = td ? '<div class="stat"><span class="stat-label">' + t('kpiToday') + '</span><span class="stat-value">' + td.successRate + '% (' + td.requests + ')</span></div>' : '';
          sv.innerHTML =
            '<div class="stat savings"><span class="stat-label">' + t('savings') + '</span><span class="stat-value savings-usd">$' + _savings.savedUsd.toFixed(2) + '</span></div>' +
            todayHtml +
            '<div class="stat"><span class="stat-label">' + t('tokens') + '</span><span class="stat-value">' + fmtTokens(_savings.totalTokens) + '</span></div>' +
            '<div class="stat"><span class="stat-label">in / out</span><span class="stat-value" style="font-size:11px">' + fmtTokens(_savings.promptTokens) + ' / ' + fmtTokens(_savings.completionTokens) + '</span></div>' +
            '<div style="margin-top:6px;font-size:10px;color:#888;">' + t('savingsBasis') + '</div>';
        } else {
          sv.innerHTML = '<div class="stat"><span class="stat-label">' + t('savings') + '</span><span class="stat-value">$0.00</span></div>';
        }
      }
    }

    // ── RPM-график с сеткой ──
    function renderRpm(rpmData) {
      var canvas = document.getElementById('rpmChart');
      var ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      var w = canvas.width, h = canvas.height, padL = 34, padB = 16, padT = 8;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#8b949e';
      var max = 1;
      for (var i = 0; i < rpmData.length; i++) if (rpmData[i].count > max) max = rpmData[i].count;
      // сетка: 4 линии
      for (var g = 0; g <= 4; g++) {
        var gy = padT + (h - padT - padB) * (1 - g / 4);
        ctx.strokeStyle = 'rgba(139,148,158,.15)';
        ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - 4, gy); ctx.stroke();
        ctx.fillText(String(Math.round(max * g / 4)), 4, gy + 3);
      }
      if (!rpmData || rpmData.length === 0) { ctx.fillText('нет данных', padL + 10, h / 2); return; }
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      var step = (w - padL - 4) / Math.max(rpmData.length - 1, 1);
      rpmData.forEach(function (r, i) {
        var x = padL + i * step;
        var y = padT + (h - padT - padB) * (1 - r.count / max);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillText('-60м', padL, h - 3);
      ctx.fillText('сейчас', w - 44, h - 3);
    }

    // ── недавние запросы ──
    function renderRecent(recent) {
      var table = document.getElementById('recentTable');
      var html = '<tr><th>' + t('thRecentTime') + '</th><th>' + t('thRecentModel') + '</th><th>' + t('thRecentProvider') + '</th><th>' + t('thRecentStatus') + '</th><th>' + t('thRecentLatency') + '</th></tr>';
      recent.forEach(function (r) {
        var sc = r.status === 200 ? 'var(--ok)' : 'var(--err)';
        html += '<tr><td>' + new Date(r.timestamp).toLocaleTimeString() + '</td><td>' + esc(r.model || '-') + '</td><td>' + esc(r.provider || '-') + '</td><td style="color:' + sc + '">' + (r.status || '-') + '</td><td>' + (r.latency || 0) + 'ms</td></tr>';
      });
      table.innerHTML = html;
    }

    // ── ПРОВАЙДЕРЫ: фильтры/сортировка/таблица ──
    function setProviderFilter(f, el) {
      _providerFilter = f;
      document.querySelectorAll('#providerChips .chip').forEach(function (c) { c.classList.remove('active'); });
      el.classList.add('active');
      renderProvidersTable();
    }
    function sortProvidersBy(key) {
      if (_provSort.key === key) _provSort.dir *= -1; else { _provSort.key = key; _provSort.dir = 1; }
      renderProvidersTable();
    }
    function limitOf(key) { return (_limits[key] && _limits[key].percent) || 0; }
    function renderProvidersTable() {
      _providerQuery = (document.getElementById('providerSearch').value || '').toLowerCase();
      var rows = [];
      for (var k in _health) {
        var h = _health[k];
        var st = h.status || 'unknown';
        if (_providerFilter !== 'all' && st !== _providerFilter) continue;
        if (_providerQuery && k.toLowerCase().indexOf(_providerQuery) < 0) continue;
        rows.push({ key: k, h: h, st: st, limit: limitOf(k) });
      }
      if (_provSort.key) {
        var dir = _provSort.dir;
        rows.sort(function (a, b) {
          var av, bv;
          if (_provSort.key === 'limit') { av = a.limit; bv = b.limit; }
          else if (_provSort.key === 'name') { av = a.key; bv = b.key; return av < bv ? -dir : av > bv ? dir : 0; }
          else { av = a.h[_provSort.key] || 0; bv = b.h[_provSort.key] || 0; }
          return (av - bv) * dir;
        });
      }
      var arr = function (col) { return _provSort.key === col ? '<span class="arr">' + (_provSort.dir > 0 ? '▲' : '▼') + '</span>' : ''; };
      var html = '<tr><th>' + t('thStatus') + '</th><th onclick="sortProvidersBy(\\'name\\')">' + t('thProvider') + arr('name') + '</th>' +
        '<th onclick="sortProvidersBy(\\'latency_ms\\')">' + t('thLatency') + arr('latency_ms') + '</th>' +
        '<th onclick="sortProvidersBy(\\'reliability\\')">' + t('thReliability') + arr('reliability') + '</th>' +
        '<th onclick="sortProvidersBy(\\'limit\\')">' + t('thLimit') + arr('limit') + '</th><th>' + t('thReason') + '</th></tr>';
      rows.forEach(function (r) {
        var rel = (r.h.reliability !== null && r.h.reliability !== undefined) ? r.h.reliability + '%' : '—';
        html += '<tr>' +
          '<td><span class="badge ' + esc(r.st) + '">' + esc(r.st) + '</span></td>' +
          '<td>' + esc(r.key) + '</td>' +
          '<td>' + (r.h.latency_ms || 0) + 'ms</td>' +
          '<td>' + rel + '</td>' +
          '<td><span class="limit-bar"><span class="limit-fill" style="width:' + Math.min(r.limit, 100) + '%;background:' + limitColor(r.limit) + '"></span></span>' + r.limit + '%</td>' +
          '<td class="mono">' + esc(r.h.reason || '—') + '</td></tr>';
      });
      document.getElementById('providerTable').innerHTML = html;
      document.getElementById('providerCount').textContent = rows.length + ' из ' + Object.keys(_health).length;
    }

    // ── МОДЕЛИ ──
    function fetchModels() {
      var age = Date.now() - _modelsFetchedAt;
      if (_models.length > 0 && age < 30000) return;
      fetch(_api('/v1/models-db')).then(function (r) { return r.json(); }).then(function (d) {
        _models = d.models || [];
        _modelStats = d.stats || null;
        _modelManager = d.manager || null;
        _modelsFetchedAt = Date.now();
        fillModelFilters();
        renderModelsTable();
        renderModelRecommend();
        renderKpi();
      }).catch(function (e) { console.error('models-db:', e); });
    }
    function fillModelFilters() {
      if (!_modelStats) return;
      fillSelect('modelCategoryFilter', _modelStats.byCategory);
      fillSelect('modelStatusFilter', _modelStats.byStatus);
      fillSelect('modelSourceFilter', _modelStats.bySource);
    }
    function fillSelect(id, counts) {
      var sel = document.getElementById(id);
      var cur = sel.value;
      var firstLabel = t(sel.getAttribute('data-i18n')) || sel.options[0].text;
      var opts = '<option value="all">' + firstLabel + '</option>';
      for (var k in counts) opts += '<option value="' + esc(k) + '">' + esc(k) + ' (' + counts[k] + ')</option>';
      sel.innerHTML = opts;
      sel.value = cur && (cur === 'all' || counts[cur]) ? cur : 'all';
    }
    function sortModelsBy(key) {
      if (_modelSort.key === key) _modelSort.dir *= -1; else { _modelSort.key = key; _modelSort.dir = key === 'score' ? -1 : 1; }
      renderModelsTable();
    }
    function renderModelsTable() {
      if (_models.length === 0) { document.getElementById('modelTable').innerHTML = '<tr><td>' + t('noModels') + '</td></tr>'; return; }
      var q = (document.getElementById('modelSearch').value || '').toLowerCase();
      var cat = document.getElementById('modelCategoryFilter').value;
      var st = document.getElementById('modelStatusFilter').value;
      var src = document.getElementById('modelSourceFilter').value;
      var rows = _models.filter(function (m) {
        if (cat !== 'all' && m.category !== cat) return false;
        if (st !== 'all' && m.status !== st) return false;
        if (src !== 'all' && m.source !== src) return false;
        if (q && (m.key + ' ' + m.model).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      if (_modelSort.key) {
        var dir = _modelSort.dir, sk = _modelSort.key;
        rows.sort(function (a, b) {
          if (sk === 'key' || sk === 'model') { var av = a[sk], bv = b[sk]; return av < bv ? -dir : av > bv ? dir : 0; }
          return ((a[sk] || 0) - (b[sk] || 0)) * dir;
        });
      }
      var arr = function (col) { return _modelSort.key === col ? '<span class="arr">' + (_modelSort.dir > 0 ? '▲' : '▼') + '</span>' : ''; };
      var html = '<tr>' +
        '<th onclick="sortModelsBy(\\'score\\')">' + t('thScore') + arr('score') + '</th>' +
        '<th onclick="sortModelsBy(\\'key\\')">' + t('thKey') + arr('key') + '</th>' +
        '<th onclick="sortModelsBy(\\'model\\')">' + t('thModel') + arr('model') + '</th>' +
        '<th>' + t('thSource') + '</th><th>' + t('thCategory') + '</th>' +
        '<th onclick="sortModelsBy(\\'contextWindow\\')">' + t('thWindow') + arr('contextWindow') + '</th>' +
        '<th>' + t('thDayLimit') + '</th><th>' + t('thStatus2') + '</th>' +
        '<th>' + t('thChecked') + '</th><th>' + t('thAction') + '</th></tr>';
      rows.forEach(function (m) {
        var on = m.status !== 'user-disabled';
        html += '<tr>' +
          '<td class="score">' + (m.score || 0) + '</td>' +
          '<td class="mono">' + esc(m.key) + '</td>' +
          '<td class="mono">' + esc(m.model) + '</td>' +
          '<td>' + esc(m.source) + '</td>' +
          '<td>' + esc(m.category) + '</td>' +
          '<td>' + (m.contextWindow ? Math.round(m.contextWindow / 1000) + 'K' : '—') + '</td>' +
          '<td>' + (m.dailyLimit || '—') + '</td>' +
          '<td><span class="badge ' + esc(m.status) + '">' + esc(m.status) + '</span></td>' +
          '<td>' + fmtDate(m.lastCheckedAt) + '</td>' +
          '<td class="model-actions">' +
            '<button class="mini-btn ' + (on ? '' : 'off') + '" onclick="toggleModel(\\'' + esc(m.key) + '\\')">' + (on ? '✓' : '✗') + '</button>' +
            '<button class="mini-btn" onclick="testModelLive(\\'' + esc(m.key) + '\\')" title="' + t('testNow') + '">' + t('testNow') + '</button>' +
          '</td></tr>';
      });
      document.getElementById('modelTable').innerHTML = html;
      document.getElementById('modelCount').textContent = rows.length + ' / ' + _models.length;
      if (_modelManager) {
        document.getElementById('modelManagerInfo').textContent = t('modelManagerInfo') + ': ' +
          (_modelManager.enabled ? t('every') + ' ' + _modelManager.intervalHours + 'h' : t('off')) +
          (_modelManager.running ? ' · ' + t('cycleRunning') : '');
      }
    }

    // ── МОДЕЛИ: тумблер вкл/выкл + живой тест + рекомендации ──
    function toggleModel(key) {
      fetch(_api('/v1/models/' + encodeURIComponent(key) + '/toggle'), { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) { fetchModels(); renderKpi(); })
        .catch(function (e) { alert(e.message); });
    }
    function testModelLive(key) {
      fetch(_api('/v1/models/' + encodeURIComponent(key) + '/test'), { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          alert((d.ok ? 'OK' : 'FAIL (' + d.status + ')') + ' · ' + d.latencyMs + 'ms' + (d.error ? ' · ' + d.error : ''));
          fetchModels();
        })
        .catch(function (e) { alert(e.message); });
    }
    function renderModelRecommend() {
      var el = document.getElementById('modelRecommend');
      if (!el) return;
      var actFree = [], paid = [], local = [], other = [];
      for (var i = 0; i < _models.length; i++) {
        var m = _models[i];
        if (m.status !== 'user-disabled') continue;
        if (m.source === 'local' || m.source === 'ollama' || m.source === 'lmstudio') { local.push(m.key); continue; }
        if (/deepseek|glm-5|nemotron-550b|nemotron-120b|ox-alpha|minimax-m2/.test(m.model)) { paid.push(m.key); continue; }
        actFree.push(m.key);
      }
      var html = '';
      if (actFree.length) {
        html += '<div class="rec"><span class="rec-badge ok">' + t('recActiveFree') + ':</span> <span class="mono">' + esc(actFree.join(', ')) + '</span></div>';
      }
      if (paid.length) html += '<div class="rec"><span class="rec-badge warn">' + t('recPaid') + ':</span> <span class="mono">' + esc(paid.join(', ')) + '</span></div>';
      if (local.length) html += '<div class="rec"><span class="rec-badge">' + t('recLocal') + ':</span> <span class="mono">' + esc(local.join(', ')) + '</span></div>';
      if (!html) html = '<div class="rec"><span class="rec-badge ok">' + t('overviewLineOk') + '</span></div>';
      el.innerHTML = html;
    }

    // ── КОНТЕКСТ ──
    function renderContext(sum) {
      if (!sum || typeof sum !== 'object') { document.getElementById('ctxBlock').innerHTML = t('noData'); document.getElementById('taskBars').innerHTML = t('noData'); return; }
      var fmt3 = function (v) { return (typeof v === 'number' && v > 0) ? v.toFixed(3) : '—'; };
      var html = '<div class="stat"><span class="stat-label">' + t('ctxStatus') + '</span><span class="stat-value">' + (sum.status || 'OK') + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxReq') + '</span><span class="stat-value">' + (sum.totalRequests || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxRate') + '</span><span class="stat-value">' + (sum.ratePerHour || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxAvgRatio') + '</span><span class="stat-value">' + fmt3(sum.avgRatio) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxMaxRatio') + '</span><span class="stat-value">' + fmt3(sum.ratioMax) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxNear') + '</span><span class="stat-value">' + (sum.nearWindow || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxOver') + '</span><span class="stat-value">' + (sum.overWindow || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxCompact') + '</span><span class="stat-value">' + (sum.compactCount || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxUpgrade') + '</span><span class="stat-value">' + (sum.upgradedCount || 0) + '</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxCacheRate') + '</span><span class="stat-value">' + (typeof sum.cacheHitRate === 'number' ? sum.cacheHitRate : 0) + '%</span></div>';
      html += '<div class="stat"><span class="stat-label">' + t('ctxSys') + '</span><span class="stat-value">' + (sum.avgSysShare ? (sum.avgSysShare * 100).toFixed(0) + '%' : '—') + '</span></div>';
      if (sum.narrowProviders && sum.narrowProviders.length > 0) {
        html += '<div class="stat"><span class="stat-label">' + t('ctxNarrow') + '</span><span class="stat-value">' + esc(sum.narrowProviders.join(', ')) + '</span></div>';
      }
      document.getElementById('ctxBlock').innerHTML = html + '<div style="margin-top:8px;font-size:11px;color:#888;">' + t('ctxRecap') + '</div>';

      // категории задач — прогресс-бары
      var bars = '';
      if (sum.tasks && sum.taskTotal > 0) {
        var colors = { coding: '#00d4ff', reasoning: '#b388ff', search: '#00ff88', chat: '#ffaa00' };
        for (var tk in sum.tasks) {
          var n = sum.tasks[tk];
          if (n <= 0) continue;
          var pct = Math.round((n / sum.taskTotal) * 100);
          bars += '<div class="task-bar"><span class="name">' + tk + '</span>' +
            '<span class="bar"><span class="fill" style="width:' + pct + '%;background:' + (colors[tk] || 'var(--accent)') + '"></span></span>' +
            '<span class="num">' + n + ' (' + pct + '%)</span></div>';
        }
      }
      document.getElementById('taskBars').innerHTML = bars || '<div class="stat"><span class="stat-label">' + t('ctxNoTask') + '</span><span class="stat-value">—</span></div>';
    }

    // ── Setup (API keys) ──
    var _setupData = null;
    async function loadSetup() {
      try {
        var res = await fetch(_api('/v1/setup/keys'));
        _setupData = await res.json();
        renderSetup(_setupData);
      } catch (e) { console.error('Setup load error:', e); }
    }
    function renderSetup(data) {
      var grid = document.getElementById('setup-grid');
      var html = '';
      for (var envVar in data.groups) {
        var info = data.groups[envVar];
        var isEn = _lang === 'en';
        var name = (isEn && info.name_en) || info.name;
        var desc = (isEn && info.description_en) || info.description;
        var steps = (isEn && info.steps_en) || info.steps;
        var maskedVal = (data.masked && data.masked[envVar]) || '';
        var stepsHtml = (steps || []).map(function (s) { return '<li>' + s + '</li>'; }).join('');
        html += '<div class="key-card" id="card-' + envVar + '">';
        html += '<h3>' + esc(name) + '</h3>';
        html += '<div class="desc">' + esc(desc) + '</div>';
        html += '<ol>' + stepsHtml + '</ol>';
        html += '<div class="key-input-row">';
        html += '<input class="key-input" id="input-' + envVar + '" type="password" placeholder="' + (maskedVal ? t('keySet') + ' (' + maskedVal + ')' : t('checkKey') + '...') + '" autocomplete="off">';
        html += '<button class="btn btn-validate" data-validate="' + envVar + '">' + t('checkKey') + '</button>';
        html += '</div>';
        html += '<div id="status-' + envVar + '" class="status-wait" style="margin-top: 6px;">' + (maskedVal ? t('keySet') + ' (' + maskedVal + ')' : t('keyMissing')) + '</div>';
        html += '<a href="' + info.url + '" target="_blank" style="font-size: 11px;">' + esc(info.url) + '</a>';
        html += '</div>';
      }
      grid.innerHTML = html;
    }
    document.addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.validate) validateKey(e.target.dataset.validate);
    });
    async function validateKey(envVar) {
      var input = document.getElementById('input-' + envVar);
      var status = document.getElementById('status-' + envVar);
      var key = input.value.trim();
      status.className = 'status-wait'; status.textContent = t('testing');
      try {
        var url = _api('/v1/setup/validate?envVar=' + encodeURIComponent(envVar)) + (key ? '&apiKey=' + encodeURIComponent(key) : '');
        var res = await fetch(url);
        var result = await res.json();
        if (result.valid) { status.className = 'status-ok'; status.textContent = t('valid'); }
        else { status.className = 'status-err'; status.textContent = result.error || t('invalid'); }
      } catch (e) { status.className = 'status-err'; status.textContent = e.message; }
    }
    async function validateAll() {
      for (var envVar in _setupData.groups) {
        var input = document.getElementById('input-' + envVar);
        if (input && input.value.trim()) await validateKey(envVar);
      }
    }
    async function saveAllKeys() {
      var status = document.getElementById('save-status');
      status.className = 'status-wait'; status.textContent = t('saving');
      var keys = {};
      for (var envVar in _setupData.groups) {
        var input = document.getElementById('input-' + envVar);
        if (input && input.value.trim()) keys[envVar] = input.value.trim();
      }
      try {
        var res = await fetch(_api('/v1/setup/keys'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(keys)
        });
        var result = await res.json();
        if (result.ok) { status.className = 'status-ok'; status.textContent = t('savedMsg'); }
        else { status.className = 'status-err'; status.textContent = result.error || t('saveErr'); }
      } catch (e) { status.className = 'status-err'; status.textContent = e.message; }
    }

    applyLang();
    refresh();
    setInterval(refresh, 5000);
    setInterval(function () { _modelsFetchedAt = 0; fetchModels(); }, 30000);
    // Открыть запрошенную вкладку из хэша (#models, #providers, ...)
    var initial = (location.hash || '').replace('#', '');
    if (initial && _tabByKey[initial]) showTab(initial);
    // модели: подгружаем рекомендации один раз после первой загрузки
    var _isEn = _lang === 'en';
  </script>
</body>
</html>`;

function handleDashboard(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

module.exports = { handleDashboard };
