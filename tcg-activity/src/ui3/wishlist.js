// UI-16 the Wishlist window and the wish picker, v3 (lion-pride-tcg-design UI-16/approved, review-1 + review-2;
// FEEDBACK D-66). Only under body.ui-v3 (settings.ui_v3): the Profile's Edit button (ui-v2.js paintWish) opens this
// window in place of the v2 in-place editor. With the flag off nothing here runs.
// - The window (E1): a bottom sheet on the dock edge on compact-port, a side sheet on compact-land, a dialog on medium
//   and expanded. Each row: the slot number, the card, the top-want star (only for a card) and the pencil (E3-E6).
// - The wish picker is the one Card picker (UI-64, D-42) in pick-one mode: "Wish Slot N", the Collection filters
//   (D-66 item 3), Clear and Confirm (Clear only in the picker, D-66 item 2).
// - Every rule is on the server (/api/wishlist: set_wishlist, set_wish_top, the top want of hall_top_want.sql). This
//   module keeps no copy of a rule: a refused save shows the standard error (D-66 item 5, 10.6).
import { esc, iconButton, inlineMessage } from './components.js';
import { icon } from './icons.js';
import { thumb } from '../thumb.js';
import { openCardPicker } from './card-picker.js';

export const SAVE_ERROR = 'Something went wrong. Try again.';

/** The window form of a size class (E1). */
export const formOf = (size) => (size === 'compact-port' ? 'sheet' : size === 'compact-land' ? 'side' : 'dialog');

