-- f3_one_power_number.sql (2026-10-15): F-3, one power number (docs/foundations.md F-3 item 9 "The power that players see leaves out stat points",
-- acceptance test 7 "The power on the roster equals the power in a fight for the same card").
-- Defect (observed): card_power (roster, the card list, the leaderboards, deployable power, the ascend result) counted the stars but NOT the Attack
-- points of a copy. card_combat (the fights) counts both. So a copy with Attack points showed less power than it fought with.
-- After: the shown power of a copy IS card_combat(...)->>'cp'. ONE new function, card_power_pts, is that number, and every reader calls it:
--   card_power_pts(rarity, stars, cp_mod, points [, balance])   the CP of one copy = what the fight uses (card_combat cp)
--   owned_card_power([player])                                  one row for each owned copy with its power (card_combat once for each
--                                                               DIFFERENT input, like card_powers: many copies share stars and points)
-- Readers changed: card_powers.power (roster, Collection, squad picker), ascend_card.power (the ascend result), deployable_power,
-- roster_stats, roster_snapshot, roster_top_players (the Admin roster), collection_power_all and my_collection_power (the collection power
-- of the leaderboard and the profile: the sum of the copies, then the set bonus as before).
-- NOT changed: card_power (3 arguments) stays the power without points (the base 0-star number; hunt_attack reads it with the flag off), the fight
-- math (card_combat, hunt_attack, dungeon_*), the Gauntlet (0 stars, no points on purpose, Nathan 2026-10-11), card_powers.hp and card_powers.cp.
-- With stat_points.enabled = false (or a copy with no points) card_combat cp = round(card_cp_exact), so every number is exactly as before.
-- Test: card-studio/scripts/test-one-power-number.mjs (rolled back; MUTATE=<name> must FAIL). The golden fights (combat-golden.mjs and
-- dungeon-golden.mjs, CANDIDATE=this file) are the same. Idempotent. Grants: the default privileges of lockdown_grants.sql (service_role only).

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.card_powers(text)', '62c2883f976c480c8f817f8249e6c053', '3beac0125a58f95a5f6ee562ccf64a37'),
    ('public.ascend_card(text, bigint)', '0b8f5728ecc8b1c69a5721d28a8da536', '72ced4db9bc262a0ea3de7411d798208'),
    ('public.deployable_power(integer)', 'a744b17aff2b54b776663492ac0c4ce1', '4f52bf43cdbf72c01cd65100fab2ab3e'),
    ('public.roster_stats()', '79b65ad0a29dcd326061c1b2ef623633', '9ee7766314a236068fc8d7361a19f4b2'),
    ('public.roster_snapshot()', '9ebbc5b0d0dae19321f488750dd06d0c', '9a646f8a7c6a5e619078bbd1cd69b52c'),
    ('public.roster_top_players(integer)', 'd00d2a57e297af48467b3320ecefac1b', '59a964a1c685fb3446041ecde10c9152'),
    ('public.collection_power_all()', '4a88bfc04b1d7492f0dc9d2cd4b239d7', '3aaefc88b0a28f4505b5a3e41a13d2c9'),
    ('public.my_collection_power(text)', 'a46f5a1c1b0da1d3459cbe48ba05216f', 'a086cd4d7bacc1d91a8782a2baae7cce'),
    ('public.card_combat(text, integer, numeric, jsonb, jsonb)', 'c213fbf8f94214b5d2b316b6b21efd7b', 'c213fbf8f94214b5d2b316b6b21efd7b')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'f3_one_power_number.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the one number
create or replace function public.card_power_pts(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb, p_b jsonb)
returns integer language sql stable set search_path = public as $$
  select (card_combat(p_rarity, p_asc, p_mod, p_pts, p_b)->>'cp')::int;
$$;
create or replace function public.card_power_pts(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb)
returns integer language sql stable set search_path = public as $$
  select card_power_pts(p_rarity, p_asc, p_mod, p_pts, card_balance());
