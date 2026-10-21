-- board_tie_order.sql (2026-10-21): one fixed order for a tie on the Dungeon and the Gauntlet boards.
-- Before: dungeon_board and gauntlet_board ranked by floor desc, room desc, turns, coalesce(ended_at, now()). Two members with
-- the same four values (two active runs: both now(); two runs that ended at the same time) had no fixed order. row_number()
-- and the "order by ... limit p_limit" then followed the plan (the join order, a top-N sort for a small limit, new table
-- statistics), so two calls could give a tied member two ranks: dungeon_view_core (board read with limit 1000) and the
-- board itself, or the top 3 (limit 3) against the top of the 1000-row read. dungeon_pay pays the prizes by this rank.
-- Found by the flaky card-studio/scripts/test-boards-once.mjs (2026-10-20: rank 388 against 393 for one tied member).
-- Now: the rule of docs/activities/03-dungeon-run.md section 7 (the floor, then the room; a tie: fewer turns, then the
-- earlier finish), then the member id (player_id, text order) as the last key of row_number(). The "order by ... limit" now
-- orders by that rank (one order, not a second copy of the keys). The DISTINCT ON that picks the best run of each member gets
-- the run id as its last key (the earlier run, for two runs of one member with the same values). No other change: the
-- columns and the limits are as before.
-- Test: card-studio/scripts/test-board-tie-order.mjs (rolled back; MUTATE=<name> must FAIL). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this
-- file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.dungeon_board(date, integer)', 'f1da392ebd81a0080d9592ed459a9f5e', '5f00c4c5b2d9f1043548d8819e91a78f'),
    ('public.gauntlet_board(date, integer)', '74965f687e0dc9f93d27b903bebfa176', '8ed0efb90f0174ef43a091d812d64a6f')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'board_tie_order.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.dungeon_board(p_day date DEFAULT NULL::date, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now()), r.player_id) rank,
           r.player_id, p.username, r.floor, r.room, r.turns, r.status, to_jsonb(r.squad) squad
    from (select distinct on (x.player_id) x.* from dungeon_runs x where x.day = coalesce(p_day, dungeon_day()) and x.mode = 'daily'
          order by x.player_id, x.floor desc, x.room desc, x.turns, coalesce(x.ended_at, now()), x.id) r join players p on p.id = r.player_id
    order by rank limit p_limit) x;
$function$;

CREATE OR REPLACE FUNCTION public.gauntlet_board(p_week date DEFAULT NULL::date, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by b.floor desc, b.room desc, b.turns, coalesce(b.ended_at, now()), b.player_id) rank,
           b.player_id, p.username, b.floor, b.room, b.turns, b.status, b.day, b.runs
    from (select distinct on (r.player_id) r.player_id, r.floor, r.room, r.turns, r.status, r.ended_at, r.day,
                 count(*) over (partition by r.player_id) runs
          from dungeon_runs r
          where r.mode = 'gauntlet' and r.day between coalesce(p_week, gauntlet_week(dungeon_day())) and coalesce(p_week, gauntlet_week(dungeon_day())) + 6
          order by r.player_id, r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now()), r.id) b
    join players p on p.id = b.player_id
    order by rank limit p_limit) x;
$function$;

comment on function public.dungeon_board(date, integer) is $cm$GET /api/dungeon/board, dungeon_view and dungeon_pay: the daily board of a day (default today): the best run of each member, ranked by floor, room, turns, end time (an active run: now), then the member id, so a tie always has the same order (board_tie_order.sql). Returns a jsonb array with rank, member and depth.$cm$;
comment on function public.gauntlet_board(date, integer) is $cm$GET /api/gauntlet/board, gauntlet_view and dungeon_pay: the Gauntlet board of a week (default this week). Each member's best run of the week counts, ranked by floor, room, turns, end time (an active run: now), then the member id, so a tie always has the same order (board_tie_order.sql). Returns a jsonb array with rank and runs.$cm$;

notify pgrst, 'reload schema';
