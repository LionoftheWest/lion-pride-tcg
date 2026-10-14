/**
 * Shared helpers of the Combat Lab (scripts/combat-lab.mjs) and the Dungeon / Gauntlet golden test (scripts/dungeon-golden.mjs).
 * LOCAL copy only (docs/foundations.md "Performance and cost budget" rule 2: heavy work never runs on live).
 * Every job is ONE request: a DO block that does its work in a sub-block, raises an exception on purpose to undo every write,
 * and returns its result in the message ("RESULT:<text>"). Nothing is kept. A planted change (a mutation) is run inside the same block.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
// One command: with LOCALDB=1 the preload (it sends every SQL request to the local copy and refuses the live project) loads here,
// so 'LOCALDB=1 node scripts/combat-lab.mjs' works with no --import. A run that already has the preload does not load it twice.
if (process.env.LOCALDB === '1' && !globalThis.__LOCALDB_API) await import('./localdb-preload.mjs');

export function assertLocal(name) {
  if (process.env.LOCALDB !== '1') throw new Error(`${name} runs on the LOCAL copy only: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/${name}`);
  const ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
  if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
  return ref;
}

/** Send SQL. The preload sends it to the local database. Returns the raw text of the answer. */
export async function rawQuery(sql) {
  const ref = assertLocal('(lab)');
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  return r.text();
}

/** Run a DO block that ends with RAISE EXCEPTION 'RESULT:%'. Returns the text after RESULT:. Throws on any other error. */
export async function runBlock(sql) {
  const owner = process.env.LAB_LOCK_OWNER;
  if (owner) await lock(owner);
  let text;
  try { text = await rawQuery(sql); } finally { if (owner) unlock(owner); }
  let msg = text;
  try { const j = JSON.parse(text); msg = j.message ?? j.error ?? text; } catch { /* the raw text */ }
  const i = String(msg).indexOf('RESULT:');
  if (i < 0) throw new Error('NO RESULT: ' + String(msg).slice(0, 3000));
  let out = String(msg).slice(i + 7);
  const k = out.lastIndexOf('\nCONTEXT:');
  if (k >= 0) out = out.slice(0, k);
  return out;
}

export const sqlLit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'`;

// --- The shared local database lock (docs/foundations.md "How these PRs went live") -------------------------------------
// Several sessions use the one local copy. With LAB_LOCK_OWNER=<name> each request takes the lock (mkdir is atomic; wait and retry
// when it exists), writes the owner, and removes the lock after the request, so a long run does not hold the copy. Never removes a lock
// that another owner holds. Without LAB_LOCK_OWNER the caller holds the lock (a run of a few minutes can hold it as a whole: a change that
// another session applies in the middle of a run would show as a false difference in a golden test).
import { mkdirSync, rmSync, writeFileSync, readFileSync, rmdirSync } from 'node:fs';
const LOCK = process.env.LOCALDB_LOCK_DIR || 'C:/Users/vaugh/.localdb.lock';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function lock(owner) {
  for (let i = 0; ; i++) {
    try { mkdirSync(LOCK); writeFileSync(`${LOCK}/owner`, owner); return; }
    catch (e) { if (e.code !== 'EEXIST') throw e; if (i > 360) throw new Error(`the local database lock is held by ${(() => { try { return readFileSync(`${LOCK}/owner`, 'utf8').trim(); } catch { return '?'; } })()} for more than 30 minutes`); await sleep(5000); }
  }
}
function unlock(owner) {
  let o = ''; try { o = readFileSync(`${LOCK}/owner`, 'utf8').trim(); } catch { /* none */ }
  if (o !== owner) return;   // never remove a lock that we do not own
  rmSync(`${LOCK}/owner`, { force: true }); rmdirSync(LOCK);
}
