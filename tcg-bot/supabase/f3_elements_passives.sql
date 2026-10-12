-- f3_elements_passives.sql (2026-10-12): F-3 PR 2, `elements` and `passives` tables, the fixed copies removed (docs/foundations.md F-3 item 1).
-- Before: the elements were in three lists that did not agree (element_aliases() 13 with their words, dungeon_make_foe 8 with its own
-- counter map, tcg-activity/src/elements.js a hand copy of the 13 with the look), and the Hunt boss and Dungeon foe passives were typed
-- in spawn_hunt (7 + 4 counter passives, their labels), hunt_attack (the phase 2 pool and its labels) and dungeon_make_foe (the 7).
-- After, ONE list of each, read by the functions:
--   elements   key, name, ord (the priority when a card has several, as card_element), aliases (the trait words), the look (glyph,
--              color, color2), weak_to (the element that beats a foe of this element in the Dungeon: the old counter map), and the
--              Dungeon foe pool (dungeon_foe, dungeon_ord: the old 8 in their old order). Hunt weak points are tags chosen by
--              spawn_hunt, not elements, so the Hunt reads no element list except card_element.
--   passives   key, label, ord, where it can appear (on_boss, on_foe), counter (the boss gets at most one, chosen at random),
--              phase2 (the boss can gain it below boss_moves.phase2_at), params (the balance keys the passive reads, checked).
-- NO CHANGE IN PLAY: every Dungeon foe, every spawned boss and every Hunt fight is the same (the same random draws: the lists keep
-- their old order, so each index maps to the same element or passive). Where the old lists disagree, each caller keeps its own
-- behavior (the Dungeon keeps its 8 elements through dungeon_foe). The owner's questions are in the PR text.
-- combat_element_map() was IMMUTABLE and folded into each plan; as STABLE it rebuilt its map on every call (combat_card_facts 1 ms -> 33 ms over
-- all subjects, hunt_autopick +23%, measured on the local copy). It now reads ONE cached row (elements_cache), rebuilt by a statement trigger
-- on elements.
-- Volatility: element_aliases() read a constant VALUES list and was IMMUTABLE. It now reads a table, so it and the five functions that
-- depend on it (element_of, card_element, ach_has_element, combat_element_map, combat_card_facts) are STABLE. Nothing indexes them.
-- Test: card-studio/scripts/test-elements-passives.mjs (rolled back; MUTATE=<name> must FAIL). The golden fights
-- (card-studio/scripts/combat-golden.mjs, CANDIDATE=this file) are the same. Idempotent: the seed runs only into an empty table.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.element_aliases()', '4e5a811f8a784cf6aea70c7e9ff72152', '44393895be2bfaf9158ad4b6e6ac15da'),
    ('public.element_of(text)', '931bb00073db292f2aa3388511a075f9', 'bbb73ffbb38ad6862145a2e44899d1de'),
    ('public.card_element(text[])', 'c831ce53c14c64d5e97d3c8143f1c647', 'caee7233fa8697fb11440a99e1283cee'),
    ('public.ach_has_element(jsonb)', '2a18b4f269a791202de3031f7966aa65', '0799b8c6eba2d87e29e1d3be16d8daa4'),
    ('public.combat_element_map()', '2eb703916e6d46bd81fa84397fbddfbf', 'f7e84e8721c25b8970a9cc78582bdc05'),
    ('public.combat_card_facts(text[], text[])', 'f4044643ed5118e398419c690cb228c2', 'bdd2f182e15dd80268a6cace7ba5e1bf'),
    ('public.dungeon_make_foe(text, integer, integer, text)', '7084ee6233be63df46553f640aaea96b', '87c46db4fc8a660692944ef69171abd0'),
    ('public.spawn_hunt(integer, text)', '3a4d34dbcc06f4834204c71aec3bb677', '01612d444d1426c3dc4c4b8aea6408d4'),
    ('public.hunt_attack(text, bigint, bigint)', 'db5a58160456e81ee8c66f3200f3a379', '8ccc00dfb53f9b0203054a7e00120afb')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'f3_elements_passives.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. elements
