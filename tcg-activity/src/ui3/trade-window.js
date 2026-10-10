// UI-63: the Trade window (docs/design.md 6.5b; D-35, D-42, D-64). Approved: design repo UI-63/approved (review-2).
// A tap on a member in the Member picker (UI-65) opens it, over the Trades tab (the flag ui_v3 only): both members in
// the head, a view switch "Your cards" / "Their cards", the toolbar (search, Filters), the grid with a pager, the Gift a
// pack button, the GIVE and GET slots and the actions. One card in each slot at most (pick one, D-42).
// The pure rules are in the first part (unit-tested). The caller (src/ui-v2-social.js) gives the cards and does the calls.
import { esc, button, iconButton, searchField, pager, segmented } from './components.js';
import { icon } from './icons.js';
import { TOKENS } from '../tokens.js';
import { thumb } from '../thumb.js';
import { fitGrid } from './card-picker.js';
import { breakName } from './member-picker.js';

/** Extra copies first (D-64 item 3): the cards with 2 or more copies, then the cards with 1 copy. Inside each group the
 *  order of the list stays (a stable sort). Pure (unit-tested). */
export function orderCards(cards) {
  const list = cards || [];
  return [...list.filter((c) => (c.quantity || 0) > 1), ...list.filter((c) => !((c.quantity || 0) > 1))];
}

/** The cards that match the search (name, subject, traits) and the rarity filter ('all' or a rarity). Pure. */
export function filterCards(cards, { q = '', rarity = 'all' } = {}) {
  const t = String(q || '').trim().toLowerCase();
  return (cards || []).filter((c) => (rarity === 'all' || c.rarity === rarity)
    && (!t || [c.name, c.subject, ...(c.tags?.traits || [])].filter(Boolean).join(' ').toLowerCase().includes(t)));
}

/** The page of a list: { items, pages, page } with the page held inside 0..pages-1. Pure. */
export function pageOf(list, per, page) {
  const n = Math.max(1, per | 0);
  const pages = Math.max(1, Math.ceil((list?.length || 0) / n));
  const p = Math.max(0, Math.min(page | 0, pages - 1));
  return { items: (list || []).slice(p * n, p * n + n), pages, page: p };
}

/**
 * The grid of the approved frames (UI-63: 7 x 3 at 1280x720, 3 x 3 at 430x932 with Gift a pack): of the columns x rows whose
 * tile is card-tile to card-tile-max wide, the ones that fill at least 85% of the area height, then the most cards, then the
 * larger tile. When none fills 85%, the one with the largest used height. Pure (unit-tested).
 */
export function fitTradeGrid(width, height, gap, o = {}) {
  const min = o.min ?? TOKENS['card-tile'];
  const a = fitTradePass(width, height, gap, { ...o, min });
  // no grid fills the area at 88 px: the tile may go down to the squad size (80) before a band stays empty
  if (a.used >= 0.85 || min <= TOKENS['card-squad']) return a;
  const b = fitTradePass(width, height, gap, { ...o, min: TOKENS['card-squad'] });
  return b.used >= 0.85 ? b : a;
}
function fitTradePass(width, height, gap, { min, max = TOKENS['card-tile-max'], ratio = TOKENS['card-ratio'] }) {
  if (!(width > 0 && height > 0)) return { cols: 1, rows: 1, tile: min, used: 0 };
  const all = [];
  const cMax = Math.max(1, Math.floor((width + gap) / (min + gap)));
  for (let cols = 1; cols <= cMax; cols++) {
    const byW = (width - gap * (cols - 1)) / cols;
    const rMax = Math.max(1, Math.floor((height + gap) / (min * ratio + gap)));
    for (let rows = 1; rows <= rMax; rows++) {
      const tile = Math.floor(Math.min(max, byW, (height - gap * (rows - 1)) / rows / ratio));
      if (tile < min) continue;
      all.push({ cols, rows, tile, n: cols * rows, used: (rows * tile * ratio + gap * (rows - 1)) / height });
    }
  }
  if (!all.length) return { ...fitGrid(width, height, gap, { min, max, ratio }), used: 0 };
  const full = all.filter((c) => c.used >= 0.85);
  const pool = full.length ? full : all.filter((c) => c.used === Math.max(...all.map((x) => x.used)));
  const best = pool.reduce((a, b) => (b.n > a.n || (b.n === a.n && b.tile > a.tile) ? b : a));
  return { cols: best.cols, rows: best.rows, tile: best.tile, used: best.used };
}

