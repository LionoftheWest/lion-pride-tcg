// The explainer carousel (Nathan, 2026-10-02): the first time a member opens a view, a step-by-step
// carousel shows how it works, one real screen per slide with a gold ring on the part it explains.
// The "?" circle in the view opens the same carousel again. This is the standard for every view:
// add a set to SETS, put explainBtn(key) in the view's top row and call maybeExplain(key) after
// it paints. The seen sets are saved on the account (players.tutorial.seen, /api/tutorial).

import { v2ctx } from './ui-v2.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const img = (f) => `/explain/${f}.webp`;

export const SETS = {
  hall: { name: 'Trade Hall', slides: [
    { img: 'hall-wanted', title: 'The Trade Hall', text: 'Trade cards with any member. Wanted shows the cards members want. For trade shows the cards members offer.' },
    { img: 'hall-wanted-cards', title: 'Wanted', text: 'Each card is on a member\'s wishlist. Have one? Tap it and send it. They pick one of your cards to give back.' },
    { img: 'hall-for-trade', title: 'For trade', text: 'Members list these cards for anyone. Tap a card to make an offer for it.' },
    { img: 'hall-offer', title: 'Make an offer', text: 'Pick one of your cards of the same rarity. ♡ marks a card on their wishlist. Tap Send offer. The swap happens when they accept.' },
    { img: 'hall-offers-panel', title: 'Your offers', text: 'Offers to you and from you show here. The card you offer is held until they answer. Tap ✕ to cancel.' },
    { img: 'hall-manage-my-listings', title: 'List your cards', text: 'Tap Manage My Listings. Then tap a card to put it up for trade.' },
    { img: 'hall-your-listings', title: 'Your listings', text: 'List up to 5 cards. Tap ✕ to take one down. When you accept an offer, the listing closes.' },
  ] },
  auctions: { name: 'Auctions', slides: [
    { img: 'auctions-open', title: 'Auctions', text: 'Members auction a card. You bid with your cards. Tap an auction to see it and bid.' },
    { img: 'auctions-start', title: 'Start an auction', text: 'Pick a card. Set the minimum bid and the length, 1 to 14 days. You can run one auction at a time.' },
    { img: 'auctions-minimum', title: 'The minimum', text: 'The seller asks for a number of cards of one rarity, named cards, or both. Rarer cards count too.' },
    { img: 'auctions-bid', title: 'Place a bid', text: 'Add 1 to 5 of your cards and tap Place bid. A Gold auction takes Full Art, Promo and Event cards. Your bid cards are held.' },
    { img: 'auctions-seller-bids', title: 'The seller picks', text: 'The seller can accept any bid at any time. Best marks the top bid.' },
      { img: 'auctions-confirm', title: 'Confirm the trade', text: 'If the seller accepts your bid, you have 24 hours to confirm. If you decline, the auction goes on. All other bids come back.' },
  ] },
  trades: { name: 'Trades', slides: [
    { img: 'trades-overview', title: 'Trades', text: 'Swap one of your cards for one of theirs. You can also gift a card or a pack.' },
    { img: 'trades-pick-member', title: 'Pick a member', text: 'Tap a member, or type a name in Find. Members in voice show first.' },
    { img: 'trades-pick-card', title: 'Pick your card', text: 'Tap the card you want to give. Cards that cannot be traded do not show here.' },
    { img: 'trades-send-offer', title: 'Send the offer', text: 'They pick one of their cards of the same rarity. Your card is held until the trade ends.' },
    { img: 'trades-pick-back', title: 'Answer an offer', text: 'When a member sends you an offer, tap Pick your card. Pick one of the same rarity and send it.' },
    { img: 'trades-accept', title: 'Accept the swap', text: 'When they pick a card, tap Accept and the cards swap. Tap ✕ to stop a trade before then.' },
    { img: 'trades-gift', title: 'Gift a card or pack', text: 'Tap Gift, then pick a card or 1 pack. Gold cards cannot be gifted. The gift waits in their bell.' },
  ] },
  pranks: { name: 'Boons & Pranks', slides: [
    { img: 'pranks-overview', title: 'Boons & Pranks', text: 'Some cards have an effect that you play on a member. Boons help, pranks tease, and neutral cards protect.' },
    { img: 'pranks-pick-member', title: 'Pick a member', text: 'Tap a member or find a name. You cannot play a card on yourself.' },
    { img: 'pranks-pick-card', title: 'Pick a card', text: 'The card shows what it does and how long it lasts. ⏳ means it is not ready yet.' },
    { img: 'pranks-play', title: 'Play it', text: 'Tap Play. You can play 10 cards a day, and 3 on the same member.' },
    { img: 'pranks-on-target', title: 'Already on them', text: 'This row shows the effects on that member now. The same effect cannot be on them twice.' },
    { img: 'pranks-shields', title: 'Protect a friend', text: 'Play a neutral card on a friend to block, bounce or delay their next prank. Cleanse removes all their pranks.' },
    { img: 'pranks-on-you', title: 'On you', text: 'The effects on you show here with the time left. You get 5 pranks a day at most.' },
  ] },
  hunt: { name: 'Raid Boss', slides: [
    { img: 'hunt-squad', title: 'Pick your squad', text: 'Pick up to 8 cards for today. Tap a card again to take it out.' },
    { img: 'hunt-boss', title: 'Meet the boss', text: 'A new boss comes Thursday at 3 PM MT and leaves Monday at 5 PM MT. Tap it to see its weakness and moves.' },
    { img: 'hunt-weakness', title: 'Hit its weakness', text: 'Cards that match its weakness hit 1.5 times harder and crit more often. 3 cards of one element hit 12% harder.' },
    { img: 'hunt-lock', title: 'Lock in', text: 'Auto-pick finds strong cards. Lock in, then Enter battle. After your first attack, the squad stays for the day.' },
    { img: 'hunt-attack', title: 'Attack', text: 'Tap a card to attack. The boss hits back. A card at 0 HP is down until midnight MT.' },
    { img: 'hunt-hp', title: 'One boss for all', text: 'All members hit the same boss. It heals a little, so attack every day.' },
    { img: 'hunt-prizes', title: 'Prizes', text: 'Deal damage to earn packs, if it falls or escapes. 1st 7, 2nd 5, 3rd 4, 4th to 10th 3, all others 1.' },
  ] },
  collection: { name: 'Collection', slides: [
    { img: 'col-grid', title: 'Your cards', text: 'Every card in the set. A lock means you do not have it yet.' },
    { img: 'col-filters', title: 'Filters', text: 'Show cards by owned, rarity, element, type or game.' },
    { img: 'col-viewer', title: 'See it up close', text: 'Tap a card to open it. Drag the card to turn it in 3D.' },
    { img: 'col-stats', title: 'Card stats', text: 'Power is the damage it deals in the Raid. HP is the damage it takes before it is down.' },
    { img: 'col-ascend', title: 'Ascend', text: 'Spend spare copies to add a star, up to 5. You always keep 1 copy.' },
    { img: 'col-points', title: 'Stat points', text: 'Each star gives 3 points to this card. Attack adds 5% power, Vitality 6% HP, Precision 3% crit.' },
    { img: 'col-bosses', title: 'Raid Bosses', text: 'See every boss that the Raid can bring. Tap one to see it move.' },
  ] },
};
// Only in UI v2 (the old UI has no v2ctx).
const v2 = () => document.body.classList.contains('ui-v2');

