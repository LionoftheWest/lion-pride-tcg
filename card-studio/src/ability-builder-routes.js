/**
 * The ability builder of the Admin view (combat v2 PR T1, docs/combat-redesign-plan.md 12.1): pick the role, pick the blocks of the block library,
 * fill the numbers; the PP meter, the card text, the Silver line and the "Makes / Uses" chips come from ONE SQL check on the LOCAL copy
 * (ability_v2_check, tcg-bot/supabase/combat_v2_ability_builder.sql), not from JS math. Output: a batch file of ability_v2 rows that
 * scripts/push-abilities.mjs --v2 pushes later.
 *   GET  /library          the roles, the block library (ability_blocks with its rules), the statuses and the numbers (budget, Silver, limits)
 *   POST /check            {role, ability}: ability_v2_check on the LOCAL copy (ok, errors, pp, pps, text, silver line, enables, pays)
 *   GET  /batches          the batch files (name, rows, modified)
 *   GET  /batch/:name      one batch file
 *   POST /batch/:name      {rows}: every row is checked on the LOCAL copy first; one refused row = nothing is written. Then the file is written.
 * The batch folder is PRIVATE (unreleased card designs): ABILITY_V2_BATCH_DIR, else <repo parent>/discord-card-ideas/batches. Never this repo.
 * Protection: the admin gate (ADMIN_VIEW=1 + the studio login, src/admin-routes.js). A write needs JSON and the header X-Admin-Write: 1.
 * The LOCAL copy: LOCALDB_ENV (default %TEMP%/localdb.env), the same reader as the editors (src/admin-write.js localCopy).
 * Usage in server.js: app.use('/api/admin/abilities', abilityBuilderRouter()) BEFORE the read-only router.
 */
import express from 'express';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminGate } from './admin-routes.js';
import { localCopy, lit } from './admin-write.js';

export const batchDir = (env = process.env) => env.ABILITY_V2_BATCH_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'discord-card-ideas', 'batches');
export const BATCH_NAME = /^[a-z0-9][a-z0-9_-]{0,60}$/;
export const MAX_ROWS = 400;
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;

class BadRequest extends Error {}
// One row of a batch: {key, role, ability: {name, blocks, silver?}}. The shape only; ability_v2_check decides the rest.
export function rowShape(r, i) {
  const at = `row ${i + 1}`;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new BadRequest(`${at}: a row is {key, role, ability}`);
  if (typeof r.key !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,80}$/.test(r.key)) throw new BadRequest(`${at}: the key is a card key (lower case letters, digits, - and _)`);
  if (typeof r.role !== 'string' || !/^[a-z_]{1,30}$/.test(r.role)) throw new BadRequest(`${at}: the role is a role key`);
  if (!r.ability || typeof r.ability !== 'object' || Array.isArray(r.ability)) throw new BadRequest(`${at}: the ability is {name, blocks, silver?}`);
  const extra = Object.keys(r).filter((k) => !['key', 'role', 'ability', 'note'].includes(k));
  if (extra.length) throw new BadRequest(`${at}: unknown key ${extra[0]}`);
  return { key: r.key, role: r.role, ability: r.ability, ...(typeof r.note === 'string' && r.note ? { note: r.note.slice(0, 500) } : {}) };
}

