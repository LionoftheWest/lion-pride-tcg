// Lion Pride TCG - Admin view (Phase 1, read only). Plain JS, no framework, like the card studio.
// Every number comes from /api/admin/* (the admin_ SQL functions). Dates and times are Mountain Time (the game day).
import { lineChart, barChart, compact } from './charts.js';
import { editors } from './editors.js';

/* ---------- icons (Lucide shapes, ISC license) ---------- */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  swords: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  castle: '<path d="M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z"/><path d="M18 11V4H6v7"/><path d="M15 22v-4a3 3 0 0 0-6 0v4"/><path d="M22 11V9M2 11V9M6 4V2M18 4V2M10 4V2M14 4V2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  table: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  flask: '<path d="M10 2v7.31M14 9.3V2M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/>',
  scroll: '<path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  pass: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  fail: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  up: '<path d="M7 7h10v10M7 17 17 7"/>',
  down: '<path d="m7 7 10 10M17 7v10H7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  older: '<path d="m7 6 5 5 5-5M7 13l5 5 5-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6M2 9h20"/>',
  daily: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18m-12 6 2 2 4-4"/>',
  sparkles: '<path d="M9.94 14.06 4 20M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/>',
  swap: '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
  gavel: '<path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  star: '<path d="M11.52 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
  back: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
};
function icon(name, cls = 'ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

/* ---------- DOM: every text goes in as textContent (member names are data, never HTML) ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ---------- formats (Mountain Time) ---------- */
const TZ = 'America/Denver';
const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));
const N = (v, d = 2) => (isNum(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: d }) : '-');
const P = (v, d = 1) => (isNum(v) ? `${(Number(v) * 100).toFixed(d)}%` : '-');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { if (!iso) return '-'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d} ${MON[+m - 1]} ${y}`; };
const dayShort = (iso) => { if (!iso) return '-'; const [, m, d] = String(iso).slice(0, 10).split('-'); return `${d} ${MON[+m - 1]}`; };
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const mtParts = (ts) => Object.fromEntries(partsFmt.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
const when = (ts, year = false) => {
  if (!ts) return '-';
  const p = mtParts(ts);
  if (!p.day) return String(ts);
  return `${p.day} ${MON[+p.month - 1]}${year ? ` ${p.year}` : ''} ${p.hour}:${p.minute}`;
};
const mtDay = (ts = Date.now()) => { const p = mtParts(ts); return `${p.year}-${p.month}-${p.day}`; };
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const bytes = (b) => (!isNum(b) ? '-' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`);
const label = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const RARITY = { normal: 'Normal', illustrated_rare: 'Illustrated Rare', secret_rare: 'Secret Rare', full_art: 'Full Art', gold: 'Gold', event: 'Event', promo: 'Promo' };
const rarityDot = (r) => h('span', { class: 'dot', style: `background: var(--r-${r}, var(--muted))` });

/* ---------- API ---------- */
const lastRefresh = { el: null };
async function api(path) {
  const r = await fetch(`/api/admin${path}`, { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
  if (r.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
    throw new Error('Login required');
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(j?.error || `The server answered ${r.status}`);
  const now = Date.now();
  if (lastRefresh.el) lastRefresh.el.textContent = when(now, true);
  return j;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

/* ---------- loading and error states ---------- */
const loadingState = () => h('div', { class: 'state', role: 'status' }, h('span', { class: 'spin' }), 'Loading');
const errorState = (e, retry) => h('div', { class: 'state error', role: 'alert' }, icon('fail'), h('span', { text: e.message || String(e) }),
  retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, 'Retry') : null);
async function fill(box, fn) {
  box.replaceChildren(loadingState());
  try {
    const out = await fn();
    box.replaceChildren(...[out].flat(Infinity).filter(Boolean));
  } catch (e) {
    box.replaceChildren(errorState(e, () => fill(box, fn)));
  }
}
function panel(title, { sub, right, cls = '' } = {}) {
  const body = h('div', { class: 'pbody' });
  const el = h('section', { class: `panel ${cls}` },
    title ? h('div', { class: 'phead' }, h('div', { class: 'ptitles' }, h('h2', { text: title }), sub ? h('p', { class: 'subtitle', text: sub }) : null), right || null) : null,
    body);
  return { el, body, setSub(t) { const s = el.querySelector('.ptitles .subtitle') || el.querySelector('.ptitles').appendChild(h('p', { class: 'subtitle' })); s.textContent = t; } };
}

/* ---------- generic table: a table on the desktop, record cards on the phone ---------- */
function cell(v) {
  if (v == null) return h('span', { style: 'color: var(--muted)' }, '-');
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    if (s.length <= 160) return h('span', { class: 'json-text' }, s);
    const span = h('span', { class: 'json-text' }, `${s.slice(0, 160)} ...`);
    const btn = h('button', { class: 'more-btn', type: 'button', onclick: () => { span.textContent = s; btn.remove(); } }, 'Show all');
    return h('span', null, span, ' ', btn);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return when(v, true);
  if (typeof v === 'number') return N(v, 4);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}
function table({ cols, rows, onRow, title, phone = 'recs', rowClass }) {
  const body = rows.map((row) => {
    const tr = h('tr', { class: [onRow ? 'link' : '', rowClass ? rowClass(row) : ''].join(' ').trim() || null, tabindex: onRow ? 0 : null },
      cols.map((c) => h('td', { class: [c.r ? 'r num' : '', c.cls || '', c.hidePhone ? 'hide-phone' : ''].join(' ').trim() || null }, c.fmt ? c.fmt(row) : cell(row[c.key]))));
    if (onRow) {
      tr.addEventListener('click', () => onRow(row));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRow(row); });
    }
    return tr;
  });
  const tbl = h('div', { class: `tbl-wrap${phone === 'recs' ? ' phone-recs' : ''}` },
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map((c) => h('th', { class: [c.r ? 'r' : '', c.hidePhone ? 'hide-phone' : ''].join(' ').trim() || null, scope: 'col' }, c.label)))), h('tbody', null, body)));
  if (phone !== 'recs') return tbl;
  const titleCol = title ? cols.find((c) => c.key === title) : cols[0];
  const recs = h('div', { class: 'rec-list' }, rows.map((row) => {
    const rec = h('div', { class: `rec${onRow ? ' link' : ''}`, tabindex: onRow ? 0 : null },
      h('div', { class: 'rec-title' }, titleCol.fmt ? titleCol.fmt(row) : cell(row[titleCol.key])),
      h('dl', null, cols.filter((c) => c !== titleCol).map((c) => [h('div', null, h('dt', null, c.label), h('dd', null, c.fmt ? c.fmt(row) : cell(row[c.key])))])));
    if (onRow) rec.addEventListener('click', () => onRow(row));
    return rec;
  }));
  return [tbl, recs];
}
const statusTag = (st, text) => h('span', { class: `status ${st}` }, icon(st === 'pass' ? 'pass' : st === 'fail' ? 'fail' : st === 'warn' ? 'warn' : 'info'), text);
function hbars(items, { color = 'var(--hunt)', fmt = (v) => N(v), pct = true } = {}) {
  const max = Math.max(1, ...items.map((i) => i.max ?? i.value ?? 0));
  const total = items.reduce((a, i) => a + (i.value || 0), 0) || 1;
  return h('div', { class: 'hbars' }, items.map((i) => h('div', { class: 'hbar-row' },
    h('div', { class: 'hbar-top' }, i.dot || null, h('span', { class: 'name' }, i.label), h('span', { class: 'v' }, fmt(i.value)),
      pct ? h('span', { class: 'p' }, i.share != null ? P(i.share) : P((i.value || 0) / total)) : null),
    h('div', { class: 'bar' }, h('span', { style: `width:${Math.max(0, Math.min(100, ((i.value || 0) / (i.max ?? max)) * 100))}%; background:${i.color || color}` })))));
}
function kpi(lbl, val, sub, { big = false } = {}) {
  return h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, lbl), h('div', { class: `val num${big ? ' big' : ''}` }, val), sub ? h('div', { class: 'sub' }, sub) : null);
}
// The change against the previous period. good: 'up' (up is clearly good: green/red) or 'neutral' (grey, Nathan 2026-10-07).
function delta(cur, prev, vs, good = 'up') {
  if (!isNum(cur) || !isNum(prev)) return h('span', { class: 'delta flat' }, '-');
  if (Number(prev) === 0) return h('span', { class: 'delta flat' }, h('span', { class: 'num' }, Number(cur) === 0 ? '0.0%' : '-'), h('span', { class: 'vs' }, vs));
  const p = (cur - prev) / prev;
  const cls = good === 'neutral' || p === 0 ? 'flat' : p > 0 ? 'good' : 'bad';
  return h('span', { class: `delta ${cls}` }, p === 0 ? null : icon(p > 0 ? 'up' : 'down'), h('span', { class: 'num' }, `${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%`), h('span', { class: 'vs' }, vs));
}

/* ---------- the date range (game days, Mountain Time) ---------- */
const PRESETS = [['today', 'Today'], ['7d', '7d'], ['30d', '30d'], ['90d', '90d']];
const range = (() => { try { return JSON.parse(localStorage.getItem('admin.range')) || { preset: '30d' }; } catch { return { preset: '30d' }; } })();
function rangeDates() {
  const to = mtDay();
  if (range.preset === 'custom' && range.from && range.to) return { from: range.from, to: range.to };
  const n = { today: 0, '7d': 6, '30d': 29, '90d': 89 }[range.preset] ?? 29;
  return { from: addDays(to, -n), to };
}
const prevOf = ({ from, to }) => { const n = daysBetween(from, to) + 1; return { from: addDays(from, -n), to: addDays(from, -1) }; };
const rangeName = () => (range.preset === 'custom' ? 'prev period' : range.preset === 'today' ? 'yesterday' : `prev ${range.preset}`);
function rangeControl() {
  const { from, to } = rangeDates();
  const custom = h('div', { class: 'custom-range', hidden: range.preset !== 'custom' },
    h('input', { class: 'field', type: 'date', value: from, max: mtDay(), 'aria-label': 'From' }),
    h('input', { class: 'field', type: 'date', value: to, max: mtDay(), 'aria-label': 'To' }),
    h('button', { class: 'btn', type: 'button', onclick: () => {
      const [a, b] = custom.querySelectorAll('input');
      if (!a.value || !b.value || a.value > b.value) { a.focus(); return; }
      Object.assign(range, { preset: 'custom', from: a.value, to: b.value });
      localStorage.setItem('admin.range', JSON.stringify(range));
      render();
    } }, 'Apply'));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' },
    PRESETS.map(([k, t]) => h('button', { type: 'button', class: range.preset === k ? 'on' : null, 'aria-pressed': String(range.preset === k), onclick: () => {
      range.preset = k; localStorage.setItem('admin.range', JSON.stringify(range)); render();
    } }, t)),
    h('button', { type: 'button', class: range.preset === 'custom' ? 'on' : null, 'aria-pressed': String(range.preset === 'custom'), onclick: () => { custom.hidden = !custom.hidden; } },
      icon('calendar'), 'Custom'));
  return h('div', { class: 'range' }, h('span', { class: 'dates num hide-phone' }, `${day(from)} - ${day(to)}`), seg, custom);
}
function pageHead(title, sub, right) {
  return h('div', { class: 'page-head' }, h('div', { class: 'titles' }, h('h1', { class: 'title', text: title }), sub ? h('p', { class: 'subtitle' }, sub) : null), right || null);
}

/* ---------- navigation ---------- */
const NAV = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'members', label: 'Members', icon: 'users', match: /^\/members?(\/|$)/ },
  { id: 'economy', label: 'Economy', icon: 'coins' },
  { id: 'growth', label: 'Growth', icon: 'trend' },
  { id: 'cards', label: 'Cards', icon: 'layers', match: /^\/cards?(\/|$)/ },
  { id: 'hunt', label: 'Hunt', icon: 'swords', match: /^\/hunts?(\/|$)/ },
  { id: 'dungeon', label: 'Dungeon', icon: 'castle' },
  { id: 'activity', label: 'Activity', icon: 'zap' },
  { id: 'reports', label: 'Reports', icon: 'file', match: /^\/reports?(\/|$)/ },
  { id: 'data', label: 'Data', icon: 'table', match: /^\/data(\/|$)/ },
  { id: 'health', label: 'Health', icon: 'activity' },
];
const LOCKED = [['Balance', 'scale', 'Phase 2'], ['Settings', 'cog', 'Phase 2'], ['Events', 'calendar', 'Phase 3'], ['Rewards', 'gift', 'Phase 3'], ['Test lab', 'flask', 'Phase 3'], ['Admin log', 'scroll', 'Phase 2']];
const TABS = ['overview', 'members', 'economy', 'hunt'];
const navActive = (n, path) => (n.match ? n.match.test(path) : path === `/${n.id}`);
let session = { login: false };

