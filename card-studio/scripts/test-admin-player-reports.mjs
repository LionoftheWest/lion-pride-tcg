/**
 * Test of GET /api/admin/player-reports (src/admin-player-reports.js) with a MOCK database:
 *   node scripts/test-admin-player-reports.mjs
 * Invariants:
 *   P1 behind the admin gate: ADMIN_VIEW not 1 = 404 and no query; read only (POST = 405)
 *   P2 newest first, keyset page (before, limit at most 50; a bad value = 400 before any query)
 *   P3 each report carries its STORED screenshots only, each as a signed link of the PRIVATE bucket that ends after 300 s
 *   P4 the member names come with the ids (private page); the device facts stay in context
 */
import express from 'express';
import { adminRouter } from '../src/admin-routes.js';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 400)}`); };

const REPORTS = [5, 4, 3, 2, 1].map((id) => ({ id, player_id: '11', target_id: id === 5 ? '22' : null, kind: 'bug', body: `report ${id}`,
  context: { os: 'iOS 18', device: 'Phone' }, created_at: '2026-10-11T00:00:00Z', issue_number: 300 + id, issue_url: `https://github.com/x/y/issues/${300 + id}` }));
const SHOTS = [{ id: 1, report_id: 5, n: 1, path: '5/1.webp', stored_at: 't' }, { id: 2, report_id: 5, n: 2, path: '5/2.png', stored_at: 't' },
  { id: 3, report_id: 5, n: 3, path: '5/3.webp', stored_at: null }, { id: 4, report_id: 4, n: 1, path: '4/1.webp', stored_at: 't' }];
const log = [];
const db = {
  from: (table) => {
    const rows = { player_reports: REPORTS, player_report_shots: SHOTS, players: [{ id: '11', username: 'Alpha' }, { id: '22', username: 'Beta' }] }[table];
    const f = []; let lim = Infinity, desc = false;
    const q = {
      select: () => q,
      order: (_c, o) => { desc = o?.ascending === false; return q; },
      limit: (k) => { lim = k; return q; },
      lt: (c, v) => { f.push((r) => r[c] < v); return q; },
      in: (c, vs) => { f.push((r) => vs.includes(r[c])); return q; },
      not: (c, _o, v) => { f.push((r) => (r[c] ?? null) !== v); return q; },
      then: (ok, bad) => { log.push(table); let out = rows.filter((r) => f.every((p) => p(r))); if (desc) out = [...out].sort((a, b) => b.id - a.id); return Promise.resolve({ data: out.slice(0, lim) }).then(ok, bad); },
    };
    return q;
  },
  storage: { from: (bucket) => ({ createSignedUrls: async (paths, secs) => { log.push(`sign:${bucket}:${secs}`); return { data: paths.map((p) => ({ path: p, signedUrl: `https://s/${bucket}/${p}?token=t&exp=${secs}` })) }; } }) },
};
const start = (env) => new Promise((resolve) => {
  const app = express();
  app.use('/api/admin', adminRouter({ rpc: async () => ({ data: {} }), db, env }));
  const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
});

let srv = await start({ ADMIN_VIEW: '0' });
let base = `http://127.0.0.1:${srv.address().port}/api/admin`;
let r = await fetch(`${base}/player-reports`);
check('P1 the flag off: 404 and no query', r.status === 404 && log.length === 0, r.status);
srv.close();

srv = await start({ ADMIN_VIEW: '1' });   // no STUDIO_PASS: loopback only (adminGate)
base = `http://127.0.0.1:${srv.address().port}/api/admin`;
r = await fetch(`${base}/player-reports`, { method: 'POST' });
check('P1 read only: POST = 405', r.status === 405 && log.length === 0, r.status);
for (const bad of ['before=abc', 'limit=0', 'limit=51', 'before=-1']) {
  r = await fetch(`${base}/player-reports?${bad}`);
  check(`P2 ${bad} = 400 before any query`, r.status === 400 && log.length === 0, r.status);
}
r = await fetch(`${base}/player-reports?limit=2`);
let d = await r.json();
check('P2 newest first, 2 rows, next = the last id', r.status === 200 && d.rows.map((x) => x.id).join() === '5,4' && d.next === 4, d);
const r5 = d.rows[0];
check('P3 only the stored screenshots, in order, as signed links of report-shots that end after 300 s',
  r5.shots.map((x) => x.n).join() === '1,2' && r5.shots.every((x) => /^https:\/\/s\/report-shots\/5\/\d\.(webp|png)\?token=t&exp=300$/.test(x.url))
  && log.includes('sign:report-shots:300') && d.signed_seconds === 300, r5.shots);
check('P3 no storage path or public link leaks: the shot has n, mime, bytes, created_at, url only',
  r5.shots.every((x) => !('path' in x)) && !JSON.stringify(d).includes('/object/public/'), r5.shots[0]);
check('P4 names with the ids, the device facts in context, the Issue link', r5.player_name === 'Alpha' && r5.target_name === 'Beta' && r5.context.os === 'iOS 18' && r5.issue_url.endsWith('/305'), r5);
r = await fetch(`${base}/player-reports?before=4&limit=50`);
d = await r.json();
check('P2 before=4: the older reports, and next null on the last page', d.rows.map((x) => x.id).join() === '3,2,1' && d.next === null, d);
srv.close();

console.log(fails ? `FAILS ${fails} of ${n}` : `PASS all ${n}`);
process.exit(fails ? 1 : 0);
