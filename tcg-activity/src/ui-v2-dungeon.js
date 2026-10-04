// The Dungeon Run (design 30, approved by Nathan 2026-10-03: desktop, portrait and landscape).
// Screens: today's dungeon (the squad picker on the rarity budget), the fight, choose a reward, the
// run over, the leaderboard. The Adventure tabs (Hunt | Dungeon | Arena soon | Expeditions soon).
// Every rule and roll lives in SQL (dungeon.sql on the shared combat core); the data comes from
// src/dungeon-routes.js. The monsters are 3D (src/dungeon-stage.js, loaded on demand), bigger on
// screen (Nathan). The flag: /api/flags -> dungeon (DUNGEON_USERS / FEATURE_DUNGEON).
import { v2ctx, toast, mergedCards } from './ui-v2.js';
import { flairHTML } from './flair.js';
import { elIcon } from './element-icons.js';
import { thumb } from './thumb.js';
import { isPort } from './mobile.js';
import { gateHTML, wireGate } from './ui-v2-gate.js';
import { COIN } from './ui-v2-shop.js';
import { cardElement } from './elements.js';
import { setMood, stopMusic, toggleMute, musicBtnHTML, paintMusicBtn } from './dungeon-music.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const fmt = (n) => Number(n || 0).toLocaleString();
const RL = (r) => ctx().RARITY_LABEL?.[r] || String(r || '').replace(/_/g, ' ');
const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  castle: svg('<path d="M3 21V8l3 2V6l3 2V4h6v4l3-2v4l3-2v13z"/><path d="M10 21v-5h4v5"/>'),
  sword: svg('<path d="m14.5 17.5 5-5"/><path d="m3 3 11 11"/><path d="m21 3-11 11"/><path d="m9.5 17.5-5-5"/><path d="M3 21l3-3"/><path d="m21 21-3-3"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'),
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 2.4),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
  door: svg('<path d="M4 21h16M6 21V4h9l3 2v15"/><path d="M13 12h.01"/>'),
  skull: svg('<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.4"/><circle cx="15" cy="11" r="1.4"/>'),
  cards: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  up: svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
  heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>'),
  bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  hand: svg('<path d="M9 11V5a2 2 0 0 1 4 0v5"/><path d="M13 10V8a2 2 0 0 1 4 0v4"/><path d="M17 11a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-5a2 2 0 0 1 3-2l2 2V9"/>'),
  chest: svg('<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M5 9a7 4 0 0 1 14 0M11 13v3h2v-3"/>'),
  fire: svg('<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7z"/>'),
  left: svg('<path d="m15 18-6-6 6-6"/>'), right: svg('<path d="m9 18 6-6-6-6"/>'),
  q: svg('<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', 2.6),
  horde: svg('<circle cx="7" cy="9" r="3"/><circle cx="17" cy="9" r="3"/><circle cx="12" cy="15" r="3"/>'),
  crown: svg('<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5z"/>'),
  split: svg('<path d="M12 21v-7M12 14 6 8M12 14l6-6M4 4h4v4M16 4h4v4"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  ward: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  drop: svg('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>'),
};
const ATTACKER = new Set(['Character', 'Creature']);
const RCOL = { normal: '#9AA3B5', illustrated_rare: '#4DA3FF', secret_rare: '#B07CFF', full_art: '#FF5FA2', gold: '#F4B73C', event: '#3DD68C', promo: '#FF8A3D' };
const EFFECT = {
  empower: (a) => `+${Math.round((a.amount || 0) * 100)}% on the next hit`, shield: (a) => `Shield ${Math.round((a.amount || 0) * 100)}% of max HP`,
  heal: (a) => `Heal ${Math.round((a.amount || 0) * 100)}% of max HP`, weaken: (a) => `Monster deals ${Math.round((a.amount || 0) * 100)}% less`,
  expose: (a) => `Monster takes +${Math.round((a.amount || 0) * 100)}%`, smite: (a) => `${fmt(a.amount)} damage`, stun: () => 'The monster skips a turn',
  cleanse: () => 'Remove the curses',
};
const ACT = { strike: 'Strike', heavy: 'Heavy hit', flurry: 'Flurry', slam: 'Slam', drain: 'Drain', stun: 'Stun', poison: 'Poison', guard: 'Guard', enrage: 'Enrage', curse: 'Curse', regenerate: 'Regenerate', charging: 'Charging', cataclysm: 'Cataclysm', stunned: 'Stunned' };
// v2 (Nathan items 7, 12, 14, 15): the reward tiers, the room types, the loot at risk.
const TIER = [null, ['Common', '#9AA3B5'], ['Uncommon', '#3DD68C'], ['Rare', '#4DA3FF'], ['Ultra', '#B07CFF'], ['Legend', '#F4B73C']];
const ROOM = { fight: 'Fight', horde: 'Horde', elite: 'Elite', miniboss: 'Mini-Boss', guardian: 'Guardian', treasure: 'Treasure', rest: 'Rest', choice: 'Choice', unknown: 'Unknown room' };

const AUTO = 'lp.dungeon.auto';
export const dg = { auto: localStorage.getItem(AUTO) === '1', autoSkip: new Set(), on: false, data: null, pane: '', sel: [], filter: 'allowed', sort: 'power', page: 0, view: 'main', target: 0, support: null, busy: false, log: [], stage: null, roomKey: '' };
let tick = null;
const LAST = 'lp.adventure.tab';

// ---- Init: the dock button becomes "Adventure" and opens the last tab ---------------------------
export function initDungeon(on) {
  dg.on = !!on;
  if (!dg.on) return;
  document.body.classList.add('adv-on'); // the Hunt view reserves room for the Adventure tabs (portrait)
  const btn = document.querySelector('#dock .dk[data-view="battling"]');
  const lbl = btn?.querySelector('span');
  if (lbl) lbl.textContent = 'Adventure';
  // The Adventure button opens the last tab (the Dungeon by default: it is open every day).
  btn?.addEventListener('click', (e) => {
    if ((localStorage.getItem(LAST) || 'dungeon') !== 'dungeon') return;
    e.stopImmediatePropagation();
    ctx().sfx?.('click'); ctx().show('dungeon');
  }, true);
}

// The tab strip, also shown on the Hunt view (main.js advTabs).
export function advTabsHTML(active) {
  if (!dg.on) return '';
  const t = (k, icon, label, soon) => `<button class="dg-tab${active === k ? ' on' : ''}"${soon ? ' disabled' : ` data-adv="${k}"`}>${icon}<span>${label}</span>${soon ? '<i>SOON</i>' : ''}</button>`;
  return `<div class="dg-tabs v2-subtabs" role="tablist">${t('hunt', I.sword, 'Hunt')}${t('dungeon', I.castle, 'Dungeon')}${t('arena', I.shield, 'Arena', true)}${t('exp', I.compass, 'Expeditions', true)}</div>`;
}
export function wireAdvTabs(root) {
  root.querySelectorAll('[data-adv]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.adv;
    localStorage.setItem(LAST, k);
    ctx().sfx?.('click');
    ctx().show(k === 'hunt' ? 'battling' : 'dungeon');
  }));
}
// main.js calls this after each Hunt paint: the strip on top of the Hunt view.
export function advTabs(active = 'hunt') {
  const main = document.getElementById('main');
  if (!dg.on || !main) return;
  main.querySelector(':scope > .v2-subtabs')?.remove();
  main.insertAdjacentHTML('afterbegin', advTabsHTML(active));
  main.classList.add('has-adv');
  wireAdvTabs(main);
}

// ---- Data --------------------------------------------------------------------------------------
async function load() {
  let d = null;
  try { d = await ctx().api('/api/dungeon'); } catch { d = null; }
  dg.data = d && d.ok ? d : { closed: true, message: d?.message || 'The Dungeon is closed.' };
  return dg.data;
}
const mine = () => new Map((dg.data?.mine || []).map((c) => [Number(c.id), c]));
const run = () => dg.data?.run || null;
const active = () => run()?.status === 'active';

export async function renderDungeonV2() {
  const { el } = ctx();
  localStorage.setItem(LAST, 'dungeon');
  markDock();
  dg.per = 0; dg.pcols = 0; // measure the card grid again (the size may have changed)
  if (!dg.on) { el('main').innerHTML = '<div class="dg-closed"><b>The Dungeon is closed.</b></div>'; return; }
  if (dg.data && !dg.data.closed) paint(); else el('main').innerHTML = '<div class="loading">Opening the dungeon…</div>';
  // The star gems come from the collection (ascension per copy): load it when it is not cached yet.
  const needCol = !ctx().cache.collection;
  await Promise.all([load(), needCol ? Promise.resolve(ctx().refreshOwned?.()).catch(() => {}) : null]);
  if (ctx().currentView() !== 'dungeon') return;
  paint();
}
function markDock() {
  document.querySelectorAll('#dock .dk').forEach((b) => b.classList.toggle('active', b.dataset.view === 'battling'));
}
export function disposeDungeon() {
  clearInterval(tick); tick = null;
  dg.stage?.dispose(); dg.stage = null; dg.roomKey = '';
  clearTimeout(autoT); stopMusic(); dg.chest?.dispose(); dg.chest = null;
}

function left(iso) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
function startTick() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (ctx().currentView() !== 'dungeon') { disposeDungeon(); return; }
    const at = dg.data?.next_at;
    if (!at) return;
    if (new Date(at).getTime() <= Date.now()) { dg.sel = []; load().then(() => { if (ctx().currentView() === 'dungeon') paint(); }); return; }
    document.querySelectorAll('.dg-left').forEach((n) => { n.textContent = left(at); });
  }, 1000);
}