let seen = new Set();
let cur = null; // { key, i }
let swiped = 0; // the time of the last swipe: the click that ends it is not a tap outside

/** Called once after login with the saved progress (players.tutorial). */
export function initExplain(saved) { seen = new Set(saved?.seen || []); }

/** The "?" circle for a view's top row. */
export const explainBtn = (key) => (SETS[key] && v2() ? `<button class="ex-q" data-explain="${key}" aria-label="How ${esc(SETS[key].name)} works" title="How it works">?</button>` : '');
document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-explain]'); if (b) openExplain(b.dataset.explain); });

/** The first visit to a view opens its carousel once (never on top of the first-time walkthrough). */
export function maybeExplain(key) {
  if (!SETS[key] || !v2() || seen.has(key) || cur || document.getElementById('tutLayer')) return;
  seen.add(key);
  ctx().apiPost('/api/tutorial', { action: 'seen', set: key }).catch(() => {});
  openExplain(key);
}

/** A phone layout (body class `when`) with a full top row: the ? circle moves to the end of the
 *  view's toolbar. */
export function placeExplain(root, toolbar, when = 'm-port') {
  if (!document.body.classList.contains(when)) return;
  const q = root?.querySelector('.ex-q'); const bar = toolbar && root?.querySelector(toolbar);
  if (q && bar) bar.appendChild(q);
}

