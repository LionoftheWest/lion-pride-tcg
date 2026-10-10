// Tests for the G3 verdict: node --test ci/ui-check/evaluate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defectsOf, verdict, reportOnly } from './evaluate.mjs';
import { SIZES, SCREENS, REPORT_ONLY_SIZES, sizeKey, ownerOf } from './screens.mjs';
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
test('a window box in the corner zone is a corner-safe defect only on a screen that opts in (UI-36)', () => {
  const r = clean('dailies', '932x430'); r.checks.windowCorner = [50, 54]; r.checks.window = { sel: '#v2Dailies.u3-dl' };
  assert.deepEqual(defectsOf(r, null).map((x) => x.rule), ['corner-safe']);
  const h = clean('home', '932x430'); h.checks.windowCorner = [50, 54];
  assert.equal(defectsOf(h, null).length, 0, 'the other windows are not enforced yet');
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
  assert.equal(ownerOf('convert', '#u3ShopDlg > .u3-scrim > .u3-dialog.u3-sdlg.u3-sdlg--convert > .u3-sdlg__main > .u3-scvt'), 'UI-44');
  assert.equal(ownerOf('convert', '#main > .v2-collection > .p-actions'), 'UI-08');
  assert.equal(ownerOf('dungeon', '#topbar > #shopBtn'), 'UI-42');
  assert.equal(ownerOf('dungeon', '#topbarheader > .topright > #v2Shards'), 'UI-42');
  assert.equal(ownerOf('dungeon', '#topbarheader > .topright > #v2Avatar.v2-avatar'), 'UI-01');
  assert.equal(ownerOf('dungeon', '#topbarheader > .topright > #menuBtn.u3-ibtn'), 'UI-01');
  assert.equal(ownerOf('dungeon', '#dock > .dk.active'), 'UI-01');
  assert.equal(ownerOf('dungeon', '#docknav > .dk > span'), 'UI-01');
  assert.equal(ownerOf('help', '#v2Help.u3-hp > .u3-hp__list > .u3-hp__item'), 'UI-38');
  assert.equal(ownerOf('help', '.u3-hp__q > .u3-hp__qt'), 'UI-38');
  assert.equal(ownerOf('report', '#v2Report.u3-rp > .u3-rp__area > textarea.u3-textarea'), 'UI-40');
  assert.equal(ownerOf('report-error', '.u3-rp__foot > .u3-msg'), 'UI-40');
  assert.equal(ownerOf('menu', '.u3-menu__grid > button.u3-mtile'), 'UI-60');
  assert.equal(ownerOf('trades-few', '.u3-trades__cols > #u3Pd.u3-pd > #u3PdSide.u3-pd__body'), 'UI-25');   // Pending
  assert.equal(ownerOf('trades-offer', '.u3-pd-view > .u3-pd-view__foot > .u3-btn'), 'UI-25');   // the Offer view
  assert.equal(ownerOf('trades-few', '.u3-mp > .u3-mp__body > .u3-mp-sec'), 'UI-65');   // the picker stays UI-65
  assert.equal(ownerOf('wishlist', '#u3Wish > .u3-wl-scrim > .u3-wl > .u3-wl-row'), 'UI-16');
  assert.equal(ownerOf('wishlist-drawer', '#u3Wish > .u3-wl-scrim > .u3-wl > .u3-wl__list > .u3-wl-row'), 'UI-16');
  assert.equal(ownerOf('profile-own-wish', '#memWish > #wlHandle.u3-pf-wishbar'), 'UI-16');   // the handle strip is the Wishlist's (D-128)
  assert.equal(ownerOf('profile-own-wish', '#memWish.u3-pf-tile'), 'UI-14');                  // the tile that holds it is the Profile's
  assert.equal(ownerOf('wish-picker', '#u3Picker > .u3-pk.is-one'), 'UI-64');
  assert.equal(ownerOf('hunt-picker-detail', '#viewer.raid-info > #viewer-closebutton'), 'UI-64');
  assert.equal(ownerOf('hunt-picker-detail', '.vr-stats > .vr-stat > span "Power"'), 'UI-64');
  assert.equal(ownerOf('hunt-picker-detail', '.u3-hs-hp > span'), 'UI-17');
  assert.equal(ownerOf('dungeon-picker-detail', '#v-raid.v-raid > .vr-head'), 'UI-64');
  assert.equal(ownerOf('collection-detail', '#viewer > #viewer-prev'), 'UI-08');
  assert.equal(ownerOf('collection-detail', '#viewer > #viewer-close'), 'UI-08');
  assert.equal(ownerOf('collection-detail', '#viewer > .viewer-stage'), 'UI-08');
  assert.equal(ownerOf('trades-pick', '#u3TradeWin > .u3-tw > ul.u3-tw__grid'), 'UI-63');   // the Trade window
  assert.equal(ownerOf('trades-pick', '.u3-tw__grid > li.u3-pk-card > button.u3-pk-card__pick'), 'UI-63');   // its tiles are Card picker classes
  assert.equal(ownerOf('hunt-picker', '#u3Picker > .u3-pk-scrim > .u3-pk'), 'UI-64');   // the Card picker stays UI-64
  assert.equal(ownerOf('pack-multi', '.u3-mpacks > .u3-mrow > .u3-mpack'), 'UI-35');
  assert.equal(ownerOf('pack-multi-cards', '.mr-main > #mrGrid.mr-grid > .mr-card'), 'UI-35');
  assert.equal(ownerOf('pack-multi', '#topbar > #shopBtn'), 'UI-42');
  assert.equal(ownerOf('dungeon', '#main.has-adv > .dg-tabs.v2-subtabs > .dg-tab'), 'UI-02');   // the shell sub-tab row
  assert.equal(ownerOf('dungeon', '.u3-dg-tabs > .u3-seg > .u3-seg__item'), 'UI-46');               // the lobby's own tabs (Rule / Best / Top 3)
  assert.equal(ownerOf('menu', '#main > .home-hero'), 'UI-03');   // under the menu: Home
  // the style editor (UI-15) opens over the profile: the profile under it is UI-14, the window is UI-15, the picker UI-64
  assert.equal(ownerOf('style-editor', '.mem-col.mem-left > .mem-grid-stats > div > span'), 'UI-14');
  assert.equal(ownerOf('style-editor', '.u3-pf-tile.u3-pf-id > #memBack.u3-btn'), 'UI-14');
  assert.equal(ownerOf('style-editor', '.u3-se > .u3-se__foot > .u3-btn'), 'UI-15');
  assert.equal(ownerOf('style-picker', '#u3Picker > .u3-pk'), 'UI-64');
  assert.equal(ownerOf('style-picker', '.u3-se-slots > li'), 'UI-15');
  assert.equal(ownerOf('profile', '.mem-col.mem-left > span'), 'UI-14');
  assert.equal(ownerOf('dungeon', 'cutBtn: #main > .dg-tabs.v2-subtabs'), 'UI-02');
  assert.equal(ownerOf('dungeon', '#main > .dg-lobby'), 'UI-46');
  assert.equal(ownerOf('dungeon-path', '#main > .u3-dgs > .u3-dgc-panel'), 'UI-49');   // the room steps (UI-49)
  assert.equal(ownerOf('dungeon-floor', '#main > .u3-dgs-fd > .u3-dgs-fdp'), 'UI-49');
  assert.equal(ownerOf('dungeon-rest', '#main > .u3-dgc > .u3-dgc-hud'), 'UI-49');   // the stage parts shared with UI-48 belong to the screen under test
  assert.equal(ownerOf('dungeon-choose', '#main > .u3-dgc > .u3-dgc-hud'), 'UI-48');
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
  const rs2 = full(); rs2.find((r) => r.screen === 'collection' && r.size === '430x932').error = 'Timeout';
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
  assert.deepEqual(plan(new Set(['UI-50'])), { screens: [], uncovered: ['UI-50'] });
  assert.deepEqual(plan(new Set(['UI-49'])).screens.filter((x) => x.startsWith('dungeon-')).sort(), ['dungeon-chest', 'dungeon-chest-flipped', 'dungeon-chest-open', 'dungeon-floor', 'dungeon-floor-revealed', 'dungeon-path', 'dungeon-rest', 'dungeon-retreat']);   // the 8 UI-49 specs
  assert.deepEqual(plan(new Set()).screens, []);
  assert.equal(plan(new Set(), { full: true }).screens.length, Object.keys(SCREENS).length);
});
test('plan with the title IDs (pick): a PR runs only its own screens and the screens under them, not every Migrated row', () => {
  const enforced = new Set(['UI-07', 'UI-46', 'UI-17']);   // the title UI-46 plus Migrated rows
  assert.deepEqual(plan(enforced, { pick: new Set(['UI-46']) }).screens, ['dungeon', 'dungeon-picker', 'dungeon-picker-detail']);   // the pickers sit under UI-46
  const ui17 = plan(enforced, { pick: new Set(['UI-17']) }).screens;
  assert.ok(ui17.includes('hunt-picker') && ui17.includes('boss-window'), 'the screens UNDER the title ID run too');
  assert.ok(!ui17.includes('collection'), 'a Migrated row that is not in the title does not run');
  assert.equal(plan(enforced, { pick: new Set(['UI-01']) }).screens.length, Object.keys(SCREENS).length, 'the shell still runs every screen');
  assert.deepEqual(plan(enforced, { pick: new Set() }).screens, [], 'no title ID: nothing to run');
  assert.equal(plan(enforced, { full: true, pick: new Set(['UI-46']) }).screens.length, Object.keys(SCREENS).length, '--full (the nightly report) runs every screen');
  assert.deepEqual(plan(new Set(['UI-50']), { pick: new Set(['UI-50']) }).uncovered, ['UI-50']);
});
test('verdict with a plan: only the planned screens must have results; an uncovered enforced ID fails', () => {
  const only = full().filter((r) => r.screen === 'dungeon');
  assert.equal(verdict(only, REG, { title: 'UI-46 lobby', browsers: ['chromium'], screens: ['dungeon', 'collection'] }).fails.length, SIZES.length, 'collection was planned and has no result');
  const reg = { ...REG, 'UI-07': { ...REG['UI-07'], standard: 'Not migrated' } };
  assert.equal(verdict(only, reg, { title: 'UI-46 lobby', browsers: ['chromium'], screens: ['dungeon'] }).fails.length, 0);
  const v = verdict(only, reg, { title: 'UI-46 + UI-50', browsers: ['chromium'], screens: ['dungeon'] });
  assert.deepEqual(v.fails.map((x) => [x.owner, x.where]), [['UI-50', 'no screen in the check']]);
});

