// The Activity image copies a fixed list of top-level files (Dockerfile). A server module that is imported but not
// copied stops the container at start (2026-10-07: logs.js, PR #255; the deploy rolled back). This test fails first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const copied = new Set(readFileSync(new URL('Dockerfile', dir), 'utf8').split('\n')
  .filter((l) => /^COPY /.test(l)).flatMap((l) => l.trim().split(/\s+/).slice(1, -1)));

test('every local module that a copied top-level file imports is copied too', () => {
  const tops = readdirSync(dir).filter((f) => /\.(m?js)$/.test(f) && !/\.test\./.test(f) && copied.has(f));
  const missing = [];
  for (const f of tops) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/from '\.\/([^'/]+\.m?js)'/g)) if (!copied.has(m[1])) missing.push(`${f} -> ${m[1]}`);
  }
  assert.deepEqual(missing, [], 'add these files to the COPY line of tcg-activity/Dockerfile');
});
