/**
 * The Admin view Test lab (Phase 3): try a set of balance changes (a scenario) on the LOCAL copy with a simulation, BEFORE
 * and AFTER with the same seeds, then hand the same changes to the Phase 2 Apply path (src/admin-write.js POST /apply).
 *
 *   GET  /sims                the simulations and their parameters (src/sims/index.js)
 *   GET  /balance             the balance keys of the LOCAL copy (the values a scenario starts from)
 *   GET  /scenarios           the saved scenarios;  POST /scenarios (save or replace by name);  POST /scenarios/delete {id}
 *   POST /run                 { changes, sim, params }: starts a run in the background (202); 409 while another run runs
 *   GET  /job                 the run now or the last run: state, progress, the result (baseline, scenario, metrics)
 *   POST /job/cancel          cancels the run (pg_cancel_backend on its SQL)
 *   POST /plan                { changes }: for Apply live, one change per key from the LIVE value now (the optimistic
 *                             before value). Only for the changes of the last FINISHED run. The page then sends each to
 *                             POST /api/admin/edit/apply (admin_balance_set on live: one admin_actions row per key; Undo
 *                             from the Admin log). The lab has no write path of its own.
 *
 * A scenario change: { key, path, after } on the balance table (the same checks as the Balance editor: parseChange, and
 * in the block admin_balance_set with its type, shape and pull-rate checks). The changes of one key become ONE call with
 * the whole key (the same call Apply live makes). The prelude runs first in every simulation block and rolls back with it.
 *
 * The LOCAL copy only: the run refuses when the local copy points at a host that is not this PC. Every simulation fights
 * PRIVATE boss rows and test members (src/sims/*). One run at a time; a time limit (ADMIN_LAB_LIMIT_S, default 900 s).
 * Saved scenarios: card-studio/lab-scenarios.local.json (git-ignored: *.local.json). They hold balance keys and values
 * only (no member data).
 * Protection: adminGate (ADMIN_VIEW=1, the studio login) + the flag ADMIN_LAB=1 (off = 404); a write needs JSON and the
 * header X-Admin-Write: 1.
 */
import express from 'express';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { adminGate } from './admin-routes.js';
import { parseChange, localCopy, BadRequest, getPath, setAt, lit } from './admin-write.js';
import { SIMS, labParams, compareMetrics } from './sims/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SCENARIO_FILE = join(ROOT, 'lab-scenarios.local.json');
const LOOP = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;
const MAX_CHANGES = 20;

/** The scenario changes, checked like the Balance editor (parseChange, kind balance). */
export function parseChanges(list) {
  if (!Array.isArray(list) || !list.length) throw new BadRequest('changes: add at least one change');
  if (list.length > MAX_CHANGES) throw new BadRequest(`changes: at most ${MAX_CHANGES}`);
  const out = list.map((c) => {
    const ch = parseChange({ kind: 'balance', key: c?.key, path: c?.path || [], after: c?.after, reason: 'Test lab' });
    return { key: ch.key, path: ch.path, after: ch.after };
  });
  const seen = new Set();
  for (const c of out) {
    const id = `${c.key}\u0000${c.path.join('\u0000')}`;
    if (seen.has(id)) throw new BadRequest(`changes: ${c.key} ${c.path.join('.')} twice`);
    seen.add(id);
  }
  for (const c of out) {
    if (out.some((o) => o !== c && o.key === c.key && o.path.length < c.path.length && o.path.every((p, i) => p === c.path[i]))) {
      throw new BadRequest(`changes: ${c.key} ${c.path.join('.')} is inside another change of the same key`);
    }
  }
  return out;
}

