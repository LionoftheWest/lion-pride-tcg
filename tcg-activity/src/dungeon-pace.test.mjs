import test from 'node:test';
import assert from 'node:assert/strict';
import { foePace, turnMs, FOE_MS, TURN_MS } from './dungeon-pace.js';

test('1 and 2 monsters keep the old pace', () => {
  assert.equal(foePace(1), 1); assert.equal(foePace(2), 1);
  assert.equal(turnMs(2), 2 * FOE_MS);
});
test('3 to 5 monsters take at most the turn budget (and never run below the minimum pace)', () => {
  for (const n of [3, 4, 5]) assert.ok(turnMs(n) <= TURN_MS + 5, `n=${n} ${turnMs(n)}`);
  assert.ok(foePace(50) >= 0.4);
});
test('no monster acts: pace 1', () => assert.equal(foePace(0), 1));
