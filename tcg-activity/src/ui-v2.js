// UI v2 screens (docs/design.md, design/08-v3-*.png): Home, Collection, Achievements,
// member profiles. main.js owns the data, the streams, and the Hunt; this module only
// paints. It is used only when /api/flags says uiV2, so the v1 screens are untouched.

import { cardElement, ELEMENTS, ELEMENT_ORDER } from './elements.js';
import { fillViewerEffect } from './effects-ui.js';
import { mountBoss } from './boss.js';
import { measure } from './achievements.js';

let ctx = null; // { api, apiPost, el, esc, cache, live, show, openViewer, RARITY_LABEL, ago, features, user, currentView, refreshOwned }
export function initV2(c) { ctx = c; }

const RARITY_ORDER = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'];
const TOP_RARITY = new Set(['secret_rare', 'full_art', 'gold', 'event', 'promo']);
const GAP = 14;
const CAP_H = 24; // the caption row under each card (element, power, stars, copies)

const initial = (name) => esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
function esc(s) { return ctx.esc(s ?? ''); }
const fmt = (n) => Number(n || 0).toLocaleString();

/** A round Discord avatar: the picture from /api/avatar, the initial when there is none. */
export function avatarHTML(id, name, cls = '') {
  const img = id ? `<img src="/api/avatar/${esc(id)}" alt="" onerror="this.remove()">` : '';
  return `<span class="v2-avatar ${cls}"><span>${initial(name)}</span>${img}</span>`;
}

// ---- Shared card data ------------------------------------------------------

