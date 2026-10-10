// UI-64: the one Card picker window (docs/design.md 6.5 pickers, 6.5a; D-40, D-42). Approved: design repo UI-64/approved
// (review-1 to review-3). Pick several (a squad: the slot row in pick order, numbers on the grid, the live checks) and,
// later, pick one (the wishlist, trades). A full sheet on the compact classes and a dialog on medium and expanded (C1).
// The caller gives the cards and the rules; the server checks the squad again (dungeon_start, lock_hunt_squad).
import { esc, button, iconButton, searchField, pager, segmented } from './components.js';
import { icon } from './icons.js';
import { TOKENS } from '../tokens.js';
import { thumb } from '../thumb.js';

/**
 * The grid for an area (8.1 tile size): of every columns x rows whose tile is card-tile to card-tile-max wide, the one
 * that shows the most cards (then the larger tile). An area too short for one row of card-tile cards gets one row of
 * smaller cards. `extra` is the height under each card (the caption, pick-one). `floor` (opt-in, below min): when the
 * best fit leaves more than a quarter of the height empty, cards down to `floor` wide may add a row with the same columns (a width-limited
 * grid cannot grow its cards to the free height). Pure (unit-tested).
 */
const EMPTY_MAX = 1 / 4;   // 3.4: an empty band above 25% of the window is a defect
export function fitGrid(width, height, gap, { min = TOKENS['card-tile'], max = TOKENS['card-tile-max'], ratio = TOKENS['card-ratio'], extra = 0, floor = min } = {}) {
  if (!(width > 0 && height > 0)) return { cols: 1, rows: 1, tile: min };
  const search = (lo, atLeast = 1, colCap = Infinity) => {
    let best = null;
    const cMax = Math.min(colCap, Math.max(1, Math.floor((width + gap) / (lo + gap))));
    for (let cols = 1; cols <= cMax; cols++) {
      const byW = (width - gap * (cols - 1)) / cols;
      const rMax = Math.floor((height + gap) / (lo * ratio + extra + gap));
      for (let rows = atLeast; rows <= rMax; rows++) {
        const tile = Math.min(max, byW, ((height - gap * (rows - 1)) / rows - extra) / ratio);
        if (tile < lo) continue;
        const n = cols * rows;
        if (!best || n > best.n || (n === best.n && tile > best.tile)) best = { cols, rows, tile, n };
      }
    }
    return best;
  };
  let best = search(min);
  if (best && floor < min) {
    const used = (b) => (b.rows * (b.tile * ratio + extra) + gap * (b.rows - 1)) / height;
    if (1 - used(best) > EMPTY_MAX) { const alt = search(floor, best.rows + 1, best.cols); if (alt && alt.n > best.n) best = alt; }
  }
  if (!best) {
    const cMax = Math.max(1, Math.floor((width + gap) / (min + gap)));
    best = { cols: cMax, rows: 1, tile: Math.min(max, (width - gap * (cMax - 1)) / cMax, (height - extra) / ratio) };
  }
  return { cols: best.cols, rows: best.rows, tile: Math.floor(best.tile) };
}

/** The squad order after a tap (6.5a): a tap adds the card at the end; a tap on a picked card removes it and the cards
 *  after it move up one number. Pure (unit-tested). */
export function toggle(sel, id, cap) {
  const i = sel.indexOf(id);
  if (i >= 0) return sel.filter((x) => x !== id);
  return sel.length < cap ? [...sel, id] : sel;
}

let cur = null;   // the open picker: { opts, sel, q, values, page, per, filters }

