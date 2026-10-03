// The outbox drains (hunt_events, card_plays): a row is marked posted only when the post went
// out. A failed post stays unposted and is retried on the next poll, but only for GIVE_UP_MS:
// a row that keeps failing (a missing channel, a lost permission) must not retry for ever.
// The tables have created_at and no attempt counter, so the age is the limit (bot audit, 2026-10-03).
export const GIVE_UP_MS = 60 * 60 * 1000;

/** Set posted_at now? Yes when the post went out, or when the row is too old to retry. */
export function outboxDone(posted: boolean, createdAt: string | null | undefined, now = Date.now()): boolean {
  if (posted) return true;
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return !Number.isFinite(at) || now - at >= GIVE_UP_MS; // no usable time: do not retry for ever
}
