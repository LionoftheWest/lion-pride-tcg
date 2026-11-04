-- combat_v2_synergy.sql (2026-11-03): combat v2 item SYN, the element, affinity and set synergy (docs/combat-redesign-plan.md 7.1 to 7.5, 20.18).
-- Needs the combat v2 engine files on main (E1 to E9, M1b) and combat_v2_gauntlet_builders.sql (R1a: combat_v2_card_unit, gauntlet_v2_foes).
-- Before: no v2 function reads an element, a family or a set. The v2 card unit has no tag, the v2 foe has no element, and the hit core and the
--   support active have no synergy factor.
-- After this file (Nathan's decisions of 2026-11-03, SPEC SYN v3 section 9):
--   balance v2_synergy (new key, a note, a fixed shape in balance_v2_spec, the step order in balance_check_combat_v2): element {small_at, big_at,
--     small, big} (x1.12 at 3 cards of one element, x1.20 at 5), chart {bonus} (x1.25 when the card's element beats the foe's), affinity {step,
--     cap} (+10% for each OTHER squad card of the support's element or family, at most +30%), sets.forbidden_pride {small_at, big_at, top_at,
--     small, big, top, head} (all values 1 until the Lab report, Q8; the top step is Hunt only and needs the head subject, D-202).
--   combat_v2_card_tags(card) (NEW, STABLE): {element, family, piece, beats}. element = card_element(subjects.tag_slugs) (the v1 alias rule);
--     family = the first origin: slug; piece = the subject key when the subject has the trait slug of a set of v2_synergy.sets; beats = the sorted
--     element_counters targets of the element (no proposal row). Rule tags only (plan 7.1): no label tag is read.
--   combat_v2_synergy(state, numbers) (NEW, PURE): the state with syn {elem_n, elem_x, aff_tag, aff_n, aff_x, set_n, set_x} on every card. The
--     squad is state.cards (standing or down). A card with no tags counts for no tag and has every factor 1. It draws no random number.
--   combat_v2_card_unit: + tags (combat_v2_card_tags). gauntlet_v2_foes: + element (the week foe's element, a rule tag of the v2 foe).
--   combat_v2_status_numbers and the 3-argument combat_v2_hit: the bundle carries v2_synergy (the hit raises without it).
--   combat_v2_hit (card side only): mult x elem_x x set_x x chart, after (1 + bonus) and vs_x; the answer has chart (true or false). The enemy
--     side, the ticks and the log entries do not change.
--   combat_effect_v2_active (support only): the amounts, the focus crd and the apply / random_apply values x aff_x x set_x; smite_x and area_x
--     x aff_x (the hit core puts set_x on the smite and the area: one place for each factor). Stacks, chances, picks, durations, draws: no change.
-- NEUTRAL VALUES = TODAY: with every multiplier 1 and affinity.step 0, every v2 fight gives the same log and totals (a factor of 1 is not applied).
-- FLAG OFF = NO CHANGE IN PLAY: no v1 function changes; no play path calls a v2 function (combat_v2 stays off). The goldens prove it.
-- The callers: the Admin Combat v2 Lab (card-studio/src/combat-lab-routes.js) calls combat_v2_synergy when it builds a fight; the R1b room
--   start does (a later replace in this file, after R1b merges); R2 and R3 call it in their own room builders.
-- Every number is in balance (CI check C1). Idempotent. Server only.
-- GUARD: each replaced function must be the live text of 2026-11-03 (db/schema at 11b8db77) or the text this file made.
-- Test: card-studio/scripts/test-combat-v2-synergy.mjs (rolled back; MUTATE=all must catch every mutation).

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.balance_v2_spec(text)', '59f02d5aab9be2f8aa9d7d33cecf2c65', '00000000000000000000000000000000'),
    ('public.balance_check_combat_v2()', '04bc3a5bd5e15adf485e5e0c42398a67', '00000000000000000000000000000000'),
    ('public.combat_v2_status_numbers()', '90b928e2b93b0349e88d30934d744867', '00000000000000000000000000000000'),
    ('public.combat_v2_card_unit(bigint, jsonb)', '68287c1546cdf795309d4d41c940efaa', '00000000000000000000000000000000'),
    ('public.gauntlet_v2_foes(jsonb, integer, integer, jsonb)', 'f3df73d2b8fedc4686927303ffc24ee5', '00000000000000000000000000000000'),
    ('public.combat_v2_hit(jsonb, jsonb, jsonb)', '0ccf26061888c009b397d52b300e256b', '00000000000000000000000000000000'),
    ('public.combat_v2_hit(jsonb, jsonb, jsonb, jsonb)', 'f4dfcc7c6d771a6bda7be9cb84d82001', '00000000000000000000000000000000'),
    ('public.combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)', '1fae6f148a7ad6dc2e935081188fc718', '00000000000000000000000000000000')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_synergy.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the shape and the step order of v2_synergy (the live text + the SYN lines)
create or replace function public.balance_v2_spec(p_key text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_key
  when 'combat_v2' then '{"gauntlet": "bool", "dungeon": "bool", "hunt": "bool", "progress": "bool", "testers": ["set", "discord_id", 0, 20]}'::jsonb
  when 'v2_stats' then '{
    "max_per_stat": "int 1 20",
    "atk": {"flat": "num 0 10"},
    "def": {"pct": "num 0 0.1", "cap": "num 0 0.6"},
    "hp":  {"flat": "num 0 30"},
    "crd": {"base": "num 1 4", "pct": "num 0 0.5"},
    "crt": {"base": "num 0 0.5", "pct": "num 0 0.2", "cap": "num 0 1"},
    "abl": {"pct": "num 0 0.2"},
    "ddg": {"pct": "num 0 0.1", "cap": "num 0 0.6", "area_x": "num 0 1"},
    "acc": {"pct": "num 0 0.1"},
    "spd": {"pct": "num 0 0.1"}}'::jsonb
  when 'v2_card_hp' then '{"base": "num 1 200", "per_cp": "num 0 5"}'::jsonb
  when 'v2_asc' then '{
    "base": {"normal": "num 1 500", "illustrated_rare": "num 1 500", "secret_rare": "num 1 500", "full_art": "num 1 500", "gold": "num 1 500"},
    "top":  {"normal": "num 1 500", "illustrated_rare": "num 1 500", "secret_rare": "num 1 500", "full_art": "num 1 500", "gold": "num 1 500"},
    "curve": ["list", "num 0 1", 6, 6],
    "alias": {"promo": "enum normal|illustrated_rare|secret_rare|full_art|gold", "event": "enum normal|illustrated_rare|secret_rare|full_art|gold"}}'::jsonb
  when 'v2_level' then '{"max_level": "int 1 100", "points_per_level": "int 1 5", "converge_d": "num 0 1", "target_cp": "num 1 1000"}'::jsonb
  when 'card_level' then '{"xp_hunt_day": "int 0 100", "xp_dungeon_run": "int 0 100", "cost_base": "int 1 100", "cost_per_level": "int 0 20",
    "catchup_x": "num 1 5", "catchup_top": "int 1 20"}'::jsonb
  when 'v2_support' then '{"basic_x": "num 0 1", "power_ref": "num 1 500", "power_exp": "num 0 1",
    "enabler_extra_stack": ["set", "enum normal|illustrated_rare|secret_rare|full_art|gold|promo|event", 0, 7], "area_one_foe_x": "num 0 1"}'::jsonb
  when 'v2_speed' then '{
    "role_base": {"breaker": "num 1 100", "striker": "num 1 100", "flurry": "num 1 100", "finisher": "num 1 100", "survivor": "num 1 100", "cleaver": "num 1 100",
                  "warden": "num 1 100", "medic": "num 1 100", "controller": "num 1 100", "spotter": "num 1 100", "herald": "num 1 100", "artillery": "num 1 100"},
    "act_at": "num 10 1000", "status_min_x": "num 0.1 1", "safety_max_x": "num 1 3", "max_actions_per_step": "int 1 10"}'::jsonb
  when 'v2_charge' then '{"attacker": "int 0 5", "support": "int 0 5", "start": "int 0 5"}'::jsonb
  when 'v2_hit' then '{"miss": "num 0 0.5", "roll_min": "num 0.5 1", "roll_span": "num 0 1", "resolve_acc": "num 0 0.1", "min_dmg": "int 0 10"}'::jsonb
  when 'v2_roles' then '{
    "breaker":    {"pierce": "num 0 1", "shield_x": "num 1 5"},
    "striker":    {"crit_add": "num 0 0.5", "critx_add": "num 0 2"},
    "flurry":     {"extra_chance": "num 0 1", "extra_x": "num 0 2"},
    "finisher":   {"line": "num 0 1", "bonus": "num 0 3"},
    "survivor":   {"lifesteal": "num 0 1", "cap_maxhp": "num 0 1"},
    "cleaver":    {"splash": "num 0 1", "hunt_bonus": "num 0 1", "hunt_area_x": "num 0 1"},
    "warden":     {"ally_dr": "num 0 0.5", "taunt_w": "num 1 10"},
    "medic":      {"heal_after": "num 0 0.5"},
    "controller": {"resolve_ignore": "num 0 1", "dur_add": "int 0 5"},
    "spotter":    {"basic_expose": "num 0 1", "basic_expose_dur": "int 1 10"},
    "herald":     {"basic_empower": "num 0 1"},
    "artillery":  {"basic_x": "num 0 1", "true_strike": "bool"}}'::jsonb
  when 'v2_status' then '{
    "poison":    {"tick": "num 0 0.2", "burst_at": "int 2 10", "burst": "num 0 1", "dur": "int 1 50", "dur_card": "int 1 50", "ignore_shield": "bool"},
    "burn":      {"tick_x": "num 0 5", "max": "int 1 20", "decay": "int 0 5", "heal_x": "num 0 1", "vs_healer_x": "num 1 5", "ignore_shield": "bool"},
    "stunned":   {"max_life": "int 1 50", "max_life_card": "int 1 50"},
    "frozen":    {"max_life": "int 1 50", "max_life_card": "int 1 50"},
    "sleep":     {"dur": "int 1 50", "dur_card": "int 1 50"},
    "paralyzed": {"dur": "int 1 50", "dur_card": "int 1 50", "fail": "num 0 1"},
    "blinded":   {"miss": "num 0 1", "dur": "int 1 50", "dur_card": "int 1 50"},
    "confused":  {"chance": "num 0 1", "self_x": "num 0 2", "dur": "int 1 50", "dur_card": "int 1 50"},
    "slowed":    {"x": "num 0.1 1", "dur": "int 1 50", "dur_card": "int 1 50"},
    "quickened": {"x": "num 1 3", "dur": "int 1 50", "dur_card": "int 1 50"},
    "chill":     {"dmg": "num 0 0.5", "spd": "num 0 0.5", "freeze_at": "int 2 10", "dur": "int 1 50", "dur_card": "int 1 50"},
    "exposed":   {"cap": "num 0 3", "dur": "int 1 50", "dur_card": "int 1 50"},
    "weakened":  {"cap": "num 0 1", "dur": "int 1 50", "dur_card": "int 1 50"},
    "mark":      {"dur": "int 1 50"},
    "shielded":  {"cap_maxhp": "num 0 3"},
    "empowered": {"cap": "num 0 5", "stack": "bool", "stack_cap": "num 0 5"},
    "focused":   {"dur": "int 1 50"},
    "enraged":   {"x": "num 1 3", "dur": "int 1 50"},
    "hunt_ref_hp": "num 1 100000"}'::jsonb
  when 'v2_control' then '{"immune": "int 0 20", "immune_card": "int 0 50", "boss_immune": "int 0 20", "boss_max_dur": "int 1 10"}'::jsonb
  when 'v2_enemy' then '{
    "hunt": {
      "Normal": {"hp": "int 1000 1000000", "atk": "num 1 1000", "def": "num 0 0.6", "evasion": "num 0 0.5", "resolve": "num 0 1", "keen": "num 0 1", "speed": "num 1 400", "atk_x": "num 0.1 3", "signatures": "int 0 5"},
      "Heroic": {"hp": "int 1000 1000000", "atk": "num 1 1000", "def": "num 0 0.6", "evasion": "num 0 0.5", "resolve": "num 0 1", "keen": "num 0 1", "speed": "num 1 400", "atk_x": "num 0.1 3", "signatures": "int 0 5"},
      "Mythic": {"hp": "int 1000 1000000", "atk": "num 1 1000", "def": "num 0 0.6", "evasion": "num 0 0.5", "resolve": "num 0 1", "keen": "num 0 1", "speed": "num 1 400", "atk_x": "num 0.1 3", "signatures": "int 0 5"}},
    "boss_heal_ref": "num 1 100000",
    "boss_moves": {"strike": "num 0 1", "strike_x": "num 0 5", "slam": "num 0 1", "slam_x": "num 0 5", "drain": "num 0 1", "drain_x": "num 0 5", "drain_heal": "num 0 0.2",
      "stun": "num 0 1", "stun_x": "num 0 5", "enrage": "num 0 1", "enrage_x": "num 1 3", "enrage_dur": "int 1 20", "curse": "num 0 1", "curse_weaken": "num 0 1",
      "curse_dur": "int 1 50", "regenerate": "num 0 1", "regenerate_heal": "num 0 0.2", "regenerate_heal_rage": "num 0 0.2", "cycle": "int 2 30",
      "cataclysm_x": "num 0 5", "rage_at": "num 0 1", "rage_x": "num 1 3"},
    "signature_pool": ["set", "enum purify|ironhide|true_strike|shatter|regrowth|frost_aura|thick_hide|unstoppable|venom|burning|sunder|slowing|elusive|toxic_born|fireborn|frostborn|steadfast|dispeller", 1, 18],
    "mechanics": {
      "purify": {"every": "int 1 10"}, "ironhide": {"crit_x": "num 0 1"}, "true_strike": {}, "shatter": {"shield_x": "num 1 5"},
      "regrowth": {"heal": "num 0 0.2", "below_half_x": "num 1 5", "boss_heal": "num 0 0.05"}, "frost_aura": {"chill": "int 1 5"}, "thick_hide": {"expose_cap": "num 0 1"},
      "unstoppable": {"control_fail": "num 0 1"}, "venom": {"poison": "int 1 5", "chance": "num 0 1"}, "burning": {"burn": "int 1 5"}, "sunder": {"pierce": "num 0 1"},
      "slowing": {"chance": "num 0 1"}, "elusive": {},
      "toxic_born": {"immune": ["set", "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark", 1, 13]},
      "fireborn":   {"immune": ["set", "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark", 1, 13]},
      "frostborn":  {"immune": ["set", "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark", 1, 13]},
      "steadfast": {"dr": "num 0 1", "kinds": "int 1 13"}, "dispeller": {"x": "num 0 1"}},
    "asc3_hp_x": "num 0.5 5", "weak_role_x": "num 0 1",
    "weak_role_rules": {"controller": {"damage_x": "num 0 1", "control_add": "int 0 5"}}}'::jsonb
  when 'v2_dungeon' then '{
    "round_cap": "int 1 200", "hp_x": "num 0.1 5", "atk_x": "num 0.1 5",
    "growth": {"hp": "num 1 3", "atk": "num 1 3", "room": "num 0 1", "early_floors": "int 0 30", "early_hp": "num 0.1 1", "early_atk": "num 0.1 1"},
    "kinds": {
      "fight":    {"hp": "num 0.1 10", "atk": "num 0.1 10", "def": "num 0 0.6", "speed": "num 1 400", "passives": "int 0 5", "charge": "bool"},
      "horde":    {"hp": "num 0.1 10", "atk": "num 0.1 10", "def": "num 0 0.6", "speed": "num 1 400", "passives": "int 0 5", "charge": "bool"},
      "elite":    {"hp": "num 0.1 10", "atk": "num 0.1 10", "def": "num 0 0.6", "speed": "num 1 400", "passives": "int 0 5", "charge": "bool"},
      "miniboss": {"hp": "num 0.1 10", "atk": "num 0.1 10", "def": "num 0 0.6", "speed": "num 1 400", "passives": "int 0 5", "charge": "bool"},
      "guardian": {"hp": "num 0.1 10", "atk": "num 0.1 10", "def": "num 0 0.6", "speed": "num 1 400", "passives": "int 0 5", "charge": "bool"}},
    "foe_resolve": {"fight": "num 0 1", "horde": "num 0 1", "elite": "num 0 1", "miniboss": "num 0 1", "guardian": "num 0 1"},
    "foe_evasion_per_floor": "num 0 0.1", "foe_evasion_max": "num 0 0.5",
    "pool_moves": {"cycle": "int 2 30", "cataclysm_x": "num 0 5", "heavy_x": "num 0 5", "flurry_x": "num 0 5", "slam_x": "num 0 5", "stun_x": "num 0 5",
      "drain_x": "num 0 5", "drain_heal": "num 0 1", "poison_x": "num 0 5", "regenerate_heal": "num 0 1", "regenerate_heal_rage": "num 0 1", "guard": "num 0 1",
      "curse_weaken": "num 0 1"},
    "passive_pool": ["set", "enum purify|ironhide|true_strike|shatter|regrowth|frost_aura|thick_hide|unstoppable|venom|burning|sunder|slowing|elusive|toxic_born|fireborn|frostborn|steadfast|dispeller", 1, 18],
    "moves_v2": {"hellfire": {"x": "num 0 5", "burn": "int 1 5"}, "frost_punch": {"x": "num 0 5", "chill": "int 1 5"}, "squeeze": {"x": "num 0 5", "status": "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark"},
      "rattle": {"exposed": "num 0 1"}, "infect": {"x": "num 0 5", "poison": "int 1 5", "no_heal": "int 1 50"}},
    "monster_passives": {"kinds": ["set", "enum fight|horde|elite|miniboss|guardian", 1, 5], "pack": {"kinds": ["set", "enum fight|horde|elite|miniboss|guardian", 1, 5]}},
    "passive_params": {"bulwark": {"every": "int 2 10", "guard": "num 0 1"}, "plaguebearer": {"poison": "int 1 5"}, "undying": {"hp": "num 0 1"},
      "volatile_core": {"x": "num 0 5"}, "pack": {"atk_per_foe": "num 0 0.5"}}}'::jsonb
  when 'v2_hunt' then '{"round_cap": "int 1 200"}'::jsonb
  when 'v2_synergy' then '{
    "element":  {"small_at": "int 2 8", "big_at": "int 2 8", "small": "num 1 1.5", "big": "num 1 1.5"},
    "chart":    {"bonus": "num 1 2"},
    "affinity": {"step": "num 0 0.3", "cap": "num 0 1"},
    "sets":     {"forbidden_pride": {"small_at": "int 2 8", "big_at": "int 2 8", "top_at": "int 2 8", "small": "num 1 2", "big": "num 1 2", "top": "num 1 2",
                                    "head": "enum ottozone-s-head"}}}'::jsonb
  when 'v2_pp' then '{
    "budget": "num 1 50", "tolerance": "num 0 5",
    "ref": {"enemy_def": "num 0 1", "miss": "num 0 1", "foes_other": "num 0 5", "crit_share": "num 0 1", "frozen_share": "num 0 1", "shield_share": "num 0 1",
            "stacks": "num 0 10", "kinds": "num 0 10", "payoff": "num 0 2", "heal_value": "num 0 2"},
    "status_pp": {"poison": "num 0 100", "burn": "num 0 100", "chill": "num 0 100", "mark": "num 0 100", "exposed": "num 0 100", "weakened": "num 0 100",
                  "stunned": "num 0 100", "frozen": "num 0 100", "sleep": "num 0 100", "paralyzed": "num 0 100", "blinded": "num 0 100", "confused": "num 0 100",
                  "slowed": "num 0 100", "shield_self": "num 0 100", "empower_ally": "num 0 100"},
    "support_pp": {"shield": "num 0 200", "shield_all": "num 0 200", "heal": "num 0 200", "heal_all": "num 0 200", "empower": "num 0 200", "rally": "num 0 200",
                   "quicken": "num 0 200", "focus_crit": "num 0 200", "focus_crd": "num 0 200", "smite": "num 0 200", "cleanse": "num 0 200", "dispel": "num 0 200",
                   "consume": "num 0 200", "cure": "num 0 200"}}'::jsonb
  when 'v2_power' then '{
    "k": {"breaker": "num 0.2 5", "striker": "num 0.2 5", "flurry": "num 0.2 5", "finisher": "num 0.2 5", "survivor": "num 0.2 5", "cleaver": "num 0.2 5",
          "warden": "num 0.2 5", "medic": "num 0.2 5", "controller": "num 0.2 5", "spotter": "num 0.2 5", "herald": "num 0.2 5", "artillery": "num 0.2 5"},
    "abl_x": "num 0 1", "support_abl_ref": "num 0 100", "ddg_x": "num 0 1",
    "value": {"smite": "num 0 2", "dot": "num 0 2", "control": "num 0 2"}, "scale": "num 0.00001 1"}'::jsonb
  end;
