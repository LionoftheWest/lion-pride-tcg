// UI-38 the FAQ window (v3): the approved strings and order, one answer open, the glossary words, the icons. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpHTML } from './help.js';

const text = (h) => h.replace(/&amp;/g, '&').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const FAQ = Array.from({ length: 9 }, (_, i) => ({ q: `Old ${i}`, q3: i === 3 ? 'What do extra copies do?' : null, a: `Old answer ${i}`, a3: i === 0 ? 'Play. New answer.' : null,
  chips: i === 0 ? ['Up to 5 a day', 'Gifts and rewards are extra'] : null }));

test('UI-38 title "FAQ", the v3 question and answer texts, the chips, Replay tutorial, no old glossary words', () => {
  const h = helpHTML(FAQ, 0);
  const t = text(h);
  assert.match(t, /^FAQ /);
  assert.match(t, /Play\. New answer\. Up to 5 a day Gifts and rewards are extra/);
  assert.match(t, /What do extra copies do\?/);
  assert.doesNotMatch(t, /Old 3|Old answer 0/);
  assert.match(t, /Replay tutorial$/);
});

test('UI-38 one answer open: aria-expanded on its row, the named scroll area, 9 rows with 9 different icons', () => {
  const h = helpHTML(FAQ, 4);
  assert.equal(h.split('class="u3-hp__q"').length - 1, 9);
  assert.equal(h.split('aria-expanded="true"').length - 1, 1);
  assert.match(h, /data-q="4"[^>]*>/);
  assert.match(h, /data-scroll-area="help answers"/);
  assert.equal(h.split('Old answer 4').length - 1, 1);
  const none = helpHTML(FAQ, -1);
  assert.equal(none.split('aria-expanded="true"').length - 1, 0);
  assert.doesNotMatch(none, /class="u3-hp__a"/);
});

import { thumbMetrics } from './help.js';
test('UI-38 scroll cue: hidden when the list fits; the thumb is the visible share and follows scrollTop', () => {
  assert.equal(thumbMetrics({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 }).show, false);
  assert.equal(thumbMetrics({ scrollTop: 0, clientHeight: 300, scrollHeight: 301 }).show, false);   // 1 px of rounding is no overflow
  const top = thumbMetrics({ scrollTop: 0, clientHeight: 200, scrollHeight: 400 });
  assert.deepEqual([top.show, top.top, top.height], [true, 0, 50]);
  const mid = thumbMetrics({ scrollTop: 100, clientHeight: 200, scrollHeight: 400 });
  assert.deepEqual([mid.top, mid.height], [25, 50]);
  const end = thumbMetrics({ scrollTop: 200, clientHeight: 200, scrollHeight: 400 });
  assert.equal(end.top + end.height, 100);   // the thumb ends at the end of the rail
  const long = thumbMetrics({ scrollTop: 9000, clientHeight: 100, scrollHeight: 10000 });
  assert.equal(long.height, 12);   // a minimum thumb
  assert.ok(long.top + long.height <= 100);
  assert.equal(thumbMetrics({ scrollTop: -50, clientHeight: 200, scrollHeight: 400 }).top, 0);
});
test('UI-38 the rail is a real, hidden, aria-hidden element that is not a control', () => {
  const h = helpHTML(FAQ, 0);
  assert.match(h, /<span class="u3-hp__rail" aria-hidden="true" hidden><span class="u3-hp__thumb"><\/span><\/span>/);
});
