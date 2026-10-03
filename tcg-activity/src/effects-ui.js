import { thumb } from './thumb.js';
import { every } from './poll.js';
// Card effects (boons, pranks, neutral) in the Activity. Design: docs/boons-and-pranks.md.
// Everything here is driven by /api/effects/*; the server returns {enabled:false} when
// the flag is off, and then this module shows nothing and changes nothing.

let deps = null;     // { api, apiPost, el, esc, SFX }
let state = { enabled: false, cooldowns: {}, active: [], incoming: [], tiers: null, primitives: {} };
let badges = {};     // player_id -> { title, sticker, spotlight }
let pickerCard = null;

const KIND_LABEL = { boon: 'Boon', prank: 'Prank', neutral: 'Neutral' };
const KIND_ICON = { boon: '🎁', prank: '😈', neutral: '🌀' };
// Visual pranks that act on MY screen while active: primitive -> body class.
const BODY_FX = { googly_eyes: 'fx-googly', upside_down: 'fx-upside', rubber_chicken: 'fx-chicken', fog: 'fx-fog' };

const ERR = {
  cooldown: 'This card is on cooldown.',
  send_cap: 'You played your 10 cards for today.',
  pair_cap: 'You already played 3 cards on this member today.',
  target_prank_cap: 'This member has been pranked enough for today.',
  target_timeout_cap: 'This member has had enough timeouts for today.',
  already_active: 'This member already has that effect.',
  gift_pack_cap: 'The weekly gift-pack limit is reached.',
  effect_disabled: 'This effect unlocks soon.',
  not_owned: 'You do not own this card.',
  self_target: 'Pick another member.',
  immune: 'Discord cannot change the server owner: pick an in-game card for them.',
  no_target: 'That member has not played yet.',
  no_effect: 'This card has no effect yet.',
  slow_down: 'Slow down a little.',
};

export const effectsEnabled = () => state.enabled;

export async function initEffects(d) {
  deps = d;
  await refreshEffects();
  if (!state.enabled) return;
  wrapChicken();
  refreshBadges();
  every(30000, refreshEffects); // paused while hidden, slower when idle (poll.js)
  every(30000, refreshBadges);
}

async function refreshEffects() {
  try {
    const s = await deps.api('/api/effects/me');
    if (!s || !s.enabled) { state.enabled = false; return; }
    state = s;
    applyBodyFx();
    showIncoming();
  } catch { /* keep the previous state */ }
}

async function refreshBadges() {
  try { badges = (await deps.api('/api/effects/badges')).badges || {}; } catch { /* keep */ }
  paintStaches();
}

// The mustache prank (effects_spread.sql, Nathan 2026-10-03): a BIG mustache over the member's avatar
// everywhere the Activity shows it (profile, Live, voice tiles, leaderboards, raid board, trades), plus
// the showcase cards (ui-v2.js spotPrank). avatarHTML() draws it at render; paintStaches() adds or
// removes it on the avatars already on the screen when the badges change (every avatar has data-pid).
export const AVATAR_STACHE = '<svg class="av-stache" viewBox="0 0 100 40" aria-hidden="true"><path d="M50 14c-6-10-20-12-30-4-6 5-12 6-18 3 4 12 18 20 32 13 7-3 12-7 16-12 4 5 9 9 16 12 14 7 28-1 32-13-6 3-12 2-18-3-10-8-24-6-30 4z"/></svg>';
/** Tests only (avatar-stache.test.js): set the badges list without the server. */
export const setBadgesForTest = (b) => { badges = b || {}; };
/** The mustache markup for a member's avatar ('' when they have no mustache prank). */
export const avatarStache = (playerId) => (playerId && badges[playerId]?.mustache ? AVATAR_STACHE : '');
export function paintStaches(root = document) {
  for (const a of root.querySelectorAll('.v2-avatar[data-pid]')) {
    const on = !!badges[a.dataset.pid]?.mustache;
    const has = a.querySelector(':scope > .av-stache');
    if (on && !has) a.insertAdjacentHTML('beforeend', AVATAR_STACHE);
    if (!on && has) has.remove();
    a.classList.toggle('stached', on);
  }
}

