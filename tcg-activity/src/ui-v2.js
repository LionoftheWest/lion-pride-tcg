// UI v2 screens (docs/design.md, design/08-v3-*.png): Home, Collection, Achievements,
// member profiles. main.js owns the data, the streams, and the Hunt; this module only
// paints. It is used only when /api/flags says uiV2, so the v1 screens are untouched.

import { cardElement, ELEMENTS, ELEMENT_ORDER } from './elements.js';
import { openWishlist, closeWishlist } from './ui3/wishlist.js';
import { fillConvertButton } from './ui-v2-shop.js';
import { isLand, isPort, isPhone } from './mobile.js';
import { thumb } from './thumb.js';
import { mtToday } from './mt-time.js';
import { explainBtn, maybeExplain } from './ui-v2-explain.js';
import { flairHTML } from './flair.js';
import { fillViewerEffect, nameBadge, badgeOf } from './effects-ui.js';
import { mountBoss } from './boss-lazy.js';
import { measure, rewardOf, rewardLabel, FRAMES } from './achievements.js';
import { elIcon } from './element-icons.js';
import { modelFor as modelKey } from './boss-models.js';
import { BOSS_LIST, seedForBoss, thumbFor } from './boss-meta.js';
import { paintCollectionV3 } from './ui3/collection.js';
import * as pf3 from './ui3/profile.js';
import * as se3 from './ui3/style-editor.js';
import { openCardPicker } from './ui3/card-picker.js';
import * as hm3 from './ui3/home.js';
import { boardRows, boardHTML } from './ui3/home-boss.js';

let ctx = null; // { api, apiPost, el, esc, cache, live, show, openViewer, RARITY_LABEL, ago, features, user, currentView, refreshOwned }
export function initV2(c) { ctx = c; }
export const v2ctx = () => ctx;

const RARITY_ORDER = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'];
const TOP_RARITY = new Set(['secret_rare', 'full_art', 'gold', 'event', 'promo']);
const GAP = 14;
const CAP_H_ROW = 24; // the caption row under each card (element, power, stars, copies)

const initial = (name) => esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
function esc(s) { return ctx.esc(s ?? ''); }
const fmt = (n) => Number(n || 0).toLocaleString();

/** A round Discord avatar: the picture from /api/avatar, the initial when there is none. */
export function avatarHTML(id, name, cls = '', frame = null) {
  const img = id ? `<img src="/api/avatar/${esc(id)}" alt="" data-err="remove">` : '';
  const f = frame && FRAMES[frame] ? ` frame-${frame}` : '';
  return `<span class="v2-avatar ${cls}${f}"><span>${initial(name)}</span>${img}</span>`;
}
/** A title tag (an achievement reward) for a name. */
export const titleHTML = (t) => (t ? `<span class="v2-title">${esc(t)}</span>` : '');

// ---- Shared card data ------------------------------------------------------

// The full catalog with a collection merged in (default: the caller's).
export function mergedCards(ownedList = ctx.cache.collection?.cards || []) {
  const owned = new Map(ownedList.map((c) => [c.id, c]));
  const seasonIdx = new Map();
  return (ctx.cache.catalog?.cards || []).map((c) => {
    const s = c.season || 'Season 1';
    const n = (seasonIdx.get(s) || 0) + 1;
    seasonIdx.set(s, n);
    const mine = owned.get(c.id);
    return mine ? { ...c, ...mine, owned: true, locked: false, num: n } : { ...c, owned: false, locked: true, quantity: 0, ascension: 0, num: n };
  });
}
const cardHp = (power) => Math.max(60, Math.round((power || 0) * 1.8)); // = /api/hunt max_hp (card_max_hp floor 60)
const numLabel = (n) => `#${String(n).padStart(3, '0')}`;
function elemOf(c) { const e = cardElement(c.tags); return e ? { key: e, ...ELEMENTS[e] } : null; }

// The caller's profile (stats for the achievements, the spotlight). Loaded once per view.
let myProfile = null;
async function loadMyProfile(force) {
  if (myProfile && !force) return myProfile;
  try { myProfile = await ctx.api('/api/profile'); } catch { /* keep */ }
  return myProfile;
}
export async function ensureCatalog() {
  if (ctx.cache.catalog) return;
  // A failed load stays null (every reader uses catalog?.cards || []), so the next screen asks again.
  try { ctx.cache.catalog = await ctx.apiData('/api/catalog'); } catch { /* not cached */ }
}

// One card cell: the card image exactly as it is printed (500x700, its own frame),
// and a caption row under it. A missing card is a locked slot with its number.
export function tileHTML(c, idx, selected) {
  if (c.locked) {
    return `<div class="v2-cell${selected ? ' sel' : ''}" data-idx="${idx}"><div class="v2-card locked"><span class="lk">🔒</span><span class="num">${numLabel(c.num)}</span></div><div class="v2-cap"></div></div>`;
  }
  const el = elemOf(c);
  return `<div class="v2-cell${selected ? ' sel' : ''}" data-idx="${idx}">
    <div class="v2-card r-${c.rarity}">${c.image_url ? `<img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt="${esc(c.name)}" loading="lazy">` : ''}${flairHTML(c.ascension)}${c.can_ascend ? '<span class="asc-dot" title="Can ascend"></span>' : ''}</div>
    <div class="v2-cap">${el ? `<span class="cap-el" title="${esc(el.name)}">${elIcon(el.key)}</span>` : ''}<span class="cap-pow">⚡ ${c.power ?? ''}</span>
      ${c.ascension > 0 ? `<span class="cap-stars">${'★'.repeat(c.ascension)}</span>` : ''}${c.quantity > 1 ? `<span class="cap-qty">×${c.quantity}</span>` : ''}</div>
  </div>`;
}

// Fit a grid of cells to its box: the most cards that fit with no scroll.
// A phone hides the element icon in the caption (the card shows it), so 88 px stays readable.
const MIN_CW = () => (isPhone() ? 88 : 112);
function fitGrid(grid, n) {
  const cs = getComputedStyle(grid);
  const CAP_H = Number(grid.dataset.cap) || CAP_H_ROW; // a grid with a taller caption says so (data-cap)
  const w = grid.clientWidth || 600;
  // clientHeight includes the padding (4 px on top): without it, a second row ran 4 px past the box.
  const h = (grid.clientHeight || 420) - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  let best = { cols: 1, rows: 1, cw: 80 };
  for (let rows = 1; rows <= 4; rows++) {
    const byH = ((h - (rows - 1) * GAP) / rows - CAP_H) * 5 / 7;
    for (let cols = 2; cols <= 9; cols++) {
      const byW = (w - (cols - 1) * GAP) / cols;
      const cw = Math.floor(Math.min(byW, byH));
      if (cw < MIN_CW()) continue; // the caption (power, stars, copies) needs 112 px to stay readable (2026-10-01)
      // Prefer the largest card that still shows at least 10 slots (or all cards).
      const score = Math.min(cols * rows, Math.max(10, n)) * 1000 + cw;
      if (score > best.score || !best.score) best = { cols, rows, cw, score };
    }
  }
  // A box too small for a 112 px card: one row of the biggest cards that fit (the old 80 px
  // fallback ran out of a short Community grid, 2026-10-01), but never under 72 px: a card
  // must stay readable, so a small box shows fewer cards and the pager shows the rest.
  if (!best.score) {
    const cw = Math.max(72, Math.floor(Math.min(w, ((h - CAP_H) * 5) / 7)));
    best = { cols: Math.max(1, Math.floor((w + GAP) / (cw + GAP))), rows: 1, cw };
  }
  grid.style.setProperty('--cw', `${best.cw}px`);
  grid.style.setProperty('--cols', best.cols);
  return best.cols * best.rows;
}