$function$;

create or replace function public.balance_check_combat_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- ============================================================ 2. the balance key
-- @balance-begin
select set_config('balance.by', 'nathan', true);
insert into public.balance (key, value, note) values
('v2_synergy', '{"element": {"small_at": 3, "big_at": 5, "small": 1.12, "big": 1.20}, "chart": {"bonus": 1.25}, "affinity": {"step": 0.10, "cap": 0.30},
  "sets": {"forbidden_pride": {"small_at": 3, "big_at": 5, "top_at": 7, "small": 1, "big": 1, "top": 1, "head": "ottozone-s-head"}}}'::jsonb,
 $n$Combat v2 synergy (item SYN, plan 7.1 to 7.5; combat_v2_synergy.sql; Nathan 2026-11-03: the 9 recommendations). element: an ATTACKER with small_at or more squad cards of its element (itself and the supports included) deals x small, with big_at or more x big (v1 values 1.12 and 1.20). chart: a card hit on a foe whose element the card's element beats (element_counters, no proposal) x bonus (v1 1.25; no enemy-side penalty). affinity: a SUPPORT gets 1 + min(cap, step x n) on its amounts, its smite and area and its status values (not stacks, chances or durations), n = the OTHER squad cards of its element or its family (the one with more; a tie: the element). sets.<set>: the distinct pieces (subjects with the trait slug trait:<set with - for _>) in the squad: small_at -> small, big_at -> big, top_at -> top only in the Hunt and with the head subject in the squad; the factor goes to every squad card (Q7 = B). The set values stay 1 until the Lab measures them (Q8). Neutral (= the v2 engine before SYN): small, big, bonus, every set value 1 and step 0. Shape: balance_v2_spec (trigger balance_check_combat_v2).$n$)
