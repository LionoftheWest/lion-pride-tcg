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
import { BOSS_LIST, seedForBoss, thumbFor } from './boss-meta.js';
import { cardElement, ELEMENTS } from './elements.js';

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
      loadSamples();
    } catch { ctx = null; }
    return ctx;
  }
  // Real recorded attack sounds (public/sfx/<element>.mp3). Fall back to the
  // synthesized slot below until a sample finishes decoding.
  const ELEMENT_SFX = ['fire', 'water', 'lightning', 'ice', 'nature', 'earth', 'air', 'shadow', 'light', 'arcane', 'psychic', 'toxic', 'metal', 'physical'];
  const BOSS_SFX = ['curse', 'defeat', 'enrage', 'slam', 'strike', 'stunned'];
  const MON_SFX = ['roar1', 'roar2', 'roar3', 'roar4', 'growl1', 'growl2', 'growl3'];
  const UI_SFX = ['tear', 'flip', 'page', 'rare', 'reveal', 'click'];
  const samples = {};
  let samplesLoading = false;
  function decodeInto(url, key) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => { samples[key] = audio; })
      .catch(() => {});
  }
  function loadSamples() {
    if (samplesLoading || !ctx) return;
    samplesLoading = true;
    for (const n of ELEMENT_SFX) decodeInto(`sfx/${n}.mp3`, n);
    for (const n of BOSS_SFX) decodeInto(`sfx/boss/${n}.mp3`, `boss:${n}`);
    for (const n of MON_SFX) decodeInto(`sfx/monster/${n}.mp3`, `mon:${n}`);
    // UI sounds override the synthesized slots of the same name (tear/flip/page/rare),
    // plus 'reveal' (cards spill out) and 'click' (open a card).
    for (const n of UI_SFX) decodeInto(`sfx/ui/${n}.mp3`, n);
  }
  const active = new Set(); // playing sample sources, so we can cut them when leaving battle
  function playSample(name, peak = 0.9, maxDur = 2.5) {
    if (!samples[name]) return false;
    const src = ctx.createBufferSource();
    src.buffer = samples[name];
    const g = ctx.createGain();
    g.gain.value = peak;
    src.connect(g).connect(master);
    active.add(src);
    src.onended = () => active.delete(src);
    src.start();
    if (maxDur) { try { src.stop(ctx.currentTime + maxDur); } catch {} } // cap length so long clips can't overrun
    return true;
  }
  function stopAllSamples() { for (const s of active) { try { s.stop(); } catch {} } active.clear(); }
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
    // Per-element attack sounds, synthesized to match each 3D effect.
    fire: () => { swish({ dur: 0.6, f0: 180, f1: 900, q: 0.7, peak: 0.5 }); tone({ freq: 90, type: 'sawtooth', dur: 0.5, peak: 0.25, glide: 60 }); },
    water: () => { swish({ dur: 0.5, f0: 300, f1: 1500, q: 0.8, peak: 0.45 }); tone({ freq: 420, type: 'sine', dur: 0.4, peak: 0.2, glide: 160 }); },
    lightning: () => { swish({ dur: 0.12, f0: 2000, f1: 5000, q: 1.4, peak: 0.5 }); tone({ freq: 1800, type: 'square', dur: 0.08, peak: 0.3, glide: 400 }); setTimeout(() => swish({ dur: 0.25, f0: 800, f1: 3000, q: 1, peak: 0.3 }), 40); },
    ice: () => { [1400, 1900, 2500].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.3, peak: 0.22 }), i * 60)); swish({ dur: 0.3, f0: 1200, f1: 3400, q: 1.2, peak: 0.3 }); },
    nature: () => { swish({ dur: 0.5, f0: 400, f1: 1400, q: 0.7, peak: 0.35 }); tone({ freq: 260, type: 'sine', dur: 0.4, peak: 0.18, glide: 380 }); },
    earth: () => { tone({ freq: 70, type: 'sine', dur: 0.6, peak: 0.5, glide: 40 }); swish({ dur: 0.5, f0: 120, f1: 500, q: 0.6, peak: 0.4 }); },
    air: () => swish({ dur: 0.6, f0: 500, f1: 2600, q: 0.5, peak: 0.4 }),
    shadow: () => { swish({ dur: 0.6, f0: 200, f1: 700, q: 0.8, peak: 0.4 }); tone({ freq: 300, type: 'sine', dur: 0.6, peak: 0.22, glide: 90 }); },
    light: () => { [784, 1047, 1319, 1568].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sine', dur: 0.5, peak: 0.24 }), i * 70)); swish({ dur: 0.35, f0: 1500, f1: 3800, q: 0.9, peak: 0.28 }); },
    arcane: () => { [880, 1175, 1397].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.45, peak: 0.22 }), i * 80)); swish({ dur: 0.3, f0: 1000, f1: 2600, q: 1, peak: 0.24 }); },
    psychic: () => { tone({ freq: 600, type: 'sine', dur: 0.5, peak: 0.26, glide: 900 }); tone({ freq: 520, type: 'sine', dur: 0.5, peak: 0.2, glide: 300 }); },
    toxic: () => { swish({ dur: 0.45, f0: 150, f1: 800, q: 0.9, peak: 0.4 }); tone({ freq: 140, type: 'square', dur: 0.3, peak: 0.2, glide: 70 }); },
    metal: () => { tone({ freq: 2400, type: 'square', dur: 0.18, peak: 0.3, glide: 1600 }); tone({ freq: 3200, type: 'sine', dur: 0.5, peak: 0.18 }); swish({ dur: 0.2, f0: 1800, f1: 4200, q: 1.4, peak: 0.3 }); },
    physical: () => { tone({ freq: 80, type: 'sine', dur: 0.22, peak: 0.5, glide: 45 }); swish({ dur: 0.18, f0: 200, f1: 900, q: 0.8, peak: 0.35 }); },
  };
  const api = {
    play(name) { if (muted || !ensure()) return; if (ctx.state === 'suspended') ctx.resume(); try { if (playSample(name)) return; slots[name] && slots[name](); } catch {} },
    sample(key, peak) { if (muted || !ensure()) return false; if (ctx.state === 'suspended') ctx.resume(); try { return playSample(key, peak); } catch { return false; } },
    playBoss(kind) { return api.sample(`boss:${kind}`, 0.85); },
    stopAll() { stopAllSamples(); },
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    toggle() { muted = !muted; try { localStorage.setItem('lp_muted', muted ? '1' : '0'); } catch {} if (master) master.gain.value = muted ? 0 : 0.55; Music.syncMute(); return muted; },
    muted: () => muted,
  };
  return api;
})();

