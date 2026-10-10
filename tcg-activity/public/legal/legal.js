// UI-57 the scroll cue of the legal pages (3.3, D-07): the thumb of the rail for the named scroll area "legal text".
// Same rule as the FAQ window (src/ui3/help.js thumbMetrics). Pure part exported for node tests (src/ui3/legal.test.js).
const MIN_THUMB = 0.12;   // the shortest thumb, as a share of the rail

/** show = the text overflows; top and height are percent of the rail. */
export function thumbMetrics({ scrollTop, clientHeight, scrollHeight }) {
  if (!(scrollHeight > clientHeight + 1) || !(clientHeight > 0)) return { show: false, top: 0, height: 100 };
  const height = Math.min(100, Math.max(MIN_THUMB, clientHeight / scrollHeight) * 100);
  const room = scrollHeight - clientHeight;
  const share = Math.min(1, Math.max(0, scrollTop / room));
  return { show: true, top: share * (100 - height), height };
}

function sync(text, rail) {
  const m = thumbMetrics(text);
  rail.hidden = !m.show;
  rail.style.setProperty('--lg-thumb-top', `${m.top}%`);
  rail.style.setProperty('--lg-thumb-h', `${m.height}%`);
}

if (typeof document !== 'undefined') {
  const text = document.querySelector('.lg__text'), rail = document.querySelector('.lg__rail');
  if (text && rail) {
    const go = () => sync(text, rail);
    text.addEventListener('scroll', go, { passive: true });
    new ResizeObserver(go).observe(text);
    document.fonts?.ready.then(go);
    go();
  }
}