// Swipe (Nathan, 2026-10-01): on a touch screen, a sideways swipe turns the page or the card.
// cb(+1) = next (swipe left), cb(-1) = previous. A vertical move or a slow drag is not a swipe.
export function onSwipe(node, cb) {
  if (!node) return;
  node._swipe = cb;
  if (node._swipeOn) return;
  node._swipeOn = true;
  node.style.touchAction = 'pan-y pinch-zoom'; // the sideways move comes to us, not the webview
  let x0 = 0, y0 = 0, t0 = 0, on = false;
  node.addEventListener('touchstart', (e) => {
    on = e.touches.length === 1;
    if (on) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }
  }, { passive: true });
  node.addEventListener('touchend', (e) => {
    if (!on) return;
    on = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4 || Date.now() - t0 > 800) return;
    node._swiped = Date.now();
    node._swipe?.(dx < 0 ? 1 : -1);
  }, { passive: true });
  // A swipe is not a tap on the card under the finger.
  node.addEventListener('click', (e) => { if (Date.now() - (node._swiped || 0) < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// Paint a paged card grid. items: cards; state: { page }; onPick(card).
export function paintCards(grid, pager, items, state, onPick, selId, dir, refit) {
  const h0 = grid.clientHeight;
  const per = fitGrid(grid, items.length);
  grid._per = per;
  const pages = Math.max(1, Math.ceil(items.length / per));
  state.page = Math.min(Math.max(0, state.page), pages - 1);
  const start = state.page * per;
  grid.innerHTML = items.length
    ? items.slice(start, start + per).map((c, i) => (state.tile || tileHTML)(c, start + i, c.id === selId)).join('')
    : '<p class="v2-empty">No cards match.</p>';
  if (dir) { grid.classList.remove('slide-next', 'slide-prev'); void grid.offsetWidth; grid.classList.add(dir === 'next' ? 'slide-next' : 'slide-prev'); }
  grid.onclick = (e) => {
    const t = e.target.closest('.v2-cell');
    const c = t && items[Number(t.dataset.idx)];
    if (c) onPick(c, t);
  };
  onSwipe(grid, (d) => {
    if (state.page + d < 0 || state.page + d > pages - 1) return;
    state.page += d;
    paintCards(grid, pager, items, state, onPick, selId, d > 0 ? 'next' : 'prev');
  });
  if (!pager) return;
  pager.innerHTML = pages > 1
    ? `<button data-p="-1" ${state.page === 0 ? 'disabled' : ''}>‹</button><span>${state.page + 1} / ${pages}</span><button data-p="1" ${state.page >= pages - 1 ? 'disabled' : ''}>›</button>`
    : '';
  pager.onclick = (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b || b.disabled) return;
    state.page += Number(b.dataset.p);
    paintCards(grid, pager, items, state, onPick, selId, Number(b.dataset.p) > 0 ? 'next' : 'prev');
  };
  // The pager is filled AFTER the grid is sized; if it wrapped the head and the grid lost
  // height, size it once more (a short window cut the second card row, 2026-10-01).
  if (!refit && grid.clientHeight !== h0) paintCards(grid, pager, items, state, onPick, selId, null, true);
}

// ---- Achievements ------------------------------------------------------------

const claimedSet = () => new Set(myProfile?.claimed || []);
function achHTML(a, big, mini) {
  const pct = Math.round((100 * a.have) / a.need);
  const claimed = claimedSet().has(a.key);
  const r = rewardOf(a.key);
  const foot = big
    ? `<div class="ah-foot"><span class="ah-reward">🎁 ${esc(rewardLabel(r))}</span>${a.done ? (claimed ? '<span class="ah-claimed">Claimed ✓</span>' : `<span class="ah-redeem" data-redeem="${esc(a.key)}">Redeem</span>`) : ''}</div>`
    : '';
  return `<button class="v2-ach${a.done ? ' done' : ''}${a.done && !claimed ? ' ready' : ''}${big ? ' big' : ''}${mini ? ' mini' : ''}" data-ach="${esc(a.key)}" title="${esc(a.desc)}">
    <div class="ah-top"><span class="ah-ico">${a.icon}</span><b>${esc(a.name)}</b><span class="ah-n">${a.done ? '✓' : `${fmt(a.have)}/${fmt(a.need)}`}</span></div>
    ${mini ? '' : `<div class="ah-desc">${esc(a.desc)}</div>`}
    <div class="ah-bar"><i style="width:${pct}%"></i></div>${foot}
  </button>`;
}

// Why an ascend was refused (ascend_card errors, ascend_guard.sql).
export const ASCEND_ERROR = {
  held: 'A copy is in a trade, an auction or a bid. Ascending keeps 1 free copy.',
  no_ascend: 'Event cards do not ascend.',
  maxed: 'This card is at ★5.',
};

// Redeem: the server checks the achievement and pays it once.
async function redeem(key, btn) {
  if (btn) { btn.textContent = 'Redeeming…'; btn.classList.add('busy'); }
  let r = null;
  try { r = await ctx.apiPost('/api/achievements/claim', { key }); } catch { r = null; }
  if (!r?.ok) {
    if (btn) { btn.textContent = r?.error === 'claimed' ? 'Claimed ✓' : 'Try again'; btn.classList.remove('busy'); }
    return;
  }
  myProfile = { ...(myProfile || {}), claimed: [...(myProfile?.claimed || []), key] };
  ctx.refreshPacks?.();
  const rw = r.reward || rewardOf(key);
  if (rw?.title || rw?.frame) toastAction(`🎁 ${rewardLabel(rw)}`, 'Equip now', () => equipTitle(rw.title || null, rw.frame || null));
  else toast(`🎁 ${rewardLabel(rw)}`);
  loadMyProfile(true).then(() => { refreshCollectionBadge(); if (ctx.currentView() === 'collection') renderCollectionV2(); });
}
async function redeemAll(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Redeeming…'; }
  let r = null;
  try { r = await ctx.apiPost('/api/achievements/claim-all', {}); } catch { r = null; }
  if (!r?.ok) { if (btn) { btn.disabled = false; btn.textContent = 'Try again'; } return; }
  ctx.refreshPacks?.();
  const parts = [r.packs ? `${r.packs} pack${r.packs === 1 ? '' : 's'}` : null, r.titles?.length ? `${r.titles.length} title${r.titles.length === 1 ? '' : 's'}` : null, r.frames?.length ? `${r.frames.length} frame${r.frames.length === 1 ? '' : 's'}` : null].filter(Boolean);
  const msg = `🎁 ${r.claimed.length} redeemed${parts.length ? ` · ${parts.join(' + ')}` : ''}`;
  if (r.titles?.length || r.frames?.length) toastAction(msg, 'Choose title', () => openSpotEditor()); else toast(msg);
  await loadMyProfile(true);
  refreshCollectionBadge();
  if (ctx.currentView() === 'collection') renderCollectionV2();
}
// The Collection dock number (Nathan, 2026-10-03): the cards that can ascend now + the achievements
// ready to redeem, one red number like the Hunt dot. Refreshed when the collection or the profile
// changes (after a pack, a trade, an ascend, a redeem) - no timer.
export async function refreshCollectionBadge({ profile = false } = {}) {
  if (!ctx) return;
  await Promise.all([ensureCatalog(), loadMyProfile(profile)]);
  const asc = (ctx.cache.collection?.cards || []).filter((c) => c.can_ascend).length;
  const ach = measure(mergedCards(), myProfile?.stats).filter((a) => a.done && !claimedSet().has(a.key)).length;
  const btn = document.querySelector('#dock .dk[data-view="collection"]');
  if (!btn) return;
  let b = btn.querySelector('.cnt');
  if (!b) { btn.insertAdjacentHTML('beforeend', '<b class="cnt"></b>'); b = btn.querySelector('.cnt'); }
  const n = asc + ach;
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('on', n > 0);
  btn.title = n ? [asc ? `${asc} can ascend` : '', ach ? `${ach} to redeem` : ''].filter(Boolean).join(' · ') : '';
}
// A toast with one action button (for example Equip after a title).
export function toastAction(text, label, fn) {
  const n = document.createElement('div');
  n.className = 'v2-toast act';
  n.innerHTML = `<span>${esc(text)}</span><button class="v2-btn gold">${esc(label)}</button>`;
  n.querySelector('button').addEventListener('click', () => { n.remove(); fn(); });
  document.body.appendChild(n);
  setTimeout(() => n.classList.add('out'), 7000);
  setTimeout(() => n.remove(), 7600);
}
async function equipTitle(title, frame) {
  const next = { title: title ?? myProfile?.title ?? null, frame: frame ?? myProfile?.frame ?? null };
  const r = await ctx.apiPost('/api/cosmetics', next).catch(() => null);
  if (r && r.ok !== false) { myProfile = { ...(myProfile || {}), ...next }; toast(title ? `🎖 Title equipped: ${title}` : '🖼 Frame equipped'); paintProfile(); }
  else toast('Could not equip it');
}
export function toast(text) {
  const n = document.createElement('div');
  n.className = 'v2-toast';
  n.textContent = text;
  document.body.appendChild(n);
  setTimeout(() => n.classList.add('out'), 2600);
  setTimeout(() => n.remove(), 3200);
}

// ---- Collection ------------------------------------------------------------

const col = { season: null, rarity: 'all', element: null, type: null, game: null, own: 'all', q: '', page: 0, sel: null, view: 'cards', achKey: null, achPage: 0, detailPage: 0, boss: 0 };
// The Raid Bosses tab: the rigged model bosses (the ones the weekly hunt spawns).
const RAID_BOSSES = BOSS_LIST.filter((b) => modelKey(`arch:${b.arch}`));
let galBoss = null; // the live boss in the Raid Bosses panel
function disposeGalBoss() { if (galBoss) { try { galBoss.dispose(); } catch { /* ignore */ } galBoss = null; } }
const TYPES = [['character', 'Character'], ['creature', 'Creature'], ['moment', 'Moment'], ['item', 'Item'], ['place', 'Place']];
const GAMES = [['smash', 'Smash Bros'], ['pokemon', 'Pokemon'], ['party', 'Party'], ['minecraft', 'Minecraft'], ['meme', 'Memes'], ['community', 'Community']];
const hasFilters = () => col.rarity !== 'all' || col.element || col.type || col.game || col.own !== 'all' || col.q.trim();
let colItems = [];
// The Cards tab of a member with the v3 flag (settings.ui_v3): the v3 Collection (UI-07).
const v3Cards = () => document.body.classList.contains('ui-v3') && col.view === 'cards';
const colTabBar = (achDone, achN, ready) => `<div class="seg col-tabs"><button data-tab="cards" class="${col.view === 'cards' ? 'on' : ''}">Cards</button>
    <button data-tab="ach" class="${col.view === 'ach' || col.view === 'achDetail' ? 'on' : ''}">Achievements <i>${achDone}/${achN}</i>${ready ? `<b class="tab-dot">${ready}</b>` : ''}</button>
    <button data-tab="bosses" class="${col.view === 'bosses' ? 'on' : ''}">Raid Bosses <i>${RAID_BOSSES.length}</i></button></div>`;
function wireColTabs() {
  ctx.el('main').querySelector('.col-tabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    col.view = b.dataset.tab === 'ach' ? 'ach' : b.dataset.tab === 'bosses' ? 'bosses' : 'cards';
    renderCollectionV2();
  });
}

export async function renderCollectionV2() {
  const { el } = ctx;
  disposeGalBoss();
  if (!ctx.cache.catalog) el('main').innerHTML = '<div class="v2-loading">Loading…</div>';
  await Promise.all([ensureCatalog(), loadMyProfile()]);
  if (ctx.currentView() !== 'collection') return;
  if (!ctx.cache.catalog) { // the catalog did not load: a Retry, not a page of empty slots
    if (v3Cards()) { paintCollectionV3(el('main'), { error: true, rerender: () => renderCollectionV2() }, { tabBar: colTabBar(0, 0, 0) }); wireColTabs(); return; }
    el('main').innerHTML = '<div class="v2-loading">Could not load the cards. <button class="v2-btn" id="colRetry">Retry</button></div>';
    el('colRetry')?.addEventListener('click', () => renderCollectionV2());
    return;
  }
  const cards = mergedCards();
  const seasons = [...new Set(cards.map((c) => c.season || 'Season 1'))];
  if (!seasons.includes(col.season)) col.season = seasons[0] || 'Season 1';
  const inSeason = cards.filter((c) => (c.season || 'Season 1') === col.season);
  const achs = measure(cards, myProfile?.stats);
  const achDone = achs.filter((a) => a.done).length;
  const ready = achs.filter((a) => a.done && !claimedSet().has(a.key)).length;
  const cnt = (f) => inSeason.filter(f).length;

  // One panel, filters only (Nathan: "ONE thing, which is just a filtered panel").
  const chip = (group, value, label, on, n) => `<button class="f-chip${on ? ' on' : ''}" data-f="${group}" data-v="${esc(value)}">${label}${n != null ? `<i>${n}</i>` : ''}</button>`;
  const setRows = seasons.map((s) => {
    const set = cards.filter((c) => (c.season || 'Season 1') === s);
    const have = set.filter((c) => c.owned).length;
    return `<button class="side-row set${s === col.season ? ' on' : ''}" data-season="${esc(s)}"><span>${esc(s)}</span><span class="n">${have}/${set.length}</span><i class="bar"><i style="width:${Math.round((100 * have) / (set.length || 1))}%"></i></i></button>`;
  }).join('');
  const rarityChips = RARITY_ORDER.filter((r) => inSeason.some((c) => c.rarity === r))
    .map((r) => chip('rarity', r, `<b class="dia" style="--rc:var(--r-${r})">◆</b>${esc(ctx.RARITY_LABEL[r] || r)}`, col.rarity === r, cnt((c) => c.rarity === r))).join('');
  const elemBtns = ELEMENT_ORDER.filter((e) => inSeason.some((c) => cardElement(c.tags) === e))
    .map((e) => `<button class="el-btn${col.element === e ? ' on' : ''}" data-el="${e}" title="${ELEMENTS[e].name} · ${cnt((c) => cardElement(c.tags) === e)}">${elIcon(e)}</button>`).join('');
  const typeChips = TYPES.filter(([k]) => inSeason.some((c) => c.tags?.type === k)).map(([k, l]) => chip('type', k, l, col.type === k)).join('');
  const gameChips = GAMES.filter(([k]) => inSeason.some((c) => [].concat(c.tags?.origin || []).includes(k))).map(([k, l]) => chip('game', k, l, col.game === k)).join('');
  const ownSeg = [['all', 'All'], ['owned', 'Owned'], ['missing', 'Missing']].map(([v, l]) => `<button data-own="${v}" class="${col.own === v ? 'on' : ''}">${l}</button>`).join('');

  const tabs = `${colTabBar(achDone, achs.length, ready)}${explainBtn('collection')}`;
  // v3 (body.ui-v3, UI-07): the Cards tab is the v3 Collection (src/ui3/collection.js). Achievements and Bosses stay v2.
  if (v3Cards()) {
    const inUse = (list, key) => list.filter(([k]) => inSeason.some((c) => (key === 'type' ? c.tags?.type === k : [].concat(c.tags?.origin || []).includes(k))));
    paintCollectionV3(el('main'), {
      col, cards, seasons, inSeason, rarityLabel: ctx.RARITY_LABEL,
      rarities: RARITY_ORDER.filter((r) => inSeason.some((c) => c.rarity === r)),
      elements: ELEMENT_ORDER.filter((e) => inSeason.some((c) => cardElement(c.tags) === e)),
      types: inUse(TYPES, 'type'), games: inUse(GAMES, 'game'),
      elementName: (e) => ELEMENTS[e]?.name || e, elIcon, elementOf: (c) => cardElement(c.tags), flair: flairHTML, thumb, onSwipe,
      openCard: (c, list) => ctx.openViewer(c, { list }),
      status: () => colStatus(), rerender: () => renderCollectionV2(),
    }, { tabBar: colTabBar(achDone, achs.length, ready), help: explainBtn('collection') });
    wireColTabs();
    maybeExplain('collection');
    return;
  }
  let center;
  if (col.view === 'bosses') {
    center = `<div class="v2-col-head">${tabs}<span class="grow"></span></div>
      <div class="v2-boss-grid" id="bossGrid">${RAID_BOSSES.map((b, i) => `<button class="boss-cell${i === col.boss ? ' on' : ''}" data-bi="${i}">
        <img src="${thumbFor(b)}" alt="" loading="lazy"><span>${esc(b.title)}</span></button>`).join('')}</div>`;
  } else if (col.view === 'ach') {
    center = `<div class="v2-col-head">${tabs}<span class="grow"></span>${ready ? `<span class="ach-ready">🎁 ${ready} to redeem</span><button class="v2-btn gold ach-all" id="achAll">Redeem All</button>` : ''}<div class="v2-pager" id="achPager"></div></div>
      <div class="v2-ach-grid" id="achGrid"></div>`;
  } else if (col.view === 'achDetail') {
    const a = achs.find((x) => x.key === col.achKey);
    center = a ? achDetailHead(a) : '';
  } else {
    const filtered = colFiltered();
    const sub = hasFilters()
      ? `${filtered.length} cards · ${filtered.filter((c) => c.owned).length} owned`
      : `${inSeason.filter((c) => c.owned).length}/${inSeason.length} · ${Math.round((100 * inSeason.filter((c) => c.owned).length) / (inSeason.length || 1))}%`;
    // A phone: the element buttons sit in the head row, beside the set name (design 24).
    center = `<div class="v2-col-head">${tabs}<h2 class="col-title">${esc(col.season)} <span class="sub">${sub}</span></h2>${isPhone() ? `<div class="el-grid head-el">${elemBtns}</div>` : ''}<span class="grow"></span><div class="v2-pager" id="colPager"></div></div>
      <div class="v2-grid" id="colGrid"></div>`;
  }

  // The pure Achievements view shows only achievements (no card panel).
  // A phone held upright (design 25): the search and a Filters button on top; the filter
  // panel opens as a sheet over the screen.
  const search = `<input class="v2-search" id="colSearch" placeholder="Search cards, tags…" value="${esc(col.q)}">`;
  el('main').innerHTML = `<div class="v2-collection${col.view === 'ach' ? ' ach-mode' : ''}${col.view === 'bosses' ? ' boss-mode' : ''}">
    ${isPort() ? `<div class="m-colbar">${search}<button class="v2-btn${hasFilters() ? ' on' : ''}" id="colFilters">☰ Filters</button></div>` : ''}
    <aside class="v2-side filters">
      <div class="f-head"><b>Filters</b>${hasFilters() ? '<button class="link-btn" id="colClear">Clear all</button>' : ''}${isPort() ? '<button class="v2-icon" id="colFiltersX" aria-label="Close">✕</button>' : ''}</div>
      ${isPort() ? '' : search}
      ${seasons.length > 1 ? `<div class="side-h">Set</div>${setRows}` : ''}
      <div class="seg f-own">${ownSeg}</div>
      <div class="side-h">Rarity</div><div class="f-chips">${rarityChips}</div>
      ${isPhone() ? '' : `<div class="side-h">Element</div><div class="el-grid">${elemBtns}</div>`}
      <div class="side-h">Type</div><div class="f-chips">${typeChips}</div>
      <div class="side-h">Game</div><div class="f-chips">${gameChips}</div>
    </aside>
    <section class="v2-center" id="colCenter">${center}</section>
    ${col.view === 'ach' ? '' : '<aside class="v2-panel" id="colPanel"></aside>'}
  </div>`;

  const toCards = () => { col.view = 'cards'; col.page = 0; };
  // The sheet stays open while the member taps filters (each tap paints the screen again).
  const sheet = el('main').querySelector('.v2-side.filters');
  if (isPort() && col.sheet) sheet?.classList.add('m-show');
  el('colFilters')?.addEventListener('click', () => { col.sheet = true; sheet?.classList.add('m-show'); fitChips(sheet); });
  el('colFiltersX')?.addEventListener('click', () => { col.sheet = false; sheet?.classList.remove('m-show'); });
  el('colSearch').addEventListener('input', (e) => {
    col.q = e.target.value; col.page = 0;
    if (col.view !== 'cards') { toCards(); renderCollectionV2().then(() => { const s = el('colSearch'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }); return; }
    paintColGrid(); paintHead();
  });
  const side = el('main').querySelector('.v2-side');
  side.addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    const set = e.target.closest('[data-season]');
    const elb = e.target.closest('.el-btn');
    const own = e.target.closest('[data-own]');
    if (f) { const k = f.dataset.f; const v = f.dataset.v; col[k] = col[k] === v ? (k === 'rarity' ? 'all' : null) : v; }
    else if (set) col.season = set.dataset.season;
    else if (elb) col.element = col.element === elb.dataset.el ? null : elb.dataset.el;
    else if (own) col.own = own.dataset.own;
    else if (e.target.closest('#colClear')) { col.rarity = 'all'; col.element = null; col.type = null; col.game = null; col.own = 'all'; col.q = ''; }
    else return;
    toCards(); renderCollectionV2();
  });
  wireColTabs();
  el('achAll')?.addEventListener('click', () => redeemAll(el('achAll')));
  // An achievement opens its detail (the cards it needs); Redeem pays it.
  el('colCenter').addEventListener('click', (e) => {
    const hel = e.target.closest('.head-el .el-btn');
    if (hel) { col.element = col.element === hel.dataset.el ? null : hel.dataset.el; toCards(); renderCollectionV2(); return; }
    const bc = e.target.closest('[data-bi]');
    if (bc) {
      col.boss = Number(bc.dataset.bi);
      el('bossGrid').querySelectorAll('.boss-cell').forEach((x) => x.classList.toggle('on', x === bc));
      paintBossPanel();
      if (isPhone()) el('colPanel')?.classList.add('m-open');
      return;
    }
    const r = e.target.closest('[data-redeem]');
    if (r) { e.stopPropagation(); redeem(r.dataset.redeem, r); return; }
    const b = e.target.closest('[data-ach]');
    if (!b) return;
    col.view = 'achDetail'; col.achKey = b.dataset.ach; col.detailPage = 0;
    renderCollectionV2();
  });

  requestAnimationFrame(() => { fitChips(side); });
  maybeExplain('collection');
  // Ready to redeem first, then the ones in progress, then the ones already claimed.
  const order = (a) => (a.done ? (claimedSet().has(a.key) ? 2 : 0) : 1);
  if (col.view === 'ach') paintAch([...achs].sort((a, b) => order(a) - order(b)));
  else if (col.view === 'achDetail') paintAchDetail(achs.find((x) => x.key === col.achKey));
  else if (col.view === 'bosses') { paintBossPanel(); return; }
  else paintColGrid();
  const selCard = cards.find((c) => c.id === col.sel) || inSeason.find((c) => c.owned) || inSeason[0];
  if (col.view !== 'ach') paintPanel(selCard);
}

// The filter panel never scrolls: when it is too tall, the chip counts go, then the
// long chip rows become one row each.
function fitChips(side) {
  if (!side) return;
  const over = () => side.scrollHeight > side.clientHeight + 1;
  if (over()) side.classList.add('tight');
  if (over()) side.classList.add('tighter');
  // A phone: the last filter groups (Game, then Type) go when they still do not fit. The search
  // box still finds those tags.
  const heads = [...side.querySelectorAll('.side-h')];
  while (over() && heads.length > 1) { const h = heads.pop(); h.classList.add('hidden'); h.nextElementSibling?.classList.add('hidden'); }
}