// Phase 2 (the editors, src/admin-write.js): its nav items open when the server has ADMIN_EDIT=1.
const ED = editors({ h, icon, api, panel, table, fill, pageHead, statusTag, N, P, when, label, RARITY, rarityDot, qs, mtDay, addDays, pager, render: () => render() });
const navLocked = () => (ED.state.on ? LOCKED.filter(([t]) => !ED.nav.some((n) => n.label === t)) : LOCKED);
function navItems(path, { onPick } = {}) {
  return [
    h('div', { class: 'nav-head' }, 'Phase 1 - Live'),
    NAV.map((n) => h('a', { class: `nav-item${navActive(n, path) ? ' active' : ''}`, href: `#/${n.id}`, 'aria-current': navActive(n, path) ? 'page' : null, onclick: onPick }, icon(n.icon), n.label)),
    h('div', { class: 'nav-sep' }),
    ...(ED.state.on ? [h('div', { class: 'nav-head' }, 'Phase 2 - Edit'),
      ...ED.nav.map((n) => h('a', { class: `nav-item${navActive(n, path) ? ' active' : ''}`, href: `#/${n.id}`, 'aria-current': navActive(n, path) ? 'page' : null, onclick: onPick }, icon(n.icon), n.label)),
      h('div', { class: 'nav-sep' })] : []),
    h('div', { class: 'nav-head' }, ED.state.on ? 'Coming' : 'Phase 2 / 3 - Coming'),
    navLocked().map(([t, ic, ph]) => h('span', { class: 'nav-item locked', 'aria-disabled': 'true' }, icon(ic), t, h('span', { class: 'tag' }, icon('lock'), ph))),
    h('div', { class: 'nav-tools' },
      h('div', { class: 'nav-head' }, 'Tools'),
      h('a', { class: 'nav-item', href: '/index.html', target: '_blank', rel: 'noopener' }, icon('palette'), 'Card Studio', h('span', { class: 'tag', style: 'border:0' }, icon('external'))),
      session.login ? h('form', { method: 'post', action: '/logout', style: 'margin:0' },
        h('button', { class: 'nav-item', type: 'submit', style: 'width:100%;border:0;background:none;cursor:pointer;font:inherit' }, icon('logout'), 'Log out')) : null),
  ];
}
function drawNav(path) {
  document.getElementById('side').replaceChildren(...navItems(path).flat());
  const more = !TABS.some((id) => navActive(NAV.find((n) => n.id === id), path));
  document.getElementById('tabbar').replaceChildren(
    ...TABS.map((id) => { const n = NAV.find((x) => x.id === id); const on = navActive(n, path); return h('a', { class: `tab${on ? ' active' : ''}`, href: `#/${id}`, 'aria-current': on ? 'page' : null }, icon(n.icon), n.label); }),
    h('button', { class: `tab${more ? ' active' : ''}`, type: 'button', 'aria-haspopup': 'dialog', onclick: () => openSheet(path) }, icon('dots'), 'More'));
}
function openSheet(path) {
  const sheet = document.getElementById('more-sheet'), back = document.getElementById('sheet-back');
  const close = () => { sheet.hidden = true; back.hidden = true; };
  sheet.replaceChildren(h('div', { class: 'sheet-head' }, h('strong', null, 'More'), h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    ...navItems(path, { onPick: close }).flat());
  sheet.hidden = false; back.hidden = false;
  back.onclick = close;
  sheet.querySelector('a')?.focus();
}

/* ---------- global search (members, cards, tables) ---------- */
function setupSearch() {
  const form = document.getElementById('gsearch'), input = document.getElementById('gsearch-input'), out = document.getElementById('gsearch-results');
  let timer = 0, seq = 0;
  const go = (href) => { out.hidden = true; input.value = ''; form.classList.remove('open'); location.hash = href; };
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) { out.hidden = true; return; }
    const my = ++seq;
    out.hidden = false; out.replaceChildren(loadingState());
    try {
      const r = await api(`/search?${qs({ q })}`);
      if (my !== seq) return;
      const groups = [
        ['Members', r.members.map((m) => [m.username || m.id, m.last_active ? `active ${dayShort(m.last_active)}` : '', `#/member/${encodeURIComponent(m.id)}`])],
        ['Cards', r.cards.map((c) => [c.name, RARITY[c.rarity] || c.rarity, `#/card/${c.id}`])],
        ['Tables', r.tables.map((t) => [t, '', `#/data/${t}`])],
      ].filter(([, items]) => items.length);
      out.replaceChildren(...(groups.length ? groups.map(([g, items]) => [h('div', { class: 'gs-group' }, g),
        items.map(([t, sub, href]) => h('button', { class: 'gs-item', type: 'button', onclick: () => go(href) }, h('span', null, t), sub ? h('span', { class: 'sub' }, sub) : null))]).flat(2)
        : [h('div', { class: 'gs-empty' }, 'No match')]));
    } catch (e) { if (my === seq) out.replaceChildren(errorState(e)); }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  form.addEventListener('submit', (e) => { e.preventDefault(); out.querySelector('.gs-item')?.click(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { out.hidden = true; form.classList.remove('open'); } });
  document.addEventListener('click', (e) => { if (!form.contains(e.target) && e.target.closest('#search-open') == null) { out.hidden = true; form.classList.remove('open'); } });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); form.classList.add('open'); input.focus(); } });
  document.getElementById('search-open').addEventListener('click', () => { form.classList.toggle('open'); if (form.classList.contains('open')) input.focus(); });
}

/* ---------- health checks (shared by Overview and Health) ---------- */
function healthChecks(hl) {
  const rc = hl.reconcile || {};
  const sum = (o) => Object.values(o || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  const q = hl.queues || {};
  const unexplained = (hl.hunts || []).reduce((a, x) => a + (x.members_unexplained || 0), 0);
  const cronFail = (hl.cron || []).filter((j) => (j.failed_7d || 0) > 0 || j.last_status === 'failed');
  const list = [
    { name: 'Pack ledger = pack balances', ok: rc.pack?.ok, detail: rc.pack?.ok ? `${N(rc.pack.players - rc.pack.mismatched)} of ${N(rc.pack.players)} match` : `${N(rc.pack?.mismatched)} members differ` },
    { name: 'Shards ledger = Shards balances', ok: rc.shard?.ok, detail: rc.shard?.ok ? `${N(rc.shard.players - rc.shard.mismatched)} of ${N(rc.shard.players)} match` : `${N(rc.shard?.mismatched)} members differ` },
    { name: 'Card grants ledger = collections', ok: rc.card?.ok, detail: rc.card?.ok ? `${N(rc.card.players_mismatched)} differences` : `${N(rc.card?.players_mismatched)} members differ` },
    { name: 'Ledger refs', ok: sum(hl.refs_missing) === 0, detail: `${N(sum(hl.refs_missing))} missing` },
    { name: 'Ledger rows without a ref', ok: sum(hl.rows_without_ref) === 0, detail: `${N(sum(hl.rows_without_ref))} rows` },
    { name: 'Hunt damage (last 3 Hunts)', ok: unexplained === 0, detail: `${N(unexplained)} members unexplained` },
    { name: 'Bot queues', ok: !(q.hunt_events_unposted > 0 && q.hunt_events_oldest_unposted) && !q.reports_unsynced && !q.card_plays_unposted_1h,
      detail: `${N((q.hunt_events_unposted || 0) + (q.reports_unsynced || 0) + (q.card_plays_unposted_1h || 0))} waiting` },
    { name: 'Discord effects failed (7 days)', ok: !q.discord_effects_failed_7d, warn: true, detail: `${N(q.discord_effects_failed_7d || 0)} failed` },
    { name: 'Cron jobs (7 days)', ok: hl.cron == null ? null : cronFail.length === 0, detail: hl.cron == null ? 'pg_cron absent' : `${N(cronFail.length)} of ${N(hl.cron.length)} with failures` },
  ];
  return list.map((c) => ({ ...c, st: c.ok == null ? 'idle' : c.ok ? 'pass' : c.warn ? 'warn' : 'fail' }));
}
const checkRows = (checks) => h('div', { class: 'checks' }, checks.map((c) => h('div', { class: `check ${c.st === 'fail' ? 'fail' : ''}` },
  statusTag(c.st, c.st === 'pass' ? 'Pass' : c.st === 'fail' ? 'Fail' : c.st === 'warn' ? 'Warn' : 'None'), h('span', null, c.name), h('span', { class: 'detail' }, c.detail))));

/* ================= pages ================= */

async function pageOverview(main) {
  const r = rangeDates(), pv = prevOf(r);
  main.append(pageHead('Overview', `Whole server, ${dayShort(r.from)} - ${day(r.to)}. Deltas compare with the previous period.`, rangeControl()));
  const ovP = api(`/overview?${qs(r)}`), pvP = api(`/overview?${qs(pv)}`);
  const ecoP = api(`/economy?${qs({ ...r, bucket: daysBetween(r.from, r.to) > 120 ? 'week' : 'day' })}`);
  const hlP = api('/health');
  const kp = h('div', { class: 'kpis' });
  main.append(kp);
  fill(kp, async () => {
    const [o, p] = await Promise.all([ovP, pvP]);
    const vs = `vs ${rangeName()}`;
    return [
      kpi('Members', N(o.members.total), delta(o.members.total, o.members.total - o.members.new, `vs ${day(r.from)}`)),
      kpi('Active members', N(o.members.active), delta(o.members.active, p.members.active, vs)),
      kpi('Avg daily active', N(o.members.avg_daily_active, 1), delta(o.members.avg_daily_active, p.members.avg_daily_active, vs)),
      kpi('Packs opened', N(o.packs.opened), delta(o.packs.opened, p.packs.opened, vs)),
      kpi('Shards earned', N(o.shards.earned), delta(o.shards.earned, p.shards.earned, vs, 'neutral')),
      kpi('Shards spent', N(o.shards.spent), delta(o.shards.spent, p.shards.spent, vs, 'neutral')),
    ];
  });
  const row1 = h('div', { class: 'cols-ov' }), row2 = h('div', { class: 'cols-ov' });
  main.append(row1, row2);
  const ch = panel('Shards earned vs spent', { sub: `Per ${daysBetween(r.from, r.to) > 120 ? 'week' : 'day'}, ${dayShort(r.from)} - ${dayShort(r.to)}` });
  const pu = panel('Pulls: actual vs expected rate');
  row1.append(ch.el, pu.el);
  fill(ch.body, async () => shardsChart(await ecoP));
  fill(pu.body, async () => {
    const o = await ovP;
    pu.setSub(`${N(o.pulls.cards_pulled)} pulls from ${N(o.packs.opened)} packs. Range = 99% band around expected.`);
    return pullsTable(o.pulls);
  });
  const hu = panel('Hunt participation'), he = panel('Data health');
  row2.append(hu.el, he.el);
  fill(hu.body, async () => huntParticipation(hu, await ovP));
  fill(he.body, async () => {
    const hl = await hlP;
    const checks = healthChecks(hl).filter((c) => c.st !== 'idle').slice(0, 6);
    he.setSub(`Ledger checks on ${session.source || 'LIVE'}, last run ${when(hl.at, true)}`);
    const pass = checks.filter((c) => c.st === 'pass').length, fail = checks.length - pass;
    he.el.querySelector('.phead').append(h('div', { style: 'display:flex;gap:12px' }, statusTag('pass', `${pass} pass`), fail ? statusTag('fail', `${fail} fail`) : null));
    return [checkRows(checks), h('div', { class: 'pager' }, h('a', { class: 'btn', href: '#/health' }, 'All checks'))];
  });
}
function shardsChart(eco) {
  const rows = eco.ratios || [];
  if (!rows.length) return h('div', { class: 'empty' }, 'No rows');
  return lineChart({
    labels: rows.map((x) => dayShort(x.t)),
    series: [
      { name: 'Shards earned', short: 'Earned', color: 'var(--s-earned)', values: rows.map((x) => Number(x.shards_earned) || 0) },
      { name: 'Shards spent', short: 'Spent', color: 'var(--s-spent)', values: rows.map((x) => Number(x.shards_spent) || 0) },
    ],
  });
}
const pullStatus = (x) => (!isNum(x.z) ? statusTag('idle', 'No sample') : x.out ? statusTag('warn', 'Out of range') : statusTag('pass', 'Within range'));
function pullsTable(pulls) {
  const total = pulls.cards_pulled || 0;
  const Z99 = 2.576;
  const rows = (pulls.by_rarity || []).map((x) => ({ ...x, actual_rate: total ? x.actual / total : null, out: isNum(x.z) && Math.abs(x.z) > Z99 }));
  if (!rows.length) return h('div', { class: 'empty' }, 'No pulls in the range');
  return table({
    phone: 'table',
    rowClass: (x) => (x.out ? 'warn' : ''),
    cols: [
      { key: 'rarity', label: 'Rarity', fmt: (x) => [rarityDot(x.rarity), RARITY[x.rarity] || x.rarity, h('div', { class: 'phone-only' }, pullStatus(x))] },
      { key: 'rate', label: 'Expected', r: true, fmt: (x) => P(x.rate, 2) },
      { key: 'actual_rate', label: 'Actual', r: true, fmt: (x) => h('span', { style: x.out ? 'color: var(--danger-text)' : null }, P(x.actual_rate, 2)) },
      { key: 'actual', label: 'N', r: true, fmt: (x) => N(x.actual) },
      { key: 'z', label: 'Status', hidePhone: true, fmt: pullStatus },
    ],
    rows,
  });
}
async function huntParticipation(p, ov) {
  const list = await api('/hunts?limit=1');
  const cur = list.rows?.[0];
  if (!cur) return h('div', { class: 'empty' }, 'No Hunt yet');
  const hu = await api(`/hunt/${cur.id}`);
  const hunt = hu.hunt || cur;
  const now = Date.now();
  const live = !hunt.defeated_at && !hunt.settled_at && Date.parse(hunt.closes_at) > now;
  const total = daysBetween(mtDay(hunt.opens_at), mtDay(hunt.closes_at)) + 1;
  const dayN = Math.min(total, daysBetween(mtDay(hunt.opens_at), mtDay()) + 1);
  p.setSub(`Hunt ${hunt.id}, ${dayShort(mtDay(hunt.opens_at))} - ${day(mtDay(hunt.closes_at))}`);
  p.el.querySelector('.phead').append(live ? h('span', { class: 'pill hunt' }, icon('swords'), `Boss live, day ${dayN} of ${total}`)
    : h('span', { class: 'pill neutral' }, icon('swords'), `${label(hunt.status)} ${hunt.defeated_at ? when(hunt.defeated_at) : ''}`.trim()));
  const left = hunt.hp_max ? (hunt.hp_remaining || 0) / hunt.hp_max : 0;
  const active = ov.members.active || 0;
  return [
    h('div', { class: 'lbl' }, 'Current boss'),
    h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline;margin:4px 0 8px' },
      h('strong', { style: 'font-size:16px' }, hunt.name, ' ', h('span', { class: 'badge' }, hunt.tier)),
      h('span', { style: 'font-size:13px;color:var(--text-2)' }, 'HP left ', h('span', { class: 'num', style: 'color:var(--text);font-weight:600' }, `${N(hunt.hp_remaining)} / ${N(hunt.hp_max)}`), ' ',
        h('span', { class: 'num', style: 'color:var(--hunt-text);font-weight:700' }, P(left, 0)))),
    h('div', { class: 'bar thick' }, h('span', { style: `width:${left * 100}%;background:var(--hunt)` })),
    h('div', { class: 'cols-2 mt' },
      h('div', null,
        h('div', { class: 'lbl' }, 'Fighters vs active'),
        h('div', { style: 'margin:6px 0' }, h('span', { class: 'num', style: 'font-size:16px;font-weight:600' }, N(hu.fighters)), h('span', { class: 'num', style: 'color:var(--text-2);font-size:13px' }, ` / ${N(active)} active`)),
        h('div', { class: 'bar' }, h('span', { style: `width:${active ? Math.min(100, (hu.fighters / active) * 100) : 0}%;background:var(--hunt)` })),
        h('div', { style: 'font-size:12px;color:var(--text-2);margin-top:6px' }, `${P(active ? hu.fighters / active : null, 0)} of active members in the range`),
        h('div', { class: 'lbl mt' }, 'Attacks per fighter'),
        h('div', { style: 'margin-top:6px' }, h('span', { class: 'num', style: 'font-size:16px;font-weight:600' }, N(hu.fighters ? hu.attacks / hu.fighters : null, 1)),
          h('span', { style: 'font-size:13px;color:var(--text-2)' }, ` avg, ${N(hu.attacks)} attacks`))),
      h('div', null,
        h('div', { style: 'display:flex;justify-content:space-between' }, h('span', { class: 'lbl' }, 'Damage per day'), h('span', { class: 'num', style: 'font-size:12px;color:var(--text-2)' }, `${N(hu.damage)} total`)),
        barChart({ name: 'Damage', bars: (hu.by_day || []).map((d) => ({ label: day(d.day), short: d.day.slice(8, 10), value: d.damage })), highlightLast: live, fmt: (v) => compact(v), height: 150 }))),
    h('div', { class: 'pager' }, h('a', { class: 'btn', href: `#/hunt/${hunt.id}` }, 'Open the Hunt')),
  ];
}

