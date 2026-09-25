/**
 * Apply a .sql file to the PERSONAL Supabase project via the Management API.
 *   node scripts/apply-sql.mjs <path-to.sql>
 * Uses SUPABASE_ACCESS_TOKEN + SUPABASE_URL from this project's .env (override:true
 * so the personal token wins over any ambient work-account token).
 *
 * After the file applies, this script also:
 *   1. records it in public.schema_migrations (file, sha256, applied_at), so
 *      "is it applied?" has an answer in the database, not only in notes;
 *   2. re-applies tcg-bot/supabase/lockdown_grants.sql and runs check-grants.mjs,
 *      so a migration can never leave a table or RPC open to the public anon key.
 */
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

dotenv.config({ override: true });

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || '';
const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const file = process.argv[2];

if (!token) { console.error('Missing SUPABASE_ACCESS_TOKEN in .env'); process.exit(1); }
if (!ref) { console.error('Could not read the project ref from SUPABASE_URL'); process.exit(1); }
if (!file) { console.error('Usage: node scripts/apply-sql.mjs <path-to.sql>'); process.exit(1); }

const LOCKDOWN = fileURLToPath(new URL('../../tcg-bot/supabase/lockdown_grants.sql', import.meta.url));
const CHECK = fileURLToPath(new URL('./check-grants.mjs', import.meta.url));

async function run(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`FAILED ${r.status}:`, JSON.stringify(body)); process.exit(1); }
  return body;
}

const sql = readFileSync(file, 'utf8');
console.log('OK', JSON.stringify(await run(sql)).slice(0, 300));

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sha = createHash('sha256').update(sql).digest('hex');
await run(`create table if not exists public.schema_migrations (
    id bigserial primary key, file text not null, sha256 text not null,
    applied_at timestamptz not null default now());
  insert into public.schema_migrations (file, sha256) values (${lit(basename(file))}, ${lit(sha)});`);
console.log(`recorded ${basename(file)} @ ${sha.slice(0, 12)} in schema_migrations`);

if (resolve(file) !== LOCKDOWN) {
  await run(readFileSync(LOCKDOWN, 'utf8'));
  console.log('re-applied lockdown_grants.sql');
}
const check = spawnSync(process.execPath, [CHECK], { stdio: 'inherit' });
process.exitCode = check.status ?? 1;
