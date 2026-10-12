// UI-40 the Feedback window, v3 (lion-pride-tcg-design UI-40/approved, review-1; FEEDBACK D-80 items 6 and 18: the window title is
// "Feedback", a greyed Send states "Type a message first"). Only under body.ui-v3: ui-v2-report.js paints this HTML in place of its
// v2 markup and keeps all of its logic (the kinds, the text, POST /api/feedback, the 3 a day limit). With the flag off nothing here runs.
// - The window is a bottom sheet on the dock edge on compact-port and a panel under the top bar on medium and expanded
//   (ui3/90-ui-40.css), out of the Discord corner zone.
// - The text box is the named scroll area "report text" (3.3, D-07) with a scroll cue, only when the text does not fit.
// Review-2 (approval 2026-10-11, the 7 choices as recommended): the device chip in "Sent with it" opens the 6 facts; the
// Screenshots block (only seen by the team) with "Add this screen", "Upload an image" and 3 fixed slots; one fixed message
// line under Send for the reason or any error, so nothing moves (3.3). The rules of the slots are in report-shots.js.
import { esc, iconButton, button, segmented, textarea, progressLinear } from './components.js';
import { SHOT_TEXT, SLOTS, countText, sendState, deviceChip, factRows } from './report-shots.js';
import { icon } from './icons.js';
import { thumbMetrics } from './help.js';

export { thumbMetrics };
export const MIN = 5, MAX = 1500;   // the server rules (reports.js): a report is 5 to 1500 characters
export const KINDS = [['bug', 'Bug', 'bug'], ['feedback', 'Feedback', 'message-square'], ['idea', 'Idea', 'lightbulb']];
export const PLACEHOLDER = { bug: 'What happened?', feedback: 'What do you think?', idea: 'What is your idea?' };
export const REASON = 'Type a message first';
export const ERROR_TEXT = 'Something went wrong. Try again.';   // the standard error text (7.2)

/** Can this text be sent now? */
export const canSend = (text, busy = false) => !busy && String(text ?? '').trim().length >= MIN;

/** The error line for a server answer (null = no error). The limit and the short answers keep their v2 meaning. */
export function errorText(r) {
  if (r?.ok) return null;
  if (r?.error === 'limit') return `You can send ${r.limit || 3} reports a day.`;
  if (r?.error === 'short') return 'Write a little more.';
  return ERROR_TEXT;
}

const fact = (ic, text) => `<span class="u3-chip u3-chip--status u3-chip--md u3-rp__fact">${icon(ic)}<span>${esc(text)}</span></span>`;

/** The Send row: the primary button and ONE fixed message line under it (review-2 change 7). The line holds the reason of a
 *  greyed Send ("Type a message first", "Wait for the upload to finish") or an error (the send error, an image error). */
export function footHTML({ text = '', busy = false, error = '', shots = [] }) {
  const { canSend: ok, line } = sendState({ text, sending: busy, shots, error, min: MIN });
  const msg = line?.kind === 'error'
    ? `<p class="u3-msg u3-msg--error u3-rp__line" role="alert">${icon('circle-alert')}<span>${esc(line.text)}</span></p>`
    : `<p class="u3-reason u3-rp__line"${line ? '' : ' aria-hidden="true"'}>${line ? esc(line.text) : ''}</p>`;
  return button({ label: 'Send', variant: 'primary', icon: 'send', disabled: !ok && !busy, busy, busyLabel: 'Sending', data: { 'rp-send': '1' } }) + msg;
}

/** The device chip: the one fact that is a control (review-2 change 2): a strong edge and an info icon; a tap opens the facts. */
export function deviceChipHTML(facts, open = false) {
  const { icon: ic, label } = deviceChip(facts);
  if (!label) return '';
  return `<button type="button" class="u3-chip u3-chip--status u3-chip--md u3-rp__fact u3-rp__dev" data-rp-device="1" aria-expanded="${open}" aria-controls="u3RpDev" aria-label="${esc(label)}, device facts">`
    + `${icon(ic)}<span>${esc(label)}</span>${icon('info', { size: 'sm' })}</button>`;
}

/** The Info popover with the 6 facts (5.2 Info popover; a tap opens it; Escape, a tap outside and a second tap close it). */
export function devicePopHTML(facts, open = false) {
  const rows = factRows(facts);
  if (!rows.length) return '';
  return `<div class="u3-rp__pop" id="u3RpDev" role="dialog" aria-label="Device"${open ? '' : ' hidden'}><span class="u3-label">Device</span>`
    + `<dl class="u3-rp__rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`;
}

/** One fixed slot: empty, a picture, working (the picture at 40% with Progress/linear at its foot), failed (a danger edge
 *  and Try again on the picture). The remove control is on every slot that is not working and not stored yet. */
