// UI-61 the Settings window (lion-pride-tcg-design UI-61/approved, review-1; FEEDBACK D-80 item 27: the section label
// "Effects"). Only under body.ui-v3 (settings.ui_v3): the Menu tile "Settings" (UI-60, shell.js) opens it.
// - Effects: "Reduce effects" (D-11, design.md 9.5). Stored on this device. With no choice stored, it follows the device
//   setting "reduced motion". While on, a screen prank (googly eyes, upside down, fog, rubber chicken) shows as the
//   banner only (effects-ui.js asks reduceEffects()). It acts only under the v3 flag.
// - Discord pings and Discord posts: the same prefs as the bell's Settings tab (GET/POST /api/notify-prefs, the bot
//   reads players.notify_prefs). "Pings on" off greys the 4 kinds. A refused save puts the switch back and shows the
//   inline error under its row (7.3, 10.6).
// - A bottom sheet on the dock edge on compact-port, 2 columns in the safe frame on compact-land, a panel under the
//   top bar on medium and expanded (ui3.css "Settings window").
import { esc, iconButton, inlineMessage } from './components.js';

const REDUCE_KEY = 'lp.reduceEffects';
const PINGS = [['plays', 'Card plays on me'], ['trades', 'Trades & gifts'], ['raid', 'Hunt'], ['packs', 'Pack reminders']];
export const SAVE_ERROR = 'Something went wrong. Try again.';

