-- combat_v2_power.sql (2026-10-22): combat v2, phase 4, PR E9: the Power number (docs/combat-redesign-plan.md 2.5, decision 3 of section 15, 14.1 row E9,
-- section 20.6).
-- Needs combat_v2_auto.sql (E8) first, and so the tester list, E7c, E7b, E7, T1c, T1b, T1, E6, E5, E4, E3, E2, E1 and V1.
-- Before: balance v2_power (V1) held the plan 2.5 formula numbers with k = 1 for every role ("not fitted yet"); no function read it. The Hunt auto-pick
-- (E8) scored a card by its offense only (attack x crit factor x speed). The v1 numbers (card_powers, hunt_squad_value) stay as they are.
-- After this file (the reference is the simulator card-studio/v2sim/power.mjs: cardPower, squadValue; auto.mjs autoPick):
--   BALANCE v2_power: + value (decision 3: the share of the PP of the smite, dot and control blocks of a support active that counts in its Offense) and
--     scale; k = the fitted role scale. Measured by node card-studio/v2sim/run.mjs power (plan 20.6). config.json v2_power has the same value (the test
--     compares them). balance_v2_spec (replaced: the text of combat_v2_testers.sql + the leaves value and scale) gives the fixed shape and the limits.
--   card_power_v2(card, blocks, numbers) (STABLE: it reads the statuses table and, with no numbers argument, balance): the Power number of ONE card from
--     card_combat_v2 (the stats, the support factor F, the extra stack) and the BASE blocks of its active:
--       crit factor cx = 1 + crt x (crd - 1); hit chance h = 1 - max(0, v2_hit.miss + v2_enemy.hunt.Heroic.evasion - acc)
--       attacker Offense = atk x cx x h x spd x (1 + abl_x x (abl - 1))
--       support  Offense = (v2_support.basic_x x atk x h + support_abl_ref x F x abl + F x abl x atk x u x V) x cx x spd,
--                V = value.smite x PP(smite blocks) + value.dot x PP(dot blocks) + value.control x PP(control blocks), u = 1 / (support_pp.smite x sup_cycle)
--       Survival = hp / (1 - def) / (1 - ddg_x x ddg); Power = Offense x Survival x k[role] x scale; the card shows round(Power).
--     The PP of each block = ability_v2_pps (the price list of plan 5.2) on the blocks with the extra stack. The families (card_power_v2_families): smite =
--     smite, area, vs_status, payoff_dmg, crit_add, consume of a support; dot / control = a status block (apply, on_crit, on_kill; random_apply when every option is in
--     one family) of a status of the statuses family dot or control; an attachment counts in the family of its host; the rest is other.
--   card_power_v2(rarity, stars, mod, level, points, role, blocks): the same from the card facts (card_combat_v2, then card_power_v2).
--   combat_v2_squad_value(cards, numbers, auto) (STABLE): the squad value = the sum of power x the pair score of each card in the squad (E8
--     combat_v2_autopick_pair: pair_floor for a payoff card with no maker of its status among the other cards). cards = [{id, role, class, power, blocks}].
--   card_power_v2_numbers(): the numbers that card_power_v2 reads (ability_v2_numbers + v2_power, v2_hit, v2_enemy, v2_support + the status families).
--   combat_v2_autopick (REPLACED, the E8 text + one rule): a pool card may carry its Power number (power); its score uses the Power in place of the offense.
--     A pool card with no power scores as in E8 (the E8 test proves it), so nothing else changes.
-- REPLACED: balance_v2_spec (the v2_power leaves) and combat_v2_autopick (the power of a pool card). No v1 function calls a new or replaced function; the
-- flag combat_v2 stays OFF. Every number is in balance (C1: only 0 and 1 in the bodies). Idempotent: a second run keeps a changed value. Server only.
-- Test: card-studio/scripts/test-combat-v2-power.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).
-- Lab: node card-studio/v2sim/run.mjs power and powerpick.

