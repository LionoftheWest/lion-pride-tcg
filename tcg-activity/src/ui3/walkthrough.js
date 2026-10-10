// UI-37 the first-time walkthrough, v3 (design repo UI-37/approved, review-1; FEEDBACK D-74, D-80). Only under body.ui-v3:
// ui-v2-tutorial.js paints this markup in place of its v2 card and keeps all of its logic (the saved progress, the real
// actions on step 1 and 2, the Finish that pays 1 pack once through the server). With the flag off nothing here runs.
// This file holds the step list, the "N OF M" counting and the place of the card. All pure, so node can test them.
import { esc } from './components.js';
import { icon } from './icons.js';

// The keys are the keys of the saved progress (tutorial.sql): do not rename one.
// Step 7 points at the Menu button (the Dailies are in the menu, UI-60); the red dot shows what can be claimed.
export const STEPS = [
  { key: 'gifts', target: '#bellBtn', title: 'Claim your gifts', text: 'Your New Player Bonus and Launch Day gift wait in the bell. Claim them to get your packs.' },
  { key: 'open', target: '#dockOpen', title: 'Open your first pack', text: 'Tap OPEN to reveal your cards. Each pack has 5 cards.' },
  { key: 'rarity', target: ['#revealGrid', '#mrGrid', '#homePulls .pl-top', '#homePulls'], title: 'Rarities', text: 'Cards come in 5 rarities: Normal, Illustrated Rare, Secret Rare, Full Art and Gold. Gold is the rarest.' },
  { key: 'collection', target: "#dock .dk[data-view='collection']", title: 'Your collection', text: 'Tap Ascend on a card to spend extra copies on a star, up to 5. Each star gives 3 stat points.' },
  { key: 'hunt', target: "#dock .dk[data-view='battling']", title: 'The Hunt', text: 'A new boss every Thursday at 3 PM MT. Attack with up to 8 cards a day until Monday 5 PM MT. Members share the packs.' },
  { key: 'community', target: "#dock .dk[data-view='trading']", title: 'Boons and pranks', text: 'Boons help a friend. Pranks mess with them. Some cards block or bounce pranks back.' },
  { key: 'dailies', target: ['#menuBtn', '#dailyBtn'], title: 'Dailies', text: 'Earn up to 5 packs a day by playing. The red dot shows what you can claim.' },
  { key: 'voice', target: '#homeVoice', title: 'Play together', text: 'Open the game in a voice channel to see your friends play live.' },
];

/** The steps the member sees: every step except the skipped ones (step 1 when no gift waits, FEEDBACK item 17). */
export const shownSteps = (skipped = []) => STEPS.filter((s) => !skipped.includes(s.key));

/** The label of a step: { n, m, label }. "STEP 1 OF 7" when step 1 is skipped. A key that is skipped has no place (n 0). */
export function position(key, skipped = []) {
  const list = shownSteps(skipped);
  const i = list.findIndex((s) => s.key === key);
  return { n: i + 1, m: list.length, label: i < 0 ? '' : `STEP ${i + 1} OF ${list.length}` };
}

/** The dots: one per shown step; the saved progress does not matter, the place in the walk does. */
export function dots(key, skipped = []) {
  const list = shownSteps(skipped);
  const at = list.findIndex((s) => s.key === key);
  return list.map((_, i) => (i === at ? 'on' : i < at ? 'done' : 'todo'));
}