const byKey = (changes) => {
  const m = new Map();
  for (const c of changes) m.set(c.key, [...(m.get(c.key) || []), c]);
  return m;
};
const arr = (path) => `${lit(`{${path.map((p) => `"${String(p).replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`)}::text[]`;

/**
 * The prelude of a scenario: per key, the whole value with the leaves set, through admin_balance_set (the function Apply
 * live calls). A leaf must exist and keep its JSON type (the Balance editor rule).
 */
export function preludeSql(changes, actor) {
  return [...byKey(changes)].map(([key, list]) => `declare v_before jsonb; v_after jsonb; begin
    select value into v_before from balance where key = ${lit(key)};
    if v_before is null then raise exception 'lab: no balance key %', ${lit(key)}; end if;
    v_after := v_before;
${list.map((c) => `    if v_before #> ${arr(c.path)} is null then raise exception 'lab: balance % has no value at %', ${lit(key)}, ${lit(c.path.join('.'))}; end if;
    if jsonb_typeof(v_before #> ${arr(c.path)}) <> jsonb_typeof(${lit(JSON.stringify(c.after))}::jsonb) then
      raise exception 'lab: balance % % must stay a %', ${lit(key)}, ${lit(c.path.join('.'))}, jsonb_typeof(v_before #> ${arr(c.path)}); end if;
    v_after := ${c.path.length ? `jsonb_set(v_after, ${arr(c.path)}, ${lit(JSON.stringify(c.after))}::jsonb, false)` : `${lit(JSON.stringify(c.after))}::jsonb`};`).join('\n')}
    perform admin_balance_set(${lit(actor)}, ${lit(key)}, '{}'::text[], v_before, v_after, 'Test lab scenario');
  end;`).join('\n  ');
}

/** One change per key for Apply live: the live value now (before) and the value with the leaves set (after). */
export function applyPlan(changes, liveRows, tested = {}) {
  return [...byKey(changes)].map(([key, list]) => {
    const row = liveRows.find((r) => r.key === key);
    if (!row) throw new BadRequest(`no balance key ${key} on live`);
    let after = structuredClone(row.value);
    const leaves = list.map((c) => {
      const live = getPath(row.value, c.path);
      if (live === undefined) throw new BadRequest(`balance ${key} has no value at ${c.path.join('.')} on live`);
      after = setAt(after, c.path, structuredClone(c.after));
      const t = tested[`${key}\u0000${c.path.join('\u0000')}`];
      return { path: c.path, live, tested_before: t === undefined ? null : t, after: c.after,
        live_matches_tested: t !== undefined && JSON.stringify(t) === JSON.stringify(live) };
    });
    return { key, before: row.value, after, leaves, live_matches_tested: leaves.every((l) => l.live_matches_tested) };
  });
}

/** The saved scenarios (a git-ignored file). */
export function scenarioStore(file = SCENARIO_FILE) {
  const read = () => {
    if (!existsSync(file)) return [];
    try { const j = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(j.scenarios) ? j.scenarios : []; } catch { return []; }
  };
  const write = (list) => { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify({ scenarios: list }, null, 1)); renameSync(tmp, file); };
  return {
    list: read,
    save(s) {
      const list = read();
      const i = list.findIndex((x) => x.name === s.name);
      const row = { id: i >= 0 ? list[i].id : randomUUID(), ...s, saved_at: new Date().toISOString() };
      if (i >= 0) list[i] = row; else list.push(row);
      if (list.length > 200) throw new BadRequest('at most 200 saved scenarios');
      write(list);
      return row;
    },
    remove(id) { const list = read(); const next = list.filter((x) => x.id !== id); write(next); return list.length !== next.length; },
  };
}

/** The LOCAL copy, or an error when it points at another host. */
export function assertLocal(local) {
  const v = local.read?.();
  if (!v) throw new BadRequest('The local copy is not set up. Refresh the local copy.');
  if (!LOOP.test(String(v.PGMETA_URL || ''))) throw new BadRequest('The Test lab runs only on the local copy on this PC (PGMETA_URL).');
  if (v.SUPABASE_URL && !LOOP.test(String(v.SUPABASE_URL))) throw new BadRequest('The Test lab runs only on the local copy: its SUPABASE_URL is not on this PC.');
  return v;
}

/** The background runner: one run at a time, progress, cancel, a time limit. */
export function labRunner({ local, sims = SIMS, limitMs = 900000, now = () => Date.now() }) {
  let job = null;
  const cancelSql = (id) => `select count(pg_cancel_backend(pid)) n from pg_stat_activity where pid <> pg_backend_pid() and query like ${lit(`%lptcg-lab:${id}%`)}`;
  const cancel = async (why = 'cancelled') => {
    if (!job || job.state !== 'running') return job;
    job.cancel = why;
    try { await local.sql(cancelSql(job.id), { role: null }); } catch { /* the run ends by itself */ }
    return job;
  };
  const start = ({ changes, sim, params, actor }) => {
    if (job?.state === 'running') { const e = new BadRequest('A run is running. Wait for it or cancel it.'); e.status = 409; throw e; }
    const s = sims[sim];
    const id = randomUUID();
    job = { id, state: 'running', sim, label: s.label, params, changes, started_at: new Date(now()).toISOString(), ended_at: null,
      progress: { phase: 'baseline', done: 0, total: 1, item: null }, result: null, error: null, cancel: null };
    const j = job;
    const q = (sql) => local.sql(`/* lptcg-lab:${id} */\n${sql}`);
    const timer = setTimeout(() => { cancel('time limit'); }, limitMs);
    timer.unref?.();
    (async () => {
      try {
        // the LOCAL values the scenario starts from (Apply live warns when live differs)
        const tested = {};
        for (const [key, list] of byKey(changes)) {
          const [row] = await local.sql(`select value from balance where key = ${lit(key)}`);
          if (!row) throw new BadRequest(`no balance key ${key} on the local copy`);
          for (const c of list) {
            const v = getPath(row.value, c.path);
            if (v === undefined) throw new BadRequest(`balance ${key} has no value at ${c.path.join('.')} on the local copy`);
            if (JSON.stringify(v) === JSON.stringify(c.after)) throw new BadRequest(`balance ${key} ${c.path.join('.')}: the new value is the same as the local value`);
            tested[`${key}\u0000${c.path.join('\u0000')}`] = v;
          }
        }
        const opts = (phase) => ({ onProgress: (done, total, item) => { j.progress = { phase, done, total, item: item || null }; }, isCancelled: () => Boolean(j.cancel) });
        const base = await s.mod.run(q, params, opts('baseline'));
        if (j.cancel) throw new Error(j.cancel);
        let scen = null;
        if (s.compare) {
          scen = await s.mod.run(q, params, { ...opts('scenario'), prelude: preludeSql(changes, actor) });
          if (j.cancel) throw new Error(j.cancel);
        }
        j.result = { baseline: base.summary, scenario: scen?.summary || null, metrics: compareMetrics(sim, base.summary, scen?.summary || null), tested,
          compare: s.compare };
        j.state = 'done';
      } catch (e) {
        j.state = j.cancel ? 'cancelled' : 'failed';
        j.error = j.cancel === 'time limit' ? `The run passed the time limit (${Math.round(limitMs / 1000)} s)` : j.cancel ? 'Cancelled' : String(e?.message || e).replace(/^admin: /, '').slice(0, 600);
      } finally {
        clearTimeout(timer);
        j.ended_at = new Date(now()).toISOString();
      }
    })();
    return job;
  };
  const view = () => (job ? { ...job, cancel: undefined } : { state: 'idle' });
  return { start, cancel, status: view, current: () => job };
}

export function labRouter({ live, local = localCopy(), store = scenarioStore(), runner = null, env = process.env, sims = SIMS }) {
  if (!live) throw new Error('labRouter needs the live client');
  const run = runner || labRunner({ local, sims, limitMs: 1000 * (Number(env.ADMIN_LAB_LIMIT_S) || 900) });
  const actor = () => `studio:${env.STUDIO_USER || 'studio'}`;
  const r = express.Router();
  r.use(adminGate(env));
  r.use((req, res, next) => (env.ADMIN_LAB === '1' ? next() : res.status(404).json({ error: 'not found' })));
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!/^application\/json\b/.test(req.headers['content-type'] || '') || req.headers['x-admin-write'] !== '1') {
      return res.status(403).json({ error: 'a write needs JSON and the header X-Admin-Write: 1' });
    }
    return next();
  });
  r.use(express.json({ limit: '64kb' }));
  const wrap = (fn) => async (req, res) => {
    try { return await fn(req, res); } catch (e) {
      if (e instanceof BadRequest) return res.status(e.status || 400).json({ error: e.message });
      if (/must be|is not|not allowed|parameter/.test(e?.message || '')) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: 'test lab route failed' });
    }
  };

  r.get('/sims', (req, res) => res.json({ sims: Object.entries(sims).map(([id, s]) => ({ id, label: s.label, compare: s.compare, fields: s.fields })),
    edit: env.ADMIN_EDIT === '1' }));
  r.get('/balance', wrap(async (req, res) => {
    assertLocal(local);
    const rows = await local.sql('select key, value, note from balance order by key');
    return res.json({ rows });
  }));
  r.get('/scenarios', (req, res) => res.json({ scenarios: store.list() }));
  r.post('/scenarios', wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.name !== 'string' || b.name.trim().length < 2 || b.name.length > 80) throw new BadRequest('name must be 2 to 80 characters');
    if (!sims[b.sim]) throw new BadRequest('sim is not allowed');
    const changes = parseChanges(b.changes);
    const params = labParams(b.sim, b.params || {});
    return res.json({ scenario: store.save({ name: b.name.trim(), sim: b.sim, params, changes }) });
  }));
  r.post('/scenarios/delete', wrap(async (req, res) => {
    if (typeof req.body?.id !== 'string' || !/^[0-9a-f-]{36}$/.test(req.body.id)) throw new BadRequest('id is not allowed');
    return res.json({ deleted: store.remove(req.body.id) });
  }));

  r.post('/run', wrap(async (req, res) => {
    const b = req.body || {};
    if (!sims[b.sim]) throw new BadRequest('sim is not allowed');
    const changes = parseChanges(b.changes);
    const params = labParams(b.sim, b.params || {});
    assertLocal(local);
    const info = await local.info();
    if (!info.reachable) return res.status(409).json({ error: 'The local copy does not answer. Refresh the local copy.' });
    if (!info.has_admin_write) return res.status(409).json({ error: 'The local copy has no admin_write.sql. Refresh the local copy after the migration.' });
    try { return res.status(202).json(run.start({ changes, sim: b.sim, params, actor: actor() })); } catch (e) {
      if (e.status === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
  }));
  r.get('/job', (req, res) => res.json(run.status()));
  r.post('/job/cancel', wrap(async (req, res) => res.json(await run.cancel())));

  r.post('/plan', wrap(async (req, res) => {
    const changes = parseChanges(req.body?.changes);
    const j = run.current();
    if (!j || j.state !== 'done' || !j.result?.compare) return res.status(409).json({ error: 'Run the scenario first: Apply needs a finished run.' });
    if (JSON.stringify(j.changes) !== JSON.stringify(changes)) return res.status(409).json({ error: 'The changes differ from the last run. Run the scenario again.' });
    const keys = [...new Set(changes.map((c) => c.key))];
    const { data, error } = await live.from('balance').select('key, value').in('key', keys);
    if (error) throw new BadRequest(error.message || String(error));
    return res.json({ plan: applyPlan(changes, data || [], j.result.tested) });
  }));
  r.use((err, req, res, next) => (err && err.type === 'entity.parse.failed' ? res.status(400).json({ error: 'the body is not valid JSON' }) : next(err)));
  return r;
}
