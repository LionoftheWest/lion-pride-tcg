-- Turn-based battle, Phase 1 (2026-09-16). The attack ends the round; the boss then draws
-- ONE hidden action from its pool (Strike single-target, Slam area) and it lands as a
-- surprise. Replaces the old 45% reactive counter (the boss now acts every round). This
-- also lays the state foundation (round counter + per-card status columns) for phases 2-3.
-- See discord/docs/battle-turn-based.md.

create table if not exists hunt_combat_state (
  hunt_id      bigint not null,
  player_id    text not null,
  hit_date     date not null,
  round        int not null default 0,
  boss_enrage  numeric not null default 1.0,   -- phase 2 (Enrage self-buff)
  enrage_until int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (hunt_id, player_id, hit_date)
);
alter table hunt_combat_state enable row level security;  -- service-role only

-- Per-card status for the day (used from phase 3; added now so the schema is ready).
alter table hunt_card_hp add column if not exists shield        int not null default 0;
alter table hunt_card_hp add column if not exists dmg_buff      numeric not null default 1.0;
alter table hunt_card_hp add column if not exists dmg_debuff    numeric not null default 1.0;
alter table hunt_card_hp add column if not exists cd_until_round int not null default 0;

create or replace function hunt_attack(p_player text, p_hunt bigint, p_card bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_season text; v_type text; v_mod numeric; v_cardname text;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
  v_feed text; v_settle jsonb; v_milestone boolean;
  v_total bigint; v_used int; v_topcard text; v_topdmg bigint; v_cap int;
  v_bossact text; v_slam jsonb; v_round int; v_targets jsonb;
begin
  select status, closes_at, weak_points, tier into v_status, v_closes, v_weak, v_tier
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;

  select pc.quantity, pc.ascension, c.rarity::text, c.season, s.type, s.cp_mod, c.name
    into v_qty, v_asc, v_rarity, v_season, v_type, v_mod, v_cardname
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;

  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'utc')::date;
  v_cp := card_power(v_rarity, v_asc, v_mod);
  v_maxhp := card_max_hp(v_cp);

  select hp_remaining, downed into v_cardhp, v_downed
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then
    v_cardhp := v_maxhp; v_downed := false;
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

  v_bonus := exists (select 1 from jsonb_array_elements(v_weak) w
    where (w->>'kind' = 'type'   and w->>'value' = v_type)
       or (w->>'kind' = 'rarity' and w->>'value' = v_rarity)
       or (w->>'kind' = 'season' and w->>'value' = v_season));

  v_miss  := random() < 0.08;
  v_crit  := (not v_miss) and random() < (case when v_bonus then 0.20 else 0.10 end);
  v_block := (not v_miss) and (not v_crit) and random() < 0.12;
  if v_miss then
    v_dmg := 0; v_outcome := 'miss';
  else
    v_base := v_cp * (case when v_bonus then 2 else 1 end) * (0.85 + random() * 0.30);
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

  -- ===== Boss turn: draw ONE hidden action from the pool (Strike / Slam). =====
  v_tmult := case v_tier when 'Heroic' then 1.25 when 'Mythic' then 1.6 else 1.0 end;
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    insert into hunt_combat_state (hunt_id, player_id, hit_date, round)
      values (p_hunt, p_player, v_day, 1)
      on conflict (hunt_id, player_id, hit_date)
      do update set round = hunt_combat_state.round + 1, updated_at = now()
      returning round into v_round;

    if random() < 0.65 then
      v_bossact := 'strike';                                            -- single target: the attacker
      v_cdmg := greatest(1, round(v_maxhp * (0.10 + random() * 0.10) * v_tmult));
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
    else
      v_bossact := 'slam';                                             -- area: every engaged card
      v_cdmg := greatest(1, round(v_maxhp * (0.05 + random() * 0.05) * v_tmult));  -- the attacker's share
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
      with tgt as (
        select h.card_id, greatest(1, round(h.max_hp * (0.05 + random() * 0.05) * v_tmult)) as dmg
        from hunt_card_hp h
        where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day
          and h.card_id <> p_card and not h.downed
      ), upd as (
        update hunt_card_hp h
          set hp_remaining = greatest(0, h.hp_remaining - t.dmg),
              downed = (h.hp_remaining - t.dmg) <= 0, updated_at = now()
        from tgt t
        where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = t.card_id
        returning h.card_id, h.hp_remaining, h.max_hp, h.downed, t.dmg
      )
      select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'dmg', dmg,
               'hp', hp_remaining, 'max_hp', max_hp, 'downed', downed)), '[]'::jsonb)
        into v_slam from upd;
    end if;
  end if;
  v_downed := v_cardhp <= 0;
  v_counter := v_bossact is not null;   -- the boss acted this round (kept for the log/feed)

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed, updated_at = now();

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
  if v_status <> 'defeated' and not v_miss
     and (v_feed = 'all' or (v_feed = 'milestones' and v_milestone)) then
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
      from (select card_id, sum(damage) d from hunt_hits
            where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
            group by card_id order by d desc limit 1) sub
      join cards c on c.id = sub.card_id;
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'player_done', jsonb_build_object('player_id', p_player,
        'total', v_total, 'cards_used', v_used, 'top_card', v_topcard, 'top_damage', v_topdmg,
        'boss_hp', v_hp, 'boss_hp_max', (select hp_max from hunts where id = p_hunt)));
  end if;

  -- The attacker is always in the target list; Slam adds the other engaged cards.
  v_targets := jsonb_build_array(jsonb_build_object('card_id', p_card, 'dmg', v_cdmg,
      'hp', v_cardhp, 'max_hp', v_maxhp, 'downed', v_downed)) || coalesce(v_slam, '[]'::jsonb);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'crit', v_crit, 'cp', v_cp,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', v_bossact, 'round', v_round, 'targets', v_targets) end);
end $$;

notify pgrst, 'reload schema';
