/**
 * The shared parts of the simulations (card-studio/src/sims/*.js). A simulation is a DO block that always ends with
 * RAISE EXCEPTION 'SIMRES <json>': nothing it does stays in the database. It runs only on the LOCAL copy.
 *
 * q(sql): the executor. It returns the rows, or throws an Error whose message holds the database error text.
 *   - the studio: localCopy().sql (src/admin-write.js, postgres-meta on this PC, as service_role);
 *   - a CLI script: cliQuery() below (the Management API URL, which scripts/localdb-preload.mjs sends to the local copy).
 * prelude: SQL statements that run first INSIDE the block (the Test lab puts the scenario changes there: they roll back
 * with everything else). The same seeds run with and without the prelude.
 */
export const MARK = 'SIMRES';

/** The JSON after SIMRES in an error text (postgres-meta or the Management API shape), else null. */
export function simJson(msg) {
  const s = String(msg ?? '');
  const i = s.indexOf(`${MARK} `);
  if (i < 0) return null;
  let t = s.slice(i + MARK.length + 1);
  for (let k = 0; k < 4; k++) {
    try { return JSON.parse(t); } catch { /* cut the tail and try again */ }
    t = t.replace(/\n(CONTEXT|HINT|DETAIL|QUERY|WHERE):[\s\S]*$/, '').replace(/"\s*}\s*$/, '').trim();
    if (k === 1) t = t.replace(/\\"/g, '"').replace(/\n/g, '\n');
  }
  return null;
}

/** The first line of a database error, without the SQLSTATE prefix. */
export const errText = (msg) => String(msg ?? '').replace(/^Failed to run sql query:\s*/, '').replace(/^ERROR:\s+([A-Z0-9]{5}:\s*)?/, '').split('\nCONTEXT:')[0].trim().slice(0, 600);

export class SimError extends Error {}

/** Run one rolled-back block and return its SIMRES json. A block that did not raise SIMRES is an error. */
export async function runBlock(q, sql) {
  let msg;
  try {
    await q(sql);
    throw new SimError('the simulation block did not roll back (no SIMRES)');
  } catch (e) {
    if (e instanceof SimError) throw e;
    msg = e?.message || String(e);
  }
  const j = simJson(msg);
  if (j == null) throw new SimError(errText(msg));
  return j;
}

/** A SQL text literal. */
export const lit = (s) => `'${String(s).replace(/\0/g, '').replace(/'/g, "''")}'`;

/** Check a whole number parameter (the default when missing). */
export function intParam(v, name, min, max, def) {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new SimError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}
export function numParam(v, name, min, max, def) {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new SimError(`${name} must be a number from ${min} to ${max}`);
  return n;
}
export function oneOf(v, name, list, def) {
  if (v == null || v === '') return def;
  if (!list.includes(v)) throw new SimError(`${name} must be one of ${list.join(', ')}`);
  return v;
}

/** A seeded random number generator (mulberry32) for the JavaScript side (the kill odds resampling). */
export function rng(seed) {
  let a = (Math.floor(seed * 2 ** 31) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/**
 * The executor of a CLI script: the Management API SQL endpoint. It refuses to run unless LOCALDB=1 (the preload sends
 * the request to the local copy; without it the request would reach the LIVE project). allowLive: a read-only report.
 */
export function cliQuery({ allowLive = false } = {}) {
  if (process.env.LOCALDB !== '1' && !allowLive) {
    console.error('This simulation runs only on the LOCAL copy:\n  LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/<name>.mjs ...');
    process.exit(2);
  }
  const t = process.env.SUPABASE_ACCESS_TOKEN || 'local';
  const ref = (process.env.SUPABASE_URL || '').match(/https?:\/\/([a-z0-9]+)/)?.[1] || 'local';
  return async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* text */ }
    if (r.ok) return Array.isArray(j) ? j : [];
    throw new Error(j?.message || j?.error || text);
  };
}