on conflict (key) do nothing;
-- @balance-end

-- ============================================================ 3. the rule tags of a card (plan 7.1: role, element, family, set; never a label tag)
create or replace function public.combat_v2_card_tags(p_card bigint) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare tg text[]; subj text; el text; fam text; pc text; sets jsonb; k text;
begin
  if p_card is null then raise exception 'combat_v2_card_tags: the card id is needed'; end if;
  select coalesce(s.tag_slugs, '{}'::text[]), s.key into tg, subj from public.cards c join public.subjects s on s.id = c.subject_id where c.id = p_card;
  if not found then raise exception 'combat_v2_card_tags: unknown card %', p_card; end if;
  select b.value->'sets' into sets from public.balance b where b.key = 'v2_synergy';
  if jsonb_typeof(sets) is distinct from 'object' then raise exception 'combat_v2_card_tags: no balance value for v2_synergy.sets'; end if;
  el := card_element(tg);
  select q.t into fam from unnest(tg) with ordinality q(t, o) where q.t like 'origin:%' order by q.o limit 1;
  -- the set piece: the subject has the set slug (the set key with - for _)
  for k in select x from jsonb_object_keys(sets) x order by x loop
    if 'trait:' || replace(k, '_', '-') = any(tg) then pc := subj; exit; end if;
  end loop;
  return jsonb_build_object('element', el, 'family', fam, 'piece', pc,
    'beats', coalesce((select jsonb_agg(e.target order by e.target) from public.element_counters e where e.beater = el and not e.proposal), '[]'::jsonb));
end $fn$;

-- ============================================================ 4. the squad factors (computed once, when the fight state is built)
create or replace function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb
language plpgsql immutable set search_path = public as $fn$
declare
  sy jsonb := p_b->'v2_synergy'; ce jsonb := p_b->'v2_synergy'->'element'; ca jsonb := p_b->'v2_synergy'->'affinity';
  cards jsonb := p_state->'cards'; out jsonb := '{}'::jsonb; c record; t jsonb; el text; fam text;
  en int; ex numeric; ne int; nf int; atag text; an int; ax numeric; sn int := 0; sx numeric := 1; head boolean; sk text; sv jsonb;
begin
  if jsonb_typeof(sy) is distinct from 'object' or jsonb_typeof(ce) is distinct from 'object' or jsonb_typeof(ca) is distinct from 'object'
     or jsonb_typeof(sy->'sets') is distinct from 'object' then
    raise exception 'combat_v2_synergy: no balance value for v2_synergy (element, affinity, sets)';
  end if;
  if jsonb_typeof(cards) is distinct from 'object' then raise exception 'combat_v2_synergy: the state needs cards (an object of card units)'; end if;
  -- the set factor: the same for every squad card (Q7 = B). The pieces are distinct subjects; the top step: the Hunt and the head in the squad
  for sk, sv in select x.key, x.value from jsonb_each(sy->'sets') x order by x.key loop
    select count(distinct q.value->'tags'->>'piece')::int, coalesce(bool_or(q.value->'tags'->>'piece' = sv->>'head'), false) into sn, head
      from jsonb_each(cards) q where jsonb_typeof(q.value->'tags') = 'object';
    sx := sx * case when sn >= (sv->>'top_at')::int and p_state->>'mode' = 'hunt' and head then (sv->>'top')::numeric
                    when sn >= (sv->>'big_at')::int then (sv->>'big')::numeric
                    when sn >= (sv->>'small_at')::int then (sv->>'small')::numeric else 1 end;
  end loop;
  if sx = 1 then sx := 1; end if;
  for c in select q.key, q.value from jsonb_each(cards) q order by q.key loop
    t := c.value->'tags';
    if jsonb_typeof(t) is distinct from 'object' then
      -- a unit with no tags (a snapshot made before SYN): it counts for no tag, and every factor is 1
      out := out || jsonb_build_object(c.key, c.value || jsonb_build_object('syn', jsonb_build_object('elem_n', 0, 'elem_x', 1, 'aff_tag', null, 'aff_n', 0, 'aff_x', 1,
        'set_n', 0, 'set_x', 1)));
      continue;
    end if;
    el := t->>'element'; fam := t->>'family';
    -- the element count: the squad cards of the element (this card too; attackers and supports)
    select count(*)::int into en from jsonb_each(cards) q where el is not null and q.value->'tags'->>'element' = el;
    ex := 1;
    if c.value->>'class' = 'attacker' and el is not null then
      ex := case when en >= (ce->>'big_at')::int then (ce->>'big')::numeric when en >= (ce->>'small_at')::int then (ce->>'small')::numeric else 1 end;
    end if;
    -- the affinity (a support): the OTHER squad cards of its element or its family, the one with more (a tie: the element)
    atag := null; an := 0; ax := 1;
    if c.value->>'class' = 'support' then
      ne := case when el is null then 0 else en - 1 end;
      select count(*)::int into nf from jsonb_each(cards) q where fam is not null and q.key <> c.key and q.value->'tags'->>'family' = fam;
      if el is not null and ne >= nf then atag := el; an := ne; elsif fam is not null then atag := fam; an := nf; end if;
      ax := 1 + least((ca->>'cap')::numeric, (ca->>'step')::numeric * an);
    end if;
    if ex = 1 then ex := 1; end if;
    if ax = 1 then ax := 1; end if;
    out := out || jsonb_build_object(c.key, c.value || jsonb_build_object('syn', jsonb_build_object('elem_n', case when el is null then 0 else en end, 'elem_x', ex,
      'aff_tag', atag, 'aff_n', an, 'aff_x', ax, 'set_n', sn, 'set_x', sx)));
  end loop;
  return jsonb_set(p_state, '{cards}', out);
