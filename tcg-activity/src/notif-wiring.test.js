// DB-MEM A3, review r1 L-1: the server.js calls that clear the cached bell count. node --test src/notif-wiring.test.js
// server.js starts the server on import, so this test reads its source: each call below must stay inside its function.
// A removal of any one of them makes this test fail (notif-routes.test.js proves what bustCount does).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// The text from `start` to the first `end` after it.
const block = (start, end) => {
  const i = SRC.indexOf(start);
  assert.ok(i >= 0, `server.js has ${start}`);
  const j = SRC.indexOf(end, i + start.length);
  assert.ok(j > i, `the end of ${start}`);
  return SRC.slice(i, j + end.length);
};
const calls = (text, call) => text.split(call).length - 1;

test('notify(): the member who gets a new note has the count dropped', () => {
  const b = block('async function notify(userId, kind, message) {', '\n}');
  assert.equal(calls(b, 'notifRoutes.bustCount(userId)'), 1);
});

test('bustUser(): also drops the count (packs, cards, trades)', () => {
  const b = block('function bustUser(userId) {', '}\n');
  assert.equal(calls(b, 'notifRoutes.bustCount(userId)'), 1);
});

test('POST /api/gifts/claim: drops the count after the claims AND on the error path (an earlier id may be claimed)', () => {
  const b = block("app.post('/api/gifts/claim'", '\n});');
  assert.equal(calls(b, 'notifRoutes.bustCount(me.id)'), 2);
  const err = b.slice(b.indexOf('if (error)'), b.indexOf('return res.status(500)', b.indexOf('if (error)')));
  assert.equal(calls(err, 'notifRoutes.bustCount(me.id)'), 1, 'the bust comes before the 500 answer');
  const tail = b.slice(b.indexOf('if (packs || cards) bustUser(me.id);'), b.indexOf('res.json({ ok: packs + cards + shards > 0'));
  assert.equal(calls(tail, 'notifRoutes.bustCount(me.id)'), 1, 'the bust comes before the answer, for every claim (also Shards only)');
});

test('the count routes come from notif-routes.js (no second copy in server.js)', () => {
  assert.equal(calls(SRC, "app.get('/api/notifications/count'"), 0);
  assert.equal(calls(SRC, "app.post('/api/notifications/read'"), 0);
  assert.equal(calls(SRC, 'registerNotifRoutes(app,'), 1);
});
