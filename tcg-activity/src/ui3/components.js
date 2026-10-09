// The UI-00 components (docs/design.md 5.2) as HTML string functions. The styles are public/ui3.css (every value is a
// token). Every interactive component has the 5.1 states: default, hover (pointer only), pressed (scale 0.97),
// focus-visible, disabled with a reason, busy. Every icon-only control has an aria-label (5.3, G-109).
import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attrs = (o = {}) => Object.entries(o).filter(([, v]) => v !== false && v != null)
  .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
const cx = (...c) => c.filter(Boolean).join(' ');
const spinner = (size = 'md') => icon('loader-circle', { size, cls: 'u3-spin' });
// A disabled control states its reason under it (4.9, G-048).
const withReason = (html, disabled, reason) => (disabled && reason ? `<span class="u3-ctl">${html}<span class="u3-reason">${esc(reason)}</span></span>` : html);

/** Shards reward pill inside a button ("+40"). */
export const rewardPill = (text) => `<span class="u3-reward">${icon('hexagon', { size: 'sm', cls: 'u3-coin' })}<span>${esc(text)}</span></span>`;

/** Button: primary, secondary, ghost, danger, boon, prank; md 44 / sm 32 (hit area 44 on touch). */
export function button({ label, variant = 'secondary', size = 'md', icon: ic = null, reward = null, disabled = false, reason = null,
  busy = false, busyLabel = null, type = 'button', data = {} }) {
  const inner = busy ? `${spinner()}<span class="u3-btn__label">${esc(busyLabel || label)}</span>`
    : `${ic ? icon(ic) : ''}<span class="u3-btn__label">${esc(label)}</span>${reward ? rewardPill(reward) : ''}`;
  const html = `<button${attrs({ type, class: cx('u3-btn', `u3-btn--${variant}`, `u3-btn--${size}`), disabled: disabled || busy, 'aria-busy': busy ? 'true' : null,
    ...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v])) })}>${inner}</button>`;
  return withReason(html, disabled, reason);
}

/** IconButton: md 40 / sm 32 (hit area 44 on touch). The label is required (5.3). */
export function iconButton({ icon: ic, label, size = 'md', variant = 'panel', disabled = false, busy = false, reason = null, data = {} }) {
  if (!label) throw new Error('iconButton needs a label (design.md 5.3)');
  const html = `<button${attrs({ type: 'button', class: cx('u3-ibtn', `u3-ibtn--${size}`, `u3-ibtn--${variant}`), 'aria-label': label, disabled: disabled || busy,
    'aria-busy': busy ? 'true' : null, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v])) })}>${busy ? spinner('lg') : icon(ic, { size: 'lg' })}</button>`;
  return withReason(html, disabled, reason);
}

/** Counter (count badge, caps at 99+, G-093) and Dot (one meaning per color; red = an action waits, 5.3). */
export const counter = (n, { neutral = false } = {}) => `<span class="${cx('u3-counter', neutral && 'u3-counter--neutral')}">${n > 99 ? '99+' : Math.max(0, n | 0)}</span>`;
export const dot = (label = null) => `<span class="u3-dot"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}></span>`;

/** Chip: filter (on/off), status, rarity, element, effect; md 28 / sm 22 (hit area 44 on touch). */
export function chip({ label = '', kind = 'filter', on = false, rarity = null, element = null, effect = null, size = 'md', busy = false,
  disabled = false, reason = null, interactive = kind === 'filter' || kind === 'element', elementIcon = null, data = {} }) {
  const tag = interactive ? 'button' : 'span';
  const cls = cx('u3-chip', `u3-chip--${kind}`, `u3-chip--${size}`, on && 'is-on', rarity && `u3-r-${rarity}`, element && `u3-el-${element}`, effect && `u3-fx-${effect}`);
  const mark = kind === 'filter' && rarity ? '<span class="u3-chip__mark" aria-hidden="true"></span>' : '';
  const body = kind === 'element' ? (elementIcon || '') : `${mark}${busy ? spinner('xs') : ''}<span>${esc(label)}</span>`;
  const a = interactive ? { type: 'button', 'aria-pressed': kind === 'filter' || kind === 'element' ? String(!!on) : null, disabled: disabled || busy,
    'aria-label': kind === 'element' ? label : null } : {};
  const html = `<${tag}${attrs({ class: cls, ...a, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v])) })}>${body}</${tag}>`;
  return withReason(html, disabled, reason);
}

