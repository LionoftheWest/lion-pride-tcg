/**
 * Acceptance test for tcg-bot/supabase/dailies_adventure.sql (the Dungeon and the Gauntlet dailies) on the LIVE
 * database, NO lasting change: one DO block; the final RAISE rolls it all back.
 *   node scripts/test-adventure-dailies.mjs             must PASS
 *   MUTATE=<name> node scripts/test-adventure-dailies.mjs   must FAIL, for every name:
 *     mode     the Dungeon daily counts a Gauntlet run      always   the Dungeon daily is done with no run
 *     today    a run of yesterday counts                    flag     the Gauntlet daily shows with its mode off
 *     guard    the live-version guard accepts any version   names    claim_daily refuses the two new tasks
 *   node scripts/test-adventure-dailies.mjs --live      the same cases on the CURRENT functions (test-all-local.mjs:
 *     pack_ledger_strict.sql replaced claim_daily after this file, so its md5 guard refuses to run this file again)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/dailies_adventure.sql', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MUT = {
  mode: ["day = d and mode = 'daily');", "day = d);"],
  always: ["'done', dg, 'claimed', 'dungeon'", "'done', true, 'claimed', 'dungeon'"],
  today: ["where player_id = p_player and day = d and mode = 'gauntlet');", "where player_id = p_player and day >= d - 1 and mode = 'gauntlet');"],
  flag: ["gaon := dgon and coalesce((select (value->>'enabled')::boolean from settings where key = 'gauntlet'), false);", "gaon := dgon;"],
  names: ["'social', 'dungeon', 'gauntlet') then", "'social') then"],
  guard: ["not in ('d5bf4bded6dff9041233de103668b9d6',", "is null and 'x' not in ("],
};
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');
const task = (k) => `(select x from jsonb_array_elements(dailies_tasks('tst_ad_a')) x where x->>'task' = '${k}')`;

const body = String.raw`do $t$
declare bad text := ''; r jsonb; d date := (now() at time zone 'America/Denver')::date; sb int; pb int;
begin
  ${process.argv.includes('--live') ? '-- the current functions' : 'execute $m$' + mig + '$m$;'}
  update settings set value = value || '{"enabled": true, "cap": 5, "shards": 40}' where key = 'dailies';
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  insert into settings (key, value) values ('pack_earn_multiplier', '1') on conflict (key) do update set value = '1';
  insert into players (id, username) values ('tst_ad_a', 'adventure daily');

  -- 1. No run today: both dailies show, not done; a claim pays nothing.
  if ${task('dungeon')} is null or ${task('gauntlet')} is null then bad := bad || 'dailies missing: ' || dailies_tasks('tst_ad_a')::text || '; '; end if;
  if (${task('dungeon')}->>'done')::boolean or (${task('gauntlet')}->>'done')::boolean then bad := bad || 'done with no run; '; end if;
  if (claim_daily('tst_ad_a', 'dungeon')->>'error') is distinct from 'not_done' then bad := bad || 'claim with no run; '; end if;

  -- 2. A Gauntlet run yesterday does not count; a Gauntlet run today does the Gauntlet daily only.
  insert into dungeon_runs (player_id, day, squad, state, mode, status) values ('tst_ad_a', d - 1, '{1,2,3,4,5}', '{}', 'gauntlet', 'over');
  if (${task('gauntlet')}->>'done')::boolean then bad := bad || 'yesterday counts; '; end if;
  insert into dungeon_runs (player_id, day, squad, state, mode, status) values ('tst_ad_a', d, '{1,2,3,4,5}', '{}', 'gauntlet', 'over');
  if not (${task('gauntlet')}->>'done')::boolean or (${task('dungeon')}->>'done')::boolean then bad := bad || 'gauntlet run: ' || dailies_tasks('tst_ad_a')::text || '; '; end if;

  -- 3. The claim: 1 pack + the daily Shards, once.
  select shard_balance, pack_balance into sb, pb from players where id = 'tst_ad_a';
  r := claim_daily('tst_ad_a', 'gauntlet');
  if not coalesce((r->>'ok')::boolean, false) or (r->>'packs')::int <> 1 or (r->>'shards')::int <> 40
     or (select pack_balance from players where id = 'tst_ad_a') - pb <> 1 or (select shard_balance from players where id = 'tst_ad_a') - sb <> 40 then bad := bad || 'gauntlet claim: ' || r::text || '; '; end if;
  if (claim_daily('tst_ad_a', 'gauntlet')->>'error') is distinct from 'claimed' then bad := bad || 'claimed twice; '; end if;

  -- 4. A Dungeon run today does the Dungeon daily; it counts toward the 5-pack earn limit (packs earned_*).
  insert into dungeon_runs (player_id, day, squad, state, mode, status) values ('tst_ad_a', d, '{1,2,3,4,5}', '{}', 'daily', 'over');
  if not (${task('dungeon')}->>'done')::boolean then bad := bad || 'dungeon run not done; '; end if;
  insert into pack_ledger (player_id, amount, reason) values ('tst_ad_a', 4, 'earned_daily');
  r := claim_daily('tst_ad_a', 'dungeon');
  if not coalesce((r->>'ok')::boolean, false) or (r->>'packs')::int <> 0 or (r->>'shards')::int <> 40 then bad := bad || 'dungeon claim at the limit: ' || r::text || '; '; end if;

  -- 5. A mode OFF hides its daily.
  update settings set value = value || '{"enabled": false}' where key = 'gauntlet';
  if ${task('gauntlet')} is not null or ${task('dungeon')} is null then bad := bad || 'gauntlet off still shows; '; end if;
  update settings set value = value || '{"enabled": false}' where key = 'dungeon';
  if ${task('dungeon')} is not null then bad := bad || 'dungeon off still shows; '; end if;
  -- The five older dailies are unchanged.
  if (select string_agg(x->>'task', ',') from jsonb_array_elements(dailies_tasks('tst_ad_a')) x) <> 'checkin,chat,hunt,voice,social' then bad := bad || 'the older dailies changed; '; end if;

${!process.argv.includes('--live') && (!process.env.MUTATE || process.env.MUTATE === 'guard') ? `
  -- 6. The guard: the file runs again on its own result; a changed live function stops it.
  begin execute $m$${mig}$m$; exception when others then bad := bad || 'second run: ' || sqlerrm || '; '; end;
  execute replace(pg_get_functiondef('public.dailies_tasks'::regproc), 'declare', 'declare -- changed by someone else');
  begin execute $m$${mig}$m$; bad := bad || 'the guard let a changed dailies_tasks through; ';
  exception when others then if sqlerrm not like '%changed since this file was built%' then bad := bad || 'guard: ' || sqlerrm || '; '; end if; end;

` : ''}
  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2000));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
