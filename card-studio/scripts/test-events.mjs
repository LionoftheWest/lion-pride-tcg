/**
 * events.sql: the Events system. Fake members only, one DO block, always rolled back.
 *   node scripts/test-events.mjs [path/to/events.sql] [--mutate]
 * With a file it applies the file inside the rolled-back block (two times: it must be idempotent), from zero (the
 * events tables and the two event_id columns are dropped first, so an object that exists already cannot hide a
 * mutation). Without a file it tests the database as it is (before the migration: it FAILS, the baseline).
 * --mutate runs each mutation of the file below and expects the test to FAIL for each one.
 * Invariants:
 *   E1 the shapes: valid audience / rewards / rules give no error, each bad shape gives its exact error; the CHECK refuses a bad row
 *   E2 the audience: members, left the server, tutorial_done, joined_after/before, active_since, everyone
 *   E3 the state machine of a drop: draft is ignored, scheduled waits, live pays the start once, ended; event_log in order
 *   E4 exactly once across ticks; the gifts carry event_id; Redeem writes ledger rows that point at the gift; admin_actions
 *   E5 a trigger event pays each member once, inside the window only, on the tick after the action; the end pays once
 *   E6 a rank event: rank() with ties, the tiers, the end paid once (a second payout is already_paid)
 *   E7 the preview has no side effects and matches the payout; new_* is 0 after the payout
 *   E8 cancel stops the payouts; the stale check; a live event changes only text and end; ended is locked
 *   E9 hunt_hit, hunt_damage, tutorial_done and dungeon_run read the right tables in the window
 *   E10 a drop with late_joiners pays a member who joins later, on the next tick
 *   E11 the launch event: one row with the settings window, its gifts and cards linked, the same gifts as before on
 *       the same inputs (the launch functions unchanged: md5), the tick never pays it and only ends it; Admin refuses it
 *   E12 the lockdown: RLS on, no API grants, anon and authenticated cannot call the functions, search_path, comments
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const MIG = file ? readFileSync(file, 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';

// The launch functions that must stay as they are (db/schema/functions/*.sql md5 before this file).
const LAUNCH_MD5 = {
  'public.launch_player_gift(text)': 'd8530e349fd439f5367768b2a88db4f5',
  'public.launch_raider_gift()': '29bb8b3672f64105ea8506b1c084fd44',
  'public.set_launch_player_card(bigint)': '154ae3017b164634b8f166d1cab90dbb',
  'public.give_card_gift(text, bigint, text, text)': '463b0640f85010d294db9bb8cfb85769',
  'public.claim_tutorial_reward(text)': 'eec8f640fdc2ea7e70177e68532b43be',
  'public.claim_gift(text, bigint)': '3492a584dd9a8a56a934ce91b8374c4d',
};
const md5Json = JSON.stringify(LAUNCH_MD5);

const A = 'tst_ev_a', B = 'tst_ev_b', C = 'tst_ev_c', D = 'tst_ev_d', E = 'tst_ev_e', ADMIN = 'tst_ev_admin';
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; got jsonb; r jsonb; ok boolean; n int; n2 int; T timestamptz := date_trunc('second', now()); card bigint; card2 bigint;
  ev bigint; ev2 bigint; ev3 bigint; ev4 bigint; ev5 bigint; ev6 bigint; up timestamptz; g bigint; hb bigint; cnt jsonb; cnt2 jsonb; lid bigint; cfg jsonb;
  launch_before int;
begin
  ${mig ? `drop table if exists event_payouts, event_log, events cascade;
  alter table gift_claims drop column if exists event_id;
  alter table cards drop column if exists event_id;
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent` : '-- the database as it is'}
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${ADMIN}', true);
  insert into players (id, username, created_at) values ('${A}', 'tst ev a', T - interval '30 days'), ('${B}', 'tst ev b', T - interval '2 days'),
    ('${C}', 'tst ev c', T - interval '30 days'), ('${D}', 'tst ev d', T - interval '30 days');
  update players set left_guild_at = T - interval '1 day' where id = '${C}';
  select id into card from cards where rarity = 'normal' order by id limit 1;
  select id into card2 from cards where rarity = 'normal' order by id offset 1 limit 1;
  cfg := (select value from settings where key = 'launch_event_cards');
  select count(*) into launch_before from gift_claims where reason in ('event:launch_player', 'event:launch_raider');

  -- E1 the shapes ------------------------------------------------------------------------------------------
  select jsonb_agg(to_jsonb(event_shape_errors(x.k, x.a::jsonb, x.w::jsonb, x.u::jsonb)) order by x.i) into got from (values
    (1, 'drop', '{"all": true}', '{"per_member": {"packs": 2}}', '{}'),
    (2, 'drop', '{"all": true, "members": ["a"]}', '{"per_member": {"packs": 2}}', '{}'),
    (3, 'drop', '{}', '{"per_member": {"packs": 2}}', '{}'),
    (4, 'drop', '{"active_since": "2026-10-01"}', '{"per_member": {"packs": 2}}', '{}'),
    (5, 'drop', '{"members": ["a", "a"]}', '{"per_member": {"packs": 2}}', '{}'),
    (6, 'drop', '{"all": true}', '{"per_member": {"packs": 101}}', '{}'),
    (7, 'drop', '{"all": true}', '{"per_member": {}}', '{}'),
    (8, 'rank', '{"all": true}', '{"ranks": [{"from": 1, "to": 2, "packs": 1}, {"from": 2, "to": 3, "packs": 1}]}', '{"metric": "hunt_damage"}'),
    (9, 'trigger', '{"tutorial_done": true}', '{"per_member": {"shards": 10}}', '{"trigger": "chat"}'),
    (10, 'party', '{"all": true}', '{}', '{}'),
    (11, 'drop', '{"all": true}', '{"per_member": {"packs": 1.5}}', '{}'),
    (12, 'trigger', '{"joined_after": "2026-10-01T00:00:00Z", "active_since": "2026-10-01T00:00:00-06:00"}', '{"title": "Hi", "per_member": {"card_id": 5}}', '{"trigger": "hunt_hit"}'),
    (13, 'drop', '{"all": true}', '{"per_member": {"packs": 1}, "ranks": []}', '{"late_joiners": "yes"}'),
    (14, 'launch_cards', '{"all": true}', '{}', '{"settings_key": "x", "gift_reasons": ["event:x"]}')
  ) x(i, k, a, w, u);
  res := res || jsonb_build_object('case', 'E1 the shapes: each valid shape no error, each bad shape its exact errors', 'ok', got = jsonb_build_array(
    '[]'::jsonb, '["audience: all must be true and alone"]'::jsonb, '["audience: choose everyone or at least one filter"]'::jsonb,
    '["audience: active_since must be an ISO time with a zone"]'::jsonb, '["audience: a member is listed twice"]'::jsonb,
    '["rewards.per_member: packs must be 0 to 100"]'::jsonb, '["rewards.per_member: give packs, Shards or a card"]'::jsonb,
    '["rewards.ranks[2]: the tiers must go up and not overlap"]'::jsonb, '["rules: trigger must be hunt_hit, tutorial_done, pack_opened or dungeon_run"]'::jsonb,
    '["kind must be drop, trigger, rank or launch_cards"]'::jsonb, '["rewards.per_member: packs must be a whole number"]'::jsonb, '[]'::jsonb,
    '["rewards: a drop event has per_member, not ranks", "rules: late_joiners must be true or false"]'::jsonb, '[]'::jsonb), 'got', got);
  ok := false;
  begin
    insert into events (key, kind, title, starts_at, ends_at, audience, rewards, created_by) values ('tst_ev_bad', 'drop', 'x', T, T + interval '1 hour', '{}', '{"per_member": {"packs": 1}}', 'x');
  exception when check_violation then ok := true; end;
  res := res || jsonb_build_object('case', 'E1 the CHECK refuses a row with a bad shape', 'ok', ok);

  -- E2 the audience ----------------------------------------------------------------------------------------
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', 1, 'tutorial', 'tutorial', 'complete', T - interval '3 days');
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${D}', -1, 'opened', 'open', 'tst_ev_open_d', T - interval '1 hour');
  select jsonb_agg(x.v order by x.i) into got from (
    select 1 i, (select coalesce(jsonb_agg(member_id order by member_id), '[]') from event_audience('{"members": ["${A}", "${B}", "${C}"]}', T)) v union all
    select 2, (select coalesce(jsonb_agg(member_id order by member_id), '[]') from event_audience('{"members": ["${A}", "${B}", "${C}", "${D}"], "tutorial_done": true}', T)) union all
    select 3, (select coalesce(jsonb_agg(member_id order by member_id), '[]') from event_audience(jsonb_build_object('members', jsonb_build_array('${A}', '${B}', '${D}'), 'joined_after', to_char((T - interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), T)) union all
    select 4, (select coalesce(jsonb_agg(member_id order by member_id), '[]') from event_audience(jsonb_build_object('members', jsonb_build_array('${A}', '${B}', '${D}'), 'joined_before', to_char((T - interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), T)) union all
    select 5, (select coalesce(jsonb_agg(member_id order by member_id), '[]') from event_audience(jsonb_build_object('members', jsonb_build_array('${A}', '${B}', '${D}'), 'active_since', to_char((T - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), T)) union all
    select 6, to_jsonb((select count(*) from event_audience('{"all": true}', T)) = (select count(*) from players where left_guild_at is null))
  ) x;
  res := res || jsonb_build_object('case', 'E2 the audience: members (left server out), tutorial_done, joined_after, joined_before, active_since, everyone', 'ok', got = jsonb_build_array(
    '["${A}", "${B}"]'::jsonb, '["${A}"]'::jsonb, '["${B}"]'::jsonb, '["${A}", "${D}"]'::jsonb, '["${D}"]'::jsonb, 'true'::jsonb), 'got', got);

  -- E3 / E4 a drop ------------------------------------------------------------------------------------------
  r := admin_event_save(jsonb_build_object('key', 'tst_ev_drop', 'kind', 'drop', 'title', 'Tst Drop', 'starts_at', T + interval '1 hour', 'ends_at', T + interval '2 hours',
    'audience', jsonb_build_object('members', jsonb_build_array('${A}', '${B}', '${C}')), 'rewards', jsonb_build_object('per_member', jsonb_build_object('packs', 3, 'shards', 50, 'card_id', card))), null, '${ADMIN}', 'tst');
  ev := (r->'event'->>'id')::bigint;
  res := res || jsonb_build_object('case', 'E3 save a new event: a draft by the actor', 'ok', r->>'ok' = 'true' and r->'event'->>'status' = 'draft' and r->'event'->>'created_by' = '${ADMIN}', 'got', r);
  perform event_tick(T + interval '90 minutes');
  res := res || jsonb_build_object('case', 'E3 the tick ignores a draft', 'ok', (select status from events where id = ev) = 'draft' and not exists (select 1 from gift_claims where event_id = ev));
  r := admin_event_schedule(ev, (select updated_at from events where id = ev), '${ADMIN}', true);
  perform event_tick(T + interval '30 minutes');
  res := res || jsonb_build_object('case', 'E3 scheduled waits for starts_at', 'ok', r->>'ok' = 'true' and (select status from events where id = ev) = 'scheduled' and not exists (select 1 from gift_claims where event_id = ev), 'got', r);
  perform event_tick(T + interval '90 minutes');
  select jsonb_agg(jsonb_build_array(player_id, kind, title, amount, shards, reason, card_id = card, from_id, claimed_at) order by player_id, kind) into got from gift_claims where event_id = ev;
  res := res || jsonb_build_object('case', 'E3/E4 live: the start pays each audience member once (packs+Shards gift, card gift), event_id set', 'ok',
    (select status from events where id = ev) = 'live' and got = jsonb_build_array(
      jsonb_build_array('${A}', 'card', (select left(name, 80) from cards where id = card), 1, 0, 'event', true, null, null),
      jsonb_build_array('${A}', 'promo', 'Tst Drop', 3, 50, 'event', null, null, null),
      jsonb_build_array('${B}', 'card', (select left(name, 80) from cards where id = card), 1, 0, 'event', true, null, null),
      jsonb_build_array('${B}', 'promo', 'Tst Drop', 3, 50, 'event', null, null, null)), 'got', got);
  perform event_tick(T + interval '100 minutes');
  perform event_tick(T + interval '110 minutes');
  r := event_pay(ev, 'start', T + interval '115 minutes');
  res := res || jsonb_build_object('case', 'E4 exactly once: two more ticks and a second start payout give nothing (already_paid)', 'ok',
    (select count(*) from gift_claims where event_id = ev) = 4 and r->>'error' = 'already_paid', 'got', r);
  select jsonb_agg(jsonb_build_array(period, members, packs, shards, cards) order by period) into got from event_payouts where event_id = ev;
  res := res || jsonb_build_object('case', 'E4 event_payouts: one start row with the totals', 'ok', got = '[["start", 2, 6, 100, 2]]'::jsonb, 'got', got);
  select jsonb_agg(jsonb_build_array(actor, reason, source, after->'count', after->'amount', after->'shards') order by (after->>'amount')::int desc) into got from admin_actions where action = 'gift' and after->'gift_ids' <@ (select jsonb_agg(id) from gift_claims where event_id = ev);
  res := res || jsonb_build_object('case', 'E4 the payout writes admin_actions through gift_admin_log (actor event:<key>)', 'ok',
    got = '[["event:tst_ev_drop", "event", "sql", 2, 3, 50], ["event:tst_ev_drop", "event", "sql", 2, 1, 0]]'::jsonb, 'got', got);
  select id into g from gift_claims where event_id = ev and player_id = '${A}' and kind = 'promo';
  r := claim_gift('${A}', g);
  select jsonb_build_array((select jsonb_agg(jsonb_build_array(amount, reason, ref_kind, ref_id = g::text)) from pack_ledger where player_id = '${A}' and ref_kind = 'gift' and ref_id = g::text),
                           (select jsonb_agg(jsonb_build_array(amount, reason, ref_kind, ref_id = g::text)) from shard_ledger where player_id = '${A}' and ref_kind = 'gift' and ref_id = g::text)) into got;
  res := res || jsonb_build_object('case', 'E4 Redeem: the ledger rows point at the gift (ref gift, id), reason event', 'ok',
    r->>'ok' = 'true' and got = '[[[3, "event", "gift", true]], [[50, "event", "gift", true]]]'::jsonb, 'got', got);
  perform event_tick(T + interval '3 hours');
  select jsonb_agg(action order by id) into got from event_log where event_id = ev;
  res := res || jsonb_build_object('case', 'E3 ended at ends_at, no end payout for a drop; event_log: create, schedule, start, pay, end', 'ok',
    (select status = 'ended' and ended_at = T + interval '3 hours' from events where id = ev) and (select count(*) from gift_claims where event_id = ev) = 4
    and got = '["create", "schedule", "start", "pay", "end"]'::jsonb, 'got', got);
  select jsonb_agg(jsonb_build_array(actor, action, target_kind, target_id = ev::text) order by id) into got from admin_actions where target_kind = 'event' and target_id = ev::text;
  res := res || jsonb_build_object('case', 'E3 the admin changes write admin_actions (create, schedule)', 'ok',
    got = '[["${ADMIN}", "event_create", "event", true], ["${ADMIN}", "event_schedule", "event", true]]'::jsonb, 'got', got);
  r := admin_event_save(jsonb_build_object('id', ev, 'title', 'New'), (select updated_at from events where id = ev), '${ADMIN}', null);
  res := res || jsonb_build_object('case', 'E8 an ended event is locked', 'ok', r->>'error' = 'locked', 'got', r);

  -- E5 a trigger event (pack_opened) ------------------------------------------------------------------------
  r := admin_event_save(jsonb_build_object('key', 'tst_ev_trig', 'kind', 'trigger', 'title', 'Tst Trigger', 'starts_at', T - interval '1 hour', 'ends_at', T + interval '1 hour',
    'audience', jsonb_build_object('members', jsonb_build_array('${A}', '${B}')), 'rewards', jsonb_build_object('title', 'Opened a pack', 'per_member', jsonb_build_object('shards', 25)),
    'rules', '{"trigger": "pack_opened"}'::jsonb), null, '${ADMIN}', null);
  ev2 := (r->'event'->>'id')::bigint;
  r := admin_event_schedule(ev2, (r->'event'->>'updated_at')::timestamptz, '${ADMIN}', true);
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values
    ('${A}', -1, 'opened', 'open', 'tst_ev_1', T - interval '2 hours'),   -- before the window
    ('${A}', -1, 'opened', 'open', 'tst_ev_2', T - interval '30 minutes'),
    ('${A}', -1, 'opened', 'open', 'tst_ev_3', T - interval '20 minutes'),
    ('${B}', -1, 'opened', 'open', 'tst_ev_4', T + interval '30 minutes'),
    ('${D}', -1, 'opened', 'open', 'tst_ev_5', T - interval '30 minutes'); -- not in the audience
  perform event_tick(T);
  select coalesce(jsonb_agg(jsonb_build_array(player_id, title, shards) order by player_id), '[]') into got from gift_claims where event_id = ev2;
  res := res || jsonb_build_object('case', 'E5 the first tick pays A (two opens: one gift), not B (later), not D (audience)', 'ok',
    (select status from events where id = ev2) = 'live' and got = '[["${A}", "Opened a pack", 25]]'::jsonb, 'got', got);
  perform event_tick(T + interval '5 minutes');
  n := (select count(*) from event_payouts where event_id = ev2);
  perform event_tick(T + interval '45 minutes');
  perform event_tick(T + interval '50 minutes');
  perform event_tick(T + interval '2 hours');
  select coalesce(jsonb_agg(jsonb_build_array(player_id, shards) order by player_id), '[]') into got from gift_claims where event_id = ev2;
  select jsonb_agg(jsonb_build_array(period, members, shards) order by case when period = 'start' then 0 when period like 'tick:%' then 1 else 2 end, period) into cnt from event_payouts where event_id = ev2;
  res := res || jsonb_build_object('case', 'E5 each member once across 5 ticks; a tick with nothing to pay writes no row; the end runs once', 'ok',
    n = 1 and got = '[["${A}", 25], ["${B}", 25]]'::jsonb and (select status from events where id = ev2) = 'ended'
    and jsonb_array_length(cnt) = 3 and cnt->0->>0 like 'tick:%' and cnt->0->>1 = '1' and cnt->1->>0 like 'tick:%' and cnt->1->>1 = '1' and cnt->2 = '["end", 0, 0]'::jsonb, 'got', jsonb_build_array(got, cnt));

  -- E6 / E7 a rank event (packs_opened) --------------------------------------------------------------------
  r := admin_event_save(jsonb_build_object('key', 'tst_ev_rank', 'kind', 'rank', 'title', 'Tst Rank', 'starts_at', T - interval '50 minutes', 'ends_at', T + interval '1 hour',
    'audience', jsonb_build_object('members', jsonb_build_array('${A}', '${B}', '${D}')),
    'rewards', jsonb_build_object('ranks', jsonb_build_array(jsonb_build_object('from', 1, 'to', 1, 'packs', 5), jsonb_build_object('from', 2, 'to', 2, 'shards', 100),
       jsonb_build_object('from', 3, 'to', 3, 'shards', 10, 'card_id', card2))), 'rules', '{"metric": "packs_opened"}'::jsonb), null, '${ADMIN}', null);
  ev3 := (r->'event'->>'id')::bigint;
  r := admin_event_schedule(ev3, (r->'event'->>'updated_at')::timestamptz, '${ADMIN}', true);
  -- In the window [T - 50 min, now): A 2 (E5) + 1, B 2, D 1 (E5) + 1. B opened 1 more at T + 30 min (E5: after now, not counted).
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values
    ('${A}', -1, 'opened', 'open', 'tst_ev_r1', T - interval '40 minutes'), ('${B}', -2, 'opened', 'open', 'tst_ev_r2', T - interval '40 minutes'),
    ('${D}', -1, 'opened', 'open', 'tst_ev_r3', T - interval '40 minutes'),
    ('${D}', -1, 'opened', 'open', 'tst_ev_r5', T - interval '55 minutes'); -- before the start
  perform event_tick(T);
  select jsonb_build_array((select count(*) from gift_claims), (select count(*) from event_payouts), (select count(*) from event_log), (select count(*) from admin_actions)) into cnt;
  r := admin_event_preview(ev3);
  select jsonb_build_array((select count(*) from gift_claims), (select count(*) from event_payouts), (select count(*) from event_log), (select count(*) from admin_actions)) into cnt2;
  res := res || jsonb_build_object('case', 'E6/E7 the preview: rank() ties share rank 2, the tiers, the totals; nothing written', 'ok', cnt = cnt2
    and r->'by_rank' = '[{"rank": 1, "members": 1, "packs": 5, "shards": 0, "card_id": null}, {"rank": 2, "members": 2, "packs": 0, "shards": 200, "card_id": null}]'::jsonb
    and (r->>'members')::int = 3 and (r->>'new_members')::int = 3 and (r->>'packs')::int = 5 and (r->>'shards')::int = 200 and (r->>'audience')::int = 3, 'got', jsonb_build_array(r, cnt, cnt2));
  res := res || jsonb_build_object('case', 'E6 no payout of a live rank event before the end', 'ok', (select status from events where id = ev3) = 'live' and not exists (select 1 from gift_claims where event_id = ev3));
  r := admin_event_end_now(ev3, (select updated_at from events where id = ev3), '${ADMIN}', 'tst end');
  select coalesce(jsonb_agg(jsonb_build_array(player_id, kind, amount, shards) order by player_id, kind), '[]') into got from gift_claims where event_id = ev3;
  res := res || jsonb_build_object('case', 'E6 End now pays the end once by rank (A 5 packs, B and D tie: 100 Shards each)', 'ok', r->>'ok' = 'true'
    and (select status from events where id = ev3) = 'ended' and got = jsonb_build_array(jsonb_build_array('${A}', 'promo', 5, 0), jsonb_build_array('${B}', 'promo', 0, 100), jsonb_build_array('${D}', 'promo', 0, 100)), 'got', jsonb_build_array(got, r));
  r := event_pay(ev3, 'end', now());
  cnt := admin_event_preview(ev3);
  ok := (admin_event_end_now(ev3, (select updated_at from events where id = ev3), '${ADMIN}', null))->>'error' = 'bad_status';
  res := res || jsonb_build_object('case', 'E6/E7 a second end payout is already_paid, End now again is refused, the preview shows new_members 0', 'ok',
    r->>'error' = 'already_paid' and ok and (cnt->>'new_members')::int = 0 and (cnt->>'members')::int = 3, 'got', jsonb_build_array(r, cnt));
  r := admin_event(ev3);
  res := res || jsonb_build_object('case', 'E7 admin_event: the claims and payouts counts', 'ok', r->'claims' = '{"gifts": 3, "claimed": 0, "members": 3, "packs": 5, "packs_claimed": 0, "shards": 200, "shards_claimed": 0, "cards": 0, "cards_claimed": 0}'::jsonb
    and jsonb_array_length(r->'payouts') = 1 and r->'payouts'->0->>'period' = 'end', 'got', r);

  -- E8 cancel, stale, live locks --------------------------------------------------------------------------
  r := admin_event_save(jsonb_build_object('key', 'tst_ev_cancel', 'kind', 'trigger', 'title', 'Tst Cancel', 'starts_at', T + interval '6 hours', 'ends_at', T + interval '8 hours',
    'audience', jsonb_build_object('members', jsonb_build_array('${A}', '${B}')), 'rewards', jsonb_build_object('per_member', jsonb_build_object('packs', 1)),
    'rules', '{"trigger": "pack_opened"}'::jsonb), null, '${ADMIN}', null);
  ev4 := (r->'event'->>'id')::bigint; up := (r->'event'->>'updated_at')::timestamptz;
  r := admin_event_save(jsonb_build_object('id', ev4, 'title', 'Tst Cancel 2'), up - interval '1 second', '${ADMIN}', null);
  res := res || jsonb_build_object('case', 'E8 an edit with an old updated_at is refused as stale', 'ok', r->>'error' = 'stale' and (select title from events where id = ev4) = 'Tst Cancel', 'got', r);
  r := admin_event_save(jsonb_build_object('id', ev4, 'title', 'Tst Cancel 2'), up, '${ADMIN}', null);
  res := res || jsonb_build_object('case', 'E8 the edit with the current updated_at is saved, updated_at moves', 'ok', r->>'ok' = 'true' and (r->'event'->>'updated_at')::timestamptz > up, 'got', r);
  r := admin_event_schedule(ev4, (r->'event'->>'updated_at')::timestamptz, '${ADMIN}', true);
  perform event_tick(T + interval '6 hours 5 minutes');
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', -1, 'opened', 'open', 'tst_ev_c1', T + interval '6 hours 10 minutes');
  perform event_tick(T + interval '6 hours 15 minutes');
  n := (select count(*) from gift_claims where event_id = ev4);
  r := admin_event_save(jsonb_build_object('id', ev4, 'rewards', jsonb_build_object('per_member', jsonb_build_object('packs', 9))), (select updated_at from events where id = ev4), '${ADMIN}', null);
  ok := r->>'error' = 'locked';
  r := admin_event_save(jsonb_build_object('id', ev4, 'ends_at', T + interval '9 hours'), (select updated_at from events where id = ev4), '${ADMIN}', null);
  ok := ok and r->>'ok' = 'true';
  res := res || jsonb_build_object('case', 'E8 a live event: the rewards are locked, a later end is saved', 'ok', ok and n = 1, 'got', jsonb_build_array(n, r));
  r := admin_event_cancel(ev4, (select updated_at from events where id = ev4), '${ADMIN}', 'tst cancel');
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${B}', -1, 'opened', 'open', 'tst_ev_c2', T + interval '6 hours 20 minutes');
  perform event_tick(T + interval '6 hours 30 minutes');
  perform event_tick(T + interval '10 hours');
  res := res || jsonb_build_object('case', 'E8 cancel stops the payouts: B acts after the cancel and gets nothing; the gift of A stays', 'ok', r->>'ok' = 'true'
    and (select status = 'cancelled' and ended_at is not null from events where id = ev4) and (select count(*) from gift_claims where event_id = ev4) = 1
    and not exists (select 1 from event_payouts where event_id = ev4 and period = 'end'), 'got', r);

  -- E9 the other triggers and hunt_damage ------------------------------------------------------------------
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at) values ('Tst Ev Boss', 'Normal', '[]', '[]', 500000, 500000, T + interval '1 day') returning id into hb;
  insert into hunt_combat_log (hunt_id, player_id, card_id, ts, outcome, damage) values (hb, '${A}', card, T - interval '10 minutes', 'hit', 100), (hb, '${B}', card, T - interval '10 minutes', 'hit', 300),
    (hb, '${D}', card, T - interval '3 hours', 'hit', 999);
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage, created_at) values (hb, '${D}', card2, game_day(T), 5, T - interval '5 minutes');
  insert into dungeon_runs (player_id, day, squad, state, started_at) values ('${B}', game_day(T), array[card], '{}', T - interval '15 minutes');
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${D}', 1, 'tutorial', 'tutorial', 'complete', T - interval '5 minutes');
  select jsonb_agg(x.v order by x.i) into got from (
    select x.i, (select coalesce(jsonb_agg(jsonb_build_array(y.member_id, y.rank, y.score) order by y.member_id), '[]')
                   from event_recipients(jsonb_populate_record(null::events, jsonb_build_object('id', null, 'key', 'tst_x', 'kind', x.k, 'title', 'x', 'status', 'draft',
                     'starts_at', T - interval '1 hour', 'ends_at', T + interval '1 hour', 'audience', '{"members": ["${A}", "${B}", "${D}"]}'::jsonb,
                     'rewards', x.w::jsonb, 'rules', x.u::jsonb, 'created_by', 'x')), T) y) v
      from (values (1, 'trigger', '{"per_member": {"packs": 1}}', '{"trigger": "hunt_hit"}'), (2, 'trigger', '{"per_member": {"packs": 1}}', '{"trigger": "dungeon_run"}'),
                   (3, 'trigger', '{"per_member": {"packs": 1}}', '{"trigger": "tutorial_done"}'),
                   (4, 'rank', '{"ranks": [{"from": 1, "to": 10, "packs": 1}]}', '{"metric": "hunt_damage"}')) x(i, k, w, u)) x;
  res := res || jsonb_build_object('case', 'E9 hunt_hit (combat log or hunt_hits), dungeon_run, tutorial_done, hunt_damage: the window only', 'ok', got = jsonb_build_array(
    jsonb_build_array(jsonb_build_array('${A}', null, null), jsonb_build_array('${B}', null, null), jsonb_build_array('${D}', null, null)),
    jsonb_build_array(jsonb_build_array('${B}', null, null)), jsonb_build_array(jsonb_build_array('${D}', null, null)),
    jsonb_build_array(jsonb_build_array('${A}', 2, 100), jsonb_build_array('${B}', 1, 300))), 'got', got);

  -- E10 a drop with late joiners --------------------------------------------------------------------------
  r := admin_event_save(jsonb_build_object('key', 'tst_ev_late', 'kind', 'drop', 'title', 'Tst Late', 'starts_at', T + interval '11 hours', 'ends_at', T + interval '12 hours',
    'audience', jsonb_build_object('members', jsonb_build_array('${A}', '${E}')), 'rewards', jsonb_build_object('per_member', jsonb_build_object('packs', 2)),
    'rules', '{"late_joiners": true}'::jsonb), null, '${ADMIN}', null);
  ev5 := (r->'event'->>'id')::bigint;
  r := admin_event_schedule(ev5, (r->'event'->>'updated_at')::timestamptz, '${ADMIN}', true);
  perform event_tick(T + interval '11 hours 5 minutes');
  n := (select count(*) from gift_claims where event_id = ev5);
  insert into players (id, username, created_at) values ('${E}', 'tst ev e', T);
  perform event_tick(T + interval '11 hours 15 minutes');
  perform event_tick(T + interval '13 hours');
  select coalesce(jsonb_agg(jsonb_build_array(player_id, amount) order by player_id), '[]') into got from gift_claims where event_id = ev5;
  select jsonb_agg(left(period, 5) order by case when period = 'start' then 0 when period like 'tick:%' then 1 else 2 end, period) into cnt from event_payouts where event_id = ev5;
  res := res || jsonb_build_object('case', 'E10 late_joiners: A at the start, E (a new member) on the next tick, each once', 'ok',
    n = 1 and got = '[["${A}", 2], ["${E}", 2]]'::jsonb and cnt = '["start", "tick:", "end"]'::jsonb, 'got', jsonb_build_array(n, got, cnt));

  -- E11 the launch event -----------------------------------------------------------------------------------
  if cfg is null then
    res := res || jsonb_build_object('case', 'E11 the launch event: settings.launch_event_cards exists in this database', 'ok', false);
  else
    select id into lid from events where key = 'launch_2026';
    select to_jsonb(e) - 'id' - 'created_at' - 'updated_at' into got from events e where key = 'launch_2026';
    res := res || jsonb_build_object('case', 'E11 one launch row: kind launch_cards, the settings window, live until player_until', 'ok', got = jsonb_build_object(
      'key', 'launch_2026', 'kind', 'launch_cards', 'title', 'Launch Day event cards', 'status', case when now() < (cfg->>'player_until')::timestamptz then 'live' else 'ended' end,
      'starts_at', (cfg->>'player_from')::timestamptz, 'ends_at', (cfg->>'player_until')::timestamptz, 'audience', '{"all": true}'::jsonb, 'rewards', '{}'::jsonb,
      'rules', '{"settings_key": "launch_event_cards", "gift_reasons": ["event:launch_player", "event:launch_raider"]}'::jsonb, 'created_by', 'events.sql',
      'ended_at', case when now() < (cfg->>'player_until')::timestamptz then null else (cfg->>'player_until')::timestamptz end,
      'description', got->>'description'), 'got', got);
    res := res || jsonb_build_object('case', 'E11 the old launch gifts and the two cards point at the launch row', 'ok',
      (select count(*) from gift_claims where reason in ('event:launch_player', 'event:launch_raider') and event_id is distinct from lid) = 0
      and (select count(*) from gift_claims where event_id = lid) = launch_before
      and (select count(*) from cards where event_id = lid and id in ((cfg->>'player_card')::bigint, (cfg->>'raider_card')::bigint)) = 2);
    select jsonb_object_agg(f, md5(replace(pg_get_functiondef(f::regprocedure), chr(13), ''))) into got from jsonb_object_keys('${md5Json}'::jsonb) f;
    res := res || jsonb_build_object('case', 'E11 the launch functions are unchanged (md5)', 'ok', got = '${md5Json}'::jsonb, 'got', got);
    -- The same inputs as before: a member finishes the tutorial (launch_player_gift), a member fights in a launch Hunt (the trigger).
    ok := launch_player_gift('${B}');
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage, created_at) select (cfg->>'raider_hunts_from')::bigint, '${D}', card, game_day(T) - 30, 1, T
      where exists (select 1 from hunts where id = (cfg->>'raider_hunts_from')::bigint);
    select coalesce(jsonb_agg(jsonb_build_array(player_id, kind, title, amount, shards, reason, card_id, from_id, event_id = lid) order by player_id), '[]') into got
      from gift_claims where player_id in ('${B}', '${D}') and reason like 'event:%';
    res := res || jsonb_build_object('case', 'E11 the same launch gifts on the same inputs, now with event_id', 'ok', got = case when now() < (cfg->>'player_until')::timestamptz then
        jsonb_build_array(jsonb_build_array('${B}', 'card', 'Launch Day Player', 1, 0, 'event:launch_player', (cfg->>'player_card')::bigint, null, true)) else '[]'::jsonb end
      || case when exists (select 1 from hunts where id = (cfg->>'raider_hunts_from')::bigint) then
        jsonb_build_array(jsonb_build_array('${D}', 'card', 'Launch Day Raider', 1, 0, 'event:launch_raider', (cfg->>'raider_card')::bigint, null, true)) else '[]'::jsonb end, 'got', got);
    n := (select count(*) from gift_claims where event_id = lid);
    r := admin_event_end_now(lid, (select updated_at from events where id = lid), '${ADMIN}', null);
    ok := r->>'error' = 'locked';
    r := admin_event_cancel(lid, (select updated_at from events where id = lid), '${ADMIN}', null);
    ok := ok and r->>'error' = 'locked';
    r := admin_event_save(jsonb_build_object('id', lid, 'title', 'x'), (select updated_at from events where id = lid), '${ADMIN}', null);
    ok := ok and r->>'error' = 'locked';
    res := res || jsonb_build_object('case', 'E11 the Admin functions refuse to change the launch row', 'ok', ok, 'got', r);
    perform event_tick((cfg->>'player_until')::timestamptz - interval '1 minute');
    perform event_tick((cfg->>'player_until')::timestamptz + interval '1 minute');
    res := res || jsonb_build_object('case', 'E11 the tick never pays the launch row and ends it at player_until', 'ok',
      (select count(*) from gift_claims where event_id = lid) = n and not exists (select 1 from event_payouts where event_id = lid)
      and (select status from events where id = lid) = 'ended');
  end if;

  -- E12 lockdown -------------------------------------------------------------------------------------------
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]') into got from pg_class c where c.oid in ('public.events'::regclass, 'public.event_log'::regclass, 'public.event_payouts'::regclass)
    and c.relrowsecurity and not has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    and obj_description(c.oid, 'pg_class') is not null;
  res := res || jsonb_build_object('case', 'E12 the 3 tables: RLS on, no API grants, a comment', 'ok', jsonb_array_length(got) = 3, 'got', got);
  select jsonb_build_array(count(*), count(*) filter (where not p.prosecdef and array_to_string(p.proconfig, ',') ilike '%search_path=public%' and obj_description(p.oid, 'pg_proc') is not null
           and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute'))) into got
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'event\_%' or p.proname like 'admin\_event%' or p.proname in ('events_touch', 'gift_claims_event_link'));
  res := res || jsonb_build_object('case', 'E12 the 21 functions: invoker, search_path public, a comment, no API execute, service_role execute', 'ok', got = '[21, 21]'::jsonb, 'got', got);
  ok := true;
  foreach cnt in array array['"anon"'::jsonb, '"authenticated"'::jsonb] loop
    perform set_config('role', cnt #>> '{}', true);
    begin perform admin_events(); ok := false; exception when insufficient_privilege then null; end;
    begin perform event_tick(now()); ok := false; exception when insufficient_privilege then null; end;
    begin perform 1 from events limit 1; ok := false; exception when insufficient_privilege then null; end;
    perform set_config('role', 'postgres', true);
  end loop;
  res := res || jsonb_build_object('case', 'E12 anon and authenticated: admin_events, event_tick and the events table are refused', 'ok', ok);
  res := res || jsonb_build_object('case', 'E12 the pg_cron job event-tick every 10 minutes', 'ok',
    exists (select 1 from cron.job where jobname = 'event-tick' and schedule = '*/10 * * * *' and command = 'select public.event_tick();'));
  raise exception 'RESULTS %', res;