function paintHead() {
  // The header sub-line follows the search as the member types.
  const { el } = ctx;
  const h = el('colCenter')?.querySelector('.v2-col-head .sub');
  if (!h || col.view !== 'cards') return;
  const f = colFiltered();
  if (hasFilters()) h.textContent = `${f.length} cards · ${f.filter((c) => c.owned).length} owned`;
}

// The achievements grid, paged: a page holds the cards that fully fit (no scrolling).
function paintAch(achs, dir) {
  const { el } = ctx;
  const grid = el('achGrid');
  if (!grid) return;
  grid.innerHTML = achs.map((a) => achHTML(a, true)).join('');
  const bottom = grid.getBoundingClientRect().bottom;
  const per = Math.max(1, [...grid.children].filter((n) => n.getBoundingClientRect().bottom <= bottom + 1).length);
  const pages = Math.max(1, Math.ceil(achs.length / per));
  col.achPage = Math.min(Math.max(0, col.achPage), pages - 1);
  grid.innerHTML = achs.slice(col.achPage * per, col.achPage * per + per).map((a) => achHTML(a, true)).join('');
  if (dir) { grid.classList.remove('slide-next', 'slide-prev'); void grid.offsetWidth; grid.classList.add(dir === 'next' ? 'slide-next' : 'slide-prev'); }
  const pager = el('achPager');
  pager.innerHTML = pages > 1
    ? `<button id="aPrev" ${col.achPage === 0 ? 'disabled' : ''}>‹</button><span>${col.achPage + 1} / ${pages}</span><button id="aNext" ${col.achPage >= pages - 1 ? 'disabled' : ''}>›</button>`
    : '';
  el('aPrev')?.addEventListener('click', () => { col.achPage -= 1; paintAch(achs, 'prev'); });
  el('aNext')?.addEventListener('click', () => { col.achPage += 1; paintAch(achs, 'next'); });
}

// One achievement opened: its progress, and the cards it needs (owned ones in full
// colour, missing ones as the normal locked slot).
function achDetailHead(a) {
  const pct = Math.round((100 * a.have) / a.need);
  return `<div class="v2-col-head ach-head">
      <button class="v2-icon" id="achBack" aria-label="Back">‹</button>
      <span class="ah-ico big">${a.icon}</span>
      <h2>${esc(a.name)} <span class="sub">${esc(a.desc)} · ${a.done ? 'Complete' : `${fmt(a.have)} / ${fmt(a.need)}`} · 🎁 ${esc(rewardLabel(rewardOf(a.key)))}</span></h2>
      <span class="grow"></span>${a.done ? (claimedSet().has(a.key) ? '<span class="ah-claimed">Claimed ✓</span>' : `<button class="v2-btn gold" data-redeem="${esc(a.key)}">🎁 Redeem</button>`) : ''}<div class="v2-pager" id="detPager"></div></div>
    <div class="ah-bar wide"><i style="width:${pct}%"></i></div>
    ${a.set ? '<div class="v2-grid" id="detGrid"></div>' : `<div class="ach-stat"><b>${fmt(a.have)}</b><span>of ${fmt(a.need)}</span></div>`}`;
}
function paintAchDetail(a) {
  const { el } = ctx;
  el('achBack')?.addEventListener('click', () => { col.view = 'ach'; renderCollectionV2(); });
  const grid = el('detGrid');
  if (!a || !grid) return;
  const items = [...a.set].sort((x, y) => (y.owned - x.owned) || (x.num - y.num));
  const st = { page: col.detailPage };
  paintCards(grid, el('detPager'), items, st, (c, t) => { col.detailPage = st.page; pickCard(c, t, grid, items); }, col.sel);
}

function colFiltered() {
  const q = col.q.trim().toLowerCase();
  return mergedCards().filter((c) => {
    if ((c.season || 'Season 1') !== col.season) return false;
    if (col.rarity !== 'all' && c.rarity !== col.rarity) return false;
    if (col.element && cardElement(c.tags) !== col.element) return false;
    if (col.type && c.tags?.type !== col.type) return false;
    if (col.game && ![].concat(c.tags?.origin || []).includes(col.game)) return false;
    if (col.own === 'owned' && !c.owned) return false;
    if (col.own === 'missing' && c.owned) return false;
    if (q) {
      const t = c.tags || {};
      const hay = [c.name, c.subject, t.type, t.class, t.origin, ...(t.traits || []), ...(t.genre || [])].flat().filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Tap a card: it becomes the panel card, and an owned card opens in the 3D viewer
// right away (Nathan: no extra "View card" click).
// The list the open card came from (the grid order = the card numbers): a swipe in the phone card
// view and the arrows in the 3D viewer step through it.
let panelList = [];
function pickCard(c, node, grid, list) {
  panelList = list || [];
  col.sel = c.id;
  grid.querySelectorAll('.v2-cell.sel').forEach((n) => n.classList.remove('sel'));
  node?.classList.add('sel');
  // A phone has no room for the side panel: the panel opens as the full-screen card view
  // (designs 24 + 25), and a tap on its big card opens the 3D viewer.
  if (isPhone()) { ctx.el('colPanel')?.classList.add('m-open'); paintPanel(c); return; }
  paintPanel(c);
  if (!c.locked) ctx.openViewer(c, viewerNav());
}
// The 3D viewer steps through the owned cards of the same list; the panel follows.
function viewerNav() {
  return { list: panelList.filter((x) => !x.locked), onStep: (x) => { col.sel = x.id; markSel(); paintPanel(x); } };
}
function markSel() {
  const grid = panelList === colItems ? ctx.el('colGrid') : ctx.el('detGrid');
  grid?.querySelectorAll('.v2-cell').forEach((n) => n.classList.toggle('sel', String(panelList[Number(n.dataset.idx)]?.id) === String(col.sel)));
}
// The phone card view: a swipe shows the next / previous card of the list (all cards, owned or
// not, like the grid). The grid behind it turns to that card's page.
function stepPanel(d) {
  const i = panelList.findIndex((x) => String(x.id) === String(col.sel));
  const n = i < 0 ? null : panelList[i + d];
  if (!n) return;
  col.sel = n.id;
  if (panelList === colItems && ctx.el('colGrid')?._per) col.page = Math.floor((i + d) / ctx.el('colGrid')._per);
  paintColGrid();
  paintPanel(n);
  const box = ctx.el('colPanel');
  box?.classList.remove('m-slide-next', 'm-slide-prev'); void box?.offsetWidth;
  box?.classList.add(d > 0 ? 'm-slide-next' : 'm-slide-prev');
}

const colState = { get page() { return col.page; }, set page(v) { col.page = v; } };
function paintColGrid() {
  const { el } = ctx;
  const grid = el('colGrid');
  if (!grid) return;
  colItems = colFiltered();
  paintCards(grid, el('colPager'), colItems, colState, (c, t) => pickCard(c, t, grid, colItems), col.sel);
  colStatus();
}
// My Live in voice tile (design 19): the set I browse, how much of it I own, 3 owned cards.
function colStatus() {
  const set = mergedCards().filter((c) => (c.season || 'Season 1') === col.season && (!col.game || [].concat(c.tags?.origin || []).includes(col.game)));
  const own = set.filter((c) => c.owned);
  ctx.status?.('collection', { t: col.game ? (GAMES.find(([k]) => k === col.game)?.[1] || col.season) : col.season,
    n: own.length, of: set.length, c: own.slice(0, 3).map((c) => Number(c.id)).filter(Boolean) });
}

const TAG_FACETS = ['type', 'class', 'origin', 'genre', 'traits'];
const GAME_LABELS = { smash: 'Super Smash Bros', pokemon: 'Pokemon', minecraft: 'Minecraft', party: 'Party Games', meme: 'Memes', community: 'Community' };

// The right panel: everything about one card (Nathan: stats, tags, effect, artist).
function paintPanel(c) {
  const { el } = ctx;
  const box = el('colPanel');
  if (!box) return;
  if (!c) { box.innerHTML = '<p class="v2-empty">Pick a card.</p>'; return; }
  const el0 = elemOf(c);
  const all = mergedCards();
  const maxPow = Math.max(1, ...all.map((x) => x.power || 0));
  const sp = !c.locked && ctx.cache.collection?.stats?.on ? c.stat : null; // stat points (stat_points.sql)
  const power = sp ? sp.cp : (c.power || 0);
  const hp = sp ? sp.hp : cardHp(power);
  const crit = 10 + Math.round((sp?.crit || 0) * 100);
  const bar = (label, val, max, color, shown) => `<div class="stat"><b>${shown}</b><span>${label}</span><i class="sbar"><i style="width:${Math.min(100, Math.round((100 * val) / max))}%;background:${color}"></i></i></div>`;
  const t = c.tags || {};
  const chips = [];
  if (el0) chips.push(`<span class="tag el">${elIcon(el0.key)} ${el0.name}</span>`);
  for (const f of TAG_FACETS) {
    let vals = Array.isArray(t[f]) ? t[f] : (t[f] ? [t[f]] : []);
    if (f === 'traits' && el0) vals = vals.filter((v) => String(v).toLowerCase() !== el0.key);
    if (f === 'origin') vals = vals.map((v) => GAME_LABELS[v] || v);
    for (const v of vals) chips.push(`<span class="tag">${esc(String(v).split(':').pop())}</span>`);
  }
  const ab = c.ability;
  const abHTML = ab && ab.name
    ? `<div class="pbox"><div class="pb-h"><b>${esc(ab.name)}</b><span>${esc(['Ability', ab.kind].filter(Boolean).join(' · '))}</span></div><p>${esc(ab.desc || '')}</p></div>`
    : '';
  const a = c.ascension || 0;
  let ascHTML = '';
  if (!c.locked && ctx.features().ascension) {
    const spare = Math.max(0, (c.quantity || 0) - 1);
    const need = c.next_cost;
    ascHTML = need == null && a < 5
      ? `<div class="asc"><div class="pb-h"><span class="side-h">Ascension</span><span>${ASCEND_ERROR.no_ascend}</span></div></div>`
      : a >= 5
      ? '<div class="asc"><div class="pb-h"><span class="side-h">Ascension</span><span>★5 max</span></div></div>'
      : `<div class="asc"><div class="pb-h"><span class="side-h">Ascension</span><span class="mono">${Math.min(spare, need || 0)} / ${need} copies</span></div><i class="sbar"><i style="width:${need ? Math.min(100, Math.round((100 * spare) / need)) : 0}%;background:var(--gold)"></i></i></div>`;
  }
  const inSpot = (myProfile?.spotlight || []).map(Number).includes(Number(c.id));
  const canAsc = !c.locked && ctx.features().ascension && a < 5 && c.can_ascend;
  const owned = c.locked ? 'Not in your collection yet' : `${c.quantity} ${c.quantity === 1 ? 'copy' : 'copies'}`;
  box.innerHTML = `${isPhone() ? '<button class="v2-icon p-close" id="pClose" aria-label="Close">✕</button>' : ''}<div class="p-top">
      <div class="p-art${c.locked ? ' locked' : ''}" id="pArt">${!c.locked && c.image_url ? `<img src="${c.image_url}" alt="">${flairHTML(a)}` : '<span class="lk">🔒</span>'}</div>
      <div class="p-id">
        <span class="p-num">${numLabel(c.num)} · ${esc(c.season || 'Season 1').toUpperCase()}</span>
        <h3>${esc(c.name)}</h3>
        <span class="p-rar" style="--rc:var(--r-${c.rarity})">● ${esc(ctx.RARITY_LABEL[c.rarity] || c.rarity)}</span>
        <span class="p-stars">${'★'.repeat(a)}<i>${'☆'.repeat(5 - a)}</i><span class="p-own">${owned}</span></span>
        <div class="p-stats">
          ${bar('Power', power, maxPow, 'var(--gold)', power)}
          ${bar('HP', hp, cardHp(maxPow), 'var(--danger)', hp)}
          ${bar('Crit', crit, 60, 'var(--el-lightning)', `${crit}%`)}
        </div>
      </div>
    </div>
    ${c.lore ? `<p class="p-lore">“${esc(c.lore)}”</p>` : ''}
    ${abHTML}
    <div class="pbox fx hidden" id="colEffect"></div>
    ${chips.length ? `<div class="p-tags" id="pTags">${chips.join('')}</div>` : ''}
    ${ascHTML}
    ${sp ? pointsHTML(c, sp) : ''}
    ${c.artist ? `<div class="p-credit">🎨 Art by <b>${esc(c.artist)}</b></div>` : ''}
    <div class="p-actions">
      ${canAsc ? `<button class="v2-btn gold" id="pAscend">Ascend to ★${a + 1} · uses ${c.next_cost}</button>` : ''}
      ${c.locked ? '' : '<button class="v2-btn sh-convert hidden" id="pConvert"></button>'}
      ${c.locked ? '' : `<button class="v2-icon${inSpot ? ' on' : ''}" id="pSpot" title="${inSpot ? 'Remove from Spotlight' : 'Add to Spotlight'}">${inSpot ? '★' : '☆'}</button>`}
      <button class="v2-icon" id="pTrade" title="Trade">⇄</button>
    </div>`;
  el('pArt')?.addEventListener('click', () => { if (!c.locked) ctx.openViewer(c, viewerNav()); });
  if (isPhone()) onSwipe(box, stepPanel);
  el('pClose')?.addEventListener('click', () => box.classList.remove('m-open'));
  if (isPhone()) phoneColumns(box);
  el('pTrade')?.addEventListener('click', () => ctx.show('trading'));
  el('pSpot')?.addEventListener('click', () => toggleSpotlight(c));
  el('pAscend')?.addEventListener('click', () => ascend(c));
  // Extra copies -> Shards (the button shows only when copies can convert; ui-v2-shop.js).
  fillConvertButton(c, async () => { await ctx.refreshOwned(); renderCollectionV2(); });
  if (sp) wirePoints(c, sp, box);
  fitPanel(box);
  // The effect block fills later and makes the right column taller: balance the columns again.
  fillViewerEffect(c, 'colEffect').then(() => { if (isPhone()) balanceColumns(box); fitPanel(box); });
}

// The phone card view: the big card, then two columns that do not share rows (the name,
// stats, lore and tags / the ability, effect, ascension and actions).
function phoneColumns(box) {
  const mid = document.createElement('div'); mid.className = 'pv-mid';
  const side = document.createElement('div'); side.className = 'pv-side';
  const art = box.querySelector('.p-art');
  const id = box.querySelector('.p-id');
  if (art) box.prepend(art);
  box.querySelector('.p-top')?.remove();
  [box.querySelector('#pClose'), id, box.querySelector('.p-lore'), box.querySelector('.p-tags'), box.querySelector('.p-credit'), box.querySelector('.p-actions')].forEach((n) => n && mid.append(n));
  [...box.children].filter((n) => n !== art).forEach((n) => side.append(n));
  box.append(mid, side);
  balanceColumns(box);
}

function balanceColumns(box) {
  const mid = box.querySelector('.pv-mid'), side = box.querySelector('.pv-side');
  if (!mid || !side) return;
  // Landscape: a right column taller than the view sends Ascension, then the stat points, to the
  // middle column (above the buttons) while the middle has the room.
  if (!isLand()) return;
  // A column grows with its blocks, so test each block against the bottom of the card view.
  const limit = () => box.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(box).paddingBottom) || 0) + 1;
  // Sum the block heights: a stretched column pushes its buttons (margin-top: auto) to its bottom.
  // Only blocks in the flow count: not the close button (absolute) and not a hidden block (no gap).
  // The lore, tags and artist line do not count: fitPanel hides them when the room is short, and
  // the stat points come first (they were cut while the lore took the room).
  const flow = (ch) => { const cs = getComputedStyle(ch); return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed' && !ch.matches('.p-lore, .p-tags, .p-credit'); };
  const over = (col) => {
    const gap = parseFloat(getComputedStyle(col).rowGap) || 0;
    const kids = [...col.children].filter(flow);
    const h = kids.reduce((t, ch) => t + ch.getBoundingClientRect().height, 0) + gap * Math.max(0, kids.length - 1);
    return col.getBoundingClientRect().top + h > limit();
  };
  const actions = mid.querySelector('.p-actions');
  for (const sel of ['.asc', '#pPts']) {
    if (!over(side)) break;
    const n = side.querySelector(sel);
    if (!n || n.classList.contains('pts-open')) continue;
    mid.insertBefore(n, actions || null);
    if (over(mid)) side.append(n); // no room in the middle: it stays on the right
  }
}

// The Raid Bosses panel: the selected boss, alive (idle + an occasional flex or taunt),
// with its story and the model credit.
function paintBossPanel() {
  const box = ctx.el('colPanel');
  const b = RAID_BOSSES[col.boss] || RAID_BOSSES[0];
  if (!box || !b) return;
  disposeGalBoss();
  box.innerHTML = `<div class="boss-stage"><canvas id="galBossCanvas"></canvas></div>
    <div class="boss-info"><span class="side-h">Raid Boss</span><h3>${esc(b.title)}</h3>
      <p class="p-lore">${esc(b.blurb || '')}</p>${b.credit ? `<div class="p-credit">${esc(b.credit)}</div>` : ''}</div>`;
  try { galBoss = mountBoss(ctx.el('galBossCanvas'), seedForBoss(b), 'Mythic', { portrait: true, portraitOpts: { at: 0.5 } }); } catch { galBoss = null; }
}

// ---- Stat points: each star gives 3 points for this copy (docs/card-stats.md) ----------
const STAT_DEFS = [['attack', 'Attack'], ['vitality', 'Vitality'], ['precision', 'Precision'], ['potency', 'Potency'], ['haste', 'Haste']];
// open: the phone stat editor is open (a phone shows one line until Assign, 2026-10-01).
const pend = { id: null, add: {}, open: false }; // points picked but not saved yet (one card at a time)
// Only the stats that do something for this card: attackers fight, effects and supports cast.
function statKeys(c) {
  const keys = [];
  if (['Character', 'Creature'].includes(c.type)) keys.push('attack', 'vitality', 'precision');
  if (c.effect || c.ability?.kind === 'support') keys.push('potency');
  if (c.effect) keys.push('haste');
  return keys;
}
function pointsHTML(c, sp) {
  const keys = statKeys(c);
  if (!keys.length) return '';
  if (pend.id !== c.id) { pend.id = c.id; pend.add = {}; pend.open = false; }
  const picked = Object.values(pend.add).reduce((t, n) => t + n, 0);
  const left = (sp.free || 0) - picked;
  const pts = sp.points || {};
  const spent = Object.values(pts).reduce((t, n) => t + (Number(n) || 0), 0);
  const rows = STAT_DEFS.filter(([k]) => keys.includes(k)).map(([k, label]) => `<div class="pts-row">
      <span>${label}</span><b>${Number(pts[k]) || 0}${pend.add[k] ? `<i>+${pend.add[k]}</i>` : ''}</b>
      <button class="pts-add" data-add="${k}"${left > 0 ? '' : ' disabled'}>+</button></div>`).join('');
  const canReset = spent > 0 && !picked && !ctx.cache.collection?.stats?.resetUsed;
  // A phone has no room for five rows in the card view (Nathan, 2026-10-01: cut off in landscape):
  // one line with the free points and what is spent; Assign opens the rows over the card view.
  if (isPhone() && !pend.open) {
    const sum = STAT_DEFS.filter(([k]) => keys.includes(k) && Number(pts[k])).map(([k, label]) => `<i>${label} ${Number(pts[k])}</i>`).join('');
    const btn = left > 0 ? `<button class="v2-btn gold" id="ptsOpen" data-n="${left}">Assign</button>` : canReset ? '<button class="v2-btn" id="ptsOpen">Edit</button>' : '';
    return `<div class="pts pts-compact${left > 0 ? ' has-free' : ''}" id="pPts">
    <div class="pb-h"><span class="side-h">Stat points</span><span class="mono">${left} free</span></div>
    ${sum || btn ? `<div class="pts-sum">${sum}${btn}</div>` : ''}</div>`;
  }
  return `<div class="pts${left > 0 ? ' has-free' : ''}${isPhone() ? ' pts-open' : ''}" id="pPts">
    <div class="pb-h"><span class="side-h">Stat points</span><span class="mono">${left} free</span>${isPhone() ? '<button class="v2-icon" id="ptsDone" title="Close">✕</button>' : ''}</div>
    <div class="pts-rows">${rows}</div>
    ${picked || canReset ? `<div class="pts-act">${picked ? '<button class="v2-btn gold" id="ptsSave">Save</button><button class="v2-btn" id="ptsUndo">Undo</button>' : ''}
      ${canReset ? '<button class="link-btn" id="ptsReset">Reset</button>' : ''}</div>` : ''}
  </div>`;
}
function wirePoints(c, sp, box) {
  const repaint = () => paintPanel(c);
  box.querySelector('#pPts')?.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { const k = add.dataset.add; pend.add[k] = (pend.add[k] || 0) + 1; repaint(); return; }
    if (e.target.closest('#ptsUndo')) { pend.add = {}; repaint(); return; }
    if (e.target.closest('#ptsOpen')) { pend.open = true; repaint(); return; }
    if (e.target.closest('#ptsDone')) { pend.open = false; pend.add = {}; repaint(); return; }
    const save = e.target.closest('#ptsSave');
    const reset = e.target.closest('#ptsReset');
    if (!save && !reset) return;
    (save || reset).disabled = true;
    let r = null;
    try {
      r = save ? await ctx.apiPost('/api/stats/spend', { cardId: c.id, add: pend.add })
        : await ctx.apiPost('/api/stats/reset', { cardId: c.id });
    } catch { r = null; }
    if (!r?.ok) { (save || reset).disabled = false; (save || reset).textContent = r?.error === 'reset_used' ? 'Next week' : 'Try again'; return; }
    pend.add = {}; pend.open = false;
    await ctx.refreshOwned();
    renderCollectionV2();
  });
}

async function ascend(c) {
  const btn = ctx.el('pAscend');
  if (btn) { btn.disabled = true; btn.textContent = 'Ascending…'; }
  let r = null;
  try { r = await ctx.apiPost('/api/ascend', { cardId: c.id }); } catch { r = null; }
  if (!r?.ok) { if (btn) { btn.disabled = false; btn.textContent = 'Could not ascend'; } if (r?.error && ASCEND_ERROR[r.error]) toast(ASCEND_ERROR[r.error]); return; }
  const after = { ...c, ascension: r.ascension, quantity: r.quantity, power: r.power, next_cost: r.next_cost,
    can_ascend: r.next_cost != null && r.quantity >= 1 + r.next_cost };
  ctx.celebrateAscend(c, after, !!ctx.cache.collection?.stats?.on && statKeys(c).length > 0);
  await ctx.refreshOwned();
  renderCollectionV2();
}

async function toggleSpotlight(c) {
  const cur = (myProfile?.spotlight || []).map(Number);
  const id = Number(c.id);
  let next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  if (next.length > 3) next = next.slice(next.length - 3); // the oldest pick leaves
  let r = null;
  try { r = await ctx.apiPost('/api/spotlight', { cardIds: next }); } catch { r = null; }
  if (!r?.ok) return;
  if (myProfile) myProfile.spotlight = r.spotlight;
  paintPanel(c);
}

// No scrolling: keep the tags to the rows that fit, then drop the lore if still tight.
function fitPanel(box) {
  if (!box?.isConnected) return;
  const over = () => box.scrollHeight > box.clientHeight + 1;
  box.querySelector('.p-lore')?.classList.remove('hidden');
  const tags = box.querySelector('.p-tags');
  if (tags) {
    tags.classList.remove('one-row');
    tags.querySelector('.tag.more')?.remove();
    tags.querySelectorAll('.tag').forEach((t) => t.classList.remove('hidden'));
  }
  if (over() && tags) {
    // One row of tags; the rest fold into a "+N" chip (the full list is in its tooltip).
    tags.classList.add('one-row');
    const all = [...tags.querySelectorAll('.tag')];
    const right = tags.getBoundingClientRect().right;
    const hidden = all.filter((t) => t.getBoundingClientRect().right > right - 44);
    if (hidden.length) {
      hidden.forEach((t) => t.classList.add('hidden'));
      tags.insertAdjacentHTML('beforeend', `<span class="tag more" title="${esc(hidden.map((t) => t.textContent.trim()).join(', '))}">+${hidden.length}</span>`);
    }
  }
  const lore = box.querySelector('.p-lore');
  lore?.classList.remove('clamp');
  if (over() && lore) { lore.classList.add('clamp'); lore.title = lore.textContent; }
  if (over()) lore?.classList.add('hidden');
  // Still tight (the stat points add rows): the tags go, then the artist line.
  tags?.classList.remove('hidden');
  box.querySelector('.p-credit')?.classList.remove('hidden');
  if (over()) tags?.classList.add('hidden');
  if (over()) box.querySelector('.p-credit')?.classList.add('hidden');
}

export function refreshCollectionV2() {
  if (ctx.currentView() === 'collection') renderCollectionV2();
}

// ---- Spotlight -------------------------------------------------------------

// The spotlight cards of a merged collection: the saved picks, else the 3 strongest.
function spotlightOf(cards, ids) {
  const owned = cards.filter((c) => c.owned);
  const picked = (ids || []).map((id) => owned.find((c) => Number(c.id) === Number(id))).filter(Boolean);
  if (picked.length) return picked;
  return [...owned].sort((a, b) => (b.power || 0) - (a.power || 0) || ((RARITY_ORDER.indexOf(b.rarity)) - RARITY_ORDER.indexOf(a.rarity))).slice(0, 3);
}
// The showcase pranks (effects_batch3.sql) on a member's spotlight: swap_showcase shows a
// random Normal card instead (the same one all day), mustache draws a mustache on each card.
const STACHE = '<svg class="fx-stache" viewBox="0 0 100 40" aria-hidden="true"><path d="M50 14c-6-10-20-12-30-4-6 5-12 6-18 3 4 12 18 20 32 13 7-3 12-7 16-12 4 5 9 9 16 12 14 7 28-1 32-13-6 3-12 2-18-3-10-8-24-6-30 4z"/></svg>';
function spotPrank(c, playerId, i) {
  const b = playerId ? badgeOf(playerId) : null;
  let card = c;
  if (b?.swapShowcase) {
    const normals = (ctx.cache.catalog?.cards || []).filter((x) => x.rarity === 'normal' && x.image_url);
    const day = mtToday();
    const h = [...`${playerId}${day}${i}`].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) >>> 0, 7);
    if (normals.length) card = normals[h % normals.length];
  }
  return { card, stache: b?.mustache ? STACHE : '' };
}
function spotHTML(cards) {
  const me = ctx.user()?.id;
  return cards.map((c0, i) => { const { card: c, stache } = spotPrank(c0, me, i);
    return `<button class="spot-card r-${c.rarity}" data-si="${i}" title="${esc(c.name)}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt="${esc(c.name)}">${stache}</button>`; }).join('')
    || '<p class="v2-empty">No cards yet.</p>';
}