// ---- Numbers: the card's Normal values scaled by the tier, clamped by the hard limit ----
function scaled(card) {
  const e = card.effect || {};
  const t = state.tiers?.[card.rarity] || { power: 1, cd: 1 };
  const p = state.primitives?.[e.primitive] || {};
  // The same math as play_card_effect(): tier x this copy's bonus x the global knob. The bonus: with
  // stat points on, the Potency and Haste points of this copy (card_combat(): the stars add nothing
  // to effects); with them off, the per-star bonus. Before 2026-10-02 the card always showed the
  // star bonus, so a starred card showed a stronger effect and a shorter cooldown than it had.
  const stars = Number(card.ascension) || 0;
  const a = state.ascension || {};
  let mPow, mCd, bonus = null;
  if (deps.statsOn?.()) {
    const st = card.stat || deps.lookup?.(card.id)?.stat || {};
    mPow = Number(st.potency) || 1;
    mCd = Number(st.haste) || 1;
    if (mPow !== 1 || mCd !== 1) bonus = { points: true, power: Math.round((mPow - 1) * 100), cd: Math.round((1 - mCd) * 100) };
  } else {
    mPow = 1 + (Number(a.power_per_star) || 0) * stars;
    mCd = Math.max(0.2, 1 - (Number(a.cd_per_star) || 0) * stars);
    if (stars) bonus = { points: false, power: Math.round((mPow - 1) * 100), cd: Math.round((1 - mCd) * 100) };
  }
  const power = t.power * mPow;
  const cd = t.cd * mCd * (Number(state.cooldownScale) || 1);
  let amount = e.base?.amount != null ? Math.round(e.base.amount * power * 100) / 100 : null;
  let dur = e.base?.duration_s != null ? Math.round(e.base.duration_s * power) : null;
  if (amount != null && p.max_amount != null) amount = Math.min(amount, Number(p.max_amount));
  if (dur != null && p.max_duration_s != null) dur = Math.min(dur, p.max_duration_s);
  return { amount, dur, cooldownH: (Number(e.cooldown_h) || 24) * cd, kind: p.kind, enabled: !!p.enabled, stars,
    starBonus: bonus };
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  if (sec < 600 && sec % 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`; // a short prank: 1m 20s
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return mm ? `${h}h ${mm}m` : `${h}h`;
  const dd = Math.floor(h / 24), hh = h % 24;
  return hh ? `${dd}d ${hh}h` : `${dd}d`;
}

function readyIn(card) {
  const at = state.cooldowns?.[card.subject_id];
  if (!at) return 0;
  return Math.max(0, (new Date(at).getTime() - Date.now()) / 1000);
}

// Cards opened from the Hunt squad, the live feed, or a pack reveal come from other
// endpoints without `effect`. Find the effect by card id: first in what the app has
// loaded (deps.lookup), then in the catalog, which this module loads once itself.
let catalogById = null;
async function effectFor(card) {
  if (card?.effect?.primitive) return card;
  const hit = deps.lookup?.(card?.id);
  if (hit?.effect) return { ...card, effect: hit.effect, subject_id: hit.subject_id };
  if (!catalogById) {
    try { catalogById = new Map(((await deps.api('/api/catalog')).cards || []).map((c) => [c.id, c])); }
    catch { catalogById = new Map(); }
  }
  const c = catalogById.get(card?.id);
  return c?.effect ? { ...card, effect: c.effect, subject_id: c.subject_id } : card;
}

// ---- The card viewer section ----
const viewerSeq = {}; // box id -> the latest request
// boxId: the viewer's #v-effect by default; the v2 Collection panel passes its own box.
export async function fillViewerEffect(card, boxId = 'v-effect') {
  const { el } = deps || {};
  const box = el?.(boxId);
  if (!box) return;
  const seq = viewerSeq[boxId] = (viewerSeq[boxId] || 0) + 1;
  if (!state.enabled) { box.classList.add('hidden'); return; }
  const full = await effectFor(card);
  if (seq !== viewerSeq[boxId]) return; // the member opened another card meanwhile
  paintViewerEffect(full, boxId);
}

function paintViewerEffect(card, boxId) {
  const { el, esc } = deps;
  const box = el(boxId);
  if (!box) return;
  if (!card?.effect?.primitive) { box.classList.add('hidden'); return; }
  const e = card.effect;
  const s = scaled(card);
  const meta = [];
  if (s.amount != null) meta.push(`Power ${s.amount}`);
  if (s.dur) meta.push(`Lasts ${fmtDur(s.dur)}`);
  meta.push(`Cooldown ${fmtDur(s.cooldownH * 3600)}`);
  if (s.starBonus?.points) meta.push([s.starBonus.power ? `Potency +${s.starBonus.power}% effect` : '', s.starBonus.cd ? `Haste −${s.starBonus.cd}% cooldown` : ''].filter(Boolean).join(', '));
  else if (s.starBonus) meta.push(`★${s.stars}: +${s.starBonus.power}% effect, −${s.starBonus.cd}% cooldown`);
  const wait = readyIn(card);
  let btn = '';
  if (!card.locked) {
    if (!s.enabled) btn = '<button class="v-play" disabled>Unlocks soon</button>';
    else if (wait > 0) btn = `<button class="v-play" disabled>Ready in ${fmtDur(wait)}</button>`;
    else btn = '<button class="v-play">Play on a member</button>';
  }
  box.innerHTML = `<div class="v-sec-head">${KIND_ICON[s.kind] || '🎴'} ${KIND_LABEL[s.kind] || 'Effect'}</div>
    <div class="v-effect-name">${esc(e.name || e.primitive)}</div>
    <div class="v-effect-desc">${esc(e.desc || '')}</div>
    <div class="v-effect-meta">${meta.join(' · ')}</div>${btn}`;
  box.classList.remove('hidden');
  box.querySelector('.v-play:not([disabled])')?.addEventListener('click', () => openPicker(card));
}

// ---- The member picker ----
function openPicker(card) {
  const { el, esc } = deps;
  pickerCard = card;
  const m = el('effectPick');
  m.className = 'open';
  m.innerHTML = `<div class="gift-card">
      <div class="gift-head"><span>${KIND_ICON[scaled(card).kind] || '🎴'} Play ${esc(card.name)}</span><button class="gift-close" id="effClose">✕</button></div>
      <div class="gift-bal">${esc(card.effect?.name || '')}: ${esc(card.effect?.desc || '')}</div>
      <input id="effSearch" class="ginput" placeholder="Search members…" autocomplete="off">
      <div class="gift-results" id="effResults"></div>
      <div class="gift-msg" id="effMsg"></div>
    </div>`;
  el('effClose').addEventListener('click', closePicker);
  m.addEventListener('click', (ev) => { if (ev.target === m) closePicker(); });
  let t = null;
  el('effSearch').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => loadTargets(ev.target.value), 250); });
  el('effResults').addEventListener('click', (ev) => {
    const b = ev.target.closest?.('.eff-go');
    if (b) confirmPlay(b.closest('.gift-row').dataset.id, b.closest('.gift-row').dataset.name);
  });
  loadTargets('');
  el('effSearch').focus();
}

// From a member's profile: pick one of MY ready cards of this kind, then confirm the
// play on that member (the same confirm + play path as the card viewer).
export function playOnMember(kind, target) {
  const { el, esc } = deps;
  if (!state.enabled) return;
  const mine = (deps.ownedCards?.() || []).filter((c) => c.effect?.primitive && scaled(c).kind === kind);
  const m = el('effectPick');
  m.className = 'open';
  const row = (c, i) => {
    const s = scaled(c); const wait = readyIn(c);
    const why = !s.enabled ? 'Unlocks soon' : wait > 0 ? `Ready in ${fmtDur(wait)}` : '';
    return `<div class="gift-row" data-i="${i}"><span class="gift-name">${esc(c.name)} · ${esc(c.effect.name || '')}</span>
      ${why ? `<span class="gift-bal">${why}</span>` : '<button class="gift-send eff-pick">Pick</button>'}</div>`;
  };
  m.innerHTML = `<div class="gift-card">
      <div class="gift-head"><span>${KIND_ICON[kind] || '🎴'} ${KIND_LABEL[kind] || 'Card'} for ${esc(target.name)}</span><button class="gift-close" id="effClose">✕</button></div>
      <div class="gift-results" id="effResults">${mine.length ? mine.map(row).join('') : `<p class="empty">You have no ${esc((KIND_LABEL[kind] || '').toLowerCase())} cards yet.</p>`}</div>
      <div class="gift-msg" id="effMsg"></div>
    </div>`;
  el('effClose').addEventListener('click', closePicker);
  m.addEventListener('click', (ev) => { if (ev.target === m) closePicker(); });
  el('effResults').addEventListener('click', (ev) => {
    const b = ev.target.closest?.('.eff-pick');
    if (!b) return;
    pickerCard = mine[Number(b.closest('.gift-row').dataset.i)];
    confirmPlay(target.id, target.name);
  });
}

function closePicker() { const m = deps.el('effectPick'); m.className = 'hidden'; m.innerHTML = ''; pickerCard = null; }

async function loadTargets(q) {
  const { api, el, esc } = deps;
  const box = el('effResults');
  if (!box) return;
  try {
    const d = await api(`/api/players?q=${encodeURIComponent(q || '')}`);
    const ps = d.players || [];
    box.innerHTML = ps.length
      ? ps.map((p) => `<div class="gift-row" data-id="${esc(p.id)}" data-name="${esc(p.username)}">
          <span class="gift-name">${nameBadge(p.id, p.username)}</span>
          <button class="gift-send eff-go">Play</button></div>`).join('')
      : '<p class="empty">No members found.</p>';
  } catch { box.innerHTML = '<p class="empty">Could not load members.</p>'; }
}

function confirmPlay(id, name) {
  const { el, esc } = deps;
  const box = el('effResults');
  box.innerHTML = `<div class="eff-confirm">Play <b>${esc(pickerCard.name)}</b> on <b>${esc(name)}</b>?
      <div class="eff-confirm-btns"><button class="gift-send" id="effYes">Play it</button><button class="gift-close eff-no" id="effNo">Back</button></div></div>`;
  el('effNo').addEventListener('click', () => (el('effSearch') ? loadTargets(el('effSearch').value || '') : closePicker()));
  el('effYes').addEventListener('click', () => doPlay(id, name));
}

async function doPlay(id, name) {
  const { apiPost, el, esc, SFX } = deps;
  const yes = el('effYes');
  if (yes) yes.disabled = true;
  const r = await apiPost('/api/effects/play', { cardId: pickerCard.id, targetId: id }).catch(() => ({ ok: false }));
  const msg = el('effMsg');
  if (r?.ok) {
    deps.status?.('playing', { c: [Number(pickerCard.id)].filter(Boolean), t: pickerCard.effect?.name || pickerCard.name, s: name }); // my Live in voice tile
    SFX.play(r.kind === 'prank' ? 'rare' : 'reveal');
    const out = r.outcome === 'blocked' ? `🛡️ ${esc(name)} blocked it!`
      : r.outcome === 'reflected' ? '🪞 It bounced back to you!'
      : r.outcome === 'decoyed' ? `🎯 Direct hit on ${esc(name)}!`
      : r.outcome === 'redirected' ? '🔀 It went to someone else!'
      : r.outcome === 'delayed' ? `⏳ It lands on ${esc(name)} in 1 hour.`
      : `${KIND_ICON[r.kind] || '🎴'} Played on ${esc(name)}!`;
    if (msg) msg.innerHTML = out;
    await refreshEffects();
    setTimeout(closePicker, 1400);
  } else {
    if (msg) { msg.textContent = ERR[r?.error] || 'That did not work.'; msg.classList.add('err'); }
    if (yes) yes.disabled = false;
  }
}

// The name colors a member can pick (the same list as the bot's NAME_COLORS).
const NAME_COLORS = ['#F4B73C', '#FF5A5A', '#FF9A3C', '#5BE38A', '#4FD6F0', '#5B8CFF', '#B45AD8', '#FF7AC8'];

// ---- Pranks on my next pack reveal (effects_batch3.sql) ----
const PACK_FX = ['photobomb', 'fake_gold', 'jinx', 'slow_motion'];
/** The first waiting pack prank on me ({ primitive, card }), or null. */
export function packPrank() {
  const e = (state.active || []).find((x) => PACK_FX.includes(x.primitive));
  return e ? { primitive: e.primitive, card: e.card || null } : null;
}
/** Play a pack prank on the reveal stage, and use it up on the server. */
export function runPackPrank(p, stage) {
  if (!p || !stage) return;
  deps.apiPost('/api/effects/used', { primitive: p.primitive }).catch(() => {});
  state.active = state.active.filter((x) => x.primitive !== p.primitive);
  if (p.primitive === 'jinx') { stage.classList.add('fx-jinx'); setTimeout(() => stage.classList.remove('fx-jinx'), 9000); }
  if (p.primitive === 'slow_motion') {
    // Every animation on the reveal plays at half speed for 12 seconds.
    const t0 = Date.now();
    const slow = () => { document.getAnimations().forEach((a) => { if (a.playbackRate !== 0.5) a.playbackRate = 0.5; }); if (Date.now() - t0 < 12000) requestAnimationFrame(slow); };
    slow();
  }
  if (p.primitive === 'fake_gold' || p.primitive === 'photobomb') {
    const o = document.createElement('div');
    o.className = p.primitive === 'fake_gold' ? 'fx-fakegold' : 'fx-photobomb';
    o.innerHTML = p.primitive === 'fake_gold' ? '<b>GOLD!</b><i>...psych</i>'
      : `${p.card?.image_url ? `<img src="${p.card.image_url}" alt="">` : ''}<b>📸</b>`;
    stage.appendChild(o);
    setTimeout(() => o.remove(), p.primitive === 'fake_gold' ? 2600 : 1900);
  }
}

/** A member's name decorations and showcase pranks (the badges list). */
export function badgeOf(playerId) { return badges[playerId] || null; }

// ---- Name decorations (titles, stickers, spotlight) ----
// A long name may go to a second line only at a natural point: after _ . - or between a small and
// a capital letter (HighFlying|Penguin). Takes escaped text.
export const breakable = (html) => String(html).replace(/(?<=[a-z0-9])([_.\-])(?=[a-z0-9])/gi, '$1<wbr>').replace(/([a-z])(?=[A-Z])/g, '$1<wbr>');
export function nameBadge(playerId, username, soft) {
  const esc = deps?.esc || ((s) => String(s));
  const b = badges[playerId];
  const base = soft ? breakable(esc(username || 'Player')) : esc(username || 'Player');
  if (!b) return base;
  const sticker = b.sticker ? `<img class="nb-sticker" src="${b.sticker}" alt="">` : '';
  const title = b.title ? ` <span class="nb-title">${esc(b.title)}</span>` : '';
  return `<span class="nb${b.spotlight ? ' nb-spot' : ''}">${sticker}${base}${title}</span>`;
}

// ---- What happens on MY screen ----
// A screen prank lasts 1-3 minutes (screen_pranks_short.sql): it goes at its end time, not
// at the next 30 s refresh.
let fxTimer = null;
function applyBodyFx() {
  const now = Date.now();
  const live = state.active.filter((e) => BODY_FX[e.primitive] && !(e.expires_at && Date.parse(e.expires_at) <= now));
  const on = new Set(live.map((e) => BODY_FX[e.primitive]));
  for (const cls of Object.values(BODY_FX)) document.body.classList.toggle(cls, on.has(cls));
  clearTimeout(fxTimer);
  const next = Math.min(...live.map((e) => (e.expires_at ? Date.parse(e.expires_at) : Infinity)));
  if (Number.isFinite(next)) fxTimer = setTimeout(applyBodyFx, Math.max(250, next - now + 250));
}

let shown = new Set();
function showIncoming() {
  const { el, esc, apiPost } = deps;
  const fresh = (state.incoming || []).filter((p) => !shown.has(p.id));
  if (!fresh.length) return;
  const host = el('effectBanners');
  for (const p of fresh.reverse()) {
    shown.add(p.id);
    const icon = p.outcome === 'blocked' ? '🛡️' : p.outcome === 'decoyed' ? '🪧' : p.outcome === 'delayed' ? '⏳' : KIND_ICON[p.kind] || '🎴';
    const text = p.outcome === 'blocked' ? `${esc(p.sender)} tried <b>${esc(p.card?.name || 'a card')}</b> on you, but it was blocked!`
      : p.outcome === 'reflected' ? `Your <b>${esc(p.card?.name || 'card')}</b> bounced back to you!`
      : p.outcome === 'decoyed' ? `${esc(p.sender)} played <b>${esc(p.card?.name || 'a card')}</b> on you. Your cardboard cutout took it!`
      : p.outcome === 'delayed' ? `${esc(p.sender)} played <b>${esc(p.card?.name || 'a card')}</b> on you. It lands in 1 hour.`
      : `${esc(p.sender)} played <b>${esc(p.card?.name || 'a card')}</b> on you!`;
    const div = document.createElement('div');
    div.className = `eff-banner ${p.kind}`;
    const pickColor = p.primitive === 'color_role' && p.outcome === 'applied';
    div.innerHTML = `${p.card?.image_url ? `<img src="${thumb(p.card.image_url)}" data-full="${p.card.image_url || ''}" alt="">` : ''}<span>${icon} ${text}${pickColor
      ? `<span class="eff-colors">${NAME_COLORS.map((c) => `<button class="eff-color" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</span>` : ''}</span><button class="eff-x" aria-label="Close">✕</button>`;
    div.querySelector('.eff-x').addEventListener('click', () => div.remove());
    if (pickColor) {
      // The name color boon: the pick goes to the bot (gold after 24 h with no pick).
      div.querySelector('.eff-colors').addEventListener('click', async (e) => {
        const b = e.target.closest('.eff-color');
        if (!b) return;
        const r = await apiPost('/api/effects/color', { playId: p.id, color: b.dataset.color }).catch(() => null);
        if (r?.ok) { div.querySelector('.eff-colors').innerHTML = '<b>✓</b>'; setTimeout(() => div.remove(), 1800); }
      });
    }
    host.appendChild(div);
    if (!pickColor) setTimeout(() => div.remove(), 12000);
    if ((p.primitive === 'confetti' || p.primitive === 'gift_wrap') && !['blocked', 'decoyed', 'delayed'].includes(p.outcome)) confetti(p.card?.image_url);
  }
  apiPost('/api/effects/seen', { ids: fresh.map((p) => p.id) }).catch(() => {});
}

// Card art bursts over the screen (confetti + gift wrap).
function confetti(img) {
  const layer = document.createElement('div');
  layer.className = 'eff-confetti';
  for (let i = 0; i < 26; i += 1) {
    const bit = document.createElement(img && i % 3 === 0 ? 'img' : 'i');
    if (bit.tagName === 'IMG') bit.src = img;
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.animationDelay = `${Math.random() * 0.8}s`;
    bit.style.setProperty('--hue', String(Math.floor(Math.random() * 360)));
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  deps.SFX.play('rare');
  setTimeout(() => layer.remove(), 4200);
}

// Rubber chicken: while active, every Activity sound is a squeak.
let squeakCtx = null;
function squeak() {
  try {
    squeakCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = squeakCtx.createOscillator(), g = squeakCtx.createGain(), t = squeakCtx.currentTime;
    o.type = 'square';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1700, t + 0.08); o.frequency.exponentialRampToValueAtTime(600, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(squeakCtx.destination); o.start(t); o.stop(t + 0.26);
  } catch { /* no audio */ }
}
function wrapChicken() {
  const { SFX } = deps;
  const orig = SFX.play.bind(SFX);
  SFX.play = (name, ...rest) => (document.body.classList.contains('fx-chicken') && !SFX.muted() ? squeak() : orig(name, ...rest));
}

// ---- For the Community tab's Boons & Pranks view (the same math as the viewer) ----
export const effectState = () => state;
export const effectScaled = (card) => scaled(card);
export const effectReadyIn = (card) => readyIn(card);
export const EFFECT_KIND = { label: KIND_LABEL, icon: KIND_ICON };
export const effectError = (code) => ERR[code] || 'That did not work. Try again.';
/** Play a card on a member. Returns the server result; refreshes cooldowns + effects. */
export async function playCard(card, targetId) {
  const r = await deps.apiPost('/api/effects/play', { cardId: card.id, targetId }).catch(() => ({ ok: false }));
  if (r?.ok) {
    deps.status?.('playing', { c: [Number(card.id)].filter(Boolean), t: card.effect?.name || card.name }); // my Live in voice tile
    deps.SFX?.play?.(r.kind === 'prank' ? 'rare' : 'reveal'); await refreshEffects();
  }
  return r || { ok: false };
}
export async function reloadEffects() { await refreshEffects(); return state; }

// Test mode: try a card's effect on yourself (no post, no cooldown). Refreshes the
// effects and badges, so the visuals start at once.
export async function testCard(card) {
  const r = await deps.apiPost('/api/effects/test', { cardId: card.id }).catch(() => ({ ok: false }));
  if (r?.ok) { await refreshEffects(); await refreshBadges(); testLanding(card, r); }
  return r || { ok: false };
}

// A test has no play record, so the landing a real target gets (the banner, the
// confetti) is played here, at once. A sticker / title shows your name with the badge.
function testLanding(card, r) {
  const { el, esc } = deps;
  const host = el('effectBanners');
  if (!host) return;
  const me = deps.user?.();
  const onName = r.primitive === 'sticker' || r.primitive === 'title' || r.primitive === 'spotlight';
  const div = document.createElement('div');
  div.className = `eff-banner ${r.kind || ''} eff-test`;
  div.innerHTML = `${card.image_url ? `<img src="${thumb(card.image_url)}" data-full="${card.image_url || ''}" alt="">` : ''}<span>🧪 Test: <b>${esc(card.effect?.name || card.name || 'a card')}</b> ${r.primitive === 'cleanse' ? ` removed ${r.removed || 0} prank${r.removed === 1 ? '' : 's'} from you` : ` is on you${onName && me ? `. Your name now: ${nameBadge(me.id, me.name)}` : ''}`}</span><button aria-label="Close">✕</button>`;
  div.querySelector('button').addEventListener('click', () => div.remove());
  host.appendChild(div);
  setTimeout(() => div.remove(), 12000);
  if (r.primitive === 'confetti' || r.primitive === 'gift_wrap') confetti(card.image_url);
}
export async function clearTests() {
  const r = await deps.apiPost('/api/effects/test/clear', {}).catch(() => ({ ok: false }));
  if (r?.ok) { await refreshEffects(); await refreshBadges(); }
  return r || { ok: false };
}
