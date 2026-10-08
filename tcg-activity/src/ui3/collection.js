// UI-07 Collection (v3, only under body.ui-v3): the card grid, the toolbar (search + Filters, D-39), the Filters panel,
// the pager under the grid (D-36), the card face only (D-29), no card panel beside the grid (D-38).
// Approved design: lion-pride-tcg-design UI-07/approved (review-2). The v2 Collection (ui-v2.js) stays for every
// member without the flag: ui-v2.js calls paintCollectionV3() only when body.ui-v3 is set and the Cards tab is open.
// The state object (col) and the card data stay in ui-v2.js, so the Achievements and Bosses tabs do not change.
import { icon } from './icons.js';
import { esc, iconButton, button, pager } from './components.js';

// ---- Pure logic (tested in collection.test.js) ----------------------------------------------------------------

/** The minimum tile width (design.md 8.1 "tile" 88 px; D-60: 55 px on compact-land, so that 2 rows fit). */
export const TILE_MIN = 88;
export const TILE_MIN_COMPACT_LAND = 55;
export const tileMin = (cls) => (cls === 'compact-land' ? TILE_MIN_COMPACT_LAND : TILE_MIN);

/**
 * The one grid fitter (design.md 3.4, 3.5): the page size is the number of 5:7 tiles that fit in the box, each tile at
 * least `min` wide. A grid adds a row before it adds a page, and it shows at least 2 rows (G-099). With equal counts,
 * the larger tile wins. Returns { cols, rows, per, cw } (cw = the tile width that CSS computes from the same box).
 */
export function fitGrid({ width, height, gap, min, minRows = 2, maxCols = 40, maxRows = 12 }) {
  const w = Math.max(0, width), h = Math.max(0, height);
  const cwFor = (cols, rows) => Math.min((w - (cols - 1) * gap) / cols, ((h - (rows - 1) * gap) / rows) * 5 / 7);
  let best = null;
  for (let rows = minRows; rows <= maxRows; rows++) {
    for (let cols = 1; cols <= maxCols; cols++) {
      const cw = cwFor(cols, rows);
      if (cw < min) continue;
      const per = cols * rows;
      if (!best || per > best.per || (per === best.per && cw > best.cw)) best = { cols, rows, per, cw };
    }
  }
  if (best) return best;
  // The box is too small for 2 rows of the minimum tile. The minimum width wins (8.1, as the v2 fitter): one row of
  // tiles at the minimum width, and the pager shows the rest. Only a box lower than one minimum tile shrinks the tile.
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  return { cols, rows: 1, per: cols, cw: Math.max(0, Math.min(min, cwFor(cols, 1))) };
}

/** The page after a change: inside 0..pages-1. Returns { page, pages, start }. */
export function pageOf({ total, per, page }) {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, per)));
  const p = Math.min(Math.max(0, page | 0), pages - 1);
  return { page: p, pages, start: p * Math.max(1, per) };
}

/** The filter defaults (Clear all). The search box is not a panel filter: it stays in the toolbar (D-39). */
export const FILTER_DEFAULTS = Object.freeze({ own: 'all', rarity: 'all', element: null, type: null, game: null });
/** The number on the Filters button (D-39): each panel group with a choice counts 1. */
export function activeFilterCount(f) {
  return (f.own && f.own !== 'all' ? 1 : 0) + (f.rarity && f.rarity !== 'all' ? 1 : 0) + (f.element ? 1 : 0) + (f.type ? 1 : 0) + (f.game ? 1 : 0);
}
export const filtersLabel = (n) => (n > 0 ? `Filters (${n})` : 'Filters');

