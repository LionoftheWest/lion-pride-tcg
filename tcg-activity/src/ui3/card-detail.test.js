// UI-08: the Card Detail markup and the fit steps. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailHTML, pointsHTML, statHTML, abilityHTML, ascensionHTML } from './card-detail.js';
import { widthSteps } from './card-detail-fit.js';

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