export function openExplain(key, i = 0) {
  if (!SETS[key]) return;
  cur = { key, i };
  let layer = document.getElementById('exLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'exLayer';
    document.body.appendChild(layer);
    layer.addEventListener('click', onClick);
    layer.addEventListener('pointerdown', swipeStart);
    document.addEventListener('keydown', onKey);
  }
  paint();
}

function close() {
  document.getElementById('exLayer')?.remove();
  document.removeEventListener('keydown', onKey);
  cur = null;
}
function go(d) {
  const n = SETS[cur.key].slides.length;
  const i = cur.i + d;
  if (i >= n) return close();
  if (i < 0) return;
  cur.i = i;
  paint(d);
}

function paint(dir = 0) {
  const layer = document.getElementById('exLayer');
  const set = SETS[cur.key];
  const s = set.slides[cur.i];
  const last = cur.i === set.slides.length - 1;
  layer.innerHTML = `<div class="ex-card" role="dialog" aria-label="${esc(set.name)}: how it works">
    <button class="v2-icon ex-x" data-a="close" aria-label="Close">✕</button>
    <div class="ex-pic${dir ? (dir > 0 ? ' in-r' : ' in-l') : ''}"><img src="${img(s.img)}" alt=""></div>
    <div class="ex-body">
      <span class="ex-step mono">${esc(set.name.toUpperCase())} · ${cur.i + 1} OF ${set.slides.length}</span>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.text)}</p>
      <div class="ex-dots">${set.slides.map((_, j) => `<button class="${j === cur.i ? 'on' : ''}" data-a="dot" data-i="${j}" aria-label="Step ${j + 1}"></button>`).join('')}</div>
      <div class="ex-nav">
        <button class="v2-btn" data-a="back"${cur.i ? '' : ' disabled'}>‹ Back</button>
        <button class="v2-btn gold" data-a="next">${last ? 'Got it' : 'Next ›'}</button>
      </div>
    </div>
  </div>`;
  // Load the next picture early so Next does not wait.
  const nx = set.slides[cur.i + 1];
  if (nx) new Image().src = img(nx.img);
}

function onClick(e) {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (Date.now() - swiped < 400) return;
  if (e.target.id === 'exLayer' || a === 'close') return close();
  if (a === 'next') return go(1);
  if (a === 'back') return go(-1);
  if (a === 'dot') { const j = Number(e.target.dataset.i); if (j !== cur.i) go(j - cur.i); }
}
function onKey(e) {
  if (!cur) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
}
// A swipe on the picture or the text moves one slide. It never closes the carousel (only Got it, X,
// Esc or a tap outside do).
function swipeStart(e) {
  if (!e.target.closest('.ex-card') || e.target.closest('button')) return;
  const x0 = e.clientX, y0 = e.clientY;
  const up = (u) => {
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (u.type === 'pointercancel') return;
    const dx = u.clientX - x0, dy = u.clientY - y0;
    if (!(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && cur)) return;
    swiped = Date.now();
    if (dx < 0 && cur.i < SETS[cur.key].slides.length - 1) go(1);
    else if (dx > 0) go(-1);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
