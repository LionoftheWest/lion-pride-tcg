// UI v2 social screens, approved 2026-09-27: the Notifications panel (design 11), the
// Leaderboard (design 12), and Trading with Gift inside it (designs 14 + 13).
// Uses the shared helpers of ui-v2.js; the data comes from the existing APIs.

import { v2ctx, avatarHTML, titleHTML, ensureCatalog, paintCards, fitChildren, openMember, toast } from './ui-v2.js';
import { thumb } from './thumb.js';
import { playTradeFx } from './ui-v2-tradefx.js';
import { isPhone, isPort, isLand } from './mobile.js';
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
};
const noteKind = (k) => NOTE_KINDS[k] || (String(k).startsWith('hunt') ? { icon: '⚔', tab: 'hunt', label: 'Hunt', act: 'Hunt' } : { icon: '🔔', tab: 'all', label: '' });
let noteTab = 'all';
let noteItems = [];
let noteHunt = null;
let noteGifts = []; // gifts waiting to be redeemed (gift_claims.sql)
let pingPrefs = null; // the Settings tab: which bot posts may ping me (null = not loaded)
const PING_ROWS = [['plays', 'Card plays on me'], ['trades', 'Trades & gifts'], ['raid', 'Raid boss'], ['packs', 'Pack reminders']];

export async function openNotifsV2() {
  const { el, api } = ctx();
  let box = el('v2Notifs');
  if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="v2Notifs" class="v2-drop hidden"></div>'); box = el('v2Notifs'); }
  if (!box.classList.contains('hidden')) { closeNotifsV2(); return; }
  box.classList.remove('hidden');
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
  if (noteItems.some((x) => !x.read)) { try { await apiPost('/api/notifications/read', {}); } catch { /* keep */ } }
  ctx().updateNotifBadge(noteGifts.length); // a gift not redeemed yet keeps the red number
}
function paintNotifs() {
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
  box.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    closeNotifsV2();
    const act = a.dataset.act;
    if (act === 'Hunt') ctx().show('battling');
    else if (act === 'Open') ctx().openPacks();
    else if (act === 'View') ctx().show('trading');
  };
  requestAnimationFrame(() => fitChildren(el('ntList')));
}

// ---- Gifts to redeem (Nathan, 2026-10-01): the New Player Bonus, the Launch Day gift,
// member gifts and promos wait here; Redeem adds the packs to the OPEN balance. ----
function giftsHTML() {
  if (!noteGifts.length) return '';
  const total = noteGifts.reduce((n, g) => n + g.amount, 0);
  return `<div class="gf-list"><div class="side-h">Gifts to redeem${noteGifts.length > 1 ? `<button class="v2-btn gold gf-all">Redeem all +${total}</button>` : ''}</div>
    ${noteGifts.map((g) => `<div class="gf-row"><span class="gf-ico">🎁</span><div class="gf-t"><b>${esc(g.title)}</b><span>${g.amount} pack${g.amount === 1 ? '' : 's'}</span></div>
      <button class="v2-btn gold gf-redeem" data-id="${g.id}">Redeem</button></div>`).join('')}</div>`;
}
async function redeem(btn, ids) {
  btn.disabled = true;
  let r = null;
  try { r = await ctx().apiPost('/api/gifts/claim', { ids }); } catch { r = null; }
  if (r?.ok) {
    noteGifts = noteGifts.filter((g) => !ids.includes(g.id));
    toast(`🎁 +${r.packs} pack${r.packs === 1 ? '' : 's'}`);
    ctx().refreshPacks?.();
  } else {
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
      ${avatarHTML(r.id, r.name, 'big', r.frame)}<span class="lb-place">${[2, 1, 3][i]}</span><b class="lb-name">${nameBadge(r.id, r.name)}</b>${titleHTML(r.title)}
      <span class="lb-val">${m.icon} ${val(r)}</span>
      <span class="lb-sub">⚔ ${short(r.huntDamage)} · 💀 ${r.bosses} · 📚 ${r.cards}</span></div>` : '<div class="lb-pod empty"></div>')).join('');
  const line = (r, i) => `<div class="lb-row${r.id === d.me ? ' me' : ''}" data-member="${esc(r.id)}"><span class="lb-i mono">${i + 1}</span>
      <span class="lb-p">${avatarHTML(r.id, r.name, 'sm', r.frame)}<b>${nameBadge(r.id, r.name)}</b>${titleHTML(r.title)}${r.id === d.me ? '<i class="you">You</i>' : ''}</span>
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
      <div class="lb-tabs">${METRICS.map((mm) => `<button class="lb-tab${mm.key === m.key ? ' on' : ''}" data-m="${mm.key}">${mm.icon} ${esc(mm.label)}</button>`).join('')}</div>
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
  });
}

