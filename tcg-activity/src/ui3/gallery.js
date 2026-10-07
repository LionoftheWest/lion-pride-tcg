// The UI-00 gallery (public/ui3.html): every v3 component and its states, as on the approved library sheets
// (lion-pride-tcg-design UI-00/approved). A review tool for Nathan, not a game screen. Built by build.mjs.
import * as C from './components.js';
import { icon, ICONS } from './icons.js';
import { watchSizeClass } from './size-class.js';
import { elIcon } from '../element-icons.js';

const spec = (caption, html) => `<figure class="g-spec"><div class="g-spec__body">${html}</div><figcaption class="g-cap">${C.esc(caption)}</figcaption></figure>`;
const frame = (caption, html) => `<figure class="g-spec g-spec--frame"><div class="g-frame">${html}</div><figcaption class="g-cap">${C.esc(caption)}</figcaption></figure>`;
const VARIANTS = ['primary', 'secondary', 'ghost', 'danger', 'boon', 'prank'];
const LABEL = { primary: 'Claim +1', secondary: 'Clear', ghost: 'Edit', danger: 'Remove listing', boon: 'Play on a member', prank: 'Play on a member' };
const ICON = { primary: 'gift', secondary: 'rotate-ccw', ghost: null, danger: 'trash-2', boon: null, prank: null };
const RARITIES = [['normal', 'Normal'], ['illustrated_rare', 'Illustrated Rare'], ['secret_rare', 'Secret Rare'], ['full_art', 'Full Art'], ['gold', 'Gold'], ['event', 'Event'], ['promo', 'Promo']];
const ELEMENTS = ['fire', 'water', 'lightning', 'ice', 'nature', 'earth', 'shadow', 'air', 'arcane', 'psychic', 'toxic', 'metal', 'physical', 'light'];

