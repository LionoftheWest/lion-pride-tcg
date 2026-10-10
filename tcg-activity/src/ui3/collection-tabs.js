// UI-11 Collection: Bosses tab, and UI-12 Collection: Achievements, the achievement window and Claim (v3, only under
// body.ui-v3, settings.ui_v3). Approved designs: lion-pride-tcg-design UI-11/approved and UI-12/approved (review-1 and
// review-2: D-63, the "?" sits at the end of the sub-tab row on every class but compact-port).
// ui-v2.js calls paintAchievementsV3 / paintBossesV3 from renderCollectionV2 when the flag is on and the tab is open.
// The v2 tabs stay as they are for every member without the flag. The data, the API calls and the 3D mount stay in
// ui-v2.js: this module only paints and wires the approved layout (deps `d`).
// - Achievements: a list of tiles (one height for every tile, A6), the page size is what fits (3.4, 3.5), the pager
//   centered under the list (D-36). Claim is the status of a ready tile; Claim all and "N to claim" sit in the head row.
//   A tap on a tile opens the achievement window (a sheet on compact-port, a dialog on the other classes, A8).
// - Bosses: all bosses on one page, the name inside the tile (wraps, B6, B7). A tap opens the boss window (B3).
import { esc, button, iconButton, pager, progressLinear } from './components.js';
import { icon } from './icons.js';
import { fmtFor } from './number.js';

// ---- Pure logic (tested in collection-tabs.test.js) ------------------------------------------------------------

