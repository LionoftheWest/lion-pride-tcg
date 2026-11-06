-- hunt_v2_native_units.sql (2026-11-06): item HUNT-V2-NATIVE, the shared Hunt boss in combat v2 units.
-- Nathan 2026-11-06: "Yeah it should only be v2 going forward" and "everything should still be simple math/calculations".
-- Before: spawn_hunt made the shared boss on the v1 scale (balance boss_hp, for example Heroic 80000). Each member fights a private v2
--   copy (max = combat_v2_hunt_boss, for example 36244 for the Heroic Warlord) that starts at the shared fraction, and
--   hunt_v2_live_credit multiplied each private HP decrease by hunts.hp_max / private max (x 2.21) before hunt_hits and the shared HP.
-- After this file, for a Hunt that spawns with combat_v2.hunt ON (and a v2 boss for its name):
--   hunts.hp_max = hp_remaining = round(combat_v2_hunt_boss(tier, key).max). The community needs the same v2 damage as before
--   (v1 pool x v2 max / v1 max = v2 max). stats.unit = 'v2' marks the row; stats.v1_hp = the v1 tier size (balance boss_hp).
--   hunt_v2_start gives the private copy hp = hunts.hp_remaining and max = hunts.hp_max (no rounding gap at the kill).
--   hunt_v2_live_credit credits 1:1 (scale 1): the damage in hunt_hits = the private decrease (x the boons, as before).
--   ach_track_values (heavy, bighit) counts a v2-unit Hunt's damage x v1_hp / hp_max: the achievement tiers keep their meaning.
-- Unchanged: a Hunt with no stats.unit (the live Hunt 148564 and every older Hunt) keeps the v1 conversion until it ends. Flag OFF:
--   spawn_hunt and the credit run exactly as before. No new number: every number comes from the balance keys v2_enemy, enemy_v2, boss_hp.
-- Idempotent. Server only. GUARD: each replaced function must be its origin/main text or the text that this file made.
-- Undo: hunt_v2_native_units_undo.sql. Test: card-studio/scripts/test-hunt-v2-native-units.mjs (rolled back; MUTATE=all).

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.spawn_hunt(integer, text)', '01612d444d1426c3dc4c4b8aea6408d4', '75d5ef2446c270acda5c86feccb98824'),
    ('public.hunt_v2_start(text, bigint[])', '398e21c9c00dd9eddfbdf539969cf676', '697a15815650016e31aada64dd7c76b0'),
    ('public.hunt_v2_live_credit(bigint, text, date, jsonb)', '2e2f2b28bf7309ed1053610593128c40', '4ffdae766232988ab62fa3c8e4a63910'),
    ('public.ach_track_values(text)', '14927afaf886b134383f4c72ec987925', '7985127ab7cedfd11189cb7b95042eca')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'hunt_v2_native_units.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

