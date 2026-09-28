-- The weekly spawn picks ONLY rigged model bosses (2026-09-27). Nathan: "we do need
-- more model bosses put in for now and we'll slowly switch them out" for his own
-- animated bosses. Eight more Mixamo monsters join the first three. boss-model.js maps
-- each name to its GLB. The rest of spawn_hunt is the live definition, unchanged.

CREATE OR REPLACE FUNCTION public.spawn_hunt(p_days integer DEFAULT 3)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_players int; v_tier text; v_nweak int; v_nresist int; v_tiermult numeric;
  v_weak jsonb; v_resist jsonb; v_hp bigint; v_name text; v_id bigint; v_pow bigint;
  v_pool text[]; v_recent text[]; v_fresh text[]; v_weaktags text[]; v_resisttags text[];
  v_passive jsonb; v_pk text;
  v_plabels jsonb := jsonb_build_object(
    'armored',  'Armored: melee attackers deal less',
    'shrouded', 'Shrouded: attacks miss more often',
    'flaming',  'Flaming: burns the attacking card',
    'volatile', 'Volatile: counterattacks hit harder');
  -- Only the rigged model bosses (tcg-activity/src/boss-model.js MODEL_BOSSES).
  c_names text[] := array['The Rage-Quit Warlord','The Netcode Mutant','Maw of the Meta',
                          'The Lagspike Parasite','The Patch-Day Pumpkin','The Ranked Nightshade',
                          'The Grind Vampire','The Ban-Wave Demon','The Smurf Brute',
                          'The AFK Warzombie','The Hardstuck Skeleton'];
begin
  update hunts set status = 'expired' where status = 'active';
  select greatest(1, count(*)) into v_players from players;
  v_tier := (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)];
  v_tiermult := case v_tier when 'Normal' then 8 when 'Heroic' then 12 else 15 end;
  v_nweak   := case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end;
  v_nresist := case v_tier when 'Normal' then 0 when 'Heroic' then 1 else 2 end;

  -- Weak/resist tags come only from slugs that a FAIR SHARE of the draw-pool
  -- attackers carry: at least 4 cards (and 7%), at most 35%. A tag with 1 card is a
  -- weakness nobody can use; origin:smash (59% of attackers) makes every squad match.
  -- If the band has too few tags for this tier, fall back to every tag held by 2+.
  with att as (
    select s.id, s.tag_slugs from subjects s
    where s.tags->>'class' = 'attacker'
      and exists (select 1 from cards c where c.subject_id = s.id and c.in_draw_pool)
  ), cov as (
    select slug, count(distinct att.id) n from att, unnest(att.tag_slugs) slug
    where slug like 'trait:%' or slug like 'origin:%' group by slug
  ), tot as (select count(*) total from att)
  select array_agg(slug), (select array_agg(slug) from cov where n >= 2)
    into v_pool, v_fresh
  from cov, tot
  where n >= greatest(4, ceil(tot.total * 0.07)) and n <= floor(tot.total * 0.35);
  if coalesce(array_length(v_pool, 1), 0) < v_nweak + v_nresist then v_pool := v_fresh; end if;

  select coalesce(array_agg(distinct e->>'value'), '{}') into v_recent
  from (select weak_points from hunts order by id desc limit 4) h,
       lateral jsonb_array_elements(coalesce(h.weak_points, '[]'::jsonb)) e
  where e->>'kind' = 'tag';

  if v_pool is null or array_length(v_pool, 1) is null then
    v_weak := '[]'::jsonb; v_resist := '[]'::jsonb;
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

  -- Boss passive: none on Normal; one random passive on Heroic; volatile also possible on Mythic.
  if v_tier = 'Normal' then
    v_passive := '{}'::jsonb;
  else
    v_pk := case v_tier
      when 'Mythic' then (array['armored','shrouded','flaming','volatile'])[1 + floor(random() * 4)]
      else (array['armored','shrouded','flaming'])[1 + floor(random() * 3)] end;
    v_passive := jsonb_build_object('kind', v_pk, 'label', v_plabels->>v_pk);
  end if;

  v_pow := deployable_power();
  v_hp := greatest(500, round(v_pow * v_tiermult));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at)
    values (v_name, v_tier, v_weak, v_resist, v_passive, v_hp, v_hp, now() + make_interval(days => p_days))
    returning id into v_id;
  return v_id;
end $function$;

notify pgrst, 'reload schema';
