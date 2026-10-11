-- dungeon_auto_rounds.sql (2026-10-11). Auto mode on the server: up to N rounds of the Dungeon / Gauntlet fight in ONE call.
-- Why: with Auto on, the client sent one request for every action (about 19 attacks a minute, each one a database transaction and
-- a round trip) and animated the answer. The rules do not change: every action here is a CALL of dungeon_attack or dungeon_support
-- (and through dungeon_attack, dungeon_enemy_turn): this file copies no rule, no roll, no number. It only chooses the action,
-- with the same choice the client made (src/ui-v2-dungeon.js autoStep), and loops.
--
-- dungeon_auto_attackers(run, squad, foe, round)   the attackers that stand, with ready / weakness / CP / HP share (a helper, pure)
-- dungeon_auto_action(run, squad, tried, kind)     the choice. Pure (stable): reads the run state and the squad cards, writes nothing.
--   target = the living monster closest to falling (the lowest HP; the first of equals)
--   attack = a READY attacker (not stunned) that hits a weakness of the target first, then the highest CP, then the squad order;
--            when no attacker is ready there is no attack (D-182: a stunned card never attacks)
--   support (at most one a round, only when sup_round is not the round) = the first support card in squad order that stands, is
--            ready, is not in `tried` and has something useful to do:
--              heal    -> the attacker under 50% HP that is the lowest      shield -> the attacker under 60% HP that is the lowest
--              empower -> the attacker that attacks this round              cleanse -> only when a card is cursed or poisoned
--              stun    -> only when the target is not stunned already       any other effect -> the target
-- dungeon_auto_rounds(player, mode, max)           the loop: a support (when useful), then an attack, per round, up to `max` rounds (1 to 10).
--   It stops at: a kill (the loot, the next monster or the reward step belong to the member), a step that is not a fight any more
--   (reward, floor, cleared), a run that is over (the squad fell, the round cap), an action the rules refuse, or `max`.
--   A round with no possible attack (every standing attacker is stunned, D-182) is a PASS: dungeon_pass_turn runs the monsters' turn, the entry is {sup?, pass}.
--   The answer: ok, rounds [{sup, atk | pass}] (each one = the answer of dungeon_support / dungeon_attack plus the card and the target),
--   stopped (kill | phase | over | max | error | none), error, played, state, status. The client animates the rounds in order.
--   A support that the rules refuse (cooldown, one support a turn ...) is skipped; a refused attack ends the call with the reason.
--   When nothing was played, the answer is the refusal itself ({ok: false, error}), as the single call would give it.
-- Same rows as the single calls (dungeon_log, combat_actions): each action goes through the same function.
-- Needs dungeon_stun_pass.sql (dungeon_pass_turn). New functions only: no live function is replaced, so no live-text guard is needed. Test: card-studio/scripts/test-dungeon-auto-rounds.mjs.

