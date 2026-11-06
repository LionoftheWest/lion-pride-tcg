-- hunt_v2_view_boss_max_undo.sql (2026-11-06): the undo of hunt_v2_view_boss_max.sql (HUNT-HEADER-V2). It puts back the exact R3-ON text of
-- hunt_v2_view (combat_v2_on_hunt.sql; live md5 44ada58cd6bcc7b6ed02606810d7fbb8 on 2026-11-06) and its R3-ON comment.
-- After the undo the view has no boss_max key: the Hunt header shows the v1 numbers again (the client falls back, hunt-scale.js).
-- Apply only when Nathan or the orchestrator wants the fix out. A second run changes nothing.
-- GUARD: the live hunt_v2_view must be the text of hunt_v2_view_boss_max.sql or the R3-ON text.

do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.hunt_v2_view(text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('e70ec9be7f9038548dd28c013f833682', '44ada58cd6bcc7b6ed02606810d7fbb8') then
    raise exception 'hunt_v2_view_boss_max_undo.sql: the live hunt_v2_view is not the text of hunt_v2_view_boss_max.sql (md5 %).', m;
  end if;
end $g$;

create or replace function public.hunt_v2_view(p_player text) returns jsonb
language plpgsql set search_path = public as $function$
declare v_day date := hunt_v2_today(); v_live boolean := combat_v2_on('hunt'); v_tester boolean := combat_v2_on('hunt', p_player); h public.hunts; v_has boolean;
  v_key text; r public.hunt_v2_days; o jsonb; v_end public.hunts; v_endkey text;
begin
  perform hunt_v2_abandon(p_player, v_day);
  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1;
  v_has := found;
  if v_has then v_key := hunt_v2_boss_key(h.name); end if;
  select * into r from public.hunt_v2_days d where d.player_id = p_player and d.day = v_day and (not v_has or d.hunt_id = h.id) order by d.started_at desc limit 1;
  if not v_has and v_tester and not v_live then
    select * into v_end from public.hunts order by opens_at desc limit 1;
    if found then v_endkey := hunt_v2_boss_key(v_end.name); end if;
  end if;
  o := jsonb_build_object('ok', true, 'tester', v_tester, 'live', v_live, 'practice', not v_live,
    'hunt', case when v_has then jsonb_build_object('id', h.id, 'name', h.name, 'tier', h.tier, 'closes_at', h.closes_at,
              'live_frac', h.hp_remaining::numeric / h.hp_max) end,
    'boss', case when v_key is not null then hunt_boss_v2_card(v_key, h.tier) when v_endkey is not null then hunt_boss_v2_card(v_endkey, v_end.tier) end,
    'day', hunt_v2_day_json(r),
    'can_start', (v_live or v_tester) and ((v_has and v_key is not null
                   and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day))
                 or (v_endkey is not null and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = v_end.id and d.player_id = p_player and d.day = v_day))));
  if r.status = 'active' then
    return hunt_v2_out(r.hunt_id, r.player_id, r.day, '{}'::jsonb) || o;
  end if;
  return o;
end $function$;

revoke all on function public.hunt_v2_view(text) from public, anon, authenticated;
grant execute on function public.hunt_v2_view(text) to service_role;

comment on function public.hunt_v2_view(text) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, server only, route): the Hunt screen in v2: tester, live (the flag), practice, hunt (live_frac = the shared boss bar), the boss card, today's day row (live, credited), can_start (the flag or a tester; a tester with no active Hunt can practise against the newest ended one) and the screen fields of an active day. combat_v2_on_hunt.sql.$cm$;

notify pgrst, 'reload schema';
