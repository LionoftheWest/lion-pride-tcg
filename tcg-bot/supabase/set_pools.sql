-- Set pools (F-2 PR 2, docs/foundations.md F-2 item 5; Nathan, 2026-10-11): a card has ONE home set, where it is
-- printed and numbered (cards.set_id, cards.set_number). Any other set can add that card to its pull pool, and a set
-- can include a whole set. The player gets the same card (the same cards.id), not a copy.
--
-- The design:
--   1. set_pool(set_id, card_id): one card added to the pool of another set (not its home set).
--   2. set_includes(set_id, included_set_id): a whole set added to the pool of a set, with ITS pool (home cards,
--      set_pool and its own includes), so a "mega set" that includes every set updates by itself. No set includes
--      itself, and no cycle (set_includes_rules refuses one, also between two concurrent writes).
--   3. set_draw_pool: ONE row for each (pool set, card): the cards that a pack of pool_set_id can give. The pool set
--      must be pullable; each card must be in_draw_pool and source draw (the old draw_pool rules). The card keeps
--      its HOME set_id and set_number (an S1 card in the S2 pool still shows "ORI · #014").
--      A pack of set X filters on pool_set_id = X (the bot: tcg-bot/src/draw-pool.ts; open_packs with p_set checks it).
--   4. draw_pool: the same columns as before, ONE row per card: every card that any set_draw_pool row gives. The
--      readers that use every pullable set (the bot's pack with no set, dungeon_card_of, shop_pick_stock) see each
--      card once, so a card in two pools does not get double odds. A card whose home set is not pullable but that
--      is in the pool of a pullable set is in it (a pool makes a card pullable).
--   5. pullable_sets: the counts (cards, owned) come from set_draw_pool (the pool of each set).
--   6. spawn_hunt (boss tag coverage) and ach_tag_badges read draw_pool, not cards.in_draw_pool, so
--      a set that is not pullable yet (a set in preparation) does not change bosses or achievements. Today every
--      in_draw_pool card is source draw in S1, the only set, and S1 is pullable: no result changes
--      (test-set-pools.mjs compares them before and after). ach_track_values also reads cards.in_draw_pool; it is NOT
--      changed here, because the open perf PR (perf_five_slow_calls.sql) replaces it: change it after that PR merges.
--   7. The admin writes of the Sets section (card-studio): admin_set_save, admin_set_pool, admin_set_include. Each
--      checks its input, refuses a stale edit (SQLSTATE LP409) or a bad request (LP400, "admin: ..."), and writes its
--      admin_actions row (admin_log_action) in the same transaction, as admin_write.sql does.
-- With S1 the only set and no pool rows, every draw is exactly the same as before.
-- Runs more than once with the same result. Test: card-studio/scripts/test-set-pools.mjs.

-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the live text it was
-- built from (the first md5) or on its own result (the second md5). Any other change stops it: rebuild this file.
do $g$
declare x text[]; m text;
begin
  foreach x slice 1 in array array[
    ['open_packs(text, bigint[], integer, text)', '27536bef052197d6d509fa7ba49f4ee5', 'b99eae6d7c99c82a567e4c1d875e985f'],
    ['pullable_sets(text)', 'd1d818b4d246e4490c7c2c0bd6f14d58', 'bd005b54bfb92f0bb5a8350716ff14cf'],
    ['spawn_hunt(integer, text)', '87d7ae86ad47945a5e6c7d44f453a1ad', '3a4d34dbcc06f4834204c71aec3bb677'],
    ['ach_tag_badges(text)', '8843b3946ad845ece37481b4955dbf5c', '56ea953ca6228d9c61103376e9e41225'],
    -- not replaced, but they read draw_pool: they must still expect one row per card
    ['dungeon_card_of(text)', '1b92692ef66cd4a6cd2d1cb831a84528', '1b92692ef66cd4a6cd2d1cb831a84528'],
    ['shop_pick_stock(date)', '589f407a4c0961c9ccfdbcc7bc6df5c9', '589f407a4c0961c9ccfdbcc7bc6df5c9']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'set_pools.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. set_pool ----------------------------------------------------------------------------------------------------
create table if not exists public.set_pool (
  set_id text not null references public.card_sets(id) on delete cascade,
  card_id bigint not null references public.cards(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (set_id, card_id));
create index if not exists set_pool_card_id_idx on public.set_pool (card_id);
alter table public.set_pool enable row level security;
revoke all on public.set_pool from anon, authenticated;

-- A pool card comes from ANOTHER set: its home set already gives it.
create or replace function public.set_pool_rules()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if exists (select 1 from cards where id = new.card_id and set_id = new.set_id) then
    raise exception 'set_pool: card % is a card of set % (its home set); a pool holds cards of other sets', new.card_id, new.set_id
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;
drop trigger if exists set_pool_rules on public.set_pool;
create trigger set_pool_rules before insert or update on public.set_pool for each row execute function public.set_pool_rules();

-- 2. set_includes ------------------------------------------------------------------------------------------------
create table if not exists public.set_includes (
  set_id text not null references public.card_sets(id) on delete cascade,
  included_set_id text not null references public.card_sets(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (set_id, included_set_id),
  constraint set_includes_not_self check (set_id <> included_set_id));
create index if not exists set_includes_included_idx on public.set_includes (included_set_id);
alter table public.set_includes enable row level security;
revoke all on public.set_includes from anon, authenticated;

-- No cycle: the new included set must not reach the set (directly or through other includes). The advisory lock
-- makes two writes wait for each other, so two concurrent inserts (A includes B, B includes A) cannot both pass.
create or replace function public.set_includes_rules()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('set_includes_rules'));
  if exists (with recursive r(id) as (
               select new.included_set_id
               union
               select i.included_set_id from set_includes i join r on i.set_id = r.id)
             select 1 from r where r.id = new.set_id) then
    raise exception 'set_includes: % includes % already (directly or through another set), so % cannot include % (a cycle)',
      new.included_set_id, new.set_id, new.set_id, new.included_set_id using errcode = 'check_violation';
  end if;
  return new;
end $function$;
drop trigger if exists set_includes_rules on public.set_includes;
create trigger set_includes_rules before insert or update on public.set_includes for each row execute function public.set_includes_rules();

-- 3. set_draw_pool and draw_pool ---------------------------------------------------------------------------------
create or replace view public.set_draw_pool with (security_invoker = true) as
  with recursive reach (pool_set_id, src_set_id) as (
    select s.id, s.id from public.card_sets s where s.pullable
    union
    select r.pool_set_id, i.included_set_id from reach r join public.set_includes i on i.set_id = r.src_set_id),
  members (pool_set_id, card_id) as (
    select r.pool_set_id, c.id from reach r join public.cards c on c.set_id = r.src_set_id
    union
    select r.pool_set_id, p.card_id from reach r join public.set_pool p on p.set_id = r.src_set_id)
  select m.pool_set_id, c.id, c.subject_id, c.name, c.rarity, c.source, c.image_url, c.artist_credit, c.lore, c.set_id, c.set_number
    from members m join public.cards c on c.id = m.card_id
   where c.in_draw_pool and c.source::text = 'draw';
revoke all on public.set_draw_pool from anon, authenticated;

create or replace view public.draw_pool with (security_invoker = true) as
  select c.id, c.subject_id, c.name, c.rarity, c.source, c.image_url, c.artist_credit, c.lore, c.set_id, c.set_number
    from public.cards c
   where exists (select 1 from public.set_draw_pool p where p.id = c.id);
revoke all on public.draw_pool from anon, authenticated;

-- 4. An open from one set: every card must be in the pool of that set (home, set_pool or an included set) -----------
CREATE OR REPLACE FUNCTION public.open_packs(p_player_id text, p_cards bigint[], p_size integer, p_set text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_want int; v_have int; v_n int; v_open text := gen_random_uuid()::text; -- one id for the packs of this open
begin
  if not exists (select 1 from card_sets where id = p_set and pullable) then
    raise exception 'set_not_pullable: %', coalesce(p_set, 'null') using errcode = 'P0001';
  end if;
  -- set_pools.sql: the pool of the set (set_draw_pool.pool_set_id), not the home set of the card.
  if exists (select 1 from unnest(p_cards) x(id) where not exists (select 1 from set_draw_pool d where d.id = x.id and d.pool_set_id = p_set)) then
    raise exception 'open_packs: a card is not in the draw pool of set %', p_set using errcode = 'P0001';
  end if;
  v_want := coalesce(array_length(p_cards, 1), 0) / greatest(1, p_size);
  if v_want < 1 or v_want > 10 then return 0; end if;
  -- The row lock makes concurrent opens of one player wait, so the balance never goes below 0.
  select pack_balance into v_have from players where id = p_player_id for update;
  v_n := least(coalesce(v_have, 0), v_want);
  if v_n <= 0 then return 0; end if;
  update players set pack_balance = pack_balance - v_n, last_open_set = p_set where id = p_player_id; -- D-85
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, set_id)
    select p_player_id, -1, 'opened', 'open', v_open, p_set from generate_series(1, v_n);
  perform add_cards_to_player(p_player_id, p_cards[1 : v_n * p_size]);
  return v_n;
end $function$;

-- 5. The Open screen counts the pool of each set -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pullable_sets(p_player text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with s as (select * from card_sets where pullable),
  newest as (select id from s order by released_at desc nulls last, sort desc, id desc limit 1),
  -- set_pools.sql: the pool of each set (home cards + set_pool + included sets), so the counts include the pool cards.
  n as (select pool_set_id as set_id, count(*) as cards from set_draw_pool group by pool_set_id),
  o as (select d.pool_set_id as set_id, count(*) as owned from player_cards pc join set_draw_pool d on d.id = pc.card_id
         where pc.player_id = p_player and pc.quantity > 0 group by d.pool_set_id)
  select jsonb_build_object(
    'sets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'code', s.code, 'season', s.season, 'released_at', s.released_at,
        'is_new', s.id = (select id from newest) and (select count(*) from s) > 1,
        'cards', coalesce(n.cards, 0), 'owned', coalesce(o.owned, 0),
        'cover_card_id', s.cover_card_id, 'cover_image_url', c.image_url,
        'pack_color', s.pack_color, 'pack_art_url', s.pack_art_url)
      order by s.sort, s.id)
      from s left join n on n.set_id = s.id left join o on o.set_id = s.id left join cards c on c.id = s.cover_card_id), '[]'::jsonb),
    'last_set', coalesce((select p.last_open_set from players p join s on s.id = p.last_open_set where p.id = p_player),
                         (select id from newest)));