/** The cards of the grid: the set, the panel filters and the search (the same rules as the v2 Collection). */
export function filterCards(cards, f, { season, q = '', elementOf }) {
  const s = String(q || '').trim().toLowerCase();
  return cards.filter((c) => {
    if ((c.season || 'Season 1') !== season) return false;
    if (f.rarity !== 'all' && c.rarity !== f.rarity) return false;
    if (f.element && elementOf(c) !== f.element) return false;
    if (f.type && c.tags?.type !== f.type) return false;
    if (f.game && ![].concat(c.tags?.origin || []).includes(f.game)) return false;
    if (f.own === 'owned' && !c.owned) return false;
    if (f.own === 'missing' && c.owned) return false;
    if (f.own === 'ascend' && !(c.owned && c.can_ascend)) return false;   // D-33: only the cards that can ascend now
    if (s) {
      const t = c.tags || {};
      const hay = [c.name, c.subject, t.type, t.class, t.origin, ...(t.traits || []), ...(t.genre || [])].flat().filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** The set line beside the toolbar: "154/352 · 44%", or with a filter or a search "12 cards · 3 owned". */
export function setLine({ inSeason, filtered, filtering }) {
  if (filtering) return `${plural(filtered.length, 'card', 'cards')} · ${filtered.filter((c) => c.owned).length} owned`;
  const have = inSeason.filter((c) => c.owned).length;
  return `${have}/${inSeason.length} · ${Math.round((100 * have) / (inSeason.length || 1))}%`;
}

/** The card number on a missing card, as drawn: a hash and 3 digits (set_number from the server, PR 237; else the place in the set). */
export const numLabel = (c) => `#${String(c.set_number ?? c.num ?? '').padStart(3, '0')}`;

// ---- Painting ---------------------------------------------------------------------------------------------------

const OWN = [['all', 'All'], ['owned', 'Owned'], ['missing', 'Missing'], ['ascend', 'Can ascend']];
const $ = (id) => document.getElementById(id);
let deps = null;          // { col, cards, seasons, inSeason, rarities, elements, types, games, rarityLabel, elementName, elIcon, elementOf, flair, thumb, openCard, onSwipe, status, rerender }
let items = [];           // the filtered cards of the grid
let ro = null;            // the ResizeObserver of the grid box (re-fit within 200 ms, G-010)
let draft = null;         // the Filters panel choices before Confirm

const filtering = (col) => activeFilterCount(col) > 0 || !!String(col.q || '').trim();

function tileHTML(c, idx) {
  if (c.locked) {
    return `<button type="button" class="u3-ctile is-locked" data-idx="${idx}" aria-label="${esc(numLabel(c))}, not owned">`
      + `${icon('lock', { size: 'lg' })}<span class="u3-ctile__num">${esc(numLabel(c))}</span></button>`;
  }
  return `<button type="button" class="u3-ctile u3-r-${esc(c.rarity)}" data-idx="${idx}" aria-label="${esc(c.name)}, ${esc(deps.rarityLabel[c.rarity] || c.rarity)}">`
    + `${c.image_url ? `<img class="u3-ctile__img" src="${esc(deps.thumb(c.image_url))}" alt="" loading="lazy" draggable="false">` : ''}`
    + `${deps.flair(c.ascension)}</button>`;
}

/** Paint the Cards tab of the Collection into #main. tabBar = the v2 tab markup (subtabs.js lifts it into the row,
 *  the shell decorates it); help = the view's "?" (the shell moves it into the row on the wide classes, D-63). */
export function paintCollectionV3(main, d, { tabBar, help }) {
  deps = d;
  const { col } = d;
  if (d.error) {
    main.innerHTML = `<div class="u3-col u3-col--error">${tabBar}<div class="u3-col__err">`
      + `<p class="u3-col__errline">${icon('circle-alert')}<span>Could not load this.</span></p>${button({ label: 'Retry', variant: 'secondary', data: { retry: '1' } })}</div></div>`;
    main.querySelector('[data-retry]')?.addEventListener('click', () => d.rerender());
    return;
  }
  const q = col.q || '';
  main.innerHTML = `<div class="u3-col">${tabBar}
    <div class="u3-col__bar">
      <div class="u3-search u3-col__search">${icon('search')}<input id="colSearch" class="u3-search__input" type="search" placeholder="Search cards, tags…" aria-label="Search cards" value="${esc(q)}" autocomplete="off">`
      + `<span class="u3-col__clear"${q ? '' : ' hidden'}>${iconButton({ icon: 'x', label: 'Clear search', size: 'sm', variant: 'plain' })}</span></div>
      <button type="button" class="u3-btn u3-btn--secondary u3-btn--md u3-col__filters" id="colFilters" aria-haspopup="dialog" aria-expanded="false">${icon('list-filter')}<span class="u3-btn__label" id="colFiltersLbl">${esc(filtersLabel(activeFilterCount(col)))}</span></button>
      <p class="u3-col__set">${help || ''}<span class="u3-col__setname">${esc(col.season)}</span><span class="u3-col__setsub" id="colSetSub"></span></p>
    </div>
    <div class="u3-col__box" id="colBox"><div class="u3-col__grid" id="colGrid"></div><div class="u3-col__pager" id="colPager"></div></div>
  </div>`;
  wire(main);
  paintGrid();
}

let qTimer = null;
function wire(main) {
  const { col } = deps;
  const input = $('colSearch');
  const clear = main.querySelector('.u3-col__clear');
  // 5.2 Search Field: 150 ms debounce; the grid filters as the member types (D-39).
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { col.q = input.value; col.page = 0; paintGrid(); }, 150);
  });
  clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; col.q = ''; col.page = 0; paintGrid(); input.focus(); });
  $('colFilters').addEventListener('click', openFilters);
  const grid = $('colGrid');
  grid.addEventListener('click', (e) => {
    const t = e.target.closest('.u3-ctile');
    const c = t && items[Number(t.dataset.idx)];
    if (c) deps.openCard(c, items);
  });
  // 9.3: the arrow keys move through the grid; past the first or last card they turn the page.
  grid.addEventListener('keydown', (e) => {
    const t = e.target.closest('.u3-ctile');
    if (!t) return;
    const cols = Number(grid.dataset.cols) || 1;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (!step) return;
    e.preventDefault();
    const to = Number(t.dataset.idx) + step;
    if (to < 0 || to >= items.length) return;
    const per = Number(grid.dataset.per) || 1;
    if (Math.floor(to / per) !== col.page) { col.page = Math.floor(to / per); paintGrid(); }
    grid.querySelector(`.u3-ctile[data-idx="${to}"]`)?.focus();
  });
  deps.onSwipe(grid, (dir) => turn(dir));
  $('colPager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) turn(b.dataset.page === 'next' ? 1 : -1);
  });
  ro?.disconnect();
  let rt = null;
  ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (document.body.contains(grid)) paintGrid({ keepFirst: true }); else ro?.disconnect(); }, 100); });
  ro.observe($('colBox'));
}

