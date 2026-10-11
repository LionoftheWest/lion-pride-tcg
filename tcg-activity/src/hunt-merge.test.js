// node --test src/hunt-merge.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFightRows } from './hunt-merge.js';

const card = (id, o = {}) => ({ id, name: `c${id}`, power: 100, matches: false, hp: 50, max_hp: 50, downed: false, used: false, shield: 0, cdReady: 0, ...o });

test('a card with a row gets hp, downed, shield, cooldown and used; a card without a row is untouched', () => {
  const out = mergeFightRows([card(1), card(2)], [{ card_id: 1, hp_remaining: 20, max_hp: 60, downed: false, shield: 7, cd_until_round: 3 }]);
  const a = out.find((c) => c.id === 1), b = out.find((c) => c.id === 2);
  assert.deepEqual([a.hp, a.max_hp, a.downed, a.used, a.shield, a.cdReady], [20, 60, false, true, 7, 3]);
  assert.deepEqual(b, card(2));
});

test('the order is the server order: downed last, then weak-point matches, then power', () => {
  const roster = [card(1, { power: 300 }), card(2, { power: 100, matches: true }), card(3, { power: 200 }), card(4, { power: 900 })];
  const out = mergeFightRows(roster, [{ card_id: 4, hp_remaining: 0, max_hp: 50, downed: true }]);
  assert.deepEqual(out.map((c) => c.id), [2, 1, 3, 4]);
});

test('a missing max_hp keeps the held one; null shield and cooldown become 0; ids match as numbers', () => {
  const out = mergeFightRows([card(5, { max_hp: 77 })], [{ card_id: '5', hp_remaining: 10, downed: false, shield: null, cd_until_round: null }]);
  assert.deepEqual([out[0].max_hp, out[0].shield, out[0].cdReady, out[0].used], [77, 0, 0, true]);
});

test('no roster or no rows: nothing breaks', () => {
  assert.deepEqual(mergeFightRows(undefined, undefined), []);
  assert.deepEqual(mergeFightRows([card(1)], undefined), [card(1)]);
});
