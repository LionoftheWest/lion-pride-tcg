// UI-64 fix: the card details fit the safe frame (viewer-fit.js: the mode, the widest card, the step down). node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeOf, maxCardWidth, stepDown } from './viewer-fit.js';

test('the mode comes from the box of the viewer: wider than tall = row, else col', () => {
  assert.equal(modeOf(932, 430), 'row');
  assert.equal(modeOf(430, 932), 'col');
  assert.equal(modeOf(500, 500), 'col');
});

test('row: the card is as tall as the frame (ratio 1.4) and at most 46% of the width; col: at most 42% of the width and 1/1.6 of the height', () => {
  assert.equal(maxCardWidth('row', 900, 350, 1.4), 250);
  assert.equal(maxCardWidth('row', 300, 350, 1.4), 138);
  assert.equal(maxCardWidth('col', 400, 800, 1.4), 168);
  assert.equal(maxCardWidth('col', 900, 1200, 1.4, 160), 160);
  assert.equal(maxCardWidth('col', 400, 300, 1.4), 133);
});

test('the step down never goes under the smallest card and ends with null', () => {
  assert.equal(stepDown(200, 80, 8), 192);
  assert.equal(stepDown(84, 80, 8), 80);
  assert.equal(stepDown(80, 80, 8), null);
});
