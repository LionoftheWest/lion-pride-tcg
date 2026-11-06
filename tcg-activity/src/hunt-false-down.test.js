// HUNT-FALSE-DOWN (Nathan, 2026-11-06: "my squad was down on the hunt even though it wasn't").
// A live v2 day writes 8 hunt_card_hp bridge rows (downed = true at full HP, hunt_v2_start). When /api/hunt/v2/view failed
// (live p95 15-24 s, errors on 2026-11-06), the Hunt view fell back to the v1 roster and squadDown() read the bridge rows as a
// squad that is down. The invariant: while a live v2 day exists today (or the server cannot tell), the v1 roster never decides
// "squad down"; a permanent v2 refusal (403) keeps the v1 rules; the re-reads are limited.
//   node --test src/hunt-false-down.test.js           a mutation: MUTATE=<name> node --test src/hunt-false-down.test.js
//   MUTATE=all node src/hunt-false-down.test.js       the baseline and every mutation in one run (each must fail). CI: combat-checks.yml
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { squadDown } from './squad-pick.js';

const here = dirname(fileURLToPath(import.meta.url));
const MOD = 'hunt-v2-wait.js';
// [the text, its replacement] in hunt-v2-wait.js: each mutation brings back one defect; the tests below must fail on each.
export const MUTATIONS = {
  // the original defect: a failed v2 answer falls back to the v1 squad rule
  step_no_wait: ["  if (d?.v2day === true || d?.v2day === null) return 'wait';\n", ''],
  // review r1 H1: a 403 (not_tester, off) waits and re-reads forever
  step_403_waits: ["  if (err && (err.status === 401 || err.status === 403)) return 'v1';\n", ''],
  // review r1 M2: an unknown flag counts as "no v2 day"
  step_unknown_v1: ["d?.v2day === true || d?.v2day === null) return 'wait'", "d?.v2day === true) return 'wait'"],
  // review r1 M2: a failed hunt_v2_days read gives false
  flag_error_false: ['  if (!q || q.error || !Array.isArray(q.data)) return null;', '  if (!q || !Array.isArray(q.data)) return false;'],
  // review r1 L1: an answer of an earlier day is not read again
  step_no_reload: ["return d?.v2day === true ? 'reload' : 'v1';", "return 'v1';"],
  // review r1 M1: no limit
  waiter_no_limit: ['      if (busy || tries >= delays.length) return;', '      if (busy) return;'],
  // review r1 M1: a second chain while a timer or a request is in flight
  waiter_two_chains: ['      if (busy || tries >= delays.length) return;', '      if (tries >= delays.length) return;'],
  // review r1 M1: no backoff
  waiter_no_backoff: ['      }, delays[tries]);', '      }, delays[0]);'],
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
const { v2DayFlag, huntV2Step, v2Waiter, V2_WAIT_DELAYS } = await load();

// The live bridge rows of 2026-11-06 (lionofthewest94, hunt 148564): 8 rows, downed = true, hp_remaining = max_hp.
const bridge = [54, 57, 107, 221, 254, 82, 330, 259].map((id) => ({ id, type: 'Character', used: true, downed: true, hp: 200, max_hp: 200 }));
const today = { hunt: { id: 148564 }, roster: bridge, squad: bridge.map((c) => String(c.id)), usedToday: 8, v2day: true };
const NET = { status: 0, error: 'network' };

test('the trap: the v1 rule reads the 8 bridge rows as a squad that is down', () => {
  assert.equal(squadDown(today.roster, today.squad), true);
});

test('server flag: a live row is true, no row is false, a failed or timed-out read is unknown (null), never false', () => {
  assert.equal(v2DayFlag({ data: [{ day: '2026-11-06' }], error: null }), true);
  assert.equal(v2DayFlag({ data: [], error: null }), false);
  assert.equal(v2DayFlag({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }), null);
  assert.equal(v2DayFlag({ data: null, error: new Error('fetch failed') }), null);
  assert.equal(v2DayFlag(undefined), null);
});

test('a live v2 day and a transient v2 failure: the view waits, it never uses the v1 squad rule', () => {
  assert.equal(huntV2Step(today, null, NET), 'wait', 'a dropped request');
  assert.equal(huntV2Step(today, null, { status: 500, error: 'canceling statement' }), 'wait', 'a 500');
  assert.equal(huntV2Step(today, null, { status: 409, error: 'busy' }), 'wait', 'a 409 busy');
  assert.equal(huntV2Step(today, null, null), 'wait', 'not read yet');
  assert.equal(huntV2Step({ ...today, v2day: null }, null, { status: 500 }), 'wait', 'M2: the server could not tell');
});

test('H1: a 403 (not_tester, off: the flag OFF) or a 401 is permanent: the v1 rules, no wait', () => {
  assert.equal(huntV2Step(today, null, { status: 403, error: 'not_tester' }), 'v1');
  assert.equal(huntV2Step(today, null, { status: 403, error: 'off' }), 'v1');
  assert.equal(huntV2Step({ ...today, v2day: null }, null, { status: 403, error: 'off' }), 'v1');
  assert.equal(huntV2Step(today, null, { status: 401, error: 'not authenticated' }), 'v1');
});

test('the v2 day row decides; no live v2 day keeps the v1 rules; L1: an answer of an earlier day is read again', () => {
  assert.equal(huntV2Step(today, { ok: true, day: { status: 'active' }, run: { status: 'active' }, fight: {} }, null), 'v2');
  assert.equal(huntV2Step(today, { ok: true, day: { status: 'over', ended_by: 'squad_down' } }, null), 'v2');
  assert.equal(huntV2Step({ ...today, v2day: false }, null, NET), 'v1', 'a v1 day');
  assert.equal(huntV2Step({ ...today, v2day: false }, { ok: true, day: null }, null), 'v1');
  assert.equal(huntV2Step({ ...today, v2day: null }, { ok: true, day: null }, null), 'v1', 'the view says: no day today');
  assert.equal(huntV2Step({ hunt: null }, null, NET), 'v1', 'no hunt');
  // the MT midnight: /api/hunt of yesterday (v2day true), the v2 answer of today (no day row yet)
  assert.equal(huntV2Step(today, { ok: true, day: null }, null), 'reload');
});

// A fake clock: timers run in time order; a request takes `lat` ms. The client = the paint rule of main.js paintHuntView:
// a 'wait' or 'reload' step calls wait() unless the waiter stopped (then the Retry state, no automatic call).
function sim({ minutes = 10, lat = 0, reopenEvery = 0, answer }) {
  let now = 0; const q = [];
  const timer = (fn, ms) => { q.push({ at: now + ms, fn }); q.sort((a, b) => a.at - b.at); };
  const st = { calls: 0, inFlight: 0, maxInFlight: 0, gaps: [], last: null, d: today, v: null, err: NET };
  const w = v2Waiter({
    timer,
    load: () => new Promise((res) => {
      st.calls += 1; st.inFlight += 1; st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
      if (st.last !== null) st.gaps.push(now - st.last); st.last = now;
      timer(() => { st.inFlight -= 1; Object.assign(st, answer(now)); res(); }, lat);
    }),
    paint: () => paint(),
  });
  const paint = () => { const s = huntV2Step(st.d, st.v, st.err); if (s === 'wait' || s === 'reload') { if (!w.stopped) w.wait(); } else w.reset(); };
  return (async () => {
    paint();
    if (reopenEvery) for (let t = reopenEvery; t < minutes * 60000; t += reopenEvery) q.push({ at: t, fn: paint });
    q.sort((a, b) => a.at - b.at);
    while (q.length && q[0].at <= minutes * 60000) {
      const { at, fn } = q.shift(); now = at; fn();
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    }
    return { ...st, stopped: w.stopped, w, paint };
  })();
}
const fail = () => ({ v: null, err: { status: 500, error: 'out of memory' } });

test('M1: every answer fails for 10 min: 3 re-reads (3 s, 6 s, 12 s), then it stops', async () => {
  const r = await sim({ answer: fail });
  assert.deepEqual(V2_WAIT_DELAYS, [3000, 6000, 12000]);
  assert.equal(r.calls, 3, 'load() calls (each = 1 /api/hunt/v2/view + 1 /api/hunt)');
  assert.deepEqual(r.gaps, [6000, 12000], 'the backoff');
  assert.equal(r.stopped, true, 'the Retry state');
});

test('M1: the waiter itself refuses a 4th re-read, also when a caller ignores `stopped`', async () => {
  let calls = 0; const tick = () => new Promise((r) => setImmediate(r));
  const w = v2Waiter({ timer: (fn) => fn(), load: async () => { calls += 1; }, paint: () => {} });
  for (let i = 0; i < 10; i += 1) { w.wait(); await tick(); }
  assert.equal(calls, 3);
  assert.equal(w.stopped, true);
});

test('M1: slow answers (20 s) and the tab opened again every 10 s: one chain, still 3 re-reads in 10 min', async () => {
  const r = await sim({ answer: fail, lat: 20000, reopenEvery: 10000 });
  assert.equal(r.maxInFlight, 1, 'never 2 requests at one time');
  assert.equal(r.calls, 3);
  assert.equal(r.stopped, true);
});

test('M1: Retry gives 3 more re-reads; a success ends the wait', async () => {
  const r = await sim({ answer: fail, minutes: 1 });
  r.w.reset(); assert.equal(r.w.stopped, false);
  let ok = 0; const w = v2Waiter({ timer: (fn) => fn(), load: async () => { ok += 1; }, paint: () => {} });
  w.wait(); await new Promise((res) => setImmediate(res));
  assert.equal(ok, 1);
  const s = await sim({ answer: () => ({ v: { ok: true, day: { status: 'active' } }, err: null }) });
  assert.equal(s.calls, 1, 'the first re-read succeeds: no more calls');
  assert.equal(huntV2Step(s.d, s.v, s.err), 'v2');
});

test('L1: a screen open across the MT midnight leaves the loader at the first re-read', async () => {
  const r = await sim({ answer: () => ({ d: { ...today, v2day: false, roster: [] }, v: { ok: true, day: null }, err: null }) });
  assert.equal(r.calls, 1);
  assert.equal(huntV2Step(r.d, r.v, r.err), 'v1');
});