/** The card of one step. last = the Finish button (no arrow). */
export function cardHTML(step, skipped, { last = false } = {}) {
  const p = position(step.key, skipped);
  const d = dots(step.key, skipped).map((s) => `<i class="u3-wt__dot${s === 'todo' ? '' : ` is-${s}`}"></i>`).join('');
  return `<div class="u3-wt__spot"></div>`
    + `<div class="u3-wt__card" role="dialog" aria-label="Walkthrough, ${esc(p.label.toLowerCase())}" aria-describedby="u3WtText">`
    + `<div class="u3-wt__top"><span class="u3-wt__step">${esc(p.label)}</span><span class="u3-wt__dots" aria-hidden="true">${d}</span></div>`
    + `<div class="u3-wt__title" role="heading" aria-level="2">${esc(step.title)}</div>`
    + `<div class="u3-wt__text" id="u3WtText">${esc(step.text)}</div>`
    + `<span class="u3-chip u3-chip--status u3-wt__reward">${icon('gift', { size: 'md' })}<span>Finish: 1 free pack</span></span>`
    + `<div class="u3-wt__act"><button type="button" class="u3-btn u3-btn--ghost u3-btn--md u3-wt__skip" data-wt="skip"><span class="u3-btn__label">Skip</span></button>`
    + `<button type="button" class="u3-btn u3-btn--primary u3-btn--md" data-wt="next"><span class="u3-btn__label">${last ? 'Finish' : 'Next'}</span>${last ? '' : icon('arrow-right')}</button></div>`
    + `<i class="u3-wt__arrow"></i></div>`;
}

const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const box = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });

/** The place of the card: never over the spotlighted control (with its ring), never in the Discord corner zone (the right
 *  corner.w of the top corner.h), inside the frame. rect = the target box; card = { w, h }; view = { w, h };
 *  o = { gap, margin, ring, corner: { w, h }, frame: { l, t, r, b } (the safe insets) }.
 *  Returns { left, top, side: 'below' | 'above' | 'right' | 'left', arrow } (arrow = the offset of the tip, along the card edge). */
export function placeCard(rect, card, view, o) {
  const { gap, margin, ring, corner } = o;
  const f = o.frame || { l: 0, t: 0, r: 0, b: 0 };
  const lo = { x: f.l + margin, y: f.t + margin }, hi = { x: view.w - f.r - margin - card.w, y: view.h - f.b - margin - card.h };
  const clamp = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));
  const ringBox = { left: rect.left - ring, top: rect.top - ring, right: rect.right + ring, bottom: rect.bottom + ring };
  const zone = { left: view.w - corner.w, top: 0, right: view.w, bottom: corner.h };
  const cx = rect.left + (rect.right - rect.left) / 2, cy = rect.top + (rect.bottom - rect.top) / 2;
  const mk = (side) => {
    let left, top;
    if (side === 'below' || side === 'above') {
      left = clamp(cx - card.w / 2, lo.x, hi.x);
      top = side === 'below' ? ringBox.bottom + gap : ringBox.top - gap - card.h;
    } else {
      left = side === 'right' ? ringBox.right + gap : ringBox.left - gap - card.w;
      top = clamp(cy - card.h / 2, lo.y, hi.y);
    }
    const b = box(left, top, card.w, card.h);
    const inside = b.left >= lo.x - 0.5 && b.top >= lo.y - 0.5 && b.right <= view.w - f.r - margin + 0.5 && b.bottom <= view.h - f.b - margin + 0.5;
    // a candidate that is out of the frame, over the ring or in the corner zone is "bad"; the least bad one wins at the end
    const bad = (inside ? 0 : 1) + (hit(b, ringBox) ? 4 : 0) + (hit(b, zone) ? 2 : 0);
    const arrow = side === 'below' || side === 'above' ? cx - left : cy - top;
    return { left, top, side, arrow, bad, over: area(b, ringBox) + area(b, zone) };
  };
  const pref = cy < view.h / 2 ? ['below', 'above', 'right', 'left'] : ['above', 'below', 'left', 'right'];
  const all = pref.map(mk);
  const best = all.find((c) => c.bad === 0) || all.slice().sort((a, b) => a.over - b.over || a.bad - b.bad)[0];
  // the least bad place still stays in the frame (a target as big as the screen leaves no free place)
  const left = clamp(best.left, lo.x, hi.x), top = clamp(best.top, lo.y, hi.y);
  return { left, top, side: best.side, arrow: best.arrow + best.left - left };
}
