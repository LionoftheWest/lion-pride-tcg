// UI-13 Achievement tracks, titles and frames (v3, only under body.ui-v3 and only for a member whose achievement view is
// enabled: settings.achievement_tracks). Approved designs: lion-pride-tcg-design UI-13/approved. The Achievements tab (UI-12,
// collection-tabs.js) paints the Badges list; this module paints the other three: the Tracks list with its window, the Titles
// list and the Frames list. All four share the switch (Tracks | Badges | Titles | Frames) in the head row.
// ui-v2.js owns the data and the calls (deps `d`); this module only paints and wires. The look is 90-ui-13.css (tokens only).
import { esc, button, iconButton, pager, progressLinear, segmented, tierPip, inlineMessage } from './components.js';
import { icon } from './icons.js';
import { fmtFor } from './number.js';
import { rowsThatFit, pageSlice, wideColumns } from './collection-tabs.js';
import * as T from './tracks.js';

const S = { page: { tracks: 0, titles: 0, frames: 0 }, openKey: null, busy: new Set(), err: new Set(), all: null, eq: new Set(), eqErr: new Set(), ro: null, mo: null, key: null };
const WIDE_COLS_TRACKS = 6;
const px = (v) => parseFloat(v) || 0;
const $ = (r, s) => r?.querySelector(s);
const sizeCls = () => document.body.dataset.size || '';
const num = (n) => fmtFor(n, sizeCls());

/** The switch: Tracks, Badges, Titles, Frames (a level-2 Segmented). */
export const switchHTML = (seg) => `<div class="u3-tr__sw">${segmented(T.SEGMENTS.map(([id, label]) => ({ id, label, active: id === seg })), { label: 'Achievements' })}</div>`;

// ---- The tiles -----------------------------------------------------------------------------------------------------------
function claimBtn(key, n, { size = 'sm' } = {}) {
  return button({ label: S.err.has(key) ? 'Try again' : T.claimLabel(n), busyLabel: 'Claiming…', variant: 'primary', size, busy: S.busy.has(key), data: { claim: key } });
}

export function trackTileHTML(t, rewards = null) {
  const ready = T.readyOf(t);
  const goal = T.trackGoal(t);
  const pips = Array.from({ length: 5 }, (_, i) => tierPip(T.tierKey(i + 1), { reached: i < (t.reached | 0) })).join('');
  const count = goal.done ? num(t.value) : `${num(t.value)}/${num(goal.need)}`;
  const foot = goal.done ? `All ${T.TIER_NAMES.length} tiers reached` : T.rewardShort((t.reached | 0) + 1, t.titles, rewards);
  return `<li class="u3-at u3-tr is-${ready ? 'ready' : 'progress'}" data-key="${esc(t.key)}">`
    + `<div class="u3-at__top"><span class="u3-at__ico" aria-hidden="true">${icon(T.trackIcon(t.key))}</span>`
    + `<button type="button" class="u3-at__name" data-track="${esc(t.key)}">${esc(t.name)}</button>${ready ? claimBtn(`track:${t.key}`, ready) : ''}</div>`
    + `<p class="u3-at__desc">${esc(T.trackDesc(t))}</p>`
    + `<div class="u3-tr__meter"><span class="u3-tr__pips" aria-label="${t.reached | 0} of 5 tiers reached" role="img">${pips}</span>${progressLinear({ value: T.trackFill(t) })}<span class="u3-at__n">${count}</span></div>`
    + `<p class="u3-at__rw">${icon('gift', { size: 'sm' })}<span>${esc(foot)}</span></p></li>`;
}

function equipBtn(r, kind) {
  if (r.locked) return `<span class="u3-tr__lock">${icon('lock', { size: 'md', label: 'Not owned' })}</span>`;
  if (r.equipped) return `<span class="u3-tr__on">Equipped ${icon('check', { size: 'sm' })}</span>`;
  const key = `${kind}:${r.value}`;
  return button({ label: S.eqErr.has(key) ? 'Try again' : 'Equip', busyLabel: 'Equipping…', variant: 'primary', size: 'sm', busy: S.eq.has(key), data: { equip: kind, value: r.value } });
}
function galleryFoot(r, members) {
  return `<div class="u3-tr__foot"><span>${esc(r.source)}</span><span>${esc(T.membersLine(r.owners, members))}</span></div>`;
}
export function titleTileHTML(r, members) {
  return `<li class="u3-at u3-tr u3-tr--gal${r.locked ? ' is-locked' : ''}"><div class="u3-at__top"><span class="u3-tr__title">${esc(r.label)}</span>${equipBtn(r, 'title')}</div>`
    + `<p class="u3-at__desc">${esc(r.desc)}</p>${galleryFoot(r, members)}</li>`;
}
export function frameTileHTML(r, members, d) {
  return `<li class="u3-at u3-tr u3-tr--gal${r.locked ? ' is-locked' : ''}"><div class="u3-at__top">${d.avatar(r.value, r.track)}<span class="u3-tr__fname">${esc(r.label)}</span>${equipBtn(r, 'frame')}</div>`
    + `<p class="u3-at__desc">${esc(r.desc)}</p>${galleryFoot(r, members)}</li>`;
}

