/**
 * Acceptance test for localdb-guard.mjs (2026-10-14: the Hunt golden ran on the LIVE project: LOCALDB=1 with no localdb preload uses the
 * live token from .env). No database is used and no network request is made.
 *   node scripts/test-localdb-guard.mjs                      must PASS
 *   MUTATE=<name> node scripts/test-localdb-guard.mjs        must FAIL: guard-open (the guard does not stop), guard-unlisted (a script reads LOCALDB, has no
 *                                                            guard import and no reason), guard-off-by-import (a script lost its import)
 * Invariants:
 *   1. With LOCALDB=1 and no preload, the guard exits 2 with a clear message; with the preload (globalThis.__LOCALDB_API) or without LOCALDB it does nothing.
 *   2. Real entry points, started with LOCALDB=1 and no preload, are refused (exit not 0 and the message), in a temp directory with no .env and no
 *      SUPABASE_* variables, so even a broken guard cannot reach a live project.
 *   3. EVERY script that reads process.env.LOCALDB either imports the guard (or lab-lib, which loads the preload and checks inline) or is on the
 *      named list below with its reason.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || '';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// Scripts that read LOCALDB and do not import the guard, each with the reason.
const EXEMPT = {
  'localdb-preload.mjs': 'it IS the preload',
  'localdb-guard.mjs': 'it IS the guard',
  'test-localdb-guard.mjs': 'this test',
  'lab-lib.mjs': 'loads the preload by itself, then checks inline',
  'combat-golden.mjs': 'loads the preload by itself, then checks inline',
  'apply-sql.mjs': 'its own guard (apply-sql-guard.test.mjs proves it)',
  'apply-sql-guard.test.mjs': 'it runs apply-sql with LOCALDB=1 and no preload on purpose',
  'rehearse-sql.mjs': 'sets NODE_OPTIONS=--import=preload for its children',
  'test-all-local.mjs': 'the runner: starts every child with --import preload',
  'find-superseded.mjs': 'talks to the local postgres-meta directly (LOCALDB_ENV), no live path',
  'check-sets.mjs': 'reads the local copy directly (LOCALDB_ENV), no live path',
  'loadtest-dungeon.mjs': 'reads the local env file only',
  'loadtest-roundtrips.mjs': 'reads the local env file only',
  'loadtest-idle.mjs': 'reads the local env file only',
  'set-backup-password.mjs': 'a read of LOCALDB inside an ssh helper: no SQL request',
};
const GUARD_IMPORT = /^import ['"]\.\/localdb-guard\.mjs['"];?/m;
let guardTarget = join(HERE, 'localdb-guard.mjs');
if (MUTATE === 'guard-open') {
  const d = mkdtempSync(join(tmpdir(), 'lg-'));
  guardTarget = join(d, 'localdb-guard.mjs');
  writeFileSync(guardTarget, readFileSync(join(HERE, 'localdb-guard.mjs'), 'utf8').replace("process.env.LOCALDB === '1' &&", 'false &&'));
}

// A cwd with no .env and an environment with no SUPABASE_*: a broken guard still cannot reach a project.
const cwd = mkdtempSync(join(tmpdir(), 'lg-cwd-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SUPABASE_|^NODE_OPTIONS$/.test(k)));
const run = (args, e = {}) => spawnSync(process.execPath, args, { cwd, env: { ...env, ...e }, encoding: 'utf8', timeout: 30000 });

// 1. the guard itself
const g = JSON.stringify(pathToFileURL(guardTarget).href);
let r = run(['--input-type=module', '-e', `import ${g}; console.log('RAN')`], { LOCALDB: '1' });
check(r.status === 2 && /LIVE/.test(r.stderr) && !/RAN/.test(r.stdout), `LOCALDB=1, no preload: the guard exits 2 with the message (exit ${r.status}, ran: ${/RAN/.test(r.stdout)})`);
r = run(['--input-type=module', '-e', `globalThis.__LOCALDB_API = 'x'; await import(${g}); console.log('RAN')`], { LOCALDB: '1' });
check(r.status === 0 && /RAN/.test(r.stdout), 'LOCALDB=1 with the preload flag: the guard lets the script run');
r = run(['--input-type=module', '-e', `import ${g}; console.log('RAN')`]);
check(r.status === 0 && /RAN/.test(r.stdout), 'no LOCALDB: the guard does nothing');

// 2. real entry points with no preload (the scripts that import the guard; lab-lib scripts load the preload by themselves)
for (const f of ['test-hunt-calendar.mjs', 'gen-schema-snapshot.mjs', 'balance.mjs', 'test-golden-mutations.mjs', 'check-schema-drift.mjs', 'test-schema-snapshot.mjs']) {
  r = run([join(HERE, f)], { LOCALDB: '1', LOCALDB_ENV: join(cwd, 'none.env') });
  const all = `${r.stderr}${r.stdout}`;
  const line = all.split('\n').find((l) => /preload|LIVE/.test(l));
  check(r.status !== 0 && !!line, `${f} with LOCALDB=1 and no preload is refused (exit ${r.status}): ${line ? line.slice(0, 110) : 'NO REFUSAL'}`);
}

// 3. every script that reads LOCALDB is covered (text check: nothing runs)
const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs'));
const text = (f) => {
  let s = readFileSync(join(HERE, f), 'utf8');
  if (MUTATE === 'guard-unlisted' && f === 'test-hunt-calendar.mjs') s = s.replace("import './localdb-guard.mjs';", '');
  if (MUTATE === 'guard-off-by-import' && f === 'balance.mjs') s = s.replace("import './localdb-guard.mjs';", '// import');
  return s;
};
const reads = (f) => /process\.env\.LOCALDB\b(?!_)/.test(text(f));
const uncovered = files.filter((f) => reads(f) && !EXEMPT[f] && !GUARD_IMPORT.test(text(f)) && !/^import .*lab-lib/m.test(text(f)));
check(uncovered.length === 0, `every script that reads LOCALDB imports the guard, uses lab-lib, or has a named reason (${files.filter(reads).length} read it; uncovered: ${uncovered.join(', ') || 'none'})`);
const stale = Object.keys(EXEMPT).filter((f) => !files.includes(f));
check(stale.length === 0, `the exempt list names no missing file (${stale.join(', ') || 'none'})`);
rmSync(cwd, { recursive: true, force: true });
console.log(fails ? `FAILS ${fails}` : 'PASS all');
process.exit(fails ? 1 : 0);
