// The report button (Nathan, 2026-10-01; design 23): the wrench in the top bar opens
// "Report a problem" (Bug / Feedback / Idea). POST /api/feedback stores it (reports.js,
// player_reports.sql: 3 a day) and the server turns it into a GitHub Issue that never names
// the member. Shown only when /api/flags says reports: true (FEATURE_REPORTS=1).

import { v2ctx } from './ui-v2.js';
import { reportHTML, footHTML, shotsHTML, errorText, syncRail } from './ui3/report.js';
import { SHOT_TEXT, SLOTS, PICK_MAX_BYTES, shotsReducer, shotsToUpload, sendState, uploadOutcome, newShotId } from './ui3/report-shots.js';
import { captureView, prepareShot } from './ui3/report-capture.js';
import { deviceFactsOf } from './device-facts.js';
import { isShort, usableFrame } from './ui3/size-class.js';

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

const state = { kind: 'bug', text: '', sent: null, error: '', busy: false, shots: [], reportId: null, devOpen: false };
// From main.js: balance (the public balance of /api/flags), sdkPlatform() (the Discord SDK platform), upload() (the raw image POST).
let deps = {};

const version = () => (document.querySelector('script[src*="main."]')?.getAttribute('src')?.match(/main\.([A-Za-z0-9]+)\.js/)?.[1] || 'dev').slice(0, 8).toLowerCase();
const screen = () => {
  const v = ctx().currentView?.() || 'home';
  return SCREENS[v] || v.charAt(0).toUpperCase() + v.slice(1);
};
const when = () => new Date().toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })
  + ' · ' + new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', ...(v3() ? { timeZoneName: 'short' } : {}) });   // v3: the zone label (UI-40 frame: "3:56 PM MDT")

