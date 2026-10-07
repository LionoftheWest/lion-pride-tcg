-- damage_log.sql: ONE DAMAGE LOG (Nathan, 2026-10-06: "Yes start now"). Stacks on combat_actions.sql (#214),
-- hunt_damage_trace.sql and balance_table.sql / balance_economy.sql (#231).
-- Every point of Hunt damage in hunt_hits (the leaderboard and the prizes) now has one log row:
--   an attack        hunt_combat_log (one row per attack; damage)
--   a Smite          combat_actions kind 'support', effect 'smite' (hunt_support writes it since #214;
--                    result.value = the damage, result.mirrored = true when Mirror sent it to the smite card)
--   a Hunt Crasher   combat_actions kind 'effect', effect 'raid_crasher' (NEW: hunt_attack writes it here, for the
--                    member who gets the credit, on their Raider card; result.value = the damage)
--   a manual change  hunt_adjustments
-- So hunt_damage_reconcile becomes: hits = logged + smite + crasher + adjusted + unexplained, with no special case.
-- `amount` keeps its meaning (the ability or charge amount); the damage is in result.value (Nathan, 2026-10-07).
-- A Crasher charge with no owner or no card still hits the boss: the attacker gets the credit on the attacking card
-- (result.fallback = true), so boss HP and hunt_hits always agree. play_card_effect always sets both, so this does not
-- happen today (live, 2026-10-07: 9 charges, 0 with no owner, 0 with no card).
-- hunt_attack is rebuilt from its LIVE text (2026-10-07, md5 835daea4...) with the Crasher log only: card-studio/scripts/
-- combat-golden.mjs (CANDIDATE=this file) shows that no fight changes. combat_core.sql, balance_table.sql and
-- hunt_boss_moves.sql are rebuilt in the same PR with the same text, so a re-run never removes the log write.
-- The old Smite and Crasher damage (before this file) gets backfilled log rows (result.backfilled = true).
-- Test: card-studio/scripts/test-damage-log.mjs. Idempotent.

-- GUARD (the combat_core.sql rule): the live hunt_attack must be the text this file was built from, or its result.
do $g$ begin
  if to_regclass('public.balance') is null then raise exception 'damage_log.sql: apply balance_table.sql first'; end if;
  if to_regclass('public.combat_actions') is null then raise exception 'damage_log.sql: apply combat_actions.sql first'; end if;
  if md5(replace(pg_get_functiondef('public.hunt_attack'::regproc), chr(13), '')) not in ('835daea41237378340cc28a88c3b0921', '5cfa1a4779226661d56ceda56045b58c') then
    raise exception 'damage_log.sql: the live hunt_attack changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;
-- GUARD-END

-- 1. A third kind of action: 'effect' (a prank or boon that acts in a fight; first: the Hunt Crasher).
alter table public.combat_actions drop constraint if exists combat_actions_kind_check;
-- dungeon_combat_log.sql (2026-10-07) added 'enemy': it stays here, so a re-run of this file does not drop it.
alter table public.combat_actions add constraint combat_actions_kind_check check (kind in ('attack', 'support', 'effect', 'enemy'));

-- 2. hunt_attack: the LIVE text + the Hunt Crasher log row (and the no-owner fallback).
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
  v_double boolean := false; v_rally numeric; v_mend numeric; v_bf numeric;
  v_party jsonb; v_crash jsonb; v_crash_dmg int := 0; v_crash_to text; v_crash_card bigint;
  v_crash_fb boolean := false; v_crash_round int; v_clog bigint;
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
  v_bname text; v_marks jsonb; v_pick jsonb; v_ctr jsonb; v_tick jsonb; v_ubuff numeric := 1;
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive, coalesce(hp_share, hp_max), stats, hp_remaining, name
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive, v_share, v_stats, v_hp, v_bname
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
    v_cap := hunt_card_cap();
    if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap then
      return jsonb_build_object('ok', false, 'error', 'day_limit', 'cap', v_cap);
    end if;
  else
    v_cap := hunt_card_cap();
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
  select boss_enrage, enrage_until, boss_weaken, weaken_until, boss_expose, expose_until, stunned_until, marks
    into v_enrage, v_enr_until, v_weaken, v_wk_until, v_expose, v_exp_until, v_stun_until, v_marks
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
    combat_miss('shrouded' = any(v_plist)),                                          -- shrouded: more misses
    v_aeff, v_aamt, v_athresh, 'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end, v_hp, v_hpmax);   -- Veil (hunt_boss_moves.sql)
  v_miss := (v_hit->>'miss')::boolean; v_crit := (v_hit->>'crit')::boolean; v_block := (v_hit->>'block')::boolean;
  v_dmg := (v_hit->>'dmg')::int; v_outcome := v_hit->>'outcome'; v_double := (v_hit->>'double')::boolean;
  if not v_miss then
    -- Rally (a boon): the next hit deals +amount % (the boon is used up by this hit).
    v_rally := take_player_effect(p_player, 'rally');
    if v_rally is not null then v_dmg := greatest(1, round(v_dmg * (1 + least(v_rally, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Butterfingers (a prank, effects_outside.sql): the next hit deals -amount % (used up by this hit).
    v_bf := take_player_effect(p_player, 'butterfingers');
    if v_bf is not null and v_dmg > 0 then v_dmg := greatest(1, round(v_dmg * (1 - least(v_bf, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Launch Party (the Launch Day Player boon, launch_event_cards.sql): +amount % on each of the
    -- next N hits (options.uses), one charge per hit.
    v_party := use_effect_charge(p_player, 'launch_party');
    if v_party is not null then v_dmg := greatest(1, round(v_dmg * (1 + least((v_party->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Raid Crasher (the Launch Day Raider prank): the boss takes +amount % more on each of the next N
    -- hits, and that extra damage counts for the prankster (options.credit_to) on the leaderboard.
    v_crash := use_effect_charge(p_player, 'raid_crasher');
    if v_crash is not null then
      v_crash_dmg := greatest(1, round(v_dmg * least((v_crash->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))::int;
      v_crash_to := coalesce(v_crash->'options'->>'credit_to', v_crash->'options'->>'sender_id');
      v_crash_card := (v_crash->'options'->>'card_id')::bigint;
      -- No owner or no card (damage_log.sql): the extra damage still hits the boss, so the attacker gets the credit on
      -- the attacking card. Boss HP and hunt_hits then agree; the log row says fallback.
      if v_crash_to is null or v_crash_card is null then
        v_crash_to := p_player; v_crash_card := p_card; v_crash_fb := true;
      end if;
      v_crash_round := v_round;
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
  -- Counter marks on this attack (hunt_boss_moves.sql): Counter-pick (an empowered attack hurts the attacker by the
  -- bonus) and Demotion (an attack on an exposed boss sends 20% back).
  if v_dmg > 0 and v_buff > 1 and hunt_mark_on(v_marks, 'counterpick', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(2 * v_dmg * (v_buff - 1) / v_buff))::int);   -- twice the bonus
  end if;
  if v_dmg > 0 and v_exp_until >= v_round and v_expose > 0 and hunt_mark_on(v_marks, 'demotion', v_round)
     and not hunt_mark_on(v_marks, 'block_expose', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * 0.2))::int);
  end if;
  v_ubuff := v_buff;   -- the empower this attack used (Tier List)
  v_buff := 1;

  -- The boss ATK (Nathan, 2026-09-28: flat stats, so tougher cards survive more hits).
  -- hunts.stats.atk is set at spawn; an older hunt uses the tier default.
  v_atk := coalesce((v_stats->>'atk')::numeric, balance_num('boss_atk', v_tier));
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    update hunt_combat_state set round = round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
      returning round into v_round;
    -- Phase 1 below 50% HP: permanent rage. Frenzied: +5% per 10% of HP lost (combat_enemy_mult).
    v_lost := 1 - v_hp::numeric / greatest(1, v_hpmax);
    v_bmult := combat_enemy_mult(v_enrage, v_enr_until,
      case when hunt_mark_on(v_marks, 'block_weaken', v_round) then 0 else v_weaken end,   -- Alt-F4 (hunt_boss_moves.sql)
      v_wk_until, v_round, 'volatile' = any(v_plist), v_lost, 'frenzied' = any(v_plist));
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: +20% for each weaken played
      v_bmult := v_bmult * (1 + coalesce((v_marks->'spiral'->>'bonus')::numeric, 0));
    end if;
    v_bheal := 0;

    -- The enemy turn (combat_core.sql: combat_enemy_act): a surprise draw.
    -- The damage-over-time marks tick first (hunt_boss_moves.sql: Infect, Nightshade).
    v_tick := hunt_counter_tick(p_hunt, p_player, v_day, p_card, v_round);
    if (v_tick->>'attacker')::int > 0 then
      v_ab := combat_absorb(v_shield, (v_tick->>'attacker')::int); v_shield := (v_ab->>'shield')::int;
      v_cardhp := greatest(0, v_cardhp - (v_ab->>'dmg')::int);
    end if;
    v_act := combat_enemy_act(v_atk, v_bmult, v_round, v_stun_until, v_lost, v_share);
    v_bossact := v_act->>'action'; v_cdmg := (v_act->>'dmg')::int; v_area := (v_act->>'area')::numeric;
    v_bheal := v_bheal + (v_act->>'heal')::int;
    -- A counter move (hunt_boss_moves.sql): 40% of the normal turns of a boss with a move pool. An effect move comes on
    -- top of the usual turn (base); a hit move replaces it.
    v_pick := hunt_counter_pick(p_hunt, p_player, v_day, v_bname, v_bossact);
    if v_pick is not null then
      v_ctr := hunt_counter_act(p_hunt, p_player, v_day, p_card, v_round, v_atk, v_bmult, v_pick->>'key', v_pick->>'name',
        v_cardhp, v_maxhp, v_shield, v_ubuff);
      if v_ctr->>'shield' is not null then v_shield := (v_ctr->>'shield')::int; end if;
      if v_ctr->>'debuff' is not null then v_debuff := (v_ctr->>'debuff')::numeric; end if;
      v_cardhp := greatest(0, v_cardhp - (v_ctr->>'loss')::int);
      v_bheal := v_bheal + (v_ctr->>'heal')::int;
      if not (v_ctr->>'base')::boolean then   -- a hit move: no usual turn
        v_bheal := v_bheal - (v_act->>'heal')::int;
        v_bossact := 'counter'; v_area := 0; v_cdmg := (v_ctr->>'dmg')::int;
        if not (v_ctr->>'pierce')::boolean then
          v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
        end if;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      end if;
    end if;
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
      update hunt_combat_state set boss_enrage = balance_num('boss_moves', 'enrage_x'), enrage_until = v_round + balance_num('boss_moves', 'enrage_rounds')::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif v_bossact = 'curse' then
      v_debuff := balance_num('boss_moves', 'curse_x');
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + combat_regen(v_share); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - combat_thorns(v_dmg));
    end if;
    if v_bheal > 0 then
      update hunts set hp_remaining = least(hp_max, hp_remaining + v_bheal) where id = p_hunt and status = 'active'
        returning hp_remaining into v_hp;
    end if;
    -- Phase 2 below boss_moves.phase2_at HP: the boss gains one more passive (once per hunt).
    v_phase := null;
    if v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'phase2_at') and not coalesce((v_passive->>'phase2')::boolean, false) then
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
    elsif (v_hp + v_dmg)::numeric / greatest(1, v_hpmax) >= balance_num('boss_moves', 'rage_at') and v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'rage_at') then
      v_phase := 'rage';                            -- this hit took the boss below rage_at
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
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp)
  returning id into v_clog;

  -- The Hunt Crasher log row (damage_log.sql): the extra damage that hunt_hits credits to the prankster's Raider card.
  -- amount = the charge amount (%), result.value = the damage, combat_log_id = the attack it rode on.
  if v_dmg > 0 and v_crash_dmg > 0 then
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)
    values ('hunt', p_hunt, v_crash_to, v_crash_card, 'effect', v_day, v_crash_round, 'raid_crasher', (v_crash->>'amount')::numeric,
      jsonb_build_object('value', v_crash_dmg, 'attacker', p_player, 'attack_card', p_card, 'combat_log_id', v_clog, 'fallback', v_crash_fb));
  end if;

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
      'hp', v_cardhp, 'max_hp', v_maxhp, 'downed', v_downed)) || coalesce(v_slam, '[]'::jsonb) || coalesce(v_tick->'targets', '[]'::jsonb)
      || coalesce(v_ctr->'targets', '[]'::jsonb);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'resisted', v_rm > 0, 'crit', v_crit, 'cp', v_cp, 'heal', v_heal, 'ability', v_aeff,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'round', v_round, 'round_cap', v_rcap,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed, 'shield', v_shield,
    'burned', v_burned, 'double', v_double, 'rally', v_rally, 'butterfingers', v_bf, 'mend', v_mend, 'party', v_party->'amount', 'crashed', nullif(v_crash_dmg, 0), 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
    'synergy', case when v_syn >= balance_num('combat', 'syn_small_at') then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', case when v_bossact = 'counter' then v_ctr->>'anim' else v_bossact end, 'round', v_round, 'targets', v_targets)
        || case when v_ctr is null then '{}'::jsonb else jsonb_build_object('move', v_ctr->>'move', 'counter', v_ctr->>'key') end end);
end $function$
;

comment on function public.hunt_attack(text, bigint, bigint) is
  '[hunt] One attack of a squad card on the Hunt boss, then the boss turn. Writes hunt_hits (the damage), hunt_combat_log (one row per attack) and, for a Hunt Crasher charge, the prankster''s hunt_hits share and its combat_actions row (kind effect, effect raid_crasher, result.value = the damage). Rules: combat_core.sql; numbers: public.balance.';

-- 3. The backfill: a log row for the old Smite and Crasher damage (before this file, and Smite before #214).
--    Per (hunt, member, card, day): rest = hunt_hits - logged attacks (the Mountain Time day of the log row, as
--    hunt_attack sets hit_date) - the card's adjustments - the log rows that exist. A positive rest is PROVEN when:
--      Smite    the card's ability is smite (a support card: hunt_attack refuses it, so only hunt_support writes it);
--      Crasher  the card's prank is raid_crasher (the Raider card): only the Crasher credit adds to it without a log row.
--    One row per (hunt, member, card, day) with the whole rest (the single plays are not known: round and amount null).
--    A negative rest or a rest on another card is NOT invented: it stays in the reconcile (hunt_adjustments explains
--    the known ones; live 2026-10-07: the only negative Crasher rest, -204, is part of oct2_heal_loop_cut).
--    An active Hunt is skipped (the boss counter Rollback reads the last smite row of the day): run this file again
--    after it ends. A re-run adds nothing (the rest is then 0).
do $b$
declare v_smite int; v_crash int; v_sd bigint; v_cd bigint;
begin
  with h as (select hunt_id, player_id, card_id, hit_date d, sum(damage) x from hunt_hits group by 1, 2, 3, 4),
  l as (select hunt_id, player_id, card_id, (ts at time zone 'America/Denver')::date d, sum(damage) x from hunt_combat_log group by 1, 2, 3, 4),
  a as (select hunt_id, player_id, card_id, hit_date d, sum(damage) x from hunt_adjustments where card_id is not null group by 1, 2, 3, 4),
  g as (select ref_id hunt_id, player_id, card_id, game_day d, effect, sum((result->>'value')::bigint) x from combat_actions
         where mode = 'hunt' and effect in ('smite', 'raid_crasher') and not coalesce((result->>'mirrored')::boolean, false)
         group by 1, 2, 3, 4, 5),
  r as (
    select h.hunt_id, h.player_id, h.card_id, h.d,
           case when s.ability->>'kind' = 'support' and s.ability->>'effect' = 'smite' then 'smite'
                when s.effect->>'primitive' = 'raid_crasher' then 'raid_crasher' end as eff,
           h.x - coalesce(l.x, 0) - coalesce(a.x, 0) as rest0
      from h
      join hunts hu on hu.id = h.hunt_id and hu.status <> 'active'
      join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
      left join l on l.hunt_id = h.hunt_id and l.player_id = h.player_id and l.card_id = h.card_id and l.d = h.d
      left join a on a.hunt_id = h.hunt_id and a.player_id = h.player_id and a.card_id = h.card_id and a.d = h.d
  ), r2 as (
    select r.*, r.rest0 - coalesce(g.x, 0) as rest from r
      left join g on g.hunt_id = r.hunt_id and g.player_id = r.player_id and g.card_id = r.card_id and g.d = r.d and g.effect = r.eff
     where r.eff is not null
  ), ins as (
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)
    select 'hunt', hunt_id, player_id, card_id, case when eff = 'smite' then 'support' else 'effect' end, d, null, eff, null,
           jsonb_build_object('value', rest, 'backfilled', true, 'source', 'damage_log.sql: hunt_hits minus the logged damage')
      from r2 where rest > 0
    returning effect, (result->>'value')::bigint v
  )
  select count(*) filter (where effect = 'smite'), count(*) filter (where effect = 'raid_crasher'),
         coalesce(sum(v) filter (where effect = 'smite'), 0), coalesce(sum(v) filter (where effect = 'raid_crasher'), 0)
    into v_smite, v_crash, v_sd, v_cd from ins;
  raise notice 'damage_log.sql backfill: % Smite rows (% damage), % Crasher rows (% damage)', v_smite, v_sd, v_crash, v_cd;
end $b$;

-- 4. The reconcile: one row per member in the Hunt, sums over all days. No special case: every column is a log.
create or replace function public.hunt_damage_reconcile(p_hunt bigint)
returns table (player_id text, hits bigint, logged bigint, adjusted bigint, smite bigint, crasher bigint, unexplained bigint)
language sql stable security invoker set search_path = public as $$
  with h as (
    select hh.player_id, sum(hh.damage)::bigint as d from hunt_hits hh where hh.hunt_id = p_hunt group by 1
  ), l as (
    select cl.player_id, sum(cl.damage)::bigint as d from hunt_combat_log cl where cl.hunt_id = p_hunt group by 1
  ), a as (
    select ha.player_id, sum(ha.damage)::bigint as d from hunt_adjustments ha where ha.hunt_id = p_hunt group by 1
  ), x as (
    select ca.player_id,
           sum((ca.result->>'value')::bigint) filter (where ca.effect = 'smite')::bigint as smite,
           sum((ca.result->>'value')::bigint) filter (where ca.effect = 'raid_crasher')::bigint as crasher
      from combat_actions ca
     where ca.mode = 'hunt' and ca.ref_id = p_hunt and ca.effect in ('smite', 'raid_crasher')
       and not coalesce((ca.result->>'mirrored')::boolean, false)
     group by 1
  ), players_in as (
    select h.player_id from h union select l.player_id from l union select a.player_id from a union select x.player_id from x
  )
  select pi.player_id, coalesce(h.d, 0), coalesce(l.d, 0), coalesce(a.d, 0), coalesce(x.smite, 0), coalesce(x.crasher, 0),
         (coalesce(h.d, 0) - coalesce(l.d, 0) - coalesce(a.d, 0) - coalesce(x.smite, 0) - coalesce(x.crasher, 0))::bigint
    from players_in pi
    left join h on h.player_id = pi.player_id left join l on l.player_id = pi.player_id
    left join a on a.player_id = pi.player_id left join x on x.player_id = pi.player_id
   order by 1
$$;

comment on function public.hunt_damage_reconcile(bigint) is
  '[hunt] Traces Hunt damage per member: hits (hunt_hits) = logged (hunt_combat_log, the attacks) + smite + crasher (combat_actions result.value of effect smite (not mirrored) and raid_crasher) + adjusted (hunt_adjustments) + unexplained. unexplained must be 0: any change to hunt_hits with no log row shows there. Service role only.';

revoke execute on function public.hunt_damage_reconcile(bigint) from public, anon, authenticated;
grant execute on function public.hunt_damage_reconcile(bigint) to service_role;

-- 5. What each column of the action log means (kind 'effect' is new).
-- (dungeon_combat_log.sql 2026-10-07 wrote these notes again for the Dungeon and Gauntlet rows: the same text here.)
comment on table public.combat_actions is $c$[combat] The shared action log of every fight mode. Hunt: one row per support play (hunt_support) and per Hunt Crasher hit (hunt_attack); with hunt_combat_log and hunt_adjustments it traces every point of hunt_hits (hunt_damage_reconcile). Dungeon and Gauntlet (dungeon_combat_log.sql): one row per HP change of a run (attack, lifesteal, support play, enemy action, room reward, rest); dungeon_damage_reconcile traces the run HP. Server only (RLS on, no API grants).$c$;
comment on column public.combat_actions.id is $c$Row id (also the order of the actions).$c$;
comment on column public.combat_actions.mode is $c$The fight mode: hunt, dungeon (a daily Dungeon run) or gauntlet (a Gauntlet run). A reader that means one mode must filter it: ref_id values of different modes can be equal.$c$;
comment on column public.combat_actions.ref_id is $c$The fight: hunts.id for mode hunt, dungeon_runs.id for mode dungeon and gauntlet.$c$;
comment on column public.combat_actions.player_id is $c$The member who played it (Dungeon and Gauntlet: the run's member, also on enemy rows). For a Hunt Crasher row: the member who gets the credit (the prankster), not the attacker (result.attacker).$c$;
comment on column public.combat_actions.card_id is $c$The card that acted (the attacker, the support card, the lifesteal card). Null on an enemy row and on a Dungeon reward or rest row. For a Hunt Crasher row: the Raider card that gets the credit in hunt_hits.$c$;
comment on column public.combat_actions.kind is $c$attack (a Dungeon or Gauntlet attack), support (a support card play), effect (a prank, boon or other effect: raid_crasher, lifesteal, reward_heal, reward_revive, rest) or enemy (a Dungeon or Gauntlet foe acts: the card it hit, or its own heal).$c$;
comment on column public.combat_actions.game_day is $c$The fight day: the Mountain Time day (hunt_hits.hit_date) for the Hunt, dungeon_runs.day for the Dungeon and the Gauntlet.$c$;
comment on column public.combat_actions.round is $c$The squad round of the action (Dungeon: the round of the attack or play; an enemy row has the next round, the one the foes act in). Null on a backfilled row and on a Dungeon reward or rest row.$c$;
comment on column public.combat_actions.effect is $c$The effect: the support effect (empower, expose, heal, shield, stun, weaken, smite, cleanse), the attack ability (Dungeon attack rows, null without one), the prank (raid_crasher), lifesteal, reward_heal, reward_revive, rest, or the enemy action (strike, slam, cataclysm, drain, stun, counter and the other pool moves; area = a Slam or Cataclysm hit on another card; poison, thorns, burn; heal = the foe heals).$c$;
comment on column public.combat_actions.amount is $c$The ability amount after potency and the affinity match (support), the attack ability amount (Dungeon attack), or the charge amount in % (raid_crasher). Not the damage: the HP change is result.value. Null on a backfilled row and on an enemy, reward or rest row.$c$;
comment on column public.combat_actions.target_card is $c$The card the action targets: the ally of a support (heal, shield, empower), the card a foe hit (enemy rows), the card a lifesteal, reward or rest healed. Else null.$c$;
comment on column public.combat_actions.target_foe is $c$The foe slot (0 = the first foe of the room): the foe an attack or a support hit, or the foe that acted (enemy rows). Else null.$c$;
comment on column public.combat_actions.result is $c$The applied result. Hunt: value = the applied value (smite and raid_crasher: the damage in hunt_hits); support: gained, mirrored (true = no boss damage), countered, scale, matched, aff_count, affinity, cooldown, target_after; raid_crasher: attacker, attack_card, combat_log_id, fallback (true = no owner, the attacker got the credit); backfilled = true: written by damage_log.sql from hunt_hits. Dungeon and Gauntlet: side (card or foe: whose HP changed), dir (dmg, heal or null), value (the HP change after the shield and the HP floor, 0 or more), hp_after, max, floor, room; attack: dmg (the hit before the HP floor), guarded, outcome, crit, double, bonus, resisted, cp; support: applied, until, matched, scale, aff_count, affinity, cooldown, kill; enemy: raw (before the shield), absorbed, move, hits, dot, action; reward and rest: hp_before, revived.$c$;
comment on column public.combat_actions.created_at is $c$When the row was written.$c$;

notify pgrst, 'reload schema';
