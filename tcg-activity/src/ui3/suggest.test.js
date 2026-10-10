// UI-29 the member suggest list: the rules that run without a browser. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markMatch, breakName, rankMatches, visibleRows, listHeight, SUGGEST_MAX_ROWS } from './suggest.js';
import { markMatch as pickerMark } from './member-picker.js';

test('the match shows in gold (bold), case kept from the name; the name is escaped', () => {
  assert.equal(markMatch('mr.mobs', 'mob'), 'mr.<b>mob</b>s');
  assert.equal(markMatch('MOBster', 'mob'), '<b>MOB</b>ster');
  assert.equal(markMatch('a<b>c', 'x'), 'a&lt;b&gt;c');
  assert.match(markMatch('a<b>c', '<b>'), /<b>&lt;b&gt;<\/b>/);
  assert.equal(markMatch('abc', ''), 'abc');
  assert.equal(pickerMark, markMatch, 'the picker re-exports the one function');
});

test('D-08: break points, never an ellipsis', () => {
  assert.equal(breakName('a_b'), 'a_<wbr>b');
  assert.equal(breakName('fooBar'), 'foo<wbr>Bar');
  assert.ok(!breakName('some_long.name-here').includes('…'));
});

test('ranking: names that start with the text first, the server order kept inside each group, a cap', () => {
  const m = (name) => ({ name });
  const out = rankMatches([m('xxmob'), m('mobby'), m('other'), m('amob'), m('mob2')], 'mob');
  assert.deepEqual(out.map((x) => x.name), ['mobby', 'mob2', 'xxmob', 'amob', 'other']);
  assert.equal(rankMatches(Array.from({ length: 30 }, (_, i) => m(`n${i}`)), 'n').length, 12);
  assert.deepEqual(rankMatches(null, 'a'), []);
});

test('whole rows only: the room in rows, at most 6, at least 1, at most the count', () => {
  assert.equal(visibleRows({ room: 400, rowH: 44, gap: 4, count: 10 }), SUGGEST_MAX_ROWS);
  assert.equal(visibleRows({ room: 100, rowH: 44, gap: 4, count: 10 }), 2);
  assert.equal(visibleRows({ room: 10, rowH: 44, gap: 4, count: 10 }), 1, 'one row stays');
  assert.equal(visibleRows({ room: 400, rowH: 44, gap: 4, count: 3 }), 3);
  assert.equal(listHeight(3, 44, 4), 140);
  assert.equal(listHeight(1, 44, 4), 44);
});
