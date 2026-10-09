// UI-24 the bell window: the logic that can be checked without a browser. node --test
// 3.4 / G-022 the list pages (no row dropped), D-80 22 the Hunt card on page 2 (compact-land), 5.2 the kind icons,
// 10.1 the glossary (Claim, HUNT), 7.3 the claim error line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packPages, packColumns, noteIcon, bellUnits, CLAIM_ERROR } from './bell.js';

const H = (h, x = {}) => ({ h, ...x });

test('3.4: the rows that fit, then the next page; every row is on exactly one page', () => {
  const units = [H(20, { head: true }), H(50, { section: 'a' }), H(50, { section: 'a' }), H(50, { section: 'a' }), H(50, { section: 'a' })];
  const { pages } = packPages(units, { full: 300, paged: 300, gap: 10 });
  assert.deepEqual(pages, [[0, 1, 2, 3, 4]], 'all fit: one page');
  const p2 = packPages(units, { full: 200, paged: 150, gap: 10 }).pages;
  // with the pager (150): head 20 + 50 + 50 = 140 incl. gaps; then the head again on the next page
  assert.deepEqual(p2, [[0, 1, 2], [0, 3, 4]]);
  const rows = p2.flat().filter((i) => i !== 0).sort();
  assert.deepEqual(rows, [1, 2, 3, 4], 'no row dropped, none twice');
});

test('3.4: the paged height is used once there are 2 pages (the pager takes its room)', () => {
  const units = [H(50), H(50), H(50)];
  assert.equal(packPages(units, { full: 170, paged: 100, gap: 10 }).pages.length, 1, '3 rows fit the full height');
  assert.deepEqual(packPages(units, { full: 120, paged: 60, gap: 10 }).pages, [[0], [1], [2]]);
});

test('a section head never ends a page', () => {
  const units = [H(50), H(50), H(20, { head: true }), H(50, { section: 'e' })];
  const { pages } = packPages(units, { full: 140, paged: 140, gap: 10 });
  assert.deepEqual(pages, [[0, 1], [2, 3]]);
});

test('D-80 22: the page2 unit (the Hunt card on compact-land) starts page 2, before the rows that go on', () => {
  const units = [H(80, { page2: true }), H(20, { head: true }), H(50, { section: 'e' }), H(50, { section: 'e' }), H(50, { section: 'e' })];
  const { pages } = packPages(units, { full: 200, paged: 140, gap: 10 });
  assert.deepEqual(pages[0], [1, 2, 3], 'page 1: the rows');
  assert.equal(pages[1][0], 0, 'page 2 starts with the Hunt card');
  assert.ok(pages[1].includes(4), 'the next rows follow');
  const few = packPages([H(80, { page2: true }), H(50)], { full: 400, paged: 340, gap: 10 }).pages;
  assert.deepEqual(few, [[1], [0]], 'even when all would fit, the Hunt card is on page 2');
  assert.deepEqual(packPages([H(80, { page2: true })], { full: 400, paged: 340, gap: 10 }).pages, [[0]], 'alone: page 1');
});

test('5.2: one SVG icon for each kind, never an emoji', () => {
  assert.equal(noteIcon('pack_earned'), 'package');
  assert.equal(noteIcon('pack_gift'), 'gift');
  assert.equal(noteIcon('card_gift'), 'layers');
  assert.equal(noteIcon('trade_offer'), 'arrow-left-right');
  assert.equal(noteIcon('trade_counter'), 'arrow-left-right');
  assert.equal(noteIcon('trade_accepted'), 'circle-check');
  assert.equal(noteIcon('auction_bid'), 'landmark');
  assert.equal(noteIcon('hunt_down'), 'swords');
  assert.equal(noteIcon('something_new'), 'bell');
});

