import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerBlockText, refundText } from './effects-ui.js';

// The owner popup and the refund popup texts (effects_spread, Nathan 2026-10-03): no owner name.
test('the owner popup text names no member', () => {
  assert.equal(ownerBlockText('title'), 'Discord does not let anyone rename the server owner, so this card cannot be played.');
  assert.equal(ownerBlockText('timeout'), 'Discord does not let anyone time out the server owner, so this card cannot be played.');
  assert.equal(ownerBlockText('reaction_storm'), '');
});
test('the refund popup says the card is ready again', () => {
  assert.match(refundText({ reason: 'not_manageable', target: 'Leo', card: { name: 'King of the Swamp' } }), /rename Leo, so your King of the Swamp did nothing\. The play is refunded: the card is ready again/);
});
