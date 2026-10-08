// UI-16 the Wishlist window and the wish picker (src/ui3/wishlist.js) and the pick-one mode of the Card picker
// (src/ui3/card-picker.js). node --test. Fake cards only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formOf, wishlistHTML, wishFilters, wishFilterCount, wishApply, SAVE_ERROR } from './wishlist.js';
import { pickOne, toggle } from './card-picker.js';

const card = (id, rarity, extra = {}) => ({ id, name: `Card ${id}`, rarity, image_url: `/api/img/c${id}.webp`, ...extra });
const slots = [
  { slot: 1, card: card(1, 'full_art'), mine: 0, top: true },
  { slot: 2, card: card(2, 'gold'), mine: 0, top: false },
  { slot: 3, card: card(3, 'normal'), mine: 0, top: false },
  { slot: 4, card: card(4, 'secret_rare'), mine: 0, top: false },
  { slot: 5, card: null, mine: 0, top: false },
];
const LABEL = { normal: 'Normal', gold: 'Gold', full_art: 'Full Art', secret_rare: 'Secret Rare' };

test('the window form for each size class (E1): sheet, side sheet, dialog', () => {
  assert.equal(formOf('compact-port'), 'sheet');
  assert.equal(formOf('compact-land'), 'side');
  for (const s of ['medium', 'expanded', 'tiny', undefined]) assert.equal(formOf(s), 'dialog', String(s));
});

test('the window: title, count, 5 rows with the slot numbers, the star only for a card, the pencil on every row', () => {
  const h = wishlistHTML({ slots, form: 'sheet', rarityLabel: LABEL });
  assert.match(h, /data-form="sheet"/);
  assert.match(h, />Wishlist</);
  assert.match(h, /class="u3-wl__count">4\/5</);
  assert.equal((h.match(/class="u3-wl-row[ "]/g) || []).length, 5);
  for (const n of [1, 2, 3, 4, 5]) assert.match(h, new RegExp(`class="u3-wl-row__n">${n}<`));
  assert.equal((h.match(/data-wltop=/g) || []).length, 4, 'a star on each card row, none on the empty row');
  assert.equal((h.match(/data-wlset=/g) || []).length, 5, 'a pencil on every row');
  assert.equal((h.match(/aria-pressed="true"/g) || []).length, 1, 'one top want');
  assert.match(h, /u3-wl-row u3-r-full_art is-top/);
  assert.match(h, /class="u3-wl-row is-empty">.*?<b class="u3-wl-row__name">Empty<\/b>/);
  assert.match(h, /aria-label="Close"/);
  assert.doesNotMatch(h, /data-wlclear|>Clear</, 'Clear is only in the picker (D-66 item 2)');
  assert.match(h, />Full Art</);
  assert.doesNotMatch(h, /u3-msg/, 'no error line without an error');
});

