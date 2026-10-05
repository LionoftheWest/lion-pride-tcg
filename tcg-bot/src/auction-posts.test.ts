import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPost, minLine, leftText, auctionPostsEnabled, START_WINDOW_MS } from './auction-posts.js';
import { cleanTradeSpec } from './trade-pictures.js';
import { renderAuction, renderListing } from './post-pictures.js';

const NOW = Date.parse('2026-10-02T18:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const row = (o: Partial<Parameters<typeof nextPost>[0]>) => ({ status: 'live', created_at: ago(60_000), settled_at: null, notice_message_id: null, notice_dirty: true, ...o });

test('a new auction gets a start post once; an old one (made while the flag was off) is skipped', () => {
  assert.equal(nextPost(row({}), NOW), 'start');
  assert.equal(nextPost(row({ notice_message_id: 'posted' }), NOW), null, 'posted already');
  assert.equal(nextPost(row({ notice_message_id: 'posted', notice_dirty: true }), NOW), null, 'a bid (dirty) on a live auction posts nothing');
  assert.equal(nextPost(row({ created_at: ago(START_WINDOW_MS + 1) }), NOW), 'skip');
});

test('an ended auction gets one end post; an old end is skipped; no end post twice', () => {
  for (const status of ['sold', 'closed', 'expired']) {
    assert.equal(nextPost(row({ status, notice_message_id: 'posted', settled_at: ago(30_000) }), NOW), 'end', status);
    assert.equal(nextPost(row({ status, notice_message_id: 'posted', notice_dirty: false, settled_at: ago(30_000) }), NOW), null, `${status} posted already`);
    assert.equal(nextPost(row({ status, settled_at: ago(START_WINDOW_MS + 1) }), NOW), 'skip-end', `${status} old`);
  }
  assert.equal(nextPost(row({ status: 'accepted', notice_message_id: 'posted' }), NOW), null, 'accepted is not the end');
});

test('the minimum line and the time left', () => {
  assert.equal(minLine({ min_rarity: 'full_art', min_count: 2, min_mode: 'and' }, ['Coral Siren']), '2× Full Art + Coral Siren');
  assert.equal(minLine({ min_rarity: 'full_art', min_count: 1, min_mode: 'or' }, ['A', 'B']), '1× Full Art or A or B');
  assert.equal(minLine({ min_rarity: null, min_count: 0, min_mode: 'and' }, []), 'Any bid');
  assert.equal(leftText(new Date(NOW + 2 * 86400e3 + 3 * 3600e3).toISOString(), NOW), '2d 3h');
  assert.equal(leftText(new Date(NOW + 5 * 60e3).toISOString(), NOW), '5m');
});

test('the auction posts flag is OFF by default', () => {
  delete process.env.FEATURE_AUCTION_POSTS;
  assert.equal(auctionPostsEnabled(), false);
});

test('the listing picture spec is allow-listed', () => {
  assert.deepEqual(cleanTradeSpec({ type: 'listing', listingId: 7, x: 1 }), { type: 'listing', listingId: 7 });
  for (const bad of [{ type: 'listing' }, { type: 'listing', listingId: '7' }, { type: 'listing', listingId: 0 }]) assert.equal(cleanTradeSpec(bad), null, JSON.stringify(bad));
});

test('the listing and auction renderers draw a PNG with no art', async () => {
  const PNG = (b: Buffer) => b.subarray(0, 4).toString('hex') === '89504e47';
  const c = { name: 'Glacier Wolf', rarity: 'gold', art: null };
  assert.ok(PNG(await renderListing({ name: 'ΜΙΣΤΥ Я', avatar: null, card: c, wants: [c, c] })));
  for (const phase of ['start', 'end'] as const) for (const kind of ['sold', 'closed', 'expired'] as const) {
    assert.ok(PNG(await renderAuction({ phase, seller: 'Misty 🐊', sellerAvatar: null, card: c, min: '2× Full Art', endsIn: '2d 3h', bids: 4,
      result: phase === 'end' ? { kind, winner: 'Kira', winnerAvatar: null, cards: [c, c] } : undefined })), `${phase} ${kind}`);
  }
});