// ---- Paint -------------------------------------------------------------------------------------
function paint() {
  const { el } = ctx();
  const main = el('main');
  const d = dg.data;
  const fight = active() && d.run.state?.phase === 'fight';
  // The same room: change the parts in place (no rebuild, no flicker).
  if (fight && dg.view !== 'board' && main.querySelector(`.dg-fight[data-room="${roomKey()}"]`)) { fightUpdate(main, d.run.state); return; }
  // Keep the 3D canvas across repaints of the same room (no model reload, no flash).
  const keep = fight && dg.stage ? dg.stage.canvas : null;
  if (!fight && dg.stage) { dg.stage.dispose(); dg.stage = null; dg.roomKey = ''; }
  dg.chest?.dispose(); dg.chest = null;   // the chest canvas is rebuilt with the screen
  let body;
  if (d.closed) body = `<div class="dg-closed"><b>${esc(d.message)}</b></div>`;
  else if (!d.gate?.ok) body = gateHTML(d.gate || {}, 'the Dungeon');
  else if (dg.view === 'board') body = boardHTML();
  else if (fight) body = fightHTML();
  else if (active() && d.run.state?.phase === 'floor_done') body = floorDoneHTML();
  else if (active()) body = chooseHTML();
  else if (run()) body = overHTML();
  else body = lobbyHTML();
  main.innerHTML = `<div class="v2-dungeon${fight ? ' dg-fighting' : ''}${d.run?.state?.phase ? ` ph-${d.run.state.phase}` : ''}">${body}</div>`;
  // Item 19: the music follows the room (silent until Nathan picks the tracks: dungeon-music.js).
  setMood(fight ? (['guardian', 'miniboss'].includes(d.run.state.room_type) ? 'boss' : 'fight') : active() ? 'explore' : null);
  main.querySelectorAll('[data-music]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); paintMusicBtn(b); }));
  advTabs('dungeon'); // the Adventure tabs: the same place as on the Hunt view (Nathan item 2)
  main.querySelectorAll('.card-info').forEach((b) => b.addEventListener('click', (e) => { if (fight) return; e.stopPropagation(); const id = Number(b.closest('.dg-card')?.dataset.id); if (id) openInfo(id); }));
  wireGate(main);
  if (dg.view === 'board') wireBoard(main);
  else if (fight) wireFight(main, keep);
  else if (active() && d.run.state?.phase === 'floor_done') wireFloorDone(main);
  else if (active()) wireChoose(main);
  else if (run()) wireOver(main);
  else if (!d.closed && d.gate?.ok) wireLobby(main);
  startTick();
}

const cardTile = (c, opts = {}) => {
  const r = c?.rarity || 'normal';
  return `<div class="dg-card r-${r}${opts.cls ? ' ' + opts.cls : ''}" data-id="${c?.id}"${opts.attr || ''} style="--rc:${RCOL[r] || '#9AA3B5'}">
    ${c?.image_url ? `<img src="${thumb(c.image_url)}" alt="" loading="lazy">` : ''}
    ${opts.top ?? `<span class="dg-pt">${c.cost ?? 1}<small>PT</small></span><span class="dg-pw">${I.bolt}${fmt(c.cp)}</span>`}
    <span class="dg-nm"><b>${esc(c?.name || '?')}</b><small>◆ ${esc(RL(r))}</small></span>
    ${flairHTML(ascOf(c?.id))}${opts.info === false ? '' : '<button class="card-info" data-info="1" aria-label="Details">🔍</button>'}
    ${opts.over || ''}
  </div>`;
};
// The member's star level of a card (the collection cache) and the full card for the viewer.
const ascOf = (id) => (ctx().cache.collection?.cards || []).find((x) => Number(x.id) === Number(id))?.ascension || 0;
function openInfo(id) {
  // The viewer with the ability, the effect, the tags, and the squad numbers (power, HP, points).
  const row = (dg.data?.mine || []).find((x) => Number(x.id) === Number(id));
  const base = mergedCards().find((x) => Number(x.id) === Number(id));
  const full = base || row ? { ...(base || {}), ...(row || {}), image_url: base?.image_url || row?.image_url } : null;
  if (full) ctx().openViewer(full, { squad: true });
}

// ---- Today's dungeon (the squad picker) --------------------------------------------------------
function ruleBlock(c) {
  const rule = dg.data.rule || {};
  if (rule.types && !rule.types.includes(c.type)) return `${c.type} · not today`;
  if (rule.no_rarity && rule.no_rarity.includes(c.rarity)) return `${RL(c.rarity)} · not today`;
  return '';
}
function lobbyHTML() {
  const d = dg.data;
  const M = mine();
  const picks = dg.sel.map((id) => M.get(id)).filter(Boolean);
  const cost = picks.reduce((t, c) => t + (c.cost || 1), 0);
  const budget = d.budget || 12;
  const atk = picks.some((c) => ATTACKER.has(c.type));
  const ruleOk = picks.every((c) => !ruleBlock(c));
  const full = picks.length === (d.squad || 5);
  const ok = full && cost <= budget && atk && ruleOk;
  const rule = d.rule || {};
  // The budget bar: one segment per point, coloured by the card that uses it.
  const segs = []; picks.forEach((c) => { for (let i = 0; i < (c.cost || 1); i++) segs.push(RCOL[c.rarity] || '#9AA3B5'); });
  const bar = `<div class="dg-bar">${Array.from({ length: Math.max(budget, segs.length) }, (_, i) => `<i style="${segs[i] ? `background:${segs[i]}` : ''}"${i >= budget ? ' class="over"' : ''}></i>`).join('')}</div>`;
  const pts = `<b class="dg-pts${cost > budget ? ' bad' : ''}">${cost}<small> / ${budget} pts</small></b>`;
  const legend = '<small class="dg-legend">Normal 1 · Illustrated 2 · Secret 3 · Full Art 4 · Gold 5</small>';
  const slots = `<div class="dg-slots">${Array.from({ length: d.squad || 5 }, (_, i) => {
    const c = picks[i];
    return `<div class="dg-slot">${c ? cardTile(c, { attr: ` data-unpick="${c.id}" title="Remove"` }) : `<div class="dg-empty">${i + 1}</div>`}
      <span class="dg-slot-ft"><span class="l">Slot ${i + 1}</span>${c ? `<b style="color:${RCOL[c.rarity]}">${'●'.repeat(c.cost || 1)}</b><button data-unpick="${c.id}" title="Remove">${I.x}</button>` : ''}</span></div>`;
  }).join('')}</div>`;
  const chk = (good, a, b) => `<li class="${good ? 'ok' : ''}"><span>${good ? I.check : ''}</span><b>${a}</b><em>${b}</em></li>`;
  const check = `<ul class="dg-check">${chk(full, `${picks.length} / ${d.squad || 5} cards`, full ? 'Squad full' : 'Pick your squad')}
      ${chk(picks.length > 0 && cost <= budget, `${cost} / ${budget} points`, cost <= budget ? `${budget - cost} points left` : `${cost - budget} over the budget`)}
      ${chk(atk, 'An attacker', atk ? 'Ready to fight' : 'Add a Character or a Creature')}
      ${rule.types || rule.no_rarity ? chk(picks.length > 0 && ruleOk, esc(rule.name), ruleOk ? 'Today\'s rule met' : 'A card breaks the rule') : ''}</ul>`;
  const start = `<button class="v2-btn gold dg-start" ${ok && !dg.busy ? '' : 'disabled'}>${I.sword}Start run</button>`;
  const note = '<small class="dg-note">1 run a day · the squad locks at the start</small>';
  const date = `<span class="dg-date">${new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}</span>`;
  const desc = '<p class="dg-desc">The same dungeon for every member · floors of 5 rooms · room 5 is the floor guardian</p>';
  const timer = `<div class="dg-timer">${I.timer}<span class="l">New dungeon in</span><b class="dg-left">${left(d.next_at)}</b></div>`;
  // Your cards: the filter and the sort.
  const all = d.mine || [];
  const blocked = all.filter((c) => ruleBlock(c));
  const list = all.filter((c) => (dg.filter === 'blocked' ? ruleBlock(c) : !ruleBlock(c)) && (dg.filter === 'atk' ? ATTACKER.has(c.type) : dg.filter === 'sup' ? !ATTACKER.has(c.type) : true))
    .sort((a, b) => (dg.sort === 'cost' ? (a.cost - b.cost) || (b.cp - a.cp) : (b.cp - a.cp)));
  const per = dg.per || (isPort() ? 10 : 8);
  const pages = Math.max(1, Math.ceil(list.length / per));
  dg.page = Math.min(dg.page, pages - 1);
  const grid = list.slice(dg.page * per, dg.page * per + per).map((c) => {
    const n = dg.sel.indexOf(Number(c.id));
    const why = ruleBlock(c);
    const over = why ? `<span class="dg-block">${I.ban}<em>${esc(why)}</em></span>` : n >= 0 ? `<span class="dg-num">${n + 1}</span>` : '';
    return cardTile(c, { cls: `${why ? 'blocked' : ''}${n >= 0 ? ' picked' : ''}`, attr: why ? '' : ` data-pick="${c.id}"`, over });
  }).join('');
  const chip = (k, label, n) => `<button class="dg-chip${dg.filter === k ? ' on' : ''}" data-filter="${k}">${label}${n != null ? ` <b>${n}</b>` : ''}</button>`;
  const sortB = `<div class="dg-sort"><button class="${dg.sort === 'power' ? 'on' : ''}" data-sort="power">Power</button><button class="${dg.sort === 'cost' ? 'on' : ''}" data-sort="cost">Cost</button></div>`;
  const pager = `<div class="dg-pager"><button data-page="-1" ${dg.page ? '' : 'disabled'}>${I.left}</button><b>${dg.page + 1} / ${pages}</b><button data-page="1" ${dg.page < pages - 1 ? '' : 'disabled'}>${I.right}</button></div>`;
  const chips = `<div class="dg-chips">${chip('allowed', `${I.check}Allowed today`)}${chip('atk', 'Attackers', all.filter((c) => ATTACKER.has(c.type) && !ruleBlock(c)).length)}${chip('sup', 'Supports', all.filter((c) => !ATTACKER.has(c.type) && !ruleBlock(c)).length)}${blocked.length ? chip('blocked', `${I.ban}Blocked`, blocked.length) : ''}</div>`;
  const title = `<h3>Your cards <small>${all.length}</small></h3>`;
  const yours = (head) => `<div class="dg-yours"><div class="dg-yhead">${head}</div><div class="dg-grid"${isPort() && dg.pcols ? ` style="grid-template-columns:repeat(${dg.pcols},minmax(0,1fr))"` : ""}>${grid || '<p class="dg-none">No cards here.</p>'}</div></div>`;
  const types = ['Character', 'Creature', 'Item', 'Moment', 'Place'];
  const ruleChips = rule.types ? `<div class="dg-rcs">${types.map((t) => `<span class="dg-rc ${rule.types.includes(t) ? 'yes' : 'no'}">${rule.types.includes(t) ? I.check : I.ban}${t}</span>`).join('')}</div>` : '';
  const ruleIn = `<span class="k">${I.cards}Today's rule</span><h2>${esc(rule.name || 'Everything goes')}</h2><p>${esc(rule.note || '')}</p>${ruleChips}`;
  const best = d.season_best;
  const bestIn = `<div class="k-row"><span class="k">Your best today</span><span class="dg-pill">1 run left</span></div><h2 class="muted">No run yet</h2>
      <div class="dg-mini"><span>Season best<b>${best ? `${best.floor}F Room ${best.room}` : '—'}</b></span><span>Runs today<b>${fmt(d.runs_today)}</b></span></div>`;
  const seg = (keys) => `<div class="dg-seg">${keys.map(([k, icon, label]) => `<button class="${dg.pane === k ? 'on' : ''}" data-pane="${k}">${icon}${label}</button>`).join('')}</div>`;
  const PEOPLE = svg('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1M16 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6"/>');

  if (isPort()) {
    if (!['squad', 'rule', 'top'].includes(dg.pane)) dg.pane = 'squad';
    let body;
    if (dg.pane === 'rule') body = `<section class="dg-panel dg-rule">${ruleIn}</section><section class="dg-panel dg-best">${bestIn}</section>`;
    else if (dg.pane === 'top') body = topHTML();
    else {
      body = `<header class="dg-head"><img class="dg-thumb" src="/dungeon/room.webp" alt=""><div class="dg-title"><h1>${I.castle}${esc(d.name)} ${date}</h1>${desc}</div></header>
        <section class="dg-panel dg-sq"><div class="k-row"><span class="k">Your squad</span>${pts}</div>${bar}${legend}${slots}</section>
        <div class="dg-gorow">${check}${start}</div>${note}
        ${yours(`${title}${sortB}${pager}${chips}`)}`;
    }
    const tabs = seg([['squad', PEOPLE, 'Squad'], ['rule', I.cards, 'Rule'], ['top', I.trophy, 'Top 3']]);
    return `<div class="dg-lobby port"><div class="dg-prow">${tabs}${timer}</div>${body}</div>`;
  }
  if (document.body.classList.contains('m-land')) {
    if (!['rule', 'best', 'top'].includes(dg.pane)) dg.pane = 'rule';
    const paneIn = dg.pane === 'best' ? bestIn : dg.pane === 'top' ? topHTML(true) : ruleIn;
    return `<div class="dg-lobby land">
      <aside class="dg-side">
        <section class="dg-panel dg-info">${date}<h1>${I.castle}${esc(d.name)}</h1>${desc}${timer}</section>
        <section class="dg-panel dg-pane">${seg([['rule', '', 'Rule'], ['best', '', 'Best'], ['top', '', 'Top 3']])}<div class="dg-pane-in">${paneIn}</div></section>
      </aside>
      <div class="dg-col">
        <section class="dg-panel dg-main"><div class="dg-brow"><span class="k">Squad budget</span>${bar}${pts}</div>
          <div class="dg-squad">${slots}<div class="dg-go">${check}${start}</div></div></section>
        <section class="dg-panel dg-cards">${yours(`${title}${chips}${sortB}${pager}`)}</section>
      </div></div>`;
  }
  return `<div class="dg-lobby">
    <section class="dg-panel dg-main">
      <header class="dg-head">
        <img class="dg-thumb" src="/dungeon/room.webp" alt="">
        <div class="dg-title"><h1>${I.castle}${esc(d.name)} ${date}</h1>${desc}</div>
        <div class="dg-budget"><span class="k">Squad budget</span>${pts}${bar}${legend}</div>
      </header>
      <div class="dg-squad">${slots}<div class="dg-go">${check}${start}${note}</div></div>
      ${yours(`${title}${chips}${sortB}${pager}`)}
    </section>
    <aside class="dg-side">${timer}<section class="dg-panel dg-rule">${ruleIn}</section><section class="dg-panel dg-best">${bestIn}</section>${topHTML()}</aside>
  </div>`;
}
function topHTML(bare) {
  const d = dg.data;
  const top = d.top || [];
  const rows = top.length ? top.map((t) => `<li><span class="rk">${t.rank}</span><b>${esc(t.username || 'Member')}</b><em>${t.floor}F Room ${t.room}</em></li>`).join('') : '<li class="none">No runs yet today. Be the first.</li>';
  const inner = `<div class="k-row"><h3>${I.trophy}Today's top 3</h3><small>${fmt(d.runs_today)} run${Number(d.runs_today) === 1 ? '' : 's'}</small></div><ol>${rows}</ol>
    <button class="v2-btn dg-seeboard" data-board>See the leaderboard ${I.arrow}</button>`;
  return bare ? `<div class="dg-top">${inner}</div>` : `<section class="dg-panel dg-top">${inner}</section>`;
}
function wireLobby(main) {
  const M = mine();
  const n = dg.data.squad || 5;
  main.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.pick);
    const i = dg.sel.indexOf(id);
    if (i >= 0) dg.sel.splice(i, 1);
    else if (dg.sel.length < n) dg.sel.push(id);
    else { toast(`Your squad has ${n} cards. Remove one first.`); return; }
    ctx().sfx?.('click'); paint();
  }));
  main.querySelectorAll('[data-unpick]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); dg.sel = dg.sel.filter((x) => x !== Number(b.dataset.unpick)); paint(); }));
  main.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => { dg.pane = b.dataset.pane; dg.per = 0; paint(); }));
  main.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { dg.filter = b.dataset.filter; dg.page = 0; paint(); }));
  main.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { dg.sort = b.dataset.sort; dg.page = 0; paint(); }));
  main.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { dg.page += Number(b.dataset.page); paint(); }));
  main.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard()));
  // Fill the free rows: the page size is the columns x the rows that fit (measured once per size).
  const grid = main.querySelector('.dg-grid'); const one = grid?.querySelector('.dg-card');
  if (grid && one) {
    const flex = getComputedStyle(grid).display === 'flex';   // the landscape phone: one row of full-height cards
    const gapX = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const cols = flex ? Math.max(1, Math.floor((grid.clientWidth + gapX) / (one.getBoundingClientRect().width + gapX))) : getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    const rows = Math.max(1, Math.floor((grid.clientHeight + gap) / (one.getBoundingClientRect().height + gap)));
    // A short portrait screen: smaller cards (more columns) until one full row fits.
    if (isPort() && !flex && grid.clientHeight + 1 < one.getBoundingClientRect().height && (dg.pcols || 5) < 6) { dg.pcols = (dg.pcols || 5) + 1; paint(); return; }
    const per = flex ? cols : cols * rows;   // the portrait lobby is one view too (no scroll)
    if (per !== dg.per) { dg.per = per; paint(); return; }
  }
  main.querySelector('.dg-start')?.addEventListener('click', async () => {
    if (dg.busy) return;
    dg.busy = true; paint();
    let r = null;
    try { r = await ctx().apiPost('/api/dungeon/start', { cards: dg.sel.filter((id) => M.has(id)) }); } catch (e) { r = e?.body || null; }
    dg.busy = false;
    if (!r?.ok) { toast(r?.message || 'The run did not start.'); paint(); return; }
    ctx().sfx?.('click');
    dg.log = []; dg.target = 0; dg.sel = [];
    await load(); paint();
  });
}

