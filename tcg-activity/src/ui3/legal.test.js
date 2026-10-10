// UI-57 the legal pages: the scroll cue math and the page structure. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thumbMetrics } from '../../public/legal/legal.js';

test('no cue when the text fits', () => {
  assert.equal(thumbMetrics({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 }).show, false);
  assert.equal(thumbMetrics({ scrollTop: 0, clientHeight: 0, scrollHeight: 900 }).show, false);
});

test('the thumb is the visible share, starts at the top and ends at the bottom', () => {
  const a = thumbMetrics({ scrollTop: 0, clientHeight: 500, scrollHeight: 2000 });
  assert.equal(a.show, true); assert.equal(a.height, 25); assert.equal(a.top, 0);
  const z = thumbMetrics({ scrollTop: 1500, clientHeight: 500, scrollHeight: 2000 });
  assert.equal(z.top + z.height, 100);
});

test('a very long text keeps a thumb that can be seen', () => {
  assert.equal(thumbMetrics({ scrollTop: 0, clientHeight: 100, scrollHeight: 100000 }).height, 12);
});

for (const [file, title] of [['terms', 'Terms of Service'], ['privacy', 'Privacy Policy']]) {
  test(`${file}.html: header, one named scroll area with a rail, the cue script, the title`, () => {
    const h = readFileSync(new URL(`../../public/legal/${file}.html`, import.meta.url), 'utf8');
    assert.match(h, new RegExp(`<h1>${title}</h1>`));
    assert.equal((h.match(/data-scroll-area="legal text"/g) || []).length, 1);
    assert.match(h, /class="lg__rail"/);
    assert.match(h, /legal\/legal\.js/);
    assert.match(h, /Effective 29 September 2026/);
    assert.ok(h.indexOf('lg__head') < h.indexOf('lg__text'));
  });
}
