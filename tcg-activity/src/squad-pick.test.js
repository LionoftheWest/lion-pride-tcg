// node --test src/squad-pick.test.js — the lock-in warning, a squad that is down, a turn with no action (Nathan, 2026-10-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSlots, hasAttacker } from './squad-pick.js';

// F-3 (2026-10-11): the auto-pick search and the team value are SQL now (hunt_autopick_pool, hunt_squad_value). Their cases
// (the full search, the support pair, the daily limit, a downed card) run in card-studio/scripts/test-f3-combat-math.mjs (4b).
let n = 0;
const card = (power, slugs = [], more = {}) => ({ id: ++n, type: 'Character', rarity: 'normal', season: 1, slugs, power, used: false, downed: false, ...more });

test('openSlots: how many more cards can go in today', () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(50 + i));
  assert.equal(openSlots(cards, cards.slice(0, 5).map((c) => c.id)), 3);
  assert.equal(openSlots(cards, cards.slice(0, 8).map((c) => c.id)), 0);
  for (const c of cards.slice(0, 6)) c.used = true; cards[0].downed = true;     // 6 used, 1 down
  assert.equal(openSlots(cards, [cards[1].id]), 6); // 4 standing used + 2 new slots
  assert.equal(openSlots(cards.slice(0, 3), [cards[1].id]), 1);                  // only 1 card left to add
});

// The squad-down check (Nathan + xeno, 2026-10-02: one downed card "wiped" a squad of 8).
import { squadDown, noAction } from './squad-pick.js';
const sq = () => Array.from({ length: 10 }, (_, i) => card(50 + i));
test('xeno: 8 locked, the first attacker fought and is down, 7 not fought yet: NOT down', () => {
  const cards = sq(); const sel = cards.slice(0, 8).map((c) => c.id);
  cards[0].used = true; cards[0].downed = true;
  assert.equal(squadDown(cards, sel), false);
});
test('all 8 locked attackers down: the squad is down', () => {
  const cards = sq(); const sel = cards.slice(0, 8).map((c) => c.id);
  for (const c of cards.slice(0, 8)) { c.used = true; c.downed = true; }
  assert.equal(squadDown(cards, sel), true);
});
test('a squad of 5, all down: down (no fresh cards join later)', () => {
  const cards = sq(); const sel = cards.slice(0, 5).map((c) => c.id);
  for (const c of cards.slice(0, 5)) { c.used = true; c.downed = true; }
  assert.equal(squadDown(cards, sel), true);
});
test('D-173: 6 attackers down, 2 supports up: NOT down (every card of the squad must be down)', () => {
  const cards = [...sq().slice(0, 6), card(10, [], { type: 'Moment' }), card(10, [], { type: 'Item' })];
  for (const c of cards.slice(0, 6)) { c.used = true; c.downed = true; }
  assert.equal(squadDown(cards, cards.map((c) => c.id)), false);
});
test('D-173: 6 attackers and 1 of 2 supports down, 1 support up: NOT down; all 8 down: down', () => {
  const cards = [...sq().slice(0, 6), card(10, [], { type: 'Moment' }), card(10, [], { type: 'Item' })];
  for (const c of cards.slice(0, 7)) { c.used = true; c.downed = true; }
  assert.equal(squadDown(cards, cards.map((c) => c.id)), false);
  cards[7].used = true; cards[7].downed = true;
  assert.equal(squadDown(cards, cards.map((c) => c.id)), true);
});
test('5 attackers down, 1 attacker of the squad not fought yet: NOT down', () => {
  const cards = sq(); const sel = cards.slice(0, 6).map((c) => c.id);
  for (const c of cards.slice(0, 5)) { c.used = true; c.downed = true; }
  assert.equal(squadDown(cards, sel), false);
});
test('no locked squad (fought before the server squads): the cards that fought are the squad', () => {
  const cards = sq();
  cards[0].used = true; cards[0].downed = true; cards[1].used = true;
  assert.equal(squadDown(cards, []), false);
});
test('a squad of supports only has no attacker; one Character or Creature is enough', () => {
  const sups = [card(10, [], { type: 'Moment' }), card(10, [], { type: 'Item' }), card(10, [], { type: 'Place' }), card(10, [], { type: null })];
  const ids = sups.map((c) => c.id);
  assert.equal(hasAttacker(sups, ids), false);
  const beast = card(20, [], { type: 'Creature' });
  assert.equal(hasAttacker([...sups, beast], [...ids, beast.id]), true);
  assert.equal(hasAttacker([...sups, beast], ids), false); // owned but not picked
});

// D-173: "No action can be taken" (every attacker down, every standing support on cooldown) -> the boss acts.
test('D-173 noAction: attackers down, the only support on cooldown: true', () => {
  const cards = [card(50), card(50), card(10, [], { type: 'Moment', cdReady: 5 })];
  cards[0].downed = cards[1].downed = true; cards[0].used = cards[1].used = cards[2].used = true;
  assert.equal(noAction(cards, cards.map((c) => c.id), 3), true);
});
test('D-173 noAction: the support is ready (cdReady <= round): false', () => {
  const cards = [card(50), card(10, [], { type: 'Moment', cdReady: 3 })];
  cards[0].downed = true; cards[0].used = cards[1].used = true;
  assert.equal(noAction(cards, cards.map((c) => c.id), 3), false);
});
test('D-173 noAction: an attacker stands: false (even with the support on cooldown)', () => {
  const cards = [card(50), card(50), card(10, [], { type: 'Moment', cdReady: 9 })];
  cards[0].downed = true;
  assert.equal(noAction(cards, cards.map((c) => c.id), 3), false);
});
test('D-173 noAction: the whole squad is down (nothing stands): false (the squad is down, not a pass)', () => {
  const cards = [card(50), card(10, [], { type: 'Moment', cdReady: 9 })];
  for (const c of cards) { c.downed = true; c.used = true; }
  assert.equal(noAction(cards, cards.map((c) => c.id), 3), false);
});
test('D-173 noAction: one support ready, one on cooldown: false; a card outside the squad is ignored', () => {
  const cards = [card(50), card(10, [], { type: 'Moment', cdReady: 9 }), card(10, [], { type: 'Item', cdReady: 0 }), card(10, [], { type: 'Item', cdReady: 0 })];
  cards[0].downed = true;
  assert.equal(noAction(cards, [cards[0].id, cards[1].id, cards[2].id], 3), false);
  assert.equal(noAction(cards, [cards[0].id, cards[1].id], 3), true);
});