// ---- Home ------------------------------------------------------------------

let heroBoss = null;
const pullsTab = { v: 'all' };

let homeRO = null;
export function disposeHomeV2() {
  disposeGalBoss();
  if (homeRO) { homeRO.disconnect(); homeRO = null; }
  if (heroBoss) { try { heroBoss.dispose(); } catch { /* ignore */ } heroBoss = null; }
}

export async function renderHomeV2() {
  const { el } = ctx;
  disposeHomeV2();
  // Design 19 (Nathan, 2026-09-30): the hunt + Live in voice on the left, Live pulls down
  // the right to the same bottom line. No profile tile: the top-bar avatar opens it.
  const v3 = hm3.homeV3();
  el('main').innerHTML = `<div class="${v3 ? 'u3-home' : 'v2-home h19'}">
    ${v3 ? '<div class="u3-hm">' : ''}<section class="${v3 ? 'u3-hm-tile' : 'v2-tile'} hero" id="homeHero"><div class="v2-loading">Loading…</div></section>
    <section class="${v3 ? 'u3-hm-tile' : 'v2-tile'} voice" id="homeVoice"></section>
    <section class="${v3 ? 'u3-hm-tile' : 'v2-tile'} pulls" id="homePulls"></section>${v3 ? '</div>' : ''}
  </div>`;
  paintVoice();
  paintPulls();
  if (v3) watchHomeV3();
  const [hunt] = await Promise.all([
    ctx.features().hunt ? ctx.api('/api/hunt').catch(() => null) : Promise.resolve(null),
    loadMyProfile(true),
    ensureCatalog(),
  ]);
  if (ctx.currentView() !== 'home') return;
  paintHero(hunt);
  paintVoice(); // the catalog is loaded now: the tiles can show card pictures
}

function paintHero(d) {
  const { el } = ctx;
  const box = el('homeHero');
  if (!box) return;
  const h = d?.hunt;
  if (hm3.homeV3()) { paintHeroV3(box, d, h); return; }
  if (!h) {
    const last = d?.lastResult;
    const won = last?.status === 'defeated';
    const board = (d?.lastBoard || []).slice(0, 3);
    const key = last ? modelKey(last.name) : null;
    box.innerHTML = `<div class="hero-info rest">
        <span class="live-chip calm">PRIDE HUNT · RESTING</span>
        ${last ? `<h2>${esc(last.name)}</h2><span class="rest-res ${won ? 'won' : 'lost'}">${won ? '🏆 Defeated by the pride' : '💀 Escaped'}</span>` : '<h2>The hunt is resting</h2>'}
        ${last ? `<div class="rest-stats">
          <div><b>${fmt(d.myLast || 0)}</b><span>Your damage</span></div>
          <div><b>${fmt(last.hp_max || 0)}</b><span>Boss HP</span></div>
          <div><b>${esc(last.tier || '')}</b><span>Tier</span></div></div>` : ''}
        ${d?.nextSpawnAt ? `<div class="hero-next"><span>Next boss in</span><b class="mono" data-until="${esc(d.nextSpawnAt)}"></b></div>` : ''}
      </div>
      <div class="hero-rest-side">
        ${key ? '<div class="rest-stage"><canvas id="restCanvas"></canvas></div>' : ''}
        ${board.length ? `<div class="rest-top"><span class="side-h">Top hunters</span>${board.map((r, i) => `<div class="rest-hr"><span class="mono">${i + 1}</span>${avatarHTML(r.player_id, r.username, 'xs')}<b>${esc(r.username)}</b><span class="mono">${fmt(r.damage)}</span></div>`).join('')}</div>` : ''}
      </div>`;
    tickCloses();
    // The last boss, alive: its idle animation, framed on the head and chest (no picture box).
    if (key) { try { heroBoss = mountBoss(el('restCanvas'), last.name, last.tier, { portrait: true }); } catch { heroBoss = null; } }
    return;
  }
  const pct = Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max));
  const segs = Array.from({ length: 10 }, (_, i) => `<i class="${i * 10 < pct ? 'on' : ''}"></i>`).join('');
  const rank = myProfile?.huntRank ? `#${myProfile.huntRank} of ${myProfile.huntPlayers}` : '';
  box.innerHTML = `<div class="hero-info">
      <span class="live-chip">● PRIDE HUNT · LIVE NOW</span>
      <h2>${esc(h.name)}</h2>
      <div class="hero-hp"><span>${pct}% HP</span><span class="mono" data-closes="${esc(h.closes_at)}"></span></div>
      <div class="segbar">${segs}</div>
      <div class="hero-row"><button class="v2-btn gold" id="heroJoin">⚔ Join the hunt</button><span class="hero-faces" id="heroFaces"></span><span class="mono dim">${rank}</span></div>
    </div>
    <div class="hero-stage"><canvas id="heroCanvas"></canvas></div>`;
  el('heroJoin').addEventListener('click', () => ctx.show('battling'));
  ctx.api('/api/hunt/feed').then((f) => {
    const seen = new Map();
    for (const r of f?.feed || []) if (r.player_id && !seen.has(r.player_id)) seen.set(r.player_id, r.player);
    const faces = el('heroFaces');
    if (faces) faces.innerHTML = [...seen].slice(0, 4).map(([id, name]) => avatarHTML(id, name, 'xs')).join('');
  }).catch(() => {});
  tickCloses();
  // The live boss: the same close-up as the resting card (head + chest, the flex/taunt showcase).
  // It showed the full body (Nathan, 2026-10-01: the first live boss after PR #35).
  try { heroBoss = mountBoss(el('heroCanvas'), h.name || 'boss', h.tier, { portrait: true }); } catch { heroBoss = null; }
}

