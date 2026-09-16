import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BONUS_THRESHOLD,
  PACK_SIZE,
  PULL_RATES,
  type Rarity,
  drawPack,
  groupByRarity,
  packsToAward,
  rollRarity,
} from './draw.js';

/** A small deterministic RNG (mulberry32) so tests are repeatable. */
function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TestCard {
  id: number;
  rarity: Rarity;
}

function pool(counts: Partial<Record<Rarity, number>>): Record<Rarity, TestCard[]> {
  const cards: TestCard[] = [];
  let id = 1;
  for (const [rarity, count] of Object.entries(counts)) {
    for (let i = 0; i < (count ?? 0); i += 1) {
      cards.push({ id: id++, rarity: rarity as Rarity });
    }
  }
  return groupByRarity(cards);
}

describe('rollRarity', () => {
  it('produces each tier within tolerance of its rate', () => {
    const rng = seededRng(12345);
    const runs = 500_000;
    const counts: Record<Rarity, number> = {
      normal: 0,
      illustrated_rare: 0,
      secret_rare: 0,
      full_art: 0,
      gold: 0,
    };
    for (let i = 0; i < runs; i += 1) {
      counts[rollRarity(rng)] += 1;
    }

    // Absolute tolerance per tier. Comfortable for 500k samples.
    const tolerance: Record<Rarity, number> = {
      normal: 0.01,
      illustrated_rare: 0.01,
      secret_rare: 0.002,
      full_art: 0.002,
      gold: 0.0015,
    };

    for (const rarity of Object.keys(counts) as Rarity[]) {
      const observed = counts[rarity] / runs;
      const expected = PULL_RATES[rarity];
      assert.ok(
        Math.abs(observed - expected) < tolerance[rarity],
        `${rarity}: observed ${observed.toFixed(5)}, expected ${expected}`,
      );
    }
  });

  it('has pull rates that sum to exactly 1', () => {
    const sum = Object.values(PULL_RATES).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum was ${sum}`);
  });
});

describe('drawPack', () => {
  it('returns exactly PACK_SIZE cards', () => {
    const rng = seededRng(1);
    const cards = drawPack(pool({ normal: 10, gold: 2 }), rng);
    assert.equal(cards.length, PACK_SIZE);
  });

  it('falls back to Normal when a rolled rarity has no cards', () => {
    const rng = seededRng(999);
    // Only Normal cards exist. Every non-Normal roll must fall back to Normal.
    const cards = drawPack(pool({ normal: 5 }), rng);
    for (const card of cards) {
      assert.equal(card.rarity, 'normal');
    }
  });

  it('throws when the pool has no Normal cards', () => {
    const rng = seededRng(7);
    assert.throws(() => drawPack(pool({ gold: 3 }), rng), /no Normal cards/);
  });
});

describe('packsToAward', () => {
  it('grants a base pack for one message, once', () => {
    assert.deepEqual(
      packsToAward({ messageCount: 1, baseClaimed: false, bonusClaimed: false }),
      { base: true, bonus: false },
    );
    assert.deepEqual(
      packsToAward({ messageCount: 5, baseClaimed: true, bonusClaimed: false }),
      { base: false, bonus: false },
    );
  });

  it('grants the bonus only at the threshold, once', () => {
    assert.equal(
      packsToAward({
        messageCount: BONUS_THRESHOLD - 1,
        baseClaimed: true,
        bonusClaimed: false,
      }).bonus,
      false,
    );
    assert.equal(
      packsToAward({
        messageCount: BONUS_THRESHOLD,
        baseClaimed: true,
        bonusClaimed: false,
      }).bonus,
      true,
    );
    assert.equal(
      packsToAward({
        messageCount: BONUS_THRESHOLD + 50,
        baseClaimed: true,
        bonusClaimed: true,
      }).bonus,
      false,
    );
  });
});
