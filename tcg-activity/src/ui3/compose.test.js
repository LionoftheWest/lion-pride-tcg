// UI-31 Offer on a listing and List a card: the pure rules of src/ui3/compose.js. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIST_MAX, slotsOf, freeOf, listable, listFit, applyListPick, listFilterCount, unlistedText, listError, offerSeed, offerPlan } from './compose.js';
import { ICONS } from './icons.js';

const C = (id, name, rarity, quantity = 1, extra = {}) => ({ id, name, rarity, quantity, ...extra });

test('five slots: the listings first, the rest empty', () => {
  assert.equal(LIST_MAX, 5);
  const s = slotsOf([{ id: 1 }, { id: 2 }]);
  assert.equal(s.length, 5);
  assert.deepEqual(s.map((x) => x && x.id), [1, 2, null, null, null]);
  assert.deepEqual(slotsOf(null).filter(Boolean), []);
});

test('free copies: owned less held', () => {
  assert.equal(freeOf(C(1, 'a', 'normal', 3), { 1: 2 }), 1);
  assert.equal(freeOf(C(1, 'a', 'normal', 1), { 1: 4 }), 0);
  assert.equal(freeOf(C(1, 'a', 'normal', 2)), 2);
});

test('the list picker offers tradeable, not Gold, free, not listed cards: best rarity first, then copies', () => {
  const cards = [C(1, 'n1', 'normal', 1), C(2, 'fa', 'full_art', 1), C(3, 'g', 'gold', 2), C(4, 'held', 'secret_rare', 1), C(5, 'locked', 'normal', 2, { tradeable: false }),
    C(6, 'listed', 'normal', 2), C(7, 'n7', 'normal', 3), C(8, 'sr', 'secret_rare', 2)];
  const got = listable(cards, [{ card: { id: 6 } }], { 4: 1 }).map((c) => c.name);
  assert.deepEqual(got, ['fa', 'sr', 'n7', 'n1']);
});

test('search and the rarity filter', () => {
  const cards = [C(1, 'Pikachu', 'full_art', 1, { subject: 'Pokemon' }), C(2, 'Link', 'secret_rare', 1, { tags: { traits: ['hero'] } }), C(3, 'Mime', 'normal')];
  const run = (v, q) => applyListPick(cards, v, q).map((c) => c.name);
  assert.deepEqual(run({}, ''), ['Pikachu', 'Link', 'Mime']);
  assert.deepEqual(run({ rarity: 'normal' }, ''), ['Mime']);
  assert.deepEqual(run({ rarity: 'all' }, ' pika '), ['Pikachu']);
  assert.deepEqual(run({}, 'hero'), ['Link']);
  assert.deepEqual(run({}, 'zzz'), []);
  assert.equal(listFilterCount({ rarity: 'all' }), 0);
  assert.equal(listFilterCount({ rarity: 'normal' }), 1);
});

test('the slot size: the most columns whose slot is 88 px or more; 5 in a row when wide, 3 and 2 on a phone', () => {
  const o = { min: 88, ratio: 1.4 };
  assert.deepEqual(listFit(1160, 400, 16, o), { cols: 5, rows: 1, tile: 219 });
  assert.deepEqual(listFit(366, 700, 16, o), { cols: 3, rows: 2, tile: 111 });
  assert.deepEqual(listFit(690, 1000, 16, o), { cols: 3, rows: 2, tile: 219 });   // a tablet: three and two, larger than five in a row (126)
  assert.equal(listFit(1160, 330, 16, o).cols, 5);   // a desktop window: the two rows would be small
  const tall = listFit(366, 200, 16, o);   // too low for two rows of 88 px: the slot follows the height
  assert.ok(tall.tile * 1.4 * tall.rows + 16 * (tall.rows - 1) <= 200);
  assert.equal(listFit(0, 0, 16, o).cols, 5);
});

test('the texts: unlisted toast and the list error (10.2)', () => {
  assert.equal(unlistedText("Geno's Megaman"), "Geno's Megaman unlisted.");
  assert.equal(listError(null), 'Could not list that card.');
  assert.equal(listError({ message: 'Full.' }), 'Full.');
});

test('an offer on a Wanted card opens Your cards with the card in GIVE (a free copy), else nothing chosen', () => {
  assert.deepEqual(offerSeed('wanted', { card: { id: 9 }, mine: 2 }), { view: 'mine', giveId: 9, getId: null });
  assert.deepEqual(offerSeed('wanted', { card: { id: 9 }, mine: 0 }), { view: 'mine', giveId: null, getId: null });
});

test('an offer on a For trade card opens Their cards with the card in GET (a Request, D-35)', () => {
  assert.deepEqual(offerSeed('fortrade', { id: 5, card: { id: 9 }, mine: false }), { view: 'their', giveId: null, getId: 9 });
});

test('the Offer call: Wanted keeps the trade offer, For trade goes to the Hall offer with the listing; gifts stay', () => {
  const plan = { path: '/api/trade/offer', body: { toId: '7', offerCardId: 33 } };
  assert.deepEqual(offerPlan('wanted', { id: 1 }, plan), plan);
  assert.deepEqual(offerPlan('fortrade', { id: 5 }, plan), { path: '/api/hall/offer', body: { listingId: 5, cardId: 33 } });
  const gift = { path: '/api/trade/gift', body: { toId: '7', cardId: 33 } };
  assert.deepEqual(offerPlan('fortrade', { id: 5 }, gift), gift);
  assert.equal(offerPlan('fortrade', { id: 5 }, null), null);
});

test('the icons the sheet uses are in the icon set (G-053)', () => {
  for (const n of ['arrow-left', 'plus', 'x', 'tag', 'circle-alert']) assert.ok(ICONS[n], n);
});