// ---- The fight ---------------------------------------------------------------------------------
// The room is built ONCE (fightBuild); every action after that changes the parts in place (fightUpdate),
// so the screen never flickers and the HP bars slide (Nathan, 2026-10-03, items 5 and 10).
const roomKey = () => `${run().floor}-${run().room}`;
const foesOf = (st) => (st?.foes || []).map((f) => ({ ...f, boss: st.room_type === 'guardian', elite: st.room_type === 'elite' }));
function progressHTML() {
  const R = run();
  const rooms = dg.data.rooms || [];
  // A room ahead is "?" (the server hides it, item 15); only the guardian shows.
  const ic = { fight: I.sword, horde: I.horde, elite: I.fire, miniboss: I.crown, treasure: I.chest, rest: I.heart, choice: I.split, guardian: I.skull, unknown: I.q };
  const dots = rooms.map((rm, i) => {
    const n = i + 1;
    const st = n < R.room ? 'done' : n === R.room ? 'now' : 'next';
    const type = n === R.room && R.state?.room_type ? R.state.room_type : rm.type;
    return `${i ? `<i class="dg-link ${n <= R.room ? 'done' : ''}"></i>` : ''}<span class="dg-dot ${st} t-${type}" title="${esc(ROOM[type] || type)}">${st === 'done' ? I.check : ic[type] || I.q}</span>`;
  }).join('');
  const g = rooms[4];
  return `<div class="dg-prog"><div class="dg-fl"><span>Floor ${R.floor}</span><b>Room ${R.room} of 5</b></div><div class="dg-dots">${dots}</div>${g?.name ? `<span class="dg-guard">Guardian: ${esc(g.name)}</span>` : ''}</div>`;
}
function statsHTML() {
  const R = run();
  const st = R.state || {};
  const buff = Math.round(((st.buff || 1) - 1) * 100);
  // Item 12: the floor's loot is at risk (a fall loses it); the guardian banks it (safe).
  const pend = st.pend || {}, bank = st.bank || {};
  const pc = (pend.cards || []).length, bc = (bank.cards || []).length;
  return `<div class="dg-stats"><span class="risk" title="This floor's loot: lost if the squad falls. The floor guardian banks it.">${COIN}<b>${fmt(pend.shards)}${pc ? ` +${pc}${I.cards}` : ''}</b><i>at risk</i></span><span class="bank" title="Banked loot: safe. Yours when the run ends.">${I.lock}<b>${fmt(bank.shards)}${bc ? ` +${bc}${I.cards}` : ''}</b><i>banked</i></span><span title="The run damage bonus">${I.up}<b>+${buff}%</b><i>damage</i></span></div>`;
}
// A weakness / resistance as an icon: an element icon, or a short word (melee, beast ...).
const traitIcon = (v) => {
  const k = String(v || '').replace(/^trait:/, '');
  return elIcon(k) || `<b>${esc(k.slice(0, 6).toUpperCase())}</b>`;
};
const hitsWeak = (c, f) => (f?.weak || []).find((w) => (c.slugs || []).includes(w.value));
const isResist = (c, f) => (f?.resist || []).some((w) => (c.slugs || []).includes(w.value));
const squadOf = (R) => { const M = mine(); return (R.squad || []).map((id) => ({ ...(M.get(Number(id)) || { id }), s: R.state.cards?.[String(id)] || {} })); };
const supDesc = (c) => { const a = c.ability || {}; return (EFFECT[a.effect] || (() => a.effect || ''))(a); };