function rowHTML(x, rarityLabel) {
  const c = x.card;
  const pencil = iconButton({ icon: 'pencil', label: `Pick a card for slot ${x.slot}`, data: { wlset: x.slot } });
  if (!c) {
    return `<li class="u3-wl-row is-empty"><span class="u3-wl-row__n">${x.slot}</span><span class="u3-wl-row__card">${icon('plus')}</span>`
      + `<span class="u3-wl-row__main"><b class="u3-wl-row__name">Empty</b></span><span class="u3-wl-row__acts">${pencil}</span></li>`;
  }
  const star = iconButton({ icon: 'star', label: `Top want: ${c.name}`, data: { wltop: x.slot } }).replace('<button', `<button aria-pressed="${x.top ? 'true' : 'false'}"`);
  return `<li class="u3-wl-row u3-r-${esc(c.rarity || 'normal')}${x.top ? ' is-top' : ''}"><span class="u3-wl-row__n">${x.slot}</span>`
    + `<span class="u3-wl-row__card">${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" draggable="false">` : ''}</span>`
    + `<span class="u3-wl-row__main"><b class="u3-wl-row__name">${esc(c.name)}</b>`
    + `<span class="u3-wl-row__r"><span class="u3-wl-row__dia" aria-hidden="true"></span>${esc(rarityLabel?.[c.rarity] || c.rarity)}</span></span>`
    + `<span class="u3-wl-row__acts">${star}${pencil}</span></li>`;
}

/** The window. slots = the /api/wishlist slots, msg = the error line (or ''), form = formOf(size). */
export function wishlistHTML({ slots = [], msg = '', form = 'dialog', rarityLabel = {} }) {
  const n = slots.filter((x) => x.card).length;
  return `<div class="u3-scrim u3-wl-scrim" data-u3-scrim data-form="${form}"><section class="u3-wl" role="dialog" aria-modal="true" aria-labelledby="u3WlT">`
    + `<header class="u3-wl__head">${icon('heart', { size: 'xl' })}<h2 class="u3-wl__title" id="u3WlT">Wishlist</h2>`
    + `<span class="u3-wl__count">${n}/${slots.length}</span>${iconButton({ icon: 'x', label: 'Close', data: { wlclose: '1' } })}</header>`
    + `<ol class="u3-wl__list">${slots.map((x) => rowHTML(x, rarityLabel)).join('')}</ol>`
    + `${msg ? inlineMessage({ kind: 'error', text: msg }) : ''}</section></div>`;
}

// ---- The wish picker filters: the Collection Filters panel groups (UI-07; D-66 item 3) -----------------------------
const words = (q) => String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
const textOf = (c) => { const t = c.tags || {}; return [c.name, c.subject, t.type, t.class, t.origin, ...(t.traits || []), ...(t.genre || [])].flat().filter(Boolean).join(' ').toLowerCase(); };
const origins = (c) => [].concat(c.tags?.origin || []);

/**
 * The filter groups for the cards (each group lists only the values that some card has, as the Collection does).
 * lib = { rarities: [[key, label]], elements: [[key, label]], types: [[key, label]], games: [[key, label]], elementOf(card) }.
 * start = the first values (the rarity of the card in the slot: "Filters (1)", as the approved frame).
 */
export function wishFilters(cards, lib, start = {}) {
  const has = (f) => (k) => cards.some((c) => f(c) === k || (Array.isArray(f(c)) && f(c).includes(k)));
  const group = (key, label, list, f) => ({ key, label, value: start[key] || 'all', clear: 'all',
    options: [{ id: 'all', label: 'All' }, ...list.filter(([k]) => has(f)(k)).map(([k, l]) => ({ id: k, label: l }))] });
  return [
    { key: 'show', label: 'Show', value: start.show || 'all', clear: 'all',
      options: [{ id: 'all', label: 'All' }, { id: 'owned', label: 'Owned' }, { id: 'missing', label: 'Missing' }, { id: 'ascend', label: 'Can ascend' }] },
    group('rarity', 'Rarity', lib.rarities, (c) => c.rarity),
    group('el', 'Element', lib.elements, (c) => lib.elementOf(c)),
    group('type', 'Type', lib.types, (c) => c.tags?.type),
    group('game', 'Game', lib.games, origins),
  ];
}
export const wishFilterCount = (v) => ['show', 'rarity', 'el', 'type', 'game'].filter((k) => v[k] && v[k] !== 'all').length;
/** The shown cards, in catalog order. Pure (unit-tested). */
export function wishApply(cards, v, q, elementOf) {
  const w = words(q);
  return cards.filter((c) => (v.show === 'owned' ? c.owned : v.show === 'missing' ? !c.owned : v.show === 'ascend' ? !!c.can_ascend : true)
    && (!v.rarity || v.rarity === 'all' || c.rarity === v.rarity)
    && (!v.el || v.el === 'all' || elementOf(c) === v.el)
    && (!v.type || v.type === 'all' || c.tags?.type === v.type)
    && (!v.game || v.game === 'all' || origins(c).includes(v.game))
    && (!w.length || w.every((x) => textOf(c).includes(x))));
}

// ---- The window --------------------------------------------------------------------------------------------------
let st = null;   // { o, slots, msg, busy }

/**
 * Open the window. o = { slots, load() -> { slots }, save(slot, cardId|null) -> { ok }, star(slot) -> { ok },
 *   cards() -> the catalog cards with owned/can_ascend, lib (wishFilters), rarityLabel, detail(card), onChange(),
 *   returnFocus }
 */
export function openWishlist(o) {
  closeWishlist();
  st = { o, slots: o.slots || [], msg: '', busy: false };
  const host = document.createElement('div');
  host.id = 'u3Wish';
  document.body.appendChild(host);
  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  addEventListener('resize', paint);
  paint();
  host.querySelector('.u3-wl')?.focus?.({ preventScroll: true });
}

export function closeWishlist() {
  if (!st) return;
  document.getElementById('u3Wish')?.remove();
  document.removeEventListener('keydown', onKey);
  removeEventListener('resize', paint);
  const back = st.o.returnFocus;
  st = null;
  back?.focus?.();
}

function paint() {
  const host = document.getElementById('u3Wish');
  if (!host || !st) return;
  host.innerHTML = wishlistHTML({ slots: st.slots, msg: st.msg, form: formOf(document.body.dataset.size), rarityLabel: st.o.rarityLabel });
  host.querySelector('.u3-wl').tabIndex = -1;
}

// a save or a star: the server answers, then the window shows the server's list again
async function run(call) {
  if (!st || st.busy) return;
  st.busy = true;
  let r = null;
  try { r = await call(); } catch { r = null; }
  if (!st) return;
  st.msg = r?.ok ? '' : SAVE_ERROR;
  let d = null;
  try { d = await st.o.load(); } catch { d = null; }
  if (!st) return;
  if (Array.isArray(d?.slots)) st.slots = d.slots;
  st.busy = false;
  paint();
  if (r?.ok) st.o.onChange?.();
}

function openPicker(slot, from) {
  const o = st.o;
  const cur = st.slots.find((x) => x.slot === slot)?.card || null;
  const curId = cur ? Number(cur.id) : null;
  const cards = o.cards();
  const elementOf = o.lib.elementOf;
  openCardPicker({
    title: `Wish Slot ${slot}`, icon: 'heart', one: true, cap: 1, cards, selected: curId ? [curId] : [], returnFocus: from,
    filters: wishFilters(cards, o.lib, { rarity: cur?.rarity }),
    filterCount: wishFilterCount,
    apply: (list, v, q) => wishApply(list, v, q, elementOf),
    status: (sel) => ({ checks: [], ready: sel.length === 1 }),
    detail: (c) => o.detail?.(c),
    clear: { label: 'Clear', disabled: !curId, onClear: async () => { await run(() => o.save(slot, null)); return true; } },
    onConfirm: async (sel) => { if (Number(sel[0]) !== curId) await run(() => o.save(slot, Number(sel[0]))); return true; },
  });
}

function onKey(e) {
  if (!st || e.key !== 'Escape' || document.getElementById('u3Picker')) return;   // the picker closes first
  e.preventDefault();
  closeWishlist();
}

function onClick(e) {
  if (!st) return;
  const t = e.target.closest('button, [data-u3-scrim]');
  if (!t) return;
  if (t.matches('[data-u3-scrim]')) { if (e.target === t) closeWishlist(); return; }
  const d = t.dataset;
  if (d.wlclose) { closeWishlist(); return; }
  if (d.wltop) { if (t.getAttribute('aria-pressed') !== 'true') run(() => st.o.star(Number(d.wltop))); return; }
  if (d.wlset) openPicker(Number(d.wlset), t);
}
