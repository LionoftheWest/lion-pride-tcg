// UI-08: the Card Detail markup and the fit steps. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailHTML, pointsHTML, statHTML, abilityHTML, ascensionHTML } from './card-detail.js';
import { widthSteps } from './card-detail-fit.js';
import { icon } from './icons.js';

const base = { c: {}, num: '#001', season: 'Season 1', name: 'Mr. Mob\'s Mime', rarity: 'normal', rarityLabel: 'Normal', locked: false, art: '<img src="x">', a: 0, own: '3 copies',
  stats: [statHTML('Power', 9, 20, '--gold')], lore: 'Barrier', tags: [{ label: 'Psychic', ico: '<svg></svg>' }, { label: 'Creature' }], ability: { name: 'Final Act', kind: 'attack', desc: 'd' },
  asc: { have: 2, need: 4 }, points: '', canAsc: true, ascLabel: 'Ascend to ★1 · uses 4', inSpot: false };

test('the window keeps every id of the v2 panel, so the handlers find their buttons', () => {
  const h = detailHTML(base);
  for (const id of ['pArt', 'pAscend', 'pConvert', 'pSpot', 'pTrade', 'pClose', 'colEffect', 'pTags']) assert.match(h, new RegExp(`id="${id}"`), id);
});

test('a locked card has no Convert, Spotlight or Ascend button, and the trade button stays', () => {
  const h = detailHTML({ ...base, locked: true, canAsc: false, asc: null });
  for (const id of ['pAscend', 'pConvert', 'pSpot']) assert.doesNotMatch(h, new RegExp(`id="${id}"`), id);
  assert.match(h, /id="pTrade"/);
  assert.match(h, /is-locked/);
});

test('the rarity chip shows the full sentence-case name', () => {
  assert.match(detailHTML({ ...base, rarity: 'secret_rare', rarityLabel: 'Secret Rare' }), /u3-chip--rarity[^>]*>.*Secret Rare/s);
});

test('the stat points editor replaces the other right column blocks; the summary does not', () => {
  const p = { keys: [['attack', 'Attack']], pts: {}, add: { attack: 1 }, free: 2, picked: 1, canReset: false };
  const open = pointsHTML({ ...p, open: true });
  assert.match(open, /id="ptsSave"/); assert.match(open, /id="ptsUndo"/); assert.match(open, /id="ptsDone"/); assert.match(open, /data-add="attack"/); assert.match(open, /\+1/);
  const h = detailHTML({ ...base, points: open });
  assert.doesNotMatch(h, /Final Act/);
  const closed = pointsHTML({ ...p, picked: 0, add: {}, open: false });
  assert.match(closed, /id="ptsOpen"/); assert.match(closed, /2 free/);
  assert.match(detailHTML({ ...base, points: closed }), /Final Act/);
});

test('ability and ascension blocks', () => {
  assert.equal(abilityHTML(null), '');
  assert.match(ascensionHTML({ have: 2, need: 4 }), /2 \/ 4 copies/);
  assert.match(ascensionHTML({ text: '★5 max' }), /★5 max/);
});

test('the card width steps go down to the smallest card and end there', () => {
  const s = widthSteps(160, 44, 8);
  assert.equal(s[0], 160); assert.equal(s.at(-1), 44); assert.ok(s.every((w, i) => i === 0 || w < s[i - 1]));
});

// STAT-V2 (UI-10 review-3, SPEC G-C1): the 9 v2 rows, their UI-67 icons, MAX at the cap, + disabled at the cap and at 0 free.
const V2 = [['atk', 'Attack', 'dumbbell'], ['def', 'Defense', 'shield-half'], ['hp', 'HP', 'heart'], ['crd', 'Crit Damage', 'bomb'], ['crt', 'Crit %', 'dices'],
  ['abl', 'Ability', 'wand-sparkles'], ['ddg', 'Dodge', 'footprints'], ['acc', 'Accuracy', 'crosshair'], ['spd', 'Speed', 'gauge']];
const rowsOf = (h) => [...h.matchAll(/<div class="u3-det__row">(.*?)<\/button><\/div>/gs)].map((m) => m[1]);
const plusOf = (row) => /<button[^>]*data-add="(\w+)"[^>]*>/.exec(row);

test('STAT-V2: 9 rows in the plan order, each with its icon before the name', () => {
  const h = pointsHTML({ keys: V2, cap: 10, pts: { atk: 10, hp: 2 }, add: {}, free: 2, picked: 0, canReset: false, open: true });
  const rows = rowsOf(h);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map((r) => plusOf(r)[1]), V2.map((d) => d[0]));
  assert.deepEqual(rows.map((r) => /<span class="u3-det__rowname">([^<]*)<\/span>/.exec(r)[1]), V2.map((d) => d[1]));
  for (const [i, r] of rows.entries()) {
    const svg = r.indexOf('<svg'), name = r.indexOf('u3-det__rowname');
    assert.ok(svg >= 0 && svg < name, `the icon of ${V2[i][0]} comes before its name`);
    assert.ok(r.includes(icon(V2[i][2], { size: 'sm' })), `icon ${V2[i][2]}`);
  }
});

test('STAT-V2: a stat at the cap shows MAX and its + is disabled; the others stay open', () => {
  const h = pointsHTML({ keys: V2, cap: 10, pts: { atk: 10, hp: 2 }, add: {}, free: 2, picked: 0, canReset: false, open: true });
  const rows = rowsOf(h);
  assert.match(rows[0], /<b>MAX<\/b>/);
  assert.match(plusOf(rows[0])[0], / disabled/);
  assert.match(rows[2], /<b>2<\/b>/);
  for (const r of rows.slice(1)) assert.doesNotMatch(plusOf(r)[0], / disabled/);
  assert.doesNotMatch(h, /NaN|undefined/);
});

test('STAT-V2: picked points that reach the cap disable the +; 0 free disables every +', () => {
  const near = rowsOf(pointsHTML({ keys: V2, cap: 10, pts: { def: 9 }, add: { def: 1 }, free: 3, picked: 1, canReset: false, open: true }));
  assert.match(plusOf(near[1])[0], / disabled/);
  assert.match(near[1], /<b>9<i>\+1<\/i><\/b>/);
  assert.doesNotMatch(plusOf(near[0])[0], / disabled/);
  const none = rowsOf(pointsHTML({ keys: V2, cap: 10, pts: {}, add: { hp: 2 }, free: 2, picked: 2, canReset: false, open: true }));
  for (const r of none) assert.match(plusOf(r)[0], / disabled/);
});

test('STAT-V2: Save and Undo only with picked points', () => {
  const p = { keys: V2, cap: 10, pts: { atk: 3 }, add: {}, free: 2, picked: 0, canReset: false, open: true };
  const idle = pointsHTML(p);
  assert.doesNotMatch(idle, /id="ptsSave"/); assert.doesNotMatch(idle, /id="ptsUndo"/);
  const picked = pointsHTML({ ...p, add: { hp: 1 }, picked: 1 });
  assert.match(picked, /id="ptsSave"/); assert.match(picked, /id="ptsUndo"/);
});

test('STAT-V2: a v1 row (no icon, no cap) renders as before: no svg in the name, no MAX', () => {
  const h = pointsHTML({ keys: [['attack', 'Attack']], pts: { attack: 15 }, add: {}, free: 1, picked: 0, canReset: false, open: true });
  const r = rowsOf(h)[0];
  assert.doesNotMatch(r.slice(0, r.indexOf('<b>')), /<svg/);
  assert.match(r, /<b>15<\/b>/);
  assert.doesNotMatch(plusOf(r)[0], / disabled/);
});