-- The words of one element: lower case, trimmed, no empty word, no repeat (an immutable helper for the check).
create or replace function public.alias_list_ok(p_aliases text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(cardinality(p_aliases) > 0
         and not exists (select 1 from unnest(p_aliases) a where a is null or a = '' or a <> lower(trim(a)))
         and cardinality(p_aliases) = (select count(distinct a) from unnest(p_aliases) a), false);
$$;

create table if not exists public.elements (
  key         text primary key check (key ~ '^[a-z]+$'),
  name        text not null check (name <> '' and name = trim(name)),
  ord         integer not null unique check (ord >= 1),
  aliases     text[] not null check (public.alias_list_ok(aliases)),
  glyph       text not null check (glyph <> ''),
  color       text not null check (color ~ '^#[0-9a-f]{6}$'),
  color2      text not null check (color2 ~ '^#[0-9a-f]{6}$'),
  weak_to     text references public.elements (key),
  dungeon_foe boolean not null default false,
  dungeon_ord integer unique check (dungeon_ord >= 1),
  updated_at  timestamptz not null default now(),
  check (key = any(aliases)),
  check (weak_to is distinct from key),
  check (dungeon_foe = (dungeon_ord is not null)),
  check (not dungeon_foe or weak_to is not null)
);
alter table public.elements enable row level security;
revoke all on public.elements from anon, authenticated;

-- One word means one element: a word that another element already has is refused.
create or replace function public.elements_check() returns trigger language plpgsql set search_path = public as $$
declare v_dup text;
begin
  select a into v_dup from public.elements e, unnest(e.aliases) a where e.key <> new.key and a = any(new.aliases) limit 1;
  if v_dup is not null then raise exception 'elements: the word "%" belongs to another element', v_dup; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists elements_check on public.elements;
create trigger elements_check before insert or update on public.elements for each row execute function public.elements_check();


-- The cache of combat_element_map(): one row, rebuilt after each statement that changes elements (the map is read for every card of every
-- Hunt fight and auto-pick, so it must not be built again on each call).
create table if not exists public.elements_cache (
  id  integer primary key check (id = 1),
  map jsonb not null
);
alter table public.elements_cache enable row level security;
revoke all on public.elements_cache from anon, authenticated;
create or replace function public.elements_cache_rebuild() returns void language plpgsql set search_path = public as $$
begin
  insert into public.elements_cache (id, map)
    select 1, jsonb_build_object('alias', (select jsonb_object_agg(a.alias, jsonb_build_array(a.element, a.ord)) from public.element_aliases() a),
                                 'canon', (select jsonb_agg(distinct x.element) from public.element_aliases() x))
    on conflict (id) do update set map = excluded.map;
end $$;
create or replace function public.elements_cache_refresh() returns trigger language plpgsql set search_path = public as $$
begin
  perform public.elements_cache_rebuild();
  return null;
end $$;
drop trigger if exists elements_cache_refresh on public.elements;
create trigger elements_cache_refresh after insert or update or delete on public.elements for each statement execute function public.elements_cache_refresh();

-- The seed: the 13 elements of element_aliases() (the words and the order), the look of elements.js, the counter map and the 8 foe
-- elements of dungeon_make_foe (in their old order). Only into an empty table: a re-run never undoes an edit.
do $s$
begin
  if exists (select 1 from public.elements) then return; end if;
  insert into public.elements (key, name, ord, aliases, glyph, color, color2) values
    ('fire',      'Fire',      1,  array['fire','flame','burning'],                      '🔥', '#ff6a3c', '#ffd23e'),
    ('water',     'Water',     2,  array['water','aqua','ocean'],                        '💧', '#3fb0ff', '#8fe0ff'),
    ('lightning', 'Lightning', 3,  array['lightning','electric','thunder'],              '⚡', '#ffe23e', '#fff6a0'),
    ('ice',       'Ice',       4,  array['ice','frost','frozen'],                        '❄', '#7fe0ff', '#dffbff'),
    ('nature',    'Nature',    5,  array['nature','grass','plant','wood'],               '🌿', '#5ddb7a', '#c8ff9a'),
    ('earth',     'Earth',     6,  array['earth','rock','stone','ground'],               '⛰', '#c79a5a', '#efd39a'),
    ('air',       'Air',       7,  array['air','wind','flying'],                         '🌪', '#bfeaff', '#ffffff'),
    ('shadow',    'Shadow',    8,  array['shadow','dark','ghost'],                       '🌑', '#9a5cff', '#c9a6ff'),
    ('light',     'Light',     9,  array['light','holy','radiant'],                      '✨', '#ffe27a', '#ffffff'),
    ('arcane',    'Arcane',    10, array['arcane','magic','fairy','mystic'],             '🔮', '#e06aff', '#ffc0ff'),
    ('psychic',   'Psychic',   11, array['psychic','psi'],                               '🌀', '#ff6ad0', '#ffd0ef'),
    ('toxic',     'Toxic',     12, array['toxic','poison','venom'],                      '☣', '#9cd93c', '#e0ff9a'),
    ('metal',     'Metal',     13, array['metal','robot','mechanical','tech','steel'],   '⚙', '#a8bccf', '#e6f0fa');
  -- The Dungeon foe pool and its counter map (dungeon_make_foe: els and counter). One UPDATE: the checks and the foreign key see the end state.
  update public.elements e set dungeon_foe = true, dungeon_ord = v.o, weak_to = v.w
    from (values ('fire', 1, 'water'), ('water', 2, 'lightning'), ('lightning', 3, 'earth'), ('earth', 4, 'nature'),
                 ('nature', 5, 'fire'), ('ice', 6, 'fire'), ('shadow', 7, 'light'), ('light', 8, 'shadow')) v(k, o, w)
   where e.key = v.k;
end $s$;

-- ============================================================ 2. passives
create table if not exists public.passives (
  key      text primary key check (key ~ '^[a-z_]+$'),
  label    text not null check (label <> '' and label = trim(label)),
  ord      integer not null unique check (ord >= 1),
  on_boss  boolean not null default false,
  on_foe   boolean not null default false,
  counter  boolean not null default false,
  phase2   boolean not null default false,
  params   jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  updated_at timestamptz not null default now(),
  check (on_boss or on_foe),
  check (not counter or (on_boss and not on_foe)),
  check (not phase2 or (on_boss and not counter))
);
alter table public.passives enable row level security;
revoke all on public.passives from anon, authenticated;

-- params = {"balance": "<balance key>", "keys": ["<leaf>", ...]}: the numbers that the passive reads. Each leaf must be in the balance row.
create or replace function public.passives_check() returns trigger language plpgsql set search_path = public as $$
declare v_row jsonb; v_leaf text;
begin
  if new.params <> '{}'::jsonb then
    if jsonb_typeof(new.params->'keys') is distinct from 'array' or new.params->>'balance' is null then
      raise exception 'passives: params must be {"balance": "<key>", "keys": [...]} (passive %)', new.key;
    end if;
    select value into v_row from public.balance where key = new.params->>'balance';
    for v_leaf in select jsonb_array_elements_text(new.params->'keys') loop
      if v_row is null or not v_row ? v_leaf then raise exception 'passives: balance % has no number "%" (passive %)', new.params->>'balance', v_leaf, new.key; end if;
    end loop;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists passives_check on public.passives;
create trigger passives_check before insert or update on public.passives for each row execute function public.passives_check();

-- The 11 passives of spawn_hunt / hunt_attack / dungeon_make_foe, with the labels of spawn_hunt (hunt_attack typed the same 7).
-- The numbers are already in balance boss_passives (hunt_boss_moves.sql): params names them.
do $s$
begin
  if exists (select 1 from public.passives) then return; end if;
  insert into public.passives (key, label, ord, on_boss, on_foe, counter, phase2, params) values
    ('armored',      'Armored: melee attackers deal less',                   1,  true, true,  false, true,  '{"balance": "boss_passives", "keys": ["armored_x"]}'),
    ('shrouded',     'Shrouded: attacks miss more often',                    2,  true, true,  false, true,  '{"balance": "boss_passives", "keys": ["shrouded_miss"]}'),
    ('flaming',      'Flaming: burns the attacking card',                    3,  true, true,  false, true,  '{"balance": "boss_passives", "keys": ["flaming_chance", "flaming_x"]}'),
    ('volatile',     'Volatile: counterattacks hit harder',                  4,  true, true,  false, true,  '{"balance": "boss_passives", "keys": ["volatile_x"]}'),
    ('regenerating', 'Regenerating: heals a little every turn',              5,  true, true,  false, true,  '{"balance": "boss_passives", "keys": ["regenerating_heal", "regenerating_heal_foe"]}'),
    ('thorns',       'Thorns: part of your damage comes back to your card',  6,  true, true,  false, true,  '{"balance": "boss_passives", "keys": ["thorns"]}'),
    ('frenzied',     'Frenzied: hits harder as it loses HP',                 7,  true, true,  false, true,  '{"balance": "boss_passives", "keys": ["frenzied_per_10pct"]}'),
    ('plague',       'Plague: heals and cleanse barely work',                8,  true, false, true,  false, '{"balance": "boss_passives", "keys": ["plague_x", "plague_cleanse"]}'),
    ('shatterer',    'Shatterer: shields and smite barely work',             9,  true, false, true,  false, '{"balance": "boss_passives", "keys": ["shatterer_x"]}'),
    ('dispeller',    'Dispeller: empower and expose barely work',            10, true, false, true,  false, '{"balance": "boss_passives", "keys": ["dispeller_x"]}'),
    ('juggernaut',   'Juggernaut: weaken and stun barely work',              11, true, false, true,  false, '{"balance": "boss_passives", "keys": ["juggernaut_x", "juggernaut_stun_fail"]}');
end $s$;

-- ============================================================ 3. the readers
-- The words of every element: the same rows as the old VALUES list (alias, element, ord). A table read: STABLE.
create or replace function public.element_aliases()
returns table(alias text, element text, ord integer) language sql stable parallel safe set search_path = public as $$
  select a.alias, e.key, e.ord from public.elements e cross join lateral unnest(e.aliases) a(alias);
$$;
-- The alias map and the canonical element list for combat_card_facts: the cached row (the same jsonb as the old text built). STABLE.
create or replace function public.combat_element_map()
returns jsonb language sql stable set search_path = public as $$
  select coalesce((select c.map from public.elements_cache c where c.id = 1),
                  (select jsonb_build_object('alias', jsonb_object_agg(a.alias, jsonb_build_array(a.element, a.ord)),
                                             'canon', (select jsonb_agg(distinct x.element) from public.element_aliases() x))
                     from public.element_aliases() a));
$$;
select public.elements_cache_rebuild();   -- from the table (also for a database that already has the rows)
-- These four only call element_aliases(): the text stays, the volatility follows it (combat_element_map is below: it has a cache).
alter function public.element_of(text) stable;
alter function public.card_element(text[]) stable;
alter function public.ach_has_element(jsonb) stable;
alter function public.combat_card_facts(text[], text[]) stable;

-- The element that beats a foe of this element in the Dungeon (the old counter map), or NULL.
create or replace function public.element_weak_to(p_key text)
returns text language sql stable set search_path = public as $$
  select e.weak_to from public.elements e where e.key = p_key;
$$;

-- The Dungeon foe elements in their draw order (dungeon_make_foe picks by index: the order is part of the result).
create or replace function public.dungeon_foe_elements()
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(e.key order by e.dungeon_ord), '{}'::text[]) from public.elements e where e.dungeon_foe;
$$;

