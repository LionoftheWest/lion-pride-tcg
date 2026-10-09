// UI-66 the Leaderboard window (lion-pride-tcg-design UI-66/approved, review-1; D-44). Only under body.ui-v3
// (settings.ui_v3): one window with 4 tabs (Main, Hunt, Dungeon, Gauntlet) replaces the Leaderboard view (UI-22), the
// Hunt standings pop-up (UI-21) and the Dungeon / Gauntlet boards (UI-51, UI-52). With the flag off nothing here runs.
// - The data: the same 4 APIs as v2 (GET /api/leaderboard/v2, /api/hunt/leaderboard, /api/dungeon/board,
//   /api/gauntlet/board). This module keeps no copy of a number: it ranks and pages what the server sends.
// - Every entry point opens this one window on its tab: Menu > Leaderboard (Main), the Hunt board button (Hunt), the
//   Dungeon and Gauntlet "See the leaderboard" buttons (Dungeon, Gauntlet).
// - Lists page "1 / N" (D-36, 3.4): the page size is the one number this module measures (3.5): the rows that fit the
//   list box of the element itself (and the columns that fit, on the Hunt tab). Nothing scrolls.
// - A sheet on compact-port and compact-land, a centered dialog on medium and expanded (public/ui3/90-ui-66.css).
import { esc, iconButton, subTabs, segmented, pager, progressLinear, inlineMessage } from './components.js';
import { icon } from './icons.js';
import { fmtFor } from './number.js';

export const TABS = [
  { id: 'main', label: 'Main', icon: 'trophy' },
  { id: 'hunt', label: 'Hunt', icon: 'swords' },
  { id: 'dungeon', label: 'Dungeon', icon: 'castle' },
  { id: 'gauntlet', label: 'Gauntlet', icon: 'crown' },
];
// The 5 boards of the Main tab: the name, the short column name (a phone), the line icon (5.2 Icon, D-50).
export const METRICS = [
  { key: 'power', label: 'Collection Power', col: 'Power', icon: 'zap' },
  { key: 'huntDamage', label: 'Hunt damage', col: 'Hunt dmg', icon: 'swords' },
  { key: 'bosses', label: 'Bosses downed', col: 'Bosses', icon: 'skull' },
  { key: 'cards', label: 'Cards', col: 'Cards', icon: 'layers' },
  { key: 'achievements', label: 'Achievements', col: 'Ach.', icon: 'award' },
];
export const TOP = 10;   // "the most it can show is the top 10" (Nathan, 2026-10-01): podium 1-3, table 4-10
export const ERROR_TEXT = 'The leaderboard is not available.';
const ENDPOINT = { main: '/api/leaderboard/v2', hunt: '/api/hunt/leaderboard', dungeon: '/api/dungeon/board', gauntlet: '/api/gauntlet/board' };

// ---- Pure rules (tested in leaderboard.test.js) ----
/** The rows from best to worst on one board; a tie sorts by name (as the v2 board). */
export const ranked = (rows, key) => [...(rows || [])].sort((a, b) => (b[key] || 0) - (a[key] || 0) || String(a.name).localeCompare(String(b.name)));

/** The page size of a list (3.4): the columns that fit, times the rows that fit the height (a gap between rows). */
export function pageFit({ count, height, rowH, gap = 0, cols = 1 }) {
  const rows = Math.max(1, Math.floor((height + gap) / Math.max(1, rowH + gap)));
  const pageSize = Math.max(1, cols * rows);
  return { cols: Math.max(1, cols), rows, pageSize, pages: Math.max(1, Math.ceil(Math.max(0, count) / pageSize)) };
}

/** Pages for rows of different heights (a Dungeon row with a long status line is taller): the rows that fit one page, in order.
 *  Every page holds at least one row. Returns [{ start, end }]. */
export function packPages(heights, height, gap = 0) {
  const pages = [];
  let start = 0, used = 0;
  heights.forEach((h, i) => {
    const need = i > start ? gap + h : h;
    if (i > start && used + need > height) { pages.push({ start, end: i }); start = i; used = h; } else used += need;
  });
  if (heights.length) pages.push({ start, end: heights.length });
  return pages.length ? pages : [{ start: 0, end: 0 }];
}

