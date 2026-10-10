// The unlock gate screen for the Hunt and the Dungeon (docs/activities/03-dungeon-run.md 3A; Nathan
// 2026-10-03). The server decides (adventure_gate.sql); this only shows the checklist and a button for
// each step: the starter gifts -> the bell, the attackers -> open packs.
import { v2ctx } from './ui-v2.js';
import { gateModel } from './ui3/unlock.js';
import { button, esc } from './ui3/components.js';
import { icon } from './ui3/icons.js';

const ctx = () => v2ctx();
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const OK = svg('<path d="M20 6 9 17l-5-5"/>');
const LOCK = svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');

// what: 'the Hunt' | 'the Dungeon'
// v3 (UI-53, design repo UI-53/approved): the same gate in the UI-00 components. The texts and the steps come from unlock.js.
function gateV3HTML(g, what) {
  const m = gateModel(g, what);
  const step = (s) => `<div class="u3-gt-step${s.done ? ' is-done' : ''}">
      <span class="u3-gt-ic">${s.done ? icon('check') : ''}</span>
      <div class="u3-gt-txt"><b>${esc(s.title)}</b><span>${esc(s.prog)}</span></div>
      ${s.done ? '<span class="u3-gt-ok">Done</span>' : button({ label: s.label, variant: s.variant, data: { gate: s.act } })}
    </div>`;
  return `<div class="u3-gate"><section class="u3-gt-card">
    <span class="u3-gt-lock">${icon('lock', { size: 'xl' })}</span>
    <h2 class="u3-gt-title">${esc(m.title)}</h2>
    <div class="u3-gt-steps">${m.steps.map(step).join('')}</div>
  </section></div>`;
}

export function gateHTML(g, what) {
  if (document.body.classList.contains('ui-v3')) return gateV3HTML(g, what);
  const giftsDone = (g.gifts_open || 0) === 0;
  const atkDone = (g.attackers || 0) >= (g.need || 8);
  const claimed = (g.gifts_total || 0) - (g.gifts_open || 0);
  const step = (done, title, prog, btn, act) => `<div class="gt-step${done ? ' done' : ''}">
      <span class="gt-ic">${done ? OK : ''}</span>
      <div class="gt-txt"><b>${title}</b><span>${prog}</span></div>
      ${done ? '<span class="gt-ok">Done</span>' : `<button class="v2-btn gold gt-go" data-gate="${act}">${btn}</button>`}
    </div>`;
  return `<div class="gt-wrap"><div class="gt-card">
    <span class="gt-lock">${LOCK}</span>
    <h2>Unlock ${what}</h2>
    ${step(giftsDone, 'Redeem your starter gifts', `${claimed} / ${g.gifts_total || 0} redeemed`, 'Open the bell', 'bell')}
    ${step(atkDone, `Own ${g.need || 8} attackers`, `${Math.min(g.attackers || 0, g.need || 8)} / ${g.need || 8} Characters or Creatures`, 'Open a pack', 'open')}
  </div></div>`;
}

export function wireGate(root) {
  root.querySelectorAll('[data-gate]').forEach((b) => b.addEventListener('click', () => {
    ctx().sfx?.('click');
    if (b.dataset.gate === 'bell') document.getElementById('bellBtn')?.click();
    else document.getElementById('dockOpen')?.click();
  }));
}
