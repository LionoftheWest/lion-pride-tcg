// UI-33 the Open window: the logic that can be checked without a browser. node --test
// D-85 the preselected set, D-88 the hidden counts, D-90 / 3.4 the page size of the set list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCounts, preselect, fitSets, pageOf } from './open-window.js';

const S = (id, released_at = null) => ({ id, name: id, code: id, released_at, cards: 10, owned: 1 });

test('D-88: only the counts the member can open show; D-87: the window works with 1 pack', () => {
  assert.deepEqual(openCounts(0), []);
  assert.deepEqual(openCounts(1), [1]);
  assert.deepEqual(openCounts(4), [1]);
  assert.deepEqual(openCounts(5), [1, 5]);
  assert.deepEqual(openCounts(9), [1, 5]);
  assert.deepEqual(openCounts(10), [1, 5, 10]);
  assert.deepEqual(openCounts(12), [1, 5, 10]);
  assert.deepEqual(openCounts('7'), [1, 5]);
  assert.deepEqual(openCounts(undefined), []);
});

test('D-85: the set of the last open is selected (session, then server), else the newest, never a set not in the list', () => {
  const sets = [S('S1', '2026-09-01'), S('S2', '2026-12-01'), S('S3', '2026-11-01')];
  assert.equal(preselect(sets, 'S3'), 'S3', 'the server last_set');
  assert.equal(preselect(sets, 'S3', 'S1'), 'S1', 'the open in this session wins over the server answer from before it');
  assert.equal(preselect(sets, 'S9'), 'S2', 'a last set that is not pullable: the newest set');
  assert.equal(preselect(sets, null, 'S9'), 'S2');
  assert.equal(preselect(sets, null), 'S2', 'first visit: the newest set');
  assert.equal(preselect([S('A'), S('B')], null), 'A', 'no release dates: the first set');
  assert.equal(preselect([], 'S1'), null);
  assert.equal(preselect(undefined, 'S1'), null);
});

// The approved review-3 table (UI-33/review-3/notes.md "Tiles per page"): 430x932 2 x 4, 932x430 2 x 2,
// 1280x720 5 x 3 (5 x 2 when paged). Tile 114 px, gap 12, minimum tile 180.
const T = { minTile: 180, tileH: 114, gap: 12 };
test('3.4: one set fills the width; the columns never exceed the sets', () => {
  assert.deepEqual(fitSets({ ...T, n: 1, width: 386, height: 600, pagerH: 44 }), { cols: 1, rows: 1, pageSize: 1, pages: 1 });
  assert.equal(fitSets({ ...T, n: 2, width: 1100, height: 400, pagerH: 32 }).cols, 2);
});
test('3.4: a grid adds a row before it adds a page; the pager comes only when the sets do not fit', () => {
  // 430x932: 2 columns; 4 rows fit
  const port = (n) => fitSets({ ...T, n, width: 386, height: 4 * 114 + 3 * 12 + 60, pagerH: 44 });
  assert.deepEqual(port(4), { cols: 2, rows: 2, pageSize: 4, pages: 1 });
  assert.deepEqual(port(8), { cols: 2, rows: 4, pageSize: 8, pages: 1 });
  const p12 = port(12);
  assert.equal(p12.cols, 2);
  assert.ok(p12.pages >= 2, 'more sets than fit: pages');
  // 932x430: 2 columns, 2 rows: 12 sets = 3 pages
  const land = fitSets({ ...T, n: 12, width: 404, height: 2 * 114 + 12 + 44 + 12, pagerH: 44 });
  assert.deepEqual(land, { cols: 2, rows: 2, pageSize: 4, pages: 3 });
  // 1280x720: 5 columns; 3 rows without the pager, 2 with it (12 fit, 24 = 3 pages)
  const wide = (n) => fitSets({ ...T, n, width: 1100, height: 3 * 114 + 2 * 12 + 10, pagerH: 32 });
  assert.deepEqual(wide(12), { cols: 5, rows: 3, pageSize: 12, pages: 1 });
  assert.deepEqual(wide(24), { cols: 5, rows: 2, pageSize: 10, pages: 3 });
});
test('3.4: never 0 rows or 0 columns, even in a frame too small for one tile', () => {
  const f = fitSets({ ...T, n: 5, width: 50, height: 20, pagerH: 44 });
  assert.equal(f.cols, 1); assert.equal(f.rows, 1); assert.equal(f.pageSize, 1); assert.equal(f.pages, 5);
});
test('D-85 + D-90: the window opens on the page of the selected set', () => {
  assert.equal(pageOf(0, 4), 1); assert.equal(pageOf(3, 4), 1); assert.equal(pageOf(4, 4), 2); assert.equal(pageOf(11, 4), 3);
  assert.equal(pageOf(-1, 4), 1, 'no selected set: page 1');
});