test('the keyboard variant does not check the empty band; the same band in base is a defect (2.3, G-015)', () => {
  const kb = { ...clean('trades-picker', '375x667'), variant: 'keyboard' }; kb.checks.emptyBandY = 1;
  assert.equal(defectsOf(kb, null).filter((x) => x.rule === 'empty').length, 0);
  const base = clean('trades-picker', '375x667'); base.checks.emptyBandY = 1;
  assert.equal(defectsOf(base, null).filter((x) => x.rule === 'empty').length, 1);
});

test('trades-pick measures the old v2 trade builder: its owner is UI-63 (the Trade window), not UI-25', () => {
  assert.equal(SCREENS['trades-pick'].id, 'UI-63');
  assert.equal(ownerOf('trades-pick', '.tr-main > #trMembers.tr-members > .tr-mem'), 'UI-63');
  assert.equal(ownerOf('trades', '.u3-pd-row'), 'UI-25');
});

test('an accepted exception (decision ID, one ID/screen/size/rule) does not fail; anything else still fails', () => {
  const rs = full();
  const cell = rs.find((r) => r.screen === 'home' && r.size === '430x932');
  cell.checks.emptyBandY = 0.29;
  const other = rs.find((r) => r.screen === 'home' && r.size === '412x915');
  other.checks.emptyBandY = 0.29;
  const ex = [{ decision: 'D-999', id: 'UI-03', screen: 'home', size: '430x932', rule: 'empty', why: 'test' }];
  const v = verdict(rs, REG, { title: 'UI-03 Home', browsers: ['chromium'], exceptions: ex });
  assert.equal(v.defects.filter((x) => x.accepted === 'D-999').length, 1);
  assert.deepEqual(v.fails.map((x) => [x.rule, x.size]), [['empty', '412x915']]);   // the other size still fails
  const none = verdict(rs, REG, { title: 'UI-03 Home', browsers: ['chromium'] });
  assert.equal(none.fails.length, 2);
});

