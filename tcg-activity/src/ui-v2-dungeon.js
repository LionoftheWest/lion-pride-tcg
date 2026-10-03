// The Dungeon Run (design 30, approved by Nathan 2026-10-03: desktop, portrait and landscape).
// Screens: today's dungeon (the squad picker on the rarity budget), the fight, choose a reward, the
// run over, the leaderboard. The Adventure tabs (Hunt | Dungeon | Arena soon | Expeditions soon).
// Every rule and roll lives in SQL (dungeon.sql on the shared combat core); the data comes from
// src/dungeon-routes.js. The monsters are 3D (src/dungeon-stage.js, loaded on demand), bigger on
// screen (Nathan). The flag: /api/flags -> dungeon (DUNGEON_USERS / FEATURE_DUNGEON).
import { v2ctx, toast } from './ui-v2.js';
import { thumb } from './thumb.js';
import { isPort } from './mobile.js';
import { gateHTML, wireGate } from './ui-v2-gate.js';
import { COIN } from './ui-v2-shop.js';

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
};
const ATTACKER = new Set(['Character', 'Creature']);
const RCOL = { normal: '#9AA3B5', illustrated_rare: '#4DA3FF', secret_rare: '#B07CFF', full_art: '#FF5FA2', gold: '#F4B73C', event: '#3DD68C', promo: '#FF8A3D' };
const EFFECT = {
  empower: (a) => `+${Math.round((a.amount || 0) * 100)}% on the next hit`, shield: (a) => `Shield ${Math.round((a.amount || 0) * 100)}% of max HP`,
  heal: (a) => `Heal ${Math.round((a.amount || 0) * 100)}% of max HP`, weaken: (a) => `Monster deals ${Math.round((a.amount || 0) * 100)}% less`,
  expose: (a) => `Monster takes +${Math.round((a.amount || 0) * 100)}%`, smite: (a) => `${fmt(a.amount)} damage`, stun: () => 'The monster skips a turn',
  cleanse: () => 'Remove the curses',
};
const ACT = { strike: 'Strike', slam: 'Slam', drain: 'Drain', stun: 'Stun', enrage: 'Enrage', curse: 'Curse', regenerate: 'Regenerate', charging: 'Charging', cataclysm: 'Cataclysm', stunned: 'Stunned' };

export const dg = { on: false, data: null, pane: '', sel: [], filter: 'allowed', sort: 'power', page: 0, view: 'main', target: 0, support: null, busy: false, log: [], stage: null, roomKey: '' };
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
  return `<div class="dg-tabs" role="tablist">${t('hunt', I.sword, 'Hunt')}${t('dungeon', I.castle, 'Dungeon')}${t('arena', I.shield, 'Arena', true)}${t('exp', I.compass, 'Expeditions', true)}</div>`;
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
export function advTabs() {
  const main = document.getElementById('main');
  if (!dg.on || !main || main.querySelector(':scope > .dg-tabs')) return;
  main.insertAdjacentHTML('afterbegin', advTabsHTML('hunt'));
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
  dg.per = 0; // measure the card grid again (the size may have changed)
  if (!dg.on) { el('main').innerHTML = '<div class="dg-closed"><b>The Dungeon is closed.</b></div>'; return; }
  if (dg.data && !dg.data.closed) paint(); else el('main').innerHTML = '<div class="loading">Opening the dungeon…</div>';
  await load();
  if (ctx().currentView() !== 'dungeon') return;
  paint();
}
function markDock() {
  document.querySelectorAll('#dock .dk').forEach((b) => b.classList.toggle('active', b.dataset.view === 'battling'));
}
export function disposeDungeon() {
  clearInterval(tick); tick = null;
  dg.stage?.dispose(); dg.stage = null; dg.roomKey = '';
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
  // Keep the 3D canvas across repaints of the same room (no model reload, no flash).
  const keep = fight && dg.stage ? dg.stage.canvas : null;
  if (!fight && dg.stage) { dg.stage.dispose(); dg.stage = null; dg.roomKey = ''; }
  let body;
  if (d.closed) body = `<div class="dg-closed"><b>${esc(d.message)}</b></div>`;
  else if (!d.gate?.ok) body = gateHTML(d.gate || {}, 'the Dungeon');
  else if (dg.view === 'board') body = boardHTML();
  else if (fight) body = fightHTML();
  else if (active()) body = chooseHTML();
  else if (run()) body = overHTML();
  else body = lobbyHTML();
  main.innerHTML = `<div class="v2-dungeon${fight ? ' dg-fighting' : ''}${d.run?.state?.phase ? ` ph-${d.run.state.phase}` : ''}">${fight ? '' : advTabsHTML('dungeon')}${body}</div>`;
  wireAdvTabs(main);
  wireGate(main);
  if (dg.view === 'board') wireBoard(main);
  else if (fight) wireFight(main, keep);
  else if (active()) wireChoose(main);
  else if (run()) wireOver(main);
  else if (!d.closed && d.gate?.ok) wireLobby(main);
  startTick();
}

