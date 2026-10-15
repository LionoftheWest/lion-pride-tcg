// UI-39 the explainer carousels, v3 (design repo UI-39/approved, review-1; FEEDBACK D-80 items 7 and 8). Only under body.ui-v3:
// ui-v2-explain.js paints this window in place of its v2 card and keeps its logic (the first-visit auto-open, the "?" re-open,
// the seen sets saved on the account, the swipe, Esc and the arrow keys). With the flag off nothing here runs.
// This file holds the pure logic (the six sets, the step index, the first-visit rule, the picture names) and the window HTML.
// A picture is a crop of an approved screen with the control ringed in gold (public/explain/v3/<set>-<n>-c.webp for compact-port,
// -w.webp for the wider classes). Which one shows is a CSS rule on body[data-size] (90-ui-39.css), not a window size test.
import { esc, button, iconButton } from './components.js';
import { statSummary } from '../stat-labels.js';
import { RINGS } from './explain-rings.js';

// The texts are the approved frames (UI-39/source/slides.js: the captured texts with the glossary fixes of design.md 10.1),
// except the eight slides that D-80 item 8 replaced with the texts proposed in review-1 notes.md (P1). The Boons set is
// named "Boons" (D-80 item 7); the Hunt set "The Hunt" (10.1).
export const V3_SETS = {
  hall: { name: 'Trade Hall', slides: [
    { title: 'The Trade Hall', text: 'Trade cards with any member. Wanted shows the cards members want. For trade shows the cards members offer.' },
    { title: 'Wanted', text: 'Each card is one member\'s top want. Have one? Tap it to open a trade with that member.' },
    { title: 'For trade', text: 'Members list these cards for anyone. Tap a card to make an offer for it.' },
    { title: 'Make an offer', text: 'Pick one of your cards of the same rarity. ♡ marks a card on their wishlist. Tap Offer.' },
    { title: 'Your offers', text: 'Your offers wait in Pending, under Sent. The card you offer is held until they answer.' },
    { title: 'List your cards', text: 'Tap Manage my listings. Then tap a card to put it up for trade.' },
    { title: 'Your listings', text: 'List up to 5 cards. Tap ✕ to take one down. When you accept an offer, the listing closes.' },
  ] },
  auctions: { name: 'Auctions', slides: [
    { title: 'Auctions', text: 'Members auction a card. You bid with your cards. Tap an auction to see it and bid.' },
    { title: 'Start an auction', text: 'Pick a card. Set the minimum bid and the length, 1 to 14 days. You can run one auction at a time.' },
    { title: 'The minimum', text: 'The seller asks for a number of cards of one rarity, named cards, or both. Rarer cards count too.' },
    { title: 'Place a bid', text: 'Add 1 to 5 of your cards and tap Place bid. A Gold auction takes Full Art, Promo and Event cards. Your bid cards are held.' },
    { title: 'The seller picks', text: 'The seller can accept any bid at any time. Best marks the top bid.' },
    { title: 'Confirm the trade', text: 'If the seller accepts your bid, you have 24 hours to confirm. If you decline, the auction goes on. All other bids come back.' },
  ] },
  trades: { name: 'Trades', slides: [
    { title: 'Trades', text: 'Trade one of your cards for one of theirs. You can also gift a card or a pack.' },
    { title: 'Pick a member', text: 'Tap a member, or type a name in Find. Members in voice show first.' },
    { title: 'Pick your card', text: 'Tap the card you want to give. Cards that cannot be traded do not show here.' },
    { title: 'Send the offer', text: 'They pick one of their cards of the same rarity. Your card is held until the trade ends.' },
    { title: 'Answer an offer', text: 'An offer to you waits in Pending, under Incoming. Tap Accept or Decline.' },
    { title: 'Accept the trade', text: 'When they pick a card, tap Accept and the trade is done. Tap Decline to stop it.' },
    { title: 'Gift a card or pack', text: 'Tap Gift, then pick a card or 1 pack. Gold cards cannot be gifted. The gift waits in their bell.' },
  ] },
  pranks: { name: 'Boons', slides: [
    { title: 'Boons & Pranks', text: 'Some cards have an effect that you play on a member. Boons help, pranks tease, and shield cards protect.' },
    { title: 'Pick a member', text: 'Tap a member or find a name. You cannot play a card on yourself.' },
    { title: 'Pick a card', text: 'The card shows what it does and how long it lasts. ⏳ means it is not ready yet.' },
    { title: 'Play it', text: 'Tap Play boon, Play prank or Play shield. You can play 10 cards a day, and 3 on one member.' },
    { title: 'Already on them', text: 'This row shows the effects on that member now. The same effect cannot be on them twice.' },
    { title: 'Protect a friend', text: 'Play a shield card on a friend to block, bounce or delay their next prank. Cleanse removes all their pranks.' },
    { title: 'On you', text: 'The effects on you show here with the time left. You get 5 pranks a day at most.' },
  ] },
  hunt: { name: 'The Hunt', slides: [
    { title: 'Pick your squad', text: 'Pick up to 8 cards for today. Tap a card again to take it out.' },
    { title: 'Meet the boss', text: 'A new boss comes Thursday at 3 PM MT and leaves Monday at 5 PM MT. Tap it to see its weakness and moves.' },
    { title: 'Hit its weakness', text: 'Cards that match its weakness hit 1.5 times harder and crit more often. 3 cards of one element hit 12% harder.' },
    { title: 'Lock in', text: 'Auto-pick finds strong cards. Tap Confirm, then Enter battle. After your first attack, the squad stays for the day.' },
    { title: 'Attack', text: 'Tap a card to attack. The boss hits back. A card at 0 HP is down until midnight MT.' },
    { title: 'One boss for all', text: 'All members hit the same boss. It heals a little, so attack every day.' },
    { title: 'Prizes', text: 'Deal damage to earn packs, if it falls or escapes. 1st 7, 2nd 5, 3rd 4, 4th to 10th 3, all others 1.' },
  ] },
  collection: { name: 'Collection', slides: [
    { title: 'Your cards', text: 'Every card in the set. A lock means you do not have it yet.' },
    { title: 'Filters', text: 'Show cards by owned, rarity, element, type or game.' },
    { title: 'See it up close', text: 'Tap a card to open its details. Tap the card art to turn it in 3D.' },
    { title: 'Card stats', text: 'Power is the damage it deals in the Hunt. HP is the damage it takes before it is down.' },
    { title: 'Ascend', text: 'Spend extra copies to add a star, up to 5. You always keep 1 copy.' },
    { title: 'Stat points', get text() { return statSummary(); } },   // the names and numbers come from balance (stat-labels.js)
    { title: 'Bosses', text: 'See every boss that the Hunt can bring. Tap one to see it move.' },
  ] },
};

