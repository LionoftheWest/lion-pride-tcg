import test from 'node:test';
import assert from 'node:assert/strict';
import { foePace, turnMs, FOE_MS, TURN_MS } from './dungeon-pace.js';

test('1 monster keeps the old pace, 2 take at most the budget', () => {
  assert.equal(foePace(1), 1);
  assert.ok(turnMs(2) <= TURN_MS + 5 && foePace(2) > 0.8);
});
test('2 to 5 monsters take at most the turn budget (and never run below the minimum pace)', () => {
  for (const n of [2, 3, 4, 5]) assert.ok(turnMs(n) <= TURN_MS + 5, `n=${n} ${turnMs(n)}`);
  assert.ok(foePace(50) >= 0.3);
});
test('no monster acts: pace 1', () => assert.equal(foePace(0), 1));

import { AUTO_ROUNDS, skippedRounds } from './dungeon-pace.js';
test('Auto batch: 2 rounds; the skipped rounds report their kill and loot', () => {
  assert.equal(AUTO_ROUNDS, 2);
  const rounds = [{ atk: { kill: false } }, { atk: { kill: true, loot: { card: 7 } } }];
  assert.deepEqual(skippedRounds(rounds, 0), { kill: true, loot: true });
  assert.deepEqual(skippedRounds(rounds, 1), { kill: true, loot: true });
  assert.deepEqual(skippedRounds(rounds, 2), { kill: false, loot: false });
  assert.deepEqual(skippedRounds(undefined, 0), { kill: false, loot: false });
});