/**
 * A fixed number of columns (compact-port: 4, as the approved frames): the tile follows the column width, the rows are the
 * whole rows that fit (at least 1). Pure (unit-tested).
 */
export function fitCols(width, height, gap, cols = 4, ratio = TOKENS['card-ratio']) {
  if (!(width > 0 && height > 0)) return { cols, rows: 1, tile: TOKENS['card-mini'] };
  const tile = Math.floor((width - gap * (cols - 1)) / cols);
  const rows = Math.max(1, Math.floor((height + gap) / (tile * ratio + gap)));
  return { cols, rows, tile };
}

/** The rules of the server (gift_card, create_trade_open): a card to offer must be tradeable; a card to gift also not Gold. */
export const canOffer = (c) => !!c && c.tradeable !== false;
export const canGift = (c) => canOffer(c) && c.rarity !== 'gold';

/**
 * The actions (D-35): your card only = Gift and Offer; their card only = Request; one in each = Offer. One primary
 * button (5.3). Nothing chosen = no action. Each action says whether it works now (disabled + a reason in the label, 4.9).
 * twoStep: the server rule (FEEDBACK 2026-10-01): I send ONE card, they pick theirs. The server has no request of a
 * card alone, so Request waits for the server change (D-35); with the old rule (twoStep off) Offer needs both cards.
 * Pure (unit-tested).
 */
export function actionsFor({ give = null, get = null, twoStep = true } = {}) {
  if (give && !get) {
    return [
      { id: 'gift', disabled: !canGift(give), reason: give.rarity === 'gold' ? 'Gold cannot be gifted' : (canOffer(give) ? '' : 'Locked') },
      { id: 'offer', primary: true, disabled: !canOffer(give) || !twoStep, reason: !canOffer(give) ? 'Locked' : (twoStep ? '' : 'Pick their card') },
    ];
  }
  if (!give && get) return [{ id: 'request', primary: true, disabled: true, reason: 'Not open yet' }];
  if (give && get) return [{ id: 'offer', primary: true, disabled: !canOffer(give), reason: canOffer(give) ? '' : 'Locked' }];
  return [];
}

/** The server call for an action (the paths and fields of server.js). Pure (unit-tested). */
export function planFor(action, { give = null, get = null, to, twoStep = true } = {}) {
  if (action === 'gift') return give && to ? { path: '/api/trade/gift', body: { toId: String(to), cardId: give.id } } : null;
  if (action === 'pack') return to ? { path: '/api/gift', body: { toId: String(to), amount: 1 } } : null;
  if (action === 'offer') {
    if (!give || !to) return null;
    // two-step on: only my card goes; the other member picks theirs. Off: both cards go (the old flow).
    if (twoStep) return { path: '/api/trade/offer', body: { toId: String(to), offerCardId: give.id } };
    return get ? { path: '/api/trade/offer', body: { toId: String(to), offerCardId: give.id, requestCardId: get.id } } : null;
  }
  return null;
}

// ---- the window -----------------------------------------------------------------------------------------------------
let st = null;   // the open window: { d, view, give, get, q, rarity, page: {mine, their}, per, cols, tile, panel, draft, busy, confirm }

const $ = (id) => document.getElementById(id);
const rLabel = (r) => st?.d.rarityLabel?.(r) || r;

