-- f3_engine_hunt.sql (2026-10-16): F-3 PR 4d, the Hunt plays through the effect engine (docs/f3-effect-engine.md section 3, row "4d").
-- Before: hunt_support typed each support effect by its name (heal, shield, empower, weaken, expose, stun, smite, cleanse) with the Hunt counters
-- (4 counter passives, the boss marks) in its code; hunt_attack, combat_hit, combat_crit_chance and hunt_card_crits typed the attack effects (focus,
-- pierce, execute, rampage, lifesteal). The Dungeon and the Gauntlet already play through the engine (f3_engine_dungeon.sql, PR 4c).
-- After this file:
--   hunt_support: combat_effect (trigger use) + hunt_effect_apply in place of the effect branches and the counters.
--   hunt_attack: combat_effect before_hit (the hit mods) -> combat_crit_chance_mods + combat_hit_core; on_hit (lifesteal) and after_attack (the empower
--     ends) through the engine.
--   combat_hit (14 args) and combat_crit_chance (4 args): the same signatures (old tests call them); the hit mods come from the engine (hunt_hit_mods) and
--     the work from combat_hit_core / combat_crit_chance_mods (no effect name). No fight function calls them after this file.
--   hunt_card_crits: the crit chance of each attacker with the crit_add mod of the engine (combat_crit_chance_mods).
--   hunt_fight_state_info (new): the Hunt fight state (2.8) from the rows the caller already read (the locked boss row, the passives, the acting card, the
--     combat state row) and ONE statement over the committed cards (hunt_card_hp, one primary key lookup into cards and subjects for each row). It also
--     gives hunt_attack its card checks, the boss state of the member and the tags of the other cards for the squad synergy (combat_squad), in place of
--     old queries over the same rows. hunt_fight_state (the 4b signature) calls it. hunt_attack reads hit_on of its card (the hit triggers with a step) in
--     its card select, so the engine skips a trigger with no step (the 4c rule).
--   hunt_effect_apply: an index loop over the changes; a change of the boss HP can be a delta (dhp) of the locked hunts row.
-- The Hunt rules stay: the ally target committed first with full HP (after Packet Loss; a target over the daily cap gets no row), the shared boss row
-- locked FOR UPDATE and its HP written as a delta under the lock, support damage credited to hunt_hits, settle_hunt on a kill, every counter passive and
-- mark (Mirror, Undying, Spiral, Desync / Juggernaut, Hotfix / Plague / Rot, Packet Loss, Bloodrot, block_* / half_*), the refusals in the old order. The
-- boons that touch the hit (rally, butterfingers, mend, launch_party, raid_crasher) are not changed (a later PR, 4g).
-- NO CHANGE IN PLAY: combat-golden.mjs (BASE = live, CANDIDATE = this file), test-boss-counters-golden.mjs and test-effect-shadow.mjs (the old Hunt text
-- in test-effect-shadow.base.sql against the public functions after this file) show the same fights. Needs f3_effect_engine.sql and
-- f3_engine_dungeon.sql first. Idempotent.

-- GUARD (the combat_core.sql rule): each function that this file replaces must be the live text this file was built from (or the text this file made).
do $g$
declare r record; m text;
begin
  for r in select * from (values
      ('hunt_support(text, bigint, bigint, bigint)', array['558ae31f748d04cbb4f9ad6533e61edc', 'a43dd44ac4cdf5a4286bde1a5da3febc']),
      ('hunt_attack(text, bigint, bigint)', array['d378bd47d31633c2a0ba4b1e905d895b', 'ae6228037f627e2413b9693f22e345c7']),
      ('combat_hit(integer, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, boolean, numeric, bigint, bigint)', array['f020462408f217e25a0446d1449aaaea', '706ee32ac3eca129ecebc718c26dc4e2']),
      ('combat_crit_chance(boolean, text, numeric, jsonb)', array['3943bf85ef544d157b419144279abfcb', 'ecf443321194c7e27e39a97feeb69218']),
      ('hunt_card_crits(text, bigint)', array['445046bcbee8ea2c4df26651217112b4', 'bbf26e2f54f8800360f6607887b3e101']),
      ('hunt_fight_state(bigint, text, date, bigint, bigint)', array['da247886c1002012d24c5a8e5ae504cb', '76e656dfde1f58068ec6b107b9ffbfef']),
      ('hunt_effect_apply(bigint, text, date, jsonb)', array['e5032b9430d7fb32bcb1529e1c9a47ef', '26dae354070ad8abcacb301a6634ce07'])
    ) t(sig, ok) loop
    select md5(replace(pg_get_functiondef(('public.' || r.sig)::regprocedure), chr(13), '')) into strict m;
    if not (m = any(r.ok)) then
      raise exception 'f3_engine_hunt.sql: the live % changed since this file was built (md5 %). Rebuild it from the live text.', r.sig, m;
    end if;
  end loop;
  if to_regprocedure('public.combat_effect(jsonb, bigint, text, jsonb)') is null then raise exception 'f3_engine_hunt.sql: needs f3_effect_engine.sql first'; end if;
  if to_regprocedure('public.dungeon_fight_state_info(dungeon_runs, jsonb, bigint, jsonb, bigint, jsonb)') is null then raise exception 'f3_engine_hunt.sql: needs f3_engine_dungeon.sql first'; end if;
