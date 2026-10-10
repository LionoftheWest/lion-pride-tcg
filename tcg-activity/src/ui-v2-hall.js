// The Trading Hall + Auctions (Nathan, 2026-10-01/02; designs 26 review 2 + 27, all approved; auctions
// as one list, no Gold switch). Community > Hall: Trade Hall (Wanted | For trade) and Auctions (Open |
// My auctions). The rules live in SQL (hall_auctions.sql), the data in src/hall-routes.js.
// Privacy: another member's wishlist and listed cards show here, never their collection.
import { explainBtn, maybeExplain } from './ui-v2-explain.js';
import { v2ctx, avatarHTML, paintCards, fitChildren, toast, openMember, onSwipe, ensureCatalog } from './ui-v2.js';
import { esc as esc3, button, iconButton, searchField, pager, chip, segmented, stateEmpty } from './ui3/components.js';
import { fitGrid } from './ui3/card-picker.js';
import { switchHTML, activeSwitch, switchTarget, applyHall, emptyState, notOwned, clampPage, pagesOf, manageLabel, filterCount, toggleFilter,
  NO_FILTERS, OWN_OPTIONS, RARITY_CHIPS, TYPE_CHIPS, GAME_CHIPS, fitAll } from './ui3/hall.js';
import { TOKENS } from './tokens.js';
import { cardElement, ELEMENTS, ELEMENT_ORDER } from './elements.js';
import { elIcon } from './element-icons.js';
import { thumb } from './thumb.js';
import { isPhone, isPort } from './mobile.js';
import { nameBadge, breakable } from './effects-ui.js';
import { tr, commTabs, wireCommTabs, offersAsideHTML, wireOffers, refreshOffers } from './ui-v2-social.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const fmt = (n) => Number(n || 0).toLocaleString();
const RL = (r) => ctx().RARITY_LABEL?.[r] || String(r || '').replace(/_/g, ' ');
const RANK = { normal: 0, illustrated_rare: 1, secret_rare: 2, promo: 2, full_art: 3, event: 3, gold: 4 };
const BID_GOLD = ['full_art', 'promo', 'event']; // a Gold auction takes only these (hall_auctions.sql)
const nm = (id, name) => nameBadge(id, name, isPhone());
const title = (s) => (isPhone() ? breakable(esc(s)) : esc(s));

export const hall = { sub: 'hall', view: 'wanted', aview: 'open', page: 0, data: null, held: {}, sel: null, wish: null, give: null, msg: '',
  listing: false, auctions: null, auctionsBy: {}, auction: null, bid: [], start: null, sellerWish: [], q: '', f: { ...NO_FILTERS }, fdraft: null };
const isV3 = () => document.body.classList.contains('ui-v3');

// ---- Data -------------------------------------------------------------------------------------
async function loadHall() {
  const { api } = ctx();
  const [d, h] = await Promise.all([api('/api/hall').catch(() => null), api('/api/hall/held').catch(() => ({ held: {} }))]);
  hall.data = d && !d.error ? d : { wanted: [], forTrade: [], mine: [] };
  hall.held = h.held || {};
  if (!tr.offers) await refreshOffers();
}
async function loadAuctions(view = hall.aview) {
  const [d, h] = await Promise.all([ctx().api(`/api/auctions?view=${view}`).catch(() => null), ctx().api('/api/hall/held').catch(() => ({ held: {} }))]);
  hall.auctionsBy[view] = d?.auctions || [];
  if (view === hall.aview) hall.auctions = hall.auctionsBy[view];
  hall.held = h.held || {};
}
// Community opened: load the Hall in the background, so the first switch to it is instant.
export function prefetchHall() {
  if (!hall.data) loadHall().catch(() => {});
  if (!hall.auctionsBy.open) loadAuctions('open').catch(() => {});
}
const mine = () => ctx().cache.collection?.cards || [];
const free = (c) => Math.max(0, (mine().find((x) => Number(x.id) === Number(c?.id))?.quantity || 0) - (hall.held[c?.id] || 0));

// No "Loading" screen on a switch (Nathan, 2026-10-02): the last data paints at once, a quiet refresh
// repaints only when the data changed. With no data yet, the current screen stays until it arrives.
export async function renderHall() {
  const here = () => ctx().currentView() === 'trading' && tr.tab === 'hall';
  const key = () => (hall.sub === 'auctions' ? `a:${hall.aview}` : 'h');
  const snap = () => JSON.stringify(hall.sub === 'auctions' ? hall.auctionsBy[hall.aview] : hall.data) + JSON.stringify(hall.held);
  const k = key();
  if (hall.sub === 'auctions') hall.auctions = hall.auctionsBy[hall.aview] || null;
  const cached = hall.sub === 'auctions' ? !!hall.auctions : !!hall.data;
  if (cached && ctx().cache.collection) paintHall();
  const before = cached ? snap() : null;
  if (!ctx().cache.collection) { try { await ctx().refreshOwned(); } catch { /* keep */ } }
  if (hall.sub === 'auctions') await loadAuctions(); else await loadHall();
  if (!here() || key() !== k) return; // the member moved on meanwhile
  if (!cached || snap() !== before || !ctx().cache.collection || hall.openAccepted) paintHall();
  hall.openAccepted = false; // the fresh list was searched
}
// The live trade poll: an offer arrived or closed while I look at the Hall.
export function repaintHall() { if (hall.sub === 'hall') paintHall(); }
// My wishlist changed (a card or the top want): reload the Hall data; repaint the Trade Hall grid when it shows.
export async function refreshHall() {
  if (!hall.data) return;
  await loadHall();
  if (ctx().currentView() === 'trading' && tr.tab === 'hall' && hall.sub === 'hall' && !hall.sel && !hall.listing) paintHall();
}

function paintHall() {
  if (isV3() && (hall.sub === 'auctions' || hall.listing || hall.sel)) closeHallFilters();
  if (hall.sub === 'auctions') {
    if (hall.start) return paintStart();
    if (hall.auction) return paintAuction();
    return paintAuctionGrid();
  }
  if (hall.listing) return paintListSheet();
  if (hall.sel) return paintComposer();
  return paintHallGrid();
}

