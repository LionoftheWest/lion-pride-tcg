// UI-08: the Card Detail window fits the safe frame (no scroll, nothing cut: 3.3). The CSS (public/ui3/90-ui-08.css) lays the window out
// as a dialog (two columns) or a sheet (one column) from body[data-size]. This module measures the window itself: it starts with the
// normal card width, takes a step off while the content overflows its box, then switches to the tight layout (is-tight: smaller gaps and
// stat boxes) and steps again. Nothing is hidden. The same pattern as src/ui3/viewer-fit.js.
import { TOKENS } from '../tokens.js';
import { stepDown } from './viewer-fit.js';

/** The card widths to try, largest first, ending at min. Pure. */
export function widthSteps(max, min = TOKENS['card-mini'], step = TOKENS['sp-2']) {
  const out = [];
  for (let w = max; w; w = stepDown(w, min, step)) out.push(w);
  return out;
}

// The window overflows when its content is taller or wider than it, or when a visible block lies outside its box (a stat row that is wider
// than its column). The touch hit area of a small control (an absolute ::after) is not content: blocks are measured by their own boxes.
const overflows = (w) => {
  if (w.scrollHeight > w.clientHeight + 1 || w.scrollWidth > w.clientWidth + 1) return true;
  const box = w.getBoundingClientRect();
  return [...w.querySelectorAll('.u3-det__main > *, .u3-det__side > *, .u3-det__main > * > *')].some((e) => {
    if (!e.offsetParent) return false;
    const r = e.getBoundingClientRect();
    return r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1;
  });
};

// The content arrives late (the effect section, the convert button): the window is fitted again after each change of its content.
const watched = new WeakSet();
function observe(win) {
  if (watched.has(win)) return;
  watched.add(win);
  let rt = 0;
  new MutationObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => fitDetail(win)); }).observe(win, { childList: true, subtree: true });
}

/** Fit the open window. Returns { w, fits, tight } (for the tests and the probes). */
export function fitDetail(win = document.getElementById('u3DetWin')) {
  if (!win || !win.isConnected || win.closest('.hidden') || !document.body.classList.contains('ui-v3')) return null;
  observe(win);
  win.classList.toggle('is-narrow', win.clientWidth < TOKENS['sheet-side-w'] * 2.1 && !document.body.dataset.size?.startsWith('compact'));   // a dialog narrower than two columns of the side width
  win.style.removeProperty('--det-art-w');
  win.classList.remove('is-tight', 'is-over');
  const max = Math.round(parseFloat(getComputedStyle(win).getPropertyValue('--det-art-max')) || TOKENS['card-squad'] * 2);
  const steps = widthSteps(max);
  for (const tight of [false, true]) {
    win.classList.toggle('is-tight', tight);
    for (const w of steps) {
      win.style.setProperty('--det-art-w', `${w}px`);
      if (!overflows(win)) return { w, fits: true, tight };
    }
  }
  win.style.setProperty('--det-art-w', `${steps[steps.length - 1]}px`);
  win.classList.add('is-over');   // a window that cannot fit even the tight layout scrolls instead of cutting the lower blocks (reported, not hidden)
  return { w: steps[steps.length - 1], fits: false, tight: true };
}

let watching = false;
/** Fit again when the window size changes or the fonts arrive, once the window exists. */
export function watchDetailFit() {
  if (watching) return;
  watching = true;
  let rt = 0;
  const again = () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => fitDetail()); };
  addEventListener('resize', again);
  document.fonts?.ready?.then(again);
}