create or replace function public.spawn_hunt(p_days integer DEFAULT 3, p_tier text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare
  v_players int; v_tier text; v_nweak int; v_nresist int; v_tiermult numeric;
  v_weak jsonb; v_resist jsonb; v_hp bigint; v_name text; v_id bigint; v_pow bigint;
  v_pool text[]; v_recent text[]; v_fresh text[]; v_weaktags text[]; v_resisttags text[];
  v_passive jsonb; v_pk text; v_plist jsonb; v_hunters int;
  v_cfg jsonb; v_atk int;
  v_key text; v_v1hp bigint; v_unit text := 'v1';   -- HUNT-V2-NATIVE
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
  -- HUNT-V2-NATIVE (Nathan 2026-11-06: "it should only be v2 going forward"): with combat_v2.hunt ON the shared boss is made in v2 units.
  -- hp_max = the max of the v2 boss (combat_v2_hunt_boss: balance v2_enemy.hunt.<tier>.hp x v2_enemy.asc3_hp_x x enemy_v2.bosses.<key>.hp_factor),
  -- the community pool of before in v2 damage (v1 pool x v2 max / v1 max). stats.unit = 'v2' marks the row (credit 1:1); stats.v1_hp keeps the
  -- v1 tier size (balance boss_hp), the scale of the lifetime achievement values (ach_track_values). Flag OFF or no v2 boss: v1 units as before.
  v_v1hp := v_hp;
  if combat_v2_on('hunt') then
    v_key := hunt_v2_boss_key(v_name);
    if v_key is not null then v_hp := round((combat_v2_hunt_boss(v_tier, v_key)->>'max')::numeric)::bigint; v_unit := 'v2'; end if;
  end if;
  -- Boss stats: the tier ATK (balance boss_atk) x this boss's own multiplier
  -- (balance boss_stats, by name, for example {"The Smurf Brute": {"atk_mult": 1.2}}).
  v_atk := round(balance_num('boss_atk', v_tier)
                 * coalesce((balance_get('boss_stats')->v_name->>'atk_mult')::numeric, 1));
  -- The boss heals are sized to HP / crew (boss-sim.mjs: heals sized to the FULL HP make
  -- every heal worth several squad battles).
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
    values (v_name, v_tier, v_weak, v_resist, v_passive, v_hp, v_hp, now() + make_interval(days => p_days),
            -- the heal share: a fixed size (hunt_hp.heal_share), not HP / crew, so more HP does not mean more healing
            coalesce((v_cfg->>'heal_share')::bigint, greatest(1, round(v_v1hp::numeric / v_hunters))),
            jsonb_build_object('atk', v_atk) || case when v_unit = 'v2' then jsonb_build_object('unit', 'v2', 'v1_hp', v_v1hp) else '{}'::jsonb end)
    returning id into v_id;
  return v_id;
end $fn$;

create or replace function public.hunt_v2_start(p_player text, p_cards bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare
  v_day date := hunt_v2_today(); v_live boolean := combat_v2_on('hunt'); v_practice boolean := false; h public.hunts; v_key text; b jsonb; bu jsonb;
  v_cap int; act numeric; v_frac numeric; boss jsonb; v_st text; v_cl timestamptz;
  pool jsonb := '[]'; v_ids bigint[]; bad bigint[] := '{}'; x bigint; rr record; u jsonb;
  v_units jsonb := '{}'; v_info jsonb := '{}'; cards jsonb := '{}'; s jsonb; r jsonb; sh jsonb;
begin
  -- who: everyone with the flag ON; with it OFF the testers (R3)
  if not v_live and not combat_v2_on('hunt', p_player) then return jsonb_build_object('ok', false, 'error', 'not_tester'); end if;
  perform hunt_v2_abandon(p_player, v_day);
  -- the live Hunt, read with NO lock
  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1;
  if not found then
    -- a TESTER with no active Hunt practises against the newest ended Hunt (live frac 1, no shared write)
    if v_live or not combat_v2_on('hunt', p_player) then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
    select * into h from public.hunts order by opens_at desc limit 1;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
    v_practice := true;
  end if;
  v_key := hunt_v2_boss_key(h.name);
  if v_key is null then return jsonb_build_object('ok', false, 'error', 'no_v2_boss', 'name', h.name); end if;
  if exists (select 1 from public.hunt_v2_days d where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day) then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;
  if v_live then
    -- the lock order of a live start (r3 L-1): FIRST the boss row FOR KEY SHARE (no write lock: it never waits on a v2 shared write),
    -- the status and the close time again under it; THEN the player's row (two starts of one player serialize)
    select status, closes_at into v_st, v_cl from public.hunts where id = h.id for key share;
    if v_st <> 'active' or now() >= v_cl then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
    perform 1 from public.players where id = p_player for update;
    -- INV-ON-3: a member who played the v1 Hunt today (hunt_card_hp rows of today, no v2 day) plays v1 today
    if exists (select 1 from public.hunt_card_hp hc where hc.hunt_id = h.id and hc.player_id = p_player and hc.hit_date = v_day) then
      return jsonb_build_object('ok', false, 'error', 'v1_today');
    end if;
  end if;
  b := combat_v2_enemy_numbers();
  bu := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']);
  v_cap := hunt_card_cap();
  act := (b->'v2_speed'->>'act_at')::numeric;
  if act is null then raise exception 'hunt_v2_start: no balance value for v2_speed.act_at'; end if;
  v_frac := case when v_practice then 1 else h.hp_remaining::numeric / h.hp_max end;
  boss := combat_v2_hunt_boss(h.tier, v_key, jsonb_build_object('start_frac', v_frac, 'meter', round((random() * act)::numeric, 2)), b);
  -- HUNT-V2-NATIVE: a Hunt in v2 units (stats.unit) gives the private copy the shared numbers, so a private decrease is the shared decrease
  if not v_practice and h.stats->>'unit' = 'v2' then boss := boss || jsonb_build_object('hp', h.hp_remaining::numeric, 'max', h.hp_max::numeric); end if;
  if p_cards is null then
    -- the auto-pick (r3 L-5, r4 L-4): the unit stats of dungeon_v2_unit (the live level and points, as the fight) and the fight speed,
    -- one bundle for every call; a card with no usable ability_v2 is left out
    for rr in select pc.card_id, s0.ability_v2 as a
                from public.player_cards pc join public.cards c on c.id = pc.card_id join public.subjects s0 on s0.id = c.subject_id
               where pc.player_id = p_player and pc.quantity > 0 order by pc.card_id loop
      continue when jsonb_typeof(rr.a) is distinct from 'object' or jsonb_typeof(rr.a->'role') is distinct from 'string'
        or jsonb_typeof(rr.a->'blocks') is distinct from 'array' or not exists (select 1 from public.roles y where y.key = rr.a->>'role');
      u := dungeon_v2_unit(p_player, rr.card_id, bu);
      pool := pool || jsonb_build_array(jsonb_build_object('id', rr.card_id, 'role', u->>'role', 'class', u->>'class', 'atk', u->'atk',
        'crt', u->'crt', 'crd', u->'crd', 'spd', combat_v2_speed(u, 0, b), 'blocks', u->'active'->'blocks', 'pick_factor', rr.a->'pick_factor'));
    end loop;
    if jsonb_array_length(pool) = 0 then return jsonb_build_object('ok', false, 'error', 'squad_size', 'cap', v_cap); end if;
    v_ids := array(select (z #>> '{}')::bigint from jsonb_array_elements(combat_v2_autopick(pool,
               jsonb_build_object('mechanics', coalesce(boss->'mechanics', '[]'::jsonb), 'weak_role', boss->'weak_role'), v_cap, b, null)->'ids') z);
  else
    if coalesce(cardinality(p_cards), 0) = 0 or cardinality(p_cards) > v_cap or array_position(p_cards, null) is not null
       or (select count(distinct y) from unnest(p_cards) y) <> cardinality(p_cards) then
      return jsonb_build_object('ok', false, 'error', 'squad_size', 'cap', v_cap);
    end if;
    foreach x in array p_cards loop
      if not exists (select 1 from public.player_cards pc where pc.player_id = p_player and pc.card_id = x and pc.quantity > 0) then
        return jsonb_build_object('ok', false, 'error', 'not_owned', 'card', x);
      end if;
    end loop;
    v_ids := p_cards;
  end if;
  foreach x in array v_ids loop
    begin
      u := dungeon_v2_unit(p_player, x, bu);
      v_units := v_units || jsonb_build_object(x::text, u);
      v_info := v_info || jsonb_build_object(x::text, dungeon_v2_info(x));
    exception when no_data_found then
      bad := bad || x;
    end;
  end loop;
  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'no_v2', 'cards', to_jsonb(bad)); end if;
  foreach x in array v_ids loop
    cards := cards || jsonb_build_object(x::text, (v_units->(x::text)) || jsonb_build_object('meter', round((random() * act)::numeric, 2)));
  end loop;
  s := jsonb_build_object('v', '2'::jsonb, 'mode', 'hunt', 'round', 0, 'clock', 0, 'squad', to_jsonb(v_ids), 'cards', cards, 'enemies', jsonb_build_array(boss),
    'marks', '{}'::jsonb, 'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
  s := combat_v2_synergy(s, b);
  r := combat_v2_step(s, null, b);
  begin
    insert into public.hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp, live)
    values (h.id, p_player, v_day, v_key, v_ids,
            jsonb_build_object('engine', '2'::jsonb, 'tier', h.tier, 'squad', to_jsonb(v_ids), 'units', v_units, 'info', v_info, 'fight', r->'state')
              || case when v_practice then jsonb_build_object('practice_ended', true) else '{}'::jsonb end,
            (boss->>'hp')::numeric, v_live);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already');
  end;
  if v_live then
    -- the bridge rows: one downed hunt_card_hp row per squad card (the v1 readers count the day; every v1 path refuses these cards)
    insert into public.hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
      select h.id, p_player, z, v_day, round((v_units->(z::text)->>'max')::numeric)::int, round((v_units->(z::text)->>'max')::numeric)::int, true
        from unnest(v_ids) z
      on conflict (hunt_id, player_id, card_id, hit_date) do update set downed = true, updated_at = now();
  end if;
  perform hunt_v2_save(h.id, p_player, v_day, r->'state', r->>'event', jsonb_build_object('kind', 'start', 'event', r->'event', 'won', r->'won', 'log', r->'log'));
  -- HO2b: the start step runs like an act: a boss HP decrease is credited (the shared write)
  sh := hunt_v2_live_credit(h.id, p_player, v_day, r->'log');
  return hunt_v2_out(h.id, p_player, v_day, jsonb_build_object('event', r->'event', 'won', r->'won', 'actor', r->'actor', 'steps_left', r->'steps_left',
    'played', 0, 'log', coalesce(r->'log', '[]'::jsonb), 'hp_changes', dungeon_v2_hp(s, r->'state'), 'credit', sh));
