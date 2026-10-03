// node --test src/squad-pick.test.js — the auto-pick and the lock-in warning (Nathan, 2026-10-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestSquad, teamValue, openSlots, hasAttacker } from './squad-pick.js';

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

const support = (effect, more = {}) => card(10, [], { type: 'Moment', effect, affinity: null, potency: 1, ...more });
const typeOf = (cards, ids) => ids.map((id) => cards.find((c) => c.id === id));

test('a squad keeps 2 support slots: 6 attackers + 2 supports', () => {
  const cards = [...Array.from({ length: 10 }, (_, i) => card(60 + i)), support('heal'), support('empower'), support('expose')];
  const t = typeOf(cards, bestSquad(cards, hunt));
  assert.equal(t.length, 8);
  assert.equal(t.filter((c) => c.effect).length, 2);
  assert.deepEqual(t.filter((c) => !c.effect).map((c) => c.power), [69, 68, 67, 66, 65, 64]); // the 6 strongest attackers
});

test('the 2 supports mix a heal/shield/weaken with a damage effect (not two of one kind)', () => {
  const cards = [...Array.from({ length: 8 }, (_, i) => card(60 + i)), support('empower'), support('empower'), support('expose'), support('heal')];
  const fx = typeOf(cards, bestSquad(cards, hunt)).filter((c) => c.effect).map((c) => c.effect).sort();
  assert.equal(fx.length, 2);
  assert.ok(fx.includes('heal'), 'one sustain support: ' + fx);
  assert.ok(fx.some((e) => e === 'empower' || e === 'expose'), 'one damage support: ' + fx);
});

test('a support whose affinity matches the squad wins over the same effect without it', () => {
  const cards = [...Array.from({ length: 8 }, (_, i) => card(60 + i, ['trait:beast'])), support('empower', { affinity: 'trait:beast' }), support('empower'), support('shield')];
  const ids = bestSquad(cards, hunt);
  assert.ok(ids.includes(cards[8].id) && !ids.includes(cards[9].id));
});

test('Potency points make a support stronger', () => {
  const cards = [...Array.from({ length: 8 }, (_, i) => card(60 + i)), support('shield'), support('shield', { potency: 1.1 }), support('expose')];
  const ids = bestSquad(cards, hunt);
  assert.ok(ids.includes(cards[9].id) && !ids.includes(cards[8].id));
});

test('support cards fill the squad when there are too few attackers', () => {
  const cards = [...Array.from({ length: 5 }, (_, i) => card(60 + i)), ...['heal', 'shield', 'empower', 'expose', 'stun'].map((e) => support(e))];
  const t = typeOf(cards, bestSquad(cards, hunt));
  assert.equal(t.length, 8);
  assert.equal(t.filter((c) => c.effect).length, 3);
});

test('the daily limit keeps room for the supports: 6 attackers used today + 2 new supports', () => {
  const cards = [...Array.from({ length: 10 }, (_, i) => card(60 + i, [], { used: i < 6 })), support('heal'), support('empower')];
  const t = typeOf(cards, bestSquad(cards, hunt));
  assert.equal(t.length, 8);
  assert.equal(t.filter((c) => c.effect).length, 2);
});

test('openSlots: how many more cards can go in today', () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(50 + i));
  assert.equal(openSlots(cards, cards.slice(0, 5).map((c) => c.id)), 3);
  assert.equal(openSlots(cards, cards.slice(0, 8).map((c) => c.id)), 0);
  for (const c of cards.slice(0, 6)) c.used = true; cards[0].downed = true;     // 6 used, 1 down
  assert.equal(openSlots(cards, [cards[1].id]), 6); // 4 standing used + 2 new slots
  assert.equal(openSlots(cards.slice(0, 3), [cards[1].id]), 1);                  // only 1 card left to add
});

// The squad-down check (Nathan + xeno, 2026-10-02: one downed card "wiped" a squad of 8).
import { squadDown } from './squad-pick.js';
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
test('6 attackers down, 2 supports up: down (supports cannot fight alone, nothing hits them)', () => {
  const cards = [...sq().slice(0, 6), card(10, [], { type: 'Moment' }), card(10, [], { type: 'Item' })];
  for (const c of cards.slice(0, 6)) { c.used = true; c.downed = true; }
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
