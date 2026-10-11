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