function left(iso) {
  const s = Math.max(0, (new Date(iso).getTime() - Date.now()) / 1000);
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${hh}h` : `${hh}h ${mm}m`;
}
function tickCloses() {
  document.querySelectorAll('[data-closes]').forEach((n) => { n.textContent = `closes ${left(n.dataset.closes)}`; });
  document.querySelectorAll('[data-until]').forEach((n) => { n.textContent = left(n.dataset.until); });
}
// No scrolling: remove children from the end until the box fits.
export function fitChildren(box) {
  if (!box) return;
  const bottom = box.getBoundingClientRect().bottom;
  // Keep the first child: a short window showed "Incoming 3" with no offer to accept (2026-10-01).
  while (box.children.length > 1 && box.lastElementChild.getBoundingClientRect().bottom > bottom + 1) box.lastElementChild.remove();
}

function profileStats(p, cards) {
  const total = ctx.cache.catalog?.cards?.length || 0;
  const ownedN = cards.filter((c) => c.owned).length;
  const achs = total ? measure(cards, p?.stats) : [];
  const stat = (v, k) => `<div><b>${v}</b><span>${k}</span></div>`;
  return `<div class="prof-stats">
      ${stat(total ? `${ownedN}/${total}` : ownedN, 'Cards')}
      ${stat(p?.huntRank ? `#${p.huntRank}` : '—', 'Hunt rank')}
      ${stat(achs.length ? `${achs.filter((a) => a.done).length}/${achs.length}` : '—', 'Achievements')}
      ${stat(p ? fmt(p.stats?.packsOpened ?? p.packsOpened) : '—', 'Packs opened')}
    </div>`;
}

function paintProfile() {
  const { el } = ctx;
  const box = el('homeProfile');
  if (!box) return;
  const me = ctx.user();
  const cards = mergedCards();
  const spot = spotlightOf(cards, myProfile?.spotlight);
  box.innerHTML = `<div class="prof-head">${avatarHTML(me?.id, me?.name, 'big', myProfile?.frame)}<div class="prof-name"><h3>${nameBadge(me?.id, me?.name || '')}</h3>${titleHTML(myProfile?.title)}</div>
      ${myProfile?.power != null ? `<span class="prof-cp">⚡ ${fmt(myProfile.power)}</span>` : ''}</div>
    <button class="v2-btn prof-cos" id="profCos">🎖 Title &amp; frame</button>
    ${profileStats(myProfile, cards)}
    <div class="side-h">Spotlight <button class="link-btn" id="spotEdit">Edit</button></div>
    <div class="spot-row" id="spotRow">${spotHTML(spot)}</div>`;
  el('spotRow').onclick = (e) => { const b = e.target.closest('[data-si]'); if (b) ctx.openViewer(spot[Number(b.dataset.si)]); };
  el('spotEdit').addEventListener('click', () => openSpotEditor());
  el('profCos')?.addEventListener('click', () => openSpotEditor());
}

export const STATUS_TEXT = {
  home: ['🏠', 'On the home screen'], collection: ['📚', 'Browsing collection'], hunt: ['⚔', 'In the hunt'],
  battle: ['⚔', 'Attacking the boss'], trading: ['⇄', 'Trading'], opening: ['🎴', 'Opening a pack'], playing: ['✨', 'Playing a card'],
};

// The Live in voice tiles (design 19): what each member does now, with the detail their
// app sends (main.js sendStatus -> server.js cleanDetail): c card ids, n/of, v, x, t, s.
const cardById = (id) => (ctx.cache.catalog?.cards || []).find((c) => Number(c.id) === Number(id));
const vcAgo = (at) => { const m = Math.floor((Date.now() - (at || Date.now())) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`; };
function vcCard(id, cls = '') {
  const c = cardById(id);
  return c ? `<img class="vc-c r-${esc(c.rarity)} ${cls}" src="${thumb(c.image_url)}" data-full="${esc(c.image_url || '')}" alt="">` : `<span class="vc-c empty ${cls}"></span>`;
}
function vcSlots(ids, total, empty) {
  const out = [];
  for (let i = 0; i < Math.min(5, Math.max(total || 0, ids.length)); i += 1) out.push(ids[i] ? vcCard(ids[i]) : `<span class="vc-c ${empty}">${empty === 'back' ? '♛' : '+'}</span>`);
  return out.join('');
}
function vcBody(p) {
  const d = p.status?.d || {};
  const ids = d.c || [];
  switch (p.status?.kind) {
    case 'opening': {
      const r = d.t && ctx.RARITY_LABEL[d.t];
      return { st: `Opening a pack${d.of ? ` · ${d.n || 0}/${d.of}` : ''}`, body: `<div class="vc-slots">${vcSlots(ids, d.of || 5, 'back')}</div>`,
        foot: r ? `<span class="vc-hot" style="color:var(--r-${esc(d.t)}, var(--gold))">${esc(r)} pulled!</span>` : '' };
    }
    case 'collection': {
      const pct = d.of ? Math.round((100 * (d.n || 0)) / d.of) : 0;
      return { st: 'Browsing collection', body: `<div class="vc-stack">${ids.slice(0, 3).map((id) => vcCard(id)).join('')}</div>
        <div class="vc-set"><b>${esc(d.t || 'Season 1')}</b><span class="mono">${pct}%</span><i class="vc-bar"><i style="width:${pct}%"></i></i></div>`,
        foot: d.of ? `<span></span><span class="mono">${d.n || 0} / ${d.of}</span>` : '' };
    }
    case 'hunt':
      return { st: 'In the hunt', body: `<div class="vc-slots">${vcSlots(ids.slice(0, 3), Math.min(3, ids.length || 1), 'plus')}</div>${d.v ? `<div class="vc-big"><b class="mono">${fmt(d.v)}</b><span>DAMAGE</span></div>` : ''}`,
        foot: d.of ? `<span class="mono">${d.n || 0}/${d.of} cards</span>` : '' };
    case 'battle':
      return { st: 'Attacking the boss', body: `${vcCard(ids[0], 'hit')}<div class="vc-dmg"><b class="mono">-${fmt(d.v || 0)}</b>${d.x ? '<span class="vc-crit">CRIT</span>' : ''}</div>`,
        foot: d.of ? `<span class="mono">${d.n || 0}/${d.of} cards</span>` : '' };
    case 'trading':
      return { st: d.t ? `Trading with ${d.t}` : 'Trading', body: ids.length ? `${vcCard(ids[0])}<span class="vc-swap">⇄</span>${vcCard(ids[1])}<div class="vc-tr"><b>${d.s === 'sent' ? 'Offer sent' : 'Building an offer'}</b>${d.s === 'sent' ? '<span>Pending</span>' : ''}</div>` : '',
        foot: '' };
    case 'playing':
      return { st: d.s ? `Playing on ${d.s}` : 'Playing a card', body: ids.length || d.t ? `${vcCard(ids[0])}<div class="vc-tr"><b>${esc(d.t || 'A card')}</b></div>` : '', foot: '' };
    default: {
      const [, txt] = STATUS_TEXT[p.status?.kind] || ['•', 'Here'];
      return { st: txt, body: '', foot: '' };
    }
  }
}

// Nathan: a little Watch chip on the tile of a member who opens a pack (a tap watches it).
const WATCH_CHIP = '<span class="vc-watch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>Watch</span>';
export function paintVoice() {
  const { el } = ctx;
  const box = el('homeVoice');
  if (!box) return;
  if (hm3.homeV3()) { paintVoiceV3(box); return; }
  const me = ctx.user();
  const people = [...(ctx.live.presence || [])];
  // The member always sees their own tile, first (Nathan: not "Just you right now").
  if (me && !people.some((p) => String(p.id) === String(me.id))) people.unshift({ id: me.id, name: me.name, status: { kind: 'home' } });
  people.sort((a, b) => (String(b.id) === String(me?.id)) - (String(a.id) === String(me?.id)));
  const tile = (p) => {
    const kind = p.status?.kind || 'here';
    const [ico] = STATUS_TEXT[kind] || ['•'];
    const self = String(p.id) === String(me?.id);
    const b = vcBody(p);
    const watch = !self && kind === 'opening' && ctx.watchable?.(p.id);
    return `<button class="vc-tile k-${esc(kind)}${self ? ' self' : ''}${watch ? ' watch' : ''}" data-member="${esc(p.id)}"><div class="vc-head">${avatarHTML(p.id, p.name, 'sm')}
      <div><b>${nameBadge(p.id, p.name)}${self ? ' <i class="you">You</i>' : ''}</b><span class="vc-st">${ico} ${esc(b.st)}</span></div>${watch ? WATCH_CHIP : `<span class="vc-ago mono">${vcAgo(p.status?.at)}</span>`}</div>
      ${b.body ? `<div class="vc-body">${b.body}</div>` : ''}${b.foot ? `<div class="vc-foot">${b.foot}</div>` : ''}</button>`;
  };
  // Phones show one row (Nathan: the +N tile for the rest). The desktop shows up to 6.
  const shown = isLand() ? (innerWidth >= 800 ? 3 : 2) : isPort() ? 2 : 6;
  box.innerHTML = `<div class="tile-h"><b>🎧 Live in voice</b><span class="dim">${people.length}</span><span class="grow"></span>${people.length > 1 ? '<span class="live-chip sm">● LIVE</span>' : ''}</div>
    <div class="vc-grid${people.length > shown ? '' : ' no-more'}" style="--vc-n:${shown}">${people.slice(0, shown).map(tile).join('')}${people.length > shown ? `<span class="vc-more">+${people.length - shown}</span>` : ''}</div>`;
  // A tap on an "Opening" tile watches that pack (the only way to see another member's open).
  box.onclick = (e) => { const t = e.target.closest('[data-member]'); if (!t) return; if (t.classList.contains('watch') && ctx.watchOpen?.(t.dataset.member)) return; openMember(t.dataset.member); };
}

export function paintPulls() {
  const { el } = ctx;
  const box = el('homePulls');
  if (!box) return;
  if (hm3.homeV3()) { paintPullsV3(box); return; }
  const all = ctx.live.pulls || [];
  // Den (design 19): the pulls of the members in my voice channel now.
  const den = new Set([...(ctx.live.presence || []).map((p) => String(p.id)), String(ctx.user()?.id || '')]);
  const pulls = pullsTab.v === 'top' ? all.filter((p) => TOP_RARITY.has(p.rarity))
    : pullsTab.v === 'den' ? all.filter((p) => den.has(String(p.player_id))) : all;
  const [first, ...rest] = pulls;
  const row = (p, i) => `<div class="pl-row" data-pi="${i}"><img src="${thumb(p.image_url)}" data-full="${p.image_url || ''}" alt="" loading="lazy"><div class="pl-t"><b>${nameBadge(p.player_id, p.player)}</b> pulled <span style="color:var(--r-${p.rarity}, var(--text-primary))">${esc(p.name)}</span></div><span class="mono dim">${ctx.ago(p.at)}</span></div>`;
  box.innerHTML = `<div class="tile-h"><b><span class="live-dot"></span> Live pulls</b><span class="grow"></span>
      <div class="seg">${[['all', 'All'], ['top', 'Top pulls'], ['den', 'Den']].map(([v, l]) => `<button data-t="${v}" class="${pullsTab.v === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    ${first ? `<div class="pl-top r-${first.rarity}" data-pi="0"><img src="${thumb(first.image_url)}" data-full="${first.image_url || ''}" alt=""><div><span class="pl-k">${esc((ctx.RARITY_LABEL[first.rarity] || first.rarity).toUpperCase())} · ${ctx.ago(first.at)}</span><b>${nameBadge(first.player_id, first.player)} pulled ${esc(first.name)}</b></div></div>` : '<p class="v2-empty">No pulls yet.</p>'}
    <div class="pl-list" id="plList">${rest.slice(0, 8).map((p, i) => row(p, i + 1)).join('')}</div>`;
  box.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { pullsTab.v = b.dataset.t; paintPulls(); }));
  box.onclick = (e) => { const r = e.target.closest('[data-pi]'); if (r && pulls[Number(r.dataset.pi)]) ctx.openViewer(pulls[Number(r.dataset.pi)]); };
  // No scrolling: drop the rows that do not fully fit.
  fitChildren(el('plList'));
  // Once more after the layout settles (the hunt card can still grow and shrink the list).
  requestAnimationFrame(() => setTimeout(() => fitChildren(el('plList')), 300));
}

export function homeTick() { tickCloses(); }

// ---- Home v3 (UI-03, body.ui-v3): src/ui3/home.js has the markup; these paint it and wire it ----
const pullsPage = { start: 0 };
const watchHomeV3 = () => {   // refit the voice cells and the pull rows when a tile changes size (fonts, class change)
  if (typeof ResizeObserver === 'undefined') return;
  let t = null;
  homeRO = new ResizeObserver(() => { if (t) cancelAnimationFrame(t); t = requestAnimationFrame(() => { t = null; fitHomeV3(); }); });
  homeRO.observe(ctx.el('homeHero')); homeRO.observe(ctx.el('homeVoice')); homeRO.observe(ctx.el('homePulls'));
  document.fonts?.ready?.then(fitHomeV3);
};
// The whole Home: every tile fits its box. When something is still cut, the layout modes in steps (the last step with the fewest
// cut tiles stays): is-compact (smaller gaps and padding), is-vrow (Live in voice in one row, compact-port), is-pull (a wider Live pulls column, compact-land).
function fitHomeV3() {
  const root = ctx.el('main')?.querySelector('.u3-home');
  if (!root) return;
  const run = () => { hm3.fitHero(ctx.el('homeHero')); hm3.fitVoice(ctx.el('homeVoice')); fitPullsV3(); };
  let best = null;
  for (const step of [[], ['is-compact'], ['is-compact', 'is-vrow'], ['is-compact', 'is-vrow', 'is-pull']]) {
    root.classList.remove('is-compact', 'is-vrow', 'is-pull');
    root.classList.add(...step);
    run();
    const cut = hm3.cutTiles(root);
    if (!best || cut <= best.cut) best = { step, cut };   // a tie keeps the later (denser) step
    if (!cut) break;
  }
  root.classList.remove('is-compact', 'is-vrow', 'is-pull');
  root.classList.add(...best.step);
  run();
}
function paintHeroV3(box, d, h) {
  const { el } = ctx;
  if (!h) {
    const last = d?.lastResult;
    const key = last ? modelKey(last.name) : null;
    box.innerHTML = hm3.heroRestHTML(d, { fmt, hasModel: !!key });
    wireTopHunter(box);
    hm3.fitHero(box);
    tickCloses();
    // the last boss, alive (the live 3D portrait, as today)
    if (key) { try { heroBoss = mountBoss(el('restCanvas'), last.name, last.tier, { portrait: true }); } catch { heroBoss = null; } }
    return;
  }
  const pct = Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max));
  const rank = myProfile?.huntRank ? `#${myProfile.huntRank} of ${myProfile.huntPlayers}` : '';
  box.innerHTML = hm3.heroLiveHTML(h, pct, { rank });
  hm3.fitHero(box);
  box.querySelector('[data-hjoin]')?.addEventListener('click', () => ctx.show('battling'));
  ctx.api('/api/hunt/feed').then((f) => {
    const seen = new Map();
    for (const r of f?.feed || []) if (r.player_id && !seen.has(r.player_id)) seen.set(r.player_id, r.player);
    const faces = el('heroFaces');
    if (faces) faces.innerHTML = [...seen].slice(0, 4).map(([id, name]) => avatarHTML(id, name, 'xs')).join('');
  }).catch(() => {});
  // the Top hunter line during a live fight (D-52): the first row of the Hunt board
  ctx.api('/api/hunt/leaderboard').then((b) => {
    const top = (b?.leaders || [])[0];
    const slot = el('heroTop');
    const rows = boardRows(b?.leaders);
    if (top && slot) { slot.outerHTML = boardHTML(rows, { fmt, avatar: (id, name) => avatarHTML(id, name, 'xs') }) + hm3.topHunterHTML(top, fmt); wireTopHunter(el('homeHero')); fitHomeV3(); }
  }).catch(() => {});
  tickCloses();
  try { heroBoss = mountBoss(el('heroCanvas'), h.name || 'boss', h.tier, { portrait: true }); } catch { heroBoss = null; }
}
// "Top hunter" opens the Leaderboard window (the hidden v2 button that the menu tile clicks too)
function wireTopHunter(box) { box?.querySelectorAll('[data-top-hunter]').forEach((b) => { if (!b.dataset.wired) { b.dataset.wired = '1'; b.addEventListener('click', () => document.getElementById('boardBtn')?.click()); } }); }

