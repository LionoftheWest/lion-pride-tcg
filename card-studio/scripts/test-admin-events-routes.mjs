/**
 * Test of card-studio/src/admin-events-routes.js with a MOCK rpc (no database):   node scripts/test-admin-events-routes.mjs
 * Invariants:
 *   V1 the flag: ADMIN_VIEW not 1 = 404 for GET and POST, the rpc is never called
 *   V2 the login: with STUDIO_PASS set, no or a wrong Basic Auth = 401 (GET and POST); the right one = 200
 *   V3 no STUDIO_PASS: a loopback request is served, a forwarded one is refused (403)
 *   V4 a write needs Content-Type application/json AND X-Admin-Write: 1 (else 403, no rpc); PUT / DELETE = 405
 *   V5 each route calls its admin_event* function with the parsed arguments and the actor studio:<STUDIO_USER>
 *   V6 bad input (an id, a time, an unknown event field, a non-boolean on, a long reason) = 400 before the rpc
 *   V7 a database error = 400 with the message
 *   V8 mounted before the read-only router in the real app: a POST reaches the events router (not the 405 of /api/admin)
 *   V9 the calendar and the library (F-1 PR 5): GET /calendar reads the events that overlap from..to (bad times = 400 before the
 *      database), GET /vars gives each base value (a path, a whole value, a factor = 1) and the limits as numbers, the template
 *      routes call their admin_event_template* functions with the actor; bad input = 400 before the rpc; the gate stays
 */
import express from 'express';
import { eventsRouter } from '../src/admin-events-routes.js';
import { adminRouter } from '../src/admin-routes.js';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 400)}`); };

const calls = [];
const rpc = async (fn, args) => {
  calls.push({ fn, args });
  if (fn === 'admin_event_cancel' && args.p_id === 13) return { data: null, error: { message: 'boom from the database' } };
  return { data: { fn } };
};
const start = (env, withRead = false) => new Promise((resolve) => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/events', eventsRouter({ rpc, env }));
  if (withRead) app.use('/api/admin', adminRouter({ rpc, env }));
  const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
});
const auth = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
const W = { 'content-type': 'application/json', 'x-admin-write': '1' };
const post = (url, body, headers) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

// V1
let srv = await start({ ADMIN_VIEW: '0', STUDIO_USER: 'u', STUDIO_PASS: 'p' });
let base = `http://127.0.0.1:${srv.address().port}/api/admin/events`;
let r = await fetch(base, { headers: auth('u', 'p') });
let r2 = await post(base, { event: {} }, { ...auth('u', 'p'), ...W });
check('V1 the flag off: 404 for GET and POST, no rpc call', r.status === 404 && r2.status === 404 && calls.length === 0, [r.status, r2.status]);
srv.close();

// V2, V4, V5, V6, V7
srv = await start({ ADMIN_VIEW: '1', STUDIO_USER: 'nathan', STUDIO_PASS: 'p' });
base = `http://127.0.0.1:${srv.address().port}/api/admin/events`;
r = await fetch(base);
r2 = await post(`${base}/1/cancel`, {}, W);
check('V2 no login: 401 for GET and POST', r.status === 401 && r2.status === 401 && calls.length === 0, [r.status, r2.status]);
r = await post(`${base}/1/cancel`, {}, { ...auth('nathan', 'wrong'), ...W });
check('V2 a wrong password: 401', r.status === 401 && calls.length === 0, r.status);
const A = auth('nathan', 'p');
r = await fetch(base, { headers: A });
check('V2/V5 the right login: GET / -> admin_events, no-store', r.status === 200 && r.headers.get('cache-control') === 'no-store'
  && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn: 'admin_events', args: {} }), calls.at(-1));

