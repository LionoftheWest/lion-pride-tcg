-- The live text of eight functions BEFORE f3_one_power_number.sql (F-3 one power number), copied from db/schema/functions of origin/main 5571a02c.
-- Older migration files guard these functions with the md5 of this text (card_ledger.sql: ascend_card; balance_dungeon_numbers.sql: roster_stats,
-- roster_snapshot). Their tests put it in place first, inside the rolled-back block (f3-power-before.mjs), so the old file runs as it did.

-- @fn card_powers
CREATE OR REPLACE FUNCTION public.card_powers(p_player text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- card_combat once per DIFFERENT input (perf_five_slow_calls.sql): many copies share rarity, stars, cp_mod and stat points.
  with b as materialized (select card_balance() v),
  base as materialized (
    select c.id, c.rarity::text rarity, s.cp_mod from cards c left join subjects s on s.id = c.subject_id where p_player is null),
  base_k as materialized (
    select k.rarity, k.cp_mod, jsonb_build_object('power', round(card_cp_exact(k.rarity, 0, k.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                                  'hp', card_max_hp(round(card_cp_exact(k.rarity, 0, k.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                                                    (b.v->'card_hp'->>'floor')::numeric, (b.v->'card_hp'->>'per_cp')::numeric)) v
      from (select distinct rarity, cp_mod from base) k, b),
  own as materialized (
    select c.id, c.rarity::text rarity, pc.ascension, s.cp_mod, pc.stat_points
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
     where p_player is not null and pc.player_id = p_player and pc.quantity > 0),
  own_k as materialized (
    select k.rarity, k.ascension, k.cp_mod, k.stat_points,
           card_combat(k.rarity, k.ascension, k.cp_mod, k.stat_points, b.v)
           || jsonb_build_object('power', round(card_cp_exact(k.rarity, k.ascension, k.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int) v
      from (select distinct rarity, ascension, cp_mod, stat_points from own) k, b)
  select coalesce(jsonb_object_agg(x.id::text, x.v), '{}'::jsonb) from (
    select base.id, k.v from base join base_k k on k.rarity = base.rarity and k.cp_mod is not distinct from base.cp_mod
    union all
    select own.id, k.v from own join own_k k on k.rarity = own.rarity and k.ascension is not distinct from own.ascension
       and k.cp_mod is not distinct from own.cp_mod and k.stat_points is not distinct from own.stat_points) x;
$function$;

-- @fn ascend_card
CREATE OR REPLACE FUNCTION public.ascend_card(p_player_id text, p_card_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_qty int; v_asc int; v_rarity text; v_cost int; v_mod numeric;
begin
  select pc.quantity, pc.ascension, c.rarity, s.cp_mod
    into v_qty, v_asc, v_rarity, v_mod
  from player_cards pc
  join cards c    on c.id = pc.card_id
  join subjects s on s.id = c.subject_id
  where pc.player_id = p_player_id and pc.card_id = p_card_id
  for update of pc;

  if not found then return jsonb_build_object('ok', false, 'error', 'not owned'); end if;
  if v_rarity in ('event', 'promo') then return jsonb_build_object('ok', false, 'error', 'no_ascend'); end if;
  if v_asc >= 5 then return jsonb_build_object('ok', false, 'error', 'maxed'); end if;

  v_cost := ascend_cost(v_rarity, v_asc);
  if v_qty < 1 + v_cost then
    return jsonb_build_object('ok', false, 'error', 'need_more', 'have', v_qty, 'need', 1 + v_cost);
  end if;
  -- A copy held by a trade offer, an auction or a bid is not free to spend, and the copy that
  -- stays must be free too (else it leaves with the trade, the auction or the bid).
  if free_copies(p_player_id, p_card_id) < v_cost + 1 then
    return jsonb_build_object('ok', false, 'error', 'held', 'free', free_copies(p_player_id, p_card_id), 'need', v_cost + 1);
  end if;

  -- The copies spent: one ledger row, ref ('ascension', '<card>:<the star reached>').
  if v_cost > 0 then
    perform card_move(p_player_id, p_card_id, -v_cost, 'ascend', 'ascension', p_card_id::text || ':' || (v_asc + 1));
  end if;
  update player_cards set ascension = ascension + 1
   where player_id = p_player_id and card_id = p_card_id;

  return jsonb_build_object('ok', true, 'ascension', v_asc + 1,
    'quantity', v_qty - v_cost, 'power', card_power(v_rarity, v_asc + 1, v_mod),
    'next_cost', ascend_cost(v_rarity, v_asc + 1));
end;
$function$;

-- @fn deployable_power
CREATE OR REPLACE FUNCTION public.deployable_power(p_cap integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cfg as (
    select coalesce(p_cap, hunt_card_cap()) as n
  ), atk as (
    select pc.player_id,
      card_power(c.rarity::text, pc.ascension, s.cp_mod) as pow,
      row_number() over (partition by pc.player_id
        order by card_power(c.rarity::text, pc.ascension, s.cp_mod) desc) as rn
    from player_cards pc
    join cards c on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.quantity >= 1 and s.type in ('Character', 'Creature')
  )
  select coalesce(sum(a.pow), 0)::bigint from atk a, cfg where a.rn <= cfg.n;
$function$;

-- @fn roster_stats
CREATE OR REPLACE FUNCTION public.roster_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with owned as (
    select pc.player_id, pc.card_id, pc.ascension, c.rarity::text as rarity, s.cp_mod, s.type,
           card_power(c.rarity::text, pc.ascension, s.cp_mod) as power
    from player_cards pc
    join cards c on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.quantity >= 1
  ), agg as (
    select coalesce(sum(power), 0)::bigint as total_power,
           count(*)::int as owned_cards,
           count(distinct player_id)::int as owners
    from owned
  )
  select jsonb_build_object(
    'players',        (select count(*) from players),
    'owners',         a.owners,
    'owned_cards',    a.owned_cards,
    'total_power',    a.total_power,
    'deployable_power', deployable_power(),
    'avg_power_owner', case when a.owners > 0 then round(a.total_power::numeric / a.owners, 1) else 0 end,
    'boss_hp', roster_boss_hp(deployable_power()),   -- the estimate of balance boss_hp_estimate (not the real boss HP)
    'by_rarity',   (select jsonb_object_agg(rarity, cnt) from (select rarity, count(*) cnt from owned group by rarity) r),
    'by_ascension',(select jsonb_object_agg(ascension::text, cnt) from (select ascension, count(*) cnt from owned group by ascension) x)
  ) from agg a;
$function$;

-- @fn roster_snapshot
CREATE OR REPLACE FUNCTION public.roster_snapshot()
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_pow bigint; v_dep bigint; v_cards int; v_owners int; v_players int; v_id bigint; v_hp jsonb;
begin
  select coalesce(sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)), 0)::bigint, count(*)::int, count(distinct pc.player_id)::int
    into v_pow, v_cards, v_owners
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.quantity >= 1;
  v_dep := deployable_power();
  select count(*)::int into v_players from players;
  v_hp := roster_boss_hp(v_dep);   -- the estimate of balance boss_hp_estimate (not the real boss HP), the same as roster_stats
  insert into roster_power_history (players, owned_cards, total_power, deployable_power, boss_hp_normal, boss_hp_heroic, boss_hp_mythic)
    values (v_players, v_cards, v_pow, v_dep,
      (v_hp->>'Normal')::bigint, (v_hp->>'Heroic')::bigint, (v_hp->>'Mythic')::bigint)
    returning id into v_id;
  return v_id;
end $function$;

-- @fn roster_top_players
CREATE OR REPLACE FUNCTION public.roster_top_players(p_limit integer DEFAULT 20)
 RETURNS TABLE(player_id text, username text, owned_cards bigint, total_power bigint, best_card integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select pc.player_id, max(pl.username), count(*),
         sum(card_power(c.rarity::text, pc.ascension, s.cp_mod))::bigint,
         max(card_power(c.rarity::text, pc.ascension, s.cp_mod))
  from player_cards pc
  join cards c on c.id = pc.card_id
  join subjects s on s.id = c.subject_id
  left join players pl on pl.id = pc.player_id
  where pc.quantity >= 1
  group by pc.player_id
  order by 4 desc
  limit greatest(1, p_limit);
$function$;

-- @fn collection_power_all
CREATE OR REPLACE FUNCTION public.collection_power_all()
 RETURNS TABLE(player_id text, power bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with b as (select balance_get('rarity_cp') rcp, balance_get('stars') st, (balance_get('set_bonus') #>> '{}')::numeric sb),
  subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select pc.player_id, c.subject_id, sum(round(card_cp_exact(c.rarity::text, pc.ascension, s.cp_mod, b.rcp, b.st))::int) base_cp, count(*) ov
      from b, player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
     where pc.quantity >= 1 group by pc.player_id, c.subject_id
  )
  select ps.player_id, sum(case when ps.ov = st.tv then round(ps.base_cp * (select sb from b)) else ps.base_cp end)::bigint
    from ps join subj_totals st on st.subject_id = ps.subject_id group by ps.player_id;
$function$;

-- @fn my_collection_power
CREATE OR REPLACE FUNCTION public.my_collection_power(p_player_id text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with b as (select balance_get('rarity_cp') rcp, balance_get('stars') st, (balance_get('set_bonus') #>> '{}')::numeric sb),
  subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select c.subject_id,
           sum(round(card_cp_exact(c.rarity::text, pc.ascension, s.cp_mod, b.rcp, b.st))::int) base_cp,
           count(*) ov
    from b, player_cards pc
    join cards c    on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.player_id = p_player_id and pc.quantity >= 1
    group by c.subject_id
  )
  select coalesce(sum(case when ps.ov = st.tv then round(ps.base_cp * (select sb from b)) else ps.base_cp end), 0)::bigint
  from ps join subj_totals st on st.subject_id = ps.subject_id;
$function$;