/**
 * Open the picker.
 * opts: { title, cap, cards: [{ id, name, rarity, image_url }], selected: [ids],
 *   badge(card) -> text or '' (the Dungeon cost "2 PT", C4),
 *   blocked(card, sel) -> reason or '' (greyed, not selectable; the magnifier stays, C13),
 *   filters: [{ key, label, options: [{ id, label }], value, clear }], apply(cards, values, q) -> the shown list in order,
 *   filterCount(values) -> the number on "Filters (n)",
 *   status(sel) -> { checks: [{ ok, label }], ready, reason },
 *   detail(card) (the magnifier: the Card Detail), onConfirm(sel) -> true to close (async allowed),
 *   locked(card) -> true: in the squad and cannot leave it (the Hunt: a card that fought today),
 *   autoPick(sel) -> the new selection (async; the Auto-pick button left of Confirm),
 *   confirmCheck(sel) -> null, or { title, line, cancel, primary, fill(sel) } (a dialog before Confirm: the Hunt short squad) }
 *   A status check is { ok, label }, or a stat { stat, label } ("225 Squad Power" with the zap icon, C9).
 *   mode: 'one' = pick one (6.5, the wishlist, the Shop stat reset): no slot row, no count, one card at a time with the
 *   gold check mark (no number); a tap on the picked card clears it. cap is 1 then.
 *   icon: the name of an icon left of the title. clear: the label of a Clear button left of Confirm (pick one: the
 *   wishlist frames). caption(card) -> text (or a list of parts) under each card (the Shop stat points, D-80 item 23). status(sel).checks is
 *   the status line slot. slotsLabel: the aria-label of the slot row (default "Your squad").
 */
export function openCardPicker(opts) {
  closeCardPicker();
  const values = Object.fromEntries((opts.filters || []).map((f) => [f.key, f.value]));
  const one = opts.mode === 'one';
  cur = { one, opts, sel: [...(opts.selected || [])].slice(0, one ? 1 : opts.cap), q: '', values, page: 0, per: 0, panel: false, busy: false };
  const host = document.createElement('div');
  host.id = 'u3Picker';
  document.body.appendChild(host);
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  // the keyboard and the size class change body data-kb / data-size after the resize: measure again then too
  cur.mo = new MutationObserver(onResize);
  cur.mo.observe(document.body, { attributes: true, attributeFilter: ['data-kb', 'data-size', 'data-input'] });
  paint();
  // the search box takes the focus only with a mouse or trackpad: on touch it would open the keyboard (9.1)
  if (document.body.dataset.input === 'fine') host.querySelector('.u3-search__input')?.focus({ preventScroll: true });
  else host.querySelector('.u3-pk')?.focus({ preventScroll: true });
}

export function closeCardPicker() {
  if (!cur) return;
  document.getElementById('u3Picker')?.remove();
  document.removeEventListener('keydown', onKey);
  removeEventListener('resize', onResize);
  cur.mo?.disconnect();
  const back = cur.opts.returnFocus;
  cur = null;
  back?.focus?.();
}

const byId = () => new Map(cur.opts.cards.map((c) => [Number(c.id), c]));
const shown = () => (cur.opts.apply ? cur.opts.apply(cur.opts.cards, cur.values, cur.q) : cur.opts.cards);