// The plate name: the element word is its own span (landscape hides it: the icon shows the element).
const plateName = (f) => { const n = String(f.name || ''); const w = n.split(' ')[0]; return f.element && w.toLowerCase() === String(f.element).toLowerCase() ? `<i class="pre">${esc(w)} </i>${esc(n.slice(w.length + 1))}` : esc(n); };
function fightHTML() {
  const R = run(); const st = R.state;
  const foes = foesOf(st);
  const squad = squadOf(R);
  const atk = squad.filter((c) => ATTACKER.has(c.type));
  const sup = squad.filter((c) => !ATTACKER.has(c.type));
  const plate = (f, i) => `<div class="dg-plate${f.boss ? ' boss' : f.elite ? ' elite' : ''}" data-foe="${i}">
      <span class="n">${f.element && elIcon(f.element) ? `<span class="el" title="${esc(f.element)}">${elIcon(f.element)}</span>` : ""}<b>${plateName(f)}</b><small>LV ${f.level}</small><em class="hpn"></em></span>
      <span class="bar"><i></i></span>
      <span class="wk">${(f.weak || []).length ? `<span class="wk-l" title="Weak to">${I.up}${f.weak.map((w) => `<i title="Weak to ${esc(String(w.value).replace(/^trait:/, ''))}">${traitIcon(w.value)}</i>`).join('')}</span>` : ''}${(f.resist || []).length ? `<span class="rs-l" title="Resists">${I.shield}${f.resist.map((w) => `<i title="Resists ${esc(String(w.value).replace(/^trait:/, ''))}">${traitIcon(w.value)}</i>`).join('')}</span>` : ''}</span>
      ${(f.passives || []).length ? `<span class="ps">${f.passives.map((p) => `<i>${esc(p)}</i>`).join('')}</span>` : ''}</div>`;
  // The card art keeps only the power; the weakness tag and the buffs sit in their own row under the
  // card, so nothing overlaps (Nathan, 2026-10-03).
  const unit = (c) => `<div class="dg-unit" data-card="${c.id}">
      ${cardTile(c, { top: `<span class="dg-pw">${I.bolt}${fmt(c.cp)}</span>`, over: '<span class="dg-state"></span><span class="dg-tap">Tap to attack</span>' })}
      <span class="dg-fx"></span>
      <span class="dg-hp"><i></i></span><small class="dg-hpn"></small></div>`;
  const supB = (c) => `<button class="dg-sup" data-sup="${c.id}">
      ${c.image_url ? `<img src="${thumb(c.image_url)}" alt="">` : '<span></span>'}
      <span class="t"><b>${esc(c.name)}</b><small>${esc(supDesc(c))}</small></span><em></em></button>`;
  return `<div class="dg-fight" data-room="${roomKey()}">
    <div class="dg-ftop">${progressHTML()}${statsHTML()}</div>
    <div class="dg-meter"></div>
    <div class="dg-arena">
      <div class="dg-plates">${foes.map(plate).join('')}</div>
      <canvas class="dg-canvas"></canvas>
      <div class="dg-reticle"><i></i></div>
      <div class="dg-pops"></div>
      ${musicBtnHTML()}<button class="dg-auto${dg.auto ? " on" : ""}" title="Auto: the squad fights by itself. It stops at every choice."><i></i>Auto</button>
    </div>
    <div class="dg-hint"></div>
    <div class="dg-units">${atk.map(unit).join('')}</div>
    <aside class="dg-right"><section class="dg-panel dg-shp"><span class="k">Squad HP</span><b class="v"></b><span class="dg-hp big"><i></i></span></section>
      <section class="dg-panel dg-sups"><span class="k">Support</span>${sup.map(supB).join('') || '<p class="dg-none">No support cards in this squad.</p>'}</section></aside>
    <aside class="dg-left-col"><span class="k">Room log</span><ol class="dg-log"></ol></aside>
    <div class="dg-shade"></div>
  </div>`;
}

// The turn meter: you, then every monster standing, in the order they act. A stunned monster shows
// "skips". During the monsters' turn the one acting lights up (dg.acting = its index).
function meterHTML(st) {
  const round = st.round || 0;
  const foes = foesOf(st);
  const mine = dg.acting == null;
  const chips = foes.map((f, i) => {
    if (f.hp <= 0) return '';
    const stun = (f.st || 0) >= round + 1;
    return `<i class="dg-arrow">${I.right}</i><span class="dg-mt foe${dg.acting === i ? ' on' : ''}${stun ? ' skip' : ''}"><b>${esc(f.name.split(' ').slice(-1)[0])}</b><small>${stun ? 'Stunned' : f.boss ? 'Boss' : 'Monster'}</small></span>`;
  }).join('');
  return `<span class="dg-round">Round ${round + 1}</span><span class="dg-mt you${mine ? ' on' : ''}"><b>You</b><small>${mine ? 'Your turn' : 'Done'}</small></span>${chips}`;
}

