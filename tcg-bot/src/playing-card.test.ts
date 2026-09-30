import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlayingCard, W, H } from './playing-card.js';

// PNG: the 8-byte signature, then the IHDR chunk with the width and height.
const size = (png: Buffer): [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)];
const isPng = (png: Buffer): boolean => png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

test('a member with no picture and no pull today still renders a 1200x630 PNG', async () => {
  const png = await renderPlayingCard({ name: 'blastninja718', playing: false, avatar: null, card: null, packs: 0, damage: 0 });
  assert.ok(isPng(png));
  assert.deepEqual(size(png), [W, H]);
});

test('a broken card image or avatar does not stop the render', async () => {
  const junk = Buffer.from('not an image');
  const png = await renderPlayingCard({ name: 'A very long member name that must shrink to fit', playing: true, avatar: junk,
    card: { name: 'A card with a very long name that is cut to fit under the frame', rarity: 'gold', art: junk }, packs: 12, damage: 123456 });
  assert.ok(isPng(png));
  assert.deepEqual(size(png), [W, H]);
});
