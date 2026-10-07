-- Boss HP for the bosses to come (Nathan, 2026-10-06): the 40,000 Mythic boss was nearly dead in one day.
--   settings.hunt_hp: Normal 70,000, Heroic 80,000, Mythic 80,000 (from 30,000 / 40,000 / 40,000).
--   The heal fix: a boss heal is sized to hunts.hp_share, which was HP / crew. With more HP that means more healing
--   per attack, and a regenerating boss becomes unkillable (the simulation: 0% killed at 75,000). Now hp_share =
--   settings.hunt_hp.heal_share (3,000, the size of today's bosses), whatever the HP.
-- The simulation (real member-days of both bosses, card-studio/hunt-hp-sim.local.mjs, the exploit day left out):
-- Normal 70,000 killed in 100% (day 3.5), Heroic 80,000 in 97% (day 4.3), Mythic 80,000 in about 60% (day 4.7).
-- Only a new boss reads these numbers: the live boss keeps its HP and its share (Nathan: no change to it).
-- spawn_hunt is rebuilt from its LIVE text with the share line only; the guard refuses if it changed.
-- Test: card-studio/scripts/test-boss-hp.mjs.
do $g$ begin
  -- balance_table.sql (2026-10-03): the functions below read public.balance, so it must exist first.
  if to_regclass('public.balance') is null then
    raise exception '%: apply balance_table.sql first (these functions read the balance table)', 'boss_hp_heal_share.sql';
  end if;
  if md5(replace(pg_get_functiondef('public.spawn_hunt'::regproc), chr(13), '')) not in ('c754ef43fcbf05328e8e1a90f8445007', '2ebcc17b77256bc9cede8ef0fb2f3f3b') then
    raise exception 'boss_hp_heal_share.sql: the live spawn_hunt changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;

-- balance_table.sql moved settings.hunt_hp into balance boss_hp (2026-10-06): the numbers are set there.
update public.balance set value = value || '{"Normal": 70000, "Heroic": 80000, "Mythic": 80000, "heal_share": 3000}'::jsonb where key = 'boss_hp';

CREATE OR REPLACE FUNCTION public.spawn_hunt(p_days integer DEFAULT 3, p_tier text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_players int; v_tier text; v_nweak int; v_nresist int; v_tiermult numeric;
  v_weak jsonb; v_resist jsonb; v_hp bigint; v_name text; v_id bigint; v_pow bigint;
  v_pool text[]; v_recent text[]; v_fresh text[]; v_weaktags text[]; v_resisttags text[];
  v_passive jsonb; v_pk text; v_plist jsonb; v_hunters int;
  v_cfg jsonb; v_atk int;
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
                          'The AFK Warzombie','The Hardstuck Skeleton','The Zerg-Rush Queen'];
begin
  update hunts set status = 'expired' where status = 'active';
  -- p_tier picks the tier (an early boss, Nathan 2026-10-04); NULL = random, as the weekly spawn does.
  if p_tier is not null and p_tier not in ('Normal', 'Heroic', 'Mythic') then raise exception 'bad tier %', p_tier; end if;
  v_tier := coalesce(p_tier, (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)]);
  v_nweak   := balance_num('boss_tiers', v_tier, 'weak')::int;      -- balance_table.sql
  v_nresist := balance_num('boss_tiers', v_tier, 'resist')::int;

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
  where n >= greatest(balance_num('boss_tags', 'min_cards'), ceil(tot.total * balance_num('boss_tags', 'min_share')))
    and n <= floor(tot.total * balance_num('boss_tags', 'max_share'));
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
          order by random() limit balance_num('boss_tiers', v_tier, 'passives')::int) x;
  v_passive := jsonb_build_object('kind', v_plist->0->>'kind', 'label', v_plist->0->>'label', 'list', v_plist);

  -- Fixed HP per tier (balance boss_hp).
  v_cfg := balance_get('boss_hp');
  v_hp := greatest((v_cfg->>'floor')::bigint, balance_num('boss_hp', v_tier)::bigint);
  v_hunters := greatest(1, (v_cfg->>'crew')::int);
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  -- Boss stats: the tier ATK (balance boss_atk) x this boss's own multiplier
  -- (balance boss_stats, by name, for example {"The Smurf Brute": {"atk_mult": 1.2}}).
  v_atk := round(balance_num('boss_atk', v_tier)
                 * coalesce((balance_get('boss_stats')->v_name->>'atk_mult')::numeric, 1));
  -- The boss heals are sized to HP / crew (boss-sim.mjs: heals sized to the FULL HP make
  -- every heal worth several squad battles).
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
    values (v_name, v_tier, v_weak, v_resist, v_passive, v_hp, v_hp, now() + make_interval(days => p_days),
            -- the heal share: a fixed size (hunt_hp.heal_share), not HP / crew, so more HP does not mean more healing
            coalesce((v_cfg->>'heal_share')::bigint, greatest(1, round(v_hp::numeric / v_hunters))), jsonb_build_object('atk', v_atk))
    returning id into v_id;
  return v_id;
end $function$
;

notify pgrst, 'reload schema';
