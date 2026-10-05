/**
 * Acceptance test for tcg-bot/supabase/gift_all_members.sql against the LIVE database with
 * NO lasting change:  node scripts/test-gift-all.mjs
 * One DO block applies the migration, runs the server-wide gift twice, and checks that each
 * member ends with exactly one start gift. It RAISEs the results, so everything rolls back.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/gift_all_members.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const BY = '999999999999999910'; // a sample admin id (p_by is only recorded)
const OLD = '999999999999999911', NEW = '999999999999999912', EARLY = '999999999999999913', LATER = '999999999999999914';
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; r2 jsonb; members jsonb; other_before bigint;
begin
  execute $m$${mig}$m$;
  -- A member who already played (a row, no start gift yet) and one who joined early (welcome).
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${OLD}', 'tst old');
  perform set_config('tcg.skip_welcome', '', true);
  insert into players (id, username) values ('${EARLY}', 'tst early');   -- the welcome trigger: 10
  select coalesce(sum(pack_balance), 0) into other_before from players where id not in ('${OLD}', '${NEW}', '${EARLY}', '${LATER}');
  members := jsonb_build_array(
    jsonb_build_object('id', '${OLD}', 'username', 'tst old'),
    jsonb_build_object('id', '${NEW}', 'username', 'tst new', 'avatar', 'a_0123456789abcdef0123456789abcdef'),
    jsonb_build_object('id', '${NEW}', 'username', 'tst new'),
    jsonb_build_object('id', '${EARLY}', 'username', 'tst early'),
    jsonb_build_object('id', 'not-a-discord-id', 'username', 'bad'));
  r := gift_all_members(members, 10, '${BY}');
  res := res || jsonb_build_object('case', 'the counts: 3 members, 1 created, 2 gifted, 1 skipped (a duplicate and a bad id ignored)', 'ok',
    (r->>'members')::int = 3 and (r->>'created')::int = 1 and (r->>'gifted')::int = 2 and (r->>'skipped')::int = 1, 'r', r);
  res := res || jsonb_build_object('case', 'a member who already played gets 10 (launch_gift) and 1 bell note', 'ok',
    (select pack_balance from players where id = '${OLD}') = 10
    and (select count(*) from pack_ledger where player_id = '${OLD}' and reason = 'launch_gift' and amount = 10) = 1
    and (select count(*) from notifications where player_id = '${OLD}') = 1);
  res := res || jsonb_build_object('case', 'a member who never played is created with exactly 10 (no welcome on top) and the avatar', 'ok',
    (select pack_balance from players where id = '${NEW}') = 10
    and not exists (select 1 from pack_ledger where player_id = '${NEW}' and reason = 'welcome')
    and (select avatar from players where id = '${NEW}') = 'a_0123456789abcdef0123456789abcdef'
    and (select count(*) from notifications where player_id = '${NEW}') = 1);
  res := res || jsonb_build_object('case', 'a member who already got the welcome packs is skipped (10, not 20)', 'ok',
    (select pack_balance from players where id = '${EARLY}') = 10 and (select count(*) from pack_ledger where player_id = '${EARLY}') = 1);
  r2 := gift_all_members(members, 10, '${BY}');
  res := res || jsonb_build_object('case', 'a second run gives nothing', 'ok',
    (r2->>'gifted')::int = 0 and (r2->>'skipped')::int = 3 and (select pack_balance from players where id = '${OLD}') = 10, 'r', r2);
  insert into players (id, username) values ('${LATER}', 'tst later');
  res := res || jsonb_build_object('case', 'after the gift, a new member still gets the welcome packs (the skip is reset)', 'ok',
    (select pack_balance from players where id = '${LATER}') = 10 and exists (select 1 from pack_ledger where player_id = '${LATER}' and reason = 'welcome'));
  res := res || jsonb_build_object('case', 'a bad amount is refused; the other members are unchanged', 'ok',
    gift_all_members(members, 0, null)->>'error' = 'bad_amount' and gift_all_members(members, 101, null)->>'error' = 'bad_amount'
    and (select coalesce(sum(pack_balance), 0) from players where id not in ('${OLD}', '${NEW}', '${EARLY}', '${LATER}')) = other_before);
  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 500)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like '9999999999999999%') test_players, (select count(*) from pg_proc where proname = 'gift_all_members') fn_live, (select sum(pack_balance) from players) live_packs")));
process.exitCode = fail ? 1 : 0;
