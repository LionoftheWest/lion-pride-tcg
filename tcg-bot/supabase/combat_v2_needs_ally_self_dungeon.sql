-- combat_v2_needs_ally_self_dungeon.sql (2026-11-05): R1b-FIX part 2, the ally mark of the v2 Dungeon screen for a "self" block.
-- Defect: dungeon_v2_needs_ally (combat_v2_dungeon_run.sql, R2a; dungeon_v2_info of combat_v2_on_dungeon.sql reads it) has the R1b rule of
--   gauntlet_v2_needs_ally: it marks a quicken block with "self": true as an ally pick. The engine (combat_effect_v2_active) does not ask for an
--   ally there: a self quicken is valid only on an attacker (ability_v2_check), and the attacker branch Quickens the card itself after the hits
--   and returns before the ally code of the support branch. So the v2 Dungeon screen asked an ally pick for S2 "Time Skip" (subject 302,
--   cards 475, 476, 478). Part 1 (the Gauntlet helper): combat_v2_needs_ally_self.sql.
-- After this file: dungeon_v2_needs_ally = the R2a rule, and a block with "self": true never asks for an ally. Nothing else changes: the
--   signature, IMMUTABLE, search_path, the grants (service_role only) and every other function stay.
-- Idempotent. Server only. Undo: combat_v2_needs_ally_self_dungeon_undo.sql.
-- Test: card-studio/scripts/test-combat-v2-needs-ally-self.mjs (rolled back; MUTATE=all must catch every mutation).

-- GUARD: the live function must be the R2a text (md5 f6a36c42...) or the text of this file.
do $g$
declare m text;
begin
  m := md5(replace(pg_get_functiondef('public.dungeon_v2_needs_ally(jsonb)'::regprocedure), chr(13), ''));
  if m not in ('f6a36c42df0a3d677210b02efdf1d619', '3578f0810a65c3b21f69dc0a116352f6') then
    raise exception 'combat_v2_needs_ally_self_dungeon.sql: the live dungeon_v2_needs_ally(jsonb) changed since this file was built. Rebuild from the live text. (md5 %)', m;
  end if;
end $g$;

create or replace function public.dungeon_v2_needs_ally(p_blocks jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  -- the engine rule of combat_effect_v2_active (R1b 3.2 item 3): a single-ally block (shield, heal, empower, focus, cure; quicken without
  -- all) whose "to" is not most_hurt or strongest asks for opts.ally; a "self" block (an attacker quicken: the card itself) never does
  select coalesce(bool_or((x->>'k' in ('shield', 'heal', 'empower', 'focus', 'cure') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false)))
                          and coalesce(x->>'to', '') not in ('most_hurt', 'strongest')
                          and x->'self' is distinct from 'true'::jsonb), false)
    from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) x;
$fn$;

revoke all on function public.dungeon_v2_needs_ally(jsonb) from public, anon, authenticated;
grant execute on function public.dungeon_v2_needs_ally(jsonb) to service_role;

comment on function public.dungeon_v2_needs_ally(jsonb) is $cm$[combat] Combat v2 Dungeon (20.19 R2; R1b-FIX combat_v2_needs_ally_self_dungeon.sql): true when an active (its blocks) asks the player for an ally: a shield, heal, empower, focus or cure block, or quicken without all, whose to is not most_hurt or strongest and that is not self (an attacker quicken on the card itself) (the engine rule of combat_effect_v2_active; R1b 3.2 item 3). Pure. combat_v2_dungeon_run.sql.$cm$;

notify pgrst, 'reload schema';
