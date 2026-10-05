// Shared helpers for the UI gates (docs/design.md 12.5): the UI scope, git, the register, the job summary.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCOPE = JSON.parse(readFileSync(fileURLToPath(new URL('./scope.json', import.meta.url)), 'utf8'));

// A glob with "**" (any folders) and "*" (any name part, no "/").
export function globRe(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp(`^${re}$`);
}
const match = (globs) => { const res = globs.map(globRe); return (p) => res.some((r) => r.test(p)); };
const inUi = match(SCOPE.ui), notUi = match(SCOPE.notUi), isToken = match(SCOPE.tokenSource);

/** A file whose change makes the PR a UI PR (G1). */
export const isUiFile = (p) => inUi(p) && !notUi(p);
/** A file that the literal counter reads (G4). */
export const isLiteralFile = (p) => isUiFile(p) && !isToken(p) && SCOPE.literalExtensions.some((x) => p.endsWith(x));

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** The base and head of the change: the PR base (env) or origin/main, and HEAD. */
export function range() {
  const head = process.env.HEAD_SHA || 'HEAD';
  const baseRef = process.env.BASE_SHA || 'origin/main';
  const base = git('merge-base', baseRef, head).trim();
  return { base, head };
}

/** Parse docs/ui-register.md: { 'UI-00': { id, screen, design, approved, built, standard, notes } }. */
export function parseRegister(text) {
  const rows = {};
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|\s*UI-\d{2}\s*\|/.test(line)) continue;
    const c = line.split('|').slice(1, -1).map((s) => s.trim());
    const [id, screen, design, approved, built, standard, notes] = c;
    rows[id] = { id, screen, design, approved, built, standard, notes };
  }
  return rows;
}

/** A design approval in the register format of design.md 12.4: "YYYY-MM-DD, design, <where>". */
export const isDesignApproved = (approved) => /^\d{4}-\d{2}-\d{2},\s*design\b/i.test(approved || '');

/** The register IDs in a PR title ("UI-07 ..." or "feat(ui): UI-07, UI-08 ..."). */
export const titleIds = (title) => [...new Set((String(title || '').match(/\bUI-\d{2}\b/g) || []))];

/** Write to the GitHub job summary (and to stdout). */
export function summary(md) {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