/** Level 1: the sub-tab row (always its own row under the top bar, D-37; an icon on every tab, D-47; no counts, D-27). */
export function subTabs(tabs, { slim = false, help = null } = {}) {
  const items = tabs.map((t) => `<button${attrs({ type: 'button', role: 'tab', class: cx('u3-tab', t.active && 'is-active'), 'aria-selected': String(!!t.active), 'data-tab': t.id })}>`
    + `${icon(t.icon)}<span class="u3-tab__label">${esc(t.label)}</span>${t.dot ? dot('New') : ''}</button>`).join('');
  return `<div class="${cx('u3-subtabs', slim && 'u3-subtabs--slim')}"><div class="u3-subtabs__strip" role="tablist">${items}</div>`
    + `${help ? iconButton({ icon: 'info', label: help, size: 'sm', variant: 'plain' }) : ''}</div>`;
}

/** Level 2: the segmented switch. */
export function segmented(items, { label = null } = {}) {
  return `<div class="u3-seg" role="tablist"${label ? ` aria-label="${esc(label)}"` : ''}>${items.map((s) => `<button${attrs({ type: 'button', role: 'tab', class: cx('u3-seg__item', s.active && 'is-active'),
    'aria-selected': String(!!s.active), 'aria-controls': s.controls || null, 'data-seg': s.id })}>${s.icon ? icon(s.icon) : ''}<span>${esc(s.label)}</span></button>`).join('')}</div>`;
}

/** Panel (one header, one section label), Tile, StatBox. */
export const panel = ({ title = null, label = null, body = '', cls = '' }) => `<section class="${cx('u3-panel', cls)}">`
  + `${title || label ? `<header class="u3-panel__head">${title ? `<h3 class="u3-panel__title">${esc(title)}</h3>` : ''}${label ? `<span class="u3-label">${esc(label)}</span>` : ''}</header>` : ''}${body}</section>`;
export const tile = ({ body = '', cls = '' }) => `<div class="${cx('u3-tile', cls)}">${body}</div>`;
export const statBox = ({ value, label }) => `<div class="u3-stat"><span class="u3-stat__value">${esc(value)}</span><span class="u3-stat__label">${esc(label)}</span></div>`;

/** Dialog: a title, one line, Cancel on the left and the primary action on the right (5.3, G-059). */
export function dialog({ id = 'u3-dialog', eyebrow = null, title, line = null, body = '', cancel = 'Cancel', primary = null, closeLabel = 'Close' }) {
  return `<div class="u3-scrim" data-u3-scrim><div class="u3-dialog" role="dialog" aria-modal="true" aria-labelledby="${esc(id)}-t">`
    + `<header class="u3-dialog__head"><div>${eyebrow ? `<span class="u3-label">${esc(eyebrow)}</span>` : ''}<h2 class="u3-dialog__title" id="${esc(id)}-t">${esc(title)}</h2>`
    + `${line ? `<p class="u3-dialog__line">${esc(line)}</p>` : ''}</div>${iconButton({ icon: 'x', label: closeLabel, variant: 'plain' })}</header>`
    + `${body}<footer class="u3-dialog__foot">${cancel ? button({ label: cancel, variant: 'secondary' }) : ''}${primary ? button({ variant: 'primary', ...primary }) : ''}</footer></div></div>`;
}

/** Sheet: bottom (compact-port) or side (compact-land, medium, expanded; 5.2). */
export function sheet({ side = 'bottom', title, body = '', closeLabel = 'Close' }) {
  return `<div class="u3-scrim" data-u3-scrim><aside class="u3-sheet u3-sheet--${side}" role="dialog" aria-modal="true" aria-label="${esc(title)}">`
    + `<header class="u3-sheet__head"><h2 class="u3-sheet__title">${esc(title)}</h2>${iconButton({ icon: 'x', label: closeLabel, variant: 'plain' })}</header>${body}</aside></div>`;
}