-- The passive keys of one pool, in table order: boss (the main ones that every boss can have), counter (the counter passives), phase2
-- (what a boss can gain in phase 2), foe (what a Dungeon foe can have).
create or replace function public.passives_for(p_pool text)
returns text[] language plpgsql stable set search_path = public as $$
begin
  if p_pool is null or p_pool not in ('boss', 'counter', 'phase2', 'foe') then raise exception 'passives_for: unknown pool %', p_pool; end if;
  return (select coalesce(array_agg(p.key order by p.ord), '{}'::text[]) from public.passives p
           where case p_pool when 'boss' then p.on_boss and not p.counter when 'counter' then p.counter
                             when 'phase2' then p.phase2 else p.on_foe end);
end $$;

create or replace function public.passive_label(p_key text)
returns text language sql stable set search_path = public as $$
  select p.label from public.passives p where p.key = p_key;
$$;

-- The list for the server route GET /api/elements (the Activity switches to it in a later UI PR).
create or replace function public.elements_list()
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', e.key, 'name', e.name, 'ord', e.ord, 'aliases', to_jsonb(e.aliases), 'glyph', e.glyph,
           'color', e.color, 'color2', e.color2, 'weak_to', e.weak_to, 'dungeon_foe', e.dungeon_foe) order by e.ord), '[]'::jsonb) from public.elements e;
$$;