end $g$;
-- GUARD-END

-- ============================================================ 1. the Hunt fight state from the rows that the mode already read
-- hunt_fight_state_info(hunt, member, day, boss, combat state, actor, actor facts, target): the fight state of 2.8 (the 4b shape).
--   p_boss: {hp, max, status, tier, passives} of the hunts row the caller holds (NULL: read here, as in 4b).
--   p_afacts: the facts of the acting card that the caller read: {ability, potency, haste} of a support copy, or {ability, tags, subject, type} of an
--     attacker (NULL: read here, as in 4b). They go over the squad facts of the card.
--   p_cs: the hunt_combat_state row of the member and day as jsonb (to_jsonb of the row) when the caller read it (NULL: read here).
--   plan_cache_mode = force_generic_plan: every query here is a key lookup, so each one is planned once in a session (a fresh session planned the state
--   statement again for its first calls: hunt_attack 1.12 x the old time, 0.98 with one plan; fight-timing.mjs).
--   ONE statement gives the committed cards and their facts (hunt_card_hp by its key, one primary key lookup into cards and subjects for each row). The
--   ally target: its tags from the squad facts and one ownership lookup when it has a row; else one lookup with the commit facts of 4b (hunt_commit_card).
create or replace function public.hunt_fight_state_info(p_hunt bigint, p_player text, p_day date, p_boss jsonb, p_cs jsonb, p_actor bigint, p_afacts jsonb, p_target bigint)
returns jsonb language plpgsql stable set search_path = public set plan_cache_mode = force_generic_plan as $$
declare v_b jsonb := p_boss; v_cs jsonb := p_cs; v_cards jsonb; v_squad jsonb; v_n int; v_facts jsonb; v_a text := p_actor::text;
  v_ts text := p_target::text; v_af jsonb := p_afacts; v_t jsonb;