function tileHTML(c, picked) {
  const name = esc(c.name || 'Card');
  return `<li class="u3-pk-card u3-r-${esc(c.rarity || 'normal')}${picked ? ' is-sel' : ''}" data-card="${c.id}">`
    + `<button type="button" class="u3-pk-card__pick" data-pick="${c.id}" aria-pressed="${picked ? 'true' : 'false'}" aria-label="${name}${picked ? ', chosen' : ''}">`
    + `${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" loading="lazy" draggable="false">` : ''}</button>`
    + `${picked ? `<span class="u3-tw-check" aria-hidden="true">${icon('check', { size: 'sm' })}</span>` : ''}</li>`;
}

function slotHTML(c, tag) {
  return `<div class="u3-tw-slot"><div class="u3-tw-slot__box${c ? ` is-full u3-r-${esc(c.rarity || 'normal')}` : ''}"${c ? ` title="${esc(c.name)}"` : ''}>`
    + `${c ? (c.image_url ? `<img src="${thumb(c.image_url)}" alt="${esc(c.name)}" draggable="false">` : '') : '<span aria-hidden="true">?</span>'}</div>`
    + `<span class="u3-tw-slot__tag">${tag}</span></div>`;
}

function list() {
  const base = st.view === 'mine' ? st.d.mine() : st.d.theirs();
  return orderCards(filterCards(base, { q: st.q, rarity: st.rarity }));
}

function actionHTML(a) {
  const label = { gift: 'Gift', offer: 'Offer', request: 'Request' }[a.id];
  return button({ label, icon: a.id === 'gift' ? 'gift' : null, variant: a.primary ? 'primary' : 'secondary', disabled: a.disabled, reason: a.reason || null,
    busy: st.busy === a.id, data: { act: a.id } });
}

function paint() {
  const host = $('u3TradeWin');
  if (!host || !st) return;
  const { d } = st;
  const mine = st.view === 'mine';
  const all = list();
  const pg = pageOf(all, st.per || all.length || 1, st.page[st.view]);
  st.page[st.view] = pg.page;
  const acts = actionsFor({ give: st.give, get: st.get, twoStep: d.twoStep });
  const packs = d.packs();
  const caret = document.activeElement?.classList.contains('u3-search__input') && host.contains(document.activeElement) ? document.activeElement.selectionStart : null;
  const n = st.rarity !== 'all' ? 1 : 0;
  host.innerHTML = `<section style="${st.slotW ? `--tw-slot:${st.slotW}px` : ''}" class="u3-tw${st.split ? ' is-split' : ''}${st.tight ? ' is-tight' : ''}${st.shown ? ' is-still' : ''}" role="dialog" aria-modal="true" aria-label="Trade with ${esc(d.to.name)}">`
    + `<header class="u3-tw__head"><span class="u3-tw__who">${d.avatar(d.me.id, d.me.name)}<span class="u3-tw__name">${breakName(d.me.name)}</span></span><span class="u3-tw__swap">${icon('arrow-left-right', { size: 'lg' })}</span>`
    + `<span class="u3-tw__who">${d.avatar(d.to.id, d.to.name)}<span class="u3-tw__name">${breakName(d.to.name)}</span></span></header>`
    + `<div class="u3-tw__close">${iconButton({ icon: 'x', label: 'Close', data: { backpick: '1', close: '1' } })}</div>`
    + `<div class="u3-tw__views">${segmented([{ id: 'mine', label: 'Your cards', active: mine }, { id: 'their', label: 'Their cards', active: !mine }], { label: 'Cards' })}</div>`
    + `<div class="u3-tw__tools">${searchField({ value: st.q, placeholder: st.narrow ? 'Search' : 'Search cards, tags…' })}${filtersHTML(n)}</div>`
    + `<ul class="u3-tw__grid${(st.tile || TOKENS['card-tile']) < TOKENS['card-tile'] ? ' is-small' : ''}" aria-label="${mine ? 'Your cards' : 'Their cards'}" style="--pk-cols:${st.cols || 1};--pk-tile:${st.tile || TOKENS['card-tile']}px">`
    + `${pg.items.map((c) => tileHTML(c, Number((mine ? st.give : st.get)?.id) === Number(c.id))).join('') || `<li class="u3-pk-none">${esc(st.q || st.rarity !== 'all' ? 'No cards match.' : 'No cards here.')}</li>`}</ul>`
    + `<div class="u3-tw__pager">${pager({ page: pg.page + 1, pages: pg.pages })}</div>`
    + `<div class="u3-tw__pack">${mine ? packHTML(packs) : ''}</div>`
    + `<div class="u3-tw__bar"><div class="u3-tw__slots">${slotHTML(st.give, 'GIVE')}<span class="u3-tw__swap2">${icon('arrow-left-right', { size: 'lg' })}</span>${slotHTML(st.get, 'GET')}</div>`
    + `<div class="u3-tw__acts">${acts.map(actionHTML).join('')}</div></div>`
    + `</section>${st.panel ? filterPanelHTML() : ''}${st.confirm ? confirmHTML() : ''}`;
  st.shown = true;   // the pop-in plays once, when the window opens (a repaint does not restart it)
  if (caret != null) { const i = host.querySelector('.u3-search__input'); i?.focus({ preventScroll: true }); i?.setSelectionRange(caret, caret); }
  measure();
}

// Gift a pack: always on "Your cards"; the count is in the label, and 0 disables it (4.9).
function packHTML(packs) {
  const busy = st.busy === 'pack';
  return `<button type="button" class="u3-btn u3-btn--secondary u3-btn--md" data-act="pack"${packs < 1 || busy ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>${icon('package')}<span class="u3-btn__label">Gift a pack</span><span class="u3-tw__packn">${packs | 0}</span></button>`;
}

// Filters: the label shows; in the narrow mode (the search placeholder does not fit) only the icon shows, the name stays for a reader
function filtersHTML(n) {
  const label = n ? `Filters (${n})` : 'Filters';
  return `<button type="button" class="u3-btn u3-btn--secondary u3-btn--md${st.narrow ? ' is-icon' : ''}" data-filters="1" aria-label="${label}">${icon('list-filter')}<span class="u3-btn__label">${label}</span></button>`;
}

function filterPanelHTML() {
  const opts = [{ id: 'all', label: 'All' }, ...(st.d.rarities || []).map((r) => ({ id: r, label: rLabel(r) }))];
  return `<div class="u3-scrim u3-tw-fscrim" data-u3-scrim><div class="u3-dialog u3-tw-filters" role="dialog" aria-modal="true" aria-labelledby="u3TwF">`
    + `<header class="u3-dialog__head"><h2 class="u3-dialog__title" id="u3TwF">Filters</h2>${iconButton({ icon: 'x', label: 'Close', variant: 'plain', data: { fclose: '1' } })}</header>`
    + `<div class="u3-tw-fgroup"><span class="u3-label">Rarity</span>${segmented(opts.map((o) => ({ id: `rarity:${o.id}`, label: o.label, active: st.draft === o.id })), { label: 'Rarity' })}</div>`
    + `<footer class="u3-dialog__foot">${button({ label: 'Clear', data: { fclear: '1' } })}${button({ label: 'Show cards', variant: 'primary', data: { fok: '1' } })}</footer></div></div>`;
}

// A gift cannot be undone: a dialog first (5.2 Dialog). The Offer goes out at once (it can be cancelled in Pending).
function confirmHTML() {
  const c = st.confirm;
  return `<div class="u3-scrim u3-tw-fscrim" data-u3-scrim><div class="u3-dialog" role="alertdialog" aria-modal="true" aria-labelledby="u3TwC">`
    + `<header class="u3-dialog__head"><h2 class="u3-dialog__title" id="u3TwC">${esc(c.title)}</h2>${iconButton({ icon: 'x', label: 'Close', variant: 'plain', data: { cclose: '1' } })}</header>`
    + `<footer class="u3-dialog__foot">${button({ label: 'Cancel', data: { cclose: '1' } })}${button({ label: c.primary, variant: 'primary', busy: !!st.busy, data: { cgo: c.act } })}</footer></div></div>`;
}

// The page size (3.5): the columns and rows that fit the grid area. A new size makes a new page; the first card of the page stays.
function measure() {
  const g = document.querySelector('#u3TradeWin .u3-tw__grid');
  if (!g || !st) return;
  const tw = g.closest('.u3-tw');
  const r = tw.getBoundingClientRect();
  // the size class holds while the keyboard is open (size-class.js): compact-land is always two columns, compact-port always one;
  // medium and expanded: the window box itself (wider than tall = two columns)
  const cls = document.body.dataset.size;
  const split = cls === 'compact-land' ? true : cls === 'compact-port' ? false : (document.body.hasAttribute('data-kb') ? !!st.split : r.width > r.height);   // measured on the window itself (2.1): the two-column layout when it is wider than tall
  if (!!st.split !== split) { st.split = split; st.per = 0; paint(); return; }
  // the split on a short window: the slots shrink (down to card-mini) until the left column fits (the Card picker rule)
  const sl = tw.querySelector('.u3-tw__slots');
  if (st.split && sl) {
    const next = [tw.querySelector('.u3-tw__pack:not(:empty)'), tw.querySelector('.u3-tw__acts')].find((x) => x && x.getBoundingClientRect().height);
    const over = next ? sl.getBoundingClientRect().bottom - (next.getBoundingClientRect().top - parseFloat(getComputedStyle(tw).rowGap || 0)) : 0;
    const w = st.slotW || sl.querySelector('.u3-tw-slot__box').getBoundingClientRect().width;
    if (over > 0.5 && w > TOKENS['card-mini']) { st.slotW = Math.max(TOKENS['card-mini'], Math.floor(w - over / TOKENS['card-ratio']) - 1); paint(); return; }
    // the slots are at the smallest size and the column still does not fit: Gift and Offer sit side by side (the tight mode)
    if (over > 0.5 && !st.tight) { st.tight = true; paint(); return; }
  }
  // the search placeholder must fit its box: if not, Filters shows its icon only (the narrow mode)
  const inp = tw.querySelector('.u3-search__input');
  if (inp && !st.narrow) {
    const cx = document.createElement('canvas').getContext('2d');
    cx.font = getComputedStyle(inp).font;
    if (cx.measureText(inp.placeholder).width > inp.clientWidth - parseFloat(getComputedStyle(inp).paddingLeft || 0) * 2) { st.narrow = true; paint(); return; }
  }
  const cs = getComputedStyle(g);
  const gap = parseFloat(cs.columnGap) || 0;
  const f = document.body.dataset.size === 'compact-port' ? fitCols(g.clientWidth, g.clientHeight, gap, 4) : fitTradeGrid(g.clientWidth, g.clientHeight, gap);
  const per = f.cols * f.rows;
  if (per !== st.per || f.tile !== st.tile || f.cols !== st.cols) {
    const first = st.page[st.view] * (st.per || per);
    st.page[st.view] = Math.floor(first / per);
    Object.assign(st, { per, tile: f.tile, cols: f.cols });
    paint();
  }
}

let rt = 0;
function onResize() { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (st) { st.per = 0; st.slotW = 0; st.tight = false; st.narrow = false; paint(); } }); }

function onKey(e) {
  if (!st || e.key !== 'Escape' || e.u3Done) return;
  if (document.querySelector('#viewer:not(.hidden)')) return;
  e.preventDefault();
  if (st.confirm) { st.confirm = null; paint(); } else if (st.panel) { st.panel = false; paint(); } else closeTradeWindow();
}

function onInput(e) {
  if (!e.target.classList.contains('u3-search__input')) return;
  st.q = e.target.value;
  st.page[st.view] = 0;
  paint();
}

async function run(act) {
  if (!st || st.busy) return;
  const { d } = st;
  const plan = planFor(act, { give: st.give, get: st.get, to: d.to.id, twoStep: d.twoStep });
  if (!plan) return;
  st.busy = act === 'pack' ? 'pack' : act;
  paint();
  let r = null;
  try { r = await d.send(act, plan); } catch { r = null; }
  if (!st) return;
  st.busy = null;
  st.confirm = null;
  if (r?.ok) { const done = d.onDone; closeTradeWindow(); done?.(act, r); return; }
  st.error = true;
  paint();
  d.onError?.(act);
}

async function onClick(e) {
  if (!st) return;
  const t = e.target.closest('button, [data-u3-scrim]');
  if (!t) return;
  const d = t.dataset;
  if (t.matches('[data-u3-scrim]')) {
    if (e.target !== t) return;
    if (t.classList.contains('u3-tw-fscrim')) { st.panel = false; st.confirm = null; paint(); } else closeTradeWindow();
    return;
  }
  if (d.close) { closeTradeWindow(); return; }
  if (d.seg && !st.panel) { st.view = d.seg; paint(); return; }
  if (d.pick) {
    const c = (st.view === 'mine' ? st.d.mine() : st.d.theirs()).find((x) => Number(x.id) === Number(d.pick));
    const key = st.view === 'mine' ? 'give' : 'get';
    if (c) st[key] = Number(st[key]?.id) === Number(c.id) ? null : c;   // a tap on the chosen card un-chooses it
    paint();
    return;
  }
  if (d.page) { st.page[st.view] += d.page === 'next' ? 1 : -1; paint(); return; }
  if (t.matches('.u3-ibtn') && t.closest('.u3-search')) { st.q = ''; st.page[st.view] = 0; paint(); return; }
  if (d.filters) { st.draft = st.rarity; st.panel = true; paint(); return; }
  if (d.fclose) { st.panel = false; paint(); return; }
  if (d.seg && st.panel) { st.draft = d.seg.split(':')[1]; paint(); return; }
  if (d.fclear) { st.draft = 'all'; paint(); return; }
  if (d.fok) { st.rarity = st.draft; st.panel = false; st.page.mine = 0; st.page.their = 0; paint(); return; }
  if (d.cclose) { st.confirm = null; paint(); return; }
  if (d.cgo) { run(d.cgo); return; }
  if (d.act === 'gift') { st.confirm = { act: 'gift', title: `Gift ${st.give?.name || 'this card'} to ${st.d.to.name}?`, primary: 'Gift' }; paint(); return; }
  if (d.act === 'pack') { st.confirm = { act: 'pack', title: `Gift 1 pack to ${st.d.to.name}?`, primary: 'Gift' }; paint(); return; }
  if (d.act === 'offer' || d.act === 'request') { run(d.act); }
}

/**
 * Open the window.
 * d: { me: {id, name}, to: {id, name}, mine(): cards, theirs(): cards (each { id, name, rarity, image_url, quantity, tradeable }),
 *   packs(): my pack count, twoStep: boolean, rarities: [keys], rarityLabel(key), avatar(id, name): html,
 *   send(action, plan) -> { ok } (async), onDone(action, result), onError(action), onClose() }
 */
export function openTradeWindow(d) {
  if (st) return;
  st = { d, view: 'mine', give: null, get: null, q: '', rarity: 'all', page: { mine: 0, their: 0 }, per: 0, cols: 0, tile: 0, panel: false, draft: 'all', busy: null, confirm: null };
  const host = document.createElement('div');
  host.id = 'u3TradeWin';
  host.className = 'u3-scrim u3-tw-scrim';
  host.setAttribute('data-u3-scrim', '');
  document.body.appendChild(host);
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  st.mo = new MutationObserver(onResize);
  st.mo.observe(document.body, { attributes: true, attributeFilter: ['data-kb', 'data-size', 'data-input'] });
  document.fonts?.ready.then(() => { if (st) onResize(); });
  paint();
  host.querySelector('.u3-tw')?.setAttribute('tabindex', '-1');
  host.querySelector('.u3-tw')?.focus({ preventScroll: true });
}

/** The cards or the packs changed (a poll): paint again with the new lists. */
export function refreshTradeWindow() { if (st) paint(); }
export const tradeWindowOpen = () => !!st;

export function closeTradeWindow() {
  if (!st) return;
  const done = st.d.onClose;
  $('u3TradeWin')?.remove();
  document.removeEventListener('keydown', onKey);
  removeEventListener('resize', onResize);
  st.mo?.disconnect();
  st = null;
  done?.();
}
