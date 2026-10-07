// The Issue text for a player report must never ping, carry HTML, or name the member.
// node --test reports.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { issueFor, cleanContext, reportTarget } from './reports.js';

const row = { id: 12, kind: 'bug', body: 'The pack froze @everyone <img src=x>\nsecond line', context: { screen: 'home', version: 'abc1234', window: '1288x594', error: 'TypeError: x | y' }, created_at: '2026-10-01T15:14:00Z', player_id: '999999999999999999' };

test('the title is [Kind] + the first line, the labels are player-report + the kind', () => {
  const i = issueFor(row);
  assert.match(i.title, /^\[Bug\] The pack froze /);
  assert.deepEqual(i.labels, ['player-report', 'bug']);
});

test('no "@" can ping anyone (title and body), and "<" cannot carry HTML', () => {
  const i = issueFor(row);
  for (const s of [i.title, i.body]) {
    assert.doesNotMatch(s, /@(?!\u200b)/, 'every @ is broken by a zero-width space');
    assert.doesNotMatch(s, /<img/);
  }
});

test('the member is never named: no id, no name, only "a member (report #12)"', () => {
  const i = issueFor(row);
  assert.doesNotMatch(i.title + i.body, /999999999999999999/);
  assert.match(i.body, /by a member \(report #12\)\./);
});

test('the report is quoted line by line, the context is a table, a "|" cannot break it', () => {
  const i = issueFor(row);
  assert.match(i.body, /^> The pack froze/m);
  assert.match(i.body, /^> second line$/m);
  assert.match(i.body, /\| Screen \| home \|/);
  assert.match(i.body, /\| Sent \| Oct 1, 2026, 9:14 AM MT \|/);
  assert.match(i.body, /\| Last error \| TypeError: x y \|/);
});

test('a long first line is cut at 70 characters', () => {
  const i = issueFor({ ...row, body: 'x'.repeat(200) });
  assert.equal(i.title, `[Bug] ${'x'.repeat(69)}…`);
});

test('the client context keeps 4 short strings and drops everything else', () => {
  assert.deepEqual(cleanContext({ screen: 'home', version: 'v', window: '1x1', error: 'e', token: 'secret', screen2: 'x' }), { screen: 'home', version: 'v', window: '1x1', error: 'e' });
  assert.equal(cleanContext({ error: 'e'.repeat(999) }).error.length, 300);
  assert.deepEqual(cleanContext(null), {});
  assert.deepEqual(cleanContext('junk'), {});
});

// A fake supabase query builder: records the updates, returns the given rows.
function fakeDb(rows) {
  const updates = [];
  const q = { select: () => q, is: () => q, lt: () => q, order: () => q, limit: async () => ({ data: rows }) };
  return { updates, from: () => ({ ...q, update: (v) => ({ eq: async (_c, id) => { updates.push({ id, ...v }); return {}; } }) }) };
}
const waiting = [{ id: 7, kind: 'idea', body: 'More bosses', context: {}, created_at: '2026-10-01T15:00:00Z', attempts: 0 }];

test('sync: a created Issue stores its number, its url and the sync time', async () => {
  const { syncOnce } = await import('./reports.js');
  const db = fakeDb(waiting); const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url, o }); return { ok: true, json: async () => ({ number: 41, html_url: 'https://github.com/x/y/issues/41' }) }; };
  assert.equal(await syncOnce(db, { token: 't', repo: 'x/y', fetchImpl }), 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/x/y/issues');
  assert.equal(calls[0].o.headers.authorization, 'Bearer t');
  assert.deepEqual(JSON.parse(calls[0].o.body).labels, ['player-report', 'idea']);
  assert.equal(db.updates[0].issue_number, 41);
  assert.ok(db.updates[0].synced_at);
});

test('sync: a failed call counts an attempt and keeps the report waiting', async () => {
  const { syncOnce } = await import('./reports.js');
  const db = fakeDb(waiting);
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) });
  assert.equal(await syncOnce(db, { token: 't', repo: 'x/y', fetchImpl }), 0);
  assert.equal(db.updates[0].attempts, 1);
  assert.equal(db.updates[0].synced_at, undefined);
  assert.match(db.updates[0].last_error, /401 Bad credentials/);
});

test('sync: no token means no call at all', async () => {
  const { syncOnce } = await import('./reports.js');
  let called = false;
  assert.equal(await syncOnce(fakeDb(waiting), { token: '', fetchImpl: async () => { called = true; } }), 0);
  assert.equal(called, false);
});

test('reportTarget: a Discord id that is not the reporter; anything else is null', () => {
  assert.equal(reportTarget('777777777777777777', '999999999999999999'), '777777777777777777');
  assert.equal(reportTarget(' 777777777777777777 ', '1'), '777777777777777777');
  assert.equal(reportTarget('999999999999999999', '999999999999999999'), null, 'not the reporter');
  for (const bad of [null, undefined, '', '12', 'abc', "1' or 1=1", 7777777777777777777n]) assert.equal(reportTarget(bad === 7777777777777777777n ? '7'.repeat(25) : bad, '1'), null);
});

test('the target member never goes into the Issue', () => {
  const i = issueFor({ ...row, target_id: '888888888888888888' });
  assert.doesNotMatch(i.title + i.body, /888888888888888888/);
});
