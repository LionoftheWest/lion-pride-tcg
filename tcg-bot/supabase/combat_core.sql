-- The shared combat core (Nathan, 2026-10-03: "the same combat systems for Hunt, Dungeon Run, and
-- Arena ... really lock down across the whole underlying system").
--
-- Every combat RULE lives here, in small functions that take plain values and return plain values. A mode
-- (the Hunt today; the Dungeon and the Arena next) keeps only its own storage: where the HP, the shields,
-- the cooldowns and the squad live. hunt_attack and hunt_support below are the live definitions (2026-10-03)
-- rebuilt on these functions, with NO change in behavior:
-- - the same formulas, the same numeric types, the same order of every random() call;
-- - card-studio/scripts/combat-golden.mjs plays 84 seeded fights (every boss action, passive, support,
--   crit / miss / block, burn, double strike, phases, defeat, cooldowns, stun immunity) through the live
--   code and through this file, and fails on the first difference.
-- A rule change here changes the Hunt, the Dungeon and the Arena together. Idempotent.

-- ---- The attack ---------------------------------------------------------------------------------------

-- Weakness and resistance: matches by type, rarity, season or tag; p_stack = the squad cards that share a
-- weak tag (the soft cap: the bonus halves for each card after 3). The multiplier stays in 0.25 .. 2.5.
create or replace function public.combat_weak(p_weak jsonb, p_resist jsonb, p_type text, p_rarity text, p_season text,
                                              p_tags text[], p_stack int)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_wm int; v_rm int; v_wmult numeric;
begin
  select count(*) into v_wm from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'season' and w->>'value' = p_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  select count(*) into v_rm from jsonb_array_elements(coalesce(p_resist, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'season' and w->>'value' = p_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  v_wmult := 1
    + (1 - power(0.5, v_wm)) * (case when p_stack <= 3 then 1 else power(0.5, p_stack - 3) end)
    - 0.8 * (1 - power(0.5, v_rm));
  v_wmult := greatest(0.25, least(2.5, v_wmult));
  return jsonb_build_object('wm', v_wm, 'rm', v_rm, 'mult', v_wmult);
end $$;

-- The squad counts for one attacker. p_others = the tag lists of the OTHER cards in the fight (one
-- entry per card); p_self_in = the attacker is already in the fight. Returns the weak-tag stack, the
-- element / origin / trait synergies and their multiplier (capped at 1.6).
create or replace function public.combat_squad(p_tags text[], p_self_in boolean, p_others jsonb, p_weak jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_wtags text[]; v_stack int := 0; v_elem text; v_syn int; v_synmult numeric := 1;
  v_origin text; v_osyn int; v_omult numeric := 1; v_ksyn int; v_kmult numeric := 1;
  v_o jsonb := coalesce(p_others, '[]'::jsonb);
begin
  select array_agg(w->>'value') into v_wtags
    from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w where w->>'kind' = 'tag';
  if v_wtags is not null and array_length(v_wtags, 1) > 0 then
    select count(*) into v_stack from jsonb_array_elements(v_o) o
      where array(select jsonb_array_elements_text(o)) && v_wtags;
    if p_self_in and p_tags && v_wtags then v_stack := v_stack + 1; end if;
  end if;
  -- Element synergy: this card's dominant element + how many other cards share it.
  v_elem := (select e from unnest(array['fire','water','lightning','ice','nature','earth','air',
                                        'shadow','light','arcane','psychic','toxic','metal']) e
             where ('trait:' || e) = any(p_tags) limit 1);
  if v_elem is not null then
    select count(*) into v_syn from jsonb_array_elements(v_o) o where o ? ('trait:' || v_elem);
    v_syn := coalesce(v_syn, 0) + 1;   -- include this card
    if v_syn >= 5 then v_synmult := 1.20; elsif v_syn >= 3 then v_synmult := 1.12; end if;
  else
    v_syn := 0;
  end if;
  -- Origin (game) synergy.
  v_origin := (select t from unnest(p_tags) t where t like 'origin:%' limit 1);
  if v_origin is not null then
    select count(*) into v_osyn from jsonb_array_elements(v_o) o where o ? v_origin;
    v_osyn := coalesce(v_osyn, 0) + 1;
    if v_osyn >= 5 then v_omult := 1.18; elsif v_osyn >= 3 then v_omult := 1.10; end if;
  end if;
  -- Trait (kind) synergy: the best-shared non-element trait.
  select coalesce(max(cnt), 0) into v_ksyn from (
    select count(*) as cnt from unnest(p_tags) tg cross join jsonb_array_elements(v_o) o
      where tg like 'trait:%' and tg not in ('trait:fire','trait:water','trait:lightning','trait:ice','trait:nature','trait:earth','trait:air','trait:shadow','trait:light','trait:arcane','trait:psychic','trait:toxic','trait:metal')
        and o ? tg
      group by tg) k;
  if v_ksyn > 0 then v_ksyn := v_ksyn + 1; if v_ksyn >= 5 then v_kmult := 1.14; elsif v_ksyn >= 3 then v_kmult := 1.08; end if; end if;
  v_synmult := least(1.6, v_synmult * v_omult * v_kmult);
  return jsonb_build_object('stack', v_stack, 'elem', v_elem, 'syn', v_syn, 'synmult', v_synmult);
end $$;

-- The crit chance: 10% (20% on a weakness), + the Focus ability, + Precision points under the crit cap.
create or replace function public.combat_crit_chance(p_bonus boolean, p_aeff text, p_aamt numeric, p_cmb jsonb)
returns numeric language plpgsql stable set search_path = public as $$
declare v_critchance numeric;
begin
  v_critchance := (case when p_bonus then 0.20 else 0.10 end) + (case when p_aeff = 'focus' then p_aamt else 0 end);
  if (p_cmb->>'on')::boolean then   -- Precision points, under the crit cap
    v_critchance := least(coalesce((stat_cfg()->>'crit_cap')::numeric, 0.6), v_critchance + (p_cmb->>'crit')::numeric);
  end if;
  return v_critchance;
end $$;

-- One attack roll: miss, crit, block, the damage range, the multipliers, Execute and Rampage.
-- p_expose = the active Expose amount (0 when none). The random() calls keep the live order.
create or replace function public.combat_hit(p_cp int, p_wmult numeric, p_buff numeric, p_debuff numeric, p_synmult numeric,
  p_critchance numeric, p_miss numeric, p_aeff text, p_aamt numeric, p_athresh numeric, p_armored_melee boolean,
  p_expose numeric, p_hp bigint, p_hpmax bigint)
returns jsonb language plpgsql volatile set search_path = public as $$
declare v_miss boolean; v_crit boolean; v_block boolean; v_base numeric; v_dmg int; v_outcome text; v_double boolean := false;
begin
  v_miss  := random() < p_miss;
  v_crit  := (not v_miss) and random() < p_critchance;
  v_block := (not v_miss) and (not v_crit) and (p_aeff <> 'pierce' or p_aeff is null) and random() < 0.12;
  if v_miss then
    v_dmg := 0; v_outcome := 'miss';
  else
    v_base := p_cp * p_wmult * (0.85 + random() * 0.30);
    v_base := v_base * p_buff * p_debuff;
    v_base := v_base * p_synmult;                                                     -- squad synergy
    if p_armored_melee then v_base := v_base * 0.72; end if;                          -- an armored enemy
    if p_expose > 0 then v_base := v_base * (1 + p_expose); end if;
    if p_aeff = 'execute' and p_hp < p_athresh * p_hpmax then v_base := v_base * (1 + p_aamt); end if;
    if v_crit  then v_base := v_base * 2;   end if;
    if v_block then v_base := v_base * 0.5; end if;
    v_dmg := greatest(1, round(v_base));
    v_outcome := case when v_crit then 'crit' when v_block then 'blocked' else 'hit' end;
    -- Rampage (an attack ability): amount = the chance of a second strike (no crit / block).
    if p_aeff = 'rampage' and random() < p_aamt then
      v_dmg := v_dmg + greatest(1, round(v_base / (case when v_crit then 2 else 1 end) / (case when v_block then 0.5 else 1 end)));
      v_double := true;
    end if;
  end if;
  return jsonb_build_object('dmg', v_dmg, 'outcome', v_outcome, 'miss', v_miss, 'crit', v_crit, 'block', v_block, 'double', v_double);
end $$;

-- Lifesteal: a share of the damage, capped at 6% of the card's max HP.
create or replace function public.combat_lifesteal(p_dmg int, p_aamt numeric, p_maxhp int)
returns int language sql immutable as $$
  select greatest(1, least(round(p_dmg * p_aamt), round(p_maxhp * 0.06)))::int;
$$;

-- ---- The enemy turn -----------------------------------------------------------------------------------

-- The enemy damage multiplier: Enrage, Weaken (both while active), Volatile, the 50% rage, Frenzied.
create or replace function public.combat_enemy_mult(p_enrage numeric, p_enr_until int, p_weaken numeric, p_wk_until int,
  p_round int, p_volatile boolean, p_lost numeric, p_frenzied boolean)
returns numeric language plpgsql immutable set search_path = public as $$
declare v_bmult numeric := 1;
begin
  if p_enr_until >= p_round and p_enrage > 0 then v_bmult := v_bmult * p_enrage; end if;
  if p_wk_until  >= p_round and p_weaken > 0 then v_bmult := v_bmult * (1 - p_weaken); end if;
  if p_volatile then v_bmult := v_bmult * 1.25; end if;                       -- volatile
  if p_lost >= 0.5 then v_bmult := v_bmult * 1.3; end if;                     -- below 50% HP: rage
  if p_frenzied then v_bmult := v_bmult * (1 + 0.05 * floor(p_lost * 10)); end if;
  return v_bmult;
end $$;

-- The enemy's action (a surprise: drawn now, never shown ahead, except the Cataclysm charge).
-- Returns the action, the damage to the attacking card before shields ('dmg'), the share of ATK that
-- also hits every other card ('area': the caller rolls each card), and the enemy heal ('heal').
create or replace function public.combat_enemy_act(p_atk numeric, p_bmult numeric, p_round int, p_stun_until int,
  p_lost numeric, p_share bigint)
returns jsonb language plpgsql volatile set search_path = public as $$
declare v_act text; v_cdmg int := 0; v_area numeric := 0; v_bheal int := 0; v_r numeric;
begin
  if p_stun_until >= p_round then
    v_act := 'stunned';
  elsif p_round % 8 = 7 then
    v_act := 'charging';                      -- the Cataclysm is shown one round ahead
  elsif p_round % 8 = 0 then
    v_act := 'cataclysm';                     -- ATK x 0.75 to every card still standing
    v_cdmg := greatest(1, round(p_atk * 0.75 * (0.85 + random() * 0.30) * p_bmult)); v_area := 0.75;
  else
    v_r := random();
    if v_r < 0.40 then
      v_act := 'strike';                      -- ATK x 1.0
      v_cdmg := greatest(1, round(p_atk * 1.00 * (0.85 + random() * 0.30) * p_bmult));
    elsif v_r < 0.62 then
      v_act := 'slam';                        -- ATK x 0.35 to every card
      v_cdmg := greatest(1, round(p_atk * 0.35 * (0.85 + random() * 0.30) * p_bmult)); v_area := 0.35;
    elsif v_r < 0.72 then
      v_act := 'drain';                       -- ATK x 0.8, heals 1.5% of a player's share
      v_cdmg := greatest(1, round(p_atk * 0.80 * (0.85 + random() * 0.30) * p_bmult));
      v_bheal := v_bheal + greatest(1, round(p_share * 0.015));
    elsif v_r < 0.80 then
      v_act := 'stun';                        -- ATK x 0.45 and the card waits one round
      v_cdmg := greatest(1, round(p_atk * 0.45 * (0.85 + random() * 0.30) * p_bmult));
    elsif v_r < 0.87 then
      v_act := 'enrage';                      -- x1.4 for 2 rounds (the caller stores it)
    elsif v_r < 0.93 then
      v_act := 'curse';                       -- the attacking card deals x0.7 (the caller stores it)
    else
      v_act := 'regenerate';                  -- 3% of a player's share, 5% below 50% HP
      v_bheal := v_bheal + greatest(1, round(p_share * case when p_lost >= 0.5 then 0.05 else 0.03 end));
    end if;
  end if;
  return jsonb_build_object('action', v_act, 'dmg', v_cdmg, 'area', v_area, 'heal', v_bheal);
end $$;

-- One card's share of an area hit (Slam, Cataclysm): its own damage roll.
create or replace function public.combat_area_roll(p_atk numeric, p_area numeric, p_bmult numeric)
returns int language sql volatile as $$
  select greatest(1, round(p_atk * p_area * (0.85 + random() * 0.30) * p_bmult))::int;
$$;

-- A shield absorbs damage first.
create or replace function public.combat_absorb(p_shield int, p_dmg int)
returns jsonb language plpgsql immutable as $$
declare v_absorb int := least(p_shield, p_dmg);
begin
  return jsonb_build_object('shield', p_shield - v_absorb, 'dmg', p_dmg - v_absorb);
end $$;

-- A Flaming enemy: a 30% chance that the attacking card burns (the damage before shields, 0 = no burn).
create or replace function public.combat_burn(p_atk numeric)
returns int language plpgsql volatile as $$
begin
  if random() < 0.30 then return greatest(1, round(p_atk * 0.40 * (0.85 + random() * 0.30)))::int; end if;
  return 0;
end $$;

-- Thorns: 10% of the damage comes back to the attacking card. Regenerating: 0.5% of a share each turn.
create or replace function public.combat_thorns(p_dmg int) returns int language sql immutable as $$ select greatest(1, round(p_dmg * 0.10))::int; $$;
create or replace function public.combat_regen(p_share bigint) returns int language sql immutable as $$ select greatest(1, round(p_share * 0.005))::int; $$;

-- ---- Supports -----------------------------------------------------------------------------------------

-- The affinity scale (team / enemy effects): +15% for each squad card that shares the affinity, max x2.
create or replace function public.combat_aff_scale(p_count int) returns numeric language sql immutable as $$ select least(2.0, 1 + 0.15 * coalesce(p_count, 0)); $$;

-- The value of a support effect. Ally effects: shield / heal = a share of the TARGET's max HP (max 100%),
-- empower = the damage multiplier. Enemy effects: weaken (max 60%), expose (max 100%), smite (damage).
create or replace function public.combat_support_value(p_eff text, p_amt numeric, p_scale numeric, p_target_maxhp int)
returns numeric language sql immutable as $$
  select case p_eff
    when 'empower' then 1 + p_amt
    when 'shield'  then greatest(1, round(p_target_maxhp * least(p_amt, 1.0)))
    when 'heal'    then greatest(1, round(p_target_maxhp * least(p_amt, 1.0)))
    when 'weaken'  then least(0.6, p_amt * p_scale)
    when 'expose'  then least(1.0, p_amt * p_scale)
    when 'smite'   then greatest(1, round(p_amt * p_scale))
  end;
$$;

-- Stun immunity: after a stun the enemy cannot be stunned again for 2 rounds (at most 1 round in 3).
create or replace function public.combat_stun_immune(p_stun_until int, p_round int) returns boolean language sql immutable as $$
  select coalesce(p_stun_until, 0) > 0 and p_round < p_stun_until + 2;
$$;

-- ---- The Hunt on the core (the live definitions of 2026-10-03, rebuilt; the same behavior) ----------

CREATE OR REPLACE FUNCTION public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int;
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_season text; v_type text; v_mod numeric; v_cardname text;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint; v_hpmax bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
  v_feed text; v_settle jsonb; v_milestone boolean;
  v_total bigint; v_used int; v_topcard text; v_topdmg bigint; v_cap int;
  v_bossact text; v_slam jsonb; v_round int; v_targets jsonb;
  v_ability jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; v_heal int;
  v_buff numeric; v_debuff numeric; v_shield int; v_absorb int; v_critchance numeric;
  v_enrage numeric; v_enr_until int; v_weaken numeric; v_wk_until int; v_expose numeric; v_exp_until int; v_stun_until int;
  v_bmult numeric; v_r numeric;
  v_resist jsonb; v_tags text[]; v_wtags text[]; v_wm int; v_rm int; v_stack int; v_wmult numeric;
  v_plist text[]; v_share bigint; v_bheal int; v_lost numeric; v_phase text; v_extra text; v_stunned_card boolean;
  v_passive jsonb; v_pk text; v_elem text; v_syn int; v_synmult numeric; v_burn int; v_burned boolean;
  v_origin text; v_osyn int; v_omult numeric; v_ksyn int; v_kmult numeric;
  v_stats jsonb; v_atk numeric; v_pts jsonb; v_cmb jsonb;
  v_double boolean := false; v_rally numeric; v_mend numeric;
  v_party jsonb; v_crash jsonb; v_crash_dmg int := 0; v_crash_to text; v_crash_card bigint;
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive, coalesce(hp_share, hp_max), stats, hp_remaining
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive, v_share, v_stats, v_hp
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  v_pk := v_passive->>'kind';
  -- Every passive the boss has (passive.list; an older hunt has only passive.kind).
  select coalesce(array_agg(x->>'kind'), array[v_pk]) into v_plist
    from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;
  v_plist := array_remove(v_plist, null);

  select pc.quantity, pc.ascension, c.rarity::text, c.season, s.type, s.cp_mod, c.name, s.ability, s.tag_slugs, pc.stat_points
    into v_qty, v_asc, v_rarity, v_season, v_type, v_mod, v_cardname, v_ability, v_tags, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'America/Denver')::date;
  -- One squad per day (hunt_squads.sql): a locked squad fights only with its own cards.
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  -- The round limit (hunt_loop_caps.sql): a squad fights at most hunt_round_cap rounds a day.
  v_rcap := hunt_round_cap();
  if coalesce((select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day), 0) >= v_rcap then
    return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap);
  end if;
  -- The stat points of this copy (stat_points.sql). With the flag off: card_power + card_max_hp.
  v_cmb := card_combat(v_rarity, v_asc, v_mod, v_pts);
  v_cp := (v_cmb->>'cp')::int;
  v_maxhp := (v_cmb->>'hp')::int;

  select hp_remaining, downed, coalesce(dmg_buff, 1), coalesce(dmg_debuff, 1), coalesce(shield, 0)
    into v_cardhp, v_downed, v_buff, v_debuff, v_shield
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then
    v_cardhp := v_maxhp; v_downed := false; v_buff := 1; v_debuff := 1; v_shield := 0;
    select coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8) into v_cap;
    if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap then
      return jsonb_build_object('ok', false, 'error', 'day_limit', 'cap', v_cap);
    end if;
  else
    select coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8) into v_cap;
  end if;
  if v_downed or v_cardhp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'downed', 'card_hp', 0, 'card_max_hp', v_maxhp);
  end if;

  v_round := hunt_state_round(p_hunt, p_player, v_day);
  select coalesce(cd_until_round, 0) >= v_round + 1 into v_stunned_card
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if coalesce(v_stunned_card, false) and (
       exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day
               and h.card_id <> p_card and not h.downed and coalesce(h.cd_until_round, 0) < v_round + 1
               and exists (select 1 from cards c join subjects s on s.id = c.subject_id where c.id = h.card_id and s.type in ('Character', 'Creature')))
       or (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) < v_cap) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  -- Mend (a boon): the first hurt card that attacks heals the waiting amount first
  -- (after the downed / stunned checks, so a refused attack keeps the boon).
  if v_cardhp < v_maxhp then
    v_mend := take_player_effect(p_player, 'mend');
    if v_mend is not null then v_cardhp := least(v_maxhp, v_cardhp + greatest(1, round(v_mend))::int); end if;
  end if;
  select boss_enrage, enrage_until, boss_weaken, weaken_until, boss_expose, expose_until, stunned_until
    into v_enrage, v_enr_until, v_weaken, v_wk_until, v_expose, v_exp_until, v_stun_until
    from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;

  v_aeff := case when v_ability->>'kind' = 'attack' then v_ability->>'effect' else null end;
  v_aamt := coalesce((v_ability->>'amount')::numeric, 0);
  v_athresh := coalesce((v_ability->>'threshold')::numeric, 0);

  -- The squad in this fight (combat_core.sql: combat_squad): the other cards and their tags.
  v_sq := combat_squad(v_tags,
    exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day),
    (select coalesce(jsonb_agg(to_jsonb(s.tag_slugs)), '[]'::jsonb)
       from (select distinct h.card_id from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card) hc
       join cards c on c.id = hc.card_id join subjects s on s.id = c.subject_id),
    v_weak);
  v_stack := (v_sq->>'stack')::int;
  v_wk := combat_weak(v_weak, v_resist, v_type, v_rarity, v_season, v_tags, v_stack);
  v_wm := (v_wk->>'wm')::int; v_rm := (v_wk->>'rm')::int; v_wmult := (v_wk->>'mult')::numeric;
  v_bonus := v_wm > 0;
  v_elem := v_sq->>'elem'; v_syn := (v_sq->>'syn')::int; v_synmult := (v_sq->>'synmult')::numeric;

  v_critchance := combat_crit_chance(v_bonus, v_aeff, v_aamt, v_cmb);
  v_hit := combat_hit(v_cp, v_wmult, v_buff, v_debuff, v_synmult, v_critchance,
    0.08 + case when 'shrouded' = any(v_plist) then 0.10 else 0 end,                  -- shrouded: more misses
    v_aeff, v_aamt, v_athresh, 'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 then v_expose else 0 end, v_hp, v_hpmax);
  v_miss := (v_hit->>'miss')::boolean; v_crit := (v_hit->>'crit')::boolean; v_block := (v_hit->>'block')::boolean;
  v_dmg := (v_hit->>'dmg')::int; v_outcome := v_hit->>'outcome'; v_double := (v_hit->>'double')::boolean;
  if not v_miss then
    -- Rally (a boon): the next hit deals +amount % (the boon is used up by this hit).
    v_rally := take_player_effect(p_player, 'rally');
    if v_rally is not null then v_dmg := greatest(1, round(v_dmg * (1 + least(v_rally, 100) / 100.0))); end if;
    -- Launch Party (the Launch Day Player boon, launch_event_cards.sql): +amount % on each of the
    -- next N hits (options.uses), one charge per hit.
    v_party := use_effect_charge(p_player, 'launch_party');
    if v_party is not null then v_dmg := greatest(1, round(v_dmg * (1 + least((v_party->>'amount')::numeric, 100) / 100.0))); end if;
    -- Raid Crasher (the Launch Day Raider prank): the boss takes +amount % more on each of the next N
    -- hits, and that extra damage counts for the prankster (options.credit_to) on the leaderboard.
    v_crash := use_effect_charge(p_player, 'raid_crasher');
    if v_crash is not null then
      v_crash_dmg := greatest(1, round(v_dmg * least((v_crash->>'amount')::numeric, 100) / 100.0))::int;
      v_crash_to := coalesce(v_crash->'options'->>'credit_to', v_crash->'options'->>'sender_id');
      v_crash_card := (v_crash->'options'->>'card_id')::bigint;
    end if;
  end if;

  if v_dmg > 0 then
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
      values (p_hunt, p_player, p_card, v_day, v_dmg)
      on conflict (hunt_id, player_id, card_id, hit_date)
      do update set damage = hunt_hits.damage + excluded.damage;
    -- The Raid Crasher share: the prankster's own hunt_hits row (their Raider card), so it counts
    -- for the leaderboard and the prizes.
    if v_crash_dmg > 0 and v_crash_to is not null and v_crash_card is not null then
      insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
        values (p_hunt, v_crash_to, v_crash_card, v_day, v_crash_dmg)
        on conflict (hunt_id, player_id, card_id, hit_date)
        do update set damage = hunt_hits.damage + excluded.damage;
    end if;
    update hunts set hp_remaining = greatest(0, hp_remaining - v_dmg - v_crash_dmg),
      status      = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then now() else defeated_at end
      where id = p_hunt;
  end if;
  select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;

  v_heal := 0;
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);  -- cap: lifesteal cannot out-heal the boss
    v_cardhp := least(v_maxhp, v_cardhp + v_heal);
  end if;
  v_buff := 1;

  -- The boss ATK (Nathan, 2026-09-28: flat stats, so tougher cards survive more hits).
  -- hunts.stats.atk is set at spawn; an older hunt uses the tier default.
  v_atk := coalesce((v_stats->>'atk')::numeric,
    (select (value->>v_tier)::numeric from settings where key = 'hunt_atk'),
    case v_tier when 'Heroic' then 73 when 'Mythic' then 93 else 58 end);
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    update hunt_combat_state set round = round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
      returning round into v_round;
    -- Phase 1 below 50% HP: permanent rage. Frenzied: +5% per 10% of HP lost (combat_enemy_mult).
    v_lost := 1 - v_hp::numeric / greatest(1, v_hpmax);
    v_bmult := combat_enemy_mult(v_enrage, v_enr_until, v_weaken, v_wk_until, v_round,
      'volatile' = any(v_plist), v_lost, 'frenzied' = any(v_plist));
    v_bheal := 0;

    -- The enemy turn (combat_core.sql: combat_enemy_act): a surprise draw.
    v_act := combat_enemy_act(v_atk, v_bmult, v_round, v_stun_until, v_lost, v_share);
    v_bossact := v_act->>'action'; v_cdmg := (v_act->>'dmg')::int; v_area := (v_act->>'area')::numeric;
    v_bheal := v_bheal + (v_act->>'heal')::int;
    if v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then
      v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
    end if;
    if v_area > 0 then   -- Slam / Cataclysm: every other card standing rolls its own hit
      with tgt as (
        select h.card_id, greatest(0, h.raw - coalesce(h.shield, 0)) as dmg,
               greatest(0, coalesce(h.shield, 0) - h.raw) as shleft
               from (select x.*, combat_area_roll(v_atk, v_area, v_bmult) as raw
                     from hunt_card_hp x
                     where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = v_day and x.card_id <> p_card and not x.downed) h
      ), upd as (
        update hunt_card_hp h set hp_remaining = greatest(0, h.hp_remaining - t.dmg),
            shield = t.shleft, downed = (h.hp_remaining - t.dmg) <= 0, updated_at = now()
        from tgt t where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = t.card_id
        returning h.card_id, h.hp_remaining, h.max_hp, h.downed, t.dmg
      )
      select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'dmg', dmg, 'hp', hp_remaining, 'max_hp', max_hp, 'downed', downed)), '[]'::jsonb)
        into v_slam from upd;
    end if;
    if v_bossact = 'enrage' then
      update hunt_combat_state set boss_enrage = 1.4, enrage_until = v_round + 2, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif v_bossact = 'curse' then
      v_debuff := 0.7;
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + combat_regen(v_share); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - combat_thorns(v_dmg));
    end if;
    if v_bheal > 0 then
      update hunts set hp_remaining = least(hp_max, hp_remaining + v_bheal) where id = p_hunt and status = 'active'
        returning hp_remaining into v_hp;
    end if;
    -- Phase 2 below 25% HP: the boss gains one more passive (once per hunt).
    v_phase := null;
    if v_hp::numeric / greatest(1, v_hpmax) < 0.25 and not coalesce((v_passive->>'phase2')::boolean, false) then
      select k into v_extra from unnest(array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied']) k
        where k <> all(v_plist) order by random() limit 1;
      update hunts set passive = coalesce(passive, '{}'::jsonb) || jsonb_build_object('phase2', true,
          'list', coalesce(passive->'list', '[]'::jsonb) || case when v_extra is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('kind', v_extra, 'label', case v_extra
              when 'armored' then 'Armored: melee attackers deal less' when 'shrouded' then 'Shrouded: attacks miss more often'
              when 'flaming' then 'Flaming: burns the attacking card' when 'volatile' then 'Volatile: counterattacks hit harder'
              when 'regenerating' then 'Regenerating: heals a little every turn' when 'thorns' then 'Thorns: part of your damage comes back to your card'
              else 'Frenzied: hits harder as it loses HP' end)) end)
        where id = p_hunt;
      v_phase := coalesce(v_extra, 'phase2');
    elsif (v_hp + v_dmg)::numeric / greatest(1, v_hpmax) >= 0.5 and v_hp::numeric / greatest(1, v_hpmax) < 0.5 then
      v_phase := 'rage';                            -- this hit took the boss below 50%
    end if;
  end if;

  -- Flaming boss: a chance the attacking card catches burn after acting.
  v_burned := false;
  if 'flaming' = any(v_plist) and v_status <> 'defeated' then
    v_burn := combat_burn(v_atk);
    if v_burn > 0 then
      v_ab := combat_absorb(v_shield, v_burn); v_shield := (v_ab->>'shield')::int; v_burn := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_burn); v_burned := v_burn > 0;
    end if;
  end if;

  v_downed := v_cardhp <= 0;
  v_counter := v_bossact is not null and v_bossact not in ('stunned', 'enrage', 'curse', 'regenerate', 'charging');

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, dmg_buff, dmg_debuff, shield, cd_until_round)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed, v_buff, v_debuff, v_shield,
            case when v_bossact = 'stun' then v_round + 1 else 0 end)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed,
      dmg_buff = excluded.dmg_buff, dmg_debuff = excluded.dmg_debuff, shield = excluded.shield,
      cd_until_round = greatest(excluded.cd_until_round, hunt_card_hp.cd_until_round), updated_at = now();

  insert into hunt_combat_log (hunt_id, player_id, card_id, cp, outcome, bonus, crit, block,
    damage, countered, counter_dmg, card_hp_after, card_downed, boss_hp_after)
  values (p_hunt, p_player, p_card, v_cp, v_outcome, v_bonus, v_crit, v_block,
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp);

  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  select coalesce((select value #>> '{}' from settings where key = 'hunt_attack_feed'), 'milestones') into v_feed;
  v_milestone := v_crit or v_downed;
  if v_status <> 'defeated' and not v_miss and (v_feed = 'all' or (v_feed = 'milestones' and v_milestone)) then
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'attack', jsonb_build_object('player_id', p_player, 'card', v_cardname,
        'damage', v_dmg, 'outcome', v_outcome, 'crit', v_crit, 'bonus', v_bonus, 'downed', v_downed));
  end if;

  -- The end-of-day summary (hunt_squad_done.sql): when every attacker of the locked squad is down,
  -- once per member per day. It needed 8 cards used, so a short squad (or the old squad bug) never posted.
  -- The round limit also ends the squad, so its summary posts then too (hunt_loop_caps.sql).
  if v_status <> 'defeated' and ((v_downed and hunt_squad_done(p_hunt, p_player, v_day, v_cap)) or v_round >= v_rcap)
     and not exists (select 1 from hunt_events where hunt_id = p_hunt and kind = 'player_done'
                       and payload->>'player_id' = p_player and created_at >= (v_day::timestamp at time zone 'America/Denver')) then
    select coalesce(sum(damage), 0), count(distinct card_id) into v_total, v_used
      from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    select c.name, sub.d into v_topcard, v_topdmg
      from (select card_id, sum(damage) d from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
            group by card_id order by d desc limit 1) sub join cards c on c.id = sub.card_id;
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'player_done', jsonb_build_object('player_id', p_player,
        'total', v_total, 'cards_used', v_used, 'top_card', v_topcard, 'top_damage', v_topdmg,
        'boss_hp', v_hp, 'boss_hp_max', v_hpmax));
  end if;

  v_targets := jsonb_build_array(jsonb_build_object('card_id', p_card, 'dmg', v_cdmg,
      'hp', v_cardhp, 'max_hp', v_maxhp, 'downed', v_downed)) || coalesce(v_slam, '[]'::jsonb);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'resisted', v_rm > 0, 'crit', v_crit, 'cp', v_cp, 'heal', v_heal, 'ability', v_aeff,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'round', v_round, 'round_cap', v_rcap,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed, 'shield', v_shield,
    'burned', v_burned, 'double', v_double, 'rally', v_rally, 'mend', v_mend, 'party', v_party->'amount', 'crashed', nullif(v_crash_dmg, 0), 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
    'synergy', case when v_syn >= 3 then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', v_bossact, 'round', v_round, 'targets', v_targets) end);
