// The Dungeon Run (design 30, approved by Nathan 2026-10-03: desktop, portrait and landscape).
// Screens: today's dungeon (the squad picker on the rarity budget), the fight, choose a reward, the
// run over, the leaderboard. The Adventure tabs (Hunt | Dungeon | Arena soon | Expeditions soon).
// Every rule and roll lives in SQL (dungeon.sql on the shared combat core); the data comes from
// src/dungeon-routes.js. The monsters are 3D (src/dungeon-stage.js, loaded on demand), bigger on
// screen (Nathan). The flag: /api/flags -> dungeon (DUNGEON_USERS / FEATURE_DUNGEON).
// The Gauntlet (gauntlet.sql, Nathan 2026-10-03) is the same screens with dg.mode = 'gauntlet': the week's
// squad for everyone (no picker), one run a day, no loot, the weekly board and prizes.
import { v2ctx, toast, mergedCards } from './ui-v2.js';
import { flairHTML } from './flair.js';
import { elIcon } from './element-icons.js';
import { thumb } from './thumb.js';
import { isPort } from './mobile.js';
import { gateHTML, wireGate } from './ui-v2-gate.js';
import { COIN } from './ui-v2-shop.js';
import { cardElement } from './elements.js';
import { setMood, stopMusic, toggleMute, musicBtnHTML, paintMusicBtn } from './dungeon-music.js';
import { openCardPicker, closeCardPicker } from './ui3/card-picker.js';
import { icon as ui3Icon } from './ui3/icons.js';
import { button as btn3, segmented as ui3Segmented } from './ui3/components.js';
import { TOKENS } from './tokens.js';
import { fmtFor } from './ui3/number.js';

const ctx = () => v2ctx();
const icon3 = (name, size = 'md') => ui3Icon(name, { size });
const segmented3 = (items, label) => ui3Segmented(items, { label });
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
dg.mode = localStorage.getItem(LAST) === 'gauntlet' ? 'gauntlet' : 'daily';
const GA = () => dg.mode === 'gauntlet';
const API = () => (GA() ? '/api/gauntlet' : '/api/dungeon');
// Switch the mode (the Dungeon tab or the Gauntlet tab): a new mode loads its own data.
function setMode(m) {
  if (dg.mode === m) return;
  dg.mode = m; dg.data = null; dg.view = 'main'; dg.pane = ''; dg.log = []; dg.target = 0; dg.sel = [];
  dg.stage?.dispose(); dg.stage = null; dg.roomKey = '';
}

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
    const last = localStorage.getItem(LAST) || 'dungeon';
    if (last !== 'dungeon' && last !== 'gauntlet') return;
    setMode(last === 'gauntlet' ? 'gauntlet' : 'daily');
    e.stopImmediatePropagation();
    ctx().sfx?.('click'); ctx().show('dungeon');
  }, true);
}

// The tab strip, also shown on the Hunt view (main.js advTabs).
export function advTabsHTML(active) {
  if (!dg.on) return '';
  const t = (k, icon, label, soon) => `<button class="dg-tab${active === k ? ' on' : ''}"${soon ? ' disabled' : ` data-adv="${k}"`}>${icon}<span>${label}</span>${soon ? '<i>SOON</i>' : ''}</button>`;
  return `<div class="dg-tabs v2-subtabs" role="tablist">${t('hunt', I.sword, 'Hunt')}${t('dungeon', I.castle, 'Dungeon')}${t('gauntlet', I.crown, 'Gauntlet')}${t('arena', I.shield, 'Arena', true)}${t('exp', I.compass, 'Expeditions', true)}</div>`;
}
export function wireAdvTabs(root) {
  root.querySelectorAll('[data-adv]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.adv;
    localStorage.setItem(LAST, k);
    ctx().sfx?.('click');
    if (k !== 'hunt') setMode(k === 'gauntlet' ? 'gauntlet' : 'daily');
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
  const m = dg.mode;
  try { d = await ctx().api(API()); } catch { d = null; }
  if (m !== dg.mode) return dg.data;   // the member switched tabs while it loaded
  dg.data = d && d.ok ? d : { closed: true, message: GA() && d?.error === 'disabled' ? 'The Gauntlet is closed.' : d?.message || (GA() ? 'The Gauntlet is closed.' : 'The Dungeon is closed.') };
  return dg.data;
}
// The member's cards (the Dungeon), or the week's squad (the Gauntlet: the same base cards for everyone).
const cardsOf = () => dg.data?.mine || (Array.isArray(dg.data?.squad) ? dg.data.squad : []);
const mine = () => new Map(cardsOf().map((c) => [Number(c.id), c]));
const run = () => dg.data?.run || null;
const active = () => run()?.status === 'active';

export async function renderDungeonV2() {
  const { el } = ctx();
  localStorage.setItem(LAST, GA() ? 'gauntlet' : 'dungeon');
  markDock();
  dg.per = 0; dg.pcols = 0; dg.v3tabs = false; dg.tight = 0; // measure the card grid and the v3 side column again (the size may have changed)
  if (!dg.on) { el('main').innerHTML = '<div class="dg-closed"><b>The Dungeon is closed.</b></div>'; return; }
  if (dg.data && !dg.data.closed) paint(); else el('main').innerHTML = `<div class="loading">${GA() ? 'Opening the Gauntlet…' : 'Opening the dungeon…'}</div>`;
  // The star gems come from the collection (ascension per copy): load it when it is not cached yet.
  const needCol = !ctx().cache.collection;
  const m = dg.mode;
  await Promise.all([load(), needCol ? Promise.resolve(ctx().refreshOwned?.()).catch(() => {}) : null]);
  if (ctx().currentView() !== 'dungeon' || m !== dg.mode) return;
  paint();
}
function markDock() {
  document.querySelectorAll('#dock .dk').forEach((b) => b.classList.toggle('active', b.dataset.view === 'battling'));
}
export function disposeDungeon() {
  clearInterval(tick); tick = null;
  dg.stage?.dispose(); dg.stage = null; dg.roomKey = '';
  clearTimeout(autoT); stopMusic(); dg.chest?.dispose(); dg.chest = null;
  closeCardPicker();   // the Card picker belongs to the lobby (UI-64)
}

function left(iso) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
// A long wait (the week): days and hours.
function leftLong(iso) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  return s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : left(iso);
}
function startTick() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (ctx().currentView() !== 'dungeon') { disposeDungeon(); return; }
    const at = dg.data?.next_at;
    if (!at) return;
    if (new Date(at).getTime() <= Date.now()) { dg.sel = []; load().then(() => { if (ctx().currentView() === 'dungeon') paint(); }); return; }
    document.querySelectorAll('.dg-left').forEach((n) => { n.textContent = left(at); });
    if (dg.data?.ends_at) document.querySelectorAll('.dg-wleft').forEach((n) => { n.textContent = leftLong(dg.data.ends_at); });
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
  else if (!d.gate?.ok) body = gateHTML(d.gate || {}, GA() ? 'the Gauntlet' : 'the Dungeon');
  else if (dg.view === 'board') body = boardHTML();
  else if (fight) body = fightHTML();
  else if (active() && d.run.state?.phase === 'floor_done') body = floorDoneHTML();
  else if (active()) body = chooseHTML();
  else if (run()) body = overHTML();
  else body = GA() ? gaLobbyHTML() : V3() ? lobbyV3HTML() : lobbyHTML();
  main.innerHTML = `<div class="v2-dungeon${GA() ? ' ga' : ''}${fight ? ' dg-fighting' : ''}${d.run?.state?.phase ? ` ph-${d.run.state.phase}` : ''}">${body}</div>`;
  // Item 19: the music follows the room (silent until Nathan picks the tracks: dungeon-music.js).
  setMood(fight ? (['guardian', 'miniboss'].includes(d.run.state.room_type) ? 'boss' : 'fight') : active() ? 'explore' : null);
  main.querySelectorAll('[data-music]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); paintMusicBtn(b); }));
  advTabs(GA() ? 'gauntlet' : 'dungeon'); // the Adventure tabs: the same place as on the Hunt view (Nathan item 2)
  main.querySelectorAll('.card-info').forEach((b) => b.addEventListener('click', (e) => { if (fight) return; e.stopPropagation(); const id = Number(b.closest('.dg-card')?.dataset.id); if (id) openInfo(id); }));
  wireGate(main);
  if (dg.view === 'board') wireBoard(main);
  else if (fight) wireFight(main, keep);
  else if (active() && d.run.state?.phase === 'floor_done') wireFloorDone(main);
  else if (active()) wireChoose(main);
  else if (run()) wireOver(main);
  else if (!d.closed && d.gate?.ok) (GA() ? wireGaLobby : V3() ? wireLobbyV3 : wireLobby)(main);
  startTick();
}