/** The set for a key, or null. */
export const v3Set = (key) => (Object.prototype.hasOwnProperty.call(V3_SETS, key) ? V3_SETS[key] : null);

/** The next step index. d is +1 (Next) or -1 (Back), or any jump. Past the last step the carousel is done; before the first it stays. */
export function stepTo(i, d, n) {
  const j = (i | 0) + (d | 0);
  if (j >= n) return { i: n - 1, done: true };
  return { i: Math.max(0, j), done: false };
}

/** "TRADE HALL · 2 OF 7" (the eyebrow, uppercase). */
export const eyebrow = (set, i) => `${set.name.toUpperCase()} · ${i + 1} OF ${set.slides.length}`;

/** "2 / 7" (the pager label of the library Pager, 5.2). */
export const pagerLabel = (i, n) => `${i + 1} / ${n}`;

/** The picture file of a slide; cls is "c" (compact-port) or "w" (the wider classes). */
export const picUrl = (key, i, cls) => `/explain/v3/${key}-${i + 1}-${cls}.webp`;

/** The first visit to a view opens its carousel once: only when the set is known and not yet seen. */
export const isFirstVisit = (seen, key) => !!v3Set(key) && !seen.has(key);

/** The gold ring on the control the slide names: percent of the picture (explain-rings.js), one for each picture class. */
export function ringHTML(key, i, cls) {
  const r = RINGS[`${key}-${i + 1}`]?.[cls];
  if (!r) return '';
  return `<span class="u3-ex__ring u3-ex__ring--${cls}" aria-hidden="true" style="left:${r[0]}%;top:${r[1]}%;width:${r[2]}%;height:${r[3]}%"></span>`;
}

/** The window's inside. dir is the swipe direction (+1 forward, -1 back, 0 first paint): it picks the slide animation. */
export function explainHTML(key, i, dir = 0) {
  const set = v3Set(key);
  const n = set.slides.length;
  const s = set.slides[i];
  const last = i === n - 1;
  const anim = dir > 0 ? ' is-r' : dir < 0 ? ' is-l' : '';
  return `<div class="u3-ex" role="dialog" aria-modal="true" aria-labelledby="u3ExT">`
    + `<div class="u3-ex__pic${anim}"><img class="u3-ex__img u3-ex__img--c" src="${picUrl(key, i, 'c')}" alt="" loading="lazy" draggable="false">`
    + `<img class="u3-ex__img u3-ex__img--w" src="${picUrl(key, i, 'w')}" alt="" loading="lazy" draggable="false">`
    + `${ringHTML(key, i, 'c')}${ringHTML(key, i, 'w')}${iconButton({ icon: 'x', label: 'Close', data: { a: 'close' } })}</div>`
    + `<div class="u3-ex__body"><span class="u3-ex__eye">${esc(eyebrow(set, i))}</span>`
    + `<h2 class="u3-ex__title" id="u3ExT">${esc(s.title)}</h2><div class="u3-ex__text">${esc(s.text)}</div>`
    + `<div class="u3-ex__nav">${button({ label: 'Back', icon: 'chevron-left', disabled: i === 0, data: { a: 'back' } })}`
    + `<span class="u3-ex__pg" aria-live="polite">${esc(pagerLabel(i, n))}</span>`
    + `${button({ label: last ? 'Got it' : 'Next', variant: 'primary', icon: last ? null : 'chevron-right', data: { a: 'next' } })}</div></div></div>`;
}
