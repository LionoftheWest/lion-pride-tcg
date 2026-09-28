-- Fixed boss HP (Nathan, 2026-09-28: "it should be a set HP that can handle tons of players
-- regardless"; "10+ players ... up to 7x/player a week ... a legit challenge to destroy").
-- The HP no longer depends on the player count or the card power: one number per tier from
-- the settings dial 'hunt_hp' (boss-sim.mjs FIXED mode, calibrated on the real fights of
-- 2026-09-28: one top squad battle = ~3,400 net damage on a Normal, ~1,600 on a Mythic).
--   Normal  80,000: 10 top squads a day win on day ~3.
--   Heroic 100,000: 10 top squads a day win on day ~5.7 (86%).
--   Mythic 100,000: 10 top squads EVERY day for 7 days win 40% of the time.
-- crew = the HP share that sizes the boss heals (hp_share = HP / crew), so a heal is the
-- same size for any number of players. spawn_hunt = the live definition with the HP block
-- replaced. New spawns only.

insert into settings (key, value) values ('hunt_hp',
  '{"Normal":80000,"Heroic":100000,"Mythic":100000,"crew":10}'::jsonb)
  on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.spawn_hunt(p_days integer DEFAULT 3)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_players int; v_tier text; v_nweak int; v_nresist int; v_tiermult numeric;
  v_weak jsonb; v_resist jsonb; v_hp bigint; v_name text; v_id bigint; v_pow bigint;
  v_pool text[]; v_recent text[]; v_fresh text[]; v_weaktags text[]; v_resisttags text[];
  v_passive jsonb; v_pk text; v_plist jsonb; v_hunters int;
  v_cfg jsonb;
  v_plabels jsonb := jsonb_build_object(
    'armored',      'Armored: melee attackers deal less',
    'shrouded',     'Shrouded: attacks miss more often',
    'flaming',      'Flaming: burns the attacking card',
    'volatile',     'Volatile: counterattacks hit harder',
    'regenerating', 'Regenerating: heals a little every turn',
    'thorns',       'Thorns: part of your damage comes back to your card',
    'frenzied',     'Frenzied: hits harder as it loses HP');
  -- Only the rigged model bosses (tcg-activity/src/boss-model.js MODEL_BOSSES).
  c_names text[] := array['The Rage-Quit Warlord','The Netcode Mutant','Maw of the Meta',
                          'The Lagspike Parasite','The Patch-Day Pumpkin','The Ranked Nightshade',
                          'The Grind Vampire','The Ban-Wave Demon','The Smurf Brute',
                          'The AFK Warzombie','The Hardstuck Skeleton'];
begin
  update hunts set status = 'expired' where status = 'active';
  v_tier := (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)];
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

  -- Stacking passives (Nathan, 2026-09-28): Normal 1, Heroic 2, Mythic 3, all different.
  -- passive.kind/label = the first (older readers); passive.list = all of them.
  select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'label', v_plabels->>k)), '[]'::jsonb) into v_plist
    from (select k from unnest(array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied']) k
          order by random() limit case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end) x;
  v_passive := jsonb_build_object('kind', v_plist->0->>'kind', 'label', v_plist->0->>'label', 'list', v_plist);

  -- Fixed HP per tier (the settings dial 'hunt_hp', see the header).
  select value into v_cfg from settings where key = 'hunt_hp';
  v_cfg := coalesce(v_cfg, '{"Normal":80000,"Heroic":100000,"Mythic":100000,"crew":10}'::jsonb);
  v_hp := greatest(500, coalesce((v_cfg->>v_tier)::bigint, 100000));
  v_hunters := greatest(1, coalesce((v_cfg->>'crew')::int, 10));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  -- The boss heals are sized to HP / crew (boss-sim.mjs: heals sized to the FULL HP make
  -- every heal worth several squad battles).
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share)
    values (v_name, v_tier, v_weak, v_resist, v_passive, v_hp, v_hp, now() + make_interval(days => p_days),
            greatest(1, round(v_hp::numeric / v_hunters)))
    returning id into v_id;
  return v_id;
end $function$;

notify pgrst, 'reload schema';
