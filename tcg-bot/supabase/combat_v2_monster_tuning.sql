-- combat_v2_monster_tuning.sql (2026-10-21): combat v2, phase 4, the E7 follow-up: the monster tuning and the "Weak to" tags of the Hunt bosses
-- (docs/combat-redesign-plan.md 7.4, 8.2, 8.4, 20.2; Nathan approved the 7 decisions on 2026-10-21). Needs combat_v2_monsters.sql (E7) first.
-- Before: Steadfast, Plated, Fade and Brood had on_foe false, but combat_v2_dungeon_foe took any mechanic; Bulwark, Undying and Regrowth walled every
-- squad on a Dungeon guardian (Lab median cut 0.23, 0.52, 0.58); Ironhide, Venom and Slowing were hard counters (one archetype below x0.5); the boss card
-- showed hunt_bosses_v2.weak_to (empty), but the fight read the Weak to role from a caller option (two homes).
-- After this file (the reference is the simulator card-studio/v2sim: engine.mjs cardHit and enemyHit, modes.mjs makeBoss; config.json):
--   BALANCE (the part between the markers needs only V1: test-combat-v2-balance.mjs runs it after V1, as on live):
--     balance_v2_spec (replaced: V1 text + 3 new leaves) and the values: v2_enemy.mechanics.ironhide.crit_x 0.7 (unless Marked, the crit chance is
--     x crit_x; 0 = the E7 rule: no crit), venom.chance 0.35 and slowing.chance 0.4 (the chance that a hit applies the status; 1 = every hit, the E7
--     rule), regrowth.heal 0.01 -> 0.007 (a Dungeon foe heals 0.7% of its max HP a step); v2_dungeon.passive_params.bulwark every 2 -> 3, guard
--     0.2 -> 0.18, undying.hp 0.25 -> 0.15. The Lab set each number (card-studio/scripts/lab-combat-v2-passives.mjs; the PR has the before/after table).
--   THE MECHANIC TEXTS (enemy_mechanics): Ironhide, Venom and Slowing name their new {leaf} numbers.
--   THE WEAK TO TAGS (hunt_bosses_v2.weak_to): the 16 primary role tags that Nathan approved (one role: tag a boss). hunt_bosses_v2_check (replaced)
--     refuses a tag that is not a role tag (no element or family weakness), more than one role tag, an unknown role, and the 4 support roles with no
--     week rule (Warden, Medic, Spotter, Herald: their week changes nothing; the Controller week has its own rule).
--   REPLACED (each gives its E7 answer on a state with no new number: crit_x 0, no chance):
--     combat_v2_hit (Ironhide crit_x), combat_v2_enemy_hit (the Venom and Slowing chance: one draw each, after the hit and before the status; no draw at
--     chance 1), combat_v2_hunt_boss (ONE SOURCE: the weak_role of a named boss is its role: tag of hunt_bosses_v2.weak_to; opts.weak_role raises; a tier
--     boss takes only on_boss mechanics), combat_v2_dungeon_foe (a foe takes only on_foe mechanics: Steadfast, Plated, Fade, Brood and the other boss
--     rules stay on the Hunt boss), hunt_bosses_v2_check.
--   DRAW SLOTS (the simulator's rng calls in order): an enemy single hit: the hit draws, Crush, Frost Aura, [Venom chance] then Venom, Burning; an area hit:
--     the hit draws, Crush, [Slowing chance] then Slowing.
-- NO CHANGE IN PLAY: no v1 function calls a replaced function, the flag combat_v2 stays OFF, and no other function changes (the test compares the md5 of
-- every other public function). Every number is in balance (C1: only 0 and 1 in the bodies of the combat_ functions). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-monster-tuning.mjs (rolled back; SQL = the simulator on random fights; MUTATE=all must catch every mutation).

-- @balance-begin (test-combat-v2-balance.mjs runs this part after V1: it needs only V1)
create or replace function public.balance_v2_spec(p_key text)
returns jsonb language sql immutable set search_path = public as $fn$
  select case p_key
  when 'combat_v2' then '{"gauntlet": "bool", "dungeon": "bool", "hunt": "bool", "progress": "bool"}'::jsonb
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
    "abl_x": "num 0 1", "support_abl_ref": "num 0 100", "ddg_x": "num 0 1"}'::jsonb
  end;
