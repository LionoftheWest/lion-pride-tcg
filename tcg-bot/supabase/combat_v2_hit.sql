-- combat_v2_hit.sql (2026-10-19): combat v2, phase 2, PR E4: the hit core (docs/combat-redesign-plan.md sections 2.2, 4, 6, 8 and 14).
-- Needs combat_v2_stats.sql (E3) first, and so E2 (combat_v2_numbers), E1 (the status keys of the fight state v = 2) and V1 (the balance keys
-- v2_hit, v2_stats, v2_status, v2_roles, v2_enemy, v2_support).
-- Before: v2 has the stat line of a card (E3) and the clock (E2), but no rule turns an attack into damage.
-- After this file (the reference is the simulator card-studio/v2sim, engine.mjs Battle.cardHit, Battle.enemyHit and Battle.damage; formulas.mjs
-- F.afterDefense, F.critChance, F.missChance, F.dodgeChance):
--   combat_v2_hit(attacker, target, ctx, numbers): ONE hit of one unit on one unit. It writes nothing and reads no table: the answer says what the
--     hit did, and the caller applies it (E5 and E6 build the actions on it). Not in any v1 path.
--     attacker and target are units of a fight state v = 2 with their stat line (the numbers of card_combat_v2 stats, as rates, not points):
--       a card:   role (a key of v2_roles), class (attacker or support, as card_combat_v2 gives it), atk (the CP of its hits), crt, crd, abl, acc, def, ddg, hp, max, down, status{}
--       an enemy: atk (its ATK), def, evasion, keen, mechanics (a list of keys of v2_enemy.mechanics), hp, max, down, status{}
--       A missing rate is 0 (crd: v2_stats.crd.base, abl: 1). A status counts while its until is not below ctx.clock (no until or no clock: it counts),
--       the same rule as combat_v2_speed (E2).
--     ctx: side ('card' = a card hits an enemy, 'enemy' = an enemy hits a card; required), clock, mode (hunt: the enemy is the Hunt boss), x (the
--       multiplier of the hit, default 1), basic (true: the basic attack, so x = v2_support.basic_x for a support, v2_roles.artillery.basic_x and the
--       Artillery true strike), area (an area hit: Dodge x v2_stats.ddg.area_x), true_strike, pierce, shield_x, crit_add, crit_bonus, bonus, vs_x (the
--       ability blocks of E6), warden (true: a standing Warden other than the target is in the squad of the target card), foes_alive (the standing
--       enemies: the Cleaver Hunt bonus counts at 1), draws (the random numbers, see below).
--     A CARD HIT (side card), in this order:
--       1. miss: no roll when the hit is a true strike or the target is Marked. Else miss = max(0, v2_hit.miss + target evasion + v2_status.blinded.miss
--          (the attacker is Blinded) - attacker acc). A draw below miss = a miss: the hit ends, nothing else is drawn.
--       2. the roll: x x (v2_hit.roll_min + draw x v2_hit.roll_span).
--       3. crit: no draw when the target has Ironhide and is not Marked. Else chance = min(v2_stats.crt.cap + Focused, crt + crit_add + crit_bonus +
--          Focused + the Striker crit_add x abl); a draw below it = a crit, x (crd + the Striker critx_add x abl).
--       4. x (1 + Empowered x (v2_enemy.mechanics.dispeller.x vs a Dispeller)) x (1 - Weakened) x (1 - v2_status.chill.dmg x Chill stacks)
--          x (1 + target Exposed) x (1 + target Mark) x (1 + bonus + the Finisher bonus x abl below the HP line + the Cleaver hunt_bonus x abl when one
--          foe stands) x vs_x.  raw = atk x that.
--       5. Pierce = max(ctx pierce, the Breaker pierce); shield_x = max(ctx shield_x, the Breaker shield_x).
--     AN ENEMY HIT (side enemy), in this order:
--       1. Blinded: only when the attacker is Blinded: a draw below v2_status.blinded.miss = a miss.
--       2. Dodge: no roll vs the mechanic true_strike (or ctx true_strike). dodge = max(0, ddg x (1 - attacker keen) x (area: v2_stats.ddg.area_x));
--          only when dodge is above 0: a draw below it = dodged.
--       3. the roll: raw = atk x x x (roll_min + draw x roll_span) x Enraged x (the Hunt boss below v2_enemy.boss_moves.rage_at: rage_x)
--          x (1 - Weakened) x (1 - chill.dmg x Chill stacks) x (1 + target Exposed). No crit.
--       4. Pierce = v2_enemy.mechanics.sunder.pierce for Sunder; shield_x = v2_enemy.mechanics.shatter.shield_x for Shatter.
--     THE DAMAGE (both sides): after Defense = raw x (1 - def x (1 - min(1, pierce))); a card target with ctx warden x (1 - v2_roles.warden.ally_dr);
--       at least v2_hit.min_dmg. The shield (status shielded of a card, guarded of an enemy) absorbs first: absorbed = min(damage, shield / shield_x),
--       the shield loses absorbed x shield_x. The rest is HP loss (at most the HP). dmg = absorbed + HP loss. A Survivor heals
--       min(lifesteal x abl x dmg, cap_maxhp x abl x max) (the heal rules, Burn and max HP, are the caller's).
--     A target that is down: no draw and no damage.
--     Answer: {side, hit, miss, dodged, crit, true_strike, marked, chance (miss or dodge), crit_chance, roll, raw, pierce, shield_x, dmg, absorbed,
--       shield_after, hp_loss, hp_after, down, heal, draws}. marked = the hit used a Mark (the caller ends the Mark after the attack, and Empowered).
--     RANDOM DRAWS (plan 6.2: the slots in a fixed order, so goldens with setseed stay stable): a card hit draws [miss], roll, [crit]; an enemy hit
--       [Blinded], [dodge], roll (a slot in brackets only when its rule above draws). With ctx.draws (a list of numbers from 0 to below 1) the hit takes
--       its draws from the list in that order (a missing slot raises); without it, random(). draws in the answer = the numbers used, in order (a replay
--       with them gives the same hit). A rider, the Flurry second strike and every other draw of the action come AFTER the hit (the caller draws them).
--   combat_v2_hit(attacker, target, ctx): the same with the numbers of balance (one read).
--   combat_v2_status_on(unit, key, clock): the status object while it counts at that clock, else NULL. PURE.
--   combat_v2_draw(draws, slot): the draw of one slot (draws NULL: random()). VOLATILE.
--   Not in this file (later PRs): Steadfast and the other new enemy passives (E7), Sleep waking on damage and the heal rules (E5), Confused targets,
--   Flurry, Cleaver splash, riders and the support blocks (E6). The Focused crit damage of the simulator focus block (st.focused.crd) is not a key
--   of the v2 status shape (stacks, value, until): E6 decides it with the block library.
-- NO CHANGE IN PLAY: no v1 function calls these functions and no v1 function changes (the test compares the md5 of every other function).
-- No new balance key or leaf: every number of the hit is a leaf of V1 (v2_hit, v2_stats, v2_status, v2_roles, v2_enemy, v2_support).
-- Every number is in balance (CI check C1: only 0 and 1 in the bodies; ^combat_ is in the C1 scope). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-hit.mjs (rolled back; SQL = the simulator on a grid with the same draws; MUTATE=all must catch every mutation).

-- ============================================================ 1. helpers: a status that counts, one random draw
create or replace function public.combat_v2_status_on(p_unit jsonb, p_key text, p_clock int) returns jsonb language sql immutable set search_path = public as $fn$
  select case when s is not null and jsonb_typeof(s) = 'object' and coalesce((s->>'until')::int >= p_clock, true) then s end
    from (select p_unit->'status'->p_key as s) x;
$fn$;

create or replace function public.combat_v2_draw(p_draws jsonb, p_slot int) returns numeric language plpgsql volatile set search_path = public as $fn$
declare d numeric;
begin
  if p_draws is null then return random()::numeric; end if;
  if p_slot >= jsonb_array_length(p_draws) then
    raise exception 'combat_v2_hit: the draw slot % is missing (% draws given)', p_slot + 1, jsonb_array_length(p_draws);
  end if;
  if jsonb_typeof(p_draws->p_slot) is distinct from 'number' then raise exception 'combat_v2_hit: draw % must be a number', p_slot + 1; end if;
  d := (p_draws->>p_slot)::numeric;
  if d < 0 or d >= 1 then raise exception 'combat_v2_hit: draw % must be from 0 to below 1 (%)', p_slot + 1, d; end if;
  return d;
end $fn$;

-- ============================================================ 2. the hit core
create or replace function public.combat_v2_hit(p_att jsonb, p_tgt jsonb, p_ctx jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  h jsonb := p_b->'v2_hit'; st jsonb := p_b->'v2_stats'; ss jsonb := p_b->'v2_status'; ro jsonb := p_b->'v2_roles';
  me jsonb := p_b->'v2_enemy'->'mechanics'; bm jsonb := p_b->'v2_enemy'->'boss_moves';
  ctx jsonb := coalesce(p_ctx, '{}'::jsonb);
  side text := ctx->>'side'; clk int; draws jsonb := ctx->'draws'; used jsonb := '[]'::jsonb; d numeric;
  role text := p_att->>'role'; rn jsonb; tmech jsonb := coalesce(p_tgt->'mechanics', '[]'::jsonb); amech jsonb := coalesce(p_att->'mechanics', '[]'::jsonb);
  ab numeric; x numeric; mult numeric; roll numeric; chance numeric := 0; critc numeric := 0; foc numeric := 0; bonus numeric;
  ts boolean; marked boolean := false; can_crit boolean; crit boolean := false; s jsonb; k text;
  raw numeric := 0; pierce numeric := 0; sx numeric := 1; a numeric; shield numeric; absorbed numeric := 0; hp_loss numeric := 0;
  thp numeric; tmax numeric; heal numeric := 0; shield_key text;
begin
  if h is null or st is null or ss is null or ro is null or me is null or bm is null or p_b->'v2_support' is null then
    raise exception 'combat_v2_hit: no balance value for v2_hit, v2_stats, v2_status, v2_roles, v2_enemy or v2_support';
  end if;
  if side is null or side not in ('card', 'enemy') then raise exception 'combat_v2_hit: ctx.side must be card (a card hits an enemy) or enemy (%)', side; end if;
  if jsonb_typeof(p_att) is distinct from 'object' or jsonb_typeof(p_tgt) is distinct from 'object' then raise exception 'combat_v2_hit: the attacker and the target must be units'; end if;
  if jsonb_typeof(p_att->'atk') is distinct from 'number' or (p_att->>'atk')::numeric < 0 then raise exception 'combat_v2_hit: the attacker needs atk (a number of 0 or more)'; end if;
  if jsonb_typeof(p_tgt->'hp') is distinct from 'number' or jsonb_typeof(p_tgt->'max') is distinct from 'number' or (p_tgt->>'max')::numeric <= 0 then
    raise exception 'combat_v2_hit: the target needs hp and max (max above 0)';
  end if;
  if draws is not null and jsonb_typeof(draws) <> 'array' then raise exception 'combat_v2_hit: ctx.draws must be a list of numbers'; end if;
  if ctx ? 'clock' then clk := (ctx->>'clock')::int; end if;
  if side = 'card' then
    rn := ro->role;
    if rn is null or role like '\_%' then raise exception 'combat_v2_hit: the attacking card needs a role of v2_roles (%)', role; end if;
    if coalesce(p_att->>'class', '') not in ('attacker', 'support') then
      raise exception 'combat_v2_hit: the attacking card needs its class, attacker or support (card_combat_v2 class; %)', p_att->>'class';
    end if;
  end if;
  for k in select jsonb_array_elements_text(tmech) union all select jsonb_array_elements_text(amech) loop
    if not me ? k then raise exception 'combat_v2_hit: % is not a mechanic of v2_enemy.mechanics', k; end if;
  end loop;
  thp := (p_tgt->>'hp')::numeric; tmax := (p_tgt->>'max')::numeric;
  shield_key := case when side = 'card' then 'guarded' else 'shielded' end;
  -- a target that is down takes nothing and costs no draw
  if coalesce((p_tgt->>'down')::boolean, false) or thp <= 0 then
    return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', false, 'crit', false, 'true_strike', false, 'marked', false,
      'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', greatest(thp, 0), 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
      'down', true, 'heal', 0, 'draws', used);
  end if;

  if side = 'card' then
    -- ---------------------------------------------------------------- a card hits an enemy (simulator Battle.cardHit)
    ab := coalesce((p_att->>'abl')::numeric, 1);
    x := coalesce((ctx->>'x')::numeric,
                  case when coalesce((ctx->>'basic')::boolean, false) then
                    case when role = 'artillery' then (ro->'artillery'->>'basic_x')::numeric
                         when p_att->>'class' = 'support' then (p_b->'v2_support'->>'basic_x')::numeric end end, 1);
    ts := coalesce((ctx->>'true_strike')::boolean, false)
          or (coalesce((ctx->>'basic')::boolean, false) and role = 'artillery' and coalesce((ro->'artillery'->>'true_strike')::boolean, false));
    s := combat_v2_status_on(p_tgt, 'mark', clk); marked := s is not null;
    -- 1. miss
    if not ts and not marked then
      chance := greatest(0, (h->>'miss')::numeric + coalesce((p_tgt->>'evasion')::numeric, 0)
                + case when combat_v2_status_on(p_att, 'blinded', clk) is not null then (ss->'blinded'->>'miss')::numeric else 0 end
                - coalesce((p_att->>'acc')::numeric, 0));
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'draws', used);
      end if;
    end if;
    -- 2. the roll
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    -- 3. crit (Ironhide: no crit unless Marked)
    can_crit := not (tmech ? 'ironhide' and not marked);
    foc := coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'value')::numeric, 0);
    critc := coalesce((p_att->>'crt')::numeric, 0) + coalesce((ctx->>'crit_add')::numeric, 0) + coalesce((ctx->>'crit_bonus')::numeric, 0) + foc
             + case when role = 'striker' then (ro->'striker'->>'crit_add')::numeric * ab else 0 end;
    critc := least((st->'crt'->>'cap')::numeric + foc, critc);
    if can_crit then
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      crit := d < critc;
    end if;
    if crit then
      mult := mult * (coalesce((p_att->>'crd')::numeric, (st->'crd'->>'base')::numeric) + case when role = 'striker' then (ro->'striker'->>'critx_add')::numeric * ab else 0 end);
    end if;
    -- 4. the multipliers
    s := combat_v2_status_on(p_att, 'empowered', clk);
    if s is not null then mult := mult * (1 + (s->>'value')::numeric * case when tmech ? 'dispeller' then (me->'dispeller'->>'x')::numeric else 1 end); end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    if marked then mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'mark', clk)->>'value')::numeric, 0)); end if;
    bonus := coalesce((ctx->>'bonus')::numeric, 0);
    if role = 'finisher' and thp / tmax < (ro->'finisher'->>'line')::numeric then bonus := bonus + (ro->'finisher'->>'bonus')::numeric * ab; end if;
    if role = 'cleaver' and (ctx->>'foes_alive')::int = 1 then bonus := bonus + (ro->'cleaver'->>'hunt_bonus')::numeric * ab; end if;
    mult := mult * (1 + bonus);
    if coalesce((ctx->>'vs_x')::numeric, 0) <> 0 then mult := mult * (ctx->>'vs_x')::numeric; end if;
    -- 5. Pierce and shield break (the Breaker passive)
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when role = 'breaker' then (ro->'breaker'->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when role = 'breaker' then (ro->'breaker'->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  else
    -- ---------------------------------------------------------------- an enemy hits a card (simulator Battle.enemyHit)
    x := coalesce((ctx->>'x')::numeric, 1);
    ts := coalesce((ctx->>'true_strike')::boolean, false) or amech ? 'true_strike';
    -- 1. Blinded
    if combat_v2_status_on(p_att, 'blinded', clk) is not null then
      chance := (ss->'blinded'->>'miss')::numeric;
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'draws', used);
      end if;
    end if;
    -- 2. Dodge (single hits; area hits x area_x)
    if not ts then
      chance := greatest(0, coalesce((p_tgt->>'ddg')::numeric, 0) * (1 - coalesce((p_att->>'keen')::numeric, 0))
                * case when coalesce((ctx->>'area')::boolean, false) then (st->'ddg'->>'area_x')::numeric else 1 end);
      if chance > 0 then
        d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
        if d < chance then
          return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', true, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
            'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
            'down', false, 'heal', 0, 'draws', used);
        end if;
      end if;
    end if;
    -- 3. the roll and the enemy multipliers
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    s := combat_v2_status_on(p_att, 'enraged', clk);
    if s is not null then mult := mult * (s->>'value')::numeric; end if;
    if ctx->>'mode' = 'hunt' and coalesce((p_att->>'hp')::numeric / nullif((p_att->>'max')::numeric, 0) < (bm->>'rage_at')::numeric, false) then
      mult := mult * (bm->>'rage_x')::numeric;
    end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    -- 4. Sunder and Shatter
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when amech ? 'sunder' then (me->'sunder'->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when amech ? 'shatter' then (me->'shatter'->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  end if;

  -- ---------------------------------------------------------------- the damage (simulator Battle.damage)
  shield := coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0);
  if raw > 0 then
    a := raw * (1 - coalesce((p_tgt->>'def')::numeric, 0) * (1 - least(1, pierce)));
    if side = 'enemy' and coalesce((ctx->>'warden')::boolean, false) then a := a * (1 - (ro->'warden'->>'ally_dr')::numeric); end if;
    a := greatest((h->>'min_dmg')::numeric, a);
    if shield > 0 then
      absorbed := least(a, shield / sx);
      shield := greatest(0, shield - absorbed * sx);
      a := a - absorbed;
    end if;
    hp_loss := least(thp, a);
  end if;
  if side = 'card' and role = 'survivor' and absorbed + hp_loss > 0 then
    heal := least((ro->'survivor'->>'lifesteal')::numeric * ab * (absorbed + hp_loss),
                  (ro->'survivor'->>'cap_maxhp')::numeric * ab * coalesce((p_att->>'max')::numeric, 0));
  end if;
  return jsonb_build_object('side', side, 'hit', true, 'miss', false, 'dodged', false, 'crit', crit, 'true_strike', ts, 'marked', marked,
    'chance', chance, 'crit_chance', case when side = 'card' and can_crit then critc else 0 end, 'roll', roll, 'raw', raw, 'pierce', pierce, 'shield_x', sx,
    'dmg', absorbed + hp_loss, 'absorbed', absorbed, 'shield_after', shield, 'hp_loss', hp_loss, 'hp_after', greatest(0, thp - hp_loss),
    'down', thp - hp_loss <= 0, 'heal', heal, 'draws', used);
end $fn$;

create or replace function public.combat_v2_hit(p_att jsonb, p_tgt jsonb, p_ctx jsonb) returns jsonb language sql volatile set search_path = public as $fn$
  select combat_v2_hit(p_att, p_tgt, p_ctx, combat_v2_numbers(array['v2_hit', 'v2_stats', 'v2_status', 'v2_roles', 'v2_enemy', 'v2_support']));
$fn$;

-- ============================================================ 3. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['combat_v2_status_on(jsonb, text, integer)', 'combat_v2_draw(jsonb, integer)', 'combat_v2_hit(jsonb, jsonb, jsonb, jsonb)',
                           'combat_v2_hit(jsonb, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.combat_v2_status_on(jsonb, text, integer) is $cm$[combat] Combat v2: the status object of a fight-state unit (status{}.key) while it counts at the clock (no until, no clock, or until not below the clock), else NULL. The rule of combat_v2_speed. PURE. combat_v2_hit.sql.$cm$;
comment on function public.combat_v2_draw(jsonb, integer) is $cm$[combat] Combat v2: the random number of one draw slot of a hit: the slot of the list p_draws (numbers from 0 to below 1; a missing slot raises), or random() when p_draws is NULL. VOLATILE. combat_v2_hit.sql.$cm$;
comment on function public.combat_v2_hit(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 hit core (plan 2.2, 4, 6): one hit of a card on an enemy (ctx.side card: miss = base + evasion + Blinded - acc unless true strike or Marked; roll; crit min(cap + Focused, crt + adds + Striker) unless Ironhide and not Marked, x crd; Empowered (Dispeller), Weakened, Chill, Exposed, Mark, Finisher, Cleaver, vs_x; Breaker pierce and shield break) or of an enemy on a card (ctx.side enemy: Blinded; Dodge ddg x (1 - keen), area x area_x, not vs true_strike; roll; Enraged, boss rage, Weakened, Chill, Exposed; Sunder, Shatter). Damage = raw x (1 - def x (1 - pierce)), Warden ally_dr, min_dmg, then the shield (shielded / guarded) absorbs first. Draw slots in a fixed order (card: [miss], roll, [crit]; enemy: [Blinded], [dodge], roll) from ctx.draws or random(); riders draw after. Answer {hit, miss, dodged, crit, dmg, absorbed, shield_after, hp_loss, hp_after, down, heal, draws, ...}. Writes nothing; numbers from p_b. No v1 function calls it.$cm$;
comment on function public.combat_v2_hit(jsonb, jsonb, jsonb) is $cm$[combat] combat_v2_hit(attacker, target, ctx, numbers) with the numbers of balance v2_hit, v2_stats, v2_status, v2_roles, v2_enemy and v2_support. combat_v2_hit.sql.$cm$;

notify pgrst, 'reload schema';
