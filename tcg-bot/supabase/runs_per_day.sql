-- runs_per_day.sql (2026-10-11): F-1 PR 3, runs each day as event variables (docs/foundations.md F-1 item 6, acceptance test 4).
-- Before: one Dungeon run and one Gauntlet run a game day, fixed in code: dungeon_start and gauntlet_start refused a second
-- run of the day, and the unique index dungeon_runs_one_a_day_mode (player_id, day, mode) refused a second row.
-- (The design table says "one Gauntlet run each week"; the code is one Gauntlet run a DAY: gauntlet_start checks the day and
-- gauntlet_view gives next_at = tomorrow. So the variable is gauntlet_runs_per_day, and with no event nothing changes.)
-- Now:
--   1. balance        dungeon_runs_per_day = 1 and gauntlet_runs_per_day = 1, each a whole number from 1 to 10
--                     (balance_check_runs). The game reads them only through game_var.
--   2. event_vars     dungeon_runs_per_day and gauntlet_runs_per_day (combine max, 1 to 10, whole): an event raises them.
--   3. dungeon_runs   attempt (1, 2, ...: the run number of the member, day and mode); the unique index is now
--                     (player_id, day, mode, attempt).
--   4. dungeon_start / gauntlet_start: one run at a time (an active run of today refuses a new one, as before), and at most
--                     game_var(...) runs a game day; the new run gets the next attempt.
--   5. The readers    dungeon_board: the best run of each member (dungeon_pay pays one prize a member, as gauntlet_board
--                     already did). dungeon_view_core / gauntlet_view: the newest run of today; when it is over and a run is
--                     left, run is null (the screen shows the start, with no Activity change) and last_run has the ended run;
--                     runs_left is new. Checked and unchanged (one run at a time keeps them right): the action functions
--                     (dungeon_attack, _support, _choose, _pass_turn, _retreat, _auto_rounds read the ACTIVE run of today),
--                     dungeon_settle and dungeon_settle_stale (by run id / every active run of an earlier day), dailies_tasks
--                     (exists), event_recipients (exists), add_card_to_player (the newest active run), shard_ledger_reconcile
--                     (per run), gauntlet_board (best per member, runs = the count), the admin reads (counts of runs).
-- Test: card-studio/scripts/test-runs-per-day.mjs (rolled back; MUTATE=<name> must FAIL). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this
-- file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.dungeon_start(text, bigint[])', 'ce4f9a981e635a21b6023e7e04aa5bb1', 'e7a308246d6e7cf0fc5905742b5a1fbe'),
    ('public.gauntlet_start(text)', '44cd8f236280b94e11a53f5731e653c4', 'a9223065ba351464603e3a656e18029f'),
    ('public.dungeon_board(date, integer)', 'e5e302af2f0732b67abb8394d3c071e9', 'f1da392ebd81a0080d9592ed459a9f5e'),
    ('public.dungeon_view_core(text, boolean)', '7b7ae8216c958c8f9da0365120c0536b', 'c97a26b0aefe71e2a13ee0428a530795'),
    ('public.gauntlet_view(text)', 'a37af9d2320ec9f6a443fce2046e9732', 'b109912842b67cf1299b7a7befff93da')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'runs_per_day.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the balance keys and their limits
