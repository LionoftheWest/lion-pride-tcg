import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankByName, nameScore } from './name-rank.js';

const names = (rows) => rows.map((r) => r.username);
const R = (...n) => n.map((username) => ({ username }));

test('the best match first: exact, starts with, word start, anywhere', () => {
  assert.deepEqual(names(rankByName(R('Bananas', 'Anna', 'an', 'Dan_Annoy', 'Ann'), 'an')), ['an', 'Ann', 'Anna', 'Dan_Annoy', 'Bananas']);
});

test('a word inside the name counts: camelCase, _, ., -, space', () => {
  for (const n of ['LionoftheWest', 'mr.west', 'big_west', 'the-west', 'Old West']) assert.equal(nameScore(n, 'west'), 2, n);
  assert.equal(nameScore('northwestern', 'west'), 3);
});

test('no match is dropped, and case does not matter', () => {
  assert.deepEqual(names(rankByName(R('Xeno', 'Kira'), 'XEN')), ['Xeno']);
  assert.deepEqual(rankByName(R('Kira'), 'zz'), []);
});