$fn$;

select set_config('balance.by', 'nathan', true);
update public.balance set value = jsonb_set(jsonb_set(jsonb_set(value,
    '{mechanics,ironhide}', (value->'mechanics'->'ironhide') || '{"crit_x":0.7}'),
    '{mechanics,venom}', (value->'mechanics'->'venom') || '{"chance":0.35}'),
    '{mechanics,slowing}', (value->'mechanics'->'slowing') || '{"chance":0.4}')
 where key = 'v2_enemy' and not (value->'mechanics'->'ironhide' ? 'crit_x');
update public.balance set value = jsonb_set(value, '{mechanics,regrowth,heal}', '0.007')
 where key = 'v2_enemy' and value->'mechanics'->'regrowth'->'heal' = '0.01'::jsonb;
update public.balance set value = jsonb_set(value, '{passive_params,bulwark}', '{"every":3,"guard":0.18}')
 where key = 'v2_dungeon' and value->'passive_params'->'bulwark' = '{"every":2,"guard":0.2}'::jsonb;
update public.balance set value = jsonb_set(value, '{passive_params,undying,hp}', '0.15')
 where key = 'v2_dungeon' and value->'passive_params'->'undying'->'hp' = '0.25'::jsonb;
update public.balance set note = note || $n$ The E7 tuning (2026-10-21, combat_v2_monster_tuning.sql, the Lab set each number): mechanics.ironhide.crit_x = the crit chance factor of the cards against it unless it is Marked (0 = no crit); mechanics.venom.chance and mechanics.slowing.chance = the chance that a hit applies the status (1 = every hit); mechanics.regrowth.heal of a Dungeon foe 1% -> 0.7%.$n$
 where key = 'v2_enemy' and note not like '%The E7 tuning%';
update public.balance set note = note || $n$ The E7 tuning (2026-10-21, combat_v2_monster_tuning.sql, the Lab set each number): bulwark every 2nd action, 20% -> every 3rd action, 18%; undying 25% -> 15%.$n$
 where key = 'v2_dungeon' and note not like '%The E7 tuning%';
-- @balance-end

-- ============================================================ the mechanic texts (enemy_mechanics: the {leaf} numbers of the new leaves)
update public.enemy_mechanics set text = 'Unless this enemy is Marked, cards have {crit_x} of their crit chance against it.'
 where key = 'ironhide' and text is distinct from 'Unless this enemy is Marked, cards have {crit_x} of their crit chance against it.';
update public.enemy_mechanics set text = 'Each single hit of this enemy has a {chance} chance to apply {poison} Poison to the card it hits.'
 where key = 'venom' and text is distinct from 'Each single hit of this enemy has a {chance} chance to apply {poison} Poison to the card it hits.';
update public.enemy_mechanics set text = 'Each area hit of this enemy has a {chance} chance to Slow the card it hits.'
 where key = 'slowing' and text is distinct from 'Each area hit of this enemy has a {chance} chance to Slow the card it hits.';

