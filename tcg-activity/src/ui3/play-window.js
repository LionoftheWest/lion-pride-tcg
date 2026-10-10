// UI-28: the DOM side of the play flow (body.ui-v3 only): the confirm window, the small notice dialog, the toast, and the
// incoming banners. The HTML and the rules are in effects.js (unit-tested). Approved: design repo UI-28/approved.
import { confirmHTML, noticeHTML, bannerHTML, BANNERS_MAX } from './effects.js';
import { toast } from './components.js';

let win = null;   // the open confirm window: { o, onPlay, choice, msg, busy, back }
let note = null;  // the open notice dialog: { onClose, back }

// ---- the confirm window ----
function host() {
  let h = document.getElementById('u3FxWin');
  if (!h) { h = document.createElement('div'); h.id = 'u3FxWin'; document.body.appendChild(h); h.addEventListener('click', onWinClick); }
  return h;
}

function paintWin() {
  if (!win) return;
  host().innerHTML = confirmHTML({ ...win.o, choice: win.choice, msg: win.msg, busy: win.busy });
}

/**
 * Open the confirm window over whatever is open (the Card picker stays under it).
 * o: the fields of confirmHTML (kind, title, desc, imgSrc, rarity, chips, whoHTML, toName, active, polls, used, cap).
 * onPlay(choice) -> { ok, error }: the play (a poll card gets the index of the picked question). ok closes the window.
 * opts.onClose: runs when the window closes without a play (Back, the close button, Escape).
 */
export function openPlayWindow(o, onPlay, opts = {}) {
  closePlayWindow();
  win = { o, onPlay, opts, choice: null, msg: '', busy: false, back: document.activeElement };
  paintWin();
  document.addEventListener('keydown', onWinKey, true);
  host().querySelector('.u3-fxw')?.focus({ preventScroll: true });   // the window takes the focus (no ring on a button before a keyboard moves it)
}

export function closePlayWindow() {
  if (!win) return;
  document.getElementById('u3FxWin')?.remove();
  document.removeEventListener('keydown', onWinKey, true);
  const back = win.back;
  win = null;
  back?.focus?.({ preventScroll: true });
}

function onWinKey(e) {
  if (!win || e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();   // the Card picker under the window keeps its place
  if (!win.busy) { const cb = win.opts.onClose; closePlayWindow(); cb?.(); }
}

async function onWinClick(e) {
  if (!win) return;
  const t = e.target.closest('button, [data-u3-scrim]');
  if (!t) return;
  if (t.matches('[data-u3-scrim]')) { if (e.target === t && !win.busy) { const cb = win.opts.onClose; closePlayWindow(); cb?.(); } return; }
  const d = t.dataset;
  if (d.fxclose != null || d.fxback != null) { if (!win.busy) { const cb = win.opts.onClose; closePlayWindow(); cb?.(); } return; }
  if (d.fxq != null) { win.choice = Number(d.fxq); win.msg = ''; paintWin(); host().querySelector('[data-fxplay]')?.focus({ preventScroll: true }); return; }
  if (d.fxplay != null) {
    if (win.busy) return;
    win.busy = true; win.msg = ''; paintWin();
    let r = null;
    try { r = await win.onPlay(win.choice); } catch { r = { ok: false }; }
    if (!win) return;
    win.busy = false;
    if (r?.ok) { closePlayWindow(); return; }
    win.msg = r?.message || 'That did not work. Try again.';
    paintWin();
    host().querySelector('[data-fxplay]')?.focus({ preventScroll: true });
  }
}

// ---- the notice dialog (owner block, refund) ----
export function openNotice({ title, line }, onClose) {
  closeNotice();
  note = { onClose, back: document.activeElement };
  const h = document.createElement('div');
  h.id = 'u3FxNote';
  h.innerHTML = noticeHTML({ title, line });
  document.body.appendChild(h);
  h.addEventListener('click', (e) => { const t = e.target.closest('[data-fxok], [data-u3-scrim]'); if (t && (t.dataset.fxok != null || e.target === t)) closeNotice(true); });
  document.addEventListener('keydown', onNoteKey, true);
  h.querySelector('.u3-fxn')?.focus({ preventScroll: true });
}
function onNoteKey(e) { if (note && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNotice(true); } }
export function closeNotice(run = false) {
  if (!note) return;
  document.getElementById('u3FxNote')?.remove();
  document.removeEventListener('keydown', onNoteKey, true);
  const { onClose, back } = note;
  note = null;
  if (run) onClose?.();
  back?.focus?.({ preventScroll: true });
}

// ---- the toast (7.3): above the dock, centered, 4 seconds ----
let toastTimer = null;
export function playToast(kind, text) {
  document.getElementById('u3FxToast')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="u3FxToast" class="u3-fx-toast">${toast({ kind, text })}</div>`);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => document.getElementById('u3FxToast')?.remove(), 4000);
}

// ---- the incoming banners (5.2 Banner): under the top bar, at most BANNERS_MAX at once, the rest wait ----
const queue = [];   // { b, id, extra, ms, wire }
let seq = 0;
function bannerHost() {
  let h = document.getElementById('u3FxBanners');
  if (!h) {
    h = document.createElement('div'); h.id = 'u3FxBanners'; h.className = 'u3-fxb-host';
    document.body.appendChild(h);
    h.addEventListener('click', (e) => { const x = e.target.closest('[data-fxbclose]'); if (x) dropBanner(x.dataset.fxbclose); });
  }
  return h;
}
function dropBanner(id) {
  const h = document.getElementById('u3FxBanners');
  h?.querySelector(`[data-fxb="${id}"]`)?.remove();
  fillBanners();
  if (h && !h.children.length && !queue.length) h.remove();
}
function fillBanners() {
  const h = bannerHost();
  while (h.children.length < BANNERS_MAX && queue.length) {
    const q = queue.shift();
    h.insertAdjacentHTML('beforeend', bannerHTML(q.b, { id: q.id, extra: q.extra }));
    const el = h.lastElementChild;
    q.wire?.(el);
    if (q.ms) setTimeout(() => dropBanner(q.id), q.ms);
  }
}
/** Show an incoming banner. b: bannerOf(p) + imgSrc. extra: more HTML under the text (the name color row). ms: 0 = stays until closed. */
export function pushBanner(b, { extra = '', ms = 12000, wire = null } = {}) {
  seq += 1;
  queue.push({ b, id: `b${seq}`, extra, ms, wire });
  fillBanners();
  return `b${seq}`;
}
export { dropBanner };
