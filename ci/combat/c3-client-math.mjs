// Combat check 3: no combat math in tcg-activity/src and tcg-bot/src (docs/f3-effect-engine.md section 3, "The three CI checks", item 3;
// docs/foundations.md section 0: "No number is copied into JS"). No database.
//   Files: every git-tracked .js, .mjs and .ts file under tcg-activity/src and tcg-bot/src, except tests (*.test.*).
//   Rule A (every file): the name of a combat balance number (a leaf of the c3-client-math.json "keys" in docs/data/balance.md, the generated
//     balance reference; only leaf names with "_", so that common words such as "crit" do not count). The client shows the numbers that the
//     server sends; a leaf name in the client is allowed only to show a value that the server sent (an allowlist entry with that reason).
//   Rule B (the files whose name matches "oldFiles": squad, team, crit, combat): the constants of the old JS fight math (F-3 PR 1 removed them:
//     the synergy factors 1.08 to 1.20 and the cap 1.6, the armored factor 0.72, the weakness steps, the support search weights).
//   Rule C (every file): the formula shapes of the old JS fight math ("oldFormulas", for example Math.min(1.6, ...) and 0.5 ** n).
//   An allowlist ("allow": { file: { count, reason } }) is a ratchet. The check FAILS on a hit above the allowlist, an entry with no reason, or an
//   entry above the real count.
//   node ci/combat/c3-client-math.mjs
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git, readJson, summary } from './lib.mjs';

/** The leaf names of the keys from docs/data/balance.md ("Shape: `object { a: number, ... }`" under "### <key>"). */
export function balanceLeaves(md, keys) {
  const text = md.replace(/\r/g, '');
  const out = new Set();
  const missing = [];
  for (const k of keys) {
    const i = text.indexOf(`\n### ${k}\n`);
    if (i < 0) { missing.push(k); continue; }
    const j = text.indexOf('\n### ', i + 5);
    const sh = text.slice(i, j < 0 ? text.length : j).match(/^Shape: `(.*)`$/m);
    if (!sh) { missing.push(k); continue; }
    for (const m of sh[1].matchAll(/([a-z][a-z0-9_]*):/g)) if (m[1].includes('_')) out.add(m[1]);
  }
  return { leaves: [...out].sort(), missing };
}

/** The hits of one file: [text]. */
export function hits(path, text, leaves, cfg) {
  const out = [];
  if (leaves.length) for (const m of text.matchAll(new RegExp(String.raw`\b(${leaves.join('|')})\b`, 'g'))) out.push(`balance leaf ${m[1]}`);
  const base = path.split('/').pop();
  if (new RegExp(cfg.oldFiles, 'i').test(base)) {
    for (const c of cfg.oldConstants) for (const m of text.matchAll(new RegExp(String.raw`(?<![\w.])${c.replace('.', '\\.')}(?![\w.])`, 'g'))) out.push(`old constant ${m[0]}`);
  }
  for (const f of cfg.oldFormulas) for (const m of text.matchAll(new RegExp(f, 'g'))) out.push(`old formula ${m[0]}`);
  return out;
}

/** The check. files: [{ path, text }]. Returns { problems, counted, leaves }. */
export function check(files, md, cfg) {
  const problems = [];
  const { leaves, missing } = balanceLeaves(md, cfg.keys);
  if (missing.length) problems.push(`docs/data/balance.md has no shape for the balance key(s) ${missing.join(', ')} (generate it again: gen-data-docs.mjs, or change "keys")`);
  if (leaves.length < 20) problems.push(`only ${leaves.length} combat balance leaf names found in docs/data/balance.md: the reader is broken`);
  const allow = cfg.allow || {};
  for (const [f, e] of Object.entries(allow)) {
    if (!e || typeof e.reason !== 'string' || e.reason.trim().length < 10) problems.push(`allowlist ${f}: no reason`);
  }
  const seen = {};
  for (const f of files) {
    const h = hits(f.path, f.text, leaves, cfg);
    seen[f.path] = h.length;
    const ok = allow[f.path]?.count || 0;
    if (h.length > ok) problems.push(`${f.path}: ${h.length} combat math hit(s), the allowlist permits ${ok}: ${[...new Set(h)].slice(0, 5).join(', ')}. The client shows the numbers of the server (SQL); it does not calculate a fight value.`);
  }
  for (const [f, e] of Object.entries(allow)) {
    if ((seen[f] || 0) < (e?.count || 0)) problems.push(`ratchet: ${f} has ${seen[f] || 0} hit(s), the allowlist permits ${e.count}. Lower the count in ci/combat/c3-client-math.json.`);
  }
  return { problems, counted: files.length, leaves };
}

export function clientFiles() {
  return git('ls-files', 'tcg-activity/src', 'tcg-bot/src').split('\n')
    .filter((p) => /\.(js|mjs|ts)$/.test(p) && !/\.test\./.test(p))
    .map((p) => ({ path: p, text: readFileSync(join(ROOT, p), 'utf8') }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = readJson('c3-client-math.json');
  const md = readFileSync(join(ROOT, 'docs', 'data', 'balance.md'), 'utf8');
  const r = check(clientFiles(), md, cfg);
  summary(`## Combat check 3: no combat math in tcg-activity/src and tcg-bot/src\n\n${r.counted} files read, ${r.leaves.length} combat balance leaf names.\n`);
  if (r.problems.length) { summary(r.problems.map((p) => `- FAIL ${p}`).join('\n')); process.exit(1); }
  summary('PASS no combat math in the client code.');
}