const cardTile = (c, opts = {}) => {
  const r = c?.rarity || 'normal';
  return `<div class="dg-card r-${r}${opts.cls ? ' ' + opts.cls : ''}"${opts.attr || ''} style="--rc:${RCOL[r] || '#9AA3B5'}">
    ${c?.image_url ? `<img src="${thumb(c.image_url)}" alt="" loading="lazy">` : ''}
    ${opts.top ?? `<span class="dg-pt">${c.cost ?? 1}<small>PT</small></span><span class="dg-pw">${I.bolt}${fmt(c.cp)}</span>`}
    <span class="dg-nm"><b>${esc(c?.name || '?')}</b><small>◆ ${esc(RL(r))}</small></span>
    ${opts.over || ''}
  </div>`;
};

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
  const yours = (head) => `<div class="dg-yours"><div class="dg-yhead">${head}</div><div class="dg-grid">${grid || '<p class="dg-none">No cards here.</p>'}</div></div>`;
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
    const per = isPort() ? cols * 2 : flex ? cols : cols * rows;
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
const roomKey = () => `${run().floor}-${run().room}`;
const foesOf = (st) => (st?.foes || []).map((f) => ({ ...f, boss: st.room_type === 'guardian', elite: st.room_type === 'elite' }));
function progressHTML() {
  const R = run();
  const rooms = dg.data.rooms || [];
  const ic = { fight: I.sword, elite: I.fire, treasure: I.chest, rest: I.heart, guardian: I.skull };
  const dots = rooms.map((rm, i) => {
    const n = i + 1;
    const st = n < R.room ? 'done' : n === R.room ? 'now' : 'next';
    return `${i ? `<i class="dg-link ${n <= R.room ? 'done' : ''}"></i>` : ''}<span class="dg-dot ${st} t-${rm.type}" title="${esc(rm.type)}">${st === 'done' ? I.check : ic[rm.type] || ''}</span>`;
  }).join('');
  const g = rooms[4];
  return `<div class="dg-prog"><div class="dg-fl"><span>Floor ${R.floor}</span><b>Room ${R.room} of 5</b></div><div class="dg-dots">${dots}</div>${g?.name ? `<span class="dg-guard">Guardian: ${esc(g.name)}</span>` : ''}</div>`;
}
function statsHTML() {
  const R = run();
  const buff = Math.round(((R.state?.buff || 1) - 1) * 100);
  return `<div class="dg-stats"><span title="Shards this run">${COIN}<b>+${fmt(R.shards)}</b><i>Shards</i></span><span title="Cards found">${I.cards}<b>${(R.cards || []).length}</b><i>cards found</i></span><span title="The run damage bonus">${I.up}<b>+${buff}%</b><i>damage</i></span></div>`;
}
const isWeak = (c, f) => (f?.weak || []).some((w) => (c.slugs || []).includes(w.value));
const isResist = (c, f) => (f?.resist || []).some((w) => (c.slugs || []).includes(w.value));
function fightHTML() {
  const R = run(); const st = R.state; const M = mine();
  const foes = foesOf(st);
  if (!foes[dg.target] || foes[dg.target].hp <= 0) dg.target = Math.max(0, foes.findIndex((f) => f.hp > 0));
  const tf = foes[dg.target];
  const squad = (R.squad || []).map((id) => ({ ...(M.get(Number(id)) || { id }), s: st.cards?.[String(id)] || {} }));
  const atk = squad.filter((c) => ATTACKER.has(c.type));
  const sup = squad.filter((c) => !ATTACKER.has(c.type));
  const round = st.round || 0;
  const hp = squad.reduce((t, c) => t + (c.s.hp || 0), 0), max = squad.reduce((t, c) => t + (c.s.max || 0), 0);
  const cards = atk.map((c) => {
    const down = c.s.down, stun = (c.s.cd || 0) >= round + 1;
    const pct = Math.max(0, Math.min(100, (c.s.hp / Math.max(1, c.s.max)) * 100));
    const tag = tf ? (isWeak(c, tf) ? '<span class="dg-tag weak">WEAK</span>' : isResist(c, tf) ? '<span class="dg-tag res">RESIST</span>' : '') : '';
    const over = down ? `<span class="dg-state">${I.skull}Down</span>` : stun ? `<span class="dg-state">${I.timer}Stunned</span>` : dg.support ? '' : '<span class="dg-tap">Tap to attack</span>';
    return `<div class="dg-unit${down ? ' down' : ''}${stun ? ' stun' : ''}${dg.support ? ' help' : ''}" data-card="${c.id}">${tag}
      ${cardTile(c, { top: `<span class="dg-pw">${I.bolt}${fmt(c.cp)}</span>${(c.s.buff || 1) > 1 ? '<span class="dg-buff">EMPOWERED</span>' : ''}${(c.s.debuff || 1) < 1 ? '<span class="dg-buff bad">CURSED</span>' : ''}`, over })}
      <span class="dg-hp"><i style="width:${pct}%" class="${pct < 30 ? 'low' : ''}"></i></span><small class="dg-hpn${pct < 30 ? ' low' : ''}">${fmt(c.s.hp)}/${fmt(c.s.max)}${c.s.shield ? ` <em>+${fmt(c.s.shield)}</em>` : ''}</small></div>`;
  }).join('');
  const sups = sup.map((c) => {
    const ready = round >= (c.s.cd || 0) && !c.s.down;
    const a = c.ability || {};
    const desc = (EFFECT[a.effect] || (() => a.effect || ''))(a);
    return `<button class="dg-sup${ready ? '' : ' wait'}${dg.support === Number(c.id) ? ' on' : ''}" data-sup="${c.id}" ${ready ? '' : 'disabled'}>
      ${c.image_url ? `<img src="${thumb(c.image_url)}" alt="">` : '<span></span>'}
      <span class="t"><b>${esc(c.name)}</b><small>${esc(desc)}</small></span>
      <em>${c.s.down ? 'Down' : ready ? `${I.check}Ready` : `${I.timer}In ${c.s.cd - round} round${c.s.cd - round === 1 ? '' : 's'}`}</em></button>`;
  }).join('') || '<p class="dg-none">No support cards in this squad.</p>';
  const log = dg.log.slice(-6).reverse().map((l) => `<li class="${l.kind}"><b>${esc(l.who)}</b><span>→ ${esc(l.to)}</span><em>${l.txt}</em></li>`).join('') || '<li class="none">The fight starts. Tap a card.</li>';
  const hint = dg.support ? 'Tap a card in your squad to help it' : foes.filter((f) => f.hp > 0).length > 1 ? 'Tap a monster to target it · tap a card to attack' : 'Tap a card to attack';
  return `<div class="dg-fight">
    <div class="dg-ftop">${progressHTML()}${statsHTML()}<button class="v2-btn dg-retreat">${I.door}Retreat</button></div>
    <div class="dg-turn"><b>Your turn</b><span>Round ${round + 1}</span></div>
    <div class="dg-arena">
      <canvas class="dg-canvas"></canvas>
      <div class="dg-plates">${foes.map((f, i) => `<div class="dg-plate${i === dg.target ? ' on' : ''}${f.hp <= 0 ? ' dead' : ''}${f.boss ? ' boss' : ''}" data-foe="${i}">
        <span class="n"><b>${esc(f.name)}</b><small>LV ${f.level}</small><em>${fmt(Math.max(0, f.hp))} / ${fmt(f.max)}</em></span>
        <span class="bar"><i style="width:${Math.max(0, (f.hp / f.max) * 100)}%"></i></span>
        ${(f.passives || []).length ? `<span class="ps">${f.passives.map((p) => `<i>${esc(p)}</i>`).join('')}</span>` : ''}</div>`).join('')}</div>
      <div class="dg-pops"></div>
    </div>
    <div class="dg-hint">${I.hand}${hint}${dg.support ? '<button class="dg-cancel">Cancel</button>' : ''}</div>
    <div class="dg-units">${cards}</div>
    <aside class="dg-right"><section class="dg-panel dg-shp"><span class="k">Squad HP</span><b>${fmt(hp)}<small> / ${fmt(max)}</small></b><span class="dg-hp big"><i style="width:${(hp / Math.max(1, max)) * 100}%"></i></span></section>
      <section class="dg-panel dg-sups"><span class="k">Support</span>${sups}</section></aside>
    <aside class="dg-left-col"><span class="k">Room log</span><ol class="dg-log">${log}</ol></aside>
  </div>`;
}
function placePlates(main) {
  if (!dg.stage) return;
  const L = dg.stage.labels();
  main.querySelectorAll('.dg-plate').forEach((p) => {
    const l = L[Number(p.dataset.foe)];
    if (!l) return;
    p.style.left = `${l.x}px`; p.style.top = `${l.y}px`; const phone = document.body.classList.contains('m-port') || document.body.classList.contains('m-land');
    p.style.width = `${Math.min(260, Math.max(phone ? 70 : 140, l.w * (phone ? 0.96 : 0.92)))}px`;
  });
}
function pop(main, x, y, txt, cls = '') {
  const box = main.querySelector('.dg-pops');
  if (!box) return;
  const n = document.createElement('span');
  n.className = `dg-pop ${cls}`; n.innerHTML = txt; n.style.left = `${x}px`; n.style.top = `${y}px`;
  box.appendChild(n); setTimeout(() => n.remove(), 1500);
}
function popCard(main, id, txt, cls = '') {
  const u = main.querySelector(`.dg-unit[data-card="${id}"]`);
  if (!u) return;
  const n = document.createElement('span');
  n.className = `dg-pop on-card ${cls}`; n.innerHTML = txt;
  u.appendChild(n); setTimeout(() => n.remove(), 1500);
}
async function wireFight(main, keep) {
  const R = run();
  const arena = main.querySelector('.dg-arena');
  const old = main.querySelector('.dg-canvas');
  if (keep && dg.roomKey === roomKey()) { old.replaceWith(keep); }
  else {
    dg.stage?.dispose(); dg.stage = null;
    const canvas = old;
    try {
      const { mountStage } = await import('./dungeon-stage.js');
      if (!main.contains(canvas)) return;
      dg.stage = mountStage(canvas, { onPick: (i) => { dg.target = i; paint(); }, onLayout: () => placePlates(main) });
      dg.stage.canvas = canvas;
      dg.roomKey = roomKey();
      await dg.stage.setFoes(foesOf(R.state));
    } catch (e) { console.warn('dungeon stage', e); }
  }
  requestAnimationFrame(() => placePlates(main));
  setTimeout(() => placePlates(main), 300);
  main.querySelectorAll('[data-foe]').forEach((p) => p.addEventListener('click', () => { if (Number(p.dataset.foe) !== dg.target) { dg.target = Number(p.dataset.foe); paint(); } }));
  main.querySelector('.dg-cancel')?.addEventListener('click', () => { dg.support = null; paint(); });
  main.querySelector('.dg-retreat')?.addEventListener('click', () => retreat());
  main.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.sup);
    const c = mine().get(id);
    const tgt = c?.ability?.target || 'boss';
    if (tgt === 'ally' || tgt === 'self') { dg.support = dg.support === id ? null : id; paint(); return; }
    act('support', { cardId: id, targetFoe: dg.target });
  }));
  main.querySelectorAll('.dg-unit').forEach((u) => u.addEventListener('click', () => {
    const id = Number(u.dataset.card);
    if (dg.support) { const s = dg.support; dg.support = null; act('support', { cardId: s, targetCard: id }); return; }
    if (u.classList.contains('down')) { toast('That card is down.'); return; }
    act('attack', { cardId: id, target: dg.target });
  }));
  void arena;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function act(kind, body) {
  if (dg.busy) return;
  dg.busy = true;
  const main = document.getElementById('main');
  main.querySelector('.dg-fight')?.classList.add('busy');
  let r = null;
  try { r = await ctx().apiPost(`/api/dungeon/${kind}`, body); } catch (e) { r = e?.body || null; }
  if (!r?.ok) { dg.busy = false; main.querySelector('.dg-fight')?.classList.remove('busy'); toast(r?.message || 'That did not work.'); return; }
  const M = mine();
  const foes = foesOf(run().state);
  const L = dg.stage?.labels() || [];
  const nm = (id) => M.get(Number(id))?.name || 'Card';
  if (kind === 'attack') {
    const t = r.target ?? body.target;
    const f = foes[t];
    const l = L[t];
    ctx().sfx?.(r.damage > 0 ? 'hit' : 'click');
    dg.stage?.play(t, r.kill ? 'death' : 'hit');
    if (l) pop(main, l.x, l.y + 70, r.damage > 0 ? `-${fmt(r.damage)}${r.crit ? '<small>CRITICAL</small>' : r.double ? '<small>DOUBLE</small>' : r.bonus ? '<small>WEAK</small>' : r.resisted ? '<small>RESIST</small>' : ''}` : 'MISS', r.crit ? 'crit' : r.damage > 0 ? '' : 'miss');
    dg.log.push({ kind: 'me', who: nm(body.cardId), to: f?.name || 'Monster', txt: r.damage > 0 ? `-${fmt(r.damage)}${r.crit ? ' <i>CRIT</i>' : ''}` : 'miss' });
    if (r.heal) popCard(main, body.cardId, `+${fmt(r.heal)}`, 'heal');
    if (r.kill) dg.log.push({ kind: 'kill', who: f?.name || 'Monster', to: 'defeated', txt: `${COIN}+${fmt(r.loot?.shards)}` });
    // The monsters' turn: each one acts in order (the surprise).
    for (const e of r.enemy || []) {
      await sleep(520);
      const ef = foes[e.foe];
      if (e.action !== 'stunned' && e.action !== 'charging') dg.stage?.play(e.foe, 'attack');
      await sleep(260);
      if (e.dmg > 0) popCard(main, e.card, `-${fmt(e.dmg)}`, 'hurt');
      for (const a of e.area || []) if (a.dmg > 0) popCard(main, a.card, `-${fmt(a.dmg)}`, 'hurt');
      if (e.heal > 0 && L[e.foe]) pop(main, L[e.foe].x, L[e.foe].y + 70, `+${fmt(e.heal)}`, 'heal');
      if (L[e.foe] && !e.dmg) pop(main, L[e.foe].x, L[e.foe].y + 40, esc(ACT[e.action] || e.action), 'act');
      dg.log.push({ kind: 'foe', who: ef?.name || 'Monster', to: e.dmg ? nm(e.card) : (ACT[e.action] || e.action), txt: e.dmg ? `-${fmt(e.dmg)}` : '' });
    }
    if (r.burned > 0) popCard(main, body.cardId, `-${fmt(r.burned)} burn`, 'hurt');
    await sleep(r.kill ? 900 : 450);
  } else {
    ctx().sfx?.('click');
    const tx = body.targetCard ? nm(body.targetCard) : foes[body.targetFoe]?.name || 'Monster';
    dg.log.push({ kind: 'sup', who: nm(body.cardId), to: tx, txt: esc(r.effect || '') });
    if (body.targetCard) popCard(main, body.targetCard, esc((r.effect || '').toUpperCase()), 'heal');
    else if (L[body.targetFoe]) pop(main, L[body.targetFoe].x, L[body.targetFoe].y + 70, esc((r.effect || '').toUpperCase()), 'act');
    if (r.kill) dg.stage?.play(body.targetFoe, 'death');
    await sleep(r.kill ? 900 : 350);
  }
  if (r.loot?.card) toast('A card dropped! It is in your collection.');
  await load();
  dg.busy = false;
  if (ctx().currentView() === 'dungeon') paint();
}
async function retreat() {
  if (!confirm('Retreat now? The run ends here. You keep your depth and all the loot.')) return;
  let r = null;
  try { r = await ctx().apiPost('/api/dungeon/retreat', {}); } catch (e) { r = e?.body || null; }
  if (!r?.ok) { toast(r?.message || 'That did not work.'); return; }
  await load(); paint();
}

