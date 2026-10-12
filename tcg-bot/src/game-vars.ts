// The game variables (F-1, tcg-bot/supabase/event_vars.sql + game_vars_readers.sql): a value that an event can change is
// read through ONE call, bot_game_vars(), which returns { vars: game_vars(), pulls: game_pull_rates() }. The SQL combines
// the balance base with every live event (game_var); the bot never calculates it again.
//   vars.pack_earn_mult   the earned-pack factor (store.ts: 0 = earning paused)
//   pulls                 the pull rates with the live pull_rare_mult applied (draw.ts pullTable checks them)
//   hunt_prizes           the Hunt prizes with the live hunt_prize_mult (game_hunt_prizes): the prizes settle_hunt pays (hunt-notify.ts)
// One cache, 30 s (docs/foundations.md F-1 item 7): a live event change reaches the next pack within 30 s.
// The same fail-closed rule as balance.ts: a failed refresh keeps the last good values; with no values at all the call
// throws, so a pack never opens with invented rates.
import { getSupabase } from './supabase.js';
import { type PullTable, pullTable } from './draw.js';

export const GAME_VARS_TTL_MS = 30_000;
export interface GameVars {
  vars: Record<string, number>;
  pulls: PullTable;
  packEarnMult: number;
  huntPrizes: unknown; // checked by hunt-notify.ts huntPrizes() where it is used
}

/** Checks the answer of bot_game_vars (fail closed: an error, never a guess). */
export function parseGameVars(v: unknown): GameVars {
  const o = v as { vars?: Record<string, unknown>; pulls?: unknown; hunt_prizes?: unknown } | null;
  if (!o || typeof o.vars !== 'object' || o.vars === null) throw new Error('game vars: no vars');
  const vars: Record<string, number> = {};
  for (const [k, x] of Object.entries(o.vars)) {
    const n = Number(x);
    if (typeof x !== 'number' || !Number.isFinite(n)) throw new Error(`game vars: ${k} is not a number`);
    vars[k] = n;
  }
  const mult = vars.pack_earn_mult;
  if (mult === undefined || mult < 0) throw new Error('game vars: pack_earn_mult is missing or below 0');
  if (o.hunt_prizes === undefined || o.hunt_prizes === null) throw new Error('game vars: no hunt_prizes');
  return { vars, pulls: pullTable(o.pulls), packEarnMult: mult, huntPrizes: o.hunt_prizes };
}

export function createGameVars(
  load: () => Promise<unknown>,
  { ttl = GAME_VARS_TTL_MS, now = Date.now }: { ttl?: number; now?: () => number } = {},
): () => Promise<GameVars> {
  let cache: GameVars | null = null;
  let at = 0;
  let inflight: Promise<GameVars> | null = null;
  return async function getGameVars(): Promise<GameVars> {
    if (cache && now() - at < ttl) return cache;
    if (!inflight) {
      inflight = (async () => {
        const v = parseGameVars(await load());
        cache = v;
        at = now();
        return v;
      })().finally(() => { inflight = null; });
    }
    try { return await inflight; } catch (e) { if (cache) return cache; throw e; }
  };
}

let shared: (() => Promise<GameVars>) | null = null;
/** The bot's one game-variable cache (the service role calls bot_game_vars). */
export function getGameVars(): Promise<GameVars> {
  shared ??= createGameVars(async () => {
    const { data, error } = await getSupabase().rpc('bot_game_vars');
    if (error) throw new Error(`game vars: ${error.message}`);
    return data;
  });
  return shared();
}
/** Tests: replace the loader (a fake answer), or reset to the database loader with null. */
export function setGameVarsLoader(load: (() => Promise<unknown>) | null): void {
  shared = load ? createGameVars(load) : null;
}
