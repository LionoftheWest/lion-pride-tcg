// UI-34 / UI-35 the pack reveal: the logic that can be checked without a browser. node --test
// D-92 / D-109 the best card last, D-96 / D-107 the rare clip only on the pack with an SR+ card, D-101 the set's clips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestLast, bestIndex, revealOrder, rarePacks, fitCards, clipUrl, packSet, packStarts, fitPacks, balancedRows, newMark, PACK_RATIO, stackTimeline, stackDepth } from './pack-reveal.js';

const RANK = { normal: 0, illustrated_rare: 1, secret_rare: 2, full_art: 3, gold: 4, event: 3, promo: 2 };
const rank = (c) => RANK[c.rarity] ?? 0;
const C = (id, rarity) => ({ id, rarity });

test('D-92: the best card is last; the other cards keep their order', () => {
  const pack = [C(1, 'normal'), C(2, 'full_art'), C(3, 'normal'), C(4, 'illustrated_rare'), C(5, 'normal')];
  assert.deepEqual(bestLast(pack, rank).map((c) => c.id), [1, 3, 4, 5, 2]);
  // the best is already last: no change
  assert.deepEqual(bestLast([C(1, 'normal'), C(2, 'gold')], rank).map((c) => c.id), [1, 2]);
  // equal best ranks: the first of them goes last, so one card is "the best"
  assert.deepEqual(bestLast([C(1, 'secret_rare'), C(2, 'normal'), C(3, 'promo')], rank).map((c) => c.id), [2, 3, 1]);
  // an all-normal pack: the first card goes last (the order of a pack with no rare is not a promise)
  assert.equal(bestLast([C(1, 'normal'), C(2, 'normal')], rank).length, 2);
  assert.deepEqual(bestLast([], rank), []);
  // the input is not changed
  const input = [C(1, 'gold'), C(2, 'normal')];
  bestLast(input, rank);
  assert.deepEqual(input.map((c) => c.id), [1, 2]);
});

test('D-92: with 50 cards (a 10-pack open), the best card is the last of all', () => {
  const cards = Array.from({ length: 50 }, (_, i) => C(i, i === 17 ? 'gold' : i % 9 === 0 ? 'full_art' : 'normal'));
  const out = bestLast(cards, rank);
  assert.equal(out[out.length - 1].id, 17);
  assert.equal(out.length, 50);
  assert.equal(bestIndex(out, rank), 49);
});

test('D-109: Reveal all turns the face-down cards, the best card last', () => {
  assert.deepEqual(revealOrder([0, 1, 2, 3, 4], 4), [0, 1, 2, 3, 4]);
  assert.deepEqual(revealOrder([4, 2, 0], 4), [0, 2, 4], 'the best last even when the list is out of order');
  assert.deepEqual(revealOrder([3, 1, 4, 2], 1), [2, 3, 4, 1], 'the best card is not the last index');
  assert.deepEqual(revealOrder([0, 2], 4), [0, 2], 'the best card is already turned');
  assert.deepEqual(revealOrder([], 4), []);
});

test('D-96 / D-107: only the packs that hold an SR+ card play the rare clip', () => {
  const packs = [
    [C(1, 'normal'), C(2, 'illustrated_rare')],   // IR is not SR+
    [C(3, 'normal'), C(4, 'secret_rare')],
    [C(5, 'normal')],
    [C(6, 'promo')],
    [C(7, 'full_art'), C(8, 'gold')],
  ];
  assert.deepEqual(rarePacks(packs, rank), [1, 3, 4]);
  assert.deepEqual(rarePacks([[C(1, 'normal')]], rank), []);
  assert.deepEqual(rarePacks([], rank), []);
});

test('D-100: the packs start about 0.4 s apart', () => {
  assert.deepEqual(packStarts(5), [0, 400, 800, 1200, 1600]);
  assert.equal(packStarts(10).length, 10);
  assert.deepEqual(packStarts(0), []);
});

test('D-140: each pack is in front 0.4 s, a rare pack keeps its place and holds the front 1.4 s', () => {
  const t = stackTimeline(5, [1, 3]);
  assert.deepEqual(t.steps.map((s) => s.pack), [0, 1, 2, 3, 4], 'the rare packs stay in their real place');
  assert.deepEqual(t.steps.map((s) => s.start), [0, 400, 1800, 2200, 3600]);
  assert.deepEqual(t.steps.map((s) => s.left), [5, 4, 3, 2, 1], 'D-141: the packs left');
  assert.equal(t.end, 3600 + 1400, 'the cards come at the burst of the last pack');
  assert.deepEqual(stackTimeline(10, new Set()).steps.map((s) => s.start), packStarts(10), 'no rare pack: 0.4 s each');
  assert.equal(stackTimeline(10, []).end, 9 * 400 + 1400, '10 normal packs: 5.0 s');
  assert.deepEqual(stackTimeline(0), { steps: [], end: 0 });
  assert.equal(stackTimeline(3, [2]).steps[2].start, 800, 'a rare last pack: the same start');
});

