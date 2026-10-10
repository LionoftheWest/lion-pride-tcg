// UI-14 Profile (member), v3: design repo UI-14/approved (review-1 + review-2), only under body.ui-v3 (settings.ui_v3).
// ui-v2.js paintMember() keeps the data and the wiring (the same element ids); this module gives the v3 markup and fits
// the parts that must not scroll: the achievements grid ("+N" in its last place, C7), the Season mini grid (whole rows,
// C14), the Spotlight card size (review-2: as large as the tile allows), the wishlist handle (D-128: a strip that opens the drawer of src/ui3/wishlist.js) and the
// View all grid (the card face only, the pager under it, C16). Layouts per size class: col3 (expanded, medium
// landscape), stack (medium portrait, C15), land (compact-land), port (compact-port), tiny.
import { esc, button, pager, stateError, segmented } from './components.js';
import { icon } from './icons.js';
import { fitGrid } from './card-picker.js';
import { TOKENS } from '../tokens.js';
import { thumb } from '../thumb.js';

export const isV3 = () => document.body.classList.contains('ui-v3');

/** The shell parts that open another screen or window (the dock, the top bar, the Menu). A tap on one of them closes the Profile
 *  (it is a layer over the screens: the same "tap outside" rule as the Settings window). Pure on its argument (unit-tested). */
export const SHELL_TAP = '#dock, #topbar, #u3MenuHost';
export const closesProfile = (target) => !!target?.closest?.(SHELL_TAP);
const fmt = (n) => Number(n || 0).toLocaleString();

/** The layout of the profile for a size class and the usable frame. Pure (unit-tested). */
export function layoutOf(size, width, height) {
  if (size === 'tiny') return 'tiny';
  if (size === 'compact-port') return 'port';
  if (size === 'compact-land') return 'land';
  if (size === 'medium' && height > width) return 'stack';
  return 'col3';
}

/** n earned items in fit places: when they do not all fit, the last place shows "+N" (3.4, G-022). Pure. */
export function places(n, fit) {
  const f = Math.max(0, fit | 0);
  if (n <= f) return { show: n, more: 0 };
  if (f === 0) return { show: 0, more: n };
  return { show: f - 1, more: n - (f - 1) };
}

/** The width of the main Spotlight card (the side cards are `side` of it) for an area w x h. Pure. */
export function spotWidth(w, h, n, gap, { side = 0.82, ratio = TOKENS['card-ratio'] } = {}) {
  if (!n || !(w > 0) || !(h > 0)) return 0;
  const units = 1 + (n - 1) * side;
  return Math.max(0, Math.floor(Math.min((w - gap * (n - 1)) / units, h / ratio)));
}

/** Whole rows of mini cards (card-mini wide or wider) in an area: { cols, rows, w }. Pure. */
export function miniGrid(w, h, gap, { min = TOKENS['card-mini'], ratio = TOKENS['card-ratio'] } = {}) {
  if (!(w > 0) || !(h > 0)) return { cols: 0, rows: 0, w: 0 };
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - gap * (cols - 1)) / cols;
  const rows = Math.max(0, Math.floor((h + gap) / (cw * ratio + gap)));
  return { cols, rows, w: Math.floor(cw) };
}

// ---- Markup ----------------------------------------------------------------------------------------------------

const cardLi = (c, cls, extra = '') => `<li class="u3-pf-card u3-r-${esc(c.rarity || 'normal')}${cls ? ` ${cls}` : ''}">`
  + `<button type="button" data-id="${esc(c.id)}" aria-label="${esc(c.name || 'Card')}">${c.image_url ? `<img src="${thumb(c.image_url)}" data-full="${esc(c.image_url)}" alt="" draggable="false">` : ''}${extra}</button></li>`;

/**
 * The profile. d: { p, self, lay, avatar (html), name (html), title, pres: { ico, txt } | null, effects, stats: [[value, label]],
 *   done: [{ key, icon, name }], total, spot: [{ id, card, stache, main }], season: { name, owned, total, pct, cards }, all,
 *   rarities: [{ r, label, n }], wish, huntHTML }
 */
