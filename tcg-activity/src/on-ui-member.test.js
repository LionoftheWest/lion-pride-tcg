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
  // UI-18 FIX: the lobby member mode reads the day row again (day null before the first start -> the v1 Enter battle)
  lobby_reads_day: ['main.js', 'if (huntV2Member(huntV2) && !squad.ko', 'if (huntV2?.ok && huntLive(huntV2) && !squad.ko'],
  // UI-18 FIX: the Practice v2 icon shows in the member mode too
  practice_icon_live: ['main.js', '(huntV2CanStart(huntV2) && !huntV2Member(huntV2)) act +=', '(huntV2CanStart(huntV2)) act +='],
  // ONE-START FIX: the Dungeon member mode reads the run row mark 'live' only (null before the first start), not the flag 'member'
  dungeon_member_live_only: ['ui-v2-gauntlet2.js', '(v.member === true || v.live === true)', '(v.live === true)'],
  // ONE-START FIX: the Dungeon load sets the member mode from 'live' only (the defect of 2026-11-06)
  dungeon_load_live_only: ['ui-v2-dungeon.js', "scr !== 'v1-run' && g2.dungeonMember(v2);", "scr !== 'v1-run' && !!(v2?.ok && v2.live === true);"],
  // ONE-START FIX: the Dungeon start button keeps the old label (Nathan 2026-11-06: "Start Run (both)")
  start_label: ['ui-v2-dungeon.js', "btn3({ label: 'Start Run', icon: 'swords', variant: 'primary', disabled: !s.ok", "btn3({ label: 'Start run', icon: 'swords', variant: 'primary', disabled: !s.ok"],
  // ONE-START FIX: the Gauntlet start button keeps the old label (Nathan 2026-11-06: "Start Run (both)")
  gauntlet_label: ['ui-v2-dungeon.js', "btn3({ label: 'Start Run', icon: 'swords', variant: 'primary', disabled: dg.busy,", "btn3({ label: 'Start run', icon: 'swords', variant: 'primary', disabled: dg.busy,"],
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
// UI-18 FIX (2026-11-06): the Hunt lobby of a live member BEFORE the first start of the day. hunt_v2_view (combat_v2_on_hunt.sql) gives
// 'live' = the flag (every member) and 'day' = null until hunt_v2_start makes the day row. The shape below is the jsonb_build_object of
// hunt_v2_view with no day row (keys copied from the SQL, not recorded). The real lobby lines of main.js run with stub buttons.
const M = source('main.js');
const lobby = (v, sq = { ko: false, locked: true }) => {
  const pick = (re, what) => { const m = M.match(re); assert.ok(m, `${what} is in main.js`); return m[0]; };
  const fns = [pick(/const huntV2CanStart = .*\n/, 'huntV2CanStart'), pick(/const huntV2Member = .*\n/, 'huntV2Member')].join('');
  const rule = pick(/ {2}if \(huntV2[^\n]*h2start[^\n]*\n {2}else if \(huntV2CanStart[^\n]*\n/, 'the lobby rule');
  const b = (o) => `[${o.label}|${Object.keys(o.data || {}).join(',')}${o.disabled ? '|disabled' : ''}]`;
  return new Function('huntV2', 'squad', 'picks', 'ui3Button', 'ui3IconButton', 'huntLive',
    `${fns}let act = "[Edit|hpick][Enter battle|henter]";\n${rule}return act;`)(v, sq, [1], b, b, G.huntLive);
};
const VIEW_NO_DAY = { ok: true, tester: false, live: true, practice: false, hunt: { id: 41, name: 'Boss', tier: 'Normal', closes_at: null, live_frac: 0.9 },
  boss: { key: 'boss' }, day: null, can_start: true };
test('UI-18 FIX: a live member with no day row yet: Enter battle starts v2 (h2start), no v1 henter, no Practice v2', () => {
  assert.equal(G.huntLive(VIEW_NO_DAY), false, 'the day rule alone is false before the first start (the defect)');
  const act = lobby(VIEW_NO_DAY);
  assert.match(act, /\[Enter battle\|h2start\]/);
  assert.doesNotMatch(act, /henter/);
  assert.doesNotMatch(act, /Practice v2/);
  assert.match(lobby({ ...VIEW_NO_DAY, can_start: false }), /\[Enter battle\|h2start\|disabled\]/, 'no start left: disabled, still not v1');
  assert.match(lobby({ ...VIEW_NO_DAY, tester: true }), /\[Enter battle\|h2start\]/, 'a tester on a live day is a member too');
  assert.doesNotMatch(lobby({ ...VIEW_NO_DAY, tester: true }), /Practice v2/);
  assert.doesNotMatch(lobby(VIEW_NO_DAY, { ko: false, locked: false }), /Practice v2/, 'no squad locked yet: no Practice v2 either');
});
test('UI-18 FIX: a tester practice view (flag OFF) keeps the v1 Enter battle and the Practice v2 icon; no view keeps v1 only', () => {
  const act = lobby({ ...VIEW_NO_DAY, tester: true, live: false, practice: true });
  assert.match(act, /\[Enter battle\|henter\]/);
  assert.match(act, /\[Practice v2\|h2start\]/);
  assert.match(lobby({ ...VIEW_NO_DAY, tester: true, live: false }, { ko: false, locked: false }), /\[Practice v2\|h2start\]/, 'no squad locked: the icon too');
  assert.equal(lobby(null), '[Edit|hpick][Enter battle|henter]', 'flag OFF, not a tester (view 403): v1 unchanged');
});

// ONE-START FIX (2026-11-06, a member report; Nathan: "It should only be 'Start Run' that goes into the v2 dungeon"). The REAL
// dungeon_v2_view answer of a member with the flag ON and no run today (combat_v2_on_dungeon.sql section 8, the same text as the live
// function): 'member' = combat_v2_on('dungeon') (the flag), 'live' = r.live (null: no run row yet), 'tester' = combat_v2_on('dungeon', p)
// (true for every member while the flag is ON). Keys copied from the SQL, not recorded. The real load and lobby lines run with stub buttons.
const DV_ON = { ok: true, tester: true, member: true, live: null, v1_run: null, run: null, runs_left: 1, last_run: null, can_start: true };
const dungeonLobby = (v2, sOk = true) => {
  const pick = (re, what) => { const m = D.match(re); assert.ok(m, `${what} is in ui-v2-dungeon.js`); return m[0]; };
  const load = pick(/ {2}dg\.v2live = [^\n]*\n/, 'the member mode line');
  const start = pick(/ {2}const start = btn3\([\s\S]*?: ''\);\n/, 'the start buttons');
  const b = (o) => `[${o.label}|${o.variant || 'secondary'}|${Object.keys(o.data || {}).join(',')}${o.disabled ? '|disabled' : ''}]`;
  const scr = G.dungeonScreen(V1, v2, false);
  const dg = { busy: false, v2can: scr === 'v2-start', v2live: false };
  return new Function('GA', 'scr', 'v2', 'g2', 'dg', 'btn3', 's', `${load}${start}return start;`)(() => false, scr, v2, G, dg, b, { ok: sOk });
};
test('ONE-START FIX: a member with the flag ON and no run yet sees ONE gold Start Run, and it starts v2', () => {
  assert.equal(G.dungeonScreen(V1, DV_ON, false), 'v2-start');
  assert.equal(dungeonLobby(DV_ON), '[Start Run|primary|start3]', 'one button: the gold Start Run (start3 starts v2 in the member mode)');
  assert.match(D, /if \(dg\.v2live\) \{ if \(dg\.v2can\) startV2\(M\); return; \}/, 'start3 in the member mode calls startV2, never /api/dungeon/start');
  assert.doesNotMatch(dungeonLobby(DV_ON), /\(test\)|start2/);
});
test('ONE-START FIX: the flag ON, no run left today (v1 runs counted): Start Run disabled, never the v1 start', () => {
  const v = { ...DV_ON, can_start: false, runs_left: 0 };
  assert.equal(G.dungeonScreen(V1, v, false), 'v2-lobby');
  assert.equal(dungeonLobby(v), '[Start Run|primary|start3|disabled]');
});
test('ONE-START FIX: the flag OFF keeps the same buttons (a tester: v1 start and Play v2 (test); a member: v1 start only), label Start Run', () => {
  const tester = { ...DV_ON, member: false };
  assert.equal(G.dungeonMember(tester), false);
  assert.equal(dungeonLobby(tester), '[Start Run|primary|start3][Play v2 (test)|secondary|start2]');
  assert.equal(dungeonLobby({ ok: false, error: 'not_tester' }), '[Start Run|primary|start3]', 'not a tester (view 403): v1 only');
  assert.equal(dungeonLobby(null), '[Start Run|primary|start3]', 'no view answer: v1 only');
});
// Nathan 2026-11-06 "Start Run (both)": the v3 Gauntlet lobby start (gaLobbyV3HTML) runs with a stub button; one gold Start Run.
test('ONE-START FIX: the Gauntlet lobby has one gold Start Run (start3 -> /api/gauntlet/start, v2 while the flag is ON)', () => {
  const m = D.match(/function gaLobbyV3HTML\(\) \{[\s\S]*?\n {2}const start = (btn3\([^\n]*\));\n/);
  assert.ok(m, 'the Gauntlet start line is in gaLobbyV3HTML');
  const b = (o) => `[${o.label}|${o.variant || 'secondary'}|${Object.keys(o.data || {}).join(',')}${o.disabled ? '|disabled' : ''}]`;
  assert.equal(new Function('btn3', 'dg', `return ${m[1]};`)(b, { busy: false }), '[Start Run|primary|start3]');
});
