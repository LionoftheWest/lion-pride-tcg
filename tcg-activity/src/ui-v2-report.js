// The report button (Nathan, 2026-10-01; design 23): the wrench in the top bar opens
// "Report a problem" (Bug / Feedback / Idea). POST /api/feedback stores it (reports.js,
// player_reports.sql: 3 a day) and the server turns it into a GitHub Issue that never names
// the member. Shown only when /api/flags says reports: true (FEATURE_REPORTS=1).

import { v2ctx } from './ui-v2.js';
import { reportHTML, footHTML, errorText, syncRail } from './ui3/report.js';

const v3 = () => document.body.classList.contains('ui-v3');
const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  bug: svg('<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6 13H2"/><path d="M22 13h-4"/>'),
  feedback: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  idea: svg('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>'),
  screen: svg('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/>'),
  version: svg('<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>'),
  time: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  send: svg('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
};
const KINDS = [['bug', 'Bug'], ['feedback', 'Feedback'], ['idea', 'Idea']];
const PLACEHOLDER = { bug: 'What happened?', feedback: 'What do you think?', idea: 'What is your idea?' };
const SCREENS = { home: 'Home screen', collection: 'Collection', battling: 'Hunt', trading: 'Community', board: 'Leaderboard', gallery: 'Gallery' };
const MIN = 5, MAX = 1500;

// The last script error on this page, sent with a report (it often names the bug).
let lastError = '';
window.addEventListener('error', (e) => { lastError = String(e?.message || '').slice(0, 300); });
window.addEventListener('unhandledrejection', (e) => { lastError = String(e?.reason?.message || e?.reason || '').slice(0, 300); });

const state = { kind: 'bug', text: '', sent: null, error: '', busy: false };

const version = () => (document.querySelector('script[src*="main."]')?.getAttribute('src')?.match(/main\.([A-Za-z0-9]+)\.js/)?.[1] || 'dev').slice(0, 8).toLowerCase();
const screen = () => {
  const v = ctx().currentView?.() || 'home';
  return SCREENS[v] || v.charAt(0).toUpperCase() + v.slice(1);
};
const when = () => new Date().toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })
  + ' · ' + new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', ...(v3() ? { timeZoneName: 'short' } : {}) });   // v3: the zone label (UI-40 frame: "3:56 PM MDT")

export function initReport() {
  const btn = ctx().el('reportBtn');
  if (!btn) return;
  btn.innerHTML = ICON.wrench;
  btn.classList.remove('hidden');
  btn.addEventListener('click', openReport);
}

function paint() {
  const box = ctx().el('v2Report');
  if (!box) return;
  if (v3()) { paintV3(box); return; }
  if (state.sent) {
    box.innerHTML = `<div class="nt-head"><h3>Report a problem</h3><span class="grow"></span><button class="v2-icon" id="rpClose" aria-label="Close">✕</button></div>
      <div class="rp-done"><span class="rp-check">${ICON.check}</span><b>Thanks!</b><span>Report #${esc(state.sent)} sent</span></div>`;
    box.querySelector('#rpClose').addEventListener('click', closeReport);
    return;
  }
  const len = state.text.trim().length;
  box.innerHTML = `<div class="nt-head"><h3>Report a problem</h3><span class="grow"></span><button class="v2-icon" id="rpClose" aria-label="Close">✕</button></div>
    <div class="seg rp-kinds">${KINDS.map(([k, label]) => `<button data-k="${k}" class="${state.kind === k ? 'on' : ''}">${ICON[k]}${label}</button>`).join('')}</div>
    <textarea id="rpText" class="rp-text" maxlength="${MAX}" placeholder="${PLACEHOLDER[state.kind]}">${esc(state.text)}</textarea>
    <div class="rp-with"><span class="side-h">Sent with it</span>
      <div class="rp-chips"><span>${ICON.screen}${esc(screen())}</span><span>${ICON.version}Version ${esc(version())}</span><span>${ICON.time}${esc(when())}</span></div></div>
    ${state.error ? `<p class="rp-err">${esc(state.error)}</p>` : ''}
    <button class="v2-btn gold rp-send" id="rpSend" ${len < MIN || state.busy ? 'disabled' : ''}>${ICON.send}Send</button>`;
  box.querySelector('#rpClose').addEventListener('click', closeReport);
  box.querySelectorAll('.rp-kinds button').forEach((b) => b.addEventListener('click', () => { state.kind = b.dataset.k; state.error = ''; paint(); box.querySelector('#rpText').focus(); }));
  const ta = box.querySelector('#rpText');
  ta.addEventListener('input', () => {
    state.text = ta.value;
    box.querySelector('#rpSend').disabled = state.text.trim().length < MIN || state.busy;
  });
  box.querySelector('#rpSend').addEventListener('click', send);
}

