// UI-06 Live in voice window: the paging and the labels. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voicePaging, moreLabel, windowTitle, sheetSide } from './voice.js';
import { voiceHTML, voiceCellHTML } from './home.js';

test('paging: everything fits without the pager -> one page, no pager', () => {
  // 5 rows of 56 with gaps of 8 need 5 * 56 + 4 * 8 = 312; the list is 270 with the pager and 270 + 40 without
  assert.deepEqual(voicePaging(5, 280, 56, 8, 40), { per: 5, pages: 1 });
  assert.deepEqual(voicePaging(1, 60, 56, 8, 40), { per: 1, pages: 1 });
});
test('paging: rows that do not fit get pages of the rows that fit fully', () => {
  assert.deepEqual(voicePaging(5, 200, 56, 8, 40), { per: 3, pages: 2 });   // 3 rows = 184, 4 = 248
  assert.deepEqual(voicePaging(9, 200, 56, 8, 40), { per: 3, pages: 3 });
});
test('paging: a list too short for one row still shows one row per page', () => {
  assert.deepEqual(voicePaging(4, 10, 56, 8, 40), { per: 1, pages: 4 });
});
test('paging: the pager room is given back when it is not needed (the boundary)', () => {
  assert.deepEqual(voicePaging(3, 150, 56, 8, 40), { per: 3, pages: 1 });   // 3 rows = 184 <= 150 + 40
  assert.deepEqual(voicePaging(4, 150, 56, 8, 40), { per: 2, pages: 2 });   // 4 rows = 248 > 190
});

test('labels and the sheet side by size class (D-59)', () => {
  assert.equal(windowTitle(5), 'Live in voice · 5');
  assert.equal(moreLabel(5), 'Show all 5 in voice');
  assert.equal(sheetSide('compact-port'), 'bottom');
  for (const s of ['expanded', 'medium', 'compact-land', 'medium-short']) assert.equal(sheetSide(s), 'side', s);
});

test('the "+N" cell is a button that names the whole count (in the Home source)', () => {
  const src = readFileSync(new URL('./home.js', import.meta.url), 'utf8');
  assert.match(src, /<button type="button" class="u3-hm-more" data-voice-all aria-label="\$\{moreLabel\(cells\.length\)\}">/);
});
test('the window reuses the tile cell: member hook, You badge, Watch pill', () => {
  const cell = voiceCellHTML({ id: 'a', status: { kind: 'opening' } }, { st: 'Opening a pack' }, { avatar: '', name: 'Ann', ico: 'x', ago: '1m', self: false, watch: true });
  assert.match(cell, /data-member="a"/);
  assert.match(cell, /u3-hm-watch/);
  assert.match(voiceHTML([cell], 1), /u3-hm-vrow/);
});
test('no window size is read in the window file (F-1)', () => {
  const src = readFileSync(new URL('./voice.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerWidth|innerHeight|matchMedia|screen\./);
});
