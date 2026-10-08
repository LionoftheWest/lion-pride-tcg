// The ? Help panel (Nathan, 2026-09-30; design 21): the FAQ and Replay tutorial. The answers
// are the live game rules (docs/tutorial-faq-draft.md in discord-design); edit them here.

import { v2ctx } from './ui-v2.js';
import { replayTutorial } from './ui-v2-tutorial.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const HELP_ICON = svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');

export const FAQ = [
  { icon: '📦', q: 'How do I earn packs?', a: 'Play! Your first message of the day earns 1 pack, and 25 messages earn 1 more. The Dailies add more: check in, fight the Raid Boss, spend 30 minutes in voice with someone, and trade or play a boon.', chips: ['Up to 5 a day', 'Gifts and rewards are extra'] },
  { icon: '🕛', q: 'When does the day reset?', a: 'At midnight Mountain Time (MT).' },
  { icon: '💎', q: 'What are the rarities?', a: 'Normal, Illustrated Rare, Secret Rare, Full Art and Gold. Per card: Normal 93.98%, Illustrated Rare 5%, Secret Rare 0.6%, Full Art 0.4%, Gold 0.02%.' },
  { icon: '⭐', q: 'What do duplicates do?', a: 'Keep them! Open the card in your Collection and tap Ascend: it spends spare copies to add a star, up to 5 stars (you always keep 1 copy). Each star gives 3 stat points: Attack, Vitality, Precision, Potency and Haste. You can reset the points of one card for free once a week.' },
  { icon: '⚔', q: 'When is the Raid Boss?', a: 'A new boss appears every Thursday at 3 PM MT and stays until Monday at 5 PM MT. Each day you pick a squad of up to 8 cards. Everyone who fights earns packs, if the boss falls or escapes. The top 10 by damage earn more: 1st 7 packs, 2nd 5, 3rd 4, 4th to 10th 3. Every other hunter earns 1.' },
  { icon: '📅', q: 'How do Dailies work?', a: 'Open the calendar button. Each daily you finish shows a Claim button, and the red number shows how many you can claim. Check in every day to build a streak: day 3 and day 7 give a bonus pack.' },
  { icon: '✨', q: 'How do pranks and boons work?', a: 'Cards with an effect can be played on another member. Boons help (for example a spotlight role or a Lucky Pull). Pranks are for fun (a nickname, a color or a short timeout). You can receive at most 5 pranks a day and at most 2 timeouts a day. Some cards block, reflect or redirect pranks, and a cleanse removes them.' },
  { icon: '⇄', q: 'How do trades work?', a: 'In Community, pick a member, pick your card and send the offer. They pick one of their cards of the same rarity, then you accept to swap. You can also gift a card or a pack.' },
  { icon: '🔕', q: 'How do I stop pings?', a: 'Open the bell, then Settings. Turn off any ping you do not want, or turn off "Show when I play".',
    a3: 'Open the Menu, then Settings. Turn off any ping you do not want, or turn off "Show when I play".' },   // a3: the v3 text (UI-61 Settings in the Menu)
];

let openIdx = 0;

export function initHelp() {
  const btn = ctx().el('helpBtn');
  if (!btn) return;
  btn.innerHTML = HELP_ICON;
  btn.classList.remove('hidden');
  btn.addEventListener('click', openHelp);
}

function paint() {
  const box = ctx().el('v2Help');
  if (!box) return;
  box.innerHTML = `<div class="nt-head"><h3>Help</h3><span class="grow"></span><button class="v2-icon" id="hpClose" aria-label="Close">✕</button></div>
    <div class="hp-list">${FAQ.map((f, i) => `<div class="hp-item${i === openIdx ? ' open' : ''}" data-i="${i}">
      <button class="hp-q"><span class="hp-ico">${f.icon}</span><b>${esc(f.q)}</b><span class="hp-chev">⌄</span></button>
      ${i === openIdx ? `<div class="hp-a"><p>${esc((f.a3 && document.body.classList.contains('ui-v3')) ? f.a3 : f.a)}</p>${f.chips ? `<div class="hp-chips">${f.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</div>` : ''}</div>`).join('')}</div>
    <button class="v2-btn hp-replay" id="hpReplay">↻ Replay tutorial</button>`;
  box.querySelector('#hpClose').addEventListener('click', closeHelp);
  box.querySelectorAll('.hp-q').forEach((b) => b.addEventListener('click', () => { const i = Number(b.parentElement.dataset.i); openIdx = openIdx === i ? -1 : i; paint(); }));
  box.querySelector('#hpReplay').addEventListener('click', () => { closeHelp(); replayTutorial(); });
}

export function openHelp() {
  const { el } = ctx();
  let box = el('v2Help');
  if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="v2Help" class="v2-drop hp-drop hidden"></div>'); box = el('v2Help'); }
  if (!box.classList.contains('hidden')) { closeHelp(); return; }
  box.classList.remove('hidden');
  paint();
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
}
function outside(e) {
  const box = ctx().el('v2Help');
  if (box && !box.contains(e.target) && !e.target.closest('#helpBtn')) closeHelp();
}
export function closeHelp() {
  const box = ctx().el('v2Help');
  if (!box || box.classList.contains('hidden')) return;
  box.classList.add('hidden');
  document.removeEventListener('pointerdown', outside, { capture: true });
}