end $fn$;

create or replace function public.hunt_v2_live_credit(p_hunt bigint, p_player text, p_day date, p_log jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare r public.hunt_v2_days; c jsonb; s jsonb; v_max numeric; v_hpmax numeric; v_unit text; fx jsonb; u jsonb;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;
  v_max := (r.state->'fight'->'enemies'->0->>'max')::numeric;
  -- HUNT-V2-NATIVE: a Hunt in v2 units (stats.unit = 'v2') credits 1:1; a Hunt in v1 units keeps the scale hp_max / private max
  select hp_max, stats->>'unit' into v_hpmax, v_unit from public.hunts where id = p_hunt;
  -- HBP: the waiting Hunt boons and pranks of the member, oldest first, locked BEFORE the boss lock with SKIP LOCKED (a call never waits on an
  -- effect row). A prankster with no players row or a card with no cards row is passed as missing, so the plan uses the fallback (review F-6).
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'primitive', e.primitive, 'amount', coalesce(e.amount, 0), 'created_at', e.created_at,
           'options', e.options
             - case when exists (select 1 from public.players p where p.id = coalesce(e.options->>'credit_to', e.options->>'sender_id')) then '{}'::text[] else array['credit_to', 'sender_id'] end
             - case when coalesce(e.options->>'card_id', '') ~ '^[0-9]{1,18}$' and exists (select 1 from public.cards k where k.id = (e.options->>'card_id')::bigint) then '{}'::text[] else array['card_id'] end)
           order by e.created_at, e.id), '[]'::jsonb) into fx
    from (select pe.* from public.player_effects pe
           where pe.player_id = p_player and pe.primitive in ('rally', 'butterfingers', 'launch_party', 'raid_crasher') and pe.consumed_at is null
             and (pe.starts_at is null or pe.starts_at <= now()) and (pe.expires_at is null or pe.expires_at > now())
           order by pe.created_at, pe.id for update skip locked) e;
  c := hunt_v2_boon_plan(p_log, to_jsonb(r.squad), case when v_unit = 'v2' then 1 else v_hpmax / v_max end, fx, coalesce(balance_num('combat', 'effect_cap_pct'), 100));
  -- a fallback extra goes to the member (the plan does not know the member)
  c := jsonb_set(c, '{extras}', (select coalesce(jsonb_agg(case when z->>'player' is null then z || jsonb_build_object('player', p_player) else z end), '[]'::jsonb)
                                   from jsonb_array_elements(c->'extras') z));
  s := hunt_v2_shared(p_hunt, p_player, p_day, c);
  if coalesce((s->>'over')::boolean, false) then
    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = coalesce(ended_at, now())
     where hunt_id = p_hunt and player_id = p_player and day = p_day and (status = 'active' or ended_by is distinct from 'hunt_over');
  end if;
  -- HBP: the uses, only in the transaction that wrote their credit (a closed Hunt, no credit: the boons wait)
  if coalesce((s->>'written')::boolean, false) then
    for u in select z from jsonb_array_elements(c->'uses') z loop
      if (u->>'left')::int <= 0 then
        update public.player_effects set consumed_at = now() where id = (u->>'id')::bigint;
      else
        update public.player_effects set options = options || jsonb_build_object('uses', (u->>'left')::int) where id = (u->>'id')::bigint;
      end if;
    end loop;
  end if;
  return s || jsonb_build_object('cards', c->'cards', 'boons', case when coalesce((s->>'written')::boolean, false) then c->'boons' else null end,
    'extras', case when coalesce((s->>'written')::boolean, false) then c->'extras' else '[]'::jsonb end);
