-- combat_v2_hunt_out_live.sql (2026-11-06): R3-ON-FIX, the live keys in the answer of the v2 Hunt start, act and auto
-- (pipeline item ON, POST-SWITCH-TRIAGE.md item 1). Needs R3a (combat_v2_hunt_practice.sql) and R3-ON (combat_v2_on_hunt.sql).
-- SQL merge order: ... -> R3a -> R3-ON -> HBP -> this file.
-- Defect: hunt_v2_out (R3a) wrote 'practice', true as a constant and had no top-level live or hunt key. R3-ON changed only hunt_v2_view.
--   So after Start, Act or Auto on a LIVE member day the client (huntLive: v.live === true and v.day.live === true) showed
--   "Practice (v2 test): no rewards" and no boss HP bar. The credit was correct (hunt_v2_live_credit does not read the answer).
-- After this file, hunt_v2_out (and so hunt_v2_start, hunt_v2_act, hunt_v2_auto) answers:
--   live     = the mark of the day row (hunt_v2_days.live), never the flag (INV-ON-1: a live day stays live after a rollback).
--   practice = not live (a tester practice day keeps practice true).
--   hunt     = the shape of hunt_v2_view: id, name, tier, closes_at, live_frac = hunts.hp_remaining / hp_max. The callers run
--              hunt_v2_out AFTER hunt_v2_live_credit, so live_frac is the boss HP after the call.
--   day      = unchanged (hunt_v2_day_json of R3-ON already has day.live = the same mark).
-- Every other key is unchanged. hunt_v2_view adds its own live, practice and hunt keys after this answer (o wins), so the view is unchanged.
-- The signature, the volatility (stable), search_path, grants (service_role only) are unchanged. Idempotent.
-- GUARD: the live hunt_v2_out must be its R3a text or the text that this file made. Undo: combat_v2_hunt_out_live_undo.sql.
-- Test: card-studio/scripts/test-combat-v2-on-hunt.mjs cases HL1-HL4 (MUTATE=all_out: the baseline, then each mutation must FAIL).

do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.hunt_v2_out(bigint, text, date, jsonb)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('4964b50dd15d8072935f603800ec46aa', 'c39ba3488345fb4cb2100f551575b52e') then
    raise exception 'combat_v2_hunt_out_live.sql: the live hunt_v2_out changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

create or replace function public.hunt_v2_out(p_hunt bigint, p_player text, p_day date, p_extra jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare r public.hunt_v2_days; v_live boolean;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  v_live := coalesce(r.live, false);
  return jsonb_build_object('ok', true, 'engine', '2'::jsonb, 'live', v_live, 'practice', not v_live,
      'hunt', (select jsonb_build_object('id', h.id, 'name', h.name, 'tier', h.tier, 'closes_at', h.closes_at,
                 'live_frac', h.hp_remaining::numeric / h.hp_max) from public.hunts h where h.id = p_hunt),
      'day', hunt_v2_day_json(r),
      'boss', hunt_boss_v2_card(r.boss, r.state->>'tier'), 'damage', r.damage, 'steps', r.steps, 'status', r.status, 'ended_by', r.ended_by,
      'fight', r.state->'fight', 'info', r.state->'info', 'units', r.state->'units')
    || p_extra || dungeon_v2_screen(r.state->'fight');
end $fn$;

revoke all on function public.hunt_v2_out(bigint, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.hunt_v2_out(bigint, text, date, jsonb) to service_role;

comment on function public.hunt_v2_out(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.20 R3, R3-ON-FIX): the answer of hunt_v2_start, hunt_v2_act and hunt_v2_auto: live = the mark of the day row (hunt_v2_days.live, never the flag), practice = not live, hunt (id, name, tier, closes_at, live_frac = the shared boss HP fraction, read after the credit of the call), the day, the boss card (hunt_boss_v2_card), damage, steps, status, the fight, info, units, the given fields and the screen fields of dungeon_v2_screen. Reads only. combat_v2_hunt_out_live.sql.$cm$;

notify pgrst, 'reload schema';
