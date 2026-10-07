-- balance_table.sql (2026-10-03, Nathan: "all the code/power/changes in one place in a single table so
-- making balance adjustments becomes easier"; Option C approved 2026-10-03). Stacks on effects_outside.sql.
--
-- ONE table, public.balance, holds every number that can change a card's power or a fight:
--   card power   = rarity_cp[rarity] x stars[rarity][star] x subjects.cp_mod      (card_cp_exact, card_power)
--   combat power = card power x (1 + stat_points.attack x Attack points)          (card_combat)
--   card HP      = max(card_hp.floor, card_hp.per_cp x combat power) x Vitality   (card_max_hp, card_combat)
--   damage       = combat power x weakness x roll x buffs x synergy x passives x crit/block x boons/pranks
--                  (hunt_attack: the keys combat, boss_moves, boss_passives, boss_atk)
-- Card data stays on the card: subjects.cp_mod (per subject), subjects.ability (attack / support
-- amounts), subjects.effect (prank / boon base amounts), effect_primitives.max_amount (the ceilings).
-- The balance notes say where each of those lives.
--
-- Change a value (it acts at once, no migration, no deploy; the Activity and the bot cache 60 s):
--   update balance set value = jsonb_set(value, '{normal,5}', '8.5') where key = 'stars';
--   or: node card-studio/scripts/balance.mjs --set stars.normal.5=8.5   (--sim first to measure it)
-- Every change is in balance_log (old value, new value, when, who). Undo one: balance.mjs --undo <log id>.
-- A change must keep the shape (the same keys, numbers stay numbers and are not negative):
-- balance_check refuses anything else, so a typo cannot break the raid.
--
-- Option C (Nathan 2026-10-03): a star is worth more on a common card, so members without Gold or many
-- Full Art cards can compete; Gold 5 stars stays the strongest single card. The table replaces the old
-- global (1 + 0.08 x stars) in combat AND the old 2.5x star table in the collection power.
--
-- Every replaced function starts from the LIVE definition (pg_dump 2026-10-03 after combat_core.sql #147,
-- adventure_gate.sql and the Dungeon) and changes only the numbers: a literal becomes a balance read.
-- The combat rules stay in the combat_* functions of combat_core.sql (the Hunt and the Dungeon share them);
-- those functions now read the table, so one balance change moves the Hunt and the Dungeon together. With the
-- balance values set to the old numbers, each function returns exactly what the old one did
-- (card-studio/scripts/test-balance-table.mjs proves it with fixed random seeds).
-- The old settings rows (stat_points, hunt_atk, hunt_hp, hunt_boss_stats, hunt_round_cap,
-- hunt_daily_card_cap, card_effect_tiers, card_effect_ascension, card_effect_cooldown_scale) move into
-- the table and are deleted, so one number has one source. Idempotent.

-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the exact
-- live text it was built from (the first md5) or on its own result (the second md5, so it can run again). Any
-- other change to one of them stops it here, so that change is never reverted: rebuild this file from the live
-- text (the generator: tools repo, balance/gen2.mjs). 2026-10-07: hunt_attack, hunt_support and spawn_hunt were
-- rebuilt after hunt_boss_moves.sql (#218) by a three-way merge (base = the text this file was built from, ours = the
-- live text after #218, theirs = this file's version); one conflict (the spawn passive pool) kept both. combat_core.sql, adventure_gate.sql, gauntlet.sql,
-- dungeon_v2.sql and hunt_early_boss.sql are rebuilt in the same PR with the same numbers read from the table.
do $g$
declare x text[]; m text;
begin
  foreach x slice 1 in array array[['combat_weak', '9ce429e3987062709ad58f2da22ad6ec', '98c1aad65e30464beb60d98c4aa6e538'],
    ['combat_squad', 'e258afd794372831f5bef1e3dead7912', 'd3618d2947fbb305a84de6d00f7078ff'],
    ['combat_crit_chance', '2bdd548498d09bea30d2086e9dac0755', '3943bf85ef544d157b419144279abfcb'],
    ['combat_hit', 'c9b8153b96ea601be99eea999164ee90', 'f020462408f217e25a0446d1449aaaea'],
    ['combat_lifesteal', 'a3c71d4f040d9b1c20fa737347838842', '749c45aebf0f3492923243d215e87f10'],
    ['combat_enemy_mult', 'f60bd8121eb5ddb10bbb9aa3fb4a2646', '527cc7dac6375958062a973f44324878'],
    ['combat_enemy_act', 'f9dc9862dc364d3368cd24f4ad1bab3f', '7375b00367ee7b9e5da79919f23924ab'],
    ['combat_area_roll', 'a77385632ebd03c0da562d33c8cd09f4', 'c1bc1d81c0589772daf7dbb4cd78f0f3'],
    ['combat_burn', 'a040ef6a7396ea388031d079eb90c7c9', '4473f9c5da34eb8190c5c2799cd87d22'],
    ['combat_thorns', 'edacb38ecb5f7c6aafe1d79f517768da', '0111cc3d66a0822881833a98cc84aaf5'],
    ['combat_regen', 'fd8588f99895a09f65db11e79c5d7e62', '8d92beca10f3eed9cd97c1cc563bd864'],
    ['combat_aff_scale', 'e5be70b040755944dcec10487f274197', '7a4054dd69923c816ea97d8bab829ab8'],
    ['combat_support_value', '3a355036a33ec2a2c3719a1ebe569b23', 'f559395d686aae07f5411b3b391c2c20'],
    ['combat_stun_immune', 'a90cde7342cf656740ca6d5a1570f0ff', 'b26ab5f7ae16903480af205f114b237f'],
    ['hunt_attack', '352f81ffb45b028c1eab6e3dfcc2e707', '835daea41237378340cc28a88c3b0921'],
    ['hunt_support', '6ffdd26daed7008346262413497b2a24', 'a9addaf61d3a15508001be519589694b'],
    ['lock_hunt_squad', '4a80c769286b2b6022ab79b4cb01f7c6', '22bf3511259d728791ee370775beb5f2'],
    ['hunt_commit_card', '6ef31cb9924f10f32680369ef3057b16', '165a2c131945eb341f8e4864413f6884'],
    ['deployable_power', '10723321c2ee972b3200918687b0d8b0', 'a744b17aff2b54b776663492ac0c4ce1'],
    ['spawn_hunt', '4b9c670ee18c6ece32d5a3a886b9df1d', 'f9d7209d29cd2d9fb788141a57bc2323'],
    ['play_card_effect', 'e62c11f53b2a82ebff6869214f63d3e9', '2fc1d7c6fa08f03c87cac5c9caaa9c6a'],
    ['my_collection_power', '8f687924f72babcc2b241f0135d810b3', 'a25e996ebcfc49edfeac7d149a5ab4da'],
    ['top_collection_power', 'ea9eb37e441bf3beb8902ebd54b5ebbd', '529a2cacae1407a63e5e304960e81f8c'],
    ['dungeon_attack', '90585187581590dd5cbf03d936c92f33', '4c30628c23a9cc1b1fe19619ad63b61f'],
    ['dungeon_support', '07722fee6e10161a268b477402eb66f4', '48559abccd521a049306926bd7044de8'],
    ['dungeon_enemy_turn', 'd1d340aa97bb9ecda19b12d136ea52f4', '37fdecdbac2988fef67bef10a12ea825'],
    ['combat_pool_act', '740c827714bd36d9e85b87ebe0d76892', 'ea274af685c81c435bb3c5f715d5c6b6']] loop
    select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) into strict m from pg_proc p where p.proname = x[1] and p.pronamespace = 'public'::regnamespace;
    if m not in (x[2], x[3]) then raise exception 'balance_table.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. The table + its history ------------------------------------------------------------------
create table if not exists public.balance (
  key        text primary key,
  value      jsonb not null,
  note       text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default session_user
);
create table if not exists public.balance_log (
  id         bigserial primary key,
  key        text not null,
  op         text not null,
  old_value  jsonb,
  new_value  jsonb,
  changed_at timestamptz not null default now(),
  changed_by text not null
);
create index if not exists balance_log_key on public.balance_log (key, changed_at desc);
alter table public.balance enable row level security;
alter table public.balance_log enable row level security;
revoke all on public.balance, public.balance_log from anon, authenticated;
revoke all on sequence public.balance_log_id_seq from anon, authenticated;

-- Who changed it: balance.mjs sets balance.by; the SQL editor shows the database user.
create or replace function public.balance_who() returns text
language sql stable set search_path to 'public' as $$
  select coalesce(nullif(current_setting('balance.by', true), ''), session_user::text);
$$;

-- Every leaf of a value: its path and JSON type (for the shape check).
create or replace function public.balance_leaves(p jsonb) returns table (path text[], typ text, num numeric)
language sql immutable set search_path to 'public' as $$
  with recursive t(path, v) as (
    select '{}'::text[], p
    union all
    select t.path || e.k, e.v from t
      cross join lateral (
        select k, v from jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) x(k, v)
        union all
        select (o - 1)::text, v from jsonb_array_elements(case when jsonb_typeof(t.v) = 'array' then t.v else '[]'::jsonb end)
          with ordinality y(v, o)) e
  )
  select path, jsonb_typeof(v), case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end
    from t where jsonb_typeof(v) not in ('object', 'array') or v in ('{}'::jsonb, '[]'::jsonb);
$$;

-- The guard: a key cannot be deleted (the fight reads every key); an update keeps every old leaf with
-- the same type; no number is negative; the star table keeps 6 values per rarity.
create or replace function public.balance_check() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_bad text;
begin
  if tg_op = 'DELETE' then
    raise exception 'balance: the key % is read by the game; change its value, do not delete it', old.key;
  end if;
  select string_agg(array_to_string(n.path, '.'), ', ') into v_bad from balance_leaves(new.value) n where n.num < 0;
  if v_bad is not null then raise exception 'balance %: negative number at %', new.key, v_bad; end if;
  if tg_op = 'UPDATE' then
    select string_agg(array_to_string(o.path, '.') || ' (' || o.typ || ')', ', ') into v_bad
      from balance_leaves(old.value) o
     where o.typ <> 'object' and o.typ <> 'array'
       and not exists (select 1 from balance_leaves(new.value) n where n.path = o.path and n.typ = o.typ);
    if v_bad is not null then
      raise exception 'balance %: the new value lost or changed the type of %', new.key, v_bad;
    end if;
    new.updated_at := now();
    new.updated_by := balance_who();
  end if;
  if new.key = 'stars' then
    select string_agg(r.key, ', ') into v_bad from jsonb_each(new.value) r
     where jsonb_typeof(r.value) <> 'array' or jsonb_array_length(r.value) <> 6
        or exists (select 1 from jsonb_array_elements(r.value) x where jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric <= 0);
    if v_bad is not null then raise exception 'balance stars: % must be 6 numbers above 0 (0 to 5 stars)', v_bad; end if;
  end if;
  return new;
end $$;
drop trigger if exists balance_check on public.balance;
create trigger balance_check before insert or update or delete on public.balance
  for each row execute function public.balance_check();

create or replace function public.balance_log_write() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and old.value = new.value and old.note = new.note then return new; end if;
  insert into balance_log (key, op, old_value, new_value, changed_by)
    values (new.key, lower(tg_op), case when tg_op = 'UPDATE' then old.value end, new.value, balance_who());
  return new;
end $$;
drop trigger if exists balance_log_write on public.balance;
create trigger balance_log_write after insert or update on public.balance
  for each row execute function public.balance_log_write();

-- 2. The accessors (fail closed: a missing key or number stops the action with an error) ----------
create or replace function public.balance_get(p_key text) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare v jsonb;
begin
  select value into v from balance where key = p_key;
  if v is null then raise exception 'balance: no value for the key %', p_key; end if;
  return v;
end $$;

