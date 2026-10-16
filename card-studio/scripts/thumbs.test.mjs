// node --test scripts/thumbs.test.mjs  (no network). The thumbnails that push.js and make-thumbs.mjs upload
// reach fetch() as the exact image bytes (2026-10-16: the sharp WebAssembly build gave a SharedArrayBuffer view,
// fetch sent it as UTF-8 text, and 22 live thumbnails were broken).
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { makeThumbs } from '../src/thumbs.js';

// The bytes that fetch() would send for this body.
const sent = async (body) => Buffer.from(await new Request('http://x.test/', { method: 'POST', body }).arrayBuffer());
const decodes = async (b) => (await sharp(b, { animated: true }).raw().toBuffer()).length > 0;

test('a still card: the grid thumbnail reaches fetch() unchanged and decodes', async () => {
  const png = await sharp({ create: { width: 500, height: 700, channels: 4, background: '#c84' } }).png().toBuffer();
  const th = await makeThumbs(Buffer.from(png));
  assert.equal(th.animated, false);
  assert.equal(th.reveal, null);
  assert.ok((await sent(th.grid)).equals(th.grid), 'fetch() changed the grid bytes');
  assert.ok(await decodes(await sent(th.grid)));
});

test('an animated card: the grid and reveal thumbnails reach fetch() unchanged and decode', async () => {
  const frame = (c) => sharp({ create: { width: 500, height: 700, channels: 4, background: c } }).png().toBuffer();
  const frames = await Promise.all(['#c84', '#48c'].map(frame));
  const anim = await sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  const th = await makeThumbs(Buffer.from(anim));
  assert.equal(th.animated, true);
  for (const k of ['grid', 'reveal']) {
    assert.ok((await sent(th[k])).equals(th[k]), `fetch() changed the ${k} bytes`);
    assert.ok(await decodes(await sent(th[k])), k);
  }
});
