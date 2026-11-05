-- combat_v2_needs_ally_self.sql (2026-11-05): R1b-FIX, the ally mark of the v2 Gauntlet screen for a "self" block.
-- Defect: gauntlet_v2_needs_ally (combat_v2_gauntlet_run.sql, R1b) marks a quicken block with "self": true as an ally pick. The engine
--   (combat_effect_v2_active) does not ask for an ally there: a self quicken is valid only on an attacker (ability_v2_check, Set 2 part (b):
--   "an attacker quicken is self", "self is for an attacker quicken"), and the attacker branch of the engine Quickens the card itself after
--   the hits and returns before the ally code of the support branch. So the screen asked an ally pick for S2 "Time Skip" (subject 302,
--   cards 475, 476, 478), and the engine ignored it. Found by test-combat-v2-gauntlet-run G1.17 b at the ON go-live rehearsal 2026-11-05.
-- After this file: gauntlet_v2_needs_ally = the R1b rule, and a block with "self": true never asks for an ally. Nothing else changes: the
--   signature, IMMUTABLE, search_path, the grants (service_role only) and every other function stay. Only blocks with "self" change the answer
--   (on live 2026-11-05: one block, subject 302).
-- Part 2 (the same rule in dungeon_v2_needs_ally, combat_v2_dungeon_run.sql): combat_v2_needs_ally_self_dungeon.sql.
-- Idempotent. Server only. Undo: combat_v2_needs_ally_self_undo.sql.
-- Test: card-studio/scripts/test-combat-v2-needs-ally-self.mjs (rolled back; MUTATE=all must catch every mutation).

-- GUARD: the live function must be the R1b text (md5 fd42f176...) or the text of this file.
do $g$
declare m text;
begin
  m := md5(replace(pg_get_functiondef('public.gauntlet_v2_needs_ally(jsonb)'::regprocedure), chr(13), ''));
  if m not in ('fd42f176eddb061f541ac416a6b48c0b', 'dcf9568f280773d384762c99bb2b2d2f') then
    raise exception 'combat_v2_needs_ally_self.sql: the live gauntlet_v2_needs_ally(jsonb) changed since this file was built (md5 %). Rebuild from the live text.', m;
  end if;
end $g$;

create or replace function public.gauntlet_v2_needs_ally(p_blocks jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  -- the engine rule of combat_effect_v2_active: a single-ally block (shield, heal, empower, focus, cure; quicken without all) whose "to"
  -- is not most_hurt or strongest asks for opts.ally; a "self" block (an attacker quicken: the card itself) never does
  select coalesce(bool_or((x->>'k' in ('shield', 'heal', 'empower', 'focus', 'cure') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false)))
                          and coalesce(x->>'to', '') not in ('most_hurt', 'strongest')
                          and x->'self' is distinct from 'true'::jsonb), false)
    from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) x;
$fn$;

revoke all on function public.gauntlet_v2_needs_ally(jsonb) from public, anon, authenticated;
grant execute on function public.gauntlet_v2_needs_ally(jsonb) to service_role;

comment on function public.gauntlet_v2_needs_ally(jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b; R1b-FIX combat_v2_needs_ally_self.sql): true when an active (its blocks) asks the player for an ally: a shield, heal, empower, focus or cure block, or quicken without all, whose to is not most_hurt or strongest and that is not self (an attacker quicken on the card itself) (the engine rule of combat_effect_v2_active). A gated block may make it true when the engine does not use the ally (harmless). Pure. combat_v2_gauntlet_run.sql.$cm$;

notify pgrst, 'reload schema';
