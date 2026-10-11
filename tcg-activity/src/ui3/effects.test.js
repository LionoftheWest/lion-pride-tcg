// UI-28 the play flow: the rules and the HTML of the confirm window, the popups and the banners. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerBlocked, ownerBlockText, pollQuestions, playResultText, refundText, bannerOf, confirmHTML, noticeHTML, bannerHTML, todayHTML, OWNER_FORBIDDEN, BANNERS_MAX } from './effects.js';
import { OWNER_FORBIDDEN as SERVER_LIST } from '../../effects.js';

test('the owner list is the list of the server (a card the server refuses must be blocked before the play)', () => {
  assert.deepEqual([...OWNER_FORBIDDEN].sort(), [...SERVER_LIST].sort());
});

test('ownerBlocked: only a forbidden effect on a member of the immune list (ids as strings or numbers)', () => {
  assert.equal(ownerBlocked('nickname', 'tst_o', ['tst_o']), true);
  assert.equal(ownerBlocked('nickname', 'tst_x', ['tst_o']), false);
  assert.equal(ownerBlocked('confetti', 'tst_o', ['tst_o']), false, 'an effect Discord permits is never blocked');
  assert.equal(ownerBlocked('timeout', 7, ['7']), true);
  assert.equal(ownerBlocked('timeout', 'tst_o', undefined), false);
});

test('ownerBlockText: the words of the approved frame, no member name, "time out" for a timeout', () => {
  assert.equal(ownerBlockText('nickname'), 'Discord does not let anyone rename the server owner, so this card cannot be played.');
  assert.match(ownerBlockText('timeout'), /time out the server owner/);
});

test('pollQuestions: every preset question with the member name filled in, the index kept', () => {
  const effect = { options: { polls: [{ question: 'Should we recount {name}\'s votes?', answers: ['a'] }, { question: 'Who is {name}?', answers: ['b'] }] } };
  assert.deepEqual(pollQuestions(effect, 'tst_hera'), [{ i: 0, text: "Should we recount tst_hera's votes?" }, { i: 1, text: 'Who is tst_hera?' }]);
  assert.deepEqual(pollQuestions({ options: {} }, 'x'), []);
  assert.deepEqual(pollQuestions(null, 'x'), []);
});

test('playResultText: one line for each outcome of play_card_effect', () => {
  assert.equal(playResultText({ ok: true, outcome: 'applied' }, 'Hera'), 'Played on Hera.');
  assert.match(playResultText({ ok: true }, 'Hera', null, true), /waits until they join voice/);
  assert.equal(playResultText({ outcome: 'blocked' }, 'Hera'), "Hera's ward blocked it.");
  assert.equal(playResultText({ outcome: 'reflected' }, 'Hera'), 'It bounced back to you!');
  assert.equal(playResultText({ outcome: 'decoyed' }, 'Hera'), "Hera's decoy took the hit.");
  assert.equal(playResultText({ outcome: 'redirected' }, 'Hera', 'Otto'), 'It was redirected to Otto.');
  assert.equal(playResultText({ outcome: 'redirected' }, 'Hera'), 'It was redirected to another member.');
  assert.equal(playResultText({ outcome: 'delayed' }, 'Hera'), 'It lands on Hera in 1 hour.');
});

test('refundText: the frame text, "time out" for a member the bot cannot time out', () => {
  const t = refundText({ reason: 'not_manageable', target: 'tst_a', card: { name: 'King of the Swamp' } });
  assert.equal(t, 'Discord did not let the bot rename tst_a, so your King of the Swamp did nothing. The play is refunded: the card is ready again, and it does not count today.');
  assert.match(refundText({ reason: 'not_moderatable', target: 'b', card: null }), /time out b, so your card did nothing/);
});