/* ----- Members ----- */
const SORTS = [['last_active', 'Last active'], ['joined', 'Joined'], ['power', 'Power'], ['packs', 'Packs'], ['shards', 'Shards'], ['cards', 'Cards'], ['hunts', 'Hunts'], ['active_days_30', 'Active days 30d'], ['name_asc', 'Name A-Z']];
const memberName = (m) => m.username || m.id;
async function pageMembers(main, _, q) {
  const search = q.get('q') || '', sort = q.get('sort') || 'last_active', page = Math.max(0, Number(q.get('page')) || 0);
  const setQ = (o) => { location.hash = `#/members?${qs({ q: search, sort, page: 0, ...o })}`; };
  const input = h('input', { class: 'field', type: 'search', value: search, placeholder: 'Name or member id', 'aria-label': 'Search members', style: 'min-width:220px' });
  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => setQ({ q: input.value.trim() }), 400); });
  const sel = h('select', { class: 'field', 'aria-label': 'Sort', onchange: (e) => setQ({ sort: e.target.value }) }, SORTS.map(([k, t2]) => h('option', { value: k, selected: k === sort }, t2)));
  main.append(pageHead('Members', 'Every member, one page of 50', h('div', { class: 'form-row', style: 'margin:0' }, input, sel)));
  const p = panel(null);
  main.append(p.el);
  fill(p.body, async () => {
    const d = await api(`/members?${qs({ search, sort, limit: 50, offset: page * 50 })}`);
    if (!d.rows.length) return h('div', { class: 'empty' }, 'No member');
    const open = (m) => { location.hash = `#/member/${encodeURIComponent(m.id)}`; };
    return [
      table({
        onRow: open, title: 'username', rows: d.rows,
        cols: [
          { key: 'username', label: 'Member', fmt: (m) => [h('span', { class: 'avatar sm' }), memberName(m)] },
          { key: 'joined', label: 'Joined', fmt: (m) => h('span', { class: 'num' }, day(m.joined)) },
          { key: 'last_active', label: 'Last active', fmt: (m) => h('span', { class: 'num' }, day(m.last_active)) },
          { key: 'active_days_30', label: 'Days 30d', r: true, fmt: (m) => N(m.active_days_30) },
          { key: 'packs', label: 'Packs', r: true, fmt: (m) => N(m.packs) },
          { key: 'shards', label: 'Shards', r: true, fmt: (m) => N(m.shards) },
          { key: 'copies', label: 'Cards', r: true, fmt: (m) => N(m.copies) },
          { key: 'unique_cards', label: 'Unique', r: true, fmt: (m) => N(m.unique_cards) },
          { key: 'power', label: 'Power', r: true, fmt: (m) => N(m.power) },
          { key: 'hunts', label: 'Hunts', r: true, fmt: (m) => N(m.hunts) },
          { key: 'hunt_damage', label: 'Damage', r: true, fmt: (m) => N(m.hunt_damage) },
        ],
      }),
      pager(d.offset, d.rows.length, d.total, (pg) => setQ({ page: pg, sort, q: search }), 50),
    ];
  });
}
function pager(offset, n, total, go, size) {
  const page = Math.floor(offset / size);
  return h('div', { class: 'pager' },
    h('span', { class: 'num' }, `${N(n ? offset + 1 : 0)}-${N(offset + n)} of ${total != null ? N(total) : '?'}`),
    h('button', { class: 'btn', type: 'button', disabled: page === 0, onclick: () => go(page - 1) }, 'Previous'),
    h('button', { class: 'btn', type: 'button', disabled: total != null ? offset + n >= total : n < size, onclick: () => go(page + 1) }, 'Next'));
}

/* ----- Member detail ----- */
const KINDS = {
  joined: ['Joined', 'userplus'], pack: ['Pack', 'package'], card: ['Card', 'layers'], shard: ['Shards', 'gem'], daily: ['Daily', 'daily'],
  gift: ['Gift', 'gift'], gift_claim: ['Gift claimed', 'gift'], hunt: ['Hunt hit', 'swords'], combat: ['Combat', 'swords'], squad: ['Squad', 'users'],
  hunt_adjustment: ['Hunt fix', 'swords'], dungeon: ['Dungeon run', 'castle'], dungeon_over: ['Dungeon end', 'castle'], effect_sent: ['Effect played', 'sparkles'],
  effect_received: ['Effect received', 'sparkles'], trade: ['Trade', 'swap'], auction: ['Auction', 'gavel'], shop: ['Shop', 'cart'], achievement: ['Achievement', 'trophy'],
  report: ['Report', 'flag'], note: ['Bell note', 'bell'], chat: ['Chat', 'message'], voice: ['Voice', 'mic'],
  // the logs of 2026-10-07 (admin_member_timeline)
  guild: ['Discord server', 'users'], visit: ['Visit', 'eye'], tutorial: ['Walkthrough', 'info'], profile: ['Profile', 'cog'],
  dungeon_combat: ['Dungeon fight', 'castle'], wishlist: ['Wishlist', 'star'], stat_points: ['Stat points', 'zap'],
  report_about: ['Named in a report', 'flag'], note_read: ['Notes read', 'bell'], admin: ['Admin', 'scroll'],
};
const UNIT = { pack: ['pack', 'packs'], card: ['card', 'cards'], shard: ['Shard', 'Shards'], shop: ['Shard', 'Shards'], hunt: ['damage', 'damage'], hunt_adjustment: ['damage', 'damage'],
  chat: ['message', 'messages'], voice: ['minute', 'minutes'], achievement: ['pack', 'packs'],
  visit: ['minute', 'minutes'], dungeon_combat: ['damage', 'damage'], stat_points: ['point', 'points'], note_read: ['note', 'notes'] };
const kindClass = (k) => (k === 'hunt' || k === 'combat' || k === 'squad' || k === 'hunt_adjustment' ? 'hunt' : k === 'shard' || k === 'shop' ? 'shard' : '');
const kindTag = (k, map = KINDS) => { const [t, ic] = map[k] || [label(k), 'info']; return h('span', { class: `kind ${kindClass(k)}` }, icon(ic), t); };
const amountText = (r) => {
  if (!isNum(r.amount)) return '';
  const a = Number(r.amount), u = UNIT[r.kind];
  const sign = a > 0 && !['hunt', 'chat', 'voice', 'visit', 'dungeon_combat', 'note_read'].includes(r.kind) ? '+' : '';
  return `${sign}${N(a)}${u ? ` ${Math.abs(a) === 1 ? u[0] : u[1]}` : ''}`;
};