function turn(dir) {
  const grid = $('colGrid');
  const per = Number(grid?.dataset.per) || 1;
  const { pages } = pageOf({ total: items.length, per, page: 0 });
  const next = deps.col.page + dir;
  if (next < 0 || next > pages - 1) return;
  deps.col.page = next;
  paintGrid();
}

/** The box the grid may fill: the grid box minus the pager and the space above it. CSS computes the tile width from
 *  the same box (ui3.css .u3-col__grid), so JS gives only the page size (3.5). */
function measure() {
  const box = $('colBox');
  const pg = $('colPager');
  const cs = getComputedStyle(box);
  const gap = parseFloat(cs.getPropertyValue('--u3-gap')) || 0;
  const above = parseFloat(cs.getPropertyValue('--u3-pager-gap')) || 0;
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);   // 100cqh is the content box
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return { width: box.clientWidth - padX, height: box.clientHeight - padY - pg.offsetHeight - above, gap };
}

function paintGrid({ keepFirst = false } = {}) {
  const grid = $('colGrid');
  if (!grid) return;
  const { col } = deps;
  const first = keepFirst ? col.page * (Number(grid.dataset.per) || 0) : null;
  items = filterCards(deps.cards, col, { season: col.season, q: col.q, elementOf: deps.elementOf });
  const fit = fitGrid({ ...measure(), min: tileMin(document.body.dataset.size) });
  if (first != null) col.page = Math.floor(first / fit.per);   // 2.1: keep the first visible card on a size change
  const { page, pages, start } = pageOf({ total: items.length, per: fit.per, page: col.page });
  col.page = page;
  grid.dataset.cols = fit.cols; grid.dataset.rows = fit.rows; grid.dataset.per = fit.per;
  grid.style.setProperty('--u3-cols', fit.cols);
  grid.style.setProperty('--u3-rows', fit.rows);
  grid.innerHTML = items.length ? items.slice(start, start + fit.per).map((c, i) => tileHTML(c, start + i)).join('')
    : '<p class="u3-col__none">No cards match.</p>';
  grid.classList.toggle('is-empty', !items.length);
  const pg = $('colPager');
  pg.innerHTML = pager({ page: page + 1, pages });
  pg.classList.toggle('is-hidden', !items.length);   // the place stays (3.3: nothing moves)
  const sub = $('colSetSub');
  if (sub) sub.textContent = setLine({ inSeason: deps.inSeason, filtered: items, filtering: filtering(col) });
  deps.status?.();
}

