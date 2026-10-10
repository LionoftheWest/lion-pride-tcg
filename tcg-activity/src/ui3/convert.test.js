// UI-44 Convert extra copies: the logic without a browser. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampCount, stepCount, convertTotals, keepNote, convertState } from './convert.js';
import { confirmHTML } from './shop.js';

test('the count stays a whole number from 1 to the extra copies', () => {
  assert.equal(clampCount(0, 2), 1);
  assert.equal(clampCount(5, 2), 2);
  assert.equal(clampCount('x', 4), 1);
  assert.equal(clampCount(2.7, 4), 2);
  assert.equal(stepCount(2, 1, 2), 2, 'the reached limit holds: + at the top');
  assert.equal(stepCount(1, -1, 2), 1, 'the reached limit holds: - at 1');
  assert.equal(stepCount(1, 1, 3), 2);
});

test('the totals come from the rate in the server answer', () => {
  assert.deepEqual(convertTotals({ n: 2, each: 5, balance: 698 }), { get: 10, now: 698, after: 708 });
  assert.deepEqual(convertTotals({ n: 1, each: 7, balance: 0 }), { get: 7, now: 0, after: 7 });
  assert.equal(convertTotals({ n: 3, each: 1200, balance: 10 }).after, 3610);
});

test('the keep note: the ascend sentence shows only while the card can ascend', () => {
  assert.equal(keepNote({ ascension: 0 }), 'You keep 1 copy. These copies can also ascend this card.');
  assert.equal(keepNote({ ascension: 4 }), 'You keep 1 copy. These copies can also ascend this card.');
  assert.equal(keepNote({ ascension: 5 }), 'You keep 1 copy.');
  assert.equal(keepNote({}), 'You keep 1 copy. These copies can also ascend this card.');
});

test('nothing to convert gives no window state; a count starts at all the extras', () => {
  assert.equal(convertState(null, {}), null);
  assert.equal(convertState({ count: 0, each: 5 }, {}), null);
  assert.equal(convertState({ count: 2, each: 0 }, {}), null);
  const s = convertState({ count: 2, each: 5 }, { id: 1 });
  assert.equal(s.n, 2); assert.equal(s.max, 2); assert.equal(s.each, 5); assert.equal(s.kind, 'convert');
});

test('the confirm window: Cancel left, the gold Convert right with the reward; the error line shows the text', () => {
  const base = { kind: 'convert', art: '<i></i>', eyebrow: 'Convert extras', title: 'Convert extra copies of X?', sub: '', control: '<div class="ctl"></div>',
    rows: { now: 698, price: 10, priceLabel: 'You get · 2 × 5', sign: '+', after: 708 }, note: 'You keep 1 copy.', go: { label: 'Convert', reward: '+10' } };
  const html = confirmHTML(base, '');
  assert.ok(html.indexOf('data-cancel') < html.indexOf('data-go'));
  assert.ok(html.includes('+ 10') && html.includes('708') && html.includes('Balance now') && html.includes('Balance after'));
  assert.ok(html.includes('u3-btn--primary') && html.includes('u3-msg--info') && html.includes('You keep 1 copy.'));
  assert.ok(!html.includes('u3-msg--error'));
  const err = confirmHTML({ ...base, msg: 'Something went wrong. Try again.' }, '');
  assert.ok(err.includes('u3-msg--error') && err.includes('Something went wrong. Try again.'));
  assert.ok(confirmHTML({ ...base, busy: true, go: { ...base.go, busyLabel: 'Converting' } }, '').includes('Converting'));
});