$$;

-- One row for each owned copy (quantity >= 1; the same rows and joins as the old readers) with its power. p_player null = every player.
-- card_combat runs once for each DIFFERENT (rarity, stars, cp_mod, points), as card_powers does (perf_five_slow_calls.sql).
create or replace function public.owned_card_power(p_player text default null)
returns table(player_id text, card_id bigint, subject_id bigint, rarity text, ascension integer, cp_mod numeric, type text, power integer)
language sql stable set search_path = public as $$
  with b as materialized (select card_balance() v),
  o as materialized (
    select pc.player_id, pc.card_id, c.subject_id, c.rarity::text rarity, pc.ascension, s.cp_mod, s.type::text type, pc.stat_points
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
     where pc.quantity >= 1 and (p_player is null or pc.player_id = p_player)),
  k as materialized (
    select d.rarity, d.ascension, d.cp_mod, d.stat_points, card_power_pts(d.rarity, d.ascension, d.cp_mod, d.stat_points, b.v) cp
      from (select distinct rarity, ascension, cp_mod, stat_points from o) d, b)
  select o.player_id, o.card_id, o.subject_id, o.rarity, o.ascension, o.cp_mod, o.type, k.cp
    from o join k on k.rarity = o.rarity and k.ascension = o.ascension and k.cp_mod is not distinct from o.cp_mod
                 and k.stat_points = o.stat_points;
$$;

-- ============================================================ 2. the readers
-- card_powers: only `power` of an owned copy changes (it was card_cp_exact without points; it is now the cp that card_combat gives).
create or replace function public.card_powers(p_player text default null::text)
 returns jsonb language sql stable set search_path to 'public'
as $function$
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
    -- F-3 one power number: power = the cp of card_combat (stars AND points), the number the fights use.
    select k.rarity, k.ascension, k.cp_mod, k.stat_points, x.cc || jsonb_build_object('power', (x.cc->>'cp')::int) v
      from (select distinct rarity, ascension, cp_mod, stat_points from own) k, b,
           lateral (select card_combat(k.rarity, k.ascension, k.cp_mod, k.stat_points, b.v) cc offset 0) x)   -- offset 0: the planner must not inline it (cc is read twice)
  select coalesce(jsonb_object_agg(x.id::text, x.v), '{}'::jsonb) from (
    select base.id, k.v from base join base_k k on k.rarity = base.rarity and k.cp_mod is not distinct from base.cp_mod
    union all
    select own.id, k.v from own join own_k k on k.rarity = own.rarity and k.ascension is not distinct from own.ascension
       and k.cp_mod is not distinct from own.cp_mod and k.stat_points is not distinct from own.stat_points) x;
$function$;

-- ascend_card: the result power counts the points of the copy.
create or replace function public.ascend_card(p_player_id text, p_card_id bigint)
 returns jsonb language plpgsql set search_path to 'public'
as $function$
declare
  v_qty int; v_asc int; v_rarity text; v_cost int; v_mod numeric; v_pts jsonb;
begin
  select pc.quantity, pc.ascension, c.rarity, s.cp_mod, pc.stat_points
    into v_qty, v_asc, v_rarity, v_mod, v_pts
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
    'quantity', v_qty - v_cost, 'power', card_power_pts(v_rarity, v_asc + 1, v_mod, v_pts),
    'next_cost', ascend_cost(v_rarity, v_asc + 1));
end;
$function$;

create or replace function public.deployable_power(p_cap integer default null::integer)
 returns bigint language sql stable set search_path to 'public'
as $function$
  with cfg as (
    select coalesce(p_cap, hunt_card_cap()) as n
  ), atk as (
    select o.player_id, o.power as pow,
      row_number() over (partition by o.player_id order by o.power desc) as rn
    from owned_card_power() o
    where o.type in ('Character', 'Creature')
  )
  select coalesce(sum(a.pow), 0)::bigint from atk a, cfg where a.rn <= cfg.n;
