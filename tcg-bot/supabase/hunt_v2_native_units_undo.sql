-- hunt_v2_native_units_undo.sql (2026-11-06): the undo of hunt_v2_native_units.sql (HUNT-V2-NATIVE). It puts back the origin/main text of
-- spawn_hunt, hunt_v2_start, hunt_v2_live_credit, hunt_attack, hunt_support, balance_check_combat_v2.
-- A Hunt spawned in v2 units keeps its stats.unit mark. After the undo it gets the v1 scale hp_max / private max again (about 1, because
-- its hp_max is the v2 max), and the v1 fight is open for it again. Use the undo between Hunts. Undo hunt_ach_damage_v2.sql first.
-- Idempotent. GUARD as the forward file.

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.spawn_hunt(integer, text)', '01612d444d1426c3dc4c4b8aea6408d4', '947f0c7c05be5f21a86b99210d4dc49d'),
    ('public.hunt_v2_start(text, bigint[])', '398e21c9c00dd9eddfbdf539969cf676', '697a15815650016e31aada64dd7c76b0'),
    ('public.hunt_v2_live_credit(bigint, text, date, jsonb)', '2e2f2b28bf7309ed1053610593128c40', '4ffdae766232988ab62fa3c8e4a63910'),
    ('public.hunt_attack(text, bigint, bigint)', '7f71eebe29b73b15f7c46d2b7a44c4b0', 'a06988245cde70262687cda817b5ad81'),
    ('public.hunt_support(text, bigint, bigint, bigint)', 'e3f4fa9d381f6e8779e6151830a3c2ae', '8ac711106f43f78bfaf11246d2b5768d'),
    ('public.balance_check_combat_v2()', 'b8cbfbaee3f3d1e4ed3874fec3323407', '79229ab288c19b7ada3b676b44da59fd')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'hunt_v2_native_units_undo.sql: the live % changed since this file was built. Write a new undo from the live text.', f.fn;
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
declare r public.hunt_v2_days; c jsonb; s jsonb; v_max numeric; v_hpmax numeric; fx jsonb; u jsonb;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;
  v_max := (r.state->'fight'->'enemies'->0->>'max')::numeric;
  v_hpmax := (select hp_max from public.hunts where id = p_hunt);
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
  c := hunt_v2_boon_plan(p_log, to_jsonb(r.squad), v_hpmax / v_max, fx, coalesce(balance_num('combat', 'effect_cap_pct'), 100));
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

