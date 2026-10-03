// The top want of each member (hall-routes.js topWants): the starred slot, else the first filled slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topWants } from './hall-routes.js';

const pick = (rows) => Object.fromEntries(topWants(rows).map((w) => [w.player_id, w.card_id]));

test('one card for each member', () => {
  const rows = [1, 2, 3, 4, 5].map((s) => ({ player_id: 'a', slot: s, card_id: 100 + s, top: false }))
    .concat([{ player_id: 'b', slot: 2, card_id: 7, top: false }]);
  assert.equal(topWants(rows).length, 2);
});
test('the starred slot wins, in any row order', () => {
  const rows = [{ player_id: 'a', slot: 4, card_id: 44, top: true }, { player_id: 'a', slot: 1, card_id: 11, top: false }, { player_id: 'a', slot: 2, card_id: 22, top: false }];
  assert.deepEqual(pick(rows), { a: 44 });
  assert.deepEqual(pick([...rows].reverse()), { a: 44 });
});
test('no star: the first filled slot (a wishlist set before the star shows at once)', () => {
  const rows = [{ player_id: 'a', slot: 3, card_id: 33 }, { player_id: 'a', slot: 2, card_id: 22 }, { player_id: 'a', slot: 5, card_id: 55 }];
  assert.deepEqual(pick(rows), { a: 22 });
});