-- ============================================================ 4. the callers read the tables
-- spawn_hunt: the labels and the passive lists come from passives (the live text; changed: v_plabels removed, passives_for, passive_label).
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
  v_main text[]; v_ctr text[];
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
  v_main := passives_for('boss'); v_ctr := passives_for('counter');   -- the passives table (passives.sql): the main ones, then one random counter passive
  select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'label', passive_label(k))), '[]'::jsonb) into v_plist
    from (select k from unnest(v_main || case when cardinality(v_ctr) = 0 then '{}'::text[]
                                              else array[v_ctr[1 + floor(random() * cardinality(v_ctr))::int]] end) k
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

-- hunt_attack: the phase 2 pool and label come from passives (the live text; changed: passives_for('phase2'), passive_label).
CREATE OR REPLACE FUNCTION public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int;
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_season text; v_type text; v_mod numeric; v_cardname text;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint; v_hpmax bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
  v_feed text; v_settle jsonb; v_milestone boolean;
  v_total bigint; v_used int; v_topcard text; v_topdmg bigint; v_cap int;
  v_bossact text; v_slam jsonb; v_round int; v_targets jsonb;
  v_ability jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; v_heal int;
  v_buff numeric; v_debuff numeric; v_shield int; v_absorb int; v_critchance numeric;
  v_enrage numeric; v_enr_until int; v_weaken numeric; v_wk_until int; v_expose numeric; v_exp_until int; v_stun_until int;
  v_bmult numeric; v_r numeric;
  v_resist jsonb; v_tags text[]; v_wtags text[]; v_wm int; v_rm int; v_stack int; v_wmult numeric;
  v_plist text[]; v_share bigint; v_bheal int; v_lost numeric; v_phase text; v_extra text; v_stunned_card boolean;
  v_passive jsonb; v_pk text; v_elem text; v_syn int; v_synmult numeric; v_burn int; v_burned boolean;
  v_origin text; v_osyn int; v_omult numeric; v_ksyn int; v_kmult numeric;
  v_stats jsonb; v_atk numeric; v_pts jsonb; v_cmb jsonb;
  v_double boolean := false; v_rally numeric; v_mend numeric; v_bf numeric;
  v_party jsonb; v_crash jsonb; v_crash_dmg int := 0; v_crash_to text; v_crash_card bigint;
  v_crash_fb boolean := false; v_crash_round int; v_clog bigint;
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
  v_bname text; v_marks jsonb; v_pick jsonb; v_ctr jsonb; v_tick jsonb; v_ubuff numeric := 1;
  v_rtgt bigint; v_redir jsonb; v_squad bigint[];   -- D-129 / D-132: the card a single boss hit lands on, when it is not the attacking card
  v_rrar text; v_rasc int; v_rmod numeric; v_rpts jsonb; v_rkind text; v_rmax int;
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive, coalesce(hp_share, hp_max), stats, hp_remaining, name
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive, v_share, v_stats, v_hp, v_bname
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  v_pk := v_passive->>'kind';
  -- Every passive the boss has (passive.list; an older hunt has only passive.kind).
  select coalesce(array_agg(x->>'kind'), array[v_pk]) into v_plist
    from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;
  v_plist := array_remove(v_plist, null);

  select pc.quantity, pc.ascension, c.rarity::text, c.season, s.type, s.cp_mod, c.name, s.ability, s.tag_slugs, pc.stat_points
    into v_qty, v_asc, v_rarity, v_season, v_type, v_mod, v_cardname, v_ability, v_tags, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'America/Denver')::date;
  -- One squad per day (hunt_squads.sql): a locked squad fights only with its own cards.
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  -- The round limit (hunt_loop_caps.sql): a squad fights at most hunt_round_cap rounds a day.
  v_rcap := hunt_round_cap();
  if coalesce((select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day), 0) >= v_rcap then
    return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap);
  end if;
  -- The stat points of this copy (stat_points.sql). With the flag off: card_power + card_max_hp.
  v_cmb := card_combat(v_rarity, v_asc, v_mod, v_pts);
  v_cp := (v_cmb->>'cp')::int;
  v_maxhp := (v_cmb->>'hp')::int;

  select hp_remaining, downed, coalesce(dmg_buff, 1), coalesce(dmg_debuff, 1), coalesce(shield, 0)
    into v_cardhp, v_downed, v_buff, v_debuff, v_shield
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then
    v_cardhp := v_maxhp; v_downed := false; v_buff := 1; v_debuff := 1; v_shield := 0;
    v_cap := hunt_card_cap();
    if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap then
      return jsonb_build_object('ok', false, 'error', 'day_limit', 'cap', v_cap);
    end if;
  else
    v_cap := hunt_card_cap();
  end if;
  if v_downed or v_cardhp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'downed', 'card_hp', 0, 'card_max_hp', v_maxhp);
  end if;

  v_round := hunt_state_round(p_hunt, p_player, v_day);
  select coalesce(cd_until_round, 0) >= v_round + 1 into v_stunned_card
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if coalesce(v_stunned_card, false) and (
       exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day
               and h.card_id <> p_card and not h.downed and coalesce(h.cd_until_round, 0) < v_round + 1
               and exists (select 1 from cards c join subjects s on s.id = c.subject_id where c.id = h.card_id and s.type in ('Character', 'Creature')))
       or (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) < v_cap) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  -- Mend (a boon): the first hurt card that attacks heals the waiting amount first
  -- (after the downed / stunned checks, so a refused attack keeps the boon).
  if v_cardhp < v_maxhp then
    v_mend := take_player_effect(p_player, 'mend');
    if v_mend is not null then v_cardhp := least(v_maxhp, v_cardhp + greatest(1, round(v_mend))::int); end if;
  end if;
  select boss_enrage, enrage_until, boss_weaken, weaken_until, boss_expose, expose_until, stunned_until, marks
    into v_enrage, v_enr_until, v_weaken, v_wk_until, v_expose, v_exp_until, v_stun_until, v_marks
    from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;

  v_aeff := case when v_ability->>'kind' = 'attack' then v_ability->>'effect' else null end;
  v_aamt := coalesce((v_ability->>'amount')::numeric, 0);
  v_athresh := coalesce((v_ability->>'threshold')::numeric, 0);

  -- The squad in this fight (combat_core.sql: combat_squad): the other cards and their tags.
  v_sq := combat_squad(v_tags,
    exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day),
    (select coalesce(jsonb_agg(to_jsonb(s.tag_slugs)), '[]'::jsonb)
       from (select distinct h.card_id from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card) hc
       join cards c on c.id = hc.card_id join subjects s on s.id = c.subject_id),
    v_weak);
  v_stack := (v_sq->>'stack')::int;
  v_wk := combat_weak(v_weak, v_resist, v_type, v_rarity, v_season, v_tags, v_stack);
  v_wm := (v_wk->>'wm')::int; v_rm := (v_wk->>'rm')::int; v_wmult := (v_wk->>'mult')::numeric;
  v_bonus := v_wm > 0;
  v_elem := v_sq->>'elem'; v_syn := (v_sq->>'syn')::int; v_synmult := (v_sq->>'synmult')::numeric;

  v_critchance := combat_crit_chance(v_bonus, v_aeff, v_aamt, v_cmb);
  v_hit := combat_hit(v_cp, v_wmult, v_buff, v_debuff, v_synmult, v_critchance,
    combat_miss('shrouded' = any(v_plist)),                                          -- shrouded: more misses
    v_aeff, v_aamt, v_athresh, 'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end, v_hp, v_hpmax);   -- Veil (hunt_boss_moves.sql)
  v_miss := (v_hit->>'miss')::boolean; v_crit := (v_hit->>'crit')::boolean; v_block := (v_hit->>'block')::boolean;
  v_dmg := (v_hit->>'dmg')::int; v_outcome := v_hit->>'outcome'; v_double := (v_hit->>'double')::boolean;
  if not v_miss then
    -- Rally (a boon): the next hit deals +amount % (the boon is used up by this hit).
    v_rally := take_player_effect(p_player, 'rally');
    if v_rally is not null then v_dmg := greatest(1, round(v_dmg * (1 + least(v_rally, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Butterfingers (a prank, effects_outside.sql): the next hit deals -amount % (used up by this hit).
    v_bf := take_player_effect(p_player, 'butterfingers');
    if v_bf is not null and v_dmg > 0 then v_dmg := greatest(1, round(v_dmg * (1 - least(v_bf, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Launch Party (the Launch Day Player boon, launch_event_cards.sql): +amount % on each of the
    -- next N hits (options.uses), one charge per hit.
    v_party := use_effect_charge(p_player, 'launch_party');
    if v_party is not null then v_dmg := greatest(1, round(v_dmg * (1 + least((v_party->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Raid Crasher (the Launch Day Raider prank): the boss takes +amount % more on each of the next N
    -- hits, and that extra damage counts for the prankster (options.credit_to) on the leaderboard.
    v_crash := use_effect_charge(p_player, 'raid_crasher');
    if v_crash is not null then
      v_crash_dmg := greatest(1, round(v_dmg * least((v_crash->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))::int;
      v_crash_to := coalesce(v_crash->'options'->>'credit_to', v_crash->'options'->>'sender_id');
      v_crash_card := (v_crash->'options'->>'card_id')::bigint;
      -- No owner or no card (damage_log.sql): the extra damage still hits the boss, so the attacker gets the credit on
      -- the attacking card. Boss HP and hunt_hits then agree; the log row says fallback.
      if v_crash_to is null or v_crash_card is null then
        v_crash_to := p_player; v_crash_card := p_card; v_crash_fb := true;
      end if;
      v_crash_round := v_round;
    end if;
  end if;

  if v_dmg > 0 then
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
      values (p_hunt, p_player, p_card, v_day, v_dmg)
      on conflict (hunt_id, player_id, card_id, hit_date)
      do update set damage = hunt_hits.damage + excluded.damage;
    -- The Raid Crasher share: the prankster's own hunt_hits row (their Raider card), so it counts
    -- for the leaderboard and the prizes.
    if v_crash_dmg > 0 and v_crash_to is not null and v_crash_card is not null then
      insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
        values (p_hunt, v_crash_to, v_crash_card, v_day, v_crash_dmg)
        on conflict (hunt_id, player_id, card_id, hit_date)
        do update set damage = hunt_hits.damage + excluded.damage;
    end if;
    update hunts set hp_remaining = greatest(0, hp_remaining - v_dmg - v_crash_dmg),
      status      = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then now() else defeated_at end
      where id = p_hunt;
  end if;
  select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;

  v_heal := 0;
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);  -- cap: lifesteal cannot out-heal the boss
    v_cardhp := least(v_maxhp, v_cardhp + v_heal);
  end if;
  -- Counter marks on this attack (hunt_boss_moves.sql): Counter-pick (an empowered attack hurts the attacker by the
  -- bonus x counterpick.x) and Demotion (an attack on an exposed boss sends demotion.back back): balance boss_counters.
  if v_dmg > 0 and v_buff > 1 and hunt_mark_on(v_marks, 'counterpick', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(hunt_counter_num('counterpick', 'x') * v_dmg * (v_buff - 1) / v_buff))::int);
  end if;
  if v_dmg > 0 and v_exp_until >= v_round and v_expose > 0 and hunt_mark_on(v_marks, 'demotion', v_round)
     and not hunt_mark_on(v_marks, 'block_expose', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * hunt_counter_num('demotion', 'back')))::int);
  end if;
  v_ubuff := v_buff;   -- the empower this attack used (Tier List)
  v_buff := 1;

  -- The boss ATK (Nathan, 2026-09-28: flat stats, so tougher cards survive more hits).
  -- hunts.stats.atk is set at spawn; an older hunt uses the tier default.
  v_atk := coalesce((v_stats->>'atk')::numeric, balance_num('boss_atk', v_tier));
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    update hunt_combat_state set round = round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
      returning round into v_round;
    -- Phase 1 below 50% HP: permanent rage. Frenzied: +5% per 10% of HP lost (combat_enemy_mult).
    v_lost := 1 - v_hp::numeric / greatest(1, v_hpmax);
    v_bmult := combat_enemy_mult(v_enrage, v_enr_until,
      case when hunt_mark_on(v_marks, 'block_weaken', v_round) then 0 else v_weaken end,   -- Alt-F4 (hunt_boss_moves.sql)
      v_wk_until, v_round, 'volatile' = any(v_plist), v_lost, 'frenzied' = any(v_plist));
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: + spiral.step for each weaken played
      v_bmult := v_bmult * (1 + coalesce((v_marks->'spiral'->>'bonus')::numeric, 0));
    end if;
    v_bheal := 0;

    -- The enemy turn (combat_core.sql: combat_enemy_act): a surprise draw.
    -- The damage-over-time marks tick first (hunt_boss_moves.sql: Infect, Nightshade).
    v_tick := hunt_counter_tick(p_hunt, p_player, v_day, p_card, v_round);
    if (v_tick->>'attacker')::int > 0 then
      v_ab := combat_absorb(v_shield, (v_tick->>'attacker')::int); v_shield := (v_ab->>'shield')::int;
      v_cardhp := greatest(0, v_cardhp - (v_ab->>'dmg')::int);
    end if;
    v_act := combat_enemy_act(v_atk, v_bmult, v_round, v_stun_until, v_lost, v_share);
    v_bossact := v_act->>'action'; v_cdmg := (v_act->>'dmg')::int; v_area := (v_act->>'area')::numeric;
    v_bheal := v_bheal + (v_act->>'heal')::int;
    -- A counter move (hunt_boss_moves.sql): a share of the normal turns of a boss with a move pool (balance boss_counters). An effect move comes on
    -- top of the usual turn (base); a hit move replaces it.
    v_pick := hunt_counter_pick(p_hunt, p_player, v_day, v_bname, v_bossact);
    if v_pick is not null then
      v_ctr := hunt_counter_act(p_hunt, p_player, v_day, p_card, v_round, v_atk, v_bmult, v_pick->>'key', v_pick->>'name',
        v_cardhp, v_maxhp, v_shield, v_ubuff);
      if v_ctr->>'shield' is not null then v_shield := (v_ctr->>'shield')::int; end if;
      if v_ctr->>'debuff' is not null then v_debuff := (v_ctr->>'debuff')::numeric; end if;
      v_cardhp := greatest(0, v_cardhp - (v_ctr->>'loss')::int);
      v_bheal := v_bheal + (v_ctr->>'heal')::int;
      if not (v_ctr->>'base')::boolean then   -- a hit move: no usual turn
        v_bheal := v_bheal - (v_act->>'heal')::int;
        v_bossact := 'counter'; v_area := 0; v_cdmg := (v_ctr->>'dmg')::int;
        if not (v_ctr->>'pierce')::boolean then
          v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
        end if;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      end if;
    end if;
    -- D-129 (Nathan, 2026-10-08) and D-132 (2026-10-09): the boss's SINGLE hit (strike, drain, stun) picks a RANDOM card of the
    -- WHOLE LOCKED SQUAD, the attacking card and the supports included, from the first attack of the day. A support can go
    -- down here (D-126: only in the Hunt and the Arena). The pool: the attacking card, and every card of today's locked squad
    -- (hunt_squads.card_ids) that is owned and not down. A squad card that has not acted yet has no hunt_card_hp row: it enters
    -- with full HP when it is hit (hunt_commit_card; if the cap refuses, the same insert, so the hit is never lost). With no
    -- locked squad (a member who never locked one) the pool is the attacking card and the cards that already have a row.
    -- Slam and Cataclysm keep their own targets (the attacking card takes the main hit, every other card WITH A ROW its own
    -- area hit), and so do the counter moves.
    v_rtgt := null; v_redir := null;
    if v_bossact in ('strike', 'drain', 'stun') then
      select card_ids into v_squad from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      select t.cid into v_rtgt from (select p_card as cid
          union select x from unnest(coalesce(v_squad, '{}'::bigint[])) x
            where x <> p_card
              and not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = x and h.downed)
              and exists (select 1 from player_cards pc where pc.player_id = p_player and pc.card_id = x and pc.quantity > 0)
          union select h.card_id from hunt_card_hp h
            where v_squad is null and h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card and not h.downed) t
        order by random() limit 1;
    end if;
    if v_rtgt is not null and v_rtgt <> p_card then   -- the hit lands on another card: it takes the hit (and the stun) instead
      if not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = v_rtgt) then
        -- D-132: a squad card that never acted enters with full HP (the HP rule of hunt_support: card_combat, a support card_max_hp(0))
        select pc.ascension, c.rarity::text, s.cp_mod, pc.stat_points, s.ability->>'kind'
          into v_rasc, v_rrar, v_rmod, v_rpts, v_rkind
          from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
          where pc.player_id = p_player and pc.card_id = v_rtgt;
        v_rmax := (card_combat(v_rrar, v_rasc, v_rmod, v_rpts)->>'hp')::int;
        if v_rkind = 'support' then v_rmax := card_max_hp(0); end if;
        if not hunt_commit_card(p_hunt, p_player, v_rtgt, v_day, v_rmax) then   -- refused (the daily card cap): the hit is not lost
          insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
            values (p_hunt, p_player, v_rtgt, v_day, v_rmax, v_rmax, false)
            on conflict (hunt_id, player_id, card_id, hit_date) do nothing;
        end if;
      end if;
      v_redir := hunt_counter_hit(p_hunt, p_player, v_day, v_rtgt, v_cdmg, false);
      if v_bossact = 'stun' then
        update hunt_card_hp set cd_until_round = greatest(coalesce(cd_until_round, 0), v_round + 1), updated_at = now()
          where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and card_id = v_rtgt;
      end if;
      v_cdmg := 0;
    elsif v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then
      v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
    end if;
    if v_area > 0 then   -- Slam / Cataclysm: every other card standing rolls its own hit
      with tgt as (
        select h.card_id, greatest(0, h.raw - coalesce(h.shield, 0)) as dmg,
               greatest(0, coalesce(h.shield, 0) - h.raw) as shleft
               from (select x.*, combat_area_roll(v_atk, v_area, v_bmult) as raw
                     from hunt_card_hp x
                     where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = v_day and x.card_id <> p_card and not x.downed) h
      ), upd as (
        update hunt_card_hp h set hp_remaining = greatest(0, h.hp_remaining - t.dmg),
            shield = t.shleft, downed = (h.hp_remaining - t.dmg) <= 0, updated_at = now()
        from tgt t where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = t.card_id
        returning h.card_id, h.hp_remaining, h.max_hp, h.downed, t.dmg
      )
      select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'dmg', dmg, 'hp', hp_remaining, 'max_hp', max_hp, 'downed', downed)), '[]'::jsonb)
        into v_slam from upd;
    end if;
    if v_bossact = 'enrage' then
      update hunt_combat_state set boss_enrage = balance_num('boss_moves', 'enrage_x'), enrage_until = v_round + balance_num('boss_moves', 'enrage_rounds')::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif v_bossact = 'curse' then
      v_debuff := balance_num('boss_moves', 'curse_x');
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + combat_regen(v_share); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - combat_thorns(v_dmg));
    end if;
    if v_bheal > 0 then
      update hunts set hp_remaining = least(hp_max, hp_remaining + v_bheal) where id = p_hunt and status = 'active'
        returning hp_remaining into v_hp;
    end if;
    -- Phase 2 below boss_moves.phase2_at HP: the boss gains one more passive (once per hunt).
    v_phase := null;
    if v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'phase2_at') and not coalesce((v_passive->>'phase2')::boolean, false) then
      select k into v_extra from unnest(passives_for('phase2')) k
        where k <> all(v_plist) order by random() limit 1;
      update hunts set passive = coalesce(passive, '{}'::jsonb) || jsonb_build_object('phase2', true,
          'list', coalesce(passive->'list', '[]'::jsonb) || case when v_extra is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('kind', v_extra, 'label', passive_label(v_extra))) end)
        where id = p_hunt;
      v_phase := coalesce(v_extra, 'phase2');
    elsif (v_hp + v_dmg)::numeric / greatest(1, v_hpmax) >= balance_num('boss_moves', 'rage_at') and v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'rage_at') then
      v_phase := 'rage';                            -- this hit took the boss below rage_at
    end if;
  end if;

  -- Flaming boss: a chance the attacking card catches burn after acting.
  v_burned := false;
  if 'flaming' = any(v_plist) and v_status <> 'defeated' then
    v_burn := combat_burn(v_atk);
    if v_burn > 0 then
      v_ab := combat_absorb(v_shield, v_burn); v_shield := (v_ab->>'shield')::int; v_burn := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_burn); v_burned := v_burn > 0;
    end if;
  end if;

  v_downed := v_cardhp <= 0;
  v_counter := v_bossact is not null and v_bossact not in ('stunned', 'enrage', 'curse', 'regenerate', 'charging');

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, dmg_buff, dmg_debuff, shield, cd_until_round)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed, v_buff, v_debuff, v_shield,
            case when v_bossact = 'stun' and v_redir is null then v_round + 1 else 0 end)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed,
      dmg_buff = excluded.dmg_buff, dmg_debuff = excluded.dmg_debuff, shield = excluded.shield,
      cd_until_round = greatest(excluded.cd_until_round, hunt_card_hp.cd_until_round), updated_at = now();

  insert into hunt_combat_log (hunt_id, player_id, card_id, cp, outcome, bonus, crit, block,
    damage, countered, counter_dmg, card_hp_after, card_downed, boss_hp_after)
  values (p_hunt, p_player, p_card, v_cp, v_outcome, v_bonus, v_crit, v_block,
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp)
  returning id into v_clog;

  -- The Hunt Crasher log row (damage_log.sql): the extra damage that hunt_hits credits to the prankster's Raider card.
  -- amount = the charge amount (%), result.value = the damage, combat_log_id = the attack it rode on.
  if v_dmg > 0 and v_crash_dmg > 0 then
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)
    values ('hunt', p_hunt, v_crash_to, v_crash_card, 'effect', v_day, v_crash_round, 'raid_crasher', (v_crash->>'amount')::numeric,
      jsonb_build_object('value', v_crash_dmg, 'attacker', p_player, 'attack_card', p_card, 'combat_log_id', v_clog, 'fallback', v_crash_fb));
  end if;

  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  select coalesce((select value #>> '{}' from settings where key = 'hunt_attack_feed'), 'milestones') into v_feed;
  v_milestone := v_crit or v_downed;
  if v_status <> 'defeated' and not v_miss and (v_feed = 'all' or (v_feed = 'milestones' and v_milestone)) then
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'attack', jsonb_build_object('player_id', p_player, 'card', v_cardname,
        'damage', v_dmg, 'outcome', v_outcome, 'crit', v_crit, 'bonus', v_bonus, 'downed', v_downed));
  end if;

  -- The end-of-day summary (hunt_squad_done.sql): when every attacker of the locked squad is down,
  -- once per member per day. It needed 8 cards used, so a short squad (or the old squad bug) never posted.
  -- The round limit also ends the squad, so its summary posts then too (hunt_loop_caps.sql).
  if v_status <> 'defeated' and ((v_downed and hunt_squad_done(p_hunt, p_player, v_day, v_cap)) or v_round >= v_rcap)
     and not exists (select 1 from hunt_events where hunt_id = p_hunt and kind = 'player_done'
                       and payload->>'player_id' = p_player and created_at >= (v_day::timestamp at time zone 'America/Denver')) then
    select coalesce(sum(damage), 0), count(distinct card_id) into v_total, v_used
      from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    select c.name, sub.d into v_topcard, v_topdmg
      from (select card_id, sum(damage) d from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
            group by card_id order by d desc limit 1) sub join cards c on c.id = sub.card_id;
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'player_done', jsonb_build_object('player_id', p_player,
        'total', v_total, 'cards_used', v_used, 'top_card', v_topcard, 'top_damage', v_topdmg,
        'boss_hp', v_hp, 'boss_hp_max', v_hpmax));
  end if;

  v_targets := case when v_redir is null then '[]'::jsonb else jsonb_build_array(v_redir) end   -- the HIT card is targets[0] (the client marks a stun / curse on targets[0])
      || jsonb_build_array(jsonb_build_object('card_id', p_card, 'dmg', v_cdmg,
      'hp', v_cardhp, 'max_hp', v_maxhp, 'downed', v_downed)) || coalesce(v_slam, '[]'::jsonb) || coalesce(v_tick->'targets', '[]'::jsonb)
      || coalesce(v_ctr->'targets', '[]'::jsonb);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'resisted', v_rm > 0, 'crit', v_crit, 'cp', v_cp, 'heal', v_heal, 'ability', v_aeff,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'round', v_round, 'round_cap', v_rcap,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed, 'shield', v_shield,
    'burned', v_burned, 'double', v_double, 'rally', v_rally, 'butterfingers', v_bf, 'mend', v_mend, 'party', v_party->'amount', 'crashed', nullif(v_crash_dmg, 0), 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
    'synergy', case when v_syn >= balance_num('combat', 'syn_small_at') then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', case when v_bossact = 'counter' then v_ctr->>'anim' else v_bossact end, 'round', v_round, 'targets', v_targets)
        || case when v_ctr is null then '{}'::jsonb else jsonb_build_object('move', v_ctr->>'move', 'counter', v_ctr->>'key') end end);
