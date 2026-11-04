-- combat_v2_on_gauntlet.sql (2026-11-04): combat v2 step R1-ON, the Gauntlet v2 for ALL members (pipeline item ON, SPEC v1 section 3.2).
-- Needs combat_v2_gauntlet_run.sql (R1b: the gauntlet_v2 run mode, gauntlet_v2_begin, the run functions).
-- Before: a gauntlet_v2 run (a tester run) is never on the board, the prizes or the lobby numbers (R1b D1). The week squad pool has no
--   ability_v2 rule, so one squad card with no v2 unit makes the whole week v1 for every player (R1b D2).
-- After this file:
--   INV-ON-1 the member mark: gauntlet_v2_begin (replaced, the R1b text plus ONE key) stores member = combat_v2_on('gauntlet') (the ONE-argument
--     flag, not the tester list) in the run state. Every reader below reads the MARK, never the live flag. So a tester run of before the
--     switch stays off the board, and a member run that started before a rollback stays on it (D4, INV-ON-3).
--   gauntlet_board (replaced): the runs of mode gauntlet, and the gauntlet_v2 runs with state.member true. The same order. dungeon_pay
--     ('gauntlet', week) reads gauntlet_board, so the weekly prizes follow with no change there.
--   gauntlet_view (replaced): players_week and runs_left read the same set as the board (best and top come from the board).
--   gauntlet_pool (replaced): while combat_v2_on('gauntlet') is true, only cards with a usable ability_v2 (the combat_v2_card_unit rule: an
--     object, a role of the roles table, a list of blocks). A week that exists keeps its squad.
-- NO CHANGE IN PLAY while the flag combat_v2.gauntlet is false: every v1 answer stays the same (a tester run has member false).
-- The switch is a separate one-statement file (combat_v2_switch_gauntlet_on.sql). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-on-gauntlet.mjs (rolled back; MUTATE=all must catch every mutation).

-- GUARD (the runs_per_day.sql rule): each replaced function must be the live text this file was built from (or the text this file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.gauntlet_v2_begin(text, bigint[], jsonb, integer)', '232f4e27b4aabbc68ca0df9ef4a67adc', '892d5d55e3f97abee932ae6c95b0ec2c'),
    ('public.gauntlet_board(date, integer)', '8ed0efb90f0174ef43a091d812d64a6f', 'e42f6675df0e631b9fca388d15a68207'),
    ('public.gauntlet_view(text)', 'b109912842b67cf1299b7a7befff93da', '8837ba6084c9da5bf7fdd9c910d8879c'),
    ('public.gauntlet_pool()', 'fa50cc96e510a739d1f806c72c1e9271', 'b043c321853267cf52d5a663cd38ab0d')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_on_gauntlet.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the member mark (the R1b text plus 'member')
create or replace function public.gauntlet_v2_begin(p_player text, p_squad bigint[], p_units jsonb, p_attempt int) returns jsonb
language plpgsql set search_path = public as $fn$
declare v_day date := dungeon_day(); fl jsonb; v_carry jsonb; st jsonb; x jsonb; v_id bigint;
begin
  fl := (select floors from gauntlet_weeks where week = gauntlet_week(v_day));
  v_carry := (select jsonb_object_agg(e.key, jsonb_build_object('hp', e.value->'hp', 'max', e.value->'max', 'down', false,
                'charge', e.value->'charge', 'held', e.value->'held')) from jsonb_each(p_units) e);
  -- the run: engine 2, the units and the active names of the run start (D4: a later ability_v2 change does not touch this run)
  -- R1-ON INV-ON-1: member = the one-argument flag at the start (true for every run after the switch; false for a tester run before it)
  st := jsonb_build_object('engine', '2'::jsonb, 'mode', 'gauntlet', 'member', combat_v2_on('gauntlet'), 'squad', to_jsonb(p_squad), 'units', p_units,
    'carry', v_carry, 'info', gauntlet_v2_info(p_units));
  x := gauntlet_v2_enter(st, fl->0->0, 1, 1, jsonb_array_length(fl), null);
  insert into dungeon_runs (player_id, day, squad, state, mode, attempt) values (p_player, v_day, p_squad, x->'state', 'gauntlet_v2', p_attempt) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'mode', 'gauntlet_v2', 'squad', to_jsonb(p_squad)),
    jsonb_build_object('event', x->'step'->'event', 'log', x->'step'->'log'));
  perform gauntlet_v2_end(v_id, x->'state'->>'phase');
  return gauntlet_v2_out(v_id, jsonb_build_object('engine', '2'::jsonb, 'event', x->'step'->'event', 'actor', x->'step'->'actor',
    'steps_left', x->'step'->'steps_left', 'log', coalesce(x->'step'->'log', '[]'::jsonb)));
end $fn$;

-- ============================================================ 2. the board: v1 runs and member v2 runs (the board_tie_order.sql text)
create or replace function public.gauntlet_board(p_week date default null, p_limit integer default 20) returns jsonb
language sql stable set search_path = public as $function$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by b.floor desc, b.room desc, b.turns, coalesce(b.ended_at, now()), b.player_id) rank,
           b.player_id, p.username, b.floor, b.room, b.turns, b.status, b.day, b.runs
    from (select distinct on (r.player_id) r.player_id, r.floor, r.room, r.turns, r.status, r.ended_at, r.day,
                 count(*) over (partition by r.player_id) runs
          from dungeon_runs r
          -- R1-ON: a v2 run counts by its member mark (never the live flag, INV-ON-1)
          where (r.mode = 'gauntlet' or (r.mode = 'gauntlet_v2' and r.state->>'member' = 'true'))
            and r.day between coalesce(p_week, gauntlet_week(dungeon_day())) and coalesce(p_week, gauntlet_week(dungeon_day())) + 6
          order by r.player_id, r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now()), r.id) b
    join players p on p.id = b.player_id
    order by rank limit p_limit) x;
