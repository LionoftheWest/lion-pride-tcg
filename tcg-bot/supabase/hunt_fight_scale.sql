-- hunt_fight_scale.sql (2026-11-06): HUNT-HEADER-V2 part A, the ONE conversion factor from the shared Hunt scale to the v2 fight scale.
-- Nathan (2026-11-06): "Yes everything needs to be accurate to the damage people ACTUALLY do now in combat v2".
-- Needs R3a (combat_v2_hunt_practice.sql), R3-ON (combat_v2_on_hunt.sql) and hunt_v2_view_boss_max.sql.
-- SQL merge order: ... -> R3-ON -> HBP -> R3-ON-FIX -> hunt_v2_view_boss_max.sql -> this file.
-- Why: with combat v2 live every member fights a PRIVATE copy of the boss (max = combat_v2_hunt_boss(tier, key).max, for example 36244).
--   hunt_v2_credit writes the shared row (hunts.hp_remaining, hunt_hits.damage, hunt_combat_log.damage) on the v1 scale: each decrease of the
--   private HP x hunts.hp_max / private max. So every shared-scale number (boss HP, damage) x (private max / hunts.hp_max) is the number of the
--   fight that the members see. One factor for HP and damage: the bar, the HP numbers and the damage numbers agree.
-- hunt_fight_scale(p_hunt) = (combat_v2_hunt_boss(tier, key)->>'max') / hunts.hp_max (the same function and bundle as hunt_v2_start and
--   hunt_v2_view.boss_max), or NULL (= show the shared numbers as they are) when:
--   - the flag combat_v2.hunt is OFF (flag OFF: every reader shows today's numbers), or
--   - the Hunt is not active and had no live v2 day (a v1 Hunt of the past keeps its v1 numbers), or
--   - the Hunt has no v2 boss (hunt_v2_boss_key null) or no hp_max.
-- hunt_fight_scales(p_hunts) = { "<hunt id>": factor } for the given Hunts with a factor (the batch form for the readers; it calls hunt_fight_scale).
-- Readers: tcg-activity server.js (hunt-v2-scale.js) and the bot (hunt-notify.ts). Reads only. New functions: no guard needed (idempotent).
-- Test: card-studio/scripts/test-hunt-fight-scale.mjs (MUTATE=all: the baseline, then each mutation must FAIL).

create or replace function public.hunt_fight_scale(p_hunt bigint) returns numeric
language plpgsql stable set search_path = public as $fn$
declare h public.hunts; k text;
begin
  if not combat_v2_on('hunt') then return null; end if;
  select * into h from public.hunts where id = p_hunt;
  if not found or coalesce(h.hp_max, 0) <= 0 then return null; end if;
  if h.status <> 'active' and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = p_hunt and d.live) then return null; end if;
  k := hunt_v2_boss_key(h.name);
  if k is null then return null; end if;
  return (combat_v2_hunt_boss(h.tier, k)->>'max')::numeric / h.hp_max;
end $fn$;

create or replace function public.hunt_fight_scales(p_hunts bigint[]) returns jsonb
language sql stable set search_path = public as $fn$
  select coalesce(jsonb_object_agg(x.id::text, x.f), '{}'::jsonb)
    from (select distinct u.id, hunt_fight_scale(u.id) as f from unnest(coalesce(p_hunts, '{}'::bigint[])) u(id) where u.id is not null) x
   where x.f is not null;
$fn$;

revoke all on function public.hunt_fight_scale(bigint) from public, anon, authenticated;
revoke all on function public.hunt_fight_scales(bigint[]) from public, anon, authenticated;
grant execute on function public.hunt_fight_scale(bigint) to service_role;
grant execute on function public.hunt_fight_scales(bigint[]) to service_role;

comment on function public.hunt_fight_scale(bigint) is $cm$[combat] Combat v2 Hunt (HUNT-HEADER-V2): the one factor from the shared Hunt scale (hunts.hp_max, hunt_hits.damage) to the v2 fight scale = combat_v2_hunt_boss(tier, key).max / hunts.hp_max; NULL when the flag is OFF, the Hunt is not active and had no live v2 day, or it has no v2 boss. Readers multiply every shared HP and damage number by it. hunt_fight_scale.sql.$cm$;
comment on function public.hunt_fight_scales(bigint[]) is $cm$[combat] Combat v2 Hunt (HUNT-HEADER-V2): { hunt id: hunt_fight_scale } for the given Hunts that have a factor (the batch read of the server and the bot). hunt_fight_scale.sql.$cm$;

notify pgrst, 'reload schema';
