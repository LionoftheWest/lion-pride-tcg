// UI-40 the Feedback window (v3): the approved strings, the Send rules, the error texts, the scroll cue. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportHTML, footHTML, canSend, errorText, thumbMetrics, MIN, MAX, ERROR_TEXT, REASON } from './report.js';

const text = (h) => h.replace(/&amp;/g, '&').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const S = { kind: 'bug', text: '', sent: null, error: '', busy: false, screen: 'Home screen', version: 'abc123', when: 'Oct 4 · 3:56 PM MDT' };

test('UI-40 title "Feedback", the three kinds, the placeholder per kind, the facts sent with it', () => {
  const t = text(reportHTML(S));
  assert.match(t, /^Feedback Bug Feedback Idea /);
  assert.match(t, /Sent with it Home screen Version abc123 Oct 4 · 3:56 PM MDT/);
  assert.match(reportHTML(S), /placeholder="What happened\?"/);
  assert.match(reportHTML({ ...S, kind: 'feedback' }), /placeholder="What do you think\?"/);
  assert.match(reportHTML({ ...S, kind: 'idea' }), /placeholder="What is your idea\?"/);
});

test('UI-40 one kind is active; the text box is the named scroll area with the message limit and a rail', () => {
  const h = reportHTML({ ...S, kind: 'idea' });
  assert.equal(h.split('aria-selected="true"').length - 1, 1);
  assert.match(h, /data-seg="idea"[^>]*>/);
  assert.match(h, /data-scroll-area="report text"/);
  assert.match(h, new RegExp(`maxlength="${MAX}"`));
  assert.match(h, /u3-rp__rail/);
});

test('UI-40 Send: greyed with the reason under MIN characters (spaces do not count), busy while it sends', () => {
  assert.equal(MIN, 5);
  assert.equal(canSend('    a  '), false);
  assert.equal(canSend('hello'), true);
  assert.equal(canSend('hello', true), false);
  const grey = footHTML({ text: 'hi' });
  assert.match(grey, /disabled/);
  assert.match(text(grey), new RegExp(`Send ${REASON}$`));
  const on = footHTML({ text: 'hello there' });
  assert.doesNotMatch(on, /disabled/);
  assert.doesNotMatch(text(on), /Type a message first/);
  const busy = footHTML({ text: 'hello there', busy: true });
  assert.match(busy, /aria-busy="true"/);
  assert.doesNotMatch(text(busy), /Type a message first/);
});

test('UI-40 errors: the standard text in the line under Send (review-2 change 7), the limit and short answers keep their text', () => {
  assert.equal(ERROR_TEXT, 'Something went wrong. Try again.');
  assert.equal(errorText({ ok: true }), null);
  assert.equal(errorText(null), ERROR_TEXT);
  assert.equal(errorText({ error: 'x' }), ERROR_TEXT);
  assert.equal(errorText({ error: 'limit', limit: 3 }), 'You can send 3 reports a day.');
  assert.equal(errorText({ error: 'short' }), 'Write a little more.');
  const h = reportHTML({ ...S, text: 'hello there', error: ERROR_TEXT });
  assert.match(text(h), /Version abc123 Oct 4 · 3:56 PM MDT Send Something went wrong\. Try again\.$/);
  assert.match(h, /role="alert"/);
});