async function pageMember(main, [id]) {
  const find = h('input', { class: 'field', type: 'search', placeholder: 'Find a member', 'aria-label': 'Find a member', style: 'min-width:220px' });
  find.addEventListener('keydown', (e) => { if (e.key === 'Enter' && find.value.trim()) location.hash = `#/members?${qs({ q: find.value.trim() })}`; });
  const head = pageHead('Member detail', h('span', { class: 'crumb' }, h('a', { href: '#/members' }, 'Members'), ' / ', h('span', { id: 'crumb-name' }, id)), find);
  main.append(head);
  const top = h('div');
  main.append(top);
  const dP = api(`/member/${encodeURIComponent(id)}`);
  fill(top, async () => {
    const d = await dP;
    if (!d.found) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No member with this id'));
    const pr = d.profile, b = d.balances, c = d.collection, a = d.activity;
    head.querySelector('#crumb-name').textContent = pr.username || pr.id;
    const joined = mtDay(pr.joined);
    const ledgerOk = b.pack_ledger_sum === b.packs && b.shard_ledger_sum === b.shards;
    const tile = (ic, lbl, val, sub) => h('div', { class: 'mtile' }, h('div', { class: 'lbl' }, icon(ic), lbl), h('div', { class: 'val' }, val), h('div', { class: 'sub' }, sub));
    const profile = h('section', { class: 'panel profile' },
      h('div', { style: 'display:flex;gap:16px;align-items:center;min-width:0;flex:1 1 360px' }, memberAvatar(pr),
        h('div', { style: 'min-width:0' },
          h('div', { class: 'pname' }, pr.username || pr.id, pr.title ? h('span', { class: 'badge info' }, icon('star'), pr.title) : null,
            pr.muted ? h('span', { class: 'badge' }, 'Muted') : null, pr.discord_immune ? h('span', { class: 'badge' }, 'Immune') : null,
            pr.in_guild === false ? h('span', { class: 'badge' }, 'Left the server') : null),
          h('div', { class: 'facts' },
            h('div', null, h('div', { class: 'lbl' }, 'Joined'), h('span', { class: 'num' }, day(joined))),
            h('div', null, h('div', { class: 'lbl' }, 'Last active'), h('span', { class: 'num' }, day(a.last_active))),
            h('div', null, h('div', { class: 'lbl' }, 'Member for'), h('span', { class: 'num' }, `${N(daysBetween(joined, mtDay()))} days`)),
            h('div', null, h('div', { class: 'lbl' }, 'Active days'), h('span', { class: 'num' }, `${N(a.active_days_30)} in 30d`)),
            h('div', null, h('div', { class: 'lbl' }, 'Ledgers'), ledgerOk ? statusTag('pass', 'Match') : statusTag('fail', 'Differ'))))),
      h('div', { class: 'mtiles' },
        tile('package', 'Packs', N(b.packs), `${N(b.packs_earned)} earned, ${N(b.packs_opened)} opened`),
        tile('gem', 'Shards', N(b.shards), `${N(b.shards_earned)} earned, ${N(b.shards_spent)} spent`),
        tile('layers', 'Cards owned', N(c.copies), `${N(c.unique_cards)} unique`),
        tile('zap', 'Power', N(c.power), powerRank(c))));
    const coll = panel('Collection by rarity', { sub: `${N(c.copies)} cards, ${N(c.unique_cards)} unique` });
    coll.body.append(hbars((c.by_rarity || []).map((x) => ({ label: RARITY[x.rarity] || x.rarity, value: x.copies, dot: rarityDot(x.rarity), color: `var(--r-${x.rarity})`, max: c.copies, share: c.copies ? x.copies / c.copies : 0 }))));
    const act = panel('Actions', { right: ED.state.on ? null : h('span', { class: 'tag' }, icon('lock'), 'Phase 2') });
    if (ED.state.on) act.body.append(...ED.memberActions(d, () => setTimeout(render, 600)));
    else act.body.append(...[['Grant packs', 'package'], ['Give a card', 'gift'], ['Fix a balance', 'scale']].map(([t, ic]) => h('button', { class: 'action-btn', type: 'button', disabled: true }, icon(ic), t, h('span', { class: 'lock' }, icon('lock')))));
    const det = panel('Details');
    const kv = (title, pairs) => h('div', { class: 'rec' }, h('div', { class: 'lbl', style: 'margin-bottom:6px' }, title), h('dl', null, pairs.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))));
    det.body.append(
      kv('Hunt', [['Hunts', N(d.hunt.hunts)], ['Damage', N(d.hunt.damage)], ['Attacks', N(d.hunt.attacks)], ['Supports', N(d.hunt.supports)], ['Prize packs', N(d.hunt.prize_packs)]]),
      kv('Trading', [['Swaps', N(d.trading.swaps)], ['Open offers', N(d.trading.open_offers?.length)], ['Listings', N(d.trading.open_listings?.length)], ['Live auctions', N(d.trading.live_auctions?.length)], ['Wishlist', N(d.trading.wishlist?.length)]]),
      kv('Effects', [['Sent', N(d.effect_plays.sent)], ['Received', N(d.effect_plays.received)], ['Cooldowns now', N(d.effect_plays.cooldowns_now)], ['Active now', N((d.effects_now?.length || 0) + (d.discord_effects_now?.length || 0))]]),
      kv('Achievements', [['Claims', N(d.achievements.claims)], ['Packs', N(d.achievements.packs)], ['Titles', N(d.achievements.titles?.length)], ['Frames', N(d.achievements.frames?.length)]]),
      kv('Collection', [['Stars', N(c.stars)], ['Pulls', N(c.pulls)], ['Rare+ pulls', N(c.pulls_rare_plus)], ['Dungeon runs', N(d.dungeon?.length)], ['Gifts waiting', N(b.gifts_waiting)], ['Reports sent', N(d.reports?.by_count)]]),
      ...memberAppDetails(d, kv),
      h('div', { class: 'rec' }, h('div', { class: 'lbl', style: 'margin-bottom:8px' }, 'Active days by source'),
        hbars(Object.entries(a.by_source || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ label: label(k), value: v, max: a.active_days })), { pct: false })));
    const tl = timelinePanel(id);
    return [profile, h('div', { class: 'cols-member mt' },
      h('div', { class: 'stack' }, coll.el, act.el, det.el),
      tl)];
  });
}
/* The member page parts of the 2026-10-07 update (admin_member: avatar_url, power_rank, app, reports against). */
function memberAvatar(pr, cls = 'avatar') {
  const el = h('div', { class: cls });
  if (pr?.avatar_url) {
    const img = h('img', { src: pr.avatar_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    el.append(img);
  }
  return el;
}
const powerRank = (c) => (isNum(c.power_rank) ? `Rank ${N(c.power_rank)} of ${N(c.power_rank_of)}` : 'No rank');
function memberAppDetails(d, kv) {
  const ap = d.app || {}, pr = d.profile || {}, rp = d.reports || {};
  const screens = Object.entries(ap.views_by_screen || {}).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${label(k)} ${N(v)}`).join(', ');
  return [
    kv('App', [['Visits', N(ap.visits)], ['Last visit', when(ap.last_visit, true)], ['Screens viewed', N(ap.views)], ['Top screens', screens || '-'],
      ['Walkthrough steps', N(ap.tutorial_steps)], ['Bell notes unread', `${N(ap.notes_unread)} of ${N(ap.notes)}`]]),
    kv('Discord and logs', [['Server joined', when(pr.guild_joined_at, true)], ['Server left', when(pr.left_guild_at, true)],
      ['Profile changes', N(ap.profile_changes)], ['Wishlist changes', N(ap.wishlist_changes)], ['Admin actions', N(ap.admin_actions)],
      ['Reports against', N(rp.against_count)]]),
  ];
}
// The timeline filter runs on the server (admin_member_timeline p_kinds): a chip loads its kind from the newest event.
function timelinePanel(id) {
  const p = panel('Activity timeline', { sub: 'Every event for this member, newest first', cls: 'tl-panel' });
  const count = h('span', { class: 'num', style: 'font-size:12px;color:var(--text-2)' });
  p.el.querySelector('.phead').append(count);
  const state = { rows: [], next: null, kind: 'all', busy: false, totals: null, total: 0, matching: 0, seq: 0 };
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Kinds' });
  const tbody = h('tbody');
  const list = h('div', { class: 'tl-list' });
  const tableEl = h('div', { class: 'tbl-wrap tl-table' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Time', 'Kind', 'Description'].map((t) => h('th', { scope: 'col' }, t)), h('th', { class: 'r', scope: 'col' }, 'Amount'))), tbody));
  const oldest = h('span', { class: 'num' });
  const more = h('button', { class: 'btn', type: 'button' }, icon('older'), 'Load older');
  const status = h('div');
  const draw = () => {
    const totals = state.totals || {};
    const kinds = Object.keys(totals).sort((a, b) => totals[b] - totals[a] || a.localeCompare(b));
    const chip = (k, t, n, ic) => h('button', { class: `chip${state.kind === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.kind === k), onclick: () => {
      if (state.kind === k) return;
      state.kind = k; load(true);
    } }, state.kind === k ? icon('check') : ic ? icon(ic) : null, t, h('span', { class: 'n' }, N(n)));
    chips.replaceChildren(chip('all', 'All', state.total), ...kinds.map((k) => chip(k, (KINDS[k] || [label(k)])[0], totals[k], (KINDS[k] || [])[1])));
    count.textContent = `${N(state.rows.length)} of ${N(state.matching)} events`;
    tbody.replaceChildren(...state.rows.map((r) => h('tr', null, h('td', { class: 'num' }, when(r.at)), h('td', null, kindTag(r.kind)), h('td', null, r.text), h('td', { class: 'r' }, h('span', { class: 'amount' }, amountText(r))))));
    list.replaceChildren(...state.rows.map((r) => h('div', { class: 'tl-item' }, h('div', { class: 'row1' }, kindTag(r.kind), h('span', { class: 'amount' }, amountText(r))), h('div', { class: 'desc' }, r.text), h('div', { class: 'when' }, when(r.at, true)))));
    if (!state.rows.length && !state.busy) list.replaceChildren(h('div', { class: 'empty' }, 'No events'));
    oldest.textContent = state.rows.length ? `Oldest shown: ${when(state.rows.at(-1).at, true)}` : '';
    more.disabled = !state.next || state.busy;
    more.hidden = !state.next;
  };
  const load = async (reset = false) => {
    const my = ++state.seq;
    if (reset) { state.rows = []; state.next = null; }
    state.busy = true; more.disabled = true;
    if (reset) draw();
    status.replaceChildren(loadingState());
    try {
      const d = await api(`/member/${encodeURIComponent(id)}/timeline?${qs({ limit: 20, before: state.next?.before, before_key: state.next?.before_key, kinds: state.kind === 'all' ? null : state.kind })}`);
      if (my !== state.seq) return;
      state.rows.push(...(d.rows || []));
      state.next = d.next || null;
      state.totals = d.totals || {}; state.total = d.total ?? 0; state.matching = d.matching ?? state.rows.length;
      status.replaceChildren();
    } catch (e) { if (my === state.seq) status.replaceChildren(errorState(e, () => load(reset))); }
    if (my !== state.seq) return;
    state.busy = false;
    draw();
  };
  more.addEventListener('click', () => load(false));
  p.body.append(chips, tableEl, list, status, h('div', { class: 'tl-foot' }, oldest, more));
  load(true);
  return p.el;
}

/* ----- Economy ----- */
async function pageEconomy(main, _, q) {
  const r = rangeDates(), bucket = q.get('bucket') === 'week' ? 'week' : 'day';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Bucket' }, [['day', 'Day'], ['week', 'Week']].map(([k, t]) =>
    h('button', { type: 'button', class: bucket === k ? 'on' : null, 'aria-pressed': String(bucket === k), onclick: () => { location.hash = `#/economy?bucket=${k}`; } }, t)));
  main.append(pageHead('Economy', `Packs, cards and Shards, ${dayShort(r.from)} - ${day(r.to)}`, h('div', { class: 'range' }, seg, rangeControl())));
  const box = h('div');
  main.append(box);
  fill(box, async () => {
    const e = await api(`/economy?${qs({ ...r, bucket })}`);
    const rows = e.ratios || [];
    const sum = (k) => rows.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    const pe = sum('packs_earned'), po = sum('packs_opened'), se = sum('shards_earned'), ss = sum('shards_spent');
    const labels = rows.map((x) => dayShort(x.t));
    const ch1 = panel('Shards earned vs spent', { sub: `Per ${bucket}` });
    ch1.body.append(shardsChart(e));
    const ch2 = panel('Packs earned vs opened', { sub: `Per ${bucket}` });
    ch2.body.append(lineChart({ labels, series: [
      { name: 'Packs earned', short: 'Earned', color: 'var(--s-earned)', values: rows.map((x) => Number(x.packs_earned) || 0) },
      { name: 'Packs opened', short: 'Opened', color: 'var(--s-spent)', values: rows.map((x) => Number(x.packs_opened) || 0) }] }));
    const sup = e.supply || [];
    const supply = (name, key) => { const pp = panel(name, { sub: `Held by all members at the end of each ${bucket}` });
      pp.body.append(lineChart({ labels: sup.map((x) => dayShort(x.t)), series: [{ name, short: 'Now', color: 'var(--s-spent)', values: sup.map((x) => Number(x[key]) || 0) }], height: 160 })); return pp.el; };
    const reasons = (ledger, unit) => {
      const agg = {};
      for (const x of e.series?.[ledger] || []) { const a = (agg[x.reason] ||= { reason: x.reason, rows: 0, in: 0, out: 0 }); a.rows += x.rows || 0; a.in += Number(x.in) || 0; a.out += Number(x.out) || 0; }
      const list = Object.values(agg).sort((a, b) => (b.in - b.out) - (a.in - a.out));
      const pp = panel(`${unit} by reason`, { sub: `${ledger}_ledger` });
      pp.body.append(...[list.length ? table({ rows: list, phone: 'table', cols: [
        { key: 'reason', label: 'Reason', fmt: (x) => label(x.reason) },
        { key: 'rows', label: 'Rows', r: true, fmt: (x) => N(x.rows) },
        { key: 'in', label: 'In', r: true, fmt: (x) => N(x.in) },
        { key: 'out', label: 'Out', r: true, fmt: (x) => N(x.out) }] }) : h('div', { class: 'empty' }, 'No rows')].flat());
      return pp.el;
    };
    const ratio = panel('Ratios', { sub: `Per ${bucket}` });
    ratio.body.append(...[table({ rows: [...rows].reverse(), cols: [
      { key: 't', label: bucket === 'week' ? 'Week of' : 'Day', fmt: (x) => h('span', { class: 'num' }, day(x.t)) },
      { key: 'packs_earned', label: 'Packs earned', r: true, fmt: (x) => N(x.packs_earned) },
      { key: 'packs_opened', label: 'Packs opened', r: true, fmt: (x) => N(x.packs_opened) },
      { key: 'open_earn', label: 'Opened / earned', r: true, fmt: (x) => P(x.open_earn) },
      { key: 'shards_earned', label: 'Shards earned', r: true, fmt: (x) => N(x.shards_earned) },
      { key: 'shards_spent', label: 'Shards spent', r: true, fmt: (x) => N(x.shards_spent) },
      { key: 'spend_earn', label: 'Spent / earned', r: true, fmt: (x) => P(x.spend_earn) }] })].flat());
    return [
      h('div', { class: 'kpis' },
        kpi('Packs earned', N(pe)), kpi('Packs opened', N(po)), kpi('Opened / earned', P(pe ? po / pe : null)),
        kpi('Shards earned', N(se)), kpi('Shards spent', N(ss)), kpi('Spent / earned', P(se ? ss / se : null))),
      h('div', { class: 'cols-ov' }, ch1.el, ch2.el),
      h('div', { class: 'cols-3', style: 'margin-bottom:16px' }, supply('Packs held', 'packs_held'), supply('Card copies held', 'copies_held'), supply('Shards held', 'shards_held')),
      h('div', { class: 'cols-3', style: 'margin-bottom:16px' }, reasons('pack', 'Packs'), reasons('shard', 'Shards'), reasons('card', 'Card copies')),
      ratio.el,
    ];
  });
}

