// The draw did not change when the pull rates moved to the balance table (balance_economy.sql, 2026-10-06).
// draw-golden.json was recorded with the OLD draw.ts (the rates and the pack size were constants in the code):
// 20,000 seeded packs without luck, with luck 2 and with luck 3 (a sha256 of every card id in order + the rarity
// counts), and 2,000,000 seeded rarity rolls. This test draws the same seeds with the NEW draw.ts and the `pulls`
// value of the migration, and must get exactly the same cards. A mutation check proves it can fail.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { type PullTable, type Rarity, drawPack, groupByRarity, pullTable, rollRarity } from './draw.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./draw-golden.json', import.meta.url), 'utf8'));
const MIGRATION = readFileSync(new URL('../supabase/balance_economy.sql', import.meta.url), 'utf8');
const TABLE = pullTable(JSON.parse(MIGRATION.match(/\('pulls', '(\{[^']*\})',/)![1]!));

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
const cards: { id: number; rarity: Rarity }[] = [];
let id = 1;
for (const [r, n] of Object.entries({ normal: 10, illustrated_rare: 4, secret_rare: 2, full_art: 2, gold: 2 })) {
  for (let i = 0; i < n; i += 1) cards.push({ id: id++, rarity: r as Rarity });
}
const POOL = groupByRarity(cards);

function packs(table: PullTable, luck: number | null) {
  const h = createHash('sha256');
  const counts: Record<string, number> = {};
  for (let s = 0; s < 20000; s += 1) {
    const p = drawPack(POOL, table, seededRng(s), luck);
    h.update(p.map((c) => c.id).join(',') + ';');
    for (const c of p) counts[c.rarity] = (counts[c.rarity] || 0) + 1;
  }
  return { sha256: h.digest('hex'), counts };
}
function rolls(table: PullTable) {
  const rng = seededRng(12345);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 2_000_000; i += 1) { const r = rollRarity(table.rates, rng); counts[r] = (counts[r] || 0) + 1; }
  return counts;
}

describe('the draw with the balance pulls = the draw with the old constants', () => {
  it('the migration keeps the exact old values (Gold 0.02%, pack of 5)', () => {
    assert.deepEqual(TABLE, { pack_size: 5, rates: { normal: 0.9398, illustrated_rare: 0.05, secret_rare: 0.006, full_art: 0.004, gold: 0.0002 } });
  });
  for (const luck of [null, 2, 3]) {
    it(`20,000 seeded packs, luck ${luck ?? 'none'}: the same cards in the same order`, () => {
      assert.deepEqual(packs(TABLE, luck), GOLDEN[`packs_luck_${luck ?? 0}`]);
    });
  }
  it('2,000,000 seeded rarity rolls: the same counts', () => {
    assert.deepEqual(rolls(TABLE), GOLDEN.rolls_2m_seed_12345);
  });
  it('MUTATION: Gold 0.03% instead of 0.02% gives other draws (so the golden check can fail)', () => {
    const m = { pack_size: 5, rates: { ...TABLE.rates, gold: 0.0003, normal: 0.9397 } };
    assert.notDeepEqual(rolls(m), GOLDEN.rolls_2m_seed_12345);
    assert.notEqual(packs(m, null).sha256, GOLDEN.packs_luck_0.sha256);
  });
  it('MUTATION: a pack of 4 gives other packs', () => {
    assert.notEqual(packs({ ...TABLE, pack_size: 4 }, null).sha256, GOLDEN.packs_luck_0.sha256);
  });
});

describe('pullTable refuses a wrong table (fail closed: no pack opens with invented rates)', () => {
  const ok = { pack_size: 5, rates: { ...TABLE.rates } };
  it('accepts the live table', () => assert.deepEqual(pullTable(ok), TABLE));
  for (const [what, v] of [
    ['a missing rarity', { pack_size: 5, rates: { normal: 0.9398, illustrated_rare: 0.05, secret_rare: 0.006, full_art: 0.0042 } }],
    ['rates that do not add up to 1', { pack_size: 5, rates: { ...TABLE.rates, gold: 0.001 } }],
    ['a rate that is text', { pack_size: 5, rates: { ...TABLE.rates, gold: '0.0002' } }],
    ['pack_size 0', { pack_size: 0, rates: TABLE.rates }],
    ['pack_size 2.5', { pack_size: 2.5, rates: TABLE.rates }],
    ['no value', null],
  ] as [string, unknown][]) {
    it(`refuses ${what}`, () => assert.throws(() => pullTable(v), /balance pulls/));
  }
});