// Change the parts in place from a state (the server's, or the animation's step).
function fightUpdate(main, st) {
  const F = main.querySelector('.dg-fight');
  if (!F) return;
  const R = run();
  const foes = foesOf(st);
  if (!foes[dg.target] || foes[dg.target].hp <= 0) dg.target = Math.max(0, foes.findIndex((f) => f.hp > 0));
  const tf = foes[dg.target];
  const round = st.round || 0;
  foes.forEach((f, i) => {
    const p = F.querySelector(`.dg-plate[data-foe="${i}"]`);
    if (!p) return;
    p.classList.toggle('on', i === dg.target && f.hp > 0);
    p.classList.toggle('dead', f.hp <= 0);
    p.querySelector('.hpn').textContent = `${fmt(Math.max(0, f.hp))} / ${fmt(f.max)}${f.sh > 0 ? ` +${fmt(f.sh)} guard` : ''}`;
    p.classList.toggle('guarded', f.sh > 0);
    p.querySelector('.bar i').style.width = `${Math.max(0, (f.hp / f.max) * 100)}%`;
  });
  dg.stage?.setTarget?.(tf && tf.hp > 0 ? dg.target : -1);
  const squad = (R.squad || []).map((id) => ({ ...(mine().get(Number(id)) || { id }), s: st.cards?.[String(id)] || {} }));
  let hp = 0, max = 0;
  for (const c of squad) {
    hp += c.s.hp || 0; max += c.s.max || 0;
    const u = F.querySelector(`.dg-unit[data-card="${c.id}"]`);
    if (u) {
      const down = !!c.s.down, stun = !down && (c.s.cd || 0) >= round + 1;
      const pct = Math.max(0, Math.min(100, ((c.s.hp || 0) / Math.max(1, c.s.max || 1)) * 100));
      u.classList.toggle('down', down); u.classList.toggle('stun', stun);
      u.querySelector('.dg-hp i').style.width = `${pct}%`;
      u.querySelector('.dg-hp i').classList.toggle('low', pct < 30);
      u.querySelector('.dg-hpn').innerHTML = `${fmt(c.s.hp)}/${fmt(c.s.max)}${c.s.shield ? ` <em>+${fmt(c.s.shield)}</em>` : ''}`;
      u.querySelector('.dg-hpn').classList.toggle('low', pct < 30);
      u.querySelector('.dg-state').innerHTML = down ? `${I.skull}Down` : stun ? `${I.timer}Stunned` : '';
      // The status row: small icons in ONE fixed-height row (never wraps, the cards never move; Nathan).
      // More than fit: +N. The names are in the tooltip.
      const w = tf && hitsWeak(c, tf), res = !w && tf && isResist(c, tf);
      const fx = [];
      if (w) fx.push(['weak', traitIcon(w.value), 'Weakness: this card does extra damage to the target']);
      if (res) fx.push(['res', I.shield, 'Resisted: the target takes less damage from this card']);
      if ((c.s.buff || 1) > 1) fx.push(['buff', I.up, 'Empowered: the next hit is stronger']);
      if ((c.s.debuff || 1) < 1) fx.push(['bad', I.skull, 'Cursed: this card deals less damage']);
      if ((c.s.psnu ?? -1) >= round + 1 && c.s.psn > 0) fx.push(['psn', I.drop, `Poisoned: -${fmt(c.s.psn)} HP each round`]);
      if (c.s.shield > 0) fx.push(['shd', I.ward, `Shield: blocks ${fmt(c.s.shield)} damage`]);
      if (stun) fx.push(['stn', I.timer, 'Stunned: skips this turn']);
      const box = u.querySelector('.dg-fx'); const room = Math.max(1, Math.floor((box.clientWidth + 3) / 21));
      const shown = fx.length > room ? fx.slice(0, room - 1) : fx;
      box.innerHTML = shown.map(([k, ic, t]) => `<i class="s-${k}" title="${esc(t)}">${ic}</i>`).join('') + (fx.length > shown.length ? `<i class="s-more">+${fx.length - shown.length}</i>` : '');
      box.title = fx.map((x) => x[2]).join(' · ');
    }
    const b = F.querySelector(`.dg-sup[data-sup="${c.id}"]`);
    if (b) {
      // Item 17: one support per turn. After one, the others wait for the next turn (an attack ends it).
      const used = Number(st.sup_round ?? -1) === round;
      const ready = round >= (c.s.cd || 0) && !c.s.down;
      b.disabled = !ready || used || dg.busy;
      b.classList.toggle('wait', !ready || used);
      b.classList.toggle('on', dg.support === Number(c.id));
      b.querySelector('em').innerHTML = c.s.down ? 'Down' : !ready ? `${I.timer}In ${c.s.cd - round} round${c.s.cd - round === 1 ? '' : 's'}` : used ? `${I.lock}Next turn` : `${I.check}Ready`;
    }
  }
  F.querySelector('.dg-shp .v').innerHTML = `${fmt(hp)}<small> / ${fmt(max)}</small>`;
  F.querySelector('.dg-shp .dg-hp i').style.width = `${(hp / Math.max(1, max)) * 100}%`;
  F.querySelector('.dg-meter').innerHTML = meterHTML(st);
  F.querySelector('.dg-log').innerHTML = dg.log.slice(-6).reverse().map((l) => `<li class="${l.kind}"><b>${esc(l.who)}</b><span>→ ${esc(l.to)}</span><em>${l.txt}</em></li>`).join('') || '<li class="none">The fight starts. Tap a card.</li>';
  const sc = dg.support ? mine().get(dg.support) : null;
  F.querySelector('.dg-hint').innerHTML = sc ? `${I.hand}Choose a card for <b>${esc(sc.name)}</b><button class="dg-cancel">Cancel</button>`
    : dg.busy ? `${I.timer}The monsters are acting…` : Number(st.sup_round ?? -1) === round ? `${I.hand}Support used · tap a card to attack` : `${I.hand}${foes.filter((f) => f.hp > 0).length > 1 ? 'Tap a monster to target it · tap a card to attack' : 'Tap a card to attack'}`;
  F.classList.toggle('picking', !!sc);
  F.classList.toggle('busy', !!dg.busy);
  const sb = F.querySelector('.dg-stats'); if (sb) sb.outerHTML = statsHTML();
  placeArena(main);
}
// The name plates sit in a band above the monsters (never on the turn meter, never on each other);
// the reticle marks the target on the monster itself.
function placeArena(main) {
  if (!dg.stage) return;
  const L = dg.stage.labels();
  const canvas = main.querySelector('.dg-canvas');
  const off = canvas ? canvas.offsetTop : 0;
  // Each plate is narrower than the space to its neighbours and stays inside the arena.
  const W = main.querySelector('.dg-arena')?.clientWidth || 0;
  const phone = document.body.classList.contains('m-port') || document.body.classList.contains('m-land');
  const xs = L.filter(Boolean).map((l) => l.x);
  main.querySelectorAll('.dg-plate').forEach((p) => {
    const l = L[Number(p.dataset.foe)];
    if (!l) return;
    const room = Math.min(9999, ...xs.filter((x) => x !== l.x).map((x) => Math.abs(x - l.x))) - 6;
    const w = Math.max(48, Math.min(250, l.w * (phone ? 0.84 : 0.92), room, W ? W - 8 : 9999));
    p.style.width = `${w}px`;
    p.style.left = `${W ? Math.min(Math.max(l.x, w / 2 + 4), W - w / 2 - 4) : l.x}px`;
  });
  const r = main.querySelector('.dg-reticle');
  const l = L[dg.target];
  const alive = (run()?.state?.foes || [])[dg.target]?.hp > 0;
  if (r) {
    r.classList.toggle('on', !!l && alive && !dg.support);
    if (l) { r.style.left = `${l.x}px`; r.style.top = `${off + (l.y + l.foot) / 2}px`; r.style.width = r.style.height = `${Math.max(70, Math.min(170, (l.foot - l.y) * 0.8))}px`; }
  }
}
function pop(main, i, txt, cls = '', dy = 0) {
  const box = main.querySelector('.dg-pops'); const l = dg.stage?.labels()[i]; const canvas = main.querySelector('.dg-canvas');
  if (!box || !l) return;
  const n = document.createElement('span');
  n.className = `dg-pop ${cls}`; n.innerHTML = txt; n.style.left = `${l.x}px`; n.style.top = `${(canvas?.offsetTop || 0) + l.y + 40 + dy}px`;
  box.appendChild(n); setTimeout(() => n.remove(), 1500);
}
function popCard(main, id, txt, cls = '') {
  const u = main.querySelector(`.dg-unit[data-card="${id}"]`);
  if (!u) return;
  const n = document.createElement('span');
  n.className = `dg-pop on-card ${cls}`; n.innerHTML = txt;
  u.appendChild(n); setTimeout(() => n.remove(), 1500);
  u.classList.remove('hurt'); void u.offsetWidth; if (cls === 'hurt') u.classList.add('hurt');
}
async function wireFight(main, keepCanvas) {
  const R = run();
  const F = main.querySelector('.dg-fight');
  const canvas = main.querySelector('.dg-canvas');
  fightUpdate(main, R.state);
  if (keepCanvas) canvas.replaceWith(keepCanvas);
  else {
    dg.stage?.dispose(); dg.stage = null;
    try {
      const { mountStage } = await import('./dungeon-stage.js');
      if (!main.contains(canvas)) return;
      dg.stage = mountStage(canvas, { onPick: (i) => target(main, i), onLayout: () => placeArena(main) });
      dg.stage.canvas = canvas;
      dg.roomKey = roomKey();
      await dg.stage.setFoes(foesOf(R.state));
      { const fs0 = foesOf(R.state).filter((x) => x.hp > 0); loadVoices(fs0); if (fs0.length && (R.state.round || 0) === 0) snd(voiceOf(fs0[0].key).roar, fs0[0].boss ? 0.75 : 0.45); }
      fightUpdate(main, run().state);
    } catch (e) { console.warn('dungeon stage', e); }
  }
  requestAnimationFrame(() => placeArena(main));
  F.querySelector('.dg-auto')?.addEventListener('click', (e) => { e.stopPropagation(); dg.auto = !dg.auto; localStorage.setItem(AUTO, dg.auto ? '1' : ''); e.currentTarget.classList.toggle('on', dg.auto); ctx().sfx?.('click'); autoNext(); });
  autoNext();
  F.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('.dg-cancel') || t.closest('.dg-shade')) { dg.support = null; fightUpdate(main, run().state); return; }
    if (t.closest('.card-info')) { const id = Number(t.closest('.dg-card')?.dataset.id); if (id) openInfo(id); return; }
    const p = t.closest('[data-foe]'); if (p) { target(main, Number(p.dataset.foe)); return; }
    if (t.closest('.dg-retreat')) { retreat(); return; }
    const s = t.closest('[data-sup]');
    if (s && !s.disabled) {
      const id = Number(s.dataset.sup);
      const tgt = mine().get(id)?.ability?.target || 'boss';
      if (tgt === 'ally' || tgt === 'self') { dg.support = dg.support === id ? null : id; fightUpdate(main, run().state); return; }
      act('support', { cardId: id, targetFoe: dg.target });
      return;
    }
    const u = t.closest('.dg-unit');
    if (u) {
      const id = Number(u.dataset.card);
      if (dg.support) { const sid = dg.support; dg.support = null; act('support', { cardId: sid, targetCard: id }); return; }
      if (u.classList.contains('down')) { toast('That card is down.'); return; }
      act('attack', { cardId: id, target: dg.target });
    }
  });
}
function target(main, i) {
  const f = (run()?.state?.foes || [])[i];
  if (!f || f.hp <= 0 || i === dg.target) return;
  dg.target = i; ctx().sfx?.('click'); fightUpdate(main, run().state);
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
// One action: the hit lands at once, then each monster takes its turn in order with a clear pause,
// the meter lights the one acting, and every HP bar moves step by step. The server's state is the
// truth at the end (fightUpdate with r.state).
async function act(kind, body) {
  if (dg.busy) return false;
  const main = document.getElementById('main');
  dg.busy = true; fightUpdate(main, run().state);
  let r = null;
  try { r = await ctx().apiPost(`/api/dungeon/${kind}`, body); } catch (e) { r = e?.body || null; }
  if (!r?.ok) { dg.busy = false; fightUpdate(main, run().state); toast(r?.message || 'That did not work.'); return false; }
  const M = mine();
  const before = clone(run().state);
  const foes = foesOf(before);
  const nm = (id) => M.get(Number(id))?.name || 'Card';
  const step = clone(before);
  if (kind === 'attack') {
    const t = r.target ?? body.target;
    const f = foes[t];
    // Item 13: the card's element effect from the Raid flies to the monster, then the hit lands.
    if (dg.stage?.cast) { const elx = cardElement(M.get(Number(body.cardId))?.tags) || 'physical'; snd(elx, 0.6); dg.stage.cast(t, elx); await sleep(dg.auto ? 300 : 480); }
    ctx().sfx?.(r.damage > 0 ? 'hit' : 'click');
    dg.stage?.play(t, r.kill ? 'death' : 'hit');
    if (r.kill) { mvoice(f, 'die', 0.6); if (f?.boss) snd('boss:defeat', 0.6); } else if (r.damage > 0) mvoice(f, 'hurt', 0.45);
    pop(main, t, r.damage > 0 ? `-${fmt(r.damage)}${r.crit ? '<small>CRITICAL</small>' : r.double ? '<small>DOUBLE</small>' : r.bonus ? '<small>WEAKNESS</small>' : r.resisted ? '<small>RESISTED</small>' : ''}` : r.guarded > 0 ? 'BLOCKED' : 'MISS', r.crit ? 'crit' : r.damage > 0 ? '' : 'miss');
    if (r.guarded > 0) { pop(main, t, `${I.shield}-${fmt(r.guarded)} guard`, 'act', -34); step.foes[t].sh = Math.max(0, (step.foes[t].sh || 0) - r.guarded); }
    // The monster's HP moves now (the final value from the server).
    step.foes[t].hp = r.state.foes[t].hp;
    if (r.heal) { const k = String(body.cardId); step.cards[k].hp = Math.min(step.cards[k].max, step.cards[k].hp + r.heal); popCard(main, body.cardId, `+${fmt(r.heal)}`, 'heal'); }
    dg.log.push({ kind: 'me', who: nm(body.cardId), to: f?.name || 'Monster', txt: r.damage > 0 ? `-${fmt(r.damage)}${r.crit ? ' <i>CRIT</i>' : ''}` : 'miss' });
    if (r.kill) { dg.log.push({ kind: 'kill', who: f?.name || 'Monster', to: 'defeated', txt: `${COIN}+${fmt(r.loot?.shards)}` }); lootDrop(main, t, r.loot); }
    fightUpdate(main, step);
    await sleep(r.kill ? 1100 : 750);
    const hurt = (id, d, label = '') => { const k = String(id); if (!step.cards[k] || !d) return; step.cards[k].hp = Math.max(0, step.cards[k].hp - d); popCard(main, id, `-${fmt(d)}${label}`, 'hurt'); };
    // Poison ticks first (item 20: Acid Spit, Infect).
    if ((r.poison || []).length) {
      for (const p of r.poison) hurt(p.card, p.dmg, ' poison');
      dg.log.push({ kind: 'foe', who: 'Poison', to: r.poison.map((p) => nm(p.card)).join(', '), txt: `-${fmt(r.poison.reduce((a, p) => a + (p.dmg || 0), 0))}` });
      fightUpdate(main, step); await sleep(550);
    }
    // The monsters' turn, one by one: each uses a named move from its pool (item 20).
    for (const e of r.enemy || []) {
      dg.acting = e.foe; fightUpdate(main, step);
      const move = e.move || ACT[e.action] || e.action;
      pop(main, e.foe, esc(move), 'act move', -30);
      await sleep(450);
      dg.stage?.foeFx?.(e.foe, e.action);   // item 13: the Raid boss effect of the move
      if (e.action !== 'stunned') mvoice(foes[e.foe], 'atk', 0.55);
      if (['slam', 'cataclysm', 'curse', 'poison', 'enrage', 'charging', 'stunned'].includes(e.action)) snd(MOVE_SND[e.action], 0.4);
      if (e.action !== 'stunned' && e.action !== 'charging' && (e.dmg || (e.area || []).length)) { dg.stage?.play(e.foe, 'attack'); await sleep(380); }
      hurt(e.card, e.dmg, e.hits > 1 ? ` ×${e.hits}` : '');
      for (const a of e.area || []) hurt(a.card, a.dmg);
      if (e.dot > 0 && e.dmg > 0) popCard(main, e.card, `${I.drop}Poisoned`, 'debuff');
      if (e.action === 'stun' && e.dmg > 0) popCard(main, e.card, `${I.timer}Stunned`, 'debuff');
      if (e.action === 'curse') popCard(main, e.card, 'CURSED', 'debuff');
      if (e.guard > 0) { step.foes[e.foe].sh = (step.foes[e.foe].sh || 0) + e.guard; pop(main, e.foe, `${I.shield}+${fmt(e.guard)} guard`, 'heal', 10); }
      if (e.heal > 0) { step.foes[e.foe].hp = Math.min(step.foes[e.foe].max, step.foes[e.foe].hp + e.heal); pop(main, e.foe, `+${fmt(e.heal)}`, 'heal'); }
      if (e.dmg) ctx().sfx?.('hit');
      const area = (e.area || []).reduce((a, x) => a + (x.dmg || 0), 0);
      dg.log.push({ kind: 'foe', who: `${ef(foes, e.foe)} · ${move}`, to: e.dmg ? nm(e.card) : area ? 'the squad' : (ACT[e.action] || e.action), txt: e.dmg || area ? `-${fmt((e.dmg || 0) + area)}${area ? ' all' : ''}` : '' });
      fightUpdate(main, step);
      await sleep(650);
    }
    dg.acting = null;
    if (r.burned > 0) popCard(main, body.cardId, `-${fmt(r.burned)} burn`, 'hurt');
  } else {
    ctx().sfx?.('click');
    const tx = body.targetCard ? nm(body.targetCard) : foes[body.targetFoe]?.name || 'Monster';
    dg.log.push({ kind: 'sup', who: nm(body.cardId), to: tx, txt: esc(r.effect || '') });
    if (body.targetCard) popCard(main, body.targetCard, esc((r.effect || '').toUpperCase()), 'heal');
    else pop(main, body.targetFoe, esc((r.effect || '').toUpperCase()), 'act');
    if (r.kill) { dg.stage?.play(body.targetFoe, 'death'); lootDrop(main, body.targetFoe, null); }
    await sleep(r.kill ? 900 : 350);
  }
  if (r.loot?.card) toast('A card dropped!');
  // The truth from the server, then the run totals (Shards, cards) in the background.
  dg.data.run.state = r.state;
  dg.busy = false;
  const phase = r.state?.phase;
  if (r.status === 'over' || phase !== 'fight') { await load(); if (ctx().currentView() === 'dungeon') paint(); return true; }
  fightUpdate(main, r.state);
  load().then(() => { if (ctx().currentView() === 'dungeon' && main.querySelector('.dg-fight')) fightUpdate(main, run().state); });
  autoNext();
  return true;
}
// ---- Auto (item 16) ------------------------------------------------------------------------------
// The squad plays by itself in a fight: at most one useful support, then the best attack. It stops at
// every choice (rewards, chests, doors, the floor screen): those stay the member's. Auto counts on the
// leaderboard (Nathan). Every rule still runs in SQL; Auto only picks the same actions a tap would.
let autoT = null;
function autoNext() {
  clearTimeout(autoT);
  if (!dg.auto) return;
  autoT = setTimeout(autoStep, 550);
}
async function autoStep() {
  const R = run(); const st = R?.state;
  if (!dg.auto || dg.busy || dg.support || !st || st.phase !== 'fight' || ctx().currentView() !== 'dungeon' || !document.querySelector('.dg-fight')) return;
  const M = mine(); const round = st.round || 0;
  const foes = foesOf(st);
  const alive = foes.map((f, i) => ({ ...f, i })).filter((f) => f.hp > 0);
  if (!alive.length) return;
  // The target: the monster closest to falling (fewer monsters acting sooner).
  const tf = alive.reduce((a, b) => (b.hp < a.hp ? b : a));
  dg.target = tf.i;
  const squad = squadOf(R);
  const atk = squad.filter((c) => ATTACKER.has(c.type) && !c.s.down);
  const ready = atk.filter((c) => (c.s.cd || 0) < round + 1);
  const pool = ready.length ? ready : atk;
  if (!pool.length) return;
  // The attacker: a weakness hit first, then the most power.
  const best = pool.reduce((a, b) => ((hitsWeak(b, tf) ? 1 : 0) - (hitsWeak(a, tf) ? 1 : 0) || b.cp - a.cp) > 0 ? b : a);
  // One support per turn, only when it helps.
  if (Number(st.sup_round ?? -1) !== round) {
    const low = (p) => atk.filter((c) => c.s.hp / Math.max(1, c.s.max) < p).sort((a, b) => a.s.hp / a.s.max - b.s.hp / b.s.max)[0];
    for (const c of squad.filter((x) => !ATTACKER.has(x.type) && !x.s.down && round >= (x.s.cd || 0))) {
      const key = `${c.id}:${R.floor}:${R.room}:${round}`;
      if (dg.autoSkip.has(key)) continue;
      const a = c.ability || {}; const tg = a.target || 'boss';
      let body = null;
      if (tg === 'ally' || tg === 'self') {
        const who = a.effect === 'heal' ? low(0.5) : a.effect === 'shield' ? low(0.6) : a.effect === 'empower' ? best : null;
        if (who) body = { cardId: c.id, targetCard: who.id };
      } else if (a.effect === 'cleanse') {
        if (squad.some((x) => (x.s.debuff || 1) < 1 || (x.s.psnu ?? -1) >= round + 1)) body = { cardId: c.id };
      } else if (a.effect === 'stun') {
        if ((tf.st || 0) < round) body = { cardId: c.id, targetFoe: tf.i };
      } else body = { cardId: c.id, targetFoe: tf.i };
      if (!body) continue;
      dg.autoSkip.add(key);   // tried once this round (a refusal never loops)
      if (await act('support', body)) return;   // act() schedules the next step
      autoNext(); return;
    }
  }
  if (!(await act('attack', { cardId: best.id, target: tf.i }))) { dg.auto = false; localStorage.setItem(AUTO, ''); document.querySelector('.dg-auto')?.classList.remove('on'); }
}
const ef = (foes, i) => foes[i]?.name || 'Monster';
// Sounds (Nathan: like the Raid boss): the Raid samples through main.js SFX. Each monster type has its
// own voice (a roar and a growl from the pool, by its key); each move its boss sound; each card its element.
const snd = (k, peak) => { try { ctx().sfxSample?.(k, peak); } catch { /* sound is optional */ } };
const MOVE_SND = { strike: 'boss:strike', heavy: 'boss:strike', flurry: 'boss:strike', drain: 'boss:strike', stun: 'boss:strike', slam: 'boss:slam', cataclysm: 'boss:slam', curse: 'boss:curse', poison: 'boss:curse', enrage: 'boss:enrage', charging: 'boss:enrage', stunned: 'boss:stunned' };
// Each monster type's own voice (CC0, public/sfx/dungeon/CREDITS.md): its attack, hurt and death sounds.
const DSND = {
  slime: { atk: ['slime_01', 'slime_03'], hurt: ['slime_05'], die: ['slime_08'] },
  ooze: { atk: ['spit_01', 'slime_02'], hurt: ['slime_06'], die: ['slime_07'] },
  skeleton: { atk: ['attack_01', 'attack_02'], hurt: ['hurt_01'], die: ['die_01'] },
  zombie: { atk: ['grunt_03', 'burp_01'], hurt: ['cough_01'], die: ['die_02'] },
  giant: { atk: ['troll_01', 'troll_02', 'stomp_01'], hurt: ['grunt_05'], die: ['troll_03'] },
  yeti: { atk: ['roar_02', 'howl'], hurt: ['grunt_07'], die: ['roar_05'] },
  demon: { atk: ['monster_04', 'monster_09'], hurt: ['monster_12'], die: ['monster_17'] },
  golem: { atk: ['stomp_01', 'grunt_01'], hurt: ['grunt_09'], die: ['die_03'] },
  squid: { atk: ['burble_01', 'bug_05'], hurt: ['bug_09'], die: ['burble_02'] },
  raptor: { atk: ['scream_01', 'attack_04'], hurt: ['hurt_03'], die: ['scream_02'] },
};
const loadVoices = (foes) => { for (const f of foes) for (const list of Object.values(DSND[f.key] || {})) for (const n of list) ctx().sfxLoad?.(`dg:${n}`, `sfx/dungeon/${n}.mp3`); };
// Play a monster sound: its own voice when it has one, else the shared Raid pool.
const mvoice = (f, kind, peak) => { const l = DSND[f?.key]?.[kind]; if (l?.length) snd(`dg:${l[Math.floor(Math.random() * l.length)]}`, peak); else if (kind !== 'hurt') snd(kind === 'die' ? voiceOf(f?.key).growl : voiceOf(f?.key).roar, peak); };
const voiceOf = (key) => { let h = 0; for (const ch of String(key || 'm')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return { roar: `mon:roar${1 + (h % 4)}`, growl: `mon:growl${1 + ((h >> 3) % 3)}` }; };
// A loot drop: Shards fly up from the monster (and a card when one dropped).
function lootDrop(main, i, loot) {
  const box = main.querySelector('.dg-pops'); const l = dg.stage?.labels()[i]; const canvas = main.querySelector('.dg-canvas');
  if (!box || !l) return;
  const y = (canvas?.offsetTop || 0) + (l.y + l.foot) / 2;
  for (let k = 0; k < 6; k++) {
    const n = document.createElement('span');
    n.className = 'dg-drop'; n.innerHTML = COIN;
    n.style.left = `${l.x}px`; n.style.top = `${y}px`;
    n.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`); n.style.setProperty('--dy', `${-60 - Math.random() * 90}px`);
    n.style.animationDelay = `${k * 40}ms`;
    box.appendChild(n); setTimeout(() => n.remove(), 1400);
  }
  if (loot?.card) {
    const n = document.createElement('span');
    n.className = 'dg-drop card'; n.innerHTML = I.cards; n.style.left = `${l.x}px`; n.style.top = `${y}px`;
    box.appendChild(n); setTimeout(() => n.remove(), 1600);
  }
}
// An in-app confirm window (window.confirm does not open inside the Discord Activity: Retreat did nothing).
function confirmBox(title, text, ok) {
  return new Promise((done) => {
    const w = document.createElement('div');
    w.className = 'dg-modal';
    w.innerHTML = `<div class="dg-mbox"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="dg-mbtn"><button class="v2-btn" data-m="0">Cancel</button><button class="v2-btn gold" data-m="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(w);
    w.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b && e.target !== w) return; w.remove(); done(b?.dataset.m === '1'); });
  });
}
async function retreat() {
  if (!(await confirmBox('Retreat with the loot?', 'The run ends here. You keep your depth and every banked Shard and card.', 'Retreat'))) return;
  let r = null;
  try { r = await ctx().apiPost('/api/dungeon/retreat', {}); } catch (e) { r = e?.body || null; }
  if (!r?.ok) { toast(r?.message || 'That did not work.'); return; }
  await load(); paint();
}

