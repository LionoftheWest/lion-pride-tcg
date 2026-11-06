// R2-MOVE: tcg-activity/art-url.js against the shared vectors (shared/art-url-vectors.json; the same file tests the bot and
// the card studio copies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artKey, artVersion, r2Url, r2FromLogical } from './art-url.js';

const V = JSON.parse(readFileSync(new URL('../shared/art-url-vectors.json', import.meta.url), 'utf8'));

test('artKey / artVersion: every vector', () => {
  for (const c of V.key) {
    assert.equal(artKey(c.in), c.key, `artKey ${c.in}`);
    if (c.key) assert.equal(artVersion(c.in), c.v, `artVersion ${c.in}`);
  }
});
test('r2Url: every vector', () => {
  for (const c of V.r2) assert.equal(r2Url(c.key, c.v, V.r2Base), c.out);
  assert.equal(r2Url('card-art/a.png', null, V.r2Base + '/'), `${V.r2Base}/card-art/a.png`, 'a trailing slash on the base');
});
test('r2FromLogical: every vector', () => {
  for (const c of V.logical) assert.equal(r2FromLogical(c.in, V.r2Base), c.out);
});
