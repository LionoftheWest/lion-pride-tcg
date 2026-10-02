-- A squad is done when every ATTACKER of it is down (Nathan, 2026-10-02). The boss acts only after an
-- attack, so once the attackers are down nothing can hit the supports or move the rounds that their
-- cooldowns wait on: an every-card rule could never end a squad. The end-of-day summary (player_done)
-- now posts on that, once per member per day, for any squad size (it needed 8 cards used).
-- With a locked squad (hunt_squads.sql): its attackers. Without one: the old rule.

create or replace function public.hunt_squad_done(p_hunt bigint, p_player text, p_day date, p_cap int)
returns boolean language plpgsql stable set search_path = public as $$
declare sq bigint[];
begin
  select card_ids into sq from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  if sq is not null then
    return not exists (
      select 1 from unnest(sq) x join cards c on c.id = x join subjects s on s.id = c.subject_id
       where s.type in ('Character', 'Creature')
         and not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player
                           and h.hit_date = p_day and h.card_id = x and h.downed));
  end if;
  return (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = p_day) >= p_cap
     and not exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and not downed);
end $$;

create or replace function public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
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

  select count(*) into v_wm from jsonb_array_elements(coalesce(v_weak, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = v_type)
       or (w->>'kind' = 'rarity' and w->>'value' = v_rarity)
       or (w->>'kind' = 'season' and w->>'value' = v_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(v_tags));
  select count(*) into v_rm from jsonb_array_elements(coalesce(v_resist, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = v_type)
       or (w->>'kind' = 'rarity' and w->>'value' = v_rarity)
       or (w->>'kind' = 'season' and w->>'value' = v_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(v_tags));
  select array_agg(w->>'value') into v_wtags
    from jsonb_array_elements(coalesce(v_weak, '[]'::jsonb)) w where w->>'kind' = 'tag';
  v_stack := 0;
  if v_wtags is not null and array_length(v_wtags, 1) > 0 then
    select count(distinct h.card_id) into v_stack
    from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
    where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and s.tag_slugs && v_wtags;
  end if;
  v_bonus := v_wm > 0;
  v_wmult := 1
    + (1 - power(0.5, v_wm)) * (case when v_stack <= 3 then 1 else power(0.5, v_stack - 3) end)
    - 0.8 * (1 - power(0.5, v_rm));
  v_wmult := greatest(0.25, least(2.5, v_wmult));

  -- Squad element synergy: this card's dominant element + how many committed cards share it.
  v_elem := (select e from unnest(array['fire','water','lightning','ice','nature','earth','air',
                                        'shadow','light','arcane','psychic','toxic','metal']) e
             where ('trait:' || e) = any(v_tags) limit 1);
  v_synmult := 1;
  if v_elem is not null then
    select count(distinct h.card_id) into v_syn
      from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
      where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day
        and h.card_id <> p_card and ('trait:' || v_elem) = any(s.tag_slugs);
    v_syn := coalesce(v_syn, 0) + 1;   -- include this card
    if v_syn >= 5 then v_synmult := 1.20; elsif v_syn >= 3 then v_synmult := 1.12; end if;
  else
    v_syn := 0;
  end if;
  -- Origin (game) synergy: committed cards sharing this attacker origin.
  v_origin := (select t from unnest(v_tags) t where t like 'origin:%' limit 1);
  v_omult := 1;
  if v_origin is not null then
    select count(distinct h.card_id) into v_osyn from hunt_card_hp h join cards c on c.id=h.card_id join subjects s on s.id=c.subject_id
      where h.hunt_id=p_hunt and h.player_id=p_player and h.hit_date=v_day and h.card_id <> p_card and v_origin = any(s.tag_slugs);
    v_osyn := coalesce(v_osyn,0) + 1;
    if v_osyn >= 5 then v_omult := 1.18; elsif v_osyn >= 3 then v_omult := 1.10; end if;
  end if;
  -- Trait (kind) synergy: best-shared non-element trait among committed cards.
  v_kmult := 1;
  select coalesce(max(cnt),0) into v_ksyn from (
    select count(distinct h.card_id) as cnt from unnest(v_tags) tg
      cross join hunt_card_hp h join cards c on c.id=h.card_id join subjects s on s.id=c.subject_id
      where tg like 'trait:%' and tg not in ('trait:fire','trait:water','trait:lightning','trait:ice','trait:nature','trait:earth','trait:air','trait:shadow','trait:light','trait:arcane','trait:psychic','trait:toxic','trait:metal')
        and h.hunt_id=p_hunt and h.player_id=p_player and h.hit_date=v_day and h.card_id <> p_card and tg = any(s.tag_slugs)
      group by tg) k;
  if v_ksyn > 0 then v_ksyn := v_ksyn + 1; if v_ksyn >= 5 then v_kmult := 1.14; elsif v_ksyn >= 3 then v_kmult := 1.08; end if; end if;
  v_synmult := least(1.6, v_synmult * v_omult * v_kmult);

  v_critchance := (case when v_bonus then 0.20 else 0.10 end) + (case when v_aeff = 'focus' then v_aamt else 0 end);
  if (v_cmb->>'on')::boolean then   -- Precision points, under the crit cap
    v_critchance := least(coalesce((stat_cfg()->>'crit_cap')::numeric, 0.6), v_critchance + (v_cmb->>'crit')::numeric);
  end if;
  v_miss  := random() < (0.08 + case when 'shrouded' = any(v_plist) then 0.10 else 0 end);   -- shrouded: more misses
  v_crit  := (not v_miss) and random() < v_critchance;
  v_block := (not v_miss) and (not v_crit) and (v_aeff <> 'pierce' or v_aeff is null) and random() < 0.12;
  if v_miss then
    v_dmg := 0; v_outcome := 'miss';
  else
    v_base := v_cp * v_wmult * (0.85 + random() * 0.30);
    v_base := v_base * v_buff * v_debuff;
    v_base := v_base * v_synmult;                                                     -- squad element synergy
    if 'armored' = any(v_plist) and 'trait:melee' = any(v_tags) then v_base := v_base * 0.72; end if;  -- armored boss
    if v_exp_until >= v_round and v_expose > 0 then v_base := v_base * (1 + v_expose); end if;
    if v_aeff = 'execute' and v_hp < v_athresh * v_hpmax then v_base := v_base * (1 + v_aamt); end if;
    if v_crit  then v_base := v_base * 2;   end if;
    if v_block then v_base := v_base * 0.5; end if;
    v_dmg := greatest(1, round(v_base));
    v_outcome := case when v_crit then 'crit' when v_block then 'blocked' else 'hit' end;
    -- Rampage (an attack ability): amount = the chance of a second strike (no crit / block).
    if v_aeff = 'rampage' and random() < v_aamt then
      v_dmg := v_dmg + greatest(1, round(v_base / (case when v_crit then 2 else 1 end) / (case when v_block then 0.5 else 1 end)));
      v_double := true;
    end if;
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
    v_heal := greatest(1, least(round(v_dmg * v_aamt), round(v_maxhp * 0.06)));  -- cap: lifesteal cannot out-heal the boss
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
    v_bmult := 1;
    if v_enr_until >= v_round and v_enrage > 0 then v_bmult := v_bmult * v_enrage; end if;
    if v_wk_until  >= v_round and v_weaken > 0 then v_bmult := v_bmult * (1 - v_weaken); end if;
    if 'volatile' = any(v_plist) then v_bmult := v_bmult * 1.25; end if;                       -- volatile boss

    -- Phase 1 below 50% HP: permanent rage. Frenzied: +5% per 10% of HP lost.
    v_lost := 1 - v_hp::numeric / greatest(1, v_hpmax);
    if v_lost >= 0.5 then v_bmult := v_bmult * 1.3; end if;
    if 'frenzied' = any(v_plist) then v_bmult := v_bmult * (1 + 0.05 * floor(v_lost * 10)); end if;
    v_bheal := 0;

    if v_stun_until >= v_round then
      v_bossact := 'stunned';
    elsif v_round % 8 = 7 then
      v_bossact := 'charging';                      -- the Cataclysm is shown one round ahead
    elsif v_round % 8 = 0 then
      v_bossact := 'cataclysm';                     -- ATK x 0.75 to every card still standing
      v_cdmg := greatest(1, round(v_atk * 0.75 * (0.85 + random() * 0.30) * v_bmult));
      v_absorb := least(v_shield, v_cdmg); v_shield := v_shield - v_absorb; v_cdmg := v_cdmg - v_absorb;
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
      with tgt as (
        select h.card_id, greatest(0, h.raw - coalesce(h.shield, 0)) as dmg,
               greatest(0, coalesce(h.shield, 0) - h.raw) as shleft
               from (select x.*, greatest(1, round(v_atk * 0.75 * (0.85 + random() * 0.30) * v_bmult)) as raw
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
    else
      v_r := random();
      if v_r < 0.40 then
        v_bossact := 'strike';                      -- ATK x 1.0
        v_cdmg := greatest(1, round(v_atk * 1.00 * (0.85 + random() * 0.30) * v_bmult));
        v_absorb := least(v_shield, v_cdmg); v_shield := v_shield - v_absorb; v_cdmg := v_cdmg - v_absorb;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      elsif v_r < 0.62 then
        v_bossact := 'slam';                        -- ATK x 0.35 to every card
        v_cdmg := greatest(1, round(v_atk * 0.35 * (0.85 + random() * 0.30) * v_bmult));
        v_absorb := least(v_shield, v_cdmg); v_shield := v_shield - v_absorb; v_cdmg := v_cdmg - v_absorb;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
        with tgt as (
          select h.card_id, greatest(0, h.raw - coalesce(h.shield, 0)) as dmg,
                 greatest(0, coalesce(h.shield, 0) - h.raw) as shleft
                 from (select x.*, greatest(1, round(v_atk * 0.35 * (0.85 + random() * 0.30) * v_bmult)) as raw
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
      elsif v_r < 0.72 then
        v_bossact := 'drain';                       -- ATK x 0.8, heals 1.5% of a player's share
        v_cdmg := greatest(1, round(v_atk * 0.80 * (0.85 + random() * 0.30) * v_bmult));
        v_absorb := least(v_shield, v_cdmg); v_shield := v_shield - v_absorb; v_cdmg := v_cdmg - v_absorb;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
        v_bheal := v_bheal + greatest(1, round(v_share * 0.015));
      elsif v_r < 0.80 then
        v_bossact := 'stun';                        -- ATK x 0.45 and the card waits one round
        v_cdmg := greatest(1, round(v_atk * 0.45 * (0.85 + random() * 0.30) * v_bmult));
        v_absorb := least(v_shield, v_cdmg); v_shield := v_shield - v_absorb; v_cdmg := v_cdmg - v_absorb;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      elsif v_r < 0.87 then
        v_bossact := 'enrage';
        update hunt_combat_state set boss_enrage = 1.4, enrage_until = v_round + 2, updated_at = now()
          where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      elsif v_r < 0.93 then
        v_bossact := 'curse';
        v_debuff := 0.7;
      else
        v_bossact := 'regenerate';                  -- 3% of a player's share, 5% below 50% HP
        v_bheal := v_bheal + greatest(1, round(v_share * case when v_lost >= 0.5 then 0.05 else 0.03 end));
      end if;
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + greatest(1, round(v_share * 0.005)); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * 0.10)));
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
  if 'flaming' = any(v_plist) and v_status <> 'defeated' and random() < 0.30 then
    v_burn := greatest(1, round(v_atk * 0.40 * (0.85 + random() * 0.30)));
    v_absorb := least(v_shield, v_burn); v_shield := v_shield - v_absorb; v_burn := v_burn - v_absorb;
    v_cardhp := greatest(0, v_cardhp - v_burn); v_burned := v_burn > 0;
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
  if v_downed and v_status <> 'defeated' and hunt_squad_done(p_hunt, p_player, v_day, v_cap)
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
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed, 'shield', v_shield,
    'burned', v_burned, 'double', v_double, 'rally', v_rally, 'mend', v_mend, 'party', v_party->'amount', 'crashed', nullif(v_crash_dmg, 0), 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
    'synergy', case when v_syn >= 3 then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', v_bossact, 'round', v_round, 'targets', v_targets) end);
end $function$;