const cardTile = (c, opts = {}) => {
  const r = c?.rarity || 'normal';
  return `<div class="dg-card r-${r}${opts.cls ? ' ' + opts.cls : ''}" data-id="${c?.id}"${opts.attr || ''} style="--rc:${RCOL[r] || '#9AA3B5'}">
    ${c?.image_url ? `<img src="${thumb(c.image_url)}" alt="" loading="lazy">` : ''}
    ${opts.top ?? `<span class="dg-pt">${c.cost ?? 1}<small>PT</small></span><span class="dg-pw">${I.bolt}${fmt(c.cp)}</span>`}
    <span class="dg-nm"><b>${esc(c?.name || '?')}</b><small>◆ ${esc(RL(r))}</small></span>
    ${flairHTML(GA() ? 0 : ascOf(c?.id))}${opts.info === false ? '' : '<button class="card-info" data-info="1" aria-label="Details">🔍</button>'}
    ${opts.over || ''}
  </div>`;
};
// The member's star level of a card (the collection cache) and the full card for the viewer.
const ascOf = (id) => (ctx().cache.collection?.cards || []).find((x) => Number(x.id) === Number(id))?.ascension || 0;
function openInfo(id) {
  // The viewer with the ability, the effect, the tags, and the squad numbers (power, HP, points).
  const row = cardsOf().find((x) => Number(x.id) === Number(id));
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
  const date = `<span class="dg-date">${new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}</span>`;
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
      body = `<header class="dg-head"><img class="dg-thumb" src="/dungeon/room.webp" alt=""><div class="dg-title"><h1>${I.castle}${esc(d.name)} ${date}</h1></div></header>
        <section class="dg-panel dg-sq"><div class="k-row"><span class="k">Your squad</span>${pts}</div>${bar}${legend}${slots}</section>
        <div class="dg-gorow">${check}${start}</div>
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
        <section class="dg-panel dg-info">${date}<h1>${I.castle}${esc(d.name)}</h1>${timer}</section>
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
        <div class="dg-title"><h1>${I.castle}${esc(d.name)} ${date}</h1></div>
        <div class="dg-budget"><span class="k">Squad budget</span>${pts}${bar}${legend}</div>
      </header>
      <div class="dg-squad">${slots}<div class="dg-go">${check}${start}</div></div>
      ${yours(`${title}${chips}${sortB}${pager}`)}
    </section>
    <aside class="dg-side">${timer}<section class="dg-panel dg-rule">${ruleIn}</section><section class="dg-panel dg-best">${bestIn}</section>${topHTML()}</aside>
  </div>`;
}
// ---- v3: today's dungeon (UI-46) and the Card picker (UI-64), behind the ui_v3 flag --------------------------------
// The approved design (design repo UI-46/approved): the squad slots, the budget, the live checks, "Select your squad" /
// Edit and Start run; no card grid in the view (D-40). The grid is the Card picker window (UI-64, src/ui3/card-picker.js).
// Build condition of the approval (P1): "Your best today" shows on every class (a panel, or the Rule / Best / Top 3 tabs).
const V3 = () => document.body.classList.contains('ui-v3');
const cls3 = () => document.body.dataset.size || 'expanded';
const fmt3 = (n) => fmtFor(n, cls3());   // 10.5: the compact number form on the compact classes (the counters of the v3 room screens)
/** The checks of a squad (one source for the view and the picker): size, budget, an attacker, today's rule. */
function squadStatus(ids) {
  const d = dg.data;
  const M = mine();
  const picks = ids.map((id) => M.get(Number(id))).filter(Boolean);
  const size = d.squad || 5;
  const budget = d.budget || 12;
  const cost = picks.reduce((t, c) => t + (c.cost || 1), 0);
  const full = picks.length === size;
  const atk = picks.some((c) => ATTACKER.has(c.type));
  const ruleOk = picks.every((c) => !ruleBlock(c));
  const rule = d.rule || {};
  const checks = [
    { ok: full, label: `${picks.length} / ${size} cards` },
    { ok: picks.length > 0 && cost <= budget, label: `${cost} / ${budget} points` },
    { ok: atk, label: 'An attacker' },
    ...(rule.types || rule.no_rarity ? [{ ok: picks.length > 0 && ruleOk, label: rule.name || 'Today\'s rule' }] : []),
  ];
  return { picks, size, budget, cost, ok: full && cost <= budget && atk && ruleOk, checks };
}
function budgetBarHTML(s) {
  const segs = []; s.picks.forEach((c) => { for (let i = 0; i < (c.cost || 1); i++) segs.push(c.rarity || 'normal'); });
  return `<div class="u3-dg-bar" role="img" aria-label="${s.cost} of ${s.budget} points">${Array.from({ length: Math.max(s.budget, segs.length) }, (_, i) => `<i class="${segs[i] ? `u3-r-${esc(segs[i])} is-on` : ''}${i >= s.budget ? ' is-over' : ''}"></i>`).join('')}</div>`;
}
const ptsHTML = (s) => `<b class="u3-dg-pts${s.cost > s.budget ? ' is-bad' : ''}">${s.cost}<span> / ${s.budget} pts</span></b>`;
const checksHTML3 = (s) => `<ul class="u3-dg-checks">${s.checks.map((k) => `<li class="${k.ok ? 'is-ok' : ''}">${icon3(k.ok ? 'circle-check' : 'circle')}<span>${esc(k.label)}</span></li>`).join('')}</ul>`;
function slotsHTML3(s) {
  return `<div class="u3-dg-slots"><ol class="u3-dg-slots__in" aria-label="Your squad">${Array.from({ length: s.size }, (_, i) => {
    const c = s.picks[i];
    const tag = dg.tight ? 'div' : 'button';   // tight: a preview; the Select / Edit button is the action (9.1)
    return `<li class="u3-dg-slot${c ? ` is-full u3-r-${esc(c.rarity || 'normal')}` : ''}"><${tag}${dg.tight ? '' : ' type="button" data-pickopen'} class="u3-dg-slot__card" aria-label="${c ? `Slot ${i + 1}: ${esc(c.name || 'card')}, ${c.cost || 1} points` : `Slot ${i + 1}, empty`}${dg.tight ? '' : c ? '. Edit the squad' : '. Select your squad'}">`
      + `${c ? `${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" draggable="false">` : ''}<span class="u3-pk-badge" aria-hidden="true">${c.cost || 1} PT</span>` : `<span class="u3-dg-slot__n" aria-hidden="true">${i + 1}</span>`}</${tag}>`
      + `<span class="u3-dg-slot__label">Slot ${i + 1}</span></li>`;
  }).join('')}</ol></div>`;
}
function lobbyV3HTML() {
  const d = dg.data;
  const s = squadStatus(dg.sel);
  const rule = d.rule || {};
  const size = cls3();
  const date = `<span class="u3-dg-date">${esc(new Date(d.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase())}</span>`;
  const head = `<header class="u3-dg-head"><img class="u3-dg-thumb" src="/dungeon/room.webp" alt="">${icon3('castle', 'lg')}<h1 class="u3-dg-name">${esc(d.name)}</h1>${date}</header>`;
  const timer = `<section class="u3-dg-panel u3-dg-timer">${icon3('timer')}<span>New dungeon in</span><b class="dg-left">${left(d.next_at)}</b></section>`;
  const pick = s.picks.length ? btn3({ label: 'Edit', data: { pickopen: '1' } }) : btn3({ label: 'Select your squad', variant: 'primary', data: { pickopen: '1' } });
  const start = btn3({ label: 'Start run', icon: 'swords', variant: 'primary', disabled: !s.ok || dg.busy, busy: dg.busy, busyLabel: 'Starting', data: { start3: '1' } });
  const types = ['Character', 'Creature', 'Item', 'Moment', 'Place'];
  const ruleChips = rule.types ? `<div class="u3-dg-rchips">${types.map((t) => `<span class="u3-dg-rchip ${rule.types.includes(t) ? 'is-yes' : 'is-no'}">${icon3(rule.types.includes(t) ? 'check' : 'ban')}${t}</span>`).join('')}</div>` : '';
  const ruleIn = `<span class="u3-label u3-dg-k">${icon3('layers')}Today's rule</span><h2 class="u3-dg-h">${esc(rule.name || 'Everything goes')}</h2>${rule.note ? `<p class="u3-dg-p">${esc(rule.note)}</p>` : ''}${ruleChips}`;
  const best = d.season_best;
  const bestIn = `<span class="u3-label u3-dg-k">${icon3('star')}Your best today</span><h2 class="u3-dg-h is-muted">No run yet</h2>`
    + `<dl class="u3-dg-mini"><div><dt>Season best</dt><dd>${best ? `${best.floor}F Room ${best.room}` : 'None yet'}</dd></div><div><dt>Runs today</dt><dd>${fmt(d.runs_today)}</dd></div></dl>`;
  const top = d.top || [];
  const topIn = `<div class="u3-dg-toph"><h2 class="u3-dg-h">${icon3('trophy', 'lg')}Today's top 3</h2><span class="u3-dg-runs">${fmt(d.runs_today)} run${Number(d.runs_today) === 1 ? '' : 's'}</span></div>`
    + `<ol class="u3-dg-top">${top.length ? top.map((t) => `<li><span>${t.rank}</span><b>${esc(t.username || 'Member')}</b><em>${t.floor}F Room ${t.room}</em></li>`).join('') : '<li class="is-none">No runs yet today. Be the first.</li>'}</ol>`
    + btn3({ label: 'See the leaderboard', icon: null, data: { board: '1' } }).replace('</span></button>', `</span>${icon3('arrow-right')}</button>`);
  const tabs = (keys) => `<div class="u3-dg-tabs">${segmented3(keys.map(([k, ic, label]) => ({ id: `pane:${k}`, icon: ic, label, active: dg.pane === k, controls: `u3DgPane-${k}` })), 'Today')}</div>`;
  const paneIn = { rule: ruleIn, best: bestIn, top: topIn };
  // every tab panel is in the page; the inactive ones are hidden (P1: content moves into a tab, it is not removed)
  const panels = (map) => Object.entries(map).map(([k, html]) => `<div class="u3-dg-tabpanel" role="tabpanel" id="u3DgPane-${k}"${dg.pane === k ? '' : ' hidden'}>${html}</div>`).join('');
  const squadPanel = (withHead, extra = '') => `<section class="u3-dg-panel u3-dg-main"><div class="u3-dg-hrow">${withHead ? head : ''}${extra}`
    + `<div class="u3-dg-budget"><span class="u3-label">${size === 'compact-port' ? 'Your squad' : 'Squad budget'}</span>${ptsHTML(s)}</div>${budgetBarHTML(s)}</div>${slotsHTML3(s)}`
    + (size === 'compact-port' ? `<div class="u3-dg-act">${pick}</div></section><div class="u3-dg-go">${checksHTML3(s)}${start}</div>`
      : `<div class="u3-dg-foot">${checksHTML3(s)}<div class="u3-dg-act">${pick}${start}</div></div></section>`);
  if (size === 'compact-port') {
    if (!['squad', 'rule', 'top'].includes(dg.pane)) dg.pane = 'squad';
    const body = panels({ squad: `${head}${squadPanel(false)}`, rule: `<section class="u3-dg-panel">${ruleIn}</section><section class="u3-dg-panel">${bestIn}</section>`, top: `<section class="u3-dg-panel">${topIn}</section>` });
    return `<div class="u3-dg u3-dg--port"${dg.tight ? ` data-tight="${dg.tight}"` : ''}><div class="u3-dg-prow">${tabs([['squad', 'users', 'Squad'], ['rule', 'layers', 'Rule'], ['top', 'trophy', 'Top 3']])}${timer}</div>${body}</div>`;
  }
  if (size === 'medium' && innerHeight > innerWidth) {
    if (!dg.v3tabs) return `<div class="u3-dg u3-dg--stack"${dg.tight ? ` data-tight="${dg.tight}"` : ''}>${squadPanel(true)}<div class="u3-dg-below">${timer}<section class="u3-dg-panel u3-dg-rule">${ruleIn}</section><section class="u3-dg-panel">${bestIn}</section><section class="u3-dg-panel">${topIn}</section></div></div>`;
    if (!['rule', 'best', 'top'].includes(dg.pane)) dg.pane = 'rule';
    return `<div class="u3-dg u3-dg--stack"${dg.tight ? ` data-tight="${dg.tight}"` : ''}>${squadPanel(true)}<div class="u3-dg-below is-tabs">${timer}<section class="u3-dg-panel u3-dg-pane">${tabs([['rule', null, 'Rule'], ['best', null, 'Best'], ['top', null, 'Top 3']])}<div class="u3-dg-pane__in">${panels(paneIn)}</div></section></div></div>`;
  }
  if (size === 'compact-land' || dg.v3tabs) {
    if (!['rule', 'best', 'top'].includes(dg.pane)) dg.pane = 'rule';
    // tight: the timer moves next to the name (where the budget line was), so the tab panel has the side column
    const t2 = dg.tight ? `<div class="u3-dg-timer u3-dg-timer--inline">${icon3('timer')}<b class="dg-left">${left(d.next_at)}</b></div>` : '';
    return `<div class="u3-dg u3-dg--side-tabs"${dg.tight ? ` data-tight="${dg.tight}"` : ''}><aside class="u3-dg-side">${dg.tight ? '' : timer}<section class="u3-dg-panel u3-dg-pane">${tabs([['rule', null, 'Rule'], ['best', null, 'Best'], ['top', null, 'Top 3']])}<div class="u3-dg-pane__in">${panels(paneIn)}</div></section></aside>${squadPanel(true, t2)}</div>`;
  }
  return `<div class="u3-dg"${dg.tight ? ` data-tight="${dg.tight}"` : ''}><aside class="u3-dg-side">${timer}<section class="u3-dg-panel">${ruleIn}</section><section class="u3-dg-panel">${bestIn}</section><section class="u3-dg-panel">${topIn}</section></aside>${squadPanel(true)}</div>`;
}
function openDungeonPicker(from) {
  const d = dg.data;
  const cap = d.squad || 5;
  const budget = d.budget || 12;
  const all = d.mine || [];
  const blocked = all.some((c) => ruleBlock(c));
  const costOf = (sel) => { const M = mine(); return sel.reduce((t, id) => t + (M.get(Number(id))?.cost || 1), 0); };
  const text = (c) => [c.name, c.type, RL(c.rarity), ...(Array.isArray(c.tags) ? c.tags : [])].join(' ').toLowerCase();
  openCardPicker({
    title: 'Squad', cap, cards: all, selected: dg.sel, returnFocus: from,
    badge: (c) => `${c.cost ?? 1} PT`,
    blocked: (c, sel) => ruleBlock(c) || (sel.length >= cap ? 'Squad full' : '') || (costOf(sel) + (c.cost || 1) > budget ? 'Over the budget' : ''),
    filters: [
      { key: 'show', label: 'Show', value: 'allowed', clear: 'all', options: [{ id: 'allowed', label: 'Allowed today' }, { id: 'atk', label: 'Attackers' }, { id: 'sup', label: 'Supports' },
        ...(blocked ? [{ id: 'blocked', label: 'Blocked' }] : []), { id: 'all', label: 'All cards' }] },
      { key: 'sort', label: 'Sort', value: 'power', clear: 'power', options: [{ id: 'power', label: 'Power' }, { id: 'cost', label: 'Cost' }] },
    ],
    filterCount: (v) => (v.show !== 'all' ? 1 : 0),
    apply: (cards, v, q) => {
      const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return cards.filter((c) => {
        const why = ruleBlock(c);
        if (v.show === 'allowed' && why) return false;
        if (v.show === 'blocked' && !why) return false;
        if (v.show === 'atk' && (why || !ATTACKER.has(c.type))) return false;
        if (v.show === 'sup' && (why || ATTACKER.has(c.type))) return false;
        return !words.length || words.every((w) => text(c).includes(w));
      }).sort((a, b) => (v.sort === 'cost' ? (a.cost - b.cost) || (b.cp - a.cp) : (b.cp - a.cp)));
    },
    status: (sel) => { const s = squadStatus(sel); return { checks: s.checks, ready: s.ok, reason: null }; },
    detail: (c) => openInfo(c.id),
    onConfirm: (sel) => { dg.sel = sel; ctx().sfx?.('click'); paint(); return true; },
  });
}
function wireLobbyV3(main) {
  const M = mine();
  main.querySelectorAll('[data-pickopen]').forEach((b) => b.addEventListener('click', () => openDungeonPicker(b)));
  main.querySelectorAll('[data-seg^="pane:"]').forEach((b) => b.addEventListener('click', () => { dg.pane = b.dataset.seg.slice(5); paint(); }));
  main.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard()));
  // medium and expanded: the side column shows every panel when they fit, else the Rule / Best / Top 3 tabs (P1)
  const side = main.querySelector('.u3-dg:not(.u3-dg--side-tabs):not(.u3-dg--port) .u3-dg-side, .u3-dg-below:not(.is-tabs)');
  if (side && side.scrollHeight > side.clientHeight + 1) { dg.v3tabs = true; paint(); return; }
  // a short screen: the tight mode when a slot is smaller than a tap target (9.1), or a column overflows
  const slot = main.querySelector('.u3-dg-tabpanel:not([hidden]) .u3-dg-slot__card, .u3-dg-main .u3-dg-slot__card');
  const over = [...main.querySelectorAll('.u3-dg-main, .u3-dg-side, .u3-dg-tabpanel:not([hidden])')].some((n) => n.scrollHeight > n.clientHeight + 1);
  if (!dg.tight && ((slot && slot.getBoundingClientRect().width < TOKENS['card-mini']) || over)) { dg.tight = 1; paint(); return; }
  main.querySelector('[data-start3]')?.addEventListener('click', async () => {
    if (dg.busy || !squadStatus(dg.sel).ok) return;
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
  if (GA()) {   // the Gauntlet: no loot; the week's best and the run bonus
    const b = dg.data.best;
    return `<div class="dg-stats"><span title="Your best run this week">${I.trophy}<b>${b ? `${b.floor}F R${b.room}` : '—'}</b><i>week best</i></span><span title="The run damage bonus">${I.up}<b>+${buff}%</b><i>damage</i></span></div>`;
  }
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
const ctlHTML = () => `${musicBtnHTML()}<button class="dg-auto${dg.auto ? " on" : ""}" title="Auto: the squad fights by itself. It stops at every choice."><i></i>Auto</button>`;
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
      <span class="t"><b>${esc(c.name)}</b><small>${esc(supDesc(c))}</small></span><em></em></button>`;   // D-156: a support has no HP bar in the Dungeon and the Gauntlet (they never go down, D-126)
  return `<div class="dg-fight" data-room="${roomKey()}">
    <div class="dg-ftop">${progressHTML()}${statsHTML()}</div>
    <div class="dg-meter"></div>
    <div class="dg-arena">
      <div class="dg-plates">${foes.map(plate).join('')}</div>
      <canvas class="dg-canvas"></canvas>
      <div class="dg-reticle"><i></i></div>
      <div class="dg-pops"></div>
      ${V3() ? '' : ctlHTML()}
    </div>
    ${V3() ? `<div class="dg-ctl">${musicBtnHTML()}<div class="dg-hint"></div><button class="dg-auto${dg.auto ? ' on' : ''}" title="Auto: the squad fights by itself. It stops at every choice."><i></i>Auto</button></div>` : '<div class="dg-hint"></div>'}
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
      b.disabled = (!ready || used || dg.busy) && !(V3() && dg.support && !dg.busy);   // v3 (D-70): while a support is picking a target, every support is a valid target
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
// v3 (UI-47): the fight stacks (the phone layout of the approved frames) on a compact-port phone and on a tall tablet. The tall tablet is
// measured on the fight box itself (F-1): the box is taller than wide. The class is read again after a resize.
let fightRO = null;
function fitFightV3(F) {
  fightRO?.disconnect(); fightRO = null;
  if (!V3() || !F) return;
  const measure = () => {
    if (!F.isConnected) return;
    const tile = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-tile-max')) || 112;
    F.classList.toggle('is-stack', cls3() === 'compact-port' || (cls3() === 'medium' && F.clientHeight > F.clientWidth));
    F.classList.toggle('is-narrow', cls3() === 'compact-port' && F.clientWidth < 3.5 * tile); F.classList.toggle('is-slim', cls3() === 'medium' && F.clientWidth < 6.4 * tile);
    // is-short, is-short2: the fight is taller than its box, or the stage is under 2.2 widest card tiles high: the cards, then Squad HP and the supports, take less room
    const arena = F.querySelector('.dg-arena');
    F.classList.remove('is-short', 'is-short2');
    const over = () => F.scrollHeight > F.clientHeight + 1 || (arena && arena.clientHeight < 2.2 * tile);
    if (F.classList.contains('is-stack') && over()) { F.classList.add('is-short'); if (over()) F.classList.add('is-short2'); }
    placeArena(document.getElementById('main'));
  };
  measure();
  document.fonts?.ready.then(measure);
  if (typeof ResizeObserver === 'function') { fightRO = new ResizeObserver(measure); fightRO.observe(F); const ar = F.querySelector('.dg-arena'); if (ar) fightRO.observe(ar); }
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
    if (V3()) {   // UI-47: the plates stand in even slots over the stage, one slot for each monster (the approved frames), whatever the monsters' size
      const cnt = Math.max(1, L.length), slot = (W || 0) / cnt, gap = phone ? 4 : 8;
      p.style.width = `${Math.max(48, slot - gap)}px`;
      p.style.left = `${slot * (Number(p.dataset.foe) + 0.5)}px`;
      return;
    }
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
  fitFightV3(F);
  F.querySelector('.dg-auto')?.addEventListener('click', (e) => { e.stopPropagation(); dg.auto = !dg.auto; localStorage.setItem(AUTO, dg.auto ? '1' : ''); e.currentTarget.classList.toggle('on', dg.auto); ctx().sfx?.('click'); autoNext(); });
  autoNext();
  F.addEventListener('click', (e) => {
    const t = e.target;
    if (V3() && dg.support && !t.closest('.dg-unit, .dg-sup, .dg-hint')) { dg.support = null; fightUpdate(main, run().state); return; }   // v3 (UI-47): the dim layer is drawn, not a box, so a tap outside the targets cancels here
    if (t.closest('.dg-cancel') || t.closest('.dg-shade')) { dg.support = null; fightUpdate(main, run().state); return; }
    if (t.closest('.card-info')) { const id = Number(t.closest('.dg-card')?.dataset.id); if (id) openInfo(id); return; }
    const p = t.closest('[data-foe]'); if (p) { target(main, Number(p.dataset.foe)); return; }
    if (t.closest('.dg-retreat')) { retreat(); return; }
    const s = t.closest('[data-sup]');
    if (s && V3() && dg.support && Number(s.dataset.sup) !== dg.support && !dg.busy) {   // v3 (UI-47, D-70): a support is a valid target of another support
      const sid = dg.support; dg.support = null; act('support', { cardId: sid, targetCard: Number(s.dataset.sup) }); return;
    }
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
  try { r = await ctx().apiPost(`/api/dungeon/${kind}`, { ...body, mode: dg.mode }); } catch (e) { r = e?.body || null; }
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
    if (r.kill) { dg.log.push({ kind: 'kill', who: f?.name || 'Monster', to: 'defeated', txt: GA() ? '' : `${COIN}+${fmt(r.loot?.shards)}` }); if (!GA()) lootDrop(main, t, r.loot); }
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
    if (V3()) {   // UI-49: the one window system (Dialog look, scrim, Cancel + the action, no close button: a blocking confirm)
      w.className = 'u3-dgs-modal';
      w.innerHTML = `<div class="u3-scrim" data-u3-scrim><div class="u3-dialog u3-dgs-dlg" role="dialog" aria-modal="true" aria-labelledby="u3DgsT"><div><h2 class="u3-dialog__title" id="u3DgsT">${esc(title)}</h2><p class="u3-dialog__line">${esc(text)}</p></div>`
        + `<footer class="u3-dialog__foot">${btn3({ label: 'Cancel', data: { m: '0' } })}${btn3({ label: ok, variant: 'primary', data: { m: '1' } })}</footer></div></div>`;
      document.body.appendChild(w);
      w.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b && !e.target.matches('[data-u3-scrim]')) return; w.remove(); done(b?.dataset.m === '1'); });
      const dlg = w.querySelector('.u3-dialog'); dlg.tabIndex = -1; dlg.focus({ preventScroll: true });   // the window takes the focus (no ring on a button)
      return;
    }
    w.className = 'dg-modal';
    w.innerHTML = `<div class="dg-mbox"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="dg-mbtn"><button class="v2-btn" data-m="0">Cancel</button><button class="v2-btn gold" data-m="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(w);
    w.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b && e.target !== w) return; w.remove(); done(b?.dataset.m === '1'); });
  });
}
async function retreat() {
  if (!(await (GA() ? confirmBox('End the run here?', 'Your depth counts for this week. Your next Gauntlet run is tomorrow.', 'End the run')
    : confirmBox('Retreat with the loot?', 'The run ends here. You keep your depth and every banked Shard and card.', 'Retreat')))) return;
  let r = null;
  try { r = await ctx().apiPost('/api/dungeon/retreat', { mode: dg.mode }); } catch (e) { r = e?.body || null; }
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
  if (!Array.isArray(w)) return '';
  const sum = w.reduce((a, x) => a + (+x || 0), 0) || 1;
  return ['Normal', 'IR', 'SR'].map((l, i) => [Math.round(((+w[i] || 0) * 100) / sum), l]).filter(([p]) => p > 0).map(([p, l]) => `${p}% ${l}`).join(' · ');
}
function offerInfo(o) {
  return {
    heal: [I.heart, `Heal ${pct(o.amount)}`, 'Once per floor'],
    buff: [I.up, `+${pct(o.amount)} damage`, ''],
    shards: [COIN, `${fmt(o.amount)} Shards`, ''],
    card: [I.cards, 'A random card', oddsLine(o.odds)],
    ward: [I.ward, `Shield ${pct(o.amount)}`, ''],   // D-125: the internal kind stays 'ward'; the member sees "Shield"
    reset: [I.reset, 'Cooldown reset', ''],
    revive: [I.heart, `Revive at ${pct(o.amount)}`, 'Once per floor'],
    continue: [I.arrow, 'Continue', ''],
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
  if (V3() && ['choose', 'rest', 'path', 'chest'].includes(ph)) return chooseV3HTML(R, st);   // UI-48 (the reward) and UI-49 (rest, doors, chest)
  const offer = (o, i) => {
    const t = offerInfo(o);
    return `<button class="dg-offer k-${o.kind}${o.to ? ` to-${o.to}` : ''}" data-choose="${i}" style="${TIER[o.tier] ? `--tc:${TIER[o.tier][1]}` : ''}">${tierTag(o.tier)}<span class="ic">${t[0]}</span><b>${t[1]}</b>${t[2] ? `<small>${t[2]}</small>` : ''}</button>`;
  };
  const head = {
    choose: ['Room cleared', 'Choose a reward', ''],
    rest: ['Rest room', 'Take a breath', 'The squad healed 40%, and each downed card came back with 25% HP.'],
    path: ['A choice', 'Pick a door', ''],
    chest: ['Treasure room', 'You found a chest', 'Tap the chest to open it.'],
  }[ph] || ['', '', ''];
  const body = ph === 'chest' ? chestHTML(st) : `<div class="dg-offers n${(st.offers || []).length}">${(st.offers || []).map(offer).join('')}</div>`;
  return `<div class="dg-choose">
    <div class="dg-ftop">${progressHTML()}${statsHTML()}</div>
    <section class="dg-panel dg-cbox ph-${ph}">${musicBtnHTML()}<span class="k">${head[0]}</span><h2>${head[1]}</h2>${head[2] ? `<p>${head[2]}</p>` : ''}${body}</section>
  </div>`;
}
// ---- v3: Choose a reward (UI-48), behind the ui_v3 flag --------------------------------------------------
// The approved design (design repo UI-48/approved): the progress pill and the loot chips on the dungeon stage, a panel
// with "Room cleared", "Choose a reward" and the offers (a row of 3; a stacked list on compact-port). The same data,
// the same data-choose handler and the same /api/dungeon/choose call as the v2 view (choose(), wireChoose()).
// D-125 (Nathan: "the little explainer of what the reward does"): the line under each reward, from the words the code and the design already have
// (the Shield and Heal lines of EFFECT, the run buff line of the dungeon design, the loot chip tooltip). A reward with no such words shows none (reset).
function offerExplain(o, t) {
  const p = pct(o.amount);
  return ({
    heal: `Heal ${p} of max HP · Once per floor`,
    ward: `Shield ${p} of max HP`,
    buff: `Your attackers deal +${p} for the rest of the run`,
    shards: EXPLAIN_LONGEST,
    reset: 'Resets every cooldown in your squad',   // D-133
  })[o.kind] || t[2] || '';
}
const EXPLAIN_LONGEST = "This floor's loot: lost if the squad falls. The floor guardian banks it.";
const OFFER_ICON = { card: 'layers', ward: 'shield-check', heal: 'heart', revive: 'heart', buff: 'trending-up', reset: 'rotate-ccw', continue: 'arrow-right' };
function progressV3HTML(R) {
  const rooms = dg.data.rooms || [];
  const ic = { fight: I.sword, horde: I.horde, elite: I.fire, miniboss: I.crown, treasure: I.chest, rest: I.heart, choice: I.split, guardian: I.skull, unknown: I.q };
  const dots = rooms.map((rm, i) => {
    const n = i + 1;
    const state = n < R.room ? 'done' : n === R.room ? 'now' : 'next';
    const type = n === R.room && R.state?.room_type ? R.state.room_type : rm.type;
    return `${i ? `<i class="u3-dgc-link${n <= R.room ? ' is-done' : ''}"></i>` : ''}<span class="u3-dgc-dot is-${state} t-${esc(type)}" title="${esc(ROOM[type] || type)}">${state === 'done' ? icon3('check') : ic[type] || I.q}</span>`;
  }).join('');
  const g = rooms[4];
  return `<div class="u3-dgc-prog"><div class="u3-dgc-fl"><span class="u3-label">Floor ${R.floor}</span><b>Room ${R.room} of 5</b></div><div class="u3-dgc-dots">${dots}</div>${g?.name ? `<span class="u3-dgc-guard">Guardian: ${esc(g.name)}</span>` : ''}</div>`;
}
function chipsV3HTML(st) {
  const pend = st.pend || {}, bank = st.bank || {};
  const buff = Math.round(((st.buff || 1) - 1) * 100);
  const loot = (b) => `${fmt3(b.shards)}${(b.cards || []).length ? ` +${b.cards.length}${icon3('layers', 'sm')}` : ''}`;
  return `<div class="u3-dgc-chips"><span class="u3-dgc-chip is-risk" title="This floor's loot: lost if the squad falls. The floor guardian banks it.">${COIN}<b>${loot(pend)}</b><i>at risk</i></span>`
    + `<span class="u3-dgc-chip is-bank" title="Banked loot: safe. Yours when the run ends.">${icon3('lock')}<b>${loot(bank)}</b><i>banked</i></span>`
    + `<span class="u3-dgc-chip" title="The run damage bonus">${icon3('trending-up')}<b>+${buff}%</b><i>damage</i></span></div>`;
}
const ROOM_HEAD_V3 = {
  choose: ['Room cleared', 'Choose a reward', ''],
  rest: ['Rest room', 'Take a breath', 'The squad healed 40%, and each downed card came back with 25% HP.'],
  path: ['A choice', 'Pick a door', ''],
  chest: ['Treasure room', 'You found a chest', 'Tap the chest to open it.'],
};
function chooseV3HTML(R, st) {
  dg.numCls = cls3();
  const offers = st.offers || [];
  const ph = st.phase;
  const head = ROOM_HEAD_V3[ph] || ROOM_HEAD_V3.choose;
  const offer = (o, i) => {
    const t = offerInfo(o);
    const ic = o.kind === 'shards' ? COIN : OFFER_ICON[o.kind] ? icon3(OFFER_ICON[o.kind], '2xl') : t[0];
    const tier = TIER[o.tier];
    return `<button type="button" class="u3-dgc-offer is-t${tier ? o.tier : 0} k-${esc(o.kind)}${o.to ? ` to-${esc(o.to)}` : ''}" data-choose="${i}">${tier ? `<span class="u3-dgc-tier">${tier[0]}</span>` : ''}<span class="u3-dgc-ic">${ic}</span><b>${t[1]}</b><small><span>${esc(offerExplain(o, t))}</span>${ph === 'choose' ? `<span class="u3-dgc-ghost" aria-hidden="true">${esc(EXPLAIN_LONGEST)}</span>` : ''}</small></button>`;
  };
  const body = ph === 'chest' ? chestV3HTML(st) : `<div class="u3-dgc-offers n${offers.length}">${offers.map(offer).join('')}</div>`;
  return `<div class="u3-dgc${ph === 'choose' ? '' : ' u3-dgs'} ph-${esc(ph)}"><div class="u3-dgc-hud">${progressV3HTML(R)}${chipsV3HTML(st)}</div>
    <section class="u3-dgc-panel">${ph === 'choose' ? '' : musicBtnHTML()}<span class="u3-label u3-dgc-k">${head[0]}</span><h2 class="u3-dgc-h">${head[1]}</h2>${head[2] ? `<p class="u3-dgs-line">${head[2]}</p>` : ''}${body}</section>
  </div>`;
}
// ---- v3: the chest (UI-49): the 3D chest, then the loot (Shards, the card face down, Continue) when it is open ----
function chestV3HTML(st) {
  const c = st.chest || {};
  const t = TIER[c.tier] || TIER[1];
  const card = c.card ? dg.data.lootCards?.[c.card] : null;
  return `<div class="u3-dgs-chest" style="--tc:${t[1]}">
    <button type="button" class="u3-dgs-chestbox" aria-label="Open the chest"><span class="u3-dgs-fb"><i></i>${I.chest}</span><canvas class="u3-dgs-cv"></canvas></button>
    <div class="u3-dgs-loot"><span class="u3-dgs-ct">${t[0]} chest</span>
      <span class="u3-dgs-sh">${COIN}<b>+${fmt3(c.shards)}</b><small>Shards</small></span>${card ? `<div class="dg-flips u3-dgs-cf">${flipHTML([card], 'chest')}</div>` : ''}
      ${btn3({ label: 'Continue', variant: 'primary', icon: 'arrow-right', data: { choose: '0' } })}</div>
  </div>`;
}
// ---- v3: Floor cleared (UI-49) ----
function floorDoneV3HTML(R, st) {
  dg.numCls = cls3();
  const fl = st.floor_loot || {}; const bank = st.bank || {};
  const cards = (fl.cards || []).map((id) => dg.data.lootCards?.[id] || { id });
  const capLeft = Math.max(0, (dg.data.cap || 300) - (bank.shards || 0));
  const box = (label, val) => `<div class="u3-dgs-stat"><span class="u3-dgs-sl">${label}</span><b>${val}</b></div>`;
  return `<div class="u3-dgc u3-dgs u3-dgs-fd ph-floor_done"><section class="u3-dgs-fdp">${musicBtnHTML()}
    <div class="u3-dgs-fdh"><span class="u3-label u3-dgs-fdk">${icon3('castle', 'md')}${esc(dg.data.name)} · Floor ${R.floor}</span><h1 class="u3-dgc-h">Floor ${R.floor} cleared!</h1></div>
    <div class="u3-dgs-stats">${box('Loot gained', `${COIN}+${fmt3(fl.shards)}`)}${box('Banked', `${icon3('lock')}${fmt3(bank.shards)}${(bank.cards || []).length ? ` +${(bank.cards || []).length}${icon3('layers')}` : ''}`)}${box('Cap left', fmt3(capLeft))}</div>
    ${cards.length ? `<div class="u3-dgs-lh"><h3>Cards found <small>${cards.length}</small></h3>${btn3({ label: 'Reveal all', variant: 'primary', icon: 'layers' }).replace('class="u3-btn', 'class="u3-dgs-reveal u3-btn')}</div><div class="dg-flips u3-dgs-fl" style="--n:${cards.length}">${flipHTML(cards, 'floor')}</div>` : '<p class="u3-dgs-none">No cards on this floor.</p>'}
    <div class="u3-dgs-btns">${btn3({ label: 'Retreat with the loot', variant: 'danger', icon: 'door-open' }).replace('class="u3-btn', 'class="u3-dgs-leave u3-btn')}${btn3({ label: `Descend to Floor ${R.floor + 1}`, variant: 'primary', icon: 'arrow-right' }).replace('class="u3-btn', 'class="u3-dgs-next u3-btn')}</div>
  </section></div>`;
}
// Measured fit (UI-48): when the drawn layout is too high for the stage (a short phone), the stage gets .is-tight (smaller
// icons and gaps, the tier chip beside the name). It is measured again after the fonts load and after a resize.
let chooseRO = null;
function fitChooseV3(main) {
  chooseRO?.disconnect(); chooseRO = null;
  const box = main.querySelector('.u3-dgc');
  if (!box) return;
  // too high or too wide: the stage itself, or a part that clips its own content (the panel and the offers share the stage height; the guardian text sits in the pill; D-117 gives the stage more height but not more width)
  const dgs = box.classList.contains('u3-dgs');
  const stable = dgs || box.classList.contains('ph-choose');   // the counters never change the size of the panel (a long counter only shrinks the counters)
  const chipsOver = () => [...box.querySelectorAll('.u3-dgc-chips, .u3-dgc-chip')].some((e) => e.scrollWidth > e.clientWidth + 1) || [...box.querySelectorAll('.u3-dgc-hud > *')].some((e) => e.getBoundingClientRect().right > box.getBoundingClientRect().right);
  const parts = box.querySelectorAll(stable ? '.u3-dgc-prog, .u3-dgc-guard, .u3-dgc-panel, .u3-dgc-offers, .u3-dgc-offer, .u3-dgc-tier, .u3-dgc-offer b, .u3-dgc-offer small' : '.u3-dgc-prog, .u3-dgc-chip, .u3-dgc-guard, .u3-dgc-panel, .u3-dgc-offers, .u3-dgc-offer, .u3-dgc-tier, .u3-dgc-offer b, .u3-dgc-offer small');
  const over = () => (stable ? box.scrollHeight > box.clientHeight + 1 : box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1) || [...parts].some((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
  const measure = () => {
    box.classList.toggle('is-fill', cls3() === 'medium' && box.clientHeight > box.clientWidth && !box.classList.contains('u3-dgs'));   // a tall tablet (the stage itself is taller than wide, F-1): the offers stack and fill the stage
    box.classList.remove('is-tight', 'is-tight2', 'is-short', 'is-short2', 'is-roomy', 'is-wide', 'is-wide2');
    // UI-49: a large stage (expanded or medium, never the door choice and never a phone: D-134, the approved frames keep the smaller panel) with a small panel: the panel takes the height of the stage (the doors, the chest and the Continue row grow with it)
    const panel = box.querySelector('.u3-dgc-panel'), hud = box.querySelector('.u3-dgc-hud');
    if (box.classList.contains('u3-dgs') && panel && hud && (cls3() === 'expanded' || cls3() === 'medium') && !box.classList.contains('ph-path') && (box.clientHeight - hud.offsetHeight - panel.offsetHeight) / 2 > 0.2 * box.clientHeight) box.classList.add('is-roomy');
    if (over()) { box.classList.add('is-tight'); if (over()) box.classList.add('is-tight2'); }
    // UI-49: a long counter only makes the counters too WIDE: they shrink and wrap (is-wide, is-wide2) and the panel keeps its size
    if (stable && chipsOver()) { box.classList.add('is-wide'); if (chipsOver()) box.classList.add('is-wide2'); }
    // UI-49: is-short / is-short2 = the stage is still too HIGH (not only too wide): the chest, the loot and the type shrink (a long counter makes it only wide)
    const high = () => box.scrollHeight > box.clientHeight + 1 || (panel && panel.scrollHeight > panel.clientHeight + 1);
    if (box.classList.contains('u3-dgs') && high()) { box.classList.add('is-short'); if (high()) box.classList.add('is-short2'); } };   // is-tight2: still too wide (a narrow stage: the safe-area insets), so the tier chip gets its own row
  measure();
  document.fonts?.ready.then(() => { if (box.isConnected) measure(); });
  if (typeof ResizeObserver === 'function') { chooseRO = new ResizeObserver(() => { if (box.isConnected) measure(); }); chooseRO.observe(box); }
}
// UI-49: the Floor cleared screen is measured too: when the drawn layout is too high (a short phone), the panel gets .is-tight
// (smaller type, gaps and boxes). The face-down cards then take the space that is left (fitFlips).
let floorRO = null;
function fitFloorV3(main) {
  floorRO?.disconnect(); floorRO = null;
  const box = main.querySelector('.u3-dgs-fd');
  if (!box) return;
  const panel = box.querySelector('.u3-dgs-fdp');
  const measure = () => {
    box.classList.toggle('is-fill', cls3() === 'medium' && box.clientHeight > box.clientWidth);   // a tall tablet (measured on the stage itself, F-1): the stacked layout
    box.classList.remove('is-tight', 'is-tight2', 'is-lean');
    // is-lean (a phone, portrait): the cards come out smaller than 1.5 widest grid tiles high, so the two buttons share one row and the gaps shrink; the cards take the room
    const fl = box.querySelector('.u3-dgs-fl');
    if (fl && (cls3() === 'compact-port' || box.classList.contains('is-fill'))) {
      fitFlips(main);
      const tile = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-tile-max')) || 112;
      if ((parseFloat(fl.style.getPropertyValue('--fh')) || 0) < 1.5 * tile) box.classList.add('is-lean');
    }
    const wide = [...box.querySelectorAll('.u3-dgs-stat > b, .u3-btn, .u3-dgs-btns')].some((e) => e.scrollWidth > e.clientWidth + 1);   // UI-50: the row of the leaderboard button and the timer too
    if (wide || panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1) box.classList.add('is-tight');
    fitFlips(main);
    // is-tight2: a card is still narrower than the touch size (a short, narrow stage: the safe-area insets), so the buttons lose their icons and the counters shrink again
    const hit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hit')) || 44;
    if (box.querySelector('.u3-dgs-fl') && [...box.querySelectorAll('.u3-dgs-fl .dg-flip')].some((f) => f.getBoundingClientRect().width < hit)) { box.classList.add('is-tight', 'is-tight2'); fitFlips(main); }
  };
  measure();
  document.fonts?.ready.then(() => { if (box.isConnected) measure(); });
  if (typeof ResizeObserver === 'function') { floorRO = new ResizeObserver(() => { if (box.isConnected) measure(); }); floorRO.observe(box); }
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
        <button class="v2-btn gold dg-cont" data-choose="0">${I.arrow}Continue</button></div>
    </div>`;
}
// Cards face down; a tap flips one (the same as a pack). Used by the chest, the floor screen, the end.
function flipHTML(list, key) {
  return list.map((c, i) => `<button class="dg-flip r-${c.rarity || 'normal'}${upCls(`${key}:${i}`)}"${V3() ? ` aria-label="${esc(`${c.name || 'Card'}, ${RL(c.rarity || 'normal')}`)}"` : ''} data-flip="${key}:${i}" data-id="${c.id}" style="--rc:${RCOL[c.rarity] || '#9AA3B5'}; --d:${i * 90}ms">
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
    // v3 (UI-49): the app caption (name and rarity, 11 px at least) shows when the card is as wide as the widest grid tile; a narrower card shows the real face only (it prints its own name)
    if (V3() && box.closest('.u3-dgs')) box.classList.toggle('is-nocap', Math.floor(Math.min(best, 280)) / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-ratio')) || 1.4) < (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-tile-max')) || 112));
  });
}
window.addEventListener('resize', () => { const m = document.getElementById('main'); if (m?.querySelector('.dg-flips')) fitFlips(m); });
// v3 lobby (UI-46): measure the side column and the tight mode again after a resize (a turn, the keyboard)
let v3rt = null;
window.addEventListener('resize', () => {
  if (V3() && document.querySelector('#main .u3-dgc') && dg.numCls && dg.numCls !== cls3() && ctx().currentView() === 'dungeon') { dg.numCls = cls3(); clearTimeout(v3rt); v3rt = setTimeout(paint, 150); return; }   // UI-49: the number form follows the size class
  if (!V3() || !document.querySelector('#main .u3-dg')) return;
  clearTimeout(v3rt);
  v3rt = setTimeout(() => { if (document.querySelector('#main .u3-dg')) { dg.v3tabs = false; dg.tight = 0; paint(); } }, 150);
});
function wireFlips(main) {
  fitFlips(main);
  const flip = (b) => { if (b.classList.contains('up')) { const id = Number(b.dataset.id); if (id) openInfo(id); return; } b.classList.add('up'); ups.add(upTag(b.dataset.flip)); ctx().sfx?.('flip'); if (main.querySelector('.u3-dgs-chest')) requestAnimationFrame(() => { fitFlips(main); fitChooseV3(main); fitFlips(main); }); };
  main.querySelectorAll('[data-flip]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); flip(b); }));
  main.querySelector('.dg-reveal, .u3-dgs-reveal')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    [...main.querySelectorAll('[data-flip]:not(.up)')].forEach((b, i) => setTimeout(() => flip(b), i * 220));
  });
  if (cardBack == null) getBack().then(() => { if (ctx().currentView() === 'dungeon' && main.querySelector('[data-flip]') && cardBack) main.querySelectorAll('.dg-flip .face.back').forEach((f) => { f.innerHTML = `<img src="${esc(cardBack)}" alt="">`; }); });
}
async function choose(pick) {
  if (dg.busy) return;
  dg.busy = true;
  let r = null;
  try { r = await ctx().apiPost('/api/dungeon/choose', { pick, mode: dg.mode }); } catch (e) { r = e?.body || null; }
  dg.busy = false;
  if (!r?.ok) { toast(r?.message || 'That did not work.'); return; }
  ctx().sfx?.('click');
  if (r.door === 'elite') toast('An ambush!');
  dg.log = []; dg.target = 0;
  await load(); paint();
}
function wireChoose(main) {
  fitChooseV3(main);
  main.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.choose))));
  const box = main.querySelector('.dg-chestbox, .u3-dgs-chestbox');
  const croot = box?.closest('.dg-chest, .u3-dgs-chest');
  // The 3D chest (a real model with its open animation); the drawn chest (v3: the chest icon) stays as the fallback.
  const cv = box?.querySelector('.dg-chest3d, .u3-dgs-cv');
  if (cv) {
    cv.addEventListener('chest-ready', () => box.classList.add('has3d'), { once: true });
    cv.addEventListener('chest-fail', () => box.classList.add('fail'), { once: true });   // v3: only then the chest icon shows (no old chest art flashes before the 3D chest)
    import('./dungeon-chest.js').then(({ mountChest }) => { if (main.contains(cv)) { dg.chest?.dispose(); dg.chest = mountChest(cv, getComputedStyle(croot).getPropertyValue('--tc').trim() || '#9AA3B5'); } }).catch(() => {});
  }
  box?.addEventListener('click', () => {
    if (croot.classList.contains('open')) return;
    dg.chest?.open();
    snd('boss:enrage', 0.25);
    setTimeout(() => { croot.classList.add('open'); fitChooseV3(main); fitFlips(main); ctx().sfx?.('rare'); }, dg.chest ? 650 : 0);
  });
  wireFlips(main);
}

// ---- The floor is done: the loot gained (item 12) ---------------------------------------------------
// The guardian fell: this floor's loot is banked (safe). Descend (the next floor's loot is at risk
// again) or Retreat and keep everything banked. Retreat lives only here.
function floorDoneHTML() {
  const R = run(); const st = R.state;
  if (GA()) {
    const b = dg.data.best;
    return `<div class="dg-over dg-floordone">
    <section class="dg-panel dg-obox dg-fdbox">${musicBtnHTML()}
      <div class="dg-ohead"><div class="dg-fdhead"><span class="k">${I.crown}${esc(dg.data.name)} · Floor ${R.floor}</span><h1>Floor ${R.floor} cleared!</h1></div>
      <div class="dg-depth dg-fdstats"><span>Depth<b>${R.floor}F Room ${R.room}</b></span><span>Week best<b>${b ? `${b.floor}F R${b.room}` : '—'}</b></span><span>Rank<b>#${b?.rank || '—'}</b></span></div></div>
      <div class="dg-lootrow"></div>
      <div class="dg-obtn dg-fdbtn"><button class="v2-btn dg-leave">${I.door}End the run</button><button class="v2-btn gold dg-next" data-choose="0">${I.arrow}Descend to Floor ${R.floor + 1}</button></div>
    </section>
  </div>`;
  }
  if (V3()) return floorDoneV3HTML(R, st);   // UI-49 (the Gauntlet's floor screen above keeps the v2 view)
  const fl = st.floor_loot || {}; const bank = st.bank || {};
  const cards = (fl.cards || []).map((id) => dg.data.lootCards?.[id] || { id });
  const capLeft = Math.max(0, (dg.data.cap || 300) - (bank.shards || 0));
  return `<div class="dg-over dg-floordone">
    <section class="dg-panel dg-obox dg-fdbox">${musicBtnHTML()}
      <div class="dg-ohead"><div class="dg-fdhead"><span class="k">${I.castle}${esc(dg.data.name)} · Floor ${R.floor}</span><h1>Floor ${R.floor} cleared!</h1></div>
      <div class="dg-depth dg-fdstats"><span>Loot gained<b>${COIN}+${fmt(fl.shards)}</b></span><span>Banked<b>${I.lock}${fmt(bank.shards)}${(bank.cards || []).length ? ` +${(bank.cards || []).length}${I.cards}` : ''}</b></span><span>Cap left<b>${fmt(capLeft)}</b></span></div></div>
      <div class="dg-lootrow">${cards.length ? `<div class="dg-lhead"><h3>Cards found <small>${cards.length}</small></h3><button class="v2-btn gold dg-reveal">${I.cards}Reveal all</button></div><div class="dg-flips" style="--n:${cards.length}">${flipHTML(cards, 'floor')}</div>` : '<p class="muted dg-nocards">No cards on this floor.</p>'}</div>
      <div class="dg-obtn dg-fdbtn"><button class="v2-btn dg-leave">${I.door}Retreat with the loot</button><button class="v2-btn gold dg-next" data-choose="0">${I.arrow}Descend to Floor ${R.floor + 1}</button></div>
    </section>
  </div>`;
}
function wireFloorDone(main) {
  fitFloorV3(main);
  main.querySelector('.dg-next, .u3-dgs-next')?.addEventListener('click', () => choose(0));
  main.querySelector('.dg-leave, .u3-dgs-leave')?.addEventListener('click', () => retreat());
  wireFlips(main);
}

// ---- The run is over: the loot screen ----------------------------------------------------------
// One screen, no scroll (Nathan items 25, 26): the result, the totals, and the cards found FACE DOWN;
// tap a card (or Reveal all) to flip it, the same as a pack.
let cardBack = null;
// The cards already turned face up (by run, screen and card): a repaint (a rotation) keeps them up (Nathan, 2026-10-03).
const ups = new Set();
const upTag = (f) => `${run()?.id}|${run()?.status}|${run()?.floor}|${run()?.state?.phase}|${f}`;
const upCls = (f) => (ups.has(upTag(f)) ? ' up' : '');
const getBack = async () => { if (cardBack == null) { try { cardBack = (await (await fetch('/api/config')).json()).backUrl || ''; } catch { cardBack = ''; } } return cardBack; };
function overHTML() {
  const R = run();
  if (GA()) return gaOverHTML(R);
  const t = { cleared: ['Dungeon cleared!'], retreat: ['You retreated'], fell: ['Your squad fell'] }[R.ended_by] || ['Run over'];
  if (V3()) return overV3HTML(R, t);   // UI-50 (the Gauntlet's end above keeps the v2 view)
  const loot = dg.data.loot || [];
  const cards = loot.map((c, i) => `<button class="dg-flip r-${c.rarity || 'normal'}${upCls(String(i))}" data-flip="${i}" style="--rc:${RCOL[c.rarity] || '#9AA3B5'}; --d:${i * 90}ms">
      <span class="face back">${cardBack ? `<img src="${esc(cardBack)}" alt="">` : '<i></i>'}</span>
      <span class="face front">${cardTile({ ...c, cost: null }, { top: '', info: false })}</span></button>`).join('');
  return `<div class="dg-over">
    <section class="dg-panel dg-obox">
      <div class="dg-ohead"><div><span class="k">${I.castle}${esc(dg.data.name)}</span><h1>${t[0]}</h1></div>
        <div class="dg-depth"><span>Depth<b>${R.floor}F Room ${R.room}</b></span><span>Rank today<b>#${R.rank || '—'}</b></span><span>Shards<b>${COIN}<em class="dg-count" data-to="${R.shards}">0</em></b></span><span>Turns<b>${fmt(R.turns)}</b></span></div></div>
      <div class="dg-lootrow">${cards ? `<div class="dg-lhead"><h3>Cards found <small>${loot.length}</small></h3><button class="v2-btn gold dg-reveal">${I.cards}Reveal all</button></div><div class="dg-flips${loot.length > 6 ? ' two' : ''}" style="--n:${loot.length}">${cards}</div>` : '<p class="muted dg-nocards">No cards dropped this run.</p>'}</div>
      <div class="dg-obtn"><button class="v2-btn" data-board>${I.trophy}See the leaderboard</button><small class="dg-note">${I.timer}A new dungeon in <b class="dg-left">${left(dg.data.next_at)}</b></small></div>
    </section>
  </div>`;
}
// ---- v3: the run over (UI-50), behind the ui_v3 flag ----
// The approved design (design repo UI-50/approved): the Floor cleared panel of UI-49 (u3-dgs-fd) with the run totals, the cards found face down,
// "Reveal all", "See the leaderboard" and (phones) the timer of the next dungeon. The same data, handlers and counts as the v2 view (wireOver).
function overV3HTML(R, t) {
  dg.numCls = cls3();
  const loot = dg.data.loot || [];
  const box = (label, val) => `<div class="u3-dgs-stat"><span class="u3-dgs-sl">${label}</span><b>${val}</b></div>`;
  return `<div class="u3-dgc u3-dgs u3-dgs-fd u3-dgs-ov ph-over"><section class="u3-dgs-fdp">
    <div class="u3-dgs-fdh"><span class="u3-label u3-dgs-fdk">${icon3('castle', 'md')}${esc(dg.data.name)}</span><h1 class="u3-dgc-h">${t[0]}</h1></div>
    <div class="u3-dgs-stats">${box('Depth', `${R.floor}F Room ${R.room}`)}${box('Rank today', `#${R.rank || '—'}`)}${box('Shards', `${COIN}<em class="dg-count" data-to="${Number(R.shards) || 0}">0</em>`)}${box('Turns', fmt3(R.turns))}</div>
    ${loot.length ? `<div class="u3-dgs-lh"><h3>Cards found <small>${loot.length}</small></h3>${btn3({ label: 'Reveal all', variant: 'primary', icon: 'layers' }).replace('class="u3-btn', 'class="u3-dgs-reveal u3-btn')}</div><div class="dg-flips u3-dgs-fl" style="--n:${loot.length}">${flipHTML(loot, 'over')}</div>` : '<p class="u3-dgs-none">No cards dropped this run.</p>'}
    <div class="u3-dgs-btns">${btn3({ label: 'See the leaderboard', variant: 'secondary', icon: 'trophy' }).replace('class="u3-btn', 'data-board class="u3-btn')}<span class="u3-dgs-note">${icon3('timer')}A new dungeon in <b class="dg-left">${left(dg.data.next_at)}</b></span></div>
  </section></div>`;
}
function wireOver(main) {
  if (main.querySelector('.u3-dgs-ov')) fitFloorV3(main);
  fitFlips(main);
  main.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard()));
  // The Shards count up.
  const c = main.querySelector('.dg-count');
  if (c) { const to = Number(c.dataset.to) || 0; const t0 = performance.now(); const f = (t) => { const k = Math.min(1, (t - t0) / 1200); c.textContent = V3() ? fmt3(Math.round(to * k * (2 - k))) : fmt(Math.round(to * k * (2 - k))); if (k < 1) requestAnimationFrame(f); else if (V3() && main.querySelector('.u3-dgs-ov')) fitFloorV3(main); }; requestAnimationFrame(f); }
  const flip = (b) => { if (b.classList.contains('up')) { const it = (dg.data.loot || [])[Number(b.dataset.flip)]; if (it) openInfo(Number(it.id)); return; } b.classList.add('up'); ups.add(upTag(b.dataset.flip)); ctx().sfx?.('flip'); if (main.querySelector('.u3-dgs-chest')) requestAnimationFrame(() => { fitFlips(main); fitChooseV3(main); fitFlips(main); }); };
  main.querySelectorAll('[data-flip]').forEach((b) => b.addEventListener('click', () => flip(b)));
  main.querySelector('.dg-reveal, .u3-dgs-reveal')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    [...main.querySelectorAll('[data-flip]:not(.up)')].forEach((b, i) => setTimeout(() => flip(b), i * 220));
  });
  if (cardBack == null) getBack().then(() => { if (ctx().currentView() === 'dungeon' && main.querySelector('.dg-over, .u3-dgs-ov') && cardBack) paint(); });
}

// ---- The Gauntlet: the week's squad (gauntlet.sql) ------------------------------------------------------
// The same squad and the same dungeon for everyone, Sunday to Saturday; one run a day; the best run of the
// week counts; no loot; the weekly prizes (settings.dungeon_prizes.weekly). No picker: the squad is shown.
const SHORT = { normal: 'Normal', illustrated_rare: 'IR', secret_rare: 'SR', full_art: 'Full Art', gold: 'Gold' };
const tagName = (t) => String(t || '').replace(/^(trait|origin):/, '').replace(/\b\w/g, (x) => x.toUpperCase());
function prizeText(p) {
  if (!p) return '';
  const n = (v, one, many) => `${fmt(v)} ${Number(v) === 1 ? one : many}`;
  return [p.shards ? `${fmt(p.shards)} Shards` : '', p.packs ? n(p.packs, 'pack', 'packs') : '', p.cards ? n(p.cards, 'card', 'cards') : ''].filter(Boolean).join(' · ');
}
function gaPrizesHTML(bare) {
  const pz = dg.data.prizes || [];
  const odds = (o) => Object.keys(SHORT).filter((k) => (o || {})[k]).map((k) => `${o[k]}% ${SHORT[k]}`).join(' · ');   // the rarity order
  const rows = pz.slice(0, 3).map((p, i) => `<li><span class="rk">${i + 1}</span><b>${esc(prizeText(p))}</b>${p.cards ? `<em>${esc(odds(p.odds))}</em>` : ''}</li>`).join('')
    + (pz[3] ? `<li><span class="rk sm">4-10</span><b>${esc(prizeText(pz[3]))}</b></li>` : '');
  const inner = `<div class="k-row"><h3>${I.crown}Weekly prizes</h3><small>Paid at the week's end</small></div><ol class="dg-prizes">${rows}</ol>`;
  return bare ? `<div class="dg-top">${inner}</div>` : `<section class="dg-panel dg-top">${inner}</section>`;
}
function gaTopHTML(bare) {
  const d = dg.data;
  const top = d.top || [];
  const rows = top.length ? top.map((t) => `<li><span class="rk">${t.rank}</span><b>${esc(t.username || 'Member')}</b><em>${t.floor}F Room ${t.room}</em></li>`).join('') : '<li class="none">No runs yet this week. Be the first.</li>';
  const inner = `<div class="k-row"><h3>${I.trophy}Top 3 this week</h3><small>${fmt(d.players_week)} player${Number(d.players_week) === 1 ? '' : 's'}</small></div><ol>${rows}</ol>
    <button class="v2-btn dg-seeboard" data-board>See the leaderboard ${I.arrow}</button>`;
  return bare ? `<div class="dg-top">${inner}</div>` : `<section class="dg-panel dg-top">${inner}</section>`;
}
function gaLobbyHTML() {
  const d = dg.data;
  const sq = Array.isArray(d.squad) ? d.squad : [];
  const cost = sq.reduce((t, c) => t + (c.cost || 1), 0);
  const budget = d.budget || 12;
  const theme = d.theme ? tagName(d.theme) : '';
  const segs = []; sq.forEach((c) => { for (let i = 0; i < (c.cost || 1); i++) segs.push(RCOL[c.rarity] || '#9AA3B5'); });
  const bar = `<div class="dg-bar">${Array.from({ length: Math.max(budget, segs.length) }, (_, i) => `<i style="${segs[i] ? `background:${segs[i]}` : ''}"></i>`).join('')}</div>`;
  const pts = `<b class="dg-pts">${cost}<small> / ${budget} pts</small></b>`;
  const slots = `<div class="dg-slots">${sq.map((c) => `<div class="dg-slot">${cardTile(c)}
      <span class="dg-slot-ft"><span class="l">${ATTACKER.has(c.type) ? 'Attacker' : 'Support'}</span></span></div>`).join('')}</div>`;
  const start = `<button class="v2-btn gold dg-start" ${dg.busy ? 'disabled' : ''}>${I.sword}Start run</button>`;
  const wk = new Date(d.week + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase();
  const date = `<span class="dg-date">WEEK OF ${wk}</span>`;
  const timer = `<div class="dg-timer">${I.timer}<span class="l">Week ends in</span><b class="dg-wleft">${leftLong(d.ends_at)}</b></div>`;
  const b = d.best;
  const bestIn = `<div class="k-row"><span class="k">Your best this week</span><span class="dg-pill">1 run today</span></div><h2${b ? '' : ' class="muted"'}>${b ? `${b.floor}F Room ${b.room}` : 'No run yet'}</h2>
      <div class="dg-mini"><span>Rank<b>${b ? `#${b.rank}` : '—'}</b></span><span>Your runs<b>${fmt(b?.runs || 0)}</b></span></div>`;
  const themeIn = `<span class="k">${I.cards}This week's theme</span><h2>${esc(theme || 'Mixed')}</h2>`;
  const seg = (keys) => `<div class="dg-seg">${keys.map(([k, icon, label]) => `<button class="${dg.pane === k ? 'on' : ''}" data-pane="${k}">${icon}${label}</button>`).join('')}</div>`;
  const head = `<header class="dg-head"><img class="dg-thumb" src="/dungeon/room.webp" alt=""><div class="dg-title"><h1>${I.crown}${esc(d.name)} ${date}</h1></div></header>`;

  if (isPort()) {
    if (!['squad', 'prizes', 'top'].includes(dg.pane)) dg.pane = 'squad';
    let body;
    if (dg.pane === 'prizes') body = gaPrizesHTML();
    else if (dg.pane === 'top') body = `<section class="dg-panel dg-best">${bestIn}</section>${gaTopHTML()}`;
    else body = `${head}<section class="dg-panel dg-sq"><div class="k-row"><span class="k">This week's squad</span>${pts}</div>${bar}${slots}</section>
        <div class="dg-gorow">${start}</div><section class="dg-panel dg-rule">${themeIn}</section>`;
    return `<div class="dg-lobby port ga"><div class="dg-prow">${seg([['squad', I.crown, 'Squad'], ['prizes', I.trophy, 'Prizes'], ['top', I.trophy, 'Top 3']])}${timer}</div>${body}</div>`;
  }
  if (document.body.classList.contains('m-land')) {
    if (!['theme', 'best', 'top'].includes(dg.pane)) dg.pane = 'theme';
    const paneIn = dg.pane === 'best' ? bestIn : dg.pane === 'top' ? gaTopHTML(true) : themeIn;
    return `<div class="dg-lobby land ga">
      <aside class="dg-side">
        <section class="dg-panel dg-info">${date}<h1>${I.crown}${esc(d.name)}</h1>${timer}</section>
        <section class="dg-panel dg-pane">${seg([['theme', '', 'Theme'], ['best', '', 'Best'], ['top', '', 'Top 3']])}<div class="dg-pane-in">${paneIn}</div></section>
      </aside>
      <div class="dg-col">
        <section class="dg-panel dg-main"><div class="dg-brow"><span class="k">This week's squad</span>${bar}${pts}</div>
          <div class="dg-squad">${slots}<div class="dg-go">${start}</div></div></section>
        ${gaPrizesHTML()}
      </div></div>`;
  }
  return `<div class="dg-lobby ga">
    <section class="dg-panel dg-main">
      ${head.replace('</header>', `<div class="dg-budget"><span class="k">This week's squad</span>${pts}${bar}</div></header>`)}
      <div class="dg-squad">${slots}<div class="dg-go">${start}</div></div>
      <div class="dg-gbot"><section class="dg-panel dg-rule">${themeIn}</section>${gaPrizesHTML()}</div>
    </section>
    <aside class="dg-side">${timer}<section class="dg-panel dg-best">${bestIn}</section>${gaTopHTML()}</aside>
  </div>`;
}
function wireGaLobby(main) {
  main.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => { dg.pane = b.dataset.pane; paint(); }));
  main.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard()));
  main.querySelector('.dg-start')?.addEventListener('click', async () => {
    if (dg.busy) return;
    dg.busy = true; paint();
    let r = null;
    try { r = await ctx().apiPost('/api/gauntlet/start', {}); } catch (e) { r = e?.body || null; }
    dg.busy = false;
    if (!r?.ok) { toast(r?.message || 'The run did not start.'); paint(); return; }
    ctx().sfx?.('click');
    dg.log = []; dg.target = 0;
    await load(); paint();
  });
}
// The run is over: the depth, the week's rank and best (no loot in the Gauntlet).
function gaOverHTML(R) {
  const t = { cleared: ['Gauntlet cleared!'], retreat: ['Run ended'], fell: ['Your squad fell'] }[R.ended_by] || ['Run over'];
  const b = dg.data.best;
  return `<div class="dg-over">
    <section class="dg-panel dg-obox">
      <div class="dg-ohead"><div><span class="k">${I.crown}${esc(dg.data.name)}</span><h1>${t[0]}</h1></div>
        <div class="dg-depth"><span>Depth<b>${R.floor}F Room ${R.room}</b></span><span>Week best<b>${b ? `${b.floor}F R${b.room}` : '—'}</b></span><span>Rank this week<b>#${b?.rank || '—'}</b></span><span>Turns<b>${fmt(R.turns)}</b></span></div></div>
      <div class="dg-lootrow dg-garow">${gaPrizesHTML(true)}</div>
      <div class="dg-obtn"><button class="v2-btn" data-board>${I.trophy}See the leaderboard</button><small class="dg-note">${I.timer}Your next run in <b class="dg-left">${left(dg.data.next_at)}</b></small></div>
    </section>
  </div>`;
}

// ---- The leaderboard ---------------------------------------------------------------------------
let board = null;
async function openBoard() {
  dg.view = 'board'; board = null; paint();
  try { board = await ctx().api(`${API()}/board`); } catch { board = { board: [] }; }
  if (ctx().currentView() === 'dungeon' && dg.view === 'board') paint();
}
function boardHTML() {
  const me = ctx().user()?.id;
  const rows = board ? (board.board || []).map((b) => `<li class="${String(b.player_id) === String(me) ? 'me' : ''}${b.rank <= 3 ? ` top${b.rank}` : ''}">
      <span class="rk">${b.rank}</span><b>${esc(b.username || 'Member')}</b><em>${b.floor}F Room ${b.room}</em><small>${fmt(b.turns)} turns${GA() ? ` · ${b.runs} run${b.runs === 1 ? '' : 's'}` : ''}${b.status === 'active' ? ' · in the dungeon' : ''}</small></li>`).join('') || `<li class="none">${GA() ? 'No runs yet this week.' : 'No runs yet today.'}</li>` : '<li class="none">Loading…</li>';
  return `<div class="dg-board"><section class="dg-panel">
    <div class="k-row"><button class="v2-btn dg-back">${I.back}Back</button><h2>${I.trophy}${GA() ? 'This week\'s leaderboard' : 'Today\'s leaderboard'}</h2></div>
    <ol class="dg-rows">${rows}</ol></section></div>`;
}
function wireBoard(main) { main.querySelector('.dg-back')?.addEventListener('click', () => { dg.view = 'main'; paint(); }); }
