// Gate G1 Register (docs/design.md 12.5): a UI PR names its register ID in the title, and the register row of
// that ID has a recorded design approval. A PR that changes no file in the UI scope (scope.json) passes.
//   node ci/gates/g1-register.mjs        env: PR_TITLE, BASE_SHA, HEAD_SHA (defaults: origin/main, HEAD)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isUiFile, git, range, parseRegister, isDesignApproved, titleIds, summary } from './lib.mjs';

/** The rule, without git: { ok, ui, lines }. */
export function g1({ title, changed, register }) {
  const ui = changed.filter(isUiFile);
  if (!ui.length) return { ok: true, ui, lines: ['Not a UI PR: no changed file is in the UI scope (ci/gates/scope.json).'] };
  const ids = titleIds(title);
  const lines = [`UI PR: ${ui.length} changed file${ui.length === 1 ? '' : 's'} in the UI scope (first: \`${ui[0]}\`).`];
  if (!ids.length) return { ok: false, ui, lines: [...lines, 'FAIL: the PR title has no register ID. Put the ID in the title, for example "UI-07 Collection grid" (design.md 12.3 step 5).'] };
  let ok = true;
  for (const id of ids) {
    const row = register[id];
    if (!row) { ok = false; lines.push(`FAIL ${id}: no row in docs/ui-register.md. Reserve the ID first (design.md 12.2).`); continue; }
    if (/^retired/i.test(row.standard)) { ok = false; lines.push(`FAIL ${id} (${row.screen}): the row is Retired.`); continue; }
    if (!isDesignApproved(row.approved)) { ok = false; lines.push(`FAIL ${id} (${row.screen}): no recorded design approval. Approved column: "${row.approved}". It must start "YYYY-MM-DD, design" (design.md 12.4).`); continue; }
    lines.push(`PASS ${id} (${row.screen}): ${row.approved}`);
  }
  return { ok, ui, lines };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { base, head } = range();
  const changed = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
  const register = parseRegister(readFileSync('docs/ui-register.md', 'utf8'));
  const r = g1({ title: process.env.PR_TITLE || '', changed, register });
  summary(`### G1 Register: ${r.ok ? 'PASS' : 'FAIL'}\n\nTitle: \`${process.env.PR_TITLE || ''}\`\n\n${r.lines.map((l) => `- ${l}`).join('\n')}\n`);
  process.exit(r.ok ? 0 : 1);
}