/** 'ready' (done, not claimed), 'claimed', or 'progress'. */
export function statusOf(a, claimed) {
  if (!a?.done) return 'progress';
  return claimed?.has(a.key) ? 'claimed' : 'ready';
}
/** The head line of the list (A2: "Redeem" is "Claim"). */
export const claimLine = (n) => `${Math.max(0, n | 0)} to claim`;
/** The credit line with "·" in place of the em dash (B9, 10.2). */
export const bossCredit = (s) => String(s || '').replace(/\s[—–]\s/g, ' · ');
/** The rows that fit in a box: a grid adds a row before it adds a page (3.4). At least one row. */
export function rowsThatFit({ boxH, rowH, gap }) {
  if (!(rowH > 0) || !(boxH > 0)) return 1;
  return Math.max(1, Math.floor((boxH + gap) / (rowH + gap)));
}
/** The page after a change: inside 0..pages-1. Returns { page, pages, start, end }. */
export function pageSlice(total, per, page) {
  const p = Math.max(1, per | 0);
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / p));
  const pg = Math.min(Math.max(0, page | 0), pages - 1);
  return { page: pg, pages, start: pg * p, end: Math.min(total, pg * p + p) };
}
/** The grid for the Bosses list: wide boxes get 6 columns, tall boxes 3 (approved frames); the rows follow the count. */
export function bossGrid(n, boxW, boxH, cls = '') {
  const wide = cls === 'compact-port' ? false : boxW > boxH;   // a phone held upright is always tall, whatever a safe area leaves of the box
  const cols = Math.min(Math.max(1, n), wide ? 6 : 3);
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

// ---- State that lives across repaints of the Collection (the view repaints after every Claim) -----------------------
const S = { page: 0, detailPage: 0, openKey: null, busy: new Set(), err: new Set(), all: null, bossOpen: null, ro: null, mo: null };

const px = (v) => parseFloat(v) || 0;
const $ = (r, s) => r?.querySelector(s);
const sizeCls = () => document.body.dataset.size || '';

// ---- Achievements ---------------------------------------------------------------------------------------------

function statHTML(a, st, d) {
  if (st === 'claimed') return '<span class="u3-at__claimed">Claimed ✓</span>';
  if (st === 'ready') {
    const busy = S.busy.has(a.key);
    return button({ label: S.err.has(a.key) ? 'Try again' : 'Claim', busyLabel: 'Claiming…', variant: 'primary', size: 'sm', busy, data: { claim: a.key } });
  }
  return `<span class="u3-at__n">${fmtFor(a.have, sizeCls())}/${fmtFor(a.need, sizeCls())}</span>`;
}

/** One achievement tile (A5, A6, A7): the open control is the name; the Claim button sits in the status place. */
export function achTileHTML(a, d) {
  const st = statusOf(a, d.claimed);
  const pct = Math.min(1, a.need > 0 ? a.have / a.need : 0);
  return `<li class="u3-at is-${st}" data-key="${esc(a.key)}">`
    + `<div class="u3-at__top"><span class="u3-at__ico" aria-hidden="true">${esc(a.icon)}</span>`
    + `<button type="button" class="u3-at__name" data-ach="${esc(a.key)}">${esc(a.name)}</button>${statHTML(a, st, d)}</div>`
    + `<p class="u3-at__desc">${esc(a.desc)}</p>${progressLinear({ value: pct })}`
    + `<p class="u3-at__rw">${icon('gift', { size: 'sm' })}<span>${esc(d.rewardText(a))}</span></p></li>`;
}

function headHTML(d, ready) {
  const right = ready
    ? `<span class="u3-ct__ready">${icon('gift', { size: 'md' })}<span>${esc(claimLine(ready))}</span></span>`
      + button({ label: S.all === 'error' ? 'Try again' : 'Claim all', busyLabel: 'Claiming…', variant: 'primary', size: 'sm', busy: S.all === 'busy', data: { claimall: '1' } })
    : '';
  return `<div class="u3-ct__head">${d.help || ''}${right ? `<span class="u3-ct__right">${right}</span>` : ''}</div>`;
}

/** Paint the Achievements tab into main (replaces its content). d: see ui-v2.js paintAchievementsV3 call. */
export function paintAchievementsV3(main, d) {
  document.getElementById('u3BossHost')?.remove(); S.bossOpen = null;   // a boss window never survives a tab change
  const ready = d.achs.filter((a) => statusOf(a, d.claimed) === 'ready').length;
  main.innerHTML = `${d.tabBar}<section class="u3-ct u3-ct--ach" aria-label="Achievements">${headHTML(d, ready)}`
    + `<div class="u3-ct__box"><ul class="u3-ct__grid" role="list"></ul><div class="u3-ct__pager"></div></div></section>`;
  const root = $(main, '.u3-ct');
  const box = $(root, '.u3-ct__box');
  const fit = () => fitAchievements(root, d);
  root.addEventListener('click', (e) => {
    const claim = e.target.closest('[data-claim]');
    if (claim) { if (!claim.disabled) doClaim(claim.dataset.claim, root, d); return; }
    if (e.target.closest('[data-claimall]')) { if (S.all !== 'busy') doClaimAll(root, d); return; }
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { S.page += pg.dataset.page === 'next' ? 1 : -1; fit(); return; }
    const open = e.target.closest('[data-ach]');
    if (open) openWindow(open.dataset.ach, d);
  });
  fit();
  watch(box, fit);
  if (S.openKey) openWindow(S.openKey, d, { keepFocus: true });
}

// Re-fit when the box changes size (a size class change, the keyboard, fonts arriving, 3.5): one observer for the view.
function watch(box, fn) {
  S.ro?.disconnect();
  if (!window.ResizeObserver) return;
  let last = `${box.clientWidth}x${box.clientHeight}`;
  S.ro = new ResizeObserver(() => { const now = `${box.clientWidth}x${box.clientHeight}`; if (now !== last) { last = now; fn(); } });
  S.ro.observe(box);
  document.fonts?.ready?.then(() => { if (box.isConnected) fn(); });
}

function fitAchievements(root, d) {
  const grid = $(root, '.u3-ct__grid'), box = $(root, '.u3-ct__box'), pg = $(root, '.u3-ct__pager');
  if (!grid || !box) return;
  const bcs = getComputedStyle(box);
  const avail = box.clientHeight - px(bcs.paddingTop) - px(bcs.paddingBottom) - px(getComputedStyle(pg).height) - px(bcs.rowGap);
  // one pass: the tile height (the tallest of all tiles, A6), the columns and the rows that fit
  const pass = (tight) => {
    grid.classList.toggle('is-tight', tight);
    grid.style.removeProperty('--u3-ct-h');
    grid.innerHTML = d.achs.map((a) => achTileHTML(a, d)).join('');
    const gap = px(getComputedStyle(grid).rowGap);
    let h = 0;
    for (const t of grid.children) h = Math.max(h, t.getBoundingClientRect().height);
    h = Math.ceil(h);
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    const rows = rowsThatFit({ boxH: avail, rowH: h, gap });
    return { h, cols, rows, used: rows * h + (rows - 1) * gap };
  };
  let r = pass(false);
  // A blank band under the rows (more than a quarter of the box): the tight mode (tighter padding) may fit one more row.
  if (avail > 0 && r.used < avail * 0.75) { const t = pass(true); if (t.rows > r.rows) r = t; else r = pass(false); }
  grid.style.setProperty('--u3-ct-h', `${r.h}px`);
  const s = pageSlice(d.achs.length, r.rows * r.cols, S.page);
  S.page = s.page;
  grid.innerHTML = d.achs.slice(s.start, s.end).map((a) => achTileHTML(a, d)).join('');
  pg.innerHTML = pager({ page: s.page + 1, pages: s.pages });
  pg.classList.toggle('is-hidden', s.pages < 2);
}

async function doClaim(key, root, d) {
  S.busy.add(key); S.err.delete(key);
  fitAchievements(root, d);
  const r = await d.claim(key);
  S.busy.delete(key);
  if (r?.ok) return;           // the view repaints itself (ui-v2.js reloads the profile)
  S.err.add(key);
  if (root.isConnected) fitAchievements(root, d);
  if (S.openKey === key) openWindow(key, d, { keepFocus: true });
}
async function doClaimAll(root, d) {
  S.all = 'busy';
  paintHead(root, d);
  const r = await d.claimAll();
  if (r?.ok) { S.all = null; return; }
  S.all = 'error';
  if (root.isConnected) paintHead(root, d);
}
function paintHead(root, d) {
  const ready = d.achs.filter((a) => statusOf(a, d.claimed) === 'ready').length;
  const old = $(root, '.u3-ct__head');
  const help = old?.querySelector('.ex-q') || null;   // the "?" may sit in the sub-tab row (D-63): leave it there
  const tmp = document.createElement('div');
  tmp.innerHTML = headHTML({ ...d, help: '' }, ready);
  const head = tmp.firstElementChild;
  if (help && old.contains(help)) head.prepend(help);
  old.replaceWith(head);
}

// ---- The achievement window (A8, A9, A10) ---------------------------------------------------------------------

function cardTileHTML(c, i, d) {
  if (c.locked || !c.owned) {
    return `<li class="u3-ath__cell"><button type="button" class="u3-ath__card is-locked" data-i="${i}" aria-label="${esc(d.numLabel(c.num))}, not owned">`
      + `${icon('lock', { size: 'md' })}<span class="u3-ath__num">${esc(d.numLabel(c.num))}</span></button></li>`;
  }
  return `<li class="u3-ath__cell"><button type="button" class="u3-ath__card u3-r-${esc(c.rarity)}" data-i="${i}" aria-label="${esc(c.name)}">`
    + `${c.image_url ? `<img src="${esc(d.thumb(c.image_url))}" alt="" loading="lazy" draggable="false">` : ''}${d.flair ? d.flair(c.ascension) : ''}</button></li>`;
}

function windowHTML(a, d) {
  const st = statusOf(a, d.claimed);
  const pct = Math.min(1, a.need > 0 ? a.have / a.need : 0);
  const progress = a.done ? 'Complete' : `${fmtFor(a.have, sizeCls())} / ${fmtFor(a.need, sizeCls())}`;
  const claim = st === 'ready'
    ? button({ label: S.err.has(a.key) ? 'Try again' : 'Claim', busyLabel: 'Claiming…', variant: 'primary', size: 'sm', busy: S.busy.has(a.key), data: { claim: a.key } }) : '';
  const body = a.set
    ? '<div class="u3-ath__box"><ul class="u3-ath__grid" role="list"></ul><div class="u3-ath__pager"></div></div>'
    : `<div class="u3-ath__stat"><b>${fmtFor(a.have, sizeCls())}</b><span>of ${fmtFor(a.need, sizeCls())}</span></div>`;
  return `<div class="u3-ath" role="dialog" aria-modal="true" aria-labelledby="u3AthT">`
    + `<header class="u3-ath__head"><span class="u3-ath__ico" aria-hidden="true">${esc(a.icon)}</span><h2 class="u3-ath__title" id="u3AthT">${esc(a.name)}</h2>`
    + `${claim}${iconButton({ icon: 'x', label: 'Close', data: { 'ath-close': '1' } })}</header>`
    + `<p class="u3-ath__line">${esc(a.desc)} · ${esc(progress)} · ${icon('gift', { size: 'sm' })} ${esc(d.rewardText(a))}</p>`
    + `${progressLinear({ value: pct })}${body}</div>`;
}

let athKeyHandler = null;
function closeWindow(restore = true) {
  const key = S.openKey;
  document.getElementById('u3AthHost')?.remove();
  S.openKey = null; S.detailPage = 0;
  S.mo?.disconnect(); S.mo = null;
  if (athKeyHandler) { document.removeEventListener('keydown', athKeyHandler); athKeyHandler = null; }
  if (restore && key) document.querySelector(`[data-ach="${CSS.escape(key)}"]`)?.focus();
}

function openWindow(key, d, { keepFocus = false } = {}) {
  const a = d.achs.find((x) => x.key === key);
  if (!a) { closeWindow(false); return; }
  if (S.openKey !== key) S.detailPage = 0;
  S.openKey = key;
  let host = document.getElementById('u3AthHost');
  const fresh = !host;
  if (!host) {
    host = document.createElement('div');
    host.id = 'u3AthHost'; host.className = 'u3-athhost';
    document.body.appendChild(host);
    host.addEventListener('click', (e) => {
      const d = host._d;   // the newest data: the view repaints after a Claim
      if (e.target === host || e.target.closest('[data-ath-close]')) { closeWindow(); return; }
      const claim = e.target.closest('[data-claim]');
      if (claim) { if (!claim.disabled) doClaim(claim.dataset.claim, document.querySelector('.u3-ct--ach'), d); return; }
      const pg = e.target.closest('[data-page]');
      if (pg && !pg.disabled) { S.detailPage += pg.dataset.page === 'next' ? 1 : -1; fitWindowCards(host, d); return; }
      const card = e.target.closest('[data-i]');
      if (card) { const cur = d.achs.find((x) => x.key === S.openKey); const c = cur?.set?.[Number(card.dataset.i)]; if (c && c.owned && !c.locked) d.openCard(c, d.sortedSet(cur)); }
    });
    athKeyHandler = (e) => { if (e.key === 'Escape' && !document.getElementById('viewer')?.classList.contains('open')) closeWindow(); };
    document.addEventListener('keydown', athKeyHandler);
  }
  host._ro?.disconnect(); host._ro = null;
  host.innerHTML = windowHTML(a, d);
  host._d = d;
  if (a.set) fitWindowCards(host, d);
  if (fresh || !keepFocus) host.querySelector('[data-ath-close]')?.focus();
  // The window belongs to the Collection view: it closes when another view paints (a dock tap while the sheet is open).
  S.mo?.disconnect();
  const main = document.getElementById('main');
  if (main && window.MutationObserver) {
    S.mo = new MutationObserver(() => { if (!main.querySelector('.u3-ct--ach')) closeWindow(false); });
    S.mo.observe(main, { childList: true });
  }
}

function fitWindowCards(host, d) {
  const a = d.achs.find((x) => x.key === S.openKey);
  const grid = $(host, '.u3-ath__grid'), box = $(host, '.u3-ath__box'), pg = $(host, '.u3-ath__pager');
  if (!a?.set || !grid || !box) return;
  const items = d.sortedSet(a);
  // one probe tile gives the column count and the tile height (the tiles are 5:7 and fill the column)
  grid.innerHTML = cardTileHTML(items[0] || { locked: true, num: 0 }, 0, d);
  const cs = getComputedStyle(grid);
  const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length);
  const gap = px(cs.rowGap);
  const cellH = grid.firstElementChild.getBoundingClientRect().height;
  const avail = box.clientHeight - px(getComputedStyle(pg).height) - px(getComputedStyle(box).rowGap);
  const per = rowsThatFit({ boxH: avail, rowH: cellH, gap }) * cols;
  const s = pageSlice(items.length, per, S.detailPage);
  S.detailPage = s.page;
  grid.innerHTML = items.slice(s.start, s.end).map((c, i) => cardTileHTML(c, s.start + i, d)).join('');
  pg.innerHTML = pager({ page: s.page + 1, pages: s.pages });
  pg.classList.toggle('is-hidden', s.pages < 2);
  if (!host._ro && window.ResizeObserver) {
    let last = `${box.clientWidth}x${box.clientHeight}`;
    host._ro = new ResizeObserver(() => { const now = `${box.clientWidth}x${box.clientHeight}`; if (now !== last) { last = now; fitWindowCards(host, host._d); } });
    host._ro.observe(box);
  }
}