test('exceptions.json: every entry is valid; the UI-49 empty-space entries name D-134 and a screen of the check', async () => {
  const { readFileSync } = await import('node:fs');
  const list = JSON.parse(readFileSync(new URL('./exceptions.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => verdict(full(), REG, { browsers: ['chromium'], exceptions: list }));
  const mine = list.filter((e) => e.id === 'UI-49');
  assert.ok(mine.length > 0 && mine.every((e) => e.decision === 'D-134' && e.rule === 'empty' && /^dungeon-/.test(e.screen)));
});

test('D-136: a defect at a report-only landscape size is listed but does not fail; the same defect at a portrait size fails', () => {
  assert.deepEqual(REPORT_ONLY_SIZES, ['667x375', '932x430', '915x412', '1180x820', '917x692', '375x667', '1280x480']);
  const rs = full();
  for (const size of ['667x375', '430x932']) rs.find((r) => r.screen === 'home' && r.size === size).checks.emptyBandY = 0.4;
  const v = verdict(rs, REG, { title: 'UI-03 Home', browsers: ['chromium'] });
  assert.equal(v.defects.filter((x) => x.rule === 'empty').length, 2, 'both are listed');
  assert.deepEqual(v.fails.map((x) => [x.rule, x.size]), [['empty', '430x932']]);
  for (const size of ['1280x720', '1990x830', '430x932', '430x822', '412x915', '820x1180', '692x917', '400x225']) assert.ok(!REPORT_ONLY_SIZES.includes(size), size + ' stays enforced');
  assert.equal(reportOnly({ size: '667x375', where: 'no result' }), false, 'a missing cell still fails');
  const miss = full().filter((r) => !(r.screen === 'home' && r.size === '667x375'));
  assert.ok(verdict(miss, REG, { title: 'UI-03 Home', browsers: ['chromium'] }).fails.some((x) => x.size === '667x375' && x.where === 'no result'));
});

test('a bad exception entry stops the gate', () => {
  for (const bad of [{ id: 'UI-03', screen: 'home', size: '430x932', rule: 'empty', why: 'x' },           // no decision
    { decision: 'D-1', id: 'UI-03', screen: 'nope', size: '430x932', rule: 'empty', why: 'x' },
    { decision: 'D-1', id: 'UI-03', screen: 'home', size: '1x1', rule: 'empty', why: 'x' },
    { decision: 'D-1', id: 'UI-03', screen: 'home', size: '430x932', rule: 'not-checked', why: 'x' },
    { decision: 'D-1', id: 'UI-03', screen: 'home', size: '430x932', rule: 'empty' }]) {                  // no why
    assert.throws(() => verdict(full(), REG, { browsers: ['chromium'], exceptions: [bad] }));
  }
});
