// UI-62 the Events page (lion-pride-tcg-design UI-62/approved, review-2; D-184 to D-188; docs/foundations.md F-1 item 10).
// A month calendar of the scheduled and live events for players. Data: GET /api/events (the one read-only route, src/events-routes.js).
// Opens from the Menu Events tile (shell.js clicks the hidden #eventsBtn that initEventsWindow adds). Only under body.ui-v3 AND
// the flag flags.events (FEATURE_EVENTS / EVENTS_USERS, default OFF): with the flag off no button exists and nothing here runs.
// - The window frame is the UI-66 window (.u3-lbhost, .u3-lb). Layout comes from the size class (2.1): expanded = wide (labelled bars,
//   details in the side column), compact-port = tall (thin bars, the day list under the grid), other classes = short (thin bars,
//   the day list beside the grid). Thin bars: 4 px, no text (D-184). Lists page "1 / N" (3.4). Nothing scrolls.
// - Kind colors and icons (D-186) are existing tokens. The theme color (D-185) is one of the 8 --name-color-* tokens: the server sends
//   a hex, the page finds the token with the same value (no color literal here).
import { esc, iconButton, button, pager, stateEmpty, stateError } from './components.js';
import { icon } from './icons.js';

export const KINDS = {
  hunt: { label: 'Hunt', icon: 'swords', color: 'var(--hunt)' },
  modifier: { label: 'Modifier', icon: 'trending-up', color: 'var(--info)' },
  community: { label: 'Community', icon: 'users', color: 'var(--effect-boon)' },
  dungeon: { label: 'Dungeon', icon: 'castle', color: 'var(--warning)' },
  gauntlet: { label: 'Gauntlet', icon: 'crown', color: 'var(--warning)' },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const ERROR_TEXT = 'Something went wrong. Try again.';

// ---- Pure rules (tested in events.test.js) ----
/** The display kind: the server kind hunt / modifier; a modifier that changes only Dungeon or only Gauntlet variables; every
 *  other server kind (drop, trigger, rank, launch_cards) is a Community event. */
export function kindOf(e) {
  if (e.kind === 'hunt') return 'hunt';
  if (e.kind === 'modifier') {
    const keys = (e.changes || []).map((c) => String(c.key));
    if (keys.length && keys.every((k) => k.startsWith('dungeon_'))) return 'dungeon';
    if (keys.length && keys.every((k) => k.startsWith('gauntlet_'))) return 'gauntlet';
    return 'modifier';
  }
  return 'community';
}
const p2 = (n) => String(n).padStart(2, '0');
/** The local calendar day of a time: "2026-10-04" (the player's zone, D-15). */
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
/** A normalized event: times as numbers, the kind decided once. */
export function norm(raw) {
  return { ...raw, start: Date.parse(raw.starts_at), end: Date.parse(raw.ends_at), k: kindOf(raw), changes: Array.isArray(raw.changes) ? raw.changes : [], theme: raw.theme || {} };
}
/** The days an event covers: its start day to the day of (end - 1 ms). */
export const covers = (e, key) => dayKey(e.start) <= key && key <= dayKey(e.end - 1);
export const isLive = (e, now) => e.start <= now && now < e.end;
/** 6 weeks x 7 days, Sunday first (the Gauntlet week, F-1 table): [{ key, n, out }]. Noon times keep the day safe from a time change. */
export function monthDays(y, m) {
  const first = new Date(y, m - 1, 1, 12);
  return Array.from({ length: 42 }, (_, i) => { const t = new Date(y, m - 1, 1 - first.getDay() + i, 12); return { key: dayKey(t), n: t.getDate(), out: t.getMonth() !== m - 1 }; });
}
/** One lane per event: the lowest free lane in start order (an event keeps its lane across weeks). Returns Map(event -> lane). */
export function lanes(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const taken = []; const lane = new Map();
  for (const e of sorted) { let l = 0; while (taken.some((t) => t.l === l && t.e.start < e.end && e.start < t.e.end)) l++; lane.set(e, l); taken.push({ l, e }); }
  return lane;
}
/** The list of one day: live first by the end time, then by the start. */
export const dayEvents = (events, key, now) => events.filter((e) => covers(e, key))
  .sort((a, b) => (isLive(b, now) - isLive(a, now)) || (isLive(a, now) ? a.end - b.end : a.start - b.start));
/** The event the side column shows first on a wide window: the live event that ends first, else the next to start. */
export function firstEvent(events, now) {
  const live = events.filter((e) => isLive(e, now)).sort((a, b) => a.end - b.end)[0];
  return live || events.filter((e) => e.start > now).sort((a, b) => a.start - b.start)[0] || null;
}
/** Countdown: the two largest units (10.5): "3d 2h", "2h 24m", "45m". */
export function left(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)); const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
const fmt = (t, o) => new Date(t).toLocaleString('en-US', o);
const zone = (t) => fmt(t, { timeZoneName: 'short' }).split(' ').pop();
/** "Fri, Oct 2 · 12:00 AM MDT" */
export const when = (t) => `${fmt(t, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmt(t, { hour: 'numeric', minute: '2-digit' })} ${zone(t)}`;
export const dayTitle = (key) => fmt(new Date(`${key}T12:00:00`), { weekday: 'short', month: 'short', day: 'numeric' });
/** The month has no event on any of its 42 shown days. */
export const monthEmpty = (events, y, m) => { const days = monthDays(y, m).map((d) => d.key); return !events.some((e) => days.some((k) => covers(e, k))); };

