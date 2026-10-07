// The balance table (tcg-bot/supabase/balance_table.sql + balance_economy.sql): every number that changes card power
// or a reward lives in public.balance. The bot reads the keys it needs through ONE cache (60 s), the same rule as the
// Activity (tcg-activity/balance.js):
//   pulls                 the pull rates and the pack size (draw.ts)
//   daily                 chat_bonus_at: the message count of the chat bonus pack (store.ts, first-pack.ts)
//   pack_earn_multiplier  the earn dial (store.ts; /packrate sets it)
//   hunt_prizes           the Raid prizes the result post lists (hunt-notify.ts)
// A failed refresh keeps the last good values. With no values at all the call throws (fail closed: no number is better
// than an invented one), so a pack never opens with made-up rates.
import { getSupabase } from './supabase.js';

export const BALANCE_TTL_MS = 60_000;
export const BOT_KEYS = ['pulls', 'daily', 'pack_earn_multiplier', 'hunt_prizes'] as const;
export type BotKey = (typeof BOT_KEYS)[number];
export type BalanceValues = Record<BotKey, unknown>;

export function createBalance(
  load: () => Promise<Record<string, unknown>>,
  { ttl = BALANCE_TTL_MS, now = Date.now }: { ttl?: number; now?: () => number } = {},
): () => Promise<BalanceValues> {
  let cache: BalanceValues | null = null;
  let at = 0;
  let inflight: Promise<BalanceValues> | null = null;
  return async function getBalance(): Promise<BalanceValues> {
    if (cache && now() - at < ttl) return cache;
    if (!inflight) {
      inflight = (async () => {
        const v = await load();
        for (const k of BOT_KEYS) if (v?.[k] === undefined || v[k] === null) throw new Error(`balance: no value for the key ${k}`);
        cache = v as BalanceValues;
        at = now();
        return cache;
      })().finally(() => { inflight = null; });
    }
    try { return await inflight; } catch (e) { if (cache) return cache; throw e; }
  };
}

let shared: (() => Promise<BalanceValues>) | null = null;
/** The bot's one balance cache (the service role reads public.balance). */
export function getBalance(): Promise<BalanceValues> {
  shared ??= createBalance(async () => {
    const { data, error } = await getSupabase().from('balance').select('key, value').in('key', [...BOT_KEYS]);
    if (error) throw new Error(`balance: ${error.message}`);
    return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  });
  return shared();
}
/** Tests: replace the loader (a fake table), or reset to the database loader with null. */
export function setBalanceLoader(load: (() => Promise<Record<string, unknown>>) | null): void {
  shared = load ? createBalance(load) : null;
}

/** A whole number from a balance value, or an error (fail closed). */
export function balanceInt(v: unknown, what: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`balance: ${what} is not a number`);
  return Math.round(n);
}
