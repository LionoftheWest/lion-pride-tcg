-- Tag synergies + boss passives (2026-09-18). Two additions to the tag battle engine:
--   1. BOSS PASSIVE: each Heroic/Mythic boss carries one passive tied to its threat —
--      armored (melee attackers deal less), shrouded (attacks miss more), flaming (burns
--      the attacking card), volatile (counters hit harder). Stored on hunts.passive,
--      assigned at spawn, applied in hunt_attack, shown as a chip in the client.
--   2. SQUAD ELEMENT SYNERGY: when 3+ of a player's committed cards share the attacker's
--      element, the attack gets a small team bonus (+12% at 3, +20% at 5). It is separate
--      from and gentler than the weak-tag path, and the weak-tag soft cap still applies,
--      so a themed squad is rewarded without a single mono-stack dominating.
-- See discord/docs/card-tags-and-battle-engine.md.

alter table hunts add column if not exists passive jsonb not null default '{}'::jsonb;

-- Spawn: same HP + weak/resist tag rotation as before, now also assigns a boss passive.
create or replace function spawn_hunt(p_days int default 3)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_players int; v_tier text; v_nweak int; v_nresist int; v_tiermult numeric;
  v_weak jsonb; v_resist jsonb; v_hp bigint; v_name text; v_id bigint; v_pow bigint;
  v_pool text[]; v_recent text[]; v_fresh text[]; v_weaktags text[]; v_resisttags text[];
  v_passive jsonb; v_pk text;
  v_plabels jsonb := jsonb_build_object(
    'armored',  'Armored: melee attackers deal less',
    'shrouded', 'Shrouded: attacks miss more often',
    'flaming',  'Flaming: burns the attacking card',
    'volatile', 'Volatile: counterattacks hit harder');
  c_names text[] := array['The Salt Kraken','The Lag Beast','The Tilt Titan','Server Gremlin',
                          'The Whiff Wyrm','Rage-Quit Revenant','The Ping Phantom','Meta Hydra',
                          'The Desync Dragon','Frame-Drop Fiend'];
begin
  update hunts set status = 'expired' where status = 'active';
  select greatest(1, count(*)) into v_players from players;
  v_tier := (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)];
  v_tiermult := case v_tier when 'Normal' then 8 when 'Heroic' then 12 else 15 end;
  v_nweak   := case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end;
  v_nresist := case v_tier when 'Normal' then 0 when 'Heroic' then 1 else 2 end;

  select array_agg(distinct slug) into v_pool from (
    select unnest(s.tag_slugs) slug from subjects s
    where s.tags->>'class' = 'attacker'
      and exists (select 1 from cards c where c.subject_id = s.id and c.in_draw_pool)
  ) t where slug like 'trait:%' or slug like 'origin:%';

  select coalesce(array_agg(distinct e->>'value'), '{}') into v_recent
  from (select weak_points from hunts order by id desc limit 4) h,
       lateral jsonb_array_elements(coalesce(h.weak_points, '[]'::jsonb)) e
  where e->>'kind' = 'tag';

  if v_pool is null or array_length(v_pool, 1) is null then
    v_weak := '[]'::jsonb; v_resist := '[]'::jsonb;
  else
    select coalesce(array_agg(p), '{}') into v_fresh
      from unnest(v_pool) p where p <> all(v_recent);
    select array_agg(t) into v_weaktags from (
      select t from unnest(case when coalesce(array_length(v_fresh, 1), 0) >= v_nweak then v_fresh else v_pool end) t
      order by random() limit v_nweak) x;
    select array_agg(t) into v_resisttags from (
      select t from unnest(v_pool) t where t <> all(coalesce(v_weaktags, '{}'))
      order by random() limit v_nresist) x;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'tag', 'value', t)), '[]'::jsonb)
      into v_weak from unnest(coalesce(v_weaktags, '{}')) t;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'tag', 'value', t)), '[]'::jsonb)
      into v_resist from unnest(coalesce(v_resisttags, '{}')) t;
  end if;

  -- Boss passive: none on Normal; one random passive on Heroic; volatile also possible on Mythic.
  if v_tier = 'Normal' then
    v_passive := '{}'::jsonb;
  else
    v_pk := case v_tier
      when 'Mythic' then (array['armored','shrouded','flaming','volatile'])[1 + floor(random() * 4)]
      else (array['armored','shrouded','flaming'])[1 + floor(random() * 3)] end;
    v_passive := jsonb_build_object('kind', v_pk, 'label', v_plabels->>v_pk);
  end if;

  v_pow := deployable_power();
  v_hp := greatest(500, round(v_pow * v_tiermult));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at)
    values (v_name, v_tier, v_weak, v_resist, v_passive, v_hp, v_hp, now() + make_interval(days => p_days))
    returning id into v_id;
  return v_id;
end $$;

