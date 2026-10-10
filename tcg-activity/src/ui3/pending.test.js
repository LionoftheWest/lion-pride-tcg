// UI-25 Pending: the rules that can be checked without a browser. node --test
// D-30 (rows), D-32 (names, count), D-64 items 7 and 10 (Decline danger, Accept secondary), D-08 (no "…").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, offerKind, pendingLists, waiting, rowHTML, sectionsHTML, viewHTML, headHTML } from './pending.js';

const H = { thumb: (u) => `/t${u}`, avatar: (id) => `<i data-av="${id}"></i>` };
const card = (id, rarity = 'normal') => ({ id, name: `tst_card_${id}`, rarity, image_url: `/img/${id}.png` });
const offer = (id, status, request = card(2), extra = {}) => ({ id, status, from_id: 'tst_a_1', to_id: 'tst_b_1', from_name: 'tst_from', to_name: 'tst_to', offer: card(1), request, ...extra });

test('ago: just now, minutes, hours, days; no date gives an empty string', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  assert.equal(ago('2026-10-08T11:59:40Z', now), 'just now');
  assert.equal(ago('2026-10-08T11:55:00Z', now), '5m ago');
  assert.equal(ago('2026-10-08T09:00:00Z', now), '3h ago');
  assert.equal(ago('2026-10-07T12:00:00Z', now), '1d ago');
  assert.equal(ago(undefined, now), '');
});

test('offerKind: the same rules as the v2 Offers panel', () => {
  assert.equal(offerKind(offer(1, 'pending'), 'in'), 'accept');            // they offered and asked: I accept
  assert.equal(offerKind(offer(1, 'pending', null), 'in'), 'pick');        // they offered only: I pick my card
  assert.equal(offerKind(offer(1, 'countered'), 'in'), 'wait');            // I picked: I wait for them
  assert.equal(offerKind(offer(1, 'countered'), 'out'), 'accept');         // they picked: I accept
  assert.equal(offerKind(offer(1, 'pending'), 'out'), 'wait');
});

test('pendingLists: the offers that wait for me first; hidden ids (the undo window) leave; the count', () => {
  const offers = { incoming: [offer(1, 'countered'), offer(2, 'pending'), offer(3, 'pending')], outgoing: [offer(4, 'pending'), offer(5, 'countered')] };
  const l = pendingLists(offers, new Set([3]));
  assert.deepEqual(l.inc.map((o) => o.id), [2, 1]);
  assert.deepEqual(l.out.map((o) => o.id), [5, 4]);
  assert.equal(waiting(l), 2, 'one incoming that I answer + one sent that I accept');
  assert.equal(waiting(pendingLists({})), 0);
});

test('rowHTML: GET / GIVE, Accept secondary and Decline danger (D-64 item 10), no "…"; Sent has Cancel', () => {
  const inc = rowHTML(offer(7, 'pending'), 'in', H);
  assert.match(inc, /data-act="accept"[^>]*data-id="7"/);
  assert.match(inc, /u3-btn--secondary[^>]*data-act="accept"/);
  assert.match(inc, /u3-btn--danger[^>]*data-act="decline"/);
  assert.ok(!/u3-btn--primary/.test(inc), 'no gold button in a row (one primary button for each view, 5.3)');
  assert.ok(inc.indexOf('Get') < inc.indexOf('Give'), 'incoming: they give (Get) first');
  const out = rowHTML(offer(8, 'pending'), 'out', H);
  assert.match(out, /data-act="cancel"/);
  assert.ok(out.indexOf('Give') < out.indexOf('Get') || !out.includes('>Get<'), 'sent: I give first');
  assert.match(out, /Waiting/);
  assert.ok(!/…|\.\.\./.test(inc + out));
});

test('rowHTML: an incoming offer with no request asks me to pick my card; a countered one waits', () => {
  assert.match(rowHTML(offer(1, 'pending', null), 'in', H), /Pick your card/);
  const w = rowHTML(offer(1, 'countered'), 'in', H);
  assert.match(w, /Waiting/);
  assert.ok(!/data-act="accept"/.test(w));
  assert.match(w, /data-act="decline"/);
});

test('rowHTML: the member name is escaped and breaks at a break point (D-08)', () => {
  const h = rowHTML(offer(1, 'pending', card(2), { from_name: '<b>x</b>_a_very_long_name' }), 'in', H);
  assert.ok(!h.includes('<b>x</b>'));
  assert.match(h, /_<wbr>/);
});

test('sectionsHTML: counts, empty lines, a pager only when a section has more rows than it shows', () => {
  const lists = { inc: [offer(1, 'pending'), offer(2, 'pending')], out: [] };
  const h = sectionsHTML({ ...lists, perIn: 1, perOut: 0, pageIn: 0, pageOut: 0 }, H);
  assert.match(h, /No sent offers\./);
  assert.equal((h.match(/u3-pager"/g) || []).length, 1, 'one pager, in Incoming');
  assert.match(h, /1 \/ 2/);
  assert.equal((h.match(/class="u3-pd-row /g) || []).length, 1, 'one row on the page');
  const p2 = sectionsHTML({ ...lists, perIn: 1, perOut: 0, pageIn: 1, pageOut: 0 }, H);
  assert.match(p2, /data-oid="2"/);
  const all = sectionsHTML({ ...lists, perIn: 2, perOut: 0 }, H);
  assert.ok(!/u3-pager"/.test(all), 'every row fits: no pager');
  assert.match(sectionsHTML({ inc: [], out: [] }, H), /No incoming offers\./);
});

test('headHTML: the count shows only when an offer waits; the sheet has its own head', () => {
  assert.match(headHTML(2), /u3-counter/);
  assert.ok(!/u3-counter/.test(headHTML(0)));
  assert.equal(headHTML(3, true), '');
});

test('viewHTML: the Offer view has Decline and Accept (primary) for an incoming offer, Cancel for a sent one', () => {
  const v = viewHTML(offer(9, 'pending', card(2), { created_at: '2026-10-07T12:00:00Z' }), 'in', H);
  assert.match(v, /Trade offer/);
  assert.match(v, /u3-btn--danger[^>]*data-act="decline"/);
  assert.match(v, /u3-btn--primary[^>]*data-act="accept"/);
  assert.match(v, /Incoming/);
  const s = viewHTML(offer(9, 'pending'), 'out', H);
  assert.match(s, /data-act="cancel"/);
  assert.ok(!/data-act="accept"/.test(s));
});
