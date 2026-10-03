// Rehearse a migration on the LOCAL Supabase copy before it goes live (Nathan, 2026-10-02):
//   node scripts/rehearse-sql.mjs <file.sql> [test-name-filter]
// 1. apply-sql.mjs applies the file to the local copy (with its schema_migrations record, the
//    lockdown grants and check-grants.mjs - all on the local copy: LOCALDB=1 + localdb-preload.mjs
//    for every child process through NODE_OPTIONS);
// 2. then the SQL tests run on the local copy (all of them, or those whose name has the filter).
// Only after both pass: node scripts/apply-sql.mjs <file.sql> on the live project.
// A failed rehearsal can leave the local copy half changed: refresh it (tools: localdb/refresh.sh).
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [file, filter = ''] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/rehearse-sql.mjs <file.sql> [test-name-filter]'); process.exit(1); }
const preload = pathToFileURL(join(root, 'scripts', 'localdb-preload.mjs')).href;
const env = { ...process.env, LOCALDB: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim() };
console.log(`1. apply ${file} to the LOCAL copy`);
const a = spawnSync(process.execPath, [join('scripts', 'apply-sql.mjs'), resolve(file)], { cwd: root, env, stdio: 'inherit' });
if (a.status !== 0) { console.log('\nREHEARSAL FAILED at the apply step: do not apply it live. Refresh the local copy before the next try.'); process.exit(1); }
console.log(`\n2. the SQL tests on the LOCAL copy${filter ? ` (filter "${filter}")` : ''}`);
const t = spawnSync(process.execPath, [join('scripts', 'test-all-local.mjs'), filter], { cwd: root, env: { ...process.env }, stdio: 'inherit' });
console.log(t.status === 0 ? '\nREHEARSAL PASSED: the migration can go live (apply-sql.mjs without LOCALDB).' : '\nREHEARSAL FAILED at the tests: read out/localdb-tests/ before anything goes live.');
process.exit(t.status === 0 ? 0 : 1);