/* ----- Growth ----- */
async function pageGrowth(main) {
  const r = rangeDates();
  main.append(pageHead('Growth', `New members, retention and reach, ${dayShort(r.from)} - ${day(r.to)}`, rangeControl()));
  const box = h('div');
  main.append(box);
  fill(box, async () => {
    const g = await api(`/growth?${qs(r)}`);
    const ret = g.retention || {}, f = g.funnel || {}, ch = g.churn || {};
    const nb = panel('New members per day');
    nb.body.append(barChart({ name: 'New members', color: 'var(--s-spent)', bars: (g.new_by_day || []).map((x) => ({ label: day(x.day), short: dayShort(x.day), value: x.new })), height: 180 }));
    const fu = panel('Funnel', { sub: `Members who joined in the range. Median ${N(f.median_hours_to_first_open, 1)} h to the first pack.` });
    const steps = [['Joined', f.joined], ['Claimed the welcome gift', f.claimed_welcome], ['Opened a first pack', f.opened_first_pack], ['First fight', f.first_fight], ['First trade', f.first_trade]];
    fu.body.append(hbars(steps.map(([t, v]) => ({ label: t, value: v, max: f.joined || 1, share: f.joined ? (v || 0) / f.joined : null })), { color: 'var(--s-spent)' }),
      h('div', { class: 'mt' }, hbars([{ label: 'Active in week 2', value: f.active_week2, max: f.week2_eligible || 1, share: f.week2_eligible ? (f.active_week2 || 0) / f.week2_eligible : null }], { color: 'var(--s-spent)' })),
      h('div', { class: 'subtitle', style: 'margin-top:6px' }, `Week 2: ${N(f.week2_eligible)} members joined 13+ days before the range end`));
    const reach = g.feature_reach || {};
    const fr = panel('Feature reach', { sub: `Share of the ${N(reach.active)} active members` });
    fr.body.append(hbars((reach.features || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).map((x) => ({ label: label(x.feature), value: x.members, max: reach.active || 1, share: x.share })), { color: 'var(--s-spent)' }));
    const co = panel('Retention cohorts', { sub: 'Share of each join week active in week 0, 1, 2 ...' });
    const W = Math.max(0, ...(g.cohorts || []).map((c) => c.weeks.length));
    co.body.append(g.cohorts?.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl cohort' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Join week'), h('th', { class: 'r', scope: 'col' }, 'Size'), Array.from({ length: W }, (_, i) => h('th', { class: 'r', scope: 'col' }, `W${i}`)))),
      h('tbody', null, g.cohorts.map((c) => h('tr', null, h('td', { class: 'num' }, day(c.week)), h('td', { class: 'r num' }, N(c.size)),
        Array.from({ length: W }, (_, i) => { const w = c.weeks[i]; return h('td', { class: 'c', title: w ? `${N(w.active)} of ${N(c.size)}` : null,
          style: w ? `background: rgba(154,115,255,${(0.08 + (w.share || 0) * 0.7).toFixed(2)})` : null }, w ? P(w.share, 0) : ''); })))))) : h('div', { class: 'empty' }, 'No cohort'));
    const retTile = (k, t) => kpi(t, P(ret[k]?.share), h('span', { class: 'num' }, `${N(ret[k]?.kept)} of ${N(ret[k]?.eligible)}`));
    return [
      h('div', { class: 'kpis' }, retTile('d1', 'Retention day 1'), retTile('d7', 'Retention day 7'), retTile('d30', 'Retention day 30'),
        kpi('Active now', N(ch.active_now), h('span', { class: 'num' }, `${N(ch.active_previous)} in the period before`)),
        kpi('Churned', N(ch.churned), h('span', { class: 'num' }, `rate ${P(ch.churn_rate)}, kept ${N(ch.kept)}`)),
        kpi('New active / returned', `${N(ch.new_active)} / ${N(ch.returned)}`)),
      h('div', { class: 'cols-ov' }, nb.el, fu.el),
      h('div', { class: 'cols-ov' }, fr.el, co.el),
    ];
  });
}

/* ----- Cards ----- */
const CARD_SORTS = ['copies', 'owners', 'pulls', 'trades', 'attacks', 'damage', 'plays', 'id'];
async function pageCards(main, _, q) {
  const r = rangeDates(), sort = CARD_SORTS.includes(q.get('sort')) ? q.get('sort') : 'copies', page = Math.max(0, Number(q.get('page')) || 0);
  const search = q.get('q') || '';
  const setQ = (o) => { location.hash = `#/cards?${qs({ q: search, sort, page: 0, ...o })}`; };
  const input = h('input', { class: 'field', type: 'search', value: search, placeholder: 'Card name or id', 'aria-label': 'Search cards', style: 'min-width:200px' });
  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => setQ({ q: input.value.trim() }), 400); });
  const sel = h('select', { class: 'field', 'aria-label': 'Sort', onchange: (e) => setQ({ sort: e.target.value }) }, CARD_SORTS.map((k) => h('option', { value: k, selected: k === sort }, `Sort: ${label(k)}`)));
  main.append(pageHead('Cards', `Each card: copies and owners now; pulls, trades and Hunt use in ${dayShort(r.from)} - ${day(r.to)}`, h('div', { class: 'range' }, input, sel, rangeControl())));
  const p = panel(null);
  main.append(p.el);
  fill(p.body, async () => {
    const d = await api(`/cards?${qs({ ...r, sort, limit: 50, offset: page * 50, search })}`);
    if (!d.rows.length) return h('div', { class: 'empty' }, 'No card');
    return [
      table({ rows: d.rows, title: 'name', onRow: (c) => { location.hash = `#/card/${c.id}`; }, cols: [
        { key: 'name', label: 'Card', fmt: (c) => [rarityDot(c.rarity), c.name] },
        { key: 'rarity', label: 'Rarity', fmt: (c) => RARITY[c.rarity] || c.rarity },
        { key: 'type', label: 'Type' },
        { key: 'copies', label: 'Copies', r: true, fmt: (c) => N(c.copies) },
        { key: 'owners', label: 'Owners', r: true, fmt: (c) => N(c.owners) },
        { key: 'stars', label: 'Stars', r: true, fmt: (c) => N(c.stars) },
        { key: 'pulls', label: 'Pulls', r: true, fmt: (c) => N(c.pulls) },
        { key: 'trades', label: 'Trades', r: true, fmt: (c) => N(c.trades) },
        { key: 'attacks', label: 'Attacks', r: true, fmt: (c) => N(c.attacks) },
        { key: 'damage', label: 'Damage', r: true, fmt: (c) => N(c.damage) },
        { key: 'damage_share', label: 'Dmg share', r: true, fmt: (c) => P(c.damage_share) },
        { key: 'supports', label: 'Supports', r: true, fmt: (c) => N(c.supports) },
        { key: 'plays', label: 'Plays', r: true, fmt: (c) => N(c.plays) },
        { key: 'in_draw_pool', label: 'In packs', fmt: (c) => (c.in_draw_pool ? 'yes' : 'no') },
      ] }),
      pager(d.offset, d.rows.length, d.total, (pg) => { location.hash = `#/cards?${qs({ q: search, sort, page: pg })}`; }, 50),
    ];
  });
}

