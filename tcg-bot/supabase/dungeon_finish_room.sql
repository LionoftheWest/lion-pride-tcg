-- dungeon_finish_room.sql (2026-10-14, D-200 / D-201). "Finish room": ONE action plays a whole fight room (the Dungeon and the Gauntlet).
-- Why: a member needs about 84 actions (Dungeon) and 136 (Gauntlet) for a run today; Nathan asked for faster runs and kept 5 rooms per floor
-- (docs/combat-lab.md "Five rooms per floor", option 3a: Finish room alone, no balance change). UI-47 review-3 option A: the client replays
-- every round fast, with a Skip button. So the answer lists every round, in order.
--
-- dungeon_finish_room(player, mode)   plays the fight of the current room to its end by calling dungeon_auto_rounds (10 rounds a call) again
--   and again. dungeon_auto_rounds stops at each kill; this function goes on (a horde has 4 or 5 monsters), because the room is the whole fight.
--   It copies no rule, no roll, no number: every action is a call of dungeon_attack / dungeon_support / dungeon_pass_turn (through Auto).
--   One transaction, the run row locked: the squad can lose (the run ends as today) and the loot, the log rows and combat_actions are the
--   rows of the same actions played one by one (the test compares them).
--   The end of a room: the fight is not a fight any more (the step is choose / floor_done / cleared: outcome won), the squad fell or the last
--   room was cleared (the run is over: lost / won), or the round limit.
--   The round limit is the EXISTING rule: balance dungeon.round_cap (40) is the most rounds of one fight. dungeon_attack / dungeon_pass_turn
--   settle the run as fell and answer round_cap at that round: this function reports it as outcome limit (the run is over, as today). No new
--   number. A second guard (the calls of the loop, round_cap + 2, each call plays at least one round) settles the run as fell if a call ever
--   made no progress: the loop never runs on.
-- The answer (the Auto answer, plus the end of the room):
--   {ok: true, rounds: [{sup?, atk | pass}], played, stopped: phase | over | limit | error | guard, error: null | {ok:false, error, ...},
--    state, status, ended: status <> 'active', outcome: won | lost | limit | null (null only when an action was refused: stopped error), calls}
--   A refusal before anything was played (disabled, no_run, not_fighting, no_attacker ...) is the plain {ok: false, error}.
-- New function only: no live function is replaced, so no live-text guard is needed. Needs dungeon_auto_rounds.sql. Test: card-studio/scripts/test-dungeon-finish-room.mjs.

create or replace function public.dungeon_finish_room(p_player text, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r dungeon_runs; v_mode text := coalesce(p_mode, 'daily'); v_cap int; v_calls int := 0; v_rounds jsonb := '[]'::jsonb; v_played int := 0;
  v_a jsonb; v_stop text := null; v_err jsonb := null; v_limit boolean := false; v_outcome text;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = v_mode for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  v_cap := balance_num('dungeon', 'round_cap')::int;   -- the round limit of one fight (balance dungeon.round_cap)
  loop
    v_calls := v_calls + 1;
    v_a := dungeon_auto_rounds(p_player, v_mode, 10);
    if not coalesce((v_a->>'ok')::boolean, false) then
      if v_a->>'error' = 'round_cap' then v_limit := true; v_stop := 'limit';   -- dungeon_attack settled the run as fell
      elsif v_calls = 1 then return v_a;   -- the refusal of the first action, as Auto gives it
      else v_err := v_a; v_stop := 'error'; end if;
      exit;
    end if;
    v_rounds := v_rounds || coalesce(v_a->'rounds', '[]'::jsonb);
    v_played := v_played + coalesce((v_a->>'played')::int, 0);
    if jsonb_typeof(v_a->'error') = 'object' then   -- an action that the rules refused, after some rounds
      if v_a->'error'->>'error' = 'round_cap' then v_limit := true; v_stop := 'limit'; else v_err := v_a->'error'; v_stop := 'error'; end if;
      exit;
    end if;
    select * into r from dungeon_runs where id = r.id;
    if r.status <> 'active' then v_stop := 'over'; exit; end if;
    if r.state->>'phase' <> 'fight' then v_stop := 'phase'; exit; end if;
    if v_calls >= v_cap + 2 then   -- never reached with the rules of today (each call plays a round, the cap ends the fight): the room is lost as at the round limit
      perform dungeon_settle(r.id, 'fell', false); v_limit := true; v_stop := 'guard'; exit;
    end if;
  end loop;
  select * into r from dungeon_runs where id = r.id;
  v_outcome := case when v_limit then 'limit'
    when r.status <> 'active' then case when r.ended_by = 'cleared' then 'won' else 'lost' end
    when r.state->>'phase' <> 'fight' then 'won'
    else null end;
  return jsonb_build_object('ok', true, 'rounds', v_rounds, 'played', v_played, 'stopped', v_stop, 'error', v_err,
    'state', r.state, 'status', r.status, 'ended', r.status <> 'active', 'outcome', v_outcome, 'calls', v_calls);
end $function$;

grant execute on function public.dungeon_finish_room(text, text) to postgres, service_role;
comment on function public.dungeon_finish_room(text, text) is $c$POST /api/dungeon/finish: plays the whole fight of the current room (Dungeon or Gauntlet) with Auto's choices, by calling dungeon_auto_rounds again and again (it goes on after a kill). One transaction. Same rules and rows as the single actions. The squad can lose (the run ends as today); the round limit is balance dungeon.round_cap (outcome limit, the run falls). Returns every round in order, the final state, status, ended and outcome (won, lost, limit).$c$;
notify pgrst, 'reload schema';
