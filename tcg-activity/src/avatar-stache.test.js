import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_STACHE, avatarStache, paintStaches, setBadgesForTest } from './effects-ui.js';

// The mustache prank on the avatar (effects_spread.sql, Nathan 2026-10-03): a member with an active
// mustache gets a big mustache over every avatar the Activity shows; it goes away when the prank ends.

/** A fake avatar element (the few DOM calls paintStaches uses). */
function avatar(pid) {
  const kids = [];
  const cls = new Set(['v2-avatar']);
  return {
    dataset: { pid }, kids, cls,
    querySelector: (sel) => (sel === ':scope > .av-stache' ? kids.find((k) => k.cls === 'av-stache') || null : null),
    insertAdjacentHTML: (_where, html) => { const k = { cls: 'av-stache', html, remove: () => kids.splice(kids.indexOf(k), 1) }; kids.push(k); },
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
  };
}
const root = (els) => ({ querySelectorAll: (sel) => (sel === '.v2-avatar[data-pid]' ? els : []) });

test('avatarStache: the mustache only for a member with the mustache prank', () => {
  setBadgesForTest({ A: { mustache: true }, B: { title: 'Ace' } });
  assert.equal(avatarStache('A'), AVATAR_STACHE);
  assert.match(avatarStache('A'), /class="av-stache"/);
  assert.equal(avatarStache('B'), '');
  assert.equal(avatarStache('C'), '');
  assert.equal(avatarStache(null), '');
});

test('paintStaches: adds one mustache to every avatar of the member, removes it when the prank ends', () => {
  const a1 = avatar('A'), a2 = avatar('A'), b = avatar('B');
  const r = root([a1, a2, b]);
  setBadgesForTest({ A: { mustache: true } });
  paintStaches(r);
  paintStaches(r); // twice: still one mustache each
  assert.deepEqual([a1.kids.length, a2.kids.length, b.kids.length], [1, 1, 0]);
  assert.ok(a1.cls.has('stached') && !b.cls.has('stached'));
  setBadgesForTest({});
  paintStaches(r);
  assert.deepEqual([a1.kids.length, a2.kids.length], [0, 0]);
  assert.ok(!a1.cls.has('stached'));
});