test('UI-40 the thanks view after a send: the report number, no text box', () => {
  const h = reportHTML({ ...S, sent: 12 });
  assert.match(text(h), /Thanks! Report #12 sent$/);
  assert.doesNotMatch(h, /textarea/);
});

test('UI-40 the report text is escaped', () => {
  const h = reportHTML({ ...S, text: '<img src=x onerror=1>', screen: '<b>x</b>' });
  assert.doesNotMatch(h, /<img|<b>x/);
});

test('UI-40 scroll cue: hidden when the text fits; the thumb is the visible share', () => {
  assert.equal(thumbMetrics({ scrollTop: 0, clientHeight: 120, scrollHeight: 120 }).show, false);
  const m = thumbMetrics({ scrollTop: 0, clientHeight: 100, scrollHeight: 400 });
  assert.deepEqual([m.show, m.top, m.height], [true, 0, 25]);
});

// ---- review-2 (approval 2026-10-11): the device chip and the screenshots ----
const F = { app: 'Mobile app', device: 'Phone', os: 'iOS 18', engine: 'WebKit', layout: 'compact portrait', dpr: '3x' };
const R2 = { ...S, text: 'The pack chooser covers the dock.', facts: F, shots: [] };

test('UI-40 r2 the device chip is the 4th fact and a control; the popover is closed until a tap', () => {
  const h = reportHTML(R2);
  assert.match(text(h), /Sent with it Home screen Version abc123 Oct 4 · 3:56 PM MDT iPhone · Discord app /);
  assert.match(h, /<button[^>]*u3-rp__dev[^>]*aria-expanded="false"[^>]*aria-controls="u3RpDev"/);
  assert.match(h, /id="u3RpDev"[^>]*hidden/);
  const open = reportHTML({ ...R2, devOpen: true });
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(open, /id="u3RpDev"[^>]*hidden/);
  assert.match(text(open), /Device Discord app Mobile app Device Phone System iOS 18 Browser engine WebKit Layout Compact · portrait Pixel ratio 3/);
  assert.doesNotMatch(reportHTML({ ...R2, facts: {} }), /u3-rp__dev/, 'no facts: no chip');
});

test('UI-40 r2 Screenshots: the privacy line, the count, both buttons and 3 slots that are always shown', () => {
  const h = reportHTML(R2);
  assert.match(text(h), /Screenshots are only seen by the team 0 \/ 3 Add this screen Upload an image Send$/);
  assert.equal(h.split('class="u3-rp__slot"').length - 1, 3, 'three empty slots');
  assert.match(h, /aria-label="Add a picture of this screen"/);
  assert.match(h, /type="file" accept="image\/\*" hidden/);
  const two = reportHTML({ ...R2, shots: [{ id: 'a', status: 'ready', url: 'blob:a' }, { id: 'b', status: 'ready', url: 'blob:b' }] });
  assert.equal(two.split('data-slot=').length - 1, 3);
  assert.match(text(two), /2 \/ 3/);
  assert.equal(two.split('aria-label="Remove screenshot"').length - 1, 2);
});

test('UI-40 r2 the limit: 3 / 3 · Limit in the danger color, both buttons grey', () => {
  const three = ['a', 'b', 'c'].map((id) => ({ id, status: 'ready', url: `blob:${id}` }));
  const h = reportHTML({ ...R2, shots: three });
  assert.match(h, /u3-rp__count is-limit">3 \/ 3 · Limit/);
  assert.match(h, /<button[^>]*disabled[^>]*data-rp-capture/);
  assert.match(h, /<button[^>]*disabled[^>]*data-rp-pick/);
  assert.doesNotMatch(reportHTML(R2), /disabled[^>]*data-rp-(capture|pick)/);
});

test('UI-40 r2 uploading: the picture with a progress bar, Send grey with "Wait for the upload to finish"', () => {
  const h = reportHTML({ ...R2, shots: [{ id: 'a', status: 'ready', url: 'blob:a' }, { id: 'b', status: 'uploading', progress: 0.5, url: 'blob:b' }] });
  assert.match(h, /is-uploading[^"]*" data-slot="1"[^>]*><img[^>]*><div class="u3-bar u3-bar--sm" role="progressbar"[^>]*aria-valuenow="50"/);
  assert.match(h, /<button[^>]*disabled[^>]*data-rp-send/);
  assert.match(text(h), /Send Wait for the upload to finish$/);
  assert.doesNotMatch(h.slice(h.indexOf('data-slot="1"'), h.indexOf('data-slot="2"')), /Remove screenshot/, 'no remove while it uploads');
});

test('UI-40 r2 a failed upload: the danger edge, Try again and remove on the slot, the error in the line under Send', () => {
  const h = reportHTML({ ...R2, error: 'The screenshot did not upload. Try again.', shots: [{ id: 'a', status: 'failed', stage: 'upload', url: 'blob:a' }] });
  assert.match(h, /u3-rp__slot is-failed/);
  assert.match(h, /aria-label="Try again"[^>]*data-rp-retry="a"/);
  assert.match(h, /aria-label="Remove screenshot"[^>]*data-rp-remove="a"/);
  assert.match(text(h), /Send The screenshot did not upload\. Try again\.$/);
  assert.doesNotMatch(h, /<button[^>]*disabled[^>]*data-rp-send/);
});

test('UI-40 r2 the message line is always there (nothing moves): empty, reason or error', () => {
  for (const s of [R2, { ...R2, text: '' }, { ...R2, error: 'x' }]) assert.equal(footHTML(s).split('u3-rp__line').length - 1, 1);
  assert.match(footHTML(R2), /aria-hidden="true"><\/p>$/);
});

test('UI-40 r2 after the report is sent and an image waits: the text is read-only', () => {
  assert.match(reportHTML({ ...R2, locked: true }), /<textarea[^>]*readonly/);
  assert.doesNotMatch(reportHTML(R2), /readonly/);
});

test('UI-40 r2 the v2-style state without facts and shots paints no review-2 block (the old callers keep working)', () => {
  const h = reportHTML(S);
  assert.doesNotMatch(h, /u3-rp__shots|u3-rp__dev/);
});
