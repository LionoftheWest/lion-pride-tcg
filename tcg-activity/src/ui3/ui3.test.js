// UI-00 v3 foundation: the size class rules (design.md 2.1), the icon set, and the component rules that can be checked
// without a browser (5.3 labels, G-093 99+ cap, 4.9 the disabled reason, D-36/D-53 pager labels). node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sizeClass, isShort, applySizeClass } from './size-class.js';
import { fmtFor, fmtCompact } from './number.js';
import { icon, ICONS } from './icons.js';
import * as C from './components.js';

test('size class: the design.md 2.1 rules in their order, every size one class', () => {
  const cases = [
    [[359, 800], 'tiny'], [[800, 299], 'tiny'], [[400, 225], 'tiny'],
    [[667, 375], 'compact-land'], [[932, 430], 'compact-land'], [[1280, 480], 'compact-land'], [[915, 412], 'compact-land'],
    [[375, 667], 'compact-port'], [[430, 932], 'compact-port'], [[599, 900], 'compact-port'],
    [[600, 900], 'medium'], [[820, 1180], 'medium'], [[917, 692], 'medium'], [[1180, 820], 'medium'], [[1199, 800], 'medium'],
    [[1200, 800], 'expanded'], [[1280, 720], 'expanded'], [[1990, 830], 'expanded'],
    [[480, 490], 'compact-port'],   // height < 500 but not landscape: rule 2 does not match, rule 3 does
  ];
  for (const [[w, h], want] of cases) assert.equal(sizeClass(w, h), want, `${w}x${h}`);
  assert.equal(isShort('expanded', 699), true); assert.equal(isShort('medium', 692), true);
  assert.equal(isShort('expanded', 720), false); assert.equal(isShort('compact-land', 400), false);
});

test('icons: one SVG style (stroke 2, currentColor), decorative unless labelled, unknown names refused', () => {
  const s = icon('award');
  assert.match(s, /stroke-width="2"/); assert.match(s, /stroke="currentColor"/); assert.match(s, /aria-hidden="true"/);
  assert.match(icon('x', { label: 'Close' }), /role="img" aria-label="Close"/);
  assert.throws(() => icon('no-such-icon'), /unknown icon/);
  for (const n of ['landmark', 'party-popper', 'layers', 'award', 'trophy', 'skull', 'swords', 'castle']) assert.ok(ICONS[n], `tab icon ${n} (3.1)`);
});

test('icon-only controls need a label (5.3); the pager arrows are labelled (D-53)', () => {
  assert.throws(() => C.iconButton({ icon: 'x' }), /needs a label/);
  assert.match(C.iconButton({ icon: 'x', label: 'Close' }), /aria-label="Close"/);
  const p = C.pager({ page: 1, pages: 3 });
  assert.match(p, /aria-label="Previous page"[^>]*disabled/); assert.match(p, /1 \/ 3/);
  assert.doesNotMatch(p.split('aria-label="Next page"')[1].split('>')[0], /disabled/);
  assert.match(C.pager({ page: 3, pages: 3 }), /aria-label="Next page"[^>]*disabled/);
});