/* ----- One card (admin_card) ----- */
async function pageCard(main, [id]) {
  const head = pageHead('Card', h('span', { class: 'crumb' }, h('a', { href: '#/cards' }, 'Cards'), ' / ', h('span', { id: 'crumb-card' }, id)));
  main.append(head);
  const box = h('div');
  main.append(box);
  fill(box, async () => {
    const d = await api(`/card/${encodeURIComponent(id)}`);
    if (!d.found) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No card with this id'));
    const k = d.card, tr = d.trading || {}, hu = d.hunt || {}, pl = d.plays || {};
    head.querySelector('.title').textContent = k.name;
    head.querySelector('#crumb-card').textContent = k.name;
    const kvRec = (title, pairs) => h('div', { class: 'rec' }, h('div', { class: 'lbl', style: 'margin-bottom:6px' }, title), h('dl', null, pairs.map(([a, v]) => h('div', null, h('dt', null, a), h('dd', null, v)))));
    const info = panel('Card', { sub: `${RARITY[k.rarity] || k.rarity}, ${label(k.type || '-')}` });
    info.body.append(h('div', { class: 'card-info' },
      k.image_url ? h('img', { class: 'card-img', src: k.image_url, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null,
      kvRec('Facts', [['Id', h('span', { class: 'num' }, k.id)], ['Rarity', [rarityDot(k.rarity), RARITY[k.rarity] || k.rarity]], ['Subject', k.subject || '-'],
        ['Season', k.season || '-'], ['Event', k.event || '-'], ['Source', label(k.source)], ['In packs', k.in_draw_pool ? 'yes' : 'no'],
        ['Tradeable', k.tradeable ? 'yes' : 'no'], ['Added', when(k.created_at, true)]])));
    const st = panel('Copies by star level', { sub: `${N(d.copies)} copies, ${N(d.owners)} owners, ${N(d.with_stat_points)} with stat points` });
    st.body.append((d.by_star || []).length ? hbars(d.by_star.map((x) => ({ label: `${N(x.stars)} stars`, value: x.copies, max: d.copies || 1, share: d.copies ? x.copies / d.copies : 0 })), { color: 'var(--gold)' })
      : h('div', { class: 'empty' }, 'Nobody owns this card'));
    const pu = panel('Pulls per week', { sub: `${N(d.pulls?.total)} pulls from packs, first ${when(d.pulls?.first, true)}` });
    pu.body.append((d.pulls?.by_week || []).length ? barChart({ name: 'Pulls', color: 'var(--s-spent)', bars: d.pulls.by_week.map((x) => ({ label: day(x.week), short: dayShort(x.week), value: x.pulls })), height: 160 })
      : h('div', { class: 'empty' }, 'No pull'));
    const io = panel('In and out', { sub: 'card_ledger, all time' });
    const reasons = {};
    for (const x of d.in_by_reason || []) (reasons[x.reason] ||= { reason: x.reason, in: 0, out: 0 }).in += Number(x.copies) || 0;
    for (const x of d.out_by_reason || []) (reasons[x.reason] ||= { reason: x.reason, in: 0, out: 0 }).out += Number(x.copies) || 0;
    const rl = Object.values(reasons).sort((a, b) => (b.in + b.out) - (a.in + a.out));
    io.body.append(...[rl.length ? table({ phone: 'table', rows: rl, cols: [{ key: 'reason', label: 'Reason', fmt: (x) => label(x.reason) },
      { key: 'in', label: 'In', r: true, fmt: (x) => N(x.in) }, { key: 'out', label: 'Out', r: true, fmt: (x) => N(x.out) }] }) : h('div', { class: 'empty' }, 'No rows')].flat());
    const use = panel('Use');
    const offers = Object.entries(tr.offers_by_status || {}).map(([s2, n]) => `${label(s2)} ${N(n)}`).join(', ');
    use.body.append(
      kvRec('Trading', [['Swaps', N(tr.swaps)], ['Offers', offers || '-'], ['Listings', `${N(tr.listings)} (${N(tr.listings_open)} open)`],
        ['Auctions', `${N(tr.auctions)} (${N(tr.auctions_sold)} sold)`], ['Wishlists now', `${N(tr.wishlisted_now)} (${N(tr.top_want_now)} top)`], ['Wishlist adds', N(tr.wishlist_adds)]]),
      kvRec('Hunt', [['Hunts', N(hu.hunts)], ['Attacks', N(hu.attacks)], ['Damage', N(hu.damage)], ['Supports', N(hu.supports)], ['Squads', N(hu.squads)]]),
      ...(d.dungeon || []).map((m) => kvRec(m.mode === 'dungeon' ? 'Dungeon' : 'Gauntlet', [['Runs', N(m.runs)], ['Attacks', N(m.attacks)], ['Damage', N(m.damage)],
        ['Supports', N(m.supports)], ['Healed', N(m.healed)], ['Taken', N(m.taken)], ['Downs', N(m.downs)]])));
    const ef = panel('Effect plays', { sub: `${N(pl.total)} plays` });
    ef.body.append(...[(pl.by_primitive || []).length ? table({ phone: 'table', rows: pl.by_primitive, cols: [
      { key: 'primitive', label: 'Effect', fmt: (x) => label(x.primitive) }, { key: 'kind', label: 'Kind', fmt: (x) => label(x.kind) },
      { key: 'plays', label: 'Plays', r: true, fmt: (x) => N(x.plays) }, { key: 'applied', label: 'Applied', r: true, fmt: (x) => N(x.applied) },
      { key: 'blocked', label: 'Blocked', r: true, fmt: (x) => N(x.blocked) }] }) : h('div', { class: 'empty' }, 'No play')].flat());
    const ow = panel('Top owners', { sub: 'Most stars, then copies' });
    ow.body.append(...[(d.top_owners || []).length ? table({ rows: d.top_owners, title: 'username', onRow: (x) => { location.hash = `#/member/${encodeURIComponent(x.player_id)}`; }, cols: [
      { key: 'username', label: 'Member', fmt: (x) => x.username || x.player_id }, { key: 'stars', label: 'Stars', r: true, fmt: (x) => N(x.stars) },
      { key: 'copies', label: 'Copies', r: true, fmt: (x) => N(x.copies) }] }) : h('div', { class: 'empty' }, 'Nobody owns this card')].flat());
    const dmg = (d.dungeon || []).reduce((a, m) => a + (Number(m.damage) || 0), 0);
    return [
      h('div', { class: 'kpis' }, kpi('Owners', N(d.owners)), kpi('Copies', N(d.copies)), kpi('Stars', N(d.stars)), kpi('Pulls', N(d.pulls?.total)),
        kpi('Hunt damage', N(hu.damage)), kpi('Dungeon damage', N(dmg))),
      h('div', { class: 'cols-ov' }, info.el, st.el),
      h('div', { class: 'cols-ov' }, pu.el, io.el),
      h('div', { class: 'cols-ov' }, use.el, h('div', { class: 'stack' }, ef.el, ow.el)),
    ];
  });
}

/* ----- Hunt ----- */
async function pageHunts(main, _, q) {
  const page = Math.max(0, Number(q.get('page')) || 0);
  main.append(pageHead('Hunt', 'Every Hunt, newest first'));
  const p = panel(null);
  main.append(p.el);
  fill(p.body, async () => {
    const d = await api(`/hunts?${qs({ limit: 20, offset: page * 20 })}`);
    if (!d.rows.length) return h('div', { class: 'empty' }, 'No Hunt yet');
    return [table({ rows: d.rows, title: 'name', onRow: (x) => { location.hash = `#/hunt/${x.id}`; }, cols: [
      { key: 'name', label: 'Boss', fmt: (x) => [x.name, ' ', h('span', { class: 'badge' }, x.tier)] },
      { key: 'status', label: 'Status', fmt: (x) => label(x.status) },
      { key: 'opens_at', label: 'Opens', fmt: (x) => h('span', { class: 'num' }, when(x.opens_at, true)) },
      { key: 'closes_at', label: 'Closes', fmt: (x) => h('span', { class: 'num' }, when(x.closes_at, true)) },
      { key: 'hp_max', label: 'HP', r: true, fmt: (x) => N(x.hp_max) },
      { key: 'hp_remaining', label: 'HP left', r: true, fmt: (x) => N(x.hp_remaining) },
      { key: 'damage', label: 'Damage', r: true, fmt: (x) => N(x.damage) },
      { key: 'fighters', label: 'Fighters', r: true, fmt: (x) => N(x.fighters) },
      { key: 'attacks', label: 'Attacks', r: true, fmt: (x) => N(x.attacks) },
      { key: 'prize_packs', label: 'Prize packs', r: true, fmt: (x) => N(x.prize_packs) },
    ] }), pager(page * 20, d.rows.length, d.total, (pg) => { location.hash = `#/hunt?page=${pg}`; }, 20)];
  });
}
async function pageHunt(main, [id]) {
  const head = pageHead('Hunt', h('span', { class: 'crumb' }, h('a', { href: '#/hunt' }, 'Hunt'), ' / ', id));
  main.append(head);
  const box = h('div');
  main.append(box);
  fill(box, async () => {
    const d = await api(`/hunt/${encodeURIComponent(id)}`);
    if (!d.found) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No Hunt with this id'));
    const hu = d.hunt;
    head.querySelector('.title').textContent = hu.name;
    const left = hu.hp_max ? (hu.hp_remaining || 0) / hu.hp_max : 0;
    const hp = panel('Boss', { sub: `${hu.tier}, ${label(hu.status)}, ${when(hu.opens_at, true)} - ${when(hu.closes_at, true)}` });
    hp.body.append(
      h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--text-2);margin-bottom:8px' },
        h('span', null, 'HP left ', h('span', { class: 'num', style: 'color:var(--text)' }, `${N(hu.hp_remaining)} / ${N(hu.hp_max)}`)), h('span', { class: 'num', style: 'color:var(--hunt-text);font-weight:700' }, P(left, 0))),
      h('div', { class: 'bar thick' }, h('span', { style: `width:${left * 100}%;background:var(--hunt)` })),
      hu.passive?.label ? h('p', { class: 'note mt' }, hu.passive.label) : null,
      h('div', { class: 'mt' }, checkRows([{ name: 'Damage reconcile', st: d.reconcile?.ok ? 'pass' : 'fail', detail: `${N(d.reconcile?.members_unexplained)} members unexplained` }])));
    const days = panel('Damage per day');
    days.body.append(barChart({ name: 'Damage', bars: (d.by_day || []).map((x) => ({ label: day(x.day), short: dayShort(x.day), value: x.damage })), height: 180, fmt: (v) => compact(v) }));
    const rb = panel('Damage by rank', { sub: `Top member ${P(d.top_share)}, top 3 ${P(d.top3_share)}` });
    rb.body.append(...[table({ phone: 'table', rows: d.rank_buckets || [], cols: [
      { key: 'ranks', label: 'Ranks' }, { key: 'members', label: 'Members', r: true, fmt: (x) => N(x.members) },
      { key: 'damage', label: 'Damage', r: true, fmt: (x) => N(x.damage) }, { key: 'share', label: 'Share', r: true, fmt: (x) => P(x.share) }] })].flat());
    const db = panel('Members by damage');
    db.body.append(hbars((d.damage_buckets || []).map((x) => ({ label: `${N(x.damage_from)}+`, value: x.members })), { color: 'var(--hunt)' }));
    const board = panel('Damage board', { right: h('a', { class: 'btn', href: `/api/admin/report/hunt_board.csv?${qs({ hunt: hu.id, limit: 1000 })}`, download: '' }, icon('download'), 'CSV') });
    fill(board.body, async () => {
      const rep = await api(`/report/hunt_board?${qs({ hunt: hu.id, limit: 100 })}`);
      return table({ rows: rep.rows, title: 'username', onRow: (x) => { location.hash = `#/member/${encodeURIComponent(x.player_id)}`; }, cols: [
        { key: 'rank', label: 'Rank', r: true, fmt: (x) => N(x.rank) }, { key: 'username', label: 'Member', fmt: (x) => x.username || x.player_id },
        { key: 'damage', label: 'Damage', r: true, fmt: (x) => N(x.damage) }, { key: 'share', label: 'Share', r: true, fmt: (x) => P(x.share) },
        { key: 'prize_packs', label: 'Prize packs', r: true, fmt: (x) => N(x.prize_packs) }] });
    });
    return [
      h('div', { class: 'kpis' }, kpi('Damage', N(d.damage)), kpi('Fighters', N(d.fighters)), kpi('Attacks', N(d.attacks)), kpi('Supports', N(d.supports)),
        kpi('Squads', N(d.squads)), kpi('Prize packs', N(d.prizes?.packs), h('span', { class: 'num' }, `${N(d.prizes?.members)} members`))),
      h('div', { class: 'cols-ov' }, hp.el, days.el),
      h('div', { class: 'cols-ov' }, rb.el, db.el),
      board.el,
    ];
  });
}

