// R2-MOVE: the mutation runner of THE GATE (spec 6.2). One run = the must-pass baseline, then each mutation, on one tree.
//   node card-studio/scripts/r2-mutations.mjs              all groups (card-studio/scripts/mutations/*.mjs)
//   node card-studio/scripts/r2-mutations.mjs g1 g4        only these groups
//   node card-studio/scripts/r2-mutations.mjs --only m12   only these mutation ids (the baseline still runs)
// Each group exports { baseline: [{ name, cmd, cwd }], mutations: [{ id, file, find, replace, cmd, cwd, expect? }] }.
// A mutation edits ONE file of this tree in place (find must occur exactly once), runs its test command, and must FAIL
// (exit != 0; with `expect`, the output must also hold that text). The file is restored in a finally, then checked.
// Line 1 = the commit (git rev-parse HEAD). Stop line: RESULT PASS failed=0, else RESULT FAIL failed=<n> (exit 1).
import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args.slice(onlyIdx + 1)) : null;
const groupsWanted = (onlyIdx >= 0 ? args.slice(0, onlyIdx) : args).filter((a) => !a.startsWith('-'));

const head = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim();
console.log(`commit ${head}${dirty ? ' (+ uncommitted changes)' : ''}`);

const run = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd: join(ROOT, cwd || '.'), shell: true, encoding: 'utf8', timeout: 600_000, env: { ...process.env, FORCE_COLOR: '0' } });
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const tail = (s, n = 6) => s.trim().split('\n').slice(-n).map((l) => `    | ${l}`).join('\n');

const mdir = join(here, 'mutations');
const files = readdirSync(mdir).filter((f) => f.endsWith('.mjs')).sort()
  .filter((f) => !groupsWanted.length || groupsWanted.includes(f.replace(/\.mjs$/, '')));
let failed = 0;
for (const f of files) {
  const g = (await import(pathToFileURL(join(mdir, f)).href)).default;
  const group = f.replace(/\.mjs$/, '');
  for (const b of g.baseline) {
    const r = run(b.cmd, b.cwd);
    console.log(`BASELINE ${group} ${b.name} ${r.code === 0 ? 'PASS' : 'FAIL'}`);
    if (r.code !== 0) { failed += 1; console.log(tail(r.out, 15)); }
  }
  for (const m of g.mutations) {
    if (only && !only.has(m.id)) continue;
    const path = join(ROOT, m.file);
    const orig = readFileSync(path, 'utf8');
    // A Windows checkout (core.autocrlf) has CRLF line ends: the find and replace texts use the file's own line end.
    const eol = orig.includes('\r\n') ? '\r\n' : '\n';
    const find = m.find.replace(/\r?\n/g, eol), repl = m.replace.replace(/\r?\n/g, eol);
    const n = orig.split(find).length - 1;
    if (n !== 1) { failed += 1; console.log(`MUT ${m.id} BROKEN (find occurs ${n} times in ${m.file})`); continue; }
    let r;
    try {
      writeFileSync(path, orig.split(find).join(repl));
      r = run(m.cmd, m.cwd);
    } finally {
      writeFileSync(path, orig);
    }
    if (readFileSync(path, 'utf8') !== orig) { failed += 1; console.log(`MUT ${m.id} RESTORE FAILED ${m.file}`); }
    const killed = r.code !== 0 && (!m.expect || r.out.includes(m.expect));
    if (!killed) failed += 1;
    console.log(`MUT ${m.id} ${killed ? 'KILLED' : 'SURVIVED'} (exit ${r.code}${m.expect ? `, expect "${m.expect}" ${r.out.includes(m.expect) ? 'seen' : 'NOT seen'}` : ''})`);
    if (!killed || process.env.MUT_VERBOSE) console.log(tail(r.out));
  }
}
console.log(failed ? `RESULT FAIL failed=${failed}` : 'RESULT PASS failed=0');
process.exit(failed ? 1 : 0);
