// The first-time walkthrough (Nathan, 2026-09-30; designs 21 + 22): the screen dims, the real
// button is spotlighted with a gold ring, and a card explains it (STEP N OF 7, Skip, Next).
// The progress is saved on the account (tutorial.sql); finishing pays 1 outside pack, once.
// It starts by itself until the member finishes or skips it; the ? panel replays it.

import { v2ctx, toast } from './ui-v2.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
export const STEPS = [
  { key: 'open', target: '#dockOpen', title: 'Open your first pack', text: 'Tap OPEN to reveal your cards. Each pack has 5 cards.' },
  // Design 22: on the member's own 5 cards in the reveal; without a pack, on Live pulls.
  { key: 'rarity', target: ['#revealGrid', '#mrGrid', '#homePulls .pl-top', '#homePulls'], title: 'Rarities', text: 'Cards come in 5 rarities: Normal, Illustrated Rare, Secret Rare, Full Art and Gold. Gold is the rarest.' },
  { key: 'collection', target: "#dock .dk[data-view='collection']", title: 'Your collection', text: 'A duplicate adds a star to your card, up to 5. Each star gives 3 stat points.' },
  { key: 'hunt', target: "#dock .dk[data-view='battling']", title: 'The Raid Boss', text: 'A new boss every Thursday at 3 PM MT. Attack with up to 8 cards a day until Monday 5 PM MT. Hunters share the packs.' },
  { key: 'community', target: "#dock .dk[data-view='trading']", title: 'Boons and pranks', text: 'Boons help a friend. Pranks mess with them. Some cards block or bounce pranks back.' },
  { key: 'dailies', target: '#dailyBtn', title: 'Dailies', text: 'Earn up to 5 packs a day by playing. The red number shows what you can claim.' },
  { key: 'voice', target: '#homeVoice', title: 'Play together', text: 'Open the game in a voice channel to see your friends play live.' },
];

let state = { done: [], skipped: false };
let idx = -1;
let onResize = null;