export function profileHTML(d) {
  const { p, self } = d;
  const badges = d.done.slice(0, 5).map((a) => `<span class="u3-pf-badge" title="${esc(a.name)}">${a.icon}</span>`).join('')
    + (d.done.length > 5 ? `<span class="u3-pf-more">+${d.done.length - 5}</span>` : '');
  const acts = self ? '' : `${d.effects ? `<div class="u3-pf-fx">${button({ label: '🎁 Boon', variant: 'boon' }).replace('<button', '<button id="memBoon"')}`
    + `${button({ label: '😈 Prank', variant: 'prank' }).replace('<button', '<button id="memPrank"')}</div>` : ''}`
    + `${button({ label: 'Offer a trade', icon: 'arrow-left-right' }).replace('<button', '<button id="memTrade"')}`;
  const id = `<section class="u3-pf-tile u3-pf-id">
    <div class="u3-pf-home">${button({ label: '← Home' }).replace('<button', '<button id="memBack"')}</div>
    <div class="u3-pf-who">${d.avatar}<div class="u3-pf-name"><h2>${d.name}</h2>${d.title ? `<span class="u3-pf-title">${esc(d.title)}</span>` : ''}
      ${self ? button({ label: '🎖 Title & frame' }).replace('<button', '<button id="memCos"') : ''}
      <div class="u3-pf-badges">${badges}</div></div></div>
    ${d.pres ? `<div class="u3-pf-status">🎧 In voice · ${d.pres.ico || ''} ${esc(d.pres.txt || 'Here')}</div>` : ''}
    ${acts ? `<div class="u3-pf-acts">${acts}</div>` : ''}
    <div class="u3-pf-stats">${d.stats.map(([v, k]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
    <div class="u3-pf-achh"><span class="u3-label">Achievements</span><span class="u3-pf-n">${d.done.length}/${d.total}</span></div>
    <ul class="u3-pf-ach" id="memAch" aria-label="Achievements"></ul>
  </section>`;
  const spot = d.all ? '' : `<section class="u3-pf-tile u3-pf-spot" id="u3PfSpot">
    <div class="u3-pf-head"><span class="u3-label">✨ Spotlight</span>${self ? button({ label: 'Edit', variant: 'ghost', size: 'sm' }).replace('<button', '<button id="memStyle"') : ''}</div>
    <ul class="u3-pf-spotrow" id="memSpot">${d.spot.map((s) => cardLi(s.card, s.main ? 'is-main' : '', s.stache).replace(`data-id="${esc(s.card.id)}"`, `data-id="${esc(s.id)}"`)).join('')
      || '<li class="u3-pf-none">No cards yet.</li>'}</ul>
  </section>`;
  const season = `<section class="u3-pf-tile u3-pf-season${d.all ? ' is-all' : ''}" id="u3PfSeason">
    <div class="u3-pf-shead"><div class="u3-pf-stitle"><h2>${esc(d.season.name)}</h2><span class="u3-pf-n">${d.season.owned}/${d.season.total}</span></div>
      <div class="u3-pf-sbar"><i style="--u3-v:${d.season.pct}%"></i></div>
      ${button({ label: d.all ? 'Back' : 'View all ›', variant: 'ghost', size: 'sm' }).replace('<button', '<button id="memAll"')}</div>
    ${d.all ? '<ul class="u3-pf-allgrid" id="memGrid" aria-label="Cards"></ul><div class="u3-pf-pager" id="memPager"></div>'
      : `<ul class="u3-pf-mini" id="memGrid" aria-label="${esc(d.season.name)}"></ul>
    <div class="u3-pf-rar">${d.rarities.map((x) => `<span class="u3-pf-rchip u3-r-${x.r}"><i aria-hidden="true">◆</i>${esc(x.label)} <b>${x.n}</b></span>`).join('')}</div>`}
  </section>`;
  // D-128: the Wishlist is a strip (the handle) at the bottom of the Profile; a tap opens the drawer with every wishlist card
  const wish = d.wish ? `<section class="u3-pf-tile u3-pf-wish" id="memWish">${wishBarHTML(null)}</section>` : '';
  const hunt = `<section class="u3-pf-tile u3-pf-hunt">${d.huntHTML}</section>`;
  // the smallest phones: the Spotlight and the Season share one place, as two tabs (P1; fitTight step 5). The handle stays outside the tabs.
  const tabs = !d.all ? `<div class="u3-pf-tabs">${segmented([{ id: 'pf:spot', label: 'Spotlight', active: true, controls: 'u3PfSpot' },
    { id: 'pf:season', label: d.season.name, controls: 'u3PfSeason' }], { label: 'Profile' })}</div>` : '';
  return `<div class="u3-pf" data-lay="${d.lay}"${self ? ' data-self=""' : ''}${d.wish ? ' data-wd=""' : ''}>${id}${spot}${season}${tabs}${hunt}${wish}</div>`;
}

