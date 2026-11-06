-- combat_v2_hunt_out_live_undo.sql (2026-11-06): the undo of combat_v2_hunt_out_live.sql (R3-ON-FIX). It puts back the exact R3a text of
-- hunt_v2_out (combat_v2_hunt_practice.sql; live md5 4964b50dd15d8072935f603800ec46aa on 2026-11-06) and its R3a comment.
-- After the undo the start, act and auto answers say practice true again and have no top-level live or hunt key (the defect of
-- POST-SWITCH-TRIAGE.md item 1). The credit does not change. Apply only when Nathan or the orchestrator wants the fix out. A second run
-- changes nothing.
-- GUARD: the live hunt_v2_out must be the text of combat_v2_hunt_out_live.sql or the R3a text.

do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.hunt_v2_out(bigint, text, date, jsonb)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('c39ba3488345fb4cb2100f551575b52e', '4964b50dd15d8072935f603800ec46aa') then
    raise exception 'combat_v2_hunt_out_live_undo.sql: the live hunt_v2_out is not the text of combat_v2_hunt_out_live.sql (md5 %).', m;
  end if;
end $g$;

create or replace function public.hunt_v2_out(p_hunt bigint, p_player text, p_day date, p_extra jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare r public.hunt_v2_days;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  return jsonb_build_object('ok', true, 'engine', '2'::jsonb, 'practice', true, 'day', hunt_v2_day_json(r),
      'boss', hunt_boss_v2_card(r.boss, r.state->>'tier'), 'damage', r.damage, 'steps', r.steps, 'status', r.status, 'ended_by', r.ended_by,
      'fight', r.state->'fight', 'info', r.state->'info', 'units', r.state->'units')
    || p_extra || dungeon_v2_screen(r.state->'fight');
end $fn$;

revoke all on function public.hunt_v2_out(bigint, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.hunt_v2_out(bigint, text, date, jsonb) to service_role;

comment on function public.hunt_v2_out(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): the answer of a practice function: the day, the boss card (hunt_boss_v2_card), damage, steps, status, the fight, info, units, practice true, the given fields and the screen fields of dungeon_v2_screen. Reads only. combat_v2_hunt_practice.sql.$cm$;

notify pgrst, 'reload schema';