// ---- Trading, with Gift inside (designs 14 + 13) ----------------------------------------

// respond: the incoming offer I pick my card for (two-step trades, trade_two_step.sql).
const tr = { tab: 'trades', mode: 'offer', giftKind: 'card', to: null, give: null, get: null, side: 'mine', filter: 'all', q: '', page: 0, members: [], theirs: {}, offers: null, msg: '', respond: null };
// The trades that wait for ME: an offer to pick a card for, or a pick to accept.
const two = () => !!ctx().trade2?.(); // two-step trades (flag); OFF = I pick both cards
export const tradeActions = (d) => (d?.incoming || []).filter((o) => o.status !== 'countered').length + (d?.outgoing || []).filter((o) => o.status === 'countered').length;

export async function renderTradingV2() {
  const { el, api } = ctx();
  el('main').innerHTML = '<div class="v2-loading">Loading…</div>';
  await ensureCatalog();
  const [players, offers] = await Promise.all([api('/api/players').catch(() => ({ players: [] })), api('/api/trades').catch(() => ({}))]);
  if (!ctx().cache.collection) { try { await ctx().refreshOwned(); } catch { /* keep */ } }
  if (ctx().currentView() !== 'trading') return;
  const me = String(ctx().user()?.id || '');
  const voice = (ctx().live.presence || []).filter((p) => String(p.id) !== me).map((p) => ({ id: String(p.id), name: p.name, voice: true }));
  const rest = (players.players || []).filter((p) => !voice.some((v) => v.id === String(p.id))).map((p) => ({ id: String(p.id), name: p.username }));
  tr.members = [...voice, ...rest];
  tr.offers = offers;
  if (!tr.to && tr.members[0]) tr.to = tr.members[0];
  if (tr.to) await loadTheirs(tr.to.id);
  if (tr.tab === 'effects' && ctx().effectsEnabled?.()) { await loadFx(); paintEffects(); } else { tr.tab = 'trades'; paintTrade(); }
}

// The Community sub-tabs (design 16): Trades, Boons & Pranks (only while effects are on).
function commTabs() {
  const fx = ctx().effectsEnabled?.();
  // Portrait (design 25): the trophy moves from the top bar into Community, the same button.
  const board = isPort() ? '<button class="v2-icon" id="commBoard" title="Leaderboard">🏆</button>' : '';
  return board + `<div class="seg" id="commTabs"><button data-tab="trades" class="${tr.tab === 'trades' ? 'on' : ''}">⇄ Trades</button>${fx ? `<button data-tab="effects" class="${tr.tab === 'effects' ? 'on' : ''}">✨ Boons<span class="ct-more"> & Pranks</span></button>` : ''}</div>`;
}
function wireCommTabs() {
  ctx().el('commBoard')?.addEventListener('click', () => ctx().el('boardBtn')?.click());
  ctx().el('commTabs')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tr.tab) return;
    tr.tab = b.dataset.tab; tr.page = 0; tr.msg = '';
    if (tr.tab === 'effects') { await loadFx(); paintEffects(); } else paintTrade();
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
  // Two-step trades (Nathan, 2026-10-01): a member only ever picks from their OWN cards.
  // Flag OFF: the sender also picks the card they get, from the other member's cards.
  const theirs = !two() && tr.side === 'theirs' && tr.mode === 'offer' ? (tr.to ? tr.theirs[tr.to.id] || [] : []).map((c) => withBase(c, b)) : null;
  let items = theirs || mine;
  if (theirs && tr.give) items = items.filter((c) => c.rarity === tr.give.rarity); // same rarity lane
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

