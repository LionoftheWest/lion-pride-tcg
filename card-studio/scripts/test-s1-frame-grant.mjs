/**
 * Acceptance test for tcg-bot/supabase/d191_s1_frame_grant.sql (D-191 option A, Nathan 2026-10-14: "Yes give them the new
 * origins frame"). Rolled back (the result comes back in the exception), with two test members:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-s1-frame-grant.mjs
 *   MUTATE=nogrant ...   the file inserts nothing: must FAIL
 * Invariants:
 *   - every member who claimed s1 owns the Origins Frame (holo:S1) afterwards, and keeps the claim row of s1 as it was;
 *   - no packs and no title are granted; a member with no s1 claim gets nothing;
 *   - a second run inserts nothing (idempotent).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/d191_s1_frame_grant.sql', import.meta.url)), 'utf8');
if (process.env.MUTATE === 'nogrant') mig = mig.replace("where c.key = 's1' and", "where false and");
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const P = 'tst_s1grant';
const sql = `do $t$
declare r jsonb;
begin
  insert into public.players (id, username) values ('${P}_a', '${P}_a'), ('${P}_b', '${P}_b');
  insert into public.achievement_claims (player_id, key, packs, title, frame) values ('${P}_a', 's1', 5, 'Origins Champion', 'holo');
  execute $m$${mig}$m$;
  execute $m$${mig}$m$;
  select jsonb_build_object(
    'a_frame', (select count(*) from public.achievement_claims where player_id = '${P}_a' and frame = 'holo:S1'),
    'a_rows',  (select count(*) from public.achievement_claims where player_id = '${P}_a'),
    'a_s1',    (select to_jsonb(c) - 'claimed_at' from public.achievement_claims c where player_id = '${P}_a' and key = 's1'),
    'a_grant', (select to_jsonb(c) - 'claimed_at' - 'player_id' from public.achievement_claims c where player_id = '${P}_a' and key = 's1:frame'),
    'b_rows',  (select count(*) from public.achievement_claims where player_id = '${P}_b')) into r;
  raise exception 'RESULT %', r;
end $t$;`;

const res = await q(sql);
const m = JSON.stringify(res).match(/RESULT (\{.*?\})(?:\\n|")/);
if (!m) { console.error('no result:', JSON.stringify(res).slice(0, 600)); process.exit(1); }
const r = JSON.parse(m[1].replace(/\\"/g, '"'));
let fails = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) fails++; };
check(r.a_frame === 1, 'an s1 claimer owns the Origins Frame (holo:S1) once');
check(r.a_rows === 2, 'two runs add exactly one row (idempotent)');
check(r.a_s1?.frame === 'holo' && r.a_s1?.packs === 5 && r.a_s1?.title === 'Origins Champion', 'the s1 claim row is unchanged (the Holo frame is kept)');
check(r.a_grant?.packs === 0 && r.a_grant?.title === null && r.a_grant?.shards === 0, 'the grant pays no packs, no title and no Shards');
check(r.b_rows === 0, 'a member with no s1 claim gets nothing');
console.log(fails ? `FAILS ${fails}` : 'PASS all 5 cases');
process.exit(fails ? 1 : 0);