create or replace function public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare
  v_rcap int;
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_set text; v_type text; v_mod numeric; v_cardname text;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint; v_hpmax bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
  v_feed text; v_settle jsonb; v_milestone boolean;
  v_total bigint; v_used int; v_topcard text; v_topdmg bigint; v_cap int;
  v_bossact text; v_slam jsonb; v_round int; v_targets jsonb;
  v_ability jsonb; v_aeff text; v_heal int;
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
  v_skey text; v_fight jsonb; v_eng jsonb; v_facts jsonb; v_others jsonb := '[]'::jsonb; v_x text; i int; v_e jsonb; v_free boolean; v_hiton jsonb;   -- f3_engine_hunt.sql: the fight state, the engine answer
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive, coalesce(hp_share, hp_max), stats, hp_remaining, name
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive, v_share, v_stats, v_hp, v_bname
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  -- R3-ON (combat_v2_on_hunt.sql): the Hunt is combat v2 for everyone with the flag ON; a live v2 day of today keeps v1 off (also after a rollback)
  if combat_v2_on('hunt') then return jsonb_build_object('ok', false, 'error', 'v2_on'); end if;   -- R3-ON
  if exists (select 1 from hunt_v2_days d where d.hunt_id = p_hunt and d.player_id = p_player and d.day = (now() at time zone 'America/Denver')::date and d.live) then   -- R3-ON
    return jsonb_build_object('ok', false, 'error', 'v2_today'); end if;   -- R3-ON
  v_pk := v_passive->>'kind';
  -- Every passive the boss has (passive.list; an older hunt has only passive.kind).
  select coalesce(array_agg(x->>'kind'), array[v_pk]) into v_plist
    from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;
  v_plist := array_remove(v_plist, null);

  -- f3_engine_hunt.sql: also the subject key and hit_on (the hit triggers that have a step: the card's attack kind, the enabled squad rows), so the
  -- engine skips a trigger with no step (in this statement: no new query)
  select pc.quantity, pc.ascension, c.rarity::text, c.set_id, s.type, s.cp_mod, c.name, s.ability, s.tag_slugs, pc.stat_points, s.key,
         (select coalesce(jsonb_agg(distinct st2->>'on'), '[]'::jsonb) from ability_kinds a cross join jsonb_array_elements(a.steps) st2
           where ((a.key = s.ability->>'effect' and s.ability->>'kind' = 'attack' and a.slot = 'attack') or (a.slot = 'squad' and a.enabled))
             and st2->>'on' in ('before_hit', 'on_hit', 'after_attack'))
    into v_qty, v_asc, v_rarity, v_set, v_type, v_mod, v_cardname, v_ability, v_tags, v_pts, v_skey, v_hiton
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
  -- F-3 4d (f3_engine_hunt.sql): the fight state from the rows read above and ONE statement over the committed cards (hunt_fight_state_info, with the
  -- combat state row). The checks below and the boss state of this member read it (in place of three old queries over the same rows: the same values),
  -- and its squad facts give the tags of the other committed cards for the squad synergy (combat_core.sql: combat_squad).
  v_fight := hunt_fight_state_info(p_hunt, p_player, v_day,
    jsonb_build_object('hp', v_hp, 'max', v_hpmax, 'status', v_status, 'tier', v_tier, 'passives', to_jsonb(v_plist)), null,
    p_card, jsonb_build_object('ability', v_ability, 'tags', coalesce(to_jsonb(v_tags), '[]'::jsonb), 'subject', v_skey, 'type', v_type, 'hit_on', v_hiton), null);
  v_facts := v_fight->'facts'->'cards';
  -- A stunned card waits while another attacker can act or the squad can still bring a card (the old checks, on the rows of the fight state).
  v_stunned_card := case when v_fight->'cards' ? p_card::text then coalesce((v_fight->'cards'->p_card::text->>'cd')::int, 0) >= v_round + 1 end;
  if coalesce(v_stunned_card, false) then
    v_free := jsonb_array_length(v_fight->'squad') < v_cap;
    for i in 0 .. jsonb_array_length(v_fight->'squad') - 1 loop
      exit when v_free;
      v_x := v_fight->'squad'->>i;
      v_free := v_x <> p_card::text and not (v_fight->'cards'->v_x->>'down')::boolean and coalesce((v_fight->'cards'->v_x->>'cd')::int, 0) < v_round + 1
                and coalesce(v_facts->v_x->>'type' in ('Character', 'Creature'), false);
    end loop;
    if v_free then
      return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
    end if;
  end if;
  -- Mend (a boon): the first hurt card that attacks heals the waiting amount first
  -- (after the downed / stunned checks, so a refused attack keeps the boon).
  if v_cardhp < v_maxhp then
    v_mend := take_player_effect(p_player, 'mend');
    if v_mend is not null then v_cardhp := least(v_maxhp, v_cardhp + greatest(1, round(v_mend))::int); end if;
  end if;
  -- the boss state of this member (hunt_combat_state, in the fight state)
  v_e := v_fight->'enemies'->0;
  v_enrage := (v_e->>'enr')::numeric; v_enr_until := (v_e->>'enru')::int; v_weaken := (v_e->>'wk')::numeric; v_wk_until := (v_e->>'wku')::int;
  v_expose := (v_e->>'ex')::numeric; v_exp_until := (v_e->>'exu')::int; v_stun_until := (v_e->>'st')::int; v_marks := v_fight->'marks';

  v_aeff := case when v_ability->>'kind' = 'attack' then v_ability->>'effect' else null end;   -- the answer key 'ability'

  for i in 0 .. jsonb_array_length(v_fight->'squad') - 1 loop
    v_x := v_fight->'squad'->>i;
    if v_x <> p_card::text then v_others := v_others || jsonb_build_array(v_facts->v_x->'tags'); end if;
  end loop;
  v_sq := combat_squad(v_tags, v_fight->'cards' ? p_card::text, v_others, v_weak);
  v_stack := (v_sq->>'stack')::int;
  v_wk := combat_weak(v_weak, v_resist, v_type, v_rarity, v_set, v_tags, v_stack);
  v_wm := (v_wk->>'wm')::int; v_rm := (v_wk->>'rm')::int; v_wmult := (v_wk->>'mult')::numeric;
  v_bonus := v_wm > 0;
  v_elem := v_sq->>'elem'; v_syn := (v_sq->>'syn')::int; v_synmult := (v_sq->>'synmult')::numeric;

  -- before_hit: the hit mods of the engine (focus, pierce, execute, rampage as data; no random()) in place of the effect names
  v_eng := combat_effect(v_fight, p_card, 'before_hit', '{"target_foe": 0}'::jsonb);
  v_critchance := combat_crit_chance_mods(v_bonus, v_eng->'mods', v_cmb);
  v_hit := combat_hit_core(v_cp, v_wmult, v_buff, v_debuff, v_synmult, v_critchance,
    combat_miss('shrouded' = any(v_plist)),                                          -- shrouded: more misses
    'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end,   -- Veil (hunt_boss_moves.sql)
    v_eng->'mods');
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
  -- on_hit (lifesteal as data; cap: lifesteal cannot out-heal the boss): only when the hit dealt damage and the card has an on_hit step (hit_on). The
  -- card as it stands now (Mend included; a first attack has no row yet).
  if v_dmg > 0 and v_hiton ? 'on_hit' then
    v_eng := combat_effect(v_fight || jsonb_build_object('cards', v_fight->'cards' || jsonb_build_object(p_card::text,
        coalesce(v_fight->'cards'->(p_card::text), '{"down": false, "shield": 0, "buff": 1, "debuff": 1, "cd": 0}'::jsonb)
        || jsonb_build_object('hp', v_cardhp, 'max', v_maxhp))),
      p_card, 'on_hit', jsonb_build_object('dealt', v_dmg, 'target_foe', 0));
    if v_eng->'log'->>'heal' is not null then
      v_heal := (v_eng->'log'->>'heal')::int;
      v_cardhp := (v_eng->'changes'->0->'set'->>'hp')::int;
    end if;
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
  -- after_attack: a buff until next_attack (empower) ends with this attack
  v_eng := combat_effect(v_fight, p_card, 'after_attack', '{}'::jsonb);
  v_buff := coalesce((v_eng->'changes'->0->'set'->>'buff')::numeric, v_buff);

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
end $fn$;

create or replace function public.hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare
  v_rcap int; v_sdown boolean;
  v_status text; v_closes timestamptz; v_tier text; v_hp bigint;
  v_qty int; v_type text; v_ability jsonb; v_eff text; v_amt numeric; v_cd int; v_tgt text;
  v_day date; v_round int; v_cd_until int; v_maxhp int;
  v_srar text; v_sasc int; v_smod numeric; v_spts jsonb; v_scmb jsonb;
  v_aff text; v_affcount int := 0; v_matched boolean := false;
  v_settle jsonb; v_ctr text[] := '{}';
  v_hpmax bigint; v_passive jsonb; v_pl jsonb; v_fight jsonb; v_eng jsonb; v_l jsonb; v_ch jsonb; i int;   -- f3_engine_hunt.sql: the boss row, the fight state, the engine answer
begin
  select status, closes_at, tier, hp_remaining, hp_max, passive into v_status, v_closes, v_tier, v_hp, v_hpmax, v_passive from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  -- R3-ON (combat_v2_on_hunt.sql): the Hunt is combat v2 for everyone with the flag ON; a live v2 day of today keeps v1 off (also after a rollback)
  if combat_v2_on('hunt') then return jsonb_build_object('ok', false, 'error', 'v2_on'); end if;   -- R3-ON
  if exists (select 1 from hunt_v2_days d where d.hunt_id = p_hunt and d.player_id = p_player and d.day = (now() at time zone 'America/Denver')::date and d.live) then   -- R3-ON
    return jsonb_build_object('ok', false, 'error', 'v2_today'); end if;   -- R3-ON

  select pc.quantity, s.type, s.ability, c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points
    into v_qty, v_type, v_ability, v_srar, v_sasc, v_smod, v_spts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_ability is null or v_ability->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;

  v_eff := v_ability->>'effect';
  -- Potency points of this support copy make its effect stronger (1 with the flag off): the engine reads them from the fight state.
  v_scmb := card_combat(v_srar, v_sasc, v_smod, v_spts);
  -- F-3: Haste points shorten the cooldown (combat_cooldown: never below 1 round).
  v_cd  := combat_cooldown(coalesce((v_ability->>'cooldown')::int, 1), (v_scmb->>'haste')::numeric);
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

  -- F-3 4d (f3_engine_hunt.sql): the effect engine (ability_kinds, docs/f3-effect-engine.md 2.5-2.6) in place of the effect branches and the counters.
  -- The fight state comes from the rows read above (the locked boss row, the passives, this support copy) and ONE statement over the committed cards
  -- (hunt_fight_state_info). The engine keeps the Hunt rules: Packet Loss first, the affinity count over the committed cards, the ally target committed
  -- with full HP (after Packet Loss; over the daily cap it gets no row), every counter passive and mark, the refusals in the old order.
  select coalesce(jsonb_agg(x->>'kind'), '[]'::jsonb) into v_pl from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;   -- passive.list (as before)
  v_fight := hunt_fight_state_info(p_hunt, p_player, v_day,
    jsonb_build_object('hp', v_hp, 'max', v_hpmax, 'status', v_status, 'tier', v_tier, 'passives', v_pl), null,
    p_card, jsonb_build_object('ability', v_ability, 'potency', v_scmb->'potency', 'haste', v_scmb->'haste'),
    case when v_tgt in ('ally', 'self') then p_target end);
  v_eng := combat_effect(v_fight, p_card, 'use', jsonb_build_object('target_card', p_target));
  if not (v_eng->>'ok')::boolean then return v_eng; end if;
  v_l := v_eng->'log';
  -- The boss HP is a change of the shared hunts row, which this call holds FOR UPDATE: it is written as a delta (dhp) to the locked row.
  v_ch := v_eng->'changes';
  for i in 0 .. jsonb_array_length(v_ch) - 1 loop
    if v_ch->i->>'op' = 'enemy' and v_ch->i->'set' ? 'hp' then
      v_ch := jsonb_set(v_ch, array[i::text, 'set'], ((v_ch->i->'set') - 'hp')
        || jsonb_build_object('dhp', (v_ch->i->'set'->>'hp')::bigint - (v_fight->'enemies'->0->>'hp')::bigint));
    end if;
  end loop;
  perform hunt_effect_apply(p_hunt, p_player, v_day, v_ch);
  if coalesce((v_eng->>'nullified')::boolean, false) then   -- Packet Loss (1) / Shadow Ban (2): this play does nothing
    update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
      values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, (v_l->>'amount')::numeric, case when v_tgt in ('ally', 'self') then p_target end,
              jsonb_build_object('nullified', true, 'countered', v_l->'countered'));
    return jsonb_build_object('ok', true, 'effect', v_eff, 'nullified', true, 'countered', v_l->'countered',
      'ready_round', v_round + v_cd, 'round', v_round, 'boss_hp', (select hp_remaining from hunts where id = p_hunt), 'defeated', false);
  end if;
  v_amt := (v_l->>'amount')::numeric; v_matched := (v_l->>'matched')::boolean; v_affcount := (v_l->>'aff_count')::int;
  v_ctr := array(select jsonb_array_elements_text(v_l->'countered'));
  -- The killing Smite: settle once + the same 'defeat' notification as hunt_attack (2026-10-03).
  if coalesce((v_l->>'kill')::boolean, false) then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  -- The action log (combat_actions.sql, Nathan 2026-10-06): every support play that worked, for the balance data. The values come from the engine log.
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
  values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, v_amt,
    case when v_tgt in ('ally', 'self') then p_target end,
    jsonb_build_object('gained', v_l->'gained', 'mirrored', 'mirror' = any(v_ctr), 'countered', v_l->'countered',
      'scale', v_l->'scale', 'matched', v_l->'matched', 'aff_count', v_l->'aff_count', 'affinity', v_l->'affinity', 'cooldown', v_cd,
      'value', v_l->'value',
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
end $fn$;

create or replace function public.balance_check_combat_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare spec jsonb := balance_v2_spec(new.key); errs text[]; v jsonb := new.value; r text; i int;
begin
  if spec is null then
    if new.key like 'v2\_%' then raise exception 'balance %: a combat v2 key needs a shape in balance_v2_spec (a fixed shape for every v2 key)', new.key; end if;
    return new;
  end if;
  errs := balance_shape_errors(v, spec, '');
  if cardinality(errs) = 0 then
    if new.key = 'v2_asc' then
      -- ASC-3: the curve goes from 0 (0 stars) to 1 (5 stars) and never falls; the 0-star base is never above the 5-star top; every card rarity has a
      -- base or an alias (promo = normal, event = full_art).
      if (v->'curve'->>0)::numeric <> 0 or (v->'curve'->>5)::numeric <> 1 then errs := errs || 'curve must start at 0 and end at 1'::text; end if;
      for i in 1..5 loop
        if (v->'curve'->>i)::numeric < (v->'curve'->>(i - 1))::numeric then errs := errs || format('curve.%s is below curve.%s', i, i - 1); end if;
      end loop;
      for r in select x from jsonb_object_keys(v->'base') x loop
        if (v->'base'->>r)::numeric > (v->'top'->>r)::numeric then errs := errs || format('base.%s is above top.%s', r, r); end if;
      end loop;
      select string_agg(e::text, ', ') into r from unnest(enum_range(null::card_rarity)) e
       where not (v->'base' ? e::text) and not (v->'alias' ? e::text);
      if r is not null then errs := errs || format('no base and no alias for the rarity %s', r); end if;
    elsif new.key = 'v2_enemy' then
      -- The boss move chances add up to 1 (the simulator picks one move with one random number over these shares).
      if abs((select sum((v->'boss_moves'->>m)::numeric) from unnest(array['strike', 'slam', 'drain', 'stun', 'enrage', 'curse', 'regenerate']) m) - 1) > 0.001 then
        errs := errs || 'boss_moves: strike + slam + drain + stun + enrage + curse + regenerate must add up to 1'::text;
      end if;
    elsif new.key = 'v2_synergy' then
      -- SYN: the steps of a count never go down: element small_at <= big_at; each set small_at <= big_at <= top_at
      if (v->'element'->>'small_at')::int > (v->'element'->>'big_at')::int then errs := errs || 'element: small_at must not be above big_at'::text; end if;
      for r in select x from jsonb_object_keys(v->'sets') x loop
        if (v->'sets'->r->>'small_at')::int > (v->'sets'->r->>'big_at')::int or (v->'sets'->r->>'big_at')::int > (v->'sets'->r->>'top_at')::int then
          errs := errs || format('sets.%s: small_at <= big_at <= top_at is needed', r);
        end if;
      end loop;
    end if;
  end if;
  if cardinality(errs) > 0 then raise exception 'balance %: %', new.key, array_to_string(errs, '; '); end if;
  return new;
end $fn$;

notify pgrst, 'reload schema';
