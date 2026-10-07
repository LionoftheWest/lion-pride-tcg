/**
 * tcg-bot/supabase/SUPERSEDED.md is current: every migration file in tcg-bot/supabase/ is in it.
 *   node scripts/test-superseded-list.mjs     (test-all-local.mjs runs it; it reads no database)
 * A new migration usually makes an older file superseded (its function text is now old). apply-sql.mjs refuses
 * only the files that SUPERSEDED.md lists, so the list must be made again after each migration:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/find-superseded.mjs   (after rehearse-sql.mjs)
 * It FAILS for each .sql file that the list does not name.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../tcg-bot/supabase/', import.meta.url));
const md = existsSync(DIR + 'SUPERSEDED.md') ? readFileSync(DIR + 'SUPERSEDED.md', 'utf8') : '';
const named = new Set([...md.matchAll(/`([\w.-]+\.sql)`/g)].map((m) => m[1]));
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const missing = files.filter((f) => !named.has(f));
if (!md) console.log('  FAIL tcg-bot/supabase/SUPERSEDED.md is missing');
for (const f of missing) console.log(`  FAIL ${f} is not in SUPERSEDED.md (run find-superseded.mjs on the local copy after the migration)`);
if (md && !missing.length) console.log(`  ok   all ${files.length} migration files are in SUPERSEDED.md`);
const fails = (md ? 0 : 1) + missing.length;
console.log(`\nFAILS ${fails}`);
process.exitCode = fails ? 1 : 0;
