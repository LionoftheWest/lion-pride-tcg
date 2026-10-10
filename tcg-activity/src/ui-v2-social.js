// UI v2 social screens, approved 2026-09-27: the Notifications panel (design 11), the
// Leaderboard (design 12), and Trading with Gift inside it (designs 14 + 13).
// Uses the shared helpers of ui-v2.js; the data comes from the existing APIs.

import { v2ctx, avatarHTML, titleHTML, ensureCatalog, paintCards, fitChildren, openMember, toast } from './ui-v2.js';
import { thumb } from './thumb.js';
import { explainBtn, maybeExplain, placeExplain } from './ui-v2-explain.js';
import { playTradeFx, playGiftFx } from './ui-v2-tradefx.js';
import { COIN, refreshShards } from './ui-v2-shop.js';
import { isPhone, isPort, isLand } from './mobile.js';
import { renderHall, repaintHall, prefetchHall, hall as hallState } from './ui-v2-hall.js';
import { mountMemberPicker, memberLists, breakName } from './ui3/member-picker.js';
import { button as button3, dot as dot3, sheet as sheet3, toast as toast3, counter as counter3, iconButton, inlineMessage, pager as pager3, progressLinear } from './ui3/components.js';
import { icon as icon3 } from './ui3/icons.js';
import { openCardPicker } from './ui3/card-picker.js';
import { KINDS, kindName, playHistory, memberReason, dayLine, leftPct, pageOf, pickerCards } from './ui3/boons.js';
import { pendingLists, waiting, sectionsHTML, headHTML, viewHTML } from './ui3/pending.js';
import { paintBell } from './ui3/bell.js';
import { effectState, effectScaled, effectReadyIn, EFFECT_KIND, effectError, playCard, reloadEffects, fmtDur, testCard, clearTests, nameBadge, breakable } from './effects-ui.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const fmt = (n) => Number(n || 0).toLocaleString();
const short = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : fmt(n));
const stripEmoji = (t) => String(t || '').replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '');

// ---- Notifications (design 11) ------------------------------------------------

const NOTE_KINDS = {
  pack_earned: { icon: '📦', tab: 'all', label: 'Pack', act: 'Open' },
  pack_gift: { icon: '🎁', tab: 'trades', label: 'Gift', act: 'Open' },
  card_gift: { icon: '🎴', tab: 'trades', label: 'Gift', act: 'View' },
  trade_offer: { icon: '⇄', tab: 'trades', label: 'Trade offer', act: 'View' },
  trade_counter: { icon: '⇄', tab: 'trades', label: 'Trade', act: 'View' },
  trade_accepted: { icon: '✅', tab: 'trades', label: 'Trade', act: 'View' },
  // The Hall + Auctions (2026-10-02: these showed as a plain bell with no way to the auction).
  auction_bid: { icon: '🔨', tab: 'trades', label: 'Auction', act: 'Auction' },
  auction_accepted: { icon: '🔨', tab: 'trades', label: 'Auction', act: 'Confirm' },
  auction_declined: { icon: '🔨', tab: 'trades', label: 'Auction', act: 'Auction' },
  auction_sold: { icon: '🔨', tab: 'trades', label: 'Auction', act: 'Auction' },
  auction_closed: { icon: '🔨', tab: 'trades', label: 'Auction', act: 'Auction' },
  auction_ended: { icon: '🔨', tab: 'trades', label: 'Auction', act: 'Auction' },
};
const noteKind = (k) => NOTE_KINDS[k] || (String(k).startsWith('hunt') ? { icon: '⚔', tab: 'hunt', label: 'Hunt', act: 'Hunt' } : { icon: '🔔', tab: 'all', label: '' });
let noteTab = 'all';
let noteItems = [];
let noteHunt = null;
let noteGifts = []; // gifts waiting to be redeemed (gift_claims.sql)
let bell3 = { page: 1, giftError: false, expanded: new Set(), pages: 1 }; // the v3 window (UI-24, flag ui_v3): page, claim error, opened rows
const isV3 = () => document.body.classList.contains('ui-v3');
let pingPrefs = null; // the Settings tab: which bot posts may ping me (null = not loaded)
const PING_ROWS = [['plays', 'Card plays on me'], ['trades', 'Trades & gifts'], ['raid', 'Raid boss'], ['packs', 'Pack reminders']];

export async function openNotifsV2() {
  const { el, api } = ctx();
  let box = el('v2Notifs');
  if (!box) { document.body.insertAdjacentHTML('beforeend', `<div id="v2Notifs" class="${isV3() ? 'u3-bell' : 'v2-drop'} hidden"></div>`); box = el('v2Notifs'); }
  if (!box.classList.contains('hidden')) { closeNotifsV2(); return; }
  box.classList.remove('hidden');
  if (isV3()) {
    bell3 = { page: 1, giftError: false, expanded: new Set(), pages: 1 };
    el('bellBtn')?.classList.add('is-open');
    el('bellBtn')?.setAttribute('aria-expanded', 'true');
    window.addEventListener('resize', bellResize);
  }
  box.innerHTML = '<div class="v2-loading">Loading…</div>';
  const [n, h] = await Promise.all([api('/api/notifications').catch(() => ({ items: [] })), ctx().features().hunt ? api('/api/hunt').catch(() => null) : null]);
  noteItems = n.items || [];
  noteGifts = n.gifts || [];
  noteHunt = h && h.hunt ? h.hunt : null;
  paintNotifs();
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
}
function outside(e) {
  const box = ctx().el('v2Notifs');
  if (box && !box.contains(e.target) && !e.target.closest('#bellBtn')) closeNotifsV2();
}
export async function closeNotifsV2() {
  const { el, apiPost } = ctx();
  const box = el('v2Notifs');
  if (!box || box.classList.contains('hidden')) return;
  box.classList.add('hidden');
  document.removeEventListener('pointerdown', outside, { capture: true });
  if (isV3()) {
    el('bellBtn')?.classList.remove('is-open');
    el('bellBtn')?.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', bellResize);
  }
  if (noteItems.some((x) => !x.read)) { try { await apiPost('/api/notifications/read', {}); } catch { /* keep */ } }
  ctx().updateNotifBadge(noteGifts.length); // a gift not redeemed yet keeps the red number
}
function paintNotifs() {
  if (isV3()) { paintBellV3(); return; }
  const { el } = ctx();
  const box = el('v2Notifs');
  const unread = noteItems.filter((x) => !x.read).length;
  const list = noteItems.filter((x) => noteTab === 'all' || noteKind(x.kind).tab === noteTab);
  const today = new Date().toDateString();
  const row = (x) => {
    const k = noteKind(x.kind);
    return `<div class="nt-row${x.read ? '' : ' unread'}"><span class="nt-ico">${k.icon}</span>
      <div class="nt-t"><b>${esc(stripEmoji(x.message))}</b>${k.label ? `<span>${esc(k.label)}</span>` : ''}</div>
      ${k.act ? `<button class="v2-chip-btn nt-act" data-act="${esc(k.act)}">${esc(k.act)}</button>` : ''}
      <span class="nt-time mono">${ctx().ago(x.created_at)}</span>${x.read ? '' : '<i class="nt-dot"></i>'}</div>`;
  };
  const todays = list.filter((x) => new Date(x.created_at).toDateString() === today);
  const earlier = list.filter((x) => new Date(x.created_at).toDateString() !== today);
  const h = noteHunt;
  const pct = h && h.hp_max ? Math.max(0, Math.round((100 * h.hp_remaining) / h.hp_max)) : 0;
  box.innerHTML = `<div class="nt-head"><h3>Notifications</h3>${unread ? `<span class="nt-count">${unread}</span>` : ''}<span class="grow"></span>
      ${unread ? '<button class="link-btn" id="ntRead">✓ Mark all read</button>' : ''}<button class="v2-icon" id="ntClose" aria-label="Close">✕</button></div>
    <div class="seg nt-tabs">${[['all', 'All'], ['hunt', 'Hunt'], ['trades', 'Trades'], ['settings', 'Settings']].map(([v, l]) => `<button data-t="${v}" class="${noteTab === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${noteTab === 'settings' ? settingsHTML() : `${giftsHTML()}${h && noteTab !== 'trades' ? `<div class="nt-hunt"><div><span class="live-chip sm">● PRIDE HUNT</span><b>${esc(h.name)}</b><i class="nt-hp"><i style="width:${pct}%"></i></i></div><button class="v2-btn gold" data-act="Hunt">⚔ Hunt</button></div>` : ''}
    <div class="nt-list" id="ntList">
      ${todays.length ? `<div class="side-h">Today</div>${todays.map(row).join('')}` : ''}
      ${earlier.length ? `<div class="side-h">Earlier</div>${earlier.map(row).join('')}` : ''}
      ${list.length || noteGifts.length ? '' : '<p class="v2-empty">Nothing here yet.</p>'}
    </div>`}`;
  el('ntClose').addEventListener('click', closeNotifsV2);
  el('ntRead')?.addEventListener('click', async () => {
    try { await ctx().apiPost('/api/notifications/read', {}); } catch { /* keep */ }
    noteItems = noteItems.map((x) => ({ ...x, read: true })); ctx().updateNotifBadge(0); paintNotifs();
  });
  box.querySelectorAll('.nt-tabs button').forEach((b) => b.addEventListener('click', () => { noteTab = b.dataset.t; paintNotifs(); if (noteTab === 'settings' && !pingPrefs) loadPingPrefs(); }));
  box.querySelector('.ps-list')?.addEventListener('change', savePingPref);
  box.querySelectorAll('.gf-redeem').forEach((b) => b.addEventListener('click', () => redeem(b, [Number(b.dataset.id)])));
  box.querySelector('.gf-all')?.addEventListener('click', (e) => redeem(e.currentTarget, noteGifts.map((g) => g.id)));
  box.onclick = onNoteAct;
  requestAnimationFrame(() => fitChildren(el('ntList')));
}
// A row action (v2 and v3): Hunt, Open, View, Auction, Confirm.
function onNoteAct(e) {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    closeNotifsV2();
    const act = a.dataset.act;
    if (act === 'Hunt') ctx().show('battling');
    else if (act === 'Open') ctx().openPacks();
    else if (act === 'View') { tr.tab = 'trades'; ctx().show('trading'); }
    // An auction note: My auctions; "Confirm" opens the auction that waits for my confirm.
    else if (act === 'Auction' || act === 'Confirm') {
      Object.assign(hallState, { sub: 'auctions', aview: 'mine', auction: null, start: null, sel: null, listing: false, page: 0, openAccepted: act === 'Confirm' });
      tr.tab = 'hall'; ctx().show('trading');
    }
}

// ---- The v3 bell (UI-24, src/ui3/bell.js): the same data, Claim calls and actions, the approved layout ----
let bellT = null;
function bellResize() { clearTimeout(bellT); bellT = setTimeout(() => { if (!ctx().el('v2Notifs')?.classList.contains('hidden')) paintBellV3(); }, 120); }
function paintBellV3() {
  const { el, apiPost } = ctx();
  const box = el('v2Notifs');
  if (!box) return;
  const r = paintBell(box, {
    tab: noteTab, items: noteItems, gifts: noteGifts, hunt: noteHunt, unread: noteItems.filter((x) => !x.read).length,
    giftError: bell3.giftError, page: bell3.page, expanded: bell3.expanded, size: document.body.dataset.size || '', now: Date.now(),
    kindOf: noteKind, strip: stripEmoji, ago: ctx().ago, thumb, coin: COIN, rarityLabel: (k) => ctx().RARITY_LABEL[k] || k,
    settings: noteTab === 'settings' ? settingsHTML() : null, focus: bell3.focus ?? null,
  });
  bell3.focus = null;
  bell3.pages = r.pages;
  if (r.page) bell3.page = r.page;
  box.querySelector('[data-close]')?.addEventListener('click', closeNotifsV2);
  box.querySelector('[data-read]')?.addEventListener('click', async () => {
    try { await apiPost('/api/notifications/read', {}); } catch { /* keep */ }
    noteItems = noteItems.map((x) => ({ ...x, read: true })); ctx().updateNotifBadge(noteGifts.length); paintNotifs();
  });
  box.querySelectorAll('.u3-bell__tabs [data-t]').forEach((b) => b.addEventListener('click', () => {
    noteTab = b.dataset.t; bell3.page = 1; paintNotifs(); if (noteTab === 'settings' && !pingPrefs) loadPingPrefs();
  }));
  box.querySelector('.ps-list')?.addEventListener('change', savePingPref);
  box.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => redeem(b, [Number(b.dataset.claim)])));
  box.querySelector('[data-claimall]')?.addEventListener('click', (e) => redeem(e.currentTarget, noteGifts.map((g) => g.id)));
  box.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
    const p = Math.min(bell3.pages, Math.max(1, bell3.page + (b.dataset.page === 'next' ? 1 : -1)));
    if (p !== bell3.page) { bell3.page = p; paintNotifs(); }
  }));
  // 10.4: a tap on a row shows its full text in place (and a second tap shortens it again)
  box.querySelectorAll('.u3-note__main').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.closest('[data-note]').dataset.note);
    if (bell3.expanded.has(id)) bell3.expanded.delete(id); else bell3.expanded.add(id);
    bell3.focus = id;
    paintNotifs();
    el('v2Notifs')?.querySelector(`[data-note="${id}"] .u3-note__main`)?.focus();
  }));
  box.onclick = onNoteAct;
}