// ---- The list (head, grid, pager) -----------------------------------------------------------------------------------------
function headHTML(d) {
  const claimRow = d.seg === 'tracks' && d.readyTotal > 0;
  const right = claimRow
    ? `<span class="u3-ct__right"><span class="u3-ct__ready">${icon('gift', { size: 'md' })}<span>${esc(T.claimLine(d.readyTotal))}</span></span>`
      + button({ label: S.all === 'error' ? 'Try again' : 'Claim all', busyLabel: 'Claiming…', variant: 'primary', size: 'sm', busy: S.all === 'busy', data: { claimall: '1' } }) + '</span>'
    : '';
  return `<div class="u3-ct__head u3-tr__head">${d.help || ''}${switchHTML(d.seg)}${right}</div>`;
}

function itemsFor(d) {
  if (d.seg === 'tracks') return T.trackOrder(d.view.tracks || []);
  if (!d.gallery) return null;
  return T.galleryRows(d.gallery, d.view, d.seg === 'titles' ? 'title' : 'frame', { equipped: d.seg === 'titles' ? d.equipped.title : d.equipped.frame, fmt: num });
}
const tileOf = (d) => (d.seg === 'tracks' ? (t) => trackTileHTML(t, d.view.rewards) : d.seg === 'titles' ? (r) => titleTileHTML(r, d.gallery.members) : (r) => frameTileHTML(r, d.gallery.members, d));

/** Paint the Tracks, Titles or Frames list into main (replaces its content). d: see ui-v2.js paintTracksTabV3. */
export function paintTracksV3(main, d) {
  const reopen = d.seg === 'tracks' ? S.openKey : null;   // a repaint after a Claim keeps the window open
  closeWindow(false);
  S.key = d.seg;
  main.innerHTML = `${d.tabBar}<section class="u3-ct u3-ct--ach u3-ct--tr" aria-label="Achievements">${headHTML(d)}`
    + `<div class="u3-ct__box"><ul class="u3-ct__grid" role="list"></ul><div class="u3-ct__pager"></div></div></section>`;
  const root = $(main, '.u3-ct');
  const box = $(root, '.u3-ct__box');
  const fit = () => fitList(root, d);
  root.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-seg]');
    if (seg) { d.onSeg(seg.dataset.seg); return; }
    if (e.target.closest('[data-retry]')) { d.onSeg(d.seg); return; }
    const claim = e.target.closest('[data-claim]');
    if (claim) { if (!claim.disabled) doClaim(claim.dataset.claim, root, d); return; }
    if (e.target.closest('[data-claimall]')) { if (S.all !== 'busy') doClaimAll(root, d); return; }
    const eq = e.target.closest('[data-equip]');
    if (eq) { if (!eq.disabled) doEquip(eq.dataset.equip, eq.dataset.value, root, d); return; }
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { S.page[d.seg] += pg.dataset.page === 'next' ? 1 : -1; fit(); return; }
    const open = e.target.closest('[data-track]');
    if (open) openWindow(open.dataset.track, d);
  });
  fit();
  watch(box, fit);
  if (reopen) openWindow(reopen, d, { keepFocus: true });
}

// Re-fit when the box changes size (a size class change, the keyboard, fonts arriving, 3.5).
function watch(box, fn) {
  S.ro?.disconnect();
  if (!window.ResizeObserver) return;
  let last = `${box.clientWidth}x${box.clientHeight}`;
  S.ro = new ResizeObserver(() => { const now = `${box.clientWidth}x${box.clientHeight}`; if (now !== last) { last = now; fn(); } });
  S.ro.observe(box);
  document.fonts?.ready?.then(() => { if (box.isConnected) fn(); });
}

