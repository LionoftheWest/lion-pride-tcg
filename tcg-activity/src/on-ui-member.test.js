// ON-UI member modes (ON SPEC 3.5, G-UI (a) (b), review r1 M-1 and L-3): the screen rule and the test text.
//   node --test src/on-ui-member.test.js            a mutation: MUTATE=<name> node --test src/on-ui-member.test.js
//   MUTATE=all node src/on-ui-member.test.js        the baseline and every mutation in one run (each must fail)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
// [file, the text, its replacement]: each mutation breaks one rule; the tests below must fail on each.
export const MUTATIONS = {
  // (b) the screen reads the live flag only: an active v1 run of today no longer keeps the v1 screens
  screen_reads_live_only: ['ui-v2-gauntlet2.js', "  if (v1RunFirst(v)) return 'v1-run';\n", ''],
  // (b) the Dungeon load stops using the screen rule
  screen_not_wired: ['ui-v2-dungeon.js', ': g2.dungeonScreen(d, v2, active());', ": (g2.v2OwnsDungeon(v2, d) ? 'v2' : 'v1');"],
  // (a) the Practice label shows in the member mode too
  practice_text_live: ['ui-v2-gauntlet2.js', '(huntLive(v) ? null :', '(false ? null :'],
  // (a) the Dungeon lobby shows Play v2 (test) in the member mode
  test_button_live: ['ui-v2-dungeon.js', '(dg.v2can && !dg.v2live ? btn3', '(dg.v2can ? btn3'],
  // L-3: a missing row mark counts as live
  mark_missing_live: ['ui-v2-gauntlet2.js', 'v.run.live === true);   // review L-3', 'v.run.live !== false);   // review L-3'],
  // R3-ON-FIX: the Hunt bar stops reading hunt.live_frac (the key of hunt_v2_out and hunt_v2_view)
  hunt_bar_frac_key: ['ui-v2-dungeon.js', 'Number(h.live_frac)', 'Number(h.frac)'],
  // R3-ON-FIX: the Hunt bar shows on a test day too (the rule stops reading huntLive)
  hunt_bar_always: ['ui-v2-dungeon.js', "  if (!huntLive(v)) return `<div class=\"dg-prog\">", "  if (false) return `<div class=\"dg-prog\">"],
};

