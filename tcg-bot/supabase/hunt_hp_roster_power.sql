-- Boss HP rebalance (2026-09-15): scale HP to the REAL roster power (sum of every owned
-- card's CP), not a flat head-count. This keeps the fight length steady across roster
-- maturity: a weak launch roster gets a weak boss, a strong ascended roster gets a hard
-- boss, with no per-stage re-tuning. Old formula (players * 1500 * tiermult) sized the
-- boss for a mature roster, so early bosses (few cards, no ascension) were unbeatable.
--
-- Formula:  hp = roster_power * 8 * tiermult   (floor 2000)
--   tiermult  Normal 1.0 / Heroic 1.5 / Mythic 2.0
-- Monte-Carlo (scripts/combat-sim.mjs) at 45% daily participation, 3-day window:
--   Normal < 1 day, Heroic ~1.4 days, Mythic ~2 days — identical band at every maturity.
-- Only spawn_hunt changes. The attack rolls and the counter multiplier are untouched.

create or replace function spawn_hunt(p_days int default 3)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_players int; v_tier text; v_nweak int; v_tiermult numeric;
  v_weak jsonb; v_hp bigint; v_name text; v_id bigint; v_pow numeric;
  c_types text[] := array['Character','Creature','Item','Place','Moment'];
  c_names text[] := array['The Salt Kraken','The Lag Beast','The Tilt Titan','Server Gremlin',
                          'The Whiff Wyrm','Rage-Quit Revenant','The Ping Phantom','Meta Hydra',
                          'The Desync Dragon','Frame-Drop Fiend'];
begin
  update hunts set status = 'expired' where status = 'active';
  select greatest(1, count(*)) into v_players from players;
  v_tier := (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)];
  v_tiermult := case v_tier when 'Normal' then 1.0 when 'Heroic' then 1.5 else 2.0 end;
  v_nweak := case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end;
  select jsonb_agg(jsonb_build_object('kind', 'type', 'value', t)) into v_weak
    from (select unnest(c_types) t order by random() limit v_nweak) x;

  -- Total roster power = sum of every owned card's CP (drives the boss size).
  select coalesce(sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)), 0)
    into v_pow
    from player_cards pc
    join cards c on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.quantity >= 1;

  v_hp := greatest(2000, round(v_pow * 8 * v_tiermult));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at)
    values (v_name, v_tier, v_weak, v_hp, v_hp, now() + make_interval(days => p_days))
    returning id into v_id;
  return v_id;
end $$;

notify pgrst, 'reload schema';