// ---- Bosses ---------------------------------------------------------------------------------------------------

/** One boss tile (B6, B7): the picture, the name inside at the bottom (wraps to 2 lines, never cut). */
export function bossTileHTML(b, i) {
  return `<li class="u3-bt"><button type="button" class="u3-bt__btn" data-bi="${i}"><img class="u3-bt__img" src="${esc(b.thumb)}" alt="" loading="lazy" draggable="false">`
    + `<span class="u3-bt__name">${esc(b.title)}</span></button></li>`;
}

/** Paint the Bosses tab into main. d: { tabBar, help, bosses: [{arch,title,blurb,credit,thumb}], mount(canvas, boss), dispose() } */
export function paintBossesV3(main, d) {
  if (S.bossOpen != null) closeBoss(d, false);   // a repaint frees the 3D scene of the old window
  if (S.openKey) closeWindow(false);
  main.innerHTML = `${d.tabBar}<section class="u3-ct u3-ct--boss" aria-label="Bosses"><div class="u3-ct__head">${d.help || ''}</div>`
    + `<div class="u3-ct__box"><ul class="u3-bg" role="list">${d.bosses.map((b, i) => bossTileHTML(b, i)).join('')}</ul></div></section>`;
  const root = $(main, '.u3-ct');
  const box = $(root, '.u3-ct__box'), grid = $(root, '.u3-bg');
  const fit = () => {
    const g = bossGrid(d.bosses.length, box.clientWidth, box.clientHeight, sizeCls());
    grid.style.setProperty('--u3-cols', g.cols); grid.style.setProperty('--u3-rows', g.rows);
  };
  fit();
  watch(box, fit);
  root.addEventListener('click', (e) => { const t = e.target.closest('[data-bi]'); if (t) openBoss(Number(t.dataset.bi), d, t); });
  S.mo?.disconnect();
}

