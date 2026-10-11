// UI-27 the Boons tab: the rules that can be checked without a browser. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playHistory, memberReason, dayLine, leftPct, pageOf, pickerCards, kindName } from './boons.js';

test('playHistory: only my plays, never on me, the target as the partner', () => {
  const plays = [
    { from_id: 'tst_me', to_id: 'tst_a', to: 'a', at: '2026-10-01T00:00:00Z' },
    { from_id: 'tst_x', to_id: 'tst_b', to: 'b', at: '2026-10-01T00:00:00Z' },
    { from_id: 'tst_me', to_id: 'tst_me', to: 'me', at: '2026-10-01T00:00:00Z' },
    { from_id: 'tst_me', to_id: 'tst_a', to: 'a', at: '2026-10-02T00:00:00Z' },
  ];
  assert.deepEqual(playHistory(plays, 'tst_me').map((h) => h.id), ['tst_a', 'tst_a']);
  assert.deepEqual(playHistory(null, 'tst_me'), []);
});

test('memberReason: blocked at the pair cap, open under it, open with no cap', () => {
  const m = { id: 'tst_a', name: 'Ann' };
  assert.equal(memberReason(m, { pairs: { tst_a: 3 }, caps: { pair_per_day: 3 } }), 'You played 3 cards on Ann today.');
  assert.equal(memberReason(m, { pairs: { tst_a: 2 }, caps: { pair_per_day: 3 } }), '');
  assert.equal(memberReason(m, { pairs: { tst_a: 9 }, caps: {} }), '');
  assert.equal(memberReason(null, {}), '');
});

test('dayLine: the line only when every play is used', () => {
  const f = (s) => `${s}s`;
  assert.equal(dayLine({ cap: 10, used: 10, resetIn: 60 }, f), 'You played your 10 cards today. New plays in 60s.');
  assert.equal(dayLine({ cap: 10, used: 9, resetIn: 60 }, f), '');
  assert.equal(dayLine({ cap: 0, used: 0 }, f), '');
});

test('leftPct: the time left of the whole, 100 with no end', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(leftPct(3600, '2026-10-01T12:30:00Z', now), 50);
  assert.equal(leftPct(3600, '2026-10-01T11:00:00Z', now), 0);
  assert.equal(leftPct(null, null, now), 100);
});

test('pageOf: whole pages, the page stays inside the range, at least one row per page', () => {
  const l = [1, 2, 3, 4, 5];
  assert.deepEqual(pageOf(l, 2, 0), { rows: [1, 2], page: 0, pages: 3 });
  assert.deepEqual(pageOf(l, 2, 9), { rows: [5], page: 2, pages: 3 });
  assert.deepEqual(pageOf(l, 0, 0).rows, [1]);
  assert.deepEqual(pageOf([], 3, 0), { rows: [], page: 0, pages: 1 });
});

test('pickerCards: effect cards only, the kind switch (neutral = shield), search, ready first', () => {
  const kinds = { 1: 'boon', 2: 'prank', 3: 'neutral', 4: 'boon' };
  const cards = [
    { id: 1, name: 'Alpha', power: 5, rarity: 'normal', effect: { primitive: 'p' } },
    { id: 2, name: 'Beta', power: 9, rarity: 'full_art', effect: { primitive: 'p' } },
    { id: 3, name: 'Gamma', power: 7, rarity: 'normal', effect: { primitive: 'p' } },
    { id: 4, name: 'Delta', power: 8, rarity: 'normal', effect: { primitive: 'p' } },
    { id: 5, name: 'Plain', power: 99, rarity: 'normal' },
  ];
  const kindOf = (c) => kinds[c.id];
  const ids = (v, q = '', ready) => pickerCards(cards, v, q, kindOf, ready).map((c) => c.id);
  assert.deepEqual(ids({ kind: 'all' }), [2, 4, 3, 1], 'a card with no effect is not listed; strongest first');
  assert.deepEqual(ids({ kind: 'shield' }), [3]);
  assert.deepEqual(ids({ kind: 'boon' }), [4, 1]);
  assert.deepEqual(ids({ kind: 'all', rarity: 'full_art' }), [2]);
  assert.deepEqual(ids({ kind: 'all' }, 'gam'), [3]);
  assert.deepEqual(ids({ kind: 'all' }, '', (c) => (c.id === 2 ? 60 : 0)), [4, 3, 1, 2], 'a card on cooldown goes last');
  assert.equal(kindName('neutral'), 'shield');
});