/** Reduce effects (D-11): the stored choice, else the device's reduced-motion setting. Off without the v3 flag. */
export function reduceEffects({ store = globalThis.localStorage, media = globalThis.matchMedia, v3 = isV3() } = {}) {
  if (!v3) return false;
  let saved = null;
  try { saved = store?.getItem(REDUCE_KEY); } catch { saved = null; }
  if (saved === '1') return true;
  if (saved === '0') return false;
  try { return !!media?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
}
export function setReduceEffects(on, store = globalThis.localStorage) {
  try { store?.setItem(REDUCE_KEY, on ? '1' : '0'); } catch { /* private mode: the choice lasts this session */ }
}
const isV3 = () => typeof document !== 'undefined' && document.body?.classList.contains('ui-v3');

// A setting row: the row text is the visible label of the library Switch (9.3); the whole row is the hit area.
function row(key, label, on, { disabled = false, error = null } = {}) {
  return `<label class="u3-st-row${disabled ? ' is-disabled' : ''}" data-row="${esc(key)}"><span class="u3-st-row__name">${esc(label)}</span>`
    + `<span class="u3-switch"><input type="checkbox" role="switch" class="u3-switch__input" data-k="${esc(key)}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}>`
    + `<span class="u3-switch__track"><span class="u3-switch__knob"></span></span></span></label>`
    + `${error ? inlineMessage({ kind: 'error', text: error }) : ''}`;
}

/** The window's inside. prefs = /api/notify-prefs prefs (null while loading); errorKey = the row of a refused save. */
export function settingsHTML({ prefs, reduce, errorKey = null }) {
  const head = `<header class="u3-st__head"><h2 class="u3-st__title" id="u3StTitle">Settings</h2>${iconButton({ icon: 'x', label: 'Close', data: { 'st-close': '1' } })}</header>`;
  const effects = `<section class="u3-st__sec u3-st__sec--fx" aria-labelledby="u3StFx"><h3 class="u3-label u3-st__label" id="u3StFx">Effects</h3>${row('reduce', 'Reduce effects', reduce)}</section>`;
  if (!prefs) return `${head}${effects}<div class="u3-st__loading" aria-busy="true" aria-label="Loading"></div>`;
  const all = prefs.all !== false;
  const err = (k) => (errorKey === k ? SAVE_ERROR : null);
  const pings = `<section class="u3-st__sec u3-st__sec--pings" aria-labelledby="u3StPings"><h3 class="u3-label u3-st__label" id="u3StPings">Discord pings</h3>`
    + `${row('all', 'Pings on', all, { error: err('all') })}${PINGS.map(([k, l]) => row(k, l, all && prefs[k] !== false, { disabled: !all, error: err(k) })).join('')}</section>`;
  const posts = `<section class="u3-st__sec u3-st__sec--posts" aria-labelledby="u3StPosts"><h3 class="u3-label u3-st__label" id="u3StPosts">Discord posts</h3>`
    + `${row('playing', 'Show when I play', prefs.playing !== false, { error: err('playing') })}</section>`;
  return `${head}<div class="u3-st__grid">${effects}${pings}${posts}</div>`;
}

// ---- The window ----
let deps = null;          // { api, apiPost }
let prefs = null;
let errorKey = null;
let touched = false;   // a switch changed since the window opened
const $ = (id) => document.getElementById(id);

// The prefs load at start (flag on), so the window opens with its rows; each open reads them again.
const loadPrefs = () => deps.api('/api/notify-prefs').then((r) => { prefs = r?.prefs || {}; return prefs; });
export function initSettingsWindow(d) { deps = d; loadPrefs().catch(() => {}); }
export const isOpen = () => !!$('u3Settings') && !$('u3Settings').classList.contains('hidden');

function paint() {
  const box = $('u3Settings');
  if (!box) return;
  box.innerHTML = settingsHTML({ prefs, reduce: reduceEffects(), errorKey });
  // compact-land: Effects and Discord posts in the right column (the area is wider than tall, 3.4): one markup, CSS places it
  box.classList.remove('is-tight');
  if (box.scrollHeight > box.clientHeight + 1) box.classList.add('is-tight');
}

export async function openSettingsWindow() {
  if (!deps) return;
  let box = $('u3Settings');
  if (!box) {
    document.body.insertAdjacentHTML('beforeend', '<div id="u3Settings" class="u3-st hidden" role="dialog" aria-modal="false" aria-labelledby="u3StTitle"></div>');
    box = $('u3Settings');
    box.addEventListener('click', (e) => { if (e.target.closest('[data-st-close]')) closeSettingsWindow(); });
    box.addEventListener('change', onChange);
  }
  if (isOpen()) { closeSettingsWindow(); return; }
  errorKey = null;
  box.classList.remove('hidden');
  $('menuBtn')?.classList.add('is-open');
  document.addEventListener('keydown', onKey);
  addEventListener('resize', paint);
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
  paint();
  box.querySelector('[data-st-close]')?.focus();
  touched = false;
  const old = JSON.stringify(prefs);
  let fresh = null;
  try { fresh = (await deps.api('/api/notify-prefs'))?.prefs || {}; } catch { fresh = null; }
  if (!touched) prefs = fresh || prefs || {};   // a switch changed meanwhile: keep the member's newer choice
  if (isOpen() && JSON.stringify(prefs) !== old) { const f = document.activeElement; paint(); if (f?.dataset?.stClose) box.querySelector('[data-st-close]')?.focus(); }
}

export function closeSettingsWindow() {
  const box = $('u3Settings');
  if (!box || box.classList.contains('hidden')) return;
  box.classList.add('hidden');
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', outside, { capture: true });
  removeEventListener('resize', paint);
  const menu = $('menuBtn');
  menu?.classList.remove('is-open');
  if (box.contains(document.activeElement) || document.activeElement === document.body) menu?.focus();   // 6.2: back to the opener
}
function outside(e) { const box = $('u3Settings'); if (box && !box.contains(e.target) && !e.target.closest('#u3MenuHost')) closeSettingsWindow(); }
function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeSettingsWindow(); } }

async function onChange(e) {
  const k = e.target?.dataset?.k;
  if (!k) return;
  if (k === 'reduce') { setReduceEffects(e.target.checked); errorKey = null; paint(); document.dispatchEvent(new CustomEvent('lp:reduce-effects')); focusRow(k); return; }
  touched = true;
  const before = { ...prefs };
  prefs = { ...prefs, [k]: e.target.checked };
  errorKey = null;
  paint(); focusRow(k);
  let r = null;
  try { r = await deps.apiPost('/api/notify-prefs', { prefs }); } catch { r = null; }
  if (!r?.ok) { prefs = before; errorKey = k; paint(); focusRow(k); }   // the switch goes back, the error under its row
}
function focusRow(k) { $('u3Settings')?.querySelector(`[data-k="${k}"]`)?.focus(); }