// ---- State ----
let deps = null;     // { api }
let st = null;       // { y, m, events, load: 'busy'|'done'|'error', selKey, selId, detail, dayList, page, pages }
let opener = null; let ro = null; let fitT = null; let tick = null;
const HIT = 44;    // the touch target, design.md 9.1 (a number, not a unit literal)
const BAR_H = 20;  // the height of a labelled bar lane (the --ev-bar token, measured in the style below)
const $ = (id) => document.getElementById(id);
const sizeCls = () => document.body.dataset.size || 'expanded';
const layout = () => (sizeCls() === 'expanded' ? 'wide' : sizeCls() === 'compact-port' ? 'tall' : 'short');
export const isOpen = () => !!$('u3EvHost');
const kindVar = (e) => `--k:${KINDS[e.k].color}`;
const kindIcon = (e, size = 'sm') => icon(KINDS[e.k].icon, { size });

/** The theme color token: the server hex equals one of the 8 --name-color-* tokens (D-185); else the kind color. */
function themeVar(e) {
  const hex = String(e.theme.color || '').toLowerCase();
  if (hex && document?.documentElement) {
    const cs = getComputedStyle(document.documentElement);
    for (let i = 1; i <= 8; i++) if (cs.getPropertyValue(`--name-color-${i}`).trim().toLowerCase() === hex) return `var(--name-color-${i})`;
  }
  return KINDS[e.k].color;
}
const artURL = (e) => (e.theme.art && /^\/[^/]/.test(e.theme.art) ? e.theme.art : null);