// ---- Between fights: a reward, a rest, a chest, a choice of doors ----------------------------------
// Item 7: 3 random offers, each with a tier (Common .. Legend, the colour); the last pick never comes
// back next, Heal once per floor. Item 14: the chest opens (its tier), the loot is at risk until the
// floor guardian. Item 15: a choice room offers doors. No Retreat here (item 12: only between floors).
const tierTag = (t) => (TIER[t] ? `<span class="dg-tier" style="--tc:${TIER[t][1]}">${TIER[t][0]}</span>` : '');
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
// The card odds of a tier (settings.dungeon.chest_rarity weights: Normal, IR, SR), rolled when the card is picked.
function oddsLine(w) {
  if (!Array.isArray(w)) return 'At risk until the floor guardian falls.';
  const sum = w.reduce((a, x) => a + (+x || 0), 0) || 1;
  return ['Normal', 'IR', 'SR'].map((l, i) => [Math.round(((+w[i] || 0) * 100) / sum), l]).filter(([p]) => p > 0).map(([p, l]) => `${p}% ${l}`).join(' · ') + ' · at risk';
}
function offerInfo(o) {
  return {
    heal: [I.heart, `Heal ${pct(o.amount)}`, 'Every standing card heals. Once per floor.'],
    buff: [I.up, `+${pct(o.amount)} damage`, 'For the rest of the run.'],
    shards: [COIN, `${fmt(o.amount)} Shards`, 'At risk until the floor guardian falls.'],
    card: [I.cards, 'A random card', oddsLine(o.odds)],
    ward: [I.ward, `Ward ${pct(o.amount)}`, 'Every card starts the next fight with a shield.'],
    reset: [I.reset, 'Cooldown reset', 'Every support is ready again.'],
    revive: [I.heart, `Revive at ${pct(o.amount)}`, 'The downed cards stand up again. Once per floor.'],
    continue: [I.arrow, 'Continue', 'To the next room.'],
    door: {
      elite: [I.fire, 'The Elite door', 'A strong monster. Better loot.'],
      rest: [I.heart, 'The quiet door', 'A rest: heal and revive.'],
      treasure: [I.chest, 'The treasure door', 'A chest.'],
      horde: [I.horde, 'The loud door', 'A horde of weaker monsters.'],
      gamble: [I.q, 'The dark door', 'A rare chest, or an ambush. 50 / 50.'],
    }[o.to] || [I.door, 'A door', ''],
  }[o.kind] || [I.check, o.kind, ''];
}
function chooseHTML() {
  const R = run(); const st = R.state;
  const ph = st.phase;
  const offer = (o, i) => {
    const t = offerInfo(o);
    return `<button class="dg-offer k-${o.kind}${o.to ? ` to-${o.to}` : ''}" data-choose="${i}" style="${TIER[o.tier] ? `--tc:${TIER[o.tier][1]}` : ''}">${tierTag(o.tier)}<span class="ic">${t[0]}</span><b>${t[1]}</b><small>${t[2]}</small></button>`;
  };
  const head = {
    choose: ['Room cleared', 'Choose a reward', 'Pick one. Each reward has a tier: Common, Uncommon, Rare, Ultra, Legend.'],
    rest: ['Rest room', 'Take a breath', 'The squad healed 40%, and each downed card came back with 25% HP.'],
    path: ['A choice', 'Pick a door', 'Each door leads to a different room.'],
    chest: ['Treasure room', 'You found a chest', 'Tap the chest to open it.'],
  }[ph] || ['', '', ''];
  const body = ph === 'chest' ? chestHTML(st) : `<div class="dg-offers n${(st.offers || []).length}">${(st.offers || []).map(offer).join('')}</div>`;
  return `<div class="dg-choose">
    <div class="dg-ftop">${progressHTML()}${statsHTML()}</div>
    <section class="dg-panel dg-cbox ph-${ph}">${musicBtnHTML()}<span class="k">${head[0]}</span><h2>${head[1]}</h2><p>${head[2]}</p>${body}</section>
  </div>`;
}
// The chest (item 14): closed until tapped; then the lid opens, its tier glows, the loot shows.
function chestHTML(st) {
  const c = st.chest || {};
  const t = TIER[c.tier] || TIER[1];
  const card = c.card ? dg.data.lootCards?.[c.card] : null;
  return `<div class="dg-chest" style="--tc:${t[1]}">
      <button class="dg-chestbox" aria-label="Open the chest"><span class="glow"></span><canvas class="dg-chest3d"></canvas><span class="lid"></span><span class="base"><i></i></span></button>
      <div class="dg-chestloot"><span class="dg-tier big" style="--tc:${t[1]}">${t[0]} chest</span>
        <div class="dg-chestrow"><span class="dg-chsh">${COIN}<b>+${fmt(c.shards)}</b><small>Shards</small></span>
        ${card ? flipHTML([card], 'chest') : ''}</div>
        <small class="dg-risk">${I.lock}At risk until the floor guardian falls.</small>
        <button class="v2-btn gold dg-cont" data-choose="0">${I.arrow}Continue</button></div>
    </div>`;
}
// Cards face down; a tap flips one (the same as a pack). Used by the chest, the floor screen, the end.
function flipHTML(list, key) {
  return list.map((c, i) => `<button class="dg-flip r-${c.rarity || 'normal'}" data-flip="${key}:${i}" data-id="${c.id}" style="--rc:${RCOL[c.rarity] || '#9AA3B5'}; --d:${i * 90}ms">
      <span class="face back">${cardBack ? `<img src="${esc(cardBack)}" alt="">` : '<i></i>'}</span>
      <span class="face front">${cardTile({ ...c, cost: null }, { top: '', info: false })}</span></button>`).join('');
}
// The face-down cards take the largest size that fits the free space, in as many rows as that needs
// (the screen never scrolls: tcg-bot/docs/DESIGN.md, screen rules).
function fitFlips(main) {
  main.querySelectorAll('.dg-flips').forEach((box) => {
    const n = box.children.length; if (!n) return;
    const gap = parseFloat(getComputedStyle(box).columnGap) || 10;
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    let best = 0;
    for (let r = 1; r <= n; r++) {
      const per = Math.ceil(n / r);
      const byW = ((w - gap * (per - 1)) / per) * 7 / 5, byH = (h - gap * (r - 1)) / r;
      best = Math.max(best, Math.min(byW, byH));
    }
    box.style.setProperty('--fh', `${Math.floor(Math.min(best, 280))}px`);
  });
}
window.addEventListener('resize', () => { const m = document.getElementById('main'); if (m?.querySelector('.dg-flips')) fitFlips(m); });
function wireFlips(main) {
  fitFlips(main);
  const flip = (b) => { if (b.classList.contains('up')) { const id = Number(b.dataset.id); if (id) openInfo(id); return; } b.classList.add('up'); ctx().sfx?.('flip'); };
  main.querySelectorAll('[data-flip]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); flip(b); }));
  main.querySelector('.dg-reveal')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    [...main.querySelectorAll('[data-flip]:not(.up)')].forEach((b, i) => setTimeout(() => flip(b), i * 220));
  });
  if (cardBack == null) getBack().then(() => { if (ctx().currentView() === 'dungeon' && main.querySelector('[data-flip]') && cardBack) main.querySelectorAll('.dg-flip .face.back').forEach((f) => { f.innerHTML = `<img src="${esc(cardBack)}" alt="">`; }); });
}
async function choose(pick) {
  if (dg.busy) return;
  dg.busy = true;
  let r = null;
  try { r = await ctx().apiPost('/api/dungeon/choose', { pick }); } catch (e) { r = e?.body || null; }
  dg.busy = false;
  if (!r?.ok) { toast(r?.message || 'That did not work.'); return; }
  ctx().sfx?.('click');
  if (r.door === 'elite') toast('An ambush!');
  dg.log = []; dg.target = 0;
  await load(); paint();
}
function wireChoose(main) {
  main.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.choose))));
  const box = main.querySelector('.dg-chestbox');
  // The 3D chest (a real model with its open animation); the drawn chest stays as the fallback.
  const cv = box?.querySelector('.dg-chest3d');
  if (cv) {
    cv.addEventListener('chest-ready', () => box.classList.add('has3d'), { once: true });
    import('./dungeon-chest.js').then(({ mountChest }) => { if (main.contains(cv)) { dg.chest?.dispose(); dg.chest = mountChest(cv, getComputedStyle(box.closest('.dg-chest')).getPropertyValue('--tc').trim() || '#9AA3B5'); } }).catch(() => {});
  }
  box?.addEventListener('click', () => {
    if (box.closest('.dg-chest').classList.contains('open')) return;
    dg.chest?.open();
    snd('boss:enrage', 0.25);
    setTimeout(() => { box.closest('.dg-chest').classList.add('open'); ctx().sfx?.('rare'); }, dg.chest ? 650 : 0);
  });
  wireFlips(main);
}