-- ============================================================ 1. balance: the fixed shape of v2_power (balance_v2_spec, the text of combat_v2_testers.sql + value and scale)
create or replace function public.balance_v2_spec(p_key text) returns jsonb language sql immutable set search_path = public as $fn$
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
$fn$;
comment on function public.balance_v2_spec(text) is $cm$[combat] The fixed shape with the limits of each combat v2 balance key (combat_v2, v2_stats, v2_card_hp, v2_asc, v2_level, card_level, v2_support, v2_speed, v2_charge, v2_hit, v2_roles, v2_status, v2_control, v2_enemy, v2_dungeon, v2_hunt, v2_pp, v2_power); NULL for every other key. A new v2 leaf needs a new spec in this function. The E7 tuning added v2_enemy.mechanics.ironhide.crit_x, venom.chance and slowing.chance (combat_v2_monster_tuning.sql); combat_v2.testers (0 to 20 Discord ids, no id twice): combat_v2_testers.sql; v2_power.value and v2_power.scale (the Power number, PR E9): combat_v2_power.sql.$cm$;

-- @balance-begin (the balance row; test-combat-v2-power.mjs compares it with config.json v2_power)
-- The V1 row has k = 1 and no value or scale: this update fits it ONCE (a row that has value already keeps its numbers, so a second run keeps a change).
select set_config('balance.by', 'nathan', true);
update public.balance set
  value = value || '{"k":{"breaker":0.942,"striker":1.003,"flurry":0.956,"finisher":0.98,"survivor":1.011,"cleaver":1.014,"warden":1.009,"medic":0.951,"controller":1.099,"spotter":0.997,"herald":0.992,"artillery":1.045},"value":{"smite":0.2,"dot":0.175,"control":0.1},"scale":0.00195}'::jsonb,
  note = $n$Combat v2: the Power number of a card (plan 2.5, decision 3; PR E9, combat_v2_power.sql; read by card_power_v2, combat_v2_squad_value and the Hunt auto-pick combat_v2_autopick; no fight reads it). Offense (attacker) = atk x (1 + crt x (crd - 1)) x hit chance x speed x (1 + abl_x x (ABL - 1)); Offense (support) = (v2_support.basic_x x atk x hit chance + support_abl_ref x F x ABL + F x ABL x atk x u x V) x the crit factor x speed, V = value.smite x PP(smite blocks) + value.dot x PP(Poison and Burn blocks) + value.control x PP(control blocks), u = 1 / (v2_pp.support_pp.smite x ability_v2.pp.sup_cycle); the hit chance is against the Heroic boss (v2_hit.miss + v2_enemy.hunt.Heroic.evasion - ACC); Survival = HP / (1 - DEF) / (1 - ddg_x x DDG); Power = Offense x Survival x k[role] x scale, shown rounded. value = the share of the PP of each family that shows in the measured value (fitted on the 42 reference templates, Hunt and Dungeon together). k = the role scale: the measured Hunt value of the role's reference cards / their formula value, / the mean of the roles (node card-studio/v2sim/run.mjs power; target 0.85 to 1.15 before the fit: the E9 formula gives 0.94 to 1.10, the plan 2.5 formula of V1 gave 0.90 to 1.46). scale = the mean Power of a Normal 0-star level-0 card of each placeholder template is 100. Refit k after each balance change (plan 2.5). config.json v2_power has the same value.$n$
where key = 'v2_power' and not (value ? 'value');
-- @balance-end

-- ============================================================ 2. the numbers and the families
create or replace function public.card_power_v2_numbers() returns jsonb language sql stable set search_path = public as $fn$
  select ability_v2_numbers() || combat_v2_numbers(array['v2_power', 'v2_hit', 'v2_enemy', 'v2_support'])
    || jsonb_build_object('status_family', (select coalesce(jsonb_object_agg(s.key, s.family), '{}'::jsonb) from public.statuses s));
$fn$;

-- the family of each block of an active (power.mjs blockFamilies): smite (a support only: an attacker hit is counted by the attacker formula), dot, control or
-- other; an attachment takes the family of its host
create or replace function public.card_power_v2_families(p_class text, p_blocks jsonb, p_b jsonb) returns text[] language plpgsql immutable set search_path = public as $fn$
declare out text[] := '{}'; host text := 'other'; f text; blk jsonb; fs text[];
begin
  for blk in select v from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality q(v, o) order by o loop
    f := 'other';
    if p_b->'blocks'->(blk->>'k')->>'attach' is not null then f := host;
    elsif p_class = 'support' and blk->>'k' in ('smite', 'area', 'vs_status', 'payoff_dmg', 'crit_add', 'consume') then f := 'smite';
    elsif blk->>'k' in ('apply', 'on_crit', 'on_kill') then
      f := case when p_b->'status_family'->>(blk->>'status') in ('dot', 'control') then p_b->'status_family'->>(blk->>'status') else 'other' end;
    elsif blk->>'k' = 'random_apply' then
      select array_agg(distinct case when p_b->'status_family'->>(o->>'status') in ('dot', 'control') then p_b->'status_family'->>(o->>'status') else 'other' end) into fs
        from jsonb_array_elements(case when jsonb_typeof(blk->'options') = 'array' then blk->'options' else '[]'::jsonb end) o;
      f := case when cardinality(fs) = 1 then fs[1] else 'other' end;
    end if;
    out := out || f; host := f;
  end loop;
  return out;