$function$;

-- 6. Bosses and achievement badges read draw_pool (a set that is not pullable yet does not count) --------------------
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
      and exists (select 1 from draw_pool c where c.subject_id = s.id)   -- set_pools.sql: draw_pool (a set that is not pullable does not count)
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

CREATE OR REPLACE FUNCTION public.ach_tag_badges(p_player text)
 RETURNS TABLE(key text, season text, short text, tag text, label text, title text, need integer, have integer, packs integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with pool as (
    select coalesce(c.season, 'Season 1') season, c.subject_id, c.id card_id, s.tag_slugs
      from cards c join subjects s on s.id = c.subject_id
     where c.id in (select id from draw_pool) and c.rarity::text <> 'event'),   -- set_pools.sql: draw_pool, not in_draw_pool
  subj as (
    select p.season, p.subject_id, t.slug
      from pool p cross join lateral unnest(p.tag_slugs) t(slug)
     where t.slug like 'origin:%' or t.slug like 'type:%'
     group by 1, 2, 3),
  mine as (
    select distinct p.season, p.subject_id from pool p
      join player_cards pc on pc.card_id = p.card_id and pc.player_id = p_player and pc.quantity > 0),
  b as (
    select s.season, s.slug, count(*)::int need, count(m.subject_id)::int have
      from subj s left join mine m on m.season = s.season and m.subject_id = s.subject_id
     group by 1, 2)
  select 'tag:' || sh.short || ':' || b.slug, b.season, sh.short, b.slug,
         initcap(split_part(b.slug, ':', 2)), initcap(split_part(b.slug, ':', 2)) || ' Master ' || sh.short,
         b.need, b.have, (ceil(b.need / balance_num('achievement_rewards', 'tag_badge', 'cards_per_pack')) + balance_num('achievement_rewards', 'tag_badge', 'extra_packs'))::int
    from b cross join lateral (select coalesce('S' || substring(b.season from '(\d+)'), b.season) short) sh
   order by b.season, b.slug like 'type:%', b.need desc, b.slug;
$function$;

-- 7. The admin writes of the Sets section ------------------------------------------------------------------------
-- The fields an admin can set. id is set once (create); last_number and created_at belong to the database.
create or replace function public.admin_set_fields(p card_sets)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code, 'pack_color', p.pack_color, 'released_at', p.released_at,
    'pullable', p.pullable, 'sort', p.sort, 'season', p.season, 'pack_art_url', p.pack_art_url, 'cover_card_id', p.cover_card_id);