// ---- The Filters panel (D-39): on top of the view; Confirm applies, Clear all resets, close discards ----------------

function chipHTML(group, value, label, on, { rarity = null, n = null } = {}) {
  return `<button type="button" class="u3-chip u3-chip--filter u3-chip--md${rarity ? ` u3-r-${esc(rarity)}` : ''}${on ? ' is-on' : ''}" aria-pressed="${on}" data-f="${group}" data-v="${esc(value)}">`
    + `${rarity ? '<span class="u3-chip__mark" aria-hidden="true"></span>' : ''}<span>${esc(label)}</span>${n != null ? `<span class="u3-chip__n">${n}</span>` : ''}</button>`;
}
function panelHTML() {
  const d = deps;
  const f = draft;
  const ascN = d.inSeason.filter((c) => c.owned && c.can_ascend).length;
  const own = OWN.map(([v, l]) => `<button type="button" role="radio" aria-checked="${f.own === v}" class="u3-seg__item${f.own === v ? ' is-active' : ''}" data-own="${v}">`
    + `<span>${l}</span>${v === 'ascend' ? `<span class="u3-chip__n">${ascN}</span>` : ''}</button>`).join('');
  const row = (label, body) => (body ? `<div class="u3-frow"><span class="u3-label u3-frow__label">${label}</span><div class="u3-frow__chips">${body}</div></div>` : '');
  const sets = d.seasons.length > 1 ? d.seasons.map((s) => chipHTML('season', s, s, f.season === s)).join('') : '';
  const rar = d.rarities.map((r) => chipHTML('rarity', r, d.rarityLabel[r] || r, f.rarity === r, { rarity: r, n: d.inSeason.filter((c) => c.rarity === r).length })).join('');
  const els = d.elements.map((e) => `<button type="button" class="u3-chip u3-chip--element u3-chip--md${f.element === e ? ' is-on' : ''}" aria-pressed="${f.element === e}" aria-label="${esc(d.elementName(e))}" data-f="element" data-v="${e}">${d.elIcon(e)}</button>`).join('');
  const types = d.types.map(([k, l]) => chipHTML('type', k, l, f.type === k)).join('');
  const games = d.games.map(([k, l]) => chipHTML('game', k, l, f.game === k)).join('');
  return `<section class="u3-fpanel" role="dialog" aria-modal="true" aria-labelledby="u3FiltersT">
    <header class="u3-fpanel__head"><h2 class="u3-fpanel__title" id="u3FiltersT">Filters</h2>${iconButton({ icon: 'x', label: 'Close', variant: 'panel', data: { fclose: '1' } })}</header>
    <div class="u3-fpanel__body">
      <div class="u3-seg u3-fpanel__own" role="radiogroup" aria-label="Show">${own}</div>
      ${row('Set', sets)}${row('Rarity', rar)}${row('Element', `<div class="u3-frow__els">${els}</div>`)}${row('Type', types)}${row('Game', games)}
    </div>
    <footer class="u3-fpanel__foot">${button({ label: 'Clear all', variant: 'ghost', data: { fclear: '1' } })}${button({ label: 'Confirm', variant: 'primary', data: { fok: '1' } })}</footer>
  </section>`;
}

