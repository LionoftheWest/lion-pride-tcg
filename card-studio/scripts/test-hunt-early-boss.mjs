/**
 * Acceptance test for tcg-bot/supabase/hunt_early_boss.sql, rolled back (NO lasting change):
 *   node scripts/test-hunt-early-boss.mjs [path/to/sql]   (no argument = the LIVE functions, the baseline)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv[2] ? readFileSync(process.argv[2], 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare res jsonb := '[]'; h bigint; h2 bigint; r jsonb; ok boolean; n int;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  -- 1. A chosen tier: Mythic has 3 weak points, 2 resists, 3 passives.
  begin
    execute 'select spawn_hunt(3, ''Mythic'')' into h;
    select tier = 'Mythic' and jsonb_array_length(weak_points) = 3 and jsonb_array_length(resist_points) = 2
       and jsonb_array_length(passive->'list') = 3 into ok from hunts where id = h;
    res := res || jsonb_build_object('case', 'spawn_hunt(3, ''Mythic'') makes a Mythic boss', 'ok', coalesce(ok, false));
  exception when others then res := res || jsonb_build_object('case', 'spawn_hunt(3, ''Mythic'') makes a Mythic boss', 'ok', false, 'err', sqlerrm); end;
  -- 2. The weekly call without a tier still works (random tier).
  begin
    execute 'select spawn_hunt(7)' into h2;
    select tier in ('Normal', 'Heroic', 'Mythic') into ok from hunts where id = h2;
    res := res || jsonb_build_object('case', 'spawn_hunt(7) still spawns a random tier', 'ok', coalesce(ok, false));
  exception when others then res := res || jsonb_build_object('case', 'spawn_hunt(7) still spawns a random tier', 'ok', false, 'err', sqlerrm); end;
  -- 3. The Monday job does not close a boss that closes later in the week.
  update hunts set status = 'active', closes_at = now() + interval '2 days', settled_at = null where id = h2;
  update hunts set status = 'expired' where id <> h2 and status = 'active';
  r := close_weekly_boss();
  select status = 'active' into ok from hunts where id = h2;
  res := res || jsonb_build_object('case', 'the Monday close leaves a boss that is not due', 'ok', coalesce(ok, false));
  -- 4. The 10-minute job closes AND pays a boss whose closing time has passed.
  insert into players (id, username) values ('tst_eb_1', 'eb') on conflict do nothing;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
    values (h2, 'tst_eb_1', (select id from cards order by id limit 1), current_date, 500);
  update hunts set closes_at = now() - interval '1 minute' where id = h2;
  begin
    execute 'select close_due_hunts()' into r;
    select count(*) into n from hunt_events where hunt_id = h2 and kind = 'expired';
    select status = 'expired' and settled_at is not null and n = 1
       and exists (select 1 from pack_ledger where player_id = 'tst_eb_1' and reason = 'hunt_reward') into ok from hunts where id = h2;
    res := res || jsonb_build_object('case', 'a due boss is closed, paid once, and posted once', 'ok', coalesce(ok, false));
  exception when others then res := res || jsonb_build_object('case', 'a due boss is closed, paid once, and posted once', 'ok', false, 'err', sqlerrm); end;
  -- 5. A bad tier is refused.
  begin
    execute 'select spawn_hunt(3, ''Legendary'')' into h;
    res := res || jsonb_build_object('case', 'a bad tier is refused', 'ok', false);
  exception when others then res := res || jsonb_build_object('case', 'a bad tier is refused', 'ok', sqlerrm like 'bad tier%'); end;
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.err ? ' — ' + r.err : ''}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
