-- Roster power tracking (2026-09-15): the boss now scales to the community roster power
-- (see hunt_hp_roster_power.sql). This file gives visibility into that number so we can
-- watch it, and the boss it produces, grow as the community grows.
--   roster_stats()          -> one snapshot: players, cards, total power, projected boss HP
--   roster_top_players(n)   -> the strongest rosters (leaderboard)
--   roster_snapshot()       -> record one history row (call weekly / at each spawn)
-- The power sum mirrors spawn_hunt exactly, so the projected HP equals the real spawn.

-- History of community roster power over time.
create table if not exists roster_power_history (
  id               bigserial primary key,
  captured_at      timestamptz not null default now(),
  players          int not null,
  owned_cards      int not null,      -- distinct owned card rows
  total_power      bigint not null,   -- sum of card_power over all owned cards
  boss_hp_normal   bigint not null,
  boss_hp_heroic   bigint not null,
  boss_hp_mythic   bigint not null
);
alter table roster_power_history enable row level security;  -- service-role only; deny anon

-- Live community roster power + the boss HP it would produce at each tier.
create or replace function roster_stats()
returns jsonb language sql stable set search_path = public as $$
  with owned as (
    select pc.player_id, pc.card_id, pc.ascension, c.rarity::text as rarity, s.cp_mod,
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
    'avg_power_owner', case when a.owners > 0 then round(a.total_power::numeric / a.owners, 1) else 0 end,
    'boss_hp', jsonb_build_object(
      'Normal', greatest(2000, round(a.total_power * 8 * 1.0)),
      'Heroic', greatest(2000, round(a.total_power * 8 * 1.5)),
      'Mythic', greatest(2000, round(a.total_power * 8 * 2.0))),
    'by_rarity',   (select jsonb_object_agg(rarity, cnt) from (select rarity, count(*) cnt from owned group by rarity) r),
    'by_ascension',(select jsonb_object_agg(ascension::text, cnt) from (select ascension, count(*) cnt from owned group by ascension) x)
  ) from agg a;
$$;

-- Leaderboard: the strongest rosters (drives the boss the most).
create or replace function roster_top_players(p_limit int default 20)
returns table(player_id text, username text, owned_cards bigint, total_power bigint, best_card int)
language sql stable set search_path = public as $$
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
$$;

-- Record one history row. Call at each weekly spawn to build the growth curve.
create or replace function roster_snapshot()
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_pow bigint; v_cards int; v_owners int; v_players int; v_id bigint;
begin
  select coalesce(sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)), 0)::bigint, count(*)::int, count(distinct pc.player_id)::int
    into v_pow, v_cards, v_owners
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.quantity >= 1;
  select count(*)::int into v_players from players;
  insert into roster_power_history (players, owned_cards, total_power, boss_hp_normal, boss_hp_heroic, boss_hp_mythic)
    values (v_players, v_cards, v_pow,
      greatest(2000, round(v_pow * 8 * 1.0)),
      greatest(2000, round(v_pow * 8 * 1.5)),
      greatest(2000, round(v_pow * 8 * 2.0)))
    returning id into v_id;
  return v_id;
end $$;

notify pgrst, 'reload schema';