const STATE_ICON = { info: 'info', success: 'circle-check', error: 'circle-alert', undo: 'undo-2' };
/** Toast: info, success, error, undo (an action). */
export const toast = ({ kind = 'info', text, action = null }) => `<div class="u3-toast u3-toast--${kind}" role="${kind === 'error' ? 'alert' : 'status'}">`
  + `${icon(STATE_ICON[kind] || 'info')}<span class="u3-toast__text">${esc(text)}</span>${action ? `<button type="button" class="u3-toast__action">${esc(action)}</button>` : ''}</div>`;
/** Inline message: success, error, info, with an icon. */
export const inlineMessage = ({ kind = 'info', text }) => `<p class="u3-msg u3-msg--${kind}"${kind === 'error' ? ' role="alert"' : ''}>${icon(STATE_ICON[kind] || 'info')}<span>${esc(text)}</span></p>`;
/** Banner: boon, prank, offline (top of the content). */
export const banner = ({ kind = 'offline', text }) => `<div class="u3-banner u3-banner--${kind}" role="status">${kind === 'offline' ? icon('triangle-alert') : ''}<span>${esc(text)}</span></div>`;

/** Pager: "1 / N", labelled arrows (44 px on touch, D-53), always centered under its grid (D-36). */
export function pager({ page = 1, pages = 1, busy = false, disabled = false }) {
  const arrow = (dir, ic, lbl, off) => `<button${attrs({ type: 'button', class: 'u3-pager__arrow', 'aria-label': lbl, 'data-page': dir, disabled: disabled || off })}>${icon(ic)}</button>`;
  return `<nav class="${cx('u3-pager', disabled && 'is-disabled')}" aria-label="Pages">${arrow('prev', 'chevron-left', 'Previous page', page <= 1)}`
    + `<span class="u3-pager__label" aria-live="polite">${busy ? spinner() : `${page | 0} / ${pages | 0}`}</span>${arrow('next', 'chevron-right', 'Next page', page >= pages)}</nav>`;
}

const pct = (v) => `${Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)}%`;
/** Progress: linear (4), segmented (8), hp (12). The width is a custom property, not a literal. */
export const progressLinear = ({ value = 0, label = null }) => `<div class="u3-bar u3-bar--sm" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${parseInt(pct(value), 10)}"${label ? ` aria-label="${esc(label)}"` : ''}><span class="u3-bar__fill" style="--u3-v:${pct(value)}"></span></div>`;
export function progressSegmented({ value = 0, segments = 10, head = null, tail = null }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return `<div class="u3-segbar">${head || tail ? `<div class="u3-segbar__head"><span>${esc(head || '')}</span><span>${esc(tail || '')}</span></div>` : ''}`
    + `<div class="u3-segbar__track" role="progressbar" aria-valuemin="0" aria-valuemax="${segments}" aria-valuenow="${lit}">${Array.from({ length: segments }, (_, i) => `<span class="${cx('u3-segbar__seg', i < lit && 'is-lit')}"></span>`).join('')}</div></div>`;
}
export const progressHp = ({ value = 0, text = '' }) => `<div class="u3-hp"><span class="u3-hp__text">${esc(text)}</span><div class="u3-hp__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${parseInt(pct(value), 10)}"><span class="u3-hp__fill" style="--u3-v:${pct(value)}"></span></div></div>`;

/** Countdown: static (two largest units) and live (tabular figures). */
export const countdownStatic = ({ label, value }) => `<span class="u3-cd"><span class="u3-cd__label">${esc(label)}</span><span class="u3-cd__value">${esc(value)}</span></span>`;
export const countdownLive = ({ value }) => `<span class="u3-cdlive">${icon('timer')}<span class="u3-cdlive__value">${esc(value)}</span></span>`;

/** State views: Empty, Error (with a retry), Loading (placeholders). */
export const stateEmpty = ({ title, line = null, action = null }) => `<div class="u3-state u3-state--empty"><p class="u3-state__title">${esc(title)}</p>${line ? `<p class="u3-state__line">${esc(line)}</p>` : ''}${action ? button({ variant: 'secondary', size: 'sm', ...action }) : ''}</div>`;
export const stateError = ({ text, retry = 'Try again' }) => `<div class="u3-state u3-state--error">${inlineMessage({ kind: 'error', text })}${button({ label: retry, variant: 'secondary', size: 'sm', icon: 'rotate-ccw' })}</div>`;
export const stateLoading = ({ count = 6 } = {}) => `<div class="u3-state u3-state--loading" aria-busy="true" aria-label="Loading">${Array.from({ length: count }, () => '<span class="u3-ph"></span>').join('')}</div>`;

