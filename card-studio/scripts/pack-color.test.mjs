// node --test scripts/pack-color.test.mjs  (no network). The pack color rule of the studio Sets page (D-191) = pack_color_ok in SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packColorError, packColorHsl } from '../public/admin/pack-color.js';

test('the two live pack colors pass (S1 Origins, S2 Double Team)', () => {
  assert.equal(packColorError('#ff8d4d'), null);
  assert.equal(packColorError('#3366cc'), null);
  assert.equal(packColorError('#22AA66'), null);
});
test('grey, white, black and near-grey colors are refused with the words of the server', () => {
  for (const c of ['#999999', '#ffffff', '#000000', '#8a7f80', '#f5f0f0', '#1a0505', '#a65959', '#ff9999', '#660000']) {
    assert.match(packColorError(c) || '', /needs more color/, c);
  }
});
test('the edges: saturation 0.35 and lightness 0.25 / 0.75', () => {
  assert.equal(packColorError('#b34d4d'), null);        // saturation 0.40
  assert.equal(packColorError('#800000'), null);        // lightness 0.25
  assert.equal(packColorError('#ff5555'), null);        // lightness 0.67
  assert.ok(packColorError('#a65959'));                 // saturation 0.30
  const c = packColorHsl('#ff8d4d'); assert.ok(Math.abs(c.s - 1) < 1e-9 && Math.abs(c.l - 0.651) < 0.001);
});
test('a text that is not #rrggbb is refused', () => {
  for (const c of ['', 'red', '#fff', null, undefined]) assert.match(packColorError(c) || '', /#rrggbb/);
});
test('the Sets page checks the color before the request on a create and on a color change', () => {
  const s = readFileSync(fileURLToPath(new URL('../public/admin/sets.js', import.meta.url)), 'utf8');
  assert.match(s, /seasonError\(set\.season, set\.id\) \|\| packColorError\(set\.pack_color\)/);
  assert.match(s, /set\.pack_color !== cur\.pack_color \? packColorError\(set\.pack_color\)/);
  assert.match(s, /if \(badColor\) return say\('st-status', `Error: \$\{badColor\}`, true\)/);
});
