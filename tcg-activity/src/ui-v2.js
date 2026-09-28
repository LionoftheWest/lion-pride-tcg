// UI v2 screens (docs/design.md, design/08-v3-*.png): Home, Collection, Achievements.
// main.js owns the data, the streams, and the Hunt; this module only paints. It is
// used only when /api/flags says uiV2, so the v1 screens are untouched.

import { cardElement, ELEMENTS, ELEMENT_ORDER } from './elements.js';
import { fillViewerEffect } from './effects-ui.js';
import { mountBoss } from './boss.js';

let ctx = null; // { api, el, esc, cache, live, show, openViewer, openPacks, RARITY_LABEL, features, packs, user }
export function initV2(c) { ctx = c; }

const RARITY_ORDER = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'];
const TOP_RARITY = new Set(['secret_rare', 'full_art', 'gold', 'event', 'promo']);
const GAP = 14;

const initial = (name) => esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
function esc(s) { return ctx.esc(s ?? ''); }
const fmt = (n) => Number(n || 0).toLocaleString();

// ---- Shared card data ------------------------------------------------------

// The full catalog with the caller's copy merged in (quantity, ascension, power).
function mergedCards() {
  const owned = new Map((ctx.cache.collection?.cards || []).map((c) => [c.id, c]));
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

// One card tile: art, element + power chips, name + rarity over the art.
function tileHTML(c, idx, selected) {
  if (c.locked) {
    return `<div class="v2-card locked${selected ? ' sel' : ''}" data-idx="${idx}"><span class="lk">🔒</span><span class="num">${numLabel(c.num)}</span></div>`;
  }
  const el = elemOf(c);
  const stars = c.ascension > 0 ? `<span class="stars">${'★'.repeat(c.ascension)}</span>` : '';
  const qty = c.quantity > 1 ? `<span class="qty">×${c.quantity}</span>` : '';
  return `<div class="v2-card r-${c.rarity}${selected ? ' sel' : ''}" data-idx="${idx}">
    ${c.image_url ? `<img src="${c.image_url}" alt="" loading="lazy">` : ''}
    ${el ? `<span class="chip-el" style="--el:${el.color}">${el.glyph}</span>` : ''}
    <span class="chip-pow">⚡ ${c.power ?? ''}</span>${qty}
    <div class="shade"></div>
    <div class="meta"><b>${esc(c.name)}</b><span class="rar">◆ ${esc(ctx.RARITY_LABEL[c.rarity] || c.rarity)}</span>${stars}</div>
  </div>`;
}

// ---- Achievements (progress from the collection; rewards come with the claim system) ----

const ELEMENT_SET_NAMES = {
  water: 'Tide Callers', fire: 'Flame Keepers', lightning: 'Storm Chasers', ice: 'Frost Guard', nature: 'Wild Growth',
  earth: 'Stone Hearts', air: 'Sky Riders', shadow: 'Night Walkers', light: 'Dawn Bringers', arcane: 'Spell Weavers',
  psychic: 'Mind Readers', toxic: 'Venom Club', metal: 'Iron Works',
};
const RARITY_SET_NAMES = { illustrated_rare: 'Rare Hunter', secret_rare: 'Secret Keeper', full_art: 'Full House', gold: 'Golden Touch' };

export function achievements(cards = mergedCards()) {
  const list = [];
  const push = (key, icon, name, desc, set) => {
    if (!set.length) return;
    list.push({ key, icon, name, desc, have: set.filter((c) => c.owned).length, need: set.length });
  };
  push('first', '🎴', 'First Pull', 'Own your first card', cards.length ? [cards.find((c) => c.owned) || cards[0]] : []);
  for (const e of ELEMENT_ORDER) {
    const set = cards.filter((c) => cardElement(c.tags) === e);
    if (set.length >= 3) push(`el:${e}`, ELEMENTS[e].glyph, ELEMENT_SET_NAMES[e] || ELEMENTS[e].name, `Collect all ${set.length} ${ELEMENTS[e].name} cards`, set);
  }
  for (const r of Object.keys(RARITY_SET_NAMES)) {
    const set = cards.filter((c) => c.rarity === r);
    push(`r:${r}`, '◆', RARITY_SET_NAMES[r], `Own every ${ctx.RARITY_LABEL[r] || r}`, set);
  }
  const seasons = [...new Set(cards.map((c) => c.season || 'Season 1'))];
  for (const s of seasons) {
    const set = cards.filter((c) => (c.season || 'Season 1') === s);
    push(`s:${s}`, '🏆', `${s} Complete`, `Collect all ${set.length} cards`, set);
  }
  // Nearest to done first, finished ones last.
  return list.sort((a, b) => ((a.have >= a.need) - (b.have >= b.need)) || (b.have / b.need - a.have / a.need));
}

function achHTML(a, big, mini) {
  const done = a.have >= a.need;
  const pct = Math.round((100 * a.have) / a.need);
  return `<div class="v2-ach${done ? ' done' : ''}${big ? ' big' : ''}${mini ? ' mini' : ''}" title="${esc(a.desc)}">
    <div class="ah-top"><span class="ah-ico">${a.icon}</span><b>${esc(a.name)}</b><span class="ah-n">${done ? '✓' : `${a.have}/${a.need}`}</span></div>
    ${mini ? '' : `<div class="ah-desc">${esc(a.desc)}</div>`}
    <div class="ah-bar"><i style="width:${pct}%"></i></div>
  </div>`;
}

// ---- Collection ------------------------------------------------------------

const col = { season: null, rarity: 'all', element: null, q: '', page: 0, sel: null, achOpen: false, achPage: 0 };
let colItems = [];

export async function renderCollectionV2() {
  const { el } = ctx;
  if (!ctx.cache.catalog) {
    el('main').innerHTML = '<div class="v2-loading">Loading…</div>';
    try { ctx.cache.catalog = await ctx.api('/api/catalog'); } catch { ctx.cache.catalog = { cards: [] }; }
  }
  const cards = mergedCards();
  const seasons = [...new Set(cards.map((c) => c.season || 'Season 1'))];
  if (!seasons.includes(col.season)) col.season = seasons[0] || 'Season 1';
  const inSeason = cards.filter((c) => (c.season || 'Season 1') === col.season);
  const achs = achievements(cards);
  const achDone = achs.filter((a) => a.have >= a.need).length;

  const setRows = seasons.map((s) => {
    const set = cards.filter((c) => (c.season || 'Season 1') === s);
    const have = set.filter((c) => c.owned).length;
    return `<button class="side-row set${s === col.season ? ' on' : ''}" data-season="${esc(s)}"><span>${esc(s)}</span><span class="n">${have}/${set.length}</span><i class="bar"><i style="width:${Math.round((100 * have) / (set.length || 1))}%"></i></i></button>`;
  }).join('');
  const rarityRows = RARITY_ORDER.filter((r) => inSeason.some((c) => c.rarity === r)).map((r) => {
    const set = inSeason.filter((c) => c.rarity === r);
    return `<button class="side-row rar${col.rarity === r ? ' on' : ''}" data-rarity="${r}" style="--rc:var(--r-${r})"><span><i class="dia">◆</i>${esc(ctx.RARITY_LABEL[r] || r)}</span><span class="n">${set.filter((c) => c.owned).length}/${set.length}</span></button>`;
  }).join('');
  const elems = ELEMENT_ORDER.filter((e) => inSeason.some((c) => cardElement(c.tags) === e));
  const elemBtns = elems.map((e) => `<button class="el-btn${col.element === e ? ' on' : ''}" data-el="${e}" title="${ELEMENTS[e].name}" style="--el:${ELEMENTS[e].color}">${ELEMENTS[e].glyph}</button>`).join('');
  const have = inSeason.filter((c) => c.owned).length;

  const center = col.achOpen
    ? `<div class="v2-col-head"><h2>Achievements <span class="sub">${achDone} / ${achs.length}</span></h2><span class="grow"></span><div class="v2-pager" id="achPager"></div><button class="v2-icon" id="achClose" aria-label="Close">✕</button></div>
       <div class="v2-ach-grid" id="achGrid"></div>`
    : `<div class="v2-col-head"><h2>${esc(col.season)} <span class="sub">${have}/${inSeason.length} · ${Math.round((100 * have) / (inSeason.length || 1))}%</span></h2>
         <span class="grow"></span><div class="el-row">${elemBtns}</div><div class="v2-pager" id="colPager"></div></div>
       <div class="v2-grid" id="colGrid"></div>`;

  el('main').innerHTML = `<div class="v2-collection">
    <aside class="v2-side">
      <input class="v2-search" id="colSearch" placeholder="Search cards, tags…" value="${esc(col.q)}">
      <div class="side-h">Sets</div>${setRows}
      <div class="side-h">Rarity</div>${rarityRows}
      <div class="side-h">Achievements <span class="n">${achDone} / ${achs.length}</span></div>
      <div class="side-ach" id="sideAch">${achs.slice(0, 4).map((a) => achHTML(a, false, true)).join('')}</div>
      <button class="side-more" id="achToggle">${col.achOpen ? 'Show less ⌃' : `Show all ${achs.length} ⌄`}</button>
    </aside>
    <section class="v2-center">${center}</section>
    <aside class="v2-panel" id="colPanel"></aside>
  </div>`;

  el('colSearch').addEventListener('input', (e) => { col.q = e.target.value; col.page = 0; if (col.achOpen) { col.achOpen = false; renderCollectionV2(); return; } paintColGrid(); });
  el('main').querySelectorAll('.side-row.set').forEach((b) => b.addEventListener('click', () => { col.season = b.dataset.season; col.page = 0; col.achOpen = false; renderCollectionV2(); }));
  el('main').querySelectorAll('.side-row.rar').forEach((b) => b.addEventListener('click', () => { col.rarity = col.rarity === b.dataset.rarity ? 'all' : b.dataset.rarity; col.page = 0; col.achOpen = false; renderCollectionV2(); }));
  el('main').querySelectorAll('.el-btn').forEach((b) => b.addEventListener('click', () => { col.element = col.element === b.dataset.el ? null : b.dataset.el; col.page = 0; renderCollectionV2(); }));
  el('achToggle').addEventListener('click', () => { col.achOpen = !col.achOpen; renderCollectionV2(); });
  el('achClose')?.addEventListener('click', () => { col.achOpen = false; renderCollectionV2(); });

  fitChildren(el('sideAch'));
  if (col.achOpen) paintAch(achs); else paintColGrid();
  const selCard = cards.find((c) => c.id === col.sel) || inSeason.find((c) => c.owned) || inSeason[0];
  paintPanel(selCard);
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

// Fit the grid to the box: the most cards that fit with no scroll (5:7 cards).
function fitGrid(grid, n) {
  const w = grid.clientWidth || 600;
  const h = grid.clientHeight || 420;
  let best = { cols: 1, rows: 1, cw: 80 };
  for (let rows = 1; rows <= 4; rows++) {
    const byH = ((h - (rows - 1) * GAP) / rows) * 5 / 7;
    for (let cols = 2; cols <= 8; cols++) {
      const byW = (w - (cols - 1) * GAP) / cols;
      const cw = Math.floor(Math.min(byW, byH));
      if (cw < 104) continue;
      // Prefer the largest card that still shows at least 10 slots (or all cards).
      const score = Math.min(cols * rows, Math.max(10, n)) * 1000 + cw;
      if (score > best.score || !best.score) best = { cols, rows, cw, score };
    }
  }
  grid.style.setProperty('--cw', `${best.cw}px`);
  grid.style.setProperty('--cols', best.cols);
  return best.cols * best.rows;
}

function paintColGrid(dir) {
  const { el } = ctx;
  const grid = el('colGrid');
  if (!grid) return;
  colItems = colFiltered();
  const per = fitGrid(grid, colItems.length);
  const pages = Math.max(1, Math.ceil(colItems.length / per));
  col.page = Math.min(Math.max(0, col.page), pages - 1);
  const start = col.page * per;
  grid.innerHTML = colItems.length
    ? colItems.slice(start, start + per).map((c, i) => tileHTML(c, start + i, c.id === col.sel)).join('')
    : '<p class="v2-empty">No cards match.</p>';
  if (dir) { grid.classList.remove('slide-next', 'slide-prev'); void grid.offsetWidth; grid.classList.add(dir === 'next' ? 'slide-next' : 'slide-prev'); }
  grid.onclick = (e) => {
    const t = e.target.closest('.v2-card');
    if (!t) return;
    const c = colItems[Number(t.dataset.idx)];
    if (!c) return;
    if (col.sel === c.id && !c.locked) { ctx.openViewer(c); return; } // a second tap opens the 3D card
    col.sel = c.id;
    grid.querySelectorAll('.v2-card.sel').forEach((n) => n.classList.remove('sel'));
    t.classList.add('sel');
    paintPanel(c);
  };
  const pager = el('colPager');
  pager.innerHTML = pages > 1
    ? `<button id="cPrev" ${col.page === 0 ? 'disabled' : ''}>‹</button><span>${col.page + 1} / ${pages}</span><button id="cNext" ${col.page >= pages - 1 ? 'disabled' : ''}>›</button>`
    : '';
  el('cPrev')?.addEventListener('click', () => { col.page -= 1; paintColGrid('prev'); });
  el('cNext')?.addEventListener('click', () => { col.page += 1; paintColGrid('next'); });
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
  const owned = c.locked ? 'Not in your collection yet' : `${c.quantity} ${c.quantity === 1 ? 'copy' : 'copies'}`;
  box.innerHTML = `<div class="p-top">
      <div class="p-art v2-card r-${c.rarity}${c.locked ? ' locked' : ''}">${!c.locked && c.image_url ? `<img src="${c.image_url}" alt="">` : '<span class="lk">🔒</span>'}</div>
      <div class="p-id">
        <span class="p-num">${numLabel(c.num)} · ${esc(c.season || 'Season 1').toUpperCase()}</span>
        <h3>${esc(c.name)}</h3>
        <span class="p-rar" style="--rc:var(--r-${c.rarity})">● ${esc(ctx.RARITY_LABEL[c.rarity] || c.rarity)}</span>
        <span class="p-stars">${'★'.repeat(a)}<i>${'☆'.repeat(5 - a)}</i><span class="p-own">${owned}</span></span>
      </div>
    </div>
    ${c.lore ? `<p class="p-lore">“${esc(c.lore)}”</p>` : ''}
    <div class="p-stats">
      ${bar('Power', power, maxPow, 'var(--gold)', power)}
      ${bar('HP', hp, cardHp(maxPow), 'var(--danger)', hp)}
      ${bar('Crit', 10, 25, 'var(--el-lightning)', '10%')}
    </div>
    ${abHTML}
    <div class="pbox fx hidden" id="colEffect"></div>
    ${chips.length ? `<div class="p-tags" id="pTags">${chips.join('')}</div>` : ''}
    ${ascHTML}
    ${c.artist ? `<div class="p-credit">🎨 Art by <b>${esc(c.artist)}</b></div>` : ''}
    <div class="p-actions">${c.locked ? '' : '<button class="v2-btn gold" id="pView">View card</button>'}<button class="v2-icon" id="pTrade" title="Trade">⇄</button></div>`;
  el('pView')?.addEventListener('click', () => ctx.openViewer(c));
  el('pTrade')?.addEventListener('click', () => ctx.show('trading'));
  fitPanel(box);
  fillViewerEffect(c, 'colEffect').then(() => fitPanel(box));
}

// No scrolling: keep the tags to the rows that fit, then drop the lore if still tight.
function fitPanel(box) {
  if (!box?.isConnected) return;
  const over = () => box.scrollHeight > box.clientHeight + 1;
  box.querySelector('.p-lore')?.classList.remove('hidden');
  const tags = box.querySelector('.p-tags');
  if (tags) tags.classList.remove('one-row');
  if (over() && tags) tags.classList.add('one-row');
  if (over()) box.querySelector('.p-lore')?.classList.add('hidden');
}

export function refreshCollectionV2() {
  if (ctx.currentView() === 'collection') renderCollectionV2();
}

// ---- Home ------------------------------------------------------------------

let heroBoss = null;
let profile = null;
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
  const [hunt, prof] = await Promise.all([
    ctx.features().hunt ? ctx.api('/api/hunt').catch(() => null) : Promise.resolve(null),
    ctx.api('/api/profile').catch(() => null),
  ]);
  if (ctx.currentView() !== 'home') return;
  profile = prof;
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
  const rank = profile?.huntRank ? `#${profile.huntRank} of ${profile.huntPlayers}` : '';
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

function paintProfile() {
  const { el } = ctx;
  const box = el('homeProfile');
  if (!box) return;
  const me = ctx.user();
  const cards = mergedCards();
  const total = ctx.cache.catalog?.cards?.length || 0;
  const ownedN = (ctx.cache.collection?.cards || []).length;
  const achs = total ? achievements(cards) : [];
  const stat = (v, k) => `<div><b>${v}</b><span>${k}</span></div>`;
  box.innerHTML = `<div class="prof-head"><span class="v2-avatar big"><span>${initial(me?.name)}</span></span><h3>${esc(me?.name || '')}</h3></div>
    <div class="prof-stats">
      ${stat(total ? `${ownedN}/${total}` : ownedN, 'Cards')}
      ${stat(profile?.huntRank ? `#${profile.huntRank}` : '—', 'Hunt rank')}
      ${stat(achs.length ? `${achs.filter((a) => a.have >= a.need).length}/${achs.length}` : '—', 'Achievements')}
      ${stat(profile ? fmt(profile.packsOpened) : '—', 'Packs opened')}
    </div>
    ${achs.length ? `<div class="side-h">Closest achievements</div><div class="prof-ach" id="profAch">${achs.filter((a) => a.have < a.need).slice(0, 3).map((a) => achHTML(a, false, true)).join('')}</div>` : ''}`;
  fitChildren(el('profAch'));
  if (!ctx.cache.catalog) ctx.api('/api/catalog').then((d) => { ctx.cache.catalog = d; if (ctx.currentView() === 'home') paintProfile(); }).catch(() => {});
}

const STATUS_TEXT = {
  home: ['🏠', 'On the home screen'], collection: ['📚', 'Browsing collection'], hunt: ['⚔', 'In the hunt'],
  battle: ['⚔', 'Attacking the boss'], trading: ['⇄', 'Trading'], opening: ['🎴', 'Opening a pack'],
};

export function paintVoice() {
  const { el } = ctx;
  const box = el('homeVoice');
  if (!box) return;
  const people = ctx.live.presence || [];
  const me = ctx.user();
  const others = people.filter((p) => String(p.id) !== String(me?.id));
  const tile = (p) => {
    const [ico, txt] = STATUS_TEXT[p.status?.kind] || ['•', 'Here'];
    return `<div class="vc-tile k-${esc(p.status?.kind || 'here')}"><div class="vc-head"><span class="v2-avatar sm"><span>${initial(p.name)}</span></span>
      <div><b>${esc(p.name)}</b><span class="vc-st">${ico} ${esc(txt)}</span></div></div>
      ${p.status?.card ? `<div class="vc-card">${esc(p.status.card)}</div>` : ''}</div>`;
  };
  box.innerHTML = `<div class="tile-h"><b>🎧 Live in voice</b><span class="dim">${people.length}</span>${others.length ? '<span class="live-chip sm">● LIVE</span>' : ''}</div>
    <div class="vc-grid">${others.length ? others.slice(0, 6).map(tile).join('') : '<p class="v2-empty">Just you right now.</p>'}</div>`;
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
