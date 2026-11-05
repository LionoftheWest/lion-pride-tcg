import './localdb-guard.mjs';
/**
 * The M1e live check after the switch (SPEC ON v6 6.7 rows 2a and 2b), READ ONLY: one request
 *   select combat_v2_convert_check()   (a STABLE function: Postgres refuses any write inside it)
 * Prints the counts only (input_missing, progress_mismatch, live_differs, log_after_switch) and "items: n". No player id, no card id.
 * A finding is NOT a rollback trigger: the fix is `select combat_v2_convert_fix();` (3.7 rule 8b), then this check again.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/convert-check.mjs     the local copy
 *   node scripts/convert-check.mjs --live                                             the live project (the orchestrator, after the switch)
 * Exit 0 = no item, 1 = items found, 2 = an error.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const live = process.argv.includes('--live');
if (process.env.LOCALDB !== '1' && !live) { console.error('convert-check: add --live for the live project, or LOCALDB=1 for the local copy'); process.exit(2); }
const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)/)?.[1];
if (ref !== 'kgvdqqehefezbypozvrh') { console.error(`convert-check: wrong Supabase project ${ref}`); process.exit(2); }
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'select combat_v2_convert_check() as c;' }) });
const text = await r.text();
let rows; try { rows = JSON.parse(text); } catch { rows = null; }
const c = Array.isArray(rows) ? rows.find((x) => x && x.c)?.c : null;
if (!c) { console.error('convert-check: no answer: ' + text.slice(0, 500)); process.exit(2); }
const { items, ...counts } = c;
console.log(JSON.stringify({ ...counts, items: (items || []).length }));
console.log(c.ok ? 'CHECK OK: every card with v1 points has its input row and its expected progress row' : 'CHECK FOUND ITEMS: run select combat_v2_convert_fix(); then this check again');
process.exit(c.ok ? 0 : 1);
