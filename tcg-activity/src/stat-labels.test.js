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
  assert.equal(statShort('haste'), 'HAS');
  assert.equal(statNames(), 'Attack, Vitality, Precision, Potency and Haste');
  assert.equal(statText('haste'), '');
  assert.equal(statSummary(), 'Each star gives points to this card.');
  assert.deepEqual(statLabelsFrom({ stat_labels: BAL.stat_labels }), {});   // no stat_points: no number, so no text
  setStatBalance({ stat_points: BAL.stat_points, stat_labels: { attack: BAL.stat_labels.attack } });
  assert.equal(statLabel('attack'), 'Attack');
  assert.equal(statLabel('haste'), 'Haste');   // one stat missing: only that one falls back
});