create or replace function public.balance_num(p_key text, variadic p_path text[]) returns numeric
language plpgsql stable set search_path to 'public' as $$
declare v numeric;
begin
  v := (balance_get(p_key) #>> p_path)::numeric;
  if v is null then raise exception 'balance: no number at %.%', p_key, array_to_string(p_path, '.'); end if;
  return v;
end $$;

-- 3. The values. A value that lives in settings today moves with its LIVE value (the literal is only
--    the fallback for a fresh database). `on conflict do nothing`: a re-run never resets a tuned value.
insert into public.balance (key, value, note) values
('rarity_cp', '{"normal":10,"illustrated_rare":20,"secret_rare":40,"full_art":75,"event":75,"gold":140,"promo":10}',
 'Card power at 0 stars, by rarity. An unknown rarity uses normal. Each subject also has its own subjects.cp_mod (0.92 to 1.06), multiplied in card_cp_exact.'),
('stars', '{"normal":[1,3,4.5,5.75,7,8],"illustrated_rare":[1,2.2,3.2,4,4.8,5.5],"secret_rare":[1,1.7,2.2,2.7,3.1,3.5],"full_art":[1,1.4,1.7,2,2.25,2.5],"event":[1,1.4,1.7,2,2.25,2.5],"gold":[1,1.15,1.27,1.38,1.49,1.6],"promo":[1,3,4.5,5.75,7,8]}',
 'Option C (Nathan 2026-10-03): the power multiplier for 0 to 5 stars, by rarity. Used by the collection power, the leaderboard AND the raid. Event and promo cards cannot ascend (ascend_card), so only their 0-star value counts.'),
('stat_points', coalesce((select value - 'star' from public.settings where key = 'stat_points'),
   '{"enabled":true,"per_star":3,"attack":0.05,"vitality":0.06,"precision":0.03,"potency":0.05,"haste":0.04,"crit_cap":0.6}')
   || '{"haste_floor":0.2,"max_per_stat":15}',
 'Stat points: per_star points per star; Attack +attack power per point, Vitality +vitality HP, Precision +precision crit (all crit under crit_cap), Potency +potency effect / support amount, Haste -haste cooldown (not below haste_floor). max_per_stat = the most points in one stat. enabled = the feature flag (false: no points, combat = card power).'),
('card_hp', '{"per_cp":1.8,"floor":60}',
 'Card HP in the raid = max(floor, per_cp x combat power), then x (1 + Vitality). A support card has the floor.'),
('set_bonus', '1.25',
 'Collection power: a subject whose every rarity the member owns counts x this (my_collection_power, the leaderboard).'),
('ascend_cost', '{"normal":[4,6,8,11,15],"illustrated_rare":[3,4,6,8,11],"secret_rare":[1,1,2,3,4],"full_art":[2,3,4,6,8],"gold":[1,2,3,4,5]}',
 'Copies spent to go from star N to N+1 (index 0 = 0 to 1 star), by rarity. An unknown rarity uses normal.'),
('boss_atk', coalesce((select value from public.settings where key = 'hunt_atk'), '{"Normal":58,"Heroic":73,"Mythic":93}'),
 'Boss ATK by tier, set on the boss at spawn (hunts.stats.atk). A boss move deals ATK x its boss_moves value.'),
('boss_stats', coalesce((select value from public.settings where key = 'hunt_boss_stats'), '{}'),
 'Per boss ATK multiplier by name, for example {"The Smurf Brute": {"atk_mult": 1.2}}. Empty = every boss x1.'),
('boss_hp', coalesce((select value from public.settings where key = 'hunt_hp'), '{"Normal":70000,"Heroic":80000,"Mythic":80000,"crew":10,"heal_share":3000}')
   || '{"floor":500}',
 'Boss HP by tier at spawn (boss_hp_heal_share.sql, 2026-10-06). heal_share = the size of a boss heal (a fixed share, not HP / crew; without it the share is HP / crew). crew = the expected hunters. floor = the least HP.'),
('boss_tiers', '{"Normal":{"weak":1,"resist":0,"passives":1},"Heroic":{"weak":2,"resist":1,"passives":2},"Mythic":{"weak":3,"resist":2,"passives":3}}',
 'At spawn, by tier: how many weak tags, resist tags and passives the boss gets.'),
('boss_tags', '{"min_cards":4,"min_share":0.07,"max_share":0.35}',
 'A weak / resist tag must be on at least min_cards and min_share of the attackers, at most max_share (spawn_hunt).'),
('round_cap', coalesce((select value from public.settings where key = 'hunt_round_cap'), '40'),
 'The most rounds one squad fights in a day.'),
('daily_card_cap', coalesce((select value from public.settings where key = 'hunt_daily_card_cap'), '8'),
 'The most cards in one squad (one day). The Activity auto-pick uses it too.'),
('combat', '{"miss":0.08,"block":0.12,"crit":0.10,"crit_weak":0.20,"crit_x":2,"block_x":0.5,"roll_min":0.85,"roll_span":0.30,"weak_step":0.5,"weak_stack_free":3,"resist_step":0.8,"resist_decay":0.5,"weak_min":0.25,"weak_max":2.5,"syn_small_at":3,"syn_big_at":5,"element_small":1.12,"element_big":1.20,"origin_small":1.10,"origin_big":1.18,"trait_small":1.08,"trait_big":1.14,"syn_cap":1.6,"lifesteal_cap":0.06,"effect_cap_pct":100}',
 'A card hit (hunt_attack). Chances: miss, block, crit (crit_weak on a weak tag; Precision adds, under stat_points.crit_cap). Damage = combat power x weakness x (roll_min + random x roll_span) x buffs x synergy x passives; crit x crit_x, block x block_x. Weakness = 1 + (1 - weak_step^weak hits) (halved per weak-tag card after weak_stack_free) - resist_step x (1 - resist_decay^resists), between weak_min and weak_max. Synergy: syn_small_at / syn_big_at cards of one element, origin or trait give element_/origin_/trait_ small / big, all together at most syn_cap. Lifesteal heals at most lifesteal_cap of max HP. Rally, Butterfingers, Launch Party, Raid Crasher: at most effect_cap_pct %. The per-card ability amounts are in subjects.ability.'),
('boss_moves', '{"cycle":8,"cataclysm_x":0.75,"strike":0.40,"strike_x":1.00,"slam":0.22,"slam_x":0.35,"drain":0.10,"drain_x":0.80,"drain_heal":0.015,"stun":0.08,"stun_x":0.45,"enrage":0.07,"enrage_x":1.4,"enrage_rounds":2,"curse":0.06,"curse_x":0.7,"regenerate_heal":0.03,"regenerate_heal_rage":0.05,"rage_at":0.5,"rage_x":1.3,"phase2_at":0.25}',
 'The boss answer after each hit. Every cycle rounds: Cataclysm (all cards, ATK x cataclysm_x), shown one round ahead. Else a move by chance: strike / slam / drain / stun / enrage / curse, regenerate = the rest of 1. _x = ATK multiplier (curse_x: the card hits x this; enrage_x for enrage_rounds). Heals are a share of HP / crew. Below rage_at HP the boss hits x rage_x; below phase2_at it gains a passive.'),
('boss_passives', '{"armored_x":0.72,"shrouded_miss":0.10,"volatile_x":1.25,"frenzied_per_10pct":0.05,"regenerating_heal":0.005,"regenerating_heal_foe":0.03,"thorns":0.10,"flaming_chance":0.30,"flaming_x":0.40}',
 'Enemy passives (the Hunt boss and the Dungeon monsters): Armored (melee cards deal x armored_x), Shrouded (+shrouded_miss miss chance), Volatile (enemy hits x volatile_x), Frenzied (+frenzied_per_10pct per 10 % HP lost), Regenerating (the Hunt boss heals regenerating_heal of HP / crew per turn, a Dungeon monster regenerating_heal_foe of its max HP), Thorns (share of the damage back to the card), Flaming (flaming_chance to burn for ATK x flaming_x).'),
('pool_moves', '{"cycle":6,"cataclysm_x":0.9,"cataclysm_area":0.75,"heavy_x":1.5,"flurry_x":0.55,"slam_x":0.35,"drain_x":0.8,"drain_heal":0.08,"stun_x":0.45,"poison_x":0.35,"poison_dot":0.25,"regenerate_heal":0.10,"regenerate_heal_rage":0.14,"guard":0.20}',
 'The Dungeon monster moves (combat_pool_act; each monster has its own move list and weights in dungeon_monsters). A guardian charges a Cataclysm every cycle rounds (ATK x cataclysm_x, the other cards x cataclysm_area). _x = ATK multiplier; flurry hits twice; drain heals drain_heal of max HP; poison adds poison_dot x ATK; regenerate heals regenerate_heal of max HP (regenerate_heal_rage below boss_moves.rage_at); guard gives a shield of guard x max HP.'),
('support', '{"affinity_step":0.15,"affinity_cap":2.0,"matched_x":1.8,"weaken_cap":0.6,"expose_cap":1.0,"heal_cap":1.0,"stun_immune_rounds":2}',
 'Support cards (hunt_support): +affinity_step per squad card with the affinity tag (at most affinity_cap); an ally with the affinity gets x matched_x; weaken and expose at most weaken_cap / expose_cap; heal and shield at most heal_cap of max HP; after a stun the boss is immune for stun_immune_rounds. The per-card amounts are in subjects.ability.'),
('effect_tiers', coalesce((select value from public.settings where key = 'card_effect_tiers'),
   '{"gold":{"cd":0.65,"power":1.5},"normal":{"cd":1,"power":1},"full_art":{"cd":0.75,"power":1.3},"secret_rare":{"cd":0.8,"power":1.3},"illustrated_rare":{"cd":0.9,"power":1.15}}'),
 'Pranks and boons (play_card_effect): power multiplies the base amount and length (Rally %, Butterfingers %, Mend, ...), cd the cooldown, by the rarity of the played card. The base amounts are in subjects.effect, the ceilings in effect_primitives.max_amount / max_duration_s.'),
('effect_ascension', coalesce((select value from public.settings where key = 'card_effect_ascension'), '{"cd_per_star":0.08,"power_per_star":0.1}')
   || '{"cd_floor":0.2}',
 'Pranks and boons when stat points are OFF: +power_per_star power and -cd_per_star cooldown per star (cooldown not below cd_floor). With stat points on, Potency and Haste replace it.'),
('effect_cooldown_scale', coalesce((select value from public.settings where key = 'card_effect_cooldown_scale'), '1'),
 'One knob for every prank / boon cooldown (1 = as written).')
on conflict (key) do nothing;

-- The old settings rows: moved above, so delete them (one number, one source).
delete from public.settings where key in ('stat_points', 'hunt_atk', 'hunt_hp', 'hunt_boss_stats', 'hunt_round_cap',
  'hunt_daily_card_cap', 'card_effect_tiers', 'card_effect_ascension', 'card_effect_cooldown_scale');

-- 4. Card power, combat power, HP: ONE place where the CP numbers multiply -----------------------
-- card_cp_exact = rarity_cp x stars x cp_mod, not rounded. card_power rounds it (collection power,
-- leaderboard, ascend result); card_combat multiplies the Attack points before it rounds (the raid).
create or replace function public.card_cp_exact(p_rarity text, p_ascension integer, p_mod numeric default 1.0) returns numeric
language sql stable set search_path to 'public' as $$
  select coalesce((b.rcp->>p_rarity)::numeric, (b.rcp->>'normal')::numeric)
       * coalesce((b.st->p_rarity->>greatest(0, least(5, coalesce(p_ascension, 0))))::numeric,
                  (b.st->'normal'->>greatest(0, least(5, coalesce(p_ascension, 0))))::numeric)
       * coalesce(p_mod, 1.0)
    from (select balance_get('rarity_cp') as rcp, balance_get('stars') as st) b;
$$;

-- STABLE now (was IMMUTABLE): it reads the table. No index, generated column or constraint uses it.
create or replace function public.card_power(p_rarity text, p_ascension integer, p_mod numeric default 1.0) returns integer
language sql stable set search_path to 'public' as $$
  select round(card_cp_exact(p_rarity, p_ascension, p_mod))::int;
$$;

create or replace function public.card_max_hp(p_cp integer) returns integer
language sql stable set search_path to 'public' as $$
  select greatest(balance_num('card_hp', 'floor'), round(p_cp * balance_num('card_hp', 'per_cp')))::int;
$$;

create or replace function public.stat_cfg() returns jsonb
language sql stable set search_path to 'public' as $$
  select balance_get('stat_points');
$$;

create or replace function public.stat_pt(p_pts jsonb, p_key text) returns integer
language sql stable set search_path to 'public' as $$
  select greatest(0, least(balance_num('stat_points', 'max_per_stat')::int, coalesce(case when jsonb_typeof(p_pts->p_key) = 'number'
    then floor((p_pts->>p_key)::numeric)::int end, 0)));
$$;

-- The combat numbers of one copy: card power (the star table) x Attack points; HP x Vitality.
-- Stat points off: card_power + card_max_hp exactly (as before).
create or replace function public.card_combat(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  c jsonb := stat_cfg();
  a int := greatest(0, least(5, coalesce(p_asc, 0)));
  pts jsonb := coalesce(p_pts, '{}'::jsonb);
  v_x numeric; v_cp int; v_spent int;
begin
  v_x := card_cp_exact(p_rarity, a, p_mod);
  if not coalesce((c->>'enabled')::boolean, false) then
    v_cp := round(v_x)::int;
    return jsonb_build_object('on', false, 'cp', v_cp, 'hp', card_max_hp(v_cp), 'crit', 0,
      'potency', 1, 'haste', 1, 'free', 0);
  end if;
  v_spent := stat_pt(pts, 'attack') + stat_pt(pts, 'vitality') + stat_pt(pts, 'precision')
           + stat_pt(pts, 'potency') + stat_pt(pts, 'haste');
  v_cp := round(v_x * (1 + (c->>'attack')::numeric * stat_pt(pts, 'attack')))::int;
  return jsonb_build_object('on', true, 'cp', v_cp,
    'hp', round(card_max_hp(v_cp) * (1 + (c->>'vitality')::numeric * stat_pt(pts, 'vitality')))::int,
    'crit', (c->>'precision')::numeric * stat_pt(pts, 'precision'),
    'potency', 1 + (c->>'potency')::numeric * stat_pt(pts, 'potency'),
    'haste', greatest((c->>'haste_floor')::numeric, 1 - (c->>'haste')::numeric * stat_pt(pts, 'haste')),
    'free', greatest(0, (c->>'per_star')::int * a - v_spent));
end $$;

create or replace function public.ascend_cost(p_rarity text, p_ascension integer) returns integer
language sql stable set search_path to 'public' as $$
  select case when coalesce(p_ascension, 0) >= 5 then null else
    coalesce((balance_get('ascend_cost')->p_rarity->>coalesce(p_ascension, 0))::int,
             (balance_get('ascend_cost')->'normal'->>coalesce(p_ascension, 0))::int) end;
$$;

create or replace function public.hunt_round_cap() returns integer
language sql stable set search_path to 'public' as $$
  select (balance_get('round_cap') #>> '{}')::int;
$$;

create or replace function public.hunt_card_cap() returns integer
language sql stable set search_path to 'public' as $$
  select (balance_get('daily_card_cap') #>> '{}')::int;
$$;

-- The miss chance (the Hunt and the Dungeon): combat.miss, + boss_passives.shrouded_miss on a Shrouded enemy.
create or replace function public.combat_miss(p_shrouded boolean) returns numeric
language sql stable set search_path to 'public' as $$
  select balance_num('combat', 'miss') + case when p_shrouded then balance_num('boss_passives', 'shrouded_miss') else 0 end;
$$;

-- What the Activity shows: it never computes power or HP, it reads them here.
-- p_player = a member: each owned copy -> power (card_power: collection, leaderboard) + the card_combat
-- numbers (cp, hp, crit, potency, haste, free: the raid). p_player null = every card at 0 stars (the catalog).
create or replace function public.card_powers(p_player text default null) returns jsonb
language sql stable set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(x.id::text, x.v), '{}'::jsonb) from (
    select c.id, jsonb_build_object('power', card_power(c.rarity::text, 0, s.cp_mod),
                                    'hp', card_max_hp(card_power(c.rarity::text, 0, s.cp_mod))) as v
      from cards c left join subjects s on s.id = c.subject_id where p_player is null
    union all
    select c.id, card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)
                 || jsonb_build_object('power', card_power(c.rarity::text, pc.ascension, s.cp_mod))
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
     where p_player is not null and pc.player_id = p_player and pc.quantity > 0) x;
$$;

-- Every member's collection power (the leaderboard), the same rule as my_collection_power.
create or replace function public.collection_power_all() returns table (player_id text, power bigint)
language sql stable set search_path to 'public' as $$
  with subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select pc.player_id, c.subject_id, sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)) base_cp, count(*) ov
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
     where pc.quantity >= 1 group by pc.player_id, c.subject_id
  )
  select ps.player_id, sum(case when ps.ov = st.tv then round(ps.base_cp * (balance_get('set_bonus') #>> '{}')::numeric) else ps.base_cp end)::bigint
    from ps join subj_totals st on st.subject_id = ps.subject_id group by ps.player_id;
$$;

-- 5. The functions that had a number written in them (LIVE definitions, the numbers now read the table).

-- combat_weak: combat.weak_step / weak_stack_free / resist_step / resist_decay / weak_min / weak_max.
CREATE OR REPLACE FUNCTION "public"."combat_weak"("p_weak" "jsonb", "p_resist" "jsonb", "p_type" "text", "p_rarity" "text", "p_season" "text", "p_tags" "text"[], "p_stack" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare v_wm int; v_rm int; v_wmult numeric;
begin
  select count(*) into v_wm from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'season' and w->>'value' = p_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  select count(*) into v_rm from jsonb_array_elements(coalesce(p_resist, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'season' and w->>'value' = p_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  v_wmult := 1
    + (1 - power(public.balance_num('combat', 'weak_step'), v_wm)) * (case when p_stack <= public.balance_num('combat', 'weak_stack_free') then 1 else power(public.balance_num('combat', 'weak_step'), p_stack - public.balance_num('combat', 'weak_stack_free')) end)
    - public.balance_num('combat', 'resist_step') * (1 - power(public.balance_num('combat', 'resist_decay'), v_rm));
  v_wmult := greatest(public.balance_num('combat', 'weak_min'), least(public.balance_num('combat', 'weak_max'), v_wmult));
  return jsonb_build_object('wm', v_wm, 'rm', v_rm, 'mult', v_wmult);
end $$;

-- combat_squad: the synergy sizes and multipliers (combat.syn_* / element_* / origin_* / trait_*).
CREATE OR REPLACE FUNCTION "public"."combat_squad"("p_tags" "text"[], "p_self_in" boolean, "p_others" "jsonb", "p_weak" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare v_wtags text[]; v_stack int := 0; v_elem text; v_syn int; v_synmult numeric := 1;
  v_origin text; v_osyn int; v_omult numeric := 1; v_ksyn int; v_kmult numeric := 1;
  v_o jsonb := coalesce(p_others, '[]'::jsonb);
begin
  select array_agg(w->>'value') into v_wtags
    from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w where w->>'kind' = 'tag';
  if v_wtags is not null and array_length(v_wtags, 1) > 0 then
    select count(*) into v_stack from jsonb_array_elements(v_o) o
      where array(select jsonb_array_elements_text(o)) && v_wtags;
    if p_self_in and p_tags && v_wtags then v_stack := v_stack + 1; end if;
  end if;
  -- Element synergy: this card's dominant element + how many other cards share it.
  v_elem := (select e from unnest(array['fire','water','lightning','ice','nature','earth','air',
                                        'shadow','light','arcane','psychic','toxic','metal']) e
             where ('trait:' || e) = any(p_tags) limit 1);
  if v_elem is not null then
    select count(*) into v_syn from jsonb_array_elements(v_o) o where o ? ('trait:' || v_elem);
    v_syn := coalesce(v_syn, 0) + 1;   -- include this card
    if v_syn >= public.balance_num('combat', 'syn_big_at') then v_synmult := public.balance_num('combat', 'element_big'); elsif v_syn >= public.balance_num('combat', 'syn_small_at') then v_synmult := public.balance_num('combat', 'element_small'); end if;
  else
    v_syn := 0;
  end if;
  -- Origin (game) synergy.
  v_origin := (select t from unnest(p_tags) t where t like 'origin:%' limit 1);
  if v_origin is not null then
    select count(*) into v_osyn from jsonb_array_elements(v_o) o where o ? v_origin;
    v_osyn := coalesce(v_osyn, 0) + 1;
    if v_osyn >= public.balance_num('combat', 'syn_big_at') then v_omult := public.balance_num('combat', 'origin_big'); elsif v_osyn >= public.balance_num('combat', 'syn_small_at') then v_omult := public.balance_num('combat', 'origin_small'); end if;
  end if;
  -- Trait (kind) synergy: the best-shared non-element trait.
  select coalesce(max(cnt), 0) into v_ksyn from (
    select count(*) as cnt from unnest(p_tags) tg cross join jsonb_array_elements(v_o) o
      where tg like 'trait:%' and tg not in ('trait:fire','trait:water','trait:lightning','trait:ice','trait:nature','trait:earth','trait:air','trait:shadow','trait:light','trait:arcane','trait:psychic','trait:toxic','trait:metal')
        and o ? tg
      group by tg) k;
  if v_ksyn > 0 then v_ksyn := v_ksyn + 1; if v_ksyn >= public.balance_num('combat', 'syn_big_at') then v_kmult := public.balance_num('combat', 'trait_big'); elsif v_ksyn >= public.balance_num('combat', 'syn_small_at') then v_kmult := public.balance_num('combat', 'trait_small'); end if; end if;
  v_synmult := least(public.balance_num('combat', 'syn_cap'), v_synmult * v_omult * v_kmult);
  return jsonb_build_object('stack', v_stack, 'elem', v_elem, 'syn', v_syn, 'synmult', v_synmult);
end $$;

-- combat_crit_chance: combat.crit / crit_weak, stat_points.crit_cap.
CREATE OR REPLACE FUNCTION "public"."combat_crit_chance"("p_bonus" boolean, "p_aeff" "text", "p_aamt" numeric, "p_cmb" "jsonb") RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare v_critchance numeric;
begin
  v_critchance := (case when p_bonus then public.balance_num('combat', 'crit_weak') else public.balance_num('combat', 'crit') end) + (case when p_aeff = 'focus' then p_aamt else 0 end);
  if (p_cmb->>'on')::boolean then   -- Precision points, under the crit cap
    v_critchance := least(public.balance_num('stat_points', 'crit_cap'), v_critchance + (p_cmb->>'crit')::numeric);
  end if;
  return v_critchance;
end $$;

-- combat_hit: combat.block / roll / crit_x / block_x, boss_passives.armored_x.
CREATE OR REPLACE FUNCTION "public"."combat_hit"("p_cp" integer, "p_wmult" numeric, "p_buff" numeric, "p_debuff" numeric, "p_synmult" numeric, "p_critchance" numeric, "p_miss" numeric, "p_aeff" "text", "p_aamt" numeric, "p_athresh" numeric, "p_armored_melee" boolean, "p_expose" numeric, "p_hp" bigint, "p_hpmax" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_miss boolean; v_crit boolean; v_block boolean; v_base numeric; v_dmg int; v_outcome text; v_double boolean := false;
begin
  v_miss  := random() < p_miss;
  v_crit  := (not v_miss) and random() < p_critchance;
  v_block := (not v_miss) and (not v_crit) and (p_aeff <> 'pierce' or p_aeff is null) and random() < public.balance_num('combat', 'block');
  if v_miss then
    v_dmg := 0; v_outcome := 'miss';
  else
    v_base := p_cp * p_wmult * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span'));
    v_base := v_base * p_buff * p_debuff;
    v_base := v_base * p_synmult;                                                     -- squad synergy
    if p_armored_melee then v_base := v_base * public.balance_num('boss_passives', 'armored_x'); end if;                          -- an armored enemy
    if p_expose > 0 then v_base := v_base * (1 + p_expose); end if;
    if p_aeff = 'execute' and p_hp < p_athresh * p_hpmax then v_base := v_base * (1 + p_aamt); end if;
    if v_crit  then v_base := v_base * public.balance_num('combat', 'crit_x');   end if;
    if v_block then v_base := v_base * public.balance_num('combat', 'block_x'); end if;
    v_dmg := greatest(1, round(v_base));
    v_outcome := case when v_crit then 'crit' when v_block then 'blocked' else 'hit' end;
    -- Rampage (an attack ability): amount = the chance of a second strike (no crit / block).
    if p_aeff = 'rampage' and random() < p_aamt then
      v_dmg := v_dmg + greatest(1, round(v_base / (case when v_crit then public.balance_num('combat', 'crit_x') else 1 end) / (case when v_block then public.balance_num('combat', 'block_x') else 1 end)));
      v_double := true;
    end if;
  end if;
  return jsonb_build_object('dmg', v_dmg, 'outcome', v_outcome, 'miss', v_miss, 'crit', v_crit, 'block', v_block, 'double', v_double);
end $$;

-- combat_lifesteal: combat.lifesteal_cap.
CREATE OR REPLACE FUNCTION "public"."combat_lifesteal"("p_dmg" integer, "p_aamt" numeric, "p_maxhp" integer) RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  select greatest(1, least(round(p_dmg * p_aamt), round(p_maxhp * public.balance_num('combat', 'lifesteal_cap'))))::int;
$$;

-- combat_enemy_mult: boss_passives.volatile_x / frenzied_per_10pct, boss_moves.rage_at / rage_x.
CREATE OR REPLACE FUNCTION "public"."combat_enemy_mult"("p_enrage" numeric, "p_enr_until" integer, "p_weaken" numeric, "p_wk_until" integer, "p_round" integer, "p_volatile" boolean, "p_lost" numeric, "p_frenzied" boolean) RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare v_bmult numeric := 1;
begin
  if p_enr_until >= p_round and p_enrage > 0 then v_bmult := v_bmult * p_enrage; end if;
  if p_wk_until  >= p_round and p_weaken > 0 then v_bmult := v_bmult * (1 - p_weaken); end if;
  if p_volatile then v_bmult := v_bmult * public.balance_num('boss_passives', 'volatile_x'); end if;                       -- volatile
  if p_lost >= public.balance_num('boss_moves', 'rage_at') then v_bmult := v_bmult * public.balance_num('boss_moves', 'rage_x'); end if;                     -- below 50% HP: rage
  if p_frenzied then v_bmult := v_bmult * (1 + public.balance_num('boss_passives', 'frenzied_per_10pct') * floor(p_lost * 10)); end if;
  return v_bmult;
end $$;

-- combat_enemy_act: boss_moves (the cycle, the move chances and ATK multipliers, the heals).
CREATE OR REPLACE FUNCTION "public"."combat_enemy_act"("p_atk" numeric, "p_bmult" numeric, "p_round" integer, "p_stun_until" integer, "p_lost" numeric, "p_share" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_act text; v_cdmg int := 0; v_area numeric := 0; v_bheal int := 0; v_r numeric;
  m jsonb := public.balance_get('boss_moves'); v_cyc int := (m->>'cycle')::int;   -- balance_table.sql
  v_t1 numeric; v_t2 numeric; v_t3 numeric; v_t4 numeric; v_t5 numeric; v_t6 numeric;
begin
  if p_stun_until >= p_round then
    v_act := 'stunned';
  elsif p_round % v_cyc = v_cyc - 1 then
    v_act := 'charging';                      -- the Cataclysm is shown one round ahead
  elsif p_round % v_cyc = 0 then
    v_act := 'cataclysm';                     -- ATK x cataclysm_x to every card still standing
    v_cdmg := greatest(1, round(p_atk * (m->>'cataclysm_x')::numeric * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span')) * p_bmult)); v_area := (m->>'cataclysm_x')::numeric;
  else
    v_t1 := (m->>'strike')::numeric; v_t2 := v_t1 + (m->>'slam')::numeric; v_t3 := v_t2 + (m->>'drain')::numeric;
    v_t4 := v_t3 + (m->>'stun')::numeric; v_t5 := v_t4 + (m->>'enrage')::numeric; v_t6 := v_t5 + (m->>'curse')::numeric;
    v_r := random();
    if v_r < v_t1 then
      v_act := 'strike';                      -- ATK x strike_x
      v_cdmg := greatest(1, round(p_atk * (m->>'strike_x')::numeric * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span')) * p_bmult));
    elsif v_r < v_t2 then
      v_act := 'slam';                        -- ATK x slam_x to every card
      v_cdmg := greatest(1, round(p_atk * (m->>'slam_x')::numeric * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span')) * p_bmult)); v_area := (m->>'slam_x')::numeric;
    elsif v_r < v_t3 then
      v_act := 'drain';                       -- ATK x drain_x, heals drain_heal of a player's share
      v_cdmg := greatest(1, round(p_atk * (m->>'drain_x')::numeric * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span')) * p_bmult));
      v_bheal := v_bheal + greatest(1, round(p_share * (m->>'drain_heal')::numeric));
    elsif v_r < v_t4 then
      v_act := 'stun';                        -- ATK x stun_x and the card waits one round
      v_cdmg := greatest(1, round(p_atk * (m->>'stun_x')::numeric * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span')) * p_bmult));
    elsif v_r < v_t5 then
      v_act := 'enrage';                      -- x enrage_x for enrage_rounds (the caller stores it)
    elsif v_r < v_t6 then
      v_act := 'curse';                       -- the attacking card deals x curse_x (the caller stores it)
    else
      v_act := 'regenerate';                  -- regenerate_heal of a player's share, regenerate_heal_rage below rage_at HP
      v_bheal := v_bheal + greatest(1, round(p_share * case when p_lost >= (m->>'rage_at')::numeric then (m->>'regenerate_heal_rage')::numeric else (m->>'regenerate_heal')::numeric end));
    end if;
  end if;
  return jsonb_build_object('action', v_act, 'dmg', v_cdmg, 'area', v_area, 'heal', v_bheal);
end $$;

-- combat_area_roll: the damage roll.
CREATE OR REPLACE FUNCTION "public"."combat_area_roll"("p_atk" numeric, "p_area" numeric, "p_bmult" numeric) RETURNS integer
    LANGUAGE "sql"
    AS $$
  select greatest(1, round(p_atk * p_area * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span')) * p_bmult))::int;
$$;

-- combat_burn: boss_passives.flaming_chance / flaming_x.
CREATE OR REPLACE FUNCTION "public"."combat_burn"("p_atk" numeric) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
begin
  if random() < public.balance_num('boss_passives', 'flaming_chance') then return greatest(1, round(p_atk * public.balance_num('boss_passives', 'flaming_x') * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span'))))::int; end if;
  return 0;
end $$;

-- combat_thorns: boss_passives.thorns.
CREATE OR REPLACE FUNCTION "public"."combat_thorns"("p_dmg" integer) RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$ select greatest(1, round(p_dmg * public.balance_num('boss_passives', 'thorns')))::int; $$;

-- combat_regen: boss_passives.regenerating_heal.
CREATE OR REPLACE FUNCTION "public"."combat_regen"("p_share" bigint) RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$ select greatest(1, round(p_share * public.balance_num('boss_passives', 'regenerating_heal')))::int; $$;

-- combat_aff_scale: support.affinity_cap / affinity_step.
CREATE OR REPLACE FUNCTION "public"."combat_aff_scale"("p_count" integer) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$ select least(public.balance_num('support', 'affinity_cap'), 1 + public.balance_num('support', 'affinity_step') * coalesce(p_count, 0)); $$;

-- combat_support_value: support.heal_cap / weaken_cap / expose_cap.
CREATE OR REPLACE FUNCTION "public"."combat_support_value"("p_eff" "text", "p_amt" numeric, "p_scale" numeric, "p_target_maxhp" integer) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  select case p_eff
    when 'empower' then 1 + p_amt
    when 'shield'  then greatest(1, round(p_target_maxhp * least(p_amt, public.balance_num('support', 'heal_cap'))))
    when 'heal'    then greatest(1, round(p_target_maxhp * least(p_amt, public.balance_num('support', 'heal_cap'))))
    when 'weaken'  then least(public.balance_num('support', 'weaken_cap'), p_amt * p_scale)
    when 'expose'  then least(public.balance_num('support', 'expose_cap'), p_amt * p_scale)
    when 'smite'   then greatest(1, round(p_amt * p_scale))
  end;
$$;

-- combat_stun_immune: support.stun_immune_rounds.
CREATE OR REPLACE FUNCTION "public"."combat_stun_immune"("p_stun_until" integer, "p_round" integer) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(p_stun_until, 0) > 0 and p_round < p_stun_until + public.balance_num('support', 'stun_immune_rounds');
$$;

-- hunt_attack (live, combat_core.sql): the miss chance, the daily card cap, the boon / prank caps, the boss ATK, Enrage, Curse, the phase lines.
CREATE OR REPLACE FUNCTION "public"."hunt_attack"("p_player" "text", "p_hunt" bigint, "p_card" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
  v_bname text; v_marks jsonb; v_pick jsonb; v_ctr jsonb; v_tick jsonb; v_ubuff numeric := 1;
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
  -- bonus) and Demotion (an attack on an exposed boss sends 20% back).
  if v_dmg > 0 and v_buff > 1 and hunt_mark_on(v_marks, 'counterpick', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(2 * v_dmg * (v_buff - 1) / v_buff))::int);   -- twice the bonus
  end if;
  if v_dmg > 0 and v_exp_until >= v_round and v_expose > 0 and hunt_mark_on(v_marks, 'demotion', v_round)
     and not hunt_mark_on(v_marks, 'block_expose', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * 0.2))::int);
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
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: +20% for each weaken played
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
    -- A counter move (hunt_boss_moves.sql): 40% of the normal turns of a boss with a move pool. An effect move comes on
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
    if v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then
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
      select k into v_extra from unnest(array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied']) k
        where k <> all(v_plist) order by random() limit 1;
      update hunts set passive = coalesce(passive, '{}'::jsonb) || jsonb_build_object('phase2', true,
          'list', coalesce(passive->'list', '[]'::jsonb) || case when v_extra is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('kind', v_extra, 'label', case v_extra
              when 'armored' then 'Armored: melee attackers deal less' when 'shrouded' then 'Shrouded: attacks miss more often'
              when 'flaming' then 'Flaming: burns the attacking card' when 'volatile' then 'Volatile: counterattacks hit harder'
              when 'regenerating' then 'Regenerating: heals a little every turn' when 'thorns' then 'Thorns: part of your damage comes back to your card'
              else 'Frenzied: hits harder as it loses HP' end)) end)
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
            case when v_bossact = 'stun' then v_round + 1 else 0 end)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed,
      dmg_buff = excluded.dmg_buff, dmg_debuff = excluded.dmg_debuff, shield = excluded.shield,
      cd_until_round = greatest(excluded.cd_until_round, hunt_card_hp.cd_until_round), updated_at = now();

  insert into hunt_combat_log (hunt_id, player_id, card_id, cp, outcome, bonus, crit, block,
    damage, countered, counter_dmg, card_hp_after, card_downed, boss_hp_after)
  values (p_hunt, p_player, p_card, v_cp, v_outcome, v_bonus, v_crit, v_block,
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp);

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

  v_targets := jsonb_build_array(jsonb_build_object('card_id', p_card, 'dmg', v_cdmg,
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
end $$;

-- hunt_support (live): support.matched_x, support.stun_immune_rounds.
CREATE OR REPLACE FUNCTION "public"."hunt_support"("p_player" "text", "p_hunt" bigint, "p_card" bigint, "p_target" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_rcap int; v_sdown boolean; v_stun_until int;
  v_status text; v_closes timestamptz; v_tier text; v_hp bigint;
  v_qty int; v_type text; v_ability jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text;
  v_day date; v_round int; v_cd_until int; v_cap int; v_maxhp int;
  v_tqty int; v_trar text; v_tasc int; v_tmod numeric; v_tmaxhp int; v_tcp int;
  v_tpts jsonb; v_srar text; v_sasc int; v_smod numeric; v_spts jsonb;
  v_aff text; v_ttags text[]; v_affcount int := 0; v_scale numeric := 1; v_matched boolean := false; v_sdmg int;
  v_settle jsonb;
  v_marks jsonb; v_plist text[]; v_f numeric := 1; v_ctr text[] := '{}'; v_gain int; v_tkind text; v_fail boolean := false;
begin
  select status, closes_at, tier into v_status, v_closes, v_tier from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  select coalesce(array_agg(x->>'kind'), '{}') into v_plist from hunts h, jsonb_array_elements(coalesce(h.passive->'list', '[]'::jsonb)) x where h.id = p_hunt;

  select pc.quantity, s.type, s.ability, c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points
    into v_qty, v_type, v_ability, v_srar, v_sasc, v_smod, v_spts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_ability is null or v_ability->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;

  v_eff := v_ability->>'effect';
  v_amt := coalesce((v_ability->>'amount')::numeric, 0);
  -- Potency points of this support copy make its effect stronger (1 with the flag off).
  v_amt := v_amt * coalesce((card_combat(v_srar, v_sasc, v_smod, v_spts)->>'potency')::numeric, 1);
  v_dur := coalesce((v_ability->>'duration')::int, 1);
  v_cd  := coalesce((v_ability->>'cooldown')::int, 1);
  v_tgt := coalesce(v_ability->>'target', 'boss');
  v_aff := v_ability->>'affinity';
  v_day := (now() at time zone 'America/Denver')::date;
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then -- hunt_squads.sql
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  v_round := hunt_state_round(p_hunt, p_player, v_day);

  -- The round limit (hunt_loop_caps.sql).
  v_rcap := hunt_round_cap();
  if v_round >= v_rcap then return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap); end if;
  select cd_until_round, downed or hp_remaining <= 0 into v_cd_until, v_sdown from hunt_card_hp
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  -- A support card that is down does nothing (hunt_loop_caps.sql: a downed heal card kept a squad alive).
  if coalesce(v_sdown, false) then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  if found and v_round < coalesce(v_cd_until, 0) then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', v_cd_until, 'round', v_round);
  end if;

  v_maxhp := card_max_hp(0);   -- a support card: the HP floor (60 since hunt_launch_balance.sql)
  if not hunt_commit_card(p_hunt, p_player, p_card, v_day, v_maxhp) then
    return jsonb_build_object('ok', false, 'error', 'day_limit');
  end if;

  -- Affinity synergy: how many committed squad cards share this support's affinity tag.
  if v_aff is not null then
    select count(distinct h.card_id) into v_affcount
    from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
    where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affcount);

  -- Counters (hunt_boss_moves.sql): the counter passives and the boss marks make this support weaker.
  select marks into v_marks from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  v_marks := coalesce(v_marks, '{}'::jsonb);
  if coalesce((v_marks->>'null_next')::int, 0) > 0 then   -- Packet Loss (1) / Shadow Ban (2): this play does nothing
    update hunt_combat_state set marks = case when (marks->>'null_next')::int > 1 then jsonb_set(marks, '{null_next}', to_jsonb((marks->>'null_next')::int - 1))
      else marks - 'null_next' end, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
      values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, 0, case when v_tgt in ('ally', 'self') then p_target end,
              jsonb_build_object('nullified', true, 'countered', jsonb_build_array('null_next')));
    return jsonb_build_object('ok', true, 'effect', v_eff, 'nullified', true, 'countered', jsonb_build_array('null_next'),
      'ready_round', v_round + v_cd, 'round', v_round, 'boss_hp', (select hp_remaining from hunts where id = p_hunt), 'defeated', false);
  end if;
  if v_eff = 'heal' and 'plague' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'plague'::text; end if;
  if v_eff in ('shield', 'smite') and 'shatterer' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'shatterer'::text; end if;
  if v_eff in ('empower', 'expose') and 'dispeller' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'dispeller'::text; end if;
  if v_eff = 'weaken' and 'juggernaut' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'juggernaut'::text; end if;
  if v_eff = 'heal' and p_target is not null and hunt_mark_on(v_marks->'heal_block_card', p_target::text, v_round) then
    v_f := v_f * coalesce((v_marks->'heal_block_card'->p_target::text->>'mult')::numeric, 0.1); v_ctr := v_ctr || 'bloodrot'::text;
  end if;
  if v_eff in ('shield', 'empower', 'weaken', 'expose', 'smite') and hunt_mark_on(v_marks, 'block_' || v_eff, v_round) then
    v_f := v_f * coalesce((v_marks->('block_' || v_eff)->>'mult')::numeric, 0.1); v_ctr := v_ctr || ('block_' || v_eff);
  end if;
  if hunt_mark_on(v_marks, 'half_' || v_eff, v_round) then   -- Shatter, Rattle, Nerf (25%), Fade, Rollback, Decay (50%) for the day
    v_f := v_f * coalesce((v_marks->('half_' || v_eff)->>'mult')::numeric, 0.5); v_ctr := v_ctr || ('half_' || v_eff);
  end if;
  if v_f <> 1 then v_amt := v_amt * v_f; end if;

  -- resolve ally-targeted effects (need a committed target row)
  if v_tgt in ('ally', 'self') then
    if p_target is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    select pc.quantity, c.rarity::text, pc.ascension, s.cp_mod, s.tag_slugs, pc.stat_points, s.ability->>'kind'
      into v_tqty, v_trar, v_tasc, v_tmod, v_ttags, v_tpts, v_tkind
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_target;
    if not found or v_tqty < 1 then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    v_tcp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'cp')::int;
    v_tmaxhp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'hp')::int;
    if v_tkind = 'support' then v_tmaxhp := card_max_hp(0); end if;   -- D-70: a support target has the support HP
    perform hunt_commit_card(p_hunt, p_player, p_target, v_day, v_tmaxhp);

    -- matched ally gets the stronger effect
    v_matched := v_aff is not null and v_ttags is not null and v_aff = any(v_ttags);
    if v_matched then v_amt := v_amt * balance_num('support', 'matched_x'); end if;

    if v_eff = 'empower' then
      update hunt_card_hp set dmg_buff = combat_support_value('empower', v_amt, 1, null), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'shield' then
      -- amount = a fraction of the TARGET's max HP (was flat 60 on 30-HP cards).
      update hunt_card_hp set shield = shield + combat_support_value('shield', v_amt, 1, max_hp)::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'heal' then
      -- amount = a fraction of the TARGET's max HP (was flat 60, a full heal on the
      -- 30-HP cards). A heal never revives a downed card (that is a separate boon).
      if exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player
                  and card_id = p_target and hit_date = v_day and downed) then
        return jsonb_build_object('ok', false, 'error', 'target_downed');
      end if;
      select hp_remaining into v_gain from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
      update hunt_card_hp set hp_remaining = least(max_hp, hp_remaining + combat_support_value('heal', v_amt, 1, max_hp)::int),
        updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day
        returning hp_remaining - v_gain into v_gain;
      if v_gain > 0 and hunt_mark_on(v_marks, 'undying', v_round) then   -- Undying: the boss heals the same
        update hunts set hp_remaining = least(hp_max, hp_remaining + v_gain) where id = p_hunt and status = 'active';
        v_ctr := v_ctr || 'undying'::text;
      end if;
    else
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;

  -- boss-targeted / team effects (scaled by affinity synergy)
  elsif v_eff = 'weaken' then
    update hunt_combat_state set boss_weaken = combat_support_value('weaken', v_amt, v_scale, null), weaken_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: each weaken adds 20% to the boss damage
      perform hunt_marks_patch(p_hunt, p_player, v_day, jsonb_build_object('spiral', (v_marks->'spiral')
        || jsonb_build_object('bonus', coalesce((v_marks->'spiral'->>'bonus')::numeric, 0) + 0.2)));
      v_ctr := v_ctr || 'spiral'::text;
    end if;
  elsif v_eff = 'expose' then
    update hunt_combat_state set boss_expose = combat_support_value('expose', v_amt, v_scale, null), expose_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'stun' then
    -- Stun immunity (hunt_loop_caps.sql): after a stun the boss cannot be stunned for 2 rounds, so
    -- 4 stun cards cannot lock it (at most 1 stunned round in 3).
    select stunned_until into v_stun_until from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if combat_stun_immune(v_stun_until, v_round) then
      return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', v_stun_until + balance_num('support', 'stun_immune_rounds')::int);
    end if;
    -- Desync / Juggernaut (hunt_boss_moves.sql): the stun fails; the card still goes on cooldown.
    if coalesce((v_marks->>'stun_fail')::boolean, false) then
      v_fail := true; v_ctr := v_ctr || 'desync'::text;
      update hunt_combat_state set marks = marks - 'stun_fail', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif 'juggernaut' = any(v_plist) then
      if random() < 0.9 then v_fail := true; v_ctr := v_ctr || 'juggernaut'::text; end if;
    end if;
    if not v_fail then
    update hunt_combat_state set stunned_until = v_round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    end if;
  elsif v_eff = 'cleanse' then
    if hunt_mark_on(v_marks, 'lock_cleanse', v_round) then   -- Hotfix (hunt_boss_moves.sql): the curse stays
      v_ctr := v_ctr || 'hotfix'::text;
    elsif 'plague' = any(v_plist) then                         -- Plague: removes only 10% of a curse
      v_ctr := v_ctr || 'plague'::text;
      update hunt_card_hp set dmg_debuff = dmg_debuff + (1 - dmg_debuff) * 0.1, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
    else
    update hunt_card_hp set dmg_debuff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
    end if;
    if hunt_mark_on(v_marks, 'rot', v_round) then              -- Rot: the cleanse also removes empower and shields
      update hunt_card_hp set dmg_buff = 1, shield = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      v_ctr := v_ctr || 'rot'::text;
    end if;
  elsif v_eff = 'smite' then
    v_sdmg := combat_support_value('smite', v_amt, v_scale, null)::int;
    if coalesce((v_marks->>'mirror')::boolean, false) then   -- Mirror (hunt_boss_moves.sql): the smite hits the smite card
      update hunt_combat_state set marks = marks - 'mirror', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      update hunt_card_hp set hp_remaining = greatest(0, hp_remaining - v_sdmg), downed = hp_remaining - v_sdmg <= 0, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
      v_ctr := v_ctr || 'mirror'::text;
    else
    update hunts set hp_remaining = greatest(0, hp_remaining - v_sdmg),
      status = case when hp_remaining - v_sdmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_sdmg <= 0 then now() else defeated_at end
      where id = p_hunt;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, p_card, v_day, v_sdmg)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
    select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;
    -- The killing Smite: settle once + the same 'defeat' notification as hunt_attack (2026-10-03).
    if v_status = 'defeated' then
      v_settle := settle_hunt(p_hunt);
      insert into hunt_events (hunt_id, kind, payload)
        values (p_hunt, 'defeat', jsonb_build_object(
          'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
          'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                  from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                        group by player_id order by sum(damage) desc limit 3) t)));
    end if;
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
  end if;

  -- The action log (combat_actions.sql, Nathan 2026-10-06): every support play that worked, for the balance data.
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
  values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, v_amt,
    case when v_tgt in ('ally', 'self') then p_target end,
    jsonb_build_object('gained', case when v_eff = 'heal' then v_gain end, 'mirrored', 'mirror' = any(v_ctr), 'countered', to_jsonb(v_ctr),
      'scale', v_scale, 'matched', v_matched, 'aff_count', v_affcount, 'affinity', v_aff, 'cooldown', v_cd,
      'value', case
        when v_eff = 'smite' then v_sdmg
        when v_eff in ('weaken', 'expose') then combat_support_value(v_eff, v_amt, v_scale, null)
        when v_eff = 'empower' then combat_support_value('empower', v_amt, 1, null)
        when v_eff in ('heal', 'shield') then (select combat_support_value(v_eff, v_amt, 1, h.max_hp) from hunt_card_hp h
          where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)
      end,
      'target_after', (select jsonb_build_object('hp', h.hp_remaining, 'max_hp', h.max_hp, 'shield', h.shield, 'dmg_buff', h.dmg_buff, 'downed', h.downed)
        from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)));

  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'affinity', v_aff, 'aff_count', v_affcount, 'matched', v_matched,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated')
    || case when cardinality(v_ctr) > 0 then jsonb_build_object('countered', to_jsonb(v_ctr)) else '{}'::jsonb end;
end $$;

-- lock_hunt_squad (live, adventure_gate.sql): daily_card_cap.
CREATE OR REPLACE FUNCTION "public"."lock_hunt_squad"("p_player" "text", "p_hunt" bigint, "p_cards" bigint[]) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_day date := (now() at time zone 'America/Denver')::date; v_cap int; v_n int; v_used bigint[]; v_gate jsonb;
begin
  if not exists (select 1 from hunts where id = p_hunt and status = 'active') then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  -- The unlock gate (adventure_gate): the starter gifts redeemed + 8 attackers.
  v_gate := adventure_gate(p_player);
  if not (v_gate->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', v_gate); end if;
  v_cap := hunt_card_cap();
  select count(distinct x) into v_n from unnest(coalesce(p_cards, '{}')) x;
  if v_n < 1 or v_n > v_cap or v_n <> cardinality(p_cards) then return jsonb_build_object('ok', false, 'error', 'bad_squad'); end if;
  if exists (select 1 from unnest(p_cards) x where not exists (select 1 from player_cards where player_id = p_player and card_id = x and quantity > 0)) then
    return jsonb_build_object('ok', false, 'error', 'not_owned');
  end if;
  -- At least 1 attacker (Nathan, 2026-10-03): a squad of supports deals no damage, so the member
  -- would fight and get no raid prize. Attackers are the types hunt_attack accepts.
  if not exists (select 1 from unnest(p_cards) x join cards c on c.id = x join subjects s on s.id = c.subject_id
                 where s.type in ('Character', 'Creature')) then
    return jsonb_build_object('ok', false, 'error', 'no_attacker');
  end if;
  select coalesce(array_agg(card_id), '{}') into v_used from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  if exists (select 1 from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) and cardinality(v_used) > 0 then
    return jsonb_build_object('ok', false, 'error', 'squad_fixed', 'squad', (select card_ids from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = v_day));
  end if;
  if not (v_used <@ p_cards) then return jsonb_build_object('ok', false, 'error', 'must_keep_used', 'used', to_jsonb(v_used)); end if;
  insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (p_hunt, p_player, v_day, p_cards)
    on conflict (hunt_id, player_id, hit_date) do update set card_ids = excluded.card_ids, locked_at = now();
  return jsonb_build_object('ok', true, 'squad', to_jsonb(p_cards));
end $$;

-- hunt_commit_card: daily_card_cap.
CREATE OR REPLACE FUNCTION "public"."hunt_commit_card"("p_hunt" bigint, "p_player" "text", "p_card" bigint, "p_day" "date", "p_maxhp" integer) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_cap int;
begin
  if not hunt_squad_allows(p_hunt, p_player, p_day, p_card) then return false; end if; -- hunt_squads.sql
  if exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = p_day) then
    return true;
  end if;
  v_cap := hunt_card_cap();
  if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = p_day) >= v_cap then
    return false;
  end if;
  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
    values (p_hunt, p_player, p_card, p_day, p_maxhp, p_maxhp, false)
    on conflict (hunt_id, player_id, card_id, hit_date) do nothing;
  return true;
end $$;

-- deployable_power: daily_card_cap.
CREATE OR REPLACE FUNCTION "public"."deployable_power"("p_cap" integer DEFAULT NULL::integer) RETURNS bigint
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with cfg as (
    select coalesce(p_cap, hunt_card_cap()) as n
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

-- spawn_hunt: boss HP, ATK, per-boss stats, tier weak / resist / passive counts, the tag band.
CREATE OR REPLACE FUNCTION "public"."spawn_hunt"("p_days" integer DEFAULT 3, "p_tier" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
end $$;

-- play_card_effect: the effect tiers, the per-star values and the cooldown knob (the caps stay in settings: phase 2).
CREATE OR REPLACE FUNCTION "public"."play_card_effect"("p_player" "text", "p_card" bigint, "p_target" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_subject bigint; v_rarity text; v_qty int; v_eff jsonb; v_prim effect_primitives%rowtype;
  v_tiers jsonb; v_caps jsonb; v_power numeric; v_cd numeric;
  v_asc int; v_ascset jsonb; v_scale numeric; v_pts jsonb; v_cmb jsonb;
  v_amount numeric; v_dur int; v_cooldown_h numeric; v_ready timestamptz;
  v_day timestamptz := date_trunc('day', now() at time zone 'America/Denver') at time zone 'America/Denver';
  v_final text := p_target; v_outcome text := 'applied'; v_play bigint;
  v_reflect_id bigint; v_ward_id bigint; v_opts jsonb;
  v_counter_id bigint; v_counter text; v_start timestamptz;
  v_choice int;   -- effects_spread.sql
begin
  if p_player = p_target then return jsonb_build_object('ok', false, 'error', 'self_target'); end if;
  if not exists (select 1 from players where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;

  -- Serialize plays that touch the same members (caps + counters), in a fixed order.
  perform 1 from players where id in (p_player, p_target) order by id for update;

  select pc.quantity, c.subject_id, c.rarity::text, s.effect, coalesce(pc.ascension, 0), pc.stat_points
    into v_qty, v_subject, v_rarity, v_eff, v_asc, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_eff is null or v_eff->>'primitive' is null then
    return jsonb_build_object('ok', false, 'error', 'no_effect');
  end if;

  select * into v_prim from effect_primitives where primitive = v_eff->>'primitive';
  if not found or not v_prim.enabled then
    return jsonb_build_object('ok', false, 'error', 'effect_disabled', 'primitive', v_eff->>'primitive');
  end if;
  -- effects_spread.sql: a poll card (options.polls) needs the sender's pick of one of its questions
  -- (play_card_effect_choice sets it); a missing or wrong index is refused before anything is spent.
  if jsonb_typeof(v_eff->'options'->'polls') = 'array' then
    v_choice := nullif(current_setting('tcg.effect_choice', true), '')::int;
    if v_choice is null or v_choice < 0 or v_choice >= jsonb_array_length(v_eff->'options'->'polls') then
      return jsonb_build_object('ok', false, 'error', 'bad_choice');
    end if;
  end if;

  -- Cooldown (player + subject).
  select ready_at into v_ready from card_effect_cooldowns
   where player_id = p_player and subject_id = v_subject for update;
  if found and v_ready > now() then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_at', v_ready);
  end if;

  -- Caps (0 or missing = off).
  select value into v_caps from settings where key = 'card_effect_caps';
  v_caps := coalesce(v_caps, '{}'::jsonb);
  if coalesce((v_caps->>'send_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
         >= (v_caps->>'send_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'send_cap');
  end if;
  if coalesce((v_caps->>'pair_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and aimed_at = p_target and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
         >= (v_caps->>'pair_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'pair_cap');
  end if;
  if v_prim.kind = 'prank' then
    if coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and kind = 'prank' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
           >= (v_caps->>'prank_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_prank_cap');
    end if;
    if v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and primitive = 'timeout' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
           >= (v_caps->>'timeout_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_timeout_cap');
    end if;
  end if;
  if v_prim.primitive = 'gift_pack' and coalesce((v_caps->>'gift_pack_per_week')::int, 0) > 0
     and ((select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and target_id = p_target and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int
       or (select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and player_id = p_player and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int) then
    return jsonb_build_object('ok', false, 'error', 'gift_pack_cap');
  end if;

  -- Counters on the target, for pranks only, in the fixed order of docs/boons-and-pranks.md
  -- 3C: decoy, ward, reflect, redirect, delay. Depth 1: ONE counter acts on a play, and a
  -- bounced or redirected prank meets no second counter. Found first, used up only after
  -- every refusal check, so a refused play never costs the target a counter.
  if v_prim.kind = 'prank' then
    select id, primitive into v_counter_id, v_counter from player_effects
     where player_id = p_target and consumed_at is null and starts_at <= now()
       and primitive in ('decoy', 'ward', 'reflect', 'redirect', 'delay')
       and (expires_at is null or expires_at > now())
     order by array_position(array['decoy', 'ward', 'reflect', 'redirect', 'delay'], primitive), id limit 1;
    if v_counter = 'decoy' then v_outcome := 'decoyed';          -- a cardboard cutout takes it
    elsif v_counter = 'ward' then v_outcome := 'blocked';
    elsif v_counter = 'reflect' then v_final := p_player; v_outcome := 'reflected';
    elsif v_counter = 'redirect' then                             -- a random other member who plays
      select pl.id into v_final from players pl
       where pl.id not in (p_player, p_target) and exists (select 1 from player_cards pc where pc.player_id = pl.id)
         and not card_effect_active(pl.id, v_prim.primitive)             -- someone it can land on
         and (coalesce((v_caps->>'prank_recv_per_day')::int, 0) = 0
              or (select count(*) from card_plays cp where cp.target_id = pl.id and cp.kind = 'prank' and cp.created_at >= v_day and cp.outcome <> 'refunded')   -- effects_spread.sql
                 < (v_caps->>'prank_recv_per_day')::int)
       order by random() limit 1;
      if v_final is null then v_final := p_target; v_counter_id := null; v_counter := null;  -- nobody else
      else v_outcome := 'redirected'; end if;
    elsif v_counter = 'delay' then v_outcome := 'delayed';        -- it lands 1 hour later
    end if;
    -- The caps count where a prank LANDS. A bounce or a redirect onto a member at their prank
    -- (or timeout) cap fizzles (found by boon-sim.mjs: a victim got 5 pranks + 1 reflected = 6).
    if v_final <> p_target and (
         (coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and kind = 'prank' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
              >= (v_caps->>'prank_recv_per_day')::int)
         or (v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and primitive = 'timeout' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
              >= (v_caps->>'timeout_recv_per_day')::int)) then
      v_outcome := 'blocked';
    end if;
  end if;

  -- No stacking (checked on the member it would land on). Refused plays keep the cooldown.
  if v_outcome not in ('blocked', 'decoyed') and not v_prim.stacks and card_effect_active(v_final, v_prim.primitive) then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'primitive', v_prim.primitive);
  end if;

  update player_effects set consumed_at = now() where id = v_counter_id;
  v_start := now() + case when v_outcome = 'delayed' then interval '1 hour' else interval '0' end;

  -- Tier scaling, then the hard ceilings.
  v_tiers := balance_get('effect_tiers');   -- balance_table.sql
  v_power := coalesce((v_tiers->v_rarity->>'power')::numeric, 1);
  v_cd    := coalesce((v_tiers->v_rarity->>'cd')::numeric, 1);
  -- Ascension (Nathan, 2026-09-27): each star of THIS copy makes the effect stronger
  -- and the cooldown shorter, on top of the tier. The hard limits below still clamp.
  v_ascset := balance_get('effect_ascension');
  v_cmb := card_combat(v_rarity, v_asc, 1, v_pts);
  if (v_cmb->>'on')::boolean then
    -- Stat points on: the Potency and Haste points of THIS copy replace the per-star bonus.
    v_power := v_power * (v_cmb->>'potency')::numeric;
    v_cd    := v_cd * (v_cmb->>'haste')::numeric;
  else
    v_power := v_power * (1 + coalesce((v_ascset->>'power_per_star')::numeric, 0) * v_asc);
    v_cd    := v_cd * greatest((v_ascset->>'cd_floor')::numeric, 1 - coalesce((v_ascset->>'cd_per_star')::numeric, 0) * v_asc);
  end if;
  -- One global knob for how often every card can be played (1 = as written).
  v_scale := (balance_get('effect_cooldown_scale') #>> '{}')::numeric;
  v_cd    := v_cd * coalesce(v_scale, 1);
  v_amount := round((v_eff->'base'->>'amount')::numeric * v_power, 2);
  v_dur    := round((v_eff->'base'->>'duration_s')::numeric * v_power)::int;
  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;
  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;
  v_cooldown_h := coalesce((v_eff->>'cooldown_h')::numeric, 24) * v_cd;

  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind,
                          rarity, amount, duration_s, outcome)
  values (p_player, v_final, p_target, p_card, v_subject, v_prim.primitive, v_prim.kind,
          v_rarity, v_amount, v_dur, v_outcome)
  returning id into v_play;

  insert into card_effect_cooldowns (player_id, subject_id, ready_at)
  values (p_player, v_subject, now() + make_interval(secs => v_cooldown_h * 3600))
  on conflict (player_id, subject_id) do update set ready_at = excluded.ready_at;

  -- What the visuals need: which card, who sent it, and ONE title from the card's list.
  v_opts := coalesce(v_eff->'options', '{}'::jsonb) || jsonb_build_object('card_id', p_card, 'sender_id', p_player);
  -- Charges (launch_event_cards.sql): base.uses = how many hits a Hunt effect lasts (1 if unset);
  -- credit_to = who gets the Raid Crasher credit (a reflected prank: the member who reflected it).
  v_opts := v_opts || jsonb_build_object('uses', greatest(1, coalesce((v_eff->'base'->>'uses')::int, 1)),
    'credit_to', case when v_outcome = 'reflected' then p_target else p_player end);
  if jsonb_typeof(v_eff->'options'->'titles') = 'array' and jsonb_array_length(v_eff->'options'->'titles') > 0 then
    v_opts := v_opts || jsonb_build_object('title',
      v_eff->'options'->'titles'->>(floor(random() * jsonb_array_length(v_eff->'options'->'titles')))::int);
  end if;
  -- effects_spread.sql: the picked poll question and its fixed answers (the bot posts these).
  if v_choice is not null then
    v_opts := (v_opts - 'polls') || jsonb_build_object('choice', v_choice,
      'question', v_eff->'options'->'polls'->v_choice->'question', 'answers', v_eff->'options'->'polls'->v_choice->'answers');
  end if;

  if v_outcome not in ('blocked', 'decoyed') then
    if v_prim.primitive = 'gift_pack' then
      perform grant_packs(v_final, greatest(1, v_amount::int), 'boon', p_player);
    elsif v_prim.primitive = 'cleanse' then
      update player_effects set consumed_at = now()
       where player_id = v_final and consumed_at is null
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      -- A Discord prank that has not run yet (a voice prank waiting for voice) is skipped;
      -- an active one is undone by the bot at its next tick.
      update discord_effects set status = 'skipped', error = 'cleansed', updated_at = now()
       where target_id = v_final and status = 'pending'
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      update discord_effects set revert_at = now(), updated_at = now()
       where target_id = v_final and status = 'active'
         and primitive in (select primitive from effect_primitives where kind = 'prank');
    elsif v_prim.channel = 'app' then
      insert into player_effects (player_id, primitive, amount, duration_s, options, source_play_id, starts_at, expires_at)
      values (v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_play, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    else
      insert into discord_effects (play_id, target_id, primitive, amount, duration_s, options, execute_after, revert_at)
      values (v_play, v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'play_id', v_play, 'outcome', v_outcome, 'target', v_final,
    'primitive', v_prim.primitive, 'kind', v_prim.kind, 'rarity', v_rarity, 'ascension', v_asc,
    'amount', v_amount, 'duration_s', v_dur, 'ready_at', now() + make_interval(secs => v_cooldown_h * 3600));
end $$;

-- my_collection_power: set_bonus.
CREATE OR REPLACE FUNCTION "public"."my_collection_power"("p_player_id" "text") RETURNS bigint
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select c.subject_id,
           sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)) base_cp,
           count(*) ov
    from player_cards pc
    join cards c    on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.player_id = p_player_id and pc.quantity >= 1
    group by c.subject_id
  )
  select coalesce(sum(case when ps.ov = st.tv then round(ps.base_cp * (balance_get('set_bonus') #>> '{}')::numeric) else ps.base_cp end), 0)::bigint
  from ps join subj_totals st on st.subject_id = ps.subject_id;
$$;

-- top_collection_power: set_bonus.
CREATE OR REPLACE FUNCTION "public"."top_collection_power"("p_limit" integer DEFAULT 20) RETURNS TABLE("player_id" "text", "username" "text", "power" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select pc.player_id, c.subject_id,
           sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)) base_cp,
           count(*) ov
    from player_cards pc
    join cards c    on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.quantity >= 1
    group by pc.player_id, c.subject_id
  ),
  totals as (
    select ps.player_id,
           sum(case when ps.ov = st.tv then round(ps.base_cp * (balance_get('set_bonus') #>> '{}')::numeric) else ps.base_cp end)::bigint cp
    from ps join subj_totals st on st.subject_id = ps.subject_id
    group by ps.player_id
  )
  select t.player_id, p.username, t.cp
  from totals t join players p on p.id = t.player_id
  order by t.cp desc
  limit greatest(1, least(100, coalesce(p_limit, 20)));
$$;

-- dungeon_attack: the miss chance (combat_miss, as the Hunt).
CREATE OR REPLACE FUNCTION "public"."dungeon_attack"("p_player" "text", "p_card" bigint, "p_target" integer DEFAULT NULL::integer, "p_mode" "text" DEFAULT 'daily'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; f jsonb; v_t int; v_tags text[];
  v_ab jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; sq jsonb; wk jsonb; v_crit numeric; hit jsonb; v_dmg int := 0; v_heal int := 0;
  v_round int; v_pl text[]; ek text; kill jsonb := null; v_cmb jsonb; v_boost numeric := 0; et jsonb := null; v_maxhp int; v_guard int := 0; v_end jsonb := null;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
  if info is null then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if info->>'type' not in ('Character', 'Creature') then return jsonb_build_object('ok', false, 'error', 'not_attacker'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'downed'); end if;
  v_round := (st->>'round')::int;
  if v_round >= coalesce((cfg->>'round_cap')::int, 40) then
    perform dungeon_settle(r.id, 'fell', false); return jsonb_build_object('ok', false, 'error', 'round_cap'); end if;
  if (c->>'cd')::int >= v_round + 1 and exists (
      select 1 from jsonb_each(st->'cards') e join cards cc on cc.id = e.key::bigint join subjects s on s.id = cc.subject_id
      where e.key <> p_card::text and not (e.value->>'down')::boolean and (e.value->>'cd')::int < v_round + 1 and s.type in ('Character', 'Creature')) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target then 0 else 1 end), e.ord limit 1;
  f := st->'foes'->v_t;
  v_tags := dungeon_txt(info->'tags'); v_pl := dungeon_txt(f->'passives');
  v_ab := info->'ability'; v_cmb := info->'cmb'; v_maxhp := (c->>'max')::int;
  v_aeff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' else null end;
  v_aamt := coalesce((v_ab->>'amount')::numeric, 0); v_athresh := coalesce((v_ab->>'threshold')::numeric, 0);
  sq := combat_squad(v_tags, true,
    (select coalesce(jsonb_agg(coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)), '[]'::jsonb) from unnest(r.squad) x
       join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where x <> p_card), f->'weak');
  wk := combat_weak(f->'weak', f->'resist', info->>'type', info->>'rarity', info->>'season', v_tags, (sq->>'stack')::int);
  v_crit := combat_crit_chance((wk->>'wm')::int > 0, v_aeff, v_aamt, v_cmb);
  hit := combat_hit((v_cmb->>'cp')::int, (wk->>'mult')::numeric, (c->>'buff')::numeric, (c->>'debuff')::numeric, (sq->>'synmult')::numeric,
    v_crit, combat_miss('shrouded' = any(v_pl)), v_aeff, v_aamt, v_athresh,
    'armored' = any(v_pl) and 'trait:melee' = any(v_tags),
    case when (f->>'exu')::int >= v_round and (f->>'ex')::numeric > 0 then (f->>'ex')::numeric else 0 end,
    (f->>'hp')::bigint, (f->>'max')::bigint);
  v_dmg := (hit->>'dmg')::int;
  if v_dmg > 0 then
    select rule->>'boost_tag', coalesce((rule->>'boost')::numeric, 0) into ek, v_boost from dungeon_days where day = r.day and r.mode = 'daily';
    v_dmg := greatest(1, round(v_dmg * (st->>'buff')::numeric * (1 + case when ek is not null and ek = any(v_tags) then v_boost else 0 end)))::int;
    -- A monster's guard (Stone Skin, Shield Up ...) absorbs first.
    v_guard := least(coalesce((f->>'sh')::int, 0), v_dmg);
    f := f || jsonb_build_object('sh', coalesce((f->>'sh')::int, 0) - v_guard);
    v_dmg := v_dmg - v_guard;
  end if;
  f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_dmg));
  st := jsonb_set(st, array['foes', v_t::text], f);
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);
    st := jsonb_set(st, array['cards', p_card::text, 'hp'], to_jsonb(least(v_maxhp, (c->>'hp')::int + v_heal)));
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'buff'], '1');
  if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  if st->>'phase' = 'fight' then
    et := dungeon_enemy_turn(st, p_card, v_t, v_dmg); st := et->'state';
    -- The squad falls when no ATTACKER stands (support cards alone cannot attack: the run was stuck).
    if not exists (select 1 from jsonb_each(st->'cards') where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false)) then st := st || '{"phase": "fell"}'; end if;
  end if;
  update dungeon_runs set state = st, turns = turns + 1 where id = r.id;
  if st->>'phase' = 'fell' then v_end := dungeon_settle(r.id, 'fell', false);
  elsif st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'attack', 'card', p_card, 'target', v_t),
    jsonb_build_object('dmg', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'double', hit->'double', 'heal', v_heal, 'enemy', et->'actions', 'kill', kill));
  return jsonb_build_object('ok', true, 'damage', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'crit', hit->'crit', 'double', hit->'double',
    'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'heal', v_heal, 'target', v_t,
    'kill', kill is not null, 'loot', case when kill is null then null else jsonb_build_object('shards', kill->'shards', 'card', kill->'card') end,
    'enemy', coalesce(et->'actions', '[]'::jsonb), 'burned', coalesce(et->'burned', '0'), 'poison', coalesce(et->'poison', '[]'::jsonb),
    'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $$;

-- dungeon_support: support.matched_x (as the Hunt).
CREATE OR REPLACE FUNCTION "public"."dungeon_support"("p_player" "text", "p_card" bigint, "p_target_card" bigint DEFAULT NULL::bigint, "p_target_foe" integer DEFAULT NULL::integer, "p_mode" "text" DEFAULT 'daily'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; v_ab jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text; v_aff text;
  v_round int; v_affc int := 0; v_scale numeric; v_matched boolean := false; tc jsonb; tinfo jsonb; f jsonb; v_t int; v_val numeric; k text; kill jsonb := null; v_end jsonb := null;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
  v_ab := info->'ability';
  if v_ab is null or v_ab->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  v_round := (st->>'round')::int;
  if coalesce((st->>'sup_round')::int, -1) = v_round then return jsonb_build_object('ok', false, 'error', 'one_support'); end if;
  if v_round < (c->>'cd')::int then return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', (c->>'cd')::int, 'round', v_round); end if;
  v_eff := v_ab->>'effect';
  v_amt := coalesce((v_ab->>'amount')::numeric, 0) * coalesce((info->'cmb'->>'potency')::numeric, 1);
  v_dur := coalesce((v_ab->>'duration')::int, 1); v_cd := coalesce((v_ab->>'cooldown')::int, 1);
  v_tgt := coalesce(v_ab->>'target', 'boss'); v_aff := v_ab->>'affinity';
  if v_aff is not null then
    select count(*) into v_affc from unnest(r.squad) x join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affc);
  if v_tgt in ('ally', 'self') then
    if p_target_card is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    tc := st->'cards'->p_target_card::text;
    if tc is null then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    tinfo := dungeon_run_card(r, p_target_card);
    v_matched := v_aff is not null and v_aff = any(dungeon_txt(tinfo->'tags'));
    if v_matched then v_amt := v_amt * balance_num('support', 'matched_x'); end if;
    if v_eff = 'empower' then tc := tc || jsonb_build_object('buff', combat_support_value('empower', v_amt, 1, null));
    elsif v_eff = 'shield' then tc := tc || jsonb_build_object('shield', (tc->>'shield')::int + combat_support_value('shield', v_amt, 1, (tc->>'max')::int)::int);
    elsif v_eff = 'heal' then
      if (tc->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'target_downed'); end if;
      tc := tc || jsonb_build_object('hp', least((tc->>'max')::int, (tc->>'hp')::int + combat_support_value('heal', v_amt, 1, (tc->>'max')::int)::int));
    else return jsonb_build_object('ok', false, 'error', 'bad_ally_effect'); end if;
    st := jsonb_set(st, array['cards', p_target_card::text], tc);
  elsif v_eff = 'cleanse' then
    for k in select jsonb_object_keys(st->'cards') loop st := jsonb_set(st, array['cards', k], (st->'cards'->k) || '{"debuff": 1, "psn": 0, "psnu": -1}'); end loop;
  else
    select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
      where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target_foe then 0 else 1 end), e.ord limit 1;
    f := st->'foes'->v_t;
    if v_eff = 'weaken' then f := f || jsonb_build_object('wk', combat_support_value('weaken', v_amt, v_scale, null), 'wku', v_round + v_dur);
    elsif v_eff = 'expose' then f := f || jsonb_build_object('ex', combat_support_value('expose', v_amt, v_scale, null), 'exu', v_round + v_dur);
    elsif v_eff = 'stun' then
      if combat_stun_immune((f->>'st')::int, v_round) then return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', (f->>'st')::int + 2); end if;
      f := f || jsonb_build_object('st', v_round + 1);
    elsif v_eff = 'smite' then
      v_val := combat_support_value('smite', v_amt, v_scale, null);
      f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_val::int));
    else return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff); end if;
    st := jsonb_set(st, array['foes', v_t::text], f);
    if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + v_cd));
  st := st || jsonb_build_object('sup_round', v_round);
  update dungeon_runs set state = st where id = r.id;
  if st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'support', 'card', p_card, 'target_card', p_target_card, 'target_foe', v_t),
    jsonb_build_object('effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'kill', kill));
  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'aff_count', v_affc,
    'ready_round', v_round + v_cd, 'kill', kill is not null, 'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $$;

-- dungeon_enemy_turn: Enrage and Curse (boss_moves, as the Hunt).
CREATE OR REPLACE FUNCTION "public"."dungeon_enemy_turn"("p_state" "jsonb", "p_attacker" bigint, "p_attacked" integer, "p_dmg" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare st jsonb := p_state; v_round int := (p_state->>'round')::int + 1; i int; f jsonb; act jsonb; v_lost numeric; v_bmult numeric;
  v_tgt text; c jsonb; v_d int; ab jsonb; k text; raw int; v_out jsonb := '[]'; v_heal int; v_pl text[]; v_burn int; v_area jsonb; v_ticks jsonb := '[]'; p int;
begin
  st := st || jsonb_build_object('round', v_round);
  -- Poison: each poisoned card loses its poison damage this round.
  for k in select key from jsonb_each(st->'cards') where not (value->>'down')::boolean and coalesce((value->>'psnu')::int, -1) >= v_round order by key loop
    c := st->'cards'->k; p := coalesce((c->>'psn')::int, 0);
    c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - p)); c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
    st := jsonb_set(st, array['cards', k], c);
    v_ticks := v_ticks || jsonb_build_object('card', k::bigint, 'dmg', p);
  end loop;
  for i in 0..jsonb_array_length(st->'foes') - 1 loop
    f := st->'foes'->i;
    continue when (f->>'hp')::int <= 0;
    v_pl := dungeon_txt(f->'passives');
    v_lost := 1 - (f->>'hp')::numeric / greatest(1, (f->>'max')::int);
    v_bmult := combat_enemy_mult((f->>'enr')::numeric, (f->>'enru')::int, (f->>'wk')::numeric, (f->>'wku')::int, v_round,
                                 'volatile' = any(v_pl), v_lost, 'frenzied' = any(v_pl));
    act := combat_pool_act((f->>'atk')::numeric, v_bmult, v_round, (f->>'st')::int, v_lost, (f->>'max')::int, f->'moves', coalesce((f->>'charge')::boolean, false));
    v_tgt := case when not coalesce((st->'cards'->p_attacker::text->>'down')::boolean, true) then p_attacker::text
                  else (select key from jsonb_each(st->'cards') where not (value->>'down')::boolean order by key limit 1) end;
    exit when v_tgt is null;   -- the squad is down
    v_area := '[]';
    if (act->>'dmg')::int > 0 then
      c := st->'cards'->v_tgt;
      ab := combat_absorb((c->>'shield')::int, (act->>'dmg')::int);
      v_d := (ab->>'dmg')::int;
      c := c || jsonb_build_object('shield', (ab->>'shield')::int, 'hp', greatest(0, (c->>'hp')::int - v_d));
      c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
      if act->>'action' = 'stun' then c := c || jsonb_build_object('cd', greatest((c->>'cd')::int, v_round + 1)); end if;
      if (act->>'dot')::int > 0 then c := c || jsonb_build_object('psn', (act->>'dot')::int, 'psnu', v_round + 3); end if;
      st := jsonb_set(st, array['cards', v_tgt], c);
    end if;
    if (act->>'area')::numeric > 0 then
      for k in select key from jsonb_each(st->'cards') where key <> v_tgt and not (value->>'down')::boolean order by key loop
        c := st->'cards'->k;
        raw := combat_area_roll((f->>'atk')::numeric, (act->>'area')::numeric, v_bmult);
        ab := combat_absorb((c->>'shield')::int, raw);
        c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - (ab->>'dmg')::int), 'shield', (ab->>'shield')::int);
        c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
        st := jsonb_set(st, array['cards', k], c);
        v_area := v_area || jsonb_build_object('card', k::bigint, 'dmg', (ab->>'dmg')::int);
      end loop;
    end if;
    if act->>'action' = 'enrage' then f := f || jsonb_build_object('enr', balance_num('boss_moves', 'enrage_x'), 'enru', v_round + balance_num('boss_moves', 'enrage_rounds')::int);
    elsif act->>'action' = 'curse' then st := jsonb_set(st, array['cards', v_tgt, 'debuff'], to_jsonb(balance_num('boss_moves', 'curse_x')));
    elsif act->>'action' = 'guard' then f := f || jsonb_build_object('sh', coalesce((f->>'sh')::int, 0) + (act->>'guard')::int);
    end if;
    v_heal := (act->>'heal')::int;
    if 'regenerating' = any(v_pl) and act->>'action' <> 'stunned' then v_heal := v_heal + greatest(1, round((f->>'max')::int * balance_num('boss_passives', 'regenerating_heal_foe')))::int; end if;
    if v_heal > 0 then f := f || jsonb_build_object('hp', least((f->>'max')::int, (f->>'hp')::int + v_heal)); end if;
    st := jsonb_set(st, array['foes', i::text], f);
    v_out := v_out || jsonb_build_object('foe', i, 'action', act->>'action', 'move', act->>'move', 'card', v_tgt::bigint, 'dmg', coalesce(v_d, 0),
      'hits', (act->>'hits')::int, 'area', v_area, 'heal', v_heal, 'guard', (act->>'guard')::int, 'dot', (act->>'dot')::int);
    v_d := null;
  end loop;
  f := st->'foes'->p_attacked;
  if f is not null and (f->>'hp')::int > 0 and not coalesce((st->'cards'->p_attacker::text->>'down')::boolean, true) then
    v_pl := dungeon_txt(f->'passives');
    c := st->'cards'->p_attacker::text;
    if 'thorns' = any(v_pl) and p_dmg > 0 then c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - combat_thorns(p_dmg))); end if;
    if 'flaming' = any(v_pl) then
      v_burn := combat_burn((f->>'atk')::numeric);
      if v_burn > 0 then
        ab := combat_absorb((c->>'shield')::int, v_burn);
        c := c || jsonb_build_object('shield', (ab->>'shield')::int, 'hp', greatest(0, (c->>'hp')::int - (ab->>'dmg')::int));
      end if;
    end if;
    c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
    st := jsonb_set(st, array['cards', p_attacker::text], c);
  end if;
  return jsonb_build_object('state', st, 'actions', v_out, 'burned', coalesce(v_burn, 0), 'poison', v_ticks);
end $$;

-- combat_pool_act: pool_moves (the Dungeon monster moves).
CREATE OR REPLACE FUNCTION "public"."combat_pool_act"("p_atk" numeric, "p_bmult" numeric, "p_round" integer, "p_stun_until" integer, "p_lost" numeric, "p_max" integer, "p_pool" "jsonb", "p_charge" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_total numeric; v_r numeric; m jsonb; v_kind text := 'strike'; v_name text := 'Strike'; v_dmg int := 0; v_area numeric := 0;
  v_heal int := 0; v_hits int := 1; v_dot int := 0; v_guard int := 0;
  roll numeric := (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span'));
  m2 jsonb := public.balance_get('pool_moves'); v_cyc int := (m2->>'cycle')::int;   -- balance_table.sql
begin
  if p_stun_until >= p_round then return jsonb_build_object('action', 'stunned', 'move', 'Stunned', 'dmg', 0, 'area', 0, 'heal', 0, 'hits', 0, 'dot', 0, 'guard', 0); end if;
  if p_charge and p_round % v_cyc = v_cyc - 1 then return jsonb_build_object('action', 'charging', 'move', 'Charging', 'dmg', 0, 'area', 0, 'heal', 0, 'hits', 0, 'dot', 0, 'guard', 0); end if;
  if p_charge and p_round % v_cyc = 0 then
    return jsonb_build_object('action', 'cataclysm', 'move', 'Cataclysm', 'dmg', greatest(1, round(p_atk * (m2->>'cataclysm_x')::numeric * roll * p_bmult)), 'area', (m2->>'cataclysm_area')::numeric, 'heal', 0, 'hits', 1, 'dot', 0, 'guard', 0);
  end if;
  select sum(coalesce((e->>'w')::numeric, 1)) into v_total from jsonb_array_elements(coalesce(p_pool, '[]')) e;
  if coalesce(v_total, 0) > 0 then
    v_r := random() * v_total;
    for m in select e from jsonb_array_elements(p_pool) e loop
      v_r := v_r - coalesce((m->>'w')::numeric, 1);
      if v_r <= 0 then v_kind := m->>'kind'; v_name := m->>'name'; exit; end if;
    end loop;
  end if;
  case v_kind
    when 'heavy' then v_dmg := greatest(1, round(p_atk * (m2->>'heavy_x')::numeric * roll * p_bmult));
    when 'flurry' then v_dmg := 2 * greatest(1, round(p_atk * (m2->>'flurry_x')::numeric * roll * p_bmult)); v_hits := 2;
    when 'slam' then v_dmg := greatest(1, round(p_atk * (m2->>'slam_x')::numeric * roll * p_bmult)); v_area := (m2->>'slam_x')::numeric;
    when 'drain' then v_dmg := greatest(1, round(p_atk * (m2->>'drain_x')::numeric * roll * p_bmult)); v_heal := greatest(1, round(p_max * (m2->>'drain_heal')::numeric));
    when 'stun' then v_dmg := greatest(1, round(p_atk * (m2->>'stun_x')::numeric * roll * p_bmult));
    when 'poison' then v_dmg := greatest(1, round(p_atk * (m2->>'poison_x')::numeric * roll * p_bmult)); v_dot := greatest(1, round(p_atk * (m2->>'poison_dot')::numeric * p_bmult));
    when 'regenerate' then v_heal := greatest(1, round(p_max * (case when p_lost >= public.balance_num('boss_moves', 'rage_at') then (m2->>'regenerate_heal_rage')::numeric else (m2->>'regenerate_heal')::numeric end))); v_hits := 0;
    when 'guard' then v_guard := greatest(1, round(p_max * (m2->>'guard')::numeric)); v_hits := 0;
    when 'enrage' then v_hits := 0;
    when 'curse' then v_hits := 0;
    else v_kind := 'strike'; v_dmg := greatest(1, round(p_atk * roll * p_bmult));
  end case;
  return jsonb_build_object('action', v_kind, 'move', v_name, 'dmg', v_dmg, 'area', v_area, 'heal', v_heal, 'hits', v_hits, 'dot', v_dot, 'guard', v_guard);
end $$;

-- 6. The new functions are for the service role only (lockdown_grants.sql re-applies this too).
revoke execute on function public.balance_who(), public.balance_leaves(jsonb), public.balance_check(), public.balance_log_write(),
  public.balance_get(text), public.balance_num(text, text[]), public.card_cp_exact(text, integer, numeric), public.hunt_card_cap(),
  public.combat_miss(boolean), public.card_powers(text), public.collection_power_all()
  from public, anon, authenticated;
grant execute on function public.balance_who(), public.balance_leaves(jsonb), public.balance_get(text), public.balance_num(text, text[]),
  public.card_cp_exact(text, integer, numeric), public.hunt_card_cap(), public.combat_miss(boolean), public.card_powers(text),
  public.collection_power_all() to service_role;

notify pgrst, 'reload schema';