end $fn$;

-- ============================================================ 3. the Power number of one card
create or replace function public.card_power_v2(p_card jsonb, p_blocks jsonb, p_b jsonb default null) returns jsonb language plpgsql stable
set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, card_power_v2_numbers());
  pw jsonb := b->'v2_power'; st jsonb := p_card->'stats'; role text := p_card->>'role'; cls text := p_card->>'class';
  blocks jsonb; fam text[]; pps jsonb; i int; pp jsonb := '{"smite": 0, "dot": 0, "control": 0, "other": 0}';
  cx numeric; hit numeric; f numeric; u numeric; v numeric := 0; off numeric; sur numeric; k numeric; val numeric; s text;
begin
  if pw is null or jsonb_typeof(pw->'value') is distinct from 'object' or jsonb_typeof(pw->'scale') is distinct from 'number' then
    raise exception 'card_power_v2: balance v2_power has no value or scale (apply combat_v2_power.sql)';
  end if;
  if jsonb_typeof(p_card) is distinct from 'object' or not exists (select 1 from public.roles r where r.key = role and r.class = cls) then
    raise exception 'card_power_v2: the card needs a role of roles with its class (card_combat_v2) (%)', coalesce(p_card::text, 'null');
  end if;
  foreach s in array array['atk', 'crt', 'crd', 'acc', 'spd', 'hp', 'def', 'ddg', 'abl'] loop
    if jsonb_typeof(st->s) is distinct from 'number' then raise exception 'card_power_v2: the card has no stat % (card_combat_v2 stats)', s; end if;
  end loop;
  if jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then raise exception 'card_power_v2: blocks must be a list of ability blocks'; end if;
  if cls = 'support' and jsonb_typeof(p_card->'power') is distinct from 'number' then raise exception 'card_power_v2: a support needs its factor F (card_combat_v2 power)'; end if;
  k := (pw->'k'->>role)::numeric;
  -- the blocks with the extra stack of the finish (the fight rule: combat_effect_v2_blocks)
  select coalesce(jsonb_agg(case when jsonb_typeof(x->'stacks') = 'number' then x || jsonb_build_object('stacks', (x->>'stacks')::int + coalesce((p_card->>'extra_stack')::int, 0)) else x end
           order by o), '[]'::jsonb) into blocks
    from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality q(x, o);
  if jsonb_array_length(blocks) > 0 then
    fam := card_power_v2_families(cls, blocks, b); pps := ability_v2_pps(cls, blocks, b);
    for i in 1 .. cardinality(fam) loop
      if jsonb_typeof(pps->(i - 1)) is distinct from 'number' then raise exception 'card_power_v2: block % (%) has no price (ability_v2_pps)', i, p_blocks->(i - 1); end if;
      pp := jsonb_set(pp, array[fam[i]], to_jsonb((pp->>fam[i])::numeric + (pps->>(i - 1))::numeric));
    end loop;
  end if;
  cx := 1 + (st->>'crt')::numeric * ((st->>'crd')::numeric - 1);
  hit := 1 - greatest(0, (b->'v2_hit'->>'miss')::numeric + (b->'v2_enemy'->'hunt'->'Heroic'->>'evasion')::numeric - (st->>'acc')::numeric);
  if cls = 'attacker' then
    off := (st->>'atk')::numeric * cx * hit * (st->>'spd')::numeric * (1 + (pw->>'abl_x')::numeric * ((st->>'abl')::numeric - 1));
  else
    f := (p_card->>'power')::numeric;
    u := 1 / ((b->'v2_pp'->'support_pp'->>'smite')::numeric * (b->'ability_v2'->'pp'->>'sup_cycle')::numeric);
    v := (pw->'value'->>'smite')::numeric * (pp->>'smite')::numeric + (pw->'value'->>'dot')::numeric * (pp->>'dot')::numeric
       + (pw->'value'->>'control')::numeric * (pp->>'control')::numeric;
    off := ((b->'v2_support'->>'basic_x')::numeric * (st->>'atk')::numeric * hit + (pw->>'support_abl_ref')::numeric * f * (st->>'abl')::numeric
            + f * (st->>'abl')::numeric * (st->>'atk')::numeric * u * v) * cx * (st->>'spd')::numeric;
  end if;
  sur := (st->>'hp')::numeric / (1 - (st->>'def')::numeric) / (1 - (pw->>'ddg_x')::numeric * (st->>'ddg')::numeric);
  val := off * sur * k * (pw->>'scale')::numeric;
  return jsonb_build_object('power', round(val)::int, 'value', val, 'offense', off, 'survival', sur, 'k', k, 'scale', (pw->>'scale')::numeric,
    'hit', hit, 'crit_x', cx, 'v', v, 'pp', pp, 'families', to_jsonb(coalesce(fam, '{}'::text[])), 'role', role, 'class', cls);