export function initReport(opts = {}) {
  deps = opts;
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
// Review-2: the device chip and the private screenshots. The facts come from src/device-facts.js (the SDK platform from main.js).
// The screenshots are kept in the window until Send: Send stores the report first, then uploads each image to
// POST /api/feedback/:id/shot (reports.js). If an image does not upload, the report is sent already: the window stays,
// the text is read-only, and Send (or Try again on the slot) uploads the rest. All done: the thanks view.
const maxShots = () => Number(deps.balance?.report_shots?.per_report) || SLOTS;
let learnedMax = null;   // balance report_shots.max_bytes, from a 413 answer (it is not in the public balance)
const maxBytes = () => Number(deps.balance?.report_shots?.max_bytes) || learnedMax || null;
const facts = () => deviceFactsOf(window, deps.sdkPlatform?.() || '');
const shotEv = (ev) => { state.shots = shotsReducer(state.shots, { max: maxShots(), ...ev }); };
const freeUrl = (s) => { if (s?.url?.startsWith('blob:')) URL.revokeObjectURL(s.url); };
function resetShots() { state.shots.forEach(freeUrl); state.shots = []; state.reportId = null; state.devOpen = false; }

// Review-2 change 8: under 700 px usable height (the threshold of "short", design.md 2.1) the window uses the smaller gaps on
// every class. body[data-short] exists only for medium and expanded, so the 375x667 phone gets the class here.
const fitShort = (box) => box.classList.toggle('is-short', isShort('medium', usableFrame(window).height));
function onV3Resize() { const box = v3box(); if (box && !box.classList.contains('hidden')) { fitShort(box); if (state.devOpen) placePop(); } }

function paintV3(box) {
  fitShort(box);
  box.innerHTML = reportHTML({ ...state, screen: screen(), version: version(), when: when(), facts: facts(), max: maxShots(), locked: !!state.reportId });
  box.querySelector('[data-rp-close]').addEventListener('click', closeReport);
  const ta = box.querySelector('#u3RpText');
  if (!ta) return;   // the thanks view
  const area = ta.parentElement;
  ta.addEventListener('input', () => {
    state.text = ta.value;
    paintFoot();
    syncRail(area);
  });
  ta.addEventListener('scroll', () => syncRail(area), { passive: true });
  railObs?.disconnect();
  if (window.ResizeObserver) { railObs = new ResizeObserver(() => syncRail(area)); railObs.observe(ta); }
  syncRail(area);
  if (state.devOpen) placePop();
}
let railObs = null;
const v3box = () => ctx().el('v2Report');
function paintFoot() { const f = v3box()?.querySelector('#u3RpFoot'); if (f) f.innerHTML = footHTML(state); }
/** Repaint only the Screenshots block and the Send row (the text box keeps its focus and its keyboard). */
function paintShots() {
  const box = v3box(), el = box?.querySelector('.u3-rp__shots');
  if (!el) { if (box && !box.classList.contains('hidden')) paint(); return; }
  el.outerHTML = shotsHTML({ shots: state.shots, max: maxShots(), sending: state.busy });
  paintFoot();
}
/** The progress of one slot, in place (no repaint for each step). */
function paintProgress(id) {
  const s = state.shots.find((x) => x.id === id);
  const bar = v3box()?.querySelector(`[data-shot="${id}"] .u3-bar`);
  if (!s || !bar) return;
  const v = Math.round((s.progress || 0) * 100);
  bar.setAttribute('aria-valuenow', String(v));
  bar.querySelector('.u3-bar__fill')?.style.setProperty('--u3-v', `${v}%`);
}

// The facts popover: it opens above the chip row before the device chip (the approved frames), inside the window.
function placePop() {
  const box = v3box(), pop = box?.querySelector('#u3RpDev'), dev = box?.querySelector('[data-rp-device]');
  if (!pop || !dev) return;
  const withEl = pop.parentElement, anchor = dev.previousElementSibling || dev;
  const gap = parseFloat(getComputedStyle(withEl).rowGap) || 0;
  pop.style.setProperty('--rp-pop-b', `${Math.round(withEl.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top + gap)}px`);
}
function setDevOpen(open) {
  state.devOpen = open;
  const box = v3box(), pop = box?.querySelector('#u3RpDev'), dev = box?.querySelector('[data-rp-device]');
  if (!pop || !dev) return;
  pop.hidden = !open;
  dev.setAttribute('aria-expanded', String(open));
  if (open) placePop();
}

/** Add one image: a slot that prepares (shrink and encode), then waits for Send. src = a File or a canvas. */
async function addShot(src, url = null) {
  if (state.shots.length >= maxShots()) return;
  const id = newShotId();
  state.error = '';
  shotEv({ type: 'add', id, src, url });
  paintShots();
  await prepare(id);
}
async function prepare(id, limit = maxBytes()) {
  const s = state.shots.find((x) => x.id === id);
  if (!s) return false;
  try {
    const out = await prepareShot(s.src, { maxBytes: limit, onProgress: (v) => { shotEv({ type: 'progress', id, value: v }); paintProgress(id); } });
    if (!state.shots.some((x) => x.id === id)) { URL.revokeObjectURL(out.url); return false; }   // removed while it was prepared
    freeUrl(state.shots.find((x) => x.id === id));
    shotEv({ type: 'ready', id, ...out });
    paintShots();
    return true;
  } catch {
    shotEv({ type: 'fail', id });
    state.error = SHOT_TEXT.failed;
    paintShots();
    return false;
  }
}

/** Upload one ready slot. A 413 with max_bytes: encode again under that limit, then one more try. */
async function uploadShot(id) {
  for (let tries = 0; tries < 2; tries += 1) {
    shotEv({ type: 'upload', id });
    paintShots();
    const s = state.shots.find((x) => x.id === id);
    if (!s || s.status !== 'uploading') return false;
    let res = { status: 0, body: null };
    try { res = await deps.upload(`/api/feedback/${encodeURIComponent(state.reportId)}/shot`, s.blob, s.mime, (v) => { shotEv({ type: 'progress', id, value: v }); paintProgress(id); }); } catch { /* failed below */ }
    const out = uploadOutcome(res.status, res.body);
    if (out === 'done') { shotEv({ type: 'done', id }); paintShots(); return true; }
    shotEv({ type: 'fail', id });
    if (out !== 'big' || tries) break;
    learnedMax = Number(res.body.max_bytes);
    shotEv({ type: 'reencode', id });              // failed upload -> preparing, under the limit the server told
    if (!(await prepare(id, learnedMax))) return false;
  }
  paintShots();
  return false;
}

async function sendV3() {
  if (!sendState({ text: state.text, sending: state.busy, shots: state.shots, min: MIN }).canSend) return;
  state.busy = true; state.error = ''; state.devOpen = false;
  paint();
  if (!state.reportId) {
    let r = null;
    try {
      r = await ctx().apiPost('/api/feedback', {
        kind: state.kind, body: state.text.trim(),
        context: { screen: screen(), version: version(), window: `${innerWidth}x${innerHeight}`, error: lastError, ...facts() },
      });
    } catch { r = null; }
    if (!r?.ok) { state.busy = false; state.error = errorText(r); paint(); return; }
    state.reportId = r.id;
  }
  for (const s of shotsToUpload(state.shots)) {
    if (s.status === 'failed') { shotEv({ type: 'retry', id: s.id }); }
    await uploadShot(s.id);
  }
  state.busy = false;
  if (state.shots.every((s) => s.status === 'done')) {
    state.sent = state.reportId; state.text = '';
    resetShots();
  } else state.error = SHOT_TEXT.failed;
  paint();
}

async function onCapture() {
  if (state.busy || state.shots.length >= maxShots()) return;
  const box = v3box();
  const id = newShotId();
  state.error = '';
  shotEv({ type: 'add', id, src: null });
  paintShots();
  try {
    const canvas = await captureView({ exclude: (n) => n === box || n.id === 'v2Report' });
    if (!state.shots.some((x) => x.id === id)) return;
    state.shots = state.shots.map((x) => (x.id === id ? { ...x, src: canvas } : x));
    await prepare(id);
  } catch {
    shotEv({ type: 'fail', id });
    state.error = SHOT_TEXT.failed;
    paintShots();
  }
}
function onFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > PICK_MAX_BYTES) { state.error = SHOT_TEXT.tooLarge; paintFoot(); return; }   // approval choice 6
  addShot(file, URL.createObjectURL(file));
}