const SECTIONS = [
  ['Buttons', () => VARIANTS.map((v) => [
    spec(`Button/${v} md 44 · default`, C.button({ label: LABEL[v], variant: v, icon: ICON[v], reward: v === 'primary' ? '+40' : null })),
    spec(`Button/${v} md · disabled`, C.button({ label: LABEL[v], variant: v, disabled: true, reason: 'Needs 100 Shards' })),
    spec(`Button/${v} md · busy`, C.button({ label: LABEL[v], variant: v, busy: true, busyLabel: 'Working…' })),
    spec(`Button/${v} sm 32`, C.button({ label: LABEL[v], variant: v, size: 'sm', icon: ICON[v] })),
  ].join('')).join('')],
  ['Controls', () => [
    spec('IconButton/panel md 40', C.iconButton({ icon: 'star', label: 'Add to wishlist' })),
    spec('IconButton sm 32', C.iconButton({ icon: 'x', label: 'Close', size: 'sm' })),
    spec('IconButton · disabled', C.iconButton({ icon: 'arrow-left-right', label: 'Trade', disabled: true })),
    spec('IconButton · busy', C.iconButton({ icon: 'rotate-ccw', label: 'Refresh', busy: true })),
    spec('Counter · 1 · 99+ · neutral', `${C.counter(1)} ${C.counter(140)} ${C.counter(7, { neutral: true })}`),
    spec('Dot (red: an action waits)', C.dot('An action waits')),
    spec('Chip/filter off · on · busy', `${C.chip({ label: 'Normal', rarity: 'normal' })} ${C.chip({ label: 'Secret Rare', rarity: 'secret_rare', on: true })} ${C.chip({ label: 'Gold', busy: true })}`),
    spec('Chip/status', C.chip({ kind: 'status', label: 'The Hunt · resting' })),
    spec('Chip/rarity (7)', RARITIES.map(([k, l]) => C.chip({ kind: 'rarity', rarity: k, label: l })).join(' ')),
    spec('Chip/effect', ['boon', 'prank', 'shield'].map((e) => C.chip({ kind: 'effect', effect: e, label: e })).join(' ')),
    spec('Chip/element (14)', ELEMENTS.map((e, i) => C.chip({ kind: 'element', element: e, label: e, on: i === 0, elementIcon: e === 'physical' ? icon('hand-fist') : elIcon(e) })).join('')),
    spec('Tabs: sub-tab row (D-37, D-47)', C.subTabs([{ id: 'cards', label: 'Cards', icon: 'layers', active: true }, { id: 'ach', label: 'Achievements', icon: 'award', dot: true }, { id: 'bosses', label: 'Bosses', icon: 'skull' }], { help: 'Help' })),
    spec('Tabs: segmented (level 2)', C.segmented([{ id: 't', label: 'Tracks', active: true }, { id: 'b', label: 'Badges' }, { id: 'ti', label: 'Titles' }, { id: 'f', label: 'Frames' }])),
  ].join('')],
  ['Inputs', () => [
    spec('SearchField · empty', C.searchField({})),
    spec('SearchField · filled', C.searchField({ value: 'pikachu' })),
    spec('SearchField · busy', C.searchField({ value: 'pika', busy: true })),
    spec('Select', C.select({ value: 'None', options: ['None', 'Fire', 'Water'], label: 'Element' })),
    spec('Stepper (shows its limits)', C.stepper({ value: 1, min: 1, max: 10 })),
    spec('Switch on · off · busy', `${C.switchControl({ on: true, label: 'Reduce effects' })} ${C.switchControl({ label: 'Pings' })} ${C.switchControl({ on: true, label: 'Saving', busy: true })}`),
    spec('Textarea', C.textarea({ placeholder: 'What do you think?', label: 'Feedback' })),
    spec('SelectedMark on a card · on a row', `${C.selectedMark({ body: '<div class="g-card">[card]</div>' })} ${C.selectedMark({ row: true, body: '<div class="g-rowitem">[item]</div>' })}`),
    spec('Row · +N more', `${C.row({ main: 'lionofthewest94', sub: 'Collection Power', tail: '2,975' })}${C.listMore(4)}`),
  ].join('')],
  ['Feedback', () => [
    spec('Toast/info', C.toast({ kind: 'info', text: 'New stock in 3h' })),
    spec('Toast/success', C.toast({ kind: 'success', text: 'Title equipped' })),
    spec('Toast/error', C.toast({ kind: 'error', text: 'Could not equip it. Try again.' })),
    spec('Toast/undo', C.toast({ kind: 'undo', text: 'Listing removed', action: 'Undo' })),
    spec('InlineMessage error · success · info', `${C.inlineMessage({ kind: 'error', text: 'Not enough Shards' })}${C.inlineMessage({ kind: 'success', text: 'Saved' })}${C.inlineMessage({ kind: 'info', text: 'Opens at 9 PM' })}`),
    spec('Banner/boon · prank · offline', `${C.banner({ kind: 'boon', text: 'A member played a boon on you' })}${C.banner({ kind: 'prank', text: 'A member played a prank on you' })}${C.banner({ kind: 'offline', text: 'You are offline. Trying again…' })}`),
    spec('StateView/empty', C.stateEmpty({ title: 'No listings yet', line: 'List a card to start.', action: { label: 'List a card' } })),
    spec('StateView/error', C.stateError({ text: 'Could not load the Trade Hall.' })),
    spec('StateView/loading', C.stateLoading({ count: 4 })),
  ].join('')],
  ['Containers', () => [
    spec('Panel (one header, one label)', C.panel({ title: 'Filters', label: 'Rarity', body: C.chip({ label: 'Normal', rarity: 'normal' }) })),
    spec('Tile', C.tile({ body: '<b>The Ranked Nightshade</b><br>6,436 / 30,000 HP' })),
    spec('StatBox', `<div class="g-row">${C.statBox({ value: '9', label: 'Power' })}${C.statBox({ value: '60', label: 'HP' })}${C.statBox({ value: '18%', label: 'Crit' })}</div>`),
    frame('Dialog (confirm): title, one line, Cancel left, action right', C.dialog({ eyebrow: "Today's stock", title: 'Buy Oh Naur?', line: 'Balance after: 598 Shards', primary: { label: 'Buy', reward: '-100' } })),
    frame('Sheet/bottom (compact-port)', C.sheet({ side: 'bottom', title: 'Notifications', body: C.row({ main: 'You earned 1 pack', sub: 'Open' }) })),
    frame('Sheet/side (other classes)', C.sheet({ side: 'side', title: 'Dailies', body: C.row({ main: 'Check in', tail: '+40' }) })),
  ].join('')],
  ['Progress', () => [
    spec('Pager · first page · middle · busy · disabled', `${C.pager({ page: 1, pages: 22 })}${C.pager({ page: 2, pages: 36 })}${C.pager({ busy: true })}${C.pager({ page: 1, pages: 36, disabled: true })}`),
    spec('Progress/linear 4', C.progressLinear({ value: 0.42, label: 'Power' })),
    spec('Progress/segmented 8', C.progressSegmented({ value: 0.21, head: '21% HP', tail: 'closes 1d 3h' })),
    spec('Progress/hp 12', C.progressHp({ value: 0.84, text: '25,210 / 30,000 HP' })),
    spec('Countdown/static', C.countdownStatic({ label: 'Next boss in', value: '4d 1h' })),
    spec('Countdown/live', C.countdownLive({ value: '09:05:20' })),
  ].join('')],
  ['Tokens', () => [
    spec('Achievement tiers (D-74, D-75): Bronze, Silver, Platinum, Diamond, Obsidian — Platinum and Obsidian are proposals',
      `<div class="g-row">${C.TIERS.map((t) => `<span class="g-swatch">${C.tierPip(t)}<span>${t[0].toUpperCase() + t.slice(1)}</span></span>`).join('')}</div>`),
    spec(`Icons: the one set (${Object.keys(ICONS).length}, Lucide, stroke 2)`, `<div class="g-icons">${Object.keys(ICONS).map((n) => `<span class="g-icon" title="${n}">${icon(n, { size: 'xl' })}<span>${n}</span></span>`).join('')}</div>`),
  ].join('')],
];

