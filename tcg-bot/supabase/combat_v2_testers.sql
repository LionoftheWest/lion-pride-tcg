-- combat_v2_testers.sql (2026-10-21): combat v2, the tester list (docs/combat-redesign-plan.md 14.2 and 20.4). Needs combat_v2_monster_tuning.sql (E7b)
-- first (this file replaces its balance_v2_spec: the E7b text + one leaf).
-- Before: the flag combat_v2 is one boolean for each capability (gauntlet, dungeon, hunt, progress), all false; a mode is on for everyone or for nobody.
-- After this file:
--   balance combat_v2.testers: a list of 0 to 20 Discord ids (each a string of 17 to 20 digits, no id twice), [] here. The ids go in later through the
--     Admin view (the balance editor: admin_balance_set, admin_actions and balance_log), never in a file of this repo.
--   balance_shape_errors (replaced: the V1 text + the spec word "discord_id") and balance_v2_spec (replaced: the E7b text + combat_v2.testers): the
--     trigger balance_check_combat_v2 refuses a tester list with a wrong item, an item twice or more than 20 items, and a combat_v2 value with no list.
--   combat_v2_on(mode, player): true when combat_v2_on(mode) is true (the mode is on for everyone), or when the mode is one of the four capabilities and
--     the player id is in combat_v2.testers. It FAILS CLOSED like the reader of one argument: a NULL mode or player, an unknown capability, a value
--     that does not match the fixed shape, no row and any error give false for the tester part.
--   combat_v2_on(mode) does not change.
-- NO CHANGE IN PLAY: no v1 function calls combat_v2_on (either form), the four modes stay false and the list is empty. The go-live steps R1 to R3 call
-- the new reader. Idempotent (the list is added only when the value has none). Server only.
-- Test: card-studio/scripts/test-combat-v2-testers.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the shape walker: + the spec word discord_id
create or replace function public.balance_shape_errors(p_val jsonb, p_spec jsonb, p_path text default '')
returns text[] language plpgsql immutable set search_path = public as $fn$
declare e text[] := '{}'; k text; w text[]; n numeric; i int; at text := coalesce(nullif(p_path, ''), 'the value');
begin
  if jsonb_typeof(p_spec) = 'object' then
    if jsonb_typeof(p_val) is distinct from 'object' then return array[format('%s must be an object', at)]; end if;
    for k in select x from jsonb_object_keys(p_val) x order by 1 loop
      if not p_spec ? k then e := e || format('%s has the unknown key %s', at, k); end if;
    end loop;
    for k in select x from jsonb_object_keys(p_spec) x order by 1 loop
      if not p_val ? k then e := e || format('%s has no %s', at, k);
      else e := e || balance_shape_errors(p_val->k, p_spec->k, ltrim(p_path || '.' || k, '.'));
      end if;
    end loop;
    return e;
  end if;
  if jsonb_typeof(p_spec) = 'array' then
    if p_spec->>0 not in ('list', 'set') then raise exception 'balance_shape_errors: unknown list spec %', p_spec; end if;
    if jsonb_typeof(p_val) is distinct from 'array' then return array[format('%s must be a list', at)]; end if;
    if jsonb_array_length(p_val) not between (p_spec->>2)::int and (p_spec->>3)::int then
      e := e || format('%s must have %s to %s items', at, p_spec->>2, p_spec->>3);
    end if;
    for i in 0 .. jsonb_array_length(p_val) - 1 loop
      e := e || balance_shape_errors(p_val->i, p_spec->1, p_path || '.' || i);
    end loop;
    if p_spec->>0 = 'set' and (select count(distinct x) <> count(*) from jsonb_array_elements(p_val) x) then
      e := e || format('%s has an item twice', at);
    end if;
    return e;
  end if;
  w := string_to_array(p_spec #>> '{}', ' ');
  case w[1]
    when 'num', 'int' then
      if jsonb_typeof(p_val) is distinct from 'number' then return array[format('%s must be a number', at)]; end if;
      n := (p_val #>> '{}')::numeric;
      if n < w[2]::numeric or n > w[3]::numeric then e := e || format('%s must be from %s to %s', at, w[2], w[3]); end if;
      if w[1] = 'int' and n % 1 <> 0 then e := e || format('%s must be a whole number', at); end if;
    when 'bool' then
      if jsonb_typeof(p_val) is distinct from 'boolean' then e := e || format('%s must be true or false', at); end if;
    when 'enum' then
      if jsonb_typeof(p_val) is distinct from 'string' or not ((p_val #>> '{}') = any (string_to_array(w[2], '|'))) then
        e := e || format('%s must be one of %s', at, replace(w[2], '|', ', '));
      end if;
    when 'discord_id' then
      -- combat_v2_testers.sql: a Discord user id = a string of 17 to 20 digits (a snowflake)
      if jsonb_typeof(p_val) is distinct from 'string' or (p_val #>> '{}') !~ '^[0-9]{17,20}$' then
        e := e || format('%s must be a Discord id (a string of 17 to 20 digits)', at);
      end if;
    else raise exception 'balance_shape_errors: unknown spec %', p_spec;
  end case;
  return e;
end $fn$;

-- ============================================================ 2. the shapes: combat_v2 + testers (the E7b text of combat_v2_monster_tuning.sql otherwise)
create or replace function public.balance_v2_spec(p_key text)
returns jsonb language sql immutable set search_path = public as $fn$
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
    "abl_x": "num 0 1", "support_abl_ref": "num 0 100", "ddg_x": "num 0 1"}'::jsonb
  end;
$fn$;

-- ============================================================ 3. the value: an empty tester list (an existing list stays)
select set_config('balance.by', 'nathan', true);
update public.balance set value = value || '{"testers": []}'::jsonb,
  note = case when position('Shape: exactly these four booleans (balance_check_combat_v2).' in note) > 0
    then replace(note, 'Shape: exactly these four booleans (balance_check_combat_v2).', $n$testers: a list of Discord ids (0 to 20) that play the v2 modes before everyone (combat_v2_testers.sql); combat_v2_on(mode, player) reads it, combat_v2_on(mode) does not. Add or remove an id only in the Admin view (Combat v2 Lab), never in a file. Shape: exactly these four booleans and the tester list (balance_check_combat_v2).$n$)
    else note || $n$ testers: a list of Discord ids (0 to 20) that play the v2 modes before everyone (combat_v2_testers.sql); combat_v2_on(mode, player) reads it.$n$ end
 where key = 'combat_v2' and not value ? 'testers';

-- ============================================================ 4. the reader with a player (fails closed)
create or replace function public.combat_v2_on(p_mode text, p_player text) returns boolean language plpgsql stable set search_path = public as $fn$
declare v jsonb;
begin
  -- on for everyone: the reader of one argument (unchanged)
  if combat_v2_on(p_mode) then return true; end if;
  -- a tester: one of the four capabilities, a player id, and a value of the fixed shape (a bad shape = no tester)
  if p_mode is null or p_mode not in ('gauntlet', 'dungeon', 'hunt', 'progress') or p_player is null then return false; end if;
  select b.value into v from balance b where b.key = 'combat_v2';
  if v is null or cardinality(balance_shape_errors(v, balance_v2_spec('combat_v2'), '')) > 0 then return false; end if;
  return coalesce(v->'testers' ? p_player, false);
exception when others then
  return false;
end $fn$;

-- ============================================================ 5. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['balance_shape_errors(jsonb, jsonb, text)', 'balance_v2_spec(text)', 'combat_v2_on(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.balance_shape_errors(jsonb, jsonb, text) is $cm$[combat] The shape walker of the combat v2 balance keys (combat_v2_flags_balance.sql): the list of problems of a value against a spec ("num lo hi", "int lo hi", "bool", "enum a|b", "discord_id" = a string of 17 to 20 digits, an object with exactly its keys, ["list"|"set", spec, min, max]); empty = fine. discord_id: combat_v2_testers.sql.$cm$;
comment on function public.balance_v2_spec(text) is $cm$[combat] The fixed shape with the limits of each combat v2 balance key (combat_v2, v2_stats, v2_card_hp, v2_asc, v2_level, card_level, v2_support, v2_speed, v2_charge, v2_hit, v2_roles, v2_status, v2_control, v2_enemy, v2_dungeon, v2_hunt, v2_pp, v2_power); NULL for every other key. A new v2 leaf needs a new spec in this function. The E7 tuning added v2_enemy.mechanics.ironhide.crit_x, venom.chance and slowing.chance (combat_v2_monster_tuning.sql); combat_v2.testers (0 to 20 Discord ids, no id twice): combat_v2_testers.sql.$cm$;
comment on function public.combat_v2_on(text, text) is $cm$[combat] The combat v2 switch for one player (plan 14.2, the go-live steps): true when combat_v2_on(p_mode) is true (the mode is on for everyone), or when p_mode is gauntlet, dungeon, hunt or progress and p_player is in balance combat_v2.testers. The tester part fails closed: a NULL mode or player, an unknown capability, a value that does not match the fixed shape (balance_v2_spec), no row or any error gives false. No v1 function calls it. combat_v2_testers.sql.$cm$;

notify pgrst, 'reload schema';
