// UI-08 Card Detail window: the logic that decides what each section shows. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindLabel, kindClass, copiesLine, ascensionOf, ascendLabel, statKeys, freeLeft, tagList } from './card-detail.js';

test('the effect kind: "neutral" shows as "Shield" (approval condition, 10.1)', () => {
  assert.equal(kindLabel('neutral'), 'Shield');
  assert.equal(kindClass('neutral'), 'shield');
  assert.equal(kindLabel('boon'), 'Boon');
  assert.equal(kindLabel('prank'), 'Prank');
  assert.equal(kindLabel(undefined), 'Effect');
});

test('copies: "1 copy", "3 copies", not owned', () => {
  assert.equal(copiesLine({ quantity: 1 }), '1 copy');
  assert.equal(copiesLine({ quantity: 3 }), '3 copies');
  assert.equal(copiesLine({ locked: true, quantity: 0 }), 'Not in your collection yet');
});

test('ascension: the copies bar counts the extra copies against the cost; max, event, not owned, flag off', () => {
  assert.deepEqual(ascensionOf({ quantity: 3, ascension: 0, next_cost: 4 }), { have: 2, need: 4, pct: 50 });   // the frame: "2 / 4 copies"
  assert.deepEqual(ascensionOf({ quantity: 9, ascension: 1, next_cost: 2 }), { have: 2, need: 2, pct: 100 });
  assert.deepEqual(ascensionOf({ quantity: 2, ascension: 5, next_cost: null }), { text: '★5 max' });
  assert.deepEqual(ascensionOf({ quantity: 2, ascension: 0, next_cost: null }), { text: 'Event cards do not ascend.' });
  assert.equal(ascensionOf({ locked: true }), null);
  assert.equal(ascensionOf({ quantity: 3, next_cost: 2 }, { on: false }), null);
});

test('the Ascend button: only when the card can ascend now', () => {
  assert.equal(ascendLabel({ quantity: 2, ascension: 0, next_cost: 1, can_ascend: true }), 'Ascend to ★1 · uses 1');   // the frame
  assert.equal(ascendLabel({ quantity: 2, ascension: 0, next_cost: 1, can_ascend: false }), null);
  assert.equal(ascendLabel({ quantity: 9, ascension: 5, can_ascend: true }), null);
  assert.equal(ascendLabel({ locked: true, can_ascend: true }), null);
  assert.equal(ascendLabel({ quantity: 2, ascension: 0, next_cost: 1, can_ascend: true }, false), null);
});

test('stat points: the stats that do something for the card, and the free points after the picks', () => {
  assert.deepEqual(statKeys({ type: 'Character', effect: { primitive: 'x' } }), ['attack', 'vitality', 'precision', 'potency', 'haste']);   // the frame
  assert.deepEqual(statKeys({ type: 'Creature' }), ['attack', 'vitality', 'precision']);
  assert.deepEqual(statKeys({ type: 'Item', ability: { kind: 'support' } }), ['potency']);
  assert.deepEqual(statKeys({ type: 'Place' }), []);
  assert.equal(freeLeft({ free: 2 }, { attack: 1 }), 1);
  assert.equal(freeLeft({ free: 2 }, {}), 2);
});

test('tags: the element first, no element twice, the game label, sentence case', () => {
  const c = { tags: { type: 'creature', class: 'attacker', origin: ['pokemon'], traits: ['psychic', 'caster'] } };
  const t = tagList(c, { elementOf: () => 'psychic', gameLabels: { pokemon: 'Pokemon' } });
  assert.deepEqual(t, [{ el: 'psychic' }, { text: 'Creature' }, { text: 'Attacker' }, { text: 'Pokemon' }, { text: 'Caster' }]);   // the frame order
});
