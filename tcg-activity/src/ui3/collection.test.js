// UI-07 Collection (v3): the grid fitter (cards per page for each size class), the Filters button count, the pager,
// and the Can ascend filter. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitGrid, tileMin, pageOf, activeFilterCount, filtersLabel, FILTER_DEFAULTS, filterCards, setLine, numLabel } from './collection.js';

const GAP = 8;   // --sp-2 between tiles (ui3.css --u3-gap)

// The grid boxes of the approved UI-07 frames (review-2), in CSS px: the width and the height that the tiles may fill.
// The expected numbers are the frames' cards per page.
const FRAMES = [
  { name: 'compact-port 375x667', cls: 'compact-port', width: 359, height: 257, cols: 3, rows: 2, per: 6 },
  { name: 'compact-port 430x932', cls: 'compact-port', width: 414, height: 522, cols: 4, rows: 4, per: 16 },
  { name: 'compact-land 932x430 (D-60: 55 x 77, 2 rows, 24)', cls: 'compact-land', width: 780, height: 162, cols: 12, rows: 2, per: 24 },
  { name: 'medium 917x692', cls: 'medium', width: 869, height: 258, cols: 9, rows: 2, per: 18 },
  { name: 'expanded 1280x720', cls: 'expanded', width: 1208, height: 416, cols: 12, rows: 3, per: 36 },
];

test('cards per page: the approved frame of each size class', () => {
  for (const f of FRAMES) {
    const r = fitGrid({ width: f.width, height: f.height, gap: GAP, min: tileMin(f.cls) });
    assert.deepEqual([r.cols, r.rows, r.per], [f.cols, f.rows, f.per], f.name);
    assert.ok(r.cw >= tileMin(f.cls), `${f.name}: tile ${r.cw} below the minimum`);
  }
  // D-60: the compact-land tile is 55 x 77 in the 932x430 frame
  const land = fitGrid({ width: 780, height: 162, gap: GAP, min: tileMin('compact-land') });
  assert.equal(Math.round(land.cw), 55);
  assert.equal(Math.round((land.cw * 7) / 5), 77);
});

test('the minimum tile: 88 px, 55 px on compact-land only (8.1, D-60)', () => {
  for (const c of ['compact-port', 'medium', 'expanded', 'tiny']) assert.equal(tileMin(c), 88, c);
  assert.equal(tileMin('compact-land'), 55);
});

test('the fitter: the most tiles that fit, at least 2 rows, no tile below the minimum, the tiles inside the box', () => {
  for (let w = 200; w <= 2000; w += 37) {
    for (let h = 180; h <= 1000; h += 23) {
      for (const min of [55, 88]) {
        const r = fitGrid({ width: w, height: h, gap: GAP, min });
        assert.ok(r.cw >= min || r.rows === 1, `${w}x${h}: tile ${r.cw} below ${min}`);
        assert.ok(r.cols * r.cw + (r.cols - 1) * GAP <= w + 1e-6, `${w}x${h}: wider than the box`);
        assert.ok(r.rows * (r.cw * 7) / 5 + (r.rows - 1) * GAP <= h + 1e-6, `${w}x${h}: taller than the box`);
        // no other grid of at least 2 rows with tiles at the minimum holds more cards (3.4 G-197)
        for (let rows = 2; rows <= 12; rows++) {
          const cols = Math.floor((w + GAP) / (min + GAP));
          const cw = Math.min((w - (cols - 1) * GAP) / cols, ((h - (rows - 1) * GAP) / rows) * 5 / 7);
          if (cols >= 1 && cw >= min) assert.ok(r.per >= cols * rows, `${w}x${h}: ${cols}x${rows} fits more than ${r.per}`);
        }
        if (r.rows === 1) assert.ok(((h - GAP) / 2) * 5 / 7 < min, `${w}x${h}: 1 row although 2 rows fit`);
      }
    }
  }
});

