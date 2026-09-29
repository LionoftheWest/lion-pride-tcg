-- Stat points (docs/card-stats.md, decided by Nathan 2026-09-27; built 2026-09-29).
-- Each ascension star gives 3 points for the owner's copy: Attack, Vitality, Precision,
-- Potency, Haste. A small fixed boost per star stays. One free reset per player per week.
-- A traded card is a new player_cards row for the new owner, so its points start at 0.
--
-- Flag: settings.stat_points.enabled (default false). While it is false, card_combat()
-- returns card_power() + card_max_hp() exactly, so the hunt and the effects do not change.
--
-- Balance (the rule: a star-5 card is not stronger in total, only shaped by its owner):
--   combat power = base x (1 + 0.08 x stars) x (1 + 0.05 x Attack) x cp_mod
--   all 15 points in Attack at star 5: 1.40 x 1.75 = 2.45 (the old fixed star 5 = 2.50),
--   and HP follows power as before (card_max_hp), so an all-Attack card = the old card.
--   Vitality +6% HP, Precision +3% crit (cap 60%), Potency +5% effect / support amount,
--   Haste -4% effect cooldown. card_power() (collection power, leaderboards) is unchanged.
-- Idempotent.

alter table public.player_cards add column if not exists stat_points jsonb not null default '{}'::jsonb;
alter table public.players add column if not exists stat_reset_week text;

insert into public.settings (key, value) values ('stat_points', jsonb_build_object(
  'enabled', false, 'per_star', 3, 'star', 0.08, 'attack', 0.05, 'vitality', 0.06,
  'precision', 0.03, 'potency', 0.05, 'haste', 0.04, 'crit_cap', 0.6))
on conflict (key) do nothing;

create or replace function public.stat_cfg() returns jsonb
language sql stable set search_path to 'public' as $$
  select coalesce((select value from settings where key = 'stat_points'), '{}'::jsonb);
$$;

-- One stat of a points object, as a whole number from 0 to 15.
create or replace function public.stat_pt(p_pts jsonb, p_key text) returns int
language sql immutable as $$
  select greatest(0, least(15, coalesce(case when jsonb_typeof(p_pts->p_key) = 'number'
    then floor((p_pts->>p_key)::numeric)::int end, 0)));
$$;

-- The combat numbers of one copy: cp, hp, the crit bonus, the effect potency and haste
-- multipliers, and the points still free to spend.
create or replace function public.card_combat(p_rarity text, p_asc int, p_mod numeric, p_pts jsonb)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  c jsonb := stat_cfg();
  a int := greatest(0, least(5, coalesce(p_asc, 0)));
  pts jsonb := coalesce(p_pts, '{}'::jsonb);
  v_cp int; v_spent int;
begin
  if not coalesce((c->>'enabled')::boolean, false) then
    v_cp := card_power(p_rarity, a, p_mod);
    return jsonb_build_object('on', false, 'cp', v_cp, 'hp', card_max_hp(v_cp), 'crit', 0,
      'potency', 1, 'haste', 1, 'free', 0);
  end if;
  v_spent := stat_pt(pts, 'attack') + stat_pt(pts, 'vitality') + stat_pt(pts, 'precision')
           + stat_pt(pts, 'potency') + stat_pt(pts, 'haste');
  v_cp := round(card_power(p_rarity, 0, 1.0) * coalesce(p_mod, 1.0)
    * (1 + coalesce((c->>'star')::numeric, 0.08) * a)
    * (1 + coalesce((c->>'attack')::numeric, 0.05) * stat_pt(pts, 'attack')))::int;
  return jsonb_build_object('on', true, 'cp', v_cp,
    'hp', round(card_max_hp(v_cp) * (1 + coalesce((c->>'vitality')::numeric, 0.06) * stat_pt(pts, 'vitality')))::int,
    'crit', coalesce((c->>'precision')::numeric, 0.03) * stat_pt(pts, 'precision'),
    'potency', 1 + coalesce((c->>'potency')::numeric, 0.05) * stat_pt(pts, 'potency'),
    'haste', greatest(0.2, 1 - coalesce((c->>'haste')::numeric, 0.04) * stat_pt(pts, 'haste')),
    'free', greatest(0, coalesce((c->>'per_star')::int, 3) * a - v_spent));
end $$;

-- The combat numbers + points of a player's ascended copies (the Activity shows them).
create or replace function public.card_stats_for(p_player text) returns jsonb
language sql stable set search_path to 'public' as $$
  select jsonb_build_object('on', coalesce((stat_cfg()->>'enabled')::boolean, false),
    'reset_week', (select stat_reset_week from players where id = p_player),
    'week', to_char(now() at time zone 'utc', 'IYYY-IW'),
    'cards', coalesce((select jsonb_object_agg(pc.card_id::text,
        card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) || jsonb_build_object('points', pc.stat_points))
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
      where pc.player_id = p_player and (pc.ascension > 0 or pc.stat_points <> '{}'::jsonb)), '{}'::jsonb));
