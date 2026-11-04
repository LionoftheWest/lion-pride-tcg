// node --test src/ui-v2-dungeon-v2.test.js      (MUTATE=<name> for one mutation; MUTATE=all runs the baseline and each mutation)
// R2b: the Dungeon test mode of the v2 fight view (ui-v2-gauntlet2.js v2OwnsDungeon, v2CanStart; R2 SPEC v3 3.4, QD2):
//   S1 a non-tester answer (403 not_tester), an error, or no answer never takes the screen and never shows "Play v2 (test)" (v1 unchanged).
//   S2 the tester's ACTIVE v2 run takes the screen, also next to a v1 run of the same day.
//   S3 a v2 run that is OVER takes the screen only when the v1 run is not active (QD2: the v1 run of the day keeps its screens).
//   S4 "Play v2 (test)" only when the server says tester AND can_start (the client never decides it).
// A mutation is a copy of the real file with ONE text change, loaded by this same test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
export const MUTATIONS = {
  over_hides_v1: ["(v.run.status === 'over' && v1?.run?.status !== 'active')", "v.run.status === 'over'"],
  any_run_owns: ["(v.run.status === 'active' || (v.run.status === 'over' && v1?.run?.status !== 'active'))", 'true'],
  no_ok_check: ['export const v2OwnsDungeon = (v, v1) => !!(v?.ok && v.run &&', 'export const v2OwnsDungeon = (v, v1) => !!(v?.run &&'],
  start_without_tester: ['!!(v?.ok && v.tester === true && v.can_start === true)', '!!(v?.ok && v.can_start === true)'],
  start_from_client: ['!!(v?.ok && v.tester === true && v.can_start === true)', '!!(v?.ok && v.tester === true && !v.run)'],
};

if (process.env.MUTATE === 'all') {
  const self = fileURLToPath(import.meta.url);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const run = (name) => spawnSync(process.execPath, ['--test', '--test-reporter=tap', self], { env: { ...env, MUTATE: name }, encoding: 'utf8' });
  const tap = (out) => `pass ${/# pass (\d+)/.exec(out)?.[1]} fail ${/# fail (\d+)/.exec(out)?.[1]}`;
  test('MUTATE=all: the baseline passes and every mutation fails', () => {
    const base = run('');
    console.log(`# baseline: ${tap(base.stdout)} -> ${base.status === 0 ? 'PASS' : 'FAIL'}`);
    assert.equal(base.status, 0, 'baseline');
    const missed = [];
    for (const name of Object.keys(MUTATIONS)) {
      const r = run(name);
      const failed = r.status !== 0 && !/the text matches/.test(r.stdout + r.stderr);
      console.log(`# ${name}: ${tap(r.stdout)} -> ${failed ? 'FAILS (caught)' : 'PASSES (NOT caught)'}`);
      if (!failed) missed.push(name);
    }
    console.log(`# all ${Object.keys(MUTATIONS).length - missed.length} of ${Object.keys(MUTATIONS).length} caught`);
    assert.deepEqual(missed, []);
  });
} else {
  await suite();
}

async function loadModule() {
  const name = process.env.MUTATE;
  if (!name) return import('./ui-v2-gauntlet2.js');
  const m = MUTATIONS[name]; if (!m) throw new Error(`unknown mutation ${name}`);
  let src = readFileSync(join(here, 'ui-v2-gauntlet2.js'), 'utf8');
  const n = src.split(m[0]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  src = src.replace(m[0], m[1]).replace(/from '\.\/([^']+)'/g, (_, p) => `from ${JSON.stringify(pathToFileURL(join(here, p)).href)}`);
  const file = join(mkdtempSync(join(tmpdir(), 'r2b-ui-mut-')), `ui-v2-gauntlet2.${name}.mjs`);
  writeFileSync(file, src);
  console.log(`# MUTATE=${name} (${file})`);
  return import(pathToFileURL(file).href);
}

async function suite() {
  const { v2OwnsDungeon, v2CanStart } = await loadModule();
  const NOT_TESTER = { ok: false, error: 'not_tester', message: 'Combat v2 is for testers only.' };
  const view = (run, extra = {}) => ({ ok: true, tester: true, runs_left: run ? 0 : 1, can_start: !run, run, ...extra });
  const v1 = (status) => ({ ok: true, run: status ? { id: 7, status } : null });

  test('S1 a non-tester, an error or no answer: no v2 screen and no Play v2 button, whatever the v1 run', () => {
    for (const v of [NOT_TESTER, null, undefined, { error: 'boom' }, { ok: false, error: 'disabled', run: { status: 'active' } }]) {
      for (const one of [v1(null), v1('active'), v1('over')]) assert.equal(v2OwnsDungeon(v, one), false, JSON.stringify(v));
      assert.equal(v2CanStart(v), false, JSON.stringify(v));
    }
  });
  test('S2 the active v2 run takes the screen (with no v1 run, an over v1 run, an active v1 run)', () => {
    for (const one of [v1(null), v1('over'), v1('active')]) assert.equal(v2OwnsDungeon(view({ id: 1, status: 'active' }), one), true);
  });
  test('S3 an over v2 run takes the screen only when the v1 run is not active (QD2)', () => {
    const v = view({ id: 1, status: 'over', ended_by: 'fell' });
    assert.equal(v2OwnsDungeon(v, v1(null)), true);
    assert.equal(v2OwnsDungeon(v, v1('over')), true);
    assert.equal(v2OwnsDungeon(v, v1('active')), false);
    assert.equal(v2OwnsDungeon(view(null), v1(null)), false, 'no v2 run: the v1 lobby');
  });
  test('S4 Play v2 (test) only for tester and can_start, both from the server', () => {
    assert.equal(v2CanStart(view(null)), true);
    assert.equal(v2CanStart(view(null, { can_start: false })), false, 'no run left today');
    assert.equal(v2CanStart(view(null, { tester: false, can_start: true })), false, 'a removed tester');
    assert.equal(v2CanStart(view({ id: 1, status: 'over' }, { can_start: false })), false, 'the run of today is used');
  });
}
