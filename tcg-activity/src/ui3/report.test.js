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

test('UI-40 errors: the standard text above Send, the limit and short answers keep their text', () => {
  assert.equal(ERROR_TEXT, 'Something went wrong. Try again.');
  assert.equal(errorText({ ok: true }), null);
  assert.equal(errorText(null), ERROR_TEXT);
  assert.equal(errorText({ error: 'x' }), ERROR_TEXT);
  assert.equal(errorText({ error: 'limit', limit: 3 }), 'You can send 3 reports a day.');
  assert.equal(errorText({ error: 'short' }), 'Write a little more.');
  const h = reportHTML({ ...S, text: 'hello there', error: ERROR_TEXT });
  assert.match(text(h), /Version abc123 Oct 4 · 3:56 PM MDT Something went wrong\. Try again\. Send$/);
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
