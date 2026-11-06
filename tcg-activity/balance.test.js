// STAT-V2 G-C5 (SPEC v3 4.4, review r1 M6): publicBalance sends the names of the 9 v2 stats to the client (/api/flags), and only the public keys.
//   node --test tcg-activity/balance.test.js
// BALANCE_MODULE=<path> runs the same test on another copy of balance.js (the mutation runs of the REPORT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MOD = process.env.BALANCE_MODULE ? pathToFileURL(resolve(process.env.BALANCE_MODULE)).href : './balance.js';
const { publicBalance, PUBLIC_KEYS } = await import(MOD);

// the seed value of stat_v2.sql (balance stat_labels_v2)
const LABELS = { atk: { label: 'Attack', short: 'ATK' }, def: { label: 'Defense', short: 'DEF' }, hp: { label: 'HP', short: 'HP' },
  crd: { label: 'Crit Damage', short: 'CRD' }, crt: { label: 'Crit %', short: 'CRT' }, abl: { label: 'Ability', short: 'ABL' },
  ddg: { label: 'Dodge', short: 'DDG' }, acc: { label: 'Accuracy', short: 'ACC' }, spd: { label: 'Speed', short: 'SPD' } };

test('publicBalance has stat_labels_v2 and not a key outside PUBLIC_KEYS', () => {
  const p = publicBalance({ stat_labels_v2: LABELS, secret: { x: 1 }, combat_v2: { progress: true, testers: ['1'] } });
  assert.deepEqual(p.stat_labels_v2, LABELS);
  assert.equal('secret' in p, false);
  assert.equal('combat_v2' in p, false);   // the tester ids and the flags stay on the server
  assert.ok(PUBLIC_KEYS.includes('stat_labels_v2'));
});

test('publicBalance keeps the v1 stat_labels and drops a key that the table does not have', () => {
  const p = publicBalance({ stat_labels: { attack: { label: 'Attack' } } });
  assert.deepEqual(Object.keys(p), ['stat_labels']);
});
