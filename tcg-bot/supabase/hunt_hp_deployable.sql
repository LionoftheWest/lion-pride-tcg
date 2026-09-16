-- Boss HP retune for the squad model (2026-09-15). Each player deploys at most 8 cards
-- per day. Only Character/Creature cards attack. Each squad card attacks REPEATEDLY until
-- the boss counter downs it (the team fights until wiped). Boss HP scales to DEPLOYABLE
-- POWER = the sum of each player's top-8 attacker cards.
--   hp = deployable_power * tiermult   (floor 500)
--   tiermult  Normal 10 / Heroic 16 / Mythic 22
-- Monte-Carlo (scripts/combat-sim.mjs), ~4-day window (Thu 21:00 -> Mon 23:00 UTC):
--   Normal <1 day full / ~1.5 half / ~3 quarter turnout; Heroic ~1.2/2.3/4.6; Mythic
--   ~1.8/3.6/7.2 — a real difficulty ladder, steady across roster maturity.

-- Deployable power = sum over players of their top-N attacker cards (N = the daily cap).
create or replace function deployable_power(p_cap int default null)
returns bigint language sql stable set search_path = public as $$
  with cfg as (
    select coalesce(p_cap, (select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8) as n
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
$$;

-- Spawn: HP now scales to deployable power.
-- The boss picks its weak + resist TAGS from the live card pool, and rotates them
-- each week (it avoids the tags used in the last 4 hunts) so every card gets its
-- turn to shine. Falls back to the whole pool when fresh tags run low. Tiers set
-- how many weak/resist tags the boss carries. See card-tags-and-battle-engine.md.
create or replace function spawn_hunt(p_days int default 3)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_players int; v_tier text; v_nweak int; v_nresist int; v_tiermult numeric;
  v_weak jsonb; v_resist jsonb; v_hp bigint; v_name text; v_id bigint; v_pow bigint;
  v_pool text[]; v_recent text[]; v_fresh text[]; v_weaktags text[]; v_resisttags text[];
  c_names text[] := array['The Salt Kraken','The Lag Beast','The Tilt Titan','Server Gremlin',
                          'The Whiff Wyrm','Rage-Quit Revenant','The Ping Phantom','Meta Hydra',
                          'The Desync Dragon','Frame-Drop Fiend'];
begin
  update hunts set status = 'expired' where status = 'active';
  select greatest(1, count(*)) into v_players from players;
  v_tier := (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)];
  v_tiermult := case v_tier when 'Normal' then 10 when 'Heroic' then 16 else 22 end;
  v_nweak   := case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end;
  v_nresist := case v_tier when 'Normal' then 0 when 'Heroic' then 1 else 2 end;

  -- The tag pool: distinct trait/origin slugs across attacker cards in the draw pool.
  select array_agg(distinct slug) into v_pool from (
    select unnest(s.tag_slugs) slug from subjects s
    where s.tags->>'class' = 'attacker'
      and exists (select 1 from cards c where c.subject_id = s.id and c.in_draw_pool)
  ) t where slug like 'trait:%' or slug like 'origin:%';

  -- Tags used as weak in the last 4 hunts (rotation prefers fresh tags).
  select coalesce(array_agg(distinct e->>'value'), '{}') into v_recent
  from (select weak_points from hunts order by id desc limit 4) h,
       lateral jsonb_array_elements(coalesce(h.weak_points, '[]'::jsonb)) e
  where e->>'kind' = 'tag';

  if v_pool is null or array_length(v_pool, 1) is null then
    v_weak := '[]'::jsonb; v_resist := '[]'::jsonb;              -- no tags yet: no weakness
  else
    select coalesce(array_agg(p), '{}') into v_fresh
      from unnest(v_pool) p where p <> all(v_recent);
    select array_agg(t) into v_weaktags from (
      select t from unnest(case when coalesce(array_length(v_fresh, 1), 0) >= v_nweak then v_fresh else v_pool end) t
      order by random() limit v_nweak) x;
    select array_agg(t) into v_resisttags from (
      select t from unnest(v_pool) t where t <> all(coalesce(v_weaktags, '{}'))
      order by random() limit v_nresist) x;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'tag', 'value', t)), '[]'::jsonb)
      into v_weak from unnest(coalesce(v_weaktags, '{}')) t;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'tag', 'value', t)), '[]'::jsonb)
      into v_resist from unnest(coalesce(v_resisttags, '{}')) t;
  end if;

  v_pow := deployable_power();
  v_hp := greatest(500, round(v_pow * v_tiermult));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values (v_name, v_tier, v_weak, v_resist, v_hp, v_hp, now() + make_interval(days => p_days))
    returning id into v_id;
  return v_id;
end $$;

-- Keep the roster reports consistent with the new HP basis.
alter table roster_power_history add column if not exists deployable_power bigint not null default 0;

create or replace function roster_stats()
returns jsonb language sql stable set search_path = public as $$
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
    'boss_hp', jsonb_build_object(
      'Normal', greatest(500, round(deployable_power() * 10)),
      'Heroic', greatest(500, round(deployable_power() * 16)),
      'Mythic', greatest(500, round(deployable_power() * 22))),
    'by_rarity',   (select jsonb_object_agg(rarity, cnt) from (select rarity, count(*) cnt from owned group by rarity) r),
    'by_ascension',(select jsonb_object_agg(ascension::text, cnt) from (select ascension, count(*) cnt from owned group by ascension) x)
  ) from agg a;
$$;

create or replace function roster_snapshot()
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_pow bigint; v_dep bigint; v_cards int; v_owners int; v_players int; v_id bigint;
begin
  select coalesce(sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)), 0)::bigint, count(*)::int, count(distinct pc.player_id)::int
    into v_pow, v_cards, v_owners
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.quantity >= 1;
  v_dep := deployable_power();
  select count(*)::int into v_players from players;
  insert into roster_power_history (players, owned_cards, total_power, deployable_power, boss_hp_normal, boss_hp_heroic, boss_hp_mythic)
    values (v_players, v_cards, v_pow, v_dep,
      greatest(500, round(v_dep * 10)),
      greatest(500, round(v_dep * 16)),
      greatest(500, round(v_dep * 22)))
    returning id into v_id;
  return v_id;
end $$;

notify pgrst, 'reload schema';
