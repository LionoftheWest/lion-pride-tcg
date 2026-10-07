/**
 * Test of card-studio/src/admin-write.js (the Admin view editors) with a MOCK live client and a MOCK local copy (no database):
 *   node scripts/test-admin-write-routes.mjs
 * Invariants:
 *   W1 the flags: ADMIN_EDIT not 1 (or ADMIN_VIEW not 1) = every route 404, nothing is called
 *   W2 the login: with STUDIO_PASS set, no Basic Auth = 401
 *   W3 a write needs JSON and X-Admin-Write: 1 (else 403, nothing is called); PUT = 405
 *   W4 a bad change (kind, key, path, amount, reason, a secret) = 400 before any call
 *   W5 /apply calls the admin_* function of the kind on LIVE with the preview value as p_before and the actor studio:<user>;
 *      LP409 = 409, another database error = 400
 *   W6 /undo calls admin_undo; a stale undo = 409
 *   W7 /preview reads the live value: the difference, the member balance, the pull math
 *   W8 /test runs a rolled-back block on the LOCAL copy only (never live.rpc); a reader error or a bad pull sum = not ok;
 *      a Hunt key also runs the simulation; a local copy that does not answer or has no admin_write.sql = 409
 *   W9 /settings: a member list comes as members with names (never a bulk id list), a secret as hidden
 *   W10 /log: undoable only for a studio change that no action undid
 *   W11 the helpers: leafDiff, pullMath, huntPrizePacks, readRes, the SQL quoting of a reason with a quote
 *   W12 the local copy must be on this PC; W13 the refresh runs one job at a time with fixed arguments
 */