// ---- The floor is done: the loot gained (item 12) ---------------------------------------------------
// The guardian fell: this floor's loot is banked (safe). Descend (the next floor's loot is at risk
// again) or Retreat and keep everything banked. Retreat lives only here.
function floorDoneHTML() {
  const R = run(); const st = R.state;
  const fl = st.floor_loot || {}; const bank = st.bank || {};
  const cards = (fl.cards || []).map((id) => dg.data.lootCards?.[id] || { id });
  const capLeft = Math.max(0, (dg.data.cap || 300) - (bank.shards || 0));
  return `<div class="dg-over dg-floordone">
    <section class="dg-panel dg-obox dg-fdbox">${musicBtnHTML()}
      <div class="dg-ohead"><div class="dg-fdhead"><span class="k">${I.castle}${esc(dg.data.name)} · Floor ${R.floor}</span><h1>Floor ${R.floor} cleared!</h1><p>The guardian fell. This floor's loot is banked: it is safe now.</p></div>
      <div class="dg-depth dg-fdstats"><span>Loot gained<b>${COIN}+${fmt(fl.shards)}</b></span><span>Banked<b>${I.lock}${fmt(bank.shards)}${(bank.cards || []).length ? ` +${(bank.cards || []).length}${I.cards}` : ''}</b></span><span>Cap left<b>${fmt(capLeft)}</b></span></div></div>
      <div class="dg-lootrow">${cards.length ? `<div class="dg-lhead"><h3>Cards found <small>${cards.length}</small></h3><button class="v2-btn gold dg-reveal">${I.cards}Reveal all</button></div><div class="dg-flips" style="--n:${cards.length}">${flipHTML(cards, 'floor')}</div>` : '<p class="muted dg-nocards">No cards on this floor.</p>'}</div>
      <div class="dg-obtn dg-fdbtn"><button class="v2-btn dg-leave">${I.door}Retreat with the loot</button><button class="v2-btn gold dg-next" data-choose="0">${I.arrow}Descend to Floor ${R.floor + 1}</button></div>
      <small class="dg-risk">${I.lock}On the next floor, the new loot is at risk until its guardian falls. Banked loot is always safe.</small>
    </section>
  </div>`;
}
function wireFloorDone(main) {
  main.querySelector('.dg-next')?.addEventListener('click', () => choose(0));
  main.querySelector('.dg-leave')?.addEventListener('click', () => retreat());
  wireFlips(main);
}