test('counter caps at 99+ (G-093); a disabled control shows its reason (4.9); busy is announced', () => {
  assert.match(C.counter(99), />99</); assert.match(C.counter(100), />99\+</); assert.match(C.counter(-3), />0</);
  const d = C.button({ label: 'Buy', disabled: true, reason: 'Needs 100 Shards' });
  assert.match(d, /disabled/); assert.match(d, /u3-reason">Needs 100 Shards/);
  const b = C.button({ label: 'Buy', busy: true });
  assert.match(b, /aria-busy="true"/); assert.match(b, /u3-spin/);
});

test('text is escaped; a dialog has Cancel on the left and the action on the right (5.3)', () => {
  assert.doesNotMatch(C.row({ main: '<img src=x onerror=1>' }), /<img/);
  const d = C.dialog({ title: 'Buy?', primary: { label: 'Buy' } });
  assert.ok(d.indexOf('>Cancel<') < d.indexOf('>Buy<'));
});

test('ui3.css uses tokens only: no color, px or z-index literal (4.1, gate G4)', () => {
  const css = readFileSync(new URL('../../public/ui3.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0, 'hex color');
  assert.equal((css.match(/\brgba?\(|\bhsla?\(/g) || []).length, 0, 'rgb/hsl color');
  assert.equal((css.match(/\d(\.\d+)?px\b/g) || []).length, 0, 'px literal');
  assert.equal((css.match(/z-index:\s*-?\d/g) || []).length, 0, 'z-index literal');
  assert.doesNotMatch(css, /m-land|m-port/);
  assert.doesNotMatch(css, /@media[^{]*(min|max)-(width|height)/, 'raw size media query (2.1)');
});

test('keyboard: the class holds while a text box has the focus on touch, and returns after (2.1, G-015)', () => {
  const doc = { documentElement: {}, body: { dataset: {} }, activeElement: null };
  const win = { innerWidth: 932, innerHeight: 430, document: doc, matchMedia: () => ({ matches: true }), getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  assert.equal(applySizeClass(win), 'compact-land');
  doc.activeElement = { tagName: 'INPUT', type: 'search' }; win.innerHeight = 193;   // the keyboard takes 55%
  assert.equal(applySizeClass(win), 'compact-land');
  assert.equal(doc.body.dataset.kb, '');
  doc.activeElement = null;                                                     // the box lost the focus
  assert.equal(applySizeClass(win), 'tiny');                                    // a really short frame is tiny
  assert.equal(doc.body.dataset.kb, undefined);
  const fine = { ...win, innerHeight: 430, matchMedia: () => ({ matches: false }) };
  applySizeClass(fine); doc.activeElement = { tagName: 'TEXTAREA' }; fine.innerHeight = 193;
  assert.equal(applySizeClass(fine), 'tiny', 'a pointer device has no on-screen keyboard: no hold');
});

test('numbers: full form, and the compact form on the compact classes from 10,000 (10.5, G-168)', () => {
  assert.equal(fmtFor(123456789, 'compact-port'), '123.5M');
  assert.equal(fmtFor(12345, 'compact-land'), '12.3k');
  assert.equal(fmtFor(9999, 'compact-port'), '9,999');
  assert.equal(fmtFor(123456789, 'expanded'), '123,456,789');
  assert.equal(fmtCompact(1234), '1.2k');
});

test('Card picker grid (UI-64, 8.1): tiles from card-tile to card-tile-max wide, the rows that fit, one smaller row when short', async () => {
  const { fitGrid } = await import('./card-picker.js');
  const g = fitGrid(398, 560, 8);                          // a 430x932 phone sheet: 4 columns
  assert.equal(g.cols, 4); assert.ok(g.tile >= 88 && g.tile <= 112); assert.ok(g.rows >= 3);
  const w = fitGrid(1200, 300, 12);                        // a wide short area: many columns, rows by height
  assert.ok(w.tile <= 112 && w.cols >= 10); assert.equal(w.rows, Math.floor((300 + 12) / (w.tile * 1.4 + 12)));
  const s = fitGrid(300, 100, 8);                          // too short for one row at 88: one row of smaller cards
  assert.equal(s.rows, 1); assert.ok(s.tile * 1.4 <= 100);
});

test('Card picker order (6.5a): a tap adds at the end; removing a card moves the later cards up; the cap holds', async () => {
  const { toggle } = await import('./card-picker.js');
  assert.deepEqual(toggle([1, 2, 3], 4, 5), [1, 2, 3, 4]);
  assert.deepEqual(toggle([1, 2, 3], 2, 5), [1, 3]);
  assert.deepEqual(toggle([1, 2, 3, 4, 5], 6, 5), [1, 2, 3, 4, 5]);
});