/** Is the answer of a tab usable? An error answer never shows as an empty list (G-083). */
export function tabState(tab, d) {
  if (!d || d.error) return 'error';
  if (tab === 'main') return Array.isArray(d.rows) ? 'ok' : 'error';
  if (tab === 'hunt') return !Array.isArray(d.leaders) ? 'error' : d.leaders.length ? 'ok' : 'empty';
  return !Array.isArray(d.board) ? 'error' : d.board.length ? 'ok' : 'empty';
}

/** My place on every board of the Main tab (the stat tiles). */
export const myRanks = (rows, me) => Object.fromEntries(METRICS.map((m) => [m.key, ranked(rows, m.key).findIndex((r) => r.id === me)]));

/** The "To #N" line: the gap to the member above me, and how far to the next place (percent). */
export function toNext(rows, me, key) {
  const list = ranked(rows, key);
  const i = list.findIndex((r) => r.id === me);
  if (i < 0) return { i, above: null, gap: 0, pct: 100 };
  const above = i > 0 ? list[i - 1] : null;
  const gap = above ? (above[key] || 0) - (list[i][key] || 0) : 0;
  return { i, above, gap, pct: above && above[key] ? Math.round((100 * (list[i][key] || 0)) / above[key]) : 100 };
}

/** The second line of a Dungeon or Gauntlet row (D2: a phone shows it too). */
export const runLine = (b, gauntlet, f = (n) => String(n)) => `${f(b.turns)} turns${gauntlet ? ` · ${b.runs} run${b.runs === 1 ? '' : 's'}` : ''}${b.status === 'active' ? ' · in the dungeon' : ''}`;

// ---- State ----
let deps = null;    // { api, user, avatarHTML, nameBadge, openMember }
let st = null;      // { tab, metric, page, data: {tab: answer}, load: {tab: 'busy'|'done'}, size }
let opener = null;
let ro = null;
let fitT = null;
const $ = (id) => document.getElementById(id);
const px = (v) => parseFloat(v) || 0;
const size = () => document.body.dataset.size || 'expanded';
const num = (n) => fmtFor(n, size());

export function initLeaderboardWindow(d) { deps = d; }
export const isOpen = () => !!$('u3LbHost');

// ---- Markup ----
const av = (id, name, frame, cls) => deps.avatarHTML(id, name, '', frame).replace('class="v2-avatar ', `class="v2-avatar ${cls} `);
const place = (n) => `<span class="u3-lb-place u3-lb-place--${n}">${n}</span>`;
const youChip = '<span class="u3-lb-you">You</span>';
const titleChip = (t) => (t ? `<span class="u3-lb-title">${esc(t)}</span>` : '');
const shortNames = () => size() === 'compact-port' || !!st?.short;   // a phone, or a switch row that did not fit with the full names (measured)
const val = (r, m, d) => (m.key === 'cards' ? `${num(r.cards)}/${num(d.totalCards)}` : m.key === 'achievements' ? `${r.achievements}/${d.achievementCount}` : num(r[m.key]));

function headHTML() {
  const tabs = subTabs(TABS.map((t) => ({ ...t, active: t.id === st.tab })));
  return `<header class="u3-lb__top"><h2 class="u3-lb__title" id="u3LbT">Leaderboard</h2>${tabs}`
    + `<span class="u3-lb__x" data-lb-close>${iconButton({ icon: 'x', label: 'Close' })}</span></header>`;
}

function podiumHTML(rows, d) {
  const m = METRICS.find((x) => x.key === st.metric);
  const tile = (r, n) => {
    if (!r) return `<div class="u3-lb-pod u3-lb-pod--${n} is-empty"></div>`;
    const sub = `<span class="u3-lb-pod__sub">${icon('swords', { size: 'sm' })}${num(r.huntDamage)}<i>·</i>${icon('skull', { size: 'sm' })}${r.bosses}<i>·</i>${icon('layers', { size: 'sm' })}${r.cards}</span>`;
    return `<button type="button" class="u3-lb-pod u3-lb-pod--${n}${r.id === d.me ? ' is-me' : ''}" data-member="${esc(r.id)}">`
      + `<span class="u3-lb-pod__face">${av(r.id, r.name, r.frame, 'u3-lb-av u3-lb-av--pod')}${place(n)}</span>`
      + `<span class="u3-lb-pod__who"><b class="u3-lb-nm">${deps.nameBadge(r.id, r.name, true)}</b>${titleChip(r.title)}</span>`
      + `<span class="u3-lb-pod__val">${icon(m.icon, { size: 'xl' })}<b>${val(r, m, d)}</b></span>${sub}</button>`;
  };
  return `<div class="u3-lb-podium">${[rows[1], rows[0], rows[2]].map((r, i) => tile(r, [2, 1, 3][i])).join('')}</div>`;
}