/** Search Field: icon, clear button, 16 px text on touch (no zoom). */
export function searchField({ value = '', placeholder = 'Search cards, tags…', busy = false, disabled = false, label = 'Search', clearLabel = 'Clear search' }) {
  return `<div class="${cx('u3-search', disabled && 'is-disabled')}">${icon('search')}<input${attrs({ class: 'u3-search__input', type: 'search', value, placeholder, 'aria-label': label, disabled })}>`
    + `${busy ? spinner() : value ? iconButton({ icon: 'x', label: clearLabel, size: 'sm', variant: 'plain' }) : ''}</div>`;
}
/** Select (native, styled). */
export const select = ({ value = '', options = [], label, disabled = false, busy = false }) => `<span class="${cx('u3-select', disabled && 'is-disabled')}">`
  + `<select${attrs({ class: 'u3-select__input', 'aria-label': label, disabled: disabled || busy })}>${options.map((o) => `<option${attrs({ value: o, selected: o === value })}>${esc(o)}</option>`).join('')}</select>`
  + `${busy ? spinner() : icon('chevron-down')}</span>`;
/** Stepper: shows its limits (5.2). */
export function stepper({ value = 1, min = 1, max = 10, busy = false, disabled = false }) {
  const b = (ic, lbl, off) => `<button${attrs({ type: 'button', class: 'u3-step__btn', 'aria-label': lbl, disabled: disabled || off })}>${icon(ic, { size: 'lg' })}</button>`;
  return `<div class="${cx('u3-step', disabled && 'is-disabled')}"><div class="u3-step__ctl">${b('minus', 'Decrease', value <= min)}<span class="u3-step__value" aria-live="polite">${busy ? spinner() : esc(value)}</span>${b('plus', 'Increase', value >= max)}</div>`
    + `<span class="u3-step__limits">${esc(min)} to ${esc(max)}</span></div>`;
}
/** Switch (a 44 px row). */
export const switchControl = ({ on = false, label, disabled = false, busy = false }) => `<label class="${cx('u3-switch', disabled && 'is-disabled')}">`
  + `<input${attrs({ type: 'checkbox', role: 'switch', class: 'u3-switch__input', checked: on, disabled: disabled || busy })}><span class="u3-switch__track"><span class="u3-switch__knob">${busy ? spinner('xs') : ''}</span></span><span class="u3-switch__label">${esc(label)}</span></label>`;
/** Textarea. */
export const textarea = ({ value = '', placeholder = '', label, disabled = false }) => `<textarea${attrs({ class: 'u3-textarea', placeholder, 'aria-label': label, disabled })}>${esc(value)}</textarea>`;
/** Selected mark: around a card or a row (replaces .sel, .hl-check, .in-spot). */
export const selectedMark = ({ body = '', row = false }) => `<div class="${cx('u3-selmark', row && 'u3-selmark--row')}">${body}<span class="u3-selmark__badge">${icon('check', { size: 'sm' })}</span></div>`;

/** Row (a list row with an optional action), and the "+N more" overflow rule. */
export const row = ({ lead = '', main, sub = null, tail = '' }) => `<div class="u3-row">${lead ? `<span class="u3-row__lead">${lead}</span>` : ''}<span class="u3-row__main"><span class="u3-row__title">${esc(main)}</span>${sub ? `<span class="u3-row__sub">${esc(sub)}</span>` : ''}</span>${tail ? `<span class="u3-row__tail">${tail}</span>` : ''}</div>`;
export const listMore = (n) => `<button type="button" class="u3-more">+${n | 0} more</button>`;

/** Achievement tier pip (D-74, D-75): bronze, silver, platinum, diamond, obsidian. */
export const TIERS = ['bronze', 'silver', 'platinum', 'diamond', 'obsidian'];
export const tierPip = (tier, { reached = true } = {}) => `<span class="${cx('u3-pip', `u3-pip--${tier}`, !reached && 'is-off')}" aria-hidden="true"></span>`;
