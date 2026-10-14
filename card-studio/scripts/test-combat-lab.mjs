/**
 * Acceptance test of the Combat Lab (docs/foundations.md F-3 acceptance test 2: "a planted infinite loop (a mutation) makes the Combat Lab fail").
 *
 * 1. BASELINE: the Lab runs on the live code, in its small size (--tiny). It must have no INVARIANT, REWARD or COOLDOWN finding. The LOOP and
 *    LOCK findings that it has on the live data are written to a temporary baseline file (they are design questions, not planted ones).
 *    The result of the baseline run is printed in this run: a mutation result is not valid when the baseline is red.
 * 2. MUTATIONS: each mutation (scripts/lab-mutations.mjs) changes one live function inside every request of the Lab (undone with it). The
 *    Lab must exit with 1 and must print a NEW finding of the class that the mutation breaks:
 *      cooldown-0             COOLDOWN   a support with a cooldown of 0
 *      infinite-loop          LOOP       a function that never returns (cut by the request limit)
 *      foes-heal-everything   LOOP/LOCK  a heal larger than all damage: a fight that cannot end
 *      negative-hp            INVARIANT  HP below 0
 *      hunt-negative-hp       INVARIANT  HP below 0 in the Hunt
 *      prize-paid-twice       REWARD     a prize that pays twice
 *
 *   LOCALDB=1 node scripts/test-combat-lab.mjs [name ...]      (names: run only these mutations)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB_MUTATIONS, mutationFile } from './lab-mutations.mjs';
if (process.env.LOCALDB !== '1') throw new Error('test-combat-lab.mjs runs on the LOCAL copy only: LOCALDB=1 node scripts/test-combat-lab.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = join(tmpdir(), 'combat-lab-test'); mkdirSync(dir, { recursive: true });
const only = process.argv.slice(2);
const run = (args, env = {}) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [join(HERE, 'combat-lab.mjs'), '--tiny', ...args], { env: { ...process.env, LOCALDB: '1', LOCALDB_QUIET: '1', LAB_LIMIT_S: '6', ...env }, encoding: 'utf8', timeout: 240_000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, s: Math.round((Date.now() - t) / 1000) };
};
const report = (name) => JSON.parse(readFileSync(join(dir, name, 'report.json'), 'utf8'));
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// --- 1. the baseline -------------------------------------------------------------------------------------------------
const sections = 'data,dungeon,rewards';
const base = run(['--sections', sections, '--no-baseline', '--out', join(dir, 'base')]);
if (!existsSync(join(dir, 'base', 'report.json'))) { console.log(base.out.slice(-2000)); check(false, 'the baseline Lab run made no report'); process.exit(1); }
const br = report('base');
const hard = br.findings.filter((f) => ['INVARIANT', 'REWARD', 'COOLDOWN'].includes(f.cls));
const soft = br.findings.filter((f) => ['LOOP', 'LOCK'].includes(f.cls));
console.log(`baseline Lab (sections ${sections}, ${base.s} s): ${br.findings.length} findings, ${hard.length} hard, ${soft.length} LOOP/LOCK; exit ${base.code}`);
for (const f of [...hard, ...soft].slice(0, 8)) console.log(`   ${f.cls}: ${f.msg}`);
check(hard.length === 0 && !br.aborted, 'baseline: the live code has no INVARIANT, REWARD or COOLDOWN finding and the Lab did not stop');
const baselineFile = join(dir, 'baseline.json');
writeFileSync(baselineFile, JSON.stringify({ known: Object.fromEntries(soft.map((f) => [f.key, f.msg])) }));
if (hard.length || br.aborted) { console.log('the baseline is red: the mutation results below are not valid'); process.exit(1); }
const base2 = run(['--sections', sections, '--baseline', baselineFile, '--out', join(dir, 'base2')]);
check(base2.code === 0, `baseline: with the ${soft.length} known LOOP/LOCK findings in the baseline file, the Lab exits 0 (${base2.s} s)`);

// --- 2. the mutations ------------------------------------------------------------------------------------------------
for (const m of LAB_MUTATIONS) {
  if (only.length && !only.includes(m.name)) continue;
  const file = mutationFile(m.name, m.file, m.from, m.to);
  const r = run(['--sections', m.sections, '--baseline', baselineFile, '--out', join(dir, m.name)], { LAB_MUTATE: file });
  const rep = existsSync(join(dir, m.name, 'report.json')) ? report(m.name) : { findings: [] };
  const hit = rep.findings.filter((f) => m.expect.includes(f.cls) && !f.known);
  check(r.code === 1 && hit.length > 0, `mutation ${m.name} (${m.what}): the Lab exits ${r.code} with ${hit.length} new ${m.expect.join('/')} finding(s) (${r.s} s)${hit[0] ? `: ${hit[0].msg.slice(0, 150)}` : ` -- ${r.out.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`}`);
}
console.log(fails ? `FAILS ${fails}` : 'PASS all');
process.exit(fails ? 1 : 0);
