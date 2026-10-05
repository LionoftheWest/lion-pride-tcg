// Gate G3, the verdict (docs/design.md 12.5, 12.6): read the results of every run (all browsers and sizes),
// turn them into the 12 check items, give each defect to its register ID, and fail on any defect of an
// enforced ID. Writes defects.json and the job summary.
//   node evaluate.mjs --results DIR [--strict] [--browsers chromium,webkit]      env: PR_TITLE
// Enforced IDs: the IDs in the PR title (the screens that the PR changes) and every register row whose
// Standard is "Migrated" or "In migration". --strict enforces every ID. The other IDs are reported, not
// enforced: a screen stays "Not migrated" until its own PR (design.md 12.9).
// A base cell with no result fails always. A runner error, a step with no control, or a call with no fixture
// on an enforced ID fails (the screen was not checked).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SIZES, SCREENS, EXPANDED, sizeKey, ownerOf } from './screens.mjs';
import { parseRegister, titleIds, summary } from '../gates/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const RULES = {   // 12.6 item -> [name, design.md section]
  scroll: ['Page scroll', '3.3'], bleed: ['Bleed, clipped text, cut buttons', '3.3'], ellipsis: ['"…" on a name', '10.4'],
  'small-text': ['Text below 11 px', '4.7'], tap: ['Touch target below 44 px on touch', '9.1'], covered: ['Covered by another layer', '4.10'],
  'corner-safe': ['Discord corner zone or outside the safe frame', '2.3'], missing: ['Missing vs expanded', '1 (P1)'],
  overlap: ['Overlapping sections', '3.3'], empty: ['Empty space above 25%', '3.4'], 'icon-name': ['Icon-only control without a name', '5.3'],
  contrast: ['Contrast below the threshold', '9.4'], keyboard: ['Keyboard covers the focused text box', '2.3'],
  'not-checked': ['Not checked (runner error, missing step, missing fixture or missing result)', '12.6'],
};
const BLEED_FIT = new Set(['clipX', 'cutBtn', 'cutText', 'spill', 'squashed', 'pokeOut', 'offscreen']);
const BLEED_CUT = new Set(['clipped', 'midword', 'offscreen', 'placeholder']);

/** The defects of one cell: [{ rule, where, value }]. `expanded` = the base result at 1990x830 (same browser, screen). */
export function defectsOf(r, expanded) {
  const d = []; const add = (rule, where, value = '') => d.push({ rule, where: String(where), value: String(value) });
  if (r.error) { add('not-checked', 'runner', r.error); return d; }
  if (!r.checks || !r.fit || !r.cut || !r.extra) { add('not-checked', 'runner', 'a check returned no data'); return d; }
  for (const m of r.miss || []) if (!/fallback used/.test(m)) add('not-checked', `step ${m}`, 'the step found no control');
  for (const k of r.noFixture || []) add('not-checked', `no fixture ${k}`, 'record the fixtures again (record.mjs)');
  const c = r.checks || {};
  if ((c.pageScroll?.x || 0) > 0 || (c.pageScroll?.y || 0) > 0) add('scroll', 'page', `${c.pageScroll.x}x${c.pageScroll.y}`);
  for (const [kind, where, v] of r.fit || []) {
    if (BLEED_FIT.has(kind)) add('bleed', `${kind}: ${where}`, v);
    else if (kind === 'overlap') add('overlap', where, v);
  }
  for (const [kind, where, text] of r.cut || []) {
    if (kind === 'ellipsis') add('ellipsis', where, text);
    else if (BLEED_CUT.has(kind)) add('bleed', `${kind}: ${where}`, text);
  }
  for (const [px, list] of Object.entries(c.tinyText || {})) for (const w of list) add('small-text', w, `${px}px`);
  if (r.touch) for (const [w, s] of [...(c.tapSmall || []), ...(c.tapTiny || [])]) add('tap', w, s);
  for (const [w, under] of c.coveredBtns || []) add('covered', w, under);
  for (const [k, w] of c.covered || []) add('covered', `window ${k}`, w);
  for (const [w, box] of c.corner || []) add('corner-safe', `corner zone: ${w}`, box);
  if ((c.windowOutside || 0) > 0) add('corner-safe', `window outside the frame: ${c.window?.sel || ''}`, c.windowOutside);
  if (expanded?.checks?.keys && r.size !== EXPANDED && r.class !== 'tiny') {
    for (const [k, v] of Object.entries(expanded.checks.keys)) {
      if (!v.inView) continue;
      const mine = c.keys?.[k];
      if (!mine) add('missing', k, 'absent'); else if (!mine.inView) add('missing', k, 'outside the view');
    }
  }
  if ((c.emptyBandY || 0) > 0.25 || (c.emptyBandX || 0) > 0.25) add('empty', c.window?.sel || '#main', `band ${Math.round(Math.max(c.emptyBandY || 0, c.emptyBandX || 0) * 100)}%`);
  for (const [w, why] of r.extra?.iconNoName || []) add('icon-name', w, why);
  for (const [w, ratio, need] of r.extra?.contrast || []) add('contrast', w, `${ratio} < ${need}`);
  if (r.keyboard?.focused && r.keyboard.inputInView === false) add('keyboard', 'focused text box', `keyboard ${r.keyboard.height}px`);
  return d;
}