// ---- The shell --------------------------------------------------------------------------------
function shell(body, { aside = '', back = null, full = true } = {}) {
  const { el } = ctx();
  // v3 (UI-30, D-67 item 1): the one switch Wanted, For trade, Auctions with the UI-00 line icons; the v2 views under it keep their own look
  const sub = isV3() ? `<div class="u3-hl__sw" id="hlSub">${switchHTML(hall.sub, hall.view)}</div>`
    : `<div class="seg" id="hlSub"><button data-s="hall" class="${hall.sub === 'hall' ? 'on' : ''}">▦<span class="bt"> Trade Hall</span></button><button data-s="auctions" class="${hall.sub === 'auctions' ? 'on' : ''}">🔨<span class="bt"> Auctions</span></button></div>`;
  // A portrait phone: the right panel is a bottom sheet (design 27): its title row is the handle.
  const sheet = isPort() && aside;
  el('main').innerHTML = `<div class="v2-trade hall-view${full ? ' hall-full' : ''}${sheet ? ` has-sheet${hall.sheet ? ' sheet-open' : ''}` : ''}">
    <section class="tr-main hl-main">
      <div class="tr-top">${commTabs()}${sub}${explainBtn(hall.sub)}<span class="grow"></span>${back ? `<button class="v2-btn" id="hlBack">←<span class="bt"> ${esc(back)}</span></button>` : ''}</div>
      ${body}
    </section>${aside}
  </div>`;
  wireCommTabs();
  // A portrait phone: the top row is full, so the ? circle goes to the end of the view's toolbar.
  const head = isPort() && el('main').querySelector('.hl-main .tr-gridhead');
  if (head) head.appendChild(el('main').querySelector('.ex-q'));
  maybeExplain(hall.sub);
  if (sheet) {
    const side = el('main').querySelector('.hall-view > aside');
    side?.classList.add('hl-sheet');
    side?.insertAdjacentHTML('afterbegin', '<button class="hl-grab" aria-label="Open or close"></button>');
    const toggle = (e) => { if (e.target.closest('button:not(.hl-grab), input, select, .of-row')) return; hall.sheet = !hall.sheet; el('main').querySelector('.hall-view')?.classList.toggle('sheet-open', hall.sheet); };
    side?.querySelector('.hl-grab')?.addEventListener('click', toggle);
    side?.querySelector('.tile-h')?.addEventListener('click', toggle);
  }
  el('hlSub').onclick = onSwitch;
  el('hlBack')?.addEventListener('click', async () => {
    Object.assign(hall, { sel: null, listing: false, auction: null, start: null, give: null, bid: [], page: 0, msg: '', sheet: false });
    await renderHall();
  });
}
// The switch (v2: Trade Hall | Auctions; v3: Wanted | For trade | Auctions)
async function onSwitch(e) {
  if (isV3()) {
    const b = e.target.closest('[data-seg]'); if (!b || b.dataset.seg === activeSwitch(hall.sub, hall.view)) return;
    const t = switchTarget(b.dataset.seg, hall.view), changed = t.sub !== hall.sub;
    Object.assign(hall, { ...t, sel: null, listing: false, auction: null, start: null, give: null, bid: [], page: 0, msg: '', sheet: false });
    if (changed) await renderHall(); else paintHall();
    return;
  }
  const b = e.target.closest('[data-s]'); if (!b || b.dataset.s === hall.sub) return;
  Object.assign(hall, { sub: b.dataset.s, sel: null, listing: false, auction: null, start: null, page: 0, msg: '' });
  await renderHall();
}
const cardImg = (c, cls = '') => (c ? `<div class="hl-card ${cls} r-${c.rarity}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt="${esc(c.name)}"></div>` : `<div class="hl-card empty ${cls}"><span>?</span></div>`);
const rarityTag = (c) => (c ? `<span class="hl-rar" style="color:var(--r-${c.rarity})">◆ ${esc(RL(c.rarity))}</span>` : '');
const left = (iso) => {
  const s = Math.max(0, (new Date(iso) - Date.now()) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return { text: d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`, soon: s < 86400 };
};
const closedText = (a) => (a.status === 'accepted' ? 'The seller accepted a bid. Bids are closed.' : a.status === 'sold' ? 'This auction is sold.' : 'This auction ended.');
const minText = (min) => {
  const parts = [];
  if (min?.count > 0 && min.rarity) parts.push(`<span class="hl-min"><b>${min.count}×</b> <i style="color:var(--r-${min.rarity})">◆ ${esc(RL(min.rarity))}</i></span>`);
  for (const c of min?.cards || []) parts.push(`<span class="hl-min card"><img src="${thumb(c.image_url)}" alt="">${esc(c.name)}</span>`);
  return parts.length ? parts.join(`<span class="hl-mode">${min.mode === 'or' ? 'or' : '+'}</span>`) : '<span class="hl-min dim">Any bid</span>';
};
const bidSummary = (cards) => {
  const by = {}; for (const c of cards) by[c.rarity] = (by[c.rarity] || 0) + 1;
  return Object.entries(by).sort((a, b) => (RANK[b[0]] ?? 0) - (RANK[a[0]] ?? 0)).map(([r, n]) => `<span><b>${n}×</b> <i style="color:var(--r-${r})">◆ ${esc(RL(r))}</i></span>`).join('');
};

// ---- Trade Hall: Wanted | For trade ----------------------------------------------------------
function paintHallGrid() {
  if (isV3()) return paintHallV3();
  const { el } = ctx();
  const d = hall.data || { wanted: [], forTrade: [], mine: [] };
  const list = hall.view === 'wanted' ? d.wanted : d.forTrade;
  const q = hall.q.trim().toLowerCase();
  const items = list.filter((x) => !q || `${x.card.name} ${x.name}`.toLowerCase().includes(q)).map((x, i) => ({ ...x.card, _it: x, _k: i }));
  shell(`<div class="tr-gridhead hl-head">
      <div class="seg" id="hlView"><button data-v="wanted" class="${hall.view === 'wanted' ? 'on' : ''}">♡ Wanted</button><button data-v="fortrade" class="${hall.view === 'fortrade' ? 'on' : ''}">🏷 For trade</button></div>
      <input class="v2-search" id="hlQ" placeholder="Search" value="${esc(hall.q)}">
      <span class="grow"></span>
      ${hall.view === 'wanted' ? '<button class="v2-btn" id="hlWish" title="My Wishlist">♡<span class="bt"> My Wishlist</span></button>' : ''}
      <button class="v2-btn gold" id="hlList">⚙ Manage My Listings <b>${d.mine.length}/5</b></button>
      <div class="v2-pager" id="hlPager"></div>
    </div>
    <div class="v2-grid" id="hlGrid" data-cap="${isPhone() ? 54 : 24}"></div>`);
  hall.tile = (c, idx, sel) => {
    const it = c._it;
    const chip = hall.view === 'wanted' ? (it.yours ? '<span class="hl-n yours">Yours</span>' : `<span class="hl-n${it.mine ? ' have' : ''}" title="Your free copies">⧉ ×${it.mine}</span>`)
      : it.mine === true ? '<span class="hl-n yours">Yours</span>' : `<span class="hl-n${it.match ? ' have' : ''}" title="Their wishlist cards you have">♡ ${it.match}</span>`;
    return `<div class="v2-cell${sel ? ' sel' : ''}" data-idx="${idx}"><div class="v2-card r-${c.rarity}">${c.image_url ? `<img src="${thumb(c.image_url)}" data-full="${c.image_url}" alt="${esc(c.name)}" loading="lazy">` : ''}</div>
      ${isPhone() ? `<div class="v2-cap hl-cap two ph"><span class="hl-who" data-member="${esc(it.player_id)}">${nm(it.player_id, it.name)}</span><span class="hl-r2">${chip}</span></div>`
        : `<div class="v2-cap hl-cap">${avatarHTML(it.player_id, it.name, 'xs')}<span class="hl-who" data-member="${esc(it.player_id)}">${nm(it.player_id, it.name)}</span>${chip}</div>`}</div>`;
  };
  paintCards(el('hlGrid'), el('hlPager'), items, hall, pickListing);
  if (!items.length) el('hlGrid').innerHTML = `<p class="v2-empty">${hall.view === 'wanted' ? 'No member has a wishlist yet. Set yours with ♡ My Wishlist.' : 'No cards are listed yet. List one with Manage My Listings.'}</p>`;
  // A member name opens their profile (the full wishlist). Capture: before the card tap opens an offer.
  el('hlGrid').addEventListener('click', (e) => { const t = e.target.closest('.hl-who[data-member]'); if (!t) return; e.stopPropagation(); openMember(t.dataset.member); }, true);
  el('hlWish')?.addEventListener('click', () => { const me = ctx().user?.(); if (me?.id) openMember(me.id); });
  el('hlView').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; hall.view = b.dataset.v; hall.page = 0; paintHall(); };
  el('hlQ').addEventListener('input', (e) => { hall.q = e.target.value; hall.page = 0; const pos = e.target.selectionStart; paintHall(); const n = el('hlQ'); n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } });
  el('hlList').onclick = async () => { try { await ctx().refreshOwned(); } catch { /* keep */ } hall.listing = true; hall.page = 0; hall.msg = ''; paintHall(); };
}

// A tap on a listing card: my own listing opens Manage, my top want my profile, any other an offer
async function pickListing(c) {
  if (hall.view === 'fortrade' && c._it.mine === true) { hall.listing = true; hall.page = 0; hall.msg = ''; paintHall(); return; }
  if (hall.view === 'wanted' && c._it.yours) { openMember(c._it.player_id); return; } // my top want: my profile Wishlist
  hall.sel = { kind: hall.view, ...c._it }; hall.give = null; hall.msg = '';
  await openComposer();
}
async function openManage() { try { await ctx().refreshOwned(); } catch { /* keep */ } hall.listing = true; hall.page = 0; hall.msg = ''; paintHall(); }

// ---- UI-30 Trade Hall lists under body.ui-v3 (src/ui3/hall.js; design repo UI-30/approved; D-67, D-80 item 21) ----------
// The same data, handlers and API calls as the v2 grid. The card face only (D-29): no member line, no "Yours", no counts.
// The grid is fitted to its box (8.1: the most cards at 88 to 112 px), the pager shows with two pages or more (D-36).
let catSrc = null, catTags = null, hlRO = null, hlItems = [], hlResizeT = null, hlResizeOn = false;
const tagsOf = (c) => {
  const cards = ctx().cache.catalog?.cards;
  if (!cards) return {};
  if (catSrc !== cards) { catSrc = cards; catTags = new Map(cards.map((x) => [Number(x.id), x.tags])); }
  return catTags.get(Number(c.id)) || {};
};
const owns = (c) => mine().some((x) => Number(x.id) === Number(c.id) && (x.quantity || 0) > 0);
function hallItemsV3() {
  const d = hall.data || { wanted: [], forTrade: [], mine: [] };
  const list = hall.view === 'wanted' ? d.wanted : d.forTrade;
  return applyHall(list, { q: hall.q, filters: hall.f, tagsOf, elementOf: cardElement, owns }).map((x, i) => ({ ...x.card, _it: x, _k: i }));
}
function tileV3(c, idx) {
  const it = c._it, off = notOwned(hall.view, it);
  return `<li class="u3-hl-card u3-r-${esc3(c.rarity || 'normal')}${off ? ' is-notowned' : ''}"><button type="button" class="u3-hl-card__pick" data-idx="${idx}" aria-label="${esc3(c.name)}, ${esc3(it.name)}${off ? ', not owned' : ''}">`
    + `${c.image_url ? `<img src="${thumb(c.image_url)}" data-full="${esc3(c.image_url)}" alt="" loading="lazy" draggable="false">` : ''}</button></li>`;
}
const searchHTML = () => searchField({ value: hall.q, placeholder: 'Search cards, tags…' });
function paintHallV3() {
  const { el } = ctx();
  const d = hall.data || { wanted: [], forTrade: [], mine: [] };
  const n = filterCount(hall.f);
  hlRO?.disconnect();
  hall.cls = document.body.dataset.size;
  el('main').innerHTML = `<div class="u3-hl">${commTabs()}${explainBtn(hall.sub)}`
    + `<div class="u3-hl__sw" id="hlSub">${switchHTML('hall', hall.view)}</div>`
    + `<div class="u3-hl__manage">${button({ label: manageLabel(d.mine.length), variant: 'primary', icon: 'settings', data: { hlmanage: '1' } })}</div>`
    + `<div class="u3-hl__wish">${button({ label: 'My wishlist', icon: 'heart', data: { hlwish: '1' } })}</div>`
    + `<div class="u3-hl__wishi">${iconButton({ icon: 'heart', label: 'My wishlist', data: { hlwish: '1' } })}</div>`
    + `<div class="u3-hl__find" id="hlSearch">${searchHTML()}</div>`
    + `<div class="u3-hl__filt">${button({ label: n ? `Filters (${n})` : 'Filters', icon: 'list-filter', data: { hlfilters: '1' } })}</div>`
    + `<ul class="u3-hl__grid" id="hlGrid" aria-label="${hall.view === 'wanted' ? 'Wanted cards' : 'Cards for trade'}"></ul><div class="u3-hl__pager" id="hlPager"></div></div>`;
  wireCommTabs();
  maybeExplain(hall.sub);
  const root = el('main').querySelector('.u3-hl');
  root.querySelector('#hlSub').onclick = onSwitch;
  root.querySelector('[data-hlmanage]').onclick = openManage;
  root.querySelectorAll('[data-hlwish]').forEach((b) => b.addEventListener('click', () => { const me = ctx().user?.(); if (me?.id) openMember(me.id); }));
  root.querySelector('[data-hlfilters]').onclick = openHallFilters;
  const find = el('hlSearch');
  find.addEventListener('input', (e) => {
    if (!e.target.classList.contains('u3-search__input')) return;
    const had = !!hall.q;
    hall.q = e.target.value; hall.page = 0;
    if (!!hall.q !== had) refreshSearch(true);   // the clear button comes and goes
    fillV3();
  });
  find.addEventListener('click', (e) => {
    if (!e.target.closest('.u3-ibtn')) return;
    hall.q = ''; hall.page = 0; refreshSearch(true); fillV3();
  });
  const g = el('hlGrid');
  g.addEventListener('click', (e) => { const b = e.target.closest('[data-idx]'); const c = b && hlItems[Number(b.dataset.idx)]; if (c) pickListing(c); });
  onSwipe(g, (dir) => { const pages = pagesOf(hlItems.length, g._per); const p = clampPage(hall.page + dir, pages); if (p !== hall.page) { hall.page = p; fillV3(); } });
  el('hlPager').onclick = (e) => {
    const b = e.target.closest('button[data-page]'); if (!b || b.disabled) return;
    hall.page += b.dataset.page === 'next' ? 1 : -1; fillV3();
  };
  if (window.ResizeObserver) { hlRO = new ResizeObserver(() => requestAnimationFrame(() => { if (el('hlGrid') === g && g.isConnected) fillV3(); })); hlRO.observe(g); }
  if (!ctx().cache.catalog) ensureCatalog().then(() => { if (el('hlGrid') === g && (hall.q || filterCount(hall.f))) fillV3(); });
  if (!hlResizeOn) { hlResizeOn = true; addEventListener('resize', onHallResize); }
  fillV3();
  document.fonts?.ready.then(() => { if (el('hlGrid') === g) fillV3(); });
}
// the search field again (the clear button), with the focus and the caret kept
function refreshSearch(focus) {
  const f = ctx().el('hlSearch'); if (!f) return;
  const a = document.activeElement, had = a && f.contains(a);
  const caret = had ? a.selectionStart : null;
  f.innerHTML = searchHTML();
  if (focus && had) { const i = f.querySelector('.u3-search__input'); i?.focus({ preventScroll: true }); try { i.setSelectionRange(caret, caret); } catch { /* */ } }
}
// the page: the grid fitted to its box, the tiles of the page, the pager
function fillV3() {
  const { el } = ctx();
  const g = el('hlGrid'); if (!g) return;
  hlItems = hallItemsV3();
  const root = g.closest('.u3-hl');
  const fit = (o) => fitGrid(g.clientWidth, g.clientHeight, parseFloat(getComputedStyle(g).columnGap) || 0, o);
  // G-099: two rows at least. A short frame first brings the rows closer (is-tight), then the cards get smaller (D-60 small tiles).
  // The pager takes room only when the cards do not all fit (has-pager), so the fit does not move when it appears.
  const solve = () => {
    root.classList.remove('is-tight');
    let r = fit();
    if (r.rows < 2) { root.classList.add('is-tight'); r = fit(); }
    if (r.rows < 2) { const s = fit({ min: TOKENS['card-mini'] }); if (s.rows >= 2) r = s; }
    return r;
  };
  root.classList.remove('has-pager');
  let f = solve();
  if (hlItems.length > f.cols * f.rows) { root.classList.add('has-pager'); f = solve(); if (hlItems.length <= f.cols * f.rows) { root.classList.remove('has-pager'); f = solve(); } }
  // every card on one page: the cards grow to fill the box (up to the largest tile)
  if (hlItems.length && hlItems.length <= f.cols * f.rows) {
    const all = fitAll(hlItems.length, g.clientWidth, g.clientHeight, parseFloat(getComputedStyle(g).columnGap) || 0, { min: f.tile, max: TOKENS['card-tile-max'], ratio: TOKENS['card-ratio'] });
    if (all) f = { ...f, ...all };
  }
  // a box under one card of the touch size (the keyboard on a short frame): no room for a card to tap, so the cards wait (the Member picker does the same)
  g.classList.toggle('is-short', f.tile < TOKENS.hit);
  const per = f.cols * f.rows;
  g._per = per;
  hall.page = clampPage(hall.page, pagesOf(hlItems.length, per));
  g.style.setProperty('--hl-cols', f.cols); g.style.setProperty('--hl-tile', `${f.tile}px`);
  const empty = emptyState(hall.view, { q: hall.q, filters: hall.f });
  g.classList.toggle('is-empty', !hlItems.length);
  const html = hlItems.length ? hlItems.slice(hall.page * per, hall.page * per + per).map((c, i) => tileV3(c, hall.page * per + i)).join('') : `<li class="u3-hl__none">${stateEmpty({ title: empty.title, line: empty.line })}</li>`;
  if (g._html !== html) { g._html = html; g.innerHTML = html; }
  const pages = pagesOf(hlItems.length, per), p = el('hlPager');
  const ph = pages > 1 ? pager({ page: hall.page + 1, pages }) : '';
  if (p && p._html !== ph) { p._html = ph; p.innerHTML = ph; }
}
// a new size class repaints the toolbar (the "?" and the wishlist button change place); the keyboard does not
function onHallResize() {
  clearTimeout(hlResizeT);
  hlResizeT = setTimeout(() => {
    if (ctx().currentView() !== 'trading' || tr.tab !== 'hall' || !isV3() || hall.sub !== 'hall' || hall.sel || hall.listing) return;
    if (document.body.dataset.size !== hall.cls && !ctx().el('u3HlF')) paintHall();
  }, 300);
}

// The Filters panel = the Collection Filters panel (D-67 item 10): no counts, no "Can ascend" (D-80 item 21)
const fchip = (key, id, label, on, extra = {}) => chip({ label, on, data: { hlf: `${key}:${id}` }, ...extra });
function filtersHTML() {
  const f = hall.fdraft;
  const group = (label, body, cls = '') => `<div class="u3-hl-fgroup"><span class="u3-label">${esc3(label)}</span><div class="u3-hl-chips${cls}">${body}</div></div>`;
  // the elements some card has (as the Collection panel); every element until the catalog is loaded
  const cat = ctx().cache.catalog?.cards;
  const have = cat ? new Set(cat.map((c) => cardElement(c.tags))) : null;
  const els = ELEMENT_ORDER.filter((e) => !have || have.has(e)).map((e) => chip({ kind: 'element', element: e, label: ELEMENTS[e].name, on: f.element === e, elementIcon: elIcon(e), data: { hlf: `element:${e}` } })).join('');
  return `<div class="u3-scrim u3-hl-fscrim" id="u3HlF" data-u3-scrim><div class="u3-dialog u3-hl-filters" role="dialog" aria-modal="true" aria-labelledby="u3HlFt" tabindex="-1">`
    + `<header class="u3-dialog__head u3-hl-fhead"><h2 class="u3-dialog__title" id="u3HlFt">Filters</h2>${segmented(OWN_OPTIONS.map(([id, label]) => ({ id: `own:${id}`, label, active: f.own === id })), { label: 'Ownership' })}${iconButton({ icon: 'x', label: 'Close filters', variant: 'panel', data: { hlfclose: '1' } })}</header>`
    + group('Rarity', RARITY_CHIPS.map(([id, l]) => fchip('rarity', id, l, f.rarity === id, { rarity: id })).join(''))
    + group('Element', els)
    + group('Type', TYPE_CHIPS.map(([id, l]) => fchip('type', id, l, f.type === id)).join(''))
    + group('Game', GAME_CHIPS.map(([id, l]) => fchip('game', id, l, f.game === id)).join(''))
    + `<footer class="u3-dialog__foot">${button({ label: 'Clear all', variant: 'ghost', data: { hlfclear: '1' } })}${button({ label: 'Confirm', variant: 'primary', data: { hlfok: '1' } })}</footer></div></div>`;
}
function paintHallFilters() {
  let host = document.getElementById('u3HlFHost');
  if (!host) { host = document.createElement('div'); host.id = 'u3HlFHost'; document.body.appendChild(host); host.addEventListener('click', onHallFilterClick); }
  host.innerHTML = filtersHTML();
  // a short frame: the gaps close up when the panel does not fit (no scroll, 3.3)
  const dlg = host.querySelector('.u3-hl-filters');
  if (dlg && dlg.scrollHeight > dlg.clientHeight + 1) dlg.classList.add('is-tight');
}
async function openHallFilters() {
  hall.fdraft = { ...hall.f };
  paintHallFilters();
  document.addEventListener('keydown', onHallFilterKey);
  document.getElementById('u3HlF')?.querySelector('.u3-hl-filters')?.focus({ preventScroll: true });
  if (!ctx().cache.catalog) ensureCatalog().then(() => { if (document.getElementById('u3HlF')) paintHallFilters(); if (ctx().el('hlGrid')) fillV3(); });
}
function closeHallFilters() {
  document.getElementById('u3HlFHost')?.remove();
  document.removeEventListener('keydown', onHallFilterKey);
  ctx().el('main')?.querySelector('[data-hlfilters]')?.focus?.({ preventScroll: true });
}
function onHallFilterKey(e) { if (e.key === 'Escape' && document.getElementById('u3HlF') && !document.querySelector('#viewer:not(.hidden)')) { e.preventDefault(); closeHallFilters(); } }
function onHallFilterClick(e) {
  const scrim = e.target.closest('[data-u3-scrim]');
  const b = e.target.closest('button');
  if (!b) { if (scrim && e.target === scrim) closeHallFilters(); return; }
  const d = b.dataset;
  if (d.hlfclose) { closeHallFilters(); return; }
  if (d.hlf) { const [k, v] = d.hlf.split(':'); hall.fdraft = toggleFilter(hall.fdraft, k, v); paintHallFilters(); return; }
  if (d.seg) { const [, v] = d.seg.split(':'); hall.fdraft = { ...hall.fdraft, own: v }; paintHallFilters(); return; }
  if (d.hlfclear) { hall.fdraft = { ...NO_FILTERS }; paintHallFilters(); return; }
  if (d.hlfok) {
    hall.f = { ...hall.fdraft }; hall.page = 0;
    closeHallFilters();
    if (ctx().el('hlGrid')) paintHallV3();
  }
}

// ---- The offer composer (an offer on a Wanted or a For trade card) -----------------------------
async function openComposer() {
  const s = hall.sel;
  const w = await ctx().api(`/api/wishlist?id=${encodeURIComponent(s.player_id)}`).catch(() => ({ slots: [] }));
  hall.wish = (w.slots || []).filter((x) => x.card);
  // Wanted: I give the card they want. For trade: I give a card from their wishlist (the same rarity).
  if (s.kind === 'wanted') hall.give = s.mine > 0 ? s.card : null;
  // Any card of that rarity (Nathan, 2026-10-02); a wishlist card I own is picked first (the one they want).
  else { const w = hall.wish.find((x) => x.mine > 0 && x.card.rarity === s.card.rarity); hall.give = w ? (mine().find((c) => Number(c.id) === Number(w.card.id)) || w.card) : null; }
  paintHall();
}
function paintComposer() {
  const { el } = ctx();
  const s = hall.sel, me = ctx().user();
  const wanted = s.kind === 'wanted';
  const g = hall.give;
  const steps = wanted ? ['You offer', `${s.name} picks`, 'You accept'] : ['You offer', `${s.name} accepts`];
  const theirs = wanted
    ? `<div class="hl-side right"><div class="tr-info"><span class="tr-who">${avatarHTML(s.player_id, s.name, 'xs')} Their offer</span><h3>${title(s.name)} picks</h3>${g ? rarityTag(g) : ''}</div>${cardImg(null)}</div>`
    : `<div class="hl-side right"><div class="tr-info"><span class="tr-who">${avatarHTML(s.player_id, s.name, 'xs')} Their offer</span><h3>${title(s.card.name)}</h3>${rarityTag(s.card)}</div>${cardImg(s.card)}</div>`;
  const yours = g
    ? `<div class="hl-side">${cardImg(g)}<div class="tr-info"><span class="tr-who">${avatarHTML(me?.id, me?.name, 'xs')} Your offer</span><h3>${title(g.name)}</h3>${rarityTag(g)}
        <span class="tr-chips">${(hall.wish || []).some((x) => Number(x.card.id) === Number(g.id)) ? '<i class="hl-wish">♡ Wishlist</i>' : ''}<i>⧉ ×${free(g)}</i></span></div></div>`
    : `<div class="hl-side">${cardImg(null)}<div class="tr-info tr-empty"><span class="tr-who">${avatarHTML(me?.id, me?.name, 'xs')} Your offer</span><h3>${wanted ? 'You have no free copy' : `Pick a ${esc(RL(s.card.rarity))} card below`}</h3></div></div>`;
  const strip = (hall.wish || []).map((x) => {
    const ok = x.mine > 0 && (wanted || x.card.rarity === s.card.rarity);
    return `<div class="hl-wcell${g && Number(g.id) === Number(x.card.id) ? ' on' : ''}${ok ? '' : ' off'}" data-id="${x.card.id}">${cardImg(x.card)}<span class="hl-n${x.mine ? ' have' : ''}">⧉ ×${x.mine}</span></div>`;
  }).join('');
  shell(`<div class="tr-compose hl-compose">
      <div class="tr-deal">${yours}<span class="tr-swap">⇄</span>${theirs}</div>
      <div class="tr-foot"><ol class="hl-steps">${steps.map((t, i) => `<li class="${i === 0 ? 'on' : ''}"><b>${i + 1}</b> ${esc(t)}</li>`).join('')}</ol>
        <span class="grow"></span><span class="tr-msg" id="hlMsg">${esc(hall.msg)}</span>
        <button class="v2-btn" id="hlClear">↺ Clear</button><button class="v2-btn gold" id="hlSend" ${g ? '' : 'disabled'}>➤ Send offer</button></div>
    </div>
    ${wanted ? `<div class="side-h hl-wh">♡ ${nm(s.player_id, s.name)}'s wishlist <span class="n">${(hall.wish || []).length}</span></div>
    <div class="hl-strip" id="hlStrip">${strip || '<p class="v2-empty">No wishlist yet.</p>'}</div>`
      : `<div class="tr-gridhead hl-head"><div class="seg"><button class="on">Your ${esc(RL(s.card.rarity))} cards</button></div><span class="hl-note dim">♡ = on ${esc(s.name)}'s wishlist</span><span class="grow"></span><div class="v2-pager" id="hlPager"></div></div>
    <div class="v2-grid" id="hlGrid"></div>`}`, { aside: offersAsideHTML(), back: 'Trade Hall', full: false });
  if (!wanted) {
    const wishIds = new Set((hall.wish || []).map((x) => Number(x.card.id)));
    const items = mine().filter((c) => c.rarity === s.card.rarity && c.tradeable !== false && free(c) > 0)
      .sort((x, y) => (wishIds.has(Number(y.id)) - wishIds.has(Number(x.id))) || (y.quantity || 0) - (x.quantity || 0));
    hall.tile = (c, idx, sel) => `<div class="v2-cell${sel ? ' sel' : ''}" data-idx="${idx}"><div class="v2-card r-${c.rarity}"><img src="${thumb(c.image_url)}" data-full="${c.image_url}" alt="${esc(c.name)}" loading="lazy"></div>
      <div class="v2-cap">${wishIds.has(Number(c.id)) ? '<span class="hl-tagc wish">♡ Wishlist</span>' : `<span class="cap-pow">⚡ ${c.power ?? ''}</span>`}<span class="cap-qty">×${free(c)}</span></div></div>`;
    paintCards(el('hlGrid'), el('hlPager'), items, hall, (c) => { hall.give = c; hall.msg = ''; paintHall(); }, g?.id);
    if (!items.length) el('hlGrid').innerHTML = `<p class="v2-empty">You have no free ${esc(RL(s.card.rarity))} card to offer.</p>`;
  }
  if (el('hlStrip')) el('hlStrip').onclick = (e) => {
    const t = e.target.closest('.hl-wcell'); if (!t || t.classList.contains('off')) return;
    const x = hall.wish.find((w) => Number(w.card.id) === Number(t.dataset.id));
    if (!wanted) { hall.give = x.card; hall.msg = ''; paintHall(); return; }
    // Wanted: another card on their wishlist is another card they want (I give it).
    hall.sel = { ...s, card: x.card, mine: x.mine }; hall.give = x.card; hall.msg = ''; paintHall();
  };
  el('hlClear').onclick = () => { hall.give = null; hall.msg = ''; paintHall(); };
  el('hlSend').onclick = async () => {
    el('hlSend').disabled = true;
    let r = null;
    try {
      r = wanted ? await ctx().apiPost('/api/trade/offer', { toId: s.player_id, offerCardId: g.id })
        : await ctx().apiPost('/api/hall/offer', { listingId: s.id, cardId: g.id });
    } catch (e) { r = e?.body || null; }
    if (r?.ok) {
      hall.msg = wanted ? `Offer sent. ${s.name} picks a card next.` : `Offer sent. ${s.name} accepts next.`;
      await Promise.all([ctx().refreshOwned(), refreshOffers(), loadHall()]);
    } else hall.msg = r?.message || 'Could not send the offer (the card may be in another offer).';
    paintHall();
  };
  wireOffers(el('main'), paintHall);
  requestAnimationFrame(() => { fitChildren(el('ofIn')); fitChildren(el('ofOut')); });
}

// ---- List a card -------------------------------------------------------------------------------
function paintListSheet() {
  const { el } = ctx();
  const d = hall.data || { mine: [] };
  const listed = new Set(d.mine.map((x) => Number(x.card?.id)));
  const items = mine().filter((c) => c.tradeable !== false && c.rarity !== 'gold' && free(c) > 0 && !listed.has(Number(c.id)))
    .sort((a, b) => (RANK[b.rarity] ?? 0) - (RANK[a.rarity] ?? 0) || (b.quantity || 0) - (a.quantity || 0));
  shell(`<div class="hl-mylist"><span class="side-h">Your listings <span class="n">${d.mine.length}/5</span></span>
      <div class="hl-lslots">${[0, 1, 2, 3, 4].map((i) => { const x = d.mine[i]; return x ? `<span class="hl-li" title="${esc(x.card?.name || '')}">${cardImg(x.card)}<b>${title(x.card?.name || '')}</b><button class="v2-icon hl-unlist" data-id="${x.id}" title="Take it off the Hall">✕</button></span>` : '<span class="hl-li empty"><i>＋</i></span>'; }).join('')}</div>
      <span class="tr-msg" id="hlMsg">${esc(hall.msg)}</span></div>
    <div class="tr-gridhead hl-head"><div class="seg"><button class="on">Your cards <b>${items.length}</b></button></div><span class="grow"></span><div class="v2-pager" id="hlPager"></div></div>
    <div class="v2-grid" id="hlGrid"></div>`, { back: 'Trade Hall' });
  hall.tile = null;
  paintCards(el('hlGrid'), el('hlPager'), items, hall, async (c) => {
    if (d.mine.length >= 5) { hall.msg = 'You can list 5 cards at a time.'; paintHall(); return; }
    let r = null;
    try { r = await ctx().apiPost('/api/hall/list', { cardId: c.id }); } catch (e) { r = e?.body || null; }
    hall.msg = r?.ok ? `${c.name} is up for trade.` : (r?.message || 'Could not list that card.');
    await loadHall(); paintHall();
  });
  el('main').querySelectorAll('.hl-unlist').forEach((b) => b.addEventListener('click', async () => {
    try { await ctx().apiPost('/api/hall/unlist', { listingId: Number(b.dataset.id) }); } catch { /* */ }
    hall.msg = 'Taken off the Hall.'; await loadHall(); paintHall();
  }));
}

// ---- Auctions: one list (Nathan, 2026-10-02: no Gold section) -----------------------------------
function paintAuctionGrid() {
  const { el } = ctx();
  const list = hall.auctions || [];
  const items = list.map((a, i) => ({ ...a.card, _a: a, _k: i }));
  shell(`<div class="tr-gridhead hl-head">
      <div class="seg" id="hlAView"><button data-v="open" class="${hall.aview === 'open' ? 'on' : ''}">🔨 Open auctions</button><button data-v="mine" class="${hall.aview === 'mine' ? 'on' : ''}">👤 My auctions</button></div>
      <span class="grow"></span><button class="v2-btn gold" id="hlStart">⚙ Manage My Listings</button><div class="v2-pager" id="hlPager"></div></div>
    <div class="v2-grid hl-agrid" id="hlGrid" data-cap="${isPhone() ? 54 : 46}"></div>`);
  hall.tile = (c, idx, sel) => {
    const a = c._a, t = left(a.ends_at);
    const waitMe = a.status === 'accepted' && a.myBid && !a.mine;
    const status = a.status === 'live' ? `<span class="hl-left${t.soon ? ' soon' : ''}">⧗ ${t.text}</span>` : waitMe ? '<span class="hl-left confirm">Confirm</span>' : `<span class="hl-left done">${a.status === 'accepted' ? 'Accepted' : a.status === 'sold' ? 'Sold' : 'Ended'}</span>`;
    return `<div class="v2-cell${sel ? ' sel' : ''}" data-idx="${idx}"><div class="v2-card r-${c.rarity}">${a.myBid ? '<span class="hl-yb">🔨 Your bid</span>' : ''}${c.image_url ? `<img src="${thumb(c.image_url)}" data-full="${c.image_url}" alt="${esc(c.name)}" loading="lazy">` : ''}</div>
      ${isPhone() ? `<div class="v2-cap hl-cap two ph"><span class="hl-who">${nm(a.seller_id, a.seller)}</span><span class="hl-r2">${status}<span class="hl-bids">🔨 ${a.bids}</span></span></div></div>` : ''}
      ${isPhone() ? '' : `<div class="v2-cap hl-cap two"><span class="hl-r1">${avatarHTML(a.seller_id, a.seller, 'xs')}<span class="hl-who">${nm(a.seller_id, a.seller)}</span>${status}</span>
        <span class="hl-r2"><span class="hl-bids">🔨 ${a.bids}</span><span class="hl-mins">${a.min.count > 0 && a.min.rarity ? `<b>${a.min.count}×</b><i style="color:var(--r-${a.min.rarity})">◆</i>` : ''}${a.min.cards.length ? `<i class="hl-plus">+</i><img src="${thumb(a.min.cards[0].image_url)}" alt="">` : ''}</span></span></div></div>`}`;
  };
  paintCards(el('hlGrid'), el('hlPager'), items, hall, async (c) => { await openAuction(c._a.id); });
  if (!items.length) el('hlGrid').innerHTML = `<p class="v2-empty">${hall.aview === 'open' ? 'No auctions are open. Start one!' : 'You have no auctions or bids.'}</p>`;
  el('hlAView').onclick = async (e) => { const b = e.target.closest('[data-v]'); if (!b || b.dataset.v === hall.aview) return; hall.aview = b.dataset.v; hall.page = 0; await renderHall(); };
  // From the bell's Confirm: open the auction that waits for me (the cached list may not have it yet).
  if (hall.openAccepted) {
    const w = list.find((a) => a.status === 'accepted' && a.myBid && !a.mine);
    if (w) { hall.openAccepted = false; openAuction(w.id); return; }
  }
  el('hlStart').onclick = async () => {
    // One live auction per member: Manage opens it; with none, it opens Start an auction.
    let my = [...(hall.auctionsBy.open || []), ...(hall.auctionsBy.mine || [])].find((a) => a.mine);
    if (!my) { const d = await ctx().api('/api/auctions?view=mine').catch(() => null); my = (d?.auctions || []).find((a) => a.mine); }
    if (my) { await openAuction(my.id); return; }
    try { await ctx().refreshOwned(); } catch { /* keep */ } // a card sold a moment ago is not offered
    hall.start = { card: null, filter: 'all', minRarity: null, minCount: 0, minCards: [], mode: 'and', days: 3, q: '', msg: '' }; hall.page = 0; hall.sheet = false; paintHall();
  };
}

// ---- Start an auction ---------------------------------------------------------------------------
const bidRarities = (gold) => (gold ? BID_GOLD : ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'promo', 'event']);
function paintStart() {
  const { el } = ctx();
  const st = hall.start;
  const filters = [['all', 'All'], ['gold', 'Gold'], ['full_art', 'Full Art'], ['secret_rare', 'Secret Rare']];
  const items = mine().filter((c) => free(c) > 0 && (st.filter === 'all' || c.rarity === st.filter))
    .sort((a, b) => (RANK[b.rarity] ?? 0) - (RANK[a.rarity] ?? 0) || (b.power || 0) - (a.power || 0));
  const c = st.card, gold = c?.rarity === 'gold';
  const allowed = bidRarities(gold);
  if (st.minRarity && !allowed.includes(st.minRarity)) st.minRarity = allowed[allowed.length > 3 ? 3 : 0];
  const cat = ctx().cache.catalog?.cards || [];
  const q = st.q.trim().toLowerCase();
  const hits = q ? cat.filter((x) => allowed.includes(x.rarity) && x.name.toLowerCase().includes(q) && !st.minCards.some((m) => m.id === x.id)).slice(0, 4) : [];
  const ends = new Date(Date.now() + st.days * 86400e3);
  const panel = `<aside class="v2-tile hl-panel"><div class="tile-h"><b>🔨 Start auction</b></div>
    ${c ? `<div class="hl-pc">${cardImg(c)}<div><h3>${title(c.name)}</h3>${rarityTag(c)}<div class="side-h">Bids</div><div class="hl-allowed">${(gold ? BID_GOLD.map((r) => `<i style="color:var(--r-${r})">◆ ${esc(RL(r))}</i>`) : ['<i>Any card but Gold</i>']).join('')}</div></div></div>` : '<p class="v2-empty">Pick the card to auction.</p>'}
    <div class="side-h">Minimum</div>
    <div class="hl-minrow"><b class="mono" id="hsCount">${st.minCount}×</b><select id="hsRarity" ${st.minCount ? '' : 'disabled'}>${allowed.map((r) => `<option value="${r}" ${st.minRarity === r ? 'selected' : ''}>◆ ${esc(RL(r))}</option>`).join('')}</select>
      <span class="grow"></span><button class="v2-icon" id="hsMinus">−</button><button class="v2-icon" id="hsPlus">＋</button></div>
    <div class="hl-qrow"><div class="seg hl-mode" id="hsMode"><button data-m="and" class="${st.mode === 'and' ? 'on' : ''}">AND</button><button data-m="or" class="${st.mode === 'or' ? 'on' : ''}">OR</button></div>
    <input class="v2-search" id="hsQ" placeholder="Ask for a card (up to 3)" value="${esc(st.q)}" ${st.minCards.length >= 3 ? 'disabled' : ''}>
    <div class="hl-hits">${hits.map((x) => `<button class="hl-hit" data-id="${x.id}">${cardImg(x, 'xs')}<span>${esc(x.name)}<br><i style="color:var(--r-${x.rarity})">◆ ${esc(RL(x.rarity))}</i></span><b>＋</b></button>`).join('')}</div></div>
    <div class="hl-chips">${st.minCards.map((x) => `<span class="hl-chip">${cardImg(x, 'xs')}${esc(x.name)}<button data-id="${x.id}" title="Remove">✕</button></span>`).join('')}</div>
    <div class="hl-minrow"><span class="side-h">Length</span><b class="mono" id="hsDays">⧗ ${st.days} day${st.days === 1 ? '' : 's'}</b><span class="dim hl-ends">ends ${ends.toLocaleDateString(undefined, { weekday: 'short' })} ${ends.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span><span class="grow"></span><button class="v2-icon" id="hsDMinus">−</button><button class="v2-icon" id="hsDPlus">＋</button></div>
    <span class="tr-msg" id="hlMsg">${esc(st.msg)}</span>
    <button class="v2-btn gold wide" id="hsGo" ${c ? '' : 'disabled'}>🔨 Start auction</button></aside>`;
  shell(`<div class="tr-gridhead hl-head"><div class="seg"><button class="on">My cards <b>${items.length}</b></button></div>
      <div class="seg" id="hsFilter">${filters.map(([v, l]) => `<button data-f="${v}" class="${st.filter === v ? 'on' : ''}">${l}</button>`).join('')}</div><span class="grow"></span><div class="v2-pager" id="hlPager"></div></div>
    <div class="v2-grid" id="hlGrid"></div>`, { aside: panel, back: 'Auctions', full: false });
  hall.tile = null;
  paintCards(el('hlGrid'), el('hlPager'), items, hall, (x) => { st.card = x; st.msg = ''; if (st.minRarity == null) st.minRarity = (x.rarity === 'gold' ? 'full_art' : 'secret_rare'); paintHall(); }, c?.id);
  el('hsFilter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; st.filter = b.dataset.f; hall.page = 0; paintHall(); };
  const setCount = (n) => { st.minCount = n; if (n && !st.minRarity) st.minRarity = allowed[0]; el('hsCount').textContent = `${n}×`; el('hsRarity').disabled = !n; if (n) el('hsRarity').value = st.minRarity; };
  const setDays = (n) => {
    st.days = n; el('hsDays').textContent = `⧗ ${n} day${n === 1 ? '' : 's'}`;
    const e2 = new Date(Date.now() + n * 86400e3), x = el('main').querySelector('.hl-ends');
    if (x) x.textContent = `ends ${e2.toLocaleDateString(undefined, { weekday: 'short' })} ${e2.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  };
  el('hsRarity').onchange = (e) => { st.minRarity = e.target.value; };
  el('hsMinus').onclick = () => setCount(Math.max(0, st.minCount - 1));
  el('hsPlus').onclick = () => setCount(Math.min(5, st.minCount + 1));
  el('hsDMinus').onclick = () => setDays(Math.max(1, st.days - 1));
  el('hsDPlus').onclick = () => setDays(Math.min(14, st.days + 1));
  el('hsMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; st.mode = b.dataset.m; el('hsMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
  // 1. Typing on a phone: the sheet fits the space above the keyboard (the visual viewport), and
  // the card picture steps aside, so the list under the box shows (IMG_2875).
  const vv = window.visualViewport;
  const fitKb = () => {
    const sh = el('main').querySelector('.hall-view > aside.hl-panel');
    const on = !!sh && !!vv && document.activeElement?.id === 'hsQ';
    document.body.classList.toggle('hl-searching', on);
    if (!on) { if (sh) { sh.style.top = ''; sh.style.height = ''; sh.style.bottom = ''; } return; }
    sh.style.top = `${Math.round(vv.offsetTop + 6)}px`; sh.style.bottom = 'auto'; sh.style.height = `${Math.round(vv.height - 12)}px`;
    el('hsQ').scrollIntoView({ block: 'start' });
  };
  if (vv && isPhone()) {
    el('hsQ').addEventListener('focus', () => { setTimeout(fitKb, 50); setTimeout(fitKb, 350); });
    el('hsQ').addEventListener('blur', () => setTimeout(fitKb, 50));
    if (!window.__hlVv) { window.__hlVv = true; vv.addEventListener('resize', () => fitKb()); }
  }
  const hitsHTML = () => {
    const qq = st.q.trim().toLowerCase();
    const hh = qq ? cat.filter((x) => allowed.includes(x.rarity) && x.name.toLowerCase().includes(qq) && !st.minCards.some((m) => m.id === x.id)).slice(0, 4) : [];
    return hh.map((x) => `<button class="hl-hit" data-id="${x.id}">${cardImg(x, 'xs')}<span>${esc(x.name)}<br><i style="color:var(--r-${x.rarity})">◆ ${esc(RL(x.rarity))}</i></span><b>＋</b></button>`).join('');
  };
  const chipsHTML = () => st.minCards.map((x) => `<span class="hl-chip">${cardImg(x, 'xs')}${esc(x.name)}<button data-id="${x.id}" title="Remove">✕</button></span>`).join('');
  const panelEl = el('main').querySelector('.hl-panel');
  const refreshPicks = () => {
    panelEl.querySelector('.hl-hits').innerHTML = hitsHTML();
    panelEl.querySelector('.hl-chips').innerHTML = chipsHTML();
    el('hsQ').disabled = st.minCards.length >= 3;
  };
  el('hsQ').addEventListener('input', (e) => { st.q = e.target.value; panelEl.querySelector('.hl-hits').innerHTML = hitsHTML(); });
  // pointerdown keeps the box focused (the keyboard stays, nothing jumps); the pick is on click.
  panelEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.hl-hit, .hl-chip button')) e.preventDefault(); });
  panelEl.addEventListener('click', (e) => {
    const hit = e.target.closest('.hl-hit');
    if (hit) { const x = cat.find((k) => Number(k.id) === Number(hit.dataset.id)); if (x && st.minCards.length < 3) st.minCards.push(x); st.q = ''; el('hsQ').value = ''; refreshPicks(); return; }
    const rm = e.target.closest('.hl-chip button');
    if (rm) { st.minCards = st.minCards.filter((x) => Number(x.id) !== Number(rm.dataset.id)); refreshPicks(); }
  });
  el('hsGo').onclick = async () => {
    el('hsGo').disabled = true;
    let r = null;
    try {
      r = await ctx().apiPost('/api/auction/start', { cardId: st.card.id, minRarity: st.minCount ? st.minRarity : null, minCount: st.minCount, minCards: st.minCards.map((x) => x.id), mode: st.mode, days: st.days });
    } catch (e) { r = e?.body || null; }
    if (!r?.ok) { st.msg = r?.message || 'Could not start the auction.'; paintHall(); return; }
    hall.start = null; toast?.(`Your auction for ${st.card.name} is open.`);
    await openAuction(r.id);
  };
}

// ---- One auction: the seller view or the bidder view ----------------------------------------------
async function openAuction(id) {
  try { await ctx().refreshOwned(); } catch { /* keep */ }
  const d = await ctx().api(`/api/auction?id=${id}`).catch(() => null);
  if (!d || d.error) { hall.auction = null; await renderHall(); return; }
  hall.auction = d; hall.bid = (d.myBid?.cards || []).map((c) => Number(c.id)); // ids (the slots look the cards up) hall.page = 0; hall.msg = '';
  if (!d.isSeller) {
    const w = await ctx().api(`/api/wishlist?id=${encodeURIComponent(d.seller_id)}`).catch(() => ({ slots: [] }));
    hall.sellerWish = (w.slots || []).filter((x) => x.card).map((x) => Number(x.card.id));
  }
  const h = await ctx().api('/api/hall/held').catch(() => ({ held: {} }));
  hall.held = h.held || {};
  paintHall();
}
function auctionPanel(a, extra) {
  const t = left(a.ends_at);
  const who = a.isSeller ? '<b>🔨 Your auction</b>' : `${avatarHTML(a.seller_id, a.seller, 'xs')}<b>${nm(a.seller_id, a.seller)}</b>`;
  return `<aside class="v2-tile hl-panel"><div class="tile-h">${isPort() ? '<b>🔨 Auction Information</b>' : who}<span class="grow"></span><span class="hl-tag" style="color:var(--r-${a.card.rarity})">◆ ${esc(RL(a.card.rarity))}</span></div>
    ${isPort() ? `<div class="hl-seller">${who}</div>` : ''}<div class="hl-big">${cardImg(a.card, 'big')}<h3>${title(a.card.name)}</h3></div>
    <div class="hl-stats"><div><span class="side-h">Minimum</span><div class="hl-mins-l">${minText(a.min)}</div></div><div><span class="side-h">Bids</span><b class="mono">${a.bidsCount}</b></div></div>
    <div class="hl-time${t.soon ? ' soon' : ''}">${a.status === 'live' || a.status === 'accepted' ? `⧗ <b class="mono">${t.text}</b><span class="dim">Ends ${new Date(a.ends_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>` : `<b>${a.status === 'sold' ? 'Sold' : 'Ended'}</b>`}</div>
    ${extra}</aside>`;
}
function paintAuction() {
  const { el } = ctx();
  const a = hall.auction;
  if (a.isSeller) return paintSeller(a);
  const gold = a.card.rarity === 'gold';
  const allowed = bidRarities(gold);
  const my = a.myBid;
  // The bidder confirms the accepted bid (two steps: the seller accepts, the bidder confirms).
  const confirm = a.status === 'accepted' && my?.status === 'accepted';
  const minIds = new Set((a.min.cards || []).map((x) => Number(x.id)));
  const wish = new Set(hall.sellerWish || []);
  const inBid = (c) => hall.bid.filter((x) => Number(x) === Number(c.id)).length;
  const items = mine().filter((c) => allowed.includes(c.rarity) && (free(c) + (my?.cards || []).filter((x) => Number(x.id) === Number(c.id)).length) > 0)
    .map((c) => ({ ...c, _tag: minIds.has(Number(c.id)) ? 'Minimum' : wish.has(Number(c.id)) ? 'Wishlist' : '' }))
    .sort((x, y) => (!!y._tag - !!x._tag) || (RANK[y.rarity] ?? 0) - (RANK[x.rarity] ?? 0));
  const byId = new Map(mine().map((c) => [Number(c.id), c]));
  const bidCards = hall.bid.map((id) => byId.get(Number(id)) || (my?.cards || []).find((x) => Number(x.id) === Number(id))).filter(Boolean);
  const meets = meetsLocal(a, bidCards);
  const best = a.best ? `<div class="hl-best"><div class="side-h">Best bid ${a.best.meets ? '<span class="hl-ok">✓ Meets minimum</span>' : ''}${a.best.mine ? ' <span class="hl-ok">You</span>' : ''}</div>
      <div class="hl-bestrow"><span class="hl-thumbs">${a.best.cards.map((x) => cardImg(x, 'xs')).join('')}</span><span class="hl-sum">${bidSummary(a.best.cards)}</span></div></div>` : '<p class="dim">No bids yet.</p>';
  shell(`<div class="hl-bid">
      <div class="hl-bidhead"><span class="side-h hl-yourbid">Your bid <span class="n">${hall.bid.length} / 5</span></span>${a.status !== 'live' && !confirm ? `<span class="hl-closed">${esc(closedText(a))}</span>` : bidCards.length ? `<span class="${meets ? 'hl-ok' : 'hl-below'}">${meets ? '✓ Meets minimum' : 'Below minimum'}</span>` : ''}
        <span class="grow"></span><span class="tr-msg" id="hlMsg">${esc(hall.msg)}</span>${my && !confirm ? '<button class="v2-btn" id="hbWithdraw">↩<span class="bt"> Withdraw</span></button>' : ''}<button class="v2-btn gold" id="hbPlace" ${bidCards.length && a.status === 'live' ? '' : 'disabled'}>🔨 <span class="bt">${my ? 'Update' : 'Place'} </span>bid</button></div>
      <div class="hl-slots">${[0, 1, 2, 3, 4].map((i) => (bidCards[i] ? `<button class="hl-slot" data-i="${i}">${cardImg(bidCards[i])}<span>${title(bidCards[i].name)}</span></button>` : '<button class="hl-slot empty"><span>＋</span><i>Add card</i></button>')).join('')}</div>
    </div>
    <div class="tr-gridhead hl-head"><div class="seg"><button class="on">My cards <b>${items.length}</b></button></div><span class="hl-note dim">${gold ? 'A Gold auction takes Full Art, Promo and Event cards.' : 'Any card but Gold.'}</span><span class="grow"></span><div class="v2-pager" id="hlPager"></div></div>
    <div class="v2-grid" id="hlGrid"></div>
    ${confirm ? `<div class="hl-modal" id="hbModal"><div class="hl-mbox"><h3>🔨 ${nm(a.seller_id, a.seller)} accepted your bid</h3>
      <ol class="hl-steps"><li class="done"><b>✓</b> ${esc(a.seller)} accepts</li><li class="on"><b>2</b> You confirm</li></ol>
      ${a.confirm_by ? `<p class="hl-deadline">⧗ Confirm within ${esc(left(a.confirm_by).text)}. After that the bid is declined and your cards are free again.</p>` : ''}
      <div class="hl-mdeal"><div><span class="side-h">Your offer</span><span class="hl-thumbs">${(my.cards || []).map((x) => cardImg(x)).join('')}</span></div><span class="tr-swap">⇄</span><div><span class="side-h">Their offer</span>${cardImg(a.card)}</div></div>
      <div class="hl-mfoot"><span class="tr-msg" id="hbMsg">${esc(hall.msg)}</span><button class="v2-btn" id="hbDecline">✕ Decline</button><button class="v2-btn gold" id="hbConfirm">✓ Confirm trade</button></div></div></div>` : ''}`,
  { aside: auctionPanel(a, best), back: 'Auctions', full: false });
  hall.tile = (c, idx, sel) => `<div class="v2-cell${sel ? ' sel' : ''}${inBid(c) ? ' in-bid' : ''}" data-idx="${idx}"><div class="v2-card r-${c.rarity}">${inBid(c) ? '<span class="hl-check">✓</span>' : ''}<img src="${thumb(c.image_url)}" data-full="${c.image_url}" alt="${esc(c.name)}" loading="lazy"></div>
    <div class="v2-cap">${c._tag ? `<span class="hl-tagc ${c._tag === 'Minimum' ? 'min' : 'wish'}">${c._tag === 'Minimum' ? '☰ Minimum' : '♡ Wishlist'}</span>` : `<span class="cap-pow">⚡ ${c.power ?? ''}</span>`}${c.quantity > 1 ? `<span class="cap-qty">×${free(c)}</span>` : ''}</div></div>`;
  paintCards(el('hlGrid'), el('hlPager'), items, hall, (c) => {
    if (a.status !== 'live') { hall.msg = closedText(a); paintHall(); return; }
    const have = free(c) + (my?.cards || []).filter((x) => Number(x.id) === Number(c.id)).length;
    const at = hall.bid.findIndex((x) => Number(x) === Number(c.id));
    if (at >= 0 && inBid(c) >= have) hall.bid.splice(at, 1); // tap again = out
    else if (hall.bid.length < 5 && inBid(c) < have) hall.bid.push(Number(c.id));
    else if (hall.bid.length >= 5) { hall.msg = 'A bid holds 5 cards.'; paintHall(); return; }
    hall.msg = ''; paintHall();
  });
  el('main').querySelectorAll('.hl-slot[data-i]').forEach((b) => b.addEventListener('click', () => { hall.bid.splice(Number(b.dataset.i), 1); paintHall(); }));
  // An empty slot: the cards below fill it (a tap there did nothing, Nathan 2026-10-02).
  el('main').querySelectorAll('.hl-slot.empty').forEach((b) => b.addEventListener('click', () => {
    if (a.status !== 'live') { hall.msg = closedText(a); paintHall(); return; }
    const g = el('hlGrid'); g?.scrollIntoView({ block: 'nearest' }); g?.classList.remove('hl-flash'); void g?.offsetWidth; g?.classList.add('hl-flash');
  }));
  el('hbPlace').onclick = async () => {
    el('hbPlace').disabled = true;
    let r = null;
    try { r = await ctx().apiPost('/api/auction/bid', { auctionId: a.id, cards: hall.bid }); } catch (e) { r = e?.body || null; }
    if (r?.ok) { hall.msg = r.meets ? 'Bid placed. It meets the minimum.' : 'Bid placed (below the minimum).'; await openAuction(a.id); hall.msg = r.meets ? 'Bid placed. It meets the minimum.' : 'Bid placed (below the minimum).'; paintHall(); }
    else { hall.msg = r?.message || 'Could not place the bid.'; paintHall(); }
  };
  el('hbWithdraw')?.addEventListener('click', async () => { try { await ctx().apiPost('/api/auction/withdraw', { auctionId: a.id }); } catch { /* */ } await openAuction(a.id); });
  el('hbConfirm')?.addEventListener('click', async () => {
    el('hbConfirm').disabled = true;
    let r = null;
    try { r = await ctx().apiPost('/api/auction/confirm', { auctionId: a.id }); } catch (e) { r = e?.body || null; }
    if (!r?.ok) { hall.msg = r?.message || 'Could not confirm.'; paintHall(); return; }
    await ctx().refreshOwned();
    toast?.(`${a.card.name} is yours!`);
    hall.auction = null; hall.aview = 'mine'; await renderHall();
  });
  el('hbDecline')?.addEventListener('click', async () => { try { await ctx().apiPost('/api/auction/decline', { auctionId: a.id }); } catch { /* */ } await openAuction(a.id); });
}
// The same rule as auction_meets() in SQL, for the live "meets" chip while picking (the server decides).
function meetsLocal(a, cards) {
  const m = a.min || {};
  const n = cards.filter((c) => m.rarity && (RANK[c.rarity] ?? 0) >= (RANK[m.rarity] ?? 0)).length;
  const countOk = !m.count || !m.rarity || n >= m.count;
  const ids = new Set(cards.map((c) => Number(c.id)));
  const cardsOk = !(m.cards || []).length || m.cards.every((c) => ids.has(Number(c.id)));
  if (m.mode === 'or' && m.count > 0 && m.rarity && (m.cards || []).length) return countOk || cardsOk;
  return countOk && cardsOk;
}
function paintSeller(a) {
  const { el } = ctx();
  const accepted = a.status === 'accepted';
  const waitFor = accepted ? (a.bids || []).find((b) => b.id === a.accepted_bid_id) : null;
  const rows = [...(a.bids || [])].sort((x, y) => ((y.id === a.accepted_bid_id) - (x.id === a.accepted_bid_id)) || (y.meets - x.meets) || (y.score - x.score));
  const bestId = rows.find((b) => b.meets)?.id;
  const ago = (iso) => ctx().ago?.(iso) || '';
  const steps = `<ol class="hl-steps">${accepted ? `<li class="done"><b>✓</b> You accept</li><li class="on"><b>2</b> ${esc(waitFor?.bidder || 'The bidder')} confirms</li>` : '<li class="on"><b>1</b> You accept</li><li><b>2</b> Bidder confirms</li>'}</ol>`;
  shell(`<div class="tr-gridhead hl-head"><div class="seg"><button class="on">Bids <b>${rows.length}</b></button></div><span class="grow"></span><span class="tr-msg" id="hlMsg">${esc(hall.msg)}</span></div>
    <div class="hl-bids" id="hlBids">${rows.map((b) => `<div class="hl-brow${b.id === a.accepted_bid_id ? ' on' : ''}${b.id === bestId ? ' best' : ''}">
        <span class="hl-bwho">${avatarHTML(b.bidder_id, b.bidder, 'xs')}<b>${nm(b.bidder_id, b.bidder)}</b><i class="dim">${esc(ago(b.at))}</i></span>
        <span class="hl-thumbs">${b.cards.map((x) => `<button class="hl-tinfo" data-id="${x.id}" title="${esc(x.name)}">${cardImg(x, 'xs')}</button>`).join('')}</span>
        <span class="hl-sum">${bidSummary(b.cards)}</span>
        ${b.id === bestId ? '<span class="hl-bestc">♛ Best</span>' : ''}<span class="${b.meets ? 'hl-ok' : 'hl-below'}">${b.meets ? '✓ Meets minimum' : '— Below minimum'}</span>
        ${b.id === a.accepted_bid_id ? `<span class="hl-wait">⧗ Waiting for ${esc(b.bidder)}${a.confirm_by ? ` · ${esc(left(a.confirm_by).text)} left` : ''}</span>` : `<button class="v2-btn ${b.meets ? 'gold' : ''} hl-accept" data-id="${b.id}" ${accepted || a.status !== 'live' ? 'disabled' : ''}>✓ Accept</button>`}
      </div>`).join('') || '<p class="v2-empty">No bids yet. Members see your auction in Open auctions.</p>'}</div>`,
  { aside: auctionPanel(a, `${steps}<span class="tr-msg">${esc(hall.msg)}</span><button class="v2-btn danger wide" id="hsClose" ${a.status === 'live' || accepted ? '' : 'disabled'}>✕ Close early</button>`), back: 'Auctions', full: false });
  requestAnimationFrame(() => fitChildren(el('hlBids')));
  el('main').querySelectorAll('.hl-accept').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    let r = null;
    try { r = await ctx().apiPost('/api/auction/accept', { bidId: Number(b.dataset.id) }); } catch (e) { r = e?.body || null; }
    hall.msg = r?.ok ? 'Accepted. The bidder confirms next.' : (r?.message || 'Could not accept.');
    await openAuction(a.id); hall.msg = r?.ok ? 'Accepted. The bidder confirms next.' : hall.msg; paintHall();
  }));
  el('main').querySelectorAll('.hl-tinfo').forEach((b) => b.addEventListener('click', () => {
    const c = (ctx().cache.catalog?.cards || []).find((x) => Number(x.id) === Number(b.dataset.id));
    if (c) ctx().openViewer?.(c);
  }));
  // Two taps (the Activity frame may block confirm()): the first one asks, the second one closes.
  el('hsClose').onclick = async () => {
    const b = el('hsClose');
    if (!b.dataset.armed) {
      b.dataset.armed = '1'; b.textContent = 'Tap again: every bid returns';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '✕ Close early'; } }, 4000);
      return;
    }
    b.disabled = true;
    try { await ctx().apiPost('/api/auction/close', { auctionId: a.id }); } catch { /* */ }
    hall.auction = null; await renderHall();
  };
}