test('the Filters button: each panel group with a choice counts 1; the search does not count (D-39)', () => {
  assert.equal(activeFilterCount(FILTER_DEFAULTS), 0);
  assert.equal(filtersLabel(0), 'Filters');
  const one = { own: 'owned' }, two = { rarity: 'gold' }, three = { element: 'fire' }, four = { type: 'item' }, five = { game: 'smash' };
  for (const part of [one, two, three, four, five]) assert.equal(activeFilterCount({ ...FILTER_DEFAULTS, ...part }), 1, JSON.stringify(part));
  assert.equal(activeFilterCount({ ...FILTER_DEFAULTS, own: 'ascend', rarity: 'gold' }), 2);
  assert.equal(activeFilterCount({ own: 'missing', rarity: 'normal', element: 'ice', type: 'place', game: 'meme', q: 'abc' }), 5);
  assert.equal(filtersLabel(2), 'Filters (2)');
});

test('the pager: "page / pages", the page stays inside the pages', () => {
  assert.deepEqual(pageOf({ total: 352, per: 24, page: 0 }), { page: 0, pages: 15, start: 0 });
  assert.deepEqual(pageOf({ total: 352, per: 24, page: 14 }), { page: 14, pages: 15, start: 336 });
  assert.deepEqual(pageOf({ total: 352, per: 24, page: 99 }), { page: 14, pages: 15, start: 336 });   // fewer cards after a filter
  assert.deepEqual(pageOf({ total: 352, per: 24, page: -3 }), { page: 0, pages: 15, start: 0 });
  assert.deepEqual(pageOf({ total: 0, per: 24, page: 2 }), { page: 0, pages: 1, start: 0 });        // no card: 1 / 1
  assert.equal(pageOf({ total: 352, per: 16, page: 0 }).pages, 22);   // 430x932 frame: "1 / 22"
  assert.equal(pageOf({ total: 352, per: 6, page: 0 }).pages, 59);    // 375x667 frame: "1 / 59"
});

const card = (id, o = {}) => ({ id, name: `Card ${id}`, season: 'Season 1', rarity: 'normal', owned: true, can_ascend: false, tags: { type: 'creature', origin: ['pokemon'], traits: [] }, ...o });
const elementOf = (c) => c.tags?.traits?.[0] || null;
test('the filters: Can ascend shows only the owned cards that can ascend now (D-33); the rest as the v2 Collection', () => {
  const cards = [card(1, { can_ascend: true }), card(2), card(3, { owned: false, can_ascend: true }), card(4, { rarity: 'gold', tags: { type: 'item', origin: ['smash'], traits: ['fire'] } }), card(5, { season: 'Season 2' })];
  const ids = (f, q = '') => filterCards(cards, { ...FILTER_DEFAULTS, ...f }, { season: 'Season 1', q, elementOf }).map((c) => c.id);
  assert.deepEqual(ids({}), [1, 2, 3, 4]);
  assert.deepEqual(ids({ own: 'ascend' }), [1]);
  assert.deepEqual(ids({ own: 'owned' }), [1, 2, 4]);
  assert.deepEqual(ids({ own: 'missing' }), [3]);
  assert.deepEqual(ids({ rarity: 'gold' }), [4]);
  assert.deepEqual(ids({ element: 'fire' }), [4]);
  assert.deepEqual(ids({ type: 'item' }), [4]);
  assert.deepEqual(ids({ game: 'smash' }), [4]);
  assert.deepEqual(ids({}, 'card 2'), [2]);
  assert.deepEqual(ids({}, 'SMASH'), [4]);
});

test('the set line and the card number, as drawn', () => {
  const inSeason = [card(1), card(2), card(3, { owned: false })];
  assert.equal(setLine({ inSeason, filtered: inSeason, filtering: false }), '2/3 · 67%');
  assert.equal(setLine({ inSeason, filtered: [], filtering: true }), '0 cards · 0 owned');
  assert.equal(setLine({ inSeason, filtered: [card(1)], filtering: true }), '1 card · 1 owned');
  assert.equal(numLabel({ set_number: 3 }), '#003');
  assert.equal(numLabel({ num: 14 }), '#014');
});
