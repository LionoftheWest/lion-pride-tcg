/**
 * Lion Pride TCG — Discord Activity front-end.
 *
 * Layout (never scrolls — see the UI ground rules):
 *   ┌ title ································· [Seasons][Trading][My Coll.][Battling] ┐
 *   │ MAIN PANE (Collection / Seasons / Trading / Battling / a pull reveal)  │ FEED │
 *   └───────────────────────────────────────────────────────────────────────┴──────┘
 * The Community Live Feed is a persistent right sidebar (not a tab), fed live by
 * SSE. The room socket (presence, shared pack-opens, reactions) also stays open
 * the whole session; when you are in a voice channel with others, their presence
 * shows in the main header and opens reveal in the main pane for everyone.
 */
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { mountBoss } from './boss.js';

const el = (id) => document.getElementById(id);
const setStatus = (t) => { el('status').textContent = t; };
const loaderMsg = (t) => { const m = el('loaderMsg'); if (m) m.textContent = t; };
// Escape for HTML. Includes the double and single quote so a value placed inside
// a quoted attribute (for example data-name="${esc(...)}") cannot break out of the
// attribute and inject a handler. A display name is player-controlled, so this
// matters for the gift/trade player rows.
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const dot = '<span class="dot"></span>';

const RARITY_LABEL = {
  normal: 'Normal',
  illustrated_rare: 'Illustrated Rare',
  secret_rare: 'Secret Rare',
  full_art: 'Full Art',
  gold: 'Gold',
  promo: 'Promo',
  event: 'Event',
};
const REACTIONS = ['🔥', '😮', '👏', '🎉', '❤️'];
// Rank tiers so we can detect a "rare pull" (Secret Rare or better) for the
// celebration. Event/Promo count as special too.
const RARITY_RANK = { normal: 0, illustrated_rare: 1, secret_rare: 2, full_art: 3, gold: 4, event: 3, promo: 2 };
const isRarePull = (cards) => cards.some((c) => (RARITY_RANK[c.rarity] ?? 0) >= 2);
const TITLES = { collection: 'My Collection', gallery: 'Gallery', trading: 'Trading', battling: 'Battling' };
// view -> cached dataset (key + endpoint) for the card views
const DATA = { collection: { key: 'collection', ep: '/api/collection' }, gallery: { key: 'catalog', ep: '/api/catalog' } };
const GAP = 14;

// ---- Sound effects — synthesized in-browser (Web Audio), no asset files ------
// Each entry is a named "slot" so a real recording can replace it later. Sounds
// play locally per user (never into the voice call). Audio needs a user gesture
// to start, so we unlock the context on the first click.
const SFX = (() => {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = (typeof localStorage !== 'undefined' && localStorage.getItem('lp_muted') === '1');

  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      noise = buf;
    } catch { ctx = null; }
    return ctx;
  }
  function envelope(gain, t0, dur, peak) {
    gain.setValueAtTime(0.0001, t0);
    gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.25));
    gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function swish({ dur = 0.35, f0 = 400, f1 = 2600, q = 0.9, peak = 0.5 } = {}) {
    if (!ensure()) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    envelope(g.gain, t, dur, peak);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }
  function tone({ freq = 440, type = 'sine', dur = 0.25, peak = 0.3, glide = 0 } = {}) {
    if (!ensure()) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    envelope(g.gain, t, dur, peak);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  const slots = {
    tear: () => { swish({ dur: 0.42, f0: 280, f1: 3200, peak: 0.55 }); tone({ freq: 130, type: 'sine', dur: 0.26, peak: 0.35, glide: 55 }); },
    flip: () => swish({ dur: 0.2, f0: 900, f1: 2200, q: 1.3, peak: 0.4 }),
    page: () => swish({ dur: 0.17, f0: 650, f1: 1700, q: 1.1, peak: 0.26 }),
    rare: () => {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.5, peak: 0.32 }), i * 120));
      setTimeout(() => tone({ freq: 1568, type: 'sine', dur: 0.8, peak: 0.22 }), 520);
    },
  };
  return {
    play(name) { if (muted || !ensure()) return; if (ctx.state === 'suspended') ctx.resume(); try { slots[name] && slots[name](); } catch {} },
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    toggle() { muted = !muted; try { localStorage.setItem('lp_muted', muted ? '1' : '0'); } catch {} if (master) master.gain.value = muted ? 0 : 0.55; return muted; },
    muted: () => muted,
  };
})();

let token = null;
let instanceId = null;
let currentView = 'collection';
let cardBack = '';
let features = {}; // server feature flags (e.g., ascension), from /api/config
let packsAvailable = 0;
let mainItems = []; // the cards backing the current main-pane grid (for click → viewer)
let revealItems = []; // the cards in the current pack reveal (for click → viewer)
let huntState = null; // the active hunt + roster (Phase 2), for live attack updates
let bossHandle = null; // the live WebGL boss creature on the battle screen (Phase 2)

const live = { pulls: [], presence: [], attacks: [] };
const ATTACKER_TYPES = ['Character', 'Creature']; // only these can attack; others are support
const squad = { page: 0, q: '', rarity: 'all', type: 'all' }; // battle picker (gallery-style)
let usedIds = new Set(); // card ids already sent at the boss today (client mirror of the cap)
let feedTopId = 0; // newest boss-feed event id shown (so polls only animate in newer ones)
let huntDay = ''; // UTC date of the current hunt render; a change means the daily reset hit
const utcToday = () => new Date().toISOString().slice(0, 10);
window.addEventListener('resize', () => { if (currentView === 'battling') sizeSquadGrid(); });
const cache = {};
let myCardIds = new Set(); // card ids the caller owns — so feed cards you own show their art
const page = { collection: 0 };
// Gallery view controls (search / filter / which season is expanded).
const gallery = { q: '', rarity: 'all', owned: 'all', season: null, page: 0 };