/** The Wishlist handle (D-128): one 44 px strip. n = the filled slots, total = the slots; null while the list loads (then it is not a button yet). */
export function wishBarHTML(n, total = 5) {
  const head = `<span class="u3-pf-wishbar__grab" aria-hidden="true"></span>${icon('heart')}<b class="u3-pf-wishbar__t">Wishlist</b>`;
  if (n == null) return `<div class="u3-pf-wishbar is-loading">${head}</div>`;
  return `<button type="button" class="u3-pf-wishbar" id="wlHandle" aria-haspopup="dialog" aria-label="Wishlist, ${n} of ${total}. Open">${head}`
    + `<span class="u3-pf-wishbar__n">${n}/${total}</span>${icon('chevron-up', { size: 'lg' })}</button>`;
}

/** The Wishlist handle opens the drawer on a tap and on a drag up (D-128). onOpen(handle) runs once; the click that ends a drag is dropped. */
export function bindWishHandle(btn, onOpen) {
  if (!btn) return;
  let y0 = null;
  let dragged = false;
  btn.addEventListener('pointerdown', (e) => { y0 = e.clientY; dragged = false; });
  btn.addEventListener('pointermove', (e) => { if (y0 != null && !dragged && y0 - e.clientY >= TOKENS.hit / 2) { dragged = true; y0 = null; onOpen(btn); } });
  const end = () => { y0 = null; };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('click', () => { if (dragged) { dragged = false; return; } onOpen(btn); });
}

/** The Hunt tile (C4: "The Hunt"; C8: the empty line centered). h = p.hunt. */
export function huntHTML(h, rank, body) {
  if (!h) return `<div class="u3-pf-head"><h3 class="u3-pf-h3">${icon('swords')}The Hunt</h3></div><p class="u3-pf-empty">No boss is live.</p>`;
  return `<div class="u3-pf-head"><h3 class="u3-pf-h3">${icon('swords')}${esc(h.name)}</h3>${rank ? `<span class="mem-rank">#${rank}</span>` : ''}</div>${body}`;
}

/** No profile (a 404) or a failed load (7.2: the error state with Try again, D-80 item 15). */
export function emptyHTML(failed) {
  const back = `<div class="u3-pf-home">${button({ label: '← Home' }).replace('<button', '<button id="memBack"')}</div>`;
  const body = failed ? stateError({ text: 'Something went wrong. Try again.' }).replace('<button', '<button id="memRetry"')
    : `<div class="u3-state"><p class="u3-msg u3-msg--error">${icon('circle-alert')}<span>This member has no profile yet.</span></p></div>`;
  return `<div class="u3-pf u3-pf--empty">${back}${body}</div>`;
}

// ---- Fit (after the browser lays the screen out) -------------------------------------------------------------------

const gapOf = (n) => parseFloat(getComputedStyle(n).columnGap) || 0;

/** Fill the achievements grid: the earned icons that fit, "+N" in the last place. */
export function fitAch(ul, done) {
  if (!ul) return;
  ul.innerHTML = '<li class="u3-pf-ab">+0</li>';
  const size = ul.firstElementChild.offsetWidth || TOKENS['ctl-sm'];   // the place size of this layout (CSS)
  ul.innerHTML = '';
  const gap = gapOf(ul);
  const cols = Math.max(1, Math.floor((ul.clientWidth + gap) / (size + gap)));
  const rows = ul.closest('.u3-pf')?.dataset.lay === 'col3' || ul.closest('.u3-pf')?.dataset.lay === 'stack'
    ? Math.max(1, Math.floor((ul.clientHeight + gap) / (size + gap))) : 1;
  const { show, more } = places(done.length, cols * rows);
  ul.innerHTML = done.slice(0, show).map((a) => `<li class="u3-pf-ab" title="${esc(a.name)}">${a.icon}</li>`).join('')
    + (more ? `<li class="u3-pf-ab u3-pf-ab--more">+${more}</li>` : '');
}

/** Size the Spotlight cards to the tile (review-2). */
export function fitSpot(row) {
  if (!row) return;
  const n = row.querySelectorAll('.u3-pf-card').length;
  row.style.removeProperty('--pf-cw');
  delete row.dataset.even;
  let w = spotWidth(row.clientWidth, row.clientHeight, n, gapOf(row));
  // the side cards may not drop below the tap size (9.1): then the three cards take one size
  if (n > 1 && w * 0.82 < TOKENS['card-mini']) { row.dataset.even = ''; w = spotWidth(row.clientWidth, row.clientHeight, n, gapOf(row), { side: 1 }); }
  if (w) row.style.setProperty('--pf-cw', `${w}px`);
}

/** The Season mini grid: whole rows only (C14). */
export function fitMini(ul, season, onlyOwned = false) {
  if (!ul) return;
  ul.innerHTML = '';
  const g = miniGrid(ul.clientWidth, ul.clientHeight, gapOf(ul));
  ul.style.setProperty('--pf-cols', String(g.cols || 1));
  const n = g.cols * g.rows;
  const list = onlyOwned ? season.filter((c) => c.owned) : season;
  ul.innerHTML = list.slice(0, n).map((c) => (c.owned ? cardLi(c, '')
    : `<li class="u3-pf-card is-lock"><span>${icon('lock', { size: 'sm' })}</span></li>`)).join('');
}