$function$;

-- ============================================================ 3. the lobby: players_week and runs_left read the board set (the runs_per_day.sql text)
create or replace function public.gauntlet_view(p_player text) returns jsonb
language plpgsql set search_path = public as $function$
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
  -- R1-ON: runs_left and players_week count the board set (v1 runs and member v2 runs, by the mark: INV-ON-1)
  v_left := greatest(game_var('gauntlet_runs_per_day')::int - (select count(*) from dungeon_runs where player_id = p_player and day = v_day
              and (mode = 'gauntlet' or (mode = 'gauntlet_v2' and state->>'member' = 'true')))::int, 0);
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
    'players_week', (select count(distinct player_id) from dungeon_runs where (mode = 'gauntlet' or (mode = 'gauntlet_v2' and state->>'member' = 'true'))
                       and day between v_week and v_week + 6),
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $function$;

-- ============================================================ 4. the week pool: only cards with a v2 unit while the Gauntlet is v2 (G-3)
create or replace function public.gauntlet_pool() returns table(id bigint, ckey bigint, role text, cost integer, tags text[], aff text)
language sql stable set search_path = public as $function$
  select c.id, hashtext(lower(regexp_replace(c.name, '^[^'']*''s[[:space:]]+', '')))::bigint,
         case when s.type in ('Character', 'Creature') then 'attacker' else 'support' end,
         balance_num('dungeon', 'cost', c.rarity::text)::int, coalesce(s.tag_slugs, '{}'), s.ability->>'affinity'
  from cards c join subjects s on s.id = c.subject_id
  where c.source::text not in ('event', 'promo') and c.rarity::text not in ('event', 'promo')
    and (s.type in ('Character', 'Creature') or (s.type is not null and s.ability->>'kind' = 'support'))
    -- R1-ON: while combat_v2.gauntlet is on, a card needs a usable ability_v2 (the combat_v2_card_unit rule), so a new week is never v1 (D2)
    and (not combat_v2_on('gauntlet') or (jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'role') = 'string'
         and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')));
$function$;

-- ============================================================ 5. server only (the grants before the file stay), the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['gauntlet_v2_begin(text, bigint[], jsonb, integer)', 'gauntlet_board(date, integer)', 'gauntlet_view(text)', 'gauntlet_pool()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.gauntlet_v2_begin(text, bigint[], jsonb, integer) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): the start of a v2 run for the tester branch of gauntlet_start: the run state (engine 2, units, carry, info), room 1 of floor 1, the row (mode gauntlet_v2, the next attempt of both modes) and the start log. combat_v2_gauntlet_run.sql. Since combat_v2_on_gauntlet.sql (R1-ON) the state also has member = combat_v2_on('gauntlet') at the start: the mark that gauntlet_board and gauntlet_view read (false for a tester run before the switch; it stays true after a rollback).$cm$;
comment on function public.gauntlet_board(date, integer) is $cm$GET /api/gauntlet/board, gauntlet_view and dungeon_pay: the Gauntlet board of a week (default this week). Each member's best run of the week counts, ranked by floor, room, turns, end time (an active run: now), then the member id, so a tie always has the same order (board_tie_order.sql). Returns a jsonb array with rank and runs. Since combat_v2_on_gauntlet.sql (R1-ON) a run is a v1 run (mode gauntlet) or a v2 run with the member mark (mode gauntlet_v2, state.member true); a tester v2 run of before the switch is not on the board.$cm$;
comment on function public.gauntlet_view(text) is $cm$GET /api/gauntlet: the member's Gauntlet screen. Ends the member's active runs of earlier days, builds the week, and returns the squad (costs: balance dungeon.cost), the budget (balance gauntlet.budget), today's newest run (null when it is over and a run is left: runs_left, last_run), the member's best rank, the rooms, the top 3 and the prizes. Since combat_v2_on_gauntlet.sql (R1-ON) runs_left and players_week count the board set (v1 runs and v2 runs with the member mark); run stays the v1 run (gauntlet_v2_view has the v2 run).$cm$;
comment on function public.gauntlet_pool() is $cm$Internal helper: the cards that the Gauntlet squad can use (attackers and support cards, no Event or Promo), with cost (balance dungeon.cost), tags and affinity. Called by gauntlet_squad. Since combat_v2_on_gauntlet.sql (R1-ON), while combat_v2_on('gauntlet') is true, only cards with a usable ability_v2 (the combat_v2_card_unit rule), so a new week squad always plays v2.$cm$;

comment on function public.combat_v2_on(text) is $cm$[combat] The ONE reader of the combat v2 switch (balance combat_v2, plan 14.2): true only when combat_v2.<p_mode> is the JSON boolean true (p_mode = gauntlet, dungeon, hunt or progress). Fails closed: a missing key, another type, a name that is not one of the four capabilities or any error gives false. Its only caller is combat_v2_on(text, text). Since combat_v2_progress_freeze_v1.sql (M1d) four v1 functions read the switch through that form: spend_stat_points and reset_stat_points (they refuse when progress is ON), buy_shop_item (its stat reset is the v2 reset when progress is ON) and shop_today (its free reset counts the gifts of that reset). Since combat_v2_gauntlet_run.sql (R1b) a fifth: gauntlet_start (its tester branch starts a gauntlet_v2 run). Since combat_v2_on_gauntlet.sql (R1-ON) two more: gauntlet_v2_begin (the member mark of a v2 run) and gauntlet_pool (only cards with a usable ability_v2 while the Gauntlet is v2).$cm$;

notify pgrst, 'reload schema';