create or replace function public.dungeon_auto_attackers(p_run dungeon_runs, p_squad jsonb, p_foe jsonb, p_round int)
 returns table(id bigint, ord int, ready boolean, weak boolean, cp int, hp numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  select x.id, x.ord::int,
    coalesce((p_run.state->'cards'->(x.id::text)->>'cd')::int, 0) < p_round + 1,
    exists (select 1 from jsonb_array_elements(coalesce(p_foe->'weak', '[]'::jsonb)) w
            where coalesce(p_squad->(x.id::text)->'tags', '[]'::jsonb) @> to_jsonb(w->>'value')),
    coalesce((p_squad->(x.id::text)->'cmb'->>'cp')::int, 0),
    coalesce((p_run.state->'cards'->(x.id::text)->>'hp')::numeric, 0) / greatest(1, coalesce((p_run.state->'cards'->(x.id::text)->>'max')::numeric, 1))
  from unnest(p_run.squad) with ordinality x(id, ord)
  where p_squad->(x.id::text)->>'type' in ('Character', 'Creature')
    and not coalesce((p_run.state->'cards'->(x.id::text)->>'down')::boolean, false);
$function$;

create or replace function public.dungeon_auto_action(p_run dungeon_runs, p_squad jsonb, p_tried bigint[], p_kind text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare st jsonb := p_run.state; v_round int := coalesce((p_run.state->>'round')::int, 0); v_tf int; v_foe jsonb; v_best bigint; v_who bigint; r record; ab jsonb; tg text; eff text;
begin
  -- the target: the living monster closest to falling
  select (e.ord - 1)::int, e.f into v_tf, v_foe from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (e.f->>'hp')::int, e.ord limit 1;
  if v_tf is null then return null; end if;
  -- the attacker: only a card that is NOT stunned (D-182: a stunned card never attacks); a weakness hit first, then the CP, then the squad order
  select a.id into v_best from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.ready order by a.weak desc, a.cp desc, a.ord limit 1;
  if p_kind = 'attack' then
    if v_best is null then return null; end if;   -- every attacker is stunned: no attack (the loop passes the turn)
    return jsonb_build_object('kind', 'attack', 'card', v_best, 'target', v_tf);
  end if;
  -- the support: the first card in squad order that stands, is ready and has something useful to do
  for r in select x.id from unnest(p_run.squad) with ordinality x(id, ord)
      where coalesce(p_squad->(x.id::text)->>'type', '') not in ('Character', 'Creature')
        and not coalesce((st->'cards'->(x.id::text)->>'down')::boolean, false)
        and v_round >= coalesce((st->'cards'->(x.id::text)->>'cd')::int, 0)
        and p_squad->(x.id::text)->'ability'->>'kind' = 'support'
        and not (x.id = any(coalesce(p_tried, '{}'::bigint[])))
      order by x.ord loop
    ab := p_squad->(r.id::text)->'ability'; tg := coalesce(ab->>'target', 'boss'); eff := ab->>'effect';
    if tg in ('ally', 'self') then
      v_who := case eff
        when 'heal' then (select a.id from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.hp < 0.5 order by a.hp, a.ord limit 1)
        when 'shield' then (select a.id from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.hp < 0.6 order by a.hp, a.ord limit 1)
        when 'empower' then v_best end;
      if v_who is not null then return jsonb_build_object('kind', 'support', 'card', r.id, 'target_card', v_who); end if;
    elsif eff = 'cleanse' then
      if exists (select 1 from jsonb_each(st->'cards') c
                 where coalesce(nullif((c.value->>'debuff')::numeric, 0), 1) < 1 or coalesce((c.value->>'psnu')::int, -1) >= v_round + 1) then
        return jsonb_build_object('kind', 'support', 'card', r.id); end if;
    elsif eff = 'stun' then
      if coalesce((v_foe->>'st')::int, 0) < v_round then return jsonb_build_object('kind', 'support', 'card', r.id, 'target_foe', v_tf); end if;
    else
      return jsonb_build_object('kind', 'support', 'card', r.id, 'target_foe', v_tf);
    end if;
  end loop;
  return null;
end $function$;

create or replace function public.dungeon_auto_rounds(p_player text, p_mode text default 'daily', p_max int default 5)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare r dungeon_runs; v_mode text := coalesce(p_mode, 'daily'); v_max int := greatest(1, least(coalesce(p_max, 5), 10)); v_squad jsonb; v_rounds jsonb := '[]'::jsonb;
  v_n int := 0; v_stop text := 'max'; v_err jsonb := null; v_act jsonb; v_res jsonb; v_tried bigint[]; v_entry jsonb; v_try int;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- The run row is locked for the whole call (dungeon_attack and dungeon_support lock it again: the same transaction).
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = v_mode for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  select coalesce(jsonb_object_agg(x::text, dungeon_run_card(r, x)), '{}'::jsonb) into v_squad from unnest(r.squad) x;   -- the squad cards do not change in a fight
  while v_n < v_max loop
    select * into r from dungeon_runs where id = r.id;
    if r.status <> 'active' then v_stop := 'over'; exit; end if;
    if r.state->>'phase' <> 'fight' then v_stop := 'phase'; exit; end if;
    v_entry := '{}'::jsonb;
    -- the support of this round (one a round)
    if coalesce((r.state->>'sup_round')::int, -1) <> coalesce((r.state->>'round')::int, 0) then
      v_tried := '{}'::bigint[];
      for v_try in 1..greatest(1, coalesce(array_length(r.squad, 1), 5)) loop   -- one try for each squad card at most (a refused card is in v_tried and is not chosen again)
        v_act := dungeon_auto_action(r, v_squad, v_tried, 'support');
        exit when v_act is null;
        v_res := dungeon_support(p_player, (v_act->>'card')::bigint, (v_act->>'target_card')::bigint, (v_act->>'target_foe')::int, v_mode);
        if coalesce((v_res->>'ok')::boolean, false) then
          v_entry := jsonb_build_object('sup', v_res || jsonb_build_object('card', (v_act->>'card')::bigint, 'target_card', v_act->'target_card', 'target_foe', v_act->'target_foe'));
          exit;
        end if;
        v_tried := v_tried || (v_act->>'card')::bigint;   -- refused by the rules: not again this round
      end loop;
      if v_entry->'sup' is not null then
        select * into r from dungeon_runs where id = r.id;
        if r.status <> 'active' or r.state->>'phase' <> 'fight' then   -- the support ended the fight (a smite on the last monster)
          v_rounds := v_rounds || jsonb_build_array(v_entry); v_stop := case when r.status <> 'active' then 'over' else 'phase' end; exit;
        end if;
      end if;
    end if;
    -- the attack
    v_act := dungeon_auto_action(r, v_squad, null, 'attack');
    if v_act is null then
      -- No attack is possible (every standing attacker is stunned): the turn passes (D-182), the monsters act once. force: a ready support with nothing useful to do is not played.
      v_res := dungeon_pass_turn(p_player, v_mode, true);
      if not coalesce((v_res->>'ok')::boolean, false) then
        if v_entry->'sup' is not null then v_rounds := v_rounds || jsonb_build_array(v_entry); end if;
        v_err := v_res; v_stop := 'error'; exit;
      end if;
      v_rounds := v_rounds || jsonb_build_array(v_entry || jsonb_build_object('pass', v_res));
      v_n := v_n + 1;
      if v_res->>'status' <> 'active' then v_stop := 'over'; exit; end if;
      continue;
    end if;
    v_res := dungeon_attack(p_player, (v_act->>'card')::bigint, (v_act->>'target')::int, v_mode);
    if not coalesce((v_res->>'ok')::boolean, false) then
      if v_entry->'sup' is not null then v_rounds := v_rounds || jsonb_build_array(v_entry); end if;
      v_err := v_res; v_stop := 'error'; exit;
    end if;
    v_rounds := v_rounds || jsonb_build_array(v_entry || jsonb_build_object('atk', v_res || jsonb_build_object('card', (v_act->>'card')::bigint)));
    v_n := v_n + 1;
    if coalesce((v_res->>'kill')::boolean, false) then v_stop := 'kill'; exit; end if;
    if v_res->>'status' <> 'active' then v_stop := 'over'; exit; end if;   -- (a step that is not a fight stops the loop at its top: stopped phase)
  end loop;
  if jsonb_array_length(v_rounds) = 0 then
    if v_err is not null then return v_err; end if;   -- the refusal of the first action, as a single call gives it
    if v_stop = 'none' then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;
  end if;
  select * into r from dungeon_runs where id = r.id;
  return jsonb_build_object('ok', true, 'rounds', v_rounds, 'played', v_n, 'stopped', v_stop, 'error', v_err,
    'state', r.state, 'status', r.status);
end $function$;

grant execute on function public.dungeon_auto_attackers(dungeon_runs, jsonb, jsonb, integer) to postgres, service_role;
grant execute on function public.dungeon_auto_action(dungeon_runs, jsonb, bigint[], text) to postgres, service_role;
grant execute on function public.dungeon_auto_rounds(text, text, integer) to postgres, service_role;

comment on function public.dungeon_auto_attackers(dungeon_runs, jsonb, jsonb, integer) is $c$Internal helper of Auto: the attackers of a run that stand, in squad order, with ready (cooldown over), weak (hits a weakness of the foe), cp and the HP share.$c$;
comment on function public.dungeon_auto_action(dungeon_runs, jsonb, bigint[], text) is $c$Internal helper of Auto: the next action a member would tap: the best attack (a ready attacker that hits a weakness first, then the highest CP) on the monster closest to falling, or the first useful support. Pure: it writes nothing.$c$;
comment on function public.dungeon_auto_rounds(text, text, integer) is $c$POST /api/dungeon/auto: plays up to p_max Auto rounds (a useful support, then the best attack) in one call, by calling dungeon_support and dungeon_attack, so every rule is the one of a single tap. Stops at a kill, a step that is not a fight, a finished run, a refused attack or the maximum. Returns each round's answers and the final state.$c$;
notify pgrst, 'reload schema';
