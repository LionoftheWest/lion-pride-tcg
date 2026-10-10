// UI-66 the Leaderboard window: the rules that need no browser (ranking, paging, the answer states, the entry points).
// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ranked, pageFit, packPages, tabState, myRanks, toNext, runLine, TABS, METRICS, TOP, ERROR_TEXT } from './leaderboard.js';

const rows = [
  { id: 'a', name: 'Ann', power: 10, huntDamage: 5, bosses: 0, cards: 3, achievements: 1 },
  { id: 'b', name: 'Bob', power: 30, huntDamage: 1, bosses: 2, cards: 3, achievements: 4 },
  { id: 'c', name: 'Cy', power: 30, huntDamage: 9, bosses: 1, cards: 1, achievements: 2 },
];

test('ranked: best first, a tie sorts by name, the input is not changed', () => {
  assert.deepEqual(ranked(rows, 'power').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(ranked(rows, 'huntDamage').map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(ranked(null, 'power'), []);
});

test('the window has the 4 tabs of D-44 in order, the 5 boards, and the top 10 rule', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['main', 'hunt', 'dungeon', 'gauntlet']);
  assert.equal(TABS[0].icon, 'trophy', 'approval condition: the Main tab icon is the trophy');
  assert.deepEqual(METRICS.map((m) => m.key), ['power', 'huntDamage', 'bosses', 'cards', 'achievements']);
  assert.equal(TOP, 10);
});

test('pageFit: the rows that fit, times the columns; at least 1 row; pages round up (D-36, 3.4)', () => {
  assert.deepEqual(pageFit({ count: 7, height: 200, rowH: 48 }), { cols: 1, rows: 4, pageSize: 4, pages: 2 });
  assert.equal(pageFit({ count: 7, height: 336, rowH: 48 }).pages, 1);
  assert.equal(pageFit({ count: 7, height: 335, rowH: 48 }).pages, 2, 'one pixel short of 7 rows');
  const hunt = pageFit({ count: 24, height: 460, rowH: 44, gap: 8, cols: 2 });   // 9 rows of 44 with 8 gaps
  assert.equal(hunt.rows, 9); assert.equal(hunt.pageSize, 18); assert.equal(hunt.pages, 2);
  assert.equal(pageFit({ count: 5, height: 10, rowH: 48 }).pageSize, 1, 'a list box smaller than one row still shows 1 row');
  assert.equal(pageFit({ count: 0, height: 300, rowH: 48 }).pages, 1, 'an empty list is 1 / 1');
});

