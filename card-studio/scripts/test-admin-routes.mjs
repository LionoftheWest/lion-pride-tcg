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
 *   R8 the studio login (req.studioAuthed) opens the router without Basic Auth; a client cannot set it
 *   R9 /source: LIVE, or LOCAL with LOCALDB=1
 *   R10 /tables: the documented tables (docs/data) with columns and primary keys
 *   R11 /table/:name: only a documented table (else 404, no query); 50 rows, ordered by the primary key, the offset and the key filter;
 *       secrets hidden, member-id lists in settings cut to a count
 *   R12 /search: members through admin_members, cards by name with the LIKE characters escaped, tables by name
 *   R13 (2026-10-07) the timeline and feed kind filters (a comma list of words, at most 40), the card search, /card/:id,
 *       /dungeon and /feed; a bad kind or id = 400 before the rpc
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
    { p_player: 'tst_admin_1', p_before: '2026-10-01T00:00:00Z', p_limit: 20, p_before_key: 'pack:9', p_kinds: null }],
  ['/member/tst_admin_1/timeline?kinds=visit,wishlist,visit,', 'admin_member_timeline', { p_player: 'tst_admin_1', p_before: null, p_limit: 50, p_before_key: null, p_kinds: ['visit', 'wishlist'] }],
  ['/economy?from=2026-09-01&bucket=week', 'admin_economy', { p_from: '2026-09-01', p_to: null, p_bucket: 'week' }],
  ['/growth', 'admin_growth', { p_from: null, p_to: null }],
  ['/cards?sort=damage', 'admin_cards', { p_from: null, p_to: null, p_sort: 'damage', p_limit: 50, p_offset: 0, p_search: null }],
  ['/cards?search=Pika%25', 'admin_cards', { p_from: null, p_to: null, p_sort: 'copies', p_limit: 50, p_offset: 0, p_search: 'Pika%' }],
  ['/card/42', 'admin_card', { p_card: 42 }],
  ['/dungeon?from=2026-09-01&to=2026-09-30', 'admin_dungeon', { p_from: '2026-09-01', p_to: '2026-09-30' }],
  ['/feed', 'admin_feed', { p_kinds: null, p_before: null, p_limit: 50, p_before_key: null }],
  ['/feed?kinds=pull,hunt&before=2026-10-01T00:00:00Z&before_key=pull:9&limit=30', 'admin_feed',
    { p_kinds: ['pull', 'hunt'], p_before: '2026-10-01T00:00:00Z', p_limit: 30, p_before_key: 'pull:9' }],
  ['/hunts', 'admin_hunts', { p_limit: 20, p_offset: 0 }],
  ['/hunt/118624', 'admin_hunt', { p_hunt: 118624 }],
  ['/reports', 'admin_report_catalog', {}],
  ['/report/hunt_board?hunt=5&limit=10', 'admin_report', { p_key: 'hunt_board', p_params: { hunt: 5, limit: 10 } }],
];
for (const [path, fn, args] of cases) {
  r = await fetch(base + path, { headers: auth('u', 'p') });
  check(`R5 ${path} -> ${fn}`, r.status === 200 && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn, args }), { status: r.status, call: calls.at(-1) });
}
for (const path of ['/feed?kinds=pull;drop', '/member/x/timeline?kinds=Visit', '/card/abc', '/card/0', '/dungeon?from=1.1.2026', '/feed?limit=500',
  '/feed?kinds=' + Array.from({ length: 41 }, (_, i) => 'k' + i).join(','), '/cards?search=' + 'a'.repeat(61), '/overview?from=yesterday', '/members?limit=500', '/members?sort=power;drop', '/hunt/abc', '/member/x/timeline?before=notatime', '/report/top_power?x=' + 'a'.repeat(50)]) {
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

// R8
{
  const app = express();
  app.use((req, res, next) => { req.studioAuthed = true; next(); });
  app.use('/api/admin', adminRouter({ rpc, env: { ADMIN_VIEW: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p' } }));
  const s2 = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  r = await fetch(`http://127.0.0.1:${s2.address().port}/api/admin/hunts`);
  check('R8 the studio login opens the router without Basic Auth', r.status === 200, r.status);
  s2.close();
  srv = await start({ ADMIN_VIEW: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p' });
  r = await fetch(`http://127.0.0.1:${srv.address().port}/api/admin/hunts?studioAuthed=true`, { headers: { studioauthed: 'true', cookie: 'studioAuthed=true' } });
  check('R8 a client cannot set studioAuthed (query, header, cookie): 401', r.status === 401, r.status);
  srv.close();
}

// R9 - R12: a mock db that records the query chain.
const queries = [];
const db = {
  from(table) {
    const q = { table, calls: [] };
    queries.push(q);
    const b = {};
    for (const m of ['select', 'eq', 'order', 'ilike', 'limit', 'range']) b[m] = (...a) => { q.calls.push([m, ...a]); return b; };
    b.then = (ok) => ok(table === 'settings'
      ? { data: [{ key: 'ui_v3', value: { enabled: true, users: ['123456789012345678', '223456789012345678'] } }, { key: 'dungeon', value: { salt: 'abc', enabled: true } }], count: 2 }
      : table === 'cards' ? { data: [{ id: 7, name: 'A 50% card', rarity: 'gold' }] }
        : { data: [{ id: 2, api_token: 'tok', note: 'x' }], count: 99 });
    return b;
  },
};
const start2 = (env) => new Promise((resolve) => {
  const app = express();
  app.use('/api/admin', adminRouter({ rpc, db, env }));
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
srv = await start2({ ADMIN_VIEW: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p', LOCALDB: '1' });
base = `http://127.0.0.1:${srv.address().port}/api/admin`;
r = await fetch(`${base}/source`, { headers: auth('u', 'p') });
let j = await r.json();
check('R9 LOCALDB=1: the source is LOCAL', j.source === 'LOCAL' && j.login === true, j);
srv.close();
srv = await start2({ ADMIN_VIEW: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p' });
base = `http://127.0.0.1:${srv.address().port}/api/admin`;
r = await fetch(`${base}/source`, { headers: auth('u', 'p') });
j = await r.json();
check('R9 no LOCALDB: the source is LIVE', j.source === 'LIVE', j);
r = await fetch(`${base}/source`);
check('R9 /source needs the login too', r.status === 401, r.status);

r = await fetch(`${base}/tables`, { headers: auth('u', 'p') });
j = await r.json();
const players = j.tables?.find((t) => t.name === 'players'), pc = j.tables?.find((t) => t.name === 'player_cards');
check('R10 the documented tables with columns and keys', j.tables?.length >= 40 && players?.columns.some((c) => c.name === 'id') && players.pk.join() === 'id'
  && pc?.pk.join() === 'player_id,card_id' && players.note.length > 20, { n: j.tables?.length, pk: pc?.pk });

let before = queries.length;
r = await fetch(`${base}/table/pg_authid`, { headers: auth('u', 'p') });
check('R11 a table not in the docs: 404 and no query', r.status === 404 && queries.length === before, r.status);
r = await fetch(`${base}/table/players?offset=100`, { headers: auth('u', 'p') });
j = await r.json();
const q1 = queries.at(-1);
check('R11 players: 50 rows from the offset, ordered by the key, newest first', r.status === 200 && q1.table === 'players'
  && JSON.stringify(q1.calls) === JSON.stringify([['select', '*', { count: 'estimated' }], ['order', 'id', { ascending: false }], ['range', 100, 149]]) && j.total_estimate === 99, q1);
check('R11 a column named like a secret is hidden', j.rows?.[0]?.api_token === '[hidden]' && j.rows[0].note === 'x', j.rows);
r = await fetch(`${base}/table/players?key=abc`, { headers: auth('u', 'p') });
check('R11 key: one row by the primary key', queries.at(-1).calls.some((c) => c[0] === 'eq' && c[1] === 'id' && c[2] === 'abc'), queries.at(-1).calls);
r = await fetch(`${base}/table/player_cards?key=abc`, { headers: auth('u', 'p') });
check('R11 key on a two-column key: 400', r.status === 400, r.status);
r = await fetch(`${base}/table/players?offset=-1`, { headers: auth('u', 'p') });
check('R11 a bad offset: 400', r.status === 400, r.status);
r = await fetch(`${base}/table/settings`, { headers: auth('u', 'p') });
j = await r.json();
check('R11 settings: a member-id list is a count, a salt is hidden', JSON.stringify(j.rows) === JSON.stringify([
  { key: 'ui_v3', value: { enabled: true, users: '[2 member ids]' } }, { key: 'dungeon', value: { salt: '[hidden]', enabled: true } }]), j.rows);
r = await fetch(`${base}/table/players`, { method: 'POST', headers: auth('u', 'p') });
check('R11 read only: POST is 405', r.status === 405, r.status);

r = await fetch(`${base}/search?q=50%25_x`, { headers: auth('u', 'p') });
j = await r.json();
const cq = queries.at(-1);
check('R12 search: admin_members with the text, limit 8', JSON.stringify(calls.at(-1)) === JSON.stringify({ fn: 'admin_members', args: { p_search: '50%_x', p_sort: 'last_active', p_limit: 8, p_offset: 0 } }), calls.at(-1));
check('R12 search: cards by name, the LIKE characters escaped', cq.table === 'cards' && cq.calls.some((c) => c[0] === 'ilike' && c[1] === 'name' && c[2] === '%50\\%\\_x%'), cq.calls);
r = await fetch(`${base}/search?q=play`, { headers: auth('u', 'p') });
j = await r.json();
check('R12 search: tables by name', j.tables.includes('players') && j.tables.includes('player_cards'), j.tables);
before = calls.length;
r = await fetch(`${base}/search?q=a`, { headers: auth('u', 'p') });
j = await r.json();
check('R12 search: under 2 characters = empty, no query', calls.length === before && j.members.length === 0, j);
srv.close();

console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
process.exitCode = fails ? 1 : 0;