end $fn$;

-- ============================================================ 5. the replaced functions (the live text + the SYN lines; each added line has the mark SYN)
create or replace function public.combat_v2_status_numbers()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select combat_v2_numbers(array['v2_status', 'v2_control', 'v2_roles', 'v2_hit', 'v2_stats', 'v2_enemy', 'v2_speed', 'v2_hunt', 'v2_dungeon', 'v2_synergy'])
         || jsonb_build_object('statuses', (select coalesce(jsonb_object_agg(s.key, jsonb_build_object('ord', s.ord, 'family', s.family, 'negative', s.negative,
              'immunity', s.immunity, 'duration', s.duration, 'end_state', s.end_state, 'on_card', s.on_card, 'on_enemy', s.on_enemy)), '{}'::jsonb)
            from public.statuses s));
$function$;

create or replace function public.combat_v2_card_unit(p_card bigint, p_b jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  b jsonb := coalesce(p_b, combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']));
  r record; a jsonb; cc jsonb;
begin
  if p_card is null then raise exception 'combat_v2_card_unit: the card id is needed'; end if;
  if jsonb_typeof(b->'v2_speed'->'role_base') is distinct from 'object' or jsonb_typeof(b->'v2_charge'->'start') is distinct from 'number' then
    raise exception 'combat_v2_card_unit: no balance value for v2_speed.role_base or v2_charge.start';
  end if;
  select c.rarity::text as rarity, s.cp_mod, s.ability_v2 into r from public.cards c join public.subjects s on s.id = c.subject_id where c.id = p_card;
  if not found then raise exception 'combat_v2_card_unit: unknown card %', p_card; end if;
  a := r.ability_v2;
  -- decision D2: no approved v2 active = no v2 unit (the caller plays v1); never a placeholder
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'role') is distinct from 'string' or jsonb_typeof(a->'blocks') is distinct from 'array'
     or not exists (select 1 from public.roles x where x.key = a->>'role') then
    raise exception using errcode = 'no_data_found',
      message = format('combat_v2_card_unit: card %s has no ability_v2 (a role of the roles table and a list of blocks), so it has no v2 unit (decision D2: the player plays v1)', p_card);
  end if;
  -- the Gauntlet has no progress (plan 3.3): 0 stars, level 0, no points
  cc := card_combat_v2(r.rarity, 0, r.cp_mod, 0, '{}'::jsonb, a->>'role', b);
  if jsonb_typeof(b->'v2_speed'->'role_base'->(cc->>'role')) is distinct from 'number' then
    raise exception 'combat_v2_card_unit: no balance value for v2_speed.role_base.%', cc->>'role';
  end if;
  return jsonb_build_object('role', cc->>'role', 'class', cc->>'class',
    'atk', cc->'stats'->'atk', 'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'abl', cc->'stats'->'abl', 'acc', cc->'stats'->'acc',
    'def', cc->'stats'->'def', 'ddg', cc->'stats'->'ddg', 'max', cc->'stats'->'hp', 'hp', cc->'stats'->'hp', 'down', false,
    'speed', b->'v2_speed'->'role_base'->(cc->>'role'), 'spd', coalesce(cc->'points'->'spd', '0'::jsonb), 'power', cc->'power', 'extra_stack', cc->'extra_stack',
    'meter', 0, 'charge', (b->'v2_charge'->>'start')::int, 'held', 0, 'status', '{}'::jsonb,
    'active', jsonb_build_object('blocks', a->'blocks'), 'tags', combat_v2_card_tags(p_card));
end $function$;

create or replace function public.gauntlet_v2_foes(p_foes jsonb, p_floor integer, p_room integer, p_b jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); f jsonb; out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_foes) is distinct from 'array' or jsonb_array_length(p_foes) = 0 then
    raise exception 'gauntlet_v2_foes: the foes must be a list of at least one week foe';
  end if;
  for f in select x from jsonb_array_elements(p_foes) x loop
    if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'key') is distinct from 'string' or jsonb_typeof(f->'kind') is distinct from 'string' then
      raise exception 'gauntlet_v2_foes: each foe needs a key and a kind (dungeon_make_foe)';
    end if;
    -- the v2 foe of the monster, the floor, the room and the kind (no extra mechanic: the v1 passives, weak and resist are not v2 rules);
    -- SYN (plan 7.1, 7.3): the element of the week foe is a rule tag of the v2 foe (the element chart of combat_v2_hit)
    -- show = the names for the screen only (no engine function reads it)
    out := out || jsonb_build_array(combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', null, b)
      || jsonb_build_object('show', jsonb_build_object('name', f->'name', 'model', f->'model', 'element', f->'element'))
      || case when jsonb_typeof(f->'element') = 'string' then jsonb_build_object('element', f->'element') else '{}'::jsonb end);
  end loop;
  return out;
end $function$;

