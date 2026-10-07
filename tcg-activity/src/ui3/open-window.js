// UI-33 the Open window (lion-pride-tcg-design UI-33/approved, review-3; D-80 to D-90). Only under body.ui-v3
// (settings.ui_v3): main.js opens it from OPEN when the flag is on, and keeps today's chooser when it is off.
// - Every pullable set from GET /api/sets: the set picture (a card of the set, D-86), the name, the code chip and
//   owned / total. The set the member opened last is selected (D-85: the server's last_set; in this session, the
//   set of the last open). "New" on the newest set when there are 2 or more sets (D-89: the server's is_new).
// - The set list pages "1 / N" when the sets do not fit (D-90, D-36). The page size is the one number this module
//   computes (3.5): the columns that fit the width and the rows that fit the height.
// - Then the counts 1, 5, 10: only the counts the member can open (D-88), the largest with the gold mark. The window
//   also opens with 1 pack (D-87). A tap on a count closes the window and opens the packs from the selected set.
// - A sheet on the dock edge on compact-port, a panel above OPEN on the other classes (ui3.css "Open window").
import { esc, iconButton, pager, stateLoading, stateError } from './components.js';
import { fmtFull } from './number.js';

export const COUNTS = [1, 5, 10];

/** The counts the member can open (D-88: the others stay hidden). The largest is the best (the gold mark). */
export function openCounts(packs) {
  const n = Number(packs) || 0;
  return COUNTS.filter((c) => c <= n);
}

/** The set to select (D-85): the set of the last open in this session, else the server's last_set, else the
 *  newest set by release date, else the first. A set that is not in the list is never selected. */
export function preselect(sets, lastSet, sessionLast = null) {
  const list = Array.isArray(sets) ? sets : [];
  if (!list.length) return null;
  for (const id of [sessionLast, lastSet]) if (id != null && list.some((s) => s.id === id)) return id;
  const dated = list.filter((s) => s.released_at).sort((a, b) => String(b.released_at).localeCompare(String(a.released_at)));
  return (dated[0] || list[0]).id;
}

/** The page size of the set list (3.4, 3.5): columns = the tiles of at least minTile that fit the width (never more
 *  than the sets); rows = the tile rows that fit the height. A grid adds a row before it adds a page (G-197). When the
 *  sets need more than one page, the pager takes its height from the rows. */
export function fitSets({ n, width, height, minTile, tileH, gap, pagerH }) {
  const count = Math.max(0, n | 0);
  if (!count) return { cols: 1, rows: 1, pageSize: 1, pages: 1 };
  const cols = Math.max(1, Math.min(count, Math.floor((width + gap) / (minTile + gap))));
  const rowsFit = (h) => Math.max(1, Math.floor((h + gap) / (tileH + gap)));
  const all = rowsFit(height);
  if (count <= cols * all) return { cols, rows: Math.ceil(count / cols), pageSize: count, pages: 1 };
  const rows = rowsFit(height - pagerH - gap);
  const pageSize = cols * rows;
  return { cols, rows, pageSize, pages: Math.ceil(count / pageSize) };
}

/** The page (1-based) that shows the set at index i. */
export const pageOf = (i, pageSize) => Math.floor(Math.max(0, i) / Math.max(1, pageSize)) + 1;

// ---- The window ----
let deps = null;           // { api, packs, onPick }
let cache = null;          // the last GET /api/sets answer
let sessionLast = null;    // the set of the last open in this session
let state = null;          // { sets, selected, page, fit }
let opener = null;

const $ = (id) => document.getElementById(id);
const px = (v) => parseFloat(v) || 0;

/** Fetch the sets now (flag on, start-up), so OPEN shows them at once. */
export function prefetchSets(api) {
  return api('/api/sets').then((d) => { if (d && Array.isArray(d.sets)) cache = d; return cache; }).catch(() => cache);
}
/** The open used this set: select it next time (D-85), and refetch the owned counts. */
export function noteOpened(setId) { if (setId) sessionLast = setId; cache = null; }
export const isOpen = () => !!$('u3OpenHost');

