// The size class (docs/design.md 2.1): ONE module computes it from the usable frame (the Activity frame minus the safe
// areas) and writes it on <body>. CSS reads body[data-size] and body[data-short]; screen CSS uses no raw width or height
// media query (G-009, G-021). The input comes from (pointer: coarse), never from the size (G-008).
// v3 only: it runs when the ui-v3 flag is on (body.ui-v3), so the live screens do not change.

// The rules in their order (2.1): the first match sets the class. Widths and heights in CSS px.
export function sizeClass(width, height) {
  if (height < 300 || width < 360) return 'tiny';
  if (height < 500 && width > height) return 'compact-land';
  if (width < 600) return 'compact-port';
  if (width < 1200) return 'medium';
  return 'expanded';
}
/** The modifier "short": medium and expanded below 700 px usable height. */
export const isShort = (cls, height) => (cls === 'medium' || cls === 'expanded') && height < 700;

/** The usable frame: the viewport minus the Discord safe-area insets (the CSS variables Discord sets). */
export function usableFrame(win = globalThis.window) {
  const css = win.getComputedStyle(win.document.documentElement);
  const inset = (side) => parseFloat(css.getPropertyValue(`--discord-safe-area-inset-${side}`)) || 0;
  return {
    width: Math.max(0, win.innerWidth - inset('left') - inset('right')),
    height: Math.max(0, win.innerHeight - inset('top') - inset('bottom')),
  };
}

/** A text box has the focus: on touch, the keyboard is open. */
export const typing = (doc) => { const a = doc.activeElement;
  return !!a && (a.tagName === 'TEXTAREA' || a.isContentEditable || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'submit', 'reset', 'file', 'color'].includes(a.type))); };
let held = null;   // the frame before the keyboard opened

/** Write the class, the short modifier and the input on <body>. Returns the class.
 *  While the keyboard is open, the class stays the class of the frame before it (2.3, G-015): the keyboard makes the
 *  frame short, and a class change would rebuild the layout and close the keyboard (Mr. Mobs, 2026-10-01). */
export function applySizeClass(win = globalThis.window) {
  const frame = usableFrame(win);
  const coarse = win.matchMedia('(pointer: coarse)').matches;
  const kb = coarse && !!held && typing(win.document) && frame.width === held.width && frame.height < held.height;
  if (!kb) held = frame;
  const { width, height } = held;
  const cls = sizeClass(width, height);
  const body = win.document.body;
  if (kb) body.dataset.kb = ''; else delete body.dataset.kb;
  body.dataset.size = cls;
  if (isShort(cls, height)) body.dataset.short = ''; else delete body.dataset.short;
  body.dataset.input = win.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine';
  return cls;
}

/** Keep the class current: one debounced observer (G-010: re-fit within 200 ms). Returns a stop function. */
export function watchSizeClass(win = globalThis.window, onChange = () => {}) {
  let t = null;
  let last = applySizeClass(win);
  const run = () => { t = null; const cls = applySizeClass(win); if (cls !== last) { last = cls; onChange(cls); } };
  const later = () => { if (t) win.clearTimeout(t); t = win.setTimeout(run, 120); };
  win.addEventListener('resize', later);
  win.document.addEventListener('focusout', later);   // the keyboard closed: the held class can end
  const mq = win.matchMedia('(pointer: coarse)');
  mq.addEventListener?.('change', later);
  return () => { win.removeEventListener('resize', later); win.document.removeEventListener('focusout', later); mq.removeEventListener?.('change', later); if (t) win.clearTimeout(t); };
}