end $fn$;

create or replace function public.card_power_v2(p_rarity text, p_stars integer, p_mod numeric, p_level integer, p_pts jsonb, p_role text, p_blocks jsonb)
returns jsonb language sql stable set search_path = public as $fn$
  select card_power_v2(card_combat_v2(p_rarity, p_stars, p_mod, p_level, p_pts, p_role), p_blocks, null);
$fn$;

-- ============================================================ 4. the squad value
create or replace function public.combat_v2_squad_value(p_cards jsonb, p_b jsonb default null, p_a jsonb default null) returns jsonb language plpgsql stable
set search_path = public as $fn$
declare
  a jsonb := coalesce(p_a, (select value from public.balance where key = 'auto_v2'));
  cs jsonb := '[]'; ids integer[] := '{}'; x jsonb; c jsonb; pr numeric; total numeric := 0; rows jsonb := '[]';
begin
  if a is null or jsonb_typeof(a->'pick') is distinct from 'object' then raise exception 'combat_v2_squad_value: no value for auto_v2.pick (balance auto_v2)'; end if;
  if jsonb_typeof(p_cards) is distinct from 'array' then raise exception 'combat_v2_squad_value: cards must be a list ({id, role, power, blocks})'; end if;
  if (select count(distinct x2->>'id') from jsonb_array_elements(p_cards) x2) <> jsonb_array_length(p_cards) then raise exception 'combat_v2_squad_value: a card id is twice in the squad'; end if;
  for x in select v from jsonb_array_elements(p_cards) v loop
    if jsonb_typeof(x->'id') is distinct from 'number' or (x->>'id')::numeric < 1 or (x->>'id')::numeric % 1 <> 0
       or not exists (select 1 from public.roles r where r.key = x->>'role')
       or jsonb_typeof(x->'power') is distinct from 'number' or (x->>'power')::numeric < 0 or jsonb_typeof(coalesce(x->'blocks', '[]'::jsonb)) <> 'array' then
      raise exception 'combat_v2_squad_value: each card needs a whole id of 1 or more, a role of roles, its power (card_power_v2 value, 0 or more) and a list of blocks (%)', x::text;
    end if;
    cs := cs || jsonb_build_array(jsonb_build_object('id', (x->>'id')::int, 'power', x->'power',
      'makes', to_jsonb(combat_v2_auto_makes(x->>'role', x->'blocks', a)), 'pays', to_jsonb(combat_v2_auto_pays(x->'blocks'))));
    ids := ids || (x->>'id')::int;
  end loop;
  for c in select v from jsonb_array_elements(cs) v loop
    pr := combat_v2_autopick_pair(c, cs, ids, a->'pick');
    total := total + (c->>'power')::numeric * pr;
    rows := rows || jsonb_build_array(jsonb_build_object('id', c->'id', 'power', c->'power', 'pair', pr, 'value', (c->>'power')::numeric * pr));
  end loop;
  return jsonb_build_object('value', total, 'shown', round(total)::bigint, 'cards', rows);
end $fn$;