function setTile(s, selected) {
  const cover = s.cover_image_url
    ? `<img src="${esc(s.cover_image_url)}" alt="" loading="lazy" draggable="false">`
    : `<span class="u3-set__slot">${esc(s.code)}</span>`;
  const isNew = s.is_new ? `<span class="u3-chip u3-chip--sm u3-chip--new"><span aria-hidden="true">✦</span><span>New</span></span>` : '';
  return `<button type="button" class="u3-set${selected ? ' is-on' : ''}" role="radio" aria-checked="${selected}" data-set="${esc(s.id)}">`
    + `<span class="u3-set__cover">${cover}</span><span class="u3-set__body"><span class="u3-set__name">${esc(s.name)}</span>`
    + `<span class="u3-set__meta"><span class="u3-set__code">${esc(s.code)}</span><span class="u3-set__owned">${fmtFull(s.owned)}/${fmtFull(s.cards)}</span></span>${isNew}</span></button>`;
}

function countTile(n, best, packImg) {
  const fan = `<img src="${esc(packImg)}" alt="" draggable="false">`;
  return `<button type="button" class="u3-count${best ? ' is-best' : ''}" data-count="${n}" aria-label="Open ${n} pack${n === 1 ? '' : 's'}">`
    + `<span class="u3-count__fan" data-n="${n}" style="--u3-pack:url('${esc(packImg)}')">${fan}</span><span class="u3-count__n"><i aria-hidden="true">×</i>${n}</span></button>`;
}

// The pack picture of the count tiles: the selected set's pack (D-90). Season 1 keeps today's pack (pack_still.png);
// no other set has its own pack picture yet.
const packPicture = () => '/pack_still.png?v=2';

function paint() {
  const host = $('u3OpenHost');
  if (!host || !state) return;
  const win = host.querySelector('.u3-open');
  const { sets, selected, fit } = state;
  const start = (state.page - 1) * fit.pageSize;
  const shown = sets.slice(start, start + fit.pageSize);
  win.style.setProperty('--u3-open-cols', String(fit.cols));
  win.querySelector('.u3-open__sets').innerHTML = shown.map((s) => setTile(s, s.id === selected)).join('');
  win.querySelector('.u3-open__pager').innerHTML = fit.pages > 1 ? pager({ page: state.page, pages: fit.pages }) : '';
  win.querySelector('.u3-open__pager').hidden = fit.pages <= 1;
  const counts = openCounts(deps.packs());
  win.querySelector('.u3-open__counts').innerHTML = counts.map((n) => countTile(n, n === counts[counts.length - 1], packPicture())).join('');
}

// The one number (3.5): the page size of the set list. Pass 1 paints one row; the space the sets may take is the
// window's max height minus everything that is not the set list.
function refit() {
  const host = $('u3OpenHost');
  if (!host || !state) return;
  const win = host.querySelector('.u3-open');
  const list = win.querySelector('.u3-open__sets');
  const css = getComputedStyle(win);
  const gap = px(css.getPropertyValue('--u3-open-gap'));
  const minTile = px(css.getPropertyValue('--u3-open-min'));
  // pass 1: one row of tiles, no pager, at the widest the window may grow
  win.classList.add('is-measuring');
  state.fit = { cols: Math.min(state.sets.length, 1), rows: 1, pageSize: 1, pages: 1 };
  state.page = 1;
  paint();
  const tileH = list.firstElementChild?.getBoundingClientRect().height || 0;
  const width = list.getBoundingClientRect().width;
  const maxH = px(css.maxHeight) || win.getBoundingClientRect().height;
  // compact-land puts the sets in their own column (--u3-open-side: 1): only the window padding is not the set list
  const other = px(css.getPropertyValue('--u3-open-side'))
    ? px(css.paddingTop) + px(css.paddingBottom) + px(css.borderTopWidth) + px(css.borderBottomWidth)
    : win.getBoundingClientRect().height - list.getBoundingClientRect().height;
  win.classList.remove('is-measuring');
  const pagerH = px(css.getPropertyValue('--u3-open-pager'));
  state.fit = fitSets({ n: state.sets.length, width, height: maxH - other, minTile, tileH, gap, pagerH });
  const i = state.sets.findIndex((s) => s.id === state.selected);
  state.page = Math.min(state.fit.pages, pageOf(i, state.fit.pageSize));   // the page that shows the selected set
  paint();
}

