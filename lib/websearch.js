// lib/websearch.js — веб-поиск для search-задач (бесплатно, без ключа).
// Используется, чтобы Freegate находил факты вместо галлюцинаций («что такое
// минимакс дизайн» → реальные данные о MiniMax, а не «минимализм»).
// Источник: DuckDuckGo HTML (без API-ключа). Вся сеть через injectable fetchImpl.
// parseDdg() — парсер HTML; search() — обёртка с таймаутом и защитой от сбоев.

const DDG_URL = 'https://html.duckduckgo.com/html/';

const isObject = (v) => v && typeof v === 'object';

// Декодирует URL, обфусцированный DDG (//duckduckgo.com/l/?uddg=<enc>&rut=..).
function decodeUrl(raw) {
  if (!raw) return '';
  if (!raw.includes('uddg=')) return raw;
  try {
    const m = raw.match(/[?&]uddg=([^&]+)/);
    if (!m) return raw;
    return decodeURIComponent(m[1]);
  } catch {
    return raw;
  }
}

// Извлекает блоки результатов: title, url, snippet.
function parseDdg(html) {
  const out = [];
  if (!html || typeof html !== 'string') return out;
  // Каждый результат — блок с result__a (заголовок+ссылка) и опц. result__snippet.
  const blocks = html.split('class="result results_links').slice(1);
  for (const b of blocks) {
    const titleM = b.match(/class="result__a"[^>]*>([^<]+)</);
    const hrefM = b.match(/class="result__a"[^>]*href="([^"]+)"/);
    const snipM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleM) continue;
    const title = titleM[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const url = decodeUrl(hrefM ? hrefM[1] : '');
    const snippet = snipM
      ? snipM[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\.\.\./g, '').trim()
      : '';
    if (title && url) out.push({ title, url, snippet: snippet.slice(0, 300) });
  }
  return out;
}

// Поиск. Возвращает [{title,url,snippet}]; при любой ошибке — [] (не бросает).
async function search(query, { fetchImpl, limit = 5, timeout = 8000 } = {}) {
  if (!fetchImpl || !query) return [];
  // DDG предпочитает '+' для пробелов (encodeURIComponent даёт %20 → может вернуть
  // anti-bot 202 без результатов). Кодируем, затем пробелы → '+'.
  const p = encodeURIComponent(query).replace(/%20/g, '+');
  const url = DDG_URL + '?q=' + p;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
      signal: controller ? controller.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (!res || !res.ok) return [];
    const html = await res.text();
    return parseDdg(html).slice(0, limit);
  } catch {
    return [];
  }
}

// Собирает контекст для промпта: заголовки + ссылки + сниппеты.
function toContext(results, query) {
  if (!Array.isArray(results) || results.length === 0) return '';
  const lines = results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? ' | ' + r.snippet : ''}`);
  return 'Актуальные данные из веб-поиска («' + query + '»):\n' + lines.join('\n');
}

module.exports = { DDG_URL, decodeUrl, parseDdg, search, toContext, isObject };