function paintVoiceV3(box) {
  const me = ctx.user();
  const people = [...(ctx.live.presence || [])];
  if (me && !people.some((p) => String(p.id) === String(me.id))) people.unshift({ id: me.id, name: me.name, status: { kind: 'home' } });
  // D-55: the other members first, then you
  people.sort((a, b) => (String(a.id) === String(me?.id)) - (String(b.id) === String(me?.id)));
  const cell = (p) => {
    const kind = p.status?.kind || 'here';
    const self = String(p.id) === String(me?.id);
    return hm3.voiceCellHTML(p, vcBody(p), { avatar: avatarHTML(p.id, p.name, 'sm'), name: nameBadge(p.id, p.name, true), ico: (STATUS_TEXT[kind] || ['•'])[0],
      ago: vcAgo(p.status?.at), self, watch: !self && kind === 'opening' && !!ctx.watchable?.(p.id) });
  };
  box.innerHTML = hm3.voiceHTML(people.map(cell), people.length);
  hm3.fitVoice(box);
  box.onclick = (e) => { const t = e.target.closest('[data-member]'); if (!t) return; if (t.classList.contains('watch') && ctx.watchOpen?.(t.dataset.member)) return; openMember(t.dataset.member); };
}

let pullsAll = [];
const pullHelpers = () => ({ thumb, name: (p) => nameBadge(p.player_id, p.player, true), ago: ctx.ago, label: ctx.RARITY_LABEL });
function fitPullsV3() {
  const box = ctx.el('homePulls');
  if (!box || !box.querySelector('#plList')) return;
  const h = pullHelpers();
  pullsPage.start = hm3.fitPulls(box, pullsAll, pullsPage.start, h, (start) => { pullsPage.start = start; fitPullsV3(); });
}
function paintPullsV3(box) {
  const all = ctx.live.pulls || [];
  const den = new Set([...(ctx.live.presence || []).map((p) => String(p.id)), String(ctx.user()?.id || '')]);
  const pulls = pullsTab.v === 'top' ? all.filter((p) => TOP_RARITY.has(p.rarity))
    : pullsTab.v === 'den' ? all.filter((p) => den.has(String(p.player_id))) : all;
  pullsAll = pulls;
  box.innerHTML = hm3.pullsHTML(pullsTab.v);
  box.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => { pullsTab.v = b.dataset.seg; pullsPage.start = 0; paintPullsV3(box); }));
  box.onclick = (e) => { const r = e.target.closest('[data-pi]'); if (r && pulls[Number(r.dataset.pi)]) ctx.openViewer(pulls[Number(r.dataset.pi)]); };
  fitPullsV3();
}