import express from 'express';
import { adminWriteRouter, leafDiff, pullMath, huntPrizePacks, readRes, testSql, localCopy, refresher, parseChange } from '../src/admin-write.js';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 400)}`); };
const ID1 = '123456789012345678', ID2 = '223456789012345678';

// The mock live client: a tiny query builder over fixed tables.
const TABLES = {
  balance: [{ key: 'round_cap', value: 40, note: 'n', updated_at: '2026-10-07T00:00:00Z', updated_by: 'x' },
    { key: 'pulls', value: { rates: { normal: 0.9398, illustrated_rare: 0.05, secret_rare: 0.006, full_art: 0.004, gold: 0.0002 }, pack_size: 5 }, note: 'p' }],
  settings: [{ key: 'ui_v3', value: { users: [ID1], enabled: false }, updated_at: 'x' }, { key: 'discord_immune', value: [ID2], updated_at: 'x' },
    { key: 'dungeon', value: { salt: 'abc', enabled: true }, updated_at: 'x' }],
  players: [{ id: ID1, username: 'tst one', pack_balance: 4, shard_balance: 10 }, { id: ID2, username: 'tst two', pack_balance: 0, shard_balance: 0 }],
  cards: [{ id: 7, name: 'Tst card', rarity: 'normal' }],
  player_cards: [],
  admin_actions: [{ id: 3, action: 'balance_set', source: 'studio', target_kind: 'balance', target_id: 'round_cap', before: { path: [], value: 39 }, after: { path: [], value: 40 }, undo_of: null },
    { id: 2, action: 'gift', source: 'bot', target_kind: 'player', target_id: ID1, after: { amount: 1 }, undo_of: null },
    { id: 1, action: 'member_packs', source: 'studio', target_kind: 'player', target_id: ID1, before: { packs: 0 }, after: { packs: 4, amount: 4 }, undo_of: null },
    { id: 4, action: 'member_packs', source: 'studio', target_kind: 'player', target_id: ID1, before: { packs: 4 }, after: { packs: 0, amount: -4 }, undo_of: 1 }],
};
const calls = [];
const live = {
  from(table) {
    const f = { eq: [], in: [] };
    const b = {
      select() { return b; }, order() { return b; }, range() { return b; },
      eq(c, v) { f.eq.push([c, v]); return b; }, in(c, v) { f.in.push([c, v]); return b; },
      async maybeSingle() { const r = await b; return { data: r.data[0] || null, error: null }; },
      then(res) {
        calls.push({ from: table });
        let rows = (TABLES[table] || []).filter((r) => f.eq.every(([c, v]) => r[c] === v) && f.in.every(([c, v]) => v.includes(r[c])));
        if (table === 'player_cards') rows = rows.map((r) => ({ ...r, cards: { name: 'Tst card', rarity: 'normal' } }));
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(res);
      },
    };
    return b;
  },
  async rpc(fn, args) {
    calls.push({ fn, args });
    if (args.p_before === 'stale' || args.p_action === 99) return { data: null, error: { code: 'LP409', message: 'admin: balance round_cap changed (now 40, expected 39). Preview the change again.' } };
    if (args.p_action === 98) return { data: null, error: { code: 'LP400', message: 'admin: an action gift from bot cannot be undone here' } };
    return { data: { action_id: 11 }, error: null };
  },
};
const localSql = [];
let localMode = 'ok';
const local = {
  async info() { return localMode === 'down' ? { configured: true, reachable: false } : { configured: true, reachable: true, has_admin_write: localMode !== 'old', newest_row: '2026-10-07T00:00:00Z' }; },
  async sql(q) {
    localSql.push(q);
    if (/^select value from balance/.test(q)) return [{ value: TABLES.balance.find((x) => q.includes(`'${x.key}'`))?.value ?? null }];
    if (/hunt_attack\(P, h, cid\)/.test(q)) throw new Error(`RES ${JSON.stringify({ before: { '8 Normal 3 stars': [[100, 10], [120, 12]] }, after: { '8 Normal 3 stars': [[110, 10], [130, 12]] }, tier: 'Heroic', trials: 2 })}`);
    const readers = localMode === 'reader_error' ? [{ fn: 'hunt_round_cap', ran: true, error: 'boom' }] : [{ fn: 'hunt_round_cap', ran: true, error: null }];
    throw new Error(`RES ${JSON.stringify({ before: 40, result: { action_id: 5 }, checks: { readers, balance_log: 1, admin_action: { action: 'balance_set' } } })}`);
  },
};
const start = (env) => new Promise((resolve) => {
  const app = express();
  app.use('/api/admin/edit', adminWriteRouter({ live, local, env, refresh: { start: () => ({ state: 'running' }), status: () => ({ state: 'idle' }) } }));
  const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
});
const auth = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
const W = { ...auth, 'content-type': 'application/json', 'x-admin-write': '1' };
const ENV = { ADMIN_VIEW: '1', ADMIN_EDIT: '1', STUDIO_USER: 'u', STUDIO_PASS: 'p' };

// W1
for (const env of [{ ...ENV, ADMIN_EDIT: '0' }, { ...ENV, ADMIN_VIEW: '0' }]) {
  const srv = await start(env);
  const base = `http://127.0.0.1:${srv.address().port}/api/admin/edit`;
  const before = calls.length + localSql.length;
  const a = await fetch(`${base}/status`, { headers: auth });
  const b = await fetch(`${base}/apply`, { method: 'POST', headers: W, body: JSON.stringify({ change: { kind: 'balance', key: 'round_cap', path: [], after: 41, reason: 'tst' }, before: 40 }) });
  check(`W1 ${env.ADMIN_EDIT !== '1' ? 'ADMIN_EDIT' : 'ADMIN_VIEW'} off: 404 and nothing called`, a.status === 404 && b.status === 404 && calls.length + localSql.length === before, [a.status, b.status]);
  srv.close();
}

const srv = await start(ENV);
const base = `http://127.0.0.1:${srv.address().port}/api/admin/edit`;
const post = (path, body, headers = W) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const change = { kind: 'balance', key: 'round_cap', path: [], after: 41, reason: 'tst reason' };

// W2
let r = await fetch(`${base}/status`);
check('W2 no login: 401', r.status === 401, r.status);
r = await fetch(`${base}/status`, { headers: auth });
check('W2 the right login: 200 with the local copy', r.status === 200 && (await r.json()).local.reachable === true, r.status);

