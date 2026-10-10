// UI-55 Avatar effects: the pure rules of src/ui3/avatarfx.js. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarEffects, overlayHTML, pidOf, syncAvatar, scanAvatars } from './avatarfx.js';

// A small fake avatar: enough of the DOM for the module (children list, dataset, querySelector for img and the overlay).
function fakeAvatar({ pid = null, src = null } = {}) {
  const av = { dataset: pid ? { pid } : {}, kids: [], html: '' };
  av.querySelector = (sel) => {
    if (sel === 'img') return src ? { getAttribute: () => src } : null;
    if (sel === ':scope > .u3-avfx') return av.kids[0] || null;
    return null;
  };
  av.insertAdjacentHTML = (_pos, html) => {
    const m = /data-fx="([^"]*)"/.exec(html);
    const node = { dataset: { fx: m[1] }, html, remove: () => { av.kids = av.kids.filter((k) => k !== node); } };
    av.kids.push(node);
  };
  return av;
}

test('effects: the mustache badge gives the mustache, anything else gives none', () => {
  assert.deepEqual(avatarEffects({ mustache: true }), ['mustache']);
  assert.deepEqual(avatarEffects({ title: 'Generous', sticker: 'x', spotlight: true, swapShowcase: true }), []);
  assert.deepEqual(avatarEffects(null), []);
  assert.deepEqual(avatarEffects(undefined), []);
});

test('overlay: no effect, no markup; the overlay is hidden from a screen reader and takes no tap', () => {
  assert.equal(overlayHTML([]), '');
  const h = overlayHTML(['mustache']);
  assert.match(h, /class="u3-avfx"/);
  assert.match(h, /aria-hidden="true"/);
  assert.match(h, /data-fx="mustache"/);
  assert.match(h, /<svg class="u3-avfx__stache"/);
  assert.doesNotMatch(h, /<button|tabindex|href/);
});

test('member id: data-pid first, else the picture address', () => {
  assert.equal(pidOf(fakeAvatar({ pid: '42' })), '42');
  assert.equal(pidOf(fakeAvatar({ src: '/api/avatar/1234?x=1' })), '1234');
  assert.equal(pidOf(fakeAvatar({ src: 'https://elsewhere/pic.png' })), '');
  assert.equal(pidOf(fakeAvatar()), '');
});

test('sync: adds the overlay once, a repeat pass changes nothing, an ended effect removes it', () => {
  const av = fakeAvatar({ pid: '1' });
  assert.equal(syncAvatar(av, ['mustache']), true);
  assert.equal(av.kids.length, 1);
  assert.equal(syncAvatar(av, ['mustache']), false);
  assert.equal(av.kids.length, 1);
  assert.equal(syncAvatar(av, []), true);
  assert.equal(av.kids.length, 0);
  assert.equal(syncAvatar(av, []), false);
});

test('scan: only the avatars of the member with the effect change; an avatar with no id stays clean', () => {
  const a = fakeAvatar({ pid: '1' }); const b = fakeAvatar({ src: '/api/avatar/2' }); const c = fakeAvatar();
  const root = { querySelectorAll: () => [a, b, c] };
  const badgeOf = (id) => (id === '2' ? { mustache: true } : null);
  assert.equal(scanAvatars(root, badgeOf), 1);
  assert.equal(a.kids.length, 0);
  assert.equal(b.kids.length, 1);
  assert.equal(c.kids.length, 0);
  assert.equal(scanAvatars(root, badgeOf), 0);
});
