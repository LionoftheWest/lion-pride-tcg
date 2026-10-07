-- effect_start_spawn_settle.sql: two Hunt fixes (2026-10-07).
-- 1. take_player_effect uses up a waiting effect only when its starts_at has come. The 'delay' counter
--    (effects_batch3.sql) moves a prank's starts_at 1 hour later, and use_effect_charge already checks it. Before, a
--    delayed rally / butterfingers / mend (hunt_attack) or lucky_pull (the bot, store.ts) was used up at once.
-- 2. spawn_hunt closes a still-active Hunt through close_hunt (expired, settle_hunt, the 'expired' post) before it
--    makes the new boss. Before, it only set status = 'expired', and close_due_hunts reads only active Hunts, so the
--    prizes of a Hunt that was active at a spawn were never paid. settle_hunt pays once (hunts.settled_at).
-- Both are rebuilt from their LIVE text (2026-10-07) with only these lines. balance_table.sql is rebuilt with the
-- same spawn_hunt text and its guard accepts the new md5, so a re-run of it does not revert this fix.
-- hunt_attack is not changed. Test: card-studio/scripts/test-effect-start-spawn.mjs. Idempotent.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or its result.
do $g$ begin
  if md5(replace(pg_get_functiondef('public.take_player_effect'::regproc), chr(13), '')) not in ('cce674475d68ce72f9882cee39c730a2', '8c5aa2f9c40142cbf1be50ecf1e6509b') then
    raise exception 'effect_start_spawn_settle.sql: the live take_player_effect changed since this file was built. Rebuild from the live text.';
  end if;
  if md5(replace(pg_get_functiondef('public.spawn_hunt'::regproc), chr(13), '')) not in ('f9d7209d29cd2d9fb788141a57bc2323', '87d7ae86ad47945a5e6c7d44f453a1ad') then
    raise exception 'effect_start_spawn_settle.sql: the live spawn_hunt changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.take_player_effect(p_player text, p_primitive text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_amount numeric;
begin
  update player_effects set consumed_at = now()
   where id = (select id from player_effects
                where player_id = p_player and primitive = p_primitive and consumed_at is null
                  and (starts_at is null or starts_at <= now())   -- a delayed prank waits (effects_batch3.sql: delay)
                  and (expires_at is null or expires_at > now())
                order by created_at limit 1 for update skip locked)
  returning coalesce(amount, 0) into v_amount;
  return v_amount;                       -- null = no waiting boon
end $function$;

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
    'frenzied',     'Frenzied: hits harder as it loses HP',
    -- The counter passives (hunt_boss_moves.sql): at most one on a boss.
    'plague',       'Plague: heals and cleanse barely work',
    'shatterer',    'Shatterer: shields and smite barely work',
    'dispeller',    'Dispeller: empower and expose barely work',
    'juggernaut',   'Juggernaut: weaken and stun barely work');
  -- Only the rigged model bosses (tcg-activity/src/boss-model.js MODEL_BOSSES).
  c_names text[] := array['The Rage-Quit Warlord','The Netcode Mutant','Maw of the Meta',
                          'The Lagspike Parasite','The Patch-Day Pumpkin','The Ranked Nightshade',
                          'The Grind Vampire','The Ban-Wave Demon','The Smurf Brute',
                          'The AFK Warzombie','The Hardstuck Skeleton','The Zerg-Rush Queen'];
begin
  -- A Hunt that is still active ends through the normal close path first (close_hunt: expired, settle_hunt pays
  -- the prizes once, the 'expired' post). Before, it was only marked expired, so its prizes were never paid.
  perform close_hunt(a.id) from (select id from hunts where status = 'active' order by id) a;
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
    from (select k from unnest(array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied',
                               (array['plague','shatterer','dispeller','juggernaut'])[1 + floor(random() * 4)::int]]) k
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
end $function$;

comment on function public.take_player_effect(text,text) is $c$[effects] Uses up the oldest waiting effect of the type for the member and returns its amount, or null if none. An effect whose starts_at is still in the future (a delayed prank) is not used up. Called by hunt_attack (mend, rally, butterfingers) and the bot (lucky_pull).$c$;
comment on function public.spawn_hunt(integer,text) is $c$[hunt] Makes a new Hunt boss and returns its id. It first closes every active Hunt with close_hunt, so settle_hunt pays its prizes once. Picks the tier, weak and resist tags, passives, HP and ATK from the balance keys. Called by spawn_weekly_boss and test scripts.$c$;

notify pgrst, 'reload schema';