$function$;

-- Create a set (p_before null) or edit one (p_before = admin_set_fields as the editor loaded it; LP409 when it changed).
-- p_set holds only the fields to set. A create needs id, name, code, pack_color and season.
create or replace function public.admin_set_save(p_actor text, p_set jsonb, p_before jsonb, p_reason text default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare k text; v_id text := p_set->>'id'; v_old card_sets; v_new card_sets; v_create boolean; v_aid bigint;
  editable constant text[] := array['id', 'name', 'code', 'pack_color', 'released_at', 'pullable', 'sort', 'season', 'pack_art_url', 'cover_card_id'];
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then raise exception using errcode = 'LP400', message = 'admin: the actor is required'; end if;
  if p_set is null or jsonb_typeof(p_set) <> 'object' then raise exception using errcode = 'LP400', message = 'admin: the set must be an object'; end if;
  for k in select jsonb_object_keys(p_set) loop
    if not k = any(editable) then raise exception using errcode = 'LP400', message = format('admin: %s cannot be set', k); end if;
  end loop;
  if v_id is null or v_id !~ '^[A-Z0-9]{1,8}$' then
    raise exception using errcode = 'LP400', message = 'admin: the set id is 1 to 8 capital letters or digits (for example S2)';
  end if;
  select * into v_old from card_sets where id = v_id for update;
  v_create := not found;
  if v_create and p_before is not null then perform admin_stale(format('set %s', v_id), null, p_before); end if;
  if not v_create and p_before is null then
    raise exception using errcode = 'LP409', message = format('admin: the set %s exists already. Open it to change it.', v_id);
  end if;
  if not v_create and admin_set_fields(v_old) is distinct from p_before then perform admin_stale(format('set %s', v_id), admin_set_fields(v_old), p_before); end if;
  begin
    if v_create then
      v_new := jsonb_populate_record(null::card_sets, jsonb_build_object('id', v_id, 'pullable', true, 'sort', 0) || p_set);
    else
      v_new := jsonb_populate_record(v_old, p_set);
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or invalid_parameter_value then
    raise exception using errcode = 'LP400', message = 'admin: a value has the wrong type: ' || sqlerrm;
  end;
  v_new.name := btrim(v_new.name);
  v_new.code := upper(btrim(v_new.code));
  v_new.pack_color := lower(btrim(v_new.pack_color));
  v_new.pack_art_url := nullif(btrim(v_new.pack_art_url), '');
  if v_new.name is null or length(v_new.name) not between 1 and 60 then raise exception using errcode = 'LP400', message = 'admin: the name is 1 to 60 characters'; end if;
  if v_new.code is null or v_new.code !~ '^[A-Z0-9]{1,8}$' then raise exception using errcode = 'LP400', message = 'admin: the code is 1 to 8 capital letters or digits (for example ORI)'; end if;
  if v_new.pack_color is null or v_new.pack_color !~ '^#[0-9a-f]{6}$' then raise exception using errcode = 'LP400', message = 'admin: the pack color is #rrggbb'; end if;
  if v_new.season is null or v_new.season < 1 then raise exception using errcode = 'LP400', message = 'admin: the season is a whole number of 1 or more'; end if;
  if v_new.pullable is null then v_new.pullable := true; end if;
  if v_new.sort is null then v_new.sort := 0; end if;
  -- https:// only, except http:// to localhost or 127.0.0.1 (the local copy serves storage there: the studio's local test).
  if v_new.pack_art_url is not null and (length(v_new.pack_art_url) > 500
      or v_new.pack_art_url !~ '^(https://[^[:space:]/]+(/[^[:space:]]*)?|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/[^[:space:]]*)$') then
    raise exception using errcode = 'LP400', message = 'admin: the pack art is an https:// address of up to 500 characters (http:// only to localhost or 127.0.0.1)';
  end if;
  if v_new.cover_card_id is not null and not exists (select 1 from cards where id = v_new.cover_card_id and set_id = v_id) then
    raise exception using errcode = 'LP400', message = format('admin: the cover card must be a card of set %s (its home set)', v_id);
  end if;
  if exists (select 1 from card_sets where id <> v_id and name = v_new.name) then raise exception using errcode = 'LP400', message = format('admin: another set has the name %s', v_new.name); end if;
  if exists (select 1 from card_sets where id <> v_id and code = v_new.code) then raise exception using errcode = 'LP400', message = format('admin: another set has the code %s', v_new.code); end if;
  -- The bot's pack with no set and every reward draw need at least one pullable set.
  if not v_new.pullable and not exists (select 1 from card_sets where id <> v_id and pullable) then
    raise exception using errcode = 'LP400', message = 'admin: this is the last pullable set; packs and rewards need one';
  end if;
  if v_create then
    insert into card_sets (id, name, code, released_at, pullable, sort, pack_color, pack_art_url, season, cover_card_id)
      values (v_id, v_new.name, v_new.code, v_new.released_at, v_new.pullable, v_new.sort, v_new.pack_color, v_new.pack_art_url, v_new.season, v_new.cover_card_id)
      returning * into v_new;
  else
    if admin_set_fields(v_new) = admin_set_fields(v_old) then raise exception using errcode = 'LP400', message = 'admin: nothing changed'; end if;
    update card_sets set name = v_new.name, code = v_new.code, released_at = v_new.released_at, pullable = v_new.pullable, sort = v_new.sort,
                         pack_color = v_new.pack_color, pack_art_url = v_new.pack_art_url, season = v_new.season, cover_card_id = v_new.cover_card_id
     where id = v_id returning * into v_new;
  end if;
  v_aid := admin_log_action(p_actor, case when v_create then 'set_create' else 'set_edit' end, 'card_set', v_id,
    case when v_create then null else admin_set_fields(v_old) end, admin_set_fields(v_new), p_reason, 'studio');
  return jsonb_build_object('action_id', v_aid, 'created', v_create, 'set', admin_set_fields(v_new));
end $function$;

-- Add cards of other sets to the pool of a set, or remove them (up to 500 at a time). Cards in the pool already
-- (add) or not in it (remove) are skipped; the result counts the rows that changed.
create or replace function public.admin_set_pool(p_actor text, p_set text, p_cards bigint[], p_add boolean, p_reason text default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_n int; v_bad bigint[]; v_aid bigint; v_ids bigint[];
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then raise exception using errcode = 'LP400', message = 'admin: the actor is required'; end if;
  if p_add is null then raise exception using errcode = 'LP400', message = 'admin: add or remove is required'; end if;
  perform 1 from card_sets where id = p_set for update;
  if not found then raise exception using errcode = 'LP400', message = format('admin: no set %s', coalesce(p_set, 'null')); end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_cards) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 500 then
    raise exception using errcode = 'LP400', message = 'admin: choose 1 to 500 cards';
  end if;
  if p_add then
    select array_agg(x order by x) into v_bad from unnest(v_ids) x where not exists (select 1 from cards c where c.id = x);
    if v_bad is not null then raise exception using errcode = 'LP400', message = format('admin: no card with the id %s', array_to_string(v_bad, ', ')); end if;
    select array_agg(c.id order by c.id) into v_bad from cards c where c.id = any(v_ids) and c.set_id = p_set;
    if v_bad is not null then
      raise exception using errcode = 'LP400', message = format('admin: the cards %s are cards of set %s (their home set): a pool holds cards of other sets', array_to_string(v_bad, ', '), p_set);
    end if;
    insert into set_pool (set_id, card_id) select p_set, x from unnest(v_ids) x on conflict do nothing;
  else
    delete from set_pool where set_id = p_set and card_id = any(v_ids);
  end if;
  get diagnostics v_n = row_count;
  v_aid := admin_log_action(p_actor, case when p_add then 'set_pool_add' else 'set_pool_remove' end, 'card_set', p_set,
    null, jsonb_build_object('cards', to_jsonb(v_ids), 'changed', v_n), p_reason, 'studio');
  return jsonb_build_object('action_id', v_aid, 'set', p_set, 'add', p_add, 'changed', v_n,
    'pool', (select count(*) from set_pool where set_id = p_set));
end $function$;

-- Include a whole set in the pool of a set, or exclude it. A cycle is refused (set_includes_rules).
create or replace function public.admin_set_include(p_actor text, p_set text, p_included text, p_add boolean, p_reason text default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_n int; v_aid bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then raise exception using errcode = 'LP400', message = 'admin: the actor is required'; end if;
  if p_add is null then raise exception using errcode = 'LP400', message = 'admin: include or exclude is required'; end if;
  if not exists (select 1 from card_sets where id = p_set) then raise exception using errcode = 'LP400', message = format('admin: no set %s', coalesce(p_set, 'null')); end if;
  if not exists (select 1 from card_sets where id = p_included) then raise exception using errcode = 'LP400', message = format('admin: no set %s', coalesce(p_included, 'null')); end if;
  if p_set = p_included then raise exception using errcode = 'LP400', message = 'admin: a set cannot include itself'; end if;
  if p_add then
    if exists (select 1 from set_includes where set_id = p_set and included_set_id = p_included) then
      perform admin_stale(format('the includes of set %s', p_set), 'true'::jsonb, 'false'::jsonb);
    end if;
    begin
      insert into set_includes (set_id, included_set_id) values (p_set, p_included);
    exception when check_violation then
      raise exception using errcode = 'LP400', message = format('admin: %s includes %s already (directly or through another set); including it would make a cycle', p_included, p_set);
    end;
  else
    delete from set_includes where set_id = p_set and included_set_id = p_included;
    get diagnostics v_n = row_count;
    if v_n = 0 then perform admin_stale(format('the includes of set %s', p_set), 'false'::jsonb, 'true'::jsonb); end if;
  end if;
  v_aid := admin_log_action(p_actor, case when p_add then 'set_include' else 'set_exclude' end, 'card_set', p_set,
    jsonb_build_object('included', not p_add, 'set', p_included), jsonb_build_object('included', p_add, 'set', p_included), p_reason, 'studio');
  return jsonb_build_object('action_id', v_aid, 'set', p_set, 'included_set', p_included, 'included', p_add,
    'includes', (select coalesce(jsonb_agg(included_set_id order by included_set_id), '[]'::jsonb) from set_includes where set_id = p_set));
end $function$;

-- 8. Locked like every function (lockdown_grants.sql) ------------------------------------------------------------
revoke execute on function public.set_pool_rules() from public, anon, authenticated;
revoke execute on function public.set_includes_rules() from public, anon, authenticated;
revoke execute on function public.admin_set_fields(card_sets) from public, anon, authenticated;
revoke execute on function public.admin_set_save(text, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.admin_set_pool(text, text, bigint[], boolean, text) from public, anon, authenticated;
revoke execute on function public.admin_set_include(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_fields(card_sets) to service_role;
grant execute on function public.admin_set_save(text, jsonb, jsonb, text) to service_role;
grant execute on function public.admin_set_pool(text, text, bigint[], boolean, text) to service_role;
grant execute on function public.admin_set_include(text, text, text, boolean, text) to service_role;
grant select on public.set_pool, public.set_includes, public.set_draw_pool, public.draw_pool to service_role;

-- 9. Documentation -----------------------------------------------------------------------------------------------
comment on table public.set_pool is '[cards] F-2 set pools: a card of another set added to the pull pool of set_id. The card keeps its home set and number (cards.set_id, set_number). admin_set_pool writes it.';
comment on column public.set_pool.set_id is 'The set whose packs can give the card (card_sets.id).';
comment on column public.set_pool.card_id is 'The card (cards.id); its home set is another set (set_pool_rules).';
comment on column public.set_pool.added_at is 'When the card was added to the pool.';
comment on table public.set_includes is '[cards] F-2 set pools: set_id includes the whole pool of included_set_id (its home cards, set_pool and its includes). No self include, no cycle (set_includes_rules). admin_set_include writes it.';
comment on column public.set_includes.set_id is 'The set that includes (card_sets.id).';
comment on column public.set_includes.included_set_id is 'The set that is included (card_sets.id).';
comment on column public.set_includes.added_at is 'When the set was included.';
comment on view public.set_draw_pool is 'The cards a pack of pool_set_id can give, one row per (pool set, card): the home cards of the set, its set_pool cards and the pools of its included sets. The pool set is pullable; each card is in_draw_pool and source draw. The bot pack with a set and open_packs(p_set) read it.';
comment on column public.set_draw_pool.pool_set_id is 'The set whose pack gives this card (a pack of set X filters on pool_set_id = X).';
comment on column public.set_draw_pool.id is 'The card id (cards.id).';
comment on column public.set_draw_pool.subject_id is 'The subject of the card (cards.subject_id).';
comment on column public.set_draw_pool.name is 'The card name (cards.name).';
comment on column public.set_draw_pool.rarity is 'The card rarity (cards.rarity); the pack draw groups the pool by it.';
comment on column public.set_draw_pool.source is 'Always draw here (cards.source).';
comment on column public.set_draw_pool.image_url is 'The card image (cards.image_url).';
comment on column public.set_draw_pool.artist_credit is 'The artist (cards.artist_credit).';
comment on column public.set_draw_pool.lore is 'The card text (cards.lore).';
comment on column public.set_draw_pool.set_id is 'The HOME set of the card (cards.set_id), not the pool set.';
comment on column public.set_draw_pool.set_number is 'The number of the card in its home set (cards.set_number).';
comment on view public.draw_pool is 'The cards any draw can give, one row per card: every card of set_draw_pool (a pullable set gives it from its home cards, its pool or an included set). The bot pack with no set, dungeon_card_of (Dungeon chests and loot, Dungeon / Gauntlet prizes), shop_pick_stock, spawn_hunt and the achievement functions read it.';
comment on column public.draw_pool.set_id is 'The HOME set of the card (cards.set_id). A pack of one set reads set_draw_pool (pool_set_id), not this.';
comment on function public.open_packs(text, bigint[], integer, text) is 'Opens up to 10 packs from one set: the set must be pullable and each card in its pool (set_draw_pool.pool_set_id; else an error). Then the same as open_packs(text, bigint[], integer), with the set on the pack_ledger rows. Returns the packs opened.';
comment on function public.pullable_sets(text) is 'The Open screen in one statement: {sets: [id, name, code, season, released_at, is_new, cards (a pack of the set can give: set_draw_pool), owned (of those, by the member), cover_card_id, cover_image_url, pack_color, pack_art_url], last_set (D-85)}.';
comment on function public.set_pool_rules() is 'Trigger on set_pool: refuses a card whose home set is the pool set.';
comment on function public.set_includes_rules() is 'Trigger on set_includes: refuses a cycle (the included set reaches the set), under an advisory lock so two concurrent writes cannot make one.';
comment on function public.admin_set_fields(card_sets) is 'The admin fields of a set as jsonb (id, name, code, pack_color, released_at, pullable, sort, season, pack_art_url, cover_card_id): the p_before of admin_set_save.';
comment on function public.admin_set_save(text, jsonb, jsonb, text) is 'Admin: create a set (p_before null) or edit one (p_before = admin_set_fields as loaded; LP409 when it changed). Checks every field, refuses to turn off the last pullable set, logs set_create / set_edit in admin_actions.';
comment on function public.admin_set_pool(text, text, bigint[], boolean, text) is 'Admin: add cards of other sets to the pool of a set, or remove them (1 to 500). Logs set_pool_add / set_pool_remove in admin_actions.';
comment on function public.admin_set_include(text, text, text, boolean, text) is 'Admin: include a whole set in the pool of a set, or exclude it. A cycle is refused. Logs set_include / set_exclude in admin_actions.';

notify pgrst, 'reload schema';
