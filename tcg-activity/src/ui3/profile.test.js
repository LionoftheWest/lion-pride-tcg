// UI-14 Profile (v3): the pure fit rules of src/ui3/profile.js. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOf, places, spotWidth, miniGrid, profileHTML, emptyHTML, huntHTML, closesProfile, SHELL_TAP } from './profile.js';
import { TOKENS } from '../tokens.js';

test('layout: one layout for each size class (medium portrait stacks, C15)', () => {
  assert.equal(layoutOf('expanded', 1280, 720), 'col3');
  assert.equal(layoutOf('medium', 917, 692), 'col3');
  assert.equal(layoutOf('medium', 1180, 820), 'col3');
  assert.equal(layoutOf('medium', 768, 1024), 'stack');
  assert.equal(layoutOf('medium', 692, 917), 'stack');
  assert.equal(layoutOf('compact-land', 932, 430), 'land');
  assert.equal(layoutOf('compact-port', 375, 667), 'port');
  assert.equal(layoutOf('tiny', 400, 225), 'tiny');
});

test('places: "+N" takes the last place, and only when the items do not fit (C7)', () => {
  assert.deepEqual(places(5, 7), { show: 5, more: 0 });
  assert.deepEqual(places(7, 7), { show: 7, more: 0 });
  assert.deepEqual(places(37, 7), { show: 6, more: 31 });   // the approved 932x430 row: 6 icons and "+31"
  assert.deepEqual(places(37, 18), { show: 17, more: 20 });  // the approved 1280x720 grid: 17 icons and "+20"
  assert.deepEqual(places(3, 0), { show: 0, more: 3 });
});

test('spotlight: the main card is as large as the area allows, the side cards 82% (review-2)', () => {
  const r = TOKENS['card-ratio'];
  // width-limited: 3 cards in 300 x 400 with 12 gaps
  const w = spotWidth(300, 400, 3, 12);
  assert.equal(w, Math.floor((300 - 24) / 2.64));
  assert.ok(w + 2 * w * 0.82 + 24 <= 300);
  // height-limited
  assert.equal(spotWidth(1000, 140, 3, 12), Math.floor(140 / r));
  // even (all one size, the tap-size fallback)
  assert.equal(spotWidth(300, 400, 3, 12, { side: 1 }), Math.floor((300 - 24) / 3));
  assert.equal(spotWidth(300, 400, 0, 12), 0);
});

test('mini grid: whole rows of card-mini or wider cards (C14)', () => {
  const g = miniGrid(500, 100, 8);
  assert.equal(g.cols, Math.floor((500 + 8) / (TOKENS['card-mini'] + 8)));
  assert.ok(g.w >= TOKENS['card-mini']);
  assert.equal(g.rows, 1);
  assert.equal(miniGrid(500, 40, 8).rows, 0);
});

const base = {
  p: { id: '1' }, self: false, lay: 'col3', all: false, effects: true, avatar: '<span class="v2-avatar"></span>', name: 'Member B', title: 'Season 1 Champion',
  pres: null, stats: [['1/2', 'Cards'], ['—', 'Hunt rank'], ['3/50', 'Achievements'], ['9', 'Packs opened'], ['10', 'Power'], ['0', 'Full Arts']],
  done: [{ key: 'a', icon: 'x', name: 'A' }], total: 50, spot: [], season: { name: 'Season 1', owned: 1, total: 2, pct: 50 },
  rarities: [{ r: 'normal', label: 'Normal', n: 1 }], wish: true, huntHTML: huntHTML(null),
};

test('markup: the approved strings, the v2 element ids (the wiring is shared), C4 "The Hunt"', () => {
  const h = profileHTML(base);
  for (const id of ['memBack', 'memBoon', 'memPrank', 'memTrade', 'memAch', 'memSpot', 'memGrid', 'memAll', 'memWish']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(!h.includes('id="memCos"') && !h.includes('id="memStyle"'), 'another member: no Title & frame, no Spotlight Edit');
  assert.ok(h.includes('The Hunt') && !h.includes('Pride Hunt'));
  assert.ok(h.includes('No boss is live.'));
  assert.ok(h.includes('Offer a trade') && h.includes('View all ›') && h.includes('← Home'));
  const own = profileHTML({ ...base, self: true });
  assert.ok(own.includes('id="memCos"') && own.includes('Title &amp; frame') && own.includes('id="memStyle"'));
  assert.ok(!own.includes('id="memTrade"'));
  const all = profileHTML({ ...base, all: true });
  assert.ok(all.includes('>Back<') && all.includes('id="memPager"') && !all.includes('id="memSpot"'));
});

test('no profile and a failed load are two states (G-083, D-80 item 15)', () => {
  assert.ok(emptyHTML(false).includes('This member has no profile yet.'));
  assert.ok(!emptyHTML(false).includes('Try again'));
  const e = emptyHTML(true);
  assert.ok(e.includes('Something went wrong. Try again.') && e.includes('id="memRetry"') && e.includes('role="alert"'));
});

test('a tap on the shell (dock, top bar, Menu) closes the Profile layer; a tap inside the Profile or its own windows does not', () => {
  // a tiny stand-in for an element: closest() matches the selector list the way the browser does
  const el = (inside) => ({ closest: (sel) => (sel.split(',').map((x) => x.trim()).some((x) => inside.includes(x)) ? {} : null) });
  for (const part of ['#dock', '#topbar', '#u3MenuHost']) assert.equal(closesProfile(el([part])), true, part);
  assert.equal(closesProfile(el(['#memberModal'])), false);
  assert.equal(closesProfile(el(['#u3Picker'])), false);
  assert.equal(closesProfile(null), false);
  assert.equal(SHELL_TAP, '#dock, #topbar, #u3MenuHost');
});