function openFilters() {
  if ($('u3Filters')) return;
  const { col } = deps;
  draft = { own: col.own, rarity: col.rarity, element: col.element, type: col.type, game: col.game, season: col.season };
  const host = document.createElement('div');
  host.id = 'u3Filters'; host.className = 'u3-fhost';
  host.innerHTML = panelHTML();
  document.body.appendChild(host);
  $('colFilters')?.setAttribute('aria-expanded', 'true');
  host.querySelector('[data-fclose]')?.focus();
  host.addEventListener('click', onPanelClick);
  document.addEventListener('keydown', onPanelKey, true);
}
function closeFilters({ apply = false } = {}) {
  const host = $('u3Filters');
  if (!host) return;
  document.removeEventListener('keydown', onPanelKey, true);
  host.remove();
  const btn = $('colFilters');
  btn?.setAttribute('aria-expanded', 'false');
  if (apply) {
    const { col } = deps;
    const seasonChanged = draft.season !== col.season;
    Object.assign(col, { own: draft.own, rarity: draft.rarity, element: draft.element, type: draft.type, game: draft.game, season: draft.season, page: 0 });
    if (seasonChanged) { deps.rerender(); return; }   // the set line, the counts and the chips belong to the set
    $('colFiltersLbl').textContent = filtersLabel(activeFilterCount(col));
    paintGrid();
  }
  draft = null;
  btn?.focus();
}
function onPanelClick(e) {
  const host = e.currentTarget;
  if (e.target === host || e.target.closest('[data-fclose]')) { closeFilters(); return; }
  if (e.target.closest('[data-fok]')) { closeFilters({ apply: true }); return; }
  if (e.target.closest('[data-fclear]')) { Object.assign(draft, FILTER_DEFAULTS); repaintPanel(); return; }
  const o = e.target.closest('[data-own]');
  if (o) { draft.own = o.dataset.own; repaintPanel(); return; }
  const c = e.target.closest('[data-f]');
  if (!c) return;
  const k = c.dataset.f; const v = c.dataset.v;
  if (k === 'season') draft.season = v;
  else draft[k] = draft[k] === v ? (k === 'rarity' ? 'all' : null) : v;
  repaintPanel();
}
function repaintPanel() {
  const host = $('u3Filters');
  if (!host) return;
  const focused = document.activeElement?.closest('[data-f], [data-own], [data-fclear]');
  const key = focused ? ['f', 'v', 'own', 'fclear'].map((k) => focused.dataset[k] || '').join('|') : null;
  host.innerHTML = panelHTML();
  if (key) [...host.querySelectorAll('[data-f], [data-own], [data-fclear]')].find((n) => ['f', 'v', 'own', 'fclear'].map((k) => n.dataset[k] || '').join('|') === key)?.focus();
}
// 6.2: Escape closes; the focus stays in the window (Tab wraps).
function onPanelKey(e) {
  const host = $('u3Filters');
  if (!host) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFilters(); return; }
  if (e.key !== 'Tab') return;
  const f = [...host.querySelectorAll('button:not([disabled])')];
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } else if (i < 0) { e.preventDefault(); f[0].focus(); }
}

/** Close the panel when the view changes (the dock, a tab). */
export function disposeCollectionV3() { closeFilters(); ro?.disconnect(); ro = null; }
