/**
 * The structure snapshot (db/schema/) is current: the LOCAL copy has the same structure as the files in the repo.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-schema-snapshot.mjs     (test-all-local.mjs runs it)
 * So rehearse-sql.mjs fails for a migration whose snapshot was not generated again (like test-db-docs.mjs for
 * docs/data/). It FAILS on each difference and prints the object and the kind (check-schema-drift.mjs does the work).
 * It reads only the catalog of the local copy, never a row.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.LOCALDB !== '1') { console.log('FAIL run it on the local copy (LOCALDB=1 + localdb-preload.mjs)'); process.exit(1); }
const script = fileURLToPath(new URL('./check-schema-drift.mjs', import.meta.url));
const r = spawnSync(process.execPath, [...process.execArgv, script], { encoding: 'utf8', env: process.env });
const out = `${r.stdout || ''}${r.stderr || ''}`;
for (const line of out.split(/\r?\n/)) if (line.trim()) console.log(line.replace(/^\s*DIFF /, '  FAIL '));
const n = Number(out.match(/(\d+) difference\(s\)/)?.[1] ?? NaN);
const ok = r.status === 0 && n === 0;
console.log(ok ? '  ok   db/schema/ is the structure of the local copy\n\nFAILS 0' : `\nFAILS ${Number.isNaN(n) ? 1 : Math.max(n, 1)}`);
process.exitCode = ok ? 0 : 1;
