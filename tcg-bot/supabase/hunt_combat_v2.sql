-- Phase 2 COMBAT v2: STAMINA + DnD-style rolls + boss counterattack (2026-09-15).
-- Cards attack FREELY (no more once/day rest). Each card has a daily HP pool; the boss
-- counters on a chance and chips it; at 0 HP the card is DOWNED until the UTC daily
-- reset. Your hit rolls miss / block / crit with damage variance. All knobs here,
-- tunable. Additive; still behind FEATURE_HUNT.

create table if not exists hunt_card_hp (
  hunt_id      bigint not null references hunts(id) on delete cascade,
  player_id    text not null,
  card_id      bigint not null,
  hit_date     date not null,
  hp_remaining int not null,
  max_hp       int not null,
  downed       boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (hunt_id, player_id, card_id, hit_date)
);
alter table hunt_card_hp enable row level security;  -- service-role only; deny anon (no policies)

-- A card's daily HP pool, derived from its CP (tunable).
create or replace function card_max_hp(p_cp int)
returns int language sql immutable set search_path = public as $$
  select greatest(30, round(p_cp * 1.8))::int;
$$;

-- Stamina model = many hits per card per day, so accumulate instead of blocking.
alter table hunt_hits drop constraint if exists hunt_hits_hunt_id_player_id_card_id_hit_date_key;
create unique index if not exists hunt_hits_daily on hunt_hits (hunt_id, player_id, card_id, hit_date);

create or replace function hunt_attack(p_player text, p_hunt bigint, p_card bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_season text; v_type text; v_mod numeric;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
begin
  select status, closes_at, weak_points, tier into v_status, v_closes, v_weak, v_tier
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;

  select pc.quantity, pc.ascension, c.rarity::text, c.season, s.type, s.cp_mod
    into v_qty, v_asc, v_rarity, v_season, v_type, v_mod
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;

  v_day := (now() at time zone 'utc')::date;
  v_cp := card_power(v_rarity, v_asc, v_mod);
  v_maxhp := card_max_hp(v_cp);

  select hp_remaining, downed into v_cardhp, v_downed
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then v_cardhp := v_maxhp; v_downed := false; end if;
  if v_downed or v_cardhp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'downed', 'card_hp', 0, 'card_max_hp', v_maxhp);
  end if;

  v_bonus := exists (select 1 from jsonb_array_elements(v_weak) w
    where (w->>'kind' = 'type'   and w->>'value' = v_type)
       or (w->>'kind' = 'rarity' and w->>'value' = v_rarity)
       or (w->>'kind' = 'season' and w->>'value' = v_season));

  -- ---- resolve YOUR hit (DnD-style rolls) ----
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

  -- ---- boss counterattack (chance; never if it just died) ----
  v_tmult := case v_tier when 'Heroic' then 1.25 when 'Mythic' then 1.6 else 1.0 end;
  v_counter := (v_status <> 'defeated') and random() < 0.30;
  v_cdmg := 0;
  if v_counter then
    v_cdmg := greatest(1, round(v_maxhp * (0.14 + random() * 0.16) * v_tmult));
    v_cardhp := greatest(0, v_cardhp - v_cdmg);
  end if;
  v_downed := v_cardhp <= 0;

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed, updated_at = now();

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'crit', v_crit, 'cp', v_cp,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed);
end $$;

notify pgrst, 'reload schema';