create or replace function public.combat_v2_hit(p_att jsonb, p_tgt jsonb, p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select combat_v2_hit(p_att, p_tgt, p_ctx, combat_v2_numbers(array['v2_hit', 'v2_stats', 'v2_status', 'v2_roles', 'v2_enemy', 'v2_support', 'v2_synergy']));
$function$;

create or replace function public.combat_v2_hit(p_att jsonb, p_tgt jsonb, p_ctx jsonb, p_b jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  ihx numeric;
  h jsonb := p_b->'v2_hit'; st jsonb := p_b->'v2_stats'; ss jsonb := p_b->'v2_status'; ro jsonb := p_b->'v2_roles'; en jsonb := p_b->'v2_enemy';
  bm jsonb := p_b->'v2_enemy'->'boss_moves';
  ctx jsonb := coalesce(p_ctx, '{}'::jsonb);
  side text := ctx->>'side'; clk int; draws jsonb := ctx->'draws'; used jsonb := '[]'::jsonb; d numeric;
  role text := p_att->>'role'; rn jsonb; tmech jsonb := coalesce(p_tgt->'mechanics', '[]'::jsonb); amech jsonb := coalesce(p_att->'mechanics', '[]'::jsonb);
  ab numeric; x numeric; mult numeric; roll numeric; chance numeric := 0; critc numeric := 0; foc numeric := 0; bonus numeric;
  ts boolean; marked boolean := false; can_crit boolean; crit boolean := false; s jsonb; k text; mp jsonb; mx numeric;
  raw numeric := 0; pierce numeric := 0; sx numeric := 1; a numeric; shield numeric; absorbed numeric := 0; hp_loss numeric := 0;
  thp numeric; tmax numeric; heal numeric := 0; shield_key text; brood int; brood_after int; lim numeric;
  fx numeric := 1; chart boolean := false;
begin
  if h is null or st is null or ss is null or ro is null or en is null or bm is null or p_b->'v2_support' is null or p_b->'v2_synergy' is null then
    raise exception 'combat_v2_hit: no balance value for v2_hit, v2_stats, v2_status, v2_roles, v2_enemy, v2_support or v2_synergy';
  end if;
  if side is null or side not in ('card', 'enemy') then raise exception 'combat_v2_hit: ctx.side must be card (a card hits an enemy) or enemy (%)', side; end if;
  if jsonb_typeof(p_att) is distinct from 'object' or jsonb_typeof(p_tgt) is distinct from 'object' then raise exception 'combat_v2_hit: the attacker and the target must be units'; end if;
  if jsonb_typeof(p_att->'atk') is distinct from 'number' or (p_att->>'atk')::numeric < 0 then raise exception 'combat_v2_hit: the attacker needs atk (a number of 0 or more)'; end if;
  if jsonb_typeof(p_tgt->'hp') is distinct from 'number' or jsonb_typeof(p_tgt->'max') is distinct from 'number' or (p_tgt->>'max')::numeric <= 0 then
    raise exception 'combat_v2_hit: the target needs hp and max (max above 0)';
  end if;
  if draws is not null and jsonb_typeof(draws) <> 'array' then raise exception 'combat_v2_hit: ctx.draws must be a list of numbers'; end if;
  if ctx ? 'clock' then clk := (ctx->>'clock')::int; end if;
  if side = 'card' then
    rn := ro->role;
    if rn is null or role like '\_%' then raise exception 'combat_v2_hit: the attacking card needs a role of v2_roles (%)', role; end if;
    if coalesce(p_att->>'class', '') not in ('attacker', 'support') then
      raise exception 'combat_v2_hit: the attacking card needs its class, attacker or support (card_combat_v2 class; %)', p_att->>'class';
    end if;
  end if;
  for k in select jsonb_array_elements_text(tmech) union all select jsonb_array_elements_text(amech) loop
    perform combat_v2_mech(p_b, null, k);
  end loop;
  thp := (p_tgt->>'hp')::numeric; tmax := (p_tgt->>'max')::numeric;
  shield_key := case when side = 'card' then 'guarded' else 'shielded' end;
  -- a target that is down takes nothing and costs no draw
  if coalesce((p_tgt->>'down')::boolean, false) or thp <= 0 then
    return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', false, 'crit', false, 'true_strike', false, 'marked', false,
      'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', greatest(thp, 0), 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
      'down', true, 'heal', 0, 'lost', 0, 'draws', used);
  end if;

  if side = 'card' then
    -- ---------------------------------------------------------------- a card hits an enemy (simulator Battle.cardHit)
    ab := coalesce((p_att->>'abl')::numeric, 1);
    x := coalesce((ctx->>'x')::numeric,
                  case when coalesce((ctx->>'basic')::boolean, false) then
                    case when role = 'artillery' then (ro->'artillery'->>'basic_x')::numeric
                         when p_att->>'class' = 'support' then (p_b->'v2_support'->>'basic_x')::numeric end end, 1);
    -- Mirror Hide: a second strike, a splash or an area hit
    if ctx->>'kind' is not null and tmech ? 'mirror_hide' then
      mp := combat_v2_mech(p_b, p_tgt, 'mirror_hide');
      mx := case when ctx->>'kind' = 'extra' then (mp->>'extra_x')::numeric else (mp->>'splash_x')::numeric end;
      if mx = 0 then
        return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', false, 'crit', false, 'true_strike', false, 'marked', false, 'mirrored', true,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'lost', 0, 'draws', used);
      end if;
      x := x * mx;
    end if;
    ts := coalesce((ctx->>'true_strike')::boolean, false)
          or (coalesce((ctx->>'basic')::boolean, false) and role = 'artillery' and coalesce((ro->'artillery'->>'true_strike')::boolean, false));
    s := combat_v2_status_on(p_tgt, 'mark', clk); marked := s is not null;
    -- 1. miss (the target's evasion + its timed evade)
    if not ts and not marked then
      chance := greatest(0, (h->>'miss')::numeric + coalesce((p_tgt->>'evasion')::numeric, 0) + coalesce((combat_v2_timed(p_tgt, 'evade', clk))::text::numeric, 0)
                + case when combat_v2_status_on(p_att, 'blinded', clk) is not null then (ss->'blinded'->>'miss')::numeric else 0 end
                - coalesce((p_att->>'acc')::numeric, 0));
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'lost', 0, 'draws', used);
      end if;
    end if;
    -- 2. the roll
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    -- 3. crit (Ironhide, E7 tuning: unless Marked, the crit chance is x ironhide.crit_x; 0 = no crit and no draw)
    ihx := case when tmech ? 'ironhide' and not marked then coalesce((combat_v2_mech(p_b, p_tgt, 'ironhide')->>'crit_x')::numeric, 0) else 1 end;
    can_crit := ihx > 0;
    foc := coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'value')::numeric, 0);
    critc := coalesce((p_att->>'crt')::numeric, 0) + coalesce((ctx->>'crit_add')::numeric, 0) + coalesce((ctx->>'crit_bonus')::numeric, 0) + foc
             + case when role = 'striker' then (ro->'striker'->>'crit_add')::numeric * ab else 0 end;
    critc := least((st->'crt'->>'cap')::numeric + foc, critc) * ihx;
    if can_crit then
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      crit := d < critc;
    end if;
    if crit then
      mult := mult * (coalesce((p_att->>'crd')::numeric, (st->'crd'->>'base')::numeric) + case when role = 'striker' then (ro->'striker'->>'critx_add')::numeric * ab else 0 end
                         + coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'crd')::numeric, 0));
    end if;
    -- 4. the multipliers (Empowered x Dispeller x the timed emp_x of the target)
    s := combat_v2_status_on(p_att, 'empowered', clk);
    if s is not null then
      mult := mult * (1 + (s->>'value')::numeric * case when tmech ? 'dispeller' then (combat_v2_mech(p_b, p_tgt, 'dispeller')->>'x')::numeric else 1 end
                          * coalesce((combat_v2_timed(p_tgt, 'emp_x', clk))::text::numeric, 1));
    end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    if marked then mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'mark', clk)->>'value')::numeric, 0)); end if;
    bonus := coalesce((ctx->>'bonus')::numeric, 0);
    if role = 'finisher' and thp / tmax < (ro->'finisher'->>'line')::numeric then bonus := bonus + (ro->'finisher'->>'bonus')::numeric * ab; end if;
    if role = 'cleaver' and (ctx->>'foes_alive')::int = 1 then bonus := bonus + (ro->'cleaver'->>'hunt_bonus')::numeric * ab; end if;
    -- the "Weak to: role" week of the target
    if p_tgt->>'weak_role' is not null and p_tgt->>'weak_role' = role then
      bonus := bonus + coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, (en->>'weak_role_x')::numeric);
    end if;
    mult := mult * (1 + bonus);
    if coalesce((ctx->>'vs_x')::numeric, 0) <> 0 then mult := mult * (ctx->>'vs_x')::numeric; end if;
    -- SYN (plan 7.3, 7.5): the squad factors of the card (combat_v2_synergy; a card with no syn has 1) and the element chart (the target's
    -- element is in the card's tags.beats, the element_counters list): mult x elem_x x set_x x chart. A factor of 1 leaves mult as it is.
    fx := coalesce((p_att->'syn'->>'elem_x')::numeric, 1) * coalesce((p_att->'syn'->>'set_x')::numeric, 1);
    chart := p_tgt->>'element' is not null and coalesce(p_att->'tags'->'beats' ? (p_tgt->>'element'), false);
    if chart then fx := fx * (p_b->'v2_synergy'->'chart'->>'bonus')::numeric; end if;
    if fx <> 1 then mult := mult * fx; end if;
    -- 5. Pierce and shield break (the Breaker passive)
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when role = 'breaker' then (ro->'breaker'->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when role = 'breaker' then (ro->'breaker'->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  else
    -- ---------------------------------------------------------------- an enemy hits a card (simulator Battle.enemyHit)
    x := coalesce((ctx->>'x')::numeric, 1);
    ts := coalesce((ctx->>'true_strike')::boolean, false) or amech ? 'true_strike';
    -- 1. Blinded
    if combat_v2_status_on(p_att, 'blinded', clk) is not null then
      chance := (ss->'blinded'->>'miss')::numeric;
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'lost', 0, 'draws', used);
      end if;
    end if;
    -- 2. Dodge (single hits; area hits x area_x)
    if not ts then
      chance := greatest(0, coalesce((p_tgt->>'ddg')::numeric, 0) * (1 - coalesce((p_att->>'keen')::numeric, 0))
                * case when coalesce((ctx->>'area')::boolean, false) then (st->'ddg'->>'area_x')::numeric else 1 end);
      if chance > 0 then
        d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
        if d < chance then
          return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', true, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
            'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
            'down', false, 'heal', 0, 'lost', 0, 'draws', used);
        end if;
      end if;
    end if;
    -- Swarm: an area hit on a support card
    if coalesce((ctx->>'area')::boolean, false) and amech ? 'swarm' and p_tgt->>'class' = 'support' then x := x * (combat_v2_mech(p_b, p_att, 'swarm')->>'x')::numeric; end if;
    -- 3. the roll and the enemy multipliers
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    s := combat_v2_status_on(p_att, 'enraged', clk);
    if s is not null then mult := mult * (s->>'value')::numeric; end if;
    if ctx->>'mode' = 'hunt' and coalesce((p_att->>'hp')::numeric / nullif((p_att->>'max')::numeric, 0) < (bm->>'rage_at')::numeric, false) then
      mult := mult * (bm->>'rage_x')::numeric;
    end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    -- Pack: + atk_per_foe for each standing enemy
    if amech ? 'pack' then mult := mult * (1 + (combat_v2_mech(p_b, p_att, 'pack')->>'atk_per_foe')::numeric * coalesce((ctx->>'foes_alive')::numeric, 0)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    -- 4. Sunder and Shatter (the unit's own params count)
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when amech ? 'sunder' then (combat_v2_mech(p_b, p_att, 'sunder')->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when amech ? 'shatter' then (combat_v2_mech(p_b, p_att, 'shatter')->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  end if;

  -- ---------------------------------------------------------------- the damage (simulator Battle.damage)
  shield := coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0);
  brood := coalesce((p_tgt->>'brood')::int, 0); brood_after := brood;
  if raw > 0 then
    a := raw * (1 - coalesce((p_tgt->>'def')::numeric, 0) * (1 - least(1, pierce)));
    if side = 'enemy' and coalesce((ctx->>'warden')::boolean, false) then a := a * (1 - (ro->'warden'->>'ally_dr')::numeric); end if;
    -- Steadfast and Brood (an enemy target)
    if tmech ? 'steadfast' then
      mp := combat_v2_mech(p_b, p_tgt, 'steadfast');
      lim := coalesce((combat_v2_timed(p_tgt, 'steadfast_kinds', clk))::text::numeric, (mp->>'kinds')::numeric);
      if combat_v2_neg_kinds(p_tgt, clk, p_b) < lim then a := a * (1 - (mp->>'dr')::numeric); end if;
    end if;
    if brood > 0 then
      a := a * (1 - (combat_v2_mech(p_b, p_tgt, 'brood')->>'dr')::numeric * brood);
      if side = 'card' and role = 'cleaver' then brood_after := brood - 1; end if;
    end if;
    a := greatest((h->>'min_dmg')::numeric, a);
    if shield > 0 and not coalesce((ctx->>'ignore_shield')::boolean, false) then
      absorbed := least(a, shield / sx);
      shield := greatest(0, shield - absorbed * sx);
      a := a - absorbed;
    end if;
    hp_loss := least(thp, a);
  end if;
  if side = 'card' and role = 'survivor' and absorbed + hp_loss > 0 then
    heal := least((ro->'survivor'->>'lifesteal')::numeric * ab * (absorbed + hp_loss),
                  (ro->'survivor'->>'cap_maxhp')::numeric * ab * coalesce((p_att->>'max')::numeric, 0));
  end if;
  return jsonb_build_object('side', side, 'hit', true, 'miss', false, 'dodged', false, 'crit', crit, 'true_strike', ts, 'marked', marked,
    'chance', chance, 'crit_chance', case when side = 'card' and can_crit then critc else 0 end, 'roll', roll, 'raw', raw, 'pierce', pierce, 'shield_x', sx,
    'dmg', absorbed + hp_loss, 'absorbed', absorbed, 'shield_after', shield, 'hp_loss', hp_loss, 'hp_after', greatest(0, thp - hp_loss),
    'down', thp - hp_loss <= 0, 'heal', heal, 'lost', absorbed * sx, 'draws', used, 'chart', chart)
    || case when brood > 0 then jsonb_build_object('brood_after', brood_after) else '{}'::jsonb end;
end $function$;

create or replace function public.combat_effect_v2_active(p_state jsonb, p_actor jsonb, p_target jsonb, p_ally jsonb, p_draws jsonb, p_b jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  ro jsonb := p_b->'v2_roles'; ss jsonb := p_b->'v2_status'; s jsonb := p_state; u jsonb; role text; cls text; ab numeric; clk int;
  d jsonb := p_draws; used jsonb := '[]'::jsonb; dv numeric; r jsonb; w jsonb; h jsonb; hits jsonb := '[]'::jsonb;
  blocks jsonb; blk jsonb; k text; tu jsonb; ch numeric; lst text[]; id text; ref jsonb; t jsonb; cured jsonb; st jsonb;
  x numeric := 1; ns int := 1; crit_add numeric := 0; pierce numeric := 0; ts boolean := false; bonus numeric := 0; crit_bonus numeric := 0; shield_x numeric := 1;
  vs_x numeric; area numeric := 0; steal numeric := 0; steal_to text; guard numeric := 0; riders jsonb := '[]'::jsonb; oncrit jsonb := '[]'::jsonb; onkill jsonb := '[]'::jsonb;
  ctx jsonb; dealt numeric := 0; i int; n int; cr numeric; amt numeric; smite_x numeric := 0; area_x numeric := 0; svs numeric := 1; sbonus numeric := 0; scrit numeric := 0;
  stk numeric; tot numeric; refhp numeric; foes int; keys jsonb; att jsonb; am jsonb; al jsonb; alu jsonb; op jsonb; nx jsonb; apath text[]; tpath text[]; cnt numeric;
  pays jsonb := '[]'::jsonb; abonus numeric; acrit numeric; au jsonb; mp jsonb; post jsonb := '[]'::jsonb;
  sa numeric := 1; sf numeric := 1;
begin
  apath := combat_v2_unit_path(s, p_actor); tpath := combat_v2_unit_path(s, p_target);
  u := s #> apath; role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1); clk := (s->>'clock')::int;
  blocks := combat_effect_v2_blocks(u, p_b); n := jsonb_array_length(blocks);
  if n = 0 then raise exception 'combat_v2_card_act: card % has no active (active.blocks)', p_actor->>'id'; end if;
  for blk in select x2 from jsonb_array_elements(blocks) x2 loop
    k := blk->>'k';
    if p_b->'blocks'->k is null or p_b->'blocks'->k->>'reserved' is not null then raise exception 'combat_v2_card_act: the block % is not built', k; end if;
    if not p_b->'blocks'->k->'classes' ? cls then raise exception 'combat_v2_card_act: the block % is not for a %', k, cls; end if;
  end loop;
  tu := s #> tpath;
  if cls = 'attacker' then
    -- Confused: the active may hit a unit of its own side (for x confused.self_x of its power)
    w := combat_v2_confused_target(s, p_actor, d, p_b);
    used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
    if (w->>'wrong')::boolean then
      r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * (w->>'x')::numeric, null, p_b);
      return jsonb_build_object('state', r->'state', 'hits', jsonb_build_array(jsonb_build_object('target', w->'target', 'confused', true, 'dmg', r->'dmg')), 'draws', used);
    end if;
    -- the shape of the hits (ABL raises each amount); an attachment is read with its host, a gate that does not hold turns its host off
    for i in 0 .. n - 1 loop
      blk := blocks->i; k := blk->>'k';
      continue when p_b->'blocks'->k->>'attach' is not null;
      att := case when p_b->'blocks'->(blocks->(i + 1)->>'k')->>'attach' is not null then blocks->(i + 1) end;
      continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);
      if k = 'hit' then x := 1 + ((blk->>'x')::numeric - 1) * ab;
      elsif k = 'strikes' then ns := (blk->>'n')::int; x := (1 + (ns * (blk->>'x')::numeric - 1) * ab) / ns;
      elsif k = 'crit_add' then crit_add := crit_add + (blk->>'v')::numeric * ab;
      elsif k = 'pierce' then pierce := greatest(pierce, (blk->>'v')::numeric);
      elsif k = 'true_strike' then ts := true;
      elsif k = 'area' then area := (blk->>'x')::numeric * ab;
      elsif k = 'payoff_dmg' then if combat_effect_v2_holds(tu, blk, clk, p_b) then bonus := bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
      elsif k = 'payoff_crit' then if combat_effect_v2_holds(tu, blk, clk, p_b) then crit_bonus := crit_bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
      elsif k = 'per_stack' then bonus := bonus + (blk->>'v')::numeric * ab * coalesce((combat_v2_status_on(tu, blk->>'status', clk)->>'stacks')::numeric, 0);
      elsif k = 'per_kind' then bonus := bonus + (blk->>'v')::numeric * ab * combat_effect_v2_count(tu, null, null, clk, p_b);
      elsif k = 'per_ally' then
        bonus := bonus + (blk->>'v')::numeric * ab
                 * (select count(*) from combat_v2_units(s) q where q.side = 'card' and q.id <> p_actor->>'id' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker');
      elsif k = 'vs_status' then if combat_effect_v2_holds(tu, blk, clk, p_b) then vs_x := (blk->>'x')::numeric; end if;
      elsif k = 'execute' then
        if (tu->>'hp')::numeric / (tu->>'max')::numeric < (blk->>'line')::numeric
           or exists (select 1 from jsonb_array_elements(blocks) y where y->>'k' = 'line_status' and combat_effect_v2_holds(tu, y, clk, p_b)) then
          bonus := bonus + (blk->>'v')::numeric * ab;
        end if;
      elsif k = 'lifesteal' then steal := (blk->>'v')::numeric * ab; steal_to := blk->>'to';
      elsif k = 'guard_up' then guard := (blk->>'v')::numeric * ab;
      elsif k = 'shield_break' then shield_x := (blk->>'x')::numeric;
      elsif k in ('apply', 'random_apply') then riders := riders || jsonb_build_array(blk);
      elsif k = 'on_crit' then oncrit := oncrit || jsonb_build_array(blk);
      elsif k = 'on_kill' then onkill := onkill || jsonb_build_array(blk);
      -- Set 2 part (b): support blocks on an attacker. dispel strips the target when its block comes (before the hits; a later payoff reads the stripped
      -- target); heal_all and quicken (self) run after the hits, with no crit roll (the hits have their own)
      elsif k = 'dispel' then s := combat_v2_status_strip(s, p_target, null, p_b)->'state';
      elsif k in ('heal_all', 'quicken') then post := post || jsonb_build_array(blk);
      end if;
    end loop;
    -- one enemy left: the area adds its share to the main hit (v2_roles.cleaver.hunt_area_x, the plan rule for an area active)
    select count(*) into foes from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int));
    if foes = 1 and area > 0 then bonus := bonus + area * (ro->'cleaver'->>'hunt_area_x')::numeric; area := 0; end if;
    -- Mirror Hide: each strike of a multi-strike active x mirror_hide.strikes_x
    if ns > 1 and coalesce(tu->'mechanics' ? 'mirror_hide', false) then x := x * (combat_v2_mech(p_b, tu, 'mirror_hide')->>'strikes_x')::numeric; end if;
    ctx := jsonb_build_object('x', x, 'crit_add', crit_add, 'crit_bonus', crit_bonus, 'bonus', bonus, 'pierce', pierce, 'shield_x', shield_x, 'true_strike', ts)
           || case when vs_x is not null then jsonb_build_object('vs_x', vs_x) else '{}'::jsonb end;
    for i in 1 .. ns loop
      exit when not combat_v2_up(s #> tpath);
      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      dealt := dealt + (h->>'dmg')::numeric;
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
      -- the riders draw AFTER the hit (plan 6.2): each one draws its chance (ABL raises a chance below one), then (random_apply) its pick, then its status draws
      if not (h->>'miss')::boolean then
        for blk in select x2 from jsonb_array_elements(riders) x2 loop
          ch := coalesce((blk->>'chance')::numeric, 1);
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
            if blk->>'k' = 'random_apply' then
              dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
              op := blk->'options'->(floor(dv * jsonb_array_length(blk->'options'))::int);
              r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            else
              r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            end if;
            s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
          end if;
        end loop;
      end if;
      -- the trigger on_crit: after a crit
      if (h->>'crit')::boolean then
        for blk in select x2 from jsonb_array_elements(oncrit) x2 loop
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          if dv < (blk->>'chance')::numeric then
            r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance') || jsonb_build_object('src', p_actor)
                                        || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
          end if;
        end loop;
      end if;
      -- the trigger on_kill: the target is down after this hit and its riders: a chance to put the status on the next standing enemy
      if jsonb_array_length(onkill) > 0 and not combat_v2_up(s #> tpath) then
        nx := (select jsonb_build_object('side', 'enemy', 'id', q.id::numeric) from combat_v2_units(s) q
                where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n limit 1);
        if nx is not null then
          for blk in select x2 from jsonb_array_elements(onkill) x2 loop
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            if dv < (blk->>'chance')::numeric then
              r := combat_v2_status_apply(s, nx, blk->>'status', (blk - 'k' - 'status' - 'chance') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
              s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
            end if;
          end loop;
        end if;
      end if;
    end loop;
    -- the area hits (all_enemies): every other standing enemy, the same shape at x = area (no vs_x); the riders with all. T1b (recommendation 5): the
    -- payoffs count on each area hit against THAT enemy's statuses (before its hit): payoff_dmg is its bonus, payoff_crit its crit bonus
    if area > 0 then
      lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
      foreach id in array lst loop
        ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
        au := s->'enemies'->(id::int); abonus := 0; acrit := 0;
        for blk in select x2 from jsonb_array_elements(pays) x2 loop
          if combat_effect_v2_holds(au, blk, clk, p_b) then
            if blk->>'k' = 'payoff_dmg' then abonus := abonus + (blk->>'v')::numeric * ab; else acrit := acrit + (blk->>'v')::numeric * ab; end if;
          end if;
        end loop;
        r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', abonus, 'crit_bonus', acrit, 'kind', 'area'), d, p_b);
        s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
        dealt := dealt + (h->>'dmg')::numeric;
        hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
        if not (h->>'miss')::boolean then
          for blk in select x2 from jsonb_array_elements(riders) x2 where coalesce((x2->>'all')::boolean, false) loop
            ch := (blk->>'chance')::numeric;
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
              r := combat_v2_status_apply(s, ref, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
              s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
            end if;
          end loop;
        end if;
      end loop;
    end if;
    if steal > 0 and dealt > 0 then
      t := case when steal_to is null then p_actor else combat_effect_v2_ally_to(s, steal_to) end;
      if t is not null then s := combat_v2_heal(s, t, steal * dealt, p_b)->'state'; end if;
    end if;
    if guard > 0 and dealt > 0 then s := combat_v2_status_apply(s, p_actor, 'shielded', jsonb_build_object('value', guard * dealt), p_b)->'state'; end if;
    -- Set 2 part (b): heal_all (every standing ally in the fixed order, incl. this card) and quicken (this card), after the hits, no crit roll
    for blk in select x2 from jsonb_array_elements(post) x2 loop
      if blk->>'k' = 'heal_all' then
        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
          s := combat_v2_heal(s, jsonb_build_object('side', 'card', 'id', id::numeric), (blk->>'v')::numeric * ab * (s->'cards'->id->>'max')::numeric, p_b)->'state';
        end loop;
      else
        s := combat_v2_status_apply(s, p_actor, 'quickened', jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';
      end if;
    end loop;
    s := combat_v2_status_remove(s, p_actor, 'empowered', p_b)->'state';
    s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
    return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
  end if;
  -- SYN (plan 7.2, 7.5): the support factors of combat_v2_synergy (1 with no syn). sa = aff_x: every amount, the focus crd, smite_x, area_x and the
  -- value of an apply or random_apply status. sf = aff_x x set_x: the amounts that are not a hit (the hit core puts set_x on the smite and the area).
  -- Stacks, chances, picks, durations and draws do not change. A factor of 1 is the number 1 (the same numbers as before).
  sa := coalesce((u->'syn'->>'aff_x')::numeric, 1); sf := sa * coalesce((u->'syn'->>'set_x')::numeric, 1);
  if sa = 1 then sa := 1; end if;
  if sf = 1 then sf := 1; end if;
  -- a support: the blocks in order. An attachment works with its host (a gate turns it off; coin draws first, then the crit roll).
  -- A crit roll (crt -> crd) for each shield, heal, empower and rally block and for an Expose, Weaken or Mark.
  for i in 0 .. n - 1 loop
    blk := blocks->i; k := blk->>'k';
    continue when p_b->'blocks'->k->>'attach' is not null;
    att := case when p_b->'blocks'->(blocks->(i + 1)->>'k')->>'attach' is not null then blocks->(i + 1) end;
    u := s #> apath; tu := s #> tpath;
    continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);
    -- the ally of a single-ally block: its "to" target, else opts.ally (none for strongest = the block does nothing, no draw)
    al := null;
    if k in ('shield', 'heal', 'empower', 'focus', 'cure') or (k = 'quicken' and not coalesce((blk->>'all')::boolean, false)) then
      if blk->>'to' in ('most_hurt', 'strongest') then
        al := combat_effect_v2_ally_to(s, blk->>'to');
        continue when al is null;
      else
        if jsonb_typeof(p_ally) is distinct from 'object' or p_ally->>'side' is distinct from 'card' then
          raise exception 'combat_v2_card_act: the block % needs opts.ally ({side: card, id})', k;
        end if;
        perform combat_v2_unit_path(s, p_ally);
        al := p_ally;
        if k = 'shield' and blk->>'to' = 'cured' and cured is not null and combat_v2_up(s #> combat_v2_unit_path(s, cured)) then al := cured; end if;
      end if;
    end if;
    alu := case when al is not null then s #> combat_v2_unit_path(s, al) end;
    -- the amount with the attachment (coin draws here), then the crit roll
    if k in ('shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally', 'focus', 'quicken') then
      am := combat_effect_v2_amount(blk, att, tu, alu, clk, d, p_b);
      used := used || (am->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(am->'draws')); amt := (am->>'v')::numeric * sf;
    end if;
    if k in ('shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally') then
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
    end if;
    if k = 'shield' then
      s := combat_v2_status_apply(s, al, 'shielded', jsonb_build_object('value', amt * ab * cr * (alu->>'max')::numeric), p_b)->'state';
    elsif k in ('shield_all', 'heal_all') then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        ref := jsonb_build_object('side', 'card', 'id', id::numeric);
        s := case when k = 'shield_all' then combat_v2_status_apply(s, ref, 'shielded', jsonb_build_object('value', amt * ab * cr * (s->'cards'->id->>'max')::numeric), p_b)->'state'
                  else combat_v2_heal(s, ref, amt * ab * cr * (s->'cards'->id->>'max')::numeric, p_b)->'state' end;
      end loop;
    elsif k = 'heal' then
      s := combat_v2_heal(s, al, amt * ab * cr * (alu->>'max')::numeric, p_b)->'state';
    elsif k = 'cleanse' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        s := combat_v2_status_cure(s, jsonb_build_object('side', 'card', 'id', id::numeric), null, 0, p_b)->'state';
      end loop;
    elsif k = 'cure' then
      keys := case when blk->'statuses' = '["all"]'::jsonb then null else blk->'statuses' end;
      r := combat_v2_status_cure(s, al, keys, (blk->>'immune')::int, p_b); s := r->'state';
      cured := al;
      -- Rot (a timed state of a standing enemy): a cure that removed a status also removes the boosts and the shield of the cured ally
      if (r->>'cured')::int > 0 and combat_v2_timed_any(s, 'rot') is not null then s := combat_v2_status_strip(s, al, null, p_b)->'state'; end if;
    elsif k = 'empower' then
      s := combat_v2_status_apply(s, al, 'empowered', jsonb_build_object('value', amt * ab * cr, 'src', p_actor), p_b)->'state';
    elsif k = 'rally' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'empowered', jsonb_build_object('value', amt * ab * cr, 'src', p_actor), p_b)->'state';
      end loop;
    elsif k = 'focus' then
      s := combat_v2_status_apply(s, al, 'focused', jsonb_build_object('value', amt * ab, 'src', p_actor)
                                  || case when blk ? 'crd' then jsonb_build_object('crd', (blk->>'crd')::numeric * ab * sf) else '{}'::jsonb end, p_b)->'state';
    elsif k = 'quicken' then
      if coalesce((blk->>'all')::boolean, false) then
        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
          s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'quickened', jsonb_build_object('value', 1 + amt * ab, 'src', p_actor), p_b)->'state';
        end loop;
      else
        s := combat_v2_status_apply(s, al, 'quickened', jsonb_build_object('value', 1 + amt * ab, 'src', p_actor), p_b)->'state';
      end if;
    elsif k = 'dispel' then s := combat_v2_status_strip(s, p_target, null, p_b)->'state';
    elsif k = 'smite' then smite_x := (blk->>'x')::numeric * ab * sa;
    elsif k = 'area' then area_x := (blk->>'x')::numeric * ab * sa;
    elsif k = 'vs_status' then if combat_effect_v2_holds(tu, blk, clk, p_b) then svs := (blk->>'x')::numeric; end if;
    elsif k = 'payoff_dmg' then if combat_effect_v2_holds(tu, blk, clk, p_b) then sbonus := sbonus + (blk->>'v')::numeric * ab; end if;
    elsif k = 'crit_add' then scrit := scrit + (blk->>'v')::numeric * ab;
    elsif k = 'consume' then
      -- Detonate: every Burn tick left at once, x times (x (1 + Exposed)), a tick that ignores shields; then the Burn ends
      st := combat_v2_status_on(tu, blk->>'status', clk);
      if st is not null and combat_v2_up(tu) then
        refhp := case when s->>'mode' = 'hunt' then (ss->>'hunt_ref_hp')::numeric else (tu->>'max')::numeric end;
        stk := coalesce((st->>'stacks')::numeric, 0); tot := 0;
        while stk > 0 loop
          tot := tot + stk * (ss->'poison'->>'tick')::numeric * (ss->'burn'->>'tick_x')::numeric * refhp;
          stk := stk - (ss->'burn'->>'decay')::numeric;
        end loop;
        s := combat_v2_status_remove(s, p_target, blk->>'status', p_b)->'state';
        r := combat_v2_damage(s, p_target, tot * (blk->>'x')::numeric * (1 + coalesce((combat_v2_status_on(tu, 'exposed', clk)->>'value')::numeric, 0)),
                              jsonb_build_object('tick', true, 'ignore_shield', true) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || coalesce(r->'draws', '[]'::jsonb); d := combat_v2_draws_rest(d, jsonb_array_length(coalesce(r->'draws', '[]'::jsonb)));
      end if;
    elsif k = 'apply' then
      ch := (blk->>'chance')::numeric;
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
        amt := null; cnt := 1;
        if blk ? 'value' then
          am := combat_effect_v2_amount(blk, att, tu, null, clk, d, p_b);
          used := used || (am->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(am->'draws'));
          if blk ? 'per' then cnt := combat_effect_v2_count(tu, case when blk->>'per' = 'kinds' then null else blk->>'per' end, blk->>'status', clk, p_b); end if;
        end if;
        if cnt > 0 then
          if blk ? 'value' then
            cr := 1;
            if p_b->'stacking'->>(blk->>'status') in ('add_cap', 'higher') then
              dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
              cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
            end if;
            amt := (am->>'v')::numeric * cnt * ab * cr * sf;
          end if;
          r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all' - 'value' - 'per')
                                      || case when amt is not null then jsonb_build_object('value', amt) else '{}'::jsonb end
                                      || jsonb_build_object('src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
          s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
        end if;
      end if;
    elsif k = 'random_apply' then
      ch := coalesce((blk->>'chance')::numeric, 1);
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
        dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
        op := blk->'options'->(floor(dv * jsonb_array_length(blk->'options'))::int);
        r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status') || jsonb_build_object('src', p_actor)
                                    || case when op ? 'value' then jsonb_build_object('value', (op->>'value')::numeric * sf) else '{}'::jsonb end
                                    || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end if;
    end if;
  end loop;
  -- the smite last: on the enemy (a true strike, x vs_status, + a support payoff, + a support crit chance), the area value on every other standing enemy;
  -- one enemy: + area_one_foe_x of the area
  if area_x > 0 and smite_x = 0 then raise exception 'combat_v2_card_act: an area block of a support needs a smite block'; end if;
  lst := case when area_x > 0 then array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n)
              else '{}'::text[] end;
  if area_x > 0 and cardinality(lst) = 0 then smite_x := smite_x + area_x * (p_b->'v2_support'->>'area_one_foe_x')::numeric; end if;
  if smite_x > 0 and combat_v2_up(s #> tpath) then
    -- the enemy rules of a smite (the simulator smite): Rollback (x rollback.smite_x), Desync (timed desync_smite: the smite misses and the state ends),
    -- Mirror (timed mirror_smite: the smite hits its caster for its atk x the smite x vs_status, and the state ends); else the hit, the Mark ends, last_smite
    tu := s #> tpath;
    if coalesce(tu->'mechanics' ? 'rollback', false) then smite_x := smite_x * (combat_v2_mech(p_b, tu, 'rollback')->>'smite_x')::numeric; end if;
    if combat_v2_timed(tu, 'desync_smite', clk) is not null then
      s := jsonb_set(s, tpath, jsonb_set(tu, '{timed}', (tu->'timed') - 'desync_smite'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', 0, 'crit', false, 'miss', true, 'desync', true));
    elsif combat_v2_timed(tu, 'mirror_smite', clk) is not null then
      s := jsonb_set(s, tpath, jsonb_set(tu, '{timed}', (tu->'timed') - 'mirror_smite'));
      r := combat_v2_damage(s, p_actor, (u->>'atk')::numeric * smite_x * svs, case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || coalesce(r->'draws', '[]'::jsonb); d := combat_v2_draws_rest(d, jsonb_array_length(coalesce(r->'draws', '[]'::jsonb)));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_actor, 'dmg', r->'dmg', 'crit', false, 'miss', false, 'mirrored', true));
    else
      r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs, 'bonus', sbonus, 'crit_add', scrit), d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
      s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
      s := jsonb_set(s, tpath || '{last_smite}'::text[], to_jsonb((h->>'dmg')::numeric));
    end if;
  end if;
  foreach id in array lst loop
    ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
    r := combat_effect_v2_hit(s, p_actor, ref, jsonb_build_object('x', area_x, 'true_strike', true, 'kind', 'area'), d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
  end loop;
  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
end $function$;

-- ============================================================ 6. server only
do $s$
declare f text;
begin
  foreach f in array array['combat_v2_card_tags(bigint)', 'combat_v2_synergy(jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $s$;
comment on function public.combat_v2_card_tags(bigint) is $cm$[combat] Combat v2 synergy (plan 7.1, item SYN): the rule tags of a card {element, family, piece, beats}: element = card_element(tag_slugs), family = the first origin: slug, piece = the subject key when the subject has the slug of a set of v2_synergy.sets, beats = the element_counters targets of the element (no proposal). No label tag. Reads only. combat_v2_synergy.sql.$cm$;
comment on function public.combat_v2_synergy(jsonb, jsonb) is $cm$[combat] Combat v2 synergy (plan 7.2, 7.3, 7.5, item SYN): the fight state with syn {elem_n, elem_x, aff_tag, aff_n, aff_x, set_n, set_x} on every card (the squad = state.cards, standing or down; numbers = balance v2_synergy). Called once when a fight state is built. A card with no tags has every factor 1. Pure: draws no random number. combat_v2_synergy.sql.$cm$;
comment on function public.combat_v2_card_unit(bigint, jsonb) is $cm$[combat] Combat v2 Gauntlet (plan 3.3, 20.15 R1a, SYN): the v2 unit of a card at 0 stars, level 0 and no points (the Gauntlet has no progress): the role and the blocks of subjects.ability_v2, the stats of card_combat_v2, the speed of the role (v2_speed.role_base), the charge at the start (v2_charge.start), no status, meter 0 (the caller draws the meters of a room), and the rule tags (combat_v2_card_tags). The unit of the Admin Combat v2 Lab. Refuses a card with no ability_v2 with the SQLSTATE no_data_found (decision D2: the player plays v1; never a placeholder). Reads only. combat_v2_gauntlet_builders.sql, combat_v2_synergy.sql.$cm$;
comment on function public.gauntlet_v2_foes(jsonb, integer, integer, jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1a, SYN): the v2 foes of one room of a Gauntlet week: each week foe (dungeon_make_foe) becomes combat_v2_dungeon_foe(key, floor, room, kind) with no extra mechanic, plus its element (a rule tag: the element chart, plan 7.3) and show {name, model, element} for the screen. No v1 number or rule (hp, atk, weak, resist, passives) enters the v2 unit. Refuses an empty list and a foe with no key or kind. Reads only. combat_v2_gauntlet_builders.sql, combat_v2_synergy.sql.$cm$;