function paintTrade() {
  const { el } = ctx();
  const toName = tr.to?.name || 'a member';
  // My Live in voice tile (design 19): once I pick a card, who I trade with and the two cards.
  if (tr.tab === 'trades' && tr.mode === 'offer') {
    const c = [tr.give?.id, tr.get?.id].map(Number).filter(Boolean);
    if (c.length) ctx().status?.('trading', { t: tr.to?.name, c, s: 'building' });
    else if (tr.sent) ctx().status?.('trading', { t: tr.sent.name, c: tr.sent.c, s: 'sent' });
  }
  const packs = ctx().packs();
  const me = ctx().user();
  // The rows that wait for ME come first (the lists show only the rows that fit).
  const inc = [...(tr.offers?.incoming || [])].sort((x, y) => (x.status === 'countered') - (y.status === 'countered'));
  const out = [...(tr.offers?.outgoing || [])].sort((x, y) => (y.status === 'countered') - (x.status === 'countered'));
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
      <div class="tr-foot"><span class="dim">${esc(o.from_name || 'They')} accepts next.</span>
        <span class="grow"></span><span class="tr-msg" id="trMsg">${esc(tr.msg)}</span>
        <button class="v2-btn" id="trClear">✕ Back</button><button class="v2-btn gold" id="trSend" ${tr.give ? '' : 'disabled'}>➤ Send my card</button></div>`;
  } else if (tr.mode === 'offer' && !two()) {
    const diff = tr.give && tr.get ? (tr.get.power || 0) - (tr.give.power || 0) : null;
    composer = `<div class="tr-deal">
        <div class="tr-side">${slotHTML(tr.give, `${avatarHTML(me?.id, me?.name, 'xs')} You give`, 'Pick your card')}</div>
        <span class="tr-swap">⇄</span>
        <div class="tr-side right">${slotHTML(tr.get, `${avatarHTML(tr.to?.id, toName, 'xs')} You get`, tr.give ? `Pick a ${ctx().RARITY_LABEL[tr.give.rarity] || ''} from ${toName}` : 'Then pick their card')}</div>
      </div>
      <div class="tr-foot">${diff != null ? `<span class="tr-diff ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '↗ +' : '↘ '}${diff} power</span>` : '<span class="dim">Swaps are the same rarity.</span>'}
        <span class="grow"></span><span class="tr-msg" id="trMsg">${esc(tr.msg)}</span>
        <button class="v2-btn" id="trClear">↺ Clear</button><button class="v2-btn gold" id="trSend" ${tr.give && tr.get && tr.to ? '' : 'disabled'}>➤ Send offer</button></div>`;
  } else if (tr.mode === 'offer') {
    // Step 1: I offer one card; the other member picks theirs (Nathan, 2026-10-01).
    composer = `<div class="tr-deal">
        <div class="tr-side">${slotHTML(tr.give, `${avatarHTML(me?.id, me?.name, 'xs')} You give`, 'Pick your card')}</div>
        <span class="tr-swap">⇄</span>
        <div class="tr-side right tr-to"><div class="tr-info"><span class="tr-who">To</span><h3>${esc(toName)}</h3>${tr.give ? `<span class="tr-rar" style="color:var(--r-${tr.give.rarity})">Picks ${aRar(tr.give)}</span>` : ''}</div>${avatarHTML(tr.to?.id, toName, 'huge')}</div>
      </div>
      <div class="tr-foot"><span class="dim">They pick a card of the same rarity.</span>
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
  const theirsN = tr.to ? (tr.theirs[tr.to.id] || []).length : 0;
  const offerCard = (c, tag) => (c ? `<div class="of-card"><img src="${thumb(c.image_url)}" data-full="${c.image_url || ''}" alt=""><span>${tag}</span></div>` : '');
  const packMode = tr.mode === 'gift' && tr.giftKind === 'pack';
  el('main').innerHTML = `<div class="v2-trade${packMode ? ' pack-mode' : ''}${tr.respond ? ' responding' : ''}">
    <section class="tr-main">
      <div class="tr-top">${commTabs()}<span class="grow"></span>
        <div class="seg" id="trMode"><button data-m="offer" class="${tr.mode === 'offer' ? 'on' : ''}">⇄ Offer</button><button data-m="gift" class="${tr.mode === 'gift' ? 'on' : ''}">🎁 Gift</button></div></div>
      <div class="tr-members" id="trMembers"><span class="side-h">To</span>
        ${tr.members.map((p) => `<button class="tr-mem${tr.to?.id === p.id ? ' on' : ''}" data-id="${esc(p.id)}">${avatarHTML(p.id, p.name, 'xs')}<span>${nameBadge(p.id, p.name, isPhone())}</span>${p.voice ? '<i class="tr-live"></i>' : ''}</button>`).join('')}
        <span class="grow"></span><input class="v2-search tr-find" id="trFind" placeholder="${isPhone() ? 'Find' : 'Find a member'}"></div>
      <div class="tr-compose">${composer}</div>
      <div class="tr-gridhead">
        ${tr.mode === 'offer' && !two() ? `<div class="seg" id="trSide"><button data-s="mine" class="${tr.side === 'mine' ? 'on' : ''}">Your cards <b>${mineN}</b></button><button data-s="theirs" class="${tr.side === 'theirs' ? 'on' : ''}">${esc(toName)}'s cards <b>${theirsN}</b></button></div>` : `<div class="seg"><button class="on">Your cards <b>${mineN}</b></button></div>`}
        <input class="v2-search" id="trQ" placeholder="${isPhone() ? 'Search' : 'Search cards, tags…'}" value="${esc(tr.q)}">
        <span class="grow"></span>
        <div class="seg" id="trFilter">${[['all', 'All'], ['dupes', 'Dupes'], ['rare', 'Rare+']].map(([v, l]) => `<button data-f="${v}" class="${tr.filter === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="v2-pager" id="trPager"></div>
      </div>
      <div class="v2-grid" id="trGrid"></div>
    </section>
    <aside class="tr-offers v2-tile">
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
    </aside>
  </div>`;

  wireCommTabs();
  // Grid
  const items = gridItems();
  const old = !two() && tr.mode === 'offer';
  const pickId = old && tr.side === 'theirs' ? tr.get?.id : tr.give?.id;
  const onPick = (c) => {
    tr.msg = '';
    if (old && tr.side === 'theirs') tr.get = c;
    else {
      tr.give = c;
      if (old) { if (tr.get && tr.get.rarity !== c.rarity) tr.get = null; tr.side = 'theirs'; tr.page = 0; }
    }
    paintTrade();
  };
  paintCards(el('trGrid'), el('trPager'), items, tr, onPick, pickId);

  // Controls
  const main = el('main');
  el('trMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; tr.mode = b.dataset.m; tr.side = 'mine'; tr.give = null; tr.get = null; tr.respond = null; tr.page = 0; tr.msg = ''; paintTrade(); };
  el('trSide')?.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; tr.side = b.dataset.s; tr.page = 0; paintTrade(); });
  el('trGiftKind')?.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; tr.giftKind = b.dataset.k; tr.msg = ''; paintTrade(); });
  el('trFilter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; tr.filter = b.dataset.f; tr.page = 0; paintTrade(); };
  el('trQ').addEventListener('input', (e) => { tr.q = e.target.value; tr.page = 0; paintCards(el('trGrid'), el('trPager'), gridItems(), tr, onPick, pickId); });
  el('trMembers').onclick = async (e) => {
    const b = e.target.closest('.tr-mem'); if (!b) return;
    tr.to = tr.members.find((p) => p.id === b.dataset.id) || tr.to; tr.get = null; tr.msg = '';
    await loadTheirs(tr.to.id); paintTrade();
  };
  let t = null;
  el('trFind').addEventListener('input', (e) => {
    clearTimeout(t);
    const q = e.target.value.trim();
    t = setTimeout(async () => {
      if (!q) return;
      try {
        const d = await ctx().api(`/api/players?q=${encodeURIComponent(q)}`);
        const found = (d.players || []).map((p) => ({ id: String(p.id), name: p.username }));
        if (found[0]) { tr.members = [...found, ...tr.members.filter((m) => !found.some((f) => f.id === m.id))]; tr.to = found[0]; await loadTheirs(tr.to.id); paintTrade(); }
      } catch { /* keep */ }
    }, 350);
  });
  el('trClear').addEventListener('click', () => { tr.give = null; tr.get = null; tr.side = 'mine'; tr.respond = null; tr.page = 0; tr.msg = ''; paintTrade(); });
  // Pick my card for an incoming offer: the grid shows my cards of that rarity.
  main.querySelectorAll('.of-pick').forEach((b) => b.addEventListener('click', () => {
    tr.respond = (tr.offers?.incoming || []).find((o) => Number(o.id) === Number(b.dataset.id)) || null;
    tr.mode = 'offer'; tr.give = null; tr.page = 0; tr.msg = '';
    paintTrade();
  }));
  el('trSend').addEventListener('click', send);
  main.querySelectorAll('.of-accept').forEach((b) => b.addEventListener('click', () => { b.disabled = true; resolve('/api/trade/accept', { offerId: Number(b.dataset.id) }); }));
  main.querySelectorAll('.of-decline').forEach((b) => b.addEventListener('click', () => resolve('/api/trade/resolve', { offerId: Number(b.dataset.id), action: 'decline' })));
  main.querySelectorAll('.of-cancel').forEach((b) => b.addEventListener('click', () => resolve('/api/trade/resolve', { offerId: Number(b.dataset.id), action: 'cancel' })));
  requestAnimationFrame(() => { fitChildren(el('ofIn')); fitChildren(el('ofOut')); if (isLand()) fitColumn(el('trMembers')); else fitRow(el('trMembers'), el('trFind')); });
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
    else if (tr.mode === 'offer') r = await apiPost('/api/trade/offer', { toId: tr.to.id, offerCardId: tr.give.id, ...(two() ? {} : { requestCardId: tr.get.id }) });
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
async function refreshOffers() {
  try { tr.offers = await ctx().api('/api/trades'); } catch { /* keep */ }
  ctx().updateTradeBadge?.(tradeActions(tr.offers));
}
async function resolve(path, body) {
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
  paintTrade();
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

function paintEffects() {
  const { el } = ctx();
  const st = effectState();
  const toName = tr.to?.name || 'a member';
  const c = fx.pick;
  const cap = st.sendCap || 0;
  const used = st.playsToday || 0;
  const left = cap ? Math.max(0, cap - used) : null;
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
        <span class="grow"></span><span class="tr-msg" id="fxMsg">${esc(fx.msg)}</span>
        <button class="v2-btn" id="fxClear">↺ Clear</button>
        ${st.canTest ? `<button class="v2-btn fx-test" id="fxTest" title="Try it on yourself: no post, no cooldown">🧪 Test on me</button>` : ''}
        <button class="v2-btn fx-play k-${k}" id="fxPlay" ${ready && tr.to && (left == null || left > 0) ? '' : 'disabled'}>✨ Play ${esc((EFFECT_KIND.label[k] || '').toLowerCase())}</button></div>`;
  } else {
    composer = `<div class="fx-empty"><b>Pick an effect card</b><span class="dim">Then play it on ${esc(toName)}.</span></div>
      <div class="tr-foot"><span class="side-h fx-on">On ${esc(toName)}</span>${fx.onTarget.length ? fx.onTarget.map((e) => `<span class="f-chip">${esc(pretty(e.primitive))}</span>`).join('') : '<span class="dim">Nothing active</span>'}<span class="grow"></span><span class="tr-msg" id="fxMsg">${esc(fx.msg)}</span></div>`;
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
      <div><b>${nameBadge(r.from_id, r.from)} → ${nameBadge(r.to_id, r.to)}</b><span>${EFFECT_KIND.icon[r.kind] || ''} ${esc(r.outcome === 'reflected' ? 'Reflected' : r.outcome === 'blocked' ? 'Blocked' : pretty(r.primitive))}</span></div>
      <span class="mono dim">${ctx().ago(r.at)}</span></div>`).join('');

  el('main').innerHTML = `<div class="v2-trade community fx-view">
    <section class="tr-main">
      <div class="tr-top">${commTabs()}<span class="grow"></span>
        ${cap ? `<div class="fx-today"><span>Plays today</span><i class="fx-bar"><i style="width:${Math.round((100 * used) / cap)}%"></i></i><b class="mono">${used}/${cap}</b></div>` : ''}</div>
      <div class="tr-members" id="trMembers"><span class="side-h">To</span>
        ${tr.members.map((p) => `<button class="tr-mem${tr.to?.id === p.id ? ' on' : ''}" data-id="${esc(p.id)}">${avatarHTML(p.id, p.name, 'xs')}<span>${nameBadge(p.id, p.name, isPhone())}</span>${p.voice ? '<i class="tr-live"></i>' : ''}</button>`).join('')}
        <span class="grow"></span><input class="v2-search tr-find" id="trFind" placeholder="${isPhone() ? 'Find' : 'Find a member'}"></div>
      <div class="tr-compose">${composer}</div>
      <div class="tr-gridhead"><div class="seg"><button class="on">Your effect cards <b>${(ctx().cache.collection?.cards || []).filter((x) => x.effect?.primitive).length}</b></button></div>
        <span class="grow"></span>
        <div class="seg" id="fxFilter">${[['all', 'All'], ['boon', '● Boon'], ['prank', '● Prank'], ['neutral', '● Neutral']].map(([v, l]) => `<button data-f="${v}" class="${fx.filter === v ? 'on' : ''} k-${v}">${l}</button>`).join('')}</div>
        <div class="v2-pager" id="fxPager"></div></div>
      <div class="v2-grid" id="fxGrid"></div>
    </section>
    <aside class="tr-offers v2-tile fx-side">
      <div class="tile-h"><b>On you</b><span class="grow"></span>${st.canTest && (st.active || []).some((e) => e.options?.test) ? '<button class="link-btn" id="fxClearTests">Clear tests</button>' : ''}<span class="n mono">${(st.active || []).length}</span></div>
      <div class="of-list fx-onyou" id="fxOnYou">${onYou || '<p class="v2-empty">Nothing is active on you.</p>'}</div>
      <div class="tile-h"><b>Recent plays</b><span class="grow"></span><span class="live-chip sm">● LIVE</span></div>
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
    const r = await playCard(fx.pick, tr.to.id);
    fx.msg = r?.ok
      ? (r.outcome === 'blocked' ? `${tr.to.name} blocked it` : r.outcome === 'reflected' ? 'It bounced back to you' : `Played on ${tr.to.name}`)
      : effectError(r?.error);
    if (r?.ok) fx.pick = null;
    await loadFx();
    paintEffects();
  });
  requestAnimationFrame(() => { fitChildren(el('fxOnYou')); fitChildren(el('fxRecent')); fitRow(el('trMembers'), el('trFind')); });
}