async function main() {
  loaderMsg('Connecting to Discord…');
  const { clientId, backUrl, features: feat } = await (await fetch('/api/config')).json();
  cardBack = backUrl || '';
  features = feat || {};

  const discordSdk = new DiscordSDK(clientId);
  await discordSdk.ready();
  instanceId = discordSdk.instanceId;

  loaderMsg('Shuffling the deck…');
  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });
  const { access_token } = await (await fetch('/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })).json();
  await discordSdk.commands.authenticate({ access_token });
  token = access_token;

  setStatus('');
  el('nav').classList.remove('hidden');
  el('body').classList.remove('hidden');
  el('loader').classList.add('gone'); // fade the loading screen away

  // Sound: unlock the audio context on the first interaction, and wire mute.
  document.addEventListener('pointerdown', () => SFX.unlock(), { passive: true });
  const mute = el('mute');
  mute.classList.remove('hidden');
  mute.textContent = SFX.muted() ? '🔇' : '🔊';
  mute.addEventListener('click', () => { mute.textContent = SFX.toggle() ? '🔇' : '🔊'; });

  const giftBtn = el('giftBtn');
  giftBtn.classList.remove('hidden');
  giftBtn.addEventListener('click', openGiftPanel);

  const bell = el('bellBtn');
  bell.classList.remove('hidden');
  bell.addEventListener('click', openNotifs);

  if (features.ascension) {
    const boardBtn = el('boardBtn');
    boardBtn.classList.remove('hidden');
    boardBtn.addEventListener('click', openBoard);
  }
  refreshNotifBadge();
  setInterval(refreshNotifBadge, 45000);

  connectStreams();
  renderFeedSidebar();
  refreshOwned();
  refreshPackStatus();
  setInterval(refreshPackStatus, 45000); // packs can be earned while the app is open
  refreshTradeBadge();
  setInterval(refreshTradeBadge, 45000); // show a badge when a trade offer arrives
  show('collection');
}

// Load which cards the caller owns (for feed-card ownership). Also warms the
// collection cache. Refreshed whenever the collection can have changed.
async function refreshOwned() {
  try {
    const d = await api('/api/collection');
    cache.collection = d;
    myCardIds = new Set((d.cards || []).map((c) => c.id));
  } catch { /* keep the previous set */ }
}

// Show the Open Pack button only when the player actually has a pack waiting.
async function refreshPackStatus() {
  try {
    const d = await api('/api/pack-status');
    packsAvailable = Number(d?.packs) || 0;
  } catch { packsAvailable = 0; }
  updateOpenButton();
}

function updateOpenButton() {
  const slot = el('openSlot');
  if (!slot) return;
  slot.innerHTML = packsAvailable > 0
    ? `<button class="open-btn" id="openBtn">Open Pack${packsAvailable > 1 ? ` ×${packsAvailable}` : ''}</button>`
    : '';
  const btn = el('openBtn');
  if (btn) btn.addEventListener('click', openPacks);
}

const api = (path) => fetch(path, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
const apiPost = (path, body) =>
  fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

// ---- Live streams (stay open for the whole session) ------------------------

let pullsStream = null;
let roomWs = null;

function connectStreams() {
  try {
    pullsStream = new EventSource(`/api/pulls/stream?token=${encodeURIComponent(token)}`);
    pullsStream.onmessage = (ev) => {
      try { const d = JSON.parse(ev.data); if (d.pulls) { live.pulls = d.pulls; if (currentView !== 'battling') renderFeedSidebar(); } } catch { /* bad frame */ }
    };
  } catch { /* no EventSource; poll below */ }
  setInterval(async () => {
    if (document.hidden || pullsStream) return;
    try { const d = await api('/api/pulls'); if (d.pulls) { live.pulls = d.pulls; if (currentView !== 'battling') renderFeedSidebar(); } } catch { /* retry */ }
  }, 15000);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const openWs = () => {
    roomWs = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&instanceId=${encodeURIComponent(instanceId)}`);
    roomWs.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'presence') { live.presence = msg.users; updatePresence(); }
      else if (msg.type === 'open') { if (Date.now() < suppressOpenUntil) return; showReveal(msg); }
      else if (msg.type === 'react') floatReact(msg);
    };
    roomWs.onclose = () => setTimeout(openWs, 4000);
  };
  openWs();
}

// ---- Community Live Feed (persistent right sidebar) ------------------------

function renderFeedSidebar() {
  const list = el('feedList');
  if (!list) return;
  const head = document.querySelector('.feed-head');
  if (currentView === 'battling') {
    // On the battle page the sidebar is the Raid Boss feed, not the community pulls.
    if (head) head.textContent = 'Raid Boss Live Feed';
    list.classList.add('attacks');
    const atk = live.attacks || [];
    list.innerHTML = atk.length
      ? atk.map(bossFeedRow).join('')
      : '<p class="empty small">No attacks yet — be the first to strike.</p>';
    feedTopId = (atk[0] && atk[0].id) || 0; // remember the newest so polls only add newer
    return;
  }
  if (head) head.textContent = 'Community Live Feed';
  list.classList.remove('attacks');
  const pulls = live.pulls || [];
  list.innerHTML = pulls.length
    ? pulls.map((p, i) => feedRow(p, i, i === 0)).join('')
    : '<p class="empty small">No pulls yet.</p>';
}

// One boss-attack row (text only — no card art, so many fit without scrolling).
// One log event becomes up to TWO feed rows: the player's hit, and — if the boss counters
// — the boss's own strike as a separate event. Newest sits on top, so the boss strike
// (which happens after the hit) is emitted first.
function bossFeedRow(e) {
  const bossName = (huntState && huntState.hunt && huntState.hunt.name) || 'The boss';
  const who = `<span class="ap">${esc(e.player)}</span>'s ${esc(e.card)}`; // the attacking card, by owner
  let playerRow;
  if (e.outcome === 'miss') {
    playerRow = `<div class="afrow ${esc(e.rarity)}">${who} <span class="amiss">missed</span>.</div>`;
  } else {
    const tags = `${e.bonus ? ' <span class="ax2">×2 weak</span>' : ''}${e.crit ? ' <span class="atag">💥 CRIT</span>' : ''}`;
    playerRow = `<div class="afrow ${esc(e.rarity)}">${who} hit for <b>${Number(e.damage).toLocaleString()}</b>${tags}</div>`;
  }
  const bossRow = e.countered
    ? `<div class="afrow bhit"><span class="bn">🩸 ${esc(bossName)}</span> hit <span class="acard">${esc(e.card)}</span> for <b>${Number(e.counterDmg || 0).toLocaleString()}</b>${e.downed ? ' <span class="adown">— downed!</span>' : ''}</div>`
    : '';
  return bossRow + playerRow;
}

function feedRow(p, idx, top) {
  return `<div class="frow${top ? ' top' : ''}" data-idx="${idx}">
    <div class="fthumb">${p.image_url ? `<img src="${p.image_url}" alt="" loading="lazy">` : ''}</div>
    <div class="ftext"><b>${esc(p.player)}</b> pulled
      <span class="fcard">${esc(p.name)}</span>
      <span class="ftier">${RARITY_LABEL[p.rarity] || p.rarity} · ${ago(p.at)}</span>
    </div>
  </div>`;
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ---- Main pane -------------------------------------------------------------

async function show(view) {
  currentView = view;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (DATA[view] && !cache[DATA[view].key]) {
    el('main').innerHTML = '<div class="loading">Loading…</div>';
    cache[DATA[view].key] = await api(DATA[view].ep);
    if (currentView !== view) return;
  }
  renderMain(view);
  renderFeedSidebar(); // the sidebar switches between the community feed and the boss feed
}

function mainHead(title) {
  return `<div class="main-head">
    <div class="mh-title">${title}<span id="presSlot">${presenceHTML()}</span><span id="powerSlot" class="power-slot"></span></div>
    <span id="openSlot"></span>
  </div>`;
}

// Total Collection Power pill — shown in the collection header when Ascension is on.
function updatePower() {
  const s = el('powerSlot');
  if (!s) return;
  const show = features.ascension && currentView === 'collection' && cache.collection;
  s.innerHTML = show ? `⚡ ${cache.collection.power || 0} CP` : '';
}

function presenceHTML() {
  return live.presence.length > 1 ? `<span class="pres">${dot}${live.presence.length} in room</span>` : '';
}
function updatePresence() {
  const slot = el('presSlot');
  if (slot) slot.innerHTML = presenceHTML();
}

// Tear down the live boss when we leave the battle screen (frees the WebGL context).
function disposeBoss() {
  if (bossHandle) { try { bossHandle.dispose(); } catch (e) { /* ignore */ } bossHandle = null; }
}

// Build the seeded creature into the battle-screen canvas (WebGL). Fails silently
// if the webview has no WebGL — the rest of the screen still works.
function mountBossFor(hunt) {
  if (window.__NO_BOSS__) return; // TEMP: skip the WebGL boss to test the card-render bug
  const cv = el('bossCanvas');
  if (!cv || !hunt) return;
  try {
    bossHandle = mountBoss(cv, hunt.name || 'boss', hunt.tier);
    if (hunt.status === 'defeated' || hunt.hp_remaining <= 0) bossHandle.defeat();
  } catch (e) { bossHandle = null; }
}

function renderMain(view) {
  disposeBoss(); // any view change tears the boss down; renderHunt re-mounts it
  stopHuntTicker(); // stop the boss/cooldown countdown; renderHunt restarts it
  if (view === 'gallery') { renderGallery(); return; }
  if (view === 'trading') { renderTrading(); return; }
  if (view === 'battling' && features.hunt) { renderHunt(); return; }
  let body;
  if (view === 'collection') {
    body = `<div class="main-body"><div class="page-grid" id="pageGrid"></div><div class="pager" id="pager"></div></div>`;
  } else {
    body = `<div class="main-body"><div class="soon">⚔️<b>Battling is coming soon.</b><span>Put your cards head to head with the server.</span></div></div>`;
  }
  el('main').innerHTML = mainHead(TITLES[view]) + body;
  updateOpenButton();
  if (view === 'collection') paintPage('collection');
}

// ---- Collection grid -------------------------------------------------------

function paintPage(view, dir) {
  const grid = el('pageGrid');
  if (!grid) return;
  const items = (cache.collection?.cards || []).map((c) => ({ ...c, locked: false }));
  const perPage = computeLayout(grid);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  page[view] = Math.min(Math.max(0, page[view]), pages - 1);
  const start = page[view] * perPage;
  const slice = items.slice(start, start + perPage);
  mainItems = items;
  grid.innerHTML = slice.length ? slice.map((c, i) => cardTile(c, start + i)).join('') : '<p class="empty">No cards yet — open a pack to start your collection.</p>';
  gridAnim(grid, dir);
  renderPager(view, pages);
  updatePower();
}

// A quick slide when paging so the change reads as motion.
function gridAnim(grid, dir) {
  if (!grid || !dir) return;
  grid.classList.remove('anim-next', 'anim-prev');
  void grid.offsetWidth; // restart the animation
  grid.classList.add(dir === 'next' ? 'anim-next' : 'anim-prev');
  SFX.play('page');
}

// The tier name is intentionally omitted here to give the art more room; the
// rarity still shows in the 3D viewer. Quantity (×N) stays.
function cardTile(c, idx) {
  const dim = c.locked ? ' locked' : '';
  const qty = c.quantity > 1 ? ` <span class="q">×${c.quantity}</span>` : '';
  const showAsc = features.ascension && !c.locked && c.ascension > 0;
  const asc = showAsc ? ` asc-${c.ascension}` : '';
  const stars = showAsc ? `<div class="tile-stars">${'★'.repeat(c.ascension)}</div>` : '';
  return `<div class="c ${c.rarity}${dim}${asc}" data-idx="${idx}">
    <div class="art">${c.image_url ? `<img src="${c.image_url}" alt="${esc(c.name)}" loading="lazy">` : ''}${stars}</div>
    <div class="cap">${esc(c.name)}${qty}</div>
  </div>`;
}

// Target 5 columns x 2 rows (10 per page). Size the card so a full 2x5 page fits
// with no scroll — bounded by width OR the height for 2 rows, whichever is
// tighter. If a taller window leaves room for more rows at that size, show them.
function computeLayout(grid) {
  const CAP = 50; // caption height under each card (a name may wrap two lines + the pager)
  const TARGET_ROWS = 2;
  const w = grid.clientWidth || 600;
  const h = grid.clientHeight || 420;
  let cols = 5;
  while (cols > 2 && (w - (cols - 1) * GAP) / cols < 130) cols -= 1; // fewer columns on a narrow window
  const byWidth = (w - (cols - 1) * GAP) / cols;
  const byHeight = ((h - (TARGET_ROWS - 1) * GAP) / TARGET_ROWS - CAP) * 5 / 7;
  const cw = Math.max(110, Math.floor(Math.min(byWidth, byHeight)));
  const cellH = cw * 7 / 5 + CAP;
  const rows = Math.max(1, Math.floor((h + GAP) / (cellH + GAP)));
  grid.style.setProperty('--cw', cw + 'px');
  grid.style.setProperty('--cols', cols);
  return cols * rows;
}

// ---- Gallery: search, tier/owned filter, season accordion ------------------

const galleryCards = () => (cache.catalog?.cards || []).map((c) => ({ ...c, locked: !c.owned }));

function seasonGroups(cards) {
  const map = new Map();
  for (const c of cards) {
    const s = c.season || 'Season 1';
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(c);
  }
  return [...map.entries()];
}

function applyFilters(cards) {
  const q = gallery.q.trim().toLowerCase();
  return cards.filter((c) => {
    if (gallery.rarity !== 'all' && c.rarity !== gallery.rarity) return false;
    if (gallery.owned === 'owned' && !c.owned) return false;
    if (gallery.owned === 'missing' && c.owned) return false;
    if (q && !((c.name || '').toLowerCase().includes(q) || (c.subject || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

// The gallery now uses the EXACT same container as the collection — a flex-fill
// `.main-body > .page-grid` — so `computeLayout` reads a real grid height and the
// page reads as a clean 2xN grid, identical to the collection. The old season
// accordion collapsed the grid height and broke the layout.
function renderGallery() {
  const cards = galleryCards();
  const rarities = [...new Set(cards.map((c) => c.rarity))];
  const rarityOpts = ['all', ...rarities]
    .map((r) => `<option value="${r}"${gallery.rarity === r ? ' selected' : ''}>${r === 'all' ? 'All tiers' : (RARITY_LABEL[r] || r)}</option>`).join('');
  const ownedOpts = [['all', 'Owned + missing'], ['owned', 'Owned only'], ['missing', 'Missing only']]
    .map(([v, l]) => `<option value="${v}"${gallery.owned === v ? ' selected' : ''}>${l}</option>`).join('');
  const seasons = seasonGroups(cards).map(([s]) => s);
  if (!seasons.includes(gallery.season)) gallery.season = seasons[0] || 'Season 1';
  const seasonSel = seasons.length > 1
    ? `<select id="gseason" class="gselect">${seasons.map((s) => `<option value="${esc(s)}"${gallery.season === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>`
    : '';
  el('main').innerHTML =
    mainHead('Gallery') +
    `<div class="gal-controls">
       <input id="gsearch" class="ginput" placeholder="Search cards…" value="${esc(gallery.q)}">
       <select id="gfilter" class="gselect">${rarityOpts}</select>
       <select id="gowned" class="gselect">${ownedOpts}</select>
       ${seasonSel}
     </div>
     <div class="main-body">
       <div class="gal-bar" id="galBar"></div>
       <div class="page-grid" id="pageGrid"></div>
       <div class="pager" id="pager"></div>
     </div>`;
  updateOpenButton();
  el('gsearch').addEventListener('input', (e) => { gallery.q = e.target.value; gallery.page = 0; paintGalleryPage(); });
  el('gfilter').addEventListener('change', (e) => { gallery.rarity = e.target.value; gallery.page = 0; paintGalleryPage(); });
  el('gowned').addEventListener('change', (e) => { gallery.owned = e.target.value; gallery.page = 0; paintGalleryPage(); });
  const gs = el('gseason');
  if (gs) gs.addEventListener('change', (e) => { gallery.season = e.target.value; gallery.page = 0; paintGalleryPage(); });
  paintGalleryPage();
}

function paintGalleryPage(dir) {
  const grid = el('pageGrid');
  if (!grid) return;
  const inSeason = galleryCards().filter((c) => (c.season || 'Season 1') === gallery.season);
  const items = applyFilters(inSeason);
  const bar = el('galBar');
  if (bar) bar.innerHTML = `<span class="gs-name">${esc(gallery.season)}</span><span class="gs-count">${inSeason.filter((c) => c.owned).length}/${inSeason.length}</span>`;
  // Same layout function as the collection — a real flex-fill grid height.
  const perPage = computeLayout(grid);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  gallery.page = Math.min(Math.max(0, gallery.page), pages - 1);
  const start = gallery.page * perPage;
  const slice = items.slice(start, start + perPage);
  mainItems = items;
  grid.innerHTML = slice.length ? slice.map((c, i) => cardTile(c, start + i)).join('') : '<p class="empty">No cards match.</p>';
  gridAnim(grid, dir);
  galleryPager(pages);
}

function galleryPager(pages) {
  const pager = el('pager');
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ''; return; }
  const p = gallery.page;
  const dots = Array.from({ length: pages }, (_, i) => `<span class="pdot${i === p ? ' on' : ''}"></span>`).join('');
  pager.innerHTML =
    `<button class="parrow" id="prev" ${p === 0 ? 'disabled' : ''}>‹</button>
     <span class="pdots">${dots}</span>
     <button class="parrow" id="next" ${p >= pages - 1 ? 'disabled' : ''}>›</button>`;
  el('prev').addEventListener('click', () => { gallery.page -= 1; paintGalleryPage('prev'); });
  el('next').addEventListener('click', () => { gallery.page += 1; paintGalleryPage('next'); });
}

function renderPager(view, pages) {
  const pager = el('pager');
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ''; return; }
  const p = page[view];
  const dots = Array.from({ length: pages }, (_, i) => `<span class="pdot${i === p ? ' on' : ''}"></span>`).join('');
  pager.innerHTML =
    `<button class="parrow" id="prev" ${p === 0 ? 'disabled' : ''}>‹</button>
     <span class="pdots">${dots}</span>
     <button class="parrow" id="next" ${p >= pages - 1 ? 'disabled' : ''}>›</button>`;
  el('prev').addEventListener('click', () => { page[view] -= 1; paintPage(view, 'prev'); });
  el('next').addEventListener('click', () => { page[view] += 1; paintPage(view, 'next'); });
}

// ---- Opening + reveal ------------------------------------------------------

async function openPacks() {
  const btn = el('openBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  try {
    const data = await apiPost('/api/open', { instanceId });
    if (data.error) note('Could not open right now.');
    else if (!data.cards || !data.cards.length)
      note('No unopened packs. Post in the server to earn one — 25 messages gets a bonus pack. Resets 00:00 UTC.');
    else {
      // The collection + ownership changed — drop caches so the views refetch.
      cache.collection = null; cache.catalog = null;
      // Always show MY reveal locally. The room broadcast echoes back to me too,
      // so suppress that echo briefly to avoid opening the takeover twice.
      suppressOpenUntil = Date.now() + 3000;
      showReveal({ user: 'You', cards: data.cards });
    }
  } catch {
    note('Could not open right now.');
  } finally {
    refreshPackStatus(); // packs were consumed — hides the button when none remain
  }
}

function note(text) {
  const head = document.querySelector('.main-head');
  if (!head) return;
  const n = document.createElement('div');
  n.className = 'open-note';
  n.textContent = text;
  head.insertAdjacentElement('afterend', n);
  setTimeout(() => n.remove(), 4500);
}

let revealTimer = null;
let suppressOpenUntil = 0; // ignore the room 'open' echo of my own pull

// Full-screen takeover. Dims the whole Activity, plays the pack burst, then the
// cards flip out ONE BY ONE (staggered). A Secret-Rare+ pull adds a celebration.
// The reusable Blender pack-open WebP will later sit behind the cards as the
// wrapper; this CSS version works today and sets the card timing.
// Interactive reveal: the cards rise out of the pack FACE-DOWN together, and the
// player taps each one to flip it. A Secret-Rare+ card flips with a burst of
// sparkles + a fanfare — the surprise lands at the flip, not up front.
let flippedCount = 0;
let tearing = false;
// A glossy holographic pack (Pokémon-Pocket style): it floats on screen, you TAP
// to rip the top off with a light-line, then the cards rise for you to flip.
function showReveal(msg) {
  const cards = msg.cards || [];
  if (!cards.length) return;
  clearTimeout(revealTimer);
  revealItems = cards;
  flippedCount = 0;
  tearing = false;
  const rare = isRarePull(cards);
  const tiles = cards.map((c, i) => {
    const hot = (RARITY_RANK[c.rarity] ?? 0) >= 2 ? ' hot' : '';
    return `<div class="fc c ${c.rarity}${hot}" data-idx="${i}" style="--i:${i}">
      <div class="pf">
        <div class="pf-face pf-back"><img src="${cardBack}" alt=""></div>
        <div class="pf-face pf-front">${c.image_url ? `<img src="${c.image_url}" alt="${esc(c.name)}">` : ''}</div>
      </div>
      <div class="fc-cap">${esc(c.name)}</div>
    </div>`;
  }).join('');
  const stage = el('stage');
  stage.className = `open packstage${rare ? ' rarepack' : ''}`;
  stage.innerHTML =
    `<div class="packwrap" id="packOpen">
       <div class="pack-shell" id="packShell">
         <img class="pack-img" id="packImg" src="/pack_still.png?v=2" alt="Lion Pride booster pack" draggable="false">
         <span class="pack-shine"></span>
         <span class="pack-rainbow"></span>
       </div>
     </div>
     <div class="tap-prompt" id="tapPrompt">Tap the pack to rip it open</div>
     <div class="reveal-grid hidden" id="revealGrid">${tiles}</div>
     <div class="reveal-prompt hidden" id="revealPrompt">Tap each card to reveal it</div>
     <div class="reacts" id="reactBar">${REACTIONS.map((e) => `<button class="react" data-emoji="${e}">${e}</button>`).join('')}
       <button class="reveal-close" id="revealClose">Back</button>
     </div>`;
  el('reactBar').addEventListener('click', (e) => {
    const emoji = e.target?.dataset?.emoji;
    if (emoji && roomWs && roomWs.readyState === 1) roomWs.send(JSON.stringify({ type: 'react', emoji }));
  });
  el('revealClose').addEventListener('click', endReveal);
  el('packOpen').addEventListener('click', () => tearPack(rare));
  setupPackTilt(el('packOpen'));
  // Preload the tear animation NOW (while the player reads "tap the pack") so the
  // swap on tap is instant. Without this the webp fetches on tap and the pack
  // blanks out for a beat on mobile — the "weird" flash.
  const tearSrc = `/tear_open.webp?t=${Date.now()}`;
  el('packOpen').dataset.tear = tearSrc;
  const pre = new Image(); pre.src = tearSrc;
  SFX.play('page');
  revealTimer = setTimeout(endReveal, 120000); // safety only; no auto-dismiss
}

// The pack (a 3D-rendered foil pouch) leans toward the pointer — the "real foil
// in your hand" feel. The baked-in holo shimmer does the rest. Clears on leave.
function setupPackTilt(pack) {
  const shell = pack.querySelector('.pack-shell') || pack.querySelector('.pack-img');
  if (!shell) return;
  pack.addEventListener('pointermove', (e) => {
    if (tearing) return;
    const r = pack.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    shell.style.transform = `rotateY(${px * 20}deg) rotateX(${-py * 20}deg)`;
  });
  pack.addEventListener('pointerleave', () => { shell.style.transform = ''; });
}

// Rip the pack open on tap: swap the still foil pouch for the rendered tear
// animation (the top seal rips off), then the cards rise from the opening
// partway through. A Secret-Rare+ pack bursts with sun-rays + sparkles.
function tearPack(rare) {
  if (tearing) return;
  tearing = true;
  const pack = el('packOpen');
  const img = el('packImg');
  const tp = el('tapPrompt');
  if (tp) tp.remove();
  SFX.play('tear');
  pack.classList.add('tearing');
  // play the rip once (cache-bust so it restarts on every open)
  const shell = el('packShell'); if (shell) shell.style.transform = '';
  if (img) { img.src = pack.dataset.tear || `/tear_open.webp?t=${Date.now()}`; }
  const stage = el('stage');
  if (rare) setTimeout(() => { sunRays(stage); packSparkles(); SFX.play('rare'); }, 900);
  // Once the rip has played, the cards EJECT from inside the pack and the pack
  // sinks away beneath them. The pack is PINNED (position:fixed) and taken OUT OF
  // FLOW first, so the reveal grid settles in the CENTRE immediately. Otherwise the
  // pack occupies the flex column, the cards land low, and removing the pack later
  // reflows the column so the cards jump from the bottom up to the middle.
  setTimeout(() => {
    const grid = el('revealGrid');
    let ox = window.innerWidth / 2;
    let oy = window.innerHeight * 0.4;
    if (pack) {
      const pr = pack.getBoundingClientRect();
      ox = pr.left + pr.width / 2;      // the pack opening, near its top
      oy = pr.top + pr.height * 0.18;
      pack.style.position = 'fixed';    // pin it exactly where it is, out of flow
      pack.style.top = `${pr.top}px`;
      pack.style.left = `${pr.left}px`;
      pack.style.width = `${pr.width}px`;
      pack.style.margin = '0';
      pack.classList.add('dropping');   // and let it sink away
    }
    grid.classList.remove('hidden');    // the grid now lays out CENTERED
    grid.querySelectorAll('.fc').forEach((fc) => {
      const r = fc.getBoundingClientRect();
      fc.style.setProperty('--fromX', `${(ox - (r.left + r.width / 2)).toFixed(0)}px`);
      fc.style.setProperty('--fromY', `${(oy - (r.top + r.height / 2)).toFixed(0)}px`);
      fc.style.setProperty('--fromR', `${(Math.random() * 34 - 17).toFixed(1)}deg`);
    });
    requestAnimationFrame(() => grid.classList.add('go')); // eject the cards
    const rp = el('revealPrompt');
    if (rp) rp.classList.remove('hidden');
  }, 1400);
  // remove the pinned pack once it has dropped out of view (no reflow — it is fixed)
  setTimeout(() => { if (pack) pack.remove(); }, 2400);
}

// Radiating sun-rays behind the cards (rare packs).
function sunRays(stage) {
  const rays = document.createElement('div');
  rays.className = 'sunrays';
  stage.insertBefore(rays, stage.firstChild);
}
// A shower of sparkles from the pack opening (rare packs).
function packSparkles() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.42;
  for (let i = 0; i < 26; i += 1) {
    const s = document.createElement('div');
    s.className = 'spark';
    const ang = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 160;
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
    s.style.animationDelay = `${Math.random() * 0.3}s`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}

// Flip one face-down card. Special cards get a delayed celebration on the turn.
function flipCard(fc, card) {
  if (fc.classList.contains('flipped')) return;
  fc.classList.add('flipped');
  SFX.play('flip');
  flippedCount += 1;
  const special = (RARITY_RANK[card.rarity] ?? 0) >= 2;
  if (special) {
    setTimeout(() => {
      fc.classList.add('celebrate');
      sparkleBurst(fc);
      SFX.play('rare');
      rareBanner(RARITY_LABEL[card.rarity] || 'RARE');
    }, 320); // after the flip turns to the front
  }
  if (flippedCount >= revealItems.length) {
    const p = el('revealPrompt');
    if (p) p.textContent = 'Tap a card to inspect it · Back to close';
  }
}

// A little shower of sparkles bursting from a card.
function sparkleBurst(fc) {
  const r = fc.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < 14; i += 1) {
    const s = document.createElement('div');
    s.className = 'spark';
    const ang = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 90;
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

function rareBanner(text) {
  const stage = el('stage');
  if (!stage || stage.classList.contains('hidden')) return;
  const b = document.createElement('div');
  b.className = 'rare-banner';
  b.textContent = `✨ ${text} ✨`;
  stage.appendChild(b);
  setTimeout(() => b.remove(), 2200);
}

function endReveal() {
  clearTimeout(revealTimer);
  const stage = el('stage');
  stage.classList.add('closing');
  setTimeout(() => { stage.className = 'hidden'; stage.innerHTML = ''; }, 260);
  refreshOwned(); // new cards landed — update owned-card set for the feed viewer
  show(currentView); // the pane may be stale (new cards landed) — refresh it
}

function floatReact(msg) {
  const node = document.createElement('div');
  node.className = 'float-react';
  node.textContent = msg.emoji;
  node.style.left = `${10 + Math.random() * 80}%`;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

// ---- Gift a pack -----------------------------------------------------------
// Find any player (from the game's player directory, not just the VC) and send
// a pack from your balance. The transfer runs in the bot; the sender is always
// the verified caller.
let giftSearchTimer = null;
async function openGiftPanel() {
  await refreshPackStatus();
  const g = el('gift');
  g.className = 'open';
  g.innerHTML =
    `<div class="gift-card">
      <div class="gift-head"><span>🎁 Gift a pack</span><button class="gift-close" id="giftClose">✕</button></div>
      <div class="gift-bal" id="giftBal">You have <b>${packsAvailable}</b> pack${packsAvailable === 1 ? '' : 's'} to give</div>
      <input id="giftSearch" class="ginput" placeholder="Search players…" autocomplete="off">
      <div class="gift-results" id="giftResults"></div>
      <div class="gift-msg" id="giftMsg"></div>
    </div>`;
  el('giftClose').addEventListener('click', closeGiftPanel);
  g.addEventListener('click', (e) => { if (e.target === g) closeGiftPanel(); });
  el('giftSearch').addEventListener('input', (e) => {
    clearTimeout(giftSearchTimer);
    const q = e.target.value;
    giftSearchTimer = setTimeout(() => loadPlayers(q), 250);
  });
  el('giftResults').addEventListener('click', (e) => {
    const btn = e.target.closest?.('.gift-send');
    if (!btn) return;
    const row = btn.closest('.gift-row');
    sendGift(row.dataset.id, row.dataset.name, btn);
  });
  loadPlayers('');
  el('giftSearch').focus();
}

function closeGiftPanel() { el('gift').className = 'hidden'; el('gift').innerHTML = ''; }

// Leaderboard: top players by Total Collection Power (the trophy button).
async function openBoard() {
  const b = el('board');
  b.className = 'open';
  b.innerHTML =
    `<div class="board-card">
      <div class="board-head"><span>🏆 Top Collection Power</span><button class="board-close" id="boardClose">✕</button></div>
      <div class="board-list" id="boardList"><div class="loading">Loading…</div></div>
    </div>`;
  el('boardClose').addEventListener('click', closeBoard);
  b.addEventListener('click', (e) => { if (e.target === b) closeBoard(); });
  try {
    const d = await api('/api/leaderboard');
    const rows = (d.leaders || []).map((p, i) => {
      const meCls = p.player_id === d.me ? ' me' : '';
      const rank = ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
      return `<div class="board-row${meCls}"><span class="board-rank">${rank}</span><span class="board-name">${esc(p.username || 'Player')}</span><span class="board-cp">⚡ ${p.power}</span></div>`;
    }).join('');
    el('boardList').innerHTML = rows || '<p class="empty">No players yet.</p>';
  } catch {
    el('boardList').innerHTML = '<p class="empty">Could not load the leaderboard.</p>';
  }
}
function closeBoard() { el('board').className = 'hidden'; el('board').innerHTML = ''; }

// ---- The Pride Hunt (Phase 2) ----------------------------------------------
// A live countdown: precise remaining-time text, plus a ticker that refreshes every
// second and re-fetches the hunt when a deadline passes (active -> cooldown -> spawn).
function fmtLeft(ms) {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, '0')}s`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}
// A countdown span the ticker updates in place. prefix stays fixed, the time recomputes.
function cdSpan(iso, prefix, cls) {
  return `<span class="${cls}" data-until="${iso}" data-prefix="${esc(prefix)}">${esc(prefix)} ${fmtLeft(new Date(iso) - Date.now())}</span>`;
}
let huntTicker = null;
let huntTick = 0;
function stopHuntTicker() { if (huntTicker) { clearInterval(huntTicker); huntTicker = null; } }
function startHuntTicker() {
  stopHuntTicker();
  huntTick = 0;
  huntTicker = setInterval(() => {
    huntTick += 1;
    let expired = false;
    document.querySelectorAll('[data-until]').forEach((n) => {
      const ms = new Date(n.dataset.until) - Date.now();
      n.textContent = `${n.dataset.prefix} ${fmtLeft(ms)}`;
      if (ms <= 0) expired = true;
    });
    if (huntTick % 3 === 0 && currentView === 'battling') refreshHuntFeed(); // poll the boss feed every 3s
    // The UTC day rolled over: the daily reset happened. Re-fetch so downed cards reset
    // and the locked squad expires (back to squad selection).
    if (huntDay && utcToday() !== huntDay) { huntDay = utcToday(); stopHuntTicker(); if (view === 'battling') renderHunt(); return; }
    // A deadline passed: the server state changed. Refresh after a short delay so the
    // cron has spawned/closed, then re-render (boss appears, or cooldown begins).
    if (expired) { stopHuntTicker(); setTimeout(() => { if (view === 'battling') renderHunt(); }, 5000); }
  }, 1000);
}

let huntCache = null; // last /api/hunt response — lets the Battle tab open instantly

async function renderHunt() {
  disposeBoss(); // renderHunt can be called directly (e.g. hunt_over) — reset the boss
  // Instant open: paint the last known state right away, then refresh in the background.
  if (huntCache) { paintHuntView(huntCache); backgroundRefreshHunt(); return; }
  el('main').innerHTML = mainHead(TITLES.battling) + '<div class="main-body"><div class="loading">Summoning the hunt…</div></div>';
  let d;
  try { d = await api('/api/hunt'); } catch { d = null; }
  huntCache = d;
  paintHuntView(d);
}

// Render the whole battle view from a data object (boss + phase + boss canvas + feed).
function paintHuntView(d) {
  if (!d || !d.hunt) {
    el('main').innerHTML = mainHead(TITLES.battling) + `<div class="main-body">${cooldownHTML(d)}</div>`;
    startHuntTicker(); // count down to the next spawn
    return;
  }
  huntState = d;
  huntDay = utcToday(); // remember the day so the ticker can detect the daily reset
  const saved = loadTeam(d.hunt.id);
  if (saved && saved.length) { squad.phase = 'battle'; squad.sel = new Set(saved); }
  else { squad.phase = 'select'; squad.page = 0; squad.sel = new Set((d.roster || []).filter((c) => c.used).map((c) => c.id)); }
  el('main').innerHTML = mainHead(TITLES.battling) + huntHTML(d);
  wireHunt();
  mountBossFor(d.hunt); // spawn the live creature into the boss canvas
  refreshHuntFeed();    // load the live attack feed
  startHuntTicker(); // count down to the Monday deadline + poll the feed
}

// Background refresh after an instant open: full repaint only if the boss/cooldown state
// changed; otherwise a light in-place update (HP, roster) with no boss re-mount flash.
async function backgroundRefreshHunt() {
  let d; try { d = await api('/api/hunt'); } catch { return; }
  if (currentView !== 'battling') return;
  const prev = huntCache; huntCache = d;
  const bossChanged = !d || !d.hunt || !prev || !prev.hunt || d.hunt.id !== prev.hunt.id;
  if (bossChanged) { disposeBoss(); paintHuntView(d); return; }
  applyHuntState(d);
}

// Apply fresh hunt data to the already-rendered view (HP bar, tally, cards) without a
// full re-render or boss re-mount.
function applyHuntState(d) {
  if (!d || !d.hunt) return;
  huntState = { ...huntState, roster: d.roster, round: d.round, usedToday: d.usedToday, hunt: d.hunt };
  const h = d.hunt;
  const fill = document.querySelector('.hpfill');
  if (fill) fill.style.width = `${Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max))}%`;
  const hpText = el('hpText');
  if (hpText) hpText.textContent = h.status === 'defeated' ? 'DEFEATED!' : `${h.hp_remaining.toLocaleString()} / ${h.hp_max.toLocaleString()} HP`;
  const slot = el('usedSlot');
  if (slot) slot.innerHTML = `Cards <b>${d.usedToday || 0}</b>/${d.dailyCap || 8}`;
  if (h.status === 'defeated') { (document.querySelector('.boss') || document.querySelector('.hunt-arena'))?.classList.add('down'); bossHandle?.defeat(); }
  if (squad.phase === 'battle') paintTeam(); else paintHuntPage();
}

// The cooldown screen: no active boss. Show the last outcome + a countdown to the next
// Thursday spawn. nextSpawnAt comes from next_hunt_spawn() (the same time the cron fires).
function cooldownHTML(d) {
  const next = d && d.nextSpawnAt;
  const last = d && d.lastResult;
  const outcome = last
    ? (last.status === 'defeated'
        ? `<span class="cd-win">🏆 The pride defeated ${esc(last.name)}.</span>`
        : `<span class="cd-loss">💀 ${esc(last.name)} escaped. The pride did not win in time.</span>`)
    : '';
  const timer = next
    ? `<div class="cd-timer">${cdSpan(next, 'Next boss in', 'countdown big')}</div>`
    : '<span>A new boss appears each week.</span>';
  return `<div class="soon cooldown">🦁<b>The hunt is resting.</b>${outcome}${timer}</div>`;
}

// Strip the facet prefix from a tag slug for display (trait:water -> water).
function tagLabel(v) { return String(v || '').split(':').pop(); }
// The boss's weak + resist tags as chips ("Weak to fire · Resists water").
function weakResistHTML(h) {
  const chips = (arr, cls) => (arr || []).map((w) => `<span class="${cls}">${esc(tagLabel(w.value))}</span>`).join(' ');
  const w = chips(h.weak_points, 'weak-chip');
  const r = chips(h.resist_points, 'resist-chip');
  const parts = [];
  if (w) parts.push(`Weak to ${w}`);
  if (r) parts.push(`Resists ${r}`);
  return `<span class="weaks">${parts.join(' · ') || 'No weakness'}</span>`;
}

function huntHTML(d) {
  const h = d.hunt;
  usedIds = new Set((d.roster || []).filter((c) => c.used).map((c) => c.id));
  // Battle phase = a full-bleed arena (boss fills the pane, squad overlays the bottom).
  if (squad.phase === 'battle') return `<div class="main-body hunt arena-mode">${battlePhaseHTML(d)}</div>`;
  const pct = Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max));
  // weak + resist chips are rendered by weakResistHTML(h)
  const defeated = h.status === 'defeated' || h.hp_remaining <= 0;
  const boss = `<div class="boss${defeated ? ' down' : ''}">
      <div class="boss-stage"><canvas id="bossCanvas"></canvas></div>
      <div class="boss-top"><span class="boss-name">${esc(h.name)}</span><span class="boss-tier tier-${esc(h.tier.toLowerCase())}">${esc(h.tier)}</span></div>
      <div class="hpbar"><div class="hpfill" style="width:${pct}%"></div><span class="hptext" id="hpText">${defeated ? 'DEFEATED!' : `${h.hp_remaining.toLocaleString()} / ${h.hp_max.toLocaleString()} HP`}</span></div>
      <div class="boss-meta">${weakResistHTML(h)}${defeated ? '<span class="closes">DEFEATED</span>' : cdSpan(h.closes_at, 'Beat in', 'closes countdown')}</div>
      <div class="boss-meta"><span id="myDmg">Your damage: <b>${(d.myDamage || 0).toLocaleString()}</b></span><span class="fighters-now" id="fighterCount"></span><span id="usedSlot" class="used-slot">Cards <b>${d.usedToday || 0}</b>/${d.dailyCap || 8}</span><button class="hunt-lb" id="huntLbBtn">🏆 Standings</button></div>
    </div>`;
  return `<div class="main-body hunt">${boss}${selectPhaseHTML(d)}</div>`;
}

// --- Phase 1: pick the squad from the whole collection (paginated, gallery-style) ---
function selectPhaseHTML(d) {
  const cap = d.dailyCap || 8;
  const rarities = [...new Set((d.roster || []).map((c) => c.rarity))];
  const rarityOpts = ['all', ...rarities]
    .map((r) => `<option value="${r}"${squad.rarity === r ? ' selected' : ''}>${r === 'all' ? 'All tiers' : (RARITY_LABEL[r] || r)}</option>`).join('');
  const typeOpts = [['all', 'All types'], ['attackers', 'Attackers'], ['support', 'Support']]
    .map(([v, l]) => `<option value="${v}"${squad.type === v ? ' selected' : ''}>${l}</option>`).join('');
  return `<div class="squad-controls">
      <input id="hsearch" class="ginput" placeholder="Search cards…" value="${esc(squad.q)}">
      <select id="hrarity" class="gselect">${rarityOpts}</select>
      <select id="htype" class="gselect">${typeOpts}</select>
    </div>
    <div class="squad-grid" id="huntGrid"></div>
    <div class="squad-foot">
      <div class="pager" id="huntPager"></div>
      <button class="autopick-btn" id="autoPickBtn">✨ Auto-pick</button>
      <button class="lockin-btn" id="lockInBtn" disabled>🔒 Lock In <b id="selCount">${squad.sel.size}</b>/${cap}</button>
    </div>`;
}

// --- Phase 2: a full-bleed arena. Boss fills the pane; squad overlays the bottom. ---
function battlePhaseHTML(d) {
  const h = d.hunt;
  const pct = Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max));
  // weak + resist chips are rendered by weakResistHTML(h)
  const defeated = h.status === 'defeated' || h.hp_remaining <= 0;
  const canEdit = (d.usedToday || 0) === 0;
  return `<div class="hunt-arena${defeated ? ' down' : ''}">
    <div class="arena-stage"><canvas id="bossCanvas"></canvas></div>
    <div class="arena-top">
      <div class="arena-titlerow">
        <span class="boss-name">${esc(h.name)}</span>
        <span class="boss-tier tier-${esc(h.tier.toLowerCase())}">${esc(h.tier)}</span>
        ${weakResistHTML(h)}
        <span class="spacer"></span>
        ${defeated ? '<span class="closes">DEFEATED</span>' : cdSpan(h.closes_at, 'Beat in', 'closes countdown')}
      </div>
      <div class="hpbar"><div class="hpfill" style="width:${pct}%"></div><span class="hptext" id="hpText">${defeated ? 'DEFEATED!' : `${h.hp_remaining.toLocaleString()} / ${h.hp_max.toLocaleString()} HP`}</span></div>
      <div class="arena-subrow">
        <span id="myDmg">Your damage: <b>${(d.myDamage || 0).toLocaleString()}</b></span>
        <span class="fighters-now" id="fighterCount"></span>
        <span id="usedSlot" class="used-slot">Cards <b>${d.usedToday || 0}</b>/${d.dailyCap || 8}</span>
        ${canEdit ? '<button class="edit-team" id="editTeam">↺ Change squad</button>' : ''}
        <button class="hunt-lb" id="huntLbBtn">🏆 Standings</button>
      </div>
    </div>
    <div class="squad-grid hand" id="huntGrid"></div>
  </div>`;
}

// A card tile in the picker. mode 'select' shows a selection check; 'battle' shows the
// card HP bar (it attacks until the boss downs it) and a DOWNED state.
function huntTile(c, mode) {
  const support = !ATTACKER_TYPES.includes(c.type);
  const selected = squad.sel.has(c.id);
  const downed = !!c.downed;
  const max = c.max_hp || 1;
  const hppct = Math.max(0, Math.round((100 * (c.hp ?? max)) / max));
  const round = huntState?.round || 0;
  const cdLeft = support && (c.cdReady || 0) > round ? (c.cdReady - round) : 0; // rounds until ready
  const cls = `c ${c.rarity}${c.matches && !support ? ' match' : ''}${support ? ' support' : ''}`
    + `${mode === 'select' && selected ? ' selected' : ''}${mode === 'battle' && downed ? ' downed' : ''}${mode === 'battle' && cdLeft ? ' cooldown' : ''}`;
  const overlay = mode === 'select'
    ? (selected ? '<span class="sel-check">✓</span>' : '')
    : (downed ? '<span class="downed-x">DOWNED</span>' : (cdLeft ? `<span class="cd-x">${cdLeft}</span>` : ''));
  const hpbar = (mode === 'battle' && !support) ? `<div class="thp"><i style="width:${hppct}%"></i></div>` : '';
  const shield = (mode === 'battle' && c.shield > 0) ? `<span class="shield-b">🛡${c.shield}</span>` : '';
  const ab = c.ability;
  const abLine = ab ? `<div class="cability" title="${esc(ab.desc || '')}">${esc(ab.name)}</div>` : '';
  const typeTag = `<span class="ctype ct-${esc((c.type || '').toLowerCase())}">${esc(c.type || '')}</span>`;
  return `<div class="${cls}" data-id="${c.id}" data-type="${esc(c.type || '')}" data-used="${usedIds.has(c.id) ? 1 : 0}" data-max="${max}" title="${ab ? esc(ab.name + ' — ' + (ab.desc || '')) : ''}">
    <div class="art">${c.image_url ? `<img src="${c.image_url}" alt="${esc(c.name)}" loading="lazy">` : ''}${typeTag}${c.matches && !support ? '<span class="x2">×2</span>' : ''}${shield}${overlay}<span class="tpow">${support ? '🛡' : `⚡${c.power}`}</span></div>
    ${hpbar}
    <div class="cap">${esc(c.name)}${abLine}</div>
  </div>`;
}

// localStorage keeps the locked squad for the day, so re-entry restores the battle view.
const teamKey = (huntId) => `lpt_team_${huntId}`;
function loadTeam(huntId) {
  try { const t = JSON.parse(localStorage.getItem(teamKey(huntId)) || 'null');
    if (t && t.date === utcToday()) return t.ids || null;
    if (t) localStorage.removeItem(teamKey(huntId)); // expired (a new day) — drop it
  } catch { /* ignore */ }
  return null;
}
function saveTeam(huntId, ids) {
  try { localStorage.setItem(teamKey(huntId), JSON.stringify({ date: utcToday(), ids })); } catch { /* ignore */ }
}
function clearTeam(huntId) { try { localStorage.removeItem(teamKey(huntId)); } catch { /* ignore */ } }

function huntFiltered() {
  const q = squad.q.trim().toLowerCase();
  return (huntState?.roster || []).filter((c) => {
    const support = !ATTACKER_TYPES.includes(c.type);
    if (squad.rarity !== 'all' && c.rarity !== squad.rarity) return false;
    if (squad.type === 'attackers' && support) return false;
    if (squad.type === 'support' && !support) return false;
    if (q && !(c.name || '').toLowerCase().includes(q)) return false;
    return true;
  });
}
// Size the picker cards. Select phase: 4x2 page fits the grid height. Battle phase: a
// single row (the hand) fits across the arena width, capped to ~34% of arena height.
function sizeSquadGrid() {
  const grid = el('huntGrid');
  if (!grid) return;
  const gap = 8, capH = 30;
  if (squad.phase === 'battle') {
    const arena = grid.closest('.hunt-arena') || grid;
    const aw = arena.clientWidth || 600, ah = arena.clientHeight || 400;
    const n = Math.max(1, (huntState?.roster || []).filter((c) => squad.sel.has(c.id)).length);
    const cols = Math.min(8, n);
    const byWidth = (aw - (cols + 1) * gap) / cols;
    const byHeight = (ah * 0.34 - capH) * 5 / 7;
    const sw = Math.max(56, Math.min(150, Math.floor(Math.min(byWidth, byHeight))));
    grid.style.setProperty('--sw', `${sw}px`);
    return;
  }
  const w = grid.clientWidth || 600, h = grid.clientHeight || 360;
  const cols = 4, rows = 2, cap = 34;
  const byWidth = (w - (cols - 1) * gap) / cols;
  const byHeight = ((h - (rows - 1) * gap) / rows - cap) * 5 / 7;
  const sw = Math.max(72, Math.min(210, Math.floor(Math.min(byWidth, byHeight))));
  grid.style.setProperty('--sw', `${sw}px`);
}
function paintHuntPage(dir) {
  const grid = el('huntGrid');
  if (!grid) return;
  const items = huntFiltered();
  const perPage = 8;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  squad.page = Math.min(Math.max(0, squad.page), pages - 1);
  const slice = items.slice(squad.page * perPage, squad.page * perPage + perPage);
  grid.innerHTML = slice.length ? slice.map((c) => huntTile(c, 'select')).join('') : '<p class="empty">No cards match.</p>';
  sizeSquadGrid();
  huntPager(pages);
}
function huntPager(pages) {
  const pager = el('huntPager');
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ''; return; }
  const p = squad.page;
  const dots = Array.from({ length: pages }, (_, i) => `<span class="pdot${i === p ? ' on' : ''}"></span>`).join('');
  pager.innerHTML = `<button class="parrow" id="hprev" ${p === 0 ? 'disabled' : ''}>‹</button><span class="pdots">${dots}</span><button class="parrow" id="hnext" ${p >= pages - 1 ? 'disabled' : ''}>›</button>`;
  el('hprev')?.addEventListener('click', () => { squad.page -= 1; paintHuntPage('prev'); });
  el('hnext')?.addEventListener('click', () => { squad.page += 1; paintHuntPage('next'); });
}
function paintTeam() {
  const grid = el('huntGrid');
  if (!grid) return;
  const team = (huntState?.roster || []).filter((c) => squad.sel.has(c.id));
  grid.innerHTML = team.length ? team.map((c) => huntTile(c, 'battle')).join('') : '<p class="empty">No squad chosen.</p>';
  sizeSquadGrid();
}
function updateLockBtn() {
  const btn = el('lockInBtn'); const cnt = el('selCount');
  if (cnt) cnt.textContent = squad.sel.size;
  if (btn) btn.disabled = squad.sel.size < 1;
}

// The live boss-attack feed (shown in the right sidebar on the battle page). Polled
// while the battle screen is open. Newest first, capped.
async function refreshHuntFeed() {
  let d; try { d = await api('/api/hunt/feed'); } catch { return; }
  const feed = d?.feed || [];
  live.attacks = feed.slice(0, 20);
  if (d && d.hp_max != null) applySharedHp(d.hp_remaining, d.hp_max, d.status, d.fighters);
  if (currentView !== 'battling') return;
  const list = el('feedList');
  if (!list || !list.classList.contains('attacks')) { renderFeedSidebar(); return; }
  // Incremental: only ANIMATE IN events newer than the top one already shown. Existing
  // rows are left untouched, so the feed no longer blinks on every poll.
  const fresh = feed.filter((e) => (e.id || 0) > feedTopId);
  if (!fresh.length) return;
  list.querySelector('.empty')?.remove();
  fresh.slice().reverse().forEach((e) => list.insertAdjacentHTML('afterbegin', bossFeedRow(e))); // oldest first -> newest ends on top
  feedTopId = feed[0].id || feedTopId;
  while (list.children.length > 20) list.lastElementChild.remove();
}

// Apply the SHARED boss health from the feed poll, so a player who is only watching
// still sees the bar drop as others attack — and sees the defeat the moment it lands.
function applySharedHp(hp, max, status, fighters) {
  if (!huntState || !huntState.hunt || hp == null) return;
  const h = huntState.hunt;
  // Never raise the bar past what this client already knows (its own attack may be
  // ahead of the 2s-cached feed) — only reflect further damage.
  if (typeof h.hp_remaining === 'number' && hp > h.hp_remaining && status !== 'defeated') hp = h.hp_remaining;
  h.hp_remaining = hp; h.status = status;
  const fill = document.querySelector('.hpfill');
  if (fill) fill.style.width = `${Math.max(0, Math.round((100 * hp) / max))}%`;
  const hpText = el('hpText');
  if (hpText) hpText.textContent = status === 'defeated' ? 'DEFEATED!' : `${hp.toLocaleString()} / ${max.toLocaleString()} HP`;
  const fc = el('fighterCount');
  if (fc) fc.textContent = fighters > 0 ? `🗡 ${fighters} hunting now` : '';
  if (status === 'defeated' && !document.querySelector('.hunt-arena.down, .boss.down')) {
    (document.querySelector('.boss') || document.querySelector('.hunt-arena'))?.classList.add('down');
    bossHandle?.defeat();
    onBossDefeated(); // guarded by the .down check above so it runs once
  }
}

// First time a card engages the boss today, it counts toward the daily squad tally.
function markCardEngaged(node) {
  if (node.dataset.used === '1') return;
  node.dataset.used = '1';
  usedIds.add(Number(node.dataset.id));
  huntState.usedToday = (huntState.usedToday || 0) + 1;
  const slot = el('usedSlot');
  if (slot) slot.innerHTML = `Cards <b>${huntState.usedToday}</b>/${huntState.dailyCap || 8}`;
}

function wireHunt() {
  el('huntLbBtn')?.addEventListener('click', openHuntBoard);
  if (squad.phase === 'battle') { wireBattlePhase(); return; }
  wireSelectPhase();
}

// Phase 1: pick up to the daily cap; Lock In switches to the battle view.
function wireSelectPhase() {
  const cap = huntState?.dailyCap || 8;
  el('hsearch')?.addEventListener('input', (e) => { squad.q = e.target.value; squad.page = 0; paintHuntPage(); });
  el('hrarity')?.addEventListener('change', (e) => { squad.rarity = e.target.value; squad.page = 0; paintHuntPage(); });
  el('htype')?.addEventListener('change', (e) => { squad.type = e.target.value; squad.page = 0; paintHuntPage(); });
  el('huntGrid')?.addEventListener('click', (e) => {
    const node = e.target.closest?.('.c');
    if (!node) return;
    const id = Number(node.dataset.id);
    if (squad.sel.has(id)) { squad.sel.delete(id); node.classList.remove('selected'); }
    else {
      if (squad.sel.size >= cap) { const b = node.getBoundingClientRect(); calloutAt(b.left + b.width / 2, b.top + 18, `MAX ${cap}`, '#ff8f5c'); return; }
      squad.sel.add(id); node.classList.add('selected');
    }
    // refresh the check overlay on this tile
    const art = node.querySelector('.art');
    art.querySelector('.sel-check')?.remove();
    if (squad.sel.has(id)) { const s = document.createElement('span'); s.className = 'sel-check'; s.textContent = '✓'; art.appendChild(s); }
    updateLockBtn();
  });
  el('lockInBtn')?.addEventListener('click', () => {
    if (squad.sel.size < 1) return;
    saveTeam(huntState.hunt.id, [...squad.sel]);
    squad.phase = 'battle';
    SFX?.play?.('reveal');
    el('main').innerHTML = mainHead(TITLES.battling) + huntHTML(huntState);
    wireHunt(); mountBossFor(huntState.hunt); paintTeam(); startHuntTicker();
  });
  // Auto-pick: the server scores the player's cards against today's boss and
  // returns the best squad. It replaces the current selection; the player can edit.
  el('autoPickBtn')?.addEventListener('click', async () => {
    const btn = el('autoPickBtn');
    btn.disabled = true; btn.classList.add('busy');
    let ids = [];
    try { ids = (await api('/api/hunt/autopick')).ids || []; } catch { ids = []; }
    btn.disabled = false; btn.classList.remove('busy');
    if (!ids.length) { calloutAt(window.innerWidth / 2, 120, 'NO PICKS', '#ff8f5c'); return; }
    squad.sel = new Set(ids.slice(0, cap));
    squad.page = 0;
    SFX?.play?.('page');
    paintHuntPage();
    updateLockBtn();
  });
  paintHuntPage();
  updateLockBtn();
}

// Phase 2: tap an attacker to attack; tap a support to fire its ability (ally effects then
// prompt for a target). pendingSupport holds an ability waiting for a target ally.
let pendingSupport = null;
function clearTargeting() {
  pendingSupport = null;
  el('huntGrid')?.classList.remove('targeting');
  document.querySelectorAll('.squad-grid .c.casting').forEach((n) => n.classList.remove('casting'));
}
function wireBattlePhase() {
  el('editTeam')?.addEventListener('click', () => {
    if ((huntState.usedToday || 0) > 0) return; // team locks once you have attacked
    clearTeam(huntState.hunt.id);
    squad.phase = 'select';
    el('main').innerHTML = mainHead(TITLES.battling) + huntHTML(huntState);
    wireHunt(); mountBossFor(huntState.hunt); startHuntTicker();
  });
  el('huntGrid')?.addEventListener('click', (e) => {
    const node = e.target.closest?.('.c');
    if (!node) return;
    const b = node.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const id = Number(node.dataset.id);
    const card = (huntState.roster || []).find((c) => c.id === id);
    const support = card && !ATTACKER_TYPES.includes(card.type);
    // Completing a support that needed a target: this attacker is the target.
    if (pendingSupport && !support && !node.classList.contains('downed')) {
      const sup = pendingSupport; clearTargeting(); fireSupport(sup, id); return;
    }
    if (support) {
      if (pendingSupport) { clearTargeting(); return; } // tapping a support cancels targeting
      if (node.classList.contains('cooldown')) { calloutAt(cx, b.top + 18, 'COOLDOWN', '#8b94a7'); return; }
      const tgt = card.ability && card.ability.target;
      if (tgt === 'ally' || tgt === 'self') { // needs a target ally
        pendingSupport = card.id; node.classList.add('casting'); el('huntGrid')?.classList.add('targeting');
        calloutAt(cx, b.top + 18, 'PICK ALLY', '#7fe3ff');
      } else { fireSupport(card.id, null); }
      return;
    }
    if (pendingSupport) { clearTargeting(); return; }
    if (node.classList.contains('downed')) { calloutAt(cx, b.top + 18, 'DOWNED', '#8b94a7'); return; }
    if (huntState?.hunt?.status === 'defeated') return;
    huntAttack(node.dataset.id, node);
  });
  paintTeam();
}

// Fire a support ability, then refresh the battle state from the server.
async function fireSupport(cardId, targetId) {
  let r; try { r = await apiPost('/api/hunt/support', { cardId, targetId }); } catch { r = null; }
  const node = document.querySelector(`.squad-grid .c[data-id="${cardId}"]`);
  const b = node ? node.getBoundingClientRect() : null;
  const at = (txt, col) => calloutAt(b ? b.left + b.width / 2 : window.innerWidth / 2, b ? b.top : 120, txt, col);
  if (!r || !r.ok) {
    at(r && r.error === 'cooldown' ? 'COOLDOWN' : (r && r.error === 'day_limit' ? `LIMIT` : 'X'), '#ff8f5c');
    return;
  }
  const label = { empower: 'EMPOWER!', shield: 'SHIELD!', heal: 'HEAL!', weaken: 'WEAKEN!', expose: 'EXPOSE!', smite: 'SMITE!', stun: 'STUN!', cleanse: 'CLEANSE!' }[r.effect] || r.effect;
  const tgt = squadNode(r.target);
  switch (r.effect) {
    case 'empower': at(label, '#ffd23e'); auraOn(tgt, '#ffd23e'); break;          // ally gains an attack aura
    case 'shield': at(label, '#7fb0ff'); shieldPop(tgt); break;                   // a guard bubble
    case 'heal': at(label, '#37e0a0'); auraOn(tgt, '#37e0a0', 'fx-aura heal'); break; // green mend (exact hp unknown → aura, no number)
    case 'cleanse': at(label, '#dfe9ff'); auraOn(tgt, '#dfe9ff', 'fx-aura'); break;
    case 'weaken': at(label, '#5aa0ff'); markToBoss(node, '▼', '#5aa0ff'); bossHandle?.flinch(); break;   // sap the boss
    case 'expose': at(label, '#ff7a3f'); markToBoss(node, '◎', '#ff7a3f'); bossGlyph('◎', '#ff7a3f'); break; // crack its guard
    case 'stun': at(label, '#ffe23e'); bossHandle?.stun(); bossGlyph('✦', '#ffe23e'); screenShake(); break;   // stagger it
    case 'smite': at(label, '#ff6a5a'); { const bp = bossPoint(); impactBurst(bp.x, bp.y, '#ff6a5a', true); } bossHandle?.flinch(); screenShake(); break;
    default: at(label, '#7fe3ff');
  }
  SFX?.play?.(r.effect === 'smite' ? 'reveal' : 'flip');
  await refreshHuntState();
}

// Re-fetch the hunt state (roster shields/cooldowns/hp, round, boss hp) and repaint the team.
async function refreshHuntState() {
  let d; try { d = await api('/api/hunt'); } catch { return; }
  if (!d || !d.hunt) { huntCache = d; if (currentView === 'battling') renderHunt(); return; }
  huntState = { ...huntState, roster: d.roster, round: d.round, usedToday: d.usedToday, hunt: d.hunt };
  huntCache = { ...huntCache, ...d }; // keep the instant-open cache warm after each action
  const h = d.hunt; const fill = document.querySelector('.hpfill');
  if (fill) fill.style.width = `${Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max))}%`;
  const hpText = el('hpText'); if (hpText) hpText.textContent = h.status === 'defeated' ? 'DEFEATED!' : `${h.hp_remaining.toLocaleString()} / ${h.hp_max.toLocaleString()} HP`;
  const slot = el('usedSlot'); if (slot) slot.innerHTML = `Cards <b>${d.usedToday || 0}</b>/${d.dailyCap || 8}`;
  if (h.status === 'defeated') { (document.querySelector('.boss') || document.querySelector('.hunt-arena'))?.classList.add('down'); bossHandle?.defeat(); }
  paintTeam();
}

function flashDamage(node, dmg, bonus) {
  const s = document.createElement('span');
  s.className = 'dmg-pop' + (bonus ? ' crit' : '');
  s.textContent = `-${dmg}${bonus ? ' ×2!' : ''}`;
  node.appendChild(s);
  setTimeout(() => s.remove(), 900);
}

// Each rarity fires its own energy color, so attacks read at a glance.
const RARITY_ATK = {
  normal: '#9fd0ff', illustrated_rare: '#5aa0ff', secret_rare: '#b06aff',
  full_art: '#ff6ad0', gold: '#ffd23e', event: '#37e0a0', promo: '#ff6a5a',
};

// A glowing bolt flies from the tapped card up to the boss. Returns { impact, cancel }.
function launchAttack(node, color) {
  const ac = color || '#7fe3ff';
  const target = document.querySelector('.arena-stage') || document.querySelector('.boss-stage') || document.querySelector('.boss');
  if (!target) return { impact() {}, cancel() {} };
  const cr = node.getBoundingClientRect(), br = target.getBoundingClientRect();
  const sx = cr.left + cr.width / 2, sy = cr.top + cr.height / 2;
  const bx = br.left + br.width / 2, by = br.top + br.height * 0.55;
  const bolt = document.createElement('div');
  bolt.className = 'atk-bolt';
  bolt.style.setProperty('--ac', ac);
  bolt.style.left = `${sx}px`; bolt.style.top = `${sy}px`;
  bolt.style.transform = 'translate(0,0) scale(.6)';
  document.body.appendChild(bolt);
  requestAnimationFrame(() => { bolt.style.transform = `translate(${bx - sx}px, ${by - sy}px) scale(1)`; });
  SFX?.play?.('page');
  let done = false;
  setTimeout(() => { if (!done) bolt.remove(); }, 1400);
  return {
    impact(bonus) {
      if (done) return; done = true;
      bolt.remove();
      impactBurst(bx, by, bonus ? '#ffd23e' : ac, bonus);
    },
    cancel() { done = true; bolt.remove(); },
  };
}

// A flash + shockwave ring + spark shower at the boss on impact.
function impactBurst(x, y, color, big) {
  const mk = (cls) => { const d = document.createElement('div'); d.className = cls; d.style.left = `${x}px`; d.style.top = `${y}px`; d.style.setProperty('--ac', color); document.body.appendChild(d); return d; };
  const flash = mk('atk-flash'); setTimeout(() => flash.remove(), 520);
  const ring = mk('atk-ring'); setTimeout(() => ring.remove(), 620);
  for (let i = 0; i < (big ? 20 : 13); i += 1) {
    const s = mk('atk-spark'); const ang = Math.random() * Math.PI * 2, d = 40 + Math.random() * (big ? 95 : 62);
    s.style.setProperty('--dx', `${Math.cos(ang) * d}px`); s.style.setProperty('--dy', `${Math.sin(ang) * d}px`);
    setTimeout(() => s.remove(), 720);
  }
}

// Floating combat text (MISS / BLOCK / CRIT! / WEAK!) at a screen point.
function calloutAt(x, y, text, color) {
  const s = document.createElement('div');
  s.className = 'atk-callout';
  s.textContent = text;
  s.style.left = `${x}px`; s.style.top = `${y}px`; s.style.setProperty('--ac', color);
  document.body.appendChild(s);
  setTimeout(() => s.remove(), 900);
}
function setCardHp(node, hp, max) {
  const m = max || Number(node.dataset.max) || 1;
  const fill = node.querySelector('.thp i') || node.querySelector('.chpfill');
  if (fill) fill.style.width = `${Math.max(0, Math.round((100 * (hp ?? m)) / m))}%`;
}
function markDowned(node) {
  node.classList.add('downed');
  setCardHp(node, 0, Number(node.dataset.max) || 1);
  if (!node.querySelector('.downed-x')) { const d = document.createElement('span'); d.className = 'downed-x'; d.textContent = 'DOWNED'; (node.querySelector('.art') || node.querySelector('.hart'))?.appendChild(d); }
}
function recoilCard(node, dmg) {
  node.classList.remove('hit'); void node.offsetWidth; node.classList.add('hit');
  setTimeout(() => node.classList.remove('hit'), 500);
  const s = document.createElement('span');
  s.className = 'dmg-pop counter';
  s.textContent = `-${dmg}`;
  node.appendChild(s);
  setTimeout(() => s.remove(), 900);
}
function screenShake() {
  const b = document.querySelector('.main-body.hunt') || el('main');
  if (!b) return;
  b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
  setTimeout(() => b.classList.remove('shake'), 450);
}

// ===== Ability effect visuals =====
// A squad card node by its card id (both phases render into .squad-grid).
function squadNode(id) { return id ? document.querySelector(`.squad-grid .c[data-id="${id}"]`) : null; }
function bossPoint() {
  const boss = document.querySelector('.arena-stage') || document.querySelector('.boss-stage') || document.querySelector('.boss');
  const br = boss?.getBoundingClientRect();
  return { x: br ? br.left + br.width / 2 : window.innerWidth / 2, y: br ? br.top + br.height * 0.45 : 120, br };
}
// An expanding colored ring centered on a card (empower / cleanse buffs). Appended to the
// card node (not .art, which is overflow:hidden) so the ring can bloom past the frame.
function auraOn(node, color, cls) {
  if (!node) return;
  const a = document.createElement('span');
  a.className = cls || 'fx-aura';
  a.style.setProperty('--ac', color);
  node.appendChild(a);
  setTimeout(() => a.remove(), 820);
}
// A shield bubble that pops in over a card (guard/shield support).
function shieldPop(node) {
  if (!node) return;
  const s = document.createElement('span');
  s.className = 'fx-shield';
  node.appendChild(s);
  setTimeout(() => s.remove(), 900);
}
// A green heal number that floats up off a card (lifesteal / heal).
function healPop(node, amount) {
  if (!node) return;
  auraOn(node, '#37e0a0', 'fx-aura heal');
  const s = document.createElement('span');
  s.className = 'heal-pop';
  s.textContent = `+${amount}`;
  node.appendChild(s);
  setTimeout(() => s.remove(), 950);
}
// A small glyph flung from a card up to the boss, bursting on arrival (weaken/expose/smite).
function markToBoss(fromNode, glyph, color) {
  const bp = bossPoint();
  const cr = fromNode ? fromNode.getBoundingClientRect() : null;
  const sx = cr ? cr.left + cr.width / 2 : window.innerWidth / 2, sy = cr ? cr.top : window.innerHeight * 0.7;
  const m = document.createElement('div');
  m.className = 'fx-mark';
  m.textContent = glyph;
  m.style.setProperty('--ac', color);
  m.style.left = `${sx}px`; m.style.top = `${sy}px`;
  document.body.appendChild(m);
  requestAnimationFrame(() => { m.style.transform = `translate(${bp.x - sx}px, ${bp.y - sy}px) scale(1.4)`; m.style.opacity = '0.1'; });
  setTimeout(() => { m.remove(); calloutAt(bp.x, bp.y - 20, glyph, color); }, 460);
}
// A transient overlay glyph pinned on the boss (expose crosshair / stun stars / cleanse).
function bossGlyph(glyph, color) {
  const bp = bossPoint();
  const g = document.createElement('div');
  g.className = 'fx-bossglyph';
  g.textContent = glyph;
  g.style.setProperty('--ac', color);
  g.style.left = `${bp.x}px`; g.style.top = `${bp.y - 26}px`;
  document.body.appendChild(g);
  setTimeout(() => g.remove(), 1100);
}
// A dark hex mark that sinks onto a card (boss curse debuff).
function curseMark(node) {
  if (!node) return;
  auraOn(node, '#b060ff', 'fx-aura curse');
  const s = document.createElement('span');
  s.className = 'fx-curse';
  s.textContent = '✖';
  node.appendChild(s);
  setTimeout(() => s.remove(), 1000);
}

async function huntAttack(cardId, node) {
  if (node.classList.contains('busy')) return;
  node.classList.add('busy');
  const rarity = ['gold', 'full_art', 'secret_rare', 'illustrated_rare', 'event', 'promo'].find((rr) => node.classList.contains(rr)) || 'normal';
  const color = RARITY_ATK[rarity] || '#7fe3ff';
  node.style.setProperty('--ac', color);
  node.classList.add('attacking'); // the card lunges + charges as it fires
  setTimeout(() => node.classList.remove('attacking'), 520);
  const atk = launchAttack(node, color); // the bolt flies immediately on tap
  const t0 = performance.now();
  let r;
  const wasNew = node.dataset.used !== '1';
  try { r = await apiPost('/api/hunt/attack', { cardId: Number(cardId) }); } catch { r = null; }
  node.classList.remove('busy');
  if (!r || !r.ok) {
    atk.cancel();
    if (r?.error === 'downed') markDowned(node);
    else if (r?.error === 'hunt_over') renderHunt();
    else if (r?.error === 'day_limit') { const b = node.getBoundingClientRect(); calloutAt(b.left + 30, b.top, `LIMIT ${r.cap || 8}`, '#ff8f5c'); }
    return;
  }
  if (wasNew) markCardEngaged(node); // first engage counts toward the daily squad tally
  const wait = Math.max(0, 340 - (performance.now() - t0));
  setTimeout(() => resolveHit(node, r, atk), wait);
}

// Land the resolved hit (synced to the bolt's arrival): outcome call-out, boss HP,
// this card's HP, then a possible boss counterattack.
function resolveHit(node, r, atk) {
  const boss = document.querySelector('.arena-stage') || document.querySelector('.boss-stage') || document.querySelector('.boss');
  const br = boss?.getBoundingClientRect();
  const bx = br ? br.left + br.width / 2 : window.innerWidth / 2;
  const by = br ? br.top + br.height * 0.42 : 120;
  const big = !!(r.bonus || r.crit);
  if (r.outcome === 'miss') {
    atk.cancel();
    calloutAt(bx, by, 'MISS', '#9aa4b6');
  } else {
    atk.impact(big);
    bossHandle?.flinch();
    if (r.crit) calloutAt(bx, by - 26, 'CRIT!', '#ffd23e');
    else if (r.outcome === 'blocked') calloutAt(bx, by - 26, 'BLOCK', '#7fb0ff');
    if (r.bonus) calloutAt(bx, by - 52, 'WEAK!', '#ff7a3f');
    else if (r.resisted) calloutAt(bx, by - 52, 'RESIST', '#7fb0ff');
    flashDamage(node, r.damage, big);
  }
  const h = huntState.hunt;
  h.hp_remaining = r.hp_remaining; h.status = r.status;
  const fill = document.querySelector('.hpfill');
  if (fill) fill.style.width = `${Math.max(0, Math.round((100 * r.hp_remaining) / h.hp_max))}%`;
  const hpText = el('hpText');
  if (hpText) hpText.textContent = r.defeated ? 'DEFEATED!' : `${r.hp_remaining.toLocaleString()} / ${h.hp_max.toLocaleString()} HP`;
  huntState.myDamage = (huntState.myDamage || 0) + (r.damage || 0);
  const md = el('myDmg');
  if (md) md.innerHTML = `Your damage: <b>${huntState.myDamage.toLocaleString()}</b>`;
  setCardHp(node, r.card_hp, r.card_max_hp);
  if (r.heal > 0 && r.ability === 'lifesteal') healPop(node, r.heal); // vampiric attacker mends itself
  if (r.defeated) { (document.querySelector('.boss') || document.querySelector('.hunt-arena'))?.classList.add('down'); bossHandle?.defeat(); SFX?.play?.('reveal'); onBossDefeated(); return; }
  SFX?.play?.(r.outcome === 'miss' ? 'page' : 'flip');
  // The attack ended the round. Now the boss takes its hidden turn (a surprise from its pool).
  if (r.boss_action) {
    showBossTurn();
    setTimeout(() => resolveBossTurn(r.boss_action), 460);
  } else if (r.card_downed) {
    markDowned(node);
  }
}

// The boss just died on this player's hit. Freeze the "Beat in" deadline at once, then —
// after the death animation — swing the view to the cooldown screen, whose countdown now
// runs to the NEXT spawn. The server already flipped the hunt to 'defeated', so the next
// /api/hunt returns no active boss (cooldown + nextSpawnAt). Fetch during the animation so
// the swap lands with no loading flash.
function onBossDefeated() {
  document.querySelectorAll('.closes.countdown[data-until]').forEach((n) => {
    n.removeAttribute('data-until'); // stop the ticker updating this deadline
    n.textContent = 'DEFEATED';
    n.classList.add('done');
  });
  const pending = api('/api/hunt').catch(() => null);
  setTimeout(async () => {
    if (currentView !== 'battling') return;
    const d = await pending;
    huntCache = d;
    disposeBoss();
    paintHuntView(d); // d.hunt is null -> cooldownHTML: "Next boss in …"
  }, 2600);
}

// A brief "Boss's turn" banner — the player learns the boss is acting, never what is coming.
function showBossTurn() {
  const arena = document.querySelector('.hunt-arena') || document.querySelector('.main-body.hunt');
  if (!arena) return;
  const b = document.createElement('div');
  b.className = 'boss-turn-banner';
  b.textContent = "⚔ Boss's Turn";
  arena.appendChild(b);
  setTimeout(() => b.remove(), 900);
}

// Resolve the boss action drawn on the server (a surprise from its pool). Each kind reads
// distinctly: Strike/Slam deal damage, Enrage buffs the boss, Curse debuffs the attacker,
// Stunned means a support locked the boss out of its turn.
function resolveBossTurn(act) {
  const bp = bossPoint();
  const bx = bp.x, by = bp.br ? bp.br.top + bp.br.height * 0.5 : 120;
  // Sync any card hp/downed changes the server reported, without a false damage pop.
  const syncTargets = (recoil, stagger) => (act.targets || []).forEach((tg, i) => {
    const cnode = squadNode(tg.card_id);
    if (!cnode) return;
    setTimeout(() => {
      if (recoil && tg.dmg > 0) recoilCard(cnode, tg.dmg);
      setCardHp(cnode, tg.hp, tg.max_hp);
      if (tg.downed) markDowned(cnode);
    }, stagger ? i * 80 : 0);
  });
  if (act.kind === 'stunned') { // a support stun robbed the boss of its turn
    bossHandle?.stun();
    calloutAt(bx, by - 18, 'STUNNED', '#ffe23e');
    bossGlyph('✦', '#ffe23e');
    SFX?.play?.('page');
    return;
  }
  if (act.kind === 'enrage') { // the boss roars — harder hits for the next rounds
    bossHandle?.enrage();
    screenShake();
    calloutAt(bx, by - 18, 'ENRAGE!', '#ff5a3c');
    bossGlyph('🔥', '#ff3a10');
    SFX?.play?.('tear');
    return;
  }
  if (act.kind === 'curse') { // a hex sinks onto the attacker — it hits softer
    calloutAt(bx, by - 18, 'CURSE!', '#b060ff');
    curseMark(squadNode((act.targets || [])[0]?.card_id));
    SFX?.play?.('tear');
    return;
  }
  // strike / slam — real damage.
  bossHandle?.counter();
  screenShake();
  calloutAt(bx, by - 18, act.kind === 'slam' ? 'SLAM!' : 'STRIKE!', '#ff6a5a');
  if (act.kind === 'slam') setTimeout(() => screenShake(), 120);
  syncTargets(true, act.kind === 'slam');
  SFX?.play?.('tear');
}

async function openHuntBoard() {
  const b = el('board');
  b.className = 'open';
  b.innerHTML =
    `<div class="board-card">
      <div class="board-head"><span>🏆 Hunt Standings</span><button class="board-close" id="boardClose">✕</button></div>
      <div class="board-list" id="boardList"><div class="loading">Loading…</div></div>
    </div>`;
  el('boardClose').addEventListener('click', closeBoard);
  b.addEventListener('click', (e) => { if (e.target === b) closeBoard(); });
  try {
    const d = await api('/api/hunt/leaderboard');
    const rows = (d.leaders || []).map((p, i) => {
      const meCls = p.player_id === d.me ? ' me' : '';
      const rank = ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
      return `<div class="board-row${meCls}"><span class="board-rank">${rank}</span><span class="board-name">${esc(p.username || 'Player')}</span><span class="board-cp">⚔️ ${p.damage}</span></div>`;
    }).join('');
    el('boardList').innerHTML = rows || '<p class="empty">No damage dealt yet.</p>';
  } catch {
    el('boardList').innerHTML = '<p class="empty">Could not load standings.</p>';
  }
}

async function loadPlayers(q) {
  const box = el('giftResults');
  if (!box) return;
  try {
    const data = await api(`/api/players?q=${encodeURIComponent(q)}`);
    const players = data.players || [];
    box.innerHTML = players.length
      ? players.map((p) => `<div class="gift-row" data-id="${p.id}" data-name="${esc(p.username)}">
          <span class="gift-name">${esc(p.username)}</span>
          <button class="gift-send">Gift 1</button>
        </div>`).join('')
      : '<p class="empty small">No players found.</p>';
  } catch { box.innerHTML = '<p class="empty small">Could not load players.</p>'; }
}

async function sendGift(toId, name, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  const msg = el('giftMsg');
  try {
    const data = await apiPost('/api/gift', { toId, amount: 1 });
    if (data.ok) {
      if (msg) msg.textContent = `🎁 Sent a pack to ${name}!`;
      SFX.play('page');
      await refreshPackStatus();
      const bal = el('giftBal');
      if (bal) bal.innerHTML = `You have <b>${packsAvailable}</b> pack${packsAvailable === 1 ? '' : 's'} to give`;
      btn.textContent = 'Sent ✓';
    } else {
      if (msg) msg.textContent = 'You have no packs to give right now.';
      btn.disabled = false;
      btn.textContent = 'Gift 1';
    }
  } catch {
    if (msg) msg.textContent = 'Could not send right now.';
    btn.disabled = false;
    btn.textContent = 'Gift 1';
  }
}

// ---- In-app notifications (the bell) ---------------------------------------
async function openNotifs() {
  const g = el('notif');
  g.className = 'open';
  g.innerHTML =
    `<div class="gift-card">
      <div class="gift-head"><span>🔔 Notifications</span><button class="gift-close" id="notifClose">✕</button></div>
      <div class="notif-list" id="notifList"><div class="loading">Loading…</div></div>
    </div>`;
  el('notifClose').addEventListener('click', closeNotifs);
  g.addEventListener('click', (e) => { if (e.target === g) closeNotifs(); });
  let data;
  try { data = await api('/api/notifications'); } catch { data = { items: [] }; }
  const items = data.items || [];
  el('notifList').innerHTML = items.length
    ? items.map((n) => `<div class="notif-row${n.read ? '' : ' unread'}"><div class="notif-msg">${esc(n.message)}</div><div class="notif-time">${ago(n.created_at)}</div></div>`).join('')
    : '<p class="empty small">No notifications yet.</p>';
  try { await apiPost('/api/notifications/read', {}); } catch { /* ignore */ }
  updateNotifBadge(0);
}
function closeNotifs() { el('notif').className = 'hidden'; el('notif').innerHTML = ''; }
function updateNotifBadge(n) {
  const btn = el('bellBtn');
  if (!btn) return;
  let b = btn.querySelector('.navbadge');
  if (n > 0) { if (!b) { b = document.createElement('span'); b.className = 'navbadge'; btn.appendChild(b); } b.textContent = n; }
  else if (b) b.remove();
}
async function refreshNotifBadge() { try { const d = await api('/api/notifications'); updateNotifBadge(d.unread || 0); } catch { /* ignore */ } }

// ---- Trading ---------------------------------------------------------------
async function renderTrading() {
  el('main').innerHTML = mainHead('Trading') + '<div class="main-body"><div class="loading">Loading trades…</div></div>';
  updateOpenButton();
  let data;
  try { data = await api('/api/trades'); } catch { data = {}; }
  const inc = data.incoming || [];
  const out = data.outgoing || [];
  updateTradeBadge(inc.length);
  const mini = (c) => (c ? `<div class="tmini ${c.rarity}"><div class="art">${c.image_url ? `<img src="${c.image_url}" alt="${esc(c.name)}">` : ''}</div><span>${esc(c.name)}</span></div>` : '');
  const incHtml = inc.length ? inc.map((o) => `
    <div class="trade-row">
      <div class="tr-who"><b>${esc(o.from_name || 'Someone')}</b> offers you</div>
      <div class="tr-cards">${mini(o.offer)}<span class="tr-swap">⇄</span>${mini(o.request)}</div>
      <div class="tr-actions"><button class="btn-accept" data-id="${o.id}">Accept</button><button class="btn-decline" data-id="${o.id}">Decline</button></div>
    </div>`).join('') : '<p class="empty small">No incoming offers.</p>';
  const outHtml = out.length ? out.map((o) => `
    <div class="trade-row">
      <div class="tr-who">To <b>${esc(o.to_name || 'Someone')}</b></div>
      <div class="tr-cards">${mini(o.offer)}<span class="tr-swap">⇄</span>${mini(o.request)}</div>
      <div class="tr-actions"><span class="tr-pending">pending</span><button class="btn-cancel" data-id="${o.id}">Cancel</button></div>
    </div>`).join('') : '<p class="empty small">No sent offers.</p>';
  const noticeHtml = tradeNotice ? `<div class="trade-notice">${esc(tradeNotice)}</div>` : '';
  tradeNotice = '';
  el('main').innerHTML = mainHead('Trading') +
    `<div class="main-body trade-body">
       ${noticeHtml}
       <div class="trade-top"><button class="open-btn" id="newTradeBtn">＋ New Trade</button></div>
       <div class="trade-cols">
         <div class="trade-col"><div class="tcol-head">Incoming${inc.length ? ` (${inc.length})` : ''}</div><div id="tIncoming">${incHtml}</div></div>
         <div class="trade-col"><div class="tcol-head">Sent</div><div id="tOutgoing">${outHtml}</div></div>
       </div>
     </div>`;
  updateOpenButton();
  el('newTradeBtn').addEventListener('click', openTradeBuilder);
  el('tIncoming').addEventListener('click', onTradeAction);
  el('tOutgoing').addEventListener('click', onTradeAction);
}

let tradeNotice = '';
async function onTradeAction(e) {
  const btn = e.target.closest?.('.btn-accept, .btn-decline, .btn-cancel');
  if (!btn) return;
  btn.disabled = true;
  const id = Number(btn.dataset.id);
  try {
    if (btn.classList.contains('btn-accept')) {
      const r = await apiPost('/api/trade/accept', { offerId: id });
      if (r.ok) { SFX.play('rare'); cache.collection = null; cache.catalog = null; tradeNotice = '✅ Trade complete!'; }
      else tradeNotice = 'Could not complete — a card is no longer available.';
    } else if (btn.classList.contains('btn-decline')) {
      await apiPost('/api/trade/resolve', { offerId: id, action: 'decline' });
    } else {
      await apiPost('/api/trade/resolve', { offerId: id, action: 'cancel' });
    }
  } catch { tradeNotice = 'Something went wrong.'; }
  renderTrading();
}

// The trade builder: recipient -> your card -> gift it, or request one back.
const trade = { step: 1, toId: null, toName: null, myCard: null, mine: [], theirs: [] };
function openTradeBuilder() {
  Object.assign(trade, { step: 1, toId: null, toName: null, myCard: null });
  el('trade').className = 'open';
  el('trade').onclick = (e) => { if (e.target === el('trade')) closeTrade(); };
  renderTradeStep();
}
function closeTrade() { el('trade').className = 'hidden'; el('trade').innerHTML = ''; }
const tradeShell = (title, inner) => `<div class="trade-card">
  <div class="gift-head"><span>${trade.step > 1 ? '<button class="tback" id="tBack">‹</button>' : ''}${title}</span><button class="gift-close" id="tClose">✕</button></div>${inner}</div>`;
// Wire the close + back buttons every step (back = the previous step).
function wireTradeNav() {
  el('tClose').onclick = closeTrade;
  const bk = el('tBack');
  if (bk) bk.onclick = () => { trade.step -= 1; renderTradeStep(); };
}
function tradeTile(c, i, big) {
  const locked = c.tradeable === false ? ' locked' : '';
  return `<div class="ttile ${c.rarity}${big ? ' big' : ''}${locked}" data-i="${i}">
    <div class="art">${c.image_url ? `<img src="${c.image_url}" alt="${esc(c.name)}">` : ''}</div>
    <div class="cap">${esc(c.name)}${c.quantity > 1 ? ` <span class="q">×${c.quantity}</span>` : ''}</div>
  </div>`;
}

async function renderTradeStep() {
  const t = el('trade');
  if (trade.step === 1) {
    t.innerHTML = tradeShell('New Trade · pick a player',
      '<input id="tSearch" class="ginput" placeholder="Search players…" autocomplete="off"><div class="gift-results" id="tPlayers"></div>');
    wireTradeNav();
    el('tSearch').addEventListener('input', (e) => { clearTimeout(giftSearchTimer); const q = e.target.value; giftSearchTimer = setTimeout(() => tradeLoadPlayers(q), 250); });
    el('tPlayers').addEventListener('click', (e) => {
      const row = e.target.closest?.('.gift-row');
      if (row) { trade.toId = row.dataset.id; trade.toName = row.dataset.name; trade.step = 2; renderTradeStep(); }
    });
    tradeLoadPlayers('');
    el('tSearch').focus();
  } else if (trade.step === 2) {
    t.innerHTML = tradeShell(`Trade with ${esc(trade.toName)} · your card`, '<div class="tgrid" id="tMine"><div class="loading">Loading…</div></div>');
    wireTradeNav();
    const data = await api('/api/collection');
    trade.mine = data.cards || [];
    el('tMine').innerHTML = trade.mine.length ? trade.mine.map((c, i) => tradeTile(c, i)).join('') : '<p class="empty small">You have no cards to trade.</p>';
    el('tMine').addEventListener('click', (e) => {
      const tile = e.target.closest?.('.ttile');
      if (tile) { trade.myCard = trade.mine[Number(tile.dataset.i)]; trade.step = 3; renderTradeStep(); }
    });
  } else if (trade.step === 3) {
    const c = trade.myCard;
    const giftable = c.tradeable && c.rarity !== 'gold';
    t.innerHTML = tradeShell(`Give ${esc(c.name)}?`,
      `<div class="tchosen">${tradeTile(c, 'x', true)}</div>
       ${!c.tradeable ? '<p class="empty small">This card is locked — it cannot be traded or gifted.</p>' : `
       <div class="tactions">
         ${giftable ? '<button class="open-btn" id="tGift">Gift it (no return)</button>' : '<p class="empty small">Gold cards can only be swapped, not gifted.</p>'}
         <button class="open-btn alt" id="tReq">Request a card back</button>
       </div>`}
       <div class="gift-msg" id="tMsg"></div>`);
    wireTradeNav();
    if (el('tGift')) el('tGift').onclick = doGift;
    if (el('tReq')) el('tReq').onclick = () => { trade.step = 4; renderTradeStep(); };
  } else if (trade.step === 4) {
    const c = trade.myCard;
    const label = RARITY_LABEL[c.rarity] || c.rarity;
    t.innerHTML = tradeShell(`Request a ${label} from ${esc(trade.toName)}`, '<div class="tgrid" id="tTheirs"><div class="loading">Loading…</div></div><div class="gift-msg" id="tMsg"></div>');
    wireTradeNav();
    const data = await api(`/api/player-cards?id=${encodeURIComponent(trade.toId)}`);
    trade.theirs = (data.cards || []).filter((x) => x.rarity === c.rarity && x.tradeable);
    el('tTheirs').innerHTML = trade.theirs.length ? trade.theirs.map((x, i) => tradeTile(x, i)).join('') : `<p class="empty small">${esc(trade.toName)} has no tradeable ${label} cards.</p>`;
    el('tTheirs').addEventListener('click', (e) => { const tile = e.target.closest?.('.ttile'); if (tile) doOffer(trade.theirs[Number(tile.dataset.i)]); });
  }
}

async function tradeLoadPlayers(q) {
  const box = el('tPlayers');
  if (!box) return;
  try {
    const d = await api(`/api/players?q=${encodeURIComponent(q)}`);
    const ps = d.players || [];
    box.innerHTML = ps.length
      ? ps.map((p) => `<div class="gift-row" data-id="${p.id}" data-name="${esc(p.username)}"><span class="gift-name">${esc(p.username)}</span><button class="gift-send">Pick</button></div>`).join('')
      : '<p class="empty small">No players found.</p>';
  } catch { box.innerHTML = '<p class="empty small">Could not load players.</p>'; }
}

async function doGift() {
  const msg = el('tMsg');
  const btn = el('tGift');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await apiPost('/api/trade/gift', { toId: trade.toId, cardId: trade.myCard.id });
    if (r.ok) { SFX.play('page'); if (msg) msg.textContent = `🎁 Gave ${trade.myCard.name} to ${trade.toName}!`; cache.collection = null; cache.catalog = null; setTimeout(closeTrade, 1100); }
    else { if (msg) msg.textContent = 'Could not gift — this copy may be reserved in a pending trade.'; if (btn) { btn.disabled = false; btn.textContent = 'Gift it (no return)'; } }
  } catch { if (msg) msg.textContent = 'Could not gift right now.'; if (btn) { btn.disabled = false; btn.textContent = 'Gift it (no return)'; } }
}

async function doOffer(theirCard) {
  const msg = el('tMsg');
  try {
    const r = await apiPost('/api/trade/offer', { toId: trade.toId, offerCardId: trade.myCard.id, requestCardId: theirCard.id });
    if (r.ok) { SFX.play('page'); if (msg) msg.textContent = `Offer sent to ${trade.toName}!`; refreshTradeBadge(); setTimeout(() => { closeTrade(); if (currentView === 'trading') renderTrading(); }, 1100); }
    else if (msg) msg.textContent = 'Could not send — this copy may already be reserved in another trade.';
  } catch { if (msg) msg.textContent = 'Could not send right now.'; }
}

function updateTradeBadge(n) {
  const btn = document.querySelector('#nav button[data-view="trading"]');
  if (!btn) return;
  let b = btn.querySelector('.navbadge');
  if (n > 0) { if (!b) { b = document.createElement('span'); b.className = 'navbadge'; btn.appendChild(b); } b.textContent = n; }
  else if (b) b.remove();
}
async function refreshTradeBadge() { try { const d = await api('/api/trades'); updateTradeBadge((d.incoming || []).length); } catch { /* ignore */ } }

// ---- 3D card viewer (ported from the public gallery) -----------------------
// DRAG to pivot, CLICK to flip, and the foil SHINES as you tilt it.
let rx = 0, ry = 0, hoverX = 0, hoverY = 0;
let dragging = false, lx = 0, ly = 0, moved = false;
const LEAN = 16;

function applyView() {
  const card3d = el('card3d');
  const ex = rx + hoverX;
  const ey = ry + hoverY;
  card3d.style.transform = `rotateX(${ex}deg) rotateY(${ey}deg)`;
  const y = (((ey % 360) + 360) % 360);
  const showingBack = y > 90 && y < 270;
  document.querySelector('.card3d .front').style.opacity = showingBack ? '0' : '1';
  document.querySelector('.card3d .back').style.opacity = showingBack ? '1' : '0';
  const dev = y > 180 ? y - 360 : y;
  const nx = Math.max(-1, Math.min(1, dev / 45));
  const ny = Math.max(-1, Math.min(1, ex / 45));
  card3d.style.setProperty('--hx', (50 + nx * 55) + '%');
  card3d.style.setProperty('--hy', (50 + ny * 55) + '%');
  card3d.style.setProperty('--gx', (50 + nx * 45) + '%');
  card3d.style.setProperty('--gy', (50 - ny * 45) + '%');
  const mag = Math.min(1, Math.hypot(nx, ny));
  card3d.style.setProperty('--holo-opacity', (0.16 + mag * 0.6).toFixed(3));
}

// You only see full art of cards you OWN. Unowned cards (gallery-locked, or any
// card opened from the community feed) show a blurred, greyed front with the
// flavor text hidden — you can tell the art is cool, but not make it out.
function openViewer(card) {
  const locked = !!card.locked;
  el('v-front').src = card.image_url || '';
  el('v-back').src = cardBack;
  el('v-subject').textContent = card.subject || '';
  el('v-name').textContent = card.name || '';
  const badge = el('v-badge');
  badge.textContent = RARITY_LABEL[card.rarity] || card.rarity;
  badge.className = 'badge ' + card.rarity;
  el('v-season').textContent = card.season || 'Season 1';
  el('v-event').textContent = card.event || '';
  el('v-event-row').classList.toggle('hidden', !card.event);
  el('v-rarity').textContent = RARITY_LABEL[card.rarity] || card.rarity;
  el('v-lore').textContent = locked ? '' : (card.lore ? `“${card.lore}”` : '');
  el('v-artist').textContent = locked ? 'Not in your collection yet' : (card.artist ? `Art by ${card.artist}` : '');
  fillViewerAbility(card.ability);
  fillViewerTags(card.tags);
  el('card3d').classList.toggle('locked', locked);
  el('card3d').classList.toggle('holo-on', !locked && card.rarity !== 'normal'); // normal = no foil; locked = hidden
  renderAscension(card);
  rx = 0; ry = 0; hoverX = 0; hoverY = 0; applyView();
  el('viewer').classList.remove('hidden');
  enableGyro();
}

// The Ability section of the card viewer (name, plain-words effect, meta).
function fillViewerAbility(ab) {
  const box = el('v-ability');
  if (!ab || !ab.name) { box.classList.add('hidden'); return; }
  el('v-ability-name').textContent = ab.name;
  el('v-ability-desc').textContent = ab.desc || '';
  const meta = [];
  if (ab.kind) meta.push(ab.kind);
  if (ab.effect) meta.push(ab.effect);
  if (ab.target) meta.push(`target: ${ab.target}`);
  if (ab.cooldown != null && ab.cooldown !== '') meta.push(`cooldown: ${ab.cooldown}`);
  el('v-ability-meta').textContent = meta.join(' · ');
  box.classList.remove('hidden');
}

// The Tags section of the card viewer, grouped by facet.
const V_TAG_FACETS = [['class', 'Class'], ['type', 'Type'], ['origin', 'Origin'], ['genre', 'Genre'], ['realm', 'Realm'], ['traits', 'Traits']];
function fillViewerTags(tags) {
  const box = el('v-tags');
  const has = tags && V_TAG_FACETS.some(([f]) => tags[f] && (Array.isArray(tags[f]) ? tags[f].length : tags[f]));
  if (!has) { box.classList.add('hidden'); return; }
  el('v-tag-rows').innerHTML = V_TAG_FACETS
    .filter(([f]) => tags[f] && (Array.isArray(tags[f]) ? tags[f].length : tags[f]))
    .map(([f, label]) => {
      const vals = Array.isArray(tags[f]) ? tags[f] : [tags[f]];
      return `<div class="v-tag-row"><span class="v-tag-facet">${label}</span><span class="v-tag-chips">${vals.map((v) => `<span class="v-chip">${esc(v)}</span>`).join('')}</span></div>`;
    }).join('');
  box.classList.remove('hidden');
}

function closeViewer() { el('viewer').classList.add('hidden'); }

// Ascension panel in the viewer — only for owned collection cards with the flag on.
function renderAscension(card) {
  const box = el('v-asc');
  const show = features.ascension && !card.locked && typeof card.ascension === 'number';
  box.classList.toggle('hidden', !show);
  const c3 = el('card3d');
  c3.className = c3.className.replace(/\b(asc-\d|atier-\d|asc-pop)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!show) return;
  const a = card.ascension || 0;
  el('v-stars').textContent = '★'.repeat(a) + '☆'.repeat(5 - a);
  el('v-power').textContent = `Power ${card.power}`;
  if (a > 0) c3.classList.add(`atier-${a}`); // the viewer card wears its tier ring + glow
  const btn = el('v-ascend');
  const note = el('v-asc-note');
  if (a >= 5) {
    btn.classList.add('hidden');
    note.textContent = 'Max ascension ★5';
    return;
  }
  btn.classList.remove('hidden');
  btn.textContent = `Ascend to ★${a + 1} · uses ${card.next_cost}`;
  btn.disabled = !card.can_ascend;
  const spare = Math.max(0, (card.quantity || 0) - 1);
  note.textContent = card.can_ascend
    ? `${spare} spare duplicate${spare === 1 ? '' : 's'} — ${spare - card.next_cost} left after`
    : `Need ${card.next_cost} spare duplicate${card.next_cost === 1 ? '' : 's'} (you have ${spare})`;
  btn.onclick = () => ascendCard(card);
}

async function ascendCard(card) {
  const btn = el('v-ascend');
  const note = el('v-asc-note');
  btn.disabled = true;
  try {
    const r = await apiPost('/api/ascend', { cardId: card.id });
    if (!r || !r.ok) {
      note.textContent = r?.error === 'need_more' ? `Need ${r.need - r.have} more duplicate(s)` : (r?.error || 'Could not ascend');
      btn.disabled = false;
      return;
    }
    card.ascension = r.ascension; card.quantity = r.quantity; card.power = r.power; card.next_cost = r.next_cost;
    card.can_ascend = r.next_cost != null && r.quantity >= 1 + r.next_cost;
    await refreshOwned();
    if (currentView === 'collection') paintPage('collection');
    updatePower();
    renderAscension(card);
    playAscend(r.ascension); // celebrate reaching the new tier on the card viewer
  } catch {
    note.textContent = 'Could not ascend';
    btn.disabled = false;
  }
}

// The five ascension tiers and their celebration colors (match the baked flair).
const ASC_TIERS = {
  1: { name: 'Normal', c1: '#e6edf6', c2: '#aab6c4' },
  2: { name: 'Bronze', c1: '#ffbe6e', c2: '#b5642a' },
  3: { name: 'Silver', c1: '#eef4fb', c2: '#93a1af' },
  4: { name: 'Gold', c1: '#ffe08a', c2: '#d9a016' },
  5: { name: 'Prestige', c1: '#ffd23e', c2: '#b45ad8' },
};

// Celebration on the Card Viewer when a card ascends to a new tier: a tier-colored
// flash + expanding rings + a shower of particles + the tier name, and a bright
// power-up pulse on the card. The card also takes on its persistent tier ring.
function playAscend(tier) {
  const stage = el('viewer-stage');
  if (!stage) return;
  const info = ASC_TIERS[tier] || ASC_TIERS[1];
  stage.style.setProperty('--c1', info.c1);
  stage.style.setProperty('--c2', info.c2);
  const card = el('card3d');
  card.classList.remove('asc-pop'); void card.offsetWidth; card.classList.add('asc-pop');
  const fx = document.createElement('div');
  fx.className = 'asc-fx';
  fx.innerHTML = '<div class="asc-flash"></div><div class="asc-ring"></div><div class="asc-ring d2"></div>';
  stage.appendChild(fx);
  const r = stage.getBoundingClientRect();
  const cx = r.width / 2, cy = r.height / 2;
  for (let i = 0; i < 22; i += 1) {
    const p = document.createElement('div');
    p.className = 'asc-particle';
    const ang = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 140;
    p.style.left = `${cx}px`; p.style.top = `${cy}px`;
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
    p.style.animationDelay = `${(Math.random() * 0.25).toFixed(2)}s`;
    stage.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }
  SFX?.play?.('rare');
  setTimeout(() => { card.classList.remove('asc-pop'); fx.remove(); }, 1900);
}

function initViewer() {
  const stage = el('viewer-stage');
  stage.addEventListener('dragstart', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    hoverX = 0; hoverY = 0;
    el('card3d').classList.add('dragging');
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      ry += dx * 0.6;
      rx = Math.max(-80, Math.min(80, rx - dy * 0.6));
      lx = e.clientX; ly = e.clientY;
      applyView();
    } else {
      const r = stage.getBoundingClientRect();
      hoverX = -(((e.clientY - r.top) / r.height) - 0.5) * 2 * LEAN;
      hoverY = (((e.clientX - r.left) / r.width) - 0.5) * 2 * LEAN;
      applyView();
    }
  });
  stage.addEventListener('pointerup', () => {
    dragging = false;
    el('card3d').classList.remove('dragging');
    if (!moved) { ry += 180; applyView(); } // a click (no drag) flips the card
  });
  stage.addEventListener('pointerleave', () => { hoverX = 0; hoverY = 0; applyView(); });

  el('viewer-close').onclick = closeViewer;
  el('viewer').addEventListener('click', (e) => { if (e.target === el('viewer')) closeViewer(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('viewer').classList.contains('hidden')) closeViewer();
    else if (!el('stage').classList.contains('hidden')) endReveal();
    else if (!el('trade').classList.contains('hidden')) closeTrade();
    else if (!el('gift').classList.contains('hidden')) closeGiftPanel();
    else if (!el('notif').classList.contains('hidden')) closeNotifs();
    else if (!el('board').classList.contains('hidden')) closeBoard();
  });

  // Click a card anywhere → open it in the viewer.
  el('main').addEventListener('click', (e) => {
    const c = e.target.closest?.('.c[data-idx]');
    if (c) { const it = mainItems[Number(c.dataset.idx)]; if (it) openViewer(it); }
  });
  // Feed cards: you see full art of cards you OWN; unowned ones open blurred.
  // The small sidebar thumbnail stays visible as-is either way.
  el('feed').addEventListener('click', (e) => {
    const r = e.target.closest?.('.frow[data-idx]');
    if (r) { const it = live.pulls[Number(r.dataset.idx)]; if (it) openViewer({ ...it, locked: !myCardIds.has(it.id) }); }
  });
  // Reveal cards: a face-down card flips on tap; a revealed card opens the viewer.
  // NOTE: a stray click on the backdrop must NOT close the reveal (you'd lose the
  // last cards) — exit only via the Back button or Escape.
  el('stage').addEventListener('click', (e) => {
    const fc = e.target.closest?.('.fc[data-idx]');
    if (!fc) return;
    const it = revealItems[Number(fc.dataset.idx)];
    if (!it) return;
    if (fc.classList.contains('flipped')) openViewer(it);
    else flipCard(fc, it);
  });
}

// Phone gyroscope: tilt the device to lean the card (the "hold a real foil" feel).
let gyroOn = false;
function onOrient(e) {
  if (e.gamma == null && e.beta == null) return;
  if (dragging) return;
  hoverY = Math.max(-LEAN, Math.min(LEAN, e.gamma || 0));
  hoverX = Math.max(-LEAN, Math.min(LEAN, (e.beta || 0) - 40));
  applyView();
}
function enableGyro() {
  if (gyroOn) return;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((s) => { if (s === 'granted') { window.addEventListener('deviceorientation', onOrient); gyroOn = true; } }).catch(() => {});
  } else {
    window.addEventListener('deviceorientation', onOrient); gyroOn = true;
  }
}

// Re-fit the paginated grid when the Discord window resizes.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentView === 'collection') paintPage('collection');
    else if (currentView === 'gallery') paintGalleryPage();
  }, 150);
});

el('nav').addEventListener('click', (e) => {
  const v = e.target?.dataset?.view;
  if (v) show(v);
});

initViewer();
main().catch((e) => {
  console.error(e);
  loaderMsg('Something went wrong: ' + (e?.message || e));
  setStatus('Something went wrong: ' + (e?.message || e));
});