/* ----- Dungeon and Gauntlet (admin_dungeon) ----- */
const MODE = { daily: 'Dungeon', gauntlet: 'Gauntlet', no_run: 'No run' };
async function pageDungeon(main) {
  const r = rangeDates();
  main.append(pageHead('Dungeon', `Daily Dungeon and Gauntlet, ${dayShort(r.from)} - ${day(r.to)}`, rangeControl()));
  const box = h('div');
  main.append(box);
  fill(box, async () => {
    const [d, hl] = await Promise.all([api(`/dungeon?${qs(r)}`), api('/health')]);
    const modes = d.by_mode || [];
    const tot = (k) => modes.reduce((a, m) => a + (Number(m[k]) || 0), 0);
    const mp = panel('Runs by mode');
    mp.body.append(...[modes.length ? table({ phone: 'recs', rows: modes, title: 'mode', cols: [
      { key: 'mode', label: 'Mode', fmt: (m) => MODE[m.mode] || label(m.mode) }, { key: 'runs', label: 'Runs', r: true, fmt: (m) => N(m.runs) },
      { key: 'members', label: 'Members', r: true, fmt: (m) => N(m.members) }, { key: 'cleared', label: 'Cleared', r: true, fmt: (m) => N(m.cleared) },
      { key: 'fell', label: 'Fell', r: true, fmt: (m) => N(m.fell) }, { key: 'best_floor', label: 'Best floor', r: true, fmt: (m) => N(m.best_floor) },
      { key: 'avg_rooms', label: 'Avg rooms', r: true, fmt: (m) => N(m.avg_rooms, 1) }, { key: 'shards', label: 'Shards', r: true, fmt: (m) => N(m.shards) }] }) : h('div', { class: 'empty' }, 'No run in the range')].flat());
    const perDay = {};
    for (const x of d.by_day || []) perDay[x.day] = (perDay[x.day] || 0) + (Number(x.runs) || 0);
    const days = [];
    for (let t = r.from; t <= r.to; t = addDays(t, 1)) days.push(t);
    const dp = panel('Runs per day');
    dp.body.append(barChart({ name: 'Runs', color: 'var(--s-spent)', bars: days.map((x) => ({ label: day(x), short: dayShort(x), value: perDay[x] || 0 })), height: 180 }));
    const kp = panel('Kills by monster', { sub: `${N(d.kills_total)} foes killed by a squad attack or support` });
    kp.body.append((d.kills || []).length ? hbars(d.kills.map((x) => ({ label: x.name || x.key, value: x.kills })), { color: 'var(--hunt)' }) : h('div', { class: 'empty' }, 'No kill'));
    const rp = panel('Rooms reached', { sub: 'Where each run stands or ended' });
    rp.body.append(...[(d.reached || []).length ? table({ phone: 'table', rows: d.reached, cols: [
      { key: 'mode', label: 'Mode', fmt: (x) => MODE[x.mode] || label(x.mode) }, { key: 'floor', label: 'Floor', r: true, fmt: (x) => N(x.floor) },
      { key: 'room', label: 'Room', r: true, fmt: (x) => N(x.room) }, { key: 'runs', label: 'Runs', r: true, fmt: (x) => N(x.runs) },
      { key: 'fell', label: 'Fell', r: true, fmt: (x) => N(x.fell) }] }) : h('div', { class: 'empty' }, 'No run')].flat());
    const pd = d.paid || {};
    const pp = panel('Paid', { sub: `${N(pd.shards)} Shards, ${N(pd.cards)} cards, ${N(pd.packs)} packs` });
    pp.body.append(...[
      (pd.shards_by_source || []).length ? table({ phone: 'table', rows: pd.shards_by_source, cols: [
        { key: 'mode', label: 'Mode', fmt: (x) => MODE[x.mode] || label(x.mode) }, { key: 'source', label: 'Source', fmt: (x) => label(x.source) },
        { key: 'rows', label: 'Rows', r: true, fmt: (x) => N(x.rows) }, { key: 'shards', label: 'Shards', r: true, fmt: (x) => N(x.shards) }] }) : h('div', { class: 'empty' }, 'No Shards paid'),
      (pd.cards_by_rarity || []).length ? h('div', { class: 'mt' }, hbars(pd.cards_by_rarity.map((x) => ({ label: `${label(x.reason)}: ${RARITY[x.rarity] || x.rarity}`, value: x.copies,
        dot: rarityDot(x.rarity), color: `var(--r-${x.rarity})` })), { pct: false })) : null,
      (pd.boards || []).length ? h('div', { class: 'mt' }, table({ phone: 'recs', title: 'period', rows: pd.boards, cols: [
        { key: 'period', label: 'Board', fmt: (x) => `${MODE[x.mode] || x.mode} ${day(x.period)}` }, { key: 'winners', label: 'Winners', r: true, fmt: (x) => N(x.winners) },
        { key: 'shards', label: 'Shards', r: true, fmt: (x) => N(x.shards) }, { key: 'packs', label: 'Packs', r: true, fmt: (x) => N(x.packs) },
        { key: 'cards', label: 'Cards', r: true, fmt: (x) => N(x.cards) }] })) : null].flat().filter(Boolean));
    const gw = panel('Gauntlet weeks');
    gw.body.append(...[(d.gauntlet_weeks || []).length ? table({ phone: 'recs', title: 'name', rows: d.gauntlet_weeks, cols: [
      { key: 'name', label: 'Gauntlet', fmt: (x) => [x.name, h('div', { class: 'num', style: 'color:var(--text-2);font-size:12px' }, day(x.week)),
        h('div', { style: 'color:var(--text-2);font-size:12px;max-width:260px' }, (x.squad || []).map((c) => c.name).join(', '))] },
      { key: 'runs', label: 'Runs', r: true, fmt: (x) => N(x.runs) }, { key: 'members', label: 'Members', r: true, fmt: (x) => N(x.members) },
      { key: 'cleared', label: 'Cleared', r: true, fmt: (x) => N(x.cleared) },
      { key: 'best', label: 'Best', fmt: (x) => (x.best ? `F${N(x.best.floor)} R${N(x.best.room)}` : '-') },
      { key: 'paid', label: 'Paid', fmt: (x) => (x.paid ? 'yes' : 'no') }] }) : h('div', { class: 'empty' }, 'No Gauntlet week in the range')].flat());
    const cd = panel('Damage per card', { sub: `combat_actions, ${N(d.combat_rows)} rows in the range` });
    cd.body.append(...[(d.card_damage || []).length ? table({ rows: d.card_damage, title: 'name', onRow: (x) => { location.hash = `#/card/${x.card_id}`; }, cols: [
      { key: 'name', label: 'Card', fmt: (x) => [rarityDot(x.rarity), x.name || x.card_id] },
      { key: 'attacks', label: 'Attacks', r: true, fmt: (x) => N(x.attacks) }, { key: 'damage', label: 'Damage', r: true, fmt: (x) => N(x.damage) },
      { key: 'damage_dungeon', label: 'Dungeon', r: true, fmt: (x) => N(x.damage_dungeon) }, { key: 'damage_gauntlet', label: 'Gauntlet', r: true, fmt: (x) => N(x.damage_gauntlet) },
      { key: 'foes_down', label: 'Kills', r: true, fmt: (x) => N(x.foes_down) }, { key: 'crits', label: 'Crits', r: true, fmt: (x) => N(x.crits) },
      { key: 'supports', label: 'Supports', r: true, fmt: (x) => N(x.supports) }, { key: 'healed', label: 'Healed', r: true, fmt: (x) => N(x.healed) },
      { key: 'taken', label: 'Taken', r: true, fmt: (x) => N(x.taken) }, { key: 'downs', label: 'Downs', r: true, fmt: (x) => N(x.downs) }] })
      : h('div', { class: 'empty' }, 'No fight row in the range')].flat());
    const rc = d.reconcile || {}, s = hl.reconcile?.shard || {};
    const cp = panel('Run checks', { sub: rc.log_from ? `Fight log since ${when(rc.log_from, true)}` : 'No fight log' });
    cp.body.append(checkRows([
      { name: 'Run HP = fight log', st: !rc.runs_checked ? 'idle' : rc.ok ? 'pass' : 'fail', detail: `${N(rc.runs_ok)} of ${N(rc.runs_checked)} runs, ${N(rc.hp_unexplained)} HP unexplained` },
      { name: 'Runs before the log', st: 'idle', detail: `${N(rc.runs_before_log)} runs` },
      { name: 'Run Shards = ledger', st: s.runs_shards_mismatched ? 'fail' : 'pass', detail: `${N(s.runs_shards_mismatched)} runs differ of ${N(s.runs)}` },
      { name: 'Run cards = ledger', st: s.runs_cards_mismatched ? 'fail' : 'pass', detail: `${N(s.runs_cards_mismatched)} differ, ${N(s.runs_cards_checked)} checked` },
      { name: 'Ledger rows with no run', st: s.run_rows_without_run ? 'warn' : 'pass', detail: `${N(s.run_rows_without_run)} rows` },
      { name: 'Dungeon refs', st: (hl.refs_missing?.shard_run || 0) + (hl.refs_missing?.card_run || 0) ? 'fail' : 'pass', detail: `${N((hl.refs_missing?.shard_run || 0) + (hl.refs_missing?.card_run || 0))} missing` }]),
      ...(rc.bad_runs || []).length ? [h('div', { class: 'mt' }, table({ phone: 'table', rows: rc.bad_runs, cols: [
        { key: 'run', label: 'Run', fmt: (x) => h('span', { class: 'num' }, x.run) }, { key: 'mode', label: 'Mode', fmt: (x) => MODE[x.mode] || x.mode },
        { key: 'rows', label: 'Rows', r: true, fmt: (x) => N(x.rows) }, { key: 'hp', label: 'HP', r: true, fmt: (x) => N(x.hp) }] }))].flat() : []);
    const dt = d.deaths || {};
    const downs = Object.values(dt.cards_down_at_end || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    return [
      h('div', { class: 'kpis' }, kpi('Runs', N(tot('runs')), `${N(tot('members'))} members`), kpi('Cleared', N(tot('cleared'))), kpi('Fell', N(dt.runs_fell), `${N(downs)} cards down`),
        kpi('Kills', N(d.kills_total)), kpi('Shards paid', N(pd.shards)), kpi('Cards paid', N(pd.cards), `${N(pd.packs)} packs`)),
      h('div', { class: 'cols-ov' }, mp.el, dp.el),
      h('div', { class: 'cols-ov' }, kp.el, rp.el),
      h('div', { class: 'cols-ov' }, pp.el, gw.el),
      h('div', { class: 'cols-ov' }, cd.el, cp.el),
    ];
  });
}

/* ----- Activity: the game feed (admin_feed) ----- */
const FEED_KINDS = {
  admin: ['Admin', 'scroll'], settings: ['Settings', 'cog'], balance: ['Balance', 'scale'], member: ['Member', 'userplus'], pull: ['Big pull', 'sparkles'],
  trade: ['Trade', 'swap'], auction: ['Auction', 'gavel'], hunt: ['Hunt', 'swords'], dungeon: ['Dungeon', 'castle'], effect: ['Effect', 'zap'], report: ['Report', 'flag'],
};
async function pageActivity(main, _, q) {
  const kind = q.get('kind') || 'all';
  main.append(pageHead('Activity', 'The newest events of the whole game'));
  const p = panel(null, { cls: 'tl-panel' });
  main.append(p.el);
  const state = { rows: [], next: null, busy: false };
  const who = (id, name) => (id ? h('a', { href: `#/member/${encodeURIComponent(id)}` }, name || id) : null);
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Kinds' },
    [['all', 'All', null], ...Object.entries(FEED_KINDS).map(([k, [t, ic]]) => [k, t, ic])].map(([k, t, ic]) =>
      h('button', { class: `chip${kind === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(kind === k), onclick: () => { location.hash = k === 'all' ? '#/activity' : `#/activity?kind=${k}`; } },
        kind === k ? icon('check') : ic ? icon(ic) : null, t)));
  const tbody = h('tbody');
  const list = h('div', { class: 'tl-list' });
  const tableEl = h('div', { class: 'tbl-wrap tl-table' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null,
    ['Time', 'Kind', 'Description', 'Member', 'Other'].map((t) => h('th', { scope: 'col' }, t)), h('th', { class: 'r', scope: 'col' }, 'Amount'))), tbody));
  const oldest = h('span', { class: 'num' });
  const more = h('button', { class: 'btn', type: 'button' }, icon('older'), 'Load older');
  const status = h('div');
  const draw = () => {
    tbody.replaceChildren(...state.rows.map((r) => h('tr', null, h('td', { class: 'num' }, when(r.at)), h('td', null, kindTag(r.kind, FEED_KINDS)),
      h('td', null, r.text, r.actor ? h('span', { style: 'color:var(--text-2)' }, ` - ${r.actor}`) : null),
      h('td', null, who(r.player_id, r.username) || '-'), h('td', null, who(r.other_id, r.other_name) || '-'),
      h('td', { class: 'r num' }, isNum(r.amount) ? N(r.amount) : ''))));
    list.replaceChildren(...state.rows.map((r) => h('div', { class: 'tl-item' }, h('div', { class: 'row1' }, kindTag(r.kind, FEED_KINDS), h('span', { class: 'amount' }, isNum(r.amount) ? N(r.amount) : '')),
      h('div', { class: 'desc' }, r.text, r.actor ? ` - ${r.actor}` : ''),
      r.player_id || r.other_id ? h('div', { class: 'desc' }, who(r.player_id, r.username), r.player_id && r.other_id ? ' / ' : null, who(r.other_id, r.other_name)) : null,
      h('div', { class: 'when' }, when(r.at, true)))));
    if (!state.rows.length && !state.busy) list.replaceChildren(h('div', { class: 'empty' }, 'No events'));
    oldest.textContent = state.rows.length ? `Oldest shown: ${when(state.rows.at(-1).at, true)}` : '';
    more.disabled = !state.next || state.busy;
    more.hidden = !state.next;
  };
  const load = async () => {
    state.busy = true; more.disabled = true;
    status.replaceChildren(loadingState());
    try {
      const d = await api(`/feed?${qs({ limit: 50, before: state.next?.before, before_key: state.next?.before_key, kinds: kind === 'all' ? null : kind })}`);
      state.rows.push(...(d.rows || []));
      state.next = d.next || null;
      status.replaceChildren();
    } catch (e) { status.replaceChildren(errorState(e, load)); }
    state.busy = false;
    draw();
  };
  more.addEventListener('click', load);
  p.body.append(chips, tableEl, list, status, h('div', { class: 'tl-foot' }, oldest, more));
  load();
}

/* ----- Reports ----- */
async function pageReports(main, [key], q) {
  main.append(pageHead('Reports', key ? h('span', { class: 'crumb' }, h('a', { href: '#/reports' }, 'Reports'), ' / ', key) : 'Ready-made reports with a CSV download'));
  const box = h('div');
  main.append(box);
  fill(box, async () => {
    const cat = await api('/reports');
    if (!key) {
      return h('div', { class: 'cols-2' }, cat.map((rp) => h('a', { class: 'panel', href: `#/report/${rp.key}`, style: 'text-decoration:none;display:block' },
        h('h2', { style: 'font-size:16px' }, rp.title), h('p', { class: 'note', style: 'margin:6px 0' }, rp.about),
        h('div', { class: 'num', style: 'font-size:12px;color:var(--muted)' }, rp.columns.join(', ')))));
    }
    const rp = cat.find((x) => x.key === key);
    if (!rp) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No report with this key'));
    const params = Object.fromEntries(Object.entries(rp.params || {}).map(([k, v]) => [k, q.has(k) ? q.get(k) : v == null ? '' : String(v)]));
    const inputs = Object.entries(params).map(([k, v]) => {
      const def = rp.params[k];
      return h('label', null, h('span', { class: 'lbl' }, label(k)), h('input', { class: 'field num', name: k, value: v, type: typeof def === 'number' || /^(limit|days|min|hunt|min_pulls)$/.test(k) ? 'number' : 'text',
        placeholder: def == null ? 'newest' : null, style: 'width:120px' }));
    });
    const form = h('form', { class: 'form-row', onsubmit: (ev) => { ev.preventDefault(); const f = new FormData(form); location.hash = `#/report/${key}?${qs(Object.fromEntries(f.entries()))}`; } },
      inputs, h('button', { class: 'btn primary', type: 'submit' }, 'Run'),
      h('a', { class: 'btn', href: `/api/admin/report/${key}.csv?${qs(params)}`, download: '' }, icon('download'), 'CSV'));
    const p = panel(rp.title, { sub: rp.about });
    p.body.append(form);
    const out = h('div');
    p.body.append(out);
    fill(out, async () => {
      const d = await api(`/report/${key}?${qs(params)}`);
      const memberCol = d.columns.includes('player_id');
      return [h('div', { class: 'num', style: 'font-size:12px;color:var(--text-2);margin-bottom:8px' }, `${N(d.row_count)} rows`),
        d.rows.length ? table({ rows: d.rows, title: d.columns.includes('username') ? 'username' : d.columns[0],
          onRow: memberCol ? (x) => { location.hash = `#/member/${encodeURIComponent(x.player_id)}`; } : null,
          cols: d.columns.map((c) => ({ key: c, label: label(c), r: d.rows.some((x) => typeof x[c] === 'number') })) }) : h('div', { class: 'empty' }, 'No rows')];
    });
    return p.el;
  });
}

