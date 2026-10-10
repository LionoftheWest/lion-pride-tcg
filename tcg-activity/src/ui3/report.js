// UI-40 the Feedback window, v3 (lion-pride-tcg-design UI-40/approved, review-1; FEEDBACK D-80 items 6 and 18: the window title is
// "Feedback", a greyed Send states "Type a message first"). Only under body.ui-v3: ui-v2-report.js paints this HTML in place of its
// v2 markup and keeps all of its logic (the kinds, the text, POST /api/feedback, the 3 a day limit). With the flag off nothing here runs.
// - The window is a bottom sheet on the dock edge on compact-port and a panel under the top bar on medium and expanded
//   (ui3/90-ui-40.css), out of the Discord corner zone.
// - The text box is the named scroll area "report text" (3.3, D-07) with a scroll cue, only when the text does not fit.
import { esc, iconButton, button, segmented, textarea, inlineMessage } from './components.js';
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

/** The Send row: the primary button, greyed with its reason while the text is too short, busy while it sends. */
export function footHTML({ text = '', busy = false, error = '' }) {
  const ok = canSend(text, busy);
  return `${error ? inlineMessage({ kind: 'error', text: error }) : ''}`
    + button({ label: 'Send', variant: 'primary', icon: 'send', disabled: !ok && !busy, busy, busyLabel: 'Sending', reason: !ok && !busy ? REASON : null, data: { 'rp-send': '1' } });
}

/** The window's inside. s = { kind, text, sent (the report number after a send), error, busy, screen, version, when }. */
export function reportHTML(s) {
  const head = `<header class="u3-rp__head"><h2 class="u3-rp__title" id="u3RpTitle">Feedback</h2>${iconButton({ icon: 'x', label: 'Close', data: { 'rp-close': '1' } })}</header>`;
  if (s.sent) {
    return `${head}<div class="u3-rp__done" role="status">${icon('circle-check', { size: '2xl' })}<b class="u3-rp__thanks">Thanks!</b><span>Report #${esc(s.sent)} sent</span></div>`;
  }
  const kinds = segmented(KINDS.map(([k, label, ic]) => ({ id: k, label, icon: ic, active: s.kind === k })), { label: 'Kind of report' });
  const box = `<div class="u3-rp__area">${textarea({ value: s.text, placeholder: PLACEHOLDER[s.kind], label: 'Your message' }).replace('<textarea', `<textarea maxlength="${MAX}" data-scroll-area="report text" id="u3RpText"`)}`
    + `<span class="u3-rp__rail" aria-hidden="true" hidden><span class="u3-rp__thumb"></span></span></div>`;
  const facts = `<div class="u3-rp__with"><span class="u3-label">Sent with it</span><div class="u3-rp__facts">${fact('monitor', s.screen)}${fact('git-commit-horizontal', `Version ${s.version}`)}${fact('clock', s.when)}</div></div>`;
  return `${head}${kinds}${box}${facts}<div class="u3-rp__foot" id="u3RpFoot">${footHTML(s)}</div>`;
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