test('a refused save shows the standard error text (D-66 item 5)', () => {
  assert.equal(SAVE_ERROR, 'Something went wrong. Try again.');
  const h = wishlistHTML({ slots, msg: SAVE_ERROR, form: 'dialog', rarityLabel: LABEL });
  assert.match(h, /u3-msg--error" role="alert">.*Something went wrong\. Try again\./);
});

test('names are escaped', () => {
  const h = wishlistHTML({ slots: [{ slot: 1, card: { id: 9, name: '<b>x</b>', rarity: 'normal' }, top: false }], rarityLabel: LABEL });
  assert.doesNotMatch(h, /<b>x<\/b>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
});

const lib = {
  rarities: [['normal', 'Normal'], ['illustrated_rare', 'Illustrated Rare'], ['full_art', 'Full Art'], ['gold', 'Gold']],
  elements: [['fire', 'Fire'], ['water', 'Water'], ['ice', 'Ice']],
  types: [['character', 'Character'], ['creature', 'Creature'], ['place', 'Place']],
  games: [['smash', 'Smash Bros'], ['pokemon', 'Pokemon'], ['meme', 'Memes']],
  elementOf: (c) => c.el || null,
};
const cards = [
  card(1, 'normal', { owned: true, el: 'fire', tags: { type: 'character', origin: ['smash'] }, subject: 'Mario' }),
  card(2, 'full_art', { owned: false, el: 'water', tags: { type: 'creature', origin: 'pokemon', traits: ['cute'] } }),
  card(3, 'gold', { owned: true, can_ascend: true, el: 'fire', tags: { type: 'creature', origin: ['pokemon', 'smash'] } }),
];

test('the filters are the Collection groups, with only the values that some card has', () => {
  const f = wishFilters(cards, lib, { rarity: 'full_art' });
  assert.deepEqual(f.map((g) => g.label), ['Show', 'Rarity', 'Element', 'Type', 'Game']);
  const opt = (k) => f.find((g) => g.key === k).options.map((o) => o.id);
  assert.deepEqual(opt('show'), ['all', 'owned', 'missing', 'ascend']);
  assert.deepEqual(f.find((g) => g.key === 'show').options.map((o) => o.label), ['All', 'Owned', 'Missing', 'Can ascend']);
  assert.deepEqual(opt('rarity'), ['all', 'normal', 'full_art', 'gold']);
  assert.deepEqual(opt('el'), ['all', 'fire', 'water']);
  assert.deepEqual(opt('type'), ['all', 'character', 'creature']);
  assert.deepEqual(opt('game'), ['all', 'smash', 'pokemon']);
  assert.equal(f.find((g) => g.key === 'rarity').value, 'full_art', 'the rarity of the card in the slot');
  assert.ok(f.every((g) => g.clear === 'all'));
  assert.equal(wishFilters(cards, lib).find((g) => g.key === 'rarity').value, 'all', 'an empty slot starts with all cards');
});

test('the filter count on "Filters (n)"', () => {
  assert.equal(wishFilterCount({ show: 'all', rarity: 'all', el: 'all', type: 'all', game: 'all' }), 0);
  assert.equal(wishFilterCount({ show: 'all', rarity: 'full_art', el: 'all', type: 'all', game: 'all' }), 1);
  assert.equal(wishFilterCount({ show: 'owned', rarity: 'gold', el: 'fire', type: 'creature', game: 'smash' }), 5);
});

test('the shown cards: each group and the search words, in catalog order', () => {
  const all = { show: 'all', rarity: 'all', el: 'all', type: 'all', game: 'all' };
  const ids = (v, q = '') => wishApply(cards, { ...all, ...v }, q, lib.elementOf).map((c) => c.id);
  assert.deepEqual(ids({}), [1, 2, 3]);
  assert.deepEqual(ids({ show: 'owned' }), [1, 3]);
  assert.deepEqual(ids({ show: 'missing' }), [2]);
  assert.deepEqual(ids({ show: 'ascend' }), [3]);
  assert.deepEqual(ids({ rarity: 'full_art' }), [2]);
  assert.deepEqual(ids({ el: 'fire' }), [1, 3]);
  assert.deepEqual(ids({ type: 'creature' }), [2, 3]);
  assert.deepEqual(ids({ game: 'smash' }), [1, 3]);
  assert.deepEqual(ids({ game: 'pokemon' }), [2, 3], 'a one-word origin counts too');
  assert.deepEqual(ids({}, 'mario'), [1], 'the subject');
  assert.deepEqual(ids({}, 'CUTE'), [2], 'a trait, any case');
  assert.deepEqual(ids({}, 'card 3'), [3], 'every word');
  assert.deepEqual(ids({ show: 'owned', type: 'creature' }), [3], 'groups combine');
});

test('the Card picker pick-one mode: a tap replaces the choice, a tap on the chosen card takes it off', () => {
  assert.deepEqual(pickOne([], 5), [5]);
  assert.deepEqual(pickOne([5], 7), [7]);
  assert.deepEqual(pickOne([5], 5), []);
  // pick several keeps its rule (6.5a)
  assert.deepEqual(toggle([5], 7, 1), [5]);
});
