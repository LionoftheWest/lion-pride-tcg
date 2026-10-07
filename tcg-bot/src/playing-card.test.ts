import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPlayingCard, W, H, RARITY } from './playing-card.js';
import { rarePulls } from './pull-posts.js';
import { cleanActivity } from './playing-posts.js';

// PNG: the 8-byte signature, then the IHDR chunk with the width and height.
const size = (png: Buffer): [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)];
const isPng = (png: Buffer): boolean => png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

test('a member with no picture and no pull today still renders a 1200x630 PNG', async () => {
  const png = await renderPlayingCard({ name: 'brock718', line: 'was playing', live: false, avatar: null, tag: 'NO PULLS YET TODAY', frame: null });
  assert.ok(isPng(png));
  assert.deepEqual(size(png), [W, H]);
});

test('a broken picture or avatar and a very long line do not stop the render', async () => {
  const junk = Buffer.from('not an image');
  const png = await renderPlayingCard({ name: 'A very long member name that must shrink to fit', line: 'is fighting The Very Long Name Of A Raid Boss That Goes On',
    live: true, avatar: junk, tag: 'RAID BOSS', frame: { art: junk, color: '#FF6B7D' } });
  assert.ok(isPng(png));
  assert.deepEqual(size(png), [W, H]);
});

test('the activity from the Activity server is allow-listed', () => {
  assert.equal(cleanActivity({ kind: 'dancing' }), null);
  assert.equal(cleanActivity(null), null);
  const a = cleanActivity({ kind: 'fighting', label: 'The Rage-Quit Warlord and a lot more text', image: 'boss/thumbs/warrok.png', extra: 'x' })!;
  assert.equal(a.kind, 'fighting');
  assert.equal(a.label, 'The Rage-Quit Warlord an'); // 24 characters
  assert.equal(a.image, 'boss/thumbs/warrok.png');
  assert.equal('extra' in a, false);
  assert.equal(cleanActivity({ kind: 'fighting', image: '../../etc/passwd' })!.image, undefined);
  assert.equal(cleanActivity({ kind: 'fighting', image: 'https://evil.example/x.png' })!.image, undefined);
  assert.deepEqual(cleanActivity({ kind: 'opening', cards: [5, -1, 2.5, '7', 9, 10, 11, 12, 13] })!.cards, [5, 9, 10, 11, 12]);
});

test('the bot rarity order equals the one order (shared/rarity-rank.json, the same as SQL rarity_rank)', () => {
  const golden = (JSON.parse(readFileSync(new URL('../../shared/rarity-rank.json', import.meta.url), 'utf8')) as { rank: Record<string, number> }).rank;
  assert.deepEqual(Object.keys(RARITY).sort(), Object.keys(golden).sort());
  for (const [r, n] of Object.entries(golden)) assert.equal(RARITY[r].rank, n, r);
});

test('the rare pull post puts the Gold first (it reads the one rarity order)', () => {
  const c = (rarity: string) => ({ name: rarity, rarity, image_url: null });
  assert.deepEqual(rarePulls([[c('full_art'), c('normal')], [c('gold'), c('event')]]).map((x) => x.rarity), ['gold', 'full_art']);
});
