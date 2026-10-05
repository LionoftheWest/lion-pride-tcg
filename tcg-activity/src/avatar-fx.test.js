import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_FX, avatarFx, paintAvatarFx, setBadgesForTest } from './effects-ui.js';

// THE AVATAR STANDARD (effects_spread, Nathan 2026-10-03): one shared overlay for every effect that changes
// a member's picture in the game; it goes on every avatar of that member and away when the effect ends.

/** A fake avatar element (the few DOM calls paintAvatarFx uses). */
function avatar(pid) {
  const kids = [];
  const cls = new Set(['v2-avatar']);
  return {
    dataset: { pid }, kids, cls,
    querySelectorAll: (sel) => (sel === ':scope > .av-fx' ? [...kids] : []),
    insertAdjacentHTML: (_where, html) => { const k = { html, remove: () => kids.splice(kids.indexOf(k), 1) }; kids.push(k); },
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
  };
}
const root = (els) => ({ querySelectorAll: (sel) => (sel === '.v2-avatar[data-pid]' ? els : []) });

test('avatarFx: the mustache overlay only for a member with the mustache prank', () => {
  setBadgesForTest({ A: { mustache: true }, B: { title: 'Ace' } });
  assert.equal(avatarFx('A'), AVATAR_FX.mustache);
  assert.match(avatarFx('A'), /class="av-fx av-stache"/);
  assert.equal(avatarFx('B'), '');
  assert.equal(avatarFx('C'), '');
  assert.equal(avatarFx(null), '');
});

test('every avatar overlay uses the shared class (one standard, not one per effect)', () => {
  for (const [k, html] of Object.entries(AVATAR_FX)) assert.match(html, /class="av-fx /, k);
});

test('paintAvatarFx: one overlay on every avatar of the member, removed when the effect ends', () => {
  const a1 = avatar('A'), a2 = avatar('A'), b = avatar('B');
  const r = root([a1, a2, b]);
  setBadgesForTest({ A: { mustache: true } });
  paintAvatarFx(r);
  paintAvatarFx(r); // twice: still one each
  assert.deepEqual([a1.kids.length, a2.kids.length, b.kids.length], [1, 1, 0]);
  assert.ok(a1.cls.has('has-fx') && !b.cls.has('has-fx'));
  setBadgesForTest({});
  paintAvatarFx(r);
  assert.deepEqual([a1.kids.length, a2.kids.length], [0, 0]);
  assert.ok(!a1.cls.has('has-fx'));
});