function meHTML(rows, d) {
  const m = METRICS.find((x) => x.key === st.metric);
  const me = rows.find((r) => r.id === d.me);
  const name = me?.name || deps.user()?.name || '';
  const ranks = myRanks(rows, d.me);
  const nx = toNext(rows, d.me, m.key);
  const to = nx.above
    ? `<div class="u3-lb-toline"><div class="u3-lb-to"><span>To #${nx.i}</span><b>${num(nx.gap)}</b></div>${progressLinear({ value: nx.pct / 100, label: `To #${nx.i}` })}</div>`
    : nx.i === 0 ? '<div class="u3-lb-to"><span>You lead this board</span></div>' : '';
  const tiles = METRICS.map((x) => `<div class="u3-lb-st${x.key === m.key ? ' is-on' : ''}"><span class="u3-lb-st__top"><b>${me ? val(me, x, d) : '—'}</b>`
    + `<span>${ranks[x.key] >= 0 ? `#${ranks[x.key] + 1}` : '—'}</span></span><span class="u3-lb-st__k">${icon(x.icon)}<span>${esc(x.label)}</span></span></div>`).join('');
  return `<section class="u3-lb-me" aria-label="Your rank"><div class="u3-lb-me__id">${av(d.me, name, me?.frame, 'u3-lb-av u3-lb-av--me')}`
    + `<div class="u3-lb-me__who"><h3>${esc(name)}</h3><span>${esc(m.label)}</span></div><b class="u3-lb-me__rank">${nx.i >= 0 ? `#${nx.i + 1}` : '—'}</b></div>${to}`
    + `<div class="u3-lb-tiles">${tiles}</div></section>`;
}

function huntTileHTML(d) {
  const live = d.live;
  const head = `<h3 class="u3-lb-hunt__h">${icon('swords', { size: 'xl' })}<span>The Hunt</span></h3>`;
  if (!live) return `<section class="u3-lb-hunt u3-lb-hunt--idle">${head}<p class="u3-lb-hunt__none">No boss is live.</p></section>`;
  const leaders = live.leaders || [];
  const meIdx = leaders.findIndex((x) => String(x.player_id) === d.me);
  const lrow = (x, i) => `<li class="u3-lb-live${String(x.player_id) === d.me ? ' is-me' : ''}"><span class="u3-lb-live__i">${i + 1}</span>`
    + `<b>${deps.nameBadge(x.player_id, x.username, true)}</b><span class="u3-lb-live__d">${num(x.damage)}</span></li>`;
  const rows = leaders.slice(0, 4).map(lrow).join('') + (meIdx >= 4 ? lrow(leaders[meIdx], meIdx) : '');
  return `<section class="u3-lb-hunt">${head}<p class="u3-lb-hunt__boss"><b>${esc(live.name)}</b><span class="u3-lb-livechip">LIVE</span></p>`
    + `<span class="u3-label">Top damage</span><ol class="u3-lb-lives">${rows || '<li class="u3-lb-hunt__none">No attacks yet.</li>'}</ol></section>`;
}

function rowHTML(r, i, d) {
  const cols = METRICS.map((m) => `<span class="u3-lb-c${m.key === st.metric ? ' is-on' : ''}" data-m="${m.key}">${val(r, m, d)}</span>`).join('');
  return `<div class="u3-lb-row${r.id === d.me ? ' is-me' : ''}" role="button" tabindex="0" data-member="${esc(r.id)}"><span class="u3-lb-i">${i + 1}</span>`
    + `<span class="u3-lb-p">${av(r.id, r.name, r.frame, 'u3-lb-av u3-lb-av--row')}<span class="u3-lb-who"><b class="u3-lb-nm">${deps.nameBadge(r.id, r.name, true)}</b> ${titleChip(r.title)} ${r.id === d.me ? youChip : ''}</span></span>${cols}</div>`;
}

function mainHTML(d) {
  const rows = ranked(d.rows, st.metric);
  const m = METRICS.find((x) => x.key === st.metric);
  const seg = segmented(METRICS.map((x) => ({ id: x.key, icon: x.icon, label: shortNames() ? x.col : x.label, active: x.key === st.metric })), { label: 'Board' });
  const th = `<div class="u3-lb-row u3-lb-th"><span class="u3-lb-i">#</span><span class="u3-lb-p">Player</span>${METRICS.map((x) => `<span class="u3-lb-c${x.key === m.key ? ' is-on' : ''}" data-m="${x.key}">${x.key === m.key ? '<i class="u3-lb-sort" aria-hidden="true">▾</i>' : ''}${esc(x.col)}</span>`).join('')}</div>`;
  const meIdx = rows.findIndex((r) => r.id === d.me);
  const pin = meIdx >= TOP ? `<div class="u3-lb-pin">${rowHTML(rows[meIdx], meIdx, d)}</div>` : '';
  return `<div class="u3-lb-main${st.flat ? ' is-flat' : ''}" data-metric="${esc(st.metric)}"><div class="u3-lb-segrow">${seg}</div>`
    + `<div class="u3-lb-side">${meHTML(d.rows, d)}${huntTileHTML(d)}</div>${st.flat ? '' : podiumHTML(rows, d)}`
    + `<div class="u3-lb-table">${th}<div class="u3-lb-rows" data-lb-list></div>${pin}</div><div class="u3-lb-pager" data-lb-pager></div></div>`;
}

const medal = (n) => (n <= 3 ? place(n) : `<span class="u3-lb-rk">${n}</span>`);
function huntRow(p, i, d) {
  return `<li class="u3-lb-hr${String(p.player_id) === String(d.me) ? ' is-me' : ''}"><span class="u3-lb-hr__rk">${medal(i + 1)}</span>`
    + `<span class="u3-lb-hr__nm">${deps.nameBadge(p.player_id, p.username, true)}</span><span class="u3-lb-hr__d">${icon('swords')}<b>${num(p.damage)}</b></span></li>`;
}
function runRow(b, d, gauntlet) {
  const mine = String(b.player_id) === String(d.me);
  return `<li class="u3-lb-dr${mine ? ' is-me' : ''}"><span class="u3-lb-dr__rk">${b.rank}</span><b class="u3-lb-dr__nm">${deps.nameBadge(b.player_id, b.username || 'Member', true)}</b>`
    + `<span class="u3-lb-dr__f">${b.floor}F Room ${b.room}</span><span class="u3-lb-dr__t">${esc(runLine(b, gauntlet, num))}</span></li>`;
}

function listTabHTML(tab, d, state) {
  const gauntlet = tab === 'gauntlet';
  const head = tab === 'hunt' ? '' : `<h3 class="u3-lb-lh">${icon('trophy', { size: '2xl' })}<span>${gauntlet ? 'This week\'s leaderboard' : 'Today\'s leaderboard'}</span></h3>`;
  const body = state === 'error' ? `<div class="u3-lb-msg u3-lb-msg--error">${inlineMessage({ kind: 'error', text: ERROR_TEXT })}</div>`
    : state === 'empty' ? `<p class="u3-lb-msg u3-lb-none">${tab === 'hunt' ? 'No damage dealt yet.' : gauntlet ? 'No runs yet this week.' : 'No runs yet today.'}</p>`
      : `<ol class="u3-lb-list u3-lb-list--${tab}" data-lb-list></ol>`;
  return `<div class="u3-lb-lt u3-lb-lt--${tab}">${head}<div class="u3-lb-lbox">${body}</div><div class="u3-lb-pager" data-lb-pager></div></div>`;
}

function panelHTML() {
  const tab = st.tab;
  if (st.load[tab] === 'busy') return `<div class="u3-lb-load" aria-busy="true" aria-label="Loading">${'<span class="u3-lb-ph"></span>'.repeat(5)}</div>`;
  const d = st.data[tab];
  const state = tabState(tab, d);
  if (tab === 'main') return state === 'ok' ? mainHTML(d) : `<p class="u3-lb-merr">${ERROR_TEXT}</p>`;
  return listTabHTML(tab, d, state);
}

// ---- Paint and fit ----
function paint() {
  const win = $('u3Lb');
  if (!win) return;
  win.dataset.lbtab = st.tab;
  win.querySelector('.u3-lb__panel').innerHTML = panelHTML();
  paintPager(win, 1, false);   // the pager has its place before the list is measured (its height is not in the list box)
  win.querySelectorAll('.u3-subtabs [data-tab]').forEach((b) => { const on = b.dataset.tab === st.tab; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
  fit();
}

function paintPager(win, pages, disabled) {
  const box = win.querySelector('[data-lb-pager]');
  if (box) box.innerHTML = pager({ page: Math.min(st.page, pages), pages, disabled });
}

// The page size is the one measured number (3.5). Pass 1 draws one row, so the row height is the real one; then the
// list box (flex: 1, min-height 0: its size does not depend on its rows) gives the rows that fit.
function fitList(win, items, render, { gridCols = false, variable = false, onProbe = null } = {}) {
  const list = win.querySelector('[data-lb-list]');
  const pagerBox = win.querySelector('[data-lb-pager]');
  if (!list) { if (pagerBox) paintPager(win, 1, false); return { pageSize: items.length, pages: 1, rows: items.length }; }
  const area = list.classList.contains('u3-lb-rows') ? list : list.parentElement;   // the box whose size does not depend on its rows
  // Pass 1 draws every row: the tallest row (a long name, a long status line) sets the one row height, so every page fits.
  list.classList.add('is-probe');
  list.style.removeProperty('--lb-rowh');
  list.innerHTML = items.map((x, i) => render(x, i)).join('');
  if (onProbe) onProbe();
  const css = getComputedStyle(list);
  const heights = [...list.children].map((k) => k.getBoundingClientRect().height);
  const rowH = Math.ceil(Math.max(0, ...heights));
  const gap = px(css.rowGap);
  const cols = gridCols ? Math.max(1, css.gridTemplateColumns.split(' ').filter(Boolean).length) : 1;
  const height = Math.floor(area.getBoundingClientRect().height);
  list.classList.remove('is-probe');
  if (variable) {   // one column of rows with their own heights: the pages are packed by the measured heights
    const pages = packPages(heights, height, gap);
    st.page = Math.min(Math.max(1, st.page), pages.length);
    const pg = pages[st.page - 1];
    list.innerHTML = items.slice(pg.start, pg.end).map((x, i) => render(x, pg.start + i)).join('');
    paintPager(win, pages.length, false);
    return { pageSize: pg.end - pg.start, pages: pages.length, rows: pg.end - pg.start };
  }
  const f = pageFit({ count: items.length, height, rowH, gap, cols });
  st.page = Math.min(Math.max(1, st.page), f.pages);
  list.style.setProperty('--lb-cols', String(f.cols));
  list.style.setProperty('--lb-rows', String(f.rows));
  list.style.setProperty('--lb-rowh', `${rowH}px`);
  const start = (st.page - 1) * f.pageSize;
  list.innerHTML = items.slice(start, start + f.pageSize).map((x, i) => render(x, start + i)).join('');
  paintPager(win, f.pages, false);
  return f;
}

// The board columns of the table (a measured mode): each column is as wide as its widest cell (head, rows, pinned row), in px;
// the open board alone when all of them do not fit the row.
function fitCols(win) {
  const table = win.querySelector('.u3-lb-table');
  if (!table) return;
  table.classList.remove('is-narrow');
  METRICS.forEach((m, i) => table.style.setProperty(`--lb-w${i}`, 'max-content'));
  const w = METRICS.map((m) => Math.ceil(Math.max(0, ...[...table.querySelectorAll(`.u3-lb-c[data-m="${m.key}"]`)].map((e) => e.getBoundingClientRect().width))));
  w.forEach((x, i) => table.style.setProperty(`--lb-w${i}`, `${x}px`));
  table.style.setProperty('--lb-wa', `${w[METRICS.findIndex((m) => m.key === st.metric)]}px`);
  const th = table.querySelector('.u3-lb-th');
  table.classList.toggle('is-narrow', th.scrollWidth > th.clientWidth + 1);
}

function fit() {
  const win = $('u3Lb');
  if (!win || !st) return;
  const panel = win.querySelector('.u3-lb__panel');
  // The layout of a wide class comes from the window box itself (2.1, F-1): a window taller than wide stacks.
  const box = win.getBoundingClientRect();
  win.dataset.lay = box.height > box.width ? 'tall' : 'wide';
  // compact-land puts the tabs beside the title; when they do not fit there (a narrow frame), they go under it (measured).
  win.classList.remove('is-stack');
  const strip = win.querySelector('.u3-subtabs__strip');
  if (strip && strip.scrollWidth > strip.clientWidth + 1) win.classList.add('is-stack');
  const tab = st.tab;
  if (tab !== 'main') win.classList.remove('is-tight');   // the tight spacing belongs to the Main tab
  if (st.load[tab] === 'busy') return;
  const d = st.data[tab];
  const state = tabState(tab, d);
  if (tab === 'main') {
    if (state !== 'ok') return;
    const rows = ranked(d.rows, st.metric);
    // The switch row: the short names when the full names do not fit it (measured).
    const sg = panel.querySelector('.u3-seg');
    if (sg && !st.short && sg.scrollWidth > sg.clientWidth + 1) { st.short = true; paint(); return; }
    // The flat mode (below): the podium is not drawn, ranks 1 to 10 are table rows.
    const first = st.flat ? 0 : 3;
    const rest = rows.slice(first, TOP);
    const list = panel.querySelector('[data-lb-list]');
    if (!rest.length) { list.innerHTML = '<p class="u3-lb-none">More players show here once they open packs.</p>'; paintPager(win, 1, false); return; }
    // A short window (a phone with its safe areas): the tight mode takes the spacing down until 3 rows fit (measured).
    win.classList.remove('is-tight');
    let f = fitList(win, rest, (r, i) => rowHTML(r, i + first, d), { variable: true, onProbe: () => fitCols(win) });
    if (f.pageSize < Math.min(3, rest.length)) { win.classList.add('is-tight'); f = fitList(win, rest, (r, i) => rowHTML(r, i + first, d), { variable: true, onProbe: () => fitCols(win) }); }
    // A podium spot whose parts do not fit its box (a long name and two titles in a stacked tile) also ends the podium.
    const podCut = [...panel.querySelectorAll('.u3-lb-pod')].some((p) => p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1);
    if (podCut && !st.flat) { st.flat = true; st.page = 1; paint(); return; }
    // Still short with the tight spacing: the podium becomes table rows (ranks 1 to 10 are paged), so no row is cut.
    if (f.pageSize < Math.min(3, rest.length) && !st.flat) { st.flat = true; st.page = 1; paint(); return; }
    // The live Hunt tile: only the rows that fit (no scroll).
    const side = panel.querySelector('.u3-lb-side');
    const lives = side?.querySelector('.u3-lb-lives');
    while (lives && lives.children.length > 1 && side.scrollHeight > side.clientHeight + 1) lives.removeChild([...lives.children].filter((x) => !x.classList.contains('is-me')).pop() || lives.lastElementChild);
    return;
  }
  if (state !== 'ok') { paintPager(win, 1, false); return; }
  if (tab === 'hunt') fitList(win, d.leaders, (p, i) => huntRow(p, i, d), { gridCols: true });
  else fitList(win, d.board, (b) => runRow(b, d, tab === 'gauntlet'), { variable: true });
}

// A resize or a class change starts the measured modes again (the full names, the podium).
const scheduleFit = () => { clearTimeout(fitT); fitT = setTimeout(() => { if (!isOpen()) return; const w = $('u3Lb').clientWidth; if (st.w !== w) { st.w = w; st.short = false; st.flat = false; if (st.tab === 'main' && st.load.main !== 'busy' && tabState('main', st.data.main) === 'ok') { paint(); return; } } redrawLabels(); fit(); }, 60); };
// A class change swaps the segment names (a phone says "Power", a tablet "Collection Power").
function redrawLabels() {
  const win = $('u3Lb');
  if (!win || st.tab !== 'main' || st.load.main === 'busy') return;
  if (win.dataset.size === size()) return;
  win.dataset.size = size();
  if (tabState('main', st.data.main) === 'ok') paint();
}

// ---- Data ----
async function load(tab) {
  if (st.load[tab] === 'busy') return;
  st.load[tab] = 'busy';
  if (st.tab === tab) paint();
  let d = null;
  try { d = await deps.api(ENDPOINT[tab]); } catch { d = null; }
  if (!isOpen()) return;
  st.data[tab] = d;
  st.load[tab] = 'done';
  if (st.tab === tab) paint();
}

function select(tab) {
  if (!st || !TABS.some((t) => t.id === tab)) return;
  const was = st.tab;
  st.tab = tab;
  st.page = 1;
  if (!st.data[tab]) load(tab); else paint();
  if (was !== tab) $('u3Lb')?.querySelector(`.u3-subtabs [data-tab="${tab}"]`)?.focus();
}

// ---- Events ----
function onClick(e) {
  const host = $('u3LbHost');
  if (e.target === host || e.target.closest('[data-lb-close]')) { closeLeaderboardWindow(); return; }
  const tab = e.target.closest('.u3-subtabs [data-tab]');
  if (tab) { select(tab.dataset.tab); return; }
  const seg = e.target.closest('.u3-seg [data-seg]');
  if (seg) { st.metric = seg.dataset.seg; st.page = 1; paint(); host.querySelector(`.u3-seg [data-seg="${CSS.escape(st.metric)}"]`)?.focus(); return; }
  const pg = e.target.closest('[data-page]');
  if (pg && !pg.disabled) { st.page += pg.dataset.page === 'next' ? 1 : -1; const keep = pg.dataset.page; fit(); host.querySelector(`[data-page="${keep}"]:not(:disabled)`)?.focus(); return; }
  const who = e.target.closest('[data-member]');
  if (who) { const id = who.dataset.member; closeLeaderboardWindow({ restore: false }); deps.openMember(id); }
}
function onKey(e) {
  if (!isOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); closeLeaderboardWindow(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.u3-lb-row[data-member]')) { e.preventDefault(); e.target.click(); return; }
  if (e.key === 'Tab') {   // focus stays in the window (6.2)
    const f = [...$('u3LbHost').querySelectorAll('button:not(:disabled), [role="button"][tabindex="0"]')];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}

/** Open the window on a tab ('main', 'hunt', 'dungeon', 'gauntlet'). A second call while open selects the tab. */
export function openLeaderboardWindow(tab = 'main') {
  if (!deps) return;
  const t = TABS.some((x) => x.id === tab) ? tab : 'main';
  if (isOpen()) { select(t); return; }
  opener = document.activeElement;
  st = { tab: t, metric: 'power', page: 1, data: {}, load: {} };
  const host = document.createElement('div');
  host.id = 'u3LbHost';
  host.className = 'u3-lbhost';
  host.innerHTML = `<section class="u3-lb" id="u3Lb" role="dialog" aria-modal="true" aria-labelledby="u3LbT" data-lbtab="${t}" data-size="${size()}">${headHTML()}<div class="u3-lb__panel"></div></section>`;
  document.body.appendChild(host);
  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', scheduleFit);
  const win = $('u3Lb');
  ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFit) : null;
  ro?.observe(win);
  document.fonts?.ready?.then(() => { if (isOpen()) fit(); });
  host.querySelector('[data-lb-close] button')?.focus();
  load(t);
}

export function closeLeaderboardWindow({ restore = true } = {}) {
  const host = $('u3LbHost');
  if (!host) return;
  ro?.disconnect(); ro = null;
  clearTimeout(fitT);
  host.remove();
  st = null;
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', scheduleFit);
  if (restore) (opener && opener.isConnected ? opener : $('menuBtn'))?.focus?.();
}
