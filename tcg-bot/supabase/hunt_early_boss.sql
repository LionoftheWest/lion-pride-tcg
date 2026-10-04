-- An early boss that closes in the middle of the week (Nathan, 2026-10-04: "a raid boss that will
-- last from tonight to Wednesday evening, then the next raid boss can launch normal on Thursday").
-- 1. spawn_hunt takes an optional tier. NULL keeps the random tier of the weekly spawn.
-- 2. close_hunt(id) closes ONE boss: expired, settle_hunt (the rank prizes), and the 'expired' post.
-- 3. close_due_hunts() closes every active boss whose closes_at has passed. pg_cron runs it every
--    10 minutes. Before, only the Monday 17:00 MT job closed a boss, and spawn_hunt set an active
--    boss to 'expired' WITHOUT settle_hunt, so a mid-week boss would pay no prizes.
-- 4. close_weekly_boss() closes the active boss only when it is due (closes_at within 1 hour), so
--    the Monday job does not end a boss that closes later in the week.
-- Test (rolled back): node scripts/test-hunt-early-boss.mjs [this file]

drop function if exists public.spawn_hunt(integer);
CREATE OR REPLACE FUNCTION public.spawn_hunt(p_days integer DEFAULT 3, p_tier text DEFAULT NULL)
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
  v_cfg := coalesce(v_cfg, '{"Normal":60000,"Heroic":80000,"Mythic":80000,"crew":10}'::jsonb);
  v_hp := greatest(500, coalesce((v_cfg->>v_tier)::bigint, 80000));
  v_hunters := greatest(1, coalesce((v_cfg->>'crew')::int, 10));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  -- Boss stats: the tier ATK (settings hunt_atk) x this boss's own multiplier
  -- (settings hunt_boss_stats, by name, for example {"The Smurf Brute": {"atk_mult": 1.2}}).
  v_atk := round(coalesce((select (value->>v_tier)::numeric from settings where key = 'hunt_atk'),
                          case v_tier when 'Heroic' then 73 when 'Mythic' then 93 else 58 end)
                 * coalesce((select (value->v_name->>'atk_mult')::numeric from settings where key = 'hunt_boss_stats'), 1));
  -- The boss heals are sized to HP / crew (boss-sim.mjs: heals sized to the FULL HP make
  -- every heal worth several squad battles).
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
    values (v_name, v_tier, v_weak, v_resist, v_passive, v_hp, v_hp, now() + make_interval(days => p_days),
            greatest(1, round(v_hp::numeric / v_hunters)), jsonb_build_object('atk', v_atk))
    returning id into v_id;
  return v_id;
end $function$;

create or replace function public.close_hunt(p_hunt bigint)
returns jsonb language plpgsql set search_path = public as $$
declare v_name text; v_settle jsonb;
begin
  update hunts set status = 'expired' where id = p_hunt and status = 'active' returning name into v_name;
  if v_name is null then return jsonb_build_object('ok', true, 'note', 'not_active', 'hunt', p_hunt); end if;
  v_settle := settle_hunt(p_hunt);
  insert into hunt_events (hunt_id, kind, payload)
    values (p_hunt, 'expired', jsonb_build_object('name', v_name, 'settle', v_settle,
      'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
              from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                    group by player_id order by sum(damage) desc limit 3) t)));
  return jsonb_build_object('ok', true, 'closed', p_hunt, 'settled', v_settle);
end $$;

create or replace function public.close_due_hunts()
returns jsonb language plpgsql set search_path = public as $$
declare r record; v_out jsonb := '[]'::jsonb;
begin
  for r in select id from hunts where status = 'active' and closes_at <= now() order by id loop
    v_out := v_out || close_hunt(r.id);
  end loop;
  return jsonb_build_object('ok', true, 'closed', v_out);
end $$;

create or replace function public.close_weekly_boss()
returns jsonb language plpgsql set search_path = public as $$
declare v_old bigint;
begin
  select id into v_old from hunts where status = 'active' and closes_at <= now() + interval '1 hour'
    order by id desc limit 1;
  if v_old is null then return jsonb_build_object('ok', true, 'note', 'none_due'); end if;
  return close_hunt(v_old);
end $$;

revoke all on function public.spawn_hunt(integer, text), public.close_hunt(bigint), public.close_due_hunts(),
  public.close_weekly_boss() from public, anon, authenticated;

do $c$
begin
  if exists (select 1 from cron.job where jobname = 'hunt-close-due') then perform cron.unschedule('hunt-close-due'); end if;
  perform cron.schedule('hunt-close-due', '*/10 * * * *', 'select close_due_hunts();');
end $c$;

notify pgrst, 'reload schema';
