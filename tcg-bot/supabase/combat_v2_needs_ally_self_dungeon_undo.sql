-- combat_v2_needs_ally_self_dungeon_undo.sql (2026-11-05): the undo of combat_v2_needs_ally_self_dungeon.sql (R1b-FIX part 2). It puts back
-- the R2a text of dungeon_v2_needs_ally (combat_v2_dungeon_run.sql, md5 f6a36c42df0a3d677210b02efdf1d619) and its R2a comment. The grants stay
-- (service_role only). After the undo the v2 Dungeon screen asks an ally pick again for a self quicken (S2 "Time Skip", subject 302).
-- Apply only when Nathan or the orchestrator wants the R2a rule back. A second run changes nothing.

-- GUARD: the live function must be the text of combat_v2_needs_ally_self_dungeon.sql or the R2a text.
do $g$
declare m text;
begin
  m := md5(replace(pg_get_functiondef('public.dungeon_v2_needs_ally(jsonb)'::regprocedure), chr(13), ''));
  if m not in ('3578f0810a65c3b21f69dc0a116352f6', 'f6a36c42df0a3d677210b02efdf1d619') then
    raise exception 'combat_v2_needs_ally_self_dungeon_undo.sql: the live dungeon_v2_needs_ally(jsonb) is not the fix text or the R2a text (md5 %)', m;
  end if;
end $g$;

create or replace function public.dungeon_v2_needs_ally(p_blocks jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  -- the engine rule of combat_effect_v2_active (R1b 3.2 item 3): a single-ally block (shield, heal, empower, focus, cure; quicken without
  -- all) whose "to" is not most_hurt or strongest asks for opts.ally
  select coalesce(bool_or((x->>'k' in ('shield', 'heal', 'empower', 'focus', 'cure') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false)))
                          and coalesce(x->>'to', '') not in ('most_hurt', 'strongest')), false)
    from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) x;
$fn$;

revoke all on function public.dungeon_v2_needs_ally(jsonb) from public, anon, authenticated;
grant execute on function public.dungeon_v2_needs_ally(jsonb) to service_role;

comment on function public.dungeon_v2_needs_ally(jsonb) is $cm$[combat] Combat v2 Dungeon (20.19 R2): true when an active (its blocks) asks the player for an ally: a shield, heal, empower, focus or cure block, or quicken without all, whose to is not most_hurt or strongest (the engine rule of combat_effect_v2_active; R1b 3.2 item 3). Pure. combat_v2_dungeon_run.sql.$cm$;

notify pgrst, 'reload schema';
