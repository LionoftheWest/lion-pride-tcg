// UI-43 r2 M-1: the v2 Shop Stat reset panel (ui-v2-shop.js -> ui-v2-shop-reset.js), paused and not paused (N-10, ON SPEC G-UI (d)).
//   node --test tcg-activity/src/ui-v2-shop-reset.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resetHTMLv2, resetOpen } from './ui-v2-shop-reset.js';
import { RESET_PAUSED } from './ui3/shop.js';

const h = { esc: (s) => String(s ?? ''), price: (n) => `<span class="sh-price">${n}</span>`, icon: { reset: '<i-reset>', cal: '<i-cal>', arrow: '<i-arrow>' }, nextDay: () => 'Mon' };
const d = (over) => ({ stat_reset_price: 150, free_reset: true, free_reset_next: '2026-11-09T07:00:00Z', ...over });
const button = (html) => html.match(/<button class="v2-btn sh-choose"[^>]*>/)[0];

test('paused: the line shows above the disabled button, the status reads Paused and is not green', () => {
  const html = resetHTMLv2(d({ stat_reset_paused: true }), h);
  assert.equal(RESET_PAUSED, 'Stat reset returns with the v2 stats screen.');
  assert.ok(html.includes(`<div class="sh-err">${RESET_PAUSED}</div>`), 'the paused line is in the panel');
  assert.match(button(html), / disabled aria-disabled="true"/, 'the Choose a card button is disabled');
  assert.match(html, /Free weekly reset<\/b><span class="grow"><\/span><span>Paused<\/span>/);
  assert.doesNotMatch(html, /sh-free ok/, 'the status is not green while paused');
  assert.ok(html.indexOf('sh-err') < html.indexOf('sh-choose'), 'the line is above the button');
  assert.equal(resetOpen(d({ stat_reset_paused: true })), false, 'the click paths do not open the picker');
});

test('not paused (false or absent): the panel is unchanged: no line, the button works, Available or Used', () => {
  for (const over of [{ stat_reset_paused: false }, {}]) {
    const html = resetHTMLv2(d(over), h);
    assert.ok(!html.includes(RESET_PAUSED) && !html.includes('sh-err'), 'no paused line');
    assert.doesNotMatch(button(html), /disabled/, 'the button works');
    assert.match(html, /sh-free ok/);
    assert.match(html, /<span>Available<\/span>/);
    assert.equal(resetOpen(d(over)), true);
    const used = resetHTMLv2(d({ ...over, free_reset: false }), h);
    assert.match(used, /<span>Used · back Mon<\/span>/);
    assert.doesNotMatch(used, /sh-free ok/);
  }
  assert.equal(resetOpen(null), true, 'no data yet: the old click path');
});

test('ui-v2-shop.js paints this panel and guards both click paths with resetOpen', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ui-v2-shop.js'), 'utf8');
  assert.equal(src.split('resetHTMLv2(shop.data, ').length - 1, 1, 'resetHTML uses resetHTMLv2');
  assert.match(src, /if \(t\.closest\('\[data-choose\]'\)\) \{ if \(resetOpen\(shop\.data\)\) openPicker\(\); return; \}/);
  assert.match(src, /if \(t\.closest\('\.sh-choose'\)\) \{ if \(resetOpen\(shop\.data\)\) openPicker\(\); return; \}/);
  assert.doesNotMatch(src, /class="sh-panel sh-reset"/, 'no second copy of the panel markup in ui-v2-shop.js');
});
