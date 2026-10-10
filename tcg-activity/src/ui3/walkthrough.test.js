// UI-37 the walkthrough (v3): the steps, the "N OF M" counting when step 1 is skipped, the card, the place of the card. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, shownSteps, position, dots, cardHTML, placeCard } from './walkthrough.js';

const text = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('the 8 steps keep the saved keys and the approved titles', () => {
  assert.deepEqual(STEPS.map((s) => s.key), ['gifts', 'open', 'rarity', 'collection', 'hunt', 'community', 'dailies', 'voice']);
  assert.deepEqual(STEPS.map((s) => s.title), ['Claim your gifts', 'Open your first pack', 'Rarities', 'Your collection', 'The Hunt', 'Boons and pranks', 'Dailies', 'Play together']);
  assert.match(STEPS[6].text, /red dot/);
  assert.equal(STEPS[6].target[0], '#menuBtn');   // step 7 points at the Menu (UI-60)
  assert.match(STEPS[4].text, /Members share the packs/);
});

test('"STEP N OF M": 8 steps with the gifts step, 7 without (FEEDBACK item 17)', () => {
  assert.equal(position('gifts').label, 'STEP 1 OF 8');
  assert.equal(position('voice').label, 'STEP 8 OF 8');
  assert.equal(position('open', ['gifts']).label, 'STEP 1 OF 7');
  assert.equal(position('voice', ['gifts']).label, 'STEP 7 OF 7');
  assert.equal(shownSteps(['gifts']).length, 7);
  assert.equal(position('gifts', ['gifts']).n, 0);
  // another skipped step (no Dailies for this member) renumbers the rest too
  assert.equal(position('voice', ['gifts', 'dailies']).label, 'STEP 6 OF 6');
});

test('the dots follow the shown steps: done, one on, the rest to do', () => {
  assert.deepEqual(dots('collection'), ['done', 'done', 'done', 'on', 'todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(dots('open', ['gifts']), ['on', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
});

test('the card: label, title, text, the Finish chip, Skip and Next; the last step says Finish with no arrow', () => {
  const t = text(cardHTML(STEPS[0], []));
  assert.match(t, /^STEP 1 OF 8 Claim your gifts Your New Player Bonus and Launch Day gift wait in the bell\. Claim them to get your packs\. Finish: 1 free pack Skip Next$/);
  const h = cardHTML(STEPS[7], ['gifts'], { last: true });
  assert.match(text(h), /STEP 7 OF 7 Play together/);
  assert.match(h, /data-wt="next"><span class="u3-btn__label">Finish<\/span><\/button>/);
  assert.match(h, /data-wt="skip"/);
  assert.equal((h.match(/class="u3-wt__dot[ "]/g) || []).length, 7);
  assert.doesNotMatch(h, /Tutorial|<h3|<p>/);   // no v2 markup: #tutLayer h3 / p of the v2 CSS would restyle it
});

const O = { gap: 16, margin: 12, ring: 8, corner: { w: 120, h: 60 } };
const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const clear = (p, rect, card, view, o = O) => {
  const c = { left: p.left, top: p.top, right: p.left + card.w, bottom: p.top + card.h };
  const ring = { left: rect.left - o.ring, top: rect.top - o.ring, right: rect.right + o.ring, bottom: rect.bottom + o.ring };
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const zone = { left: view.w - o.corner.w, top: 0, right: view.w, bottom: o.corner.h };
  return { ring: !hit(c, ring), corner: !hit(c, zone), inside: c.left >= 0 && c.top >= 0 && c.right <= view.w && c.bottom <= view.h };
};

test('the card never covers its control and never sits in the corner zone (a top control goes below, a dock control above)', () => {
  const card = { w: 300, h: 230 }, view = { w: 430, h: 932 };
  for (const [name, rect, side] of [['bell', R(274, 6, 44, 44), 'below'], ['menu', R(326, 6, 44, 44), 'below'], ['avatar', R(378, 6, 44, 44), 'below'],
    ['open', R(185, 865, 60, 60), 'above'], ['dock collection', R(96, 870, 90, 56), 'above'], ['dock community', R(324, 870, 96, 56), 'above'], ['voice', R(4, 762, 422, 100), 'above']]) {
    const p = placeCard(rect, card, view, O);
    assert.equal(p.side, side, name);
    assert.deepEqual(clear(p, rect, card, view), { ring: true, corner: true, inside: true }, name);
  }
});

test('desktop: the bell below, the Open button above, the card in the frame', () => {
  const card = { w: 300, h: 220 }, view = { w: 1280, h: 720 };
  for (const rect of [R(1105, 22, 40, 40), R(1156, 22, 40, 40), R(600, 640, 80, 70), R(420, 640, 90, 60)]) {
    const p = placeCard(rect, card, view, O);
    assert.deepEqual(clear(p, rect, card, view), { ring: true, corner: true, inside: true });
  }
});

test('a tall target goes beside the card, the corner zone and the frame still hold', () => {
  const card = { w: 300, h: 230 }, view = { w: 430, h: 700 }, rect = R(12, 60, 406, 560);
  const p = placeCard(rect, card, view, O);
  assert.ok(p.side === 'right' || p.side === 'left' || p.side === 'above' || p.side === 'below');
  // nothing fits all rules here: the least bad place is chosen (smallest overlap), and it stays in the frame
  const c = clear(p, rect, card, view);
  assert.equal(c.inside, true);
});

test('the arrow points at the middle of the control, along the card edge', () => {
  const card = { w: 300, h: 230 }, view = { w: 430, h: 932 };
  const rect = R(96, 870, 90, 56);
  const p = placeCard(rect, card, view, O);
  assert.equal(p.arrow, rect.left + 45 - p.left);
});

test('the safe-area insets keep the card inside the usable frame', () => {
  const card = { w: 300, h: 230 }, view = { w: 430, h: 932 }, o = { ...O, frame: { l: 20, t: 40, r: 20, b: 30 } };
  const rect = R(96, 870, 90, 56);
  const p = placeCard(rect, card, view, o);
  assert.ok(p.left >= 20 + 12 && p.left + 300 <= 430 - 20 - 12);
  assert.ok(p.top >= 40 + 12);
});