export function abilityBuilderRouter({ local = localCopy(), env = process.env } = {}) {
  const r = express.Router();
  r.use(adminGate(env));
  r.use(express.json({ limit: '1mb' }));
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.get('x-admin-write') !== '1' || !req.is('application/json')) return res.status(403).json({ ok: false, error: 'a write needs JSON and the header X-Admin-Write: 1' });
    return next();
  });
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ ok: false, error: e.message });
      const msg = String(e.message || e).split('\n')[0];
      return res.status(/ability_v2_|ability_blocks|does not exist/.test(msg) ? 409 : 502).json({ ok: false, error: /does not exist/.test(msg)
        ? `The local copy has no combat_v2_ability_builder.sql (${msg}). Apply it on the local copy.` : msg });
    }
  };
  const one = async (q) => (await local.sql(q))[0] || {};
  // the checks of many rows in one query (the order of the rows)
  const checkRows = async (rows) => (await one(`select coalesce(jsonb_agg(ability_v2_check(x.v->>0, x.v->1) order by x.o), '[]'::jsonb) as r
    from jsonb_array_elements(${jlit(rows.map((x) => [x.role, x.ability]))}) with ordinality x(v, o)`)).r || [];

  r.get('/library', wrap(async (req, res) => {
    const row = await one(`select ability_v2_numbers() as b,
      (select jsonb_agg(jsonb_build_object('key', key, 'class', class) order by class, key) from roles) as roles,
      (select jsonb_agg(jsonb_build_object('key', key, 'ord', ord, 'grp', grp, 'classes', classes, 'once', once, 'fields', fields, 'amount', amount, 'rule', rule,
         'reserved', reserved, 'attach', attach, 'hosts', hosts) order by ord) from ability_blocks) as blocks`);
    const b = row.b || {};
    res.json({ ok: true, local: await local.info(), roles: row.roles || [], blocks: row.blocks || [],
      statuses: Object.entries(b.statuses || {}).map(([key, s]) => ({ key, ...s })).sort((x, y) => x.ord - y.ord),
      budget: b.v2_pp?.budget, tolerance: b.v2_pp?.tolerance, silver: b.ability_v2?.silver, limits: b.ability_v2?.limits, batch_dir: batchDir(env) });
  }));

  r.post('/check', wrap(async (req, res) => {
    const row = rowShape({ key: 'x', role: req.body?.role, ability: req.body?.ability }, 0);
    const [out] = await checkRows([row]);
    res.json({ ok: true, check: out });
  }));

  const fileOf = (name) => {
    if (!BATCH_NAME.test(String(name || ''))) throw new BadRequest('a batch name is 1 to 61 lower case letters, digits, - or _');
    return join(batchDir(env), `${name}.json`);
  };
  r.get('/batches', wrap(async (req, res) => {
    const dir = batchDir(env);
    const list = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && BATCH_NAME.test(f.slice(0, -5))).map((f) => {
      const p = join(dir, f); let rows = null;
      try { rows = (JSON.parse(readFileSync(p, 'utf8')).rows || []).length; } catch { /* not a batch */ }
      return { name: f.slice(0, -5), rows, modified: statSync(p).mtime.toISOString() };
    }).sort((a, b) => (a.modified < b.modified ? 1 : -1)) : [];
    res.json({ ok: true, dir, batches: list });
  }));
  r.get('/batch/:name', wrap(async (req, res) => {
    const p = fileOf(req.params.name);
    if (!existsSync(p)) return res.status(404).json({ ok: false, error: `no batch ${req.params.name}` });
    const data = JSON.parse(readFileSync(p, 'utf8'));
    res.json({ ok: true, name: req.params.name, rows: Array.isArray(data.rows) ? data.rows : [], about: data.about || null });
  }));
  r.post('/batch/:name', wrap(async (req, res) => {
    const p = fileOf(req.params.name);
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new BadRequest(`rows is a list of 0 to ${MAX_ROWS} rows`);
    const clean = rows.map(rowShape);
    const dup = clean.find((x, i) => clean.findIndex((y) => y.key === x.key) !== i);
    if (dup) throw new BadRequest(`the key ${dup.key} is twice in the batch`);
    const checks = await checkRows(clean);
    const bad = checks.map((c, i) => (c.ok ? null : { row: i + 1, key: clean[i].key, errors: c.errors })).filter(Boolean);
    if (bad.length) return res.status(422).json({ ok: false, error: `${bad.length} row(s) refused by ability_v2_check: nothing written`, refused: bad });
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify({ about: 'PRIVATE. A batch of combat v2 actives (subjects.ability_v2) from the Admin ability builder. Push: node scripts/push-abilities.mjs --v2 <this file>. Never commit to the public repo.',
      saved_at: new Date().toISOString(), rows: clean }, null, 1));
    renameSync(tmp, p);
    res.json({ ok: true, name: req.params.name, rows: clean.length });
  }));
  return r;
}