function fitList(root, d) {
  const grid = $(root, '.u3-ct__grid'), box = $(root, '.u3-ct__box'), pg = $(root, '.u3-ct__pager');
  if (!grid || !box) return;
  const items = itemsFor(d);
  if (!items) {   // the titles and frames did not load: an error with Try again
    grid.innerHTML = `<li class="u3-tr__fail">${inlineMessage({ kind: 'error', text: 'Could not load the list.' })}${button({ label: 'Try again', variant: 'secondary', size: 'sm', data: { retry: '1' } })}</li>`;
    pg.innerHTML = ''; return;
  }
  const tile = tileOf(d);
  const bcs = getComputedStyle(box);
  const avail = box.clientHeight - px(bcs.paddingTop) - px(bcs.paddingBottom) - px(getComputedStyle(pg).height) - px(bcs.rowGap);
  // one pass: the tile height (the tallest of all tiles, A6), the columns and the rows that fit
  const pass = (tight) => {
    grid.classList.toggle('is-tight', tight);
    grid.style.removeProperty('--u3-ct-h');
    grid.style.removeProperty('--u3-ct-cols');
    grid.innerHTML = items.map(tile).join('');
    const gap = px(getComputedStyle(grid).rowGap);
    const fitCols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    if (wideColumns(fitCols)) grid.style.setProperty('--u3-ct-cols', WIDE_COLS_TRACKS);   // 1990x830: six columns (the approved frame), not the 8 of the Achievements list
    let h = 0;
    for (const t of grid.children) h = Math.max(h, t.getBoundingClientRect().height);
    h = Math.ceil(h);
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    const rows = rowsThatFit({ boxH: avail, rowH: h, gap });
    return { h, cols, rows, used: rows * h + (rows - 1) * gap };
  };
  let r = pass(false);
  if (avail > 0 && r.used < avail * 0.75) { const t = pass(true); if (t.rows > r.rows) r = t; else r = pass(false); }
  // The tiles of the page grow to fill the free height (up to 1.6 times), so that no blank band stays under the rows (the approved frames).
  const gapPx = px(getComputedStyle(grid).rowGap);
  const pageRows = Math.min(r.rows, Math.ceil(items.length / r.cols));
  const grown = pageRows > 0 ? Math.floor((avail - (pageRows - 1) * gapPx) / pageRows) : r.h;
  const h = Math.max(r.h, Math.min(grown, Math.floor(r.h * 1.6)));
  grid.style.setProperty('--u3-ct-h', `${h}px`);
  const s = pageSlice(items.length, r.rows * r.cols, S.page[d.seg]);
  S.page[d.seg] = s.page;
  grid.innerHTML = items.slice(s.start, s.end).map(tile).join('');
  pg.innerHTML = pager({ page: s.page + 1, pages: s.pages });
  pg.classList.toggle('is-hidden', s.pages < 2);
}

async function doClaim(key, root, d) {
  S.busy.add(key); S.err.delete(key);
  if (root.isConnected) fitList(root, d);
  refreshWindow(d);
  const r = await d.claim(key);
  S.busy.delete(key);
  if (r?.ok) return;           // the view repaints itself (ui-v2.js reloads the data)
  S.err.add(key);
  if (root.isConnected) fitList(root, d);
  refreshWindow(d);
}
async function doClaimAll(root, d) {
  S.all = 'busy';
  repaintHead(root, d);
  const r = await d.claimAll();
  if (r?.ok) { S.all = null; return; }
  S.all = 'error';
  if (root.isConnected) repaintHead(root, d);
}
function repaintHead(root, d) {
  const old = $(root, '.u3-ct__head');
  const help = old?.querySelector('.ex-q') || null;   // the "?" may sit in the sub-tab row (D-63): leave it there
  const tmp = document.createElement('div');
  tmp.innerHTML = headHTML({ ...d, help: '' });
  const head = tmp.firstElementChild;
  if (help && old.contains(help)) head.prepend(help);
  old.replaceWith(head);
}
async function doEquip(kind, value, root, d) {
  const key = `${kind}:${value}`;
  S.eq.add(key); S.eqErr.delete(key);
  if (root.isConnected) fitList(root, d);
  const r = await d.equip(kind, value);
  S.eq.delete(key);
  if (r?.ok) return;           // the view repaints itself: the row shows "Equipped"
  S.eqErr.add(key);
  if (root.isConnected) fitList(root, d);
}

