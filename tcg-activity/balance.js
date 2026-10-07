// The balance table (tcg-bot/supabase/balance_table.sql): every number that changes a card's power or a
// fight lives in public.balance. The server reads it through ONE cache (createBalance, 60 s). Card power,
// combat power and HP are NEVER computed here: the server reads them from SQL (card_powers,
// collection_power_all). This file only looks up table values (the ascend cost, the caps).
// /api/flags sends the public part (publicBalance) for the client, which still shows its own copies of a few
// display numbers until the UI work reads them (UI freeze, docs/design.md).

export const BALANCE_TTL_MS = 60_000;

// The server cache. load() returns the rows { key: value }. A failed refresh keeps the last good values;
// with no values at all the call throws (fail closed: no number is better than an invented one).
export function createBalance(load, { ttl = BALANCE_TTL_MS, now = Date.now } = {}) {
  let cache = null; let at = 0; let inflight = null;
  return async function getBalance() {
    if (cache && now() - at < ttl) return cache;
    if (!inflight) {
      inflight = (async () => {
        const v = await load();
        if (!v || !v.rarity_cp || !v.stars) throw new Error('balance: the table is empty');
        cache = v; at = now(); return v;
      })().finally(() => { inflight = null; });
    }
    try { return await inflight; } catch (e) { if (cache) return cache; throw e; }
  };
}

export function ascendCost(b, rarity, asc) {
  const a = Number(asc) || 0;
  if (a >= 5) return null;
  return Number((b.ascend_cost[rarity] || b.ascend_cost.normal)[a]);
}

export const dailyCardCap = (b) => Number(b.daily_card_cap);
export const roundCap = (b) => Number(b.round_cap);

// The part the client may see (the numbers are public: the repo is public). No flags, no tuning history.
export const PUBLIC_KEYS = ['rarity_cp', 'stars', 'card_hp', 'stat_points', 'combat', 'support', 'boss_passives', 'boss_moves',
  'round_cap', 'daily_card_cap', 'set_bonus', 'ascend_cost'];
export function publicBalance(b) {
  return Object.fromEntries(PUBLIC_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
}