// W3
let before = calls.length;
r = await post('/apply', { change, before: 40 }, { ...auth, 'content-type': 'application/json' });
check('W3 a write without X-Admin-Write: 403, nothing called', r.status === 403 && calls.length === before, r.status);
r = await fetch(`${base}/apply`, { method: 'POST', headers: { ...auth, 'x-admin-write': '1', 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
check('W3 a form post: 403, nothing called', r.status === 403 && calls.length === before, r.status);
r = await fetch(`${base}/apply`, { method: 'PUT', headers: W, body: '{}' });
check('W3 PUT: 405', r.status === 405, r.status);

// W4
const bad = [
  ['an unknown kind', { ...change, kind: 'drop' }], ['a bad key', { ...change, key: 'Round Cap;' }], ['a path that is not a list', { ...change, path: 'x' }],
  ['no reason', { ...change, reason: ' ' }], ['a secret path', { kind: 'setting', key: 'dungeon', path: ['salt'], after: 'x', reason: 'tst' }],
  ['an amount of 0', { kind: 'member_packs', player: ID1, amount: 0, reason: 'tst' }], ['too many packs', { kind: 'member_packs', player: ID1, amount: 5000, reason: 'tst' }],
  ['a bad member id', { kind: 'member_shards', player: "x' or 1=1", amount: 5, reason: 'tst' }], ['a card that is not a number', { kind: 'member_card', player: ID1, card: '7', amount: 1, reason: 'tst' }],
  ['no after', { ...change, after: null }],
];
before = calls.length + localSql.length;
const codes = [];
for (const [, c] of bad) { for (const p of ['/preview', '/test', '/apply']) codes.push((await post(p, { change: c, before: 1 })).status); }
check(`W4 ${bad.length} bad changes x preview / test / apply: 400, nothing called`, codes.every((c) => c === 400) && calls.length + localSql.length === before, codes);

// W5
r = await post('/apply', { change, before: 40 });
let j = await r.json();
check('W5 apply: admin_balance_set on live with the preview value and the actor', r.status === 200 && j.ok && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn: 'admin_balance_set',
  args: { p_actor: 'studio:u', p_key: 'round_cap', p_path: [], p_before: 40, p_after: 41, p_reason: 'tst reason', p_undo_of: null } }), calls.at(-1));
r = await post('/apply', { change, before: 'stale' });
check('W5 apply on a changed value: 409 with the message', r.status === 409 && /changed/.test((await r.json()).error), r.status);
r = await post('/apply', { change });
check('W5 apply with no before: 400', r.status === 400, r.status);
const kinds = [
  [{ kind: 'setting', key: 'ui_v3', path: ['enabled'], after: true, reason: 'tst' }, false, 'admin_setting_set', { p_before: false, p_path: ['enabled'] }],
  [{ kind: 'setting_member', key: 'ui_v3', path: ['users'], member: ID2, op: 'add', reason: 'tst' }, null, 'admin_setting_member', { p_member: ID2, p_add: true }],
  [{ kind: 'member_packs', player: ID1, amount: 3, reason: 'tst' }, 4, 'admin_member_packs', { p_player: ID1, p_amount: 3, p_before: 4 }],
  [{ kind: 'member_shards', player: ID1, amount: -5, reason: 'tst' }, 10, 'admin_member_shards', { p_amount: -5, p_before: 10 }],
  [{ kind: 'member_card', player: ID1, card: 7, amount: -1, reason: 'tst' }, 2, 'admin_member_card', { p_card: 7, p_amount: -1, p_before: 2 }],
];
for (const [c, b, fn, want] of kinds) {
  r = await post('/apply', { change: c, before: b });
  const last = calls.at(-1);
  check(`W5 apply ${c.kind}: ${fn} with the right arguments`, r.status === 200 && last.fn === fn && Object.entries(want).every(([k2, v]) => JSON.stringify(last.args[k2]) === JSON.stringify(v)), last);
}
r = await post('/apply', { change: kinds[2][0], before: '4' });
check('W5 a member change needs a whole-number before: 400', r.status === 400, r.status);

// W6
r = await post('/undo', { id: 3, reason: 'tst undo' });
check('W6 undo: admin_undo with the id, the actor and the reason', r.status === 200 && JSON.stringify(calls.at(-1)) === JSON.stringify({ fn: 'admin_undo', args: { p_actor: 'studio:u', p_action: 3, p_reason: 'tst undo' } }), calls.at(-1));
r = await post('/undo', { id: 99, reason: 'tst undo' });
check('W6 a stale undo: 409', r.status === 409, r.status);
r = await post('/undo', { id: 98, reason: 'tst undo' });
check('W6 a refused undo (LP400): 400', r.status === 400, r.status);
r = await post('/undo', { id: 'x', reason: 'tst undo' });
check('W6 a bad id: 400', r.status === 400, r.status);

// W7
r = await post('/preview', { change });
j = await r.json();
check('W7 preview: the live value and the difference', JSON.stringify(j.live) === JSON.stringify({ before: 40, diff: [{ path: [], before: 40, after: 41 }] }) && j.sim === true, j);
r = await post('/preview', { change: { kind: 'member_packs', player: ID1, amount: 3, reason: 'tst' } });
j = await r.json();
check('W7 preview of a member grant: before, after and the name', j.live.before === 4 && j.live.after === 7 && j.live.member_name === 'tst one', j.live);
r = await post('/preview', { change: { kind: 'balance', key: 'pulls', path: ['rates', 'gold'], after: 0.0003, reason: 'tst' } });
j = await r.json();
check('W7 preview of a pull rate: the sum check fails for a sum of 1.0001', j.pulls && j.pulls.sum_ok === false && j.pulls_now.sum_ok === true, j.pulls);
r = await post('/preview', { change: { kind: 'balance', key: 'nokey', path: [], after: 1, reason: 'tst' } });
check('W7 preview of an unknown key: 400', r.status === 400, r.status);

// W8
before = calls.filter((c) => c.fn).length;
localSql.length = 0;
r = await post('/test', { change: { ...change, key: 'round_cap' } });
j = await r.json();
check('W8 test: a rolled-back block on the local copy, never a live rpc', j.ok === true && calls.filter((c) => c.fn).length === before
  && localSql.some((q) => /admin_balance_set\('studio:u', 'round_cap'/.test(q) && /raise exception 'RES %'/.test(q)), j);
check('W8 test of a Hunt key: the simulation before and after', j.sim && j.sim.rows[0].before.mean === 110 && j.sim.rows[0].after.mean === 120, j.sim);
localMode = 'reader_error';
j = await (await post('/test', { change })).json();
check('W8 a reader that fails = the test is not ok', j.ok === false, j);
localMode = 'ok';
j = await (await post('/test', { change: { kind: 'balance', key: 'pulls', path: ['rates', 'gold'], after: 0.0003, reason: 'tst' } })).json();
check('W8 a pull sum that is not 1 = the test is not ok', j.ok === false && j.pulls.sum_ok === false, j.pulls);
localMode = 'down';
r = await post('/test', { change });
check('W8 the local copy does not answer: 409', r.status === 409, r.status);
localMode = 'old';
r = await post('/test', { change });
check('W8 the local copy has no admin_write.sql: 409', r.status === 409, r.status);
localMode = 'ok';

// W9
r = await fetch(`${base}/settings`, { headers: auth });
const txt = await r.text();
j = JSON.parse(txt);
const ui = j.rows.find((x) => x.key === 'ui_v3'), imm = j.rows.find((x) => x.key === 'discord_immune'), dg = j.rows.find((x) => x.key === 'dungeon');
check('W9 settings: member lists as members with names, the salt hidden', JSON.stringify(ui.value.users) === JSON.stringify({ $members: [{ id: ID1, username: 'tst one' }] })
  && imm.value.$members[0].username === 'tst two' && dg.value.salt.$hidden === true && !txt.includes('abc') && !/\["\d{17,20}"/.test(txt), j);

// W10
j = await (await fetch(`${base}/log`, { headers: auth })).json();
const u = Object.fromEntries(j.rows.map((x) => [x.id, x]));
check('W10 log: undoable only for a studio change not undone yet', u[3].undoable === true && u[2].undoable === false && u[1].undoable === false && u[1].undone_by === 4 && u[4].undoable === true && u[1].target_name === 'tst one', j.rows);
r = await fetch(`${base}/log?action=${encodeURIComponent("x'y")}`, { headers: auth });
check('W10 a bad filter: 400', r.status === 400, r.status);
srv.close();

// W11
check('W11 leafDiff lists the changed leaves only', JSON.stringify(leafDiff({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] })) === JSON.stringify([{ path: ['b', '1'], before: 2, after: 3 }]), leafDiff({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] }));
const pm = pullMath({ rates: { normal: 0.9398, illustrated_rare: 0.05, secret_rare: 0.006, full_art: 0.004, gold: 0.0002 }, pack_size: 5 });
check('W11 pullMath: the sum and 1 in N packs for Gold', pm.sum_ok && Math.abs(pm.rows[4].one_in_packs - 1000.4) < 0.1, pm.rows[4]);
check('W11 huntPrizePacks: 12 fighters with damage and 1 without', huntPrizePacks({ base: 1, ranks: [7, 5, 4, 3, 3, 3, 3, 3, 3, 3] }, 13, 12) === 37 + 2 + 1, huntPrizePacks({ base: 1, ranks: [7, 5, 4, 3, 3, 3, 3, 3, 3, 3] }, 13, 12));
check('W11 readRes: the RES json and an error text', readRes('RES {"a":1}').res?.a === 1 && readRes('ERROR:  LP409: admin: x changed\nCONTEXT: y').error === 'admin: x changed', readRes('ERROR:  LP409: admin: x changed\nCONTEXT: y'));
const sq = testSql(parseChange({ kind: 'member_packs', player: ID1, amount: 2, reason: "it's a fix" }), "studio:o'k");
check('W11 the SQL quotes a reason and an actor with a quote', sq.includes("'it''s a fix'") && sq.includes("'studio:o''k'") && !sq.includes("'it's"), sq.slice(0, 200));

// W12
let refused = false;
try { await localCopy({ LOCALDB_ENV: new URL('./.tmp-awr.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') }).sql('select 1'); } catch (e) { refused = /not set up/.test(e.message); }
check('W12 no env file: the local copy is not set up', refused, refused);
{
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const f = new URL('./.tmp-awr.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  writeFileSync(f, 'SUPABASE_URL=http://10.0.0.5:1\nSUPABASE_SERVICE_ROLE_KEY=x\nPGMETA_URL=http://10.0.0.5:2\n');
  let msg = ''; let fetched = false;
  try { await localCopy({ LOCALDB_ENV: f }, async () => { fetched = true; return new Response('[]'); }).sql('select 1'); } catch (e) { msg = e.message; }
  check('W12 a PGMETA_URL that is not on this PC is refused before a request', /this PC/.test(msg) && !fetched, msg);
  writeFileSync(f, 'SUPABASE_URL=http://127.0.0.1:1\nSUPABASE_SERVICE_ROLE_KEY=x\nPGMETA_URL=http://127.0.0.1:2\n');
  let body = '';
  await localCopy({ LOCALDB_ENV: f }, async (u2, o) => { body = o.body; return new Response('[]'); }).sql('select 1');
  check('W12 the local SQL runs as service_role (the role of the live API)', JSON.parse(body).query.startsWith('set role service_role;'), body);
  unlinkSync(f);
}

// W13
const spawned = [];
const fake = (cmd, a) => { spawned.push([cmd, a]); return { stdout: { on() {} }, stderr: { on() {} }, on() {} }; };
const rf = refresher({ LOCALDB_ENV: 'C:\\x\\lp-tst.env' }, fake);
rf.start(); rf.start();
check('W13 the refresh: one job, wsl.exe with the env file name and refresh.sh', spawned.length === 1 && spawned[0][0] === 'wsl.exe' && spawned[0][1].includes('LOCALDB_ENVFILE=lp-tst.env')
  && spawned[0][1].at(-1).endsWith('/localdb/refresh.sh') && rf.status().state === 'running', spawned);

console.log(fails ? `FAIL ${fails} of ${n}` : `PASS all ${n}`);
process.exit(fails ? 1 : 0);
