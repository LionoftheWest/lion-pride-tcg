import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_SPEED, finishButton, finishAnswer, finishNotice, waitMs, autoDisabled } from './dungeon-finish.js';

test('the speed: a finishing replay takes a third of a tapped round, a skip takes none', () => {
  assert.equal(FINISH_SPEED, 3);
  assert.equal(waitMs(750), 750);
  assert.equal(waitMs(750, { finishing: true }), 250);
  assert.equal(waitMs(480, { finishing: true }), 160);
  assert.equal(waitMs(750, { finishing: true, skip: true }), 0);
});
test('the button: idle, an action plays, a support picks, finishing, old server', () => {
  assert.deepEqual(finishButton({}), { hidden: false, skip: false, disabled: false, label: 'Finish Room' });
  assert.equal(finishButton({ busy: true }).disabled, true);
  assert.equal(finishButton({ picking: true }).disabled, true);
  const f = finishButton({ busy: true, finishing: true });   // finishing: busy is on, the button is Skip and pressable
  assert.deepEqual(f, { hidden: false, skip: true, disabled: false, label: 'Skip' });
  assert.equal(finishButton({ unavailable: true }).hidden, true);
});
test('Auto is greyed only while finishing', () => { assert.equal(autoDisabled(true), true); assert.equal(autoDisabled(false), false); });
test('the hint shows the round', () => { assert.equal(finishNotice(0), 'Finishing the room · Round 1'); assert.equal(finishNotice(2), 'Finishing the room · Round 3'); });
test('answer: won room, next step', () => {
  const a = finishAnswer({ ok: true, rounds: [{ atk: {} }, { atk: {} }], state: { phase: 'reward' }, status: 'active', ended: false, outcome: 'won' });
  assert.equal(a.kind, 'next'); assert.equal(a.outcome, 'won'); assert.equal(a.rounds.length, 2);
});
test('answer: lost room and the round limit end the run', () => {
  assert.equal(finishAnswer({ ok: true, rounds: [], state: { phase: 'over' }, status: 'over', ended: true, outcome: 'lost' }).kind, 'over');
  const l = finishAnswer({ ok: true, rounds: [], state: { phase: 'over' }, status: 'over', ended: true, outcome: 'limit' });
  assert.equal(l.kind, 'over'); assert.equal(l.outcome, 'limit');
});
test('answer: stopped inside the fight (a refused action) keeps the fight', () => {
  const a = finishAnswer({ ok: true, rounds: [{}], state: { phase: 'fight' }, status: 'active', outcome: null, error: { message: 'No' } });
  assert.equal(a.kind, 'fight'); assert.equal(a.message, 'No');
});
test('answer: old server 404 finish_unavailable, other errors, no answer', () => {
  assert.equal(finishAnswer({ ok: false, error: 'finish_unavailable', message: 'Finish room is not available.' }).kind, 'unavailable');
  const e = finishAnswer({ ok: false, error: 'not_fighting', message: 'Not in a fight.' });
  assert.equal(e.kind, 'error'); assert.equal(e.message, 'Not in a fight.');
  assert.equal(finishAnswer(null).kind, 'error');
});