// ---- Markup ----
function gridHTML(thin) {
  const { y, m, events, selKey, selId } = st;
  const now = Date.now(); const today = dayKey(now);
  const days = monthDays(y, m); const lane = lanes(events);
  const wd = `<div class="ev-wd" aria-hidden="true">${WD.map((w) => `<span class="u3-label">${w}</span>`).join('')}</div>`;
  if (st.load === 'busy') {
    return `<div class="ev-cal${thin ? ' is-thin' : ''}">${wd}<div class="ev-grid" aria-busy="true" aria-label="Loading">${Array.from({ length: 6 }, () => `<div class="ev-week">${Array.from({ length: 7 }, (_, c) => `<span class="ev-ph" style="grid-column:${c + 1}"></span>`).join('')}</div>`).join('')}</div></div>`;
  }
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const wk = days.slice(w * 7, w * 7 + 7);
    const cells = wk.map((dd, c) => {
      const cls = ['ev-day', dd.out && 'is-out', dd.key === today && 'is-today', dd.key === selKey && 'is-sel'].filter(Boolean).join(' ');
      const n = events.filter((e) => covers(e, dd.key)).length;
      // A wide window: the bars are the controls (a bar opens its event, "+N more" opens the day), so a day cell is a plain box and no control sits under a bar.
      if (!thin) return `<div class="${cls}" style="grid-column:${c + 1}"${dd.key === today ? ' aria-current="date"' : ''}><span class="ev-day__n">${dd.n}</span></div>`;
      return `<button type="button" class="${cls}" data-day="${dd.key}" style="grid-column:${c + 1}" aria-label="${esc(`${dayTitle(dd.key)}${n ? `, ${n} event${n === 1 ? '' : 's'}` : ''}`)}"${dd.key === today ? ' aria-current="date"' : ''}><span class="ev-day__n">${dd.n}</span></button>`;
    }).join('');
    const bars = events.filter((e) => wk.some((dd) => covers(e, dd.key))).map((e) => {
      const cols = wk.map((dd, c) => (covers(e, dd.key) ? c : -1)).filter((c) => c >= 0); const s = cols[0], t = cols[cols.length - 1];
      const fromPrev = s === 0 && dayKey(e.start) < wk[0].key; const toNext = t === 6 && dayKey(e.end - 1) > wk[6].key;
      const cls = ['ev-bar', `k-${e.k}`, fromPrev && 'is-from', toNext && 'is-to', e.id === selId && 'is-sel'].filter(Boolean).join(' ');
      const pos = `${kindVar(e)};grid-column:${s + 1} / ${t + 2};grid-row:${lane.get(e) + 2}`;
      // Thin bars (D-184) only mark the days: not controls (a 4 px target); the day list names the events. Labelled bars open their event.
      if (thin) return `<span class="${cls}" style="${pos}" aria-hidden="true"></span>`;
      return `<button type="button" class="${cls}" data-ev="${esc(e.id)}" style="${pos}" aria-label="${esc(`${e.title}, ${KINDS[e.k].label}`)}">${kindIcon(e)}<span class="ev-bar__t">${esc(e.title)}</span></button>`;
    }).join('');
    weeks.push(`<div class="ev-week">${cells}<div class="ev-lanes">${bars}</div></div>`);
  }
  return `<div class="ev-cal${thin ? ' is-thin' : ''}">${wd}<div class="ev-grid">${weeks.join('')}</div></div>`;
}

function statusHTML(e, now) {
  if (isLive(e, now)) return `<span class="u3-hm-chip is-live ev-live"><i class="u3-hm-livedot"></i>Live now</span><span class="ev-cd">${icon('timer')}<span>Ends in</span><b>${esc(left(e.end - now))}</b></span>`;
  if (now < e.start) return `<span class="ev-cd">${icon('timer')}<span>Starts in</span><b>${esc(left(e.start - now))}</b></span>`;
  return '<span class="ev-cd is-ended"><span>Ended</span></span>';
}
function artHTML(e) {
  const url = artURL(e);
  return url
    ? `<div class="ev-art is-img" style="--t:${themeVar(e)};background-image:url('${esc(url)}')" role="img" aria-label="${esc(e.title)}"></div>`
    : `<div class="ev-art is-none" style="--t:${themeVar(e)};${kindVar(e)}" aria-hidden="true"><span class="ev-art__ico">${kindIcon(e, '2xl')}</span></div>`;
}
function detailHTML(e, now, back) {
  return `<section class="ev-det" style="${kindVar(e)}" aria-labelledby="evDetT">`
    + (back ? `<div class="ev-det__back" data-ev-back>${button({ label: 'Events', variant: 'ghost', size: 'sm', icon: 'chevron-left' })}</div>` : '')
    + artHTML(e)
    + `<div class="ev-det__kind">${kindIcon(e)}<span class="u3-label">${esc(KINDS[e.k].label)}</span></div>`
    + `<h3 class="ev-det__t" id="evDetT">${esc(e.title)}</h3>`
    + (e.description ? `<p class="ev-det__d">${esc(e.description)}</p>` : '')
    + `<div class="ev-det__st">${statusHTML(e, now)}</div>`
    + `<dl class="ev-det__when"><div><dt class="u3-label">Starts</dt><dd>${esc(when(e.start))}</dd></div><div><dt class="u3-label">Ends</dt><dd>${esc(when(e.end))}</dd></div></dl>`
    + (e.changes.length ? `<div class="ev-det__ch"><span class="u3-label">What changes</span><ul>${e.changes.map((c) => `<li><i aria-hidden="true"></i>${esc(c.text)}</li>`).join('')}</ul></div>` : '')
    + '</section>';
}
function dayListHTML(key, now) {
  const list = dayEvents(st.events, key, now);
  const rows = list.map((e) => {
    const sub = isLive(e, now) ? `<i class="u3-hm-livedot"></i><span>Ends in ${esc(left(e.end - now))}</span>` : now < e.start ? `<span>Starts ${esc(when(e.start))}</span>` : '<span>Ended</span>';
    return `<button type="button" class="ev-row" data-ev="${esc(e.id)}" style="${kindVar(e)}"><span class="ev-row__ico">${kindIcon(e, 'lg')}</span><span class="ev-row__main"><span class="ev-row__t">${esc(e.title)}</span><span class="ev-row__s">${sub}</span></span>${icon('chevron-right')}</button>`;
  }).join('');
  return `<section class="ev-list" aria-label="${esc(dayTitle(key))}"><span class="u3-label ev-list__h">${esc(dayTitle(key))}</span>`
    + (list.length ? `<div class="ev-list__rows">${rows}</div>` : '<p class="ev-list__none">No events on this day.</p>')
    + '<div class="ev-list__pg" data-ev-pg hidden></div></section>';
}
function topHTML(sub) {
  return `<header class="ev-top"><h2 class="u3-lb__title" id="evT">Events</h2>`
    + (sub ? '' : `<div class="ev-month">${iconButton({ icon: 'chevron-left', label: 'Previous month', data: { 'ev-month': '-1' } })}<span class="ev-month__n">${MONTHS[st.m - 1]} ${st.y}</span>${iconButton({ icon: 'chevron-right', label: 'Next month', data: { 'ev-month': '1' } })}</div>`)
    + `<span class="u3-lb__x" data-ev-close>${iconButton({ icon: 'x', label: 'Close' })}</span></header>`;
}
function selected() { return st.events.find((e) => e.id === st.selId) || null; }