// ---- The Spotlight + style editor (Nathan: easier select / deselect) ----------------
// Three slots on top (tap a slot to empty it), your cards below (tap to add or remove),
// and the titles + frames the member has redeemed. Save writes both.
const sp = { ids: [], title: null, frame: null, q: '', page: 0 };
export async function openSpotEditor() {
  const { el } = ctx;
  await Promise.all([ensureCatalog(), loadMyProfile()]);
  const cards = mergedCards();
  sp.ids = spotlightOf(cards, myProfile?.spotlight).map((c) => Number(c.id));
  sp.title = myProfile?.title || null; sp.frame = myProfile?.frame || null; sp.q = ''; sp.page = 0;
  if (document.body.classList.contains('ui-v3')) { sp.msg = ''; sp.busy = false; paintStyleV3(); return; }   // UI-15 v3 (src/ui3/style-editor.js)
  let box = el('spotEditor');
  if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="spotEditor" class="v2-modal hidden"></div>'); box = el('spotEditor'); }
  box.classList.remove('hidden');
  box.onclick = (e) => { if (e.target === box) box.classList.add('hidden'); };
  paintSpotEditor();
}
function paintSpotEditor() {
  const { el } = ctx;
  const box = el('spotEditor');
  const cards = mergedCards();
  const owned = cards.filter((c) => c.owned);
  const byId = new Map(owned.map((c) => [Number(c.id), c]));
  const achs = measure(cards, myProfile?.stats);
  const claimed = achs.filter((a) => claimedSet().has(a.key));
  const titles = [...new Set(claimed.map((a) => rewardOf(a.key).title).filter(Boolean))];
  const frames = [...new Set(claimed.map((a) => rewardOf(a.key).frame).filter(Boolean))];
  // Every title and frame in the game, so the locked ones show what exists and which
  // achievement unlocks them (Nathan: "there aren't any frames/titles in the game").
  const unlockBy = (kind, v) => achs.filter((a) => rewardOf(a.key)[kind] === v).map((a) => a.name);
  const allTitles = [...new Set(achs.map((a) => rewardOf(a.key).title).filter(Boolean))];
  const allFrames = [...new Set(achs.map((a) => rewardOf(a.key).frame).filter(Boolean))];
  const lockedTitles = allTitles.filter((t) => !titles.includes(t));
  const lockedFrames = allFrames.filter((f) => !frames.includes(f));
  const locked = (label, by) => `<span class="f-chip locked" title="Unlock: ${esc(by.join(' or '))}">🔒 ${label}</span>`;
  const slots = [0, 1, 2].map((i) => {
    const c = byId.get(sp.ids[i]);
    return c ? `<button class="se-slot r-${c.rarity}" data-slot="${i}" title="Remove ${esc(c.name)}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""><span class="se-x">✕</span></button>`
      : `<div class="se-slot empty"><span>${i + 1}</span></div>`;
  }).join('');
  const q = sp.q.trim().toLowerCase();
  const list = owned.filter((c) => !q || [c.name, c.subject].filter(Boolean).join(' ').toLowerCase().includes(q))
    .sort((a, b) => (sp.ids.includes(Number(b.id)) - sp.ids.includes(Number(a.id))) || (b.power || 0) - (a.power || 0));
  const pill = (group, v, label, on) => `<button class="f-chip${on ? ' on' : ''}" data-${group}="${esc(v ?? '')}">${label}</button>`;
  const me = ctx.user();
  box.innerHTML = `<div class="v2-modal-card se-card">
    <button class="v2-icon mem-close" id="seClose" aria-label="Close">✕</button>
    <aside class="se-side">
      <div class="prof-head">${avatarHTML(me?.id, me?.name, 'big', sp.frame)}<div class="prof-name"><h3>${esc(me?.name || '')}</h3>${titleHTML(sp.title)}</div></div>
      <div class="side-h">Spotlight <span class="n">${sp.ids.length}/3</span></div>
      <div class="se-slots" id="seSlots">${slots}</div>
      <div class="side-h">Title</div>
      <select class="v2-select" id="seTitle">
        <option value=""${sp.title ? '' : ' selected'}>None</option>
        ${titles.map((t) => `<option value="${esc(t)}"${sp.title === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        ${lockedTitles.length ? `<optgroup label="Locked">${lockedTitles.map((t) => `<option disabled>🔒 ${esc(t)} · ${esc(unlockBy('title', t).join(' or '))}</option>`).join('')}</optgroup>` : ''}
      </select>
      <div class="side-h">Frame</div>
      <div class="f-chips">${pill('frame', '', 'None', !sp.frame)}${frames.map((f) => pill('frame', f, `<i class="se-ring frame-${f}"></i>${esc(FRAMES[f])}`, sp.frame === f)).join('')}${lockedFrames.map((f) => locked(`<i class="se-ring frame-${f}"></i>${esc(FRAMES[f])}`, unlockBy('frame', f))).join('')}</div>
      <div class="se-foot"><span class="tr-msg" id="seMsg"></span><button class="v2-btn gold" id="seSave">Save</button></div>
    </aside>
    <section class="se-main">
      <div class="v2-col-head"><h2>Your cards</h2><span class="grow"></span>
        <input class="v2-search" id="seQ" placeholder="Search cards…" value="${esc(sp.q)}"><div class="v2-pager" id="sePager"></div></div>
      <div class="v2-grid" id="seGrid"></div>
    </section>
  </div>`;
  const grid = el('seGrid');
  const pick = (c) => {
    const id = Number(c.id);
    if (sp.ids.includes(id)) sp.ids = sp.ids.filter((x) => x !== id);
    else if (sp.ids.length < 3) sp.ids = [...sp.ids, id];
    else { el('seMsg').textContent = 'The Spotlight holds 3 cards'; return; }
    paintSpotEditor();
  };
  paintCards(grid, el('sePager'), list, sp, pick);
  grid.querySelectorAll('.v2-cell').forEach((n) => { const c = list[Number(n.dataset.idx)]; if (c && sp.ids.includes(Number(c.id))) n.classList.add('sel', 'in-spot'); });
  el('seTitle').addEventListener('change', (e) => { sp.title = e.target.value || null; paintSpotEditor(); });
  el('seSlots').onclick = (e) => { const b = e.target.closest('[data-slot]'); if (!b) return; sp.ids.splice(Number(b.dataset.slot), 1); paintSpotEditor(); };
  box.querySelectorAll('[data-frame]').forEach((b) => b.addEventListener('click', () => { sp.frame = b.dataset.frame || null; paintSpotEditor(); }));
  el('seQ').addEventListener('input', (e) => { sp.q = e.target.value; sp.page = 0; paintSpotEditor(); const i = el('seQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el('seClose').addEventListener('click', () => box.classList.add('hidden'));
  el('seSave').addEventListener('click', async () => {
    const btn = el('seSave'); btn.disabled = true; btn.textContent = 'Saving…';
    const [a, b] = await Promise.all([
      ctx.apiPost('/api/spotlight', { cardIds: sp.ids }).catch(() => null),
      (sp.title !== (myProfile?.title || null) || sp.frame !== (myProfile?.frame || null)) ? ctx.apiPost('/api/cosmetics', { title: sp.title, frame: sp.frame }).catch(() => null) : Promise.resolve({ ok: true }),
    ]);
    if (!a?.ok || !b?.ok) { btn.disabled = false; btn.textContent = 'Save'; el('seMsg').textContent = 'Could not save. Try again.'; return; }
    myProfile = { ...(myProfile || {}), spotlight: a.spotlight, title: sp.title, frame: sp.frame };
    box.classList.add('hidden');
    if (ctx.currentView() === 'home') paintProfile();
    if (memData?.self && !ctx.el('memberModal')?.classList.contains('hidden')) openMember(ctx.user()?.id); // show the new title + frame
    toast('Profile saved');
  });
}

// ---- UI-15 v3 (body.ui-v3 only): the slots, the title, the frame and Save; the cards come from the Card picker (D-80 16) ----
// The titles and frames the member owns are the ones the server sends (GET /api/profile: titles, frames, from
// achievement_claims: the same list POST /api/cosmetics accepts); the locked ones show what exists and how to get it.
const TIER_FRAME = { diamond: 'Diamond frame', mythic: 'Obsidian frame' };   // the tier frames 'diamond:<track>', 'mythic:<track>' (D-74)
const frameLabel = (f) => FRAMES[f] || TIER_FRAME[String(f).split(':')[0]] || String(f);
function styleLists() {
  const achs = measure(mergedCards(), myProfile?.stats);
  const claimed = achs.filter((a) => claimedSet().has(a.key));
  const by = (kind, v) => achs.filter((a) => rewardOf(a.key)[kind] === v).map((a) => a.name).join(' or ');
  const all = (kind) => [...new Set(achs.map((a) => rewardOf(a.key)[kind]).filter(Boolean))];
  const ownT = Array.isArray(myProfile?.titles) ? myProfile.titles : [...new Set(claimed.map((a) => rewardOf(a.key).title).filter(Boolean))];
  const ownF = Array.isArray(myProfile?.frames) ? myProfile.frames : [...new Set(claimed.map((a) => rewardOf(a.key).frame).filter(Boolean))];
  return {
    titles: { owned: ownT, locked: all('title').filter((t) => !ownT.includes(t)).map((t) => ({ value: t, by: by('title', t) })) },
    frames: { owned: ownF.map((f) => ({ value: f, label: frameLabel(f) })), locked: all('frame').filter((f) => !ownF.includes(f)).map((f) => ({ value: f, label: frameLabel(f), by: by('frame', f) })) },
  };
}
function styleHost() {
  let host = document.getElementById('u3StyleHost');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'u3StyleHost';
  document.body.appendChild(host);
  host.addEventListener('click', onStyleClick);
  host.addEventListener('change', (e) => { if (e.target.id === 'u3SeTitle') { sp.title = e.target.value || null; sp.msg = ''; paintStyleV3(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && host.firstChild && !document.getElementById('u3Picker')) closeStyleV3(); });
  return host;
}
function closeStyleV3() { const h = document.getElementById('u3StyleHost'); if (h) h.innerHTML = ''; }
function paintStyleV3() {
  const me = ctx.user();
  const byId = new Map(mergedCards().filter((c) => c.owned).map((c) => [Number(c.id), c]));
  const lists = styleLists();
  styleHost().innerHTML = se3.styleEditorHTML({
    avatar: avatarHTML(me?.id, me?.name, 'u3-se-av', sp.frame), name: me?.name || '',
    cards: sp.ids.map((id) => byId.get(Number(id))).filter(Boolean), title: sp.title, frame: sp.frame, msg: sp.msg, busy: sp.busy, ...lists,
  });
}
function openSpotPicker(from) {
  const owned = mergedCards().filter((c) => c.owned).sort((a, b) => (b.power || 0) - (a.power || 0));
  openCardPicker({
    title: 'Spotlight', cap: se3.SPOT_CAP, cards: owned, selected: sp.ids.map(Number), returnFocus: from,
    blocked: (c, sel) => (sel.length >= se3.SPOT_CAP ? 'The Spotlight holds 3 cards' : ''),
    apply: (cards, v, q) => { const w = q.trim().toLowerCase(); return w ? cards.filter((c) => [c.name, c.subject].filter(Boolean).join(' ').toLowerCase().includes(w)) : cards; },
    status: () => ({ checks: [], ready: true }),
    detail: (c) => ctx.openViewer(c),
    onConfirm: (sel) => { sp.ids = sel; sp.msg = ''; paintStyleV3(); return true; },
  });
}
async function onStyleClick(e) {
  const t = e.target.closest('button, [data-u3-scrim]');
  if (!t) return;
  const d = t.dataset;
  if (t.matches('[data-u3-scrim]')) { if (e.target === t && !sp.busy) closeStyleV3(); return; }
  if (d.seclose) { closeStyleV3(); return; }
  if (d.sepick) { openSpotPicker(t); return; }
  if (d.seunpick) { sp.ids = sp.ids.filter((x) => String(x) !== d.seunpick); sp.msg = ''; paintStyleV3(); return; }
  if ('seframe' in d && !t.disabled) { sp.frame = d.seframe || null; sp.msg = ''; paintStyleV3(); return; }
  if (d.sesave && !sp.busy) {
    sp.busy = true; sp.msg = ''; paintStyleV3();
    const [a, b] = await Promise.all([
      ctx.apiPost('/api/spotlight', { cardIds: sp.ids }).catch(() => null),
      (sp.title !== (myProfile?.title || null) || sp.frame !== (myProfile?.frame || null)) ? ctx.apiPost('/api/cosmetics', { title: sp.title, frame: sp.frame }).catch(() => null) : Promise.resolve({ ok: true }),
    ]);
    sp.busy = false;
    if (!a?.ok || !b?.ok) { sp.msg = 'Could not save. Try again.'; paintStyleV3(); return; }
    myProfile = { ...(myProfile || {}), spotlight: a.spotlight, title: sp.title, frame: sp.frame };
    closeStyleV3();
    if (ctx.currentView() === 'home') paintProfile();
    if (memData?.self && !ctx.el('memberModal')?.classList.contains('hidden')) openMember(ctx.user()?.id); // show the new title + frame
    toast('Profile saved');
  }
}

// ---- A member's profile (design/15-member-profile-screen.png, approved 2026-09-27) ----
// Opened from a tile in "Live in voice". Left: who they are, what they do now, the
// actions, the stats and badges. Centre: the spotlight and their season. Right: their
// live hunt, and the cards each of you has that the other one needs.

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mem = { page: 0, all: false, pane: '' };   // pane '' = the first tab with content (profile.js fitTight)
let memData = null;

// The needs / closest achievements list: a phone shows only whole rows; no room for one row hides
// the box (a cut row showed in portrait, 2026-10-01). A desktop keeps the first row.
function fitNeed(box) {
  const list = box.querySelector('.need-list');
  if (!list) return;
  if (!isPhone()) { fitChildren(list); return; }
  const bottom = list.getBoundingClientRect().bottom + 1;
  while (list.lastElementChild && list.lastElementChild.getBoundingClientRect().bottom > bottom) list.lastElementChild.remove();
  if (!list.children.length) box.querySelector('.mem-need')?.classList.add('m-none');
}
export async function openMember(id) {
  const { el } = ctx;
  let box = el('memberModal');
  if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="memberModal" class="v2-screen hidden"></div>'); box = el('memberModal'); }
  box.innerHTML = '<div class="v2-loading">Loading…</div>';
  box.classList.remove('hidden');
  box.onclick = (e) => { if (e.target.closest('#memBack')) closeMember(); };
  await ensureCatalog();
  const me = ctx.user();
  const self = String(id) === String(me?.id);
  let p = null;
  try { p = await ctx.api(`/api/profile${self ? '' : `?id=${encodeURIComponent(id)}`}`); } catch { p = null; }
  if (!p || p.error) {
    if (pf3.isV3()) { // v3 (UI-14 C17, D-80 item 15): no profile (404) or a failed load with Try again
      box.innerHTML = pf3.emptyHTML(p?.error !== 'no such player');
      ctx.el('memRetry')?.addEventListener('click', () => openMember(id));
      return;
    }
    box.innerHTML = '<div class="mem-empty"><button class="v2-btn" id="memBack">← Home</button><p class="v2-empty">This member has no profile yet.</p></div>'; return;
  }
  memData = { p, self, cards: mergedCards(self ? undefined : (p.cards || [])) };
  mem.all = false; mem.page = 0; mem.pane = '';
  paintMember();
}
export function closeMember() { ctx.el('memberModal')?.classList.add('hidden'); }
/** v3: the Profile closes when another screen or window is chosen (the dock, a tab, the Shop, the bell, the Menu ...; capture phase, so a
 *  Profile that the same tap opens (the avatar) opens after it closed). Flag off: no change. */
export function closeMemberOnShell() {
  if (!pf3.isV3()) return;
  const m = ctx?.el('memberModal');
  if (m && !m.classList.contains('hidden')) { closeWishlist(); closeMember(); }   // the Wishlist drawer belongs to the Profile (D-128)
}
document.addEventListener('click', (e) => { if (pf3.closesProfile(e.target)) closeMemberOnShell(); }, true);

function paintMember() {
  const { el } = ctx;
  const box = el('memberModal');
  const { p, self, cards } = memData;
  const s = p.stats || {};
  const achs = measure(cards, s);
  const done = achs.filter((a) => a.done);
  const pres = (ctx.live.presence || []).find((x) => String(x.id) === String(p.id));
  const [sIco, sTxt] = STATUS_TEXT[pres?.status?.kind] || [];
  const season = cards.filter((c) => (c.season || 'Season 1') === (col.season || 'Season 1'));
  const ownedN = season.filter((c) => c.owned).length;
  const byR = (r) => cards.filter((c) => c.owned && c.rarity === r).length;
  const spot = spotlightOf(cards, p.spotlight);
  const spotOrder = spot.length === 3 ? [spot[1], spot[0], spot[2]] : spot; // the strongest in the middle
  const stat = (v, k) => `<div><b>${v}</b><span>${k}</span></div>`;
  const effects = !self && ctx.effectsEnabled?.();
  if (pf3.isV3()) { paintMemberV3({ box, p, self, cards, s, achs, done, pres, sIco, sTxt, season, ownedN, byR, spot, spotOrder, effects }); return; }

  box.innerHTML = `<div class="mem-screen">
    <aside class="mem-col mem-left">
      <div class="mem-top"><button class="v2-chip-btn" id="memBack">← Home</button></div>
      <div class="mem-id">
        ${avatarHTML(p.id, p.name, `huge${pres ? ' live' : ''}`, p.frame)}
        <h2>${nameBadge(p.id, p.name)}</h2>${titleHTML(p.title)}
        ${memData.self ? '<button class="v2-btn prof-cos" id="memCos">🎖 Title &amp; frame</button>' : ''}
        <div class="mem-badges">${done.slice(0, 5).map((a) => `<span class="mem-badge" title="${esc(a.name)}">${a.icon}</span>`).join('')}${done.length > 5 ? `<span class="mem-more">+${done.length - 5}</span>` : ''}</div>
      </div>
      ${pres ? `<div class="mem-status">🎧 In voice · ${sIco || ''} ${esc(sTxt || 'Here')}</div>` : ''}
      ${effects ? `<div class="mem-acts"><button class="v2-btn boon" id="memBoon">🎁 Boon</button><button class="v2-btn prank" id="memPrank">😈 Prank</button></div>` : ''}
      ${self ? '' : '<button class="v2-btn" id="memTrade">⇄ Offer a trade</button>'}
      <div class="mem-grid-stats">
        ${stat(`${ownedN}/${season.length}`, 'Cards')}
        ${stat(p.huntRank ? `#${p.huntRank}` : '—', 'Hunt rank')}
        ${stat(`${done.length}/${achs.length}`, 'Achievements')}
        ${stat(fmt(s.packsOpened), 'Packs opened')}
        ${stat(p.power != null ? fmt(p.power) : '—', 'Power')}
        ${stat(byR('full_art'), 'Full Arts')}
      </div>
      <div class="side-h">Achievements <span class="n">${done.length}/${achs.length}</span></div>
      <div class="mem-ach" id="memAch">${[...done, ...achs.filter((a) => !a.done)].slice(0, 18).map((a) => `<span class="mem-ab${a.done ? ' on' : ''}" title="${esc(a.name)} · ${esc(a.desc)}">${a.done ? a.icon : '🔒'}</span>`).join('')}</div>
    </aside>

    <section class="mem-center">
      ${mem.all ? '' : `<div class="mem-col mem-spot">
        <div class="side-h">✨ Spotlight${memData.self ? ' <button class="link-btn" id="memStyle">Edit</button>' : ''}</div>
        <div class="mem-spot-row" id="memSpot">${spotOrder.map((c0, i) => { const { card: c, stache } = spotPrank(c0, p.id, i);
          return `<button class="spot-card r-${c.rarity}${c0 === spot[0] ? ' main' : ''}" data-id="${c0.id}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt="${esc(c.name)}">${stache}</button>`; }).join('') || '<p class="v2-empty">No cards yet.</p>'}</div>
      </div>`}
      <div class="mem-col mem-season${mem.all ? ' full' : ''}">
        <div class="v2-col-head"><h2>${esc(col.season || 'Season 1')} <span class="sub">${ownedN}/${season.length}</span></h2>
          <i class="bar mem-bar"><i style="width:${Math.round((100 * ownedN) / (season.length || 1))}%"></i></i><span class="grow"></span>
          ${mem.all ? '<div class="v2-pager" id="memPager"></div>' : ''}<button class="link-btn" id="memAll">${mem.all ? 'Back' : 'View all ›'}</button></div>
        <div class="${mem.all ? 'v2-grid' : 'mem-mini'}" id="memGrid"></div>
        ${mem.all ? '' : `<div class="mem-rar">${RARITY_ORDER.map((r) => `<span style="--rc:var(--r-${r})"><i>◆</i>${esc(ctx.RARITY_LABEL[r] || r)} <b>${byR(r)}</b></span>`).join('')}</div>`}
      </div>
    </section>

    <aside class="mem-right">
      ${ctx.hallOn?.() ? '<div class="mem-col mem-wish" id="memWish"><div class="tile-h"><b>♡ Wishlist</b></div><p class="v2-empty">Loading…</p></div>' : ''}
      <div class="mem-col mem-hunt">${huntBoxHTML(p)}</div>
      ${ctx.hallOn?.() ? '' : `<div class="mem-col mem-need">${self ? selfNeedHTML(achs) : needHTML(cards)}</div>`}
    </aside>
  </div>`;

  // The mini season grid (or all their cards, paged).
  const grid = el('memGrid');
  if (mem.all) {
    const owned = cards.filter((c) => c.owned).sort((a, b) => (b.power || 0) - (a.power || 0));
    paintCards(grid, el('memPager'), owned, mem, (c) => ctx.openViewer(c, { list: owned }));
  } else {
    grid.innerHTML = season.map((c) => (c.owned
      ? `<button class="mem-mini-card r-${c.rarity}" data-id="${c.id}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""></button>`
      : '<span class="mem-mini-card lock">🔒</span>')).join('');
    grid.onclick = (e) => { const b = e.target.closest('[data-id]'); const c = b && cards.find((x) => String(x.id) === b.dataset.id); if (c) ctx.openViewer(c); };
  }
  // My own profile: the Spotlight, title and frame editor (its only door was the Home Spotlight,
  // which design 19 removed: Nathan, 2026-10-01 "titles/frames aren't accessible").
  el('memStyle')?.addEventListener('click', () => openSpotEditor());
  el('memCos')?.addEventListener('click', () => openSpotEditor());
  el('memSpot')?.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); const c = b && cards.find((x) => String(x.id) === b.dataset.id); if (c) ctx.openViewer(c); });
  el('memAll').addEventListener('click', () => { mem.all = !mem.all; mem.page = 0; paintMember(); });
  el('memBoon')?.addEventListener('click', () => ctx.playOnMember('boon', { id: p.id, name: p.name }));
  el('memPrank')?.addEventListener('click', () => ctx.playOnMember('prank', { id: p.id, name: p.name }));
  const trade = () => { closeMember(); ctx.openTrade({ id: p.id, name: p.name }); };
  el('memTrade')?.addEventListener('click', trade);
  box.querySelectorAll('.need-ask').forEach((b) => b.addEventListener('click', trade));
  box.querySelectorAll('.need-card').forEach((b) => b.addEventListener('click', () => {
    const c = [...cards, ...mergedCards()].find((x) => String(x.id) === b.dataset.id);
    if (c && c.image_url) ctx.openViewer(c);
  }));
  // Fit after the browser lays the new screen out (measured too early, it emptied the lists).
  requestAnimationFrame(() => { fitNeed(box); fitChildren(el('memAch')); if (!mem.all) fitChildren(el('memGrid')); });
  if (ctx.hallOn?.()) loadWish(p.id, self);
  setTimeout(() => fitNeed(box), 300); // again after the fonts and images load
}