// Not offsetParent: it is always null for a fixed element (the reveal, the dock).
const visible = (n) => !!n && !n.classList.contains('hidden') && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden' && n.getBoundingClientRect().width > 0;
const findTarget = (t) => [].concat(t).map((sel) => document.querySelector(sel)).find(visible) || null;
const revealOpen = () => visible(document.getElementById('stage')) || !!document.getElementById('mrGrid') || visible(document.getElementById('openChooser'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(body) { try { return await ctx().apiPost('/api/tutorial', body); } catch { return null; } }

/** Called once after login with the saved progress. */
export function initTutorial(saved) {
  state = { done: [], skipped: false, ...(saved || {}) };
  if (!state.skipped && (state.done || []).length < STEPS.length) setTimeout(() => start(firstOpen()), 1500);
}
const firstOpen = () => Math.max(0, STEPS.findIndex((s) => !(state.done || []).includes(s.key)));

/** The ? panel: start again from step 1 (it never pays twice). */
export async function replayTutorial() {
  const r = await post({ action: 'replay' });
  state = r?.tutorial || { done: [], skipped: false };
  start(0);
}

let inReveal = false; // step 2 is on top of the member's first pack reveal
async function start(i, opts = {}) {
  idx = i;
  inReveal = !!opts.inReveal;
  if (!inReveal) {
    if (ctx().currentView() !== 'home') { ctx().show('home'); await wait(500); }
    while (revealOpen()) await wait(400); // never over a pack reveal
  }
  const step = STEPS[idx];
  if (!step) return close();
  const target = findTarget(step.target);
  if (!target) { // not on screen for this member (for example the Dailies are off): skip it
    await mark(step.key);
    return start(idx + 1);
  }
  paint(step, target);
  if (step.key === 'open') {
    // The real action: tapping OPEN opens a pack. Step 2 waits until the 5 cards are face up
    // and explains the rarities on them (design 22), for up to 3 minutes.
    target.addEventListener('click', async () => {
      if (idx !== 0) return;
      hide();
      await mark('open');
      const t0 = Date.now();
      await wait(800);
      while (Date.now() - t0 < 180000) {
        if (document.getElementById('mrGrid')) { await wait(1200); break; }
        const cards = [...(document.getElementById('revealGrid')?.querySelectorAll('.fc') || [])];
        if (cards.length && cards.every((c) => c.classList.contains('flipped'))) { await wait(700); break; }
        if (!revealOpen()) break; // no reveal (no pack): step 2 goes on Live pulls
        await wait(300);
      }
      start(1, { inReveal: revealOpen() });
    }, { once: true });
  }
}

async function mark(key) {
  if ((state.done || []).includes(key)) return;
  state.done = [...(state.done || []), key];
  const r = await post({ action: 'step', step: key });
  if (r?.tutorial) state = r.tutorial;
}

function hide() {
  document.getElementById('tutLayer')?.remove();
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
}
function close() { hide(); idx = -1; }

function paint(step, target) {
  hide();
  const last = idx === STEPS.length - 1;
  const layer = document.createElement('div');
  layer.id = 'tutLayer';
  layer.innerHTML = `<div class="tut-spot"></div>
    <div class="tut-card" role="dialog" aria-label="Tutorial"><div class="tut-top"><span class="tut-step mono">STEP ${idx + 1} OF ${STEPS.length}</span>
      <span class="tut-dots">${STEPS.map((_, i) => `<i class="${i === idx ? 'on' : i < idx ? 'done' : ''}"></i>`).join('')}</span></div>
      <h3>${esc(step.title)}</h3><p>${esc(step.text)}</p>
      <span class="tut-reward">🎁 Finish: 1 free pack</span>
      <div class="tut-act"><button class="link-btn" id="tutSkip">Skip</button><button class="v2-btn gold" id="tutNext">${last ? 'Finish' : 'Next →'}</button></div>
      <i class="tut-arrow"></i></div>`;
  document.body.appendChild(layer);
  const place = () => {
    const r = target.getBoundingClientRect(), pad = 8;
    const spot = layer.querySelector('.tut-spot');
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const card = layer.querySelector('.tut-card');
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const gap = pad + 16, arrow = layer.querySelector('.tut-arrow');
    const fitsBelow = r.bottom + gap + ch <= window.innerHeight - 12, fitsAbove = r.top - gap - ch >= 12;
    card.classList.remove('below', 'side-left', 'side-right');
    arrow.style.left = ''; arrow.style.top = '';
    if (fitsBelow || fitsAbove) {
      const below = fitsBelow && (!fitsAbove || r.top + r.height / 2 < window.innerHeight / 2);
      const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 12);
      Object.assign(card.style, { left: `${left}px`, top: `${below ? r.bottom + gap : r.top - gap - ch}px` });
      card.classList.toggle('below', below);
      arrow.style.left = `${Math.min(cw - 24, Math.max(12, r.left + r.width / 2 - left - 8))}px`;
    } else { // a tall target (Live pulls): beside it
      const onLeft = r.left + r.width / 2 > window.innerWidth / 2;
      const left = onLeft ? Math.max(12, r.left - gap - cw) : Math.min(window.innerWidth - cw - 12, r.right + gap);
      const top = Math.min(Math.max(12, r.top + r.height / 2 - ch / 2), window.innerHeight - ch - 12);
      Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
      card.classList.add(onLeft ? 'side-left' : 'side-right');
      arrow.style.top = `${Math.min(ch - 24, Math.max(12, r.top + r.height / 2 - top - 8))}px`;
    }
  };
  place();
  onResize = place;
  window.addEventListener('resize', onResize);
  layer.querySelector('#tutSkip').addEventListener('click', async () => { close(); state.skipped = true; await post({ action: 'skip' }); });
  layer.querySelector('#tutNext').addEventListener('click', async () => {
    await mark(step.key);
    if (inReveal) { // close the reveal with its own button, then go on
      hide();
      (document.getElementById('revealDone') || document.getElementById('mrClose'))?.click();
      await wait(500);
    }
    if (!last) return start(idx + 1);
    close();
    const r = await post({ action: 'finish' });
    if (r?.ok) { toast('🎁 Tutorial complete: +1 pack'); ctx().refreshPacks?.(); }
  });
}
