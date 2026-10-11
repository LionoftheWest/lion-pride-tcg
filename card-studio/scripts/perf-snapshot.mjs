/**
 * Database load snapshot (READ ONLY). Reads pg_stat_statements through the Supabase management API with read_only: true
 * (a read-only transaction: the database refuses any write), groups the statements by function or table, prints the top list
 * and saves a dated JSON under out/perf/ (out/ is never committed).
 *
 *   node scripts/perf-snapshot.mjs [--top 25] [--by total|calls|mean|max]      take a snapshot of the live project, print it, save it
 *   node scripts/perf-snapshot.mjs --diff out/perf/a.json out/perf/b.json      what changed between two snapshots (the load of the time between)
 *   node scripts/perf-snapshot.mjs --fixture answer.json                        use a saved API answer instead of the network (tests)
 *
 * Needs SUPABASE_ACCESS_TOKEN and SUPABASE_URL in card-studio/.env (the project ref is read from SUPABASE_URL).
 * The counters of pg_stat_statements are cumulative since the last reset of the project: take a snapshot before and after a
 * release (or a busy hour) and use --diff; a diff of two snapshots never resets anything.
 * No member data: the statements are normalised by Postgres ($1, $2), and the output holds only the function or table name.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The query: one row per statement text, the heaviest 1000 (the tail is a few ms in total).
export const SNAPSHOT_QUERY = `select query, calls::bigint, total_exec_time::float8, mean_exec_time::float8, max_exec_time::float8, rows::bigint
from extensions.pg_stat_statements order by total_exec_time desc limit 1000`;

const NOISE = /pg_stat_statements|pg_meta|information_schema|pg_catalog|set_config|^(BEGIN|COMMIT|SET|SHOW|RESET|DEALLOCATE)\b|^rpc (pg_|set_)|storage\.|supabase_migrations|realtime\./i;

// The name of a statement: the PostgREST function call ("public"."name"(...)), a read of a table, or a write.
export function labelOf(query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  // A PostgREST table write: WITH pgrst_source AS ( INSERT INTO "public"."t" ... ); a read: ... FROM "public"."t".
  const verb = q.match(/^with pgrst_source as \(\s*(insert|update|delete)\b/i);
  let m = verb && q.match(/\b(?:insert into|update|delete from)\s+"public"\."([a-z_0-9]+)"/i);
  if (m) return `${verb[1].toLowerCase()} ${m[1]}`;
  m = q.match(/"public"\."([a-z_0-9]+)"\(/);   // a function call (a table write was handled above: its table name is followed by a column list too)
  if (m) return `rpc ${m[1]}`;
  m = q.match(/\bfrom "public"\."([a-z_0-9]+)"/i);
  if (m && /^(with|select) /i.test(q)) return `read ${m[1]}`;
  m = q.match(/^(insert into|update|delete from)\s+(?:"?public"?\.)?"?([a-z_0-9]+)/i);
  if (m) return `${m[1].split(' ')[0].toLowerCase()} ${m[2]}`;
  m = q.match(/^select\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/i);
  if (m) return `call ${m[1]}`;
  return q.slice(0, 60);
}

// Group the raw rows by label: calls and total time add up, the mean follows from them, the max is the largest max.
export function summarize(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const label = labelOf(r.query);
    if (NOISE.test(label) || NOISE.test(String(r.query || '').slice(0, 120))) continue;
    const g = by.get(label) || { label, calls: 0, total_ms: 0, max_ms: 0, rows: 0 };
    g.calls += Number(r.calls) || 0; g.total_ms += Number(r.total_exec_time) || 0; g.rows += Number(r.rows) || 0;
    g.max_ms = Math.max(g.max_ms, Number(r.max_exec_time) || 0);
    by.set(label, g);
  }
  return [...by.values()].map((g) => ({ ...g, mean_ms: g.calls ? g.total_ms / g.calls : 0 }));
}

const KEY = { total: 'total_ms', calls: 'calls', mean: 'mean_ms', max: 'max_ms' };
export const sortBy = (list, by = 'total') => [...list].sort((a, b) => b[KEY[by] || 'total_ms'] - a[KEY[by] || 'total_ms']);

// The change between two snapshots. A label whose counter fell was reset in between: its new value counts as new.
export function diffSnapshots(a, b) {
  const old = new Map((a.rows || []).map((r) => [r.label, r]));
  const out = [];
  for (const r of b.rows || []) {
    const o = old.get(r.label);
    const reset = o && r.calls < o.calls;
    const calls = r.calls - (o && !reset ? o.calls : 0), total_ms = r.total_ms - (o && !reset ? o.total_ms : 0);
    if (calls <= 0 && total_ms <= 0.5) continue;
    out.push({ label: r.label, calls, total_ms, mean_ms: calls ? total_ms / calls : 0, max_ms: r.max_ms, before_calls: o ? o.calls : 0, reset: !!reset });
  }
  for (const [label, o] of old) if (!(b.rows || []).some((r) => r.label === label)) out.push({ label, calls: -o.calls, total_ms: -o.total_ms, mean_ms: 0, max_ms: o.max_ms, before_calls: o.calls, gone: true });
  const minutes = (Date.parse(b.taken_at) - Date.parse(a.taken_at)) / 60000;
  return { minutes: Number.isFinite(minutes) ? minutes : null, rows: out.sort((x, y) => y.total_ms - x.total_ms) };
}

const f0 = (n) => Number(n).toFixed(0), f1 = (n) => Number(n).toFixed(1);
export function formatTable(list, { top = 25 } = {}) {
  const lines = [`${'total ms'.padStart(11)} ${'calls'.padStart(9)} ${'mean ms'.padStart(8)} ${'max ms'.padStart(8)}  statement`];
  for (const g of list.slice(0, top)) lines.push(`${f0(g.total_ms).padStart(11)} ${f0(g.calls).padStart(9)} ${f1(g.mean_ms).padStart(8)} ${f0(g.max_ms).padStart(8)}  ${g.label}`);
  return lines.join('\n');
}
export function formatDiff(d, { top = 25 } = {}) {
  const per = d.minutes && d.minutes > 0 ? (n) => ` ${f1(n / d.minutes).padStart(9)}` : () => '';
  const lines = [`between the two snapshots: ${d.minutes == null ? '?' : f1(d.minutes)} minutes`,
    `${'total ms'.padStart(11)} ${'calls'.padStart(9)} ${'mean ms'.padStart(8)}${d.minutes ? ' ms/min'.padStart(10) : ''}  statement`];
  for (const g of d.rows.slice(0, top)) lines.push(`${f0(g.total_ms).padStart(11)} ${f0(g.calls).padStart(9)} ${f1(g.mean_ms).padStart(8)}${per(g.total_ms)}  ${g.label}${g.reset ? '  (counter was reset)' : ''}${g.gone ? '  (gone)' : ''}`);
  return lines.join('\n');
}

// One read-only call of the management API. read_only: true makes the database refuse every write of the statement.
export async function fetchRows({ token, ref, fetchImpl = fetch }) {
  const r = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SNAPSHOT_QUERY, read_only: true }),
  });
  const j = await r.json();
  if (!r.ok || !Array.isArray(j)) throw new Error(`snapshot failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

export function makeSnapshot(rawRows, { ref = null, now = new Date() } = {}) {
  const rows = sortBy(summarize(rawRows), 'total');
  return { taken_at: now.toISOString(), project: ref, statements: rawRows.length, totals: { calls: rows.reduce((t, r) => t + r.calls, 0), total_ms: rows.reduce((t, r) => t + r.total_ms, 0) }, rows };
}

async function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const top = Number(arg('--top', 25)), by = arg('--by', 'total');
  if (argv.includes('--diff')) {
    const [a, b] = argv.slice(argv.indexOf('--diff') + 1, argv.indexOf('--diff') + 3).map((f) => JSON.parse(readFileSync(f, 'utf8')));
    if (!a || !b) throw new Error('usage: --diff <older.json> <newer.json>');
    console.log(formatDiff(diffSnapshots(a, b), { top })); return;
  }
  let raw, ref = null;
  if (argv.includes('--fixture')) raw = JSON.parse(readFileSync(arg('--fixture'), 'utf8'));
  else {
    const dotenv = (await import('dotenv')).default; dotenv.config({ override: true, path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });
    const token = process.env.SUPABASE_ACCESS_TOKEN; ref = process.env.SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)/)?.[1];
    if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_URL are needed (card-studio/.env)');
    raw = await fetchRows({ token, ref });
  }
  const snap = makeSnapshot(raw, { ref });
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'perf'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `snapshot-${snap.taken_at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(snap, null, 1));
  console.log(`snapshot ${snap.taken_at}  ${snap.statements} statements, ${snap.totals.calls} calls, ${f0(snap.totals.total_ms)} ms in total`);
  console.log(formatTable(sortBy(snap.rows, by), { top }));
  console.log(`saved ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