test('D-142: at most 4 packs show behind the front pack', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((p) => stackDepth(p, 0)), [0, 1, 2, 3, 4, 4, 4]);
  assert.equal(stackDepth(3, 3), 0);
  assert.equal(stackDepth(2, 3), 0, 'a pack that is gone does not go below 0');
});

test('D-101: the clips come from the folder of the chosen set', () => {
  assert.equal(clipUrl('S1', 'idle_loop'), '/packs/S1/idle_loop.webp');
  assert.equal(clipUrl('S2', 'open'), '/packs/S2/open.webp');
  assert.equal(clipUrl('S2', 'open_rare'), '/packs/S2/open_rare.webp');
  assert.throws(() => clipUrl('S1', 'tear'));
  assert.equal(packSet('S2', 'S1'), 'S2', 'the set of the open wins');
  assert.equal(packSet(undefined, 'S3'), 'S3', 'a room open with no set: the set the member opens next');
  assert.equal(packSet(null, null), 'S1');
});

test('D-72: one screen: the card width shows every card in the area, 5:7', () => {
  for (const [n, w, h] of [[5, 398, 760], [5, 900, 300], [50, 398, 760], [50, 343, 560], [25, 1240, 600]]) {
    const { cw, cols } = fitCards(n, w, h, 8);
    const rows = Math.ceil(n / cols);
    assert.ok(cw > 0, `${n} cards in ${w}x${h}`);
    assert.ok(cols * cw + (cols - 1) * 8 <= w + 0.5, `${n} cards fit the width`);
    assert.ok(rows * (cw * 7 / 5) + (rows - 1) * 8 <= h + 1, `${n} cards fit the height`);
  }
  // the approved 430x932 single reveal: 2 columns
  assert.equal(fitCards(5, 398, 760, 12).cols, 2);
  // 932x430: one row of 5
  assert.equal(fitCards(5, 860, 300, 12).cols, 5);
});

test('D-100: the waiting packs: all packs show, the rows are balanced (10 = 4, 3, 3)', () => {
  assert.deepEqual(balancedRows(10, 3), [4, 3, 3]);
  assert.deepEqual(balancedRows(5, 2), [3, 2]);
  assert.deepEqual(balancedRows(10, 1), [10]);
  assert.deepEqual(balancedRows(10, 2), [5, 5]);
  assert.deepEqual(balancedRows(3, 9), [1, 1, 1], 'never more rows than packs');
  for (const [n, w, h] of [[5, 398, 560], [10, 398, 560], [10, 1240, 520], [10, 860, 260], [5, 343, 400]]) {
    const f = fitPacks(n, w, h, 12);
    const rows = f.rows.length;
    assert.equal(f.rows.reduce((a, b) => a + b, 0), n, `${n} packs, all shown`);
    assert.ok(Math.max(...f.rows) - Math.min(...f.rows) <= 1, `${n} packs, balanced rows ${f.rows}`);
    assert.ok(Math.max(...f.rows) * f.pw + (Math.max(...f.rows) - 1) * 12 <= w + 0.5, `${n} packs fit the width`);
    assert.ok(rows * (f.pw / PACK_RATIO) + (rows - 1) * 12 <= h + 1, `${n} packs fit the height`);
  }
  assert.deepEqual(fitPacks(10, 398, 520, 12).rows, [4, 3, 3], '10 packs in 3 rows: 4, 3, 3 (as drawn on 430x932)');
  assert.deepEqual(fitPacks(5, 398, 640, 12).rows, [3, 2], '5 packs in 2 rows: 3, 2 (as drawn on 430x932)');
  assert.deepEqual(fitPacks(10, 1240, 420, 12).rows, [10], 'a wide area: one row (as drawn on 1990x830)');
});

test('review-2: the New mark is a chip from 88 px, a small chip from 70 px, else a dot', () => {
  assert.equal(newMark(138), 'chip'); assert.equal(newMark(88), 'chip');
  assert.equal(newMark(87), 'small'); assert.equal(newMark(70), 'small');
  assert.equal(newMark(69), 'dot'); assert.equal(newMark(38), 'dot');
});