begin
  if v_b is null then
    select jsonb_build_object('hp', h.hp_remaining, 'max', h.hp_max, 'status', h.status, 'tier', h.tier,
             'passives', (select coalesce(jsonb_agg(e->>'kind'), '[]'::jsonb) from jsonb_array_elements(coalesce(h.passive->'list', '[]'::jsonb)) e))
      into v_b from public.hunts h where h.id = p_hunt;
    if v_b is null then return null; end if;
  end if;
  -- the acting card when the caller did not read it (4b): its ability, tags, subject, type (and the potency and haste of a support copy)
  if p_actor is not null and v_af is null then
    select jsonb_build_object('tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type, 'ability', s.ability)
           || case when s.ability->>'kind' = 'support' then (select jsonb_build_object('potency', m->'potency', 'haste', m->'haste')
                 from (select public.card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) m) mm) else '{}'::jsonb end
      into v_af
      from public.cards c join public.subjects s on s.id = c.subject_id
      left join public.player_cards pc on pc.player_id = p_player and pc.card_id = c.id
     where c.id = p_actor;
  end if;
  if v_cs is null then
    select to_jsonb(cs) into v_cs from public.hunt_combat_state cs where cs.hunt_id = p_hunt and cs.player_id = p_player and cs.hit_date = p_day;
  end if;
  -- ONE statement: the committed cards (the rows), the squad (their ids in order) and the facts of each card (one primary key lookup for each row: a
  -- join to cards gets a generic plan that reads every card, docs/f3-effect-engine.md 8 finding 3)
  select coalesce(jsonb_object_agg(x.card_id::text, jsonb_build_object('hp', x.hp_remaining, 'max', x.max_hp, 'down', x.downed, 'shield', x.shield,
           'buff', x.dmg_buff, 'debuff', x.dmg_debuff, 'cd', x.cd_until_round)), '{}'::jsonb),
         coalesce(jsonb_agg(x.card_id order by x.card_id), '[]'::jsonb), count(*)::int,
         coalesce(jsonb_object_agg(x.card_id::text, f.facts) filter (where f.facts is not null), '{}'::jsonb)
    into v_cards, v_squad, v_n, v_facts
    from public.hunt_card_hp x
    cross join lateral (select (select jsonb_build_object('tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type)
                                  from public.cards c join public.subjects s on s.id = c.subject_id where c.id = x.card_id) facts offset 0) f
   where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = p_day;
  if v_af is not null then
    v_facts := v_facts || jsonb_build_object(v_a, coalesce(v_facts->v_a, '{}'::jsonb) || v_af);
  end if;
  -- the ally target: ok (owned), match_tags, and the commit facts when it has no row (hunt_commit_card: full HP, the squad and the daily cap)
  if p_target is not null then
    if v_cards ? v_ts and v_facts ? v_ts then
      v_t := jsonb_build_object('ok', coalesce((select pc.quantity >= 1 from public.player_cards pc where pc.player_id = p_player and pc.card_id = p_target), false),
        'match_tags', v_facts->v_ts->'tags');
    else
      select jsonb_build_object('ok', coalesce(pc.quantity >= 1, false), 'tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type,
               'match_tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb))
             || case when v_cards ? v_ts or pc.quantity is null or pc.quantity < 1 then '{}'::jsonb
                     else jsonb_build_object('commit_max', case when s.ability->>'kind' = 'support' then public.card_max_hp(0)
                                                                 else (public.card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'hp')::int end,
                                             'commit', public.hunt_squad_allows(p_hunt, p_player, p_day, p_target) and v_n < public.hunt_card_cap()) end
        into v_t
        from public.cards c join public.subjects s on s.id = c.subject_id
        left join public.player_cards pc on pc.player_id = p_player and pc.card_id = c.id
       where c.id = p_target;
    end if;
    if v_t is not null then v_facts := v_facts || jsonb_build_object(v_ts, coalesce(v_facts->v_ts, '{}'::jsonb) || v_t); end if;
  end if;
  return jsonb_build_object('v', 1, 'mode', 'hunt', 'round', coalesce((v_cs->>'round')::int, 0), 'squad', v_squad, 'cards', v_cards,
    'enemies', jsonb_build_array(jsonb_build_object('hp', (v_b->>'hp')::bigint, 'max', (v_b->>'max')::bigint, 'wk', v_cs->'boss_weaken', 'wku', v_cs->'weaken_until',
      'ex', v_cs->'boss_expose', 'exu', v_cs->'expose_until', 'st', v_cs->'stunned_until', 'enr', v_cs->'boss_enrage', 'enru', v_cs->'enrage_until')),
    'marks', coalesce(v_cs->'marks', '{}'::jsonb),
    'facts', jsonb_build_object('passives', coalesce(v_b->'passives', '[]'::jsonb), 'cards', v_facts),
    'ext', jsonb_build_object('hunt', p_hunt, 'player', p_player, 'day', p_day, 'status', v_b->>'status', 'tier', v_b->>'tier'));
end $$;

-- hunt_fight_state: the 4b signature (the tests and the timing script call it); the same state from hunt_fight_state_info.
create or replace function public.hunt_fight_state(p_hunt bigint, p_player text, p_day date, p_actor bigint default null, p_target bigint default null)
returns jsonb language sql stable set search_path = public as $$
  select public.hunt_fight_state_info(p_hunt, p_player, p_day, null, null, p_actor, null, p_target);
$$;

-- ============================================================ 2. the Hunt rows from the changes (an index loop; the boss HP as a delta under the lock)
-- hunt_effect_apply: the 4b rules (set values only, no combat math; the checks, then the commits first). An enemy change with dhp moves the boss HP of
-- the hunts row by that amount (the caller holds the row FOR UPDATE): a loss never below 0 (0 = defeated), a gain never above hp_max and only on an
-- active hunt. hp (4b) still sets the HP.
create or replace function public.hunt_effect_apply(p_hunt bigint, p_player text, p_day date, p_changes jsonb)
returns void language plpgsql set search_path = public as $$
declare c jsonb; s jsonb; i int; v_ch jsonb := coalesce(p_changes, '[]'::jsonb); n int; v_d bigint;
begin
  n := jsonb_array_length(v_ch);
  for i in 0 .. n - 1 loop
    c := v_ch->i;
    perform public.fight_change_check(c);
    if c->>'op' = 'commit' then
      perform public.hunt_commit_card(p_hunt, p_player, (c->>'card')::bigint, p_day, (c->>'max')::int);
    end if;
  end loop;
  for i in 0 .. n - 1 loop
    c := v_ch->i; s := c->'set';
    if c->>'op' = 'card' then
      update public.hunt_card_hp h set
          hp_remaining = coalesce((s->>'hp')::int, h.hp_remaining), max_hp = coalesce((s->>'max')::int, h.max_hp),
          downed = coalesce((s->>'down')::boolean, h.downed), shield = coalesce((s->>'shield')::int, h.shield),
          dmg_buff = coalesce((s->>'buff')::numeric, h.dmg_buff), dmg_debuff = coalesce((s->>'debuff')::numeric, h.dmg_debuff),
          cd_until_round = coalesce((s->>'cd')::int, h.cd_until_round), updated_at = now()
       where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day and h.card_id = (c->>'id')::bigint;
    elsif c->>'op' = 'enemy' then
      if (c->>'idx')::int <> 0 then raise exception 'hunt_effect_apply: the Hunt has one enemy (idx 0), not %', c->>'idx'; end if;
      if s ? 'dhp' then   -- a delta of the locked boss row
        v_d := (s->>'dhp')::bigint;
        if v_d < 0 then
          update public.hunts set hp_remaining = greatest(0, hp_remaining + v_d),
              status = case when hp_remaining + v_d <= 0 then 'defeated' else status end,
              defeated_at = case when hp_remaining + v_d <= 0 then now() else defeated_at end
            where id = p_hunt;
        elsif v_d > 0 then
          update public.hunts set hp_remaining = least(hp_max, hp_remaining + v_d) where id = p_hunt and status = 'active';
        end if;
      elsif s ? 'hp' then   -- the hunts row rule: a boss at 0 HP is defeated
        update public.hunts set hp_remaining = (s->>'hp')::bigint,
            status = case when (s->>'hp')::bigint <= 0 then 'defeated' else status end,
            defeated_at = case when (s->>'hp')::bigint <= 0 then now() else defeated_at end
          where id = p_hunt;
      end if;
      if s ?| array['wk', 'wku', 'ex', 'exu', 'st'] then
        update public.hunt_combat_state set boss_weaken = coalesce((s->>'wk')::numeric, boss_weaken), weaken_until = coalesce((s->>'wku')::int, weaken_until),
            boss_expose = coalesce((s->>'ex')::numeric, boss_expose), expose_until = coalesce((s->>'exu')::int, expose_until),
            stunned_until = coalesce((s->>'st')::int, stunned_until), updated_at = now()
          where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
      end if;
    elsif c->>'op' = 'marks' then
      update public.hunt_combat_state set marks = (coalesce(marks, '{}'::jsonb) - array(select jsonb_array_elements_text(coalesce(c->'del', '[]'::jsonb))))
          || coalesce(c->'set', '{}'::jsonb), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
    elsif c->>'op' = 'credit' then   -- the Hunt leaderboard (support damage)
      insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, (c->>'card')::bigint, p_day, (c->>'value')::int)
        on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
    end if;
  end loop;
end $$;

-- ============================================================ 3. the hit mods of an ability alone (the wrappers and the card viewer)
-- hunt_hit_mods(ability, boss HP, boss max HP): the mods of combat_effect before_hit for an attack ability on a fight state with this one card and the boss
-- (no squad; no boss: an empty enemy list). combat_hit, combat_crit_chance and hunt_card_crits use it.
create or replace function public.hunt_hit_mods(p_ability jsonb, p_hp bigint, p_hpmax bigint)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  return public.combat_effect(jsonb_build_object('v', 1, 'mode', 'hunt', 'round', 0, 'squad', '[]'::jsonb, 'cards', '{}'::jsonb,
      'enemies', case when p_hp is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('hp', p_hp, 'max', p_hpmax)) end, 'marks', '{}'::jsonb,
      'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', jsonb_build_object('0', jsonb_build_object('ability', p_ability))), 'ext', '{}'::jsonb),
    0, 'before_hit', '{"target_foe": 0}'::jsonb)->'mods';