/** The verdict: { enforced, isEnforced, defects, fails }. */
export function verdict(results, register, { title = '', strict = false, browsers = ['chromium', 'webkit'], sizes = SIZES.map(sizeKey) } = {}) {
  const enforced = new Set([...titleIds(title), ...Object.values(register).filter((r) => /^(migrated|in migration)/i.test(r.standard)).map((r) => r.id)]);
  const isEnforced = (id) => strict || enforced.has(id);
  const key = (r) => [r.browser, r.size, r.screen, r.variant].join('|');
  const byKey = new Map(results.map((r) => [key(r), r]));
  const all = [];
  for (const r of results) {
    const exp = byKey.get([r.browser, EXPANDED, r.screen, 'base'].join('|'));
    for (const x of defectsOf(r, exp)) all.push({ ...x, browser: r.browser, size: r.size, class: r.class, screen: r.screen, variant: r.variant, owner: x.rule === 'not-checked' ? SCREENS[r.screen].id : ownerOf(r.screen, x.where) });
  }
  // Every base cell must have a result.
  for (const b of browsers) for (const s of SIZES.filter((x) => sizes.includes(sizeKey(x)))) for (const screen of Object.keys(SCREENS)) {
    if (!byKey.has([b, sizeKey(s), screen, 'base'].join('|'))) all.push({ rule: 'not-checked', where: 'no result', value: 'the run did not produce this cell', browser: b, size: sizeKey(s), class: s[2], screen, variant: 'base', owner: SCREENS[screen].id });
  }
  // One defect per (rule, owner, where) for each browser, size and screen; keep the first variant.
  const seen = new Set();
  const defects = all.filter((x) => { const k = [x.rule, x.owner, x.where, x.browser, x.size, x.screen].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
  const fails = defects.filter((x) => isEnforced(x.owner) || x.where === 'no result');
  return { enforced, isEnforced, defects, fails };
}

function load(dir) {
  const out = [];
  const walk = (p) => { for (const f of readdirSync(p)) { const q = join(p, f); if (statSync(q).isDirectory()) walk(q); else if (f.endsWith('.json') && f !== 'defects.json') out.push(JSON.parse(readFileSync(q, 'utf8'))); } };
  walk(dir); return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const DIR = arg('results', join(here, '.out', 'results'));
  const STRICT = process.argv.includes('--strict');
  const BROWSERS = (arg('browsers') || 'chromium,webkit').split(',');
  const SIZE_LIST = arg('sizes') ? arg('sizes').split(',') : SIZES.map(sizeKey);   // a local run of some sizes
  const results = load(DIR);
  const register = parseRegister(readFileSync(join(here, '..', '..', 'docs', 'ui-register.md'), 'utf8'));
  const { enforced, isEnforced, defects, fails } = verdict(results, register, { title: process.env.PR_TITLE || '', strict: STRICT, browsers: BROWSERS, sizes: SIZE_LIST });
  writeFileSync(join(DIR, 'defects.json'), JSON.stringify({ enforced: STRICT ? 'all' : [...enforced], cells: results.length, defects }, null, 1));

  const ids = [...new Set(defects.map((x) => x.owner))].sort();
  const cols = Object.keys(RULES);
  let md = `### G3 UI check: ${fails.length ? 'FAIL' : 'PASS'}\n\n`;
  md += `${results.length} cells (${BROWSERS.join(' + ')}, ${SIZES.length} sizes, ${Object.keys(SCREENS).length} screens and windows, variants base, long, safe, keyboard). `;
  md += `Enforced IDs: ${STRICT ? '**all** (--strict)' : enforced.size ? [...enforced].sort().join(', ') : 'none (no ID in the PR title, and no register row is Migrated or In migration)'}.\n\n`;
  md += `Defects by register ID and check item (design.md 12.6). "report" = listed, not enforced.\n\n`;
  md += `| ID | Screen | ${cols.join(' | ')} | Verdict |\n|---|---|${cols.map(() => '---').join('|')}|---|\n`;
  for (const id of ids) {
    const mine = defects.filter((x) => x.owner === id);
    md += `| ${id} | ${(register[id]?.screen || '').slice(0, 34)} | ${cols.map((k) => mine.filter((x) => x.rule === k).length || '').join(' | ')} | ${isEnforced(id) ? (mine.length ? '**FAIL**' : 'PASS') : 'report'} |\n`;
  }
  if (fails.length) {
    md += `\n#### Enforced defects (first 60 of ${fails.length})\n\n| Rule | ID | Browser | Size | Screen | Variant | Where | Value |\n|---|---|---|---|---|---|---|---|\n`;
    md += fails.slice(0, 60).map((x) => `| ${RULES[x.rule][0]} (${RULES[x.rule][1]}) | ${x.owner} | ${x.browser} | ${x.size} | ${x.screen} | ${x.variant} | \`${x.where.replace(/\|/g, '/').slice(0, 90)}\` | ${x.value.replace(/\|/g, '/').slice(0, 40)} |`).join('\n') + '\n';
  }
  md += `\nThe full list is in the artifact \`g3-results\` (defects.json). Each run job keeps its screenshots in its own artifact.\n`;
  summary(md);
  process.exit(fails.length ? 1 : 0);
}
