// UI-05 / UI-60 the daily Events Dot (D-198): the first visit of each day (America/Denver day) shows the red Dot on the Menu Events tile,
// on the Menu button and on the Events slide control, until the player opens the Events page or an event slide. The "seen" day is kept in
// localStorage (no server change). Only with the flag on and at least one live event (Home reports the count with setEventsLive).
export const SEEN_KEY = 'lp.events.seen';
export const DOT_EVENT = 'u3-events-dot';

/** The Denver calendar day of a time: "2026-10-14". */
export const denverDay = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

let live = 0;       // live events known by Home (0 = flag off or none live)
let memSeen = null; // the seen day when storage is off

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** The player opened the Events page or an event slide today. */
export function seenToday(now = Date.now(), s = store()) {
  const day = denverDay(now);
  if (memSeen === day) return true;
  try { return s?.getItem(SEEN_KEY) === day; } catch { return false; }
}
/** Home reports how many events are live (0 when the flag is off). Tells the Menu to repaint its Dots. */
export function setEventsLive(n) {
  const next = Math.max(0, n | 0);
  if (next === live) return;
  live = next;
  globalThis.document?.dispatchEvent?.(new Event(DOT_EVENT));
}
/** The Dot shows: a live event and not seen today. */
export const eventsDotOn = (now = Date.now(), s = store()) => live > 0 && !seenToday(now, s);
/** The player opened the Events page or an event slide: the Dot goes for today. */
export function markEventsSeen(now = Date.now(), s = store()) {
  const was = eventsDotOn(now, s);
  const day = denverDay(now);
  memSeen = day;
  try { s?.setItem(SEEN_KEY, day); } catch { /* storage off: the memory copy holds for this visit */ }
  if (was) globalThis.document?.dispatchEvent?.(new Event(DOT_EVENT));
}
/** Test hook. */
export function resetEventsDot() { live = 0; memSeen = null; }