-- ============================================================ 5. the Hunt auto-pick with the Power number (REPLACED: the E8 text of combat_v2_auto.sql + the power of a pool card)
create or replace function public.combat_v2_autopick(p_pool jsonb, p_boss jsonb, p_cap integer, p_b jsonb default null, p_a jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());
  a jsonb := coalesce(p_a, (select value from public.balance where key = 'auto_v2'));
  pk jsonb; en jsonb; cs jsonb := '[]'; base jsonb := '{}'; sc jsonb; ids integer[]; prev integer[]; passes int := 0; x jsonb; c jsonb;
  off numeric; val numeric; ans numeric; weak numeric; mk text[]; py text[]; m text; role text; rows jsonb := '[]'; p int; pr numeric; id int;
begin
  if a is null or jsonb_typeof(a->'pick') is distinct from 'object' then raise exception 'combat_v2_autopick: no value for auto_v2.pick (balance auto_v2)'; end if;
  if b->'v2_enemy' is null then raise exception 'combat_v2_autopick: no value for v2_enemy (combat_v2_enemy_numbers)'; end if;
  pk := a->'pick'; en := b->'v2_enemy';
  if jsonb_typeof(p_pool) is distinct from 'array' then raise exception 'combat_v2_autopick: pool must be a list of cards ({id, role, class, atk, crt, crd, spd, blocks})'; end if;
  if jsonb_typeof(p_boss) is distinct from 'object' then raise exception 'combat_v2_autopick: boss must be an object ({mechanics, weak_role})'; end if;
  if p_cap is null or p_cap < 1 then raise exception 'combat_v2_autopick: cap must be a whole number of 1 or more'; end if;
  if (select count(distinct x2->>'id') from jsonb_array_elements(p_pool) x2) <> jsonb_array_length(p_pool) then raise exception 'combat_v2_autopick: a card id is twice in the pool'; end if;
  for x in select v from jsonb_array_elements(p_pool) v loop
    role := x->>'role';
    if jsonb_typeof(x->'id') is distinct from 'number' or (x->>'id')::numeric < 1 or (x->>'id')::numeric % 1 <> 0
       or not exists (select 1 from public.roles r where r.key = role and r.class = x->>'class')
       or jsonb_typeof(x->'atk') is distinct from 'number' or jsonb_typeof(x->'crt') is distinct from 'number' or jsonb_typeof(x->'crd') is distinct from 'number'
       or jsonb_typeof(x->'spd') is distinct from 'number' or jsonb_typeof(coalesce(x->'blocks', '[]'::jsonb)) <> 'array' then
      raise exception 'combat_v2_autopick: each pool card needs a whole id of 1 or more, a role of roles with its class, the numbers atk, crt, crd and spd (card_combat_v2) and a list of blocks (%)', x::text;
    end if;
    -- E9: the Power number of the card (card_power_v2 value), when the pool card has one
    if x ? 'power' and (jsonb_typeof(x->'power') is distinct from 'number' or (x->>'power')::numeric < 0) then
      raise exception 'combat_v2_autopick: the power of a pool card must be a number of 0 or more (card_power_v2 value) (%)', x::text;
    end if;
    -- the offense value (plan 2.5 Offense without the hit chance): attack x the crit factor x speed
    off := (x->>'atk')::numeric * (1 + (x->>'crt')::numeric * ((x->>'crd')::numeric - 1)) * (x->>'spd')::numeric;
    val := coalesce((x->>'power')::numeric, off);
    ans := 1;
    for m in select jsonb_array_elements_text(coalesce(p_boss->'mechanics', '[]'::jsonb)) loop
      if pk->'answers'->m->role is not null then ans := ans * (pk->'answers'->m->>role)::numeric; end if;
    end loop;
    weak := case when role = p_boss->>'weak_role' then 1 + coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, (en->>'weak_role_x')::numeric) else 1 end;
    mk := combat_v2_auto_makes(role, x->'blocks', a); py := combat_v2_auto_pays(x->'blocks');
    cs := cs || jsonb_build_array(jsonb_build_object('id', (x->>'id')::int, 'role', role, 'class', x->>'class', 'makes', to_jsonb(mk), 'pays', to_jsonb(py),
      'off', off, 'power', x->'power', 'val', val, 'ans', ans, 'weak', weak, 'base', val * ans * weak));
    base := base || jsonb_build_object(x->>'id', val * ans * weak);
  end loop;
  ids := combat_v2_autopick_choose(cs, base, p_cap, pk);
  for p in 1 .. (pk->>'passes')::int loop
    prev := ids; sc := '{}';
    for c in select v from jsonb_array_elements(cs) v loop
      sc := sc || jsonb_build_object(c->>'id', (c->>'base')::numeric * combat_v2_autopick_pair(c, cs, prev, pk));
    end loop;
    ids := combat_v2_autopick_choose(cs, sc, p_cap, pk); passes := p;
    exit when (select array_agg(y order by y) from unnest(ids) y) is not distinct from (select array_agg(y order by y) from unnest(prev) y);
  end loop;
  foreach id in array ids loop
    c := (select v from jsonb_array_elements(cs) v where (v->>'id')::int = id);
    pr := combat_v2_autopick_pair(c, cs, ids, pk);
    rows := rows || jsonb_build_array(jsonb_build_object('id', id, 'role', c->>'role', 'off', c->'off', 'power', c->'power', 'val', c->'val', 'ans', c->'ans', 'weak', c->'weak',
      'base', c->'base', 'pair', pr, 'score', (c->>'base')::numeric * pr));
  end loop;
  return jsonb_build_object('ids', to_jsonb(ids), 'rows', rows, 'passes', passes);
