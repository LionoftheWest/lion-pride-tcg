// Tests for gates G1 and G4: node --test ci/gates/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globRe, isUiFile, isLiteralFile, parseRegister, isDesignApproved, titleIds } from './lib.mjs';
import { g1 } from './g1-register.mjs';
import { countText, hexIds, g4 } from './g4-literals.mjs';

const REG = parseRegister(`| ID | Screen | Design file | Approved | Built | Standard | Notes |
|---|---|---|---|---|---|---|
| UI-00 | Design system | \`00.pen\` | 2026-10-05, design, chat | Not built | Not migrated | |
| UI-07 | Collection | \`08.png\` | 2026-09-27, design, old design.md | #10 | Not migrated | |
| UI-12 | Achievements | x | Yes, date not recorded, design, memory only | #13 | Not migrated | |
| UI-13 | Tracks | x | Date not recorded, spec only, #153 | #153 | Not migrated | |
| UI-30 | Trade Hall | x | No | #112 | Not migrated | |
| UI-54 | Music button | x | 2026-10-03, design, x | #159 | Retired | |`);

test('globs and the UI scope', () => {
  assert.ok(globRe('tcg-activity/src/**').test('tcg-activity/src/a/b.js'));
  assert.ok(globRe('**/*.test.js').test('tcg-activity/src/x.test.js'));
  assert.ok(!globRe('tcg-activity/src/*-routes.js').test('tcg-activity/src/sub/x-routes.js'));
  assert.ok(isUiFile('tcg-activity/public/ui-v2.css'));
  assert.ok(isUiFile('tcg-activity/src/ui-v2-dungeon.js'));
  assert.ok(isUiFile('tcg-bot/src/post-pictures.ts'));
  assert.ok(!isUiFile('tcg-activity/src/dungeon-routes.js'), 'server routes are not UI');
  assert.ok(!isUiFile('tcg-activity/server.js'));
  assert.ok(!isUiFile('tcg-bot/supabase/dungeon.sql'));
  assert.ok(!isUiFile('tcg-activity/src/squad-pick.test.js'));
  assert.ok(!isLiteralFile('tcg-activity/public/logo-lion.svg'), 'G4 reads code files only');
  assert.ok(!isLiteralFile('tcg-activity/public/tokens.css'), 'the generated token file is not counted');
});

test('register parse and approvals', () => {
  assert.equal(REG['UI-07'].screen, 'Collection');
  assert.ok(isDesignApproved(REG['UI-00'].approved));
  assert.ok(!isDesignApproved(REG['UI-12'].approved), 'a legacy "Yes, date not recorded" is not a recorded approval');
  assert.ok(!isDesignApproved(REG['UI-13'].approved), 'a spec approval is not a design approval');
  assert.ok(!isDesignApproved(REG['UI-30'].approved));
  assert.deepEqual(titleIds('feat(ui): UI-07, UI-08 and UI-07 again'), ['UI-07', 'UI-08']);
  assert.deepEqual(titleIds('fix: UI-7 is not an id'), []);
});

test('G1: a PR with no UI file passes, whatever its title', () => {
  const r = g1({ title: 'feat(hunt): an early boss', changed: ['tcg-bot/supabase/hunt.sql', 'tcg-activity/server.js', 'docs/design.md'], register: REG });
  assert.equal(r.ok, true); assert.equal(r.ui.length, 0);
});
test('G1: a UI PR with no register ID fails', () => {
  assert.equal(g1({ title: 'fix(ui): bigger cards', changed: ['tcg-activity/public/ui-v2.css'], register: REG }).ok, false);
});
test('G1: a UI PR with an approved ID passes', () => {
  assert.equal(g1({ title: 'UI-07 Collection grid', changed: ['tcg-activity/public/ui-v2.css'], register: REG }).ok, true);
});
test('G1: an ID that is not approved, unknown, retired, or legacy fails', () => {
  for (const t of ['UI-30 Hall', 'UI-99 New', 'UI-54 Music', 'UI-12 Achievements', 'UI-13 Tracks']) {
    assert.equal(g1({ title: t, changed: ['tcg-activity/src/ui-v2.js'], register: REG }).ok, false, t);
  }
});
test('G1: every ID in the title must pass', () => {
  assert.equal(g1({ title: 'UI-07 + UI-30', changed: ['tcg-activity/src/ui-v2.js'], register: REG }).ok, false);
  assert.equal(g1({ title: 'UI-00 + UI-07', changed: ['tcg-activity/src/ui-v2.js'], register: REG }).ok, true);
});

test('G4: each unit is counted', () => {
  const css = '.a{color:#F4B73C;background:rgba(0,0,0,.5);border:1px solid #fff;z-index:30;margin:-2.5px 0 .5px}\n/* #123456 12px z-index: 9 */\nbody.m-land .b, body.m-port .c{z-index:var(--z-sheet)}';
  assert.deepEqual(countText(css, 'x.css'), { color: 3, px: 3, z: 1, mland: 1, mport: 1 });
  const js = "el.style.zIndex = 50; o = { zIndex: 'var(--z-modal)' }; c = 0xF4B73C; s = `width:${w}px`; document.body.classList.add('m-land');";
  assert.deepEqual(countText(js, 'x.js'), { color: 1, px: 0, z: 1, mland: 1, mport: 0 }, 'a computed ${w}px is not a literal');
  assert.equal(countText("el.style.zIndex='12'; div{ z-index : 5 }", 'x.js').z, 2);
});
test('G4: not counted: a selector, a word that contains px or a hex-like id', () => {
  const js = "q('#feed'); q('#main .px-row'); const pxs = 3; const id = 'add'; x = 'px'; y = '#abcdefg';";
  assert.deepEqual(countText(js, 'x.js', hexIds(['<div id="feed"></div>'])), { color: 0, px: 0, z: 0, mland: 0, mport: 0 });
});
test('G4: a rise fails, an equal count or a drop passes, a move between files passes', () => {
  const c = (files) => { const total = { color: 0, px: 0, z: 0, mland: 0, mport: 0 }; for (const f of Object.values(files)) for (const k in total) total[k] += f[k] || 0; return { files: Object.fromEntries(Object.entries(files).map(([p, v]) => [p, { color: 0, px: 0, z: 0, mland: 0, mport: 0, ...v }])), total }; };
  const base = c({ 'a.css': { px: 10, color: 2 } });
  assert.equal(g4(base, c({ 'a.css': { px: 10, color: 2 } })).ok, true);
  assert.equal(g4(base, c({ 'a.css': { px: 9, color: 1 } })).ok, true);
  assert.equal(g4(base, c({ 'a.css': { px: 4, color: 2 }, 'b.css': { px: 6 } })).ok, true, 'a move between files');
  const r = g4(base, c({ 'a.css': { px: 10, color: 2, mland: 1 } }));
  assert.equal(r.ok, false); assert.equal(r.rises[0].unit, 'mland'); assert.equal(r.rises[0].files[0].p, 'a.css');
});
