// The v3 shell (UI-01 top bar and dock, UI-02 sub-tab row, UI-42 Shards and Shop, UI-60 menu grid), only under
// body.ui-v3 (settings.ui_v3). It does NOT replace the shell elements: the v2 code wires them by id at start-up
// (#shopBtn, #bellBtn, #v2Shards, #v2Avatar, #dock .dk, #dockOpen) and keeps repainting some of them (the Shards pill,
// the badges). This module runs after that wiring: it moves the elements into the approved layout, swaps the static
// icons for the one icon set, and adds the Menu (UI-60). The old Dailies, Help, Report and Leaderboard buttons stay
// in the page, hidden: the menu tiles click them, so their windows and badges keep working (D-31).
import { icon } from './icons.js';
import { esc, dot } from './components.js';

const $ = (id) => document.getElementById(id);

// ---- Top bar (UI-01, D-31): logo, then Shards, Shop, bell, Menu, avatar. No packs slot, no sound (D-23..D-26). ----
function buildTopbar() {
  const bar = $('topbar');
  if (!bar || bar.dataset.u3) return;
  bar.dataset.u3 = '1';
  const title = bar.querySelector('.title');
  if (title) {
    title.innerHTML = '<span class="u3-logo" aria-label="Lion Pride TCG" role="img"><span class="u3-logo__emblem"><img src="/logo-lion.svg" alt=""></span>'
      + '<span class="u3-logo__word"><b>LION</b> <b class="u3-gold">PRIDE</b></span><span class="u3-logo__tag">TCG</span></span>';
  }
  // No cut logo (3.3): when the right group leaves the logo too little room (a long Shards number), the "TCG" tag
  // gives way, then the word; the emblem always stays (measured on every size change of the logo box)
  const logo = title?.querySelector('.u3-logo');
  if (logo && window.ResizeObserver) {
    const fitLogo = () => {
      logo.classList.remove('is-no-tag', 'is-no-word');
      if (logo.scrollWidth > logo.clientWidth + 1) logo.classList.add('is-no-tag');
      if (logo.scrollWidth > logo.clientWidth + 1) logo.classList.add('is-no-word');
    };
    new ResizeObserver(() => requestAnimationFrame(fitLogo)).observe(logo);
  }
  const right = bar.querySelector('.topright');
  if (!right) return;
  // the menu button (with the Dot that mirrors the Dailies badge)
  const menu = document.createElement('button');
  menu.id = 'menuBtn'; menu.type = 'button'; menu.className = 'u3-ibtn u3-ibtn--md u3-topbtn';
  menu.setAttribute('aria-label', 'Menu'); menu.setAttribute('aria-haspopup', 'dialog'); menu.setAttribute('aria-expanded', 'false');
  menu.innerHTML = `${icon('menu', { size: 'lg' })}<span class="u3-topbtn__dot">${dot('Something waits')}</span>`;
  // order: Shards, Shop, bell, Menu, avatar
  for (const id of ['v2Shards', 'shopBtn', 'bellBtn']) { const n = $(id); if (n) right.appendChild(n); }
  right.appendChild(menu);
  const av = $('v2Avatar'); if (av) { right.appendChild(av); av.setAttribute('role', 'button'); av.tabIndex = 0; av.setAttribute('aria-label', 'Your profile'); }
  $('bellBtn')?.setAttribute('aria-label', 'Notifications');
  $('shopBtn')?.setAttribute('aria-label', 'Shop');
  for (const id of ['shopBtn', 'bellBtn']) $(id)?.classList.add('u3-topbtn');
  av?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); av.click(); } });
  menu.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
}

