// The pure game economy. No Discord and no Supabase live here, so every
// function in this file is easy to test in isolation. See docs/DESIGN.md for
// the numbers and the reasoning.

export type Rarity =
  | 'normal'
  | 'illustrated_rare'
  | 'secret_rare'
  | 'full_art'
  | 'gold';

/** The number of cards in one pack. */
export const PACK_SIZE = 5;

/** The message count in a day that earns the second (bonus) pack. */
export const BONUS_THRESHOLD = 25;

/** Per-card pull rates. These must sum to 1. */
export const PULL_RATES: Record<Rarity, number> = {
  normal: 0.938,
  illustrated_rare: 0.05,
  secret_rare: 0.006,
  full_art: 0.004,
  gold: 0.002,
};

/** A fixed order for the cumulative roll. Rarest last. */
const RARITY_ORDER: Rarity[] = [
  'normal',
  'illustrated_rare',
  'secret_rare',
  'full_art',
  'gold',
];

/**
 * Roll one rarity against the pull-rate table.
 * Pass a seeded rng for a deterministic test. Defaults to Math.random.
 */
export function rollRarity(rng: () => number = Math.random): Rarity {
  const roll = rng();
  let cumulative = 0;
  for (const rarity of RARITY_ORDER) {
    cumulative += PULL_RATES[rarity];
    if (roll < cumulative) return rarity;
  }
  // Floating-point safety: a roll of exactly ~1 lands here.
  return 'normal';
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
    grouped[card.rarity].push(card);
  }
  return grouped;
}

function drawOne<T extends { rarity: Rarity }>(
  pool: Record<Rarity, T[]>,
  rng: () => number,
): T {
  let rarity = rollRarity(rng);
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
 * Draw a full pack of PACK_SIZE cards from a pool grouped by rarity.
 * Each card rolls its rarity independently.
 */
export function drawPack<T extends { rarity: Rarity }>(
  pool: Record<Rarity, T[]>,
  rng: () => number = Math.random,
): T[] {
  const pack: T[] = [];
  for (let slot = 0; slot < PACK_SIZE; slot += 1) {
    pack.push(drawOne(pool, rng));
  }
  return pack;
}

export interface DailyActivity {
  messageCount: number;
  baseClaimed: boolean;
  bonusClaimed: boolean;
}

export interface PackAward {
  base: boolean;
  bonus: boolean;
}

/**
 * Decide which packs a member has earned but not yet claimed today.
 * - base: at least one message, not yet claimed.
 * - bonus: at least BONUS_THRESHOLD messages, not yet claimed.
 */
export function packsToAward(
  activity: DailyActivity,
  threshold = BONUS_THRESHOLD,
): PackAward {
  return {
    base: activity.messageCount >= 1 && !activity.baseClaimed,
    bonus: activity.messageCount >= threshold && !activity.bonusClaimed,
  };
}
