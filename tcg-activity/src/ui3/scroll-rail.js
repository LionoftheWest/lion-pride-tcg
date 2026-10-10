// The scroll cue of a named scroll area (docs/design.md 3.3, D-07): a rail with a thumb. Shared by the FAQ list
// (help.js, UI-38) and the bell list (bell.js, UI-24, D-144). Pure metrics + one sync call.
const MIN_THUMB = 0.12;   // the shortest thumb, as a share of the rail (a very long list keeps a thumb that can be seen)

/** Pure: show = the list overflows; top and height are percent of the rail. The thumb is as long as the visible share
 *  of the list and moves with scrollTop. */
export function thumbMetrics({ scrollTop, clientHeight, scrollHeight }) {
  if (!(scrollHeight > clientHeight + 1) || !(clientHeight > 0)) return { show: false, top: 0, height: 100 };
  const height = Math.min(100, Math.max(MIN_THUMB, clientHeight / scrollHeight) * 100);
  const room = scrollHeight - clientHeight;
  const share = Math.min(1, Math.max(0, scrollTop / room));
  return { show: true, top: share * (100 - height), height };
}

/** Put the rail in line with its list. topVar / heightVar = the CSS custom properties that the rail CSS reads. */
export function syncRailEls(list, rail, topVar, heightVar) {
  if (!list || !rail) return;
  const m = thumbMetrics(list);
  rail.hidden = !m.show;
  rail.style.setProperty(topVar, `${m.top}%`);
  rail.style.setProperty(heightVar, `${m.height}%`);
}

/** Keep the rail of an area in line with its list on scroll and on every size change of the list. Returns a stop
 *  function (the caller keeps the last one and calls it before the next repaint). */
export function watchRail(list, rail, topVar, heightVar) {
  const sync = () => syncRailEls(list, rail, topVar, heightVar);
  list.addEventListener('scroll', sync, { passive: true });
  let obs = null;
  if (typeof ResizeObserver !== 'undefined') { obs = new ResizeObserver(sync); obs.observe(list); }
  sync();
  return () => { list.removeEventListener('scroll', sync); obs?.disconnect(); };
}