-- Attack: adds boss-passive effects + squad element synergy on top of the existing engine.
create or replace function hunt_attack(p_player text, p_hunt bigint, p_card bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
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
  v_passive jsonb; v_pk text; v_elem text; v_syn int; v_synmult numeric; v_burn int; v_burned boolean;
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  v_pk := v_passive->>'kind';

  select pc.quantity, pc.ascension, c.rarity::text, c.season, s.type, s.cp_mod, c.name, s.ability, s.tag_slugs
    into v_qty, v_asc, v_rarity, v_season, v_type, v_mod, v_cardname, v_ability, v_tags
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'utc')::date;
  v_cp := card_power(v_rarity, v_asc, v_mod);
  v_maxhp := card_max_hp(v_cp);

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

  v_critchance := (case when v_bonus then 0.20 else 0.10 end) + (case when v_aeff = 'focus' then v_aamt else 0 end);
  v_miss  := random() < (0.08 + case when v_pk = 'shrouded' then 0.10 else 0 end);   -- shrouded: more misses
  v_crit  := (not v_miss) and random() < v_critchance;
  v_block := (not v_miss) and (not v_crit) and (v_aeff <> 'pierce' or v_aeff is null) and random() < 0.12;
  if v_miss then
    v_dmg := 0; v_outcome := 'miss';
  else
    v_base := v_cp * v_wmult * (0.85 + random() * 0.30);
    v_base := v_base * v_buff * v_debuff;
    v_base := v_base * v_synmult;                                                     -- squad element synergy
    if v_pk = 'armored' and 'trait:melee' = any(v_tags) then v_base := v_base * 0.72; end if;  -- armored boss
    if v_exp_until >= v_round and v_expose > 0 then v_base := v_base * (1 + v_expose); end if;
    if v_aeff = 'execute' and v_hp < v_athresh * v_hpmax then v_base := v_base * (1 + v_aamt); end if;
    if v_crit  then v_base := v_base * 2;   end if;
    if v_block then v_base := v_base * 0.5; end if;
    v_dmg := greatest(1, round(v_base));
    v_outcome := case when v_crit then 'crit' when v_block then 'blocked' else 'hit' end;
  end if;

  if v_dmg > 0 then
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
      values (p_hunt, p_player, p_card, v_day, v_dmg)
      on conflict (hunt_id, player_id, card_id, hit_date)
      do update set damage = hunt_hits.damage + excluded.damage;
    update hunts set hp_remaining = greatest(0, hp_remaining - v_dmg),
      status      = case when hp_remaining - v_dmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_dmg <= 0 then now() else defeated_at end
      where id = p_hunt;
  end if;
  select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;

  v_heal := 0;
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := greatest(1, round(v_dmg * v_aamt));
    v_cardhp := least(v_maxhp, v_cardhp + v_heal);
  end if;
  v_buff := 1;

  v_tmult := case v_tier when 'Heroic' then 1.25 when 'Mythic' then 1.6 else 1.0 end;
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    update hunt_combat_state set round = round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
      returning round into v_round;
    v_bmult := 1;
    if v_enr_until >= v_round and v_enrage > 0 then v_bmult := v_bmult * v_enrage; end if;
    if v_wk_until  >= v_round and v_weaken > 0 then v_bmult := v_bmult * (1 - v_weaken); end if;
    if v_pk = 'volatile' then v_bmult := v_bmult * 1.25; end if;                       -- volatile boss

    if v_stun_until >= v_round then
      v_bossact := 'stunned';
    else
      v_r := random();
      if v_r < 0.55 then
        v_bossact := 'strike';
        v_cdmg := greatest(1, round(v_maxhp * (0.10 + random() * 0.10) * v_tmult * v_bmult));
        v_absorb := least(v_shield, v_cdmg); v_shield := v_shield - v_absorb; v_cdmg := v_cdmg - v_absorb;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      elsif v_r < 0.80 then
        v_bossact := 'slam';
        v_cdmg := greatest(1, round(v_maxhp * (0.05 + random() * 0.05) * v_tmult * v_bmult));
        v_absorb := least(v_shield, v_cdmg); v_shield := v_shield - v_absorb; v_cdmg := v_cdmg - v_absorb;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
        with tgt as (
          select h.card_id, greatest(0, greatest(1, round(h.max_hp * (0.05 + random() * 0.05) * v_tmult * v_bmult)) - coalesce(h.shield, 0)) as dmg,
                 greatest(0, coalesce(h.shield, 0) - greatest(1, round(h.max_hp * (0.05 + random() * 0.05) * v_tmult * v_bmult))) as shleft
          from hunt_card_hp h
          where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card and not h.downed
        ), upd as (
          update hunt_card_hp h set hp_remaining = greatest(0, h.hp_remaining - t.dmg),
              shield = t.shleft, downed = (h.hp_remaining - t.dmg) <= 0, updated_at = now()
          from tgt t where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = t.card_id
          returning h.card_id, h.hp_remaining, h.max_hp, h.downed, t.dmg
        )
        select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'dmg', dmg, 'hp', hp_remaining, 'max_hp', max_hp, 'downed', downed)), '[]'::jsonb)
          into v_slam from upd;
      elsif v_r < 0.90 then
        v_bossact := 'enrage';
        update hunt_combat_state set boss_enrage = 1.4, enrage_until = v_round + 2, updated_at = now()
          where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      else
        v_bossact := 'curse';
        v_debuff := 0.7;
      end if;
    end if;
  end if;

  -- Flaming boss: a chance the attacking card catches burn after acting.
  v_burned := false;
  if v_pk = 'flaming' and v_status <> 'defeated' and random() < 0.30 then
    v_burn := greatest(1, round(v_maxhp * 0.10));
    v_absorb := least(v_shield, v_burn); v_shield := v_shield - v_absorb; v_burn := v_burn - v_absorb;
    v_cardhp := greatest(0, v_cardhp - v_burn); v_burned := v_burn > 0;
  end if;

  v_downed := v_cardhp <= 0;
  v_counter := v_bossact is not null and v_bossact not in ('stunned', 'enrage', 'curse');

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, dmg_buff, dmg_debuff, shield)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed, v_buff, v_debuff, v_shield)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed,
      dmg_buff = excluded.dmg_buff, dmg_debuff = excluded.dmg_debuff, shield = excluded.shield, updated_at = now();

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

  if v_downed and v_status <> 'defeated'
     and (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap
     and not exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and not downed) then
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
    'burned', v_burned,
    'synergy', case when v_syn >= 3 then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', v_bossact, 'round', v_round, 'targets', v_targets) end);
end $$;

notify pgrst, 'reload schema';