function render(i) {
  const [name, body] = SECTIONS[i];
  document.getElementById('g-nav').innerHTML = C.segmented(SECTIONS.map(([n], k) => ({ id: String(k), label: n, active: k === i })), { label: 'Sections' });
  document.getElementById('g-main').innerHTML = `<h2 class="g-title">${C.esc(name)}</h2><div class="g-grid">${body()}</div>`;
  document.getElementById('g-pager').innerHTML = C.pager({ page: i + 1, pages: SECTIONS.length });
  history.replaceState(null, '', `#${encodeURIComponent(name.toLowerCase())}`);
}
let cur = Math.max(0, SECTIONS.findIndex(([n]) => `#${n.toLowerCase()}` === decodeURIComponent(location.hash)));
document.addEventListener('click', (e) => {
  const seg = e.target.closest('[data-seg]');
  if (seg && seg.closest('#g-nav')) { cur = Number(seg.dataset.seg); render(cur); return; }
  const pg = e.target.closest('[data-page]');
  if (pg && pg.closest('#g-pager')) { cur = Math.max(0, Math.min(SECTIONS.length - 1, cur + (pg.dataset.page === 'next' ? 1 : -1))); render(cur); }
});
window.addEventListener('hashchange', () => { const k = SECTIONS.findIndex(([n]) => `#${n.toLowerCase()}` === decodeURIComponent(location.hash)); if (k >= 0 && k !== cur) { cur = k; render(cur); } });
watchSizeClass(window, () => render(cur));
document.getElementById('g-size').textContent = document.body.dataset.size;
window.addEventListener('resize', () => { document.getElementById('g-size').textContent = document.body.dataset.size; });
render(cur);