// ---- The run is over: the loot screen ----------------------------------------------------------
// One screen, no scroll (Nathan items 25, 26): the result, the totals, and the cards found FACE DOWN;
// tap a card (or Reveal all) to flip it, the same as a pack.
let cardBack = null;
const getBack = async () => { if (cardBack == null) { try { cardBack = (await (await fetch('/api/config')).json()).backUrl || ''; } catch { cardBack = ''; } } return cardBack; };
function overHTML() {
  const R = run();
  const t = { cleared: ['Dungeon cleared!', 'You beat every floor of today\'s dungeon.'], retreat: ['You retreated', 'A safe exit with your loot.'], fell: ['Your squad fell', 'The run ends here. Here is what you found.'] }[R.ended_by] || ['Run over', ''];
  const loot = dg.data.loot || [];
  const cards = loot.map((c, i) => `<button class="dg-flip r-${c.rarity || 'normal'}" data-flip="${i}" style="--rc:${RCOL[c.rarity] || '#9AA3B5'}; --d:${i * 90}ms">
      <span class="face back">${cardBack ? `<img src="${esc(cardBack)}" alt="">` : '<i></i>'}</span>
      <span class="face front">${cardTile({ ...c, cost: null }, { top: '', info: false })}</span></button>`).join('');
  return `<div class="dg-over">
    <section class="dg-panel dg-obox">
      <div class="dg-ohead"><div><span class="k">${I.castle}${esc(dg.data.name)}</span><h1>${t[0]}</h1><p>${t[1]}</p></div>
        <div class="dg-depth"><span>Depth<b>${R.floor}F Room ${R.room}</b></span><span>Rank today<b>#${R.rank || '—'}</b></span><span>Shards<b>${COIN}<em class="dg-count" data-to="${R.shards}">0</em></b></span><span>Turns<b>${fmt(R.turns)}</b></span></div></div>
      <div class="dg-lootrow">${cards ? `<div class="dg-lhead"><h3>Cards found <small>${loot.length}</small></h3><button class="v2-btn gold dg-reveal">${I.cards}Reveal all</button></div><div class="dg-flips${loot.length > 6 ? ' two' : ''}" style="--n:${loot.length}">${cards}</div>` : '<p class="muted dg-nocards">No cards dropped this run.</p>'}</div>
      <div class="dg-obtn"><button class="v2-btn" data-board>${I.trophy}See the leaderboard</button><small class="dg-note">${I.timer}A new dungeon in <b class="dg-left">${left(dg.data.next_at)}</b></small></div>
    </section>
  </div>`;
}
function wireOver(main) {
  fitFlips(main);
  main.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard()));
  // The Shards count up.
  const c = main.querySelector('.dg-count');
  if (c) { const to = Number(c.dataset.to) || 0; const t0 = performance.now(); const f = (t) => { const k = Math.min(1, (t - t0) / 1200); c.textContent = fmt(Math.round(to * k * (2 - k))); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
  const flip = (b) => { if (b.classList.contains('up')) { const it = (dg.data.loot || [])[Number(b.dataset.flip)]; if (it) openInfo(Number(it.id)); return; } b.classList.add('up'); ctx().sfx?.('flip'); };
  main.querySelectorAll('[data-flip]').forEach((b) => b.addEventListener('click', () => flip(b)));
  main.querySelector('.dg-reveal')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    [...main.querySelectorAll('[data-flip]:not(.up)')].forEach((b, i) => setTimeout(() => flip(b), i * 220));
  });
  if (cardBack == null) getBack().then(() => { if (ctx().currentView() === 'dungeon' && main.querySelector('.dg-over') && cardBack) paint(); });
}

// ---- The leaderboard ---------------------------------------------------------------------------
let board = null;
async function openBoard() {
  dg.view = 'board'; board = null; paint();
  try { board = await ctx().api('/api/dungeon/board'); } catch { board = { board: [] }; }
  if (ctx().currentView() === 'dungeon' && dg.view === 'board') paint();
}
function boardHTML() {
  const me = ctx().user()?.id;
  const rows = board ? (board.board || []).map((b) => `<li class="${String(b.player_id) === String(me) ? 'me' : ''}${b.rank <= 3 ? ` top${b.rank}` : ''}">
      <span class="rk">${b.rank}</span><b>${esc(b.username || 'Member')}</b><em>${b.floor}F Room ${b.room}</em><small>${fmt(b.turns)} turns${b.status === 'active' ? ' · in the dungeon' : ''}</small></li>`).join('') || '<li class="none">No runs yet today.</li>' : '<li class="none">Loading…</li>';
  return `<div class="dg-board"><section class="dg-panel">
    <div class="k-row"><button class="v2-btn dg-back">${I.back}Back</button><h2>${I.trophy}Today's leaderboard</h2><small>The deepest first · then fewer turns</small></div>
    <ol class="dg-rows">${rows}</ol></section></div>`;
}
function wireBoard(main) { main.querySelector('.dg-back')?.addEventListener('click', () => { dg.view = 'main'; paint(); }); }