// ---- Choose a reward / rest --------------------------------------------------------------------
function chooseHTML() {
  const R = run(); const st = R.state;
  const rest = st.phase === 'rest';
  const treasure = st.room_type === 'treasure';
  const offer = (o, i) => {
    const t = {
      heal: [I.heart, 'Heal', `Heal the squad ${Math.round((o.amount || 0) * 100)}% of max HP`],
      buff: [I.up, 'Power up', `+${Math.round((o.amount || 0) * 100)}% damage for the rest of the run`],
      shards: [COIN, `${fmt(o.amount)} Shards`, 'Shards for the Shop, yours now'],
      card: [I.cards, 'A card', 'A random card for your collection (better on deeper floors)'],
      continue: [I.arrow, 'Continue', 'Rested: the squad healed and the downed cards are back'],
    }[o.kind] || [I.check, o.kind, ''];
    return `<button class="dg-offer k-${o.kind}" data-choose="${i}"><span class="ic">${t[0]}</span><b>${t[1]}</b><small>${t[2]}</small></button>`;
  };
  return `<div class="dg-choose">
    <div class="dg-ftop">${progressHTML()}${statsHTML()}<button class="v2-btn dg-retreat">${I.door}Retreat</button></div>
    <section class="dg-panel dg-cbox"><span class="k">${rest ? 'Rest room' : treasure ? 'Treasure room' : 'Room cleared'}</span>
      <h2>${rest ? 'Take a breath' : treasure ? 'You found a chest' : 'Choose a reward'}</h2>
      <p>${rest ? 'The squad healed 40%, and each downed card came back with 25% HP.' : 'Pick one. The next room opens after you choose.'}</p>
      <div class="dg-offers">${(st.offers || []).map(offer).join('')}</div></section>
  </div>`;
}
function wireChoose(main) {
  main.querySelector('.dg-retreat')?.addEventListener('click', () => retreat());
  main.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', async () => {
    if (dg.busy) return;
    dg.busy = true;
    let r = null;
    try { r = await ctx().apiPost('/api/dungeon/choose', { pick: Number(b.dataset.choose) }); } catch (e) { r = e?.body || null; }
    dg.busy = false;
    if (!r?.ok) { toast(r?.message || 'That did not work.'); return; }
    ctx().sfx?.('click');
    if (r.card) toast('A card dropped! It is in your collection.');
    dg.log = []; dg.target = 0;
    await load(); paint();
  }));
}

