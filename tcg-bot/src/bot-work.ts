import { getSupabase } from './supabase.js';

// One small question for the bot timers (Nathan, 2026-10-02: Supabase Log Ingestion over quota).
// Each REST request is one log line, and the timers asked 4-7 questions every 10-15 s with nothing
// to do (~47,000 lines a day). bot_work() (bot_work.sql) answers for all of them; the answer is
// shared for TTL_MS, so the timers together make about one call per 10 s. A timer runs its full
// queries only when its part has work. If the call fails, every part says "work" (the old way).

export type Work = { fx: boolean; plays: boolean; events: boolean; auctions: boolean };
type Ask = () => Promise<{ data: unknown; error: unknown }>;

const ALL: Work = { fx: true, plays: true, events: true, auctions: true };
export const TTL_MS = 9_000;

/** A shared, cached reader. `ask` and `now` are injectable for the tests. */
export function makeBotWork(ask: Ask, now: () => number = Date.now) {
  let at = -Infinity;
  let last: Work = ALL;
  let pending: Promise<Work> | null = null;
  return function botWork(): Promise<Work> {
    if (now() - at < TTL_MS) return Promise.resolve(last);
    if (pending) return pending;
    pending = (async () => {
      try {
        const { data, error } = await ask();
        const d = data as Partial<Record<keyof Work, unknown>> | null;
        last = error || !d || typeof d !== 'object' ? ALL
          : { fx: d.fx !== false, plays: d.plays !== false, events: d.events !== false, auctions: d.auctions !== false };
      } catch {
        last = ALL;
      }
      at = now();
      pending = null;
      return last;
    })();
    return pending;
  };
}

export const botWork = makeBotWork(async () => getSupabase().rpc('bot_work'));
