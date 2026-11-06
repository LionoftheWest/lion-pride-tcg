// HUNT-FALSE-DOWN (Nathan, 2026-11-06: "my squad was down on the hunt even though it wasn't").
// A live v2 day writes one hunt_card_hp bridge row per squad card with downed = true at FULL HP (hunt_v2_start,
// combat_v2_on_hunt.sql), so the v1 readers count the day. /api/hunt then shows all 8 cards downed, and squadDown()
// (squad-pick.js) says "down". Only the v2 answer (/api/hunt/v2/view) knows the real day. This module decides when the
// Hunt view must wait for the v2 answer instead of reading the bridge rows as a v1 squad. Pure: the server and the client use it.

// The server flag (/api/hunt v2day) from the hunt_v2_days read: true (a live v2 day of today), false (none),
// null (unknown: the read failed or timed out). Review r1 M2: an error never gives false.
export function v2DayFlag(q) {
  if (!q || q.error || !Array.isArray(q.data)) return null;
  return q.data.length > 0;
}

// What the Hunt view does with the v1 answer d, the v2 answer v and the v2 failure err ({ status, error } or null):
//   'v2'     the v2 answer has today's day row: it decides the screen (the fight, or the day over)
//   'v1'     no live v2 day, or a permanent refusal (401/403: not_tester, off, the flag OFF; review r1 H1): the v1 rules
//   'reload' the v2 answer has no day row but d says a v2 day: d is from an earlier day (the MT midnight, review r1 L1)
//   'wait'   a live v2 day (or unknown) and the v2 answer failed for a transient reason (network, 500, 409 busy)
export function huntV2Step(d, v, err) {
  if (v?.ok && v.day) return 'v2';
  if (v?.ok) return d?.v2day === true ? 'reload' : 'v1';
  if (err && (err.status === 401 || err.status === 403)) return 'v1';
  if (d?.v2day === true || d?.v2day === null) return 'wait';
  return 'v1';
}

// The re-reads of a waiting view (review r1 M1): a backoff (3 s, 6 s, 12 s), then it stops ('stopped': the view shows the
// Retry state and makes no more automatic calls). One chain only: wait() does nothing while a timer or a request is in flight.
// load() reads the answers again; paint() repaints (and calls wait() again when it still waits). reset(): a success or Retry.
export const V2_WAIT_DELAYS = [3000, 6000, 12000];
export function v2Waiter({ load, paint, delays = V2_WAIT_DELAYS, timer = setTimeout }) {
  let tries = 0; let busy = false;
  const w = {
    get stopped() { return tries >= delays.length && !busy; },
    wait() {
      if (busy || tries >= delays.length) return;
      busy = true;
      timer(async () => {
        try { await load(); } catch { /* the next paint decides */ }
        tries += 1; busy = false;
        paint();
      }, delays[tries]);
    },
    reset() { if (!busy) tries = 0; },
  };
  return w;
}
