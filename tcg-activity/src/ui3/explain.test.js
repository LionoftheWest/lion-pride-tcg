// UI-39 explain.js: the six sets, the step index, the first-visit rule, the picture names, the window HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { V3_SETS, v3Set, stepTo, eyebrow, pagerLabel, picUrl, isFirstVisit, explainHTML } from './explain.js';

const COUNTS = { hall: 7, auctions: 6, trades: 7, pranks: 7, hunt: 7, collection: 7 };

test('the six sets have the approved slide counts and every slide has a title and a text', () => {
  assert.deepEqual(Object.keys(V3_SETS).sort(), Object.keys(COUNTS).sort());
  for (const [k, n] of Object.entries(COUNTS)) {
    assert.equal(V3_SETS[k].slides.length, n, k);
    for (const s of V3_SETS[k].slides) { assert.ok(s.title && s.text, k); assert.doesNotMatch(s.text, /\b(swap|neutral|Raid)\b/i, `${k}: glossary 10.1`); }
  }
});

test('every slide has both pictures (compact-port and the wider classes)', () => {
  for (const [k, set] of Object.entries(V3_SETS)) {
    set.slides.forEach((_, i) => {
      for (const c of ['c', 'w']) assert.ok(fs.existsSync(new URL(`../../public${picUrl(k, i, c)}`, import.meta.url)), `${k} ${i + 1} ${c}`);
    });
  }
});

test('v3Set only knows the six keys (no prototype keys)', () => {
  assert.equal(v3Set('hall').name, 'Trade Hall');
  assert.equal(v3Set('pranks').name, 'Boons');
  assert.equal(v3Set('toString'), null);
  assert.equal(v3Set('nope'), null);
});

test('stepTo moves one step, stays at the first step, and is done past the last', () => {
  assert.deepEqual(stepTo(0, 1, 7), { i: 1, done: false });
  assert.deepEqual(stepTo(0, -1, 7), { i: 0, done: false });
  assert.deepEqual(stepTo(6, 1, 7), { i: 6, done: true });
  assert.deepEqual(stepTo(2, 3, 7), { i: 5, done: false });
});

test('eyebrow, pager label and picture name', () => {
  assert.equal(eyebrow(V3_SETS.hall, 1), 'TRADE HALL · 2 OF 7');
  assert.equal(eyebrow(V3_SETS.pranks, 0), 'BOONS · 1 OF 7');
  assert.equal(pagerLabel(1, 7), '2 / 7');
  assert.equal(picUrl('hall', 1, 'c'), '/explain/v3/hall-2-c.webp');
});

test('first visit: only a known set that is not yet seen', () => {
  assert.equal(isFirstVisit(new Set(), 'hall'), true);
  assert.equal(isFirstVisit(new Set(['hall']), 'hall'), false);
  assert.equal(isFirstVisit(new Set(), 'nope'), false);
});

test('the window: Back is disabled on step 1, the last step ends with "Got it", the close button has a label and data-a', () => {
  const first = explainHTML('hall', 0);
  assert.match(first, /data-a="back"[^>]*disabled|disabled[^>]*data-a="back"/);
  assert.match(first, /data-a="next"/);
  assert.match(first, />Next</);
  assert.match(first, /aria-label="Close"[^>]*data-a="close"|data-a="close"[^>]*aria-label="Close"/);
  assert.match(first, /TRADE HALL · 1 OF 7/);
  assert.match(first, /1 \/ 7/);
  const last = explainHTML('auctions', 5);
  assert.doesNotMatch(last, /data-a="back"[^>]*disabled|disabled[^>]*data-a="back"/);
  assert.match(last, />Got it</);
  assert.match(last, /6 \/ 6/);
  assert.match(explainHTML('hall', 2, 1), /u3-ex__pic is-r/);
  assert.match(explainHTML('hall', 2, -1), /u3-ex__pic is-l/);
});

test('flag off: ui-v2-explain.js reaches the v3 window only behind body.ui-v3', () => {
  const src = fs.readFileSync(new URL('../ui-v2-explain.js', import.meta.url), 'utf8');
  assert.match(src, /if \(v3\(\) && v3Set\(cur\.key\)\) \{/);
  assert.match(src, /const v3 = \(\) => document\.body\.classList\.contains\('ui-v3'\)/);
});