function onV3Click(e) {
  const box = v3box();
  const t = e.target;
  if (t.closest('[data-rp-device]')) { setDevOpen(!state.devOpen); return; }
  const k = t.closest('[data-seg]');
  if (k) { if (state.reportId) return; state.kind = k.dataset.seg; state.error = ''; paint(); box.querySelector('#u3RpText')?.focus(); return; }
  if (t.closest('[data-rp-send]')) { sendV3(); return; }
  if (t.closest('[data-rp-capture]')) { onCapture(); return; }
  if (t.closest('[data-rp-pick]')) { box.querySelector('[data-rp-file]')?.click(); return; }
  const rm = t.closest('[data-rp-remove]');
  if (rm) { const s = state.shots.find((x) => x.id === rm.dataset.rpRemove); shotEv({ type: 'remove', id: rm.dataset.rpRemove }); if (!state.shots.includes(s)) freeUrl(s); state.error = ''; paintShots(); return; }
  const re = t.closest('[data-rp-retry]');
  if (re) {
    const s = state.shots.find((x) => x.id === re.dataset.rpRetry);
    if (!s || s.status !== 'failed') return;
    state.error = '';
    if (s.stage === 'upload') { sendV3(); return; }
    if (!s.src) { shotEv({ type: 'remove', id: s.id }); paintShots(); onCapture(); return; }   // a capture that failed: capture again
    shotEv({ type: 'retry', id: s.id }); paintShots(); prepare(s.id);
  }
}
function onV3Change(e) { if (e.target.matches?.('[data-rp-file]')) onFile(e.target); }
// A tap inside the window but outside the facts popover and its chip closes the popover (6.2).
function onV3Down(e) { if (state.devOpen && !e.target.closest('#u3RpDev, [data-rp-device]')) setDevOpen(false); }
function onV3Key(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (state.devOpen) { setDevOpen(false); v3box()?.querySelector('[data-rp-device]')?.focus(); return; }
  closeReport();
}

export function openReport() {
  const { el } = ctx();
  let box = el('v2Report');
  if (!box) {
    document.body.insertAdjacentHTML('beforeend', v3()
      ? '<div id="v2Report" class="u3-rp hidden" role="dialog" aria-modal="false" aria-labelledby="u3RpTitle"></div>'
      : '<div id="v2Report" class="v2-drop rp-drop hidden"></div>');
    box = el('v2Report');
    if (v3()) { box.addEventListener('click', onV3Click); box.addEventListener('change', onV3Change); box.addEventListener('pointerdown', onV3Down); }
  }
  if (!box.classList.contains('hidden')) { closeReport(); return; }
  state.sent = null; state.error = ''; state.devOpen = false;
  box.classList.remove('hidden');
  if (v3()) { document.getElementById('menuBtn')?.classList.add('is-open'); document.addEventListener('keydown', onV3Key); window.addEventListener('resize', onV3Resize); }
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
    window.removeEventListener('resize', onV3Resize);
    railObs?.disconnect();
    if (state.reportId && !state.busy) { resetShots(); state.text = ''; }   // the report is sent: the screenshots that did not upload end here
    state.devOpen = false;
    const menu = document.getElementById('menuBtn');
    menu?.classList.remove('is-open');
    if (box.contains(document.activeElement) || document.activeElement === document.body) menu?.focus();   // 6.2: back to the opener
  }
}