function bodyHTML() {
  const lay = layout(); const thin = lay !== 'wide'; const now = Date.now();
  if (st.load === 'error') return `<div class="ev-body ev-body--error">${stateError({ text: ERROR_TEXT })}</div>`;
  const grid = gridHTML(thin);
  const empty = st.load === 'done' && monthEmpty(st.events, st.y, st.m);
  let side;
  if (st.load === 'busy') side = '<div class="ev-side"><span class="ev-ph ev-ph--side"></span></div>';
  else if (empty) side = `<div class="ev-side ev-side--state">${stateEmpty({ title: 'No events this month', action: { label: 'Back to today', icon: 'calendar-check', data: { 'ev-today': '1' } } })}</div>`;
  else if (lay === 'wide') {
    const sel = selected();
    side = `<div class="ev-side">${st.dayList ? dayListHTML(st.dayList, now) : sel ? detailHTML(sel, now, false) : ''}</div>`;
  } else side = `<div class="ev-side">${st.detail && selected() ? detailHTML(selected(), now, true) : dayListHTML(st.selKey, now)}</div>`;
  if (lay === 'tall' && st.detail && selected() && !empty && st.load === 'done') return `<div class="ev-body is-detail">${side}</div>`;
  return `<div class="ev-body">${grid}${side}</div>`;
}

function paint() {
  const win = $('u3Ev'); if (!win) return;
  const sub = layout() === 'tall' && st.detail && st.load === 'done' && !!selected();
  win.dataset.lay = layout();
  win.innerHTML = topHTML(sub) + bodyHTML();
  fit();
}

