// The pure game economy. No Discord and no Supabase live here, so every
// function in this file is easy to test in isolation. See docs/DESIGN.md for
// the reasoning.
//
// The NUMBERS are not here: the pull rates and the pack size are the balance key `pulls`
// (tcg-bot/supabase/balance_economy.sql), read by the bot through the balance cache
// (balance.ts) and passed in. One source: Gold 0.02% per card (Nathan, 2026-10-02: was
// 0.05%, before that 0.1% and 0.2%) lives only in the table. Never change a rate without Nathan.

export type Rarity =
  | 'normal'
  | 'illustrated_rare'
  | 'secret_rare'
  | 'full_art'
  | 'gold';

/** The balance key `pulls`: the cards in one pack, and the per-card pull rates (they sum to 1). */
export interface PullTable {
  pack_size: number;
  rates: Record<Rarity, number>;
}

/** A fixed order for the cumulative roll. Rarest last. */
const RARITY_ORDER: Rarity[] = [
  'normal',
  'illustrated_rare',
  'secret_rare',
  'full_art',
  'gold',
];

/**
 * Check the `pulls` value read from the database and return it typed. Throws on a wrong shape
 * (a missing rarity, a rate that is not a number, a total that is not 1, a bad pack size), so a
 * wrong table stops the open instead of drawing with invented numbers. The database refuses the
 * same mistakes (balance_check_economy); this is the second check.
 */
export function pullTable(v: unknown): PullTable {
  const t = v as { pack_size?: unknown; rates?: Record<string, unknown> } | null;
  const size = Number(t?.pack_size);
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new Error('balance pulls: pack_size must be 1 to 20');
  const rates = {} as Record<Rarity, number>;
  let sum = 0;
  for (const r of RARITY_ORDER) {
    const x = t?.rates?.[r];
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new Error(`balance pulls: no rate for ${r}`);
    rates[r] = x;
    sum += x;
  }
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`balance pulls: the rates add up to ${sum}, not 1`);
  return { pack_size: size, rates };
}

/**
 * Roll one rarity against a pull-rate table.
 * Pass a seeded rng for a deterministic test.
 */
export function rollRarity(rates: Record<Rarity, number>, rng: () => number = Math.random): Rarity {
  const roll = rng();
  let cumulative = 0;
  for (const rarity of RARITY_ORDER) {
    cumulative += rates[rarity];
    if (roll < cumulative) return rarity;
  }
  // Floating-point safety: a roll of exactly ~1 lands here.
  return 'normal';
}

/**
 * The Lucky Pull boon (effects_cleanup.sql): every rare rate x luck, Normal takes the rest.
 * luck is clamped to 1..3 (effect_primitives.max_amount for lucky_pull).
 */
export function luckyRates(base: Record<Rarity, number>, luck: number): Record<Rarity, number> {
  const k = Math.max(1, Math.min(3, Number(luck) || 1));
  const out = { ...base };
  let rare = 0;
  for (const r of RARITY_ORDER) if (r !== 'normal') { out[r] = base[r] * k; rare += out[r]; }
  out.normal = Math.round((1 - rare) * 1e9) / 1e9; // no float tail: luck 1 = the base rates exactly
  return out;
}

/** Group a flat list of cards into buckets by rarity. */
export function groupByRarity<T extends { rarity: Rarity }>(
  cards: T[],
): Record<Rarity, T[]> {
  const grouped: Record<Rarity, T[]> = {
    normal: [],
    illustrated_rare: [],
    secret_rare: [],
    full_art: [],
    gold: [],
  };
  for (const card of cards) {
    // Only the 5 pack rarities: an Event or Promo card in the pool by mistake is skipped (it
    // broke the draw for everyone before; Nathan, 2026-10-01: they never come from a pack).
    grouped[card.rarity]?.push(card);
  }
  return grouped;
}

function drawOne<T extends { rarity: Rarity }>(
  pool: Record<Rarity, T[]>,
  rng: () => number,
  rates: Record<Rarity, number>,
): T {
  let rarity = rollRarity(rates, rng);
  let candidates = pool[rarity];

  // If the rolled rarity has no cards yet, fall back to Normal.
  if (candidates.length === 0) {
    rarity = 'normal';
    candidates = pool.normal;
  }
  if (candidates.length === 0) {
    throw new Error(
      'The draw pool has no Normal cards. Seed at least one Normal card.',
    );
  }

  const index = Math.floor(rng() * candidates.length);
  return candidates[index]!;
}

/**
 * Draw a full pack of table.pack_size cards from a pool grouped by rarity.
 * Each card rolls its rarity independently.
 */
export function drawPack<T extends { rarity: Rarity }>(
  pool: Record<Rarity, T[]>,
  table: PullTable,
  rng: () => number = Math.random,
  luck?: number | null,
): T[] {
  const pack: T[] = [];
  for (let slot = 0; slot < table.pack_size; slot += 1) {
    // A Lucky Pull boon changes the first slot only.
    pack.push(drawOne(pool, rng, slot === 0 && luck ? luckyRates(table.rates, luck) : table.rates));
  }
  return pack;
}

export interface PackAward {
  base: boolean;
  bonus: boolean;
}