end $function$;

CREATE OR REPLACE FUNCTION public.hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int; v_sdown boolean; v_stun_until int;
  v_status text; v_closes timestamptz; v_tier text; v_hp bigint;
  v_qty int; v_type text; v_ability jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text;
  v_day date; v_round int; v_cd_until int; v_cap int; v_maxhp int;
  v_tqty int; v_trar text; v_tasc int; v_tmod numeric; v_tmaxhp int; v_tcp int;
  v_tpts jsonb; v_srar text; v_sasc int; v_smod numeric; v_spts jsonb;
  v_aff text; v_ttags text[]; v_affcount int := 0; v_scale numeric := 1; v_matched boolean := false; v_sdmg int;
begin
  select status, closes_at, tier into v_status, v_closes, v_tier from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;

  select pc.quantity, s.type, s.ability, c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points
    into v_qty, v_type, v_ability, v_srar, v_sasc, v_smod, v_spts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_ability is null or v_ability->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;

  v_eff := v_ability->>'effect';
  v_amt := coalesce((v_ability->>'amount')::numeric, 0);
  -- Potency points of this support copy make its effect stronger (1 with the flag off).
  v_amt := v_amt * coalesce((card_combat(v_srar, v_sasc, v_smod, v_spts)->>'potency')::numeric, 1);
  v_dur := coalesce((v_ability->>'duration')::int, 1);
  v_cd  := coalesce((v_ability->>'cooldown')::int, 1);
  v_tgt := coalesce(v_ability->>'target', 'boss');
  v_aff := v_ability->>'affinity';
  v_day := (now() at time zone 'America/Denver')::date;
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then -- hunt_squads.sql
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  v_round := hunt_state_round(p_hunt, p_player, v_day);

  -- The round limit (hunt_loop_caps.sql).
  v_rcap := hunt_round_cap();
  if v_round >= v_rcap then return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap); end if;
  select cd_until_round, downed or hp_remaining <= 0 into v_cd_until, v_sdown from hunt_card_hp
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  -- A support card that is down does nothing (hunt_loop_caps.sql: a downed heal card kept a squad alive).
  if coalesce(v_sdown, false) then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  if found and v_round < coalesce(v_cd_until, 0) then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', v_cd_until, 'round', v_round);
  end if;

  v_maxhp := card_max_hp(0);   -- a support card: the HP floor (60 since hunt_launch_balance.sql)
  if not hunt_commit_card(p_hunt, p_player, p_card, v_day, v_maxhp) then
    return jsonb_build_object('ok', false, 'error', 'day_limit');
  end if;

  -- Affinity synergy: how many committed squad cards share this support's affinity tag.
  if v_aff is not null then
    select count(distinct h.card_id) into v_affcount
    from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
    where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affcount);

  -- resolve ally-targeted effects (need a committed target row)
  if v_tgt in ('ally', 'self') then
    if p_target is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    select pc.quantity, c.rarity::text, pc.ascension, s.cp_mod, s.tag_slugs, pc.stat_points
      into v_tqty, v_trar, v_tasc, v_tmod, v_ttags, v_tpts
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_target;
    if not found or v_tqty < 1 then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    v_tcp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'cp')::int;
    v_tmaxhp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'hp')::int;
    perform hunt_commit_card(p_hunt, p_player, p_target, v_day, v_tmaxhp);

    -- matched ally gets the stronger effect
    v_matched := v_aff is not null and v_ttags is not null and v_aff = any(v_ttags);
    if v_matched then v_amt := v_amt * 1.8; end if;

    if v_eff = 'empower' then
      update hunt_card_hp set dmg_buff = combat_support_value('empower', v_amt, 1, null), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'shield' then
      -- amount = a fraction of the TARGET's max HP (was flat 60 on 30-HP cards).
      update hunt_card_hp set shield = shield + combat_support_value('shield', v_amt, 1, max_hp)::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'heal' then
      -- amount = a fraction of the TARGET's max HP (was flat 60, a full heal on the
      -- 30-HP cards). A heal never revives a downed card (that is a separate boon).
      if exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player
                  and card_id = p_target and hit_date = v_day and downed) then
        return jsonb_build_object('ok', false, 'error', 'target_downed');
      end if;
      update hunt_card_hp set hp_remaining = least(max_hp, hp_remaining + combat_support_value('heal', v_amt, 1, max_hp)::int),
        updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    else
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;

  -- boss-targeted / team effects (scaled by affinity synergy)
  elsif v_eff = 'weaken' then
    update hunt_combat_state set boss_weaken = combat_support_value('weaken', v_amt, v_scale, null), weaken_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'expose' then
    update hunt_combat_state set boss_expose = combat_support_value('expose', v_amt, v_scale, null), expose_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'stun' then
    -- Stun immunity (hunt_loop_caps.sql): after a stun the boss cannot be stunned for 2 rounds, so
    -- 4 stun cards cannot lock it (at most 1 stunned round in 3).
    select stunned_until into v_stun_until from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if combat_stun_immune(v_stun_until, v_round) then
      return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', v_stun_until + 2);
    end if;
    update hunt_combat_state set stunned_until = v_round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'cleanse' then
    update hunt_card_hp set dmg_debuff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
  elsif v_eff = 'smite' then
    v_sdmg := combat_support_value('smite', v_amt, v_scale, null)::int;
    update hunts set hp_remaining = greatest(0, hp_remaining - v_sdmg),
      status = case when hp_remaining - v_sdmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_sdmg <= 0 then now() else defeated_at end
      where id = p_hunt;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, p_card, v_day, v_sdmg)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
    select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;
    if v_status = 'defeated' then perform settle_hunt(p_hunt); end if;
  else
    return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
  end if;

  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'affinity', v_aff, 'aff_count', v_affcount, 'matched', v_matched,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated');
end $function$;

notify pgrst, 'reload schema';
