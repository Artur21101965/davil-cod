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
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23e8b553'/%3E%3C/svg%3E">
  <title>Freegate — Панель управления</title>
    <style>
    /* ── Aesthetic: современный тёмный админ-дашборд (в стиле PolyCopy) ── */
    :root {
      --bg: #0d0d0f; --panel: #141416; --panel2: #1b1b1e; --border: #26262a;
      --accent: #7c5cff; --accent-dim: #9d8bff; --accent-ink: #c9beff;
      --ok: #4ade80; --warn: #fbbf24; --err: #f87171;
      --text: #ececef; --muted: #9a9aa2;
      --radius: 12px; --radius-sm: 8px;
      /* тоновые полупрозрачные акценты (для мульти-тем) */
      --t-log: rgba(124,92,255,.18); --t-glow: rgba(124,92,255,.2);
      --t-row: rgba(124,92,255,.03); --t-chip: rgba(124,92,255,.16);
      --t-bg-ok: rgba(74,222,128,.12); --t-bd-ok: rgba(74,222,128,.35); --t-dot-ok: rgba(74,222,128,.18);
      --t-bg-warn: rgba(251,191,36,.12); --t-bd-warn: rgba(251,191,36,.4);
      --t-bg-err: rgba(248,113,113,.12); --t-bd-err: rgba(248,113,113,.4);
      --t-bg-muted: rgba(154,154,162,.14); --t-bg-muted2: rgba(154,154,162,.1);
    }
    body[data-theme="warm"] {
      --bg: #131006; --panel: #1a1510; --panel2: #211c13; --border: #372e1c;
      --accent: #e8b553; --accent-dim: #c8983f; --accent-ink: #ffd58a;
      --ok: #8fbf6a; --warn: #e0a449; --err: #d97b6c;
      --text: #e8dcc0; --muted: #8a7d5f;
      --t-log: rgba(232,181,83,.18); --t-glow: rgba(232,181,83,.2);
      --t-row: rgba(232,181,83,.03); --t-chip: rgba(232,181,83,.16);
      --t-bg-ok: rgba(143,191,106,.12); --t-bd-ok: rgba(143,191,106,.35); --t-dot-ok: rgba(143,191,106,.18);
      --t-bg-warn: rgba(224,164,73,.12); --t-bd-warn: rgba(224,164,73,.4);
      --t-bg-err: rgba(217,123,108,.12); --t-bd-err: rgba(217,123,108,.4);
      --t-bg-muted: rgba(154,143,117,.14); --t-bg-muted2: rgba(154,143,117,.1);
    }
    body[data-theme="cosmic"] {
      --bg: #0a1018; --panel: #0f1720; --panel2: #141e29; --border: #1f2d3c;
      --accent: #6fb6e0; --accent-dim: #4f8fb5; --accent-ink: #a9d8f5;
      --ok: #6fbfa0; --warn: #d9b06a; --err: #d97b7b;
      --text: #d7e2e8; --muted: #5d6d7d;
      --t-log: rgba(111,182,224,.18); --t-glow: rgba(111,182,224,.2);
      --t-row: rgba(111,182,224,.03); --t-chip: rgba(111,182,224,.16);
      --t-bg-ok: rgba(111,191,160,.12); --t-bd-ok: rgba(111,191,160,.35); --t-dot-ok: rgba(111,191,160,.18);
      --t-bg-warn: rgba(217,176,106,.12); --t-bd-warn: rgba(217,176,106,.4);
      --t-bg-err: rgba(217,123,123,.12); --t-bd-err: rgba(217,123,123,.4);
      --t-bg-muted: rgba(122,134,147,.14); --t-bg-muted2: rgba(122,134,147,.1);
    }
    body[data-theme="paper"] {
      --bg: #f4f5f7; --panel: #ffffff; --panel2: #eef1f5; --border: #d7dce3;
      --accent: #1f3a5f; --accent-dim: #2c5282; --accent-ink: #1f3a5f;
      --ok: #2e7d52; --warn: #b26a00; --err: #c0392b;
      --text: #1c2733; --muted: #6b7683;
      --t-log: rgba(31,58,95,.18); --t-glow: rgba(31,58,95,.2);
      --t-row: rgba(31,58,95,.03); --t-chip: rgba(31,58,95,.12);
      --t-bg-ok: rgba(46,125,82,.1); --t-bd-ok: rgba(46,125,82,.35); --t-dot-ok: rgba(46,125,82,.18);
      --t-bg-warn: rgba(178,106,0,.1); --t-bd-warn: rgba(178,106,0,.4);
      --t-bg-err: rgba(192,57,43,.1); --t-bd-err: rgba(192,57,43,.4);
      --t-bg-muted: rgba(107,118,131,.14); --t-bg-muted2: rgba(107,118,131,.1);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg); color: var(--text); padding-bottom: 40px;
      -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }

    /* ── Раскладка: сайдбар + контент ── */
    .layout { display: flex; min-height: 100vh; }
    #sidebar { width: 240px; flex-shrink: 0; background: var(--panel); border-right: 1px solid var(--border);
      position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 20px 14px; }
    .side-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; padding: 0 6px; }
    .side-logo { width: 26px; height: 26px; border-radius: 7px; background: var(--accent); display: grid; place-items: center;
      color: #fff; font-weight: 800; font-size: 14px; box-shadow: 0 0 0 3px var(--t-log); }
    .side-brand .name { font-weight: 700; font-size: 16px; letter-spacing: .2px; }
    .side-brand .name span { color: var(--muted); font-weight: 600; }

    /* Сайдбар-навигация */
    #tabs { display: flex; flex-direction: column; gap: 3px; }
    .tab { padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer; color: var(--muted);
      font-size: 13.5px; font-weight: 500; user-select: none; transition: all .15s ease; display: flex; align-items: center; gap: 10px;
      border: none; background: none; text-align: left; position: relative; }
    .tab::before { content: ''; width: 7px; height: 7px; border-radius: 2px; background: currentColor; opacity: .6; flex-shrink: 0; }
    .tab:hover { color: var(--text); background: var(--panel2); }
    .tab.active { color: var(--accent-ink); background: var(--panel2); }
    .tab.active::before { background: var(--accent); opacity: 1; box-shadow: 0 0 0 3px var(--t-glow); }

    .side-foot { margin-top: auto; padding: 12px 6px 2px; border-top: 1px solid var(--border); }
    .side-user { display: flex; align-items: center; gap: 10px; padding: 8px 6px; }
    .side-avatar { width: 30px; height: 30px; border-radius: 8px; background: var(--panel2); display: grid; place-items: center;
      color: var(--accent-dim); font-weight: 700; font-size: 13px; border: 1px solid var(--border); }
    .side-user .info .role { font-size: 11px; color: var(--muted); }
    .side-user .info .email { font-size: 12.5px; font-weight: 600; }

    /* ── Контент ── */
    #main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    #topbar { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border); padding: 14px 28px; display: flex; align-items: center; gap: 14px; }
    .brand { font-size: 15px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 9px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--muted); }
    .dot.ok { background: var(--ok); box-shadow: 0 0 0 3px var(--t-dot-ok); }
    .dot.bad { background: var(--err); box-shadow: 0 0 0 3px var(--t-bd-err); }

    .lang-switch { margin-left: auto; display: flex; gap: 4px; background: var(--panel); border: 1px solid var(--border);
      border-radius: 999px; padding: 3px; }
    .lang-btn { padding: 5px 14px; border-radius: 999px; background: transparent; border: none;
      color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s ease; }
    .lang-btn.active { color: #fff; background: var(--accent); }
    .lang-btn:hover:not(.active) { color: var(--text); }

    /* ── Переключатель темы ── */
    .theme-switch { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border: 1px solid var(--border);
      background: var(--panel); border-radius: 999px; }
    .theme-swatch { width: 14px; height: 14px; border-radius: 4px; }
    .theme-btn { padding: 4px 14px; border-radius: 999px; background: transparent; border: none;
      color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s ease; }
    .theme-btn:hover { color: var(--text); }

    /* ── Главный заголовок ── */
    #page-head { padding: 26px 28px 0; }
    #page-head .crumb { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
    #page-head h1 { font-size: 20px; font-weight: 700; }
    #page-head .sub { color: var(--muted); font-size: 13px; margin-top: 3px; }

    /* ── KPI-карточки (крупные метрики) ── */
    #kpiBar { padding: 20px 28px 4px; display: grid !important; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }
    .kpi-chip { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 16px 13px; }
    .kpi-label { display: block; color: var(--muted); font-size: 12px; font-weight: 500; }
    .kpi-chip b { display: block; color: var(--text); font-size: 24px; font-weight: 700; margin-top: 8px; letter-spacing: -.5px; }
    .kpi-chip.warn b { color: var(--warn); } .kpi-chip.err b { color: var(--err); }
    .kpi-chip.warn, .kpi-chip.err { border-color: var(--t-bd-warn); }
    .kpi-chip.err { border-color: var(--t-bd-err); }

    /* ── Панели: общий перенос заголовка KPI полоски стал частью content ── */
    main { padding: 0 28px; }
    .panel { display: none; padding-top: 16px; }
    .panel.active { display: block; }

    /* ── Карточки/сетки ── */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
    .card { background: var(--panel); border-radius: var(--radius); padding: 18px 20px; border: 1px solid var(--border); }
    .card h2 { color: var(--muted); font-size: 11px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: .8px;
      display: flex; align-items: center; gap: 8px; font-weight: 600; }
    .card h2::before { content: ''; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); }
    .stat { display: flex; justify-content: space-between; margin-bottom: 8px; gap: 10px; }
    .stat-label { color: var(--muted); font-size: 13px; }
    .stat-value { color: var(--text); font-weight: 600; text-align: right; font-size: 13px; }

    /* ── Алерты ── */
    #alerts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .alert { padding: 11px 16px; border-radius: var(--radius-sm); font-size: 13px; border: 1px solid; background: var(--panel); }
    .alert.err { border-color: var(--t-bd-err); color: #fbc4c4; }
    .alert.warn { border-color: var(--t-bd-warn); color: #fde9b8; }
    .alert.ok { border-color: var(--t-bd-ok); color: #b7efcd; }

    /* ── Тулбар: поиск + фильтры ── */
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
    .search { flex: 1; min-width: 180px; max-width: 320px; padding: 10px 14px; border-radius: var(--radius-sm);
      border: 1px solid var(--border); background: var(--panel); color: var(--text); font-size: 13px; outline: none;
      transition: border-color .15s ease; }
    .search:focus { border-color: var(--accent); }
    select.filter { padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--panel); color: var(--text); font-size: 13px; outline: none; cursor: pointer; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { padding: 8px 14px; border-radius: 999px; background: var(--panel); border: 1px solid var(--border);
      color: var(--muted); font-size: 12.5px; cursor: pointer; user-select: none; transition: all .15s ease; }
    .chip.active { color: #fff; border-color: var(--accent); background: var(--t-chip); }
    .chip:hover { color: var(--text); }
    .count-hint { color: var(--muted); font-size: 12px; margin-left: auto; }

    /* ── Таблицы ── */
    .table-wrap { overflow-x: auto; background: var(--panel); border-radius: var(--radius); border: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 13px; white-space: nowrap; }
    th { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .6px; cursor: pointer; user-select: none; font-weight: 600; }
    th:hover { color: var(--text); }
    th .arr { font-size: 9px; margin-left: 4px; }
    td { color: var(--text); }
    tbody tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--t-row); }
    .badge { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; display: inline-block; }
    .badge.up, .badge.active { background: var(--t-bg-ok); color: var(--ok); }
    .badge.ratelimited { background: var(--t-bg-warn); color: var(--warn); }
    .badge.error, .badge.dead { background: var(--t-bg-err); color: var(--err); }
    .badge.unknown, .badge.untested { background: var(--t-bg-muted); color: var(--muted); }
    .badge.disabled, .badge.user-disabled { background: var(--t-bg-muted2); color: var(--muted); }
    .limit-bar { width: 110px; height: 6px; background: var(--panel2); border-radius: 4px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 8px; }
    .limit-fill { height: 100%; border-radius: 4px; }
    .score { font-weight: 700; color: var(--text); }
    .mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; }

    /* ── Действия над моделями ── */
    .model-actions { display: flex; gap: 6px; align-items: center; white-space: nowrap; }
    .mini-btn { padding: 6px 11px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--panel2);
      color: var(--text); font-size: 12px; cursor: pointer; transition: all .15s ease; font-weight: 500; }
    .mini-btn:hover { border-color: var(--accent); color: var(--accent-ink); }
    .mini-btn.off { color: var(--warn); }

    /* ── Рекомендации ── */
    .rec { font-size: 12.5px; margin-bottom: 7px; line-height: 1.6; }
    .rec-badge { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; margin-right: 6px; }
    .rec-badge.ok { background: var(--t-bg-ok); color: var(--ok); }
    .rec-badge.warn { background: var(--t-bg-warn); color: var(--warn); }
    .rec-badge { background: var(--t-bg-muted); color: var(--muted); }

    /* ── Экономия ── */
    .savings .savings-usd { color: var(--ok); font-size: 28px; font-weight: 700; letter-spacing: -.5px; }

    canvas { width: 100%; height: 180px; background: var(--panel); border-radius: var(--radius); border: 1px solid var(--border); }
    .refresh { color: var(--muted); font-size: 12px; margin-top: 14px; }
    .task-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13px; }
    .task-bar .name { width: 90px; color: var(--muted); text-transform: capitalize; }
    .task-bar .bar { flex: 1; height: 8px; background: var(--panel2); border-radius: 5px; overflow: hidden; }
    .task-bar .fill { height: 100%; border-radius: 5px; }
    .task-bar .num { width: 84px; text-align: right; color: var(--muted); }

    /* ── Setup ── */
    .setup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
    .key-card { background: var(--panel); border-radius: var(--radius); padding: 18px 20px; border: 1px solid var(--border); }
    .key-card h3 { color: var(--text); font-size: 15px; margin-bottom: 6px; font-weight: 700; }
    .key-card .desc { color: var(--muted); font-size: 12.5px; margin-bottom: 10px; line-height: 1.5; }
    .key-card ol { color: var(--muted); font-size: 12px; padding-left: 18px; margin-bottom: 10px; }
    .key-card li { margin-bottom: 4px; }
    .key-card a { color: var(--accent-dim); }
    .key-input-row { display: flex; gap: 8px; align-items: center; }
    .key-input { flex: 1; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 13px; font-family: monospace; }
    .btn { padding: 10px 16px; border-radius: var(--radius-sm); border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: all .15s ease; }
    .btn-validate { background: var(--panel2); color: var(--text); border: 1px solid var(--border); }
    .btn-validate:hover { border-color: var(--accent); color: var(--accent-ink); }
    .btn-save { background: var(--accent); color: #fff; }
    .btn-save:hover { filter: brightness(1.08); }
    .btn-test-all { background: var(--panel2); color: var(--ok); border: 1px solid var(--border); }
    .status-ok { color: var(--ok); font-size: 12px; }
    .status-err { color: var(--err); font-size: 12px; }
    .status-wait { color: var(--muted); font-size: 12px; }
    .hidden { display: none; }

    /* ── Опции оптимизации ── */
    .opt-row { display: flex; align-items: center; gap: 12px; margin: 12px 0 2px; font-size: 13.5px; font-weight: 600; }
    .opt-switch { display: flex; align-items: center; gap: 10px; margin-left: auto; }
    .switch { position: relative; display: inline-block; width: 40px; height: 22px; }
    .switch input { display: none; }
    .slider { position: absolute; inset: 0; background: var(--panel2); border: 1px solid var(--border); border-radius: 999px; cursor: pointer; transition: all .15s ease; }
    .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; background: var(--muted); border-radius: 50%; transition: all .15s ease; }
    .switch input:checked + .slider { background: rgba(124,92,255,.35); border-color: var(--accent); }
    .switch input:checked + .slider::before { transform: translateX(18px); background: #fff; }
    .opt-hint { font-size: 12px; color: var(--accent-dim); font-weight: 500; }
    .opt-desc { font-size: 12px; color: var(--muted); line-height: 1.55; margin: 0 0 8px; }
    .opt-note { font-size: 12px; color: var(--ok); margin-top: 8px; }

    @media (max-width: 900px) {
      #sidebar { width: 64px; padding: 20px 8px; }
      .side-brand .name, .tab .label, .side-user .info { display: none; }
      .tab { justify-content: center; }
      .side-user { justify-content: center; }
    }
    @media (max-width: 640px) {
      #topbar, #page-head, main, #kpiBar { padding-left: 16px; padding-right: 16px; }
      .kpi-chip b { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside id="sidebar">
      <div class="side-brand">
        <div class="side-logo">F</div>
        <div class="name">free<strong>gate</strong></div>
      </div>

      <nav id="tabs">
        <div class="tab active" data-i18n="tabOverview" onclick="showTab('overview')"></div>
        <div class="tab" data-i18n="tabProviders" onclick="showTab('providers')"></div>
        <div class="tab" data-i18n="tabModels" onclick="showTab('models')"></div>
        <div class="tab" data-i18n="tabContext" onclick="showTab('context')"></div>
        <div class="tab" data-i18n="tabSetup" onclick="showTab('setup')"></div>
      </nav>

      <div class="side-foot">
        <div class="side-user">
          <div class="side-avatar">F</div>
          <div class="info">
            <div class="email">Freegate</div>
            <div class="role">Admin</div>
          </div>
        </div>
      </div>
    </aside>

    <div id="main">
      <header id="topbar">
        <div class="brand"><span id="statusDot" class="dot"></span><span data-i18n="topTitle"></span></div>
        <div class="theme-switch" title="">
          <button class="theme-btn" id="themeBtn" onclick="cycleTheme()"></button>
        </div>
        <div class="lang-switch">
          <button class="lang-btn" data-lang="ru" onclick="setLang('ru')">RU</button>
          <button class="lang-btn" data-lang="en" onclick="setLang('en')">EN</button>
        </div>
      </header>

      <div id="page-head">
        <div class="crumb" data-i18n="crumb"></div>
        <h1 data-i18n="pageTitle"></h1>
        <div class="sub" data-i18n="pageSub"></div>
      </div>

      <div class="kpi" id="kpiBar"></div>

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
      <div class="grid">
        <div class="card"><h2 data-i18n="cardRpm"></h2><canvas id="rpmChart"></canvas></div>
        <div class="card"><h2 data-i18n="cardSpark"></h2><canvas id="sparkline"></canvas></div>
      </div>
      <div class="card" style="margin-top:16px;">
        <h2 data-i18n="cardRecent"></h2>
        <div class="toolbar">
          <input id="recentSearch" class="search" type="text" placeholder="" data-i18n-ph="searchRecent" oninput="renderRecent(_recent)">
          <select id="recentStatusFilter" class="filter" onchange="renderRecent(_recent)">
            <option value="all" data-i18n="filterAll"></option>
            <option value="ok" data-i18n="recentOk"></option>
            <option value="err" data-i18n="recentErr"></option>
          </select>
          <span class="count-hint" id="recentCount"></span>
        </div>
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
      <div class="card" style="margin-bottom:14px;">
        <h2 data-i18n="optBlock"></h2>
        <div class="opt-row"><span data-i18n="optCompress"></span><div class="opt-switch"><label class="switch"><input type="checkbox" id="optCompress"><span class="slider"></span></label><span class="opt-hint" id="optCompressState"></span></div></div>
        <div class="opt-desc" data-i18n="optCompressDesc"></div>
        <div class="opt-row"><span data-i18n="optVetting"></span><div class="opt-switch"><label class="switch"><input type="checkbox" id="optVetting"><span class="slider"></span></label><span class="opt-hint" id="optVettingState"></span></div></div>
        <div class="opt-desc" data-i18n="optVettingDesc"></div>
        <div class="opt-row"><span data-i18n="optRouting"></span>
          <select id="optRouting" class="filter" onchange="saveOpts()">
            <option value="weighted" data-i18n="optWeighted"></option>
            <option value="weighted-roundrobin" data-i18n="optRoundrobin"></option>
            <option value="weighted-least" data-i18n="optLeast"></option>
          </select>
          <span class="opt-hint" id="optRoutingState"></span>
        </div>
        <div class="opt-desc" data-i18n="optRoutingDesc"></div>
        <div class="opt-note" id="optSaveNote"></div>
      </div>
      <div id="setup-grid" class="setup-grid" data-i18n="loading"></div>
    </section>
      </main>

      <div class="refresh" style="padding: 0 28px;" data-i18n="autoRefresh"></div>
    </div>
  </div>

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
        optBlock: 'Опции оптимизации', optCompress: 'Сжатие промптов', optVetting: 'Самопроверка', optRouting: 'Стратегия роутинга',
        optWeighted: 'weighted (умный)', optRoundrobin: 'weighted-roundrobin (по кругу)', optLeast: 'weighted-least (меньше нагруженные)',
        optCompressDesc: 'Убирает вежливость и «мусорные» слова («пожалуйста», «привет», «наверное») из последнего сообщения — меньше токенов, быстрее и дешевле. Не трогает код.',
        optVettingDesc: 'Сложные ответы (код/рассуждения) проверяет второй моделью и помечает ошибки. Тратит один лишний запрос на проверку.',
        optRoutingDesc: 'Как Freegate выбирает провайдера: умный взвешенный, по кругу (равномерно), или наименее нагруженные.', optSaved: 'Сохранено! Перезапусти Freegate для применения.',
        crumb: 'Админ', pageTitle: 'Панель управления', pageSub: 'Мониторинг и управление Freegate', topTitle: 'Панель управления',
        kpiProviders: 'Провайдеры', kpiRequests: 'Запросы', kpiRpm: 'RPM', kpiCache: 'Кэш',
        kpiToday: 'Успех сегодня', kpiLimit: 'Лимит', kpiModels: 'Модели', kpiUptime: 'Аптайм',
        cardSavings: 'Экономия (против платных API)', savings: 'Сэкономлено', tokens: 'токенов',
        savingsBasis: 'расчёт: input $3/M, output $15/M (репрезентативно)',
        cardCache: 'Кэш', cardTokens: 'Токены', cardPool: 'Очередь',
        cardRpm: 'Запросов в минуту', cardRecent: 'Недавние запросы', cardSpark: 'Успех сегодня (по часам)',
        cardCtx: 'Контекст (узкое место)', cardTasks: 'Категории задач (24ч)',
        loading: 'Загрузка...', noData: 'Нет данных',
        cacheHits: 'Хиты', cacheMisses: 'Промахи', cacheSize: 'Размер', cacheRate: 'Точность',
        poolAll: 'без очереди', poolActive: 'активных', poolWait: 'ждут',
        searchProvider: 'Поиск провайдера...', searchModel: 'Поиск модели...', searchRecent: 'Поиск по модели/провайдеру...',
        recentOk: 'OK', recentErr: 'Ошибки',
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
        optBlock: 'Optimization options', optCompress: 'Prompt compression', optVetting: 'Self-check', optRouting: 'Routing strategy',
        optWeighted: 'weighted (smart)', optRoundrobin: 'weighted-roundrobin (round-robin)', optLeast: 'weighted-least (least-used)',
        optCompressDesc: 'Strips politeness and filler words ("please", "hello", "probably") from the last message — fewer tokens, faster and cheaper. Never touches code.',
        optVettingDesc: 'Complex answers (code/reasoning) get vetted by a second model and flagged on error. Costs one extra request per check.',
        optRoutingDesc: 'How Freegate picks a provider: smart weighted, round-robin (even), or least-loaded.', optSaved: 'Saved! Restart Freegate to apply.',
        crumb: 'Admin', pageTitle: 'Control Panel', pageSub: 'Freegate monitoring & management', topTitle: 'Control Panel',
        kpiProviders: 'Providers', kpiRequests: 'Requests', kpiRpm: 'RPM', kpiCache: 'Cache',
        kpiToday: 'Success today', kpiLimit: 'Limit', kpiModels: 'Models', kpiUptime: 'Uptime',
        cardSavings: 'Savings (vs paid APIs)', savings: 'Saved', tokens: 'tokens',
        savingsBasis: 'estimate: input $3/M, output $15/M (representative)',
        cardCache: 'Cache', cardTokens: 'Tokens', cardPool: 'Queue',
        cardRpm: 'Requests per minute', cardRecent: 'Recent requests', cardSpark: 'Success today (hourly)',
        cardCtx: 'Context (bottleneck)', cardTasks: 'Task categories (24h)',
        loading: 'Loading...', noData: 'No data',
        cacheHits: 'Hits', cacheMisses: 'Misses', cacheSize: 'Size', cacheRate: 'Rate',
        poolAll: 'no queue', poolActive: 'active', poolWait: 'waiting',
        searchProvider: 'Search provider...', searchModel: 'Search model...', searchRecent: 'Search by model/provider...',
        recentOk: 'OK', recentErr: 'Errors',
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

    // ── темы: data-theme на body + переключатель ──
    var THEME_LABELS = { poly: 'PolyCopy', warm: 'Тёплый', cosmic: 'Космос', paper: 'Бумага' };
    var THEME_ORDER = ['poly', 'warm', 'cosmic', 'paper'];
    var _theme = 'poly';
    function applyTheme() {
      document.body.setAttribute('data-theme', _theme);
      var btn = document.getElementById('themeBtn');
      if (btn) btn.textContent = (_lang === 'en' ? 'Theme' : 'Тема') + ': ' + (THEME_LABELS[_theme] || _theme);
    }
    function cycleTheme() {
      var i = THEME_ORDER.indexOf(_theme);
      _theme = THEME_ORDER[(i + 1) % THEME_ORDER.length];
      localStorage.setItem('fg_theme', _theme);
      applyTheme();
    }
    function setTheme(name) {
      if (THEME_ORDER.indexOf(name) < 0) name = 'poly';
      _theme = name; localStorage.setItem('fg_theme', name); applyTheme();
    }
    _theme = (new URLSearchParams(location.search).get('theme')) || localStorage.getItem('fg_theme') || 'poly';
    if (THEME_ORDER.indexOf(_theme) < 0) _theme = 'poly';

    // ── состояние клиента ──
    var _health = {}, _limits = {}, _cache = null, _pool = {}, _statsData = null, _ctxSummary = null;
    var _rpmData = [], _recent = [], _hourly = [];
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
        _hourly = _statsData.hourly || [];
        renderKpi();
        renderAlerts();
        renderOverviewCards();
        renderRpm(_rpmData);
        renderSparkline(_hourly);
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
      html += '<div class="kpi-chip"><span class="kpi-label">' + t('kpiProviders') + '</span><b>' + up + '/' + total + '</b></div>';
      html += '<div class="kpi-chip"><span class="kpi-label">' + t('kpiRequests') + '</span><b>' + (_statsData ? _statsData.total_requests : 0) + '</b></div>';
      html += '<div class="kpi-chip"><span class="kpi-label">' + t('kpiRpm') + '</span><b>' + rpm + '</b></div>';
      html += '<div class="kpi-chip"><span class="kpi-label">' + t('kpiCache') + '</span><b>' + cacheRate + '%</b></div>';
      // Успех сегодня — главная метрика ценности. Зелёная при высоком, жёлтая/красная при деградации.
      if (_statsData && _statsData.today) {
        var td = _statsData.today;
        var tbCls = td.successRate >= 80 ? '' : td.successRate >= 50 ? ' warn' : ' err';
        html += '<div class="kpi-chip' + tbCls + '"><span class="kpi-label">' + t('kpiToday') + '</span><b>' + td.successRate + '%</b></div>';
      }
      if (riskKey) {
        var cls = riskPct > 90 ? ' err' : riskPct > 60 ? ' warn' : '';
        html += '<div class="kpi-chip' + cls + '"><span class="kpi-label">' + t('kpiLimit') + ': ' + esc(riskKey) + '</span><b>' + riskPct + '%</b></div>';
      }
      if (_modelStats) html += '<div class="kpi-chip"><span class="kpi-label">' + t('kpiModels') + '</span><b>' + (_modelStats.byStatus.active || 0) + '/' + _modelStats.total + '</b></div>';
      html += '<div class="kpi-chip"><span class="kpi-label">' + t('kpiUptime') + '</span><b>' + fmtUptime(_statsData ? _statsData.uptime_seconds : 0) + '</b></div>';
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
      ctx.fillStyle = '#5d6d7d';
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
      ctx.strokeStyle = '#e8b553';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#e8b553'; ctx.shadowBlur = 4;
      ctx.beginPath();
      var step = (w - padL - 4) / Math.max(rpmData.length - 1, 1);
      rpmData.forEach(function (r, i) {
        var x = padL + i * step;
        var y = padT + (h - padT - padB) * (1 - r.count / max);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
      // неоновая заливка под линией
      ctx.lineTo(w - 4, h - padB);
      ctx.lineTo(padL, h - padB);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, 'rgba(232,181,83,.20)'); grad.addColorStop(1, 'rgba(232,181,83,0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.fillText('-60м', padL, h - 3);
      ctx.fillText('сейчас', w - 44, h - 3);
    }

    // ── Sparkline: успех/ошибки по часам (24ч) ──
    function renderSparkline(hourly) {
      var canvas = document.getElementById('sparkline');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      var w = canvas.width, h = canvas.height, padL = 8, padB = 18, padT = 8;
      ctx.clearRect(0, 0, w, h);
      if (!hourly || hourly.length === 0) {
        ctx.fillStyle = '#5d6d7d'; ctx.font = '11px sans-serif';
        ctx.fillText(t('noData'), padL + 4, h / 2);
        return;
      }
      var data = hourly;
      var maxVal = 1;
      for (var i = 0; i < data.length; i++) if ((data[i].total || 0) > maxVal) maxVal = data[i].total;
      var step = (w - padL - padB) / Math.max(data.length - 1, 1);
      var barW = Math.max(2, Math.min(12, step - 3));
      // колонки успеха (зелёные) + хвост ошибок (красный)
      for (var i = 0; i < data.length; i++) {
        var d = data[i];
        var total = d.total || 0;
        if (total === 0) continue;
        var ok = d.ok || 0;
        var fail = total - ok;
        var x = padL + i * step;
        var headH = (h - padT - padB);
        var okH = (ok / maxVal) * headH;
        var failH = (fail / maxVal) * headH;
        var baseY = h - padB;
        if (failH > 0) {
          ctx.fillStyle = '#f87171';
          ctx.fillRect(x, baseY - okH - failH, barW, failH);
        }
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(x, baseY - okH, barW, okH);
      }
      // подписи первого/последнего часа
      ctx.fillStyle = '#5d6d7d'; ctx.font = '10px monospace';
      ctx.fillText((data[0].hour || '').slice(8, 13), padL, h - 4);
      var lastLbl = (data[data.length - 1].hour || '').slice(8, 13);
      ctx.fillText(lastLbl, w - padB - 30, h - 4);
    }

    // ── недавние запросы ──
    function renderRecent(recent) {
      var table = document.getElementById('recentTable');
      var q = (document.getElementById('recentSearch') ? (document.getElementById('recentSearch').value || '') : '').toLowerCase();
      var stF = document.getElementById('recentStatusFilter') ? document.getElementById('recentStatusFilter').value : 'all';
      var rows = recent.filter(function (r) {
        if (stF === 'ok' && r.status !== 200) return false;
        if (stF === 'err' && (r.status === 200 || r.status === undefined)) return false;
        if (q && ((r.model || '') + ' ' + (r.provider || '')).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      var html = '<tr><th>' + t('thRecentTime') + '</th><th>' + t('thRecentModel') + '</th><th>' + t('thRecentProvider') + '</th><th>' + t('thRecentStatus') + '</th><th>' + t('thRecentLatency') + '</th></tr>';
      rows.forEach(function (r) {
        var sc = r.status === 200 ? '#4ade80' : '#f87171';
        html += '<tr><td>' + new Date(r.timestamp).toLocaleTimeString() + '</td><td>' + esc(r.model || '-') + '</td><td>' + esc(r.provider || '-') + '</td><td style="color:' + sc + '">' + (r.status || '-') + '</td><td>' + (r.latency || 0) + 'ms</td></tr>';
      });
      table.innerHTML = html;
      var cnt = document.getElementById('recentCount');
      if (cnt) cnt.textContent = rows.length + ' / ' + recent.length;
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
        var colors = { coding: '#e8b553', reasoning: '#c9a0f0', search: '#7cc4e8', chat: '#e0a449', design: '#ec8fae' };
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
      loadOpts();
    }

    // ── Опции оптимизации (compress/vetting/routing) ──
    async function loadOpts() {
      try {
        var res = await fetch(_api('/v1/config'));
        var c = await res.json();
        document.getElementById('optCompress').checked = !!c.compress.enabled;
        document.getElementById('optVetting').checked = !!c.vetting.enabled;
        document.getElementById('optRouting').value = c.routing.strategy || 'weighted';
        var note = document.getElementById('optSaveNote');
        if (note) note.textContent = '';
      } catch (e) { console.error('Config load error:', e); }
    }
    function saveOpts() {
      var body = {
        compress: { enabled: document.getElementById('optCompress').checked },
        vetting: { enabled: document.getElementById('optVetting').checked },
        routing: { strategy: document.getElementById('optRouting').value },
      };
      fetch(_api('/v1/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) { return r.json(); }).then(function (d) {
        var note = document.getElementById('optSaveNote');
        if (note) note.textContent = d.ok ? (t('optSaved')) : (d.error || t('saveErr'));
      }).catch(function (e) {
        var note = document.getElementById('optSaveNote');
        if (note) note.textContent = e.message;
      });
    }
    document.getElementById('optCompress').addEventListener('change', saveOpts);
    document.getElementById('optVetting').addEventListener('change', saveOpts);
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
    applyTheme();
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