async function send() {
  const text = state.text.trim();
  if (text.length < MIN || state.busy) return;
  state.busy = true; state.error = ''; paint();
  try {
    const r = await ctx().apiPost('/api/feedback', {
      kind: state.kind, body: text,
      context: { screen: screen(), version: version(), window: `${innerWidth}x${innerHeight}`, error: lastError },
    });
    if (r?.ok) { state.sent = r.id; state.text = ''; }
    else state.error = v3() ? errorText(r) : r?.error === 'limit' ? `You can send ${r.limit || 3} reports a day.` : r?.error === 'short' ? 'Write a little more.' : 'That did not send. Try again.';
  } catch { state.error = v3() ? errorText(null) : 'That did not send. Try again.'; }
  state.busy = false;
  paint();
}

// ---- v3 (UI-40): the Feedback window (src/ui3/report.js) ----
function paintV3(box) {
  box.innerHTML = reportHTML({ ...state, screen: screen(), version: version(), when: when() });
  box.querySelector('[data-rp-close]').addEventListener('click', closeReport);
  const ta = box.querySelector('#u3RpText');
  if (!ta) return;   // the thanks view
  const area = ta.parentElement;
  ta.addEventListener('input', () => {
    state.text = ta.value;
    box.querySelector('#u3RpFoot').innerHTML = footHTML(state);
    syncRail(area);
  });
  ta.addEventListener('scroll', () => syncRail(area), { passive: true });
  railObs?.disconnect();
  if (window.ResizeObserver) { railObs = new ResizeObserver(() => syncRail(area)); railObs.observe(ta); }
  syncRail(area);
}
let railObs = null;
function onV3Click(e) {
  const box = ctx().el('v2Report');
  const k = e.target.closest('[data-seg]');
  if (k) { state.kind = k.dataset.seg; state.error = ''; paint(); box.querySelector('#u3RpText')?.focus(); return; }
  if (e.target.closest('[data-rp-send]')) send();
}
function onV3Key(e) { if (e.key === 'Escape') { e.preventDefault(); closeReport(); } }

export function openReport() {
  const { el } = ctx();
  let box = el('v2Report');
  if (!box) {
    document.body.insertAdjacentHTML('beforeend', v3()
      ? '<div id="v2Report" class="u3-rp hidden" role="dialog" aria-modal="false" aria-labelledby="u3RpTitle"></div>'
      : '<div id="v2Report" class="v2-drop rp-drop hidden"></div>');
    box = el('v2Report');
    if (v3()) box.addEventListener('click', onV3Click);
  }
  if (!box.classList.contains('hidden')) { closeReport(); return; }
  state.sent = null; state.error = '';
  box.classList.remove('hidden');
  if (v3()) { document.getElementById('menuBtn')?.classList.add('is-open'); document.addEventListener('keydown', onV3Key); }
  paint();
  if (v3()) box.querySelector('[data-rp-close]')?.focus();   // not the text box: on a phone that would open the keyboard before the member chose to type
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
}
function outside(e) {
  const box = ctx().el('v2Report');
  if (box && !box.contains(e.target) && !e.target.closest('#reportBtn')) closeReport();
}
export function closeReport() {
  const box = ctx().el('v2Report');
  if (!box || box.classList.contains('hidden')) return;
  box.classList.add('hidden');
  document.removeEventListener('pointerdown', outside, { capture: true });
  if (v3()) {
    document.removeEventListener('keydown', onV3Key);
    railObs?.disconnect();
    const menu = document.getElementById('menuBtn');
    menu?.classList.remove('is-open');
    if (box.contains(document.activeElement) || document.activeElement === document.body) menu?.focus();   // 6.2: back to the opener
  }
}
