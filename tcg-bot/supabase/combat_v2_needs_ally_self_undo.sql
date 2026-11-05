-- combat_v2_needs_ally_self_undo.sql (2026-11-05): the undo of combat_v2_needs_ally_self.sql (R1b-FIX). It puts back the R1b text of
-- gauntlet_v2_needs_ally (combat_v2_gauntlet_run.sql, md5 fd42f176eddb061f541ac416a6b48c0b) and its R1b comment. The grants stay
-- (service_role only). After the undo the v2 Gauntlet screen asks an ally pick again for a self quicken (S2 "Time Skip", subject 302).
-- Apply only when Nathan or the orchestrator wants the R1b rule back. A second run changes nothing.

-- GUARD: the live function must be the text of combat_v2_needs_ally_self.sql (md5 dcf9568f...) or the R1b text.
do $g$
declare m text;
begin
  m := md5(replace(pg_get_functiondef('public.gauntlet_v2_needs_ally(jsonb)'::regprocedure), chr(13), ''));
  if m not in ('dcf9568f280773d384762c99bb2b2d2f', 'fd42f176eddb061f541ac416a6b48c0b') then
    raise exception 'combat_v2_needs_ally_self_undo.sql: the live gauntlet_v2_needs_ally(jsonb) is not the fix text or the R1b text (md5 %)', m;
  end if;
end $g$;

create or replace function public.gauntlet_v2_needs_ally(p_blocks jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  -- the engine rule of combat_effect_v2_active: a single-ally block (shield, heal, empower, focus, cure; quicken without all) whose "to"
  -- is not most_hurt or strongest asks for opts.ally
  select coalesce(bool_or((x->>'k' in ('shield', 'heal', 'empower', 'focus', 'cure') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false)))
                          and coalesce(x->>'to', '') not in ('most_hurt', 'strongest')), false)
    from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) x;
$fn$;

revoke all on function public.gauntlet_v2_needs_ally(jsonb) from public, anon, authenticated;
grant execute on function public.gauntlet_v2_needs_ally(jsonb) to service_role;

comment on function public.gauntlet_v2_needs_ally(jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): true when an active (its blocks) asks the player for an ally: a shield, heal, empower, focus or cure block, or quicken without all, whose to is not most_hurt or strongest (the engine rule of combat_effect_v2_active). A gated block may make it true when the engine does not use the ally (harmless). Pure. combat_v2_gauntlet_run.sql.$cm$;

notify pgrst, 'reload schema';
