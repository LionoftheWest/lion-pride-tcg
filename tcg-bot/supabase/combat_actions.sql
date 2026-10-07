-- The shared combat action log (Nathan, 2026-10-06, option B): one table for the actions of every mode.
-- The combat RULES are shared already (combat_core.sql); the RECORDS were split by mode: the Dungeon and the Gauntlet
-- log every action in dungeon_log, but the Hunt logged attacks only (hunt_combat_log) and no support play at all.
-- Now: hunt_support writes one row for each support play that worked. Later, one reader at a time: the Hunt attacks
-- and the Dungeon log move into this table too (no reader changes in this file).
--   mode, ref_id    'hunt' + the hunt id (later 'dungeon' / 'gauntlet' + the run id)
--   kind            'support' (later 'attack')
--   effect, amount  the support effect and its amount after potency and the affinity match
--   result          the applied value, the affinity scale and match, the cooldown, the target card after the play
-- hunt_support is rebuilt from its LIVE text with the insert only; the guard refuses if the live function changed.
-- Test: card-studio/scripts/test-combat-actions.mjs.
do $g$ begin
  -- balance_table.sql (2026-10-03): the functions below read public.balance, so it must exist first.
  if to_regclass('public.balance') is null then
    raise exception '%: apply balance_table.sql first (these functions read the balance table)', 'combat_actions.sql';
  end if;
  if md5(replace(pg_get_functiondef('public.hunt_support'::regproc), chr(13), '')) not in ('beb6c2738ef2b0966054234c13fa1085', 'ef5d2c1a5eb74bf430cd2ddce1c7af84') then
    raise exception 'combat_actions.sql: the live hunt_support changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;

create table if not exists public.combat_actions (
  id          bigint generated always as identity primary key,
  mode        text not null check (mode in ('hunt', 'dungeon', 'gauntlet')),
  ref_id      bigint not null,
  player_id   text not null references public.players(id) on delete cascade,
  card_id     bigint references public.cards(id),
  kind        text not null check (kind in ('attack', 'support')),
  game_day    date not null,
  round       int,
  effect      text,
  amount      numeric,
  target_card bigint,
  target_foe  int,
  result      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists combat_actions_ref on public.combat_actions (mode, ref_id, created_at);
create index if not exists combat_actions_player on public.combat_actions (player_id, created_at);
alter table public.combat_actions enable row level security;
revoke all on public.combat_actions from anon, authenticated;   -- closed to the API roles (the server reads it); lockdown_grants.sql agrees

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
  v_settle jsonb;
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
    if v_matched then v_amt := v_amt * balance_num('support', 'matched_x'); end if;

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
      return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', v_stun_until + balance_num('support', 'stun_immune_rounds')::int);
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
    -- The killing Smite: settle once + the same 'defeat' notification as hunt_attack (2026-10-03).
    if v_status = 'defeated' then
      v_settle := settle_hunt(p_hunt);
      insert into hunt_events (hunt_id, kind, payload)
        values (p_hunt, 'defeat', jsonb_build_object(
          'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
          'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                  from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                        group by player_id order by sum(damage) desc limit 3) t)));
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
  end if;

  -- The action log (combat_actions.sql, Nathan 2026-10-06): every support play that worked, for the balance data.
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
  values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, v_amt,
    case when v_tgt in ('ally', 'self') then p_target end,
    jsonb_build_object('scale', v_scale, 'matched', v_matched, 'aff_count', v_affcount, 'affinity', v_aff, 'cooldown', v_cd,
      'value', case
        when v_eff = 'smite' then v_sdmg
        when v_eff in ('weaken', 'expose') then combat_support_value(v_eff, v_amt, v_scale, null)
        when v_eff = 'empower' then combat_support_value('empower', v_amt, 1, null)
        when v_eff in ('heal', 'shield') then (select combat_support_value(v_eff, v_amt, 1, h.max_hp) from hunt_card_hp h
          where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)
      end,
      'target_after', (select jsonb_build_object('hp', h.hp_remaining, 'max_hp', h.max_hp, 'shield', h.shield, 'dmg_buff', h.dmg_buff, 'downed', h.downed)
        from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)));

  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'affinity', v_aff, 'aff_count', v_affcount, 'matched', v_matched,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated');
end $function$
;

notify pgrst, 'reload schema';
