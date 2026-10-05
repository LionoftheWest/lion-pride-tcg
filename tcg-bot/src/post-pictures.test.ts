import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rarePulls, pullPostText, cardsToPost, pullPostsEnabled } from './pull-posts.js';
import { cleanTradeSpec, tradePicture, tradePicturesEnabled } from './trade-pictures.js';
import { shownTarget, playPicturesEnabled } from './effect-notify.js';
import { renderRarePull, renderPlay, renderTrade } from './post-pictures.js';

const c = (name: string, rarity: string) => ({ name, rarity, image_url: null });
const PNG = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

test('only Full Art and Gold make a rare pull post, the rarest first', () => {
  const packs = [[c('A', 'normal'), c('B', 'full_art'), c('C', 'secret_rare')], [c('D', 'gold'), c('E', 'illustrated_rare')]];
  assert.deepEqual(rarePulls(packs).map((x) => x.name), ['D', 'B']);
  assert.deepEqual(rarePulls([[c('A', 'normal'), c('C', 'secret_rare'), c('X', 'event')]]), [], 'no rare card: no post');
});

test('the rare pull post pings the member and names the cards', () => {
  const t = pullPostText('123456789012345678', [c('Mr. Mime', 'gold'), c('Pikachu', 'full_art')]);
  assert.match(t, /<@123456789012345678>/);
  assert.match(t, /GOLD PULL/);
  assert.match(t, /\*\*Mr\. Mime\*\* and \*\*Pikachu\*\*/);
  assert.match(pullPostText('1', [c('Pikachu', 'full_art')]), /FULL ART PULL/);
});

test('every picture flag is OFF by default, and then nothing posts or draws', async () => {
  for (const k of ['FEATURE_PULL_POSTS', 'FEATURE_PLAY_PICTURES', 'FEATURE_TRADE_PICTURES']) delete process.env[k];
  assert.equal(pullPostsEnabled(), false);
  assert.equal(playPicturesEnabled(), false);
  assert.equal(tradePicturesEnabled(), false);
  assert.deepEqual(cardsToPost([[c('D', 'gold')]]), [], 'flag OFF: a Gold pull posts nothing');
  assert.equal(await tradePicture({ type: 'trade', kind: 'offer', offerId: 1 }), null);
});

test('with a flag ON the post goes past the gate', async () => {
  process.env.FEATURE_PULL_POSTS = '1'; process.env.FEATURE_TRADE_PICTURES = '1';
  const url = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
  try {
    assert.deepEqual(cardsToPost([[c('D', 'gold')]]).map((x) => x.name), ['D']);
    // Past the gate it reads the database (no env here, so it throws): the flag let it through.
    await assert.rejects(tradePicture({ type: 'trade', kind: 'offer', offerId: 1 }));
  } finally {
    delete process.env.FEATURE_PULL_POSTS; delete process.env.FEATURE_TRADE_PICTURES;
    if (url) process.env.SUPABASE_URL = url;
  }
});

test('the trade picture spec is allow-listed', () => {
  assert.deepEqual(cleanTradeSpec({ type: 'trade', kind: 'accepted', offerId: 5 }), { type: 'trade', kind: 'accepted', offerId: 5 });
  assert.deepEqual(cleanTradeSpec({ type: 'gift', fromId: '123456789012345678', toId: '223456789012345678', cardId: 9, extra: 1 }),
    { type: 'gift', fromId: '123456789012345678', toId: '223456789012345678', cardId: 9 });
  for (const bad of [null, 'x', { type: 'trade', kind: 'steal', offerId: 5 }, { type: 'trade', kind: 'offer', offerId: '5' }, { type: 'trade', kind: 'offer', offerId: -1 },
    { type: 'gift', fromId: 'abc', toId: '223456789012345678', cardId: 9 }, { type: 'gift', fromId: '123456789012345678', toId: '223456789012345678', cardId: 1.5 }]) {
    assert.equal(cleanTradeSpec(bad), null, JSON.stringify(bad));
  }
});

test('the play picture shows the member it was aimed at, or the new target of a redirect / delay', () => {
  const p = { target_id: 'T', aimed_at: 'A' };
  for (const o of ['applied', 'blocked', 'reflected', 'decoyed']) assert.equal(shownTarget({ ...p, outcome: o }), 'A', o);
  for (const o of ['redirected', 'delayed']) assert.equal(shownTarget({ ...p, outcome: o }), 'T', o);
});

test('each renderer draws a PNG with no avatars or art', async () => {
  assert.ok(PNG(await renderRarePull({ name: 'ΜΙΣΤΥ Я', avatar: null, cards: [{ name: 'A', rarity: 'gold', art: null }, { name: 'B', rarity: 'full_art', art: null }] })));
  for (const outcome of ['applied', 'blocked', 'reflected', 'decoyed', 'redirected', 'delayed']) {
    assert.ok(PNG(await renderPlay({ kind: 'prank', outcome, sender: 'Misty 🐊', senderAvatar: null, target: 'B', targetAvatar: null, card: 'C', art: null, rarity: 'normal', effectName: 'E', effectDesc: 'A long effect text '.repeat(12) })), outcome);
  }
  for (const kind of ['offer', 'picked', 'accepted', 'gift'] as const) {
    assert.ok(PNG(await renderTrade({ kind, from: 'A', fromAvatar: null, to: 'B', toAvatar: null, offer: { name: 'X', rarity: 'secret_rare', art: null }, request: kind === 'offer' ? null : { name: 'Y', rarity: 'secret_rare', art: null } })), kind);
  }
});
