/**
 * Coverage test of the database documentation (docs/data/, made by gen-data-docs.mjs from the COMMENT ON of
 * each object; the comments are in the migrations, most of them in tcg-bot/supabase/db_comments.sql).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-db-docs.mjs     (test-all-local.mjs runs it)
 * It FAILS when:
 *  1. a public table or view has no comment,
 *  2. a column of a public table or view has no comment,
 *  3. a public function has no comment (functions that an extension owns are not counted),
 *  4. a public table or function is not on a page in docs/data/ (a new object without generated docs).
 * It prints each missing object. It reads only the catalog and the docs files, never a row.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DOCS = fileURLToPath(new URL('../../docs/data/', import.meta.url));
const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)/)?.[1];
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`query failed: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};

const NOT_EXT = (col) => `not exists (select 1 from pg_depend d where d.objid = ${col} and d.deptype = 'e')`;
const tables = await q(`
  select c.relname as name, obj_description(c.oid, 'pg_class') is not null as done
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and ${NOT_EXT('c.oid')} order by 1`);
const columns = await q(`
  select c.relname || '.' || a.attname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and ${NOT_EXT('c.oid')}
     and col_description(c.oid, a.attnum) is null order by 1`);
const functions = await q(`
  select p.oid::regprocedure::text as name, obj_description(p.oid, 'pg_proc') is not null as done
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and ${NOT_EXT('p.oid')} order by 1`);

let fails = 0;
const report = (what, list) => {
  if (!list.length) { console.log(`  ok   every ${what}`); return; }
  fails += 1;
  console.log(`  FAIL ${list.length} ${what} missing:`);
  for (const x of list) console.log(`         ${x}`);
};
report('table has a comment', tables.filter((t) => !t.done).map((t) => t.name));
report('column has a comment', columns.map((c) => c.name));
report('function has a comment', functions.filter((f) => !f.done).map((f) => f.name));

// The generated pages: each table has the heading "### <name>", each function "### <regprocedure>".
const pages = existsSync(DOCS) ? readdirSync(DOCS).filter((f) => f.endsWith('.md') && f !== 'balance.md' && f !== 'README.md').map((f) => readFileSync(join(DOCS, f), 'utf8')) : [];
const headings = new Set(pages.flatMap((p) => [...p.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim())));
const regen = 'run: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/gen-data-docs.mjs';
const noTable = tables.filter((t) => !headings.has(t.name)).map((t) => t.name);
const noFn = functions.filter((f) => !headings.has(f.name)).map((f) => f.name);
report(`table is on a page in docs/data/ (${regen})`, noTable);
report(`function is on a page in docs/data/ (${regen})`, noFn);

console.log(`\n${tables.length} tables, ${functions.length} functions. FAILS ${fails}`);
if (fails) process.exitCode = 1;