// Battle background music — cycles the 4 tracks while the player is in a fight.
// All tracks are preloaded so the hand-off between songs is instant (no load gap).
const Music = (() => {
  const TRACKS = ['sfx/music/battle1.mp3', 'sfx/music/battle2.mp3', 'sfx/music/battle3.mp3', 'sfx/music/battle4.mp3'];
  let els = null, i = 0, on = false;
  function ensure() {
    if (!els) {
      els = TRACKS.map((src) => { const a = new Audio(src); a.volume = 0.24; a.preload = 'auto'; try { a.load(); } catch {} return a; });
      els.forEach((a, idx) => a.addEventListener('ended', () => { if (!on) return; i = (idx + 1) % els.length; playCurrent(); }));
    }
    return els;
  }
  function playCurrent() { ensure(); const a = els[i]; try { a.currentTime = 0; } catch {} if (on && !SFX.muted()) a.play().catch(() => {}); }
  return {
    start() { if (on) return; on = true; ensure(); i = Math.floor(Math.random() * els.length); playCurrent(); },
    stop() { on = false; if (els) els.forEach((a) => a.pause()); },
    syncMute() { if (!els) return; if (SFX.muted() || !on) els.forEach((a) => a.pause()); else playCurrent(); },
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
const squad = { page: 0, q: '', rarity: 'all', type: 'all', locked: false, ko: false }; // battle picker (gallery-style)
let usedIds = new Set(); // card ids already sent at the boss today (client mirror of the cap)
let feedTopId = 0; // newest boss-feed event id shown (so polls only animate in newer ones)
let huntDay = ''; // UTC date of the current hunt render; a change means the daily reset hit
const utcToday = () => new Date().toISOString().slice(0, 10);
window.addEventListener('resize', () => { if (currentView === 'battling') sizeSquadGrid(); });
const cache = {};
let myCardIds = new Set(); // card ids the caller owns — so feed cards you own show their art
const page = { collection: 0 };
// Gallery view controls (search / filter / which season is expanded).
// `section` is the Gallery sub-tab: 'cards' (the collection catalog) or 'bosses'
// (the raid-boss bestiary). Add more entries to GAL_SECTIONS to grow it.
const gallery = { q: '', rarity: 'all', owned: 'all', season: null, page: 0, section: 'cards' };
const GAL_SECTIONS = [['cards', 'Cards'], ['bosses', 'Raid Bosses']];

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
  el('openTop')?.addEventListener('click', openPacks); // Open Pack button by the brand title
  el('bossMini')?.addEventListener('click', (e) => { if (e.target.closest('.mb-stage')) openBossModal(); }); // click the boss -> detail
  el('bossModalClose')?.addEventListener('click', closeBossModal);
  el('bossModal')?.addEventListener('click', (e) => { if (e.target === el('bossModal')) closeBossModal(); });
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
  const btn = el('openTop'); // the Open Pack button lives up by the brand title now
  if (!btn) return;
  if (packsAvailable > 0) {
    btn.textContent = `🎴 Open Pack${packsAvailable > 1 ? ` ×${packsAvailable}` : ''}`;
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
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
  stopMonsterIdle();
  Music.stop();
  SFX.stopAll(); // cut any attack/boss sound still playing when the battle screen closes
}

// Each monster gets its own randomized "voice" (roars + growls) from the shared
// ambient pool, seeded by name so the same boss sounds consistent across the week.
let bossVoice = null;
let monsterIdle = null;
const _ROARS = ['roar1', 'roar2', 'roar3', 'roar4'];
const _GROWLS = ['growl1', 'growl2', 'growl3'];
function hashStr(s) { s = String(s || 'boss'); let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function pickBossVoice(name) { const h = hashStr(name); return { roar: _ROARS[h % _ROARS.length], growls: [_GROWLS[h % _GROWLS.length], _GROWLS[(h >> 4) % _GROWLS.length]] }; }
function bossGrowl(peak) { if (!bossVoice) return; const g = bossVoice.growls[Math.floor(Math.random() * bossVoice.growls.length)]; SFX.sample(`mon:${g}`, peak == null ? 0.45 : peak); }
function startMonsterIdle() { stopMonsterIdle(); monsterIdle = setInterval(() => { if (currentView === 'battling' && squad.phase === 'battle') bossGrowl(0.24); }, 8000 + Math.random() * 4000); }
function stopMonsterIdle() { if (monsterIdle) { clearInterval(monsterIdle); monsterIdle = null; } }

// Build the seeded creature into the battle-screen canvas (WebGL). Fails silently
// if the webview has no WebGL — the rest of the screen still works.
function mountBossFor(hunt) {
  if (window.__NO_BOSS__) return; // TEMP: skip the WebGL boss to test the card-render bug
  const cv = el('bossCanvas');
  if (!cv || !hunt) return;
  try {
    bossHandle = mountBoss(cv, hunt.name || 'boss', hunt.tier);
    bossVoice = pickBossVoice(hunt.name || hunt.id);
    if (hunt.status === 'defeated' || hunt.hp_remaining <= 0) {
      bossHandle.defeat();
    } else if (squad.phase === 'battle') {
      // Boss ambient + music only during the ACTIVE fight (post Lock In), never in squad select.
      setTimeout(() => { if (squad.phase === 'battle') SFX.sample(`mon:${bossVoice.roar}`, 0.7); }, 320); // spawn roar
      Music.start();
      startMonsterIdle();
    }
  } catch (e) { bossHandle = null; }
}

function renderMain(view) {
  disposeBoss(); // any view change tears the boss down; renderHunt re-mounts it
  { const bm = el('bossMini'); if (bm) bm.innerHTML = ''; } // clear the sidebar boss square
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
  const sectionTabs = `<div class="gal-sections">${GAL_SECTIONS
    .map(([v, l]) => `<button class="gsec${gallery.section === v ? ' active' : ''}" data-section="${v}">${l}</button>`).join('')}</div>`;
  // The card filters only make sense in the Cards section; the Raid Bosses
  // section is a fixed bestiary, so it shows just the section tabs.
  const cardControls = gallery.section === 'cards'
    ? `<input id="gsearch" class="ginput" placeholder="Search cards…" value="${esc(gallery.q)}">
       <select id="gfilter" class="gselect">${rarityOpts}</select>
       <select id="gowned" class="gselect">${ownedOpts}</select>
       ${seasonSel}`
    : '';
  el('main').innerHTML =
    mainHead('Gallery') +
    `<div class="gal-controls">${sectionTabs}${cardControls}</div>
     <div class="main-body">
       <div class="gal-bar" id="galBar"></div>
       <div class="page-grid" id="pageGrid"></div>
       <div class="pager" id="pager"></div>
     </div>`;
  updateOpenButton();
  el('main').querySelectorAll('.gsec').forEach((btn) => btn.addEventListener('click', () => {
    if (gallery.section === btn.dataset.section) return;
    gallery.section = btn.dataset.section; gallery.page = 0; renderGallery();
  }));
  if (gallery.section === 'cards') {
    el('gsearch').addEventListener('input', (e) => { gallery.q = e.target.value; gallery.page = 0; paintGalleryPage(); });
    el('gfilter').addEventListener('change', (e) => { gallery.rarity = e.target.value; gallery.page = 0; paintGalleryPage(); });
    el('gowned').addEventListener('change', (e) => { gallery.owned = e.target.value; gallery.page = 0; paintGalleryPage(); });
    const gs = el('gseason');
    if (gs) gs.addEventListener('change', (e) => { gallery.season = e.target.value; gallery.page = 0; paintGalleryPage(); });
  }
  paintGalleryPage();
}

function paintGalleryPage(dir) {
  const grid = el('pageGrid');
  if (!grid) return;
  if (gallery.section === 'bosses') { paintBossGrid(dir); return; }
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

// ---- Raid Boss bestiary (a Gallery section) --------------------------------
// A no-scroll paged grid of boss thumbnails, reusing the card grid machinery.
// Clicking a boss opens the shared boss viewer (#bossModal) with the live model.
function bossTile(b, idx) {
  return `<div class="c boss-tile" data-boss="${idx}">
    <div class="art"><img src="${thumbFor(b)}" alt="${esc(b.title)}" loading="lazy"></div>
    <div class="cap">${esc(b.title)}</div>
  </div>`;
}
function paintBossGrid(dir) {
  const grid = el('pageGrid');
  if (!grid) return;
  const items = BOSS_LIST;
  const bar = el('galBar');
  if (bar) bar.innerHTML = `<span class="gs-name">Raid Bosses</span><span class="gs-count">${items.length}</span>`;
  const perPage = computeLayout(grid);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  gallery.page = Math.min(Math.max(0, gallery.page), pages - 1);
  const start = gallery.page * perPage;
  const slice = items.slice(start, start + perPage);
  mainItems = []; // boss tiles use data-boss, not the card-viewer data-idx path
  grid.innerHTML = slice.map((b, i) => bossTile(b, start + i)).join('');
  gridAnim(grid, dir);
  galleryPager(pages);
}

function galleryPager(pages) {
  const pager = el('pager');
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ''; return; }
  const p = gallery.page;
  pager.innerHTML =
    `<button class="parrow" id="prev" ${p === 0 ? 'disabled' : ''}>‹</button>
     <span class="pcount">${p + 1} of ${pages}</span>
     <button class="parrow" id="next" ${p >= pages - 1 ? 'disabled' : ''}>›</button>`;
  el('prev').addEventListener('click', () => { gallery.page -= 1; paintGalleryPage('prev'); });
  el('next').addEventListener('click', () => { gallery.page += 1; paintGalleryPage('next'); });
}

function renderPager(view, pages) {
  const pager = el('pager');
  if (!pager) return;
  if (pages <= 1) { pager.innerHTML = ''; return; }
  const p = page[view];
  pager.innerHTML =
    `<button class="parrow" id="prev" ${p === 0 ? 'disabled' : ''}>‹</button>
     <span class="pcount">${p + 1} of ${pages}</span>
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
       <button class="reveal-close hidden" id="revealDone">Done</button>
     </div>`;
  el('reactBar').addEventListener('click', (e) => {
    const emoji = e.target?.dataset?.emoji;
    if (emoji && roomWs && roomWs.readyState === 1) roomWs.send(JSON.stringify({ type: 'react', emoji }));
  });
  el('revealDone').addEventListener('click', endReveal); // only shown once every card is revealed
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
  if (rare) setTimeout(() => { sunRays(stage); packSparkles(); }, 900); // rare sound waits for the actual rare flip
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
    SFX.play('reveal'); // cards spill out of the opened pack
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
    if (p) p.textContent = ''; // no subtitle once everything is revealed
    const done = el('revealDone');
    if (done) done.classList.remove('hidden'); // now they may leave
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
// Next UTC midnight — when the daily squad resets (one squad per day).
function nextUtcResetISO() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0)).toISOString();
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
  el('main').innerHTML = '<div class="main-body"><div class="loading">Summoning the hunt…</div></div>';
  let d;
  try { d = await api('/api/hunt'); } catch { d = null; }
  huntCache = d;
  paintHuntView(d);
}

// Render the whole battle view from a data object (boss + phase + boss canvas + feed).
function paintHuntView(d) {
  if (!d || !d.hunt) {
    el('main').innerHTML = `<div class="main-body">${cooldownHTML(d)}</div>`;
    renderBossMini(); // no active boss -> clears the sidebar square
    startHuntTicker(); // count down to the next spawn
    return;
  }
  huntState = d;
  huntDay = utcToday(); // remember the day so the ticker can detect the daily reset
  const saved = loadTeam(d.hunt.id);
  // A saved squad only holds while the server still shows committed cards. If the day's
  // squad was reset server-side (usedToday === 0), the device lock is stale — drop it and
  // return to squad selection so the player re-picks.
  // One squad per day: if every committed attacker is downed, the day's run is over.
  const committedAtk = (d.roster || []).filter((c) => c.used && ATTACKER_TYPES.includes(c.type));
  const koForDay = committedAtk.length > 0 && committedAtk.every((c) => c.downed);
  if (koForDay) {
    squad.phase = 'select'; squad.ko = true; squad.locked = false; squad.page = 0;
    squad.sel = new Set((d.roster || []).filter((c) => c.used).map((c) => c.id));
  } else if (saved && saved.length && (d.usedToday || 0) > 0) {
    squad.phase = 'battle'; squad.ko = false; squad.sel = new Set(saved);
  } else {
    if (saved) clearTeam(d.hunt.id);
    squad.phase = 'select'; squad.ko = false; squad.locked = false; squad.page = 0;
    squad.sel = new Set((d.roster || []).filter((c) => c.used).map((c) => c.id));
  }
  el('main').innerHTML = huntHTML(d); // no "Battling" head — more room for the picker/arena
  renderBossMini();     // sidebar boss square (holds #huntLbBtn + #bossCanvas in select/ko)
  wireHunt();           // wire after the square exists so the standings button binds
  mountBossFor(d.hunt); // spawn the live creature into the boss canvas (sidebar or arena)
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
  const base = `<span class="weaks">${parts.join(' · ') || 'No weakness'}</span>`;
  const pk = h.passive && h.passive.kind;
  const passive = pk ? `<span class="passive-chip" title="${esc(h.passive.label || '')}">☠ ${esc(pk.charAt(0).toUpperCase() + pk.slice(1))}</span>` : '';
  return base + passive;
}

function huntHTML(d) {
  const h = d.hunt;
  usedIds = new Set((d.roster || []).filter((c) => c.used).map((c) => c.id));
  // Battle phase = a full-bleed arena (boss fills the pane, squad overlays the bottom).
  if (squad.phase === 'battle') return `<div class="main-body hunt arena-mode">${battlePhaseHTML(d)}</div>`;
  // The boss now lives as a compact square atop the Raid Boss feed (right sidebar),
  // so the whole main pane is the squad picker.
  return `<div class="main-body hunt select-mode${squad.ko ? ' ko' : ''}">${selectPhaseHTML(d)}</div>`;
}

// Compact "raid boss live" square — rendered into the right sidebar during squad select.
function bossMiniHTML(d) {
  const h = d && d.hunt;
  if (!h) return '';
  const pct = Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max));
  const defeated = h.status === 'defeated' || h.hp_remaining <= 0;
  return `<div class="miniboss${defeated ? ' down' : ''}">
      <div class="mb-stage mb-open" id="mbStage" title="View boss details"><canvas id="bossCanvas"></canvas><span class="mb-expand">⤢</span></div>
      <div class="mb-info">
        <div class="mb-live"><span class="live-dot"></span>RAID BOSS LIVE</div>
        <div class="mb-name"><span class="boss-name">${esc(h.name)}</span><span class="boss-tier tier-${esc(h.tier.toLowerCase())}">${esc(h.tier)}</span></div>
        <div class="hpbar mini"><div class="hpfill" style="width:${pct}%"></div><span class="hptext" id="hpText">${defeated ? 'DEFEATED!' : `${h.hp_remaining.toLocaleString()} / ${h.hp_max.toLocaleString()} HP`}</span></div>
        <div class="mb-meta">${defeated ? '<span class="closes">DEFEATED</span>' : cdSpan(h.closes_at, 'Beat in', 'closes countdown')}<button class="hunt-lb" id="huntLbBtn">🏆 Standings</button></div>
      </div>
    </div>`;
}
// Fill (or clear) the sidebar boss square. Called on view/phase change only — NOT on
// feed polls — so the WebGL canvas is never torn out from under a live mount.
function renderBossMini() {
  const bm = el('bossMini');
  if (!bm) return;
  bm.innerHTML = (currentView === 'battling' && huntState && huntState.hunt && squad.phase !== 'battle') ? bossMiniHTML(huntState) : '';
}