end $fn$;

create or replace function public.ach_track_values(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $fn$
declare v jsonb := '{}'::jsonb; n bigint; dv jsonb := coalesce(shard_cfg()->'dupe_values', '{}'::jsonb);
begin
  -- Collection (draw-pool cards only: Event cards do not count)
  -- ach_has_element once per different subject (perf_five_slow_calls.sql): it depends only on the subject's tags.
  with o as materialized (
    select c.rarity, c.subject_id from player_cards pc join cards c on c.id = pc.card_id
     where pc.player_id = p_player and pc.quantity > 0 and c.id in (select id from draw_pool)),
  e as materialized (select s.id, ach_has_element(s.tags) el from subjects s where s.id in (select o.subject_id from o))
  select jsonb_build_object(
           'collector', count(*),
           'shine', count(*) filter (where o.rarity in ('illustrated_rare', 'secret_rare', 'full_art', 'gold')),
           'elementalist', count(*) filter (where e.el))
    into v
    from o left join e on e.id = o.subject_id;
  select count(*) into n from (
    select c.subject_id from cards c left join player_cards pc on pc.card_id = c.id and pc.player_id = p_player and pc.quantity > 0
     where c.id in (select id from draw_pool) group by c.subject_id having count(*) >= 2 and count(pc.card_id) = count(*)) x;
  v := v || jsonb_build_object('fullsets', n);
  -- The 3-argument stat_pt with balance stat_points.max_per_stat read once (perf_five_slow_calls.sql), not once per card and stat.
  v := v || (select jsonb_build_object(
      'ascension', coalesce(sum(pc.ascension), 0),
      'trainer', coalesce(sum(stat_pt(pc.stat_points, 'attack', m.mx) + stat_pt(pc.stat_points, 'vitality', m.mx) + stat_pt(pc.stat_points, 'precision', m.mx)
                              + stat_pt(pc.stat_points, 'potency', m.mx) + stat_pt(pc.stat_points, 'haste', m.mx)), 0))
    from player_cards pc cross join lateral (select (select balance_num('stat_points', 'max_per_stat')::int) mx) m
   where pc.player_id = p_player and pc.quantity > 0);
  -- Packs
  v := v || jsonb_build_object('packs', (select count(*) from pack_ledger where player_id = p_player and reason = 'opened'));
  v := v || jsonb_build_object('generous',
      (select coalesce(sum(-amount), 0) from pack_ledger where player_id = p_player and reason = 'gift_sent')
    + (select count(*) from gift_claims where from_id = p_player and kind = 'card' and reason = 'member_gift'));
  -- Market
  -- The trade ledger (offers + auctions), as tradesDone in server.js.
  v := v || jsonb_build_object('trader', (select count(*) from card_trades where from_id = p_player or to_id = p_player));
  v := v || jsonb_build_object('market',
      (select count(*) from trade_offers where status = 'accepted' and listing_id is not null and (from_id = p_player or to_id = p_player))
    + (select count(*) from auctions where status = 'sold' and seller_id = p_player)
    + (select count(*) from auction_bids where status = 'won' and bidder_id = p_player));
  v := v || jsonb_build_object('wish', (select count(*) from wish_grants where giver_id = p_player));
  -- Shards (earned: not admin or event gifts, not the Shop, not the achievement Shards themselves)
  v := v || jsonb_build_object('shards', (select coalesce(sum(amount), 0) from shard_ledger
      where player_id = p_player and amount > 0 and reason not in ('admin', 'event', 'milestone', 'shop')));
  v := v || jsonb_build_object('shopper', (select count(*) from shop_purchases where player_id = p_player));
  -- A 'dupes' row holds the Shards; the copies = Shards / the rarity's value per copy.
  v := v || jsonb_build_object('recycler', (select coalesce(sum(round(l.amount::numeric / nullif((dv->>c.rarity::text)::numeric, 0))), 0)
      from shard_ledger l join cards c on c.id::text = l.ref_id
     where l.player_id = p_player and l.reason = 'dupes' and l.ref_kind = 'card'));
  -- Dailies
  v := v || jsonb_build_object('grind',
      -- every claim except the plain chat daily (before pack_ledger_strict.sql: daily_claims + the chat bonus flags)
      (select count(*) from daily_claims where player_id = p_player and task <> 'chat'));
  v := v || jsonb_build_object('streak', (select coalesce(max(run_len), 0) from (
      select count(*) run_len from (select day, day - (row_number() over (order by day))::int g
                                from (select distinct day from daily_claims where player_id = p_player and task = 'checkin') d) x
       group by g) y));
  v := v || jsonb_build_object('voice', (select count(*) from (
      select day from daily_claims where player_id = p_player and task = 'voice'
      union select day from daily_claims where player_id = p_player and task = 'chat_bonus') d));
  -- Raid
  -- Joined = own committed cards (hunt_card_hp), as huntsJoined in server.js: a Raid Crasher credit
  -- row in hunt_hits is raid damage only (trade_ledger_raid_credit.sql). Damage stays on hunt_hits.
  -- HUNT-V2-NATIVE: the tiers are in v1 points. A Hunt in v2 units counts its damage x stats.v1_hp / hp_max (the share of the pool x the v1 pool,
  -- the same value as the v1-unit credit of before), so no tier changes meaning. A v1-unit Hunt: x 1.
  v := v || (select jsonb_build_object('heavy', coalesce(round(sum(x.damage * f.k)), 0), 'bighit', coalesce(round(max(x.damage * f.k)), 0))
               from hunt_hits x cross join lateral (select case when h.stats->>'unit' = 'v2' then (h.stats->>'v1_hp')::numeric / h.hp_max else 1 end as k
                                                      from hunts h where h.id = x.hunt_id) f
              where x.player_id = p_player);
  v := v || jsonb_build_object('raider', (select count(distinct hunt_id) from hunt_card_hp where player_id = p_player));
  v := v || jsonb_build_object('slayer', (select count(*) from hunts h where h.status = 'defeated'
      and exists (select 1 from hunt_card_hp x where x.hunt_id = h.id and x.player_id = p_player)));
  -- The prize order of settle_hunt: total damage, then the first hit.
  v := v || jsonb_build_object('podium', (select count(*) from (
      select x.player_id, sum(x.damage) dmg, row_number() over (partition by x.hunt_id order by sum(x.damage) desc, min(x.id)) rk
        from hunt_hits x join hunts h on h.id = x.hunt_id and h.settled_at is not null
       group by x.hunt_id, x.player_id) r where r.player_id = p_player and r.rk <= 3 and r.dmg > 0));
  -- Social
  v := v || (select jsonb_build_object('prankster', count(*) filter (where kind = 'prank'), 'vibes', count(*) filter (where kind = 'boon'))
               from card_plays where player_id = p_player);
  return v;
end $fn$;

notify pgrst, 'reload schema';
