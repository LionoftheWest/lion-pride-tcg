// Gate G4 Literal counter (docs/design.md 12.5, 4.1, 3.1): the counts of raw literals in the UI scope must not
// rise against the base of the PR (the merge base with main).
//   Files: every git-tracked file that isUiFile() and ends in .css .html .js .mjs .ts (ci/gates/scope.json),
//          minus the token source and the files generated from it (scope.json "tokenSource").
//   Units: color  hex (#RGB #RGBA #RRGGBB #RRGGBBAA), JS hex (0xRRGGBB), rgb() rgba() hsl() hsla()
//          px     every number with the unit px ("12px", "-0.5px")
//          z      every z-index / zIndex value that is not a var(--z-*) token
//          mland  every "m-land" selector or class name      mport  every "m-port"
//   CSS block comments are not counted. Moving a literal from one file to another does not change a total.
//   The skipped token files must be generated: G4 also fails when `node shared/build-tokens.mjs --check` fails
//   (a token is missing or invalid, or a generated file is stale or changed by hand). Otherwise a literal could hide there.
//   node ci/gates/g4-literals.mjs          env: BASE_SHA, HEAD_SHA (defaults: origin/main, HEAD)
import { pathToFileURL } from 'node:url';
import { isLiteralFile, git, range, summary } from './lib.mjs';
import { stale } from '../../shared/build-tokens.mjs';

export const UNITS = ['color', 'px', 'z', 'mland', 'mport'];
const RE = {
  color: /(?:#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-]))|(?:\b0x[0-9a-fA-F]{6}\b)|(?:\b(?:rgba?|hsla?)\()/g,
  px: /(?<![\w.$-])-?(?:\d+\.?\d*|\.\d+)px\b/g,
  z: /(?:z-index\s*:(?!\s*var\(--z-)\s*[^;}"'`\s][^;}"'`\n]*)|(?:zIndex\s*[:=](?!\s*['"`]?var\(--z-)\s*[^,;}\s][^,;}\n]*)/g,
  mland: /\bm-land\b/g,
  mport: /\bm-port\b/g,
};

/** Element ids that look like hex ("#feed" is the feed box, not a color): they are not counted as colors. */
export function hexIds(texts) {
  const ids = new Set();
  for (const t of texts) for (const m of t.matchAll(/\bid\s*(?:=|:)\s*["'`]([0-9a-fA-F]{3,8})["'`]/g)) ids.add(m[1].toLowerCase());
  return ids;
}

/** The counts of one file. */
export function countText(text, path = '', skipIds = new Set()) {
  const src = path.endsWith('.css') ? text.replace(/\/\*[\s\S]*?\*\//g, '') : text;
  const keep = (u) => (m) => !(u === 'color' && m[0] === '#' && skipIds.has(m.slice(1).toLowerCase()));
  return Object.fromEntries(UNITS.map((u) => [u, (src.match(RE[u]) || []).filter(keep(u)).length]));
}

/** The counts of every file in scope at one commit: { files: { path: counts }, total: counts }. */
export function countAt(rev) {
  const paths = git('ls-tree', '-r', '--name-only', rev).split('\n').filter((p) => p && isLiteralFile(p));
  const files = {}; const total = Object.fromEntries(UNITS.map((u) => [u, 0]));
  const texts = Object.fromEntries(paths.map((p) => [p, git('show', `${rev}:${p}`)]));
  const skip = hexIds(Object.values(texts));
  for (const p of paths) {
    const c = countText(texts[p], p, skip);
    files[p] = c; for (const u of UNITS) total[u] += c[u];
  }
  return { files, total };
}

/** The rule: { ok, rows, rises }. */
export function g4(baseCounts, headCounts) {
  const rows = UNITS.map((u) => ({ unit: u, base: baseCounts.total[u], head: headCounts.total[u], delta: headCounts.total[u] - baseCounts.total[u] }));
  const rises = [];
  for (const r of rows.filter((x) => x.delta > 0)) {
    const per = Object.keys({ ...baseCounts.files, ...headCounts.files })
      .map((p) => ({ p, d: (headCounts.files[p]?.[r.unit] || 0) - (baseCounts.files[p]?.[r.unit] || 0) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
    rises.push({ unit: r.unit, files: per.slice(0, 10) });
  }
  return { ok: rows.every((r) => r.delta <= 0), rows, rises };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { base, head } = range();
  const r = g4(countAt(base), countAt(head));
  let tokens;   // the token files (design.md 4.1): [] when every generated file is current
  try { tokens = stale().map((x) => `\`${x.path}\`: ${x.reason}`); } catch (e) { tokens = [e.message]; }
  const ok = r.ok && !tokens.length;
  let md = `### G4 Literal counter: ${ok ? 'PASS' : 'FAIL'}\n\nBase \`${base.slice(0, 7)}\` (merge base with main), head \`${git('rev-parse', '--short', head).trim()}\`. Scope: ci/gates/scope.json.\n\n| Unit | Base | Head | Change |\n|---|---|---|---|\n`;
  md += r.rows.map((x) => `| ${x.unit} | ${x.base} | ${x.head} | ${x.delta > 0 ? `**+${x.delta}**` : x.delta} |`).join('\n') + '\n';
  for (const x of r.rises) md += `\nFAIL: \`${x.unit}\` rose. Files with more:\n${x.files.map((f) => `- \`${f.p}\` +${f.d}`).join('\n')}\nUse a token (design.md section 4) instead of a new literal.\n`;
  md += tokens.length
    ? `\nFAIL: the token files. Change shared/tokens.json, run \`node shared/build-tokens.mjs\`, and commit the result:\n${tokens.map((t) => `- ${t}`).join('\n')}\n`
    : '\nToken files: PASS (`node shared/build-tokens.mjs --check`: every generated file is current).\n';
  summary(md);
  process.exit(ok ? 0 : 1);
}
