// UI-11 / UI-12 pure logic (src/ui3/collection-tabs.js): the claim status, the page fit, the boss grid, the credit line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, claimLine, bossCredit, rowsThatFit, pageSlice, bossGrid } from './collection-tabs.js';

test('statusOf: ready only when done and not claimed', () => {
  const claimed = new Set(['b']);
  assert.equal(statusOf({ key: 'a', done: false }, claimed), 'progress');
  assert.equal(statusOf({ key: 'a', done: true }, claimed), 'ready');
  assert.equal(statusOf({ key: 'b', done: true }, claimed), 'claimed');
  assert.equal(statusOf(null, claimed), 'progress');
});

test('claimLine uses Claim, never Redeem (glossary D-05)', () => {
  assert.equal(claimLine(2), '2 to claim');
  assert.equal(claimLine(-1), '0 to claim');
});

test('bossCredit: the em dash becomes a middle dot (B9)', () => {
  assert.equal(bossCredit('Model: Maw J Laygo — Mixamo (Adobe)'), 'Model: Maw J Laygo · Mixamo (Adobe)');
  assert.equal(bossCredit(null), '');
});

test('rowsThatFit: a grid adds a row before it adds a page, and keeps one row at least', () => {
  assert.equal(rowsThatFit({ boxH: 400, rowH: 128, gap: 8 }), 3);   // 3 x 128 + 2 x 8 = 400
  assert.equal(rowsThatFit({ boxH: 399, rowH: 128, gap: 8 }), 2);
  assert.equal(rowsThatFit({ boxH: 10, rowH: 128, gap: 8 }), 1);
  assert.equal(rowsThatFit({ boxH: 0, rowH: 0, gap: 8 }), 1);
});

test('pageSlice: the page stays inside the range after the list or the box changes', () => {
  assert.deepEqual(pageSlice(50, 12, 0), { page: 0, pages: 5, start: 0, end: 12 });
  assert.deepEqual(pageSlice(50, 12, 99), { page: 4, pages: 5, start: 48, end: 50 });
  assert.deepEqual(pageSlice(0, 12, 3), { page: 0, pages: 1, start: 0, end: 0 });
});

test('bossGrid: 6 x 2 in a wide box, 3 x 4 in a tall box, never more columns than bosses', () => {
  assert.deepEqual(bossGrid(12, 1200, 480), { cols: 6, rows: 2 });
  assert.deepEqual(bossGrid(12, 400, 700), { cols: 3, rows: 4 });
  assert.deepEqual(bossGrid(2, 1200, 480), { cols: 2, rows: 1 });
});

test('bossGrid: a phone held upright stays 3 columns even when a safe area makes the box wider than tall', () => {
  assert.deepEqual(bossGrid(12, 359, 320, 'compact-port'), { cols: 3, rows: 4 });
});
