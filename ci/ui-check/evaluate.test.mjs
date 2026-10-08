// Tests for the G3 verdict: node --test ci/ui-check/evaluate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defectsOf, verdict } from './evaluate.mjs';
import { SIZES, SCREENS, sizeKey, ownerOf } from './screens.mjs';
import { parseRegister } from '../gates/lib.mjs';

const REG = parseRegister(`| UI-01 | Shell | x | No | #10 | Not migrated | |
| UI-03 | Home | x | No | #51 | Not migrated | |
| UI-07 | Collection | x | 2026-10-05, design, x | #10 | Migrated | |
| UI-46 | Dungeon lobby | x | No | #147 | Not migrated | |`);
const clean = (screen, size = '430x932', browser = 'chromium', variant = 'base') => {
  const s = SIZES.find((x) => sizeKey(x) === size);
  return { browser, size, class: s[2], touch: s[3], screen, id: SCREENS[screen].id, variant, miss: [], fit: [], cut: [],
    checks: { pageScroll: { x: 0, y: 0 }, tinyText: {}, tapSmall: [], tapTiny: [], coveredBtns: [], covered: [], corner: [], windowOutside: 0, keys: {}, emptyBandX: 0, emptyBandY: 0 },
    extra: { iconNoName: [], contrast: [] } };
};
// A complete run: every base cell, clean.
const full = (browsers = ['chromium']) => browsers.flatMap((b) => SIZES.flatMap((s) => Object.keys(SCREENS).map((sc) => clean(sc, sizeKey(s), b))));

test('each 12.6 item comes from its detector', () => {
  const r = clean('home');
  r.checks.pageScroll = { x: 0, y: 40 };
  r.fit = [['cutBtn', '#main > .x', 12], ['overlap', '#main .a ~ .b', 8], ['gap', 'x', 1]];
  r.cut = [['ellipsis', '.name', 'Maximilian'], ['clipped', '.a > .b', 'Text']];
  r.checks.tinyText = { '10.5': ['.lbl "x"'] };
  r.checks.tapSmall = [['.chip "a"', '30x30']];
  r.checks.coveredBtns = [['#shopBtn "Shop"', 'under .eff-banner']];
  r.checks.corner = [['#bellBtn', '1,2,3,4']];
  r.checks.emptyBandY = 0.4;
  r.extra = { iconNoName: [['.x', 'no name']], contrast: [['.y "z"', 2.1, 4.5]] };
  const rules = defectsOf(r, null).map((x) => x.rule).sort();
  assert.deepEqual(rules, ['bleed', 'bleed', 'contrast', 'corner-safe', 'covered', 'ellipsis', 'empty', 'icon-name', 'overlap', 'scroll', 'small-text', 'tap'].sort());
});
test('missing vs 1990x830: a control in view at expanded and absent or outside here', () => {
  const exp = clean('home', '1990x830'); exp.checks.keys = { '#boardBtn': { inView: true }, '#mute': { inView: false } };
  const r = clean('home', '430x932'); r.checks.keys = {};
  assert.deepEqual(defectsOf(r, exp).map((x) => [x.rule, x.where]), [['missing', '#boardBtn']]);
  const tiny = clean('home', '400x225'); assert.equal(defectsOf(tiny, exp).length, 0, 'the tiny class is the P1 exception');
  const kb = { ...clean('home', '430x932'), variant: 'keyboard' }; kb.checks.keys = {};
  assert.equal(defectsOf(kb, exp).length, 0, 'the keyboard cell: P1 is checked on the base cell (G-015)');
});
test('a cell with no check data is not checked (the silent-undefined defect)', () => {
  const r = clean('home'); delete r.checks;
  assert.deepEqual(defectsOf(r, null).map((x) => x.rule), ['not-checked']);
});
test('touch targets count on touch sizes only', () => {
  const r = clean('home', '1280x720'); r.checks.tapSmall = [['.x', '30x30']];
  assert.equal(defectsOf(r, null).length, 0);
});
test('owners: the shell and the sub-tabs have their own IDs', () => {
  assert.equal(ownerOf('dungeon', '#topbar > #shopBtn'), 'UI-42');
  assert.equal(ownerOf('dungeon', '#topbarheader > .topright > #v2Shards'), 'UI-42');
  assert.equal(ownerOf('dungeon', '#topbarheader > .topright > #v2Avatar.v2-avatar'), 'UI-01');
  assert.equal(ownerOf('dungeon', '#topbarheader > .topright > #menuBtn.u3-ibtn'), 'UI-01');
  assert.equal(ownerOf('dungeon', '#dock > .dk.active'), 'UI-01');
  assert.equal(ownerOf('dungeon', '#docknav > .dk > span'), 'UI-01');
  assert.equal(ownerOf('menu', '.u3-menu__grid > button.u3-mtile'), 'UI-60');
  assert.equal(ownerOf('menu', '#main > .home-hero'), 'UI-03');   // under the menu: Home
  assert.equal(ownerOf('dungeon', 'cutBtn: #main > .dg-tabs.v2-subtabs'), 'UI-02');
  assert.equal(ownerOf('dungeon', '#main > .dg-lobby'), 'UI-46');
});
test('a clean complete run passes', () => {
  assert.equal(verdict(full(), REG, { browsers: ['chromium'] }).fails.length, 0);
});
test('a defect fails only on an enforced ID (title or Migrated)', () => {
  const rs = full(); const home = rs.find((r) => r.screen === 'home' && r.size === '430x932'); home.checks.pageScroll = { x: 0, y: 30 };
  const coll = rs.find((r) => r.screen === 'collection' && r.size === '430x932'); coll.extra.contrast = [['.c', 2, 4.5]];
  const v1 = verdict(rs, REG, { browsers: ['chromium'] });
  assert.deepEqual(v1.fails.map((x) => x.owner), ['UI-07'], 'UI-07 is Migrated, UI-03 is reported');
  assert.equal(v1.defects.length, 2);
  const v2 = verdict(rs, REG, { title: 'UI-03 Home hero', browsers: ['chromium'] });
  assert.deepEqual(v2.fails.map((x) => x.owner).sort(), ['UI-03', 'UI-07']);
  assert.equal(verdict(rs, REG, { strict: true, browsers: ['chromium'] }).fails.length, 2);
});
test('a missing cell always fails; a runner error fails on an enforced ID', () => {
  const rs = full().filter((r) => !(r.screen === 'dungeon' && r.size === '375x667'));
  assert.equal(verdict(rs, REG, { browsers: ['chromium'] }).fails[0].where, 'no result');
  const rs2 = full(); rs2.find((r) => r.screen === 'collection' && r.size === '375x667').error = 'Timeout';
  assert.equal(verdict(rs2, REG, { browsers: ['chromium'] }).fails[0].rule, 'not-checked');
  const cells = SIZES.reduce((n, s) => n + Object.values(SCREENS).filter((sc) => !sc.notOn?.includes(s[2])).length, 0);   // the menu has no tiny cell
  assert.equal(verdict(full(), REG, { browsers: ['chromium', 'webkit'] }).fails.length, cells, 'no WebKit results: every WebKit cell fails');
});

