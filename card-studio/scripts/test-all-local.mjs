// Run every SQL test (scripts/test-*.mjs) against the LOCAL Supabase copy, one after the other, and
// print one line per test (Nathan, 2026-10-02). Needs the local stack up (tools: localdb/up.sh).
//   node scripts/test-all-local.mjs [name-filter]
// Each test runs with LOCALDB=1 and localdb-preload.mjs, so it cannot reach the live project.
// A test passes when it exits 0 and prints no FAIL line (and no "FAILS n" with n > 0).
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2] || '';
const tests = readdirSync(join(root, 'scripts')).filter((f) => /^test-.*\.mjs$/.test(f) && f !== 'test-all-local.mjs' && f.includes(filter)).sort();
// Tests that need the migration file they check: the NEWEST file that defines the function.
// The Hunt tests run on the CURRENT functions (combat_core.sql replaced hunt_attack / hunt_support; the older
// files would put the pre-core versions back inside the test). logs_sql.sql (the current prune_old_rows) is applied because the local
// copy has no pg_cron jobs and no API-role revokes (the dump does not carry them); its function is the live one.
const ARGS = {
  'test-hunt-loop-caps.mjs': ['--live'],
  'test-hunt-squad-done.mjs': ['live'],
  'test-hunt-schedule-mt.mjs': ['../tcg-bot/supabase/hunt_schedule_mt.sql'],
  'test-prune-old-rows.mjs': ['../tcg-bot/supabase/logs_sql.sql'], // the current prune_old_rows (365 days, 2026-10-07)
  'test-events.mjs': ['../tcg-bot/supabase/events.sql'], // a fresh local copy has no pg_cron jobs: the file makes event-tick inside the test
  'test-achievement-tracks.mjs': ['--live'],
  'test-adventure-dailies.mjs': ['--live'],
};
// One-time acceptance tests of a data conversion: they expect the state BEFORE it ran, so they fail
// afterwards by design (on live too). Skipped, with the reason.
const ONE_TIME = {
  'test-gift-claims.mjs': 'the launch-day conversion of the 211 x 20 grants (gift_claims.sql refuses it now: done on 2026-10-01)',
};
const logDir = join(root, 'out', 'localdb-tests'); mkdirSync(logDir, { recursive: true });
const run = (file) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, ['--import', './scripts/localdb-preload.mjs', join('scripts', file), ...(ARGS[file] || [])], { cwd: root, env: { ...process.env, LOCALDB: '1', LOCALDB_QUIET: '1' } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const kill = setTimeout(() => { out += '\n[timeout 300 s]'; p.kill(); }, 300_000);
  p.on('close', (code) => { clearTimeout(kill); resolve({ code, out, s: ((Date.now() - t0) / 1000).toFixed(1) }); });
});
let pass = 0, skipped = 0; const failed = [];
for (const f of tests) {
  if (ONE_TIME[f]) { skipped += 1; console.log(`SKIP ${f.padEnd(34)}          one-time: ${ONE_TIME[f]}`); continue; }
  const r = await run(f);
  writeFileSync(join(logDir, f.replace(/\.mjs$/, '.log')), r.out);
  const failLines = r.out.split(/\r?\n/).filter((l) => /\bFAIL\b/.test(l) && !/FAILS?\s*:?\s*0\b/.test(l));
  const failsN = [...r.out.matchAll(/FAILS?\s*:?\s*(\d+)/g)].some((m) => Number(m[1]) > 0);
  const refused = /refused a live Supabase request/.test(r.out);
  // Node on Windows can crash with a libuv assert when a script exits after fetch (exit 3221226505):
  // after a full result with no failure, that is not a test failure.
  const libuv = r.code === 3221226505 && /UV_HANDLE_CLOSING/.test(r.out);
  const ok = (r.code === 0 || libuv) && !failLines.length && !failsN && !refused && (r.code === 0 || /\bPASS\b|^\s*ok\s/m.test(r.out));
  if (ok) pass += 1; else failed.push(f);
  const why = ok ? '' : refused ? ' (tried to reach LIVE - refused)' : failLines.length ? ` ${failLines[0].trim().slice(0, 110)}` : ` exit ${r.code}: ${r.out.trim().split(/\r?\n/).pop().slice(0, 110)}`;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${f.padEnd(34)} ${r.s.padStart(6)} s${why}`);
}
console.log(`\n${pass}/${tests.length - skipped} pass${skipped ? `, ${skipped} one-time skipped` : ''}. Logs: out/localdb-tests/`);
if (failed.length) console.log('failed:', failed.join(' '));
process.exit(failed.length ? 1 : 0);