for (const [name, headers] of [['no content type', { 'x-admin-write': '1' }], ['a form content type', { 'content-type': 'application/x-www-form-urlencoded', 'x-admin-write': '1' }],
  ['text/plain', { 'content-type': 'text/plain', 'x-admin-write': '1' }], ['no X-Admin-Write', { 'content-type': 'application/json' }], ['X-Admin-Write 0', { 'content-type': 'application/json', 'x-admin-write': '0' }]]) {
  const before = calls.length;
  r = await fetch(`${base}/1/cancel`, { method: 'POST', headers: { ...A, ...headers }, body: '{}' });
  check(`V4 a write with ${name}: 403, no rpc`, r.status === 403 && calls.length === before, r.status);
}
for (const m of ['PUT', 'DELETE', 'PATCH']) {
  const before = calls.length;
  r = await fetch(`${base}/1`, { method: m, headers: { ...A, ...W }, body: '{}' });
  check(`V4 ${m}: 405, no rpc`, r.status === 405 && calls.length === before, r.status);
}

const T = '2026-10-07T20:00:00.123456+00:00';
const ev = { key: 'halloween', kind: 'drop', title: 'Halloween', starts_at: '2026-10-31T06:00:00Z', ends_at: '2026-11-01T06:00:00Z',
  audience: { all: true }, rewards: { per_member: { packs: 3 } }, rules: {} };
const cases = [
  ['GET', '/42', null, 'admin_event', { p_id: 42 }],
  ['GET', '/42/preview', null, 'admin_event_preview', { p_id: 42 }],
  ['POST', '/test', { event: ev }, 'admin_event_preview_draft', { p_event: ev }],
  ['POST', '/', { event: ev }, 'admin_event_save', { p_event: ev, p_expected_updated_at: null, p_actor: 'studio:nathan', p_reason: null }],
  ['POST', '/', { event: { id: 42, title: 'Halloween 2' }, expected_updated_at: T, reason: 'typo' }, 'admin_event_save',
    { p_event: { id: 42, title: 'Halloween 2' }, p_expected_updated_at: T, p_actor: 'studio:nathan', p_reason: 'typo' }],
  ['POST', '/', { event: { id: 42, vars: { pull_rare_mult: 2 }, theme: { name: 'Rare rush' } }, expected_updated_at: T }, 'admin_event_save',   // event_vars.sql: vars and theme
    { p_event: { id: 42, vars: { pull_rare_mult: 2 }, theme: { name: 'Rare rush' } }, p_expected_updated_at: T, p_actor: 'studio:nathan', p_reason: null }],
  ['POST', '/42/schedule', { expected_updated_at: T }, 'admin_event_schedule', { p_id: 42, p_expected_updated_at: T, p_actor: 'studio:nathan', p_on: true }],
  ['POST', '/42/schedule', { expected_updated_at: T, on: false }, 'admin_event_schedule', { p_id: 42, p_expected_updated_at: T, p_actor: 'studio:nathan', p_on: false }],
  ['POST', '/42/cancel', { expected_updated_at: T, reason: 'wrong date' }, 'admin_event_cancel', { p_id: 42, p_expected_updated_at: T, p_actor: 'studio:nathan', p_reason: 'wrong date' }],
  ['POST', '/42/end', { expected_updated_at: T }, 'admin_event_end_now', { p_id: 42, p_expected_updated_at: T, p_actor: 'studio:nathan', p_reason: null }],
];
for (const [m, path, body, fn, args] of cases) {
  r = m === 'GET' ? await fetch(base + path, { headers: A }) : await post(base + path, body, { ...A, ...W });
  check(`V5 ${m} ${path} -> ${fn}`, r.status === 200 && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn, args }), { status: r.status, call: calls.at(-1) });
}
for (const [m, path, body] of [['GET', '/abc'], ['GET', '/0/preview'], ['POST', '/1/cancel', { expected_updated_at: 'yesterday' }],
  ['POST', '/', { event: { ...ev, status: 'live' } }], ['POST', '/', { event: 'x' }], ['POST', '/', {}], ['POST', '/1/schedule', { on: 'yes' }],
  ['POST', '/1/cancel', { reason: 'x'.repeat(301) }], ['POST', '/', { event: { id: 'drop table' } }]]) {
  const before = calls.length;
  r = m === 'GET' ? await fetch(base + path, { headers: A }) : await post(base + path, body, { ...A, ...W });
  check(`V6 bad input ${m} ${path} ${JSON.stringify(body || '').slice(0, 40)}: 400 before the rpc`, r.status === 400 && calls.length === before, r.status);
}
r = await post(`${base}/13/cancel`, {}, { ...A, ...W });
const b = await r.json();
check('V7 a database error: 400 with the message', r.status === 400 && b.error === 'boom from the database', b);
srv.close();

