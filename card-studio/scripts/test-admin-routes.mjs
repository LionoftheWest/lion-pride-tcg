/**
 * Test of card-studio/src/admin-routes.js with a MOCK rpc (no database):   node scripts/test-admin-routes.mjs
 * Invariants:
 *   R1 the flag: ADMIN_VIEW not 1 = every route 404, and the rpc is never called
 *   R2 the login: with STUDIO_PASS set, no or a wrong Basic Auth = 401 (also from this PC); the right one = 200
 *   R3 no STUDIO_PASS: a loopback request is served, a forwarded one (the tunnel proxy) is refused
 *   R4 read only: POST, PUT, DELETE = 405, the rpc is never called
 *   R5 each route calls its admin_ function with the parsed arguments; a bad date, number or sort word = 400 before the rpc
 *   R6 the CSV report: the catalog column order, quotes, and a formula cell made safe
 *   R7 a database error = 400 with the message
 */
import express from 'express';
import { adminRouter, toCsv } from '../src/admin-routes.js';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 400)}`); };

const calls = [];
const rpc = async (fn, args) => {
  calls.push({ fn, args });
  if (fn === 'admin_report') return { data: { columns: ['rank', 'username', 'damage'], rows: [{ rank: 1, username: '=HYPERLINK("x")', damage: 600 }, { rank: 2, username: 'a, "b"', damage: 400 }] } };
  if (fn === 'admin_health') return { data: null, error: { message: 'boom from the database' } };
  return { data: { fn } };
};
const start = (env) => new Promise((resolve) => {
  const app = express();
  app.use('/api/admin', adminRouter({ rpc, env }));
  const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
});
const auth = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });

// R1
let srv = await start({ ADMIN_VIEW: '0', STUDIO_USER: 'u', STUDIO_PASS: 'p' });
let base = `http://127.0.0.1:${srv.address().port}/api/admin`;
let r = await fetch(`${base}/overview`, { headers: auth('u', 'p') });
check('R1 the flag off: 404 and no rpc call', r.status === 404 && calls.length === 0, r.status);
srv.close();

// R2, R4, R5, R6, R7
srv = await start({ ADMIN_VIEW: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p' });
base = `http://127.0.0.1:${srv.address().port}/api/admin`;
r = await fetch(`${base}/overview`);
check('R2 no login: 401 with a Basic challenge (also from this PC)', r.status === 401 && /Basic/.test(r.headers.get('www-authenticate') || ''), r.status);
r = await fetch(`${base}/overview`, { headers: auth('u', 'wrong') });
check('R2 a wrong password: 401', r.status === 401 && calls.length === 0, r.status);
r = await fetch(`${base}/overview?from=2026-10-01&to=2026-10-07`, { headers: auth('u', 'p') });
check('R2/R5 the right login: 200, admin_overview with the dates, no-store', r.status === 200 && r.headers.get('cache-control') === 'no-store'
  && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn: 'admin_overview', args: { p_from: '2026-10-01', p_to: '2026-10-07' } }), calls.at(-1));
for (const m of ['POST', 'PUT', 'DELETE']) {
  const before = calls.length;
  r = await fetch(`${base}/overview`, { method: m, headers: { ...auth('u', 'p'), 'content-type': 'application/json' }, body: '{}' });
  check(`R4 ${m} is refused (405), no rpc call`, r.status === 405 && calls.length === before, r.status);
}
const cases = [
  ['/members?search=lion&sort=power&limit=10&offset=20', 'admin_members', { p_search: 'lion', p_sort: 'power', p_limit: 10, p_offset: 20 }],
  ['/members', 'admin_members', { p_search: null, p_sort: 'last_active', p_limit: 50, p_offset: 0 }],
  ['/member/tst_admin_1', 'admin_member', { p_player: 'tst_admin_1' }],
  ['/member/tst_admin_1/timeline?before=2026-10-01T00:00:00Z&before_key=pack:9&limit=20', 'admin_member_timeline',
    { p_player: 'tst_admin_1', p_before: '2026-10-01T00:00:00Z', p_limit: 20, p_before_key: 'pack:9' }],
  ['/economy?from=2026-09-01&bucket=week', 'admin_economy', { p_from: '2026-09-01', p_to: null, p_bucket: 'week' }],
  ['/growth', 'admin_growth', { p_from: null, p_to: null }],
  ['/cards?sort=damage', 'admin_cards', { p_from: null, p_to: null, p_sort: 'damage', p_limit: 50, p_offset: 0 }],
  ['/hunts', 'admin_hunts', { p_limit: 20, p_offset: 0 }],
  ['/hunt/118624', 'admin_hunt', { p_hunt: 118624 }],
  ['/reports', 'admin_report_catalog', {}],
  ['/report/hunt_board?hunt=5&limit=10', 'admin_report', { p_key: 'hunt_board', p_params: { hunt: 5, limit: 10 } }],
];
for (const [path, fn, args] of cases) {
  r = await fetch(base + path, { headers: auth('u', 'p') });
  check(`R5 ${path} -> ${fn}`, r.status === 200 && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn, args }), { status: r.status, call: calls.at(-1) });
}
for (const path of ['/overview?from=yesterday', '/members?limit=500', '/members?sort=power;drop', '/hunt/abc', '/member/x/timeline?before=notatime', '/report/top_power?x=' + 'a'.repeat(50)]) {
  const before = calls.length;
  r = await fetch(base + path, { headers: auth('u', 'p') });
  check(`R5 bad input ${path.slice(0, 40)}: 400 before the rpc`, r.status === 400 && calls.length === before, r.status);
}
r = await fetch(`${base}/report/hunt_board.csv?hunt=5`, { headers: auth('u', 'p') });
const csv = Buffer.from(await r.arrayBuffer()).toString("utf8");   // text() drops the BOM
check('R6 CSV: catalog order, quotes, formula cell made safe', r.status === 200 && /text\/csv/.test(r.headers.get('content-type'))
  && csv === '﻿rank,username,damage\r\n1,"\'=HYPERLINK(""x"")",600\r\n2,"a, ""b""",400\r\n', csv);
check('R6 toCsv of null and objects', toCsv(['a', 'b'], [{ a: null, b: { x: 1 } }]) === 'a,b\r\n,"{""x"":1}"\r\n', toCsv(['a', 'b'], [{ a: null, b: { x: 1 } }]));
r = await fetch(`${base}/health`, { headers: auth('u', 'p') });
const body = await r.json();
check('R7 a database error: 400 with the message', r.status === 400 && body.error === 'boom from the database', body);
srv.close();

// R3
srv = await start({ ADMIN_VIEW: '1' });
base = `http://127.0.0.1:${srv.address().port}/api/admin`;
r = await fetch(`${base}/hunts`);
check('R3 no STUDIO_PASS: this PC (loopback) is served', r.status === 200, r.status);
r = await fetch(`${base}/hunts`, { headers: { 'x-forwarded-for': '100.64.1.2' } });
check('R3 no STUDIO_PASS: a forwarded request is refused (403)', r.status === 403, r.status);
srv.close();

console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
process.exitCode = fails ? 1 : 0;