const base = (x = {}) => ({
  tab: 'all', items: [], gifts: [], hunt: null, unread: 0, giftError: false, page: 1, expanded: new Set(), size: 'expanded', now: Date.parse('2026-10-04T12:00:00Z'),
  kindOf: (k) => (k === 'trade_offer' ? { tab: 'trades', label: 'Trade offer', act: 'View' } : { tab: 'all', label: 'Pack', act: 'Open' }),
  strip: (t) => t, ago: () => '2d', thumb: (u) => u, coin: '<svg></svg>', rarityLabel: (r) => (r === 'event' ? 'Event' : r), ...x,
});
const text = (units) => units.map((u) => u.html).join('').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('10.1: Gifts to claim, Claim, Claim all +N (packs only); the claim error only after a refusal', () => {
  const gifts = [{ id: 1, kind: 'packs', title: 'Bonus', amount: 10 }, { id: 2, kind: 'card', title: 'Event gift', card: { rarity: 'event', image_url: '/x.png' } }, { id: 3, kind: 'packs', title: 'Make-up', amount: 5 }];
  const u = bellUnits(base({ gifts }));
  const t = text(u);
  assert.match(t, /Gifts to claim/);
  assert.match(t, /Claim all \+15/);
  assert.equal((t.match(/ Claim (?!all)/g) || []).length, 3, 'one Claim on each gift');
  assert.doesNotMatch(t, /Redeem/);
  assert.match(t, /Event card/);
  assert.ok(!t.includes(CLAIM_ERROR));
  assert.ok(text(bellUnits(base({ gifts, giftError: true }))).includes(CLAIM_ERROR));
  assert.doesNotMatch(text(bellUnits(base({ gifts: [gifts[0]] }))), /Claim all/, 'one gift: no Claim all');
  assert.equal(u.filter((x) => x.html.includes('u3-btn--primary')).length, 1, 'one primary button (5.3)');
});

test('the Hunt card: HUNT (not PRIDE HUNT), not on the Trades tab, on no page 2 any more (Nathan 2026-10-09)', () => {
  const hunt = { name: 'Boss', hp_remaining: 50, hp_max: 100 };
  const t = text(bellUnits(base({ hunt })));
  assert.match(t, /HUNT Boss/);
  assert.doesNotMatch(t, /PRIDE/);
  assert.equal(bellUnits(base({ hunt, tab: 'trades' })).length, 0);
  assert.ok(!bellUnits(base({ hunt, size: 'compact-land' }))[0].page2, 'compact-land: the Hunt card stays in the flow, no pager lift');
  assert.ok(!bellUnits(base({ hunt }))[0].page2);
});

test('rows: Today and Earlier, the tab filter, the unread mark, the full text after a tap (10.4)', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const items = [{ id: 7, kind: 'pack_earned', message: 'You earned 1 pack!', read: false, created_at: new Date(now - 3600e3).toISOString() },
    { id: 8, kind: 'trade_offer', message: 'An offer', read: true, created_at: new Date(now - 3 * 86400e3).toISOString() }];
  const u = bellUnits(base({ items, now }));
  assert.match(text(u), /Today You earned 1 pack! Pack Open 2d Earlier An offer Trade offer View 2d/);
  assert.equal(u.filter((x) => x.html.includes('is-unread')).length, 1);
  assert.ok(u.find((x) => x.note === 7).html.includes('data-trunc'), 'the body is marked as a permitted truncation');
  assert.ok(!u.find((x) => x.note === 7).html.includes('is-full'));
  assert.ok(bellUnits(base({ items, now, expanded: new Set([7]) })).find((x) => x.note === 7).html.includes('is-full'));
  assert.deepEqual(bellUnits(base({ items, now, tab: 'trades' })).filter((x) => x.note).map((x) => x.note), [8]);
});

test('compact-land (Nathan 2026-10-09): the rows stand in columns and fit one screen: no pager while they fit', () => {
  const units = [H(20, { head: true }), ...[1, 2, 3, 4, 5, 6].map(() => H(40, { section: 'a' }))];
  // a column of 140 holds the head and 2 rows: 6 rows need 3 columns
  assert.deepEqual(packColumns(units, { full: 140, paged: 100, gap: 10, cols: 3 }), [[[0, 1, 2], [0, 3, 4], [0, 5, 6]]], '3 columns, one page, the head again on each column');
  const two = packColumns(units, { full: 140, paged: 100, gap: 10, cols: 2 });
  assert.ok(two.length > 1, '6 rows do not fit 2 columns: the pager comes back (a row is never hidden)');
  assert.ok(two.every((p) => p.length <= 2), 'at most 2 columns on a page');
  const rows = two.flat(2).filter((i) => i !== 0).sort();
  assert.deepEqual(rows, [1, 2, 3, 4, 5, 6], 'every row on exactly one page');
  assert.deepEqual(packColumns(units, { full: 400, paged: 340, gap: 10, cols: 1 }), [[[0, 1, 2, 3, 4, 5, 6]]], 'cols 1 = packPages');
});
