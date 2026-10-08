// UI-43 the Shop: the logic that can be checked without a browser. node --test
// 3.5 the one card-width fitter (fitShop), D-46 the layout by frame shape (shopLayout), 3.4 the compact-port pages
// (pageBlocks), D-80 23 the price pill is the Buy button, D-29 no owned badge, "New" stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitShop, shopLayout, pageBlocks, stockBlocks } from './shop.js';

const M = (x) => ({ gap: 8, G: 24, labelH: 12, si: 8, pillH: 44, f: 1, ir: 3, nm: 6, ratio: 1.4, max: 112, ...x });
const extra = 12 + 16 + 44;   // label + 2 inner gaps + pill

test('D-41 / D-46: the layout of each class (an upright tablet stacks rows)', () => {
  assert.equal(shopLayout('compact-port', 430, 932), 'port');
  assert.equal(shopLayout('compact-land', 932, 430), 'row');
  assert.equal(shopLayout('medium', 768, 1024), 'tall');
  assert.equal(shopLayout('medium', 917, 692), 'wide');
  assert.equal(shopLayout('expanded', 1280, 720), 'wide');
});

test('row (compact-land): all 10 cards in one row; the width and the height both hold; a label widens its group', () => {
  const { w, fw } = fitShop('row', M({ W: 844, H: 300, G: 16, labelW: [0, 0, 0] }));
  assert.equal(fw, w, 'Featured has the card size of the row');
  assert.ok(10 * w + 7 * 8 + 2 * 16 <= 844, 'fits the width');
  assert.ok(10 * (w + 1) + 7 * 8 + 2 * 16 > 844, 'the largest that fits');
  const byH = fitShop('row', M({ W: 2000, H: 150, G: 16 })).w;
  assert.equal(byH, Math.floor((150 - extra) / 1.4), 'a short area: the height decides');
  const wide = fitShop('row', M({ W: 844, H: 300, G: 16, labelW: [200, 0, 0] })).w;
  assert.ok(wide < w, 'a Featured label wider than its card takes width from the cards');
  assert.ok(200 + (3 * wide + 16) + (6 * wide + 40) + 32 <= 844);
});

test('wide (medium landscape, expanded): Featured at most 3.2 cards, every block fits the height, the cap holds', () => {
  const m = M({ W: 1100, H: 470 });
  const { w, fw } = fitShop('wide', m);
  assert.ok(fw <= 3.2 * w + 1, 'Featured at most 3.2 cards wide');
  assert.ok(fw >= 2.5 * w, 'Featured is the large card (UI-43 approved: about 3 cards wide)');
  assert.ok(2 * (extra + w * 1.4) + 24 <= 470 + 1, 'two rows fit the height');
  assert.ok(fw * 1.4 + extra <= 470 + 1, 'Featured fits the height');
  assert.ok(fw + 24 + 6 * w + 5 * 8 <= 1100 + 1, 'fits the width');
  assert.ok(fitShop('wide', M({ W: 4000, H: 4000 })).w <= 112, 'never wider than card-tile-max');
  const square = fitShop('wide', M({ W: 600, H: 600 }));
  assert.ok(square.w >= 40, 'a square area does not starve the small cards (the 3.2 cap)');
});

test('tall (medium portrait): Normal in one row of 6 across; Featured at most 1.65 cards; it all fits', () => {
  const { w, fw } = fitShop('tall', M({ W: 720, H: 800 }));
  assert.ok(6 * w + 5 * 8 <= 720 + 1);
  assert.ok(fw <= 1.65 * w + 1);
  assert.ok(extra + fw * 1.4 + 24 + extra + w * 1.4 <= 800 + 1, 'both rows fit the height');
});

test('port (compact-port): 3 across; Featured and the Illustrated Rare row share page 1 when a 15% smaller card allows', () => {
  const full = fitShop('port', M({ W: 414, H: 1200 }));
  assert.equal(full.w, Math.floor((414 - 16) / 3), 'room: the width decides');
  const pair = fitShop('port', M({ W: 414, H: 530 }));
  assert.ok(pair.w < full.w && pair.w >= full.w * 0.85, 'shrunk at most 15%');
  assert.ok(2 * extra + 24 + 1.4 * (pair.fw + pair.w) <= 530 + 2, 'Featured + one row fit the page');
  const none = fitShop('port', M({ W: 414, H: 380 }));
  assert.ok(none.w >= Math.floor(full.w * 0.85) || none.w === Math.floor((380 - extra) / 1.4), 'no shrink below 85% for the pair');
});

test('3.4 pageBlocks: a group label never ends a page, shows again when its group goes on; the gaps above units count', () => {
  const U = (h, x = {}) => ({ h, ...x });
  const units = [U(12, { head: true, gap: 24, below: 8 }), U(200, { gap: 8 }), U(12, { head: true, gap: 24, below: 8 }), U(180, { gap: 8 }), U(180, { gap: 8 })];
  assert.deepEqual(pageBlocks(units, { full: 1000, paged: 900 }), [[0, 1, 2, 3, 4]]);
  // 12 + 8 + 200 + 24 + 12 + 8 + 180 = 444 fits 450; the next row (8 + 180) does not
  assert.deepEqual(pageBlocks(units, { full: 500, paged: 450 }), [[0, 1, 2, 3], [2, 4]]);
  // a head with no room for its first row moves with it
  assert.deepEqual(pageBlocks(units, { full: 300, paged: 240 }), [[0, 1], [2, 3], [2, 4]]);
});

test('D-80 23 / D-29: one Buy control per card (the price pill), no owned badge, "New" only on a card not owned', () => {
  const stock = [
    { slot: 1, rarity: 'secret_rare', price: 1500, owned: 0, bought: false, card: { name: 'F', image_url: '/f.png' } },
    { slot: 2, rarity: 'illustrated_rare', price: 450, owned: 2, bought: false, card: { name: 'I', image_url: '/i.png' } },
    { slot: 3, rarity: 'normal', price: 100, owned: 0, bought: true, card: { name: 'N', image_url: '/n.png' } },
  ];
  const b = stockBlocks({ stock }, '<svg class="sh-coin"></svg>', (r) => r);
  assert.deepEqual(b.map((x) => x.key), ['feat', 'ir', 'nm']);
  const html = b.flatMap((x) => x.items).join('');
  assert.equal((html.match(/data-buy=/g) || []).length, 3, 'one Buy control per card');
  assert.doesNotMatch(html, />Buy</, 'no separate Buy button: the pill is the button');
  assert.match(html, /1,500/);
  assert.doesNotMatch(html, /Owned|×2/, 'no owned badge (D-29)');
  assert.equal((html.match(/u3-chip--new/g) || []).length, 1, '"New" only on the card not owned and not bought');
  assert.match(b[2].items[0], /disabled/, 'a bought card cannot be bought again');
  assert.match(b[2].items[0], /Bought/);
});
