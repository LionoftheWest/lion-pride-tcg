// node --test collection-power.test.js : the board's total CP = my_collection_power (SQL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionPower, setTotals } from './collection-power.js';

const power = (rarity, asc, mod = 1) => ({ normal: 10, gold: 140 }[rarity] || 10) * [1, 1.25, 1.5, 1.75, 2, 2.5][asc || 0] * (mod || 1);
const catalog = [
  { id: 1, sid: 'a', rarity: 'normal', cp_mod: 1 },
  { id: 2, sid: 'a', rarity: 'gold', cp_mod: 1 },
  { id: 3, sid: 'b', rarity: 'normal', cp_mod: 1.5 },
  { id: 4, sid: 'b', rarity: 'normal', cp_mod: 1 },
  { id: 5, sid: null, rarity: 'gold', cp_mod: 1 },
];
const byId = new Map(catalog.map((c) => [c.id, c]));
const totals = setTotals(catalog);

test('a complete set gets x1.25 (rounded), an incomplete set does not', () => {
  // Set a complete: (10 + 140 x 1.25) = 185 -> 231.25 -> 231. Set b: only card 3 = 15.
  assert.equal(collectionPower([{ card_id: 1, ascension: 0 }, { card_id: 2, ascension: 1 }, { card_id: 3, ascension: 0 }], byId, totals, power), 231 + 15);
});

test('a card with no subject counts 0 (the SQL joins subjects)', () => {
  assert.equal(collectionPower([{ card_id: 5, ascension: 0 }], byId, totals, power), 0);
});

test('no cards = 0', () => assert.equal(collectionPower([], byId, totals, power), 0));
