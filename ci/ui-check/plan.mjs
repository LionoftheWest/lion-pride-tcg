// The G3 plan: which screens a run checks. A PR checks the screens of the IDs in its TITLE (a screen whose own ID or
// "under" ID is in the title); evaluate.mjs enforces the title IDs and the Migrated / In migration rows on those screens.
// The nightly report (ui-report.yml) checks every screen (--full), so a change that breaks another screen shows there.
// Nathan 2026-10-09 ("make that g3 fast"): before, every In migration row was planned, so each PR ran ~2,000 cells (40-57 min).
// The shell (UI-01 top bar and dock, UI-02 sub-tabs) is on every screen, so an enforced shell ID checks every screen. UI-00 (the design system) also checks every screen.
//   node plan.mjs [--full]        env: PR_TITLE, BASE_SHA, HEAD_SHA        prints ui=, run=, screens= (for $GITHUB_OUTPUT)
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SCREENS } from './screens.mjs';
import { isUiFile, git, range, parseRegister, titleIds } from '../gates/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SHELL_IDS = new Set(['UI-01', 'UI-02', 'UI-42']);   // UI-42: the Shards and Shop pills sit in the top bar
// The IDs that are on every screen: the shell, and UI-00, the design system (the tokens and the components). A PR with
// one of these IDs checks every screen. UI-00 owns no screen of its own, so it is never "uncovered".
export const EVERY_SCREEN_IDS = new Set([...SHELL_IDS, 'UI-00']);

/** The enforced IDs: the IDs in the title and every Migrated / In migration row. */
export const enforcedIds = (title, register) =>
  new Set([...titleIds(title), ...Object.values(register).filter((r) => /^(migrated|in migration)/i.test(r.standard)).map((r) => r.id)]);

/** { screens, uncovered }: the screens to check, and the enforced IDs that no screen of the check covers.
 *  pick = the IDs whose screens run (the title IDs); without it, the enforced IDs. */
export function plan(enforced, { full = false, pick = null } = {}) {
  const all = Object.keys(SCREENS);
  const known = new Set(all.map((s) => SCREENS[s].id));
  // An enforced ID that no screen of the check opens (not the shell): G3 cannot check it, so it fails as not checked.
  const uncovered = [...enforced].filter((id) => !EVERY_SCREEN_IDS.has(id) && !known.has(id)).sort();
  const ids = pick || enforced;
  if (full || [...ids].some((id) => EVERY_SCREEN_IDS.has(id))) return { screens: all, uncovered };
  return { screens: all.filter((s) => ids.has(SCREENS[s].id) || (pick && ids.has(SCREENS[s].under))), uncovered };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const register = parseRegister(readFileSync(join(here, '..', '..', 'docs', 'ui-register.md'), 'utf8'));
  let full = process.argv.includes('--full');
  let ui = full;
  if (!full) {
    const { base, head } = range();
    const changed = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
    // A change to the check itself runs every screen when the title names no screen (a harness PR); a screen PR that
    // also adds its specs runs its own screens, and the nightly report runs the rest.
    const own = changed.some((p) => p.startsWith('ci/ui-check/') || /^\.github\/workflows\/ui-(gates|report)\.yml$/.test(p));
    ui = own || changed.some((p) => isUiFile(p) || p === 'docs/ui-register.md');
    if (own && !titleIds(process.env.PR_TITLE || '').length) full = true;
  }
  const enforced = enforcedIds(full ? '' : process.env.PR_TITLE || '', register);
  const p = plan(enforced, { full, pick: full ? null : new Set(titleIds(process.env.PR_TITLE || '')) });
  console.error(`G3 plan: ui=${ui} enforced=${[...enforced].join(',') || 'none'} screens=${p.screens.length} uncovered=${p.uncovered.join(',') || 'none'}`);
  console.log(`ui=${ui}`);
  console.log(`run=${ui && p.screens.length > 0}`);
  console.log(`screens=${p.screens.join(',')}`);
}