// ---- The track window (the tiers of one track) ------------------------------------------------------------------------------
function windowHTML(t, d) {
  const ready = T.readyOf(t);
  const rows = T.trackRows(t, d.view.rewards).map((r) => {
    const st = r.state === 'ready' ? '<span class="u3-trw__st is-ready">Ready</span>'
      : r.state === 'claimed' ? `<span class="u3-trw__st is-claimed">${icon('check', { size: 'sm' })} Claimed</span>`
        : `<span class="u3-trw__st">${num(t.value)} / ${num(r.need)}</span>`;
    return `<li class="u3-trw__row is-${r.state}">${tierPip(r.key)}<span class="u3-trw__tier">${esc(r.name)}</span><span class="u3-trw__need">${num(r.need)}</span>`
      + `<span class="u3-trw__rw">${esc(r.reward)}</span>${st}</li>`;
  }).join('');
  return `<div class="u3-ath u3-trw" role="dialog" aria-modal="true" aria-labelledby="u3TrwT">`
    + `<header class="u3-ath__head"><span class="u3-ath__ico" aria-hidden="true">${icon(T.trackIcon(t.key), { size: 'lg' })}</span><h2 class="u3-ath__title" id="u3TrwT">${esc(t.name)}</h2>`
    + `${ready ? claimBtn(`track:${t.key}`, ready) : ''}${iconButton({ icon: 'x', label: 'Close', data: { 'trw-close': '1' } })}</header>`
    + `<p class="u3-ath__line">${esc(T.trackDesc(t))} · ${num(t.value)}</p><ul class="u3-trw__rows" role="list">${rows}</ul></div>`;
}

let keyHandler = null;
export function closeWindow(restore = true) {
  const key = S.openKey;
  document.getElementById('u3TrHost')?.remove();
  S.openKey = null;
  S.mo?.disconnect(); S.mo = null;
  if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
  if (restore && key) document.querySelector(`[data-track="${CSS.escape(key)}"]`)?.focus();
}
// A window that is short for its rows takes tighter rows (measured: the rows list is taller than its box).
function fitWindow(host) {
  const win = $(host, '.u3-trw'), rows = $(host, '.u3-trw__rows');
  if (!win || !rows) return;
  win.classList.remove('is-tight');
  if (rows.scrollHeight > rows.clientHeight + 1) win.classList.add('is-tight');
}
function refreshWindow(d) {
  const host = document.getElementById('u3TrHost');
  const t = host && (d.view.tracks || []).find((x) => x.key === S.openKey);
  if (t) { host.innerHTML = windowHTML(t, d); host._d = d; fitWindow(host); }
}
function openWindow(key, d, { keepFocus = false } = {}) {
  const t = (d.view.tracks || []).find((x) => x.key === key);
  if (!t) { closeWindow(false); return; }
  S.openKey = key;
  let host = document.getElementById('u3TrHost');
  const fresh = !host;
  if (!host) {
    host = document.createElement('div');
    host.id = 'u3TrHost'; host.className = 'u3-athhost u3-trhost';
    document.body.appendChild(host);
    host.addEventListener('click', (e) => {
      const cur = host._d;   // the newest data: the view repaints after a Claim
      if (e.target === host || e.target.closest('[data-trw-close]')) { closeWindow(); return; }
      const claim = e.target.closest('[data-claim]');
      if (claim && !claim.disabled) doClaim(claim.dataset.claim, document.querySelector('.u3-ct--tr'), cur);
    });
    keyHandler = (e) => { if (e.key === 'Escape') closeWindow(); };
    document.addEventListener('keydown', keyHandler);
  }
  host.innerHTML = windowHTML(t, d);
  host._d = d;
  fitWindow(host);
  document.fonts?.ready?.then(() => { if (host.isConnected) fitWindow(host); });
  if (fresh || !keepFocus) host.querySelector('[data-trw-close]')?.focus();
  // The window belongs to the Collection view: it closes when another view paints (a dock tap while the window is open).
  S.mo?.disconnect();
  const main = document.getElementById('main');
  if (main && window.MutationObserver) {
    S.mo = new MutationObserver(() => { if (!main.querySelector('.u3-ct--tr')) closeWindow(false); });
    S.mo.observe(main, { childList: true });
  }
}
