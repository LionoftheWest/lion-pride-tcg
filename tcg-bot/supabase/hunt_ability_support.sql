-- Ability engine, part 1 (2026-09-16): the hunt_support RPC fires a support card's ability
-- (Item/Place/Moment) with a cooldown, and writes the resulting status that hunt_attack
-- then consumes. See discord/docs/battle-turn-based.md.

-- Boss-side status carried on the per-player/day combat state.
alter table hunt_combat_state add column if not exists boss_weaken   numeric not null default 0;  -- boss deals -X for N rounds
alter table hunt_combat_state add column if not exists weaken_until  int not null default 0;
alter table hunt_combat_state add column if not exists boss_expose   numeric not null default 0;  -- boss takes +X for N rounds
alter table hunt_combat_state add column if not exists expose_until  int not null default 0;
alter table hunt_combat_state add column if not exists stunned_until int not null default 0;       -- boss skips its turn through this round

-- Ensure a combat-state row exists for this player/day, return the current round.
create or replace function hunt_state_round(p_hunt bigint, p_player text, p_day date)
returns int language plpgsql security invoker set search_path = public as $$
declare v_round int;
begin
  insert into hunt_combat_state (hunt_id, player_id, hit_date, round)
    values (p_hunt, p_player, p_day, 0)
    on conflict (hunt_id, player_id, hit_date) do nothing;
  select round into v_round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  return coalesce(v_round, 0);
end $$;

-- Commit a card into today's squad (an hp row) if it is not there yet, enforcing the cap.
-- Returns true on success, false if the daily cap is already full.
create or replace function hunt_commit_card(p_hunt bigint, p_player text, p_card bigint, p_day date, p_maxhp int)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_cap int;
begin
  if exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = p_day) then
    return true;
  end if;
  select coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8) into v_cap;
  if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = p_day) >= v_cap then
    return false;
  end if;
  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
    values (p_hunt, p_player, p_card, p_day, p_maxhp, p_maxhp, false)
    on conflict (hunt_id, player_id, card_id, hit_date) do nothing;
  return true;
end $$;

create or replace function hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_closes timestamptz; v_tier text; v_hp bigint;
  v_qty int; v_type text; v_ability jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text;
  v_day date; v_round int; v_cd_until int; v_cap int; v_maxhp int;
  v_tqty int; v_trar text; v_tasc int; v_tmod numeric; v_tmaxhp int; v_tcp int;
begin
  select status, closes_at, tier into v_status, v_closes, v_tier from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;

  select pc.quantity, s.type, s.ability into v_qty, v_type, v_ability
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_ability is null or v_ability->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;

  v_eff := v_ability->>'effect';
  v_amt := coalesce((v_ability->>'amount')::numeric, 0);
  v_dur := coalesce((v_ability->>'duration')::int, 1);
  v_cd  := coalesce((v_ability->>'cooldown')::int, 1);
  v_tgt := coalesce(v_ability->>'target', 'boss');
  v_day := (now() at time zone 'utc')::date;
  v_round := hunt_state_round(p_hunt, p_player, v_day);

  -- cooldown check (the support card's own row stores cd_until_round)
  select cd_until_round into v_cd_until from hunt_card_hp
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if found and v_round < coalesce(v_cd_until, 0) then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', v_cd_until, 'round', v_round);
  end if;

  -- commit the support card into today's squad (counts toward the cap)
  v_maxhp := 30;
  if not hunt_commit_card(p_hunt, p_player, p_card, v_day, v_maxhp) then
    return jsonb_build_object('ok', false, 'error', 'day_limit');
  end if;

  -- resolve ally-targeted effects (need a committed target row)
  if v_tgt in ('ally', 'self') then
    if p_target is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    select pc.quantity, c.rarity::text, pc.ascension, s.cp_mod into v_tqty, v_trar, v_tasc, v_tmod
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_target;
    if not found or v_tqty < 1 then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    v_tcp := card_power(v_trar, v_tasc, v_tmod);
    v_tmaxhp := card_max_hp(v_tcp);
    perform hunt_commit_card(p_hunt, p_player, p_target, v_day, v_tmaxhp);

    if v_eff = 'empower' then
      update hunt_card_hp set dmg_buff = 1 + v_amt, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'shield' then
      update hunt_card_hp set shield = shield + v_amt::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'heal' then
      update hunt_card_hp set hp_remaining = least(max_hp, hp_remaining + v_amt::int),
        downed = (least(max_hp, hp_remaining + v_amt::int) <= 0), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    else
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;

  -- boss-targeted / team effects
  elsif v_eff = 'weaken' then
    update hunt_combat_state set boss_weaken = v_amt, weaken_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'expose' then
    update hunt_combat_state set boss_expose = v_amt, expose_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'stun' then
    update hunt_combat_state set stunned_until = v_round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'cleanse' then
    update hunt_card_hp set dmg_debuff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
  elsif v_eff = 'smite' then
    update hunts set hp_remaining = greatest(0, hp_remaining - v_amt::int),
      status = case when hp_remaining - v_amt::int <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_amt::int <= 0 then now() else defeated_at end
      where id = p_hunt;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, p_card, v_day, v_amt::int)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
    select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;
    if v_status = 'defeated' then perform settle_hunt(p_hunt); end if;
  else
    return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
  end if;

  -- set the support's cooldown
  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated');
end $$;

notify pgrst, 'reload schema';
