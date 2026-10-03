// Background refreshes (badges, the bell, packs, effects, dailies) - Nathan, 2026-10-02: the
// Supabase Log Ingestion was over the Free quota, and an Activity left open kept asking all night
// (each refresh is several Supabase requests = log lines; 2-7 AM MT still had ~30 a minute).
// The rule: nothing while the window is hidden; at most every 5 minutes after 10 minutes with no
// input; everything at once when the member comes back (a tap, a key, the window shown again).

export const IDLE_MS = 10 * 60_000;
export const IDLE_EVERY_MS = 5 * 60_000;

/** A scheduler with injectable clock and visibility (for the tests). */
export function makePoller({ now = () => Date.now(), hidden = () => false } = {}) {
  const jobs = [];
  let lastInput = now();
  const isIdle = () => now() - lastInput > IDLE_MS;
  return {
    jobs,
    isIdle,
    /** Run fn every ms while the window is shown (slower when idle). */
    every(ms, fn) { jobs.push({ ms, fn, last: now() }); },
    /** One step of the 1 s clock: run the jobs that are due. */
    tick() {
      if (hidden()) return 0;
      const t = now(), slow = isIdle() ? IDLE_EVERY_MS : 0;
      let ran = 0;
      for (const j of jobs) {
        if (t - j.last < Math.max(j.ms, slow)) continue;
        j.last = t; ran += 1;
        try { const r = j.fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* a failed refresh waits for the next one */ }
      }
      return ran;
    },
    /** A tap or a key: the member is here. After an idle spell, refresh everything now. */
    input() { const was = isIdle(); lastInput = now(); if (was) this.wake(); },
    /** Make every job due on the next tick. */
    wake() { for (const j of jobs) j.last = -Infinity; },
  };
}

// The page's poller (browser only).
export const poller = makePoller({ hidden: () => typeof document !== 'undefined' && document.hidden });
export const every = (ms, fn) => poller.every(ms, fn);
export const isIdle = () => poller.isIdle();
if (typeof window !== 'undefined') {
  setInterval(() => poller.tick(), 1000);
  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(e, () => poller.input(), { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poller.wake(); });
}