end $function$;

-- dungeon_make_foe: the foe elements, the counter and the foe passives come from the tables (the live text; changed: els, counter, passives).
CREATE OR REPLACE FUNCTION public.dungeon_make_foe(p_k text, p_floor integer, p_room integer, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare m dungeon_monsters; v_el text; v_hp numeric; v_atk numeric; v_pass jsonb := '[]'; n int;
  els text[] := public.dungeon_foe_elements();   -- the elements table (dungeon_foe, dungeon_ord)
  kinds text[] := array['melee','ranged','caster','beast','hero','strong','agile'];
  passives text[] := public.passives_for('foe');   -- the passives table (on_foe)
begin
  if cardinality(els) = 0 or cardinality(passives) = 0 then raise exception 'dungeon_make_foe: the elements table has no foe element or the passives table has no foe passive'; end if;
  select count(*) into n from dungeon_monsters;
  select * into m from dungeon_monsters order by key offset floor(dungeon_rand(p_k || '|m') * n)::int limit 1;
  v_el := els[1 + floor(dungeon_rand(p_k || '|e') * cardinality(els))::int];
  -- The growth per floor and per room and the multipliers of each foe kind are in balance dungeon.
  v_hp := m.hp * power(balance_num('dungeon', 'hp_growth'), p_floor - 1) * (1 + balance_num('dungeon', 'room_growth') * (p_room - 1));
  v_atk := m.atk * power(balance_num('dungeon', 'atk_growth'), p_floor - 1);
  v_hp := v_hp * balance_num('dungeon', 'foe_mult', p_kind, 'hp'); v_atk := v_atk * balance_num('dungeon', 'foe_mult', p_kind, 'atk');
  if p_kind in ('elite', 'miniboss') then v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * cardinality(passives))::int]);
  elsif p_kind = 'guardian' then
    v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * cardinality(passives))::int], passives[1 + floor(dungeon_rand(p_k || '|q') * cardinality(passives))::int]);
  end if;
  return jsonb_build_object('key', m.key, 'model', m.model, 'element', v_el, 'level', p_floor, 'kind', p_kind,
    'name', initcap(v_el) || ' ' || m.name || case p_kind when 'elite' then ' (Elite)' when 'miniboss' then ' Mini-Boss' when 'guardian' then ' Guardian' else '' end,
    'hp', round(v_hp)::int, 'max', round(v_hp)::int, 'atk', greatest(1, round(v_atk))::int, 'moves', m.moves,
    'charge', p_kind in ('miniboss', 'guardian'),
    'tags', to_jsonb(m.tags || array['trait:' || v_el]),
    'weak', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || public.element_weak_to(v_el)),
                              jsonb_build_object('kind', 'tag', 'value', 'trait:' || kinds[1 + floor(dungeon_rand(p_k || '|w') * 7)::int])),
    'resist', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || v_el)),
    'passives', (select coalesce(jsonb_agg(distinct p), '[]'::jsonb) from jsonb_array_elements_text(v_pass) p));
