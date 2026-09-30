/**
 * Acceptance test for tcg-bot/supabase/welcome_packs.sql against the LIVE database with NO
 * lasting change:  node scripts/test-welcome-packs.mjs
 * One DO block applies the migration, creates members the ways the bot and the Activity
 * do, checks each rule, then RAISEs the results. The exception rolls back everything.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/welcome_packs.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const A = '999999999999999901', B = '999999999999999902', C = '999999999999999903', D = '999999999999999904';
const body = String.raw`do $t$
declare res jsonb := '[]'; before_sum bigint; before_n bigint; ok boolean;
begin
  select coalesce(sum(pack_balance), 0), count(*) into before_sum, before_n from players;
  execute $m$${mig}$m$;

  -- The bot's path (ensurePlayer): upsert ... on conflict do update.
  insert into players (id, username) values ('${A}', 'tst new a') on conflict (id) do update set username = excluded.username;
  res := res || jsonb_build_object('case', 'a new member (bot upsert) gets 10 packs, 1 ledger row, 1 bell note', 'ok',
    (select pack_balance from players where id = '${A}') = 10
    and (select count(*) from pack_ledger where player_id = '${A}' and reason = 'welcome' and amount = 10) = 1
    and (select count(*) from notifications where player_id = '${A}' and kind = 'pack_gift') = 1);

  insert into players (id, username) values ('${A}', 'tst new a2') on conflict (id) do update set username = excluded.username;
  res := res || jsonb_build_object('case', 'the same member again (upsert) gets nothing more', 'ok',
    (select pack_balance from players where id = '${A}') = 10
    and (select count(*) from pack_ledger where player_id = '${A}') = 1
    and (select count(*) from notifications where player_id = '${A}') = 1);

  -- The Activity's path (ensurePlayerRow): upsert ... on conflict do nothing.
  insert into players (id, username) values ('${B}', 'tst new b') on conflict (id) do nothing;
  insert into players (id, username) values ('${B}', 'tst new b') on conflict (id) do nothing;
  res := res || jsonb_build_object('case', 'a new member (Activity, do nothing) gets 10 once', 'ok',
    (select pack_balance from players where id = '${B}') = 10 and (select count(*) from pack_ledger where player_id = '${B}') = 1);

  insert into players (id, username) values ('tst_welcome', 'tst');
  res := res || jsonb_build_object('case', 'a test id (not a Discord id) gets nothing', 'ok',
    (select pack_balance from players where id = 'tst_welcome') = 0 and (select count(*) from pack_ledger where player_id = 'tst_welcome') = 0);

  update settings set value = '0'::jsonb where key = 'welcome_packs';
  insert into players (id, username) values ('${C}', 'tst new c');
  res := res || jsonb_build_object('case', 'welcome_packs = 0 turns it off', 'ok',
    (select pack_balance from players where id = '${C}') = 0 and (select count(*) from pack_ledger where player_id = '${C}') = 0);
  update settings set value = '"x"'::jsonb where key = 'welcome_packs';
  insert into players (id, username) values ('${D}', 'tst new d');
  res := res || jsonb_build_object('case', 'a bad setting value grants nothing (fails closed)', 'ok',
    (select pack_balance from players where id = '${D}') = 0);

  select (coalesce(sum(pack_balance), 0) = before_sum) into ok from players where id not in ('${A}', '${B}', '${C}', '${D}', 'tst_welcome');
  res := res || jsonb_build_object('case', 'the existing members are unchanged', 'ok', ok
    and (select count(*) from players) = before_n + 5);

  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like '9999999999999999%' or id like 'tst%') test_players, (select count(*) from pg_trigger where tgname = 'players_welcome_packs') trigger_live, (select count(*) from settings where key = 'welcome_packs') setting_live")));
process.exitCode = fail ? 1 : 0;
