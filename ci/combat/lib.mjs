// Shared helpers of the three combat checks (docs/f3-effect-engine.md section 3, the row "4e" and "The three CI checks"). No database:
// the checks read the schema snapshot (db/schema/functions, the live text), the migrations that the PR changes (tcg-bot/supabase/*.sql),
// docs/data/balance.md and the client code (tcg-activity/src, tcg-bot/src).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
export const readJson = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8'));

/** Remove the SQL comments ("--" to the end of the line, and block comments). Strings stay. */
export function stripSqlComments(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '-' && n === '-') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
    if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === "'") {
      let j = i + 1;
      while (j < src.length) { if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } break; } j += 1; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** Replace each string literal ('...') with '' and each quoted identifier with "" (after stripSqlComments). */
export function stripSqlStrings(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      let j = i + 1;
      while (j < src.length) { if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } break; } j += 1; }
      out += "''"; i = j + 1; continue;
    }
    if (c === '"') { const j = src.indexOf('"', i + 1); out += '""'; i = j < 0 ? src.length : j + 1; continue; }
    out += c; i += 1;
  }
  return out;
}

/**
 * The functions of one SQL text: [{ name, body }]. A function is "create [or replace] function [public.]name(" up to its dollar-quoted body.
 * The body is the text between the two dollar tags (the comments are not removed here).
 */
export function sqlFunctions(src) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index);
    const a = rest.search(/\bas\s+\$[a-z_]*\$/i);
    if (a < 0) continue;
    const tag = rest.slice(a).match(/\$[a-z_]*\$/i)[0];
    const b0 = rest.indexOf(tag, a) + tag.length;
    const b1 = rest.indexOf(tag, b0);
    if (b1 < 0) continue;
    out.push({ name: m[1].toLowerCase(), body: rest.slice(b0, b1) });
    re.lastIndex = m.index + b1 + tag.length;
  }
  return out;
}

/** The live functions: db/schema/functions/<name>.sql (one file for each name; overloads are in the same file). */
export function snapshotFunctions(dir = join(ROOT, 'db', 'schema', 'functions')) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/\r/g, '');
    for (const fn of sqlFunctions(text)) out.push({ ...fn, where: `db/schema/functions/${f}` });
  }
  return out;
}

/** The migrations that the PR adds or changes (tcg-bot/supabase/*.sql against the merge base), and their functions. */
export function changedMigrationFunctions() {
  const head = process.env.HEAD_SHA || 'HEAD';
  const baseRef = process.env.BASE_SHA || 'origin/main';
  let files = [];
  try {
    const base = git('merge-base', baseRef, head).trim();
    files = git('diff', '--name-only', '--diff-filter=AMR', base, head, '--', 'tcg-bot/supabase').split('\n')
      .filter((f) => /^tcg-bot\/supabase\/[^/]+\.sql$/.test(f));
  } catch (e) {
    console.log(`(no merge base with ${baseRef}: only the snapshot is checked) ${String(e.message).split('\n')[0]}`);
  }
  const out = [];
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    const text = readFileSync(join(ROOT, f), 'utf8').replace(/\r/g, '');
    for (const fn of sqlFunctions(text)) out.push({ ...fn, where: f });
  }
  return { files, functions: out };
}

/** Write to the GitHub job summary (and to stdout). */
export function summary(md) {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
