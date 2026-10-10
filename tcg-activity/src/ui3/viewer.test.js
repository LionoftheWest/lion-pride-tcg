// UI-09 / UI-10: the viewer layer texts and icons. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconOf, ascendFailText, SAVE_FAIL_TEXT, spendClasses } from './viewer.js';
import { ICONS } from './icons.js';

test('every viewer button has a known library icon', () => {
  for (const id of ['viewer-close', 'viewer-prev', 'viewer-next']) assert.ok(ICONS[iconOf(id)], id);
  assert.equal(iconOf('nope'), null);
});

test('a refused ascend names the reason when the server gave one; the stat point save error is the 10.6 sentence', () => {
  assert.equal(ascendFailText(''), 'Could not ascend');
  assert.equal(ascendFailText('Event cards do not ascend.'), 'Could not ascend. Event cards do not ascend.');
  assert.equal(SAVE_FAIL_TEXT, 'Something went wrong. Try again.');
  assert.match(spendClasses, /u3-btn--primary/);
});