$$;

-- Spend points on one copy: p_add = {"attack": 2, "vitality": 1}. Whole numbers >= 0,
-- only the 5 stats, and never more than 3 x the stars in total.
create or replace function public.spend_stat_points(p_player text, p_card bigint, p_add jsonb)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v_asc int; v_pts jsonb; v_rar text; v_mod numeric; v_new jsonb; k text; v jsonb; v_n int; v_total int; v_cap int;
begin
  if not coalesce((stat_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if p_add is null or jsonb_typeof(p_add) <> 'object' or p_add = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select pc.ascension, pc.stat_points, c.rarity::text, s.cp_mod into v_asc, v_pts, v_rar, v_mod
    from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0
    for update of pc;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  v_new := coalesce(v_pts, '{}'::jsonb);
  for k, v in select * from jsonb_each(p_add) loop
    if k not in ('attack', 'vitality', 'precision', 'potency', 'haste') then
      return jsonb_build_object('ok', false, 'error', 'bad_stat', 'stat', k); end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,2}$' then
      return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
    v_n := (v #>> '{}')::int;
    if v_n > 0 then v_new := v_new || jsonb_build_object(k, stat_pt(v_new, k) + v_n); end if;
  end loop;
  v_total := stat_pt(v_new, 'attack') + stat_pt(v_new, 'vitality') + stat_pt(v_new, 'precision')
           + stat_pt(v_new, 'potency') + stat_pt(v_new, 'haste');
  v_cap := coalesce((stat_cfg()->>'per_star')::int, 3) * coalesce(v_asc, 0);
  if v_total > v_cap then
    return jsonb_build_object('ok', false, 'error', 'not_enough',
      'free', (card_combat(v_rar, v_asc, v_mod, v_pts)->>'free')::int); end if;
  update player_cards set stat_points = v_new where player_id = p_player and card_id = p_card;
  return jsonb_build_object('ok', true, 'points', v_new, 'stats', card_combat(v_rar, v_asc, v_mod, v_new));
end $$;

-- The free reset: one card per player per ISO week (UTC). The points come back to spend.
create or replace function public.reset_stat_points(p_player text, p_card bigint)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_week text := to_char(now() at time zone 'utc', 'IYYY-IW'); v_used text; v_pts jsonb;
  v_asc int; v_rar text; v_mod numeric;
begin
  if not coalesce((stat_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select stat_reset_week into v_used from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  select pc.stat_points, pc.ascension, c.rarity::text, s.cp_mod into v_pts, v_asc, v_rar, v_mod
    from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0 for update of pc;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if coalesce(v_pts, '{}'::jsonb) = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
  if v_used = v_week then
    return jsonb_build_object('ok', false, 'error', 'reset_used',
      'next', date_trunc('week', now() at time zone 'utc') + interval '7 days'); end if;
  update player_cards set stat_points = '{}'::jsonb where player_id = p_player and card_id = p_card;
  update players set stat_reset_week = v_week where id = p_player;
  return jsonb_build_object('ok', true, 'points', '{}'::jsonb, 'stats', card_combat(v_rar, v_asc, v_mod, '{}'::jsonb));
end $$;

-- Only the server (service role) calls these.
revoke all on function public.spend_stat_points(text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.reset_stat_points(text, bigint) from public, anon, authenticated;
revoke all on function public.card_stats_for(text) from public, anon, authenticated;

-- ---- The live functions, changed to read the points ----

CREATE OR REPLACE FUNCTION public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
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

  v_day := (now() at time zone 'utc')::date;
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
    'burned', v_burned, 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
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
  v_day := (now() at time zone 'utc')::date;
  v_round := hunt_state_round(p_hunt, p_player, v_day);

  select cd_until_round into v_cd_until from hunt_card_hp
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if found and v_round < coalesce(v_cd_until, 0) then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', v_cd_until, 'round', v_round);
  end if;

  v_maxhp := 30;
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

CREATE OR REPLACE FUNCTION public.play_card_effect(p_player text, p_card bigint, p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_subject bigint; v_rarity text; v_qty int; v_eff jsonb; v_prim effect_primitives%rowtype;
  v_tiers jsonb; v_caps jsonb; v_power numeric; v_cd numeric;
  v_asc int; v_ascset jsonb; v_scale numeric; v_pts jsonb; v_cmb jsonb;
  v_amount numeric; v_dur int; v_cooldown_h numeric; v_ready timestamptz;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_final text := p_target; v_outcome text := 'applied'; v_play bigint;
  v_reflect_id bigint; v_ward_id bigint; v_opts jsonb;
begin
  if p_player = p_target then return jsonb_build_object('ok', false, 'error', 'self_target'); end if;
  if not exists (select 1 from players where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;

  -- Serialize plays that touch the same members (caps + counters), in a fixed order.
  perform 1 from players where id in (p_player, p_target) order by id for update;

  select pc.quantity, c.subject_id, c.rarity::text, s.effect, coalesce(pc.ascension, 0), pc.stat_points
    into v_qty, v_subject, v_rarity, v_eff, v_asc, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_eff is null or v_eff->>'primitive' is null then
    return jsonb_build_object('ok', false, 'error', 'no_effect');
  end if;

  select * into v_prim from effect_primitives where primitive = v_eff->>'primitive';
  if not found or not v_prim.enabled then
    return jsonb_build_object('ok', false, 'error', 'effect_disabled', 'primitive', v_eff->>'primitive');
  end if;

  -- Cooldown (player + subject).
  select ready_at into v_ready from card_effect_cooldowns
   where player_id = p_player and subject_id = v_subject for update;
  if found and v_ready > now() then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_at', v_ready);
  end if;

  -- Caps (0 or missing = off).
  select value into v_caps from settings where key = 'card_effect_caps';
  v_caps := coalesce(v_caps, '{}'::jsonb);
  if coalesce((v_caps->>'send_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and created_at >= v_day)
         >= (v_caps->>'send_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'send_cap');
  end if;
  if coalesce((v_caps->>'pair_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and aimed_at = p_target and created_at >= v_day)
         >= (v_caps->>'pair_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'pair_cap');
  end if;
  if v_prim.kind = 'prank' then
    if coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and kind = 'prank' and created_at >= v_day)
           >= (v_caps->>'prank_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_prank_cap');
    end if;
    if v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and primitive = 'timeout' and created_at >= v_day)
           >= (v_caps->>'timeout_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_timeout_cap');
    end if;
  end if;
  if v_prim.primitive = 'gift_pack' and coalesce((v_caps->>'gift_pack_per_week')::int, 0) > 0
     and ((select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and target_id = p_target and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int
       or (select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and player_id = p_player and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int) then
    return jsonb_build_object('ok', false, 'error', 'gift_pack_cap');
  end if;

  -- Counters on the target, for pranks only. Find them first, consume them only after
  -- every refusal check, so a refused play never costs the target a ward or a reflect.
  -- A reflected prank is never reflected again (the sender's reflect is not checked).
  if v_prim.kind = 'prank' then
    select id into v_reflect_id from player_effects
     where player_id = p_target and primitive = 'reflect' and consumed_at is null
       and (expires_at is null or expires_at > now()) order by id limit 1;
    if v_reflect_id is not null then
      v_final := p_player; v_outcome := 'reflected';
      -- The caps count where a prank LANDS. A sender at their own prank (or timeout)
      -- cap cannot receive the bounce, so it fizzles (found by boon-sim.mjs: a victim
      -- got 5 pranks + 1 of their own reflected back = 6 > cap 5).
      if (coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and kind = 'prank' and created_at >= v_day)
              >= (v_caps->>'prank_recv_per_day')::int)
         or (v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and primitive = 'timeout' and created_at >= v_day)
              >= (v_caps->>'timeout_recv_per_day')::int) then
        v_outcome := 'blocked';
      end if;
    end if;
    if v_outcome <> 'blocked' then
      select id into v_ward_id from player_effects
       where player_id = v_final and primitive = 'ward' and consumed_at is null
         and (expires_at is null or expires_at > now()) order by id limit 1;
      if v_ward_id is not null then v_outcome := 'blocked'; end if;
    end if;
  end if;

  -- No stacking (checked on the member it would land on). Refused plays keep the cooldown.
  if v_outcome <> 'blocked' and not v_prim.stacks and card_effect_active(v_final, v_prim.primitive) then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'primitive', v_prim.primitive);
  end if;

  update player_effects set consumed_at = now() where id in (v_reflect_id, v_ward_id);

  -- Tier scaling, then the hard ceilings.
  select value into v_tiers from settings where key = 'card_effect_tiers';
  v_power := coalesce((v_tiers->v_rarity->>'power')::numeric, 1);
  v_cd    := coalesce((v_tiers->v_rarity->>'cd')::numeric, 1);
  -- Ascension (Nathan, 2026-09-27): each star of THIS copy makes the effect stronger
  -- and the cooldown shorter, on top of the tier. The hard limits below still clamp.
  select value into v_ascset from settings where key = 'card_effect_ascension';
  v_cmb := card_combat(v_rarity, v_asc, 1, v_pts);
  if (v_cmb->>'on')::boolean then
    -- Stat points on: the Potency and Haste points of THIS copy replace the per-star bonus.
    v_power := v_power * (v_cmb->>'potency')::numeric;
    v_cd    := v_cd * (v_cmb->>'haste')::numeric;
  else
    v_power := v_power * (1 + coalesce((v_ascset->>'power_per_star')::numeric, 0) * v_asc);
    v_cd    := v_cd * greatest(0.2, 1 - coalesce((v_ascset->>'cd_per_star')::numeric, 0) * v_asc);
  end if;
  -- One global knob for how often every card can be played (1 = as written).
  select coalesce((value #>> '{}')::numeric, 1) into v_scale from settings where key = 'card_effect_cooldown_scale';
  v_cd    := v_cd * coalesce(v_scale, 1);
  v_amount := round((v_eff->'base'->>'amount')::numeric * v_power, 2);
  v_dur    := round((v_eff->'base'->>'duration_s')::numeric * v_power)::int;
  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;
  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;
  v_cooldown_h := coalesce((v_eff->>'cooldown_h')::numeric, 24) * v_cd;

  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind,
                          rarity, amount, duration_s, outcome)
  values (p_player, v_final, p_target, p_card, v_subject, v_prim.primitive, v_prim.kind,
          v_rarity, v_amount, v_dur, v_outcome)
  returning id into v_play;

  insert into card_effect_cooldowns (player_id, subject_id, ready_at)
  values (p_player, v_subject, now() + make_interval(secs => v_cooldown_h * 3600))
  on conflict (player_id, subject_id) do update set ready_at = excluded.ready_at;

  -- What the visuals need: which card, who sent it, and ONE title from the card's list.
  v_opts := coalesce(v_eff->'options', '{}'::jsonb) || jsonb_build_object('card_id', p_card, 'sender_id', p_player);
  if jsonb_typeof(v_eff->'options'->'titles') = 'array' and jsonb_array_length(v_eff->'options'->'titles') > 0 then
    v_opts := v_opts || jsonb_build_object('title',
      v_eff->'options'->'titles'->>(floor(random() * jsonb_array_length(v_eff->'options'->'titles')))::int);
  end if;

  if v_outcome <> 'blocked' then
    if v_prim.primitive = 'gift_pack' then
      perform grant_packs(v_final, greatest(1, v_amount::int), 'boon', p_player);
    elsif v_prim.primitive = 'cleanse' then
      update player_effects set consumed_at = now()
       where player_id = v_final and consumed_at is null
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      update discord_effects set revert_at = now(), updated_at = now()
       where target_id = v_final and status in ('pending', 'active')
         and primitive in (select primitive from effect_primitives where kind = 'prank');
    elsif v_prim.channel = 'app' then
      insert into player_effects (player_id, primitive, amount, duration_s, options, source_play_id, expires_at)
      values (v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_play,
              case when v_dur is not null and v_dur > 0 then now() + make_interval(secs => v_dur) end);
    else
      insert into discord_effects (play_id, target_id, primitive, amount, duration_s, options, revert_at)
      values (v_play, v_final, v_prim.primitive, v_amount, v_dur, v_opts,
              case when v_dur is not null and v_dur > 0 then now() + make_interval(secs => v_dur) end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'play_id', v_play, 'outcome', v_outcome, 'target', v_final,
    'primitive', v_prim.primitive, 'kind', v_prim.kind, 'rarity', v_rarity, 'ascension', v_asc,
    'amount', v_amount, 'duration_s', v_dur, 'ready_at', now() + make_interval(secs => v_cooldown_h * 3600));
end $function$;

CREATE OR REPLACE FUNCTION public.hunt_view(p_player text, p_hunt bigint, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ascension', pc.ascension, 'first_obtained_at', pc.first_obtained_at,
        'card', jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity, 'image_url', c.image_url, 'season', c.season,
          'subject', case when s.id is null then null else jsonb_build_object('type', s.type, 'cp_mod', s.cp_mod, 'ability', s.ability, 'tags', s.tags) end)))
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
      where pc.player_id = p_player), '[]'::jsonb),
    'hp', coalesce((
      select jsonb_agg(jsonb_build_object('card_id', h.card_id, 'hp_remaining', h.hp_remaining, 'max_hp', h.max_hp,
        'downed', h.downed, 'shield', h.shield, 'cd_until_round', h.cd_until_round))
      from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day), '[]'::jsonb),
    'stats', card_stats_for(p_player),
    'damage', coalesce((select sum(damage) from hunt_hits where hunt_id = p_hunt and player_id = p_player), 0),
    'round', (select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day));
$function$;

notify pgrst, 'reload schema';