create or replace function public.balance_check_runs() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.key in ('dungeon_runs_per_day', 'gauntlet_runs_per_day')
     and (jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::numeric not between 1 and 10 or (new.value #>> '{}')::numeric % 1 <> 0) then
    raise exception 'balance %: must be a whole number from 1 to 10 (runs a game day)', new.key;
  end if;
  return new;
end $$;
drop trigger if exists balance_check_runs on public.balance;
create trigger balance_check_runs before insert or update on public.balance for each row execute function public.balance_check_runs();

insert into public.balance (key, value, note) values
  ('dungeon_runs_per_day', '1', 'The Dungeon runs of a member in one game day (MT), one at a time. A whole number from 1 to 10 (balance_check_runs). dungeon_start reads it through game_var(''dungeon_runs_per_day''), so an event can raise it (event_vars, combine max).'),
  ('gauntlet_runs_per_day', '1', 'The Gauntlet runs of a member in one game day (MT), one at a time; the board keeps the best run of the week. A whole number from 1 to 10 (balance_check_runs). gauntlet_start reads it through game_var(''gauntlet_runs_per_day''), so an event can raise it (event_vars, combine max).')
  on conflict (key) do nothing;

-- ============================================================ 2. the event variables
insert into public.event_vars (key, label, note, balance_key, balance_path, combine, min_value, max_value, whole) values
  ('dungeon_runs_per_day', 'Dungeon runs a day', 'The Dungeon runs of a member in one game day (balance dungeon_runs_per_day). An event can only raise it (max), at most 10. dungeon_start and dungeon_view read it.',
   'dungeon_runs_per_day', '{}', 'max', 1, 10, true),
  ('gauntlet_runs_per_day', 'Gauntlet runs a day', 'The Gauntlet runs of a member in one game day (balance gauntlet_runs_per_day). An event can only raise it (max), at most 10. gauntlet_start and gauntlet_view read it.',
   'gauntlet_runs_per_day', '{}', 'max', 1, 10, true)
  on conflict (key) do nothing;

-- ============================================================ 3. the attempt number
alter table public.dungeon_runs add column if not exists attempt smallint not null default 1;
alter table public.dungeon_runs drop constraint if exists dungeon_runs_attempt_check;
alter table public.dungeon_runs add constraint dungeon_runs_attempt_check check (attempt between 1 and 100);
create unique index if not exists dungeon_runs_attempt on public.dungeon_runs (player_id, day, mode, attempt);
drop index if exists public.dungeon_runs_one_a_day_mode;

-- ============================================================ 4. the start functions and the readers
-- dungeon_start: game_var('dungeon_runs_per_day') runs a day, one at a time; the run gets the next attempt number.
CREATE OR REPLACE FUNCTION public.dungeon_start(p_player text, p_cards bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d dungeon_days; g jsonb; v_n int := balance_num('dungeon', 'squad')::int;
  v_cost int := 0; v_budget int; c jsonb; v_cards jsonb := '{}'; x bigint; v_att int := 0; v_hp int; st jsonb; v_id bigint; v_sup boolean;
  v_runs int; v_last int; v_active int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  perform 1 from players where id = p_player for update;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  -- One run at a time; at most game_var('dungeon_runs_per_day') runs a game day (balance dungeon_runs_per_day, an event can raise it).
  select count(*), coalesce(max(attempt), 0), count(*) filter (where status = 'active') into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  if v_active > 0 or v_runs >= game_var('dungeon_runs_per_day') then return jsonb_build_object('ok', false, 'error', 'already'); end if;
  if p_cards is null or array_length(p_cards, 1) <> v_n or (select count(distinct y) from unnest(p_cards) y) <> v_n then
    return jsonb_build_object('ok', false, 'error', 'squad_size', 'need', v_n); end if;
  perform dungeon_generate(v_day);
  select * into d from dungeon_days where day = v_day;
  v_budget := coalesce((d.rule->>'budget')::int, balance_num('dungeon', 'budget')::int);   -- the day's rule, else balance dungeon.budget
  foreach x in array p_cards loop
    c := dungeon_card(p_player, x);
    if c is null then return jsonb_build_object('ok', false, 'error', 'not_owned', 'card', x); end if;
    if d.rule ? 'types' and not (d.rule->'types' ? (c->>'type')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    if d.rule ? 'no_rarity' and (d.rule->'no_rarity' ? (c->>'rarity')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    v_cost := v_cost + balance_num('dungeon', 'cost', c->>'rarity')::int;
    v_sup := c->>'type' not in ('Character', 'Creature');
    if not v_sup then v_att := v_att + 1; v_hp := (c->'cmb'->>'hp')::int; else v_hp := card_max_hp(0); end if;
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup));
  end loop;
  if v_att = 0 then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;
  if v_cost > v_budget then return jsonb_build_object('ok', false, 'error', 'budget', 'cost', v_cost, 'budget', v_budget); end if;
  st := dungeon_enter(jsonb_build_object('cards', v_cards, 'buff', 1, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
          'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb)), d.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state, attempt) values (p_player, v_day, p_cards, st, v_last + 1) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'squad', to_jsonb(p_cards)), jsonb_build_object('cost', v_cost));
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $function$;

-- gauntlet_start: game_var('gauntlet_runs_per_day') runs a day, one at a time; the run gets the next attempt number.
CREATE OR REPLACE FUNCTION public.gauntlet_start(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); w gauntlet_weeks; g jsonb; c jsonb; x bigint;
  v_cards jsonb := '{}'; v_hp int; v_sup boolean; st jsonb; v_id bigint; v_runs int; v_last int; v_active int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  perform 1 from players where id = p_player for update;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  -- One run at a time; at most game_var('gauntlet_runs_per_day') runs a game day (balance gauntlet_runs_per_day, an event can raise it).
  select count(*), coalesce(max(attempt), 0), count(*) filter (where status = 'active') into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  if v_active > 0 or v_runs >= game_var('gauntlet_runs_per_day') then
    return jsonb_build_object('ok', false, 'error', 'already_gauntlet'); end if;
  w := gauntlet_generate(gauntlet_week(v_day));
  foreach x in array w.squad loop
    c := dungeon_card_base(x);
    v_sup := c->>'type' not in ('Character', 'Creature');
    v_hp := case when v_sup then card_max_hp(0) else (c->'cmb'->>'hp')::int end;
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup));
  end loop;
  st := dungeon_enter(jsonb_build_object('mode', 'gauntlet', 'cards', v_cards, 'buff', 1, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
          'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb)), w.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state, mode, attempt) values (p_player, v_day, w.squad, st, 'gauntlet', v_last + 1) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'mode', 'gauntlet', 'squad', to_jsonb(w.squad)), '{}');
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $function$;

-- dungeon_board: the best run of each member (a member with 2 runs is on the board once, as gauntlet_board does).
CREATE OR REPLACE FUNCTION public.dungeon_board(p_day date DEFAULT NULL::date, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now())) rank,
           r.player_id, p.username, r.floor, r.room, r.turns, r.status, to_jsonb(r.squad) squad
    from (select distinct on (x.player_id) x.* from dungeon_runs x where x.day = coalesce(p_day, dungeon_day()) and x.mode = 'daily'
          order by x.player_id, x.floor desc, x.room desc, x.turns, coalesce(x.ended_at, now())) r join players p on p.id = r.player_id
    order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now()) limit p_limit) x;
$function$;

-- dungeon_view_core: the newest run of today; runs_left, last_run.
CREATE OR REPLACE FUNCTION public.dungeon_view_core(p_player text, p_mine boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int; v_mine jsonb := '{}'::jsonb;
  v_b jsonb; v_cost jsonb; v_h0 int; v_board jsonb; v_left int; v_lastrun jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  -- The newest run of today. When it is over and the member has a run left (game_var dungeon_runs_per_day), run is null (the screen offers a new run)
  -- and last_run has the run that ended.
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily' order by attempt desc limit 1;
  v_left := greatest(game_var('dungeon_runs_per_day')::int - (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily')::int, 0);
  if r.status = 'over' and v_left > 0 then
    v_lastrun := jsonb_build_object('id', r.id, 'attempt', r.attempt, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room, 'turns', r.turns);
    r := null;
  end if;
  v_board := dungeon_board(v_day, 1000);   -- read ONCE: the member's rank and the top 3 both come from it
  select (e->>'rank')::int into v_rank from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  if p_mine then
    v_b := card_balance(); v_cost := balance_get('dungeon')->'cost'; v_h0 := card_max_hp(0);
    -- card_combat once per DIFFERENT input (perf_five_slow_calls.sql), joined back to each card.
    v_mine := jsonb_build_object('mine', (
             with own as materialized (
               select pc.card_id, c.id, s.type, c.rarity::text rarity, pc.ascension, s.cp_mod, pc.stat_points, s.tag_slugs
                 from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
                where pc.player_id = p_player and pc.quantity > 0),
             kc as materialized (
               select k.rarity, k.ascension, k.cp_mod, k.stat_points, card_combat(k.rarity, k.ascension, k.cp_mod, k.stat_points, v_b) cmb
                 from (select distinct rarity, ascension, cp_mod, stat_points from own) k)
             select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'type', o.type, 'rarity', o.rarity,
               'cost', coalesce((v_cost->>o.rarity)::numeric, balance_num('dungeon', 'cost', o.rarity))::int, 'cp', (x.cmb->>'cp')::int,
               'hp', case when o.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else v_h0 end,
               'slugs', coalesce(to_jsonb(o.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from own o join kc x on x.rarity = o.rarity and x.ascension is not distinct from o.ascension
                  and x.cp_mod is not distinct from o.cp_mod and x.stat_points is not distinct from o.stat_points));
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
    'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', balance_num('dungeon_rewards', 'run_shards_cap')::int,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'runs_left', v_left, 'last_run', v_lastrun,
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1)) || v_mine;
end $function$;

-- gauntlet_view: the newest run of today; runs_left, last_run.
CREATE OR REPLACE FUNCTION public.gauntlet_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb; v_board jsonb;
  v_left int; v_lastrun jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  -- The newest run of today. When it is over and the member has a run left (game_var gauntlet_runs_per_day), run is null (the screen offers a new run)
  -- and last_run has the run that ended.
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet' order by attempt desc limit 1;
  v_left := greatest(game_var('gauntlet_runs_per_day')::int - (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet')::int, 0);
  if r.status = 'over' and v_left > 0 then
    v_lastrun := jsonb_build_object('id', r.id, 'attempt', r.attempt, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room, 'turns', r.turns);
    r := null;
  end if;
  v_board := gauntlet_board(v_week, 100000);   -- read ONCE: the member's row and the top 3 both come from it
  select e into b from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', balance_num('gauntlet', 'budget')::int,
    -- OFFSET 0 (perf_five_slow_calls.sql): one dungeon_card_base per card; without it the subquery was pulled up and ran per reference.
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', balance_num('dungeon', 'cost', x.c->>'rarity')::int, 'cp', (x.c->'cmb'->>'cp')::int,
               'hp', case when x.c->>'type' in ('Character', 'Creature') then (x.c->'cmb'->>'hp')::int else card_max_hp(0) end,
               'slugs', x.c->'tags') order by x.o)
             from unnest(w.squad) with ordinality x0(id, o) cross join lateral (select x0.id, x0.o, dungeon_card_base(x0.id) c offset 0) x),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', 0, 'cards', '[]'::jsonb, 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', (b->>'rank')::int) end,
    'best', b, 'runs_left', v_left, 'last_run', v_lastrun,
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(w.floors->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(w.floors),
    'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet' and day between v_week and v_week + 6),
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $function$;

-- ============================================================ 5. the lockdown (lockdown_grants.sql pattern)
revoke all on function public.balance_check_runs() from public, anon, authenticated;
grant execute on function public.balance_check_runs() to service_role;

-- ============================================================ comments
comment on function public.balance_check_runs() is $c$Trigger (before insert or update on balance): dungeon_runs_per_day and gauntlet_runs_per_day must be whole numbers from 1 to 10.$c$;
comment on column public.dungeon_runs.attempt is $c$The run number of the member on that game day and mode: 1, 2, ... (dungeon_start / gauntlet_start: the last attempt + 1). Unique with player_id, day and mode (dungeon_runs_attempt). More than 1 only when game_var dungeon_runs_per_day or gauntlet_runs_per_day is above 1.$c$;
comment on table public.dungeon_runs is $c$[dungeon] One row per run: a member, a game day, a mode and an attempt (unique). dungeon_start or gauntlet_start writes it (one active run at a time, at most game_var dungeon_runs_per_day / gauntlet_runs_per_day runs a day), the member actions change state, dungeon_settle ends it. The boards (the best run of each member), the views and shard_ledger_reconcile read it.$c$;
comment on column public.dungeon_runs.mode is $c$daily (the Dungeon Run) or gauntlet (the weekly Gauntlet), dungeon_runs_mode_check. A member has at most game_var dungeon_runs_per_day / gauntlet_runs_per_day runs of each mode a day (1 with no event), numbered by attempt.$c$;
comment on function public.dungeon_start(text, bigint[]) is $c$POST /api/dungeon/start: starts a daily run with the squad (balance dungeon.squad cards). Checks the flag, adventure_gate, one active run at a time and at most game_var('dungeon_runs_per_day') runs today (else already), the daily rule and the budget (the rule's budget, else balance dungeon.budget; the costs are balance dungeon.cost). Writes dungeon_runs (the next attempt) and dungeon_log. Returns ok, run and state.$c$;
comment on function public.gauntlet_start(text) is $c$POST /api/gauntlet/start: starts a Gauntlet run with the week's squad. Checks both flags, adventure_gate, one active run at a time and at most game_var('gauntlet_runs_per_day') Gauntlet runs today (else already_gauntlet). Writes dungeon_runs (mode gauntlet, the next attempt) and dungeon_log.$c$;
comment on function public.dungeon_board(date, integer) is $c$GET /api/dungeon/board, dungeon_view and dungeon_pay: the daily board of a day (default today): the best run of each member, ranked by floor, room, turns, end time. Returns a jsonb array with rank, member and depth.$c$;
comment on function public.gauntlet_view(text) is $c$GET /api/gauntlet: the member's Gauntlet screen. Ends the member's active runs of earlier days, builds the week, and returns the squad (costs: balance dungeon.cost), the budget (balance gauntlet.budget), today's newest run (null when it is over and a run is left: runs_left, last_run), the member's best rank, the rooms, the top 3 and the prizes.$c$;

notify pgrst, 'reload schema';