// The full catalog with a collection merged in (default: the caller's).
function mergedCards(ownedList = ctx.cache.collection?.cards || []) {
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
const cardHp = (power) => Math.max(30, Math.round((power || 0) * 1.8)); // = /api/hunt max_hp
const numLabel = (n) => `#${String(n).padStart(3, '0')}`;
function elemOf(c) { const e = cardElement(c.tags); return e ? { key: e, ...ELEMENTS[e] } : null; }

// The caller's profile (stats for the achievements, the spotlight). Loaded once per view.
let myProfile = null;
async function loadMyProfile(force) {
  if (myProfile && !force) return myProfile;
  try { myProfile = await ctx.api('/api/profile'); } catch { /* keep */ }
  return myProfile;
}
async function ensureCatalog() {
  if (ctx.cache.catalog) return;
  try { ctx.cache.catalog = await ctx.api('/api/catalog'); } catch { ctx.cache.catalog = { cards: [] }; }
}

// One card cell: the card image exactly as it is printed (500x700, its own frame),
// and a caption row under it. A missing card is a locked slot with its number.
function tileHTML(c, idx, selected) {
  if (c.locked) {
    return `<div class="v2-cell${selected ? ' sel' : ''}" data-idx="${idx}"><div class="v2-card locked"><span class="lk">🔒</span><span class="num">${numLabel(c.num)}</span></div><div class="v2-cap"></div></div>`;
  }
  const el = elemOf(c);
  return `<div class="v2-cell${selected ? ' sel' : ''}" data-idx="${idx}">
    <div class="v2-card r-${c.rarity}">${c.image_url ? `<img src="${c.image_url}" alt="${esc(c.name)}" loading="lazy">` : ''}</div>
    <div class="v2-cap">${el ? `<span class="cap-el" title="${esc(el.name)}">${el.glyph}</span>` : ''}<span class="cap-pow">⚡ ${c.power ?? ''}</span>
      ${c.ascension > 0 ? `<span class="cap-stars">${'★'.repeat(c.ascension)}</span>` : ''}${c.quantity > 1 ? `<span class="cap-qty">×${c.quantity}</span>` : ''}</div>
  </div>`;
}

// Fit a grid of cells to its box: the most cards that fit with no scroll.
function fitGrid(grid, n) {
  const w = grid.clientWidth || 600;
  const h = grid.clientHeight || 420;
  let best = { cols: 1, rows: 1, cw: 80 };
  for (let rows = 1; rows <= 4; rows++) {
    const byH = ((h - (rows - 1) * GAP) / rows - CAP_H) * 5 / 7;
    for (let cols = 2; cols <= 9; cols++) {
      const byW = (w - (cols - 1) * GAP) / cols;
      const cw = Math.floor(Math.min(byW, byH));
      if (cw < 96) continue;
      // Prefer the largest card that still shows at least 10 slots (or all cards).
      const score = Math.min(cols * rows, Math.max(10, n)) * 1000 + cw;
      if (score > best.score || !best.score) best = { cols, rows, cw, score };
    }
  }
  grid.style.setProperty('--cw', `${best.cw}px`);
  grid.style.setProperty('--cols', best.cols);
  return best.cols * best.rows;
}

// Paint a paged card grid. items: cards; state: { page }; onPick(card).
function paintCards(grid, pager, items, state, onPick, selId, dir) {
  const per = fitGrid(grid, items.length);
  const pages = Math.max(1, Math.ceil(items.length / per));
  state.page = Math.min(Math.max(0, state.page), pages - 1);
  const start = state.page * per;
  grid.innerHTML = items.length
    ? items.slice(start, start + per).map((c, i) => tileHTML(c, start + i, c.id === selId)).join('')
    : '<p class="v2-empty">No cards match.</p>';
  if (dir) { grid.classList.remove('slide-next', 'slide-prev'); void grid.offsetWidth; grid.classList.add(dir === 'next' ? 'slide-next' : 'slide-prev'); }
  grid.onclick = (e) => {
    const t = e.target.closest('.v2-cell');
    const c = t && items[Number(t.dataset.idx)];
    if (c) onPick(c, t);
  };
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
}

// ---- Achievements ------------------------------------------------------------

function achHTML(a, big, mini) {
  const pct = Math.round((100 * a.have) / a.need);
  return `<button class="v2-ach${a.done ? ' done' : ''}${big ? ' big' : ''}${mini ? ' mini' : ''}" data-ach="${esc(a.key)}" title="${esc(a.desc)}">
    <div class="ah-top"><span class="ah-ico">${a.icon}</span><b>${esc(a.name)}</b><span class="ah-n">${a.done ? '✓' : `${fmt(a.have)}/${fmt(a.need)}`}</span></div>
    ${mini ? '' : `<div class="ah-desc">${esc(a.desc)}</div>`}
    <div class="ah-bar"><i style="width:${pct}%"></i></div>
  </button>`;
}

// ---- Collection ------------------------------------------------------------

const col = { season: null, rarity: 'all', element: null, q: '', page: 0, sel: null, view: 'cards', achKey: null, achPage: 0, detailPage: 0 };
let colItems = [];

export async function renderCollectionV2() {
  const { el } = ctx;
  if (!ctx.cache.catalog) el('main').innerHTML = '<div class="v2-loading">Loading…</div>';
  await Promise.all([ensureCatalog(), loadMyProfile()]);
  if (ctx.currentView() !== 'collection') return;
  const cards = mergedCards();
  const seasons = [...new Set(cards.map((c) => c.season || 'Season 1'))];
  if (!seasons.includes(col.season)) col.season = seasons[0] || 'Season 1';
  const inSeason = cards.filter((c) => (c.season || 'Season 1') === col.season);
  const achs = measure(cards, myProfile?.stats);
  const achDone = achs.filter((a) => a.done).length;

  const setRows = seasons.map((s) => {
    const set = cards.filter((c) => (c.season || 'Season 1') === s);
    const have = set.filter((c) => c.owned).length;
    return `<button class="side-row set${s === col.season ? ' on' : ''}" data-season="${esc(s)}"><span>${esc(s)}</span><span class="n">${have}/${set.length}</span><i class="bar"><i style="width:${Math.round((100 * have) / (set.length || 1))}%"></i></i></button>`;
  }).join('');
  const rarityRows = RARITY_ORDER.filter((r) => inSeason.some((c) => c.rarity === r)).map((r) => {
    const set = inSeason.filter((c) => c.rarity === r);
    return `<button class="side-row rar${col.rarity === r ? ' on' : ''}" data-rarity="${r}" style="--rc:var(--r-${r})"><span><i class="dia">◆</i>${esc(ctx.RARITY_LABEL[r] || r)}</span><span class="n">${set.filter((c) => c.owned).length}/${set.length}</span></button>`;
  }).join('');
  // Element filters live in the sidebar, so the page arrows in the header are never
  // pushed off the screen (that hid pages 2+ of every element, Nathan 2026-09-27).
  const elemBtns = ELEMENT_ORDER.filter((e) => inSeason.some((c) => cardElement(c.tags) === e)).map((e) => {
    const n = inSeason.filter((c) => cardElement(c.tags) === e).length;
    return `<button class="el-btn${col.element === e ? ' on' : ''}" data-el="${e}" title="${ELEMENTS[e].name} · ${n}" style="--el:${ELEMENTS[e].color}">${ELEMENTS[e].glyph}</button>`;
  }).join('');

  let center;
  if (col.view === 'ach') {
    center = `<div class="v2-col-head"><h2>Achievements <span class="sub">${achDone} / ${achs.length}</span></h2><span class="grow"></span><div class="v2-pager" id="achPager"></div><button class="v2-icon" id="achClose" aria-label="Close">✕</button></div>
      <div class="v2-ach-grid" id="achGrid"></div>`;
  } else if (col.view === 'achDetail') {
    const a = achs.find((x) => x.key === col.achKey);
    center = a ? achDetailHead(a) : '';
  } else {
    const filtered = colFiltered();
    const parts = [col.element ? ELEMENTS[col.element].name : null, col.rarity !== 'all' ? ctx.RARITY_LABEL[col.rarity] : null, col.q.trim() ? `"${col.q.trim()}"` : null].filter(Boolean);
    const sub = parts.length
      ? `${esc(parts.join(' · '))} · ${filtered.length} cards · ${filtered.filter((c) => c.owned).length} owned`
      : `${inSeason.filter((c) => c.owned).length}/${inSeason.length} · ${Math.round((100 * inSeason.filter((c) => c.owned).length) / (inSeason.length || 1))}%`;
    center = `<div class="v2-col-head"><h2>${esc(col.season)} <span class="sub">${sub}</span></h2><span class="grow"></span>
        ${parts.length ? '<button class="v2-chip-btn" id="colClear">Clear filters ✕</button>' : ''}<div class="v2-pager" id="colPager"></div></div>
      <div class="v2-grid" id="colGrid"></div>`;
  }

  el('main').innerHTML = `<div class="v2-collection">
    <aside class="v2-side">
      <input class="v2-search" id="colSearch" placeholder="Search cards, tags…" value="${esc(col.q)}">
      <div class="side-h">Sets</div>${setRows}
      <div class="side-h">Rarity</div>${rarityRows}
      <div class="side-h">Element</div><div class="el-grid">${elemBtns}</div>
      <div class="side-h">Achievements <span class="n">${achDone} / ${achs.length}</span></div>
      <div class="side-ach" id="sideAch">${achs.slice(0, 4).map((a) => achHTML(a, false, true)).join('')}</div>
      <button class="side-more${col.view === 'ach' ? ' on' : ''}" id="achToggle">See All Achievements</button>
    </aside>
    <section class="v2-center" id="colCenter">${center}</section>
    <aside class="v2-panel" id="colPanel"></aside>
  </div>`;

  const toCards = () => { col.view = 'cards'; col.page = 0; };
  el('colSearch').addEventListener('input', (e) => {
    col.q = e.target.value; col.page = 0;
    if (col.view !== 'cards') { toCards(); renderCollectionV2().then(() => { const s = el('colSearch'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }); return; }
    paintColGrid(); paintHead();
  });
  el('main').querySelectorAll('.side-row.set').forEach((b) => b.addEventListener('click', () => { col.season = b.dataset.season; toCards(); renderCollectionV2(); }));
  el('main').querySelectorAll('.side-row.rar').forEach((b) => b.addEventListener('click', () => { col.rarity = col.rarity === b.dataset.rarity ? 'all' : b.dataset.rarity; toCards(); renderCollectionV2(); }));
  el('main').querySelectorAll('.el-grid .el-btn').forEach((b) => b.addEventListener('click', () => { col.element = col.element === b.dataset.el ? null : b.dataset.el; toCards(); renderCollectionV2(); }));
  el('colClear')?.addEventListener('click', () => { col.element = null; col.rarity = 'all'; col.q = ''; toCards(); renderCollectionV2(); });
  el('achToggle').addEventListener('click', () => { col.view = col.view === 'ach' ? 'cards' : 'ach'; renderCollectionV2(); });
  el('achClose')?.addEventListener('click', () => { col.view = 'cards'; renderCollectionV2(); });
  // Any achievement (sidebar or grid) opens its detail: the cards it needs.
  el('main').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ach]');
    if (!b) return;
    col.view = 'achDetail'; col.achKey = b.dataset.ach; col.detailPage = 0;
    renderCollectionV2();
  });

  fitChildren(el('sideAch'));
  if (col.view === 'ach') paintAch(achs);
  else if (col.view === 'achDetail') paintAchDetail(achs.find((x) => x.key === col.achKey));
  else paintColGrid();
  const selCard = cards.find((c) => c.id === col.sel) || inSeason.find((c) => c.owned) || inSeason[0];
  paintPanel(selCard);
}