end $t$;`;

const run = async (mig) => {
  const out = JSON.stringify(await q(body(mig)));
  const m = out.match(/RESULTS (\[.*\])/);
  if (!m) return { error: out.slice(0, 1500) };
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
    ['exactly once: no unique gift index', 'create unique index if not exists gift_claims_event_once', 'create index if not exists gift_claims_event_once'],
    ['exactly once: a second start/end payout runs', "    if not found then return jsonb_build_object('paid', false, 'error', 'already_paid', 'period', p_period); end if;\n", ''],
    ['the gifts carry no event_id', "'promo', v_title, r.packs, r.shards, 'event', e.id", "'promo', v_title, r.packs, r.shards, 'event', null"],
    ['the audience keeps members who left', 'where p.left_guild_at is null', 'where true'],
    ['the trigger window has no end', "l.reason = 'opened' and l.created_at >= t0 and l.created_at < t1)\n", "l.reason = 'opened' and l.created_at >= t0)\n"],
    ['rank ties do not share a rank', '(rank() over (order by s.sc desc))', '(row_number() over (order by s.sc desc, s.pid))'],
    ['the preview counts paid members as new', "'new_members', (select count(*) from rp where not paid)", "'new_members', (select count(*) from rp)"],
    ['cancel only before live', "(p_to = 'cancelled' and e.status in ('draft', 'scheduled', 'live'))", "(p_to = 'cancelled' and e.status in ('draft', 'scheduled'))"],
    ['the stale check is gone', "    if e.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok', false, 'error', 'stale', 'event', to_jsonb(e)); end if;\n    if e.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('the launch event is set in settings.launch_event_cards')); end if;\n    if e.status in", "    if e.status in"],
    ['the launch gift link runs after insert', 'create trigger gift_claims_event_link before insert', 'create trigger gift_claims_event_link after insert'],
    ['the launch row is a draft', "case when now() < v_until then 'live' else 'ended' end", "case when now() < v_until then 'draft' else 'ended' end"],
    ['event_log: start logged as edit', "when 'live' then 'start'", "when 'live' then 'edit'"],
    ['shape: all may have filters', "if p_audience ? 'all' and (p_audience->'all' <> 'true'::jsonb or (select count(*) from jsonb_object_keys(p_audience)) > 1) then", "if p_audience ? 'all' and (p_audience->'all' <> 'true'::jsonb) then"],
    ['a live trigger event is not caught up', "    elsif e.kind = 'trigger' or v_late then\n", "    elsif v_late then\n"],
    ['the save writes no admin_actions row', "perform admin_log_action(p_actor, case when v_id is null then 'event_create' else 'event_edit' end, 'event', c.id::text,", "perform jsonb_build_array(p_actor, case when v_id is null then 'event_create' else 'event_edit' end, 'event', c.id::text,"],
    ['the lockdown: no revoke', 'revoke execute on function public.event_reward_errors', 'grant execute on function public.event_reward_errors'],
  ];
  let caught = 0;
  for (const [name, from, to] of MUT) {
    if (!MIG.includes(from)) { console.log(`MUTATION FAIL (text not found): ${name}`); fail++; continue; }
    let mut = MIG.split(from).join(to);
    if (name === 'the lockdown: no revoke') mut = mut.replace('\n  from public, anon, authenticated;', '\n  to public, anon, authenticated;');
    const r = await run(mut);
    const failed = r.error || r.results.some((x) => !x.ok);
    if (failed) caught++; else fail++;
    console.log(`${failed ? 'PASS' : 'FAIL'} mutation caught: ${name}${failed && !r.error ? ` (${r.results.filter((x) => !x.ok).map((x) => x.case.split(':')[0]).join('; ')})` : failed ? ' (error)' : ''}`);
  }
  console.log(`mutations caught ${caught}/${MUT.length}`);
}
process.exitCode = fail ? 1 : 0;