-- ============================================================ the Weak to tags (hunt_bosses_v2.weak_to) and the check of the rows
create or replace function public.hunt_bosses_v2_check() returns trigger language plpgsql set search_path = public as $fn$
declare m jsonb; k text; ids text[] := '{}'; nb jsonb;
begin
  foreach k in array new.sig || new.mythic loop
    if not exists (select 1 from public.enemy_mechanics x where x.key = k and x.on_boss) then raise exception 'hunt_bosses_v2 %: % is not a boss mechanic of enemy_mechanics', new.key, k; end if;
  end loop;
  foreach k in array new.resists || new.mythic_resists loop
    if not exists (select 1 from public.statuses x where x.key = k and x.negative and x.on_enemy) then raise exception 'hunt_bosses_v2 %: % is not a harmful enemy status', new.key, k; end if;
  end loop;
  foreach k in array new.weak_to loop
    if k !~ '^[a-z]+:[a-z0-9-]+$' then raise exception 'hunt_bosses_v2 %: weak_to % is not a rule tag', new.key, k; end if;
    -- E7 tuning (Nathan 2026-10-21): only role tags (the fight reads the role; no element or family weakness), one role a boss, a role of roles, and
    -- never a support role with no week rule (Warden, Medic, Spotter, Herald: their week changes nothing; the Controller has weak_role_rules)
    if k !~ '^role:' then raise exception 'hunt_bosses_v2 %: weak_to % is not a role tag (no element or family weakness)', new.key, k; end if;
    if not exists (select 1 from public.roles r where r.key = regexp_replace(k, '^role:', '')) then raise exception 'hunt_bosses_v2 %: weak_to % is not a role of roles', new.key, k; end if;
    if regexp_replace(k, '^role:', '') in ('warden', 'medic', 'spotter', 'herald') then
      raise exception 'hunt_bosses_v2 %: weak_to % is a support role with no week rule (no Warden, Medic, Spotter or Herald week)', new.key, k;
    end if;
  end loop;
  if (select count(*) from unnest(new.weak_to) x where x like 'role:%') > 1 then raise exception 'hunt_bosses_v2 %: one role tag at most (the fight reads one role)', new.key; end if;
  nb := balance_path('enemy_v2.bosses.' || new.key);
  if jsonb_typeof(nb) is distinct from 'object' then raise exception 'hunt_bosses_v2 %: no numbers in balance enemy_v2.bosses.%', new.key, new.key; end if;
  for m in select x from jsonb_array_elements(new.moves) x loop
    if coalesce(m->>'id', '') !~ '^[a-z0-9_]+$' or m->>'id' = any(ids) then raise exception 'hunt_bosses_v2 %: a move needs a new id (%)', new.key, m->>'id'; end if;
    ids := ids || (m->>'id');
    if coalesce(m->>'k', '') not in ('hit', 'area', 'apply', 'guard', 'heal', 'cleanse_self', 'cash_out', 'enrage', 'spiral', 'evade', 'charge', 'strip',
                                      'strip_shields', 'skip', 'extra_action', 'brood', 'state', 'undo_smite', 'desync_smite', 'mirror_smite', 'siphon') then
      raise exception 'hunt_bosses_v2 % %: unknown move kind %', new.key, m->>'id', m->>'k';
    end if;
    if jsonb_typeof(nb->'moves'->(m->>'id')) is distinct from 'object' then raise exception 'hunt_bosses_v2 % %: no numbers in balance enemy_v2.bosses.%.moves', new.key, m->>'id', new.key; end if;
    if exists (select 1 from jsonb_each(m) y where jsonb_typeof(y.value) = 'number') then raise exception 'hunt_bosses_v2 % %: a number goes in balance, not in the row', new.key, m->>'id'; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(nb->'moves')) <> cardinality(ids) then raise exception 'hunt_bosses_v2 %: the moves of the row and of balance differ', new.key; end if;
  new.updated_at := now();
  return new;
end $fn$;

update public.hunt_bosses_v2 set weak_to = '{role:controller}' where key = 'warlord' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:breaker}' where key = 'nightshade' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:survivor}' where key = 'netcode' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:artillery}' where key = 'vampire' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:striker}' where key = 'warzombie' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:cleaver}' where key = 'maw' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:flurry}' where key = 'smurf' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:breaker}' where key = 'skeleton' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:survivor}' where key = 'pumpkin' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:finisher}' where key = 'lagspike' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:striker}' where key = 'banwave' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:cleaver}' where key = 'zerg' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:breaker}' where key = 'salt_miner' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:flurry}' where key = 'frost_lich' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:controller}' where key = 'camper_colossus' and weak_to = '{}';
update public.hunt_bosses_v2 set weak_to = '{role:artillery}' where key = 'hydra' and weak_to = '{}';
comment on column public.hunt_bosses_v2.weak_to is 'The Weak to line: one role tag role:<role> (Nathan approved the 16 tags 2026-10-21; combat_v2_monster_tuning.sql). The fight reads this role (combat_v2_hunt_boss puts it on the boss as weak_role): one source. Never Warden, Medic, Spotter or Herald (their week changes nothing), no element or family tag.';

-- ============================================================ replaced: the hit (Ironhide crit_x) and the enemy hit (the Venom and Slowing chance)
create or replace function public.combat_v2_hit(p_att jsonb, p_tgt jsonb, p_ctx jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
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
begin
  if h is null or st is null or ss is null or ro is null or en is null or bm is null or p_b->'v2_support' is null then
    raise exception 'combat_v2_hit: no balance value for v2_hit, v2_stats, v2_status, v2_roles, v2_enemy or v2_support';
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
    'down', thp - hp_loss <= 0, 'heal', heal, 'lost', absorbed * sx, 'draws', used)
    || case when brood > 0 then jsonb_build_object('brood_after', brood_after) else '{}'::jsonb end;
