import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitTiny, tinyState,hpPercent, litFraction, openMarkHTML, tinyHTML } from './tiny.js';

const hunt = { name: 'The Ranked Nightshade', hp_max: 20000, hp_remaining: 4200, closes_at: '2026-10-12T00:00:00Z' };
const last = { name: 'The Ranked Nightshade', status: 'defeated' };

test('the state comes from the answer', () => {
  assert.equal(tinyState({ hunt }), 'live');
  assert.equal(tinyState({ hunt: null, lastResult: last }), 'rest');
  assert.equal(tinyState({ hunt: null }), 'none');
  assert.equal(tinyState(null), 'none');
});

test('the HP percent is clamped and safe', () => {
  assert.equal(hpPercent(hunt), 21);
  assert.equal(hpPercent({ hp_max: 0, hp_remaining: 5 }), 0);
  assert.equal(hpPercent({ hp_max: 10, hp_remaining: 99 }), 100);
  assert.equal(hpPercent(null), 0);
});

test('the lit segments follow the frame (21 percent lights 3 of 10)', () => {
  assert.equal(Math.round(litFraction(21) * 10), 3);
  assert.equal(litFraction(0), 0);
  assert.equal(litFraction(100), 1);
  assert.equal(Math.round(litFraction(10) * 10), 1);
});

test('the OPEN mark shows the count, caps it, and is dim at 0', () => {
  assert.match(openMarkHTML(10), /u3-counter">10</);
  assert.doesNotMatch(openMarkHTML(10), /is-empty/);
  assert.match(openMarkHTML(0), /is-empty/);
  assert.doesNotMatch(openMarkHTML(0), /u3-tn__count/);
  assert.match(openMarkHTML(150), />99\+</);
  assert.match(openMarkHTML(1), /1 pack to open/);
});

test('the three states have Open full, and the OPEN mark is not a button', () => {
  for (const d of [{ hunt }, { hunt: null, lastResult: last, nextSpawnAt: '2026-10-14T00:00:00Z' }, { hunt: null }]) {
    const html = tinyHTML(d, { packs: 10, hasModel: true });
    assert.match(html, /data-tnfull="1"/);
    assert.equal((html.match(/<button/g) || []).length, 1);
    assert.match(html, /u3-counter">10</);
  }
});

test('live shows the HP and the close time, rest shows Next boss in, none shows no boss', () => {
  const live = tinyHTML({ hunt }, { packs: 0 });
  assert.match(live, /21% HP/);
  assert.match(live, /data-closes=/);
  const rest = tinyHTML({ hunt: null, lastResult: last, nextSpawnAt: '2026-10-14T00:00:00Z' }, { packs: 3, hasModel: true });
  assert.match(rest, /Next boss in/);
  assert.match(rest, /Defeated by the pride/);
  const none = tinyHTML({ hunt: null }, { packs: 3 });
  assert.doesNotMatch(none, /canvas|u3-hm-title/);
});

// a stand-in for the view: it is "too tall" until it has the number of mode classes in need
function fakeRoot(need) {
  const cls = new Set();
  const view = { classList: { add: (c) => cls.add(c), remove: (...c) => c.forEach((x) => cls.delete(x)) }, get scrollHeight() { return cls.size >= need ? 100 : 300; }, clientHeight: 100, querySelector: () => info };
  const info = { scrollHeight: 10, clientHeight: 100, scrollWidth: 10, clientWidth: 100 };
  return { querySelector: () => view, cls };
}
test('fitTiny picks the first mode that fits, and the last when none fits', () => {
  assert.equal(fitTiny(fakeRoot(0)), '');
  assert.equal(fitTiny(fakeRoot(1)), 'is-tight');
  assert.equal(fitTiny(fakeRoot(2)), 'is-tighter');
  assert.equal(fitTiny(fakeRoot(9)), 'is-tighter');
  assert.equal(fitTiny(null), '');
});

test('a name is escaped', () => {
  assert.doesNotMatch(tinyHTML({ hunt: { ...hunt, name: '<img onerror=x>' } }, {}), /<img/);
});