test('packPages: rows of different heights fill each page in order; a row taller than the box still gets a page (3.4)', () => {
  assert.deepEqual(packPages([50, 50, 50, 50], 110, 10), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(packPages([50, 80, 50], 140, 10), [{ start: 0, end: 2 }, { start: 2, end: 3 }], '50 + 10 + 80 = 140 fits, the third row does not');
  assert.deepEqual(packPages([200, 30], 100, 8), [{ start: 0, end: 1 }, { start: 1, end: 2 }], 'a row taller than the box');
  assert.deepEqual(packPages([], 100), [{ start: 0, end: 0 }]);
  const all = packPages([40, 40, 40], 1000, 8);
  assert.equal(all.length, 1); assert.equal(all[0].end, 3);
});

test('tabState: an error answer never shows as an empty list (G-083); empty and ok are told apart', () => {
  assert.equal(tabState('hunt', null), 'error');
  assert.equal(tabState('hunt', { error: 'x' }), 'error');
  assert.equal(tabState('hunt', { leaders: [] }), 'empty');
  assert.equal(tabState('hunt', { leaders: [{}] }), 'ok');
  assert.equal(tabState('hunt', { me: 'a' }), 'error', 'no leaders field');
  assert.equal(tabState('dungeon', { ok: true, board: [] }), 'empty');
  assert.equal(tabState('gauntlet', { board: [{ rank: 1 }] }), 'ok');
  assert.equal(tabState('gauntlet', {}), 'error');
  assert.equal(tabState('main', { rows: [] }), 'ok');
  assert.equal(tabState('main', { error: 'x', rows: [] }), 'error');
  assert.equal(ERROR_TEXT, 'The leaderboard is not available.', 'the string of the capture (UI-22)');
});

test('myRanks and toNext: my place on each board, the gap to the member above me', () => {
  const r = myRanks(rows, 'a');
  assert.equal(r.power, 2); assert.equal(r.huntDamage, 1); assert.equal(r.cards, 0, 'a tie on cards sorts by name: Ann first');
  assert.equal(myRanks(rows, 'zz').power, -1, 'not on the board');
  const n = toNext(rows, 'a', 'power');
  assert.equal(n.i, 2); assert.equal(n.above.id, 'c'); assert.equal(n.gap, 20); assert.equal(n.pct, 33);
  assert.equal(toNext(rows, 'b', 'power').above, null, 'the leader has nobody above');
  assert.equal(toNext(rows, 'zz', 'power').i, -1);
});

test('runLine: the second line of a Dungeon or Gauntlet row (D2)', () => {
  assert.equal(runLine({ turns: 27 }, false), '27 turns');
  assert.equal(runLine({ turns: 62, runs: 1 }, true), '62 turns · 1 run');
  assert.equal(runLine({ turns: 62, runs: 3, status: 'active' }, true), '62 turns · 3 runs · in the dungeon');
  assert.equal(runLine({ turns: 1234 }, false, (n) => n.toLocaleString('en-US')), '1,234 turns');
});

// The entry points (D-44): with the flag on, every board button opens the one window on its tab. A source check:
// the module cannot run a click here (no DOM), and a missing branch would only show as the old board.
const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
test('entry points: Menu board, Hunt board, Dungeon and Gauntlet board open the window on their tab; the v2 code stays', () => {
  const social = src('../ui-v2-social.js');
  assert.match(social, /export function openLeaderboardV2\(\) \{\n  if \(isV3\(\)\) \{ openLeaderboardWindow\('main'\); return; \}/);
  assert.match(social, /export async function renderLeaderboardV2/, 'flag off: the v2 view stays');
  const main = src('../main.js');
  assert.match(main, /async function openHuntBoard\(\) \{\n  if \(huntV3\(\)\) \{ openLeaderboardWindow\('hunt'\); return; \}[^\n]*\n  const b = el\('board'\);/, 'flag off: the Hunt Standings pop-up stays');
  assert.match(main, /initLeaderboardWindow\(\{ api, user: \(\) => meUser, avatarHTML, nameBadge, openMember \}\)/);
  const dg = src('../ui-v2-dungeon.js');
  assert.match(dg, /async function openBoard\(\) \{\n  if \(V3\(\)\) \{ openLeaderboardWindow\(GA\(\) \? 'gauntlet' : 'dungeon'\); return; \}[^\n]*\n  dg\.view = 'board'/, 'flag off: the Dungeon board stays');
});

test('the 4 APIs of v2 are all called (no call was dropped)', () => {
  const s = src('./leaderboard.js');
  for (const p of ['/api/leaderboard/v2', '/api/hunt/leaderboard', '/api/dungeon/board', '/api/gauntlet/board']) assert.ok(s.includes(`'${p}'`), p);
});

test('the CSS file of the screen holds only UI-66 selectors (one file per screen)', () => {
  const css = readFileSync(fileURLToPath(new URL('../../public/ui3/90-ui-66.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = css.split('}').map((b) => b.split('{')[0].trim()).filter((x) => x && !x.startsWith('@') && !/^(from|to|\d)/.test(x));
  const bad = sels.filter((s) => s.split(',').some((p) => !/u3-lb/.test(p)));
  assert.deepEqual(bad, [], 'every selector names a .u3-lb class');
});