end $$;

-- ============================================================ 4. combat_hit and combat_crit_chance: the same signatures, the work of the engine
CREATE OR REPLACE FUNCTION public.combat_hit(p_cp integer, p_wmult numeric, p_buff numeric, p_debuff numeric, p_synmult numeric, p_critchance numeric, p_miss numeric, p_aeff text, p_aamt numeric, p_athresh numeric, p_armored_melee boolean, p_expose numeric, p_hp bigint, p_hpmax bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return public.combat_hit_core(p_cp, p_wmult, p_buff, p_debuff, p_synmult, p_critchance, p_miss, p_armored_melee, p_expose,
    public.hunt_hit_mods(jsonb_build_object('kind', 'attack', 'effect', p_aeff, 'amount', p_aamt, 'threshold', p_athresh), p_hp, p_hpmax));
end $function$;

CREATE OR REPLACE FUNCTION public.combat_crit_chance(p_bonus boolean, p_aeff text, p_aamt numeric, p_cmb jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  return public.combat_crit_chance_mods(p_bonus, public.hunt_hit_mods(jsonb_build_object('kind', 'attack', 'effect', p_aeff, 'amount', p_aamt), null, null), p_cmb);
end $function$;

-- ============================================================ 5. hunt_card_crits: the crit chance of each attacker with the crit_add mod of the engine
-- plan_cache_mode = force_generic_plan: the large query is planned once in a session. The old text planned it again on most calls (plpgsql kept custom
-- plans): 0.71 ms a call before, 0.33 ms with one plan (warm; fight-timing.mjs 0.59 x the old time).
CREATE OR REPLACE FUNCTION public.hunt_card_crits(p_player text, p_hunt bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
declare v_w jsonb; v_r jsonb; v_wt text[]; v_b jsonb := card_balance(); res jsonb; v_hp bigint; v_hpmax bigint; v_ck text[]; v_sq boolean;
begin
  select weak_points, resist_points, hp_remaining, hp_max into v_w, v_r, v_hp, v_hpmax from hunts where id = p_hunt;
  -- Only the crit_add mod changes the crit chance: the engine runs for an attack kind with a before_hit crit_add step (v_ck), or for every ability when an
  -- enabled squad row has one (v_sq). Any other ability has no crit_add (ability_kinds steps, no effect name). A statement with no parameter: one plan.
  select coalesce(array_agg(a.key) filter (where a.slot = 'attack'), '{}'), coalesce(bool_or(a.slot = 'squad' and a.enabled), false) into v_ck, v_sq
    from ability_kinds a where a.steps @> '[{"on": "before_hit", "do": "hit_mod", "mod": "crit_add"}]'::jsonb;
  v_wt := array(select x->>'value' from jsonb_array_elements(coalesce(v_w, '[]'::jsonb)) x where x->>'kind' = 'tag');
  with k as materialized (
    select c.id, s.type, c.rarity::text rar, c.set_id, array(select t from unnest(s.tag_slugs) t where t = any(v_wt) order by t) wtags,
           case when s.ability->>'kind' = 'attack' then s.ability->>'effect' end aeff, coalesce((s.ability->>'amount')::numeric, 0) aamt,
           coalesce(pc.stat_points, '{}'::jsonb) pts
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
     where pc.player_id = p_player and pc.quantity > 0 and s.type in ('Character', 'Creature')),
  wk as materialized (select d.*, (combat_weak(v_w, v_r, d.type, d.rar, d.set_id, d.wtags, 0)->>'wm')::int > 0 bonus
                        from (select distinct type, rar, set_id, wtags from k) d),
  p as materialized (select d.pts, card_combat('normal', 0, 1, d.pts, v_b) cmb from (select distinct pts from k) d),
  kk as materialized (select k.id, wk.bonus, k.aeff, k.aamt, k.pts from k join wk on wk.type = k.type and wk.rar = k.rar
                        and wk.set_id is not distinct from k.set_id and wk.wtags = k.wtags),
  -- F-3 4d: the crit_add mod of the engine (hunt_hit_mods) in place of the effect name (only for a kind in v_ck, or for every ability with v_sq)
  x as materialized (select d.*, combat_crit_chance_mods(d.bonus, case when v_sq or d.aeff = any(v_ck)
                              then hunt_hit_mods(jsonb_build_object('kind', 'attack', 'effect', d.aeff, 'amount', d.aamt), v_hp, v_hpmax) else '{}'::jsonb end, p.cmb) crit
                       from (select distinct bonus, aeff, aamt, pts from kk) d join p on p.pts = d.pts)
  select coalesce(jsonb_object_agg(kk.id::text, x.crit), '{}'::jsonb) into res
    from kk join x on x.bonus = kk.bonus and x.aeff is not distinct from kk.aeff and x.aamt = kk.aamt and x.pts = kk.pts;
  return res;
end $function$;

-- ============================================================ 6. hunt_support through the engine (the live text; only the effect lines are new)
CREATE OR REPLACE FUNCTION public.hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- ============================================================ 7. hunt_attack through the engine (the live text; only the effect lines are new)
CREATE OR REPLACE FUNCTION public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- ============================================================ 8. rights (server only) and the docs
revoke all on function public.hunt_fight_state_info(bigint, text, date, jsonb, jsonb, bigint, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.hunt_fight_state_info(bigint, text, date, jsonb, jsonb, bigint, jsonb, bigint) to service_role;
revoke all on function public.hunt_hit_mods(jsonb, bigint, bigint) from public, anon, authenticated;
grant execute on function public.hunt_hit_mods(jsonb, bigint, bigint) to service_role;

comment on function public.hunt_fight_state_info(bigint, text, date, jsonb, jsonb, bigint, jsonb, bigint) is 'F-3 4d: the fight state of a Hunt member and day (docs/f3-effect-engine.md 2.8) from the rows the caller already read: the boss row {hp, max, status, tier, passives}, the hunt_combat_state row (jsonb), the acting card and its facts (NULL: read here), the ally target. The committed cards and their facts come from one statement over hunt_card_hp. Each query is planned once in a session (plan_cache_mode). hunt_support and hunt_attack use it (f3_engine_hunt.sql).';
comment on function public.hunt_fight_state(bigint, text, date, bigint, bigint) is 'F-3 4b: the fight state of a Hunt member and day (docs/f3-effect-engine.md 2.8) from hunts, hunt_combat_state and hunt_card_hp; facts of the acting card and the ally target. Calls hunt_fight_state_info (f3_engine_hunt.sql).';
comment on function public.hunt_effect_apply(bigint, text, date, jsonb) is 'F-3 4b: writes the changes of combat_effect into the Hunt rows (hunt_commit_card first, hunt_card_hp, hunts, hunt_combat_state, hunt_hits): set values only, no combat math. An enemy change dhp moves the boss HP of the locked hunts row (f3_engine_hunt.sql: a loss never below 0, 0 = defeated; a gain never above hp_max, only on an active hunt); hp sets it (0 = defeated).';
comment on function public.hunt_hit_mods(jsonb, bigint, bigint) is 'F-3 4d: the hit mods of combat_effect before_hit for one attack ability on a fight state with only this card and the boss (HP, max HP; NULL = no boss). combat_hit, combat_crit_chance and hunt_card_crits use it (f3_engine_hunt.sql).';
comment on function public.combat_hit(integer, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, boolean, numeric, bigint, bigint) is 'The old hit of the Hunt (14 arguments; old tests call it). Since f3_engine_hunt.sql (F-3 4d): the hit mods come from the engine (hunt_hit_mods) and the hit from combat_hit_core; no fight function calls it.';
comment on function public.combat_crit_chance(boolean, text, numeric, jsonb) is 'The old crit chance (4 arguments; old tests call it). Since f3_engine_hunt.sql (F-3 4d): the crit_add mod of the engine (hunt_hit_mods) and combat_crit_chance_mods; no fight function calls it.';
comment on function public.hunt_card_crits(text, bigint) is 'The crit chance of each attacker of a member on a boss (hunt_view, the card viewer): the weakness, the Precision points and the crit_add mod of the engine (F-3 4d, f3_engine_hunt.sql: hunt_hit_mods + combat_crit_chance_mods).';
comment on function public.combat_effect(jsonb, bigint, text, jsonb) is 'F-3: THE effect engine (docs/f3-effect-engine.md 2.7). combat_effect(fight state, card, trigger use|before_hit|on_hit|after_attack, ctx {target_card, target_foe, dealt}) returns {ok, effect, changes[], mods{}, log{}} or the refusal answer {ok: false, error, ...}. Reads ability_kinds (steps) and passives.params.counters. VOLATILE (a use draws random() only for a stun fail). The Dungeon and the Gauntlet (f3_engine_dungeon.sql, PR 4c) and the Hunt (f3_engine_hunt.sql, PR 4d) play through it.';

notify pgrst, 'reload schema';