// ---- Fit (measured modes, 3.5): the lanes that fit a week row, the names that fit a bar, the rows that fit a page ----
function fit() {
  const win = $('u3Ev'); if (!win || st.load !== 'done') return;
  const cal = win.querySelector('.ev-cal'); const thin = !!cal && cal.classList.contains('is-thin');
  const rowOf = (b) => parseInt(b.style.gridRow, 10) - 2;
  const colsOf = (b) => b.style.gridColumn.split('/').map((x) => parseInt(x, 10));
  win.querySelectorAll('.ev-week').forEach((wk) => {
    const ln = wk.querySelector('.ev-lanes');
    const bars = [...ln.querySelectorAll('.ev-bar')]; if (!bars.length) return;
    const used = Math.max(...bars.map(rowOf)) + 1;
    let n;
    if (thin) n = 3;
    else {
      const head = wk.querySelector('.ev-day__n').getBoundingClientRect().height + parseFloat(getComputedStyle(ln).rowGap || 0);
      const barH = BAR_H; const gap = parseFloat(getComputedStyle(ln).rowGap) || 2;
      n = Math.max(1, Math.floor((wk.clientHeight - head) / (barH + gap)));
      ln.style.gridTemplateRows = `calc(var(--counter) + var(--sp-half)) repeat(${n}, var(--ev-bar)) minmax(0, 1fr)`;
    }
    if (used <= n) return;
    const keep = thin ? n : n - 1;
    const hidden = bars.filter((b) => rowOf(b) >= keep); hidden.forEach((b) => b.classList.add('is-hidden'));
    for (let c = 1; c <= 7; c++) {
      const k = hidden.filter((b) => { const [s, e] = colsOf(b); return c >= s && c < e; }).length; if (!k) continue;
      if (thin) { const dayEl = wk.querySelectorAll('.ev-day')[c - 1]; dayEl.insertAdjacentHTML('beforeend', `<span class="ev-day__more" aria-hidden="true">+${k}</span>`); }
      else ln.insertAdjacentHTML('beforeend', `<button type="button" class="ev-more" data-day="${wk.querySelectorAll('.ev-day')[c - 1].dataset.day}" style="grid-column:${c} / ${c + 1};grid-row:${keep + 2}">+${k} more</button>`);
    }
  });
  win.querySelectorAll('.ev-cal:not(.is-thin) .ev-bar:not(.is-hidden)').forEach((b) => {
    const over = () => b.scrollWidth > b.clientWidth + 1;
    if (over()) b.classList.add('is-noico');
    if (over()) b.classList.add('is-small');
    if (over()) { b.classList.remove('is-noico', 'is-small'); b.classList.add('is-icon'); }
  });
  fitList(win);
}
// The day list: a fixed place for 3 rows on tall windows (fewer when the grid rows would drop under 44 px, so nothing moves when
// the day changes, 3.3); more rows page "1 / N".
function fitList(win) {
  const list = win.querySelector('.ev-list'); if (!list) return;
  const rows = [...list.querySelectorAll('.ev-row')];
  const side = win.querySelector('.ev-side');
  if (win.dataset.lay === 'tall') {
    const hit = HIT; const gap = parseFloat(getComputedStyle(list).rowGap) || 8;
    const rowH = rows[0] ? rows[0].getBoundingClientRect().height : 56; const head = list.querySelector('.ev-list__h').getBoundingClientRect().height;
    const grid = win.querySelector('.ev-grid'); const gridGap = parseFloat(getComputedStyle(grid).rowGap) || 4;
    for (let n = 3; n >= 1; n--) { side.style.setProperty('--ev-list-h', `${head + gap + n * rowH + (n - 1) * gap + gap * 2 + hit}px`); if (grid.getBoundingClientRect().height >= 6 * hit + 5 * gridGap - 1) break; }
  }
  const over = () => side.scrollHeight > side.clientHeight + 1;
  let shown = rows.length;
  const pg = list.querySelector('[data-ev-pg]');
  if (rows.length && over()) { pg.hidden = false; pg.innerHTML = pager({ page: 1, pages: 2 }); while (over() && shown > 1) rows[--shown].hidden = true; }
  const pages = Math.max(1, Math.ceil(rows.length / Math.max(1, shown)));
  st.pages = pages; st.per = shown; st.page = Math.min(st.page || 1, pages);
  if (pages > 1) { pg.hidden = false; showPage(win); } else if (pg) { pg.hidden = true; pg.innerHTML = ''; rows.forEach((r) => { r.hidden = false; }); }
}
function showPage(win) {
  const list = win.querySelector('.ev-list'); if (!list) return;
  const rows = [...list.querySelectorAll('.ev-row')];
  rows.forEach((r, i) => { r.hidden = !(i >= (st.page - 1) * st.per && i < st.page * st.per); });
  const pg = list.querySelector('[data-ev-pg]'); pg.innerHTML = pager({ page: st.page, pages: st.pages });
}

