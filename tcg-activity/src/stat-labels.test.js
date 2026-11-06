// The stat names and explainers come from balance (F-3, f3_stat_labels.sql): the rendering, the numbers from stat_points, no invented text. node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAT_KEYS, statLabelsFrom, setStatBalance, statLabel, statShort, statText, statDefs, statNames, statSummary } from './stat-labels.js';

// The values of f3_stat_labels.sql and balance stat_points (2026-10-15).
const BAL = {
  stat_points: { attack: 0.05, vitality: 0.06, precision: 0.03, potency: 0.05, haste: 0.04, per_star: 3, max_per_stat: 15 },
  stat_labels: {
    attack: { label: 'Attack', short: 'ATK', text: 'your card hits harder (+{n}% attack power for each point)' },
    vitality: { label: 'Health', short: 'HP', text: 'your card has more HP (+{n}% HP for each point)' },
    precision: { label: 'Crit', short: 'CRT', text: 'your card lands critical hits more often (+{n}% chance for each point)' },
    potency: { label: 'Support', short: 'SUP', text: 'the support of your card is stronger (+{n}% heal, shield or empower for each point)' },
    haste: { label: 'Recharge', short: 'RCH', text: 'supports are ready sooner (-{n}% cooldown for each point)' },
  },
};

test('the five stats keep their stored keys and get the new names', () => {
  setStatBalance(BAL);
  assert.deepEqual(STAT_KEYS, ['attack', 'vitality', 'precision', 'potency', 'haste']);
  assert.deepEqual(statDefs(), [['attack', 'Attack'], ['vitality', 'Health'], ['precision', 'Crit'], ['potency', 'Support'], ['haste', 'Recharge']]);
  assert.equal(statNames(), 'Attack, Health, Crit, Support and Recharge');
  assert.equal(statShort('vitality'), 'HP');
});

test('the explainer has the number of stat_points in it (Nathan example: Recharge, -4% cooldown)', () => {
  setStatBalance(BAL);
  assert.equal(`${statLabel('haste')}: ${statText('haste')}`, 'Recharge: supports are ready sooner (-4% cooldown for each point)');
  assert.match(statText('attack'), /\+5% attack power/);
  assert.match(statText('vitality'), /\+6% HP/);
  assert.match(statText('precision'), /\+3% chance/);
  assert.match(statText('potency'), /\+5% heal/);
});

test('a balance change moves the text: the numbers are not typed in the screens', () => {
  const b = JSON.parse(JSON.stringify(BAL)); b.stat_points.haste = 0.075; b.stat_points.attack = 0.1;
  const l = statLabelsFrom(b);
  assert.match(l.haste.text, /-7\.5% cooldown/);
  assert.match(l.attack.text, /\+10% attack power/);
  b.stat_labels.haste.label = 'Cooldown';
  assert.equal(statLabelsFrom(b).haste.label, 'Cooldown');
});

test('the summary line reads the stars and the numbers from balance', () => {
  setStatBalance(BAL);
  assert.equal(statSummary(), 'Each star gives 3 points to this card. Attack adds 5% power, Health 6% HP, Crit 3% chance.');
  const b = JSON.parse(JSON.stringify(BAL)); b.stat_points.per_star = 4; b.stat_points.vitality = 0.08;
  setStatBalance(b);
  assert.match(statSummary(), /gives 4 points.*Health 8% HP/);
});

test('with no balance a stat shows its stored key with a capital (the old name) and no text is invented', () => {
  setStatBalance(null);
  assert.equal(statLabel('haste'), 'Haste');
  assert.equal(statLabel('vitality'), 'Vitality');
  assert.equal(statShort('haste'), 'HST');
  assert.equal(statShort('attack'), 'ATK');
  assert.equal(statNames(), 'Attack, Vitality, Precision, Potency and Haste');
  assert.equal(statText('haste'), '');
  assert.equal(statSummary(), 'Each star gives points to this card.');
  assert.deepEqual(statLabelsFrom({ stat_labels: BAL.stat_labels }), {});   // no stat_points: no number, so no text
  setStatBalance({ stat_points: BAL.stat_points, stat_labels: { attack: BAL.stat_labels.attack } });
  assert.equal(statLabel('attack'), 'Attack');
  assert.equal(statLabel('haste'), 'Haste');   // one stat missing: only that one falls back
});

// STAT-V2 (SPEC G-C2): the 9 v2 names come from the public balance key stat_labels_v2 (stat_v2.sql); no key = the key in capitals.
import { V2_STAT_KEYS, v2StatDefs, v2StatLabel, v2StatShort } from './stat-labels.js';
const V2L = { atk: ['Attack', 'ATK'], def: ['Defense', 'DEF'], hp: ['HP', 'HP'], crd: ['Crit Damage', 'CRD'], crt: ['Crit %', 'CRT'],
  abl: ['Ability', 'ABL'], ddg: ['Dodge', 'DDG'], acc: ['Accuracy', 'ACC'], spd: ['Speed', 'SPD'] };
const BAL2 = { ...BAL, stat_labels_v2: Object.fromEntries(Object.entries(V2L).map(([k, [label, short]]) => [k, { label, short }])) };

test('STAT-V2: the 9 rows in the plan 2.2 order with the names of stat_labels_v2 and the UI-67 icons', () => {
  setStatBalance(BAL2);
  assert.deepEqual(V2_STAT_KEYS, ['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd']);
  assert.deepEqual(v2StatDefs(), [['atk', 'Attack', 'dumbbell'], ['def', 'Defense', 'shield-half'], ['hp', 'HP', 'heart'], ['crd', 'Crit Damage', 'bomb'],
    ['crt', 'Crit %', 'dices'], ['abl', 'Ability', 'wand-sparkles'], ['ddg', 'Dodge', 'footprints'], ['acc', 'Accuracy', 'crosshair'], ['spd', 'Speed', 'gauge']]);
  // the Shop reset table and picker captions (ui-v2-shop.js) read statLabel / statShort: they resolve the v2 keys too
  assert.equal(statLabel('crd'), 'Crit Damage'); assert.equal(statShort('crd'), 'CRD'); assert.equal(statShort('hp'), 'HP');
});

test('STAT-V2: a changed balance name shows on the screen (no name typed in the code)', () => {
  const b = JSON.parse(JSON.stringify(BAL2)); b.stat_labels_v2.ddg = { label: 'Evade', short: 'EVA' };
  setStatBalance(b);
  assert.equal(v2StatLabel('ddg'), 'Evade'); assert.equal(v2StatShort('ddg'), 'EVA'); assert.equal(statLabel('ddg'), 'Evade');
  assert.equal(v2StatDefs()[6][1], 'Evade');
});

test('STAT-V2: no stat_labels_v2 = the key in capitals; the v1 keys keep their names', () => {
  setStatBalance(BAL);
  assert.deepEqual(v2StatDefs().map((d) => d[1]), ['ATK', 'DEF', 'HP', 'CRD', 'CRT', 'ABL', 'DDG', 'ACC', 'SPD']);
  assert.equal(statShort('spd'), 'SPD');
  setStatBalance(BAL2);
  assert.deepEqual(statDefs(), [['attack', 'Attack'], ['vitality', 'Health'], ['precision', 'Crit'], ['potency', 'Support'], ['haste', 'Recharge']]);
  assert.equal(statShort('vitality'), 'HP'); assert.equal(statLabel('haste'), 'Recharge');
  setStatBalance(null);
  assert.equal(statLabel('vitality'), 'Vitality');
});
