import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLastHunt } from './last-hunt.js';

const h = (id, status) => ({ id, name: `Boss ${id}`, tier: 'Normal', status });

test('the newest finished hunt is the last boss', () => {
  assert.equal(pickLastHunt([h(3, 'defeated'), h(5, 'expired'), h(4, 'defeated')], null).id, 5);
});
test('the live boss is never the last boss, even with an old finished status', () => {
  assert.equal(pickLastHunt([h(7, 'active'), h(6, 'defeated')], 7).id, 6);
  assert.equal(pickLastHunt([h(7, 'expired'), h(6, 'defeated')], 7).id, 6);
});
test('an active hunt is not finished', () => {
  assert.equal(pickLastHunt([h(9, 'active')], null), null);
});
test('ids compare as numbers (10 is newer than 9) and as strings of the same id', () => {
  assert.equal(pickLastHunt([h('9', 'defeated'), h('10', 'defeated')], null).id, '10');
  assert.equal(pickLastHunt([h('10', 'defeated')], 10), null);
});
test('no hunt gives null', () => {
  assert.equal(pickLastHunt([], 1), null);
  assert.equal(pickLastHunt(null, 1), null);
});
