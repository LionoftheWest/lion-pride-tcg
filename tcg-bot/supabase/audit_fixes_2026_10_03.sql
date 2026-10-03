-- Database audit fixes (2026-10-03). Four verified defects on the live project:
-- 1. hunt_support: a Smite support play that kills the boss settled the hunt (settle_hunt) but
--    wrote NO 'defeat' row to hunt_events, so the bot never posted the defeat/prize message
--    (hunt-notify.ts 'defeat'). hunt_attack writes it. The body below is the LIVE body
--    (pg_get_functiondef, identical to hunt_loop_caps.sql) plus the same 'defeat' insert as
--    hunt_attack (payload: name, tier, settle, top). It is written once: settle_hunt writes no
--    hunt_events row, and a later hunt_attack / hunt_support returns 'hunt_over' (status <> 'active').
-- 2. Indexes: hunt_hits (player_id, hit_date) for dailies_tasks / playing_today (they filter on
--    player_id + hit_date, and every hunt_hits index leads with hunt_id), and
--    player_cards (card_id) (the primary key leads with player_id).
-- 3. A mutable search_path (Supabase advisor 0011) on ascend_cost, card_power, rarity_rank,
--    stat_pt and subjects_flatten_tags: pin it to public like the other functions.
-- 4. Drop the unused overload add_card_to_player(text, bigint) (schema.sql). Every live caller
--    (claim_gift, accept_trade, buy_shop_item, confirm_bid) and the repo code use the 3-arg form
--    (pull_feed_source.sql), and pg_depend has no object that depends on the 2-arg form.
-- Test (rolled back): node scripts/test-smite-defeat.mjs ../tcg-bot/supabase/audit_fixes_2026_10_03.sql

-- 1. hunt_support: the 'defeat' event on a Smite kill ------------------------------------------
create or replace function public.hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint default null::bigint)
returns jsonb language plpgsql set search_path = public as $function$
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
  v_scale := least(2.0, 1 + 0.15 * coalesce(v_affcount, 0));

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
      update hunt_card_hp set dmg_buff = 1 + v_amt, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'shield' then
      -- amount = a fraction of the TARGET's max HP (was flat 60 on 30-HP cards).
      update hunt_card_hp set shield = shield + greatest(1, round(max_hp * least(v_amt, 1.0)))::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'heal' then
      -- amount = a fraction of the TARGET's max HP (was flat 60, a full heal on the
      -- 30-HP cards). A heal never revives a downed card (that is a separate boon).
      if exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player
                  and card_id = p_target and hit_date = v_day and downed) then
        return jsonb_build_object('ok', false, 'error', 'target_downed');
      end if;
      update hunt_card_hp set hp_remaining = least(max_hp, hp_remaining + greatest(1, round(max_hp * least(v_amt, 1.0)))::int),
        updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    else
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;

  -- boss-targeted / team effects (scaled by affinity synergy)
  elsif v_eff = 'weaken' then
    update hunt_combat_state set boss_weaken = least(0.6, v_amt * v_scale), weaken_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'expose' then
    update hunt_combat_state set boss_expose = least(1.0, v_amt * v_scale), expose_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'stun' then
    -- Stun immunity (hunt_loop_caps.sql): after a stun the boss cannot be stunned for 2 rounds, so
    -- 4 stun cards cannot lock it (at most 1 stunned round in 3).
    select stunned_until into v_stun_until from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if coalesce(v_stun_until, 0) > 0 and v_round < v_stun_until + 2 then
      return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', v_stun_until + 2);
    end if;
    update hunt_combat_state set stunned_until = v_round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'cleanse' then
    update hunt_card_hp set dmg_debuff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
  elsif v_eff = 'smite' then
    v_sdmg := greatest(1, round(v_amt * v_scale));
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

  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'affinity', v_aff, 'aff_count', v_affcount, 'matched', v_matched,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated');
end $function$;

revoke all on function public.hunt_support(text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.hunt_support(text, bigint, bigint, bigint) to service_role;

-- 2. Indexes -----------------------------------------------------------------------------------
create index if not exists hunt_hits_player_day on public.hunt_hits (player_id, hit_date);
create index if not exists player_cards_card on public.player_cards (card_id);

-- 3. A fixed search_path ------------------------------------------------------------------------
alter function public.ascend_cost(text, integer) set search_path = public;
alter function public.card_power(text, integer, numeric) set search_path = public;
alter function public.rarity_rank(text) set search_path = public;
alter function public.stat_pt(jsonb, text) set search_path = public;
alter function public.subjects_flatten_tags() set search_path = public;

-- 4. The unused 2-arg overload (no cascade: a dependent object makes this fail) ----------------
drop function if exists public.add_card_to_player(text, bigint);

notify pgrst, 'reload schema';
