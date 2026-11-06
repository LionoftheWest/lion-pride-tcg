-- hunt_v2_view_boss_max.sql (2026-11-06): HUNT-HEADER-V2, the max HP of the v2 boss in the Hunt view (member report, Nathan 2026-11-06:
-- "this hp bar is not accurate to what it actually is in game"). Needs R3a (combat_v2_hunt_practice.sql) and R3-ON (combat_v2_on_hunt.sql).
-- SQL merge order: ... -> R3a -> R3-ON -> HBP -> R3-ON-FIX -> this file.
-- Defect: with combat v2 live every member fights a PRIVATE copy of the boss (hunt_v2_start: combat_v2_hunt_boss, max for example 36244),
--   but the Hunt header (tcg-activity main.js huntSelectV3HTML, UI-17) showed the shared row on the v1 scale (hunts.hp_remaining / hp_max,
--   for example 60264 / 80000). The fraction was the same (hunt_v2_credit: private decrease x hp_max / private max); the numbers were not.
--   The view had no max of the private copy before the first start of the day, so the client could not show the fight's scale.
-- After this file, hunt_v2_view answers one more top-level key:
--   boss_max = (combat_v2_hunt_boss(tier, key)->>'max')::numeric: the max HP of the boss that hunt_v2_start makes for the same Hunt and tier
--              (the same function and the same balance bundle, combat_v2_enemy_numbers(), as the fight; no second calculation), or null
--              when the view has no v2 boss. A tester with no active Hunt: the max of the newest ended Hunt (the boss of the practice).
-- Every other key is unchanged (the hunt object stays the shape of hunt_v2_out: test-combat-v2-on-hunt.mjs HL4). The signature, the
-- volatility, search_path, grants (service_role only) are unchanged. Idempotent.
-- GUARD: the live hunt_v2_view must be its R3-ON text or the text that this file made. Undo: hunt_v2_view_boss_max_undo.sql.
-- Test: card-studio/scripts/test-hunt-v2-view-boss-max.mjs (MUTATE=all: the baseline, then each mutation must FAIL).

do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.hunt_v2_view(text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('44ada58cd6bcc7b6ed02606810d7fbb8', 'e70ec9be7f9038548dd28c013f833682') then
    raise exception 'hunt_v2_view_boss_max.sql: the live hunt_v2_view changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

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
    -- HUNT-HEADER-V2: the max HP of the fight's boss (the one source: combat_v2_hunt_boss, as hunt_v2_start)
    'boss_max', case when v_key is not null then (combat_v2_hunt_boss(h.tier, v_key)->>'max')::numeric
                     when v_endkey is not null then (combat_v2_hunt_boss(v_end.tier, v_endkey)->>'max')::numeric end,
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

comment on function public.hunt_v2_view(text) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, server only, route): the Hunt screen in v2: tester, live (the flag), practice, hunt (live_frac = the shared boss bar), the boss card, boss_max (the max HP of the fight's boss, combat_v2_hunt_boss: the Hunt header shows the shared fraction on this scale, HUNT-HEADER-V2), today's day row (live, credited), can_start (the flag or a tester; a tester with no active Hunt can practise against the newest ended one) and the screen fields of an active day. combat_v2_on_hunt.sql, hunt_v2_view_boss_max.sql.$cm$;

notify pgrst, 'reload schema';
