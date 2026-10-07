/**
 * Test logs_app.sql (the app logs: app_sessions, tutorial_steps, page_views, the read / target / guild columns) with NO lasting change:
 *   node scripts/test-logs-app.mjs [file.sql]      (default: ../tcg-bot/supabase/logs_app.sql; the file is safe to re-run)
 *   MUTATE=<name> node scripts/test-logs-app.mjs   must FAIL, for every name:
 *     idle      a visit never ends (no new row after 30 minutes)   merge   the client info of a visit is replaced, not merged
 *     makerow   a visit makes a session for an unknown member       older   an older join time overwrites a newer one
 *     close     a new visit does not end the open one               create  guild_joined makes a players row
 * One DO block: apply the file, make test members, call the functions, check the rows, then RAISE (rollback).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const FILE = process.argv[2] || new URL('../../tcg-bot/supabase/logs_app.sql', import.meta.url);
const mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');
const TOUCH = 'public.app_session_touch(text,jsonb)', JOINED = 'public.guild_joined(jsonb)';
const MUT = mutation({
  idle: [TOUCH, "v_seen > now() - interval '30 minutes'", "v_seen > now() - interval '30 days'"],
  merge: [TOUCH, 'client = client || v_client', 'client = v_client'],
  makerow: [TOUCH, 'if not exists (select 1 from players where id = p_player) then return null; end if;', "insert into players (id, username) values (p_player, 'made') on conflict do nothing;"],
  close: [TOUCH, 'update app_sessions set ended_at = last_seen_at where player_id = p_player and ended_at is null;', 'null;'],
  older: [JOINED, '(p.guild_joined_at is null or p.guild_joined_at < r.at)', 'true'],
  create: [JOINED, 'get diagnostics n = row_count;', "get diagnostics n = row_count; insert into players (id, username) select r2->>'id', 'made' from jsonb_array_elements(p_rows) r2 on conflict do nothing;"],
});
const A = 'tst_logs_a', B = 'tst_logs_b';

const body = String.raw`do $t$ declare
  bad text := ''; s1 bigint; s2 bigint; s3 bigint; n int; c jsonb; ok boolean; ts timestamptz;
begin
  execute $m$${mig}$m$;
  ${MUT}
  insert into players (id, username) values ('${A}', 'tst logs a'), ('${B}', 'tst logs b');

  -- 1. A visit: the first call starts a row; a call within 30 minutes continues it and merges the client info.
  s1 := app_session_touch('${A}', '{"platform":"desktop","ua":"x"}');
  if s1 is null then bad := bad || 'no session id; '; end if;
  update app_sessions set last_seen_at = now() - interval '29 minutes', started_at = now() - interval '40 minutes' where id = s1;
  s2 := app_session_touch('${A}', '{"w":800,"h":600}');
  select count(*) into n from app_sessions where player_id = '${A}';
  if s2 is distinct from s1 or n <> 1 then bad := bad || 'a call within 30 min made a new row (' || n || '); '; end if;
  select client into c from app_sessions where id = s1;
  if c is distinct from '{"platform":"desktop","ua":"x","w":800,"h":600}'::jsonb then bad := bad || 'client not merged: ' || c::text || '; '; end if;
  if (select last_seen_at from app_sessions where id = s1) <> now() then bad := bad || 'last_seen_at not moved; '; end if;
  -- a null or non-object client changes nothing
  perform app_session_touch('${A}', null); perform app_session_touch('${A}', '[1]');
  if (select client from app_sessions where id = s1) is distinct from c then bad := bad || 'a null client changed the row; '; end if;

  -- 2. After 30 minutes idle: the open row ends at its last_seen_at, a new row starts.
  ts := now() - interval '31 minutes';
  update app_sessions set last_seen_at = ts where id = s1;
  s3 := app_session_touch('${A}', '{"platform":"mobile"}');
  if s3 is null or s3 = s1 then bad := bad || 'no new row after 31 min idle; '; end if;
  if (select ended_at from app_sessions where id = s1) is distinct from ts then bad := bad || 'the old row did not end at its last_seen_at; '; end if;
  if (select ended_at from app_sessions where id = s3) is not null then bad := bad || 'the new row is ended; '; end if;
  if (select client from app_sessions where id = s3) is distinct from '{"platform":"mobile"}'::jsonb then bad := bad || 'the new row has old client info; '; end if;

  -- 3. An unknown member: null, no row, no players row.
  if app_session_touch('tst_logs_nobody', '{}') is not null then bad := bad || 'unknown member got a session; '; end if;
  if exists (select 1 from players where id = 'tst_logs_nobody') or exists (select 1 from app_sessions where player_id = 'tst_logs_nobody') then bad := bad || 'unknown member: a row was made; '; end if;

  -- 4. tutorial_steps: one row per member and step (the first time stays); page_views: a bad view name is refused.
  insert into tutorial_steps (player_id, step, done_at) values ('${A}', 'open', now() - interval '1 day');
  insert into tutorial_steps (player_id, step) values ('${A}', 'open') on conflict do nothing;
  if (select count(*) from tutorial_steps where player_id = '${A}') <> 1 or (select done_at from tutorial_steps where player_id = '${A}') <> now() - interval '1 day' then bad := bad || 'tutorial step repeated or moved; '; end if;
  insert into page_views (player_id, view, ref) values ('${A}', 'shop', null), ('${A}', 'auction', '12');
  begin insert into page_views (player_id, view) values ('${A}', 'Shop; drop'); bad := bad || 'a bad view name was stored; '; exception when check_violation then null; end;
  begin insert into page_views (player_id, view) values ('tst_logs_nobody', 'shop'); bad := bad || 'a view of an unknown member was stored; '; exception when foreign_key_violation then null; end;

  -- 5. guild_joined: only existing rows, only a newer time; the newest time of one id in the list wins.
  n := guild_joined(jsonb_build_array(
    jsonb_build_object('id', '${A}', 'at', '2026-09-01T00:00:00Z'), jsonb_build_object('id', '${A}', 'at', '2026-09-05T00:00:00Z'),
    jsonb_build_object('id', 'tst_logs_nobody', 'at', '2026-09-01T00:00:00Z')));
  if n <> 1 or (select guild_joined_at from players where id = '${A}') <> '2026-09-05T00:00:00Z' then bad := bad || 'guild_joined set ' || n || ' rows, ' || coalesce((select guild_joined_at from players where id = '${A}')::text, 'null') || '; '; end if;
  if exists (select 1 from players where id = 'tst_logs_nobody') then bad := bad || 'guild_joined made a players row; '; end if;
  n := guild_joined(jsonb_build_array(jsonb_build_object('id', '${A}', 'at', '2026-08-01T00:00:00Z')));
  if n <> 0 or (select guild_joined_at from players where id = '${A}') <> '2026-09-05T00:00:00Z' then bad := bad || 'an older join time overwrote the newer one; '; end if;
  if guild_joined('{}'::jsonb) <> 0 then bad := bad || 'a non-array changed rows; '; end if;

  -- 6. guild_left: an existing row only.
  ok := guild_left('${B}', '2026-09-10T00:00:00Z');
  if not ok or (select left_guild_at from players where id = '${B}') <> '2026-09-10T00:00:00Z' then bad := bad || 'guild_left did not set the row; '; end if;
  if guild_left('tst_logs_nobody') then bad := bad || 'guild_left reported an unknown member; '; end if;

  -- 7. The columns of the other writers exist with their types.
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'read_at') is distinct from 'timestamp with time zone' then bad := bad || 'notifications.read_at; '; end if;
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'player_reports' and column_name = 'target_id') is distinct from 'text' then bad := bad || 'player_reports.target_id; '; end if;
  begin update player_reports set target_id = 'tst_logs_nobody' where false; insert into player_reports (player_id, kind, body, target_id) values ('${A}', 'bug', 'a test report', 'tst_logs_nobody'); bad := bad || 'target_id accepts an unknown member; ';
  exception when foreign_key_violation then null; end;

  -- 8. Closed to the API roles: RLS on, no table grants, no function execute.
  select count(*) into n from pg_class where oid in ('public.app_sessions'::regclass, 'public.tutorial_steps'::regclass, 'public.page_views'::regclass) and relrowsecurity;
  if n <> 3 then bad := bad || 'RLS is off on ' || (3 - n) || ' tables; '; end if;
  if has_table_privilege('anon', 'public.app_sessions', 'select') or has_table_privilege('authenticated', 'public.page_views', 'insert')
     or has_table_privilege('anon', 'public.tutorial_steps', 'select') then bad := bad || 'an API role has a table grant; '; end if;
  if has_function_privilege('anon', '${TOUCH}', 'execute') or has_function_privilege('authenticated', '${JOINED}', 'execute')
     or has_function_privilege('anon', 'public.guild_left(text,timestamptz)', 'execute') then bad := bad || 'an API role can run a log function; '; end if;

  -- 9. The file runs again on its own result (safe to re-run).
  begin execute $m$${mig}$m$; exception when others then bad := bad || 'second run: ' || sqlerrm || '; '; end;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2000));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