end $fn$;

create or replace function public.combat_v2_enemy_hit(p_state jsonb, p_att jsonb, p_tgt jsonb, p_x numeric, p_area boolean, p_opts jsonb, p_draws jsonb, p_b jsonb)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare s jsonb := p_state; a jsonb; t jsonb; tpath text[]; h jsonb; r jsonb; d jsonb := p_draws; used jsonb := '[]'::jsonb; w boolean; foes int; lost numeric;
  m text; st text; n int; o jsonb := coalesce(p_opts, '{}'::jsonb); ch numeric; dv numeric;
begin
  tpath := combat_v2_unit_path(s, p_tgt); t := s #> tpath;
  if not combat_v2_up(t) then return jsonb_build_object('state', s, 'dealt', 0, 'hit', false, 'draws', used); end if;
  a := s #> combat_v2_unit_path(s, p_att);
  w := exists (select 1 from combat_v2_units(s) q where q.side = 'card' and q.id <> p_tgt->>'id' and s->'cards'->q.id->>'role' = 'warden' and combat_v2_up(s->'cards'->q.id));
  select count(*) into foes from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int));
  h := combat_v2_hit(a, t, jsonb_build_object('side', 'enemy', 'x', p_x, 'area', p_area, 'warden', w, 'clock', s->'clock', 'mode', s->'mode', 'foes_alive', foes,
                                              'ignore_shield', coalesce((o->>'ignore_shield')::boolean, false))
                           || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
  used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
  s := combat_v2_hit_apply(s, p_tgt, h, p_b)->'state';
  if (h->>'hit')::boolean then
    lost := (h->>'lost')::numeric;
    if coalesce(a->'mechanics' ? 'crush', false) and lost > 0 and combat_v2_up(s #> tpath) then
      r := combat_v2_damage(s, p_tgt, lost * (combat_v2_mech(p_b, a, 'crush')->>'x')::numeric,
                            jsonb_build_object('tick', true, 'ignore_shield', true, 'pierce', 1) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
    if not p_area and combat_v2_up(s #> tpath) then
      foreach m in array array['frost_aura', 'venom', 'burning'] loop
        continue when not coalesce(a->'mechanics' ? m, false);
        st := case m when 'frost_aura' then 'chill' when 'venom' then 'poison' else 'burn' end;
        n := (combat_v2_mech(p_b, a, m)->>case m when 'frost_aura' then 'chill' when 'venom' then 'poison' else 'burn' end)::int;
        -- Venom (E7 tuning): it poisons with the chance venom.chance (one draw; 1 or no chance = always, no draw)
        if m = 'venom' then
          ch := coalesce((combat_v2_mech(p_b, a, 'venom')->>'chance')::numeric, 1);
          if ch < 1 then
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            continue when dv >= ch;
          end if;
        end if;
        r := combat_v2_status_apply(s, p_tgt, st, jsonb_build_object('stacks', n, 'src', p_att) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end loop;
    end if;
    -- Slowing (E7 tuning): it Slows with the chance slowing.chance (one draw; 1 or no chance = always, no draw)
    if p_area and coalesce(a->'mechanics' ? 'slowing', false) and combat_v2_up(s #> tpath) then
      ch := coalesce((combat_v2_mech(p_b, a, 'slowing')->>'chance')::numeric, 1);
      if ch < 1 then dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1); end if;
    end if;
    if p_area and coalesce(a->'mechanics' ? 'slowing', false) and combat_v2_up(s #> tpath) and (ch >= 1 or dv < ch) then
      r := combat_v2_status_apply(s, p_tgt, 'slowed', jsonb_build_object('src', p_att) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
  end if;
  return jsonb_build_object('state', s, 'dealt', h->'dmg', 'hit', h->'hit', 'draws', used);
end $fn$;

-- ============================================================ replaced: the builders (one source for the Weak to role; on_boss and on_foe)
create or replace function public.combat_v2_hunt_boss(p_tier text, p_key text, p_opts jsonb default null, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); o jsonb := coalesce(p_opts, '{}'::jsonb); t jsonb := b->'v2_enemy'->'hunt'->p_tier;
  rw public.hunt_bosses_v2; nb jsonb; mech jsonb; res jsonb := '[]'::jsonb; moves jsonb := '[]'::jsonb; m jsonb; mn jsonb; hp numeric; u jsonb; wr text;
begin
  if t is null then raise exception 'combat_v2_hunt_boss: unknown tier % (v2_enemy.hunt)', p_tier; end if;
  -- one source (E7 tuning): the Weak to role is the role: tag of hunt_bosses_v2.weak_to, never a caller option
  if o ? 'weak_role' then raise exception 'combat_v2_hunt_boss: no opts.weak_role (the Weak to role comes from hunt_bosses_v2.weak_to)'; end if;
  if p_key is not null then
    select * into rw from public.hunt_bosses_v2 x where x.key = p_key;
    if not found then raise exception 'combat_v2_hunt_boss: unknown boss % (hunt_bosses_v2)', p_key; end if;
    nb := b->'enemy_v2'->'bosses'->p_key;
    mech := to_jsonb(rw.sig || case when p_tier = 'Mythic' then rw.mythic else '{}'::text[] end);
    res := to_jsonb(rw.resists || case when p_tier = 'Mythic' then rw.mythic_resists else '{}'::text[] end);
    for m in select x from jsonb_array_elements(rw.moves) x loop
      mn := coalesce(nb->'moves'->(m->>'id'), '{}'::jsonb);
      moves := moves || jsonb_build_array(m || (mn - 'apply') || case when m ? 'apply' or mn ? 'apply' then jsonb_build_object('apply', coalesce(m->'apply', '{}'::jsonb) || coalesce(mn->'apply', '{}'::jsonb)) else '{}'::jsonb end);
    end loop;
    wr := (select regexp_replace(q.x, '^role:', '') from unnest(rw.weak_to) with ordinality q(x, n) where q.x like 'role:%' order by q.n limit 1);
  else
    mech := coalesce(o->'sigs', '[]'::jsonb);
    -- E7 tuning: a tier boss takes only boss mechanics (enemy_mechanics.on_boss)
    for m in select x from jsonb_array_elements(mech) x loop
      if not exists (select 1 from public.enemy_mechanics y where y.key = m #>> '{}' and y.on_boss) then
        raise exception 'combat_v2_hunt_boss: % is not a Hunt boss mechanic (enemy_mechanics.on_boss)', m #>> '{}';
      end if;
    end loop;
  end if;
  hp := (t->>'hp')::numeric * (b->'v2_enemy'->>'asc3_hp_x')::numeric * coalesce((nb->>'hp_factor')::numeric, 1);
  u := jsonb_build_object('hp', hp * coalesce((o->>'start_frac')::numeric, 1), 'max', hp, 'down', false, 'atk', (t->>'atk')::numeric * (t->>'atk_x')::numeric,
         'def', (t->>'def')::numeric, 'evasion', (t->>'evasion')::numeric, 'resolve', (t->>'resolve')::numeric, 'keen', (t->>'keen')::numeric,
         'speed', (t->>'speed')::numeric, 'meter', coalesce((o->>'meter')::numeric, 0), 'charge', 0, 'status', '{}'::jsonb, 'turn', 0,
         'mechanics', mech, 'resists', res, 'params', coalesce(nb->'params', '{}'::jsonb), 'healer', mech ? 'regrowth')
       || case when p_key is not null then jsonb_build_object('boss', p_key, 'moves2', moves, 'counter_share', (nb->>'counter_share')::numeric) else '{}'::jsonb end
       || case when wr is not null then jsonb_build_object('weak_role', wr) else '{}'::jsonb end;
  if mech ? 'plated' then u := u || jsonb_build_object('def', greatest((u->>'def')::numeric, (combat_v2_mech(b, u, 'plated')->>'def')::numeric)); end if;
  if mech ? 'fade' then u := u || jsonb_build_object('evasion', (u->>'evasion')::numeric + (combat_v2_mech(b, u, 'fade')->>'evasion_add')::numeric); end if;
  if mech ? 'brood' then u := u || jsonb_build_object('brood', (combat_v2_mech(b, u, 'brood')->>'start')::int); end if;
  return u;
end $fn$;

create or replace function public.combat_v2_dungeon_foe(p_monster text, p_floor int, p_room int, p_kind text, p_mechs jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); dd jsonb := b->'v2_dungeon'; g jsonb := b->'v2_dungeon'->'growth'; k jsonb := b->'v2_dungeon'->'kinds'->p_kind;
  rw public.dungeon_monsters_v2; hp numeric; atk numeric; mech jsonb := '[]'::jsonb; u jsonb; m text;
begin
  if k is null then raise exception 'combat_v2_dungeon_foe: unknown room kind % (v2_dungeon.kinds)', p_kind; end if;
  if p_floor is null or p_floor < 1 or p_room is null or p_room < 1 then raise exception 'combat_v2_dungeon_foe: floor and room start at 1'; end if;
  select * into rw from public.dungeon_monsters_v2 x where x.key = p_monster;
  if not found then raise exception 'combat_v2_dungeon_foe: unknown monster % (dungeon_monsters_v2)', p_monster; end if;
  hp := rw.hp * power((g->>'hp')::numeric, p_floor - 1) * (1 + (g->>'room')::numeric * (p_room - 1)) * (k->>'hp')::numeric * (dd->>'hp_x')::numeric;
  atk := rw.atk * power((g->>'atk')::numeric, p_floor - 1) * (k->>'atk')::numeric * (dd->>'atk_x')::numeric;
  if p_floor <= (g->>'early_floors')::int then hp := hp * (g->>'early_hp')::numeric; atk := atk * (g->>'early_atk')::numeric; end if;
  if rw.passive is not null and p_kind = any(coalesce(rw.passive_kinds, array(select jsonb_array_elements_text(dd->'monster_passives'->'kinds')))) then
    mech := mech || to_jsonb(rw.passive);
  end if;
  for m in select jsonb_array_elements_text(coalesce(p_mechs, '[]'::jsonb)) loop
    perform combat_v2_mech(b, null, m);
    -- E7 tuning: a foe takes only foe mechanics (enemy_mechanics.on_foe): Steadfast, Plated, Fade, Brood and the other Hunt boss rules stay on the Hunt boss
    if not exists (select 1 from public.enemy_mechanics y where y.key = m and y.on_foe) then
      raise exception 'combat_v2_dungeon_foe: % is a Hunt boss mechanic, not a foe mechanic (enemy_mechanics.on_foe)', m;
    end if;
    if not mech ? m then mech := mech || to_jsonb(m); end if;
  end loop;
  if rw.aura is not null and coalesce(dd->'monster_passives'->rw.aura->'kinds' ? p_kind, false) then mech := mech || to_jsonb(rw.aura); end if;
  u := jsonb_build_object('hp', hp, 'max', hp, 'down', false, 'atk', greatest(1, atk), 'def', (k->>'def')::numeric,
         'evasion', least((dd->>'foe_evasion_max')::numeric, (dd->>'foe_evasion_per_floor')::numeric * (p_floor - 1)),
         'resolve', coalesce((dd->'foe_resolve'->>p_kind)::numeric, 0), 'keen', 0, 'speed', (k->>'speed')::numeric, 'meter', 0, 'charge', 0, 'status', '{}'::jsonb,
         'turn', 0, 'mechanics', mech, 'moves', (select jsonb_agg(jsonb_build_object('k', x->>'k', 'w', (x->>'w')::numeric)) from jsonb_array_elements(rw.moves) x),
         'cataclysm', (k->>'charge')::boolean, 'monster', p_monster,
         'healer', mech ? 'regrowth' or exists (select 1 from jsonb_array_elements(rw.moves) x where x->>'k' in ('regenerate', 'drain')));
  if mech ? 'plated' then u := u || jsonb_build_object('def', greatest((u->>'def')::numeric, (combat_v2_mech(b, u, 'plated')->>'def')::numeric)); end if;
  if mech ? 'fade' then u := u || jsonb_build_object('evasion', (u->>'evasion')::numeric + (combat_v2_mech(b, u, 'fade')->>'evasion_add')::numeric); end if;
  if mech ? 'brood' then u := u || jsonb_build_object('brood', (combat_v2_mech(b, u, 'brood')->>'start')::int); end if;
  return u;
end $fn$;

-- ============================================================ server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['balance_v2_spec(text)', 'hunt_bosses_v2_check()', 'combat_v2_hit(jsonb, jsonb, jsonb, jsonb)',
      'combat_v2_enemy_hit(jsonb, jsonb, jsonb, numeric, boolean, jsonb, jsonb, jsonb)', 'combat_v2_hunt_boss(text, text, jsonb, jsonb)',
      'combat_v2_dungeon_foe(text, integer, integer, text, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.balance_v2_spec(text) is $cm$[combat] The fixed shape with the limits of each combat v2 balance key (combat_v2, v2_stats, v2_card_hp, v2_asc, v2_level, card_level, v2_support, v2_speed, v2_charge, v2_hit, v2_roles, v2_status, v2_control, v2_enemy, v2_dungeon, v2_hunt, v2_pp, v2_power); NULL for every other key. A new v2 leaf needs a new spec in this function. The E7 tuning added v2_enemy.mechanics.ironhide.crit_x, venom.chance and slowing.chance. combat_v2_monster_tuning.sql (the V1 text of combat_v2_flags_balance.sql + these leaves).$cm$;
comment on function public.hunt_bosses_v2_check() is $cm$Trigger (before insert, update on hunt_bosses_v2): sig and mythic are boss mechanics of enemy_mechanics, resists are harmful enemy statuses, weak_to holds only role tags (no element or family tag), at most one, of a role of roles and never Warden, Medic, Spotter or Herald (no week rule), every move has a new id, a known kind, no number (numbers go in balance) and its numbers in balance enemy_v2.bosses.<key>.moves (the same moves). combat_v2_monster_tuning.sql.$cm$;
comment on function public.combat_v2_hunt_boss(text, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.4): the Hunt boss of a tier as a v2 unit (the simulator makeBoss): a named boss of hunt_bosses_v2 (sig, Mythic adds, resists, params, counter moves with the numbers of enemy_v2, weak_role = the role: tag of its weak_to: one source) or the tier boss with opts.sigs (on_boss mechanics only, no weak role); HP = tier HP x asc3_hp_x x hp_factor x opts.start_frac; Plated, Fade, Brood. opts.weak_role raises. Reads only. combat_v2_monster_tuning.sql.$cm$;
comment on function public.combat_v2_dungeon_foe(text, integer, integer, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.3): a Dungeon or Gauntlet foe as a v2 unit (the simulator makeFoe): the growth of the floor and room, the room kind, its own passive and aura, the caller's pool passives (on_foe mechanics only: a Hunt boss mechanic raises), its moves; Plated, Fade, Brood. Reads only. combat_v2_monster_tuning.sql.$cm$;
comment on function public.combat_v2_enemy_hit(jsonb, jsonb, jsonb, numeric, boolean, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.2): one enemy hit on a card (the simulator enemyHit): combat_v2_hit, then Crush on the lost shield, then the single-hit riders Frost Aura, Venom (with the chance venom.chance: one draw below 1) and Burning, or the area rider Slowing (with the chance slowing.chance). Answer {state, dealt, hit, draws}. combat_v2_monster_tuning.sql.$cm$;
comment on function public.combat_v2_hit(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 hit core (plan 2.2, 4, 6, 8): one hit of a card on an enemy (ctx.side card: miss = base + evasion + timed evade + Blinded - acc unless true strike or Marked; roll; crit min(cap + Focused, crt + adds + Striker), x ironhide.crit_x on an Ironhide target that is not Marked (0 = no crit and no draw), x crd; Mirror Hide on kinds; Empowered (Dispeller, emp_x), Weakened, Chill, Exposed, Mark, Finisher, Cleaver, the Weak to role week, vs_x; Breaker pierce and shield break) or of an enemy on a card (ctx.side enemy: Blinded; Dodge; roll; Enraged, boss rage, Weakened, Chill, Exposed, Pack, Swarm; Sunder, Shatter). Damage = raw x (1 - def x (1 - pierce)), Warden ally_dr, Steadfast, Brood, min_dmg, then the shield. Draw slots in a fixed order (card: [miss], roll, [crit]; enemy: [Blinded], [dodge], roll). Writes nothing; numbers from p_b. No v1 function calls it. combat_v2_monster_tuning.sql.$cm$;

notify pgrst, 'reload schema';
