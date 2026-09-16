-- Hunt Discord notifications (2026-09-15): an outbox table the game logic writes to and
-- the bot posts to the notifications channel. Four events:
--   spawn   -> the boss appeared (Thursday)
--   nudge   -> a reminder a few hours before the Monday deadline
--   defeat  -> the boss was destroyed + the weighted reward payout
--   expired -> the boss escaped (a lost week), with the consolation payout
-- Plus a per-attack feed (damage + card used), volume-guarded by settings.hunt_attack_feed
--   'all' | 'milestones' | 'off'  (default 'milestones' to avoid channel flooding).
-- This file also fixes a real gap: a boss defeated mid-week was never settled, so its
-- rewards were never paid. hunt_attack now settles on the killing blow (idempotent).

create table if not exists hunt_events (
  id         bigserial primary key,
  hunt_id    bigint not null,
  kind       text not null,                 -- spawn | nudge | defeat | expired | attack
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  posted_at  timestamptz
);
alter table hunt_events enable row level security;  -- service-role only; deny anon
create index if not exists hunt_events_unposted on hunt_events (id) where posted_at is null;

insert into settings (key, value) values ('hunt_attack_feed', '"milestones"'::jsonb)
  on conflict (key) do nothing;
insert into settings (key, value) values ('hunt_daily_card_cap', '8'::jsonb)
  on conflict (key) do nothing;

-- Spawn (Thursday): snapshot + spawn + deadline + a 'spawn' event.
create or replace function spawn_weekly_boss()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_snap bigint; v_new bigint; v_close timestamptz;
        v_name text; v_tier text; v_hp bigint; v_weak jsonb;
begin
  v_snap  := roster_snapshot();
  v_new   := spawn_hunt(7);
  v_close := next_hunt_close();
  update hunts set closes_at = v_close where id = v_new;
  select name, tier, hp_max, weak_points into v_name, v_tier, v_hp, v_weak from hunts where id = v_new;
  insert into hunt_events (hunt_id, kind, payload)
    values (v_new, 'spawn', jsonb_build_object('name', v_name, 'tier', v_tier,
      'hp', v_hp, 'closes_at', v_close, 'weak', v_weak));
  return jsonb_build_object('ok', true, 'new', v_new, 'snapshot', v_snap, 'closes_at', v_close);
end $$;

-- Nudge (Monday, a few hours before close): remind the channel if a boss still lives.
create or replace function nudge_hunt()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_id bigint; v_name text; v_close timestamptz; v_hp bigint; v_max bigint;
begin
  select id, name, closes_at, hp_remaining, hp_max into v_id, v_name, v_close, v_hp, v_max
    from hunts where status = 'active' order by id desc limit 1;
  if v_id is null then return jsonb_build_object('ok', true, 'note', 'no_active'); end if;
  insert into hunt_events (hunt_id, kind, payload)
    values (v_id, 'nudge', jsonb_build_object('name', v_name, 'closes_at', v_close,
      'hp_remaining', v_hp, 'hp_max', v_max));
  return jsonb_build_object('ok', true, 'nudged', v_id);
end $$;

-- Close (Monday evening): expire + settle the loss + an 'expired' event. No respawn.
create or replace function close_weekly_boss()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_old bigint; v_settle jsonb; v_name text;
begin
  select id, name into v_old, v_name from hunts where status = 'active' order by id desc limit 1;
  if v_old is null then return jsonb_build_object('ok', true, 'note', 'no_active_hunt'); end if;
  update hunts set status = 'expired' where id = v_old and status = 'active';
  v_settle := settle_hunt(v_old);
  insert into hunt_events (hunt_id, kind, payload)
    values (v_old, 'expired', jsonb_build_object('name', v_name, 'settle', v_settle,
      'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
              from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = v_old
                    group by player_id order by sum(damage) desc limit 3) t)));
  return jsonb_build_object('ok', true, 'closed', v_old, 'settled', v_settle);
end $$;

-- Attack (recreate with settle-on-defeat + notification events).
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

  -- Only living cards attack. Item / Place / Moment are support types (power-up / debuff
  -- abilities are not built yet), so they cannot damage the boss.
  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'utc')::date;
  v_cp := card_power(v_rarity, v_asc, v_mod);
  v_maxhp := card_max_hp(v_cp);

  -- The card fights until the boss counter downs it (the stamina model). Read its state
  -- for today. A downed card cannot attack again until the daily reset.
  select hp_remaining, downed into v_cardhp, v_downed
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then
    -- A card not committed yet today. Enforce the daily squad cap (distinct cards).
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

  v_tmult := case v_tier when 'Heroic' then 1.25 when 'Mythic' then 1.6 else 1.0 end;
  v_counter := (v_status <> 'defeated') and random() < 0.45;   -- boss hits back more often
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

  insert into hunt_combat_log (hunt_id, player_id, card_id, cp, outcome, bonus, crit, block,
    damage, countered, counter_dmg, card_hp_after, card_downed, boss_hp_after)
  values (p_hunt, p_player, p_card, v_cp, v_outcome, v_bonus, v_crit, v_block,
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp);

  -- Rewards on the killing blow: settle once (idempotent) + a 'defeat' notification.
  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  -- Per-attack feed (volume-guarded). The killing blow is covered by 'defeat', not here.
  select coalesce((select value #>> '{}' from settings where key = 'hunt_attack_feed'), 'milestones') into v_feed;
  v_milestone := v_crit or v_downed;   -- weak-point (x2) is too common; keep the channel quiet
  if v_status <> 'defeated' and not v_miss
     and (v_feed = 'all' or (v_feed = 'milestones' and v_milestone)) then
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'attack', jsonb_build_object('player_id', p_player, 'card', v_cardname,
        'damage', v_dmg, 'outcome', v_outcome, 'crit', v_crit, 'bonus', v_bonus, 'downed', v_downed));
  end if;

  -- Player done-summary: when the team is wiped (the full squad is committed and every
  -- committed card is downed), post one recap (total damage today + top card).
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

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'crit', v_crit, 'cp', v_cp,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed);
end $$;

notify pgrst, 'reload schema';