test('bannerOf: the three lines of each incoming play', () => {
  const p = { sender: 'tst_a', card: { name: 'Beetle' }, kind: 'prank', outcome: 'applied' };
  assert.deepEqual(bannerOf(p), { kind: 'prank', icon: 'drama', who: 'tst_a played', card: 'Beetle', tail: 'on you!' });
  assert.equal(bannerOf({ ...p, kind: 'boon' }).kind, 'boon');
  assert.equal(bannerOf({ ...p, kind: 'neutral' }).kind, 'boon', 'a shield uses the boon edge (the library has two banners)');
  assert.equal(bannerOf({ ...p, outcome: 'decoyed' }).tail, 'on you. Your cardboard cutout took it!');
  assert.equal(bannerOf({ ...p, outcome: 'blocked' }).who, 'tst_a tried');
  assert.equal(bannerOf({ ...p, outcome: 'reflected' }).who, 'Your');
  assert.equal(bannerOf({ ...p, outcome: 'delayed' }).tail, 'on you. It lands in 1 hour.');
  assert.equal(bannerOf({}).who, 'Someone played');
  assert.ok(BANNERS_MAX >= 3, 'the approved frames show three banners');
});

const view = { kind: 'prank', title: 'Recount', desc: 'The bot posts a poll.', imgSrc: '/x.webp', rarity: 'normal', chips: [{ icon: 'timer', text: '1h' }],
  whoHTML: '<span class="w">tst_hera</span>', toName: 'tst_hera', active: [], polls: [{ i: 0, text: 'Q one?' }, { i: 1, text: 'Q two?' }], used: 1, cap: 10 };

test('confirmHTML: kind chip, title, To, On, Plays today, Back left and the play button right', () => {
  const h = confirmHTML(view);
  assert.match(h, /u3-fxw--prank/);
  assert.match(h, /u3-chip--effect[^"]*u3-fx-prank/);
  assert.match(h, /<h2[^>]*>Recount<\/h2>/);
  assert.match(h, /On tst_hera/);
  assert.match(h, /Nothing active/);
  assert.match(h, /1\/10/);
  assert.ok(h.indexOf('data-fxback') < h.indexOf('data-fxplay'), 'Back is left of the play button');
  assert.match(h, /Play prank/);
  assert.match(confirmHTML({ ...view, kind: 'boon', polls: [] }), /Play boon/);
  assert.match(confirmHTML({ ...view, kind: 'shield', polls: [] }), /u3-btn--shield/);
  assert.match(confirmHTML({ ...view, kind: 'neutral', polls: [] }), /Play shield/, 'an unknown kind is a shield');
});

test('confirmHTML: a poll card plays only after a question is picked, and the pick has aria-checked', () => {
  assert.match(confirmHTML(view), /<button[^>]*disabled[^>]*data-fxplay|data-fxplay[^>]*disabled/);
  const picked = confirmHTML({ ...view, choice: 1 });
  assert.doesNotMatch(picked, /<button[^>]*\sdisabled[^>]*data-fxplay/);
  assert.match(picked, /aria-checked="true" data-fxq="1"/);
  assert.match(picked, /aria-checked="false" data-fxq="0"/);
  assert.match(picked, /Q two\?/);
});

test('confirmHTML: the error line shows above the buttons, the active effects are listed, names are escaped', () => {
  const h = confirmHTML({ ...view, polls: [], msg: 'That did not work. Try again.', active: ['Lucky Pull'], title: '<b>x</b>' });
  assert.match(h, /u3-msg--error/);
  assert.ok(h.indexOf('u3-msg--error') < h.indexOf('data-fxback'));
  assert.match(h, /Lucky Pull/);
  assert.doesNotMatch(h, /<b>x<\/b>/);
  assert.match(confirmHTML({ ...view, polls: [], busy: true }), /aria-busy="true"/);
});

test('todayHTML: nothing without a cap, the full state at the cap', () => {
  assert.equal(todayHTML(1, 0), '');
  assert.match(todayHTML(10, 10), /is-full/);
  assert.match(todayHTML(2, 10), /2\/10/);
});

test('noticeHTML: the owner and refund dialogs have a title, one line and OK', () => {
  const h = noticeHTML({ title: 'This card cannot be played', line: ownerBlockText('nickname') });
  assert.match(h, /role="dialog"/);
  assert.match(h, /This card cannot be played/);
  assert.match(h, /data-fxok/);
});

test('bannerHTML: the library banner with a close button labelled for a screen reader', () => {
  const h = bannerHTML({ ...bannerOf({ sender: 'a', card: { name: 'C' }, kind: 'prank' }), imgSrc: '/c.webp' }, { id: 'b1' });
  assert.match(h, /u3-banner--prank/);
  assert.match(h, /data-fxb="b1"/);
  assert.match(h, /aria-label="Close"/);
  assert.match(h, /on you!/);
});
