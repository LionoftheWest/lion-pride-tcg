// UI-30 Trade Hall (v3): the pure rules of src/ui3/hall.js. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALL_SWITCH, activeSwitch, switchTarget, switchHTML, filterCount, toggleFilter, applyHall, emptyState, notOwned, clampPage, pagesOf, manageLabel,
  NO_FILTERS, OWN_OPTIONS, RARITY_CHIPS } from './hall.js';
import { ICONS } from './icons.js';

const L = (name, rarity, who, tags = {}) => ({ name: who, card: { id: name.length, name, rarity }, tags });
const LIST = [L('Pikachu', 'full_art', 'Ann', { type: 'creature', origin: ['pokemon'], traits: ['electric'] }),
  L('Link', 'secret_rare', 'Bob', { type: 'character', origin: ['smash'], traits: [] }),
  L('Mr Mime', 'normal', 'Cy', { type: 'character', origin: ['pokemon'], traits: ['psychic'] })];
const tagsOf = (c) => LIST.find((x) => x.card.name === c.name).tags;
const elementOf = (t) => (t.traits.includes('electric') ? 'lightning' : t.traits.includes('psychic') ? 'psychic' : null);

test('the switch: Wanted, For trade, Auctions with the UI-00 line icons (Nathan, Shell review 2026-10-08)', () => {
  assert.deepEqual(HALL_SWITCH.map((s) => s.id), ['wanted', 'fortrade', 'auctions']);
  for (const s of HALL_SWITCH) assert.ok(ICONS[s.icon], `icon ${s.icon} is in the icon set`);
  assert.deepEqual(HALL_SWITCH.map((s) => s.icon), ['heart', 'tag', 'gavel']);
  const html = switchHTML('hall', 'fortrade');
  assert.match(html, /data-seg="fortrade"[^>]*>|class="u3-seg__item is-active"[^>]*data-seg="fortrade"/);
  assert.equal((html.match(/is-active/g) || []).length, 1);
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}▦]/u, 'no emoji (G-053)');
});

test('the active segment and the state a tap sets', () => {
  assert.equal(activeSwitch('hall', 'wanted'), 'wanted');
  assert.equal(activeSwitch('hall', 'fortrade'), 'fortrade');
  assert.equal(activeSwitch('auctions', 'fortrade'), 'auctions');
  assert.deepEqual(switchTarget('fortrade', 'wanted'), { sub: 'hall', view: 'fortrade' });
  assert.deepEqual(switchTarget('wanted', 'fortrade'), { sub: 'hall', view: 'wanted' });
  assert.deepEqual(switchTarget('auctions', 'fortrade'), { sub: 'auctions', view: 'fortrade' });   // the way back keeps the list
});

test('Filters: no Can ascend and no counts (D-80 item 21); the Owned switch stays', () => {
  assert.deepEqual(OWN_OPTIONS.map((o) => o[0]), ['all', 'owned', 'missing']);
  assert.equal(RARITY_CHIPS.length, 5);
  assert.equal(filterCount(NO_FILTERS), 0);
  assert.equal(filterCount({ ...NO_FILTERS, rarity: 'gold', game: 'smash', own: 'owned' }), 3);
  assert.deepEqual(toggleFilter(NO_FILTERS, 'rarity', 'gold').rarity, 'gold');
  assert.equal(toggleFilter(toggleFilter(NO_FILTERS, 'rarity', 'gold'), 'rarity', 'gold').rarity, null);
});

test('search and filters narrow the list (name, member, tags)', () => {
  const run = (o) => applyHall(LIST, { tagsOf, elementOf, owns: (c) => c.name === 'Link', ...o }).map((x) => x.card.name);
  assert.deepEqual(run({}), ['Pikachu', 'Link', 'Mr Mime']);
  assert.deepEqual(run({ q: ' pika ' }), ['Pikachu']);
  assert.deepEqual(run({ q: 'bob' }), ['Link']);                      // the member name
  assert.deepEqual(run({ q: 'psychic' }), ['Mr Mime']);               // a tag
  assert.deepEqual(run({ filters: { ...NO_FILTERS, rarity: 'normal' } }), ['Mr Mime']);
  assert.deepEqual(run({ filters: { ...NO_FILTERS, element: 'lightning' } }), ['Pikachu']);
  assert.deepEqual(run({ filters: { ...NO_FILTERS, type: 'character', game: 'pokemon' } }), ['Mr Mime']);
  assert.deepEqual(run({ filters: { ...NO_FILTERS, own: 'owned' } }), ['Link']);
  assert.deepEqual(run({ filters: { ...NO_FILTERS, own: 'missing' } }), ['Pikachu', 'Mr Mime']);
  assert.deepEqual(run({ q: 'zzz' }), []);
});

test('empty states: a search or a filter with no result is not the first-use text (7.2, review-1 item 9)', () => {
  assert.equal(emptyState('wanted', { q: 'Mario' }).title, 'No cards match.');
  assert.equal(emptyState('fortrade', { filters: { ...NO_FILTERS, game: 'smash' } }).title, 'No cards match.');
  assert.match(emptyState('wanted').title, /wishlist/);
  assert.match(emptyState('fortrade').line, /Manage my listings/);
  assert.doesNotMatch(emptyState('fortrade').line + emptyState('wanted').line, /!/);   // "Start one." style, 10.2
});

test('Not owned shows on a Wanted card with no copy, not on my own want or a For trade card', () => {
  assert.equal(notOwned('wanted', { mine: 0 }), true);
  assert.equal(notOwned('wanted', { mine: 2 }), false);
  assert.equal(notOwned('wanted', { mine: 0, yours: true }), false);
  assert.equal(notOwned('fortrade', { mine: false }), false);
});

test('pages: at least one, the page stays inside them, the label carries the limit', () => {
  assert.equal(pagesOf(0, 12), 1);
  assert.equal(pagesOf(25, 12), 3);
  assert.equal(clampPage(5, 3), 2);
  assert.equal(clampPage(-1, 3), 0);
  assert.equal(manageLabel(2), 'Manage my listings 2/5');
});

test('fitAll: every card on one page grows to the largest tile that shows them all', async () => {
  const { fitAll } = await import('./hall.js');
  const o = { min: 88, max: 112, ratio: 1.4 };
  assert.deepEqual(fitAll(10, 1000, 600, 8, o), { cols: 8, rows: 2, tile: 112 });   // wide: the max tile
  const t = fitAll(10, 360, 260, 8, o);                                             // short: 3 columns do not fit 4 rows
  assert.equal(t, null);
  const m = fitAll(10, 414, 207, 8, { min: 44, max: 112, ratio: 1.4 });
  assert.ok(m.tile >= 44 && m.rows * (m.tile * 1.4 + 8) - 8 <= 207 && m.cols * m.rows >= 10);
  assert.equal(fitAll(0, 400, 400, 8, o), null);
});