/** View all: the owned cards, the most that fit (8.1 tile), the pager under the grid (D-36). */
export function fitAll(ul, pagerBox, cards, st) {
  if (!ul) return;
  ul.innerHTML = '';
  const gap = gapOf(ul);
  let f = fitGrid(ul.clientWidth, ul.clientHeight, gap);
  // at least 2 rows (C16): smaller tiles (D-60, compact-land), never below the tap size, when the 8.1 tile gives one row
  if (f.rows < 2) { const s = fitGrid(ul.clientWidth, ul.clientHeight, gap, { min: TOKENS['card-mini'] }); if (s.rows >= 2) f = s; }
  const per = Math.max(1, f.cols * f.rows);
  const pages = Math.max(1, Math.ceil(cards.length / per));
  st.page = Math.min(Math.max(0, st.page), pages - 1);
  ul.style.setProperty('--pf-cols', String(f.cols));
  ul.style.setProperty('--pf-tile', `${f.tile}px`);
  ul.innerHTML = cards.slice(st.page * per, st.page * per + per).map((c) => cardLi(c, '')).join('') || '<li class="u3-pf-none">No cards yet.</li>';
  if (pagerBox) pagerBox.innerHTML = pages > 1 ? pager({ page: st.page + 1, pages }) : '';
}

/** The tight steps (no scroll, P0), the first step where every tile fits wins: 1 hides the rarity chips, 2 makes the
 *  identity smaller, 3 hides the status line; phones: 5 the actions in one row and the Spotlight and the Season as tabs
 *  (P1: content moves into a tab; D-113). The Wishlist is a handle strip (D-128), never in a tab. Last: a long name takes the small size. */
export function fitTight(root, pane = '', each = () => {}) {
  if (!root) return;
  delete root.dataset.tight;
  delete root.dataset.small;
  const panels = { spot: root.querySelector('.u3-pf-spot'), season: root.querySelector('.u3-pf-season') };
  Object.values(panels).forEach((n) => { if (n) { n.hidden = false; n.removeAttribute('role'); } });
  const minCard = TOKENS['card-mini'] * TOKENS['card-ratio'];
  const shown = (sel) => { const n = root.querySelector(sel); return n && n.offsetParent ? n : null; };
  const bad = () => [...root.querySelectorAll('.u3-pf-tile')].some((t) => t.offsetParent && t.scrollHeight > t.clientHeight + 1)
    || (shown('.u3-pf-spotrow .u3-pf-card') && shown('.u3-pf-spotrow').clientHeight < minCard)
    || [...root.querySelectorAll('.u3-pf-acts .u3-btn')].some((n) => n.offsetParent && n.scrollWidth > n.clientWidth + 1);
  const hasTabs = !!root.querySelector('.u3-pf-tabs');
  const steps = root.dataset.lay === 'port' && hasTabs ? [1, 2, 3, 5] : root.dataset.lay === 'land' && hasTabs ? [1, 2, 3, 5] : [1, 2, 3];
  const tabs = () => {
    const t = Number(root.dataset.tight) || 0;
    if (t < 5) return;
    const inTabs = ['spot', 'season'];
    // no tab chosen yet (pane ''): a profile with no Spotlight cards opens on the next tab that has content, not on an empty one
    const want = pane || (panels.spot && !root.querySelector('.u3-pf-spotrow .u3-pf-card') ? inTabs.find((k) => k !== 'spot' && panels[k]) : 'spot');
    const cur = inTabs.includes(want) && panels[want] ? want : 'spot';
    inTabs.forEach((k) => { const n = panels[k]; if (n) { n.setAttribute('role', 'tabpanel'); n.hidden = k !== cur; } });
    root.querySelectorAll('.u3-pf-tabs [data-seg]').forEach((b) => { const on = b.dataset.seg === `pf:${cur}`; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
  };
  each();
  for (const t of steps) { if (!bad()) break; root.dataset.tight = String(t); tabs(); each(); }
  if (bad()) { root.dataset.small = ''; each(); }
}

/** The stat values and labels stay on one line: a smaller step when one does not fit (a 9-digit count, 12.6); last, two columns. */
export function fitStats(box) {
  if (!box) return;
  delete box.dataset.fs;
  const over = () => [...box.querySelectorAll('b, span')].some((n) => n.scrollWidth > n.clientWidth);
  for (const f of ['1', '2', '3']) { if (!over()) break; box.dataset.fs = f; }
}

export { fmt };