const name = process.env.MUTATE;
if (name === 'all') {
  const run = (n) => spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: n }, encoding: 'utf8' });
  const base = run('');
  console.log(`baseline (no mutation) ${base.status === 0 ? 'PASS' : 'FAIL'}`);
  let ok = base.status === 0;
  for (const n of Object.keys(MUTATIONS)) { const r = run(n); const caught = r.status !== 0; ok = ok && caught; console.log(`mutation ${n.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}`); }
  console.log(`mutations: baseline ${base.status === 0 ? 'PASS' : 'FAIL'}, ${ok ? 'all caught' : 'NOT all caught'}`);
  process.exit(ok ? 0 : 1);
}
// the source text of a file, with the mutation applied when it names this file
const source = (file) => {
  const s = readFileSync(join(here, file), 'utf8').replace(/\r\n/g, '\n');
  const m = name && MUTATIONS[name];
  if (!m || m[0] !== file) return s;
  const n = s.split(m[1]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  return s.replace(m[1], m[2]);
};
// the pure module, from a mutated copy in this folder when a mutation names it (its relative imports must resolve)
async function g2() {
  const m = name && MUTATIONS[name];
  if (!m || m[0] !== 'ui-v2-gauntlet2.js') return import('./ui-v2-gauntlet2.js');
  const file = join(here, `.mut-${name}-ui-v2-gauntlet2.js`);
  writeFileSync(file, source('ui-v2-gauntlet2.js'));
  try { return await import(pathToFileURL(file).href); } finally { rmSync(file, { force: true }); }
}
const G = await g2();
const D = source('ui-v2-dungeon.js');

const V1 = { ok: true, run: null };
test('G-UI (b): the flag ON with an active v1 run of today opens the v1 run screen (also when a v2 run could start)', () => {
  const v = { ok: true, live: true, tester: false, can_start: true, v1_run: { id: 1879 }, run: null };
  assert.equal(G.dungeonScreen(V1, v, true), 'v1-run');
  assert.equal(G.dungeonScreen(V1, { ...v, v1_run: null }, false), 'v2-start', 'no v1 run: the member starts v2');
  assert.equal(G.dungeonScreen(V1, { ...v, v1_run: null, can_start: false }, false), 'v2-lobby', 'no run left: the member lobby');
  assert.equal(G.dungeonScreen(V1, { ok: false, error: 'not_tester' }, false), 'v1', 'flag OFF, not a tester: v1');
});
test('G-UI (b): the Dungeon load uses the screen rule, and a v1 run turns the member mode off', () => {
  assert.match(D, /: g2\.dungeonScreen\(d, v2, active\(\)\);/);
  assert.match(D, /dg\.v2live = !GA\(\) && scr !== 'v1-run' &&/);
});
test('G-UI (a): no Practice / test / no rewards text in the member mode; the test day keeps its label', () => {
  const member = { ok: true, live: true, day: { live: true, status: 'active' }, label: 'Practice (v2 test): no rewards' };
  assert.equal(G.practiceLabel(member), null);
  assert.equal(G.practiceLabel({ ...member, live: false, day: { live: false } }), 'Practice (v2 test): no rewards');
  assert.match(D, /\(dg\.v2can && !dg\.v2live \? btn3\(\{ label: 'Play v2 \(test\)'/, 'the Dungeon test button only outside the member mode');
});
// R3-ON-FIX (POST-SWITCH-TRIAGE item 1): a REAL hunt_v2_start answer of a member live day (recorded on a local copy with
// combat_v2_hunt_out_live.sql, tcg-activity/test-fixtures/hunt-v2-start-live.json) through the route shape (asRun) and the real bar code.
const START = JSON.parse(readFileSync(join(here, '..', 'test-fixtures', 'hunt-v2-start-live.json'), 'utf8')).body;
const { asRun } = await import('./hunt-v2-routes.js');
// the real huntProgHTML of ui-v2-dungeon.js (the mutated text when a mutation names the file), with dg.v2 = the answer
const huntBar = (v) => {
  const m = D.match(/function huntProgHTML\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'huntProgHTML is in ui-v2-dungeon.js');
  return new Function('dg', 'huntLive', 'esc', `${m[0]}\nreturn huntProgHTML();`)({ v2: v }, G.huntLive, (s) => String(s ?? ''));
};
test('R3-ON-FIX: the recorded member start answer shows no Practice label and the shared boss bar; the pre-fix shape shows the label', () => {
  assert.equal(START.live, true, 'the recorded answer is a live member day');
  const v = asRun({ ...START });
  assert.equal(v.label, 'Practice (v2 test): no rewards', 'the route adds the label to every answer (only the screen rule hides it)');
  assert.equal(G.huntLive(v), true);
  assert.equal(G.practiceLabel(v), null, 'no Practice label');
  const pct = Math.round(100 * START.hunt.live_frac);
  const bar = huntBar(v);
  assert.match(bar, /class="u3-hs-hp"/, 'the boss bar shows');
  assert.ok(bar.includes(`--hp:${pct}%`) && bar.includes(`${pct}% HP`), `the bar = hunt.live_frac (${pct}%): ${bar}`);
  // the answer of the live text before the fix: practice true, no live, no hunt
  const old = { ...START, practice: true }; delete old.live; delete old.hunt;
  const w = asRun(old);
  assert.equal(G.huntLive(w), false);
  assert.equal(G.practiceLabel(w), 'Practice (v2 test): no rewards', 'the pre-fix answer shows the label (the test depends on the live key)');
  assert.doesNotMatch(huntBar(w), /u3-hs-hp/, 'the pre-fix answer shows no bar');
});
test('L-3: a missing row mark is not live (Dungeon run, Hunt day)', () => {
  assert.equal(G.isLive({ live: true, run: { id: 1 } }), false);
  assert.equal(G.isLive({ live: true, run: { id: 1, live: true } }), true);
  assert.equal(G.huntLive({ live: true, day: { status: 'active' } }), false);
  assert.equal(G.huntLive({ live: true, day: { live: true } }), true);
});
