// The job-slot guard. A free GitHub account runs at most SLOTS jobs at once. A matrix job with many
// shards must set `max-parallel`, so that one PR cannot hold every slot (2026-10-11: 24 G3 shards held
// all 20 slots for 35 min and blocked the other PRs). Runs in the g1 job, so it runs on every PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

export const SLOTS = 20; // the job limit of the free plan
export const KEEP_FREE = 8; // slots kept for the G1/G4 jobs of other PRs
export const MAX_PARALLEL = SLOTS - KEEP_FREE;
export const BIG_MATRIX = 8; // a matrix larger than this needs max-parallel

const WORKFLOW = new URL('../../.github/workflows/ui-gates.yml', import.meta.url);

// Line-based parse (no YAML dependency). Handles inline lists (`key: [a, b]`) in the matrix.
// Returns [{ job, size, maxParallel }] for each job that has a `strategy.matrix`.
export function matrixJobs(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, ''));
  const jobs = [];
  let inJobs = false;
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
    if (!inJobs) continue;
    const j = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (j) { cur = { job: j[1], size: 0, maxParallel: null, hasMatrix: false }; jobs.push(cur); continue; }
    if (!cur) continue;
    const mp = /^ {6}max-parallel:\s*(\S+)\s*$/.exec(l);
    if (mp) cur.maxParallel = mp[1];
    if (/^ {6}matrix:\s*$/.test(l)) {
      cur.hasMatrix = true;
      let size = 1;
      for (let k = i + 1; k < lines.length && /^ {8}\S/.test(lines[k]); k++) {
        const m = /^ {8}([A-Za-z0-9_-]+):\s*\[(.*)\]\s*$/.exec(lines[k]);
        if (!m) throw new Error(`matrix line not understood in job ${cur.job}: ${lines[k].trim()}`);
        if (m[1] === 'include' || m[1] === 'exclude') throw new Error(`matrix ${m[1]} is not supported by the guard`);
        size *= m[2].split(',').filter((s) => s.trim()).length;
      }
      cur.size = size;
    }
  }
  return jobs.filter((j) => j.hasMatrix);
}

// Returns a list of problems (empty when the workflow obeys the rule).
export function slotProblems(text) {
  const problems = [];
  const found = matrixJobs(text);
  for (const j of found) {
    if (j.size <= BIG_MATRIX) continue;
    if (j.maxParallel === null) {
      problems.push(`job ${j.job}: matrix of ${j.size} has no max-parallel (limit ${MAX_PARALLEL})`);
    } else if (!/^\d+$/.test(j.maxParallel) || Number(j.maxParallel) > MAX_PARALLEL || Number(j.maxParallel) < 1) {
      problems.push(`job ${j.job}: max-parallel ${j.maxParallel} is above ${MAX_PARALLEL} (${SLOTS} slots - ${KEEP_FREE} kept free)`);
    }
  }
  return problems;
}

test('G3 slot guard: the real workflow obeys the limit and the guard sees the G3 matrix', () => {
  const text = readFileSync(WORKFLOW, 'utf8');
  const g3 = matrixJobs(text).find((j) => j.job === 'g3-run');
  assert.ok(g3 && g3.size === 24, `the guard must find g3-run with 24 cells, found ${JSON.stringify(g3)}`);
  assert.deepEqual(slotProblems(text), []);
});

test('G3 slot guard: fails when max-parallel is removed or above the limit', () => {
  const text = readFileSync(WORKFLOW, 'utf8');
  const removed = text.replace(/^ {6}max-parallel:[^\r\n]*\r?\n/m, '');
  assert.notEqual(removed, text);
  assert.equal(slotProblems(removed).length, 1);
  const twenty = text.replace(/^( {6}max-parallel:).*$/m, '$1 20');
  assert.equal(slotProblems(twenty).length, 1);
  const thirteen = text.replace(/^( {6}max-parallel:).*$/m, '$1 13');
  assert.equal(slotProblems(thirteen).length, 1);
  assert.deepEqual(slotProblems(text.replace(/^( {6}max-parallel:).*$/m, '$1 12')), []);
});

test('slot guard: every workflow obeys the limit (ui-gates, ui-report, combat-checks, ...)', () => {
  const dir = new URL('../../.github/workflows/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /.ya?ml$/.test(f));
  assert.ok(files.includes('ui-gates.yml') && files.includes('combat-checks.yml'), files.join(', '));
  for (const f of files) assert.deepEqual(slotProblems(readFileSync(new URL(f, dir), 'utf8')), [], f);
});
