/**
 * logs_sql.sql: the new logs record exactly the expected rows (settings_log, profile_log, wishlist_log,
 * stat_point_log, admin_actions with the admin gift hook), the two new columns, the 365-day retention and the
 * lockdown (RLS on, no API grants, a fixed search_path). Fake members only, rolled back.
 *   node scripts/test-logs-sql.mjs [path/to/logs_sql.sql] [--mutate]
 * With a file it applies the file inside the rolled-back block (two times: it must be idempotent). Without a
 * file it tests the database as it is (the baseline before the migration: it FAILS). --mutate also runs each
 * mutation of the file below and expects the test to FAIL for each one.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const MIG = file ? readFileSync(file, 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';

const A = 'tst_logs_a', B = 'tst_logs_b', WHO = 'tst_logs_who', ADMIN = 'tst_logs_admin';
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; got jsonb; c1 bigint; c2 bigint; c3 bigint; v_id bigint; v_id2 bigint; ok boolean; r jsonb; v_job bigint; i bigint; ids bigint[] := '{}';
begin
  ${mig ? `-- From zero (rolled back): a database that has the logs already must not hide a mutation (create ... if not exists).
  drop table if exists settings_log, profile_log, wishlist_log, stat_point_log, admin_actions cascade;
  execute $m$${mig}$m$;\n  execute $m$${mig}$m$; -- two times: idempotent` : '-- the database as it is'}
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${WHO}', true);
  insert into players (id, username) values ('${A}', 'tst logs a'), ('${B}', 'tst logs b');
  select id into c1 from cards where rarity = 'normal' order by id limit 1;
  select id into c2 from cards where rarity = 'normal' order by id offset 1 limit 1;
  select id into c3 from cards where rarity = 'normal' order by id offset 2 limit 1;

  -- 1. settings_log ------------------------------------------------------------------------------
  insert into settings (key, value) values ('tst_logs_key', '{"a":1}');
  update settings set updated_at = now() where key = 'tst_logs_key';                    -- no value change: no row
  update settings set value = '{"a":2}' where key = 'tst_logs_key';
  insert into settings (key, value) values ('tst_logs_key', '{"a":3}') on conflict (key) do update set value = excluded.value;
  delete from settings where key = 'tst_logs_key';
  select coalesce(jsonb_agg(jsonb_build_array(op, old_value, new_value, changed_by) order by id), '[]') into got from settings_log where key = 'tst_logs_key';
  res := res || jsonb_build_object('case', 'settings_log: insert, update, upsert, delete (no row for an updated_at-only update)', 'ok',
    got = '[["insert",null,{"a":1},"${WHO}"],["update",{"a":1},{"a":2},"${WHO}"],["update",{"a":2},{"a":3},"${WHO}"],["delete",{"a":3},null,"${WHO}"]]'::jsonb, 'got', got);

  -- 2. profile_log -------------------------------------------------------------------------------
  update players set pack_balance = pack_balance + 3, shard_balance = shard_balance + 5 where id = '${A}';  -- not logged
  update players set username = 'tst logs a' where id = '${A}';                                            -- the same: not logged
  update players set title = 'tst_title', frame = 'tst_frame' where id = '${A}';
  update players set spotlight = array[c1, c2] where id = '${A}';
  update players set notify_prefs = '{"all":false,"plays":true}', tutorial = '{"done":[1]}' where id = '${A}';
  update players set notify_prefs = '{"all":true,"plays":true}', avatar = 'tst_hash', username = 'tst logs a2' where id = '${A}';
  update players set title = null where id = '${A}';
  select coalesce(jsonb_agg(jsonb_build_array(field, old_value, new_value, changed_by) order by id), '[]') into got from profile_log where player_id = '${A}';
  res := res || jsonb_build_object('case', 'profile_log: one row per changed field and per changed json key, nothing for balances', 'ok',
    got = jsonb_build_array(
      '["title",null,"tst_title","${WHO}"]'::jsonb, '["frame",null,"tst_frame","${WHO}"]'::jsonb,
      jsonb_build_array('spotlight', '[]'::jsonb, jsonb_build_array(c1, c2), '${WHO}'),
      '["notify_prefs.all",null,false,"${WHO}"]'::jsonb, '["notify_prefs.plays",null,true,"${WHO}"]'::jsonb, '["tutorial.done",null,[1],"${WHO}"]'::jsonb,
      '["username","tst logs a","tst logs a2","${WHO}"]'::jsonb, '["avatar",null,"tst_hash","${WHO}"]'::jsonb, '["notify_prefs.all",false,true,"${WHO}"]'::jsonb,
      '["title","tst_title",null,"${WHO}"]'::jsonb), 'got', got);

  -- 3. wishlist_log (through the real RPCs) --------------------------------------------------------
  perform set_wishlist('${A}', 1, c1);
  perform set_wishlist('${A}', 1, c2);      -- replace
  perform set_wishlist('${A}', 2, c3);
  perform set_wish_top('${A}', 1);
  perform set_wish_top('${A}', 2);          -- unset 1, set 2
  perform set_wishlist('${A}', 1, null);    -- remove
  select coalesce(jsonb_agg(jsonb_build_array(slot, op, card_id, old_card_id) order by id), '[]') into got from wishlist_log where player_id = '${A}';
  res := res || jsonb_build_object('case', 'wishlist_log: add, replace, add, set_top, unset_top + set_top, remove', 'ok',
    got = jsonb_build_array(jsonb_build_array(1, 'add', c1, null), jsonb_build_array(1, 'replace', c2, c1), jsonb_build_array(2, 'add', c3, null),
      jsonb_build_array(1, 'set_top', c2, null), jsonb_build_array(1, 'unset_top', c2, null), jsonb_build_array(2, 'set_top', c3, null),
      jsonb_build_array(1, 'remove', c2, null)), 'got', got);

  -- 4. stat_point_log: every writer path ---------------------------------------------------------
  insert into player_cards (player_id, card_id, quantity, ascension) values ('${A}', c1, 1, 3);
  r := spend_stat_points('${A}', c1, '{"attack":2,"haste":1}');
  r := spend_stat_points('${A}', c1, '{"attack":1}');
  r := reset_stat_points('${A}', c1);                                   -- the free weekly reset
  r := spend_stat_points('${A}', c1, '{"vitality":2}');
  update players set stat_reset_week = null where id = '${A}';          -- so the Shop reset is the free one
  r := buy_shop_item('${A}', 'stat_reset', null, c1);
  res := res || jsonb_build_object('case', 'stat points: the Shop reset worked (the shards flag is on)', 'ok', (r->>'ok')::boolean, 'got', r);
  update player_cards set stat_points = '{"potency":1}' where player_id = '${A}' and card_id = c1;              -- SQL editor: up only
  update player_cards set stat_points = '{"attack":1}' where player_id = '${A}' and card_id = c1;               -- one down, one up
  update player_cards set quantity = 2 where player_id = '${A}' and card_id = c1;                               -- not a stat change
  delete from player_cards where player_id = '${A}' and card_id = c1;                                           -- the points leave
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values ('${A}', c2, 1, 1, '{"precision":1}');
  select coalesce(jsonb_agg(jsonb_build_array(card_id = c1, stat, delta, points, reason, changed_by) order by id), '[]') into got from stat_point_log where player_id = '${A}';
  res := res || jsonb_build_object('case', 'stat_point_log: spend, spend, reset, spend, Shop reset, SQL spend, SQL other, delete, insert', 'ok',
    got = '[[true,"attack",2,2,"spend","${WHO}"],[true,"haste",1,1,"spend","${WHO}"],[true,"attack",1,3,"spend","${WHO}"],
            [true,"attack",-3,0,"reset","${WHO}"],[true,"haste",-1,0,"reset","${WHO}"],[true,"vitality",2,2,"spend","${WHO}"],
            [true,"vitality",-2,0,"reset","${WHO}"],[true,"potency",1,1,"spend","${WHO}"],
            [true,"attack",1,1,"other","${WHO}"],[true,"potency",-1,0,"other","${WHO}"],[true,"attack",-1,0,"other","${WHO}"],
            [false,"precision",1,1,"other","${WHO}"]]'::jsonb, 'got', got);
  -- The writers of player_cards.stat_points in the catalog: exactly these three functions (a new one is a new path to check).
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into got from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* 'update\s+(public\.)?player_cards\s+set[^;]*stat_points';
  res := res || jsonb_build_object('case', 'the SQL writers of stat_points are spend_stat_points, reset_stat_points, buy_shop_item', 'ok',
    got = '["buy_shop_item","reset_stat_points","spend_stat_points"]'::jsonb, 'got', got);

  -- 5. admin_actions -----------------------------------------------------------------------------
  v_id := admin_log_action('${ADMIN}', 'tst_set', 'player', '${A}', '{"x":1}', '{"x":2}', 'tst reason', 'studio', null);
  select jsonb_build_array(actor, action, target_kind, target_id, before, after, reason, source, undo_of) into got from admin_actions where id = v_id;
  res := res || jsonb_build_object('case', 'admin_log_action writes the row it was given', 'ok',
    got = '["${ADMIN}","tst_set","player","${A}",{"x":1},{"x":2},"tst reason","studio",null]'::jsonb, 'got', got);
  v_id2 := admin_log_action('${ADMIN}', 'tst_undo', 'player', '${A}', '{"x":2}', '{"x":1}', 'undo', 'studio', v_id);
  res := res || jsonb_build_object('case', 'an undo row points at the action', 'ok', (select undo_of from admin_actions where id = v_id2) = v_id);
  ok := false; begin perform admin_log_action('${ADMIN}', 'tst_undo', 'player', '${A}', null, null, 'undo again', 'studio', v_id); exception when unique_violation then ok := true; end;
  res := res || jsonb_build_object('case', 'a second undo of one action is refused', 'ok', ok);
  ok := false; begin perform admin_log_action('${ADMIN}', 'tst', null, null, null, null, null, 'web', null); exception when check_violation then ok := true; end;
  res := res || jsonb_build_object('case', 'a bad source is refused', 'ok', ok);
  ok := false; begin perform admin_log_action(' ', 'tst', null, null, null, null, null, 'sql', null); exception when check_violation then ok := true; end;
  res := res || jsonb_build_object('case', 'an empty actor is refused', 'ok', ok);
  ok := false; begin perform admin_log_action('${ADMIN}', 'tst', null, null, null, null, null, 'sql', -1); exception when foreign_key_violation then ok := true; end;
  res := res || jsonb_build_object('case', 'undo_of must be an existing action', 'ok', ok);

  -- The admin gift hook: /givepacks (give_gift reason admin), a member gift (no row), an SQL event gift to two members in one statement.
  i := give_gift('${A}', 'promo', 'Tst admin gift', 2, 'admin', '${ADMIN}');
  i := give_gift('${A}', 'member_gift', 'Tst member gift', 1, 'gift_received', '${B}');
  insert into gift_claims (player_id, kind, title, amount, reason) values ('${A}', 'promo', 'Tst event', 4, 'event'), ('${B}', 'promo', 'Tst event', 4, 'event');
  select coalesce(jsonb_agg(jsonb_build_array(actor, action, target_kind, target_id, reason, source, after->'count', after->'amount', jsonb_array_length(after->'gift_ids')) order by id), '[]') into got
    from admin_actions where action = 'gift' and id > v_id2;
  res := res || jsonb_build_object('case', 'admin gifts: one row for /givepacks (bot), none for a member gift, one row for a two-member SQL event gift', 'ok',
    got = '[["${ADMIN}","gift","player","${A}","admin","bot",1,2,1],["${WHO}","gift","players",null,"event","sql",2,4,2]]'::jsonb, 'got', got);

  -- 6. and 7. the columns -------------------------------------------------------------------------
  res := res || jsonb_build_object('case', 'notifications.read_at: nullable timestamptz', 'ok', exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'read_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES'));
  res := res || jsonb_build_object('case', 'player_reports.target_id: nullable, FK players on delete set null', 'ok', exists (select 1 from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.conrelid = 'public.player_reports'::regclass and k.contype = 'f' and a.attname = 'target_id' and not a.attnotnull
      and k.confrelid = 'public.players'::regclass and k.confdeltype = 'n'));

  -- 8. retention -----------------------------------------------------------------------------------
  select jobid into v_job from cron.job order by jobid limit 1;
  insert into notifications (player_id, kind, message, read, created_at) values ('${A}', 'tst', 'x', true, now() - interval '31 days') returning id into i; ids := ids || i;
  insert into notifications (player_id, kind, message, read, created_at) values ('${A}', 'tst', 'x', false, now() - interval '364 days') returning id into i; ids := ids || i;
  insert into notifications (player_id, kind, message, read, created_at) values ('${A}', 'tst', 'x', true, now() - interval '366 days') returning id into i; ids := ids || i;
  insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'succeeded', now() - interval '89 days', now() - interval '89 days') returning runid into i; ids := ids || i;
  insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'succeeded', now() - interval '91 days', now() - interval '91 days') returning runid into i; ids := ids || i;
  perform prune_old_rows();
  res := res || jsonb_build_object('case', 'retention: a read note 31 days old and an unread note 364 days old stay, a note 366 days old goes', 'ok',
    exists (select 1 from notifications where id = ids[1]) and exists (select 1 from notifications where id = ids[2]) and not exists (select 1 from notifications where id = ids[3]));
  res := res || jsonb_build_object('case', 'retention: a cron run 89 days old stays, 91 days old goes', 'ok',
    exists (select 1 from cron.job_run_details where runid = ids[4]) and not exists (select 1 from cron.job_run_details where runid = ids[5]));

  -- 9. lockdown -------------------------------------------------------------------------------------
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]') into got from pg_class c where c.oid in
    ('public.settings_log'::regclass, 'public.profile_log'::regclass, 'public.wishlist_log'::regclass, 'public.stat_point_log'::regclass, 'public.admin_actions'::regclass)
    and c.relrowsecurity and not has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    and obj_description(c.oid, 'pg_class') is not null;
  res := res || jsonb_build_object('case', 'the 5 logs: RLS on, no API grants, a comment', 'ok', jsonb_array_length(got) = 5, 'got', got);
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into got from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('settings_log_write', 'profile_log_write', 'wishlist_log_write', 'stat_point_log_write', 'admin_log_action', 'gift_admin_log', 'prune_old_rows')
     and not p.prosecdef and array_to_string(p.proconfig, ',') ilike '%search_path=public%' and obj_description(p.oid, 'pg_proc') is not null
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
  res := res || jsonb_build_object('case', 'the 7 functions: invoker, search_path public, a comment, no API execute', 'ok', jsonb_array_length(got) = 7, 'got', got);
  raise exception 'RESULTS %', res;
end $t$;`;

const run = async (mig) => {
  const out = JSON.stringify(await q(body(mig)));
  const m = out.match(/RESULTS (\[.*\])/);
  if (!m) return { error: out.slice(0, 1200) };
  return { results: JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')) };
};

const base = await run(MIG);
let fail = 0;
if (base.error) { console.log('FAIL NO RESULTS:', base.error); fail = 1; }
else {
  for (const x of base.results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok || x.got === undefined ? '' : ` got ${JSON.stringify(x.got)}`}`); }
  console.log(fail ? `${fail} of ${base.results.length} FAILED` : `PASS all ${base.results.length}`);
}

// Mutations: each breaks one invariant in the file; the test must catch each one.
if (args.includes('--mutate') && MIG) {
  const MUT = [
    ['settings_log: no delete row', "if tg_op = 'DELETE' then\n    insert into settings_log", "if false then\n    insert into settings_log"],
    ['profile_log: the json keys are not split', "'notify_prefs.' || k2", "'notify_prefs'"],
    ['profile_log: title not logged', "(3, 'title', to_jsonb(old.title), to_jsonb(new.title)),", ''],
    ['wishlist_log: no unset_top', "case when new.top then 'set_top' else 'unset_top' end", "'set_top'"],
    ['stat_point_log: no delete trigger', 'create trigger stat_point_log_del after delete', 'create trigger stat_point_log_del after update'],
    ['stat_point_log: a reset looks like other', "then 'reset'", "then 'other'"],
    ['admin gift hook: event gifts skipped', "('admin', 'event', 'launch_gift')", "('admin', 'launch_gift')"],
    ['admin_actions: a second undo allowed', 'create unique index if not exists admin_actions_one_undo', 'create index if not exists admin_actions_one_undo'],
    ['retention: notes 30 days again', "where created_at < now() - interval '365 days'", "where created_at < now() - interval '30 days'"],
    ['retention: cron 14 days again', "interval '90 days'", "interval '14 days'"],
    ['lockdown: profile_log RLS off', 'alter table public.profile_log enable row level security;', 'alter table public.profile_log disable row level security;'],
  ];
  let caught = 0;
  for (const [name, from, to] of MUT) {
    if (!MIG.includes(from)) { console.log(`MUTATION FAIL (text not found): ${name}`); fail++; continue; }
    const r = await run(MIG.split(from).join(to));
    const failed = r.error || r.results.some((x) => !x.ok);
    if (failed) caught++; else fail++;
    console.log(`${failed ? 'PASS' : 'FAIL'} mutation caught: ${name}${failed && !r.error ? ` (${r.results.filter((x) => !x.ok).map((x) => x.case.split(':')[0]).join('; ')})` : ''}`);
  }
  console.log(`mutations caught ${caught}/${MUT.length}`);
}
process.exitCode = fail ? 1 : 0;
