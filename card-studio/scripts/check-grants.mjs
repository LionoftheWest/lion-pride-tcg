/**
 * Fail if the public API roles (anon, authenticated) can reach anything beyond the
 * public catalog. Run after every migration:  node scripts/check-grants.mjs
 * The expected state is set by tcg-bot/supabase/lockdown_grants.sql. Uses the same
 * SUPABASE_ACCESS_TOKEN + SUPABASE_URL as apply-sql.mjs.
 */
import dotenv from 'dotenv';

dotenv.config({ override: true });

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = ((process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!token || !ref) { console.error('Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL in .env'); process.exit(1); }

const PUBLIC_READ = ['cards', 'subjects'];

const sql = `
select 'EXECUTE' priv, r.rolname role, p.proname obj
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join pg_roles r
 where n.nspname = 'public' and r.rolname in ('anon', 'authenticated')
   and pg_get_function_result(p.oid) not in ('trigger', 'event_trigger')
   and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
union all
select 'WRITE', r.rolname, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join pg_roles r
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and r.rolname in ('anon', 'authenticated')
   and has_table_privilege(r.rolname, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
union all
select 'SELECT', r.rolname, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join pg_roles r
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and r.rolname in ('anon', 'authenticated')
   and c.relname <> all (array[${PUBLIC_READ.map((t) => `'${t}'`).join(',')}])
   and has_table_privilege(r.rolname, c.oid, 'SELECT')
union all
select 'NO_RLS', 'table', c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2, 3`;

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const rows = await r.json().catch(() => null);
if (!r.ok || !Array.isArray(rows)) { console.error(`FAILED ${r.status}:`, JSON.stringify(rows)); process.exit(1); }

if (rows.length) {
  console.error(`FAIL: ${rows.length} grant(s) beyond the public catalog:`);
  for (const x of rows) console.error(`  ${x.priv.padEnd(7)} ${x.role.padEnd(13)} ${x.obj}`);
  console.error('Fix: re-run  node scripts/apply-sql.mjs ../tcg-bot/supabase/lockdown_grants.sql');
  process.exitCode = 1; // not process.exit(): it trips a libuv assert on Windows after fetch
} else {
  console.log(`OK: anon + authenticated can only read ${PUBLIC_READ.join(', ')}. RLS is on for every table.`);
}
