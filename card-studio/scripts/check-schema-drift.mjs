/**
 * Compare the structure snapshot in the repo (db/schema/, made by gen-schema-snapshot.mjs) with a database and
 * print each difference (object, kind). Exit 1 on any difference, 0 when they are the same.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/check-schema-drift.mjs     the LOCAL copy (default)
 *   node scripts/check-schema-drift.mjs --live                                                LIVE, read-only
 * --live is the weekly drift check after each deploy: it finds a hand change on live, or an old migration
 * that was run again (a function md5 that is not the one in the repo). Every query is a single SELECT on the
 * catalog (assertSelect in schema-snapshot-lib.mjs): no row is read, nothing is written.
 * The local copy has no pg_cron jobs (the dump does not carry them): the local check skips cron-jobs.sql when
 * the database has no jobs. --live always checks it.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { makeQ, readCatalog, renderSnapshot, renderCron, readSnapshotDir, compareSnapshots, printDiffs, CRON_FILE } from './schema-snapshot-lib.mjs';

const LIVE = process.argv.includes('--live');
if (LIVE && process.env.LOCALDB === '1') { console.error('check-schema-drift: --live and LOCALDB=1 together: choose one'); process.exit(2); }
if (!LIVE && process.env.LOCALDB !== '1') {
  console.error('check-schema-drift: say which database. Local: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/check-schema-drift.mjs   Live (read-only): --live');
  process.exit(2);
}

async function drift({ live = LIVE } = {}) {
  const expected = await readSnapshotDir();
  if (!expected.size) throw new Error('db/schema/ is empty: run gen-schema-snapshot.mjs');
  const cat = await readCatalog(makeQ());
  const actual = renderSnapshot(cat);
  let cronNote = '';
  if (cat.cron.length || live) actual.set(CRON_FILE, renderCron(cat));
  else { expected.delete(CRON_FILE); cronNote = 'cron jobs: not checked (this database has no pg_cron jobs: the local copy; --live checks them)'; }
  return { diffs: compareSnapshots(expected, actual), cat, cronNote };
}

const { diffs, cat, cronNote } = await drift();
console.log(`schema drift: db/schema/ against the ${LIVE ? 'LIVE database (read-only)' : 'LOCAL copy'}: ${cat.rels.length} tables, ${cat.fns.length} functions, ${cat.cron.length} cron jobs`);
if (cronNote) console.log(`  note ${cronNote}`);
printDiffs(diffs);
console.log(`\n${diffs.length} difference(s).${diffs.length ? (LIVE
  ? ' Live is not the structure in the repo: find the cause (a hand change, an old file run again, or a migration without a new snapshot).'
  : ' Run: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/gen-schema-snapshot.mjs, and commit db/schema/ with the migration.') : ''}`);
process.exitCode = diffs.length ? 1 : 0;