// ---- Gifts to redeem (Nathan, 2026-10-01): the New Player Bonus, the Launch Day gift,
// member gifts and promos wait here; Redeem adds the packs to the OPEN balance. ----
function giftsHTML() {
  if (!noteGifts.length) return '';
  const total = noteGifts.filter((g) => g.kind !== 'card').reduce((n, g) => n + g.amount, 0);
  // A card gift (launch_event_cards.sql): its card art and rarity, not a pack count.
  const what = (g) => (g.kind === 'card' && g.card
    ? `<span class="gf-card" style="color:var(--r-${esc(g.card.rarity)})">${esc(ctx().RARITY_LABEL[g.card.rarity] || g.card.rarity)} card</span>`
    : `<span>${[g.amount ? `${g.amount} pack${g.amount === 1 ? '' : 's'}` : '', g.shards ? `<b class="gf-shards">${COIN}${Number(g.shards).toLocaleString()} Shards</b>` : ''].filter(Boolean).join(' + ')}</span>`);
  const ico = (g) => (g.kind === 'card' && g.card?.image_url ? `<img class="gf-img" src="${thumb(g.card.image_url)}" data-full="${esc(g.card.image_url)}" alt="">` : g.shards && !g.amount ? `<span class="gf-ico gf-coin">${COIN}</span>` : '<span class="gf-ico">🎁</span>');
  return `<div class="gf-list"><div class="side-h">Gifts to redeem${noteGifts.length > 1 ? `<button class="v2-btn gold gf-all">Redeem all${total ? ` +${total}` : ''}</button>` : ''}</div>
    ${noteGifts.map((g) => `<div class="gf-row">${ico(g)}<div class="gf-t"><b>${esc(g.title)}</b>${what(g)}</div>
      <button class="v2-btn gold gf-redeem" data-id="${g.id}">Redeem</button></div>`).join('')}</div>`;
}
async function redeem(btn, ids) {
  btn.disabled = true;
  let r = null;
  try { r = await ctx().apiPost('/api/gifts/claim', { ids }); } catch { r = null; }
  if (r?.ok) {
    const cards = noteGifts.filter((g) => ids.includes(g.id) && g.kind === 'card' && g.card); // played below
    noteGifts = noteGifts.filter((g) => !ids.includes(g.id));
    const parts = [r.packs ? `+${r.packs} pack${r.packs === 1 ? '' : 's'}` : '', r.shards ? `+${Number(r.shards).toLocaleString()} Shards` : ''].filter(Boolean);
    if (parts.length) toast(`🎁 ${parts.join(' · ')}`); // a card gift has its animation, not a toast
    if (r.shards) refreshShards();
    ctx().refreshPacks?.();
    if (r.cards) ctx().refreshOwned().catch(() => {}); // in the background: the animation starts at once
    for (const g of cards) await playGiftFx({ card: g.card, from: g.from_name, esc, label: (k) => ctx().RARITY_LABEL?.[k] || k, sfx: ctx().sfx });
    bell3.giftError = false;
  } else {
    bell3.giftError = true; // v3: the inline error under the gifts head (7.3); v2 shows nothing (as before)
    try { noteGifts = (await ctx().api('/api/notifications')).gifts || []; } catch { /* keep */ }
  }
  ctx().updateNotifBadge(noteGifts.length + noteItems.filter((x) => !x.read).length);
  paintNotifs();
}

// ---- Settings: which bot channel posts may ping me (notify_prefs.sql) ----
function settingsHTML() {
  if (!pingPrefs) return '<div class="v2-loading">Loading…</div>';
  const all = pingPrefs.all !== false;
  const row = (k, label, on, off) => `<label class="ps-row${off ? ' off' : ''}"><span>${label}</span>
    <input type="checkbox" data-k="${k}"${on ? ' checked' : ''}${off ? ' disabled' : ''}><i class="ps-sw"></i></label>`;
  return `<div class="ps-list"><div class="side-h">Discord pings</div>
    ${row('all', 'Pings on', all, false)}
    ${PING_ROWS.map(([k, l]) => row(k, l, all && pingPrefs[k] !== false, !all)).join('')}
    <div class="side-h">Discord posts</div>
    ${row('playing', 'Show when I play', pingPrefs.playing !== false, false)}</div>`;
}
async function loadPingPrefs() {
  try { pingPrefs = (await ctx().api('/api/notify-prefs')).prefs || {}; } catch { pingPrefs = {}; }
  if (noteTab === 'settings') paintNotifs();
}
async function savePingPref(e) {
  const k = e.target?.dataset?.k;
  if (!k) return;
  const before = { ...pingPrefs };
  pingPrefs = { ...pingPrefs, [k]: e.target.checked };
  paintNotifs();
  let r = null;
  try { r = await ctx().apiPost('/api/notify-prefs', { prefs: pingPrefs }); } catch { r = null; }
  if (!r?.ok) { pingPrefs = before; paintNotifs(); }
}

// ---- Leaderboard (design 12) ------------------------------------------------------

const METRICS = [
  { key: 'power', label: 'Collection Power', icon: '⚡', col: 'Power' },
  { key: 'huntDamage', label: 'Hunt damage', icon: '⚔', col: 'Hunt dmg', short: true },
  { key: 'bosses', label: 'Bosses downed', icon: '💀', col: 'Bosses' },
  { key: 'cards', label: 'Cards', icon: '📚', col: 'Cards' },
  { key: 'achievements', label: 'Achievements', icon: '🏆', col: 'Ach.' },
];
const board = { metric: 'power', data: null, back: 'home' };

export function openLeaderboardV2() {
  const c = ctx();
  if (c.currentView() !== 'leaderboard') board.back = c.currentView();
  c.show('leaderboard');
}

export async function renderLeaderboardV2() {
  const { el, api } = ctx();
  el('main').innerHTML = '<div class="v2-loading">Loading…</div>';
  try { board.data = await api('/api/leaderboard/v2'); } catch { board.data = null; }
  if (ctx().currentView() !== 'leaderboard') return;
  paintBoard();
}

function ranked(rows, key) { return [...rows].sort((a, b) => (b[key] || 0) - (a[key] || 0) || a.name.localeCompare(b.name)); }