// V9 the calendar and the library routes (F-1 PR 5)
const dbCalls = [];
const db = {
  from(table) {
    const ops = [];
    const rows = { events: [{ id: 1, title: 'A' }], event_vars: [
      { key: 'daily_cap', balance_key: 'daily', balance_path: ['cap'], combine: 'max', min_value: '1', max_value: '20', whole: true },
      { key: 'pull_rare_mult', balance_key: 'pulls', balance_path: null, combine: 'multiply', min_value: '0.5', max_value: '5', whole: false },
      { key: 'pack_earn_mult', balance_key: 'pack_earn_multiplier', balance_path: [], combine: 'multiply', min_value: '0', max_value: '5', whole: false }],
    balance: [{ key: 'daily', value: { cap: 6 } }, { key: 'pulls', value: { rates: {} } }, { key: 'pack_earn_multiplier', value: 1.5 }] }[table];
    const b = new Proxy({}, { get: (_, op) => (op === 'then' ? (res) => { dbCalls.push({ table, ops }); res({ data: rows, error: null }); }
      : (...a) => { ops.push([op, ...a]); return b; }) });
    return b;
  },
};
const rpc2 = async (fn, args) => { calls.push({ fn, args }); return fn === 'game_vars' ? { data: { daily_cap: 8, pull_rare_mult: 2, pack_earn_mult: 1.5 } } : { data: { fn } }; };
srv = await new Promise((resolve) => { const app = express(); app.use('/api/admin/events', eventsRouter({ rpc: rpc2, db, env: { ADMIN_VIEW: '1', STUDIO_USER: 'nathan', STUDIO_PASS: 'p' } })); const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
base = `http://127.0.0.1:${srv.address().port}/api/admin/events`;
const F = '2026-09-27T06:00:00.000Z', TO = '2026-11-01T06:00:00.000Z';
r = await fetch(`${base}/calendar?from=${F}&to=${TO}`, { headers: A });
let j = await r.json();
const evq = dbCalls.at(-1);
check('V9 GET /calendar reads the events that overlap from..to (starts_at < to, ends_at > from) and says repeats: false', r.status === 200 && j.rows.length === 1 && j.features?.repeats === false
  && evq.table === 'events' && evq.ops.some((o) => o[0] === 'lt' && o[1] === 'starts_at' && o[2] === TO) && evq.ops.some((o) => o[0] === 'gt' && o[1] === 'ends_at' && o[2] === F), { status: r.status, evq });
for (const qs of ['', `?from=${F}`, `?from=${TO}&to=${F}`, `?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`, `?from=soon&to=${TO}`]) {
  const before = dbCalls.length;
  r = await fetch(`${base}/calendar${qs}`, { headers: A });
  check(`V9 GET /calendar${qs.slice(0, 50)}: 400 before the database`, r.status === 400 && dbCalls.length === before, r.status);
}
r = await fetch(`${base}/vars`, { headers: A });
j = await r.json();
const by = Object.fromEntries((j.rows || []).map((v) => [v.key, v]));
check('V9 GET /vars: the base value from balance (a path, a whole value, a factor = 1), the limits as numbers, the value now', r.status === 200
  && by.daily_cap.base === 6 && by.pack_earn_mult.base === 1.5 && by.pull_rare_mult.base === 1 && by.daily_cap.min_value === 1 && by.pull_rare_mult.max_value === 5
  && by.daily_cap.now === 8 && by.pull_rare_mult.now === 2, j);
const T2 = '2026-10-07T20:00:00.123456+00:00';
const tpl = { name: 'Rare rush', kind: 'modifier', vars: { pull_rare_mult: 2 }, theme: { color: '#5B8CFF' }, default_length: '3 days' };
for (const [m, path, body, fn, args] of [
  ['GET', '/templates', null, 'admin_event_templates', {}],
  ['POST', '/templates', { template: tpl }, 'admin_event_template_save', { p_template: tpl, p_expected_updated_at: null, p_actor: 'studio:nathan', p_reason: null }],
  ['POST', '/templates', { template: { id: 3, name: 'X' }, expected_updated_at: T2 }, 'admin_event_template_save', { p_template: { id: 3, name: 'X' }, p_expected_updated_at: T2, p_actor: 'studio:nathan', p_reason: null }],
  ['POST', '/42/template', { name: 'Halloween drop' }, 'admin_event_template_from_event', { p_event_id: 42, p_name: 'Halloween drop', p_actor: 'studio:nathan', p_reason: null }],
  ['POST', '/templates/3/create', { key: 'rare_rush_20261014', starts_at: '2026-10-14T21:00:00.000Z' }, 'admin_event_from_template',
    { p_template_id: 3, p_key: 'rare_rush_20261014', p_starts_at: '2026-10-14T21:00:00.000Z', p_actor: 'studio:nathan', p_title: null, p_reason: null }],
  ['POST', '/templates/3/create', { key: 'rr_x', starts_at: '2026-10-14T21:00:00.000Z', title: 'Rare rush 2' }, 'admin_event_from_template',
    { p_template_id: 3, p_key: 'rr_x', p_starts_at: '2026-10-14T21:00:00.000Z', p_actor: 'studio:nathan', p_title: 'Rare rush 2', p_reason: null }],
]) {
  r = m === 'GET' ? await fetch(base + path, { headers: A }) : await post(base + path, body, { ...A, ...W });
  check(`V9 ${m} ${path} -> ${fn}`, r.status === 200 && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn, args }), { status: r.status, call: calls.at(-1) });
}
for (const [path, body] of [['/templates', { template: { ...tpl, source_event_id: 1 } }], ['/templates', { template: [] }], ['/42/template', {}], ['/42/template', { name: 'x'.repeat(81) }],
  ['/abc/template', { name: 'x' }], ['/templates/3/create', { starts_at: '2026-10-14T21:00:00Z' }], ['/templates/3/create', { key: 'k_k_k' }], ['/templates/0/create', { key: 'kkk', starts_at: '2026-10-14T21:00:00Z' }]]) {
  const before = calls.length;
  r = await post(base + path, body, { ...A, ...W });
  check(`V9 bad input POST ${path} ${JSON.stringify(body).slice(0, 50)}: 400 before the rpc`, r.status === 400 && calls.length === before, r.status);
}
const before9 = calls.length;
r = await post(`${base}/templates`, { template: tpl }, { ...A, 'content-type': 'application/json' });
check('V9 a library write without X-Admin-Write: 403, no rpc', r.status === 403 && calls.length === before9, r.status);
srv.close();
srv = await new Promise((resolve) => { const app = express(); app.use('/api/admin/events', eventsRouter({ rpc: rpc2, env: { ADMIN_VIEW: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p' } })); const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
r = await fetch(`http://127.0.0.1:${srv.address().port}/api/admin/events/calendar?from=${F}&to=${TO}`);
check('V9 GET /calendar keeps the login gate (401 without login)', r.status === 401, r.status);
srv.close();

// V3
srv = await start({ ADMIN_VIEW: '1' });
base = `http://127.0.0.1:${srv.address().port}/api/admin/events`;
r = await post(`${base}/1/end`, {}, W);
check('V3 no STUDIO_PASS: this PC (loopback) is served, the actor is studio:studio', r.status === 200 && calls.at(-1).args.p_actor === 'studio:studio', [r.status, calls.at(-1)]);
r = await post(`${base}/1/end`, {}, { ...W, 'x-forwarded-for': '100.64.1.2' });
check('V3 no STUDIO_PASS: a forwarded request is refused (403)', r.status === 403, r.status);
srv.close();

// V8
srv = await start({ ADMIN_VIEW: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p' }, true);
base = `http://127.0.0.1:${srv.address().port}/api/admin`;
r = await post(`${base}/events/7/cancel`, {}, { ...auth('u', 'p'), ...W });
r2 = await post(`${base}/overview`, {}, { ...auth('u', 'p'), ...W });
check('V8 with both routers: a POST to /events reaches the events router, /overview stays read only (405)', r.status === 200 && r2.status === 405, [r.status, r2.status]);
srv.close();

console.log(fails ? `FAIL ${fails} of ${n}` : `PASS all ${n}`);
process.exit(fails ? 1 : 0);