$function$;

create or replace function public.roster_stats()
 returns jsonb language sql stable set search_path to 'public'
as $function$
  with owned as (
    select o.player_id, o.card_id, o.ascension, o.rarity, o.cp_mod, o.type, o.power
    from owned_card_power() o
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

create or replace function public.roster_snapshot()
 returns bigint language plpgsql set search_path to 'public'
as $function$
declare v_pow bigint; v_dep bigint; v_cards int; v_owners int; v_players int; v_id bigint; v_hp jsonb;
begin
  select coalesce(sum(o.power), 0)::bigint, count(*)::int, count(distinct o.player_id)::int
    into v_pow, v_cards, v_owners
    from owned_card_power() o;
  v_dep := deployable_power();
  select count(*)::int into v_players from players;
  v_hp := roster_boss_hp(v_dep);   -- the estimate of balance boss_hp_estimate (not the real boss HP), the same as roster_stats
  insert into roster_power_history (players, owned_cards, total_power, deployable_power, boss_hp_normal, boss_hp_heroic, boss_hp_mythic)
    values (v_players, v_cards, v_pow, v_dep,
      (v_hp->>'Normal')::bigint, (v_hp->>'Heroic')::bigint, (v_hp->>'Mythic')::bigint)
    returning id into v_id;
  return v_id;
end $function$;

create or replace function public.roster_top_players(p_limit integer default 20)
 returns table(player_id text, username text, owned_cards bigint, total_power bigint, best_card integer)
 language sql stable set search_path to 'public'
as $function$
  select o.player_id, max(pl.username), count(*),
         sum(o.power)::bigint,
         max(o.power)
  from owned_card_power() o
  left join players pl on pl.id = o.player_id
  group by o.player_id
  order by 4 desc
  limit greatest(1, p_limit);
$function$;

create or replace function public.collection_power_all()
 returns table(player_id text, power bigint) language sql stable set search_path to 'public'
as $function$
  with b as (select (balance_get('set_bonus') #>> '{}')::numeric sb),
  subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select o.player_id, o.subject_id, sum(o.power) base_cp, count(*) ov
      from owned_card_power() o group by o.player_id, o.subject_id
  )
  select ps.player_id, sum(case when ps.ov = st.tv then round(ps.base_cp * (select sb from b)) else ps.base_cp end)::bigint
    from ps join subj_totals st on st.subject_id = ps.subject_id group by ps.player_id;
$function$;

create or replace function public.my_collection_power(p_player_id text)
 returns bigint language sql stable set search_path to 'public'
as $function$
  with b as (select (balance_get('set_bonus') #>> '{}')::numeric sb),
  subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select o.subject_id, sum(o.power) base_cp, count(*) ov
    from owned_card_power(p_player_id) o
    group by o.subject_id
  )
  select coalesce(sum(case when ps.ov = st.tv then round(ps.base_cp * (select sb from b)) else ps.base_cp end), 0)::bigint
  from ps join subj_totals st on st.subject_id = ps.subject_id;
$function$;

comment on function public.card_power_pts(text, integer, numeric, jsonb, jsonb) is $doc$[cards] THE shown power of one copy: the cp of card_combat (stars and stat points), the number the fights use (F-3 acceptance test 7). p_b = card_balance().$doc$;
comment on function public.card_power_pts(text, integer, numeric, jsonb) is $doc$[cards] card_power_pts with the balance read once (card_balance()). The shown power of a copy with its stars and points = its fight power.$doc$;
comment on function public.owned_card_power(text) is $doc$[cards] One row for each owned copy (quantity >= 1) with its power = card_power_pts (card_combat run once for each different input). p_player null = every player. Read by the roster, the leaderboards, the deployable power and the collection power.$doc$;

notify pgrst, 'reload schema';
