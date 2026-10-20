/**
 * Test of card-studio/src/ability-builder-routes.js (the ability builder of the Admin view, combat v2 PR T1) with a MOCK local copy (no database):
 *   node scripts/test-ability-builder-routes.mjs
 * Invariants:
 *   B1 the flag: ADMIN_VIEW not 1 = every route 404 and nothing is called
 *   B2 a write needs JSON and X-Admin-Write: 1 (else 403, nothing is called)
 *   B3 /check sends ONE ability_v2_check query to the LOCAL copy with the role and the ability as quoted literals (a quote cannot end the literal)
 *   B4 /batch/:name refuses a bad name, a bad row shape and a key twice (400) before any query
 *   B5 /batch/:name with a row that ability_v2_check refuses = 422 with the row and its errors, and NO file is written
 *   B6 /batch/:name with every row valid writes the file in ABILITY_V2_BATCH_DIR (never in the repo); /batch/:name reads it, /batches lists it
 *   B7 the default batch folder is outside the repo (the private discord-card-ideas folder beside it)
 */
import express from 'express';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilityBuilderRouter, batchDir } from '../src/ability-builder-routes.js';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 400)}`); };
const dir = mkdtempSync(join(tmpdir(), 'ab-batches-'));
const queries = [];
// the mock local copy: ability_v2_check refuses an ability named "BAD"
const local = {
  async sql(q) {
    queries.push(q);
    if (q.includes('ability_v2_numbers()')) return [{ b: { v2_pp: { budget: 10, tolerance: 0.6 }, ability_v2: { silver: { pp: 3, stars: 3 }, limits: {} }, statuses: {} }, roles: [{ key: 'striker', class: 'attacker' }], blocks: [] }];
    const m = q.match(/jsonb_array_elements\('(.*)'::jsonb\)/s);
    const rows = JSON.parse(m[1].replace(/''/g, "'"));
    return [{ r: rows.map(([role, ab]) => (ab.name === 'BAD' ? { ok: false, errors: ['the blocks cost 12 PP: the budget is 10 +/- 0.6'] } : { ok: true, errors: [], role, pp: 10, text: 'Hit the target for 140%.' })) }];
  },
  async info() { return { configured: true, reachable: true, file: 'localdb2.env' }; },
};
const start = (env) => new Promise((res) => { const app = express(); app.use('/api/admin/abilities', abilityBuilderRouter({ local, env })); const srv = app.listen(0, '127.0.0.1', () => res(srv)); });
const W = { 'content-type': 'application/json', 'x-admin-write': '1' };

// B1
let srv = await start({ ABILITY_V2_BATCH_DIR: dir });
let base = `http://127.0.0.1:${srv.address().port}/api/admin/abilities`;
let r = await fetch(`${base}/library`);
const r2 = await fetch(`${base}/check`, { method: 'POST', headers: W, body: JSON.stringify({ role: 'striker', ability: { name: 'x', blocks: [] } }) });
check('B1 ADMIN_VIEW off: every route 404, nothing is called', r.status === 404 && r2.status === 404 && queries.length === 0, [r.status, r2.status, queries.length]);
srv.close();

srv = await start({ ADMIN_VIEW: '1', ABILITY_V2_BATCH_DIR: dir });
base = `http://127.0.0.1:${srv.address().port}/api/admin/abilities`;
const post = (path, body, headers = W) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const GOOD = { key: 'tst-card', role: 'striker', ability: { name: "Tst O'Hit", blocks: [{ k: 'hit', x: 1.4 }] } };

// B2
r = await post('/check', { role: 'striker', ability: GOOD.ability }, { 'content-type': 'application/json' });
const r3 = await fetch(`${base}/batch/tst`, { method: 'POST', headers: { 'x-admin-write': '1', 'content-type': 'text/plain' }, body: 'rows' });
check('B2 a write with no X-Admin-Write or no JSON = 403, nothing is called', r.status === 403 && r3.status === 403 && queries.length === 0, [r.status, r3.status]);

// B3
r = await post('/check', { role: 'striker', ability: GOOD.ability }); let j = await r.json();
check('B3 /check: ONE ability_v2_check query on the LOCAL copy; the quote in the name is doubled inside the literal', r.status === 200 && j.check.ok && queries.length === 1
  && /ability_v2_check\(x\.v->>0, x\.v->1\)/.test(queries[0]) && queries[0].includes("Tst O''Hit"), [r.status, j, queries[0]?.slice(0, 200)]);
const lib = await (await fetch(`${base}/library`)).json();
check('B3 /library reads the roles and the numbers from the LOCAL copy', lib.ok && lib.budget === 10 && lib.roles[0].key === 'striker' && lib.local.reachable, lib);

// B4
queries.length = 0;
const bads = await Promise.all([post('/batch/Bad%20Name', { rows: [GOOD] }), post('/batch/tst', { rows: [{ ...GOOD, key: 'A B' }] }), post('/batch/tst', { rows: [GOOD, GOOD] }),
  post('/batch/tst', { rows: [{ ...GOOD, power: 9 }] }), post('/batch/tst', { rows: 'x' })]);
check('B4 a bad name, a bad key, a key twice, an unknown key and no list = 400 before any query', bads.every((x) => x.status === 400) && queries.length === 0, bads.map((x) => x.status));

// B5
r = await post('/batch/tst', { rows: [GOOD, { ...GOOD, key: 'tst-two', ability: { ...GOOD.ability, name: 'BAD' } }] }); j = await r.json();
check('B5 one refused row = 422 with the row and its errors; no file is written', r.status === 422 && j.refused.length === 1 && j.refused[0].row === 2 && /budget/.test(j.refused[0].errors[0]) && !existsSync(join(dir, 'tst.json')), [r.status, j]);

// B6
r = await post('/batch/tst', { rows: [GOOD, { ...GOOD, key: 'tst-two', note: 'a note' }] }); j = await r.json();
const file = join(dir, 'tst.json');
const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
const back = await (await fetch(`${base}/batch/tst`)).json();
const list = await (await fetch(`${base}/batches`)).json();
check('B6 every row valid: the file is written in ABILITY_V2_BATCH_DIR; /batch reads it; /batches lists it', r.status === 200 && j.rows === 2 && saved?.rows?.length === 2 && saved.rows[1].note === 'a note'
  && /PRIVATE/.test(saved.about) && back.rows.length === 2 && list.batches.some((b) => b.name === 'tst' && b.rows === 2), [r.status, j, list]);
srv.close();

// B7
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const def = resolve(batchDir({}));
check('B7 the default batch folder is outside the repo (the private discord-card-ideas/batches beside it)', !def.startsWith(repo + '\\') && !def.startsWith(repo + '/') && /discord-card-ideas[\\/]batches$/.test(def), [def, repo]);
rmSync(dir, { recursive: true, force: true });
console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
process.exitCode = fails ? 1 : 0;
