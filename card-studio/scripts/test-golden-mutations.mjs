/**
 * Mutation evidence for the golden tests (docs/foundations.md F-3 acceptance test 5: "the golden fights are the same before and after each
 * clean-up PR"). A golden test that no change can fail proves nothing, so this test changes one function a little (scripts/lab-mutations.mjs)
 * and checks that the golden test FAILS, and that it passes on the unchanged live text.
 *
 *   Hunt golden (scripts/combat-golden.mjs, 84 fights):       baseline PASS, the live text as a candidate PASS, each Hunt mutation FAIL
 *   Dungeon / Gauntlet golden (scripts/dungeon-golden.mjs):   the same (1 seed for each scenario: GOLDEN_SEEDS=1; the base transcripts are made once)
 *
 * The baseline of each golden test runs in this run first (a mutation result is not valid when the baseline is red).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-golden-mutations.mjs [hunt|dungeon]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GOLDEN_MUTATIONS, mutationFile } from './lab-mutations.mjs';
if (process.env.LOCALDB !== '1') throw new Error('test-golden-mutations.mjs runs on the LOCAL copy only: LOCALDB=1 node scripts/test-golden-mutations.mjs');
const HERE = dirname(fileURLToPath(import.meta.url));
// Each golden script runs in a child. A child with no localdb preload sends its SQL to the LIVE project (the live token is in .env): the child gets
// --import here, and this file refuses to run when its own run has no preload.
if (!globalThis.__LOCALDB_API) throw new Error('test-golden-mutations.mjs: run it with the preload: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-golden-mutations.mjs');
const ROOT = join(HERE, '..', '..');
const which = process.argv[2];
const cache = join(tmpdir(), 'golden-mutations'); mkdirSync(cache, { recursive: true });
const cacheFile = join(cache, 'dungeon-base.json'); rmSync(cacheFile, { force: true });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const run = (script, env = {}) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(join(HERE, 'localdb-preload.mjs')).href, join(HERE, script)], { env: { ...process.env, LOCALDB: '1', LOCALDB_QUIET: '1', ...env }, encoding: 'utf8', timeout: 280_000, cwd: join(HERE, '..') });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { code: r.status, out, last: out.split('\n').filter((l) => !/^\[/.test(l)).join(' / ').slice(0, 260), s: Math.round((Date.now() - t) / 1000) };
};
// the identity candidate: the live text of a function, from the schema snapshot (the file has comment lines and grants: valid SQL)
const live = (f) => join(ROOT, 'db', 'schema', 'functions', `${f}.sql`);

for (const g of [['hunt', 'combat-golden.mjs', {}], ['dungeon', 'dungeon-golden.mjs', { GOLDEN_SEEDS: '1', GOLDEN_CACHE: cacheFile }]]) {
  const [name, script, env] = g;
  if (which && which !== name) continue;
  const b = run(script, env);
  check(b.code === 0 && /^PASS|\nPASS|PASS \d+ fights/.test(b.out), `${name} golden, baseline (the live code twice with the same seeds): ${b.last} (${b.s} s)`);
  if (b.code !== 0) { console.log(`the ${name} baseline is red: its mutation results are not valid`); continue; }
  const id = run(script, { ...env, CANDIDATE: live(name === 'hunt' ? 'hunt_attack' : 'dungeon_attack') });
  check(id.code === 0 && /matches the live code exactly/.test(id.out), `${name} golden, the live text of ${name === 'hunt' ? 'hunt_attack' : 'dungeon_attack'} as a candidate matches: ${id.last} (${id.s} s)`);
  for (const m of GOLDEN_MUTATIONS.filter((x) => x.golden === name)) {
    const f = mutationFile(m.name, m.file, m.from, m.to);
    const r = run(script, { ...env, CANDIDATE: f });
    check(r.code === 1 && /DIFF|ZEROSTAR/.test(r.out), `${name} golden fails on the mutation ${m.name} (${m.what}): ${r.last.slice(0, 160)} (${r.s} s)`);
  }
}
console.log(fails ? `FAILS ${fails}` : 'PASS all');
process.exit(fails ? 1 : 0);