// ---- The plan (plan.mjs): a PR checks only the screens it can fail on --------------------------------------
import { plan, enforcedIds } from './plan.mjs';
test('plan: the title IDs and the Migrated rows; the shell checks every screen; an unknown screen is uncovered', () => {
  assert.deepEqual([...enforcedIds('UI-46 Dungeon lobby', REG)].sort(), ['UI-07', 'UI-46'], 'UI-07 is Migrated in REG');
  assert.deepEqual(plan(new Set(['UI-46'])).screens, ['dungeon']);
  assert.deepEqual(plan(new Set(['UI-12'])).screens, ['achievements', 'achievements-detail']);
  assert.equal(plan(new Set(['UI-01'])).screens.length, Object.keys(SCREENS).length);
  assert.equal(plan(new Set(['UI-02', 'UI-46'])).screens.length, Object.keys(SCREENS).length);
  assert.deepEqual(plan(new Set(['UI-00'])), { screens: Object.keys(SCREENS), uncovered: [] }, 'the design system is on every screen');
  assert.deepEqual(plan(new Set(['UI-49'])), { screens: [], uncovered: ['UI-49'] });
  assert.deepEqual(plan(new Set()).screens, []);
  assert.equal(plan(new Set(), { full: true }).screens.length, Object.keys(SCREENS).length);
});
test('verdict with a plan: only the planned screens must have results; an uncovered enforced ID fails', () => {
  const only = full().filter((r) => r.screen === 'dungeon');
  assert.equal(verdict(only, REG, { title: 'UI-46 lobby', browsers: ['chromium'], screens: ['dungeon', 'collection'] }).fails.length, SIZES.length, 'collection was planned and has no result');
  const reg = { ...REG, 'UI-07': { ...REG['UI-07'], standard: 'Not migrated' } };
  assert.equal(verdict(only, reg, { title: 'UI-46 lobby', browsers: ['chromium'], screens: ['dungeon'] }).fails.length, 0);
  const v = verdict(only, reg, { title: 'UI-46 + UI-49', browsers: ['chromium'], screens: ['dungeon'] });
  assert.deepEqual(v.fails.map((x) => [x.owner, x.where]), [['UI-49', 'no screen in the check']]);
});
