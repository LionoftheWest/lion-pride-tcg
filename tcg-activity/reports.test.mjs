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

// ---- Device facts (2026-10-11): six short keys, each with its limit; the Issue shows them as rows.
const facts = { app: 'Mobile app', device: 'Phone', os: 'iOS 18', engine: 'WebKit', layout: 'compact landscape', dpr: '3x' };

test('cleanContext keeps the 6 device facts, each cut to its limit, and still drops a raw user agent', () => {
  assert.deepEqual(cleanContext({ ...facts, ua: 'Mozilla/5.0 (iPhone ...)', userAgent: 'Mozilla/5.0' }), facts);
  const long = cleanContext({ app: 'a'.repeat(99), device: 'd'.repeat(99), os: 'o'.repeat(99), engine: 'e'.repeat(99), layout: 'l'.repeat(99), dpr: '9'.repeat(99) });
  assert.deepEqual(Object.fromEntries(Object.entries(long).map(([k, v]) => [k, v.length])), { app: 20, device: 12, os: 24, engine: 12, layout: 32, dpr: 8 });
  assert.equal(cleanContext({ os: 'iOS\n18' }).os, 'iOS 18', 'no line break');
});

test('issueFor shows each sent device fact as a row (App, Device, System, Engine, Layout, Pixel ratio), and no row for a missing one', () => {
  const i = issueFor({ ...row, context: { ...row.context, ...facts } });
  for (const [k, v] of [['App', 'Mobile app'], ['Device', 'Phone'], ['System', 'iOS 18'], ['Engine', 'WebKit'], ['Layout', 'compact landscape'], ['Pixel ratio', '3x']]) {
    assert.match(i.body, new RegExp(`\| ${k} \| ${v} \|`), k);
  }
  const plain = issueFor(row);
  assert.doesNotMatch(plain.body, /\| (App|Device|System|Engine|Layout|Pixel ratio) \|/);
  const evil = issueFor({ ...row, context: { os: '@everyone | <b>' } });
  assert.match(evil.body, /\| System \| @​everyone &lt;b> \|/, 'a fact is a member string: no ping, no table break, no HTML');
});

test('issueFor counts the screenshots and points to the private Admin page, never to a storage link', () => {
  assert.match(issueFor({ ...row, shots: 2 }).body, /\n\n2 screenshots, see the Admin page \(private\)\.$/);
  assert.match(issueFor({ ...row, shots: 1 }).body, /1 screenshot, see the Admin page/);
  assert.doesNotMatch(issueFor(row).body, /screenshot/);
  assert.doesNotMatch(issueFor({ ...row, shots: 3 }).body, /supabase|storage|report-shots/i);
});

// A fake supabase for the screenshot sync: player_report_shots and player_reports rows, records every update.
function shotDb({ reports = [], shots = [] }) {
  const updates = [];
  const table = (name) => {
    const rows = name === 'player_reports' ? reports : shots;
    const f = []; let lim = Infinity;
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { f.push((r) => r[c] === v); return q; },
      is: (c, v) => { f.push((r) => (r[c] ?? null) === v); return q; },
      lt: (c, v) => { f.push((r) => r[c] < v); return q; },
      not: (c, _op, v) => { f.push((r) => (r[c] ?? null) !== v); return q; },
      in: (c, vs) => { f.push((r) => vs.includes(r[c])); return q; },
      limit: (n) => { lim = n; return q; },
      then: (ok, bad) => Promise.resolve({ data: rows.filter((r) => f.every((p) => p(r))).slice(0, lim) }).then(ok, bad),
      update: (v) => ({
        eq: async (c, val) => { for (const r of rows.filter((x) => x[c] === val)) { Object.assign(r, v); updates.push({ table: name, id: r.id, ...v }); } return {}; },
        in: async (c, vals) => { for (const r of rows.filter((x) => vals.includes(x[c]))) { Object.assign(r, v); updates.push({ table: name, id: r.id, ...v }); } return {}; },
      }),
    };
    return q;
  };
  return { updates, from: table };
}

test('sync: the Issue counts the stored screenshots of the report and marks them noted (not an unstored one)', async () => {
  const { syncOnce } = await import('./reports.js');
  const db = shotDb({ reports: [{ id: 7, kind: 'bug', body: 'The pack froze', context: {}, created_at: '2026-10-01T15:00:00Z', attempts: 0, synced_at: null }],
    shots: [{ id: 1, report_id: 7, stored_at: 'x', noted_at: null }, { id: 2, report_id: 7, stored_at: 'x', noted_at: null }, { id: 3, report_id: 7, stored_at: null, noted_at: null }] });
  let sent;
  const fetchImpl = async (_u, o) => { sent = JSON.parse(o.body); return { ok: true, json: async () => ({ number: 50, html_url: 'u' }) }; };
  assert.equal(await syncOnce(db, { token: 't', repo: 'x/y', fetchImpl }), 1);
  assert.match(sent.body, /2 screenshots, see the Admin page \(private\)/);
  assert.deepEqual(db.updates.filter((u) => u.table === 'player_report_shots').map((u) => u.id).sort(), [1, 2]);
});

test('sync: screenshots stored after the Issue get ONE comment on that Issue, then they are noted (no second comment)', async () => {
  const { syncShotNotes } = await import('./reports.js');
  const db = shotDb({ reports: [{ id: 7, issue_number: 50 }, { id: 8, issue_number: null }],
    shots: [{ id: 4, report_id: 7, stored_at: 'x', noted_at: null }, { id: 5, report_id: 7, stored_at: 'x', noted_at: null }, { id: 6, report_id: 8, stored_at: 'x', noted_at: null }] });
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url, body: JSON.parse(o.body).body }); return { ok: true, json: async () => ({}) }; };
  assert.equal(await syncShotNotes(db, { token: 't', repo: 'x/y', fetchImpl }), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/x/y/issues/50/comments');
  assert.match(calls[0].body, /^2 screenshots added to report #7 after this Issue, see the Admin page \(private\)\.$/);
  assert.deepEqual(db.updates.map((u) => u.id).sort(), [4, 5], 'report 8 has no Issue yet: its screenshot waits for the Issue text');
  assert.equal(await syncShotNotes(db, { token: 't', repo: 'x/y', fetchImpl }), 0);
  assert.equal(calls.length, 1);
});

test('sync: a failed comment keeps the screenshots waiting', async () => {
  const { syncShotNotes } = await import('./reports.js');
  const db = shotDb({ reports: [{ id: 7, issue_number: 50 }], shots: [{ id: 4, report_id: 7, stored_at: 'x', noted_at: null }] });
  assert.equal(await syncShotNotes(db, { token: 't', repo: 'x/y', fetchImpl: async () => ({ ok: false, status: 500 }) }), 0);
  assert.equal(db.updates.length, 0);
});