// ---- Menu grid (UI-60): Dailies, Leaderboard, FAQ, Feedback, Settings, Events. Panel on wide classes, sheet on phones. ----
// Each tile clicks the hidden v2 button of that window. A tile whose window is off today is not shown.
const TILES = [
  { key: 'dailies', label: 'Dailies', icon: 'calendar-check', target: 'dailyBtn', shown: () => !$('dailyBtn')?.classList.contains('hidden') },
  { key: 'board', label: 'Leaderboard', icon: 'trophy', target: 'boardBtn', shown: () => !$('boardBtn')?.classList.contains('hidden') },
  { key: 'faq', label: 'FAQ', icon: 'circle-help', target: 'helpBtn', shown: () => !$('helpBtn')?.classList.contains('hidden') },
  { key: 'feedback', label: 'Feedback', icon: 'wrench', target: 'reportBtn', shown: () => !$('reportBtn')?.classList.contains('hidden') },
  { key: 'settings', label: 'Settings', icon: 'settings', target: null, shown: () => !!$('bellBtn') },
  // Events: no events content yet (D-51 keeps the Events slide hidden for the same reason). The tile shows when it exists.
  { key: 'events', label: 'Events', icon: 'scroll-text', target: 'eventsBtn', shown: () => !!$('eventsBtn') },
];
let menuOpen = false;
function menuHTML() {
  const tiles = TILES.filter((t) => t.shown()).map((t) => `<button type="button" class="u3-mtile" data-menu="${t.key}">${icon(t.icon, { size: '2xl' })}`
    + `<span class="u3-mtile__name">${esc(t.label)}</span>${t.key === 'dailies' ? `<span class="u3-mtile__dot">${dot('A daily is ready')}</span>` : ''}</button>`).join('');
  return `<div class="u3-menu" id="u3Menu" role="dialog" aria-modal="false" aria-label="Menu"><header class="u3-menu__head"><h2 class="u3-menu__title">Menu</h2>`
    + `<button type="button" class="u3-ibtn u3-ibtn--md u3-ibtn--panel u3-menu__close" aria-label="Close">${icon('x', { size: 'lg' })}</button></header>`
    + `<div class="u3-menu__grid">${tiles}</div></div>`;
}
function closeMenu() {
  menuOpen = false;
  $('u3MenuHost')?.remove();
  $('menuBtn')?.setAttribute('aria-expanded', 'false');
  $('menuBtn')?.classList.remove('is-open');
}
function toggleMenu() {
  if (menuOpen) { closeMenu(); return; }
  menuOpen = true;
  const host = document.createElement('div');
  host.id = 'u3MenuHost'; host.className = 'u3-menuhost';
  host.innerHTML = menuHTML();
  document.body.appendChild(host);
  syncDots();
  $('menuBtn')?.setAttribute('aria-expanded', 'true');
  $('menuBtn')?.classList.add('is-open');
  host.querySelector('.u3-mtile')?.focus();
  host.addEventListener('click', (e) => {
    if (e.target === host || e.target.closest('.u3-menu__close')) { closeMenu(); return; }
    const tile = e.target.closest('[data-menu]');
    if (!tile) return;
    const t = TILES.find((x) => x.key === tile.dataset.menu);
    closeMenu();
    if (t?.key === 'settings') { openSettings(); return; }
    if (t?.target) $(t.target)?.click();
  });
}
// Settings live in the notifications window today (its Settings tab): open it on that tab.
function openSettings() {
  $('bellBtn')?.click();
  // the window fills in after its fetch: wait for its Settings tab (at most 2 s)
  let n = 0;
  const t = setInterval(() => {
    const tab = document.querySelector('#v2Notifs .nt-tabs [data-t="settings"]');
    if (tab || ++n > 20) { clearInterval(t); if (tab && !tab.classList.contains('on')) tab.click(); }
  }, 100);
}
document.addEventListener('keydown', (e) => { if (menuOpen && e.key === 'Escape') { closeMenu(); $('menuBtn')?.focus(); } });
document.addEventListener('click', (e) => { if (menuOpen && !e.target.closest('#u3Menu, #menuBtn')) closeMenu(); });

// The Dot on the Menu button and the Dailies tile mirrors the Dailies badge (red = an action waits, 5.3).
function syncDots() {
  const d = $('dailyBtn');
  const waiting = !!d && !d.classList.contains('hidden') && (d.classList.contains('dl-hot') || !!d.querySelector('.navbadge'));
  $('menuBtn')?.classList.toggle('has-dot', waiting);
  document.querySelector('#u3Menu [data-menu="dailies"]')?.classList.toggle('has-dot', waiting);
}