function tileHTML(c, n, why) {
  const badge = cur.opts.badge?.(c) || '';
  const name = esc(c.name || 'Card');
  const tag = cur.opts.caption ? 'div' : 'li';   // a caption: the card sits in a cell with its caption under it (<li class="u3-pk-cell">)
  const card = `<${tag} class="u3-pk-card u3-r-${esc(c.rarity || 'normal')}${n ? ' is-sel' : ''}${why ? ' is-off' : ''}" data-card="${c.id}">`
    + `<button type="button" class="u3-pk-card__pick" data-pick="${c.id}" aria-pressed="${n ? 'true' : 'false'}"`
    + ` aria-label="${name}${badge ? `, ${esc(badge)}` : ''}${n ? (cur.one ? ', selected' : `, number ${n}`) : ''}${why ? `, ${esc(why)}` : ''}"${why && !n ? ' aria-disabled="true"' : ''}>`
    + `${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" loading="lazy" draggable="false">` : ''}</button>`
    + `${badge ? `<span class="u3-pk-badge" aria-hidden="true">${esc(badge)}</span>` : ''}`
    + `${n ? (cur.one ? `<span class="u3-pk-num is-mark" aria-hidden="true">${icon('check', { size: 'sm' })}</span>` : `<span class="u3-pk-num" aria-hidden="true">${n}</span>`) : ''}`
    + `<button type="button" class="u3-pk-card__info" data-info="${c.id}" aria-label="Card details: ${name}">${icon('search')}</button></${tag}>`;
  return cur.opts.caption ? `<li class="u3-pk-cell">${card}<span class="u3-pk-cap">${capHTML(cur.opts.caption(c))}</span></li>` : card;
}

// A caption is a text, or a list of parts that wrap as whole parts (the stat points "ATK 5", "VIT 3").
const capHTML = (v) => (Array.isArray(v) ? v.map((x) => `<span class="u3-pk-cap__i">${esc(x)}</span>`).join(' ') : esc(v || ''));

function slotsHTML() {
  const M = byId();
  const cards = cur.sel.map((id) => M.get(id)).filter(Boolean);
  return `<ol class="u3-pk-slots" aria-label="${esc(cur.opts.slotsLabel || 'Your squad')}">${Array.from({ length: cur.opts.cap }, (_, i) => {
    const c = cards[i];
    if (!c) return `<li class="u3-pk-slot${i === cards.length ? ' is-next' : ''}"><span>${i + 1}</span></li>`;
    const badge = cur.opts.badge?.(c) || '';
    return `<li class="u3-pk-slot is-full u3-r-${esc(c.rarity || 'normal')}">`
      + `${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" draggable="false">` : ''}`
      + `${badge ? `<span class="u3-pk-badge" aria-hidden="true">${esc(badge)}</span>` : ''}`
      + `${cur.opts.locked?.(c) ? '' : `<button type="button" class="u3-pk-slot__x" data-unpick="${c.id}" aria-label="Remove ${esc(c.name || 'card')}">${icon('x', { size: 'sm' })}</button>`}</li>`;
  }).join('')}</ol>`;
}

function checksHTML(st) {
  return `<ul class="u3-pk-checks" aria-live="polite">${(st.checks || []).map((k) => (k.stat != null
    ? `<li class="is-stat">${icon('zap')}<b>${esc(k.stat)}</b><span>${esc(k.label)}</span></li>`
    : `<li class="${k.ok ? 'is-ok' : ''}">${icon(k.ok ? 'circle-check' : 'circle')}<span>${esc(k.label)}</span></li>`)).join('')}</ul>`;
}

// The dialog before Confirm (5.2 Dialog): the cancel button keeps the squad as it is, the primary fills it first.
function warnHTML(w) {
  return `<div class="u3-scrim u3-pk-fscrim" data-u3-scrim><div class="u3-dialog u3-pk-warn" role="alertdialog" aria-modal="true" aria-labelledby="u3PkW">`
    + `<header class="u3-dialog__head"><h2 class="u3-dialog__title" id="u3PkW">${esc(w.title)}</h2>${iconButton({ icon: 'x', label: 'Close', variant: 'plain', data: { wclose: '1' } })}</header>`
    + `${w.line ? `<p class="u3-dialog__line">${esc(w.line)}</p>` : ''}<footer class="u3-dialog__foot">${button({ label: w.cancel || 'Continue', data: { wgo: '1' } })}${button({ label: w.primary, variant: 'primary', data: { wfill: '1' } })}</footer></div></div>`;
}

function gridHTML() {
  const list = shown();
  const per = cur.per || list.length || 1;
  const pages = Math.max(1, Math.ceil(list.length / per));
  cur.page = Math.min(cur.page, pages - 1);
  const slice = list.slice(cur.page * per, cur.page * per + per);
  const tiles = slice.map((c) => {
    const n = cur.sel.indexOf(Number(c.id)) + 1;
    return tileHTML(c, n, n ? '' : cur.opts.blocked?.(c, cur.sel) || '');
  }).join('');
  return { tiles: tiles || `<li class="u3-pk-none">${esc(cur.q ? 'No cards match.' : 'No cards here.')}</li>`, pages };
}

function filterPanelHTML() {
  const groups = (cur.opts.filters || []).map((f) => `<div class="u3-pk-fgroup"><span class="u3-label">${esc(f.label)}</span>`
    + segmented(f.options.map((o) => ({ id: `${f.key}:${o.id}`, label: o.label, active: cur.draft[f.key] === o.id })), { label: f.label }) + '</div>').join('');
  return `<div class="u3-scrim u3-pk-fscrim" data-u3-scrim><div class="u3-dialog u3-pk-filters" role="dialog" aria-modal="true" aria-labelledby="u3PkF">`
    + `<header class="u3-dialog__head"><h2 class="u3-dialog__title" id="u3PkF">Filters</h2>${iconButton({ icon: 'x', label: 'Close filters', variant: 'plain', data: { fclose: '1' } })}</header>`
    + `${groups}<footer class="u3-dialog__foot">${button({ label: 'Clear all', data: { fclear: '1' } })}${button({ label: 'Confirm', variant: 'primary', data: { fok: '1' } })}</footer></div></div>`;
}

function paint() {
  const host = document.getElementById('u3Picker');
  if (!host || !cur) return;
  const o = cur.opts;
  const st = o.status ? o.status(cur.sel) : { checks: [], ready: cur.sel.length > 0 };
  const n = o.filterCount ? o.filterCount(cur.values) : 0;
  const { tiles, pages } = gridHTML();
  const clear = o.clear && cur.one ? button({ label: o.clear, disabled: cur.busy || !cur.sel.length, data: { clear: '1' } }) : '';
  const confirm = button({ label: 'Confirm', variant: 'primary', disabled: !st.ready || cur.busy, busy: cur.busy, busyLabel: 'Saving', reason: st.ready ? null : st.reason, data: { confirm: '1' } });
  const a = document.activeElement;
  const caret = a && host.contains(a) && a.classList.contains('u3-search__input') ? a.selectionStart : null;
  host.innerHTML = `<div class="u3-scrim u3-pk-scrim${cur.shown ? ' is-still' : ''}" data-u3-scrim><section class="u3-pk${cur.one ? ' is-one' : ''}" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="u3PkT" style="--pk-cap:${o.cap};--pk-scols:${o.cap > 5 ? 4 : 3}${cur.slotW ? `;--pk-slot:${cur.slotW}px` : ''}">`
    + `<header class="u3-pk__head"><h2 class="u3-pk__title" id="u3PkT">${o.icon ? icon(o.icon) : ''}${esc(o.title || 'Squad')}${cur.one ? '' : ` <b>${cur.sel.length}</b><span>/ ${o.cap}</span>`}</h2></header>`
    + `<div class="u3-pk__close">${iconButton({ icon: 'x', label: 'Close', data: { close: '1' } })}</div>`
    + (cur.one ? '' : `<div class="u3-pk__slots">${slotsHTML()}</div>`)
    + `<div class="u3-pk__tools">${searchField({ value: cur.q })}${(o.filters || []).length ? button({ label: n ? `Filters (${n})` : 'Filters', icon: 'list-filter', data: { filters: '1' } }) : ''}</div>`
    + `<ul class="u3-pk__grid${(cur.tile || TOKENS['card-tile']) < TOKENS['card-thumb'] ? ' is-small' : ''}${o.caption ? ' has-cap' : ''}" aria-label="Cards" style="--pk-cols:${cur.cols || 1};--pk-tile:${cur.tile || TOKENS['card-tile']}px${o.caption ? `;--pk-cap-h:${cur.capH || 0}px` : ''}">${tiles}</ul>`
    + `<div class="u3-pk__pager">${pager({ page: cur.page + 1, pages })}</div>`
    + `<footer class="u3-pk__foot">${checksHTML(st)}<div class="u3-pk__acts">${clear}${o.autoPick ? button({ label: 'Auto-pick', disabled: cur.busy, data: { auto: '1' } }) : ''}${confirm}</div></footer>`
    + `</section></div>${cur.panel ? filterPanelHTML() : ''}${cur.warn ? warnHTML(cur.warn) : ''}`;
  cur.shown = true;   // the fade-in plays once, when the window opens (a repaint does not flash it)
  if (caret != null) { const i = host.querySelector('.u3-search__input'); i?.focus({ preventScroll: true }); i?.setSelectionRange(caret, caret); }
  measure();
}

// The page size: the columns and rows that fit the grid area (one view, no scroll; the pager under the grid, D-36).
function measure() {
  const g = document.querySelector('#u3Picker .u3-pk__grid');
  if (!g) return;
  const pk = g.closest('.u3-pk');
  const foot = pk.querySelector('.u3-pk-checks');   // the lowest part of the left column (compact-land: the footer box is display: contents)
  if (document.body.dataset.size === 'compact-land' && foot && !cur.one) {
    const over = foot.getBoundingClientRect().bottom - (pk.getBoundingClientRect().bottom - parseFloat(getComputedStyle(pk).paddingBottom));
    const w = cur.slotW || TOKENS['card-thumb'];
    if (over > 0.5 && w > TOKENS['card-mini']) { cur.slotW = Math.max(TOKENS['card-mini'], Math.floor(w - over / 2 / TOKENS['card-ratio']) - 1); paint(); return; }
  }
  const cs = getComputedStyle(g);
  const gap = parseFloat(cs.columnGap) || 0;
  const fit = (extra) => fitGrid(g.clientWidth, g.clientHeight, gap, { extra, floor: TOKENS['card-thumb'] });
  let capH = cur.capH || 0;
  let f = fit(capH);
  if (cur.opts.caption) {
    // the caption height: the tallest caption of the whole list at the tile width (it wraps); the fit and the height settle together
    for (let i = 0; i < 4; i++) {
      const need = captionHeight(f.tile);
      if (need <= capH) break;
      capH = need; f = fit(capH);
    }
  }
  const per = f.cols * f.rows;
  if (per !== cur.per || f.tile !== cur.tile || f.cols !== cur.cols || capH !== (cur.capH || 0)) {
    cur.capH = capH;
    const first = cur.page * (cur.per || per);
    Object.assign(cur, { per, tile: f.tile, cols: f.cols, page: Math.floor(first / per) });
    paint();
  }
}

// The tallest caption of the list, laid out at the tile width in a hidden probe (the same CSS as the real caption).
function captionHeight(tile) {
  const host = document.getElementById('u3Picker');
  const probe = document.createElement('div');
  probe.className = 'u3-pk-capprobe';
  probe.setAttribute('aria-hidden', 'true');
  probe.style.setProperty('--pk-tile', `${tile}px`);
  probe.innerHTML = shown().map((c) => `<span class="u3-pk-cap">${capHTML(cur.opts.caption(c))}</span>`).join('');
  host.appendChild(probe);
  const h = Math.ceil(Math.max(0, ...[...probe.children].map((e) => e.getBoundingClientRect().height)));
  probe.remove();
  return h;
}

let rt = null;
// a resize or a class change (the keyboard): measure again on the next frame (no timer: the keyboard check reads the window soon after)
function onResize() { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (cur) { cur.per = 0; cur.slotW = 0; cur.capH = 0; paint(); } }); }

