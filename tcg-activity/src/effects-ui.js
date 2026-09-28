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
  setInterval(refreshEffects, 30000);
  setInterval(refreshBadges, 30000);
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
}

// ---- Numbers: the card's Normal values scaled by the tier, clamped by the hard limit ----
function scaled(card) {
  const e = card.effect || {};
  const t = state.tiers?.[card.rarity] || { power: 1, cd: 1 };
  const p = state.primitives?.[e.primitive] || {};
  // The same math as play_card_effect(): tier x ascension stars x the global knob.
  const stars = Number(card.ascension) || 0;
  const a = state.ascension || {};
  const power = t.power * (1 + (Number(a.power_per_star) || 0) * stars);
  const cd = t.cd * Math.max(0.2, 1 - (Number(a.cd_per_star) || 0) * stars) * (Number(state.cooldownScale) || 1);
  let amount = e.base?.amount != null ? Math.round(e.base.amount * power * 100) / 100 : null;
  let dur = e.base?.duration_s != null ? Math.round(e.base.duration_s * power) : null;
  if (amount != null && p.max_amount != null) amount = Math.min(amount, Number(p.max_amount));
  if (dur != null && p.max_duration_s != null) dur = Math.min(dur, p.max_duration_s);
  return { amount, dur, cooldownH: (Number(e.cooldown_h) || 24) * cd, kind: p.kind, enabled: !!p.enabled, stars,
    starBonus: stars ? { power: Math.round((Number(a.power_per_star) || 0) * stars * 100), cd: Math.round((1 - Math.max(0.2, 1 - (Number(a.cd_per_star) || 0) * stars)) * 100) } : null };
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
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
  if (s.starBonus) meta.push(`★${s.stars}: +${s.starBonus.power}% effect, −${s.starBonus.cd}% cooldown`);
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
  el('effNo').addEventListener('click', () => loadTargets(el('effSearch')?.value || ''));
  el('effYes').addEventListener('click', () => doPlay(id, name));
}

async function doPlay(id, name) {
  const { apiPost, el, esc, SFX } = deps;
  const yes = el('effYes');
  if (yes) yes.disabled = true;
  const r = await apiPost('/api/effects/play', { cardId: pickerCard.id, targetId: id }).catch(() => ({ ok: false }));
  const msg = el('effMsg');
  if (r?.ok) {
    SFX.play(r.kind === 'prank' ? 'rare' : 'reveal');
    const out = r.outcome === 'blocked' ? `🛡️ ${esc(name)} blocked it!`
      : r.outcome === 'reflected' ? '🪞 It bounced back to you!'
      : `${KIND_ICON[r.kind] || '🎴'} Played on ${esc(name)}!`;
    if (msg) msg.innerHTML = out;
    await refreshEffects();
    setTimeout(closePicker, 1400);
  } else {
    if (msg) { msg.textContent = ERR[r?.error] || 'That did not work.'; msg.classList.add('err'); }
    if (yes) yes.disabled = false;
  }
}

// ---- Name decorations (titles, stickers, spotlight) ----
export function nameBadge(playerId, username) {
  const esc = deps?.esc || ((s) => String(s));
  const b = badges[playerId];
  const base = esc(username || 'Player');
  if (!b) return base;
  const sticker = b.sticker ? `<img class="nb-sticker" src="${b.sticker}" alt="">` : '';
  const title = b.title ? ` <span class="nb-title">${esc(b.title)}</span>` : '';
  return `<span class="nb${b.spotlight ? ' nb-spot' : ''}">${sticker}${base}${title}</span>`;
}

// ---- What happens on MY screen ----
function applyBodyFx() {
  const on = new Set(state.active.map((e) => BODY_FX[e.primitive]).filter(Boolean));
  for (const cls of Object.values(BODY_FX)) document.body.classList.toggle(cls, on.has(cls));
}

let shown = new Set();
function showIncoming() {
  const { el, esc, apiPost } = deps;
  const fresh = (state.incoming || []).filter((p) => !shown.has(p.id));
  if (!fresh.length) return;
  const host = el('effectBanners');
  for (const p of fresh.reverse()) {
    shown.add(p.id);
    const icon = p.outcome === 'blocked' ? '🛡️' : KIND_ICON[p.kind] || '🎴';
    const text = p.outcome === 'blocked' ? `${esc(p.sender)} tried <b>${esc(p.card?.name || 'a card')}</b> on you, but it was blocked!`
      : p.outcome === 'reflected' ? `Your <b>${esc(p.card?.name || 'card')}</b> bounced back to you!`
      : `${esc(p.sender)} played <b>${esc(p.card?.name || 'a card')}</b> on you!`;
    const div = document.createElement('div');
    div.className = `eff-banner ${p.kind}`;
    div.innerHTML = `${p.card?.image_url ? `<img src="${p.card.image_url}" alt="">` : ''}<span>${icon} ${text}</span><button aria-label="Close">✕</button>`;
    div.querySelector('button').addEventListener('click', () => div.remove());
    host.appendChild(div);
    setTimeout(() => div.remove(), 12000);
    if ((p.primitive === 'confetti' || p.primitive === 'gift_wrap') && p.outcome !== 'blocked') confetti(p.card?.image_url);
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
