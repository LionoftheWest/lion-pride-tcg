// HUNT-V2-NATIVE (Nathan 2026-11-06): the old achievements dmg1k / hit500 count in v2 damage. The goal comes from the server
// (stats.need = balance ach_damage_v2.old, hunt_ach_damage_v2.sql), the values from the SQL (ach_damage_rows). No number in the client.
//   node --test src/achievements-damage.test.js        a mutation: MUTATE=<name> node --test src/achievements-damage.test.js
//   MUTATE=all node src/achievements-damage.test.js    the baseline and every mutation in one run (each must fail)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const MOD = 'achievements.js';
// [the text, its replacement] in achievements.js: each brings back one defect; a test below must fail on each.
export const MUTATIONS = {
  need_fixed_v1: ['  const n = Number(st?.need?.[goal]);', '  const n = goal === \'dmg1k\' ? 1000 : 500;'],
  no_goal_is_done: ['  if (!(n > 0)) return { have: 0, need: 1, set: null };', '  if (!(n > 0)) return { have: 1, need: 1, set: null };'],
  desc_static: ['desc: r.desc || a.desc,', 'desc: a.desc,'],
  dmg_reads_best_hit: ["statNeed('totalDamage', 'dmg1k'", "statNeed('bestHit', 'dmg1k'"],
  hit_reads_dmg_goal: ["statNeed('bestHit', 'hit500'", "statNeed('bestHit', 'dmg1k'"],
};

const name = process.env.MUTATE;
if (name === 'all') {
  const run = (n) => spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: n }, encoding: 'utf8' });
  const base = run('');
  console.log(`baseline (no mutation) ${base.status === 0 ? 'PASS' : 'FAIL'}`);
  if (base.status !== 0) console.log(base.stdout.slice(-3000));
  let ok = base.status === 0;
  for (const n of Object.keys(MUTATIONS)) { const r = run(n); const caught = r.status !== 0; ok = ok && caught; console.log(`mutation ${n.padEnd(20)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}`); }
  console.log(`mutations: baseline ${base.status === 0 ? 'PASS' : 'FAIL'}, ${ok ? 'all caught' : 'NOT all caught'}`);
  process.exit(ok ? 0 : 1);
}
async function load() {
  const m = name && MUTATIONS[name];
  if (!m) return import(`./${MOD}`);
  const s = readFileSync(join(here, MOD), 'utf8').replace(/\r\n/g, '\n');
  const n = s.split(m[0]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  const file = join(here, `.mut-${name}-${MOD}`);
  writeFileSync(file, s.replace(m[0], m[1]));
  try { return await import(pathToFileURL(file).href); } finally { rmSync(file, { force: true }); }
}
const { measure, achievementList } = await load();

// balance ach_damage_v2.old of hunt_ach_damage_v2.sql: floor(1000 x 0.45305), floor(500 x 0.45305)
const NEED = { dmg1k: 453, hit500: 226 };
const one = (stats, key) => measure([], stats, []).find((a) => a.key === key);

test('dmg1k: the goal is stats.need.dmg1k (v2 damage), the value is totalDamage', () => {
  assert.equal(one({ totalDamage: 452, bestHit: 9999, need: NEED }, 'dmg1k').done, false);
  const a = one({ totalDamage: 453, bestHit: 0, need: NEED }, 'dmg1k');
  assert.equal(a.done, true); assert.equal(a.need, 453); assert.equal(a.have, 453);
});

test('hit500: the goal is stats.need.hit500 (v2 damage), the value is bestHit', () => {
  assert.equal(one({ totalDamage: 99999, bestHit: 225, need: NEED }, 'hit500').done, false);
  const a = one({ totalDamage: 0, bestHit: 226, need: NEED }, 'hit500');
  assert.equal(a.done, true); assert.equal(a.need, 226);
});

test('the text names the v2 goal of the member', () => {
  assert.equal(one({ totalDamage: 0, bestHit: 0, need: NEED }, 'dmg1k').desc, 'Deal 453 damage in hunts');
  assert.equal(one({ totalDamage: 0, bestHit: 0, need: NEED }, 'hit500').desc, 'Land a 226 damage hit');
});

test('no goal from the server (balance not loaded): never done, whatever the damage', () => {
  assert.equal(one({ totalDamage: 1e9, bestHit: 1e9 }, 'dmg1k').done, false);
  assert.equal(one({ totalDamage: 1e9, bestHit: 1e9, need: {} }, 'hit500').done, false);
});

test('the list has no v1 goal in its static text', () => {
  const t = achievementList([]).filter((a) => a.key === 'dmg1k' || a.key === 'hit500').map((a) => a.desc).join(' | ');
  assert.equal(t, 'Deal damage in hunts | Land a big hit in a hunt');
});