end $fn$;

-- ============================================================ 6. server only, comments
do $do$ declare f text; begin
  foreach f in array array['card_power_v2_numbers()', 'card_power_v2_families(text, jsonb, jsonb)', 'card_power_v2(jsonb, jsonb, jsonb)',
    'card_power_v2(text, integer, numeric, integer, jsonb, text, jsonb)', 'combat_v2_squad_value(jsonb, jsonb, jsonb)',
    'combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb)', 'balance_v2_spec(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $do$;
comment on function public.card_power_v2_numbers() is $cm$[combat] Combat v2 Power: the numbers that card_power_v2 reads (ability_v2_numbers with the block library and the statuses, balance v2_power, v2_hit, v2_enemy and v2_support, and status_family = the family of each status of the statuses table). combat_v2_power.sql.$cm$;
comment on function public.card_power_v2_families(text, jsonb, jsonb) is $cm$[combat] Combat v2 Power: the family of each block of an active (smite, a support only: smite, area, vs_status, payoff_dmg, crit_add, consume; dot or control: a status block of a status of that family; an attachment: the family of its host; else other). combat_v2_power.sql.$cm$;
comment on function public.card_power_v2(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 THE POWER NUMBER of one card (plan 2.5, decision 3, PR E9): Offense x Survival x k[role] x scale from card_combat_v2 (stats, support factor F, extra stack) and the base blocks of the active; a support Offense counts the PP of its smite, dot and control blocks x balance v2_power.value. {power (rounded, the number a card shows), value, offense, survival, k, scale, hit, crit_x, v, pp, families}. The client shows it only (CI check C3). The simulator twin: v2sim power.mjs cardPower. combat_v2_power.sql.$cm$;
comment on function public.card_power_v2(text, integer, numeric, integer, jsonb, text, jsonb) is $cm$[combat] Combat v2 Power number from the card facts (rarity, stars, cp_mod, level, points, role, blocks): card_combat_v2, then card_power_v2. combat_v2_power.sql.$cm$;
comment on function public.combat_v2_squad_value(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 SQUAD VALUE (plan 14.1 E9): the sum of the Power of each card x its pair score in the squad (combat_v2_autopick_pair: pair_floor for a payoff card with no maker of its status among the other cards). cards = [{id, role, power (card_power_v2 value), blocks}]; {value, shown, cards [{id, power, pair, value}]}. The simulator twin: v2sim power.mjs squadValue. combat_v2_power.sql.$cm$;
comment on function public.combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb) is $cm$[combat] Combat v2 THE HUNT AUTO-PICK (plan 14.1 E8, E9): the squad of cap cards from a pool [{id, role, class, atk, crt, crd, spd, blocks, power?}] against a boss {mechanics, weak_role}: score = the card value (its Power number, card_power_v2 value, when the pool card has one (E9); else the offense atk x (1 + crt x (crd - 1)) x spd, E8) x the role answers (auto_v2.pick.answers) x the Weak to bonus x the pair score; {ids, rows, passes}. No draw, no write. The simulator twin: v2sim auto.mjs autoPick. combat_v2_auto.sql, replaced by combat_v2_power.sql.$cm$;

notify pgrst, 'reload schema';
