// R2-MOVE: tcg-bot/src/art-url.ts against the shared vectors (shared/art-url-vectors.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artKey, artVersion, r2Url, r2FromLogical } from './art-url.js';

type Vectors = {
  r2Base: string;
  key: { in: string | null; key: string | null; v: string | null }[];
  r2: { key: string; v: string | null; out: string }[];
  logical: { in: string | null; out: string | null }[];
};
const V = JSON.parse(readFileSync(new URL('../../shared/art-url-vectors.json', import.meta.url), 'utf8')) as Vectors;

test('artKey / artVersion: every vector', () => {
  for (const c of V.key) {
    assert.equal(artKey(c.in), c.key, `artKey ${c.in}`);
    if (c.key) assert.equal(artVersion(c.in), c.v, `artVersion ${c.in}`);
  }
});
test('r2Url: every vector', () => {
  for (const c of V.r2) assert.equal(r2Url(c.key, c.v, V.r2Base), c.out);
});
test('r2FromLogical: every vector', () => {
  for (const c of V.logical) assert.equal(r2FromLogical(c.in, V.r2Base), c.out);
});