function closeBoss(d, restore = true) {
  const i = S.bossOpen;
  document.getElementById('u3BossHost')?.remove();
  S.bossOpen = null;
  try { d.dispose(); } catch { /* ignore */ }
  S.mo?.disconnect(); S.mo = null;
  if (athKeyHandler) { document.removeEventListener('keydown', athKeyHandler); athKeyHandler = null; }
  if (restore && i != null) document.querySelector(`[data-bi="${i}"]`)?.focus();
}

function openBoss(i, d, opener) {
  const b = d.bosses[i];
  if (!b) return;
  closeBoss(d, false);
  S.bossOpen = i;
  const host = document.createElement('div');
  host.id = 'u3BossHost'; host.className = 'u3-cbwhost';
  host.innerHTML = `<div class="u3-cbw" role="dialog" aria-modal="true" aria-labelledby="u3CbwT">`
    + `<div class="u3-cbw__top">${iconButton({ icon: 'x', label: 'Close', data: { 'bw-close': '1' } })}</div>`
    + `<div class="u3-cbw__stage"><canvas id="u3BossCanvas" aria-label="${esc(b.title)}"></canvas></div>`
    + `<div class="u3-cbw__info"><span class="u3-label">Boss</span><h2 class="u3-cbw__name" id="u3CbwT">${esc(b.title)}</h2>`
    + `<p class="u3-cbw__lore">${esc(b.blurb || '')}</p>${b.credit ? `<p class="u3-cbw__credit">${esc(bossCredit(b.credit))}</p>` : ''}</div></div>`;
  document.body.appendChild(host);
  host.addEventListener('click', (e) => { if (e.target === host || e.target.closest('[data-bw-close]')) closeBoss(d); });
  athKeyHandler = (e) => { if (e.key === 'Escape') closeBoss(d); };
  document.addEventListener('keydown', athKeyHandler);
  host.querySelector('[data-bw-close]')?.focus();
  try { d.mount($(host, '#u3BossCanvas'), b); } catch { /* the picture stays empty: the text still shows */ }
  // The window belongs to the Collection view: it closes (and frees the 3D scene) when another view paints.
  const main = document.getElementById('main');
  if (main && window.MutationObserver) {
    S.mo = new MutationObserver(() => { if (!main.querySelector('.u3-ct--boss')) closeBoss(d, false); });
    S.mo.observe(main, { childList: true });
  }
  void opener;
}

/** Close both windows (a view change or a repaint that must not keep one). */
export function closeCollectionWindows(d) {
  if (document.getElementById('u3AthHost')) closeWindow(false);
  if (document.getElementById('u3BossHost') && d) closeBoss(d, false);
}
