/**
 * Find the migration files that would put an OLD version back if someone ran them again today, and write
 * tcg-bot/supabase/SUPERSEDED.md (apply-sql.mjs refuses those files unless --force-superseded).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/find-superseded.mjs     (from card-studio/)
 *
 * It runs ONLY on the LOCAL copy: it talks to the local postgres-meta (PGMETA_URL in LOCALDB_ENV) directly and
 * never to a supabase.co / supabase.com host. Each file is measured inside ONE transaction that always rolls
 * back: the statements, then lockdown_grants.sql (as apply-sql.mjs does), then a DO block that reads the
 * structure and RAISES it as an error. The error aborts the transaction, so nothing stays (proved at the end:
 * the structure of the local copy is compared with the start).
 *
 * The statements of a file, one by one:
 *  - begin / commit / start transaction / end: removed (the file runs in the measuring transaction).
 *  - rollback, savepoint, vacuum, create database, alter system, ... concurrently: the file is NOT run (listed).
 *  - notify / listen: not run (no structure, no row).
 *  - data statements (insert, update, delete, merge, truncate, copy, a top-level select or call, and a
 *    DO block that writes rows or calls cron): NOT run. They are listed as "writes rows".
 *  - all other statements (create, alter, drop, grant, revoke, comment, set, a guard DO block): run.
 * Then: a function whose md5 differs from the start = the file reverts it. A function, table or cron job that
 * the file makes and live does not have = the file brings it back. If the run stops at an error, each
 * "create function" statement of the file is measured alone (the conservative answer).
 * cron.schedule calls are compared with db/schema/cron-jobs.sql (live), not run.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { flattenAnd } from './schema-snapshot-lib.mjs';

if (process.env.LOCALDB !== '1') { console.error('find-superseded: LOCAL copy only: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/find-superseded.mjs'); process.exit(2); }
const envFile = process.env.LOCALDB_ENV || join(process.env.TEMP || tmpdir(), 'localdb.env');
const META = (readFileSync(envFile, 'utf8').match(/^PGMETA_URL=(.*)$/m)?.[1] || '').trim().replace(/\/+$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(META)) { console.error(`find-superseded: PGMETA_URL in ${envFile} is not a local address: refused`); process.exit(2); }

const DIR = fileURLToPath(new URL('../../tcg-bot/supabase/', import.meta.url));
const OUT = join(DIR, 'SUPERSEDED.md');
const CRON_SNAPSHOT = fileURLToPath(new URL('../../db/schema/cron-jobs.sql', import.meta.url));
const ONLY = process.argv.slice(2).filter((a) => a.endsWith('.sql'));

const meta = async (query) => {
  const r = await fetch(`${META}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { error: text }; }
  return r.ok ? { rows: j } : { error: j.message || j.error || text, code: j.code };
};

// ---- Split a SQL file into top-level statements (quotes, E'' strings, "identifiers", $tag$ bodies, comments). ----
export function splitSql(src) {
  const out = []; let cur = ''; let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '-' && n === '-') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; cur += src.slice(i, e); i = e; continue; }
    if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; cur += src.slice(i, e); i = e; continue; }
    if (c === "'") {
      const esc = /[eE]$/.test(cur) && !/[\w$]$/.test(cur.slice(0, -1));
      let j = i + 1;
      while (j < src.length) { if (esc && src[j] === '\\') { j += 2; continue; } if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } break; } j += 1; }
      cur += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"') { const j = src.indexOf('"', i + 1); const e = j < 0 ? src.length : j + 1; cur += src.slice(i, e); i = e; continue; }
    if (c === '$') {
      const m = src.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m && !/[\w]$/.test(cur)) { const j = src.indexOf(m[0], i + m[0].length); const e = j < 0 ? src.length : j + m[0].length; cur += src.slice(i, e); i = e; continue; }
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i += 1; continue; }
    cur += c; i += 1;
  }
  if (stripComments(cur).trim()) out.push(cur.trim());
  return out.filter((s) => stripComments(s).trim());
}
function stripComments(s) { return s.replace(/^(\s*(--[^\n]*\n?|\/\*[\s\S]*?\*\/))*/g, ''); }
// The first words of a statement, lowercased, without double quotes ("public"."x" -> public.x): for matching only.
const head = (s) => stripComments(s).trim().replace(/\s+/g, ' ').replace(/"/g, '').toLowerCase();

const TX_STRIP = /^(begin|begin (transaction|work)|start transaction|commit|commit (transaction|work)|end|end (transaction|work))$/;
const TX_BAD = /^(rollback|savepoint|release|abort|prepare transaction|commit prepared|rollback prepared)\b/;
const NON_TX = /^(vacuum|create database|drop database|alter system|cluster|reindex\b.*\bconcurrently|create (unique )?index concurrently|drop index concurrently|refresh materialized view concurrently)\b/;
const DATA = /^(insert|update|delete|merge|truncate|copy|select|with|call|values|table|import)\b/;
const DO_WRITES = /\binsert\s+into\b|\bupdate\s+(only\s+)?[\w."]+\s+(as\s+\w+\s+)?set\b|\bdelete\s+from\b|\btruncate\b|\bcopy\b|cron\.(un)?schedule|\bperform\s+(?!1\b|pg_|set_config\b)[\w.]+\s*\(/i;

function classify(stmt) {
  const h = head(stmt);
  if (TX_STRIP.test(h)) return 'strip';
  if (TX_BAD.test(h)) return 'txbad';
  if (NON_TX.test(h)) return 'nontx';
  if (/^do\b/.test(h)) return DO_WRITES.test(stmt.replace(/raise\s+exception\s+'(?:[^']|'')*'/gi, '')) ? 'data' : 'run';
  if (/^(notify|listen|unlisten)\b/.test(h)) return 'skip'; // notify pgrst: no structure, no row
  if (DATA.test(h)) return 'data';
  return 'run';
}
const dataTarget = (stmt) => {
  const h = head(stmt);
  const m = h.match(/^(?:insert into|update(?: only)?|delete from|truncate(?: table)?|merge into|copy)\s+([\w."]+)/);
  if (m) return m[1].replace(/^public\./, '').replace(/"/g, '');
  const w = /^with\b/.test(h) && h.match(/\b(?:insert into|update|delete from) (?:public\.)?([a-z_]\w*)/);
  if (w) return w[1];
  if (/cron\.(un)?schedule/i.test(stmt)) return 'cron.job';
  if (/^do\b/.test(h)) { const t = [...stmt.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?([a-z_][\w]*)/gi)].map((x) => x[1].toLowerCase()).filter((x) => !['set', 'only'].includes(x)); return t.length ? [...new Set(t)].sort().join(', ') + ' (DO block)' : 'a DO block'; }
  const f = h.match(/^select\s+(?:[\w.]+\.)?([a-z_]\w*)\s*\(/);
  if (f) return `${f[1]}()`;
  return h.split(' ')[0];
};
const fnNames = (stmts) => new Set(stmts.map((s) => head(s).match(/^(?:create (?:or replace )?|alter )(?:function|procedure) ([\w."]+)\s*\(/)?.[1]).filter(Boolean).map((n) => n.replace(/^public\./, '').replace(/"/g, '')));
const tableNames = (stmts) => {
  const t = new Set();
  for (const s of stmts) {
    const h = head(s);
    const m = h.match(/^(?:create (?:unlogged )?table(?: if not exists)?|alter table(?: if exists)?(?: only)?|drop table(?: if exists)?|create (?:or replace )?(?:materialized )?view|create (?:unique )?index(?: if not exists)? [\w."]+ on(?: only)?|create policy [\w." ]+? on|drop policy(?: if exists)? [\w."]+ on|alter policy [\w."]+ on|create (?:or replace )?(?:constraint )?trigger [\w."]+ .*? on|drop trigger(?: if exists)? [\w."]+ on|comment on (?:table|column)|grant .* on(?: table)?|revoke .* on(?: table)?) ([\w."]+)/);
    if (m && !/^(all|function|functions|schema|sequence|sequences)$/.test(m[1])) t.add(m[1].replace(/^public\./, '').replace(/"/g, '').split('.')[0]);
  }
  return t;
};
// cron.schedule('name', 'schedule', <command>) calls in the file.
const cronCalls = (src) => [...src.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(?:\$([A-Za-z_]*)\$([\s\S]*?)\$\3\$|'((?:[^']|'')*)')\s*\)/g)]
  .map((m) => ({ name: m[1], schedule: m[2], command: (m[4] ?? m[5].replace(/''/g, "'")).trim() }));
const cronUnschedules = (src) => [...src.matchAll(/cron\.unschedule\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
const liveCron = () => {
  if (!existsSync(CRON_SNAPSHOT)) return null;
  const m = new Map();
  for (const x of cronCalls(readFileSync(CRON_SNAPSHOT, 'utf8').replace(/\r/g, ''))) m.set(x.name, x);
  return m;
};
const normCmd = (s) => s.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();

// ---- The structure that a run can change, read inside the transaction and raised as the error text. ----
const NOT_EXT = (col) => `not exists (select 1 from pg_depend d where d.objid = ${col} and d.deptype = 'e')`;
const STATE = `json_build_object(
  'f', (select coalesce(json_object_agg(format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)), md5(replace(pg_get_functiondef(p.oid), chr(13), ''))), '{}'::json)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p', 'w') and ${NOT_EXT('p.oid')}),
  't', (select coalesce(json_object_agg(c.relname, json_build_object(
          'columns', md5(coalesce((select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attname)
                       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '')),
          'constraints', coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\n' order by k.conname) from pg_constraint k where k.conrelid = c.oid), ''),
          'indexes', coalesce((select string_agg(pg_get_indexdef(x.indexrelid), E'\n' order by 1) from pg_index x where x.indrelid = c.oid), ''),
          'policies', coalesce((select string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), E'\n' order by p.polname) from pg_policy p where p.polrelid = c.oid), ''),
          'triggers', md5(coalesce((select string_agg(pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')),
          'rls', c.relrowsecurity::text || c.relforcerowsecurity::text,
          'grants', md5(coalesce(c.relacl::text, '')),
          'view', md5(coalesce(case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) end, '')))), '{}'::json)
          from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and ${NOT_EXT('c.oid')}),
  'e', (select coalesce(json_object_agg(t.typname, (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)), '{}'::json)
          from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'),
  'fg', md5(coalesce((select string_agg(p.proname || ':' || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${NOT_EXT('p.oid')}), '')))`;
const MARK = 'LPSNAP_STATE ';
// The text of a CHECK, an index or a policy: nested AND groups flattened (a dump and restore flattens them, see
// flattenAnd in schema-snapshot-lib.mjs), so a re-run of the same rule is not seen as a change.
const normState = (st) => { for (const t of Object.values(st.t)) for (const p of ['constraints', 'indexes', 'policies']) t[p] = flattenAnd(t[p]); return st; };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
const probe = `do $lpsnap$ begin raise exception '${MARK}%', (${STATE})::text; end $lpsnap$`;

/** Run statements in one transaction that always rolls back; return { state } or { error }. */
async function measure(stmts) {
  const body = [...stmts, probe].join(';\n') + ';';
  const r = await meta(body);
  if (r.rows) return { error: 'the transaction did not abort (no state raised): STOP' };
  const msg = String(r.error || '');
  const i = msg.indexOf(MARK);
  if (i >= 0) {
    const json = msg.slice(i + MARK.length).replace(/\nCONTEXT:[\s\S]*$/, '').trim();
    return { state: normState(JSON.parse(json)) };
  }
  return { error: msg.replace(/^ERROR:\s*/, '').split('\n')[0].slice(0, 200), code: r.code };
}

const lockdown = splitSql(readFileSync(join(DIR, 'lockdown_grants.sql'), 'utf8').replace(/\r\n/g, '\n')).filter((s) => classify(s) === 'run');
const start = await meta(`select ${STATE} as s`);
if (!start.rows) { console.error('find-superseded: cannot read the local copy:', start.error); process.exit(2); }
const before = normState(start.rows[0].s);
const base = await measure(lockdown); // the state after apply-sql.mjs of an empty file
if (!base.state) { console.error('find-superseded: lockdown_grants.sql does not run on the local copy:', base.error); process.exit(2); }
const baseline = base.state;

// File order: the last time the file was applied to live (schema_migrations, copied into the local copy), else
// the time git first added it. The newest file that gives the live version of an object "replaces" the older ones.
const applied = new Map(((await meta(`select file, extract(epoch from max(applied_at))::bigint as t from public.schema_migrations group by file`)).rows || []).map((r) => [r.file, Number(r.t)]));
const added = new Map();
{
  const log = execFileSync('git', ['log', '--diff-filter=A', '--format=@%at', '--name-only', '--', '.'], { cwd: DIR, encoding: 'utf8' });
  let t = 0;
  for (const line of log.split(/\r?\n/)) { if (line.startsWith('@')) t = Number(line.slice(1)); else if (line.trim()) added.set(basename(line.trim()), t); }
}
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql') && (!ONLY.length || ONLY.includes(f)));
const when = (f) => applied.get(f) ?? added.get(f) ?? Number.MAX_SAFE_INTEGER;
files.sort((a, b) => when(a) - when(b) || (a < b ? -1 : 1));
const cron = liveCron();

const results = [];
for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
  const stmts = splitSql(src);
  const kinds = stmts.map(classify);
  const R = { file: f, when: when(f), applied: applied.has(f), fns: fnNames(stmts), tables: tableNames(stmts), heads: stmts.map(head), reasons: [], writes: [], notes: [] };
  results.push(R);
  const bad = stmts.filter((s, k) => kinds[k] === 'txbad' || kinds[k] === 'nontx');
  if (bad.length) { R.verdict = 'not measured'; R.notes.push(`statement not allowed in a rolled-back transaction: \`${head(bad[0]).slice(0, 60)}\``); continue; }
  R.writes = [...new Set(stmts.filter((s, k) => kinds[k] === 'data').map(dataTarget))].sort();
  const run = f === 'lockdown_grants.sql' ? stmts.filter((s, k) => kinds[k] === 'run') : [...stmts.filter((s, k) => kinds[k] === 'run'), ...lockdown];
  const m = await measure(run);
  let after = m.state;
  if (m.error) {
    R.notes.push(`a re-run stops at an error today: ${m.error}`);
    // Conservative: measure each "create function" statement alone.
    const fstmts = stmts.filter((s) => /^create (or replace )?(function|procedure)\b/.test(head(s)));
    if (fstmts.length) {
      after = { f: { ...baseline.f }, t: baseline.t, e: baseline.e, fg: baseline.fg };
      for (const s of fstmts) {
        const one = await measure([s]);
        if (one.state) { for (const [k, v] of Object.entries(one.state.f)) if (baseline.f[k] !== v) after.f[k] = v; } else R.notes.push(`alone, \`${head(s).slice(0, 50)}...\` fails: ${one.error}`);
      }
      R.partial = true;
    }
  }
  if (after) {
    R.after = after;
    for (const k of Object.keys(after.f).sort()) {
      if (!(k in baseline.f)) R.reasons.push({ kind: 'fn-new', obj: k });
      else if (after.f[k] !== baseline.f[k]) R.reasons.push({ kind: 'fn-revert', obj: k });
    }
    for (const k of Object.keys(baseline.f).sort()) if (!(k in after.f)) R.reasons.push({ kind: 'fn-drop', obj: k });
    for (const k of Object.keys(after.t).sort()) {
      if (!(k in baseline.t)) { R.reasons.push({ kind: 'table-new', obj: k }); continue; }
      const parts = Object.keys(after.t[k]).filter((p) => after.t[k][p] !== baseline.t[k][p]);
      if (parts.length) R.reasons.push({ kind: 'table-change', obj: k, parts });
    }
    for (const k of Object.keys(baseline.t).sort()) if (!(k in after.t)) R.reasons.push({ kind: 'table-drop', obj: k });
    for (const k of Object.keys(after.e)) if (after.e[k] !== baseline.e[k]) R.reasons.push({ kind: 'enum', obj: k });
    if (after.fg !== baseline.fg) R.notes.push('changes function grants that lockdown_grants.sql does not put back');
  }
  if (cron) {
    for (const c of cronCalls(src)) {
      const live = cron.get(c.name);
      if (!live) R.reasons.push({ kind: 'cron-new', obj: c.name });
      else if (live.schedule !== c.schedule || normCmd(live.command) !== normCmd(c.command)) R.reasons.push({ kind: 'cron-revert', obj: c.name, detail: live.schedule !== c.schedule ? `schedule '${c.schedule}', live '${live.schedule}'` : 'command' });
    }
    for (const n of cronUnschedules(src)) if (cron.has(n) && !cronCalls(src).some((c) => c.name === n)) R.reasons.push({ kind: 'cron-drop', obj: n });
  }
  R.verdict = R.reasons.length ? 'SUPERSEDED' : m.error && !R.partial ? 'fails today' : 'no change';
  process.stdout.write(`${R.verdict === 'SUPERSEDED' ? 'S' : '.'}`);
}
console.log('');

// ---- Which newer file gives the live version. ----
const fnName = (ident) => ident.replace(/^public\./, '').replace(/\(.*$/, '');
// Every other file, oldest first: a file can be edited after it was applied (combat_core.sql, for example), so a
// file that is older by its apply time can still hold the live text.
const later = (R) => results.filter((x) => x !== R);
function replacedBy(R, r) {
  if (r.kind === 'fn-revert' || r.kind === 'fn-drop') {
    const c = later(R).filter((x) => x.fns.has(fnName(r.obj)) && x.after && x.after.f[r.obj] === baseline.f[r.obj]);
    return c.length ? c[c.length - 1].file : null;
  }
  if (r.kind === 'table-change') {
    const c = later(R).filter((x) => x.after && r.parts.every((p) => touchesPart(x, r.obj, p) && canon(x.after.t[r.obj]?.[p]) === canon(baseline.t[r.obj][p])));
    return c.length ? c[c.length - 1].file : null;
  }
  if (r.kind === 'cron-revert') { const c = later(R).filter((x) => x.reasons.every((y) => y.obj !== r.obj) && cronCalls(readFileSync(join(DIR, x.file), 'utf8')).some((k) => k.name === r.obj)); return c.length ? c[c.length - 1].file : null; }
  return null;
}
// Does a file change this part of a table? (a later file that only comments on the table does not replace a constraint)
function touchesPart(R, t, part) {
  const T = `(?:public\.)?"?${t}"?\b`;
  const re = {
    constraints: new RegExp(`^(alter table (if exists )?(only )?${T}.*\bconstraint\b|create table (if not exists )?${T})`),
    indexes: new RegExp(`^(create (unique )?index .* on (only )?${T}|drop index)`),
    policies: new RegExp(`^(create|alter|drop) policy .* on ${T}`),
    triggers: new RegExp(`^(create (or replace )?(constraint )?trigger|drop trigger) .* on ${T}`),
    columns: new RegExp(`^(alter table (if exists )?(only )?${T}.*\bcolumn\b|create table (if not exists )?${T})`),
    rls: new RegExp(`^alter table (if exists )?(only )?${T}.*row level security`),
    grants: new RegExp(`^(grant|revoke) .* on (table )?(.*, )?${T}|^(grant|revoke) .* on all tables`),
    view: new RegExp(`^create (or replace )?(materialized )?view ${T}`),
  }[part];
  return !!re && R.heads.some((h) => re.test(h));
}
const text = (R, r) => {
  const by = replacedBy(R, r);
  const tail = by ? ` (live = \`${by}\`)` : '';
  switch (r.kind) {
    case 'fn-revert': return `reverts \`${r.obj}\`${tail}`;
    case 'fn-new': return `brings back \`${r.obj}\`, which live does not have`;
    case 'fn-drop': return `drops \`${r.obj}\`${tail}`;
    case 'table-new': return `brings back table \`${r.obj}\`, which live does not have`;
    case 'table-drop': return `drops table \`${r.obj}\``;
    case 'table-change': return `changes table \`${r.obj}\`: ${r.parts.join(', ')}${tail}`;
    case 'enum': return `changes enum \`${r.obj}\``;
    case 'cron-new': return `schedules cron job \`${r.obj}\`, which live does not have`;
    case 'cron-revert': return `reverts cron job \`${r.obj}\` (${r.detail})${tail}`;
    case 'cron-drop': return `removes live cron job \`${r.obj}\``;
    default: return r.kind;
  }
};

// ---- Functions on live that no file gives (a hand change on live, or a file edited after it was applied). ----
const sourceOf = new Map();
for (const R of results) if (R.after) for (const n of R.fns) for (const [k, v] of Object.entries(R.after.f)) if (fnName(k) === n && v === baseline.f[k]) sourceOf.set(k, R.file);
const orphans = Object.keys(baseline.f).filter((k) => !sourceOf.has(k)).sort();

// ---- Proof that nothing stayed on the local copy. ----
const end = await meta(`select ${STATE} as s`);
const endState = end.rows ? normState(end.rows[0].s) : null;
const leaked = canon(endState) !== canon(before);
if (leaked && endState) for (const k of ['f', 't', 'e']) for (const x of new Set([...Object.keys(before[k]), ...Object.keys(endState[k])])) if (canon(before[k][x]) !== canon(endState[k][x])) console.log(`  changed: ${k} ${x}`);

// ---- SUPERSEDED.md ----
const esc = (s) => String(s).replace(/\|/g, '\\|');
const sup = results.filter((R) => R.verdict === 'SUPERSEDED').sort((a, b) => (a.file < b.file ? -1 : 1));
const L = ['# Superseded migration files', '',
  '> Generated by `card-studio/scripts/find-superseded.mjs` on the local copy. Do not edit by hand. Run it again after',
  '> each migration (after `rehearse-sql.mjs`), and commit this file with the migration.', '',
  'A file is SUPERSEDED when a re-run today would change the live structure: it puts an old function version back,',
  'brings back an object that a later file removed, or changes a table, an enum or a cron job. `apply-sql.mjs` refuses',
  'these files and prints the reason. Use `--force-superseded` only when you know why. The old files stay as they are:',
  'they are the history.', '',
  'How it is measured: each file runs on the local copy inside one transaction that always rolls back (the statements',
  'and `lockdown_grants.sql`, as `apply-sql.mjs` does). Data statements (insert, update, delete, a top-level select,',
  'a DO block that writes rows) do NOT run. Then the function md5s, the tables, the enums and the cron calls are',
  'compared with live. "live = `x.sql`" names the newest file that gives the live version.', '',
  `## Superseded files (${sup.length})`, '', '| File | Reasons | Notes |', '|---|---|---|'];
for (const R of sup) L.push(`| \`${R.file}\` | SUPERSEDED: ${esc(R.reasons.map((r) => text(R, r)).join('; '))} | ${esc(R.notes.join('; '))} |`);
const notMeasured = results.filter((R) => R.verdict === 'not measured');
L.push('', `## Not measured (${notMeasured.length})`, '', 'These files have a statement that cannot run in a rolled-back transaction. Read them before a re-run.', '');
for (const R of notMeasured) L.push(`- \`${R.file}\`: ${R.notes.join('; ')}`);
const fails = results.filter((R) => R.verdict === 'fails today');
L.push('', `## A re-run fails today, with no structure change (${fails.length})`, '', 'A file runs as one transaction, so an error rolls the whole file back.', '');
for (const R of fails.sort((a, b) => (a.file < b.file ? -1 : 1))) L.push(`- \`${R.file}\`: ${esc(R.notes.join('; '))}`);
const writers = results.filter((R) => R.verdict !== 'SUPERSEDED' && R.writes.length).sort((a, b) => (a.file < b.file ? -1 : 1));
L.push('', `## No structure change, but a re-run writes rows (${writers.length})`, '',
  'Not refused (a data statement can be safe to run again, for example "on conflict do nothing"). Read the file first:',
  'a one-time grant or a settings value would run again.', '');
for (const R of writers) L.push(`- \`${R.file}\`: ${esc(R.writes.join(', '))}`);
const safe = results.filter((R) => R.verdict === 'no change' && !R.writes.length).map((R) => R.file).sort();
L.push('', `## No change (${safe.length})`, '', safe.map((f) => `\`${f}\``).join(', ') || 'none', '');
L.push(`## Live functions that no file gives (${orphans.length})`, '',
  'The live text of these functions is in no migration file (a hand change on live, or a file edited after it was',
  'applied). `db/schema/functions/` holds the live text.', '');
for (const k of orphans) L.push(`- \`${k}\``);
if (!ONLY.length) writeFileSync(OUT, L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n');

console.log(`${results.length} files: ${sup.length} superseded, ${notMeasured.length} not measured, ${fails.length} fail today, ${writers.length} write rows only, ${safe.length} no change. ${orphans.length} live functions with no source file.`);
for (const R of sup) console.log(`  SUPERSEDED ${R.file}: ${R.reasons.map((r) => text(R, r)).join('; ')}`);
console.log(leaked ? 'LEAK: the local copy changed during the run. Refresh it (localdb/refresh.sh).' : 'ok   the local copy is unchanged after the run (all measuring transactions rolled back)');
if (!ONLY.length) console.log(`wrote ${OUT}`);
process.exitCode = leaked ? 1 : 0;