function paintBoard() {
  const { el } = ctx();
  const d = board.data;
  if (!d || d.error) { el('main').innerHTML = '<p class="v2-empty">The leaderboard is not available.</p>'; return; }
  const m = METRICS.find((x) => x.key === board.metric);
  const rows = ranked(d.rows, m.key);
  const meIdx = rows.findIndex((r) => r.id === d.me);
  const val = (r, mm = m) => (mm.key === 'cards' ? `${fmt(r.cards)}/${fmt(d.totalCards)}` : mm.key === 'achievements' ? `${r.achievements}/${d.achievementCount}` : mm.short ? short(r[mm.key]) : fmt(r[mm.key]));
  const pod = [rows[1], rows[0], rows[2]].map((r, i) => (r ? `<div class="lb-pod p${[2, 1, 3][i]}${r.id === d.me ? ' me' : ''}" data-member="${esc(r.id)}">
      ${avatarHTML(r.id, r.name, 'big', r.frame)}<span class="lb-place">${[2, 1, 3][i]}</span><b class="lb-name">${nameBadge(r.id, r.name, isPhone())}</b>${titleHTML(r.title)}
      <span class="lb-val">${m.icon} ${val(r)}</span>
      <span class="lb-sub">⚔ ${short(r.huntDamage)} · 💀 ${r.bosses} · 📚 ${r.cards}</span></div>` : '<div class="lb-pod empty"></div>')).join('');
  const line = (r, i) => `<div class="lb-row${r.id === d.me ? ' me' : ''}" data-member="${esc(r.id)}"><span class="lb-i mono">${i + 1}</span>
      <span class="lb-p">${avatarHTML(r.id, r.name, 'sm', r.frame)}<b>${nameBadge(r.id, r.name, isPhone())}</b>${titleHTML(r.title)}${r.id === d.me ? '<i class="you">You</i>' : ''}</span>
      ${METRICS.map((mm) => `<span class="lb-c mono${mm.key === m.key ? ' on' : ''}">${val(r, mm)}</span>`).join('')}</div>`;
  // The top 10 at most (Nathan, 2026-10-01: "the most it can show is the top 10"): the podium
  // is 1-3, the table 4-10. Your own row is pinned only when you are outside the top 10.
  const rest = rows.slice(3, 10);
  const pinMe = meIdx >= 10;

  // The right column: my ranks + the live hunt.
  const me = rows[meIdx];
  const above = meIdx > 0 ? rows[meIdx - 1] : null;
  const gap = above && me ? (above[m.key] || 0) - (me[m.key] || 0) : 0;
  const progress = above && me && above[m.key] ? Math.round((100 * (me[m.key] || 0)) / above[m.key]) : 100;
  const tiles = METRICS.map((mm) => {
    const r = ranked(d.rows, mm.key).findIndex((x) => x.id === d.me);
    return `<div class="lb-tile${mm.key === m.key ? ' on' : ''}"><span class="lb-tr">${r >= 0 ? `#${r + 1}` : '—'}</span><b>${me ? val(me, mm) : '—'}</b><span>${mm.icon} ${esc(mm.label)}</span></div>`;
  }).join('');
  const live = d.live;
  const liveRows = live ? live.leaders.slice(0, 4) : [];
  const liveMe = live ? live.leaders.findIndex((x) => String(x.player_id) === d.me) : -1;
  const maxLive = Math.max(1, ...(live?.leaders || []).map((x) => Number(x.damage)));
  const lrow = (x, i) => `<div class="lb-live${String(x.player_id) === d.me ? ' me' : ''}"><span class="mono">${i + 1}</span>${avatarHTML(x.player_id, x.username, 'sm')}<b>${nameBadge(x.player_id, x.username)}</b><span class="mono">${fmt(x.damage)}</span><i class="lb-lbar"><i style="width:${Math.round((100 * x.damage) / maxLive)}%"></i></i></div>`;

  el('main').innerHTML = `<div class="v2-board">
    <section class="lb-main">
      <div class="lb-head"><button class="v2-icon" id="lbBack" aria-label="Back">←</button><h2>Leaderboard</h2></div>
      <div class="lb-tabs">${METRICS.map((mm) => `<button class="lb-tab${mm.key === m.key ? ' on' : ''}" data-m="${mm.key}">${mm.icon} <span class="lt-l">${esc(mm.label)}</span><span class="lt-c">${esc(mm.col)}</span></button>`).join('')}</div>
      <div class="lb-podium">${pod}</div>
      <div class="lb-table">
        <div class="lb-row lb-th"><span class="lb-i">#</span><span class="lb-p">Player</span>${METRICS.map((mm) => `<span class="lb-c${mm.key === m.key ? ' on' : ''}">${mm.key === m.key ? '▾ ' : ''}${esc(mm.col)}</span>`).join('')}</div>
        <div class="lb-rows" id="lbRows">${rest.map((r, i) => line(r, i + 3)).join('') || '<p class="v2-empty">More players show here once they open packs.</p>'}</div>
        ${pinMe ? `<div class="lb-pin">${line(me, meIdx)}</div>` : ''}
      </div>
    </section>
    <aside class="lb-side">
      <div class="v2-tile lb-mine">
        <div class="prof-head">${avatarHTML(d.me, me?.name || ctx().user()?.name, 'big')}<div><h3>${esc(me?.name || ctx().user()?.name || '')}</h3><span class="dim">${esc(m.label)}</span></div>
          <b class="lb-rank">${meIdx >= 0 ? `#${meIdx + 1}` : '—'}</b></div>
        ${above ? `<div class="lb-to"><span>To #${meIdx}</span><b class="mono">${m.short ? short(gap) : fmt(gap)}</b></div><i class="lb-tobar"><i style="width:${progress}%"></i></i>` : (meIdx === 0 ? '<div class="lb-to"><span>You lead this board</span></div>' : '')}
        <div class="lb-tiles">${tiles}</div>
      </div>
      <div class="v2-tile lb-hunt">${live ? `<div class="tile-h"><b>⚔ ${esc(live.name)}</b><span class="grow"></span><span class="live-chip sm">● LIVE</span></div>
        <div class="side-h">Top damage</div>
        <div class="lb-lives">${liveRows.map(lrow).join('') || '<p class="v2-empty">No attacks yet.</p>'}${liveMe >= 4 ? lrow(live.leaders[liveMe], liveMe) : ''}</div>`
        : '<div class="tile-h"><b>⚔ Pride Hunt</b></div><p class="v2-empty">No boss is live.</p>'}</div>
    </aside>
  </div>`;
  el('lbBack').addEventListener('click', () => ctx().show(board.back || 'home'));
  el('main').querySelectorAll('.lb-tab').forEach((b) => b.addEventListener('click', () => { board.metric = b.dataset.m; paintBoard(); }));
  el('main').querySelector('.v2-board').addEventListener('click', (e) => { const t = e.target.closest('[data-member]'); if (t) openMember(t.dataset.member); });
  requestAnimationFrame(() => {
    const rows = el('lbRows');
    fitChildren(rows);
    // A phone shows fewer rows: when my row did not fit, it takes the last place (my rank stays on screen).
    if (isPhone() && rows && me && meIdx >= 3 && !pinMe && !rows.querySelector('.lb-row.me') && rows.lastElementChild) rows.lastElementChild.outerHTML = line(me, meIdx);
    // The live tile: only the rows that fit (my 4th-place row showed cut in half, 2026-10-02); when my
    // row does not fit, it takes the last place, like the table.
    const lives = el('main').querySelector('.lb-lives');
    if (lives && liveMe >= 0) {
      fitChildren(lives);
      if (!lives.querySelector('.lb-live.me') && lives.lastElementChild) lives.lastElementChild.outerHTML = lrow(live.leaders[liveMe], liveMe);
    } else if (lives) fitChildren(lives);
  });
}

// ---- Trading, with Gift inside (designs 14 + 13) ----------------------------------------

// respond: the incoming offer I pick my card for (two-step trades, trade_two_step.sql).
export const tr = { tab: 'trades', mode: 'offer', giftKind: 'card', to: null, give: null, get: null, side: 'mine', filter: 'all', q: '', page: 0, members: [], theirs: {}, offers: null, msg: '', respond: null };
// The trades that wait for ME: an offer to pick a card for, or a pick to accept.
export const tradeActions = (d) => (d?.incoming || []).filter((o) => o.status !== 'countered').length + (d?.outgoing || []).filter((o) => o.status === 'countered').length;

// A profile's Trade button (and its "You need" cards): the Community trade screen with that member
// picked. It opened the OLD trade builder (the sender picked their card too), 2026-10-01.
export function openTradeWith(to) {
  Object.assign(tr, { tab: 'trades', mode: 'offer', to: { id: String(to.id), name: to.name }, give: null, get: null, respond: null, page: 0, msg: '', v3from: true });
  ctx().show('trading');
}

// Live offers (Nathan, 2026-10-01: an accepted offer stayed on screen until he left the view).
// The poll in main.js hands the fresh /api/trades here; a change repaints the trade screen
// (takeFocus/keepFocus keep a search box), and a finished offer refreshes my cards.
export async function liveTrades(d) {
  if (!d || d.error || ctx().currentView() !== 'trading' || (tr.tab !== 'trades' && tr.tab !== 'hall')) return;
  if (JSON.stringify(d) === JSON.stringify(tr.offers)) return;
  const ids = (x) => new Set([...(x?.incoming || []), ...(x?.outgoing || [])].map((o) => Number(o.id)));
  const now = ids(d);
  const gone = [...ids(tr.offers)].some((id) => !now.has(id)); // accepted, declined or cancelled
  tr.offers = d;
  if (tr.respond && !(d.incoming || []).some((o) => Number(o.id) === Number(tr.respond.id) && o.status !== 'countered')) { tr.respond = null; tr.give = null; }
  if (gone) { try { await ctx().refreshOwned(); } catch { /* keep */ } }
  if (ctx().currentView() === 'trading' && tr.tab === 'trades') paintTrade();
  else if (ctx().currentView() === 'trading' && tr.tab === 'hall') repaintHall();
}

export async function renderTradingV2() {
  const { el, api } = ctx();
  el('main').innerHTML = '<div class="v2-loading">Loading…</div>';
  await ensureCatalog();
  const [players, offers] = await Promise.all([api('/api/players').catch(() => ({ players: [] })), api('/api/trades').catch(() => ({})), V3() ? loadPartnersV3() : null]);
  // v3: the Trades tab opens the Member picker (UI-65), except when a profile's Trade button chose the member
  tr.v3pick = !tr.v3from; tr.v3from = false;
  if (!ctx().cache.collection) { try { await ctx().refreshOwned(); } catch { /* keep */ } }
  if (ctx().currentView() !== 'trading') return;
  const me = String(ctx().user()?.id || '');
  const voice = (ctx().live.presence || []).filter((p) => String(p.id) !== me).map((p) => ({ id: String(p.id), name: p.name, voice: true }));
  const rest = (players.players || []).filter((p) => !voice.some((v) => v.id === String(p.id))).map((p) => ({ id: String(p.id), name: p.username }));
  tr.members = [...voice, ...rest];
  tr.offers = offers;
  if (tr.to && !tr.members.some((m) => m.id === tr.to.id)) tr.members.unshift(tr.to); // opened from a profile
  if (!tr.to && tr.members[0]) tr.to = tr.members[0];
  if (tr.to) await loadTheirs(tr.to.id);
  if (ctx().hallOn?.() && tr.tab !== 'hall') prefetchHall();
  if (tr.tab === 'effects' && ctx().effectsEnabled?.()) { await loadFx(); paintEffects(); } else if (tr.tab === 'hall' && ctx().hallOn?.()) await renderHall(); else { tr.tab = 'trades'; paintTrade(); }
}

// The Community sub-tabs (design 16): Trades, Boons & Pranks (only while effects are on).
export function commTabs() {
  const fx = ctx().effectsEnabled?.();
  // Portrait (design 25): the trophy moves from the top bar into Community, the same button.
  const board = isPort() ? '<button class="v2-icon" id="commBoard" title="Leaderboard">🏆</button>' : '';
  const hall = ctx().hallOn?.() ? `<button data-tab="hall" class="${tr.tab === 'hall' ? 'on' : ''}">🏠<span class="bt"> Hall</span></button>` : '';
  return board + `<div class="seg" id="commTabs"><button data-tab="trades" class="${tr.tab === 'trades' ? 'on' : ''}">⇄<span class="bt"> Trades</span></button>${hall}${fx ? `<button data-tab="effects" class="${tr.tab === 'effects' ? 'on' : ''}">✨<span class="bt"> Boons</span><span class="ct-more"> & Pranks</span></button>` : ''}</div>`;
}
export function wireCommTabs() {
  ctx().el('commBoard')?.addEventListener('click', () => ctx().el('boardBtn')?.click());
  ctx().el('commTabs')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    // v3: Trades again, from the trade builder, goes back to the Member picker (UI-65)
    if (b.dataset.tab === tr.tab) { if (V3() && tr.tab === 'trades' && !tr.v3pick) { tr.v3pick = true; tr.respond = null; paintTrade(); } return; }
    dropPickerV3();
    tr.tab = b.dataset.tab; tr.page = 0; tr.msg = '';
    if (tr.tab === 'effects') { await loadFx(); paintEffects(); } else if (tr.tab === 'hall') await renderHall(); else paintTrade();
  });
}

async function loadTheirs(id) {
  if (tr.theirs[id]) return;
  try {
    const d = await ctx().api(`/api/player-cards?id=${encodeURIComponent(id)}`);
    tr.theirs[id] = (d.cards || []).map((c) => ({ ...c, owned: true, locked: false }));
  } catch { tr.theirs[id] = []; }
}

const base = () => new Map((ctx().cache.catalog?.cards || []).map((c) => [c.id, c]));
function withBase(c, b) { const x = b.get(c.id) || {}; return { ...x, ...c, power: c.power ?? x.power, tags: c.tags || x.tags, num: c.num || 0 }; }

function gridItems() {
  const b = base();
  const mine = (ctx().cache.collection?.cards || []).map((c) => withBase({ ...c, owned: true, locked: false }, b));
  // Two-step trades (Nathan, 2026-10-01): a member only ever picks from their OWN cards. The old
  // flow (the sender also picked the card they get) is gone, on every screen (2026-10-01).
  let items = mine;
  if (tr.mode === 'gift') items = items.filter((c) => c.tradeable !== false && c.rarity !== 'gold'); // gifts: no Gold, no locked cards
  if (tr.mode === 'offer') items = items.filter((c) => c.tradeable !== false);
  // Picking my card for an incoming offer: the same rarity, not the card they offer.
  if (tr.respond) items = items.filter((c) => c.rarity === tr.respond.offer?.rarity && Number(c.id) !== Number(tr.respond.offer?.id));
  if (tr.filter === 'dupes') items = items.filter((c) => (c.quantity || 0) > 1);
  if (tr.filter === 'rare') items = items.filter((c) => c.rarity !== 'normal');
  const q = tr.q.trim().toLowerCase();
  if (q) items = items.filter((c) => [c.name, c.subject, ...(c.tags?.traits || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
  return items.sort((a, b) => ((b.quantity || 0) > 1) - ((a.quantity || 0) > 1) || (b.power || 0) - (a.power || 0));
}

function slotHTML(c, who, empty) {
  if (!c) return `<div class="tr-slot empty"><span>${esc(empty)}</span></div><div class="tr-info tr-empty"><span class="tr-who">${who}</span><h3>${esc(empty)}</h3></div>`;
  return `<div class="tr-slot r-${c.rarity}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""></div>
    <div class="tr-info"><span class="tr-who">${who}</span><h3>${isPhone() ? breakable(esc(c.name)) : esc(c.name)}</h3><span class="tr-rar" style="color:var(--r-${c.rarity})">◆ ${esc(ctx().RARITY_LABEL[c.rarity] || c.rarity)}</span>
      <span class="tr-chips"><i>⚡ ${fmt(c.power)}</i>${c.quantity ? `<i>×${c.quantity}</i>` : ''}</span></div>`;
}

// The Offers panel (Trades and the Trading Hall show the same one): the rows that wait for ME first.
export function offersAsideHTML() {
  const inc = [...(tr.offers?.incoming || [])].sort((x, y) => (x.status === 'countered') - (y.status === 'countered'));
  const out = [...(tr.offers?.outgoing || [])].sort((x, y) => (y.status === 'countered') - (x.status === 'countered'));
  const offerCard = (c, tag) => (c ? `<div class="of-card"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""><span>${tag}</span></div>` : '');
  return `    <aside class="tr-offers v2-tile">
      <div class="tile-h"><b>Offers</b>${tradeActions(tr.offers) ? `<span class="nt-count">${tradeActions(tr.offers)}</span>` : ''}</div>
      <div class="side-h">Incoming <span class="n">${inc.length}</span></div>
      <div class="of-list" id="ofIn">${inc.map((o) => {
        // An offer to answer: pick my card. My pick sent: wait for them. An old offer: accept.
        const decline = `<button class="v2-btn of-decline" data-id="${o.id}" title="Decline">✕<span class="of-t"> Decline</span></button>`;
        const acts = o.status === 'countered'
          ? `<span class="of-wait dim">Waiting<span class="of-wn"> for ${esc(o.from_name || 'them')}</span></span>${decline}`
          : o.request
            ? `<button class="v2-btn gold of-accept" data-id="${o.id}">✓ Accept</button>${decline}`
            : `<button class="v2-btn gold of-pick" data-id="${o.id}">Pick your card</button>${decline}`;
        return `<div class="of-row${tr.respond && Number(tr.respond.id) === Number(o.id) ? ' on' : ''}"><div class="of-who">${avatarHTML(o.from_id, o.from_name, 'xs')}<b>${nameBadge(o.from_id, o.from_name || 'Someone', isPhone())}</b></div>
        <div class="of-cards">${offerCard(o.offer, 'Get')}${o.request ? `<span>⇄</span>${offerCard(o.request, 'Give')}` : ''}</div>
        <div class="of-acts">${acts}</div></div>`;
      }).join('') || '<p class="v2-empty">No incoming offers.</p>'}</div>
      <div class="side-h">Sent <span class="n">${out.length}</span></div>
      <div class="of-list" id="ofOut">${out.map((o) => `<div class="of-row sent"><div class="of-who">${avatarHTML(o.to_id, o.to_name, 'xs')}<b>${nameBadge(o.to_id, o.to_name || 'Someone', isPhone())}</b><span class="dim">${o.status === 'countered' ? 'Picked a card' : o.request ? 'Waiting' : 'Picking a card'}</span></div>
        <div class="of-cards">${offerCard(o.offer, 'Give')}${o.request ? `<span>⇄</span>${offerCard(o.request, 'Get')}` : ''}</div>
        ${o.status === 'countered' ? `<div class="of-acts"><button class="v2-btn gold of-accept" data-id="${o.id}">✓ Accept</button><button class="v2-icon of-cancel" data-id="${o.id}" title="Cancel">✕</button></div>` : `<button class="v2-icon of-cancel" data-id="${o.id}" title="Cancel">✕</button>`}</div>`).join('') || '<p class="v2-empty">No sent offers.</p>'}</div>
    </aside>`;
}
// Its buttons. "Pick your card" opens Trades (the pick happens there); the rest repaint this screen.
export function wireOffers(main, repaint) {
  main.querySelectorAll('.of-pick').forEach((b) => b.addEventListener('click', () => {
    tr.respond = (tr.offers?.incoming || []).find((o) => Number(o.id) === Number(b.dataset.id)) || null;
    tr.tab = 'trades'; tr.mode = 'offer'; tr.give = null; tr.page = 0; tr.msg = '';
    paintTrade();
  }));
  main.querySelectorAll('.of-accept').forEach((b) => b.addEventListener('click', () => { b.disabled = true; resolve('/api/trade/accept', { offerId: Number(b.dataset.id) }, repaint); }));
  main.querySelectorAll('.of-decline').forEach((b) => b.addEventListener('click', () => resolve('/api/trade/resolve', { offerId: Number(b.dataset.id), action: 'decline' }, repaint)));
  main.querySelectorAll('.of-cancel').forEach((b) => b.addEventListener('click', () => resolve('/api/trade/resolve', { offerId: Number(b.dataset.id), action: 'cancel' }, repaint)));
}

// A repaint replaces the search boxes. On a phone that closed the keyboard and lost the text
// (Nathan, 2026-10-01): take the focused box before the repaint and give it back after.
function takeFocus() {
  const a = document.activeElement;
  return a && (a.id === 'trFind' || a.id === 'trQ') ? { id: a.id, at: a.selectionStart } : null;
}
function keepFocus(f) {
  const n = f && document.getElementById(f.id);
  if (!n) return;
  n.focus({ preventScroll: true });
  try { n.setSelectionRange(f.at ?? n.value.length, f.at ?? n.value.length); } catch { /* not a text box */ }
}

// Find a member (both Community screens; Nathan, 2026-10-02: "as people type it should auto
// suggest people whose names match"): the matching members show in a list under the box, the
// best match first; a tap (or Enter = the first) picks the member to trade with or play on.
// The list is on the body (no panel clips it); a repaint shows it again (tr.sugg).
let findTimer = null, findSeq = 0;
function closeSuggest() { tr.sugg = null; document.getElementById('trSuggest')?.remove(); }
function showSuggest(box, list, q, pick) {
  document.getElementById('trSuggest')?.remove();
  if (!box.isConnected || !list) return;
  const r = box.getBoundingClientRect();
  const w = Math.min(innerWidth - 12, Math.max(r.width, 240));
  const left = Math.max(6, Math.min(r.left, innerWidth - w - 6));
  const lo = q.toLowerCase();
  const mark = (n) => { const i = n.toLowerCase().indexOf(lo); return i < 0 ? esc(n) : `${esc(n.slice(0, i))}<b>${esc(n.slice(i, i + q.length))}</b>${esc(n.slice(i + q.length))}`; };
  const rows = list.length ? list.map((m, i) => `<button class="sg-row" data-i="${i}">${avatarHTML(m.id, m.name, 'xs')}<span>${mark(m.name)}</span></button>`).join('')
    : '<p class="sg-none">No member with that name</p>';
  document.body.insertAdjacentHTML('beforeend', `<div class="sg-list" id="trSuggest" role="listbox" style="left:${left}px;top:${Math.round(r.bottom + 4)}px;width:${Math.round(w)}px">${rows}</div>`);
  // pointerdown keeps the box focused; the pick waits for the click. (A pick on pointerdown removed
  // the list, and the tap's click then landed on the member button under it: a wrong member.)
  const el = document.getElementById('trSuggest');
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.sg-row');
    if (b) pick(list[Number(b.dataset.i)]);
  });
}
function wireFind(after) {
  const box = ctx().el('trFind');
  if (!box) return;
  const pick = async (m) => {
    closeSuggest(); tr.find = '';
    tr.members = [m, ...tr.members.filter((x) => x.id !== m.id)]; tr.to = m;
    await after();
  };
  if (tr.sugg && (tr.find || '').trim()) requestAnimationFrame(() => showSuggest(box, tr.sugg, tr.find.trim(), pick));
  box.addEventListener('input', (e) => {
    tr.find = e.target.value;
    clearTimeout(findTimer);
    const q = tr.find.trim();
    if (!q) { closeSuggest(); return; }
    const seq = ++findSeq;
    findTimer = setTimeout(async () => {
      try {
        const d = await ctx().api(`/api/players?q=${encodeURIComponent(q)}`);
        if (seq !== findSeq) return; // a newer letter is on its way
        tr.sugg = (d.players || []).slice(0, 6).map((p) => ({ id: String(p.id), name: p.username }));
        showSuggest(ctx().el('trFind') || box, tr.sugg, q, pick);
      } catch { /* keep */ }
    }, 150);
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSuggest();
    if (e.key === 'Enter' && tr.sugg?.[0]) { e.preventDefault(); pick(tr.sugg[0]); }
  });
  box.addEventListener('blur', () => setTimeout(() => { if (document.activeElement?.id !== 'trFind') closeSuggest(); }, 250));
}

// ---- v3 (body.ui-v3 only): the Trades tab opens with the Member picker (UI-65, D-43, 6.5b) ----
// A tap on a member opens the trade builder with that member (the v2 builder until the Trade window UI-63 is built);
// the magnifier opens the profile; Pending opens the builder, where the offers are (until UI-25 builds Pending).
const V3 = () => document.body.classList.contains('ui-v3');
let mpV3 = null, partnersV3 = null;
function dropPickerV3() { mpV3?.destroy(); mpV3 = null; dropPendingV3(); boonsRO?.disconnect(); boonsRO = null; closeBoonsSheet(); }
async function loadPartnersV3() {
  try { partnersV3 = (await ctx().api('/api/trade/partners')).partners || []; } catch { partnersV3 = partnersV3 || []; }
}
function sectionsV3(history = partnersV3) {
  const me = String(ctx().user()?.id || '');
  const l = memberLists({ history: history || [], voice: tr.members.filter((m) => m.voice), all: tr.members.filter((m) => !m.voice), me });
  // Few partners (D-64 item 5): In voice first, then All members with the Pager. "Few" = less than one full line of
  // 5 tiles (UI-25 review-2 proposal 1, open for Nathan).
  const few = l.frequent.length + l.recent.length < 5;
  return [
    ...(few ? [{ key: 'voice', label: 'In voice', members: l.voice }] : []),
    { key: 'frequent', label: 'Frequent', members: l.frequent },
    { key: 'recent', label: 'Recent', members: l.recent },
    ...(few ? [{ key: 'all', label: 'All members', members: l.all, form: 'list', paged: true }] : []),
  ];
}
function paintMemberPickerV3() {
  const main = ctx().el('main');
  if (mpV3 && main.querySelector('.u3-trades #u3TradesPick')) { mpV3.update({ sections: sectionsV3() }); paintPendingV3(); return; }
  dropPickerV3();
  main.innerHTML = `<div class="u3-trades">${commTabs()}<div class="u3-trades__cols"><section class="u3-trades__panel" id="u3TradesPick"></section>`
    + '<aside class="u3-pd u3-trades__pending" id="u3Pd" aria-label="Pending"><div class="u3-pd__body" id="u3PdSide"></div></aside><span class="u3-trades__probe" aria-hidden="true"></span></div></div>';
  wireCommTabs();
  mpV3 = mountMemberPicker(ctx().el('u3TradesPick'), {
    sections: sectionsV3(),
    lead: explainBtn('trades'),
    trail: button3({ label: 'Pending', data: { pending: '1' } }),
    search: async (q) => ((await ctx().api(`/api/players?q=${encodeURIComponent(q)}`)).players || []).map((p) => ({ id: String(p.id), name: p.username })),
    onPick: async (m) => {
      closePendingUi();
      tr.members = [m, ...tr.members.filter((x) => x.id !== m.id)];
      Object.assign(tr, { to: m, get: null, give: null, msg: '', v3pick: false });
      await loadTheirs(m.id);
      paintTrade();
    },
    onProfile: (m) => openMember(m.id),
  });
  mountPendingV3(main);
  maybeExplain('trades');
}

// ---- UI-25 Pending (D-32, D-35; approved frames in the design repo UI-25/approved) ----
// Medium and expanded: the side panel (stacked under the picker when there is no room for both); compact-port and
// compact-land: the Pending button opens it as a sheet. A row opens the Offer view. Decline and Cancel wait 8 s with
// "Undo" (7.4, D-10, D-64 item 7): the server has no undo, so the call goes out when the 8 s end.
const UNDO_MS = 8000;
const pd = { hidden: new Set(), pageIn: 0, pageOut: 0, ro: null, timers: new Map(), toastT: 0, onClick: null, onKey: null };
const pdAvatar = (id, name) => `<span class="u3-mp-av u3-pd-av" aria-hidden="true"><span>${esc(String(name || '?').trim().charAt(0).toUpperCase() || '?')}</span><img src="/api/avatar/${esc(id)}" alt="" data-err="remove"></span>`;
const pdH = { thumb, avatar: pdAvatar };
const pdLists = () => pendingLists(tr.offers, pd.hidden);

function mountPendingV3(main) {
  const cols = main.querySelector('.u3-trades__cols');
  pd.onClick = (e) => onPdClick(e);
  pd.onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.u3-pd-scrim')) { e.preventDefault(); closeViewV3(); } else if (document.querySelector('.u3-pd-sheet')) { e.preventDefault(); closeSheetV3(); }
  };
  document.addEventListener('click', pd.onClick);
  document.addEventListener('keydown', pd.onKey);
  // the layout reads the panel itself (F-1: no window size): side by side when there is room, else stacked
  pd.ro = new ResizeObserver(() => { layoutPendingV3(); paintPendingV3(); });
  pd.ro.observe(cols);
  pd.ro.observe(main.querySelector('#u3PdSide'));
  document.fonts?.ready.then(() => { if (pd.ro) { layoutPendingV3(); paintPendingV3(); } });
  layoutPendingV3();
  paintPendingV3();
}
function dropPendingV3() {
  pd.ro?.disconnect(); pd.ro = null;
  if (pd.onClick) document.removeEventListener('click', pd.onClick);
  if (pd.onKey) document.removeEventListener('keydown', pd.onKey);
  pd.onClick = pd.onKey = null;
  closePendingUi();
}
function closePendingUi() { closeViewV3(); closeSheetV3(); }
function layoutPendingV3() {
  const cols = document.querySelector('.u3-trades__cols');
  const probe = cols?.querySelector('.u3-trades__probe');
  if (!cols || !probe) return;
  cols.classList.toggle('is-stack', cols.clientWidth < probe.offsetWidth);   // the probe is as wide as the picker minimum + the panel (CSS)
}
// Fit: all rows first, then fewer rows in the longer section (a pager under it); a mode that still does not fit takes
// the next form: is-tight = the pager in the head line of its section, is-tight2 = small cards and a one-line row.
const PD_MODES = [[], ['is-tight'], ['is-tight', 'is-tight2']];
function fitPendingV3(box) {
  const lists = pdLists();
  let perIn = lists.inc.length, perOut = lists.out.length;
  const draw = (mode) => {
    box.classList.remove('is-tight', 'is-tight2');
    box.classList.add(...mode);
    box.innerHTML = headHTML(box.id === 'u3PdSheet' ? 0 : waiting(lists), box.id === 'u3PdSheet') + sectionsHTML({ ...lists, perIn, perOut, pageIn: pd.pageIn, pageOut: pd.pageOut }, pdH);
    // a long name first gets smaller (to 11 px), then wraps at its break points; never cut (D-08)
    for (const n of box.querySelectorAll('.u3-pd-row__name')) {
      let k = 0;
      while (n.scrollWidth > n.clientWidth + 0.5 && k < 4) n.dataset.shrink = String(++k);
    }
    return box.scrollHeight <= box.clientHeight + 0.5;
  };
  for (const mode of PD_MODES) {
    perIn = lists.inc.length; perOut = lists.out.length;
    for (let g = 0; g < 40; g += 1) {
      if (draw(mode)) return;
      if (perIn >= perOut && perIn > 1) perIn -= 1;
      else if (perOut > 1) perOut -= 1;
      else if (perIn > 1) perIn -= 1;
      else break;
    }
  }
}
function paintPendingV3() {
  const lists = pdLists();
  const n = waiting(lists);
  const btn = document.querySelector('.u3-mp__tools [data-pending]');
  if (btn) {
    const has = btn.querySelector('.u3-dot');
    if (n && !has) btn.insertAdjacentHTML('beforeend', dot3(`${n} waiting`));
    if (!n && has) has.remove();
  }
  const side = document.getElementById('u3PdSide');
  if (side && side.getClientRects().length) fitPendingV3(side);
  const sh = document.getElementById('u3PdSheet');
  if (sh) fitPendingV3(sh);
  // the head of a sheet is the sheet header: it shows the count beside the title
  const t = document.querySelector('.u3-pd-sheet .u3-sheet__title');
  if (t) { t.querySelector('.u3-counter')?.remove(); if (n) t.insertAdjacentHTML('beforeend', counter3(n)); }
}
function openSheetV3() {
  if (document.querySelector('.u3-pd-sheet')) return;
  const side = document.body.dataset.size === 'compact-port' ? 'bottom' : 'side';
  document.body.insertAdjacentHTML('beforeend', sheet3({ side, title: 'Pending', body: '<div class="u3-pd__body u3-pd__body--sheet" id="u3PdSheet"></div>' }));
  const sh = [...document.querySelectorAll('.u3-sheet')].pop();
  sh?.classList.add('u3-pd-sheet');
  pd.pageIn = 0; pd.pageOut = 0;
  const body = document.getElementById('u3PdSheet');
  if (pd.ro && body) pd.ro.observe(body);
  paintPendingV3();
  sh?.querySelector('.u3-ibtn')?.focus({ preventScroll: true });
}
function closeSheetV3() {
  const s = document.querySelector('.u3-pd-sheet');
  if (!s) return;
  const b = document.getElementById('u3PdSheet');
  if (pd.ro && b) pd.ro.unobserve(b);
  s.closest('[data-u3-scrim]')?.remove();
  document.querySelector('.u3-mp__tools [data-pending]')?.focus({ preventScroll: true });
}
function closeViewV3() { document.querySelector('.u3-pd-scrim')?.remove(); }
const findOffer = (id) => {
  const i = (tr.offers?.incoming || []).find((o) => Number(o.id) === Number(id));
  if (i) return { o: i, dir: 'in' };
  const o = (tr.offers?.outgoing || []).find((x) => Number(x.id) === Number(id));
  return o ? { o, dir: 'out' } : null;
};
function openViewV3(id) {
  const f = findOffer(id);
  if (!f) return;
  closeViewV3();
  document.body.insertAdjacentHTML('beforeend', viewHTML(f.o, f.dir, pdH));
  document.querySelector('.u3-pd-view .u3-ibtn')?.focus({ preventScroll: true });
}
function undoToastV3(text, onUndo) {
  document.getElementById('u3PdToast')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="u3PdToast" class="u3-pd-toast">${toast3({ kind: 'info', text, action: 'Undo' })}</div>`);
  const host = document.getElementById('u3PdToast');
  host.querySelector('.u3-toast__action').addEventListener('click', () => { host.remove(); clearTimeout(pd.toastT); onUndo(); });
  clearTimeout(pd.toastT);
  pd.toastT = setTimeout(() => host.remove(), UNDO_MS);
}
function errorToastV3() {
  document.getElementById('u3PdToast')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="u3PdToast" class="u3-pd-toast">${toast3({ kind: 'error', text: 'Something went wrong. Try again.' })}</div>`);
  clearTimeout(pd.toastT);
  pd.toastT = setTimeout(() => document.getElementById('u3PdToast')?.remove(), 4000);
}
// Decline or cancel: the row leaves now, the call goes out when the undo window ends.
function removeWithUndoV3(id, action) {
  pd.hidden.add(id);
  closeViewV3();
  paintPendingV3();
  const timer = setTimeout(async () => {
    pd.timers.delete(id);
    let r = null;
    try { r = await ctx().apiPost('/api/trade/resolve', { offerId: id, action }); } catch { r = null; }
    await refreshOffers();
    pd.hidden.delete(id);
    if (!r?.ok) errorToastV3();
    if (ctx().currentView() === 'trading' && tr.tab === 'trades' && tr.v3pick && !tr.respond && mpV3) paintPendingV3();
  }, UNDO_MS);
  pd.timers.set(id, timer);
  undoToastV3(action === 'decline' ? 'Offer declined' : 'Offer cancelled', () => { clearTimeout(timer); pd.timers.delete(id); pd.hidden.delete(id); paintPendingV3(); });
}
function onPdClick(e) {
  const t = e.target.closest('button, [data-u3-scrim]');
  if (!t) return;
  if (t.matches('[data-pending]') && t.closest('.u3-mp__tools')) { openSheetV3(); return; }
  const inSheet = t.closest('.u3-pd-sheet');
  if (inSheet && t.closest('.u3-sheet__head') && !t.dataset.act) { closeSheetV3(); return; }
  if (t.matches('[data-u3-scrim]')) {
    if (e.target === t) { if (t.classList.contains('u3-pd-scrim')) closeViewV3(); else if (t.querySelector('.u3-pd-sheet')) closeSheetV3(); }
    return;
  }
  const pg = t.closest('.u3-pd-sec__pager') && t.dataset.page;
  if (pg) {
    const key = t.closest('.u3-pd-sec').dataset.sec === 'in' ? 'pageIn' : 'pageOut';
    pd[key] = Math.max(0, pd[key] + (pg === 'next' ? 1 : -1));
    paintPendingV3();
    return;
  }
  const act = t.dataset.act;
  if (!act || !(t.closest('.u3-pd') || inSheet || t.closest('.u3-pd-scrim'))) return;
  if (act === 'close') { closeViewV3(); return; }
  const id = Number(t.dataset.id);
  if (act === 'view') { openViewV3(id); return; }
  if (act === 'decline' || act === 'cancel') { removeWithUndoV3(id, act); return; }
  if (act === 'accept') { t.disabled = true; closeViewV3(); closeSheetV3(); resolve('/api/trade/accept', { offerId: id }, paintTrade); return; }
  if (act === 'pick') {
    const f = findOffer(id);
    if (!f) return;
    closePendingUi();
    tr.respond = f.o; tr.tab = 'trades'; tr.mode = 'offer'; tr.give = null; tr.page = 0; tr.msg = '';
    paintTrade();
  }
}

function paintTrade() {
  if (V3() && tr.tab === 'trades' && tr.v3pick && !tr.respond) { paintMemberPickerV3(); return; }
  dropPickerV3();
  const { el } = ctx();
  const focus = takeFocus();
  const toName = tr.to?.name || 'a member';
  // My Live in voice tile (design 19): once I pick a card, who I trade with and the two cards.
  if (tr.tab === 'trades' && tr.mode === 'offer') {
    const c = [tr.give?.id, tr.get?.id].map(Number).filter(Boolean);
    if (c.length) ctx().status?.('trading', { t: tr.to?.name, c, s: 'building' });
    else if (tr.sent) ctx().status?.('trading', { t: tr.sent.name, c: tr.sent.c, s: 'sent' });
  }
  const packs = ctx().packs();
  const me = ctx().user();
  let composer;
  const rar = (c) => esc(ctx().RARITY_LABEL[c?.rarity] || c?.rarity || '');
  const aRar = (c) => `${/^[aeiou]/i.test(ctx().RARITY_LABEL[c?.rarity] || '') ? 'an' : 'a'} ${rar(c)}`;
  if (tr.respond) {
    // Step 2: I pick the card I give back for an incoming offer (the same rarity).
    const o = tr.respond;
    composer = `<div class="tr-deal">
        <div class="tr-side">${slotHTML(o.offer, `${avatarHTML(o.from_id, o.from_name, 'xs')} <span class="tr-wn">${esc(o.from_name || 'They')}</span> gives`, '')}</div>
        <span class="tr-swap">⇄</span>
        <div class="tr-side right">${slotHTML(tr.give, `${avatarHTML(me?.id, me?.name, 'xs')} You give`, `Pick ${aRar(o.offer)}`)}</div>
      </div>
      <div class="tr-foot">
        <span class="grow"></span><span class="tr-msg" id="trMsg">${esc(tr.msg)}</span>
        <button class="v2-btn" id="trClear">✕ Back</button><button class="v2-btn gold" id="trSend" ${tr.give ? '' : 'disabled'}>➤ Send my card</button></div>`;
  } else if (tr.mode === 'offer') {
    // Step 1: I offer one card; the other member picks theirs (Nathan, 2026-10-01).
    composer = `<div class="tr-deal">
        <div class="tr-side">${slotHTML(tr.give, `${avatarHTML(me?.id, me?.name, 'xs')} You give`, 'Pick your card')}</div>
        <span class="tr-swap">⇄</span>
        <div class="tr-side right tr-to"><div class="tr-info"><span class="tr-who">To</span><h3>${esc(toName)}</h3>${tr.give ? `<span class="tr-rar" style="color:var(--r-${tr.give.rarity})">Picks ${aRar(tr.give)}</span>` : ''}</div>${avatarHTML(tr.to?.id, toName, 'huge')}</div>
      </div>
      <div class="tr-foot">
        <span class="grow"></span><span class="tr-msg" id="trMsg">${esc(tr.msg)}</span>
        <button class="v2-btn" id="trClear">↺ Clear</button><button class="v2-btn gold" id="trSend" ${tr.give && tr.to ? '' : 'disabled'}>➤ Send offer</button></div>`;
  } else {
    const pack = tr.giftKind === 'pack';
    composer = `<div class="tr-deal">
        <div class="tr-side">${pack
          ? `<div class="tr-slot pack"><span>👑</span><b>Season 1</b></div><div class="tr-info"><span class="tr-who">You give</span><h3>1 pack</h3><span class="tr-chips"><i>🎴 ${packs} → ${Math.max(0, packs - 1)}</i></span></div>`
          : slotHTML(tr.give, `${avatarHTML(me?.id, me?.name, 'xs')} You give`, 'Pick a card to gift')}</div>
        <span class="tr-swap">→</span>
        <div class="tr-side right tr-to"><div class="tr-info"><span class="tr-who">To</span><h3>${esc(toName)}</h3></div>${avatarHTML(tr.to?.id, toName, 'huge')}</div>
      </div>
      <div class="tr-foot"><div class="seg" id="trGiftKind"><button data-k="card" class="${pack ? '' : 'on'}">Card</button><button data-k="pack" class="${pack ? 'on' : ''}">Pack</button></div>
        <span class="grow"></span><span class="tr-msg" id="trMsg">${esc(tr.msg)}</span>
        <button class="v2-btn" id="trClear">↺ Clear</button><button class="v2-btn gold" id="trSend" ${tr.to && (pack ? packs > 0 : tr.give) ? '' : 'disabled'}>🎁 Send gift</button></div>`;
  }
  const mineN = (ctx().cache.collection?.cards || []).length;
  const packMode = tr.mode === 'gift' && tr.giftKind === 'pack';
  el('main').innerHTML = `<div class="v2-trade${packMode ? ' pack-mode' : ''}${tr.respond ? ' responding' : ''}">
    <section class="tr-main">
      <div class="tr-top">${commTabs()}${explainBtn('trades')}${V3() && tr.tab === 'trades' && !tr.respond ? button3({ label: 'Members', icon: 'chevron-left', data: { backpick: '1' } }) : ''}<span class="grow"></span>
        <div class="seg" id="trMode"><button data-m="offer" class="${tr.mode === 'offer' ? 'on' : ''}">⇄ Offer</button><button data-m="gift" class="${tr.mode === 'gift' ? 'on' : ''}">🎁 Gift</button></div></div>
      <div class="tr-members" id="trMembers"><span class="side-h">To</span>
        ${tr.members.map((p) => `<button class="tr-mem${tr.to?.id === p.id ? ' on' : ''}" data-id="${esc(p.id)}">${avatarHTML(p.id, p.name, 'xs')}<span>${nameBadge(p.id, p.name, isPhone())}</span>${p.voice ? '<i class="tr-live"></i>' : ''}</button>`).join('')}
        <span class="grow"></span><input class="v2-search tr-find" id="trFind" placeholder="${isPhone() ? 'Find' : 'Find a member'}" value="${esc(tr.find || '')}"></div>
      <div class="tr-compose">${composer}</div>
      <div class="tr-gridhead">
        <div class="seg"><button class="on">Your cards <b>${mineN}</b></button></div>
        <input class="v2-search" id="trQ" placeholder="${isPhone() ? 'Search' : 'Search cards, tags…'}" value="${esc(tr.q)}">
        <span class="grow"></span>
        <div class="seg" id="trFilter">${[['all', 'All'], ['dupes', 'Dupes'], ['rare', 'Rare+']].map(([v, l]) => `<button data-f="${v}" class="${tr.filter === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="v2-pager" id="trPager"></div>
      </div>
      <div class="v2-grid" id="trGrid"></div>
    </section>
    ${offersAsideHTML()}
  </div>`;

  wireCommTabs();
  // Grid
  const items = gridItems();
  const pickId = tr.give?.id;
  const onPick = (c) => {
    tr.msg = '';
    {
      tr.give = c;
    }
    paintTrade();
  };
  paintCards(el('trGrid'), el('trPager'), items, tr, onPick, pickId);

  // Controls
  const main = el('main');
  el('trMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; tr.mode = b.dataset.m; tr.side = 'mine'; tr.give = null; tr.get = null; tr.respond = null; tr.page = 0; tr.msg = ''; paintTrade(); };
  el('trGiftKind')?.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; tr.giftKind = b.dataset.k; tr.msg = ''; paintTrade(); });
  el('trFilter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; tr.filter = b.dataset.f; tr.page = 0; paintTrade(); };
  el('trQ').addEventListener('input', (e) => { tr.q = e.target.value; tr.page = 0; paintCards(el('trGrid'), el('trPager'), gridItems(), tr, onPick, pickId); });
  el('trMembers').onclick = async (e) => {
    const b = e.target.closest('.tr-mem'); if (!b) return;
    tr.to = tr.members.find((p) => p.id === b.dataset.id) || tr.to; tr.get = null; tr.msg = '';
    await loadTheirs(tr.to.id); paintTrade();
  };
  wireFind(async () => { await loadTheirs(tr.to.id); paintTrade(); });
  // v3: back to the Member picker (UI-65; Nathan 2026-10-08), not the v1 member search
  main.querySelector('[data-backpick]')?.addEventListener('click', () => { tr.v3pick = true; tr.respond = null; paintTrade(); });
  el('trClear').addEventListener('click', () => { tr.give = null; tr.get = null; tr.side = 'mine'; tr.respond = null; tr.page = 0; tr.msg = ''; paintTrade(); });
  // Pick my card for an incoming offer: the grid shows my cards of that rarity.
  el('trSend').addEventListener('click', send);
  wireOffers(main, paintTrade);
  keepFocus(focus);
  requestAnimationFrame(() => { fitChildren(el('ofIn')); fitChildren(el('ofOut')); if (isLand()) fitColumn(el('trMembers')); else fitRow(el('trMembers'), el('trFind')); });
  // A phone held sideways: the page arrows sit in the middle of the top row, over the ? circle.
  placeExplain(main, '.tr-gridhead', 'm-land');
  maybeExplain('trades');
}

// Recent plays: only whole rows. A phone with no room for one row hides the list and its head.
function fitRecent() {
  const box = ctx().el('fxRecent'), head = ctx().el('fxRecentH');
  if (!box || !isPhone()) { if (box) fitChildren(box); return; }
  const bottom = box.getBoundingClientRect().bottom + 1;
  while (box.lastElementChild && box.lastElementChild.getBoundingClientRect().bottom > bottom) box.lastElementChild.remove();
  if (!box.children.length) { box.hidden = true; if (head) head.hidden = true; }
}

// No cut chips: drop the member chips that do not fully fit left of the search box.
// A phone: the member list is a column. The members that do not fit go (the picked one stays).
function fitColumn(col) {
  if (!col) return;
  const bottom = () => col.getBoundingClientRect().bottom - 8;
  for (;;) {
    const all = [...col.querySelectorAll('.tr-mem')];
    if (all.length < 2 || all[all.length - 1].getBoundingClientRect().bottom <= bottom()) break;
    const last = [...col.querySelectorAll('.tr-mem:not(.on)')].pop();
    if (!last) break;
    last.remove();
  }
}
function fitRow(row, stop) {
  if (!row || !stop) return;
  const right = () => row.getBoundingClientRect().right - 10;
  while (stop.getBoundingClientRect().right > right()) {
    const last = [...row.querySelectorAll('.tr-mem:not(.on)')].pop();
    if (!last) break;
    last.remove();
  }
}

async function send() {
  const { apiPost } = ctx();
  const btn = ctx().el('trSend');
  if (btn) btn.disabled = true;
  let r = null;
  try {
    if (tr.respond) r = await apiPost('/api/trade/counter', { offerId: tr.respond.id, cardId: tr.give.id });
    else if (tr.mode === 'offer') r = await apiPost('/api/trade/offer', { toId: tr.to.id, offerCardId: tr.give.id });
    else if (tr.giftKind === 'pack') r = await apiPost('/api/gift', { toId: tr.to.id, amount: 1 });
    else r = await apiPost('/api/trade/gift', { toId: tr.to.id, cardId: tr.give.id });
  } catch { r = null; }
  const responding = tr.respond;
  if (r?.ok) {
    tr.msg = responding ? `Card sent. ${responding.from_name || 'They'} accepts next.` : tr.mode === 'offer' ? `Offer sent to ${tr.to.name}` : `Gift sent to ${tr.to.name}`;
    tr.respond = null;
    if (tr.mode === 'offer' && !responding) tr.sent = { name: tr.to.name, c: [tr.give?.id, tr.get?.id].map(Number).filter(Boolean) };
    tr.give = null; tr.get = null; tr.side = 'mine';
    delete tr.theirs[tr.to.id];
    await Promise.all([ctx().refreshOwned(), ctx().refreshPacks?.()]);
    await refreshOffers();
  } else {
    tr.msg = responding ? 'Could not send that card (it may be in another offer).' : tr.mode === 'offer' ? 'Could not send the offer (the card may be in another offer).' : 'Could not send the gift.';
  }
  paintTrade();
}
export async function refreshOffers() {
  try { tr.offers = await ctx().api('/api/trades'); } catch { /* keep */ }
  ctx().updateTradeBadge?.(tradeActions(tr.offers));
}
async function resolve(path, body, repaint = paintTrade) {
  const accepting = path.endsWith('accept');
  // I can be either side: an old offer to me, or my offer that the other member answered.
  const all = [...(tr.offers?.incoming || []).map((o) => ({ o, mine: false })), ...(tr.offers?.outgoing || []).map((o) => ({ o, mine: true }))];
  const hit = accepting ? all.find((x) => Number(x.o.id) === Number(body.offerId)) : null;
  const offer = hit?.o || null;
  let r = null;
  try { r = await ctx().apiPost(path, body); } catch { r = null; }
  tr.msg = r?.ok ? '' : 'That did not work. Try again.';
  // The swap went through: play the trade while the collection and the offers reload.
  const fx = r?.ok && offer?.offer && offer?.request
    ? playTradeFx({ give: hit.mine ? offer.offer : offer.request, get: hit.mine ? offer.request : offer.offer, esc, label: (k) => ctx().RARITY_LABEL?.[k] || k, sfx: ctx().sfx })
    : null;
  if (r?.ok && accepting) await ctx().refreshOwned();
  tr.theirs = {};
  if (tr.to) await loadTheirs(tr.to.id);
  await refreshOffers();
  await fx;
  repaint();
}


// ---- Boons & Pranks (design 16) -------------------------------------------------------------
const fx = { pick: null, filter: 'all', page: 0, onTarget: [], recent: [], msg: '' };
const pretty = (p) => String(p || '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const kindOf = (c) => effectScaled(c).kind || 'neutral';

async function loadFx() {
  const { api } = ctx();
  const [st, on, rec] = await Promise.all([
    reloadEffects(),
    tr.to ? api(`/api/effects/on?id=${encodeURIComponent(tr.to.id)}`).catch(() => ({ active: [] })) : { active: [] },
    api('/api/effects/recent').catch(() => ({ plays: [] })),
  ]);
  fx.onTarget = on.active || [];
  fx.recent = rec.plays || [];
  return st;
}

function fxCards() {
  const b = new Map((ctx().cache.catalog?.cards || []).map((c) => [c.id, c]));
  return (ctx().cache.collection?.cards || []).filter((c) => c.effect?.primitive)
    .map((c) => ({ ...(b.get(c.id) || {}), ...c, owned: true, locked: false }))
    .filter((c) => fx.filter === 'all' || kindOf(c) === fx.filter)
    .sort((a, b) => (effectReadyIn(a) > 0) - (effectReadyIn(b) > 0) || (b.power || 0) - (a.power || 0));
}

// What happened to a play, in plain words for the sender (Nathan, 2026-10-03: "make the results
// clearer"). The outcomes of play_card_effect: applied, blocked, reflected, decoyed, redirected, delayed.
const OUTCOME_LABEL = { blocked: 'Blocked', reflected: 'Reflected', decoyed: 'Decoyed', redirected: 'Redirected', delayed: 'Delayed 1 h' };
function resultText(r, to, voice) {
  const other = r.target && String(r.target) !== String(to.id) ? (tr.members.find((m) => String(m.id) === String(r.target))?.name || 'another member') : null;
  switch (r.outcome) {
    case 'blocked': return `${to.name}'s ward blocked it.`;
    case 'reflected': return 'It bounced back to you!';
    case 'decoyed': return `${to.name}'s decoy took the hit.`;
    case 'redirected': return `It was redirected to ${other || 'another member'}.`;
    case 'delayed': return `It lands on ${to.name} in 1 hour.`;
    default: return voice ? `Played on ${to.name}. It waits until they join voice (1 hour max).` : `Played on ${to.name}.`;
  }
}

// ---- v3 (body.ui-v3 only): the Boons tab (UI-27, D-42, D-43, D-62) ----
// The Member picker (UI-65), then the Card picker (UI-64) with only effect cards, then Confirm plays the card (the play confirm
// window UI-28 comes later). "On you" and "Recent plays" are a side panel (expanded), a panel under the picker (medium) or a
// sheet behind the "On you" button (compact). The server rules and routes are the same as v2 (play_card_effect).
let boonsRO = null;
const bn = { page: { on: 0, rec: 0 }, msgKind: 'success' };
const KIND_ICON3 = { boon: 'gift', prank: 'drama', shield: 'shield-check' };
const avatarSrc = (id) => `/api/avatar/${encodeURIComponent(id)}`;
const whoHTML = (id, name) => `<span class="u3-bn-who"><span class="u3-mp-av" aria-hidden="true"><span>${esc(String(name || '?').trim().charAt(0).toUpperCase() || '?')}</span><img src="${esc(avatarSrc(id))}" alt="" draggable="false"></span><span class="u3-bn-who__name">${breakName(name || 'Member')}</span></span>`;

function boonsRows() {
  const st = effectState();
  const now = Date.now();
  const on = (st.active || []).map((e) => {
    const k = kindName(st.primitives?.[e.primitive]?.kind);
    const leftMs = e.expires_at ? new Date(e.expires_at) - now : null;
    return `<li class="u3-bn-row u3-bn-on k-${k}"><span class="u3-bn-ico">${icon3('sparkles', { size: 'lg' })}</span>`
      + `<span class="u3-bn-main"><span class="u3-bn-name">${esc(pretty(e.primitive))}${e.options?.test ? ' <i class="u3-bn-test">TEST</i>' : ''}</span><span class="u3-bn-sub">${esc(e.card?.name || '')}</span>`
      + `${progressLinear({ value: leftPct(e.duration_s, e.expires_at, now) / 100 })}</span>`
      + `<span class="u3-bn-left">${leftMs != null ? esc(fmtDur(leftMs / 1000)) : ''}</span></li>`;
  });
  const rec = fx.recent.map((r) => {
    const k = kindName(r.kind);
    return `<li class="u3-bn-row u3-bn-rec k-${k}"><span class="u3-bn-pair">${[[r.from_id, r.from], [r.to_id, r.to]].map(([id, n]) => `<span class="u3-mp-av" aria-hidden="true"><span>${esc(String(n || '?').charAt(0).toUpperCase())}</span><img src="${esc(avatarSrc(id))}" alt="" draggable="false"></span>`).join('')}</span>`
      + `<span class="u3-bn-main"><span class="u3-bn-name">${breakName(r.from || 'Someone')} ${icon3('arrow-right', { size: 'sm' })} ${breakName(r.to || 'Someone')}</span>`
      + `<span class="u3-bn-kind">${icon3(KIND_ICON3[k] || 'sparkles', { size: 'sm' })}<span>${esc(OUTCOME_LABEL[r.outcome] || pretty(r.primitive))}</span></span></span>`
      + `<span class="u3-bn-left">${esc(ctx().ago(r.at))}</span></li>`;
  });
  return { on, rec };
}
// the two lists of the panel (the side panel, the panel under the picker, the sheet); fillBoons() puts the rows in
function boonsPanelHTML({ sheet = false } = {}) {
  const n = (effectState().active || []).length;
  const head = (t, tail) => `<header class="u3-bn-head"><h3 class="u3-bn-title">${t}</h3>${tail}</header>`;
  return `<div class="u3-bn-panel${sheet ? ' u3-bn-panel--sheet' : ''}">`
    + `<section class="u3-bn-sec" data-sec="on">${sheet ? '' : head('On you', `<span class="u3-bn-count">${n}</span>`)}<ul class="u3-bn-list" data-list="on"></ul><div class="u3-bn-pager" data-pager="on"></div></section>`
    + `<section class="u3-bn-sec" data-sec="rec">${head('Recent plays', `<span class="u3-bn-live">${dot3()}<span>LIVE</span></span>`)}<ul class="u3-bn-list" data-list="rec"></ul><div class="u3-bn-pager" data-pager="rec"></div></section></div>`;
}
// No scroll (3.4): the rows that fit the list, the rest on pages (the Pager, D-36). A page with no pager when all rows fit.
function fillBoons(root) {
  if (!root?.isConnected) return;
  const rows = boonsRows();
  const secs = ['on', 'rec'].map((key) => {
    const sec = root.querySelector(`[data-sec="${key}"]`);
    return sec && { key, sec, ul: sec.querySelector('.u3-bn-list'), pg: sec.querySelector('.u3-bn-pager'), all: rows[key] };
  }).filter(Boolean);
  // the height each section needs with all its rows and no pager; the panel gives each what it needs, and the one that
  // needs more than half gets the rest (so one row of "On you" does not leave a gap, and the long list pages)
  for (const s of secs) {
    s.sec.style.flex = '0 0 auto'; s.pg.hidden = true; s.pg.innerHTML = '';
    s.ul.innerHTML = s.all.length ? s.all.join('') : `<li class="u3-bn-none">${s.key === 'on' ? 'Nothing is active on you.' : 'No plays yet.'}</li>`;
    s.need = s.sec.offsetHeight;
  }
  const gap = parseFloat(getComputedStyle(root).rowGap) || 0;
  const avail = root.clientHeight;
  if (secs.length === 2 && secs[0].need + secs[1].need + gap > avail) {
    const first = Math.min(secs[0].need, Math.max((avail - gap) / 2, avail - gap - secs[1].need));
    secs[0].sec.style.flex = `0 0 ${Math.floor(first)}px`;
    secs[1].sec.style.flex = '1 1 0';
  }
  for (const s of secs) {
    const { key, ul, pg, all } = s;
    if (!all.length) continue;
    const fits = (per) => { ul.innerHTML = all.slice(0, per).join(''); return ul.scrollHeight <= ul.clientHeight + 0.5; };
    let per = 1;
    while (per < all.length && fits(per + 1)) per += 1;   // all rows without the pager, else the most that fit
    if (per < all.length) {
      pg.hidden = false; pg.innerHTML = pager3({ page: 1, pages: 2 });   // the pager takes its height; measure again with it
      per = 1;
      while (per < all.length && fits(per + 1)) per += 1;
    }
    const pgs = pageOf(all, per, bn.page[key]);
    bn.page[key] = pgs.page;
    ul.innerHTML = pgs.rows.join('');
    if (!pg.hidden) pg.innerHTML = pager3({ page: pgs.page + 1, pages: pgs.pages });
  }
}
function wireBoonsPanel(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.u3-bn-pager [data-page]');
    if (!b) return;
    const key = b.closest('[data-pager]').dataset.pager;
    bn.page[key] += b.dataset.page === 'next' ? 1 : -1;
    fillBoons(root);
  });
  const ro = new ResizeObserver(() => fillBoons(root));
  ro.observe(root);
  document.fonts?.ready.then(() => fillBoons(root));
  return ro;
}
let sheetKey = null, sheetRO = null;
function closeBoonsSheet() {
  sheetRO?.disconnect(); sheetRO = null;
  document.getElementById('u3BoonsSheet')?.remove();
  if (sheetKey) { document.removeEventListener('keydown', sheetKey); sheetKey = null; }
}
function openBoonsSheet() {
  closeBoonsSheet();
  const n = (effectState().active || []).length;
  const side = document.body.dataset.size === 'compact-land' ? 'side' : 'bottom';
  document.body.insertAdjacentHTML('beforeend', `<div class="u3-scrim" id="u3BoonsSheet" data-u3-scrim><aside class="u3-sheet u3-sheet--${side} u3-bn-sheet" role="dialog" aria-modal="true" aria-labelledby="u3BnT">`
    + `<header class="u3-sheet__head"><h2 class="u3-sheet__title" id="u3BnT">On you <span class="u3-bn-count">${n}</span></h2>${iconButton({ icon: 'x', label: 'Close', data: { bnclose: '1' } })}</header>`
    + `${boonsPanelHTML({ sheet: true })}</aside></div>`);
  const host = document.getElementById('u3BoonsSheet');
  host.addEventListener('click', (e) => { if (e.target === host || e.target.closest('[data-bnclose]')) closeBoonsSheet(); });
  sheetKey = (e) => { if (e.key === 'Escape') closeBoonsSheet(); };
  document.addEventListener('keydown', sheetKey);
  sheetRO = wireBoonsPanel(host.querySelector('.u3-bn-panel'));
  fillBoons(host.querySelector('.u3-bn-panel'));
  host.querySelector('[data-bnclose]')?.focus({ preventScroll: true });
}

// The Card picker for one member: only effect cards (D-42), the kind switch All / Boon / Prank / Shield, one card, Confirm plays it.
function openBoonCards(to) {
  const st = effectState();
  const me = ctx().user();
  const b = base();
  const cards = (ctx().cache.collection?.cards || []).filter((c) => c.effect?.primitive).map((c) => ({ ...(b.get(c.id) || {}), ...c, owned: true, locked: false }));
  const rars = [...new Set(cards.map((c) => c.rarity))];
  const caps = st.caps || {};
  const used = st.playsToday || 0, cap = st.sendCap || 0;
  const dayOver = !!cap && used >= cap;
  const find = (id) => cards.find((c) => Number(c.id) === Number(id));
  // why the pick cannot be played on this member now (the counts of play_card_effect)
  const whyNot = (c) => {
    if (!c) return 'Pick an effect card';
    if (dayOver) return `You played your ${cap} cards today.`;
    const mr = memberReason(to, { pairs: st.pairs, caps });
    if (mr) return mr;
    if (kindOf(c) === 'prank' && caps.prank_recv_per_day && (st.pranked?.[String(to.id)] || 0) >= caps.prank_recv_per_day) return `${to.name} got ${caps.prank_recv_per_day} pranks today.`;
    if (['discord', 'voice'].includes(st.primitives?.[c.effect?.primitive]?.channel) && (st.immune || []).includes(String(to.id))) return `Discord cannot change the server owner: pick an in-game card for ${to.name}.`;
    return '';
  };
  openCardPicker({
    title: `Play a card on ${to.name}`, cap: 1, single: true, cls: 'u3-pk--boons', cards,
    head: `${whoHTML(me?.id, me?.name)}<span class="u3-bn-arrow">${icon3('arrow-right', { size: 'lg' })}</span>${whoHTML(to.id, to.name)}`,
    kinds: KINDS,
    filters: [{ key: 'rarity', label: 'Rarity', value: 'all', clear: 'all', options: [{ id: 'all', label: 'All' }, ...rars.map((r) => ({ id: r, label: ctx().RARITY_LABEL?.[r] || r }))] }],
    filterCount: (v) => (v.rarity && v.rarity !== 'all' ? 1 : 0),
    apply: (list, values, q) => pickerCards(list, values, q, kindOf, effectReadyIn),
    blocked: (c) => (!effectScaled(c).enabled ? 'Unlocks soon' : effectReadyIn(c) > 0 ? `Ready in ${fmtDur(effectReadyIn(c))}` : ''),
    badge: (c) => (effectReadyIn(c) > 0 ? fmtDur(effectReadyIn(c)) : ''),
    status: (sel) => { const c = find(sel[0]); const why = whyNot(c); return { checks: why && c ? [{ ok: false, label: why }] : [], ready: !!c && !why, reason: why || 'Pick an effect card' }; },
    detail: (c) => ctx().openViewer?.(c),
    returnFocus: document.querySelector('.u3-mp-tile__pick'),
    onConfirm: async (sel) => {
      const card = find(sel[0]);
      if (!card) return false;
      const voice = effectState().primitives?.[card.effect?.primitive]?.channel === 'voice';
      const r = await playCard(card, to.id);
      fx.msg = r?.ok ? resultText(r, to, voice) : effectError(r?.error);
      bn.msgKind = r?.ok ? 'success' : 'error';
      await loadFx();
      paintBoonsV3();
      return true;
    },
  });
}

function paintBoonsV3() {
  const { el } = ctx();
  const main = el('main');
  dropPickerV3();
  const st = effectState();
  const me = String(ctx().user()?.id || '');
  const cap = st.sendCap || 0, used = st.playsToday || 0;
  const resetIn = st.dayEnds ? Math.max(0, (new Date(st.dayEnds) - Date.now()) / 1000) : 0;
  const limit = dayLine({ cap, used, resetIn }, fmtDur);
  const today = (cls) => (cap ? `<div class="u3-bn-today u3-bn-today--${cls}${used >= cap ? ' is-full' : ''}"><span class="u3-bn-today__label">Plays today</span>${progressLinear({ value: used / cap, label: 'Plays today' })}<b class="u3-bn-today__n">${used}/${cap}</b></div>` : '');
  const note = limit ? `<p class="u3-bn-note u3-bn-note--limit">${icon3('circle-alert')}<span>${esc(limit)}</span></p>` : fx.msg ? inlineMessage({ kind: bn.msgKind, text: fx.msg }) : '';
  main.innerHTML = `<div class="u3-trades u3-boons">${commTabs()}<div class="u3-boons__body">`
    + `<section class="u3-trades__panel u3-boons__pick" id="u3BoonsPick"></section>`
    + `<aside class="u3-trades__panel u3-boons__side" aria-label="On you and Recent plays">${boonsPanelHTML()}</aside></div></div>`;
  wireCommTabs();
  mpV3 = mountMemberPicker(el('u3BoonsPick'), {
    sections: sectionsV3(playHistory(fx.recent, me)),
    lead: explainBtn('pranks'),
    trail: `${today('tools')}<button type="button" class="u3-btn u3-btn--secondary u3-btn--md u3-bn-onyou" data-onyou="1"><span class="u3-btn__label">On you</span>${counter3((st.active || []).length, { neutral: true })}</button>`,
    labelTail: today('row'),
    meta: note,
    search: async (q) => ((await ctx().api(`/api/players?q=${encodeURIComponent(q)}`)).players || []).map((p) => ({ id: String(p.id), name: p.username })),
    blocked: (m) => memberReason(m, { pairs: st.pairs, caps: st.caps }),
    onPick: (m) => {
      tr.members = [m, ...tr.members.filter((x) => x.id !== m.id)];
      tr.to = m; fx.msg = '';
      openBoonCards(m);
    },
    onProfile: (m) => openMember(m.id),
  });
  main.querySelector('[data-onyou]')?.addEventListener('click', openBoonsSheet);
  const side = main.querySelector('.u3-boons__side .u3-bn-panel');
  boonsRO = wireBoonsPanel(side);
  fillBoons(side);
  maybeExplain('pranks');
}

function paintEffects() {
  if (V3()) { paintBoonsV3(); return; }
  const { el } = ctx();
  const focus = takeFocus();
  const st = effectState();
  const toName = tr.to?.name || 'a member';
  const c = fx.pick;
  const cap = st.sendCap || 0;
  const used = st.playsToday || 0;
  const left = cap ? Math.max(0, cap - used) : null;
  // The limits made visible (Nathan, 2026-10-03): why a member, or the Play button, is blocked now.
  // The same counts play_card_effect uses (pair_per_day by aimed_at, prank_recv_per_day by target).
  const caps = st.caps || {};
  const pickKind = c ? kindOf(c) : null;
  const discordPick = !!c && ['discord', 'voice'].includes(st.primitives?.[c.effect?.primitive]?.channel);
  const blockOf = (p) => {
    if (!p) return '';
    if (caps.pair_per_day && (st.pairs?.[String(p.id)] || 0) >= caps.pair_per_day) return `You played ${caps.pair_per_day} cards on ${p.name} today.`;
    if (pickKind === 'prank' && caps.prank_recv_per_day && (st.pranked?.[String(p.id)] || 0) >= caps.prank_recv_per_day) return `${p.name} got ${caps.prank_recv_per_day} pranks today.`;
    if (discordPick && (st.immune || []).includes(String(p.id))) return `Discord cannot change the server owner: pick an in-game card for ${p.name}.`;
    return '';
  };
  const resetIn = st.dayEnds ? Math.max(0, (new Date(st.dayEnds) - Date.now()) / 1000) : 0;
  const capMsg = left === 0 ? `You played your ${cap} cards today. New plays in ${fmtDur(resetIn)}.` : '';
  const toBlock = blockOf(tr.to);
  let composer;
  if (c) {
    const sc = effectScaled(c);
    const wait = effectReadyIn(c);
    const k = kindOf(c);
    const ready = sc.enabled && wait <= 0;
    composer = `<div class="tr-deal fx-deal">
        <div class="tr-side"><div class="tr-slot r-${c.rarity}"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""></div>
          <div class="tr-info"><span class="fx-tags"><span class="fx-kind k-${k}">${EFFECT_KIND.icon[k] || ''} ${esc((EFFECT_KIND.label[k] || k).toUpperCase())}</span>
            <span class="fx-state ${ready ? 'ok' : ''}">${!sc.enabled ? 'Unlocks soon' : wait > 0 ? `Ready in ${fmtDur(wait)}` : '● Ready'}</span></span>
            <h3>${esc(c.effect.name || pretty(c.effect.primitive))}</h3>
            <p class="fx-desc">${esc(c.effect.desc || '')}</p>
            <span class="tr-chips">${sc.dur ? `<i>⏱ ${fmtDur(sc.dur)}</i>` : ''}<i>↻ ${fmtDur(sc.cooldownH * 3600)} cooldown</i>${sc.amount != null ? `<i>✦ ${sc.amount}</i>` : ''}</span></div></div>
        <span class="tr-swap">→</span>
        <div class="tr-side right tr-to"><div class="tr-info"><span class="tr-who">To</span><h3>${esc(toName)}</h3></div>${avatarHTML(tr.to?.id, toName, 'huge')}</div>
      </div>
      <div class="tr-foot"><span class="side-h fx-on">On ${esc(toName)}</span>${fx.onTarget.length ? fx.onTarget.map((e) => `<span class="f-chip">${esc(pretty(e.primitive))}</span>`).join('') : '<span class="dim">Nothing active</span>'}
        <span class="grow"></span><span class="tr-msg" id="fxMsg">${esc(fx.msg || capMsg || toBlock)}</span>
        <button class="v2-btn" id="fxClear">↺ Clear</button>
        ${st.canTest ? `<button class="v2-btn fx-test" id="fxTest" title="Try it on yourself: no post, no cooldown">🧪 Test on me</button>` : ''}
        <button class="v2-btn fx-play k-${k}" id="fxPlay" ${ready && tr.to && (left == null || left > 0) && !toBlock ? '' : 'disabled'}>✨ Play ${esc((EFFECT_KIND.label[k] || '').toLowerCase())}</button></div>`;
  } else {
    composer = `<div class="fx-empty"><b>Pick an effect card</b></div>
      <div class="tr-foot"><span class="side-h fx-on">On ${esc(toName)}</span>${fx.onTarget.length ? fx.onTarget.map((e) => `<span class="f-chip">${esc(pretty(e.primitive))}</span>`).join('') : '<span class="dim">Nothing active</span>'}<span class="grow"></span><span class="tr-msg" id="fxMsg">${esc(fx.msg || capMsg)}</span></div>`;
  }
  const cards = fxCards();
  const onYou = (st.active || []).map((e) => {
    const total = (Number(e.duration_s) || 0) * 1000;
    const leftMs = e.expires_at ? new Date(e.expires_at) - Date.now() : null;
    const pct = total && leftMs != null ? Math.max(0, Math.min(100, Math.round((100 * leftMs) / total))) : 100;
    return `<div class="fx-on-row"><span class="nt-ico">${e.options?.test ? '🧪' : '✨'}</span><div><b>${esc(pretty(e.primitive))}${e.options?.test ? ' <i class="fx-testtag">TEST</i>' : ''}</b><span class="dim">${esc(e.card?.name || '')}</span><i class="fx-bar"><i style="width:${pct}%"></i></i></div>
      <span class="mono fx-left">${leftMs != null ? fmtDur(leftMs / 1000) : ''}</span></div>`;
  }).join('');
  const rec = fx.recent.map((r) => `<div class="fx-rec k-${esc(r.kind)}"><span class="fx-pair">${avatarHTML(r.from_id, r.from, 'xs')}${avatarHTML(r.to_id, r.to, 'xs')}</span>
      <div><b>${nameBadge(r.from_id, r.from)} → ${nameBadge(r.to_id, r.to)}</b><span>${EFFECT_KIND.icon[r.kind] || ''} ${esc(OUTCOME_LABEL[r.outcome] || pretty(r.primitive))}</span></div>
      <span class="mono dim">${ctx().ago(r.at)}</span></div>`).join('');

  el('main').innerHTML = `<div class="v2-trade community fx-view">
    <section class="tr-main">
      <div class="tr-top">${commTabs()}${explainBtn('pranks')}<span class="grow"></span>
        ${cap ? `<div class="fx-today"><span>Plays today</span><i class="fx-bar"><i style="width:${Math.round((100 * used) / cap)}%"></i></i><b class="mono">${used}/${cap}</b></div>` : ''}</div>
      <div class="tr-members" id="trMembers"><span class="side-h">To</span>
        ${tr.members.map((p) => { const why = blockOf(p); return `<button class="tr-mem${tr.to?.id === p.id ? ' on' : ''}${why ? ' capped' : ''}" data-id="${esc(p.id)}"${why ? ` title="${esc(why)}"` : ''}>${avatarHTML(p.id, p.name, 'xs')}<span>${nameBadge(p.id, p.name, isPhone())}</span>${p.voice ? '<i class="tr-live"></i>' : ''}</button>`; }).join('')}
        <span class="grow"></span><input class="v2-search tr-find" id="trFind" placeholder="${isPhone() ? 'Find' : 'Find a member'}" value="${esc(tr.find || '')}"></div>
      <div class="tr-compose">${composer}</div>
      <div class="tr-gridhead"><div class="seg"><button class="on">Your effect cards <b>${(ctx().cache.collection?.cards || []).filter((x) => x.effect?.primitive).length}</b></button></div>
        <span class="grow"></span>
        <div class="seg" id="fxFilter">${[['all', 'All'], ['boon', '<i class="fx-dot">● </i>Boon'], ['prank', '<i class="fx-dot">● </i>Prank'], ['neutral', '<i class="fx-dot">● </i>Neutral']].map(([v, l]) => `<button data-f="${v}" class="${fx.filter === v ? 'on' : ''} k-${v}">${l}</button>`).join('')}</div>
        <div class="v2-pager" id="fxPager"></div></div>
      <div class="v2-grid" id="fxGrid"></div>
    </section>
    <aside class="tr-offers v2-tile fx-side">
      <div class="tile-h"><b>On you</b><span class="grow"></span>${st.canTest && (st.active || []).some((e) => e.options?.test) ? '<button class="link-btn" id="fxClearTests">Clear tests</button>' : ''}<span class="n mono">${(st.active || []).length}</span></div>
      <div class="of-list fx-onyou" id="fxOnYou">${onYou || '<p class="v2-empty">Nothing is active on you.</p>'}</div>
      <div class="tile-h" id="fxRecentH"><b>Recent plays</b><span class="grow"></span><span class="live-chip sm">● LIVE</span></div>
      <div class="of-list fx-recent" id="fxRecent">${rec || '<p class="v2-empty">No plays yet.</p>'}</div>
    </aside>
  </div>`;

  paintCards(el('fxGrid'), el('fxPager'), cards, fx, (card) => { fx.pick = card; fx.msg = ''; paintEffects(); }, fx.pick?.id);
  // Each effect card shows its kind above it and its cooldown on it.
  el('fxGrid').querySelectorAll('.v2-cell').forEach((n) => {
    const card = cards[Number(n.dataset.idx)];
    if (!card) return;
    const k = kindOf(card);
    n.insertAdjacentHTML('afterbegin', `<span class="fx-kind k-${k} on-card">${EFFECT_KIND.icon[k] || ''} ${esc((EFFECT_KIND.label[k] || k).toUpperCase())}</span>`);
    const w = effectReadyIn(card);
    if (w > 0) { n.classList.add('cooling'); n.querySelector('.v2-card')?.insertAdjacentHTML('beforeend', `<span class="fx-cd">⏳ ${fmtDur(w)}</span>`); }
  });
  wireCommTabs();
  el('fxFilter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; fx.filter = b.dataset.f; fx.page = 0; paintEffects(); };
  el('trMembers').onclick = async (e) => {
    const b = e.target.closest('.tr-mem'); if (!b) return;
    tr.to = tr.members.find((p) => p.id === b.dataset.id) || tr.to; fx.msg = '';
    try { fx.onTarget = (await ctx().api(`/api/effects/on?id=${encodeURIComponent(tr.to.id)}`)).active || []; } catch { fx.onTarget = []; }
    paintEffects();
  };
  el('fxClear')?.addEventListener('click', () => { fx.pick = null; fx.msg = ''; paintEffects(); });
  el('fxTest')?.addEventListener('click', async () => {
    const r = await testCard(fx.pick);
    fx.msg = r?.ok ? (r.primitive === 'cleanse' ? `Test: removed ${r.removed || 0} prank${r.removed === 1 ? '' : 's'} from you` : `Test: ${pretty(r.primitive)} is on you${r.duration_s ? ` for ${fmtDur(r.duration_s)}` : ''}`) : (r?.error === 'not_testable' ? 'This effect cannot be tested on yourself.' : effectError(r?.error));
    await loadFx(); paintEffects();
  });
  el('fxClearTests')?.addEventListener('click', async () => { await clearTests(); fx.msg = 'Tests cleared'; await loadFx(); paintEffects(); });
  el('fxPlay')?.addEventListener('click', async () => {
    const btn = el('fxPlay'); btn.disabled = true;
    const voice = effectState().primitives?.[fx.pick?.effect?.primitive]?.channel === 'voice';
    const r = await playCard(fx.pick, tr.to.id);
    fx.msg = r?.ok ? resultText(r, tr.to, voice) : effectError(r?.error);
    if (r?.ok) fx.pick = null;
    await loadFx();
    paintEffects();
  });
  wireFind(paintEffects); // Boons & Pranks had no Find handler (2026-10-01)
  keepFocus(focus);
  requestAnimationFrame(() => { fitChildren(el('fxOnYou')); fitRecent(); fitRow(el('trMembers'), el('trFind')); });
  setTimeout(fitRecent, 300); // again after the avatars and fonts load
  maybeExplain('pranks');
}