// Boss detail popup: a big 3D view + full stats + move pool (generic for now).
let bossModalHandle = null;
const BOSS_MOVES = [
  ['Slam', 'A heavy ground smash for big damage'],
  ['Strike', 'A quick jab at your card'],
  ['Enrage', 'Powers up — harder hits for a few rounds'],
  ['Curse', 'Hexes a card so it hits softer'],
  ['Stunned', 'A support can rob it of a turn'],
];
function openBossModal() {
  const h = huntState && huntState.hunt;
  if (!h) return;
  const pct = Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max));
  const defeated = h.status === 'defeated' || h.hp_remaining <= 0;
  const chipList = (arr, cls) => (arr || []).map((w) => `<span class="${cls}">${esc(tagLabel(w.value))}</span>`).join(' ');
  const wk = chipList(h.weak_points, 'weak-chip');
  const rs = chipList(h.resist_points, 'resist-chip');
  const pk = h.passive && h.passive.kind;
  const passive = pk ? `<span class="passive-chip" title="${esc(h.passive.label || '')}">☠ ${esc(pk.charAt(0).toUpperCase() + pk.slice(1))}</span>` : '';
  el('bossModalInfo').innerHTML =
    `<div class="mb-live"><span class="live-dot"></span>RAID BOSS LIVE</div>
     <h2 class="bm-name"><span class="boss-name">${esc(h.name)}</span><span class="boss-tier tier-${esc(h.tier.toLowerCase())}">${esc(h.tier)}</span></h2>
     <div class="hpbar"><div class="hpfill" style="width:${pct}%"></div><span class="hptext">${defeated ? 'DEFEATED!' : `${h.hp_remaining.toLocaleString()} / ${h.hp_max.toLocaleString()} HP`}</span></div>
     <div class="bm-sec">
       <div class="bm-stat"><span class="bm-k">Weakness</span><span class="bm-v">${wk || '<span class="bm-none">None</span>'}</span></div>
       <div class="bm-stat"><span class="bm-k">Resistance</span><span class="bm-v">${rs || '<span class="bm-none">None</span>'}</span></div>
       ${passive ? `<div class="bm-stat"><span class="bm-k">Passive</span><span class="bm-v">${passive}</span></div>` : ''}
     </div>
     <div class="bm-sec"><div class="bm-sec-h">Move Pool</div><ul class="bm-moves">${BOSS_MOVES.map(([n, d]) => `<li><b>${n}</b> — ${d}</li>`).join('')}</ul></div>`;
  el('bossModal').classList.remove('hidden');
  try { bossModalHandle = mountBoss(el('bossModalCanvas'), h.name || 'boss', h.tier); if (defeated) bossModalHandle.defeat(); } catch (e) { bossModalHandle = null; }
}
function closeBossModal() {
  if (bossModalHandle) { try { bossModalHandle.dispose(); } catch (e) { /* ignore */ } bossModalHandle = null; }
  el('bossModal').classList.add('hidden');
}
// Gallery bestiary viewer: the same #bossModal, but showing a canonical model +
// its lore instead of a live hunt's stats. Reuses bossModalHandle + closeBossModal.
function openBossGallery(b) {
  if (!b) return;
  el('bossModalInfo').innerHTML =
    `<div class="mb-live gal-boss-tag">RAID BOSS</div>
     <h2 class="bm-name"><span class="boss-name">${esc(b.title)}</span></h2>
     <p class="v-lore">${esc(b.blurb || '')}</p>`;
  el('bossModal').classList.remove('hidden');
  try { bossModalHandle = mountBoss(el('bossModalCanvas'), seedForBoss(b), 'Mythic'); } catch (e) { bossModalHandle = null; }
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
    <div class="pager" id="huntPager"></div>
    <div class="squad-grid" id="huntGrid"></div>
    <div class="squad-panel">
      <div class="squad-toprow">
        <div class="squad-left">
          <div class="cp-big" id="cpBig"></div>
          <div class="squad-synergy" id="squadSynergy"></div>
        </div>
        <div class="squad-tray" id="squadTray"></div>
      </div>
      ${squad.ko ? `<div class="squad-foot ko">
        <div class="ko-note">💀 Your squad is down — one squad per day. Regroup at the reset.</div>
        <span class="enter-btn ko-cd">🔒 ${cdSpan(nextUtcResetISO(), 'Next battle in', 'countdown kores')}</span>
      </div>` : `<div class="squad-foot">
        <button class="autopick-btn" id="autoPickBtn">✨ Auto-pick</button>
        <button class="lockin-btn" id="lockInBtn" disabled>🔒 Lock In <b id="selCount">${squad.sel.size}</b>/${cap}</button>
        <button class="enter-btn" id="enterBattleBtn" disabled>Enter Battle ▶</button>
      </div>`}
    </div>`;
}

// The live synergy readout + the 8 squad slots, recomputed as the player picks.
const SYN_MAX = 5, SYN_MIN = 3; // a synergy is ACTIVE at 3 cards and maxes out at 5 (GAME_LABELS defined below, shared with the card viewer)
const titleCase = (s) => String(s || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
function computeSquadStats() {
  const roster = huntState?.roster || [];
  const sel = [...squad.sel].map((id) => roster.find((c) => c.id === id)).filter(Boolean);
  const attackers = sel.filter((c) => ATTACKER_TYPES.includes(c.type));
  const cp = attackers.reduce((s, c) => s + (c.power || 0), 0);
  const elem = {}, origin = {}, kind = {};
  for (const c of attackers) {
    const t = c.tags || {};
    const e = cardElement(t); if (e) elem[e] = (elem[e] || 0) + 1;
    if (t.origin) origin[t.origin] = (origin[t.origin] || 0) + 1;
    for (const tr of (Array.isArray(t.traits) ? t.traits : [])) {
      if (!cardElement([tr])) { const k = String(tr).toLowerCase(); kind[k] = (kind[k] || 0) + 1; } // element traits handled above
    }
  }
  const syn = [];
  for (const [e, n] of Object.entries(elem)) syn.push({ key: 'element', label: `${ELEMENTS[e]?.glyph || ''} ${titleCase(e)}`.trim(), n });
  for (const [o, n] of Object.entries(origin)) syn.push({ key: 'origin', label: GAME_LABELS[o] || titleCase(o), n });
  for (const [k, n] of Object.entries(kind)) syn.push({ key: 'trait', label: titleCase(k), n });
  syn.sort((a, b) => b.n - a.n);
  // Effective CP = raw power scaled by each card's synergy multiplier (mirrors the engine).
  const em = (n) => (n >= 5 ? 1.20 : n >= 3 ? 1.12 : 1);
  const om = (n) => (n >= 5 ? 1.18 : n >= 3 ? 1.10 : 1);
  const km = (n) => (n >= 5 ? 1.14 : n >= 3 ? 1.08 : 1);
  let effCp = 0;
  for (const c of attackers) {
    const t = c.tags || {};
    const e = cardElement(t);
    let kBest = 0;
    for (const tr of (Array.isArray(t.traits) ? t.traits : [])) { if (!cardElement([tr])) { const k = String(tr).toLowerCase(); if ((kind[k] || 0) > kBest) kBest = kind[k]; } }
    const mult = Math.min(1.6, em(e ? (elem[e] || 0) : 0) * om(t.origin ? (origin[t.origin] || 0) : 0) * km(kBest));
    effCp += (c.power || 0) * mult;
  }
  const weakHits = sel.filter((c) => c.matches).length;
  return { sel, cp, effCp: Math.round(effCp), syn, weakHits };
}
function paintSquadPanel(cap) {
  cap = cap || huntState?.dailyCap || 8;
  const st = computeSquadStats();
  const cpEl = el('cpBig');
  if (cpEl) {
    const boost = st.effCp > st.cp ? ` <span class="cp-boost">+${(st.effCp - st.cp).toLocaleString()}</span>` : '';
    cpEl.innerHTML = `<span class="cp-num">⚡ ${st.effCp.toLocaleString()}</span><span class="cp-lbl">TEAM CP${boost}</span>`;
  }
  const synEl = el('squadSynergy');
  if (synEl) {
    const chips = st.syn.filter((s) => s.n >= 2).map((s) => {
      const on = s.n >= SYN_MIN;
      return `<span class="syn-chip syn-${s.key}${on ? ' on' : ''}">${s.label} <b>${Math.min(s.n, SYN_MAX)}/${SYN_MAX}</b></span>`;
    }).join('');
    const weak = st.weakHits ? `<span class="syn-chip weakhit">×2 weakness · ${st.weakHits}</span>` : '';
    synEl.innerHTML = `${chips || '<span class="syn-none">Group cards by element, game, or trait for a synergy</span>'}${weak}`;
  }
  const tray = el('squadTray');
  if (tray) {
    let html = '';
    for (let i = 0; i < cap; i++) {
      const c = st.sel[i];
      if (c) {
        const supp = !ATTACKER_TYPES.includes(c.type);
        const eln = supp ? null : cardElement(c.tags);
        const look = eln ? ELEMENTS[eln] : null;
        html += `<div class="slot filled${eln ? ` el-${eln}` : ''}" data-id="${c.id}"${look ? ` style="--el:${look.color};--el2:${look.color2}"` : ''}>
          ${c.image_url ? `<img src="${c.image_url}" alt="">` : ''}<span class="slot-pow">${supp ? '🛡' : `⚡${c.power}`}</span><span class="slot-x">✕</span></div>`;
      } else {
        html += `<div class="slot empty">${i + 1}</div>`;
      }
    }
    tray.innerHTML = html;
  }
  // The synergy chips + tray change the panel height as you pick, which changes how much
  // room the gallery has — re-size the grid so both card rows always fit (no clipping).
  sizeSquadGrid();
}

// --- Phase 2: a full-bleed arena. Boss fills the pane; squad overlays the bottom. ---
function battlePhaseHTML(d) {
  const h = d.hunt;
  const pct = Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max));
  // weak + resist chips are rendered by weakResistHTML(h)
  const defeated = h.status === 'defeated' || h.hp_remaining <= 0;
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
  // The card type (Creature/Character/...) is intentionally NOT shown on the roster
  // tile — it covered the card name. It still shows in the Card Information view.
  // The card's ELEMENT (attackers only) tints the card + drives its attack visual.
  const elem = !support ? cardElement(c.tags) : null;
  const look = elem ? ELEMENTS[elem] : null;
  const elBadge = look ? `<span class="celem" title="${look.name}">${look.glyph}</span>` : '';
  const elStyle = look ? ` style="--el:${look.color};--el2:${look.color2}"` : '';
  return `<div class="${cls}${elem ? ` el-${elem}` : ''}" data-id="${c.id}" data-el="${elem || ''}" data-type="${esc(c.type || '')}" data-used="${usedIds.has(c.id) ? 1 : 0}" data-max="${max}"${elStyle} title="${ab ? esc(ab.name + ' — ' + (ab.desc || '')) : ''}">
    <div class="art">${c.image_url ? `<img src="${c.image_url}" alt="${esc(c.name)}" loading="lazy">` : ''}${elBadge}${c.matches && !support ? '<span class="x2">×2</span>' : ''}${shield}${overlay}<span class="tpow">${support ? '🛡' : `⚡${c.power}`}</span><button class="card-info" data-info="1" aria-label="Details">🔍</button></div>
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
    // Give the boss + the attack stage most of the pane — the hand is a compact
    // bottom strip (was 0.34 of the height; now ~0.24, capped smaller).
    const byHeight = (ah * 0.24 - capH) * 5 / 7;
    const sw = Math.max(52, Math.min(112, Math.floor(Math.min(byWidth, byHeight))));
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
  pager.innerHTML = `<button class="parrow" id="hprev" ${p === 0 ? 'disabled' : ''}>‹</button><span class="pcount">${p + 1} of ${pages}</span><button class="parrow" id="hnext" ${p >= pages - 1 ? 'disabled' : ''}>›</button>`;
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
    if (e.target.closest?.('.card-info')) { const cc = (huntState?.roster || []).find((x) => x.id === id); if (cc) openViewer(cc); return; } // inspect, don't select
    if (squad.ko) return; // squad down for the day — inspect only, no re-pick
    if (squad.sel.has(id)) { squad.sel.delete(id); node.classList.remove('selected'); }
    else {
      if (squad.sel.size >= cap) { const b = node.getBoundingClientRect(); calloutAt(b.left + b.width / 2, b.top + 18, `MAX ${cap}`, '#ff8f5c'); return; }
      squad.sel.add(id); node.classList.add('selected');
    }
    // refresh the check overlay on this tile
    const art = node.querySelector('.art');
    art.querySelector('.sel-check')?.remove();
    if (squad.sel.has(id)) { const s = document.createElement('span'); s.className = 'sel-check'; s.textContent = '✓'; art.appendChild(s); }
    onSquadChanged();
  });
  // Remove a card by tapping its slot in the squad tray.
  el('squadTray')?.addEventListener('click', (e) => {
    if (squad.ko) return; // squad locked for the day
    const slot = e.target.closest?.('.slot.filled'); if (!slot) return;
    const id = Number(slot.dataset.id);
    squad.sel.delete(id);
    const node = el('huntGrid')?.querySelector(`.c[data-id="${id}"]`);
    if (node) { node.classList.remove('selected'); node.querySelector('.sel-check')?.remove(); }
    onSquadChanged();
  });
  // Lock In commits the squad and UNLOCKS "Enter Battle" — it does not enter yet.
  el('lockInBtn')?.addEventListener('click', () => {
    if (squad.sel.size < 1) return;
    saveTeam(huntState.hunt.id, [...squad.sel]);
    squad.locked = true;
    const eb = el('enterBattleBtn'); if (eb) { eb.disabled = false; eb.classList.add('ready'); }
    el('lockInBtn')?.classList.add('locked');
    SFX?.play?.('flip');
  });
  // Enter Battle switches to the full arena scene (the boss + attacking).
  el('enterBattleBtn')?.addEventListener('click', () => {
    if (!squad.locked || squad.sel.size < 1) return;
    disposeBoss();
    squadDownShown = false;
    squad.phase = 'battle';
    SFX?.play?.('reveal');
    el('main').innerHTML = huntHTML(huntState);
    renderBossMini(); wireHunt(); mountBossFor(huntState.hunt); paintTeam(); startHuntTicker();
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
    onSquadChanged();
  });
  function onSquadChanged() {
    squad.locked = false;
    const eb = el('enterBattleBtn'); if (eb) { eb.disabled = true; eb.classList.remove('ready'); }
    el('lockInBtn')?.classList.remove('locked');
    updateLockBtn();
    paintSquadPanel(cap);
  }
  paintHuntPage();
  onSquadChanged();
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
  el('huntGrid')?.addEventListener('click', (e) => {
    const node = e.target.closest?.('.c');
    if (!node) return;
    const b = node.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const id = Number(node.dataset.id);
    const card = (huntState.roster || []).find((c) => c.id === id);
    if (e.target.closest?.('.card-info')) { if (card) openViewer(card); return; } // inspect, don't attack/cast
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
  // One squad per day: if every committed attacker is down, end the run with a wipe.
  const committedAtk = (huntState.roster || []).filter((c) => c.used && ATTACKER_TYPES.includes(c.type));
  if (squad.phase === 'battle' && h.status !== 'defeated' && committedAtk.length > 0 && committedAtk.every((c) => c.downed)) squadDownSequence();
}

// The whole squad is down. Show a wipe overlay, then swing back to the picker view
// (locked for the day) with a countdown to the daily reset on the Enter Battle button.
let squadDownShown = false;
function squadDownSequence() {
  if (squadDownShown) return;
  squadDownShown = true;
  lockArena(true);
  const host = el('main') || document.body;
  const ov = document.createElement('div');
  ov.className = 'squad-down-ov';
  ov.innerHTML = '<div class="sd-text">SQUAD DOWN</div><div class="sd-sub">One squad per day — regroup at the reset</div>';
  host.appendChild(ov);
  SFX?.play?.('page');
  setTimeout(async () => {
    let d; try { d = await api('/api/hunt'); } catch { d = huntCache; }
    squadDownShown = false;
    if (currentView === 'battling' && d) { huntCache = d; paintHuntView(d); }
  }, 2600);
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

// A glowing bolt flies from the tapped card up to the boss, then bursts. When the
// card has an ELEMENT, the bolt carries that element's colors + glyph. Returns
// { impact, cancel }.
function launchAttack(node, color, elem) {
  const ac = color || '#7fe3ff';
  const look = elem ? ELEMENTS[elem] : null;
  const target = document.querySelector('.arena-stage') || document.querySelector('.boss-stage') || document.querySelector('.boss');
  if (!target) return { impact() {}, cancel() {} };
  const cr = node.getBoundingClientRect(), br = target.getBoundingClientRect();
  const sx = cr.left + cr.width / 2, sy = cr.top + cr.height / 2;
  const bx = br.left + br.width / 2, by = br.top + br.height * 0.55;
  const bolt = document.createElement('div');
  bolt.className = `atk-bolt${elem ? ` el ${elem}` : ''}`;
  bolt.style.setProperty('--ac', ac);
  if (look) bolt.style.setProperty('--ac2', look.color2);
  bolt.style.setProperty('--dur', `${PACE.hit}ms`);
  bolt.style.left = `${sx}px`; bolt.style.top = `${sy}px`;
  bolt.style.transform = 'translate(0,0) scale(.6)';
  if (look) bolt.innerHTML = `<span class="bolt-glyph">${look.glyph}</span>`; // the element rides the bolt
  document.body.appendChild(bolt);
  requestAnimationFrame(() => { bolt.style.transform = `translate(${bx - sx}px, ${by - sy}px) scale(1)`; });
  SFX?.play?.('page');
  let done = false;
  setTimeout(() => { if (!done) bolt.remove(); }, 1400);
  return {
    impact(bonus) {
      if (done) return; done = true;
      bolt.remove();
      impactBurst(bx, by, bonus ? '#ffd23e' : ac, bonus, elem);
    },
    cancel() { done = true; bolt.remove(); },
  };
}

// A flash + shockwave ring + spark shower at the boss on impact. With an element,
// its glyph also scatters outward so the hit reads as fire / water / shock / etc.
function impactBurst(x, y, color, big, elem) {
  const mk = (cls) => { const d = document.createElement('div'); d.className = cls; d.style.left = `${x}px`; d.style.top = `${y}px`; d.style.setProperty('--ac', color); document.body.appendChild(d); return d; };
  const flash = mk('atk-flash'); setTimeout(() => flash.remove(), 520);
  const ring = mk('atk-ring'); setTimeout(() => ring.remove(), 620);
  for (let i = 0; i < (big ? 20 : 13); i += 1) {
    const s = mk('atk-spark'); const ang = Math.random() * Math.PI * 2, d = 40 + Math.random() * (big ? 95 : 62);
    s.style.setProperty('--dx', `${Math.cos(ang) * d}px`); s.style.setProperty('--dy', `${Math.sin(ang) * d}px`);
    setTimeout(() => s.remove(), 720);
  }
  const look = elem ? ELEMENTS[elem] : null;
  if (look) {
    for (let i = 0; i < (big ? 8 : 5); i += 1) {
      const g = document.createElement('div'); g.className = 'atk-el'; g.textContent = look.glyph;
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, d = 34 + Math.random() * (big ? 78 : 52);
      g.style.left = `${x}px`; g.style.top = `${y}px`;
      g.style.setProperty('--dx', `${Math.cos(ang) * d}px`); g.style.setProperty('--dy', `${Math.sin(ang) * d}px`);
      document.body.appendChild(g); setTimeout(() => g.remove(), 760);
    }
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

// ===== Turn pacing =====
// Deliberate beats so the exchange reads: your hit lands, a pause, the boss's
// turn banner, the boss acts, then control returns. All values are tunable.
// Tempo: let the player's attack animation fully play out before the boss reacts.
const PACE = { hit: 440, afterHit: 1600, bossHold: 1700 };
let bossActing = false; // true while the boss takes its turn — taps are ignored
function lockArena(on) {
  const a = document.querySelector('.hunt-arena') || document.querySelector('.main-body.hunt');
  if (a) a.classList.toggle('turn-locked', !!on);
}

async function huntAttack(cardId, node) {
  if (bossActing) return; // the boss is mid-turn — wait for it to finish
  if (node.classList.contains('busy')) return;
  node.classList.add('busy');
  const rarity = ['gold', 'full_art', 'secret_rare', 'illustrated_rare', 'event', 'promo'].find((rr) => node.classList.contains(rr)) || 'normal';
  // The attack color/look comes from the card's ELEMENT when it has one, else its rarity.
  const elem = node.dataset.el || null;
  const look = elem ? ELEMENTS[elem] : null;
  const color = look ? look.color : (RARITY_ATK[rarity] || '#7fe3ff');
  node.style.setProperty('--ac', color);
  node.classList.add('attacking'); // the card lunges + charges as it fires
  if (elem) auraOn(node, color, `fx-aura el-charge ${elem}`); // an element aura blooms as it casts
  setTimeout(() => node.classList.remove('attacking'), 520);
  const atk = { impact() {}, cancel() {} }; // no DOM bolt — the boss's 3D effect is the whole show
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
  const wait = Math.max(0, PACE.hit - (performance.now() - t0));
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
    bossHandle?.attack?.(node.dataset.el || 'physical'); // the element's 3D attack effect plays on the boss
    SFX?.play?.(node.dataset.el || 'physical'); // ...with its matching synthesized sound
    if (r.crit) calloutAt(bx, by - 26, 'CRIT!', '#ffd23e');
    else if (r.outcome === 'blocked') calloutAt(bx, by - 26, 'BLOCK', '#7fb0ff');
    if (r.bonus) calloutAt(bx, by - 52, 'WEAK!', '#ff7a3f');
    else if (r.resisted) calloutAt(bx, by - 52, 'RESIST', '#7fb0ff');
    flashDamage(node, r.damage, big);
    if (r.synergy && r.synergy.element) { // themed-squad element synergy bonus
      const sc = (ELEMENTS[r.synergy.element] || {}).color || '#9fe3ff';
      calloutAt(bx, by - 78, `${String(r.synergy.element).toUpperCase()} SYNERGY`, sc);
    }
    if (r.burned) { const b = node.getBoundingClientRect(); calloutAt(b.left + b.width / 2, b.top + 14, 'BURN', '#ff7a3f'); } // flaming boss singed this card
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
  if (r.defeated) { (document.querySelector('.boss') || document.querySelector('.hunt-arena'))?.classList.add('down'); bossHandle?.defeat(); SFX.playBoss('defeat'); if (bossVoice) setTimeout(() => SFX.sample(`mon:${bossVoice.roar}`, 0.85), 220); onBossDefeated(); return; }
  if (r.outcome === 'miss') SFX?.play?.('page'); // hits already played their element sound
  // The attack ended the round. Now the boss takes its hidden turn (a surprise from its
  // pool). Pace it: a beat to read your hit, then the banner, then the boss acts, then
  // control returns. The roster is locked while the boss is acting so turns read clearly.
  if (r.boss_action) {
    bossActing = true;
    lockArena(true);
    setTimeout(() => showBossTurn(), PACE.afterHit);
    setTimeout(() => resolveBossTurn(r.boss_action), PACE.afterHit + 320);
    // The attack advanced the round server-side. Refresh so support cooldowns tick down
    // (and card HP / shields reconcile to the server truth) once the boss turn ends.
    setTimeout(() => { bossActing = false; lockArena(false); refreshHuntState(); }, PACE.afterHit + PACE.bossHold);
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
  setTimeout(() => b.remove(), 1250);
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
    bossHandle?.bossAct?.('stunned');
    calloutAt(bx, by - 18, 'STUNNED', '#ffe23e');
    bossGlyph('✦', '#ffe23e');
    SFX.playBoss('stunned');
    return;
  }
  if (act.kind === 'enrage') { // the boss roars — harder hits for the next rounds
    bossHandle?.enrage();
    bossHandle?.bossAct?.('enrage');
    screenShake();
    calloutAt(bx, by - 18, 'ENRAGE!', '#ff5a3c');
    bossGlyph('🔥', '#ff3a10');
    SFX.playBoss('enrage'); bossGrowl(0.6);
    return;
  }
  if (act.kind === 'curse') { // a hex sinks onto the attacker — it hits softer
    bossHandle?.bossAct?.('curse');
    calloutAt(bx, by - 18, 'CURSE!', '#b060ff');
    curseMark(squadNode((act.targets || [])[0]?.card_id));
    SFX.playBoss('curse'); bossGrowl(0.5);
    return;
  }
  // strike / slam — real damage.
  bossHandle?.counter();
  bossHandle?.bossAct?.(act.kind);
  screenShake();
  calloutAt(bx, by - 18, act.kind === 'slam' ? 'SLAM!' : 'STRIKE!', '#ff6a5a');
  if (act.kind === 'slam') setTimeout(() => screenShake(), 120);
  syncTargets(true, act.kind === 'slam');
  SFX.playBoss(act.kind); bossGrowl(0.6);
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
  SFX.play('click'); // opening a card
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

// The Tags section of the card viewer. Element shows first as a highlighted chip,
// then the facets (Game, Type, Class, Kinds). The dominant element word is hidden
// from Kinds so it is not shown twice.
const GAME_LABELS = { smash: 'Super Smash Bros', pokemon: 'Pokemon', minecraft: 'Minecraft', party: 'Party Games', meme: 'Memes', community: 'Community' };
const V_TAG_FACETS = [['origin', 'Game'], ['type', 'Type'], ['class', 'Class'], ['traits', 'Kinds']];
function fillViewerTags(tags) {
  const box = el('v-tags');
  if (!tags) { box.classList.add('hidden'); return; }
  const elem = cardElement(tags);
  const rows = [];
  if (elem) {
    const lk = ELEMENTS[elem];
    rows.push(`<div class="v-tag-row"><span class="v-tag-facet">Element</span><span class="v-tag-chips"><span class="v-chip elem" style="--el:${lk.color}">${lk.glyph} ${lk.name}</span></span></div>`);
  }
  for (const [f, label] of V_TAG_FACETS) {
    let vals = Array.isArray(tags[f]) ? tags[f] : (tags[f] ? [tags[f]] : []);
    if (f === 'traits' && elem) vals = vals.filter((v) => String(v).toLowerCase() !== elem);
    if (f === 'origin') vals = vals.map((v) => GAME_LABELS[v] || v);
    if (!vals.length) continue;
    rows.push(`<div class="v-tag-row"><span class="v-tag-facet">${label}</span><span class="v-tag-chips">${vals.map((v) => `<span class="v-chip">${esc(v)}</span>`).join('')}</span></div>`);
  }
  if (!rows.length) { box.classList.add('hidden'); return; }
  el('v-tag-rows').innerHTML = rows.join('');
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
    if (!moved) { ry += 180; applyView(); SFX.play('flip'); } // a click (no drag) flips the card
  });
  stage.addEventListener('pointerleave', () => { hoverX = 0; hoverY = 0; applyView(); });

  el('viewer-close').onclick = closeViewer;
  el('viewer').addEventListener('click', (e) => { if (e.target === el('viewer')) closeViewer(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('bossModal').classList.contains('hidden')) closeBossModal();
    else if (!el('viewer').classList.contains('hidden')) closeViewer();
    else if (!el('stage').classList.contains('hidden')) { if (revealItems.length && flippedCount >= revealItems.length) endReveal(); } // locked until all revealed
    else if (!el('trade').classList.contains('hidden')) closeTrade();
    else if (!el('gift').classList.contains('hidden')) closeGiftPanel();
    else if (!el('notif').classList.contains('hidden')) closeNotifs();
    else if (!el('board').classList.contains('hidden')) closeBoard();
  });

  // Click a card anywhere → open it in the viewer. A boss tile (Raid Bosses
  // gallery) opens the boss viewer instead.
  el('main').addEventListener('click', (e) => {
    const bt = e.target.closest?.('.c[data-boss]');
    if (bt) { openBossGallery(BOSS_LIST[Number(bt.dataset.boss)]); return; }
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
  // NOTE: the reveal is LOCKED until every card is flipped — no backdrop close, no
  // Back button; the Done button (and Escape) only work once all are revealed.
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