function onClick(e) {
  const host = $('u3OpenHost');
  if (e.target === host || e.target.closest('[data-u3-close]')) { closeOpenWindow(); return; }
  const set = e.target.closest('[data-set]');
  if (set) { state.selected = set.dataset.set; paint(); host.querySelector(`[data-set="${CSS.escape(state.selected)}"]`)?.focus(); return; }
  const pg = e.target.closest('[data-page]');
  if (pg && !pg.disabled) { turn(pg.dataset.page === 'next' ? 1 : -1); return; }
  const c = e.target.closest('[data-count]');
  if (c) {
    const n = Number(c.dataset.count);
    const setId = state.selected;
    closeOpenWindow({ restore: false });
    noteOpened(setId);
    deps.onPick(n, setId);
    return;
  }
  if (e.target.closest('[data-retry]')) load();
}
function turn(d) {
  if (!state) return;
  const p = Math.min(state.fit.pages, Math.max(1, state.page + d));
  if (p !== state.page) { state.page = p; paint(); }
}
function onKey(e) {
  if (!isOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); closeOpenWindow(); return; }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && state?.fit.pages > 1 && e.target.closest?.('.u3-open__sets, .u3-pager')) {
    turn(e.key === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (e.key === 'Tab') {   // focus stays in the window (6.2)
    const f = [...$('u3OpenHost').querySelectorAll('button:not(:disabled)')];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}
// The pager swipe (5.2 Pager: 40 px).
let swipeX = null;
const onDown = (e) => { if (e.target.closest('.u3-open__sets')) swipeX = e.clientX; };
const onUp = (e) => { if (swipeX == null) return; const dx = e.clientX - swipeX; swipeX = null; if (Math.abs(dx) >= 40) turn(dx < 0 ? 1 : -1); };
let resizeT = null;
const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(refit, 120); };

function frame(body) {
  return `<section class="u3-open" role="dialog" aria-modal="true" aria-labelledby="u3OpenT">`
    + `<header class="u3-open__head"><h2 class="u3-open__title" id="u3OpenT">Open packs</h2>`
    + `<span data-u3-close>${iconButton({ icon: 'x', label: 'Close' })}</span></header>${body}</section>`;
}
const BODY = '<div class="u3-open__sets" role="radiogroup" aria-label="Sets"></div><div class="u3-open__pager" hidden></div><div class="u3-open__counts"></div>';

function show(d) {
  const host = $('u3OpenHost');
  if (!host) return;
  const sets = Array.isArray(d?.sets) ? d.sets : [];
  if (!sets.length) { host.innerHTML = frame(stateError({ text: 'Could not load the sets.' }).replace('<button', '<button data-retry')); return; }
  host.innerHTML = frame(BODY);
  state = { sets, selected: preselect(sets, d.last_set, sessionLast), page: 1, fit: null };
  refit();
  host.querySelector('.u3-set.is-on, .u3-set')?.focus();
}
function load() {
  const host = $('u3OpenHost');
  if (!host) return;
  if (cache) { show(cache); return; }
  host.innerHTML = frame(stateLoading({ count: 2 }));
  prefetchSets(deps.api).then((d) => { if (isOpen()) show(d); });
}

/** Open the window (OPEN with 1 pack or more). A second tap on OPEN closes it. */
export function openOpenWindow(d) {
  deps = d;
  if (isOpen()) { closeOpenWindow(); return; }
  opener = document.activeElement;
  const host = document.createElement('div');
  host.id = 'u3OpenHost';
  host.className = 'u3-openhost';
  document.body.appendChild(host);
  $('dockOpen')?.setAttribute('aria-expanded', 'true');
  host.addEventListener('click', onClick);
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  load();
}

export function closeOpenWindow({ restore = true } = {}) {
  const host = $('u3OpenHost');
  if (!host) return;
  host.remove();
  state = null;
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  $('dockOpen')?.setAttribute('aria-expanded', 'false');
  if (restore) (opener && opener.isConnected ? opener : $('dockOpen'))?.focus?.();
}
