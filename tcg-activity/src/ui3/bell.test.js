// UI-24 the bell window: the logic that can be checked without a browser. node --test
// D-144 the list scrolls in a named scroll area (no pager, no row dropped), 5.2 the kind icons,
// 10.1 the glossary (Claim, HUNT), 7.3 the claim error line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteIcon, bellUnits, CLAIM_ERROR } from './bell.js';

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

test('the Hunt card: HUNT (not PRIDE HUNT), not on the Trades tab', () => {
  const hunt = { name: 'Boss', hp_remaining: 50, hp_max: 100 };
  const t = text(bellUnits(base({ hunt })));
  assert.match(t, /HUNT Boss/);
  assert.doesNotMatch(t, /PRIDE/);
  assert.equal(bellUnits(base({ hunt, tab: 'trades' })).length, 0);
  assert.ok(!bellUnits(base({ hunt }))[0].scroll, 'the Hunt card stays fixed above the scroll area');
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

test('D-144: the Earlier rows scroll (Today rows when no Earlier); heads, gifts and the Hunt card stay fixed', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const row = (id, ago) => ({ id, kind: 'pack_earned', message: 'm', read: true, created_at: new Date(now - ago).toISOString() });
  const both = bellUnits(base({ now, items: [row(1, 3600e3), row(2, 3 * 86400e3), row(3, 4 * 86400e3)], hunt: { name: 'B', hp_remaining: 1, hp_max: 2 } }));
  assert.deepEqual(both.filter((u) => u.scroll).map((u) => u.note), [2, 3]);
  assert.ok(both.filter((u) => u.head).every((u) => !u.scroll), 'section heads are never in the area');
  const today = bellUnits(base({ now, items: [row(1, 3600e3), row(4, 7200e3)] }));
  assert.deepEqual(today.filter((u) => u.scroll).map((u) => u.note), [1, 4], 'no Earlier: the Today rows scroll');
});