function slotHTML(s, i) {
  if (!s) return `<div class="u3-rp__slot" data-slot="${i}" role="img" aria-label="${esc(SHOT_TEXT.empty)}">${icon('image', { size: 'lg' })}</div>`;
  const working = s.status === 'preparing' || s.status === 'uploading';
  const pic = s.url ? `<img class="u3-rp__pic" src="${esc(s.url)}" alt="Screenshot ${i + 1}">` : '';
  const bar = working ? progressLinear({ value: s.progress || 0, label: 'Upload' }) : '';
  const retry = s.status === 'failed' ? iconButton({ icon: 'rotate-ccw', label: SHOT_TEXT.retry, size: 'sm', data: { 'rp-retry': s.id } }) : '';
  const remove = working || s.status === 'done' ? '' : iconButton({ icon: 'x', label: SHOT_TEXT.remove, size: 'sm', data: { 'rp-remove': s.id } });
  return `<div class="u3-rp__slot is-${s.status}" data-slot="${i}" data-shot="${esc(s.id)}">${pic}${bar}${retry}${remove}</div>`;
}

/** The Screenshots block (review-2 change 3): the privacy line and the count, the two buttons, the fixed slots. Its height
 *  is the same in every state. At the limit both buttons are grey and the count says "Limit" (change 5). */
export function shotsHTML({ shots = [], max = SLOTS, sending = false }) {
  const full = shots.length >= max;
  const off = full || sending;
  const add = button({ label: SHOT_TEXT.add, icon: 'camera', disabled: off, data: { 'rp-capture': '1' } }).replace('<button', `<button aria-label="${esc(SHOT_TEXT.addLabel)}"`);
  return `<div class="u3-rp__shots"><div class="u3-rp__shead"><span>${esc(SHOT_TEXT.privacy)}</span><span class="u3-rp__count${full ? ' is-limit' : ''}">${esc(countText(shots, max))}</span></div>`
    + `<div class="u3-rp__sbtns">${add}${button({ label: SHOT_TEXT.upload, icon: 'image-up', disabled: off, data: { 'rp-pick': '1' } })}</div>`
    + `<div class="u3-rp__slots">${Array.from({ length: max }, (_, i) => slotHTML(shots[i], i)).join('')}</div>`
    + '<input type="file" accept="image/*" hidden data-rp-file="1" tabindex="-1" aria-hidden="true"></div>';
}

/** The window's inside. s = { kind, text, sent (the report number after a send), error, busy, screen, version, when,
 *  facts (src/device-facts.js), devOpen (the facts popover), shots (report-shots.js), max (the slots), locked (the report is
 *  sent and only screenshots wait: the text is read-only) }. */
export function reportHTML(s) {
  const head = `<header class="u3-rp__head"><h2 class="u3-rp__title" id="u3RpTitle">Feedback</h2>${iconButton({ icon: 'x', label: 'Close', data: { 'rp-close': '1' } })}</header>`;
  if (s.sent) {
    return `${head}<div class="u3-rp__done" role="status">${icon('circle-check', { size: '2xl' })}<b class="u3-rp__thanks">Thanks!</b><span>Report #${esc(s.sent)} sent</span></div>`;
  }
  const kinds = segmented(KINDS.map(([k, label, ic]) => ({ id: k, label, icon: ic, active: s.kind === k })), { label: 'Kind of report' });
  const box = `<div class="u3-rp__area">${textarea({ value: s.text, placeholder: PLACEHOLDER[s.kind], label: 'Your message' }).replace('<textarea', `<textarea maxlength="${MAX}" data-scroll-area="report text" id="u3RpText"${s.locked ? ' readonly' : ''}`)}`
    + `<span class="u3-rp__rail" aria-hidden="true" hidden><span class="u3-rp__thumb"></span></span></div>`;
  const facts = `<div class="u3-rp__with"><span class="u3-label">Sent with it</span><div class="u3-rp__facts">${fact('monitor', s.screen)}${fact('git-commit-horizontal', `Version ${s.version}`)}${fact('clock', s.when)}${s.facts ? deviceChipHTML(s.facts, !!s.devOpen) : ''}</div>`
    + `${s.facts ? devicePopHTML(s.facts, !!s.devOpen) : ''}</div>`;
  const shots = s.shots ? shotsHTML({ shots: s.shots, max: s.max || SLOTS, sending: s.busy }) : '';
  return `${head}${kinds}${box}${facts}${shots}<div class="u3-rp__foot" id="u3RpFoot">${footHTML(s)}</div>`;
}

/** Put the rail of the area in line with its text box. Called on scroll, on input and after every repaint. */
export function syncRail(area) {
  const box = area?.querySelector('.u3-textarea'), rail = area?.querySelector('.u3-rp__rail');
  if (!box || !rail) return;
  const m = thumbMetrics(box);
  rail.hidden = !m.show;
  rail.style.setProperty('--rp-thumb-top', `${m.top}%`);
  rail.style.setProperty('--rp-thumb-h', `${m.height}%`);
}