// ---- Data ----
async function load() {
  st.load = 'busy'; paint();
  let d = null;
  try { d = await deps.api('/api/events'); } catch { d = null; }
  if (!isOpen()) return;
  if (!d || d.error || !Array.isArray(d.events)) { st.load = 'error'; paint(); return; }
  st.events = d.events.map(norm).filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end));
  st.load = 'done';
  const now = Date.now();
  if (layout() === 'wide') { const f = firstEvent(st.events, now); st.selId = f ? f.id : null; }
  paint();
}

// ---- Events ----
function onClick(e) {
  const host = $('u3EvHost');
  if (e.target === host || e.target.closest('[data-ev-close]')) { closeEventsWindow(); return; }
  const mo = e.target.closest('[data-ev-month]');
  if (mo) { st.m += Number(mo.dataset.evMonth); if (st.m < 1) { st.m = 12; st.y -= 1; } if (st.m > 12) { st.m = 1; st.y += 1; } st.detail = false; st.dayList = null; st.page = 1; paint(); host.querySelector(`button[data-ev-month="${mo.dataset.evMonth}"]`)?.focus(); return; }
  if (e.target.closest('[data-ev-back]')) { st.detail = false; paint(); return; }
  if (e.target.closest('[data-ev-today]')) { const t = new Date(); st.y = t.getFullYear(); st.m = t.getMonth() + 1; st.selKey = dayKey(t); paint(); return; }
  if (e.target.closest('.u3-state--error button')) { load(); return; }
  const pg = e.target.closest('[data-page]');
  if (pg && !pg.disabled) { st.page += pg.dataset.page === 'next' ? 1 : -1; showPage($('u3Ev')); host.querySelector(`[data-page="${pg.dataset.page}"]:not(:disabled)`)?.focus(); return; }
  const ev = e.target.closest('[data-ev]');
  if (ev) { st.selId = ev.dataset.ev; st.dayList = null; st.detail = layout() !== 'wide'; st.page = 1; paint(); return; }
  const day = e.target.closest('[data-day]');
  if (day) { st.selKey = day.dataset.day; st.page = 1; if (layout() === 'wide') { st.dayList = day.dataset.day; st.selId = null; } else st.detail = false; paint(); }
}
function onKey(e) {
  if (!isOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); closeEventsWindow(); return; }
  if (e.key === 'Tab') {
    const f = [...$('u3EvHost').querySelectorAll('button:not(:disabled):not([hidden])')]; if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}
const scheduleFit = () => { clearTimeout(fitT); fitT = setTimeout(() => { if (isOpen()) paint(); }, 60); };

/** Open the page on the month of today. */
export function openEventsWindow() {
  if (!deps || isOpen()) return;
  opener = document.activeElement;
  const t = new Date();
  st = { y: t.getFullYear(), m: t.getMonth() + 1, events: [], load: 'busy', selKey: dayKey(t), selId: null, detail: false, dayList: null, page: 1, pages: 1, per: 3 };
  const host = document.createElement('div');
  host.id = 'u3EvHost'; host.className = 'u3-lbhost ev-host';
  host.innerHTML = '<section class="u3-lb ev-win" id="u3Ev" role="dialog" aria-modal="true" aria-labelledby="evT"></section>';
  document.body.appendChild(host);
  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', scheduleFit);
  const win = $('u3Ev');
  ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFit) : null; ro?.observe(win);
  document.fonts?.ready?.then(() => { if (isOpen()) fit(); });
  tick = setInterval(() => { if (isOpen() && st.load === 'done') paint(); }, 60000);   // the countdowns
  paint();
  host.querySelector('[data-ev-close] button')?.focus();
  load();
}
export function closeEventsWindow({ restore = true } = {}) {
  const host = $('u3EvHost'); if (!host) return;
  ro?.disconnect(); ro = null; clearTimeout(fitT); clearInterval(tick);
  host.remove(); st = null;
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', scheduleFit);
  if (restore) (opener && opener.isConnected ? opener : $('menuBtn'))?.focus?.();
}

/** Start: the hidden #eventsBtn that the Menu Events tile clicks (shell.js TILES). Called only for a member with flags.events. */
export function initEventsWindow(d) {
  deps = d;
  if ($('eventsBtn')) return;
  const b = document.createElement('button');
  b.id = 'eventsBtn'; b.type = 'button'; b.className = 'hidden'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true');
  b.addEventListener('click', () => openEventsWindow());
  document.body.appendChild(b);
}