// ---- The run is over ---------------------------------------------------------------------------
function overHTML() {
  const R = run();
  const t = { cleared: ['Dungeon cleared!', 'You beat every floor of today\'s dungeon.'], retreat: ['You retreated', 'A safe exit. You keep your depth and all the loot.'], fell: ['Your squad fell', 'The run ends here. You keep your depth and all the loot.'] }[R.ended_by] || ['Run over', ''];
  const loot = (dg.data.loot || []).map((c) => cardTile({ ...c, cost: null }, { top: '' })).join('');
  return `<div class="dg-over">
    <section class="dg-panel dg-obox"><span class="k">${I.castle}${esc(dg.data.name)}</span><h1>${t[0]}</h1><p>${t[1]}</p>
      <div class="dg-depth"><span>Depth<b>${R.floor}F Room ${R.room}</b></span><span>Rank today<b>#${R.rank || '—'}</b></span><span>Shards<b>${COIN}${fmt(R.shards)}</b></span><span>Turns<b>${fmt(R.turns)}</b></span></div>
      ${loot ? `<h3>Cards found</h3><div class="dg-loot">${loot}</div>` : '<p class="muted">No cards dropped this run.</p>'}
      <div class="dg-obtn"><button class="v2-btn gold" data-board>${I.trophy}See the leaderboard</button></div>
      <small class="dg-note">${I.timer}A new dungeon in <b class="dg-left">${left(dg.data.next_at)}</b></small></section>
    <aside class="dg-side">${topHTML()}</aside>
  </div>`;
}
function wireOver(main) { main.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => openBoard())); }

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