function onKey(e) {
  if (!cur || e.key !== 'Escape') return;
  if (e.u3Done || document.querySelector('#viewer:not(.hidden)')) return;   // the card details are open above: Escape closes them first
  e.preventDefault();
  if (cur.warn) { cur.warn = null; paint(); } else if (cur.panel) { cur.panel = false; paint(); } else closeCardPicker();
}

function onInput(e) {
  if (!e.target.classList.contains('u3-search__input')) return;
  cur.q = e.target.value;
  cur.page = 0;
  paint();
}

async function onClick(e) {
  if (!cur) return;
  const t = e.target.closest('button, [data-u3-scrim]');
  if (!t) return;
  const d = t.dataset;
  const M = byId();
  if (d.close) { closeCardPicker(); return; }
  if (t.matches('[data-u3-scrim]')) { if (e.target === t) { if (cur.warn) { cur.warn = null; paint(); } else if (cur.panel) { cur.panel = false; paint(); } else closeCardPicker(); } return; }
  if (d.info) { const c = M.get(Number(d.info)); if (c) cur.opts.detail?.(c); return; }
  if (d.pick) {
    const id = Number(d.pick);
    const c = M.get(id);
    if (!c || (t.getAttribute('aria-disabled') === 'true' && !cur.sel.includes(id))) return;
    if (cur.sel.includes(id) && cur.opts.locked?.(c)) return;   // it fought today: it stays in the squad
    cur.sel = cur.one ? (cur.sel[0] === id ? [] : [id]) : toggle(cur.sel, id, cur.opts.cap);
    paint();
    return;
  }
  if (d.clear) { cur.sel = []; paint(); return; }
  if (d.unpick) { cur.sel = cur.sel.filter((x) => x !== Number(d.unpick)); paint(); return; }
  if (d.page) { cur.page += d.page === 'next' ? 1 : -1; paint(); return; }
  if (t.classList.contains('u3-search__input') === false && t.closest('.u3-search') && t.matches('.u3-ibtn')) { cur.q = ''; cur.page = 0; paint(); return; }
  if (d.filters) { cur.draft = { ...cur.values }; cur.panel = true; paint(); return; }
  if (d.fclose) { cur.panel = false; paint(); return; }
  if (d.seg && cur.panel) { const [k, v] = d.seg.split(':'); cur.draft[k] = v; paint(); return; }
  if (d.fclear) { cur.draft = Object.fromEntries(cur.opts.filters.map((f) => [f.key, f.clear ?? f.options[0].id])); paint(); return; }
  if (d.fok) { cur.values = { ...cur.draft }; cur.panel = false; cur.page = 0; paint(); return; }
  if (d.auto) {
    if (cur.busy) return;
    cur.busy = true; paint();
    let next = null;
    try { next = await cur.opts.autoPick([...cur.sel]); } catch { next = null; }
    if (!cur) return;
    cur.busy = false;
    if (Array.isArray(next)) cur.sel = next.map(Number).slice(0, cur.opts.cap);
    paint();
    return;
  }
  if (d.wclose) { cur.warn = null; paint(); return; }
  if (d.wgo) { cur.warn = null; await confirmNow(); return; }
  if (d.wfill) {
    const w = cur.warn; cur.warn = null; cur.busy = true; paint();
    let next = null;
    try { next = await w.fill([...cur.sel]); } catch { next = null; }
    if (!cur) return;
    cur.busy = false;
    if (Array.isArray(next)) cur.sel = next.map(Number).slice(0, cur.opts.cap);
    await confirmNow();
    return;
  }
  if (d.confirm) {
    if (cur.busy) return;
    const st = cur.opts.status ? cur.opts.status(cur.sel) : { ready: true };
    if (!st.ready) return;
    const w = cur.opts.confirmCheck?.([...cur.sel]);
    if (w) { cur.warn = w; paint(); return; }
    await confirmNow();
  }
}

async function confirmNow() {
  if (!cur) return;
  cur.busy = true; paint();
  let done = false;
  try { done = await cur.opts.onConfirm?.([...cur.sel]); } catch { done = false; }
  if (!cur) return;
  cur.busy = false;
  if (done !== false) closeCardPicker(); else paint();
}
