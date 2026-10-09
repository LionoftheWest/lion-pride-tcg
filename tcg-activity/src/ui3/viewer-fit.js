// UI-64 fix (Nathan 2026-10-08): the card details (the v2 #viewer, opened from the Card picker) fit the safe frame in v3.
// The CSS (public/ui3/90-ui-09-viewer-fit.css) lays the card and its info out in two modes: "row" (the card at the left, the info
// in two columns) and "col" (the card beside the name, the stats, the ability and the tags under it). This module picks the mode
// from the box of the viewer itself, then makes the card as large as the frame allows: it starts at the largest width and takes a
// step off while the content still overflows the frame (a second column, or a lower edge, outside it). Nothing is hidden.
import { TOKENS } from '../tokens.js';

/** "row" when the viewer is wider than it is tall, else "col". Pure. */
export const modeOf = (width, height) => (width > height ? 'row' : 'col');

/** The widest card: row = the frame height at the card ratio (and at most the share of the width), col = the share of the width. Pure. */
export function maxCardWidth(mode, width, height, ratio = TOKENS['card-ratio'], cap = Infinity) {
  if (mode === 'row') return Math.floor(Math.min(height / ratio, width * 0.46, cap));
  return Math.floor(Math.min(width * 0.42, height / ratio / 1.6, cap));
}

/** The next card width after one that overflowed, or null at the smallest card. Pure. */
export function stepDown(w, min = TOKENS['card-squad'], step = TOKENS['sp-2']) {
  if (w <= min) return null;
  return Math.max(min, w - step);
}

// A box overflows when its content is wider or taller than it (scroll size > client size). The frame, the info, and each box of the
// info are checked: a wide stat row inside a half-width column overflows its own box and lies over the next column.
const over = (e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1;
const overflows = (v) => over(v) || [...v.querySelectorAll('.viewer-win, .viewer-info, .vi-main, .vi-side, .vi-main > *, .vi-side > *, .viewer-info .vr-stats')].some((e) => e.offsetParent && over(e));

/** Fit the open viewer. Returns { mode, w, fits } (for the tests and the probes). */
export function fitViewer(v = document.getElementById('viewer')) {
  if (!v || v.classList.contains('hidden') || !document.body.classList.contains('ui-v3')) return null;
  v.dataset.vmode = modeOf(v.clientWidth, v.clientHeight);   // the mode first: the padding (the corner zone) depends on it
  const mode = v.dataset.vmode;
  v.style.removeProperty('--vf-card-w');
  v.classList.remove('is-tight');
  const cs = getComputedStyle(v);
  const win = v.querySelector('.viewer-win');
  const wcs = win && v.classList.contains('raid-info') ? getComputedStyle(win) : null;   // the padding and the border of the window itself
  const wx = wcs ? parseFloat(wcs.paddingLeft) + parseFloat(wcs.paddingRight) + 2 * parseFloat(wcs.borderLeftWidth) : 0;
  const wy = wcs ? parseFloat(wcs.paddingTop) + parseFloat(wcs.paddingBottom) + 2 * parseFloat(wcs.borderTopWidth) : 0;
  const W = v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - wx;
  const H = v.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - wy;
  if (!v.classList.contains('raid-info')) return { mode, w: 0, fits: true };   // the card alone: the CSS sizes it
  // a phone shows the card as large as the frame allows (the frames: 165 px in portrait); a tablet or a desktop window shows about 160 px (D-131)
  const cap = document.body.dataset.size?.startsWith('compact') ? Infinity : Math.round(TOKENS['sheet-side-w'] * 0.42);
  let w = maxCardWidth(mode, W, H, TOKENS['card-ratio'], cap);
  let fits = false;
  // first the normal layout with a card that gets smaller; when that cannot fit (a landscape phone with the safe area),
  // the tight layout (is-tight: the stats 2 x 2, smaller gaps), then the smallest card. Nothing is hidden.
  for (const tight of [false, true]) {
    v.classList.toggle('is-tight', tight);
    for (let x = tight ? Math.min(w, TOKENS['card-squad']) : w; x; x = stepDown(x, tight ? TOKENS['card-mini'] : TOKENS['card-squad'])) {
      w = x;
      v.style.setProperty('--vf-card-w', `${w}px`);
      if (!overflows(v)) { fits = true; break; }
    }
    if (fits || mode !== 'row') break;
  }
  if (!fits) { w = TOKENS['card-mini']; v.style.setProperty('--vf-card-w', `${w}px`); }
  return { mode, w, fits, tight: v.classList.contains('is-tight') };
}

let watching = false;
/** Fit again when the window changes (a resize, the fonts), once the viewer is open. */
export function watchViewerFit() {
  if (watching) return;
  watching = true;
  let rt = 0;
  const again = () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => fitViewer()); };
  addEventListener('resize', again);
  document.fonts?.ready?.then(again);
}