end $function$;

-- ============================================================ 5. the docs
comment on table public.elements is $doc$[combat] The one list of elements (f3_elements_passives.sql, F-3): key, name, ord (the priority when a card has several element words), aliases (the trait words that mean the element), glyph, color and color2 (the look), weak_to (the element that beats a Dungeon foe of this element), dungeon_foe and dungeon_ord (the Dungeon foe pool and its draw order). element_aliases, card_element, element_of and dungeon_make_foe read it. GET /api/elements returns it. A word that another element has is refused. Server only.$doc$;
comment on table public.passives is $doc$[combat] The one list of boss and foe passives (f3_elements_passives.sql, F-3): key, label, ord (the order in the pools), on_boss, on_foe, counter (a boss gets at most one, at random), phase2 (a boss can gain it in phase 2) and params (the balance keys that the passive reads, checked on write). passives_for and passive_label read it: spawn_hunt, hunt_attack and dungeon_make_foe. The code that does the effect of a passive is still in the fight functions. Server only.$doc$;

comment on table public.elements_cache is $doc$[combat] One row (id 1): the alias map and the canonical element list that combat_element_map() returns. A statement trigger on elements rebuilds it (elements_cache_rebuild). It exists because combat_card_facts reads the map for every card of every Hunt fight and auto-pick. Server only.$doc$;
comment on column public.elements_cache.id is 'Always 1: one row.';
comment on column public.elements_cache.map is 'The jsonb of combat_element_map(): alias (word to [element, ord]) and canon (the list of elements).';
comment on column public.elements.key is 'The element key (lower case letters), for example fire. The trait words and the tags use it.';
comment on column public.elements.name is 'The name shown to players, for example Fire.';
comment on column public.elements.ord is 'The priority when a card has several element words: the lowest ord wins (card_element). Unique.';
comment on column public.elements.aliases is 'The trait words that mean this element (lower case, no repeat, the key is one of them). A word of another element is refused.';
comment on column public.elements.glyph is 'The emoji shown on the attack effect and on the card (the look of elements.js).';
comment on column public.elements.color is 'The core color of the element, as #rrggbb (the look of elements.js).';
comment on column public.elements.color2 is 'The second color of the element (trail), as #rrggbb.';
comment on column public.elements.weak_to is 'The element that beats a Dungeon foe of this element (the foe gets this weakness). NULL: none. Required when dungeon_foe is true.';
comment on column public.elements.dungeon_foe is 'True when a Dungeon foe can have this element (dungeon_make_foe).';
comment on column public.elements.dungeon_ord is 'The draw order in the Dungeon foe pool (dungeon_make_foe picks by index: a change of order changes the foes). Set exactly when dungeon_foe is true.';
comment on column public.elements.updated_at is 'The last change of the row.';
comment on column public.passives.key is 'The passive key (lower case): the name that the fight functions test, for example armored.';
comment on column public.passives.label is 'The text shown to players, for example Armored: melee attackers deal less.';
comment on column public.passives.ord is 'The order in the pools (passives_for). A change of order changes the random draw. Unique.';
comment on column public.passives.on_boss is 'True when a Hunt boss can have it (spawn_hunt, hunt_attack phase 2).';
comment on column public.passives.on_foe is 'True when a Dungeon foe can have it (dungeon_make_foe).';
comment on column public.passives.counter is 'True for a counter passive: a boss gets at most one, chosen at random after the main passives.';
comment on column public.passives.phase2 is 'True when a boss can gain it in phase 2 (below boss_moves.phase2_at HP).';
comment on column public.passives.params is '{"balance": "<balance key>", "keys": [...]}: the balance numbers that the passive reads. The trigger checks that each one exists.';
comment on column public.passives.updated_at is 'The last change of the row.';
comment on function public.alias_list_ok(text[]) is 'F-3: true when a list of element words is not empty and has only lower case, trimmed words with no repeat (the check of elements.aliases).';
comment on function public.elements_check() is 'F-3: the trigger of elements: refuses a word that another element has, and sets updated_at.';
comment on function public.elements_cache_rebuild() is 'F-3: rebuilds the one row of elements_cache from the elements table.';
comment on function public.elements_cache_refresh() is 'F-3: the statement trigger of elements: calls elements_cache_rebuild after each change.';
comment on function public.element_weak_to(text) is 'F-3: the element that beats a Dungeon foe of this element (elements.weak_to), or NULL.';
comment on function public.dungeon_foe_elements() is 'F-3: the Dungeon foe elements in their draw order (elements.dungeon_ord).';
comment on function public.passives_for(text) is 'F-3: the passive keys of a pool in table order: boss, counter, phase2 or foe (passives).';
comment on function public.passive_label(text) is 'F-3: the label of a passive (passives.label).';
comment on function public.passives_check() is 'F-3: the trigger of passives: checks that params names numbers that balance has, and sets updated_at.';
comment on function public.elements_list() is 'F-3: the elements as jsonb for the server route GET /api/elements.';

notify pgrst, 'reload schema';
