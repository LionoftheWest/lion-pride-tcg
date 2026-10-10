import test from 'node:test';
import assert from 'node:assert/strict';
import { gateModel } from './unlock.js';

test('both steps open: the first gets the primary button', () => {
  const m = gateModel({ need: 8, attackers: 3, gifts_open: 2, gifts_total: 2 }, 'the Hunt');
  assert.equal(m.title, 'Unlock the Hunt');
  assert.deepEqual(m.steps.map((s) => s.done), [false, false]);
  assert.deepEqual(m.steps.map((s) => s.variant), ['primary', 'secondary']);
  assert.equal(m.steps[0].title, 'Claim your starter gifts');
  assert.equal(m.steps[0].prog, '0 / 2 claimed');
  assert.equal(m.steps[1].title, 'Own 8 attackers');
  assert.equal(m.steps[1].prog, '3 / 8 Characters or Creatures');
});

test('gifts done: the attackers step gets the primary button', () => {
  const m = gateModel({ need: 8, attackers: 3, gifts_open: 0, gifts_total: 2 }, 'the Dungeon');
  assert.deepEqual(m.steps.map((s) => s.done), [true, false]);
  assert.deepEqual(m.steps.map((s) => s.variant), ['secondary', 'primary']);
  assert.equal(m.steps[0].prog, '2 / 2 claimed');
  assert.equal(m.title, 'Unlock the Dungeon');
});

test('progress never passes the need; defaults are 8', () => {
  const m = gateModel({ attackers: 20, gifts_open: 1, gifts_total: 3 }, 'the Gauntlet');
  assert.equal(m.steps[1].done, true);
  assert.equal(m.steps[1].prog, '8 / 8 Characters or Creatures');
  assert.equal(m.steps[0].prog, '2 / 3 claimed');
  assert.deepEqual(m.steps.map((s) => s.variant), ['primary', 'secondary']);
});

test('the words Redeem and Unlocked never appear (10.1)', () => {
  const m = gateModel({ need: 8, attackers: 0, gifts_open: 2, gifts_total: 2 });
  assert.ok(!JSON.stringify(m).includes('Redeem'));
});
