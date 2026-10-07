-- fix_search_path.sql (2026-10-07): a fixed search_path for the last 16 public functions without one
-- (the Supabase security lint "function_search_path_mutable"). Each function gets search_path = public, the
-- value that 211 other public functions use on live. No body changes: md5, now() and the jsonb functions are
-- in pg_catalog, which PostgreSQL always searches first; each other call is in public.
-- None of them is SECURITY DEFINER. They are small helpers of the Hunt (hunt_mark_on, combat_*), the Dungeon
-- (dungeon_*) and the Gauntlet (gauntlet_week).
--
-- Re-run safety: a "create or replace function" without a SET clause drops the setting again. So each file that
-- creates one of these functions now carries the same SET line (balance_table.sql, combat_core.sql, dungeon.sql,
-- dungeon_v2.sql, gauntlet.sql, hunt_boss_moves.sql, one_source_rules.sql). balance_table.sql pins 8 of them by
-- md5: its guard also accepts the md5 after this file (the same text with the SET line).
-- The audit_fixes_2026_10_03.sql functions (card_power, ascend_cost, rarity_rank, stat_pt,
-- subjects_flatten_tags) got the SET line in their source files too.
--
-- Test: card-studio/scripts/test-search-path.mjs. Idempotent (alter ... set is the same on a re-run).

alter function public.combat_absorb(integer, integer) set search_path = public;
alter function public.combat_aff_scale(integer) set search_path = public;
alter function public.combat_area_roll(numeric, numeric, numeric) set search_path = public;
alter function public.combat_burn(numeric) set search_path = public;
alter function public.combat_lifesteal(integer, numeric, integer) set search_path = public;
alter function public.combat_regen(bigint) set search_path = public;
alter function public.combat_stun_immune(integer, integer) set search_path = public;
alter function public.combat_support_value(text, numeric, numeric, integer) set search_path = public;
alter function public.combat_thorns(integer) set search_path = public;
alter function public.dungeon_day() set search_path = public;
alter function public.dungeon_pick(jsonb, numeric) set search_path = public;
alter function public.dungeon_rand(text) set search_path = public;
alter function public.dungeon_rules() set search_path = public;
alter function public.dungeon_txt(jsonb) set search_path = public;
alter function public.gauntlet_week(date) set search_path = public;
alter function public.hunt_mark_on(jsonb, text, integer) set search_path = public;

-- The check: no public function is left without a fixed search_path.
do $c$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%');
  if v is not null then raise exception 'fix_search_path.sql: these public functions still have no fixed search_path: %', v; end if;
end $c$;

notify pgrst, 'reload schema';