function paintHead() {
  // The header sub-line follows the search as the member types.
  const { el } = ctx;
  const h = el('colCenter')?.querySelector('.v2-col-head .sub');
  if (!h || col.view !== 'cards') return;
  const f = colFiltered();
  if (col.q.trim() || col.element || col.rarity !== 'all') h.textContent = `${f.length} cards · ${f.filter((c) => c.owned).length} owned`;
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
      <h2>${esc(a.name)} <span class="sub">${esc(a.desc)} · ${a.done ? 'Complete' : `${fmt(a.have)} / ${fmt(a.need)}`}</span></h2>
      <span class="grow"></span><div class="v2-pager" id="detPager"></div></div>
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
  paintCards(grid, el('detPager'), items, st, (c, t) => { col.detailPage = st.page; pickCard(c, t, grid); }, col.sel);
}

function colFiltered() {
  const q = col.q.trim().toLowerCase();
  return mergedCards().filter((c) => {
    if ((c.season || 'Season 1') !== col.season) return false;
    if (col.rarity !== 'all' && c.rarity !== col.rarity) return false;
    if (col.element && cardElement(c.tags) !== col.element) return false;
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
function pickCard(c, node, grid) {
  col.sel = c.id;
  grid.querySelectorAll('.v2-cell.sel').forEach((n) => n.classList.remove('sel'));
  node?.classList.add('sel');
  paintPanel(c);
  if (!c.locked) ctx.openViewer(c);
}

const colState = { get page() { return col.page; }, set page(v) { col.page = v; } };
function paintColGrid() {
  const { el } = ctx;
  const grid = el('colGrid');
  if (!grid) return;
  colItems = colFiltered();
  paintCards(grid, el('colPager'), colItems, colState, (c, t) => pickCard(c, t, grid), col.sel);
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
  const power = c.power || 0;
  const hp = cardHp(power);
  const bar = (label, val, max, color, shown) => `<div class="stat"><b>${shown}</b><span>${label}</span><i class="sbar"><i style="width:${Math.min(100, Math.round((100 * val) / max))}%;background:${color}"></i></i></div>`;
  const t = c.tags || {};
  const chips = [];
  if (el0) chips.push(`<span class="tag el" style="--el:${el0.color}">${el0.glyph} ${el0.name}</span>`);
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
    ascHTML = a >= 5
      ? '<div class="asc"><div class="pb-h"><span class="side-h">Ascension</span><span>★5 max</span></div></div>'
      : `<div class="asc"><div class="pb-h"><span class="side-h">Ascension</span><span class="mono">${Math.min(spare, need || 0)} / ${need} copies</span></div><i class="sbar"><i style="width:${need ? Math.min(100, Math.round((100 * spare) / need)) : 0}%;background:var(--gold)"></i></i></div>`;
  }
  const inSpot = (myProfile?.spotlight || []).map(Number).includes(Number(c.id));
  const canAsc = !c.locked && ctx.features().ascension && a < 5 && c.can_ascend;
  const owned = c.locked ? 'Not in your collection yet' : `${c.quantity} ${c.quantity === 1 ? 'copy' : 'copies'}`;
  box.innerHTML = `<div class="p-top">
      <div class="p-art${c.locked ? ' locked' : ''}" id="pArt">${!c.locked && c.image_url ? `<img src="${c.image_url}" alt="">` : '<span class="lk">🔒</span>'}</div>
      <div class="p-id">
        <span class="p-num">${numLabel(c.num)} · ${esc(c.season || 'Season 1').toUpperCase()}</span>
        <h3>${esc(c.name)}</h3>
        <span class="p-rar" style="--rc:var(--r-${c.rarity})">● ${esc(ctx.RARITY_LABEL[c.rarity] || c.rarity)}</span>
        <span class="p-stars">${'★'.repeat(a)}<i>${'☆'.repeat(5 - a)}</i><span class="p-own">${owned}</span></span>
        <div class="p-stats">
          ${bar('Power', power, maxPow, 'var(--gold)', power)}
          ${bar('HP', hp, cardHp(maxPow), 'var(--danger)', hp)}
          ${bar('Crit', 10, 25, 'var(--el-lightning)', '10%')}
        </div>
      </div>
    </div>
    ${c.lore ? `<p class="p-lore">“${esc(c.lore)}”</p>` : ''}
    ${abHTML}
    <div class="pbox fx hidden" id="colEffect"></div>
    ${chips.length ? `<div class="p-tags" id="pTags">${chips.join('')}</div>` : ''}
    ${ascHTML}
    ${c.artist ? `<div class="p-credit">🎨 Art by <b>${esc(c.artist)}</b></div>` : ''}
    <div class="p-actions">
      ${canAsc ? `<button class="v2-btn gold" id="pAscend">Ascend to ★${a + 1} · uses ${c.next_cost}</button>` : ''}
      ${c.locked ? '' : `<button class="v2-icon${inSpot ? ' on' : ''}" id="pSpot" title="${inSpot ? 'Remove from Spotlight' : 'Add to Spotlight'}">${inSpot ? '★' : '☆'}</button>`}
      <button class="v2-icon" id="pTrade" title="Trade">⇄</button>
    </div>`;
  el('pArt')?.addEventListener('click', () => { if (!c.locked) ctx.openViewer(c); });
  el('pTrade')?.addEventListener('click', () => ctx.show('trading'));
  el('pSpot')?.addEventListener('click', () => toggleSpotlight(c));
  el('pAscend')?.addEventListener('click', () => ascend(c));
  fitPanel(box);
  fillViewerEffect(c, 'colEffect').then(() => fitPanel(box));
}

async function ascend(c) {
  const btn = ctx.el('pAscend');
  if (btn) { btn.disabled = true; btn.textContent = 'Ascending…'; }
  let r = null;
  try { r = await ctx.apiPost('/api/ascend', { cardId: c.id }); } catch { r = null; }
  if (!r?.ok) { if (btn) { btn.disabled = false; btn.textContent = 'Could not ascend'; } return; }
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
function spotHTML(cards) {
  return cards.map((c, i) => `<button class="spot-card r-${c.rarity}" data-si="${i}" title="${esc(c.name)}"><img src="${c.image_url || ''}" alt="${esc(c.name)}"></button>`).join('')
    || '<p class="v2-empty">No cards yet.</p>';
}

// ---- Home ------------------------------------------------------------------

let heroBoss = null;
const pullsTab = { v: 'all' };

export function disposeHomeV2() {
  if (heroBoss) { try { heroBoss.dispose(); } catch { /* ignore */ } heroBoss = null; }
}

export async function renderHomeV2() {
  const { el } = ctx;
  disposeHomeV2();
  el('main').innerHTML = `<div class="v2-home">
    <section class="v2-tile hero" id="homeHero"><div class="v2-loading">Loading…</div></section>
    <section class="v2-tile prof" id="homeProfile"></section>
    <section class="v2-tile voice" id="homeVoice"></section>
    <section class="v2-tile pulls" id="homePulls"></section>
  </div>`;
  paintVoice();
  paintPulls();
  paintProfile();
  const [hunt] = await Promise.all([
    ctx.features().hunt ? ctx.api('/api/hunt').catch(() => null) : Promise.resolve(null),
    loadMyProfile(true),
    ensureCatalog(),
  ]);
  if (ctx.currentView() !== 'home') return;
  paintProfile();
  paintHero(hunt);
}

function paintHero(d) {
  const { el } = ctx;
  const box = el('homeHero');
  if (!box) return;
  const h = d?.hunt;
  if (!h) {
    box.innerHTML = `<div class="hero-info"><span class="live-chip calm">PRIDE HUNT</span><h2>The hunt is resting</h2>
      <p class="hero-sub">${d?.lastResult ? esc(d.lastResult.status === 'defeated' ? `The pride defeated ${d.lastResult.name}.` : `${d.lastResult.name} escaped.`) : ''}</p>
      ${d?.nextSpawnAt ? `<div class="hero-next"><span>Next boss in</span><b class="mono" data-until="${esc(d.nextSpawnAt)}"></b></div>` : ''}</div>`;
    tickCloses();
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
      <div class="hero-row"><button class="v2-btn gold" id="heroJoin">⚔ Join the hunt</button><span class="mono dim">${rank}</span></div>
    </div>
    <div class="hero-stage"><canvas id="heroCanvas"></canvas></div>`;
  el('heroJoin').addEventListener('click', () => ctx.show('battling'));
  tickCloses();
  try { heroBoss = mountBoss(el('heroCanvas'), h.name || 'boss', h.tier); } catch { heroBoss = null; }
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
function fitChildren(box) {
  if (!box) return;
  const bottom = box.getBoundingClientRect().bottom;
  while (box.lastElementChild && box.children.length > 0 && box.lastElementChild.getBoundingClientRect().bottom > bottom + 1) box.lastElementChild.remove();
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
  box.innerHTML = `<div class="prof-head">${avatarHTML(me?.id, me?.name, 'big')}<h3>${esc(me?.name || '')}</h3>
      ${myProfile?.power != null ? `<span class="prof-cp">⚡ ${fmt(myProfile.power)}</span>` : ''}</div>
    ${profileStats(myProfile, cards)}
    <div class="side-h">Spotlight <button class="link-btn" id="spotEdit">Edit</button></div>
    <div class="spot-row" id="spotRow">${spotHTML(spot)}</div>`;
  el('spotRow').onclick = (e) => { const b = e.target.closest('[data-si]'); if (b) ctx.openViewer(spot[Number(b.dataset.si)]); };
  // Edit = the Collection, where the ☆ on a card adds it to the Spotlight.
  el('spotEdit').addEventListener('click', () => ctx.show('collection'));
}

const STATUS_TEXT = {
  home: ['🏠', 'On the home screen'], collection: ['📚', 'Browsing collection'], hunt: ['⚔', 'In the hunt'],
  battle: ['⚔', 'Attacking the boss'], trading: ['⇄', 'Trading'], opening: ['🎴', 'Opening a pack'],
};

export function paintVoice() {
  const { el } = ctx;
  const box = el('homeVoice');
  if (!box) return;
  const me = ctx.user();
  const people = [...(ctx.live.presence || [])];
  // The member always sees their own tile, first (Nathan: not "Just you right now").
  if (me && !people.some((p) => String(p.id) === String(me.id))) people.unshift({ id: me.id, name: me.name, status: { kind: 'home' } });
  people.sort((a, b) => (String(b.id) === String(me?.id)) - (String(a.id) === String(me?.id)));
  const tile = (p) => {
    const [ico, txt] = STATUS_TEXT[p.status?.kind] || ['•', 'Here'];
    const self = String(p.id) === String(me?.id);
    return `<button class="vc-tile k-${esc(p.status?.kind || 'here')}${self ? ' self' : ''}" data-member="${esc(p.id)}"><div class="vc-head">${avatarHTML(p.id, p.name, 'sm')}
      <div><b>${esc(p.name)}${self ? ' <i class="you">You</i>' : ''}</b><span class="vc-st">${ico} ${esc(txt)}</span></div></div>
      ${p.status?.card ? `<div class="vc-card">${esc(p.status.card)}</div>` : ''}</button>`;
  };
  box.innerHTML = `<div class="tile-h"><b>🎧 Live in voice</b><span class="dim">${people.length}</span>${people.length > 1 ? '<span class="live-chip sm">● LIVE</span>' : ''}</div>
    <div class="vc-grid">${people.slice(0, 6).map(tile).join('')}</div>`;
  box.onclick = (e) => { const t = e.target.closest('[data-member]'); if (t) openMember(t.dataset.member); };
}

export function paintPulls() {
  const { el } = ctx;
  const box = el('homePulls');
  if (!box) return;
  const all = ctx.live.pulls || [];
  const pulls = pullsTab.v === 'top' ? all.filter((p) => TOP_RARITY.has(p.rarity)) : all;
  const [first, ...rest] = pulls;
  const row = (p, i) => `<div class="pl-row" data-pi="${i}"><img src="${p.image_url || ''}" alt="" loading="lazy"><div class="pl-t"><b>${esc(p.player)}</b> pulled <span style="color:var(--r-${p.rarity}, var(--text-primary))">${esc(p.name)}</span></div><span class="mono dim">${ctx.ago(p.at)}</span></div>`;
  box.innerHTML = `<div class="tile-h"><b><span class="live-dot"></span> Live pulls</b><span class="grow"></span>
      <div class="seg"><button data-t="all" class="${pullsTab.v === 'all' ? 'on' : ''}">All</button><button data-t="top" class="${pullsTab.v === 'top' ? 'on' : ''}">Top pulls</button></div></div>
    ${first ? `<div class="pl-top r-${first.rarity}" data-pi="0"><img src="${first.image_url || ''}" alt=""><div><span class="pl-k">${esc((ctx.RARITY_LABEL[first.rarity] || first.rarity).toUpperCase())} · ${ctx.ago(first.at)}</span><b>${esc(first.player)} pulled ${esc(first.name)}</b></div></div>` : '<p class="v2-empty">No pulls yet.</p>'}
    <div class="pl-list" id="plList">${rest.slice(0, 8).map((p, i) => row(p, i + 1)).join('')}</div>`;
  box.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { pullsTab.v = b.dataset.t; paintPulls(); }));
  box.onclick = (e) => { const r = e.target.closest('[data-pi]'); if (r && pulls[Number(r.dataset.pi)]) ctx.openViewer(pulls[Number(r.dataset.pi)]); };
  // No scrolling: drop the rows that do not fully fit.
  fitChildren(el('plList'));
}

export function homeTick() { tickCloses(); }

// ---- A member's profile (click a member in "Live in voice") -------------------

const mem = { page: 0 };
export async function openMember(id) {
  const { el } = ctx;
  const me = ctx.user();
  const self = String(id) === String(me?.id);
  let box = el('memberModal');
  if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="memberModal" class="v2-modal hidden"></div>'); box = el('memberModal'); }
  box.innerHTML = '<div class="v2-modal-card"><div class="v2-loading">Loading…</div></div>';
  box.classList.remove('hidden');
  box.onclick = (e) => { if (e.target === box || e.target.closest('#memClose')) box.classList.add('hidden'); };
  await ensureCatalog();
  let p = null;
  try { p = await ctx.api(`/api/profile${self ? '' : `?id=${encodeURIComponent(id)}`}`); } catch { p = null; }
  if (!p || p.error) { box.querySelector('.v2-modal-card').innerHTML = '<button class="v2-icon mem-close" id="memClose">✕</button><p class="v2-empty">This member has no profile yet.</p>'; return; }
  const cards = mergedCards(self ? undefined : (p.cards || []));
  const spot = spotlightOf(cards, p.spotlight);
  const ownedCards = cards.filter((c) => c.owned).sort((a, b) => (b.power || 0) - (a.power || 0));
  const achs = measure(cards, p.stats);
  const s = p.stats || {};
  const line = (k, v) => `<div class="mem-stat"><span>${k}</span><b>${v}</b></div>`;
  box.querySelector('.v2-modal-card').innerHTML = `<button class="v2-icon mem-close" id="memClose" aria-label="Close">✕</button>
    <aside class="mem-side">
      <div class="prof-head">${avatarHTML(p.id, p.name, 'big')}<h3>${esc(p.name)}</h3></div>
      ${profileStats(p, cards)}
      <div class="mem-stats">
        ${line('Collection power', p.power != null ? `⚡ ${fmt(p.power)}` : '—')}
        ${line('Hunts joined', fmt(s.huntsJoined))}
        ${line('Bosses defeated', fmt(s.bossesDefeated))}
        ${line('Hunt damage', fmt(s.totalDamage))}
        ${line('Best hit', fmt(s.bestHit))}
        ${line('Achievements', `${achs.filter((a) => a.done).length} / ${achs.length}`)}
      </div>
      <div class="side-h">Spotlight</div>
      <div class="spot-row" id="memSpot">${spotHTML(spot)}</div>
    </aside>
    <section class="mem-main">
      <div class="v2-col-head"><h2>Collection <span class="sub">${ownedCards.length} cards</span></h2><span class="grow"></span><div class="v2-pager" id="memPager"></div></div>
      <div class="v2-grid" id="memGrid"></div>
    </section>`;
  el('memSpot').onclick = (e) => { const b = e.target.closest('[data-si]'); if (b) ctx.openViewer(spot[Number(b.dataset.si)]); };
  mem.page = 0;
  paintCards(el('memGrid'), el('memPager'), ownedCards, mem, (c) => ctx.openViewer(c));
}