/* ----- Data (read-only table browser) ----- */
let tableCache = null;
async function pageData(main, [name], q) {
  main.append(pageHead('Data', 'Every documented table, read only, 50 rows a page'));
  const wrap = h('div', { class: 'cols-data' });
  main.append(wrap);
  const left = panel('Tables');
  const right = h('div', { class: 'stack' });
  wrap.append(left.el, right);
  const filter = h('input', { class: 'field', type: 'search', placeholder: 'Filter', 'aria-label': 'Filter tables', style: 'width:100%' });
  const list = h('div', { class: 'tlist' });
  left.body.append(filter, list);
  fill(list, async () => {
    tableCache ||= (await api('/tables')).tables;
    const draw = () => {
      const f = filter.value.trim().toLowerCase();
      const groups = {};
      for (const t of tableCache) if (!f || t.name.includes(f)) (groups[t.group] ||= []).push(t);
      list.replaceChildren(...Object.entries(groups).flatMap(([g, ts]) => [h('div', { class: 'grp' }, g),
        ...ts.map((t) => h('button', { type: 'button', class: t.name === name ? 'on' : null, onclick: () => { location.hash = `#/data/${t.name}`; } }, t.name))]));
    };
    filter.addEventListener('input', draw);
    draw();
    return [...list.childNodes];
  });
  if (!name) { right.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'Pick a table'))); return; }
  const offset = Math.max(0, Number(q.get('offset')) || 0), key = q.get('key');
  const info = panel(name);
  const rows = panel(key ? `Row ${key}` : 'Rows', { right: key ? h('a', { class: 'btn', href: `#/data/${name}` }, 'All rows') : null });
  right.append(info.el, rows.el);
  fill(info.body, async () => {
    tableCache ||= (await api('/tables')).tables;
    const t = tableCache.find((x) => x.name === name);
    if (!t) throw new Error('Not a documented table');
    info.setSub(`${t.group}. Primary key: ${t.pk.join(', ') || 'none'}`);
    return [h('p', { class: 'note' }, t.note), h('details', { class: 'cols' }, h('summary', null, `${t.columns.length} columns`),
      table({ rows: t.columns, title: 'name', cols: [{ key: 'name', label: 'Column', fmt: (c) => h('span', { class: 'num' }, c.name) }, { key: 'type', label: 'Type' }, { key: 'comment', label: 'Note' }] }))];
  });
  fill(rows.body, async () => {
    const d = await api(`/table/${encodeURIComponent(name)}?${qs({ offset, key })}`);
    if (!d.rows.length) return h('div', { class: 'empty' }, 'No rows');
    const cols = (d.columns.length ? d.columns : Object.keys(d.rows[0])).map((c) => ({ key: c, label: c, r: d.rows.some((x) => typeof x[c] === 'number'),
      cls: d.rows.some((x) => x[c] && typeof x[c] === 'object') ? 'json' : null }));
    return [table({ rows: d.rows, cols, title: d.pk[0] || cols[0].key }),
      key ? null : pager(d.offset, d.rows.length, d.total_estimate, (pg) => { location.hash = `#/data/${name}?offset=${pg * d.limit}`; }, d.limit)];
  });
}

/* ----- Health ----- */
async function pageHealth(main) {
  main.append(pageHead('Health', 'Ledger checks, queues, cron jobs and sizes'));
  const box = h('div');
  main.append(box);
  fill(box, async () => {
    const hl = await api('/health');
    const checks = healthChecks(hl);
    const pass = checks.filter((c) => c.st === 'pass').length, fail = checks.filter((c) => c.st === 'fail').length;
    const cp = panel('Checks', { sub: `Run ${when(hl.at, true)} on ${session.source || 'LIVE'}` });
    cp.body.append(checkRows(checks));
    const rc = hl.reconcile || {};
    const lp = panel('Ledgers');
    lp.body.append(...[table({ phone: 'recs', title: 'ledger', rows: ['pack', 'shard', 'card'].map((k) => ({ ledger: k, ...rc[k] })), cols: [
      { key: 'ledger', label: 'Ledger', fmt: (x) => `${x.ledger}_ledger` },
      { key: 'ok', label: 'Status', fmt: (x) => (x.ok ? statusTag('pass', 'Pass') : statusTag('fail', 'Fail')) },
      { key: 'rows', label: 'Rows', r: true, fmt: (x) => N(x.rows) },
      { key: 'players', label: 'Members', r: true, fmt: (x) => N(x.players) },
      { key: 'mismatched', label: 'Differ', r: true, fmt: (x) => N(x.mismatched ?? x.players_mismatched) }] })].flat());
    const qp = panel('Queues');
    qp.body.append(...[table({ phone: 'table', rows: Object.entries(hl.queues || {}).map(([k, v]) => ({ k, v })), cols: [
      { key: 'k', label: 'Queue', fmt: (x) => label(x.k) }, { key: 'v', label: 'Now', r: true, fmt: (x) => (x.k.includes('oldest') ? (x.v ? when(x.v, true) : '-') : N(x.v)) }] })].flat());
    const rf = panel('Ledger refs');
    rf.body.append(...[table({ phone: 'table', rows: [...Object.entries(hl.refs_missing || {}).map(([k, v]) => ({ k: `Missing: ${k.replace('_', ' ')}`, v })),
      ...Object.entries(hl.rows_without_ref || {}).map(([k, v]) => ({ k: `No ref: ${k}`, v }))], cols: [
      { key: 'k', label: 'Check' }, { key: 'v', label: 'Rows', r: true, fmt: (x) => h('span', { style: x.v ? 'color:var(--danger-text)' : null }, N(x.v)) }] })].flat());
    const hp = panel('Hunt damage');
    hp.body.append(...[table({ phone: 'recs', title: 'hunt', rows: hl.hunts || [], onRow: (x) => { location.hash = `#/hunt/${x.hunt}`; }, cols: [
      { key: 'hunt', label: 'Hunt', fmt: (x) => h('span', { class: 'num' }, x.hunt) }, { key: 'status', label: 'Status', fmt: (x) => label(x.status) },
      { key: 'members', label: 'Members', r: true, fmt: (x) => N(x.members) }, { key: 'members_unexplained', label: 'Unexplained', r: true, fmt: (x) => N(x.members_unexplained) }] })].flat());
    const cr = panel('Cron jobs');
    cr.body.append(...[hl.cron == null ? h('div', { class: 'empty' }, 'pg_cron absent') : !hl.cron.length ? h('div', { class: 'empty' }, 'No cron job') : table({ title: 'job', rows: hl.cron, cols: [
      { key: 'job', label: 'Job', fmt: (x) => h('span', { class: 'num' }, x.job) }, { key: 'schedule', label: 'Schedule', fmt: (x) => h('span', { class: 'num' }, x.schedule) },
      { key: 'active', label: 'On', fmt: (x) => (x.active ? 'yes' : 'no') },
      { key: 'last_status', label: 'Last run', fmt: (x) => (x.last_status === 'succeeded' ? statusTag('pass', 'Succeeded') : x.last_status ? statusTag('fail', label(x.last_status)) : '-') },
      { key: 'last_start', label: 'Started', fmt: (x) => h('span', { class: 'num' }, when(x.last_start, true)) },
      { key: 'failed_7d', label: 'Failed 7d', r: true, fmt: (x) => N(x.failed_7d) }] })].flat());
    const sz = panel('Largest tables', { sub: `Database ${bytes(hl.database_bytes)}` });
    sz.body.append(hbars((hl.tables || []).map((t) => ({ label: t.table, value: t.bytes, max: hl.tables[0]?.bytes || 1 })), { fmt: bytes, pct: false, color: 'var(--edge)' }));
    const mg = panel('Last migrations');
    mg.body.append(...[table({ title: 'file', rows: hl.migrations_last || [], cols: [{ key: 'file', label: 'File', fmt: (x) => h('span', { class: 'num' }, x.file) },
      { key: 'applied_at', label: 'Applied', r: true, fmt: (x) => when(x.applied_at, true) }] })].flat());
    const bl = panel('Last balance changes');
    bl.body.append(...[table({ phone: 'recs', title: 'key', rows: hl.balance_last || [], cols: [{ key: 'key', label: 'Key', fmt: (x) => h('span', { class: 'num' }, x.key) },
      { key: 'op', label: 'Change' }, { key: 'by', label: 'By' }, { key: 'at', label: 'When', fmt: (x) => when(x.at, true) }] })].flat());
    return [
      h('div', { class: 'kpis' }, kpi('Checks', `${pass} pass`, fail ? statusTag('fail', `${fail} fail`) : statusTag('pass', 'No fail')), kpi('Database', bytes(hl.database_bytes)),
        kpi('Discord effects', N(hl.queues?.discord_effects_pending), h('span', null, `pending, ${N(hl.queues?.discord_effects_failed_7d)} failed 7d`)),
        kpi('Last migration', hl.migrations_last?.[0]?.file || '-', when(hl.migrations_last?.[0]?.applied_at, true)),
        kpi('Last balance change', hl.balance_last?.[0]?.key || '-', when(hl.balance_last?.[0]?.at, true)),
        kpi('Cron jobs', hl.cron == null ? '-' : N(hl.cron.length), hl.cron == null ? 'pg_cron absent' : `${N(hl.cron.filter((j) => j.failed_7d > 0).length)} with failures`)),
      h('div', { class: 'cols-ov' }, cp.el, lp.el),
      h('div', { class: 'cols-3', style: 'margin-bottom:16px' }, qp.el, rf.el, hp.el),
      h('div', { class: 'cols-ov' }, cr.el, sz.el),
      h('div', { class: 'cols-ov' }, mg.el, bl.el),
    ];
  });
}

/* ---------- router ---------- */
const ROUTES = [
  [/^\/overview$/, pageOverview], [/^\/members$/, pageMembers], [/^\/member\/([^/]+)$/, pageMember], [/^\/economy$/, pageEconomy], [/^\/growth$/, pageGrowth],
  [/^\/cards$/, pageCards], [/^\/card\/(\d+)$/, pageCard], [/^\/hunt$/, pageHunts], [/^\/hunt\/(\d+)$/, pageHunt], [/^\/dungeon$/, pageDungeon],
  [/^\/activity$/, pageActivity], [/^\/reports$/, pageReports],
  [/^\/report\/([a-z0-9_]+)$/, pageReports], [/^\/data$/, pageData], [/^\/data\/([a-z0-9_]+)$/, pageData], [/^\/health$/, pageHealth],
];
function render() {
  const raw = location.hash.replace(/^#/, '') || '/overview';
  const [path, query] = raw.split('?');
  const main = document.getElementById('main');
  drawNav(path);
  document.getElementById('more-sheet').hidden = true;
  document.getElementById('sheet-back').hidden = true;
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) {
      main.replaceChildren();
      window.scrollTo(0, 0);
      const navItem = [...NAV, ...(ED.state.on ? ED.nav : [])].find((n) => navActive(n, path));
      document.title = `${navItem ? navItem.label : 'Admin'} - Lion Pride TCG Admin`;
      fn(main, m.slice(1).map(decodeURIComponent), new URLSearchParams(query || ''));
      return;
    }
  }
  location.replace('#/overview');
}

async function start() {
  for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(icon(el.dataset.icon));
  lastRefresh.el = document.getElementById('refresh-at');
  setupSearch();
  document.getElementById('refresh').addEventListener('click', render);
  try {
    const s = await api('/source');
    session = { ...session, ...s };
  } catch (e) {
    session.error = e.message;
  }
  if (await ED.init()) ROUTES.push(...ED.routes);
  const badge = document.getElementById('source');
  document.getElementById('source-text').textContent = session.source || '?';
  badge.classList.toggle('local', session.source === 'LOCAL');
  badge.title = session.source === 'LOCAL' ? 'The local copy (LOCALDB=1)' : 'The live database';
  window.addEventListener('hashchange', render);
  render();
}
start();