// ---- Dock (UI-01): Home, Collection, OPEN, Adventure, Community; the one icon set. ----
const DOCK_ICON = { home: 'house', collection: 'layers', battling: 'swords', trading: 'users' };
function buildDock() {
  const dock = $('dock');
  if (!dock || dock.dataset.u3) return;
  dock.dataset.u3 = '1';
  dock.querySelectorAll('.dk[data-view]').forEach((b) => {
    const svg = b.querySelector('svg');
    const ic = DOCK_ICON[b.dataset.view];
    if (svg && ic) svg.outerHTML = icon(ic, { size: 'xl' });
  });
  const open = $('dockOpen');
  const osvg = open?.querySelector('svg');
  if (osvg) osvg.outerHTML = icon('package', { size: 'xl' });
  open?.setAttribute('aria-label', 'Open a pack');
}

// ---- Sub-tab row (UI-02): an icon on every tab (D-47), the approved names (D-62, 10.1), no counts (D-27), the "?"
// at the end of the row on compact-land, medium and expanded (D-63). The tab bars keep their own markup and handlers:
// this only rewrites the inside of each button. ----
const TAB = {
  cards: ['layers', 'Cards'], ach: ['award', 'Achievements'], bosses: ['skull', 'Bosses'],
  trades: ['arrow-left-right', 'Trades'], hall: ['landmark', 'Trade Hall'], effects: ['party-popper', 'Boons'],
  hunt: ['swords', 'Hunt'], dungeon: ['castle', 'Dungeon'], gauntlet: ['crown', 'Gauntlet'],
};
export function decorateTabs(main = $('main')) {
  if (!main || !document.body.classList.contains('ui-v3')) return;
  const host = main.querySelector(':scope > .v2-subtabs');
  if (!host) return;
  host.querySelectorAll('button[data-tab], button[data-adv]').forEach((b) => {
    const key = b.dataset.tab || b.dataset.adv;
    const t = TAB[key];
    if (!t || b.dataset.u3 === key + (b.querySelector('.tab-dot') ? '1' : '0')) return;
    const waits = !!b.querySelector('.tab-dot');
    b.innerHTML = `${icon(t[0])}<span class="u3-tab__label">${esc(t[1])}</span>${waits ? `<span class="u3-tabdot">${dot('Something to claim')}</span>` : ''}`;
    b.setAttribute('aria-label', t[1]);   // the name stays when the label gives way to the icon (D-117)
    b.dataset.u3 = key + (waits ? '1' : '0');
  });
  // the view's "?" (ui-v2-explain.js) moves to the end of the row, except on compact-port (D-63: no room there)
  const q = main.querySelector('.ex-q');
  if (q && document.body.dataset.size !== 'compact-port' && !host.contains(q)) host.appendChild(q);
  fitLowRow(host);
}
// D-117: on a low landscape phone the tabs share the top bar row. When they reach the right group (a phone with side
// insets), the logo emblem gives way (measured, body.u3-low-tight).
export function fitLowRow(host = $('main')?.querySelector(':scope > .v2-subtabs')) {
  const body = document.body;
  body.classList.remove('u3-low-tight');
  if (!host || !('low' in body.dataset)) return;
  const right = $('topbar')?.querySelector('.topright');
  if (right && host.getBoundingClientRect().right > right.getBoundingClientRect().left) body.classList.add('u3-low-tight');
}

/** Start the v3 shell (after the v2 wiring, main.js). */
export function startShell() {
  buildTopbar();
  buildDock();
  const main = $('main');
  if (main) new MutationObserver(() => decorateTabs(main)).observe(main, { childList: true, subtree: true });
  decorateTabs(main);
  addEventListener('resize', () => setTimeout(() => fitLowRow(), 200));   // after the size class (120 ms debounce)
  const d = $('dailyBtn');
  if (d) new MutationObserver(syncDots).observe(d, { attributes: true, childList: true, subtree: true });
  syncDots();
  // 9.3: the last input (pointer or key) on <body>: the shell focus ring shows after a key only (ui3.css)
  const mark = (v) => () => { document.body.dataset.lastInput = v; };
  document.addEventListener('pointerdown', mark('pointer'), true);
  document.addEventListener('keydown', mark('key'), true);
}