// ---- UI-14 v3 (body.ui-v3 only): the same data and element ids, the approved layout (src/ui3/profile.js) ----
let memLay = '';
function paintMemberV3({ box, p, self, cards, s, achs, done, pres, sIco, sTxt, season, ownedN, byR, spot, spotOrder, effects }) {
  const lay = pf3.layoutOf(document.body.dataset.size, innerWidth, innerHeight);
  memLay = lay;
  const spotItems = spotOrder.map((c0, i) => { const { card, stache } = spotPrank(c0, p.id, i); return { id: c0.id, card, stache, main: c0 === spot[0] }; });
  const all = mem.all;
  box.innerHTML = pf3.profileHTML({
    p, self, lay, all, effects,
    avatar: avatarHTML(p.id, p.name, `u3-pf-av${pres ? ' live' : ''}`, p.frame),
    name: nameBadge(p.id, p.name), title: p.title,
    pres: pres ? { ico: sIco, txt: sTxt } : null,
    stats: [[`${ownedN}/${season.length}`, 'Cards'], [p.huntRank ? `#${p.huntRank}` : '—', 'Hunt rank'], [`${done.length}/${achs.length}`, 'Achievements'],
      [fmt(s.packsOpened), 'Packs opened'], [p.power != null ? fmt(p.power) : '—', 'Power'], [String(byR('full_art')), 'Full Arts']],
    done, total: achs.length, spot: spotItems,
    season: { name: col.season || 'Season 1', owned: ownedN, total: season.length, pct: Math.round((100 * ownedN) / (season.length || 1)) },
    rarities: RARITY_ORDER.map((r) => ({ r, label: ctx.RARITY_LABEL[r] || r, n: byR(r) })),
    wish: !!ctx.hallOn?.(),
    huntHTML: pf3.huntHTML(p.hunt, p.huntRank, p.hunt ? huntBoxHTML(p).replace(/^<div class="tile-h">[\s\S]*?<\/div>/, '') : ''),
  });
  const { el } = ctx;
  const owned = cards.filter((c) => c.owned).sort((a, b) => (b.power || 0) - (a.power || 0));
  const open = (e) => { const b = e.target.closest('button[data-id]'); const c = b && cards.find((x) => String(x.id) === b.dataset.id); if (c) ctx.openViewer(c, all ? { list: owned } : undefined); };
  el('memSpot')?.addEventListener('click', open);
  el('memGrid')?.addEventListener('click', open);
  el('memStyle')?.addEventListener('click', () => openSpotEditor());
  el('memCos')?.addEventListener('click', () => openSpotEditor());
  el('memAll').addEventListener('click', () => { mem.all = !mem.all; mem.page = 0; paintMember(); });
  el('memBoon')?.addEventListener('click', () => ctx.playOnMember('boon', { id: p.id, name: p.name }));
  el('memPrank')?.addEventListener('click', () => ctx.playOnMember('prank', { id: p.id, name: p.name }));
  el('memTrade')?.addEventListener('click', () => { closeMember(); ctx.openTrade({ id: p.id, name: p.name }); });
  box.querySelector('.u3-pf-tabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-seg]'); if (!b) return; mem.pane = b.dataset.seg.slice(3); fit(); });
  el('memPager')?.addEventListener('click', (e) => { const b = e.target.closest('button[data-page]'); if (!b || b.disabled) return; mem.page += b.dataset.page === 'next' ? 1 : -1; pf3.fitAll(el('memGrid'), el('memPager'), owned, mem); });
  const fit = () => {
    if (!box.querySelector('.u3-pf')) return;
    pf3.fitTight(box.querySelector('.u3-pf'), mem.pane, () => pf3.fitStats(box.querySelector('.u3-pf-stats')));
    pf3.fitAch(el('memAch'), done);
    pf3.fitSpot(el('memSpot'));
    if (all) pf3.fitAll(el('memGrid'), el('memPager'), owned, mem); else pf3.fitMini(el('memGrid'), season);
  };
  requestAnimationFrame(fit);
  document.fonts?.ready.then(() => { if (memFit === fit) fit(); });   // the number font changes the widths
  memFit = fit;
  if (ctx.hallOn?.()) loadWish(p.id, self);
}
// A resize: a new layout paints again, the same layout fits again (no scroll, G-010).
let memFit = null; let memRT = null;
addEventListener('resize', () => {
  if (!memFit || !pf3.isV3() || ctx?.el('memberModal')?.classList.contains('hidden')) return;
  clearTimeout(memRT);
  memRT = setTimeout(() => { if (pf3.layoutOf(document.body.dataset.size, innerWidth, innerHeight) !== memLay) paintMember(); else memFit(); }, 150);
});

// ---- The Wishlist (5 slots, one card each; everyone can see it) ------------------------------
const wl = { id: null, self: false, slots: [], edit: false, pick: null, rarity: 'normal', q: '', page: 0, sel: null, msg: '' };
async function loadWish(id, self) {
  let d = null;
  try { d = await ctx.api(`/api/wishlist?id=${encodeURIComponent(id)}`); } catch { d = null; }
  Object.assign(wl, { id: String(id), self, slots: d?.slots || [], pick: null, msg: '' });
  paintWish();
}
function paintWish() {
  const box = ctx.el('memWish');
  if (!box) return;
  const n = wl.slots.filter((x) => x.card).length;
  if (pf3.isV3() && box.closest('.u3-pf')) {   // v3 (UI-16, D-128): the Profile shows a handle strip; a tap or a drag up opens the drawer
    box.innerHTML = pf3.wishBarHTML(n, wl.slots.length || 5);
    pf3.bindWishHandle(ctx.el('wlHandle'), (h) => openWishV3(h));
    memFit?.();
    return;
  }
  box.innerHTML = `<div class="tile-h"><b>♡ Wishlist</b><span class="grow"></span><span class="mono dim">${n}/5</span>
      ${wl.self ? `<button class="v2-chip-btn${wl.edit ? ' gold' : ''}" id="wlEdit">${wl.edit ? '✓ Done' : '✎ Edit'}</button>` : ''}</div>
    <div class="wl-list">${wl.slots.map((x) => `<div class="wl-row${wl.pick === x.slot ? ' on' : ''}" data-slot="${x.slot}"><span class="wl-i mono">${x.slot}</span>
      ${x.card ? `<img src="${thumb(x.card.image_url)}" data-full="${x.card.image_url || ''}" alt=""><div><b>${esc(x.card.name)}</b><span style="color:var(--r-${x.card.rarity})">◆ ${esc(ctx.RARITY_LABEL[x.card.rarity] || x.card.rarity)}</span></div>`
        : '<span class="wl-empty">＋</span><div><b class="dim">Empty</b></div>'}
      <span class="grow"></span>${x.top && !(wl.self && wl.edit) ? '<span class="wl-topmark" title="Top want: the card the Wanted view shows">★</span>' : ''}
      ${!wl.self && x.card ? `<span class="hl-n${x.mine ? ' have' : ''}" title="Your free copies">⧉ ×${x.mine}</span>` : ''}
      ${wl.self && wl.edit ? (x.card ? `<button class="v2-icon wl-top${x.top ? ' on' : ''}" data-slot="${x.slot}" title="Top want: the card the Wanted view shows">★</button><button class="v2-icon wl-x" data-slot="${x.slot}" title="Clear">✕</button>` : '') + `<button class="v2-icon wl-set" data-slot="${x.slot}" title="Pick a card">✎</button>` : ''}</div>`).join('')}</div>
    ${wl.msg ? `<span class="tr-msg">${esc(wl.msg)}</span>` : ''}`;
  // A portrait phone: the Wishlist sits beside the hunt tile; in Edit it takes the full width (ui-v2-mobile.css).
  ctx.el('memberModal')?.querySelector('.mem-screen')?.classList.toggle('wl-open', isPort() && wl.edit);
  ctx.el('wlEdit')?.addEventListener('click', (e) => { if (wishV3()) { openWishV3(e.currentTarget); return; } wl.edit = !wl.edit; wl.pick = null; closeWishPicker(); paintWish(); });
  box.querySelectorAll('.wl-x').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); saveWish(Number(b.dataset.slot), null); }));
  box.querySelectorAll('.wl-top').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); saveTop(Number(b.dataset.slot)); }));
  box.querySelectorAll('.wl-set').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openWishPicker(Number(b.dataset.slot)); }));
  box.querySelectorAll('.wl-row').forEach((r) => r.addEventListener('click', () => {
    const x = wl.slots.find((k) => k.slot === Number(r.dataset.slot));
    if (wl.self && wl.edit) { openWishPicker(x.slot); return; }
    const c = x?.card && (ctx.cache.catalog?.cards || []).find((k) => Number(k.id) === Number(x.card.id));
    if (c) ctx.openViewer(c);
  }));
  if (pf3.isV3() && box.closest('.u3-pf')) memFit?.(); // v3: fit again with the rows (the tight steps, "+N more": UI-14 C12)
}
async function saveWish(slot, cardId) {
  let r = null;
  try { r = await ctx.apiPost('/api/wishlist', { slot, cardId }); } catch { r = null; }
  wl.msg = r?.ok ? '' : (r?.message || 'Could not save that.');
  closeWishPicker();
  await loadWish(wl.id, wl.self);
  wl.edit = true; paintWish();
  if (r?.ok) hallChanged();
}
// The Trade Hall's Wanted view shows my top want: reload it (a dynamic import: ui-v2-hall imports this file).
const hallChanged = () => import('./ui-v2-hall.js').then((m) => m.refreshHall()).catch(() => {});
// Star a slot as the top want (hall_top_want.sql).
async function saveTop(slot) {
  let r = null;
  try { r = await ctx.apiPost('/api/wishlist/top', { slot }); } catch { r = null; }
  wl.msg = r?.ok ? '' : (r?.message || 'Could not save that.');
  await loadWish(wl.id, wl.self);
  wl.edit = true; paintWish();
  if (r?.ok) hallChanged();
}
// The card picker over the center column: search, a rarity row, Clear + Save (frame 02).
function openWishPicker(slot) {
  const center = ctx.el('memberModal')?.querySelector('.mem-center, .u3-pf'); // v3: over the whole profile until UI-16
  if (!center) return;
  const cur = wl.slots.find((x) => x.slot === slot)?.card;
  Object.assign(wl, { pick: slot, sel: cur ? Number(cur.id) : null, rarity: cur?.rarity || wl.rarity, page: 0 });
  center.querySelector('.wl-picker')?.remove();
  center.insertAdjacentHTML('beforeend', `<div class="wl-picker mem-col"><div class="tile-h"><b>♡ Slot ${slot}</b><span class="grow"></span><button class="v2-icon" id="wlClose" title="Close">✕</button></div>
    <div class="v2-col-head"><input class="v2-search" id="wlQ" placeholder="Search cards" value="${esc(wl.q)}"><span class="grow"></span><div class="v2-pager" id="wlPager"></div></div>
    <div class="v2-grid" id="wlGrid"></div>
    <div class="side-h">Rarity</div><div class="seg wl-rar" id="wlRar">${RARITY_ORDER.map((r) => `<button data-r="${r}" class="${wl.rarity === r ? 'on' : ''}" style="--rc:var(--r-${r})"><i>◆</i> ${esc(ctx.RARITY_LABEL[r] || r)}</button>`).join('')}</div>
    <div class="wl-foot"><span class="grow"></span><button class="v2-btn" id="wlClear">↺ Clear</button><button class="v2-btn gold" id="wlSave">✓ Save</button></div></div>`);
  const paint = () => {
    const q = wl.q.trim().toLowerCase();
    const items = (ctx.cache.catalog?.cards || []).filter((c) => c.rarity === wl.rarity && (!q || c.name.toLowerCase().includes(q))).map((c) => ({ ...c, owned: true, locked: false }));
    paintCards(ctx.el('wlGrid'), ctx.el('wlPager'), items, wl, (c) => { wl.sel = Number(c.id); paint(); }, wl.sel);
  };
  paint();
  ctx.el('wlQ').addEventListener('input', (e) => { wl.q = e.target.value; wl.page = 0; paint(); });
  ctx.el('wlRar').onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b) return; wl.rarity = b.dataset.r; wl.page = 0; wl.sel = null; center.querySelectorAll('#wlRar button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  ctx.el('wlClose').onclick = () => { closeWishPicker(); wl.pick = null; paintWish(); };
  ctx.el('wlClear').onclick = () => saveWish(slot, null);
  ctx.el('wlSave').onclick = () => { if (wl.sel) saveWish(slot, wl.sel); };
  paintWish();
}
function closeWishPicker() { ctx.el('memberModal')?.querySelector('.wl-picker')?.remove(); }
// v3 (UI-16, body.ui-v3 only): the Wishlist handle opens the drawer (D-128), and the pencil opens the Card picker (src/ui3/wishlist.js).
const wishV3 = () => document.body.classList.contains('ui-v3');
function openWishV3() {
  const id = wl.id;
  openWishlist({
    slots: wl.slots, returnFocus: () => ctx.el('wlHandle'), readonly: !wl.self, rarityLabel: ctx.RARITY_LABEL,
    view: (cardId) => { const c = (ctx.cache.catalog?.cards || []).find((k) => Number(k.id) === cardId); if (c) ctx.openViewer(c); },
    load: () => ctx.api(`/api/wishlist?id=${encodeURIComponent(id)}`),
    save: (slot, cardId) => ctx.apiPost('/api/wishlist', { slot, cardId }),
    star: (slot) => ctx.apiPost('/api/wishlist/top', { slot }),
    cards: () => mergedCards(),
    lib: { rarities: RARITY_ORDER.map((r) => [r, ctx.RARITY_LABEL[r] || r]), elements: ELEMENT_ORDER.map((e) => [e, ELEMENTS[e].name]), types: TYPES, games: GAMES, elementOf: (c) => cardElement(c.tags) },
    detail: (c) => ctx.openViewer(c),
    onChange: () => { if (wl.id === id) loadWish(id, wl.self); hallChanged(); },
  });
}

// Their damage in the live hunt, per day, and their best card.
function huntBoxHTML(p) {
  const h = p.hunt;
  if (!h) return '<div class="tile-h"><b>⚔ Pride Hunt</b></div><p class="v2-empty">No boss is live.</p>';
  const days = h.byDay || [];
  const max = Math.max(1, ...days.map((d) => d.damage));
  const today = mtToday();
  const bars = days.map((d) => `<div class="hb"><i style="height:${Math.max(6, Math.round((100 * d.damage) / max))}%" class="${d.date === today ? 'now' : ''}" title="${fmt(d.damage)}"></i><span>${DAY[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}</span></div>`).join('');
  const top = h.topCard && (ctx.cache.catalog?.cards || []).find((c) => Number(c.id) === h.topCard.id);
  return `<div class="tile-h"><b>⚔ ${esc(h.name)}</b><span class="grow"></span>${p.huntRank ? `<span class="mem-rank">#${p.huntRank}</span>` : ''}</div>
    <div class="mem-hstats"><div><b>${fmt(h.damage)}</b><span>Damage</span></div><div><b>${fmt(h.attacks)}</b><span>Attacks</span></div><div><b class="hunt">${h.share}%</b><span>Of boss HP</span></div></div>
    <div class="mem-bars">${bars || '<p class="v2-empty">No attacks yet.</p>'}</div>
    ${top ? `<div class="mem-top-card"><img src="${thumb(top.image_url)}" data-full="${top.image_url || ''}" alt=""><div><span class="side-h">Top card</span><b>${esc(top.name)}</b></div><span class="mono">⚡ ${fmt(h.topCard.damage)}</span></div>` : ''}`;
}

// Cards they own that I do not ("You need"), and cards I own that they do not.
function needHTML(theirs) {
  const mine = mergedCards();
  const iOwn = new Set(mine.filter((c) => c.owned).map((c) => c.id));
  const theyOwn = new Set(theirs.filter((c) => c.owned).map((c) => c.id));
  const rank = (c) => RARITY_ORDER.indexOf(c.rarity);
  const youNeed = theirs.filter((c) => c.owned && !iOwn.has(c.id)).sort((a, b) => rank(b) - rank(a));
  const theyNeed = mine.filter((c) => c.owned && !theyOwn.has(c.id)).sort((a, b) => rank(b) - rank(a));
  return `<div class="tile-h"><b>⇄ You need</b><span class="grow"></span><span class="n mono">${youNeed.length}</span></div>
    <div class="need-list">${youNeed.slice(0, 6).map((c) => `<div class="need-row"><button class="need-card" data-id="${c.id}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""></button>
      <div><b>${esc(c.name)}</b><span style="color:var(--r-${c.rarity})">◆ ${esc(ctx.RARITY_LABEL[c.rarity] || c.rarity)}</span></div><button class="v2-chip-btn need-ask">Ask</button></div>`).join('') || '<p class="v2-empty">You have every card they have.</p>'}</div>
    <div class="they-need"><span>They need</span><span class="tn-cards">${theyNeed.slice(0, 4).map((c) => `<button class="need-card sm" data-id="${c.id}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""></button>`).join('')}</span><b class="mono">${theyNeed.length}</b></div>`;
}
function selfNeedHTML(achs) {
  return `<div class="tile-h"><b>🏆 Closest achievements</b></div>
    <div class="need-list">${achs.filter((a) => !a.done).slice(0, 5).map((a) => achHTML(a, false, true)).join('')}</div>`;
}
