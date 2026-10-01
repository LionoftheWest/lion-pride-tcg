// node --test src/squad-pick.test.js — the auto-pick and the lock-in warning (Nathan, 2026-10-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestSquad, teamValue, openSlots } from './squad-pick.js';

const hunt = { weak_points: [{ kind: 'tag', value: 'trait:strong' }], resist_points: [{ kind: 'tag', value: 'trait:ice' }], passives: [] };
let n = 0;
const card = (power, slugs = [], more = {}) => ({ id: ++n, type: 'Character', rarity: 'normal', season: 1, slugs, power, used: false, downed: false, ...more });

test('a member with only 2 weak-matching cards still gets a full squad of 8', () => {
  const cards = [card(40, ['trait:strong']), card(45, ['trait:strong']), ...Array.from({ length: 10 }, (_, i) => card(30 + i))];
  assert.equal(bestSquad(cards, hunt).length, 8);
});

test('a card knocked out today is never picked (and it used 1 of the 8 daily slots)', () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(50 + i));
  cards[11].used = true; cards[11].downed = true; // the strongest card is down
  const ids = bestSquad(cards, hunt);
  assert.equal(ids.length, 7);
  assert.ok(!ids.includes(cards[11].id));
});

test('the daily limit: 4 cards used today (2 down) leaves 4 new + the 2 standing = 6', () => {
  const cards = Array.from({ length: 14 }, (_, i) => card(50 + i));
  for (const c of cards.slice(0, 4)) c.used = true;
  cards[0].downed = true; cards[1].downed = true;
  const ids = bestSquad(cards, hunt);
  assert.equal(ids.length, 6);
  assert.equal(ids.filter((id) => !cards.find((c) => c.id === id).used).length, 4);
  assert.ok(ids.includes(cards[2].id) && ids.includes(cards[3].id)); // the standing used cards are free
});

test('the pick has the highest team value of every possible squad (full search)', () => {
  const pick = (k, arr) => k === 0 ? [[]] : arr.flatMap((x, i) => pick(k - 1, arr.slice(i + 1)).map((r) => [x, ...r]));
  for (let seed = 1; seed <= 25; seed++) {
    let r = seed * 9301;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const tags = ['trait:fire', 'trait:water', 'trait:strong', 'trait:ice', 'origin:a', 'origin:b', 'trait:beast', 'trait:melee'];
    const cards = Array.from({ length: 11 }, () => card(Math.round(20 + rnd() * 120), tags.filter(() => rnd() < 0.3)));
    const best = Math.max(...pick(8, cards).map((t) => teamValue(t, hunt)));
    const got = teamValue(bestSquad(cards, hunt).map((id) => cards.find((c) => c.id === id)), hunt);
    assert.ok(got >= best - 1e-6 * best, `seed ${seed}: ${got.toFixed(1)} < the best ${best.toFixed(1)}`);
  }
});

test('the strongest cards win over a weak card that only matches the boss', () => {
  const weakMatch = card(20, ['trait:strong']);
  const cards = [weakMatch, ...Array.from({ length: 8 }, (_, i) => card(100 + i))];
  assert.ok(!bestSquad(cards, hunt).includes(weakMatch.id));
});

test('support cards fill the squad when there are too few attackers', () => {
  const cards = [...Array.from({ length: 5 }, (_, i) => card(60 + i)), ...Array.from({ length: 5 }, (_, i) => card(40 + i, [], { type: 'Item' }))];
  const ids = bestSquad(cards, hunt);
  assert.equal(ids.length, 8);
  assert.equal(ids.filter((id) => cards.find((c) => c.id === id).type === 'Item').length, 3);
});

test('openSlots: how many more cards can go in today', () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(50 + i));
  assert.equal(openSlots(cards, cards.slice(0, 5).map((c) => c.id)), 3);
  assert.equal(openSlots(cards, cards.slice(0, 8).map((c) => c.id)), 0);
  for (const c of cards.slice(0, 6)) c.used = true; cards[0].downed = true;     // 6 used, 1 down
  assert.equal(openSlots(cards, [cards[1].id]), 6); // 4 standing used + 2 new slots
  assert.equal(openSlots(cards.slice(0, 3), [cards[1].id]), 1);                  // only 1 card left to add
});
