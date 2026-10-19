-- combat_v2_flags_balance.sql (2026-10-18): combat v2, phase 1, PR V1 (docs/combat-redesign-plan.md sections 9.2 and 14).
-- Needs f3_engine_cleanup.sql (F-3 PR 4e) first: this file is built on top of it and changes nothing that 4e made.
-- Before: no combat v2 object in the database. The tuned v2 numbers live only in card-studio/v2sim/config.json (PR #436).
-- After this file:
--   balance combat_v2: the flag, one boolean per capability (gauntlet, dungeon, hunt, progress), ALL false.
--   combat_v2_on(mode): the one reader of the flag. It FAILS CLOSED: a missing key, a value that is not a JSON boolean, an unknown capability or any
--     error gives false.
--   balance v2_stats, v2_card_hp, v2_asc, v2_level, card_level, v2_support, v2_speed, v2_charge, v2_hit, v2_roles, v2_status, v2_control, v2_enemy,
--     v2_dungeon, v2_hunt, v2_pp, v2_power: every v2 number of config.json (plan 9.2), each key with a note, a FIXED shape and limits:
--     balance_v2_spec(key) holds the shape (every leaf with its type and limits), balance_shape_errors walks it, and the trigger
--     balance_check_combat_v2 refuses a value with a missing, extra or wrong leaf, and a key named v2_* that has no shape.
--   Each insert writes a balance_log row with "by" = nathan.
-- NO CHANGE IN PLAY: no v1 function reads a new key or calls combat_v2_on (the flag is OFF and nothing reads it yet). The goldens, the shadow test and
-- fight-timing.mjs prove it (the PR text).
-- What config.json has that this file leaves out, and why: the test card-studio/scripts/test-combat-v2-balance.mjs lists each left-out leaf with its
-- reason (live floor plan rules, monster rows of the dungeon_monsters table, simulator-only dials, texts that would copy a number).
-- Idempotent: an existing value stays (insert ... on conflict do nothing).
-- Test: card-studio/scripts/test-combat-v2-balance.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the shape walker
-- A spec is a JSON value:
--   "num <lo> <hi>"   a number from lo to hi        "int <lo> <hi>"   a whole number from lo to hi
--   "bool"            true or false                 "enum a|b|c"      one of the words
--   {"k": spec, ...}  an object with EXACTLY these keys (a missing or an extra key is refused)
--   ["list", spec, min, max]   a list of min to max items        ["set", spec, min, max]   the same, with no item twice
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
    else raise exception 'balance_shape_errors: unknown spec %', p_spec;
  end case;
  return e;
end $fn$;

-- ============================================================ 2. the shapes and limits of the v2 keys (NULL = not a v2 key)
-- The limits are about 2 x the tuned value or the natural range of a share (0 to 1); a whole-number count is "int".
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
    "enabler_extra_stack": ["set", "enum normal|illustrated_rare|secret_rare|full_art|gold|promo|event", 0, 7]}'::jsonb
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
    "empowered": {"cap": "num 0 5"},
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
      "purify": {"every": "int 1 10"}, "ironhide": {}, "true_strike": {}, "shatter": {"shield_x": "num 1 5"},
      "regrowth": {"heal": "num 0 0.2", "below_half_x": "num 1 5"}, "frost_aura": {"chill": "int 1 5"}, "thick_hide": {"expose_cap": "num 0 1"},
      "unstoppable": {"control_fail": "num 0 1"}, "venom": {"poison": "int 1 5"}, "burning": {"burn": "int 1 5"}, "sunder": {"pierce": "num 0 1"},
      "slowing": {}, "elusive": {},
      "toxic_born": {"immune": ["set", "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark", 1, 13]},
      "fireborn":   {"immune": ["set", "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark", 1, 13]},
      "frostborn":  {"immune": ["set", "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark", 1, 13]},
      "steadfast": {"dr": "num 0 1", "kinds": "int 1 13"}, "dispeller": {"x": "num 0 1"}}}'::jsonb
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
    "passive_pool": ["set", "enum purify|ironhide|true_strike|shatter|regrowth|frost_aura|thick_hide|unstoppable|venom|burning|sunder|slowing|elusive|toxic_born|fireborn|frostborn|steadfast|dispeller", 1, 18]}'::jsonb
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
                   "consume": "num 0 200"}}'::jsonb
  when 'v2_power' then '{
    "k": {"breaker": "num 0.2 5", "striker": "num 0.2 5", "flurry": "num 0.2 5", "finisher": "num 0.2 5", "survivor": "num 0.2 5", "cleaver": "num 0.2 5",
          "warden": "num 0.2 5", "medic": "num 0.2 5", "controller": "num 0.2 5", "spotter": "num 0.2 5", "herald": "num 0.2 5", "artillery": "num 0.2 5"},
    "abl_x": "num 0 1", "support_abl_ref": "num 0 100", "ddg_x": "num 0 1"}'::jsonb
  end;
$fn$;

-- ============================================================ 3. the trigger: the shape, the limits and the rules that join two leaves
create or replace function public.balance_check_combat_v2() returns trigger language plpgsql set search_path = public as $fn$
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
    end if;
  end if;
  if cardinality(errs) > 0 then raise exception 'balance %: %', new.key, array_to_string(errs, '; '); end if;
  return new;
end $fn$;
drop trigger if exists balance_check_combat_v2 on public.balance;
create trigger balance_check_combat_v2 before insert or update on public.balance
  for each row execute function public.balance_check_combat_v2();

-- ============================================================ 4. the values (config.json of card-studio/v2sim, the tuning pass of 2026-10-18)
select set_config('balance.by', 'nathan', true);
insert into public.balance (key, value, note) values
('combat_v2', '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}',
 $n$The combat v2 switch (docs/combat-redesign-plan.md 14.2; combat_v2_flags_balance.sql). One boolean for each capability: gauntlet, dungeon, hunt (the fights of that mode play combat v2) and progress (card levels, the 9 stats and ASC-3). All false = combat v1 everywhere, exactly as before. Read ONLY through combat_v2_on(mode), which fails closed (a missing key, a value that is not true or false, an unknown capability or an error = false). The order to go live: Gauntlet, then Dungeon (with progress), then Hunt, each mode at least one full week; the Hunt only between two Hunts. Rollback: set the mode false. Shape: exactly these four booleans (balance_check_combat_v2).$n$),
('v2_stats', '{"max_per_stat":10,"atk":{"flat":3},"def":{"pct":0.03,"cap":0.3},"hp":{"flat":8},"crd":{"base":2,"pct":0.1},"crt":{"base":0.1,"pct":0.04,"cap":0.6},"abl":{"pct":0.05},"ddg":{"pct":0.03,"cap":0.3,"area_x":0.5},"acc":{"pct":0.02},"spd":{"pct":0.03}}',
 $n$Combat v2: the 9 stats of every card (plan 2.2), per stat point, with max_per_stat points in one stat. atk.flat = CP for each point; def.pct = less damage taken for each point, up to def.cap; hp.flat = HP for each point; crit damage = crd.base + crd.pct x points; crit chance = crt.base + adds + crt.pct x points, up to crt.cap; abl.pct = more for the active's amounts for each point; ddg.pct = dodge for each point (single hits; area hits x ddg.area_x), up to ddg.cap; acc.pct = less own miss and less enemy resolve for each point; spd.pct = more speed for each point. Tuned in the simulator (v2sim, 2026-10-18); the Combat Lab confirms them. Nothing reads this key until the progress / mode flags of combat_v2 are on.$n$),
('v2_card_hp', '{"base":50,"per_cp":1.5}',
 $n$Combat v2: card max HP = base + per_cp x CP_base + v2_stats.hp.flat x HP points (plan 2.2). Supports have HP in v2 (enemies can hit them). Nothing reads this key until combat_v2 is on.$n$),
('v2_asc', '{"base":{"normal":25,"illustrated_rare":40,"secret_rare":60,"full_art":100,"gold":149.333},"top":{"normal":75,"illustrated_rare":140,"secret_rare":140,"full_art":187.5,"gold":224},"curve":[0,0.286,0.5,0.678,0.857,1],"alias":{"promo":"normal","event":"full_art"}}',
 $n$Combat v2: ascension ASC-3 (plan 2.3, decided 2026-10-18). CP = base[r] x (1 + (top[r] / base[r] - 1) x curve[stars]) x cp_mod. curve = the share of the way from the 0-star base to the 5-star top for 0 to 5 stars (starts at 0, ends at 1, never falls). top = the 5-star value of today (no live card loses CP). alias: promo uses normal, event uses full_art. Stars give no stat points in v2. Rules: every card rarity has a base or an alias; base is never above top (balance_check_combat_v2). Nothing reads this key until combat_v2 progress is on.$n$),
('v2_level', '{"max_level":30,"points_per_level":1,"converge_d":0.22,"target_cp":260}',
 $n$Combat v2: card levels (plan 2.4). points_per_level stat points for each level up to max_level. The catch-up dial: CP' = CP + converge_d x (level / max_level) x (target_cp - CP); HP and the support factor use CP'. converge_d 0 turns it off; 0.22 gives the decided end gap Gold / Normal x2.14 Hunt damage (v2sim). The XP rules are in card_level. Nothing reads this key until combat_v2 progress is on.$n$),
('card_level', '{"xp_hunt_day":10,"xp_dungeon_run":10,"cost_base":5,"cost_per_level":1,"catchup_x":2,"catchup_top":8}',
 $n$Combat v2: the XP rules of card levels (plan 2.4, a PROPOSAL, not tuned). A card gets xp_hunt_day XP for each Hunt day in which it acts or is hit, and xp_dungeon_run for each Dungeon run (the Gauntlet gives no XP: its cards are not the player's cards). Level L to L+1 costs cost_base + cost_per_level x L XP (level 30 = 585 XP). Catch-up: a card below the mean level of the player's catchup_top best cards gets catchup_x XP. Nothing reads this key until combat_v2 progress is on (PR M1).$n$),
('v2_support', '{"basic_x":0.18,"power_ref":25,"power_exp":0.1,"enabler_extra_stack":["full_art","event","gold"]}',
 $n$Combat v2: supports (plan 2.1). A support's basic attack hits for basic_x x CP (Artillery: v2_roles.artillery.basic_x). Support amounts scale by F = (CP_base / power_ref) ^ power_exp, so rarity and stars scale the numbers, not the blocks. An enabler of a rarity in enabler_extra_stack applies one more stack (a proposal). Nothing reads this key until combat_v2 is on.$n$),
('v2_speed', '{"role_base":{"breaker":16,"striker":17,"flurry":18,"finisher":17,"survivor":15,"cleaver":15,"warden":24,"medic":24,"controller":20,"spotter":23,"herald":24,"artillery":20},"act_at":100,"status_min_x":0.4,"safety_max_x":1.6,"max_actions_per_step":4}',
 $n$Combat v2: turn system B (plan 3.1, decided). Each clock step every standing unit adds its speed to its meter; a unit at act_at acts and loses act_at (speed act_at = one action a step). Card speed = role_base[role] x (1 + v2_stats.spd.pct x SPD points) x status multipliers, with the status multiplier kept from status_min_x to safety_max_x. A unit acts at most max_actions_per_step times in one step. Enemy speeds: v2_enemy (Hunt) and v2_dungeon.kinds. Rule: status_min_x is not above safety_max_x. Nothing reads this key until combat_v2 is on (PR E2).$n$),
('v2_charge', '{"attacker":2,"support":1,"start":0}',
 $n$Combat v2: the active ability charges over the card's own turns (plan 2.1). It is ready after attacker (or support) own turns that did not use it. The charge is start at the beginning of each fight (each Hunt day). Speed replaces cooldowns in v2. Nothing reads this key until combat_v2 is on.$n$),
('v2_hit', '{"miss":0.08,"roll_min":0.85,"roll_span":0.3,"resolve_acc":0.02,"min_dmg":1}',
 $n$Combat v2: the hit core (plan 2.2, 6.2). miss = the base miss chance (own miss = max(0, miss + evasion + blind - v2_stats.acc.pct x ACC)); the damage roll is roll_min + random x roll_span; resolve_acc = enemy resolve removed for each Accuracy point; a hit deals at least min_dmg (ticks excepted). miss, roll_min and roll_span equal the live v1 numbers of balance combat today: v2 has its own copy so that a Lab change for v2 never moves v1 (plan P6). Nothing reads this key until combat_v2 is on.$n$),
('v2_roles', '{"breaker":{"pierce":0.3,"shield_x":1.5},"striker":{"crit_add":0.08,"critx_add":0.2},"flurry":{"extra_chance":0.2,"extra_x":0.5},"finisher":{"line":0.3,"bonus":0.4},"survivor":{"lifesteal":0.15,"cap_maxhp":0.08},"cleaver":{"splash":0.6,"hunt_bonus":0.1,"hunt_area_x":0.2},"warden":{"ally_dr":0.08,"taunt_w":2},"medic":{"heal_after":0.05},"controller":{"resolve_ignore":0.5,"dur_add":1},"spotter":{"basic_expose":0.15,"basic_expose_dur":2},"herald":{"basic_empower":0.15},"artillery":{"basic_x":0.25,"true_strike":true}}',
 $n$Combat v2: the numbers of the 12 role passives (plan 4). Breaker: hits ignore pierce of Defense and deal shield_x to shields. Striker: +crit_add crit chance, +critx_add crit damage. Flurry: a basic attack strikes again with extra_chance at extra_x. Finisher: +bonus damage to a target below line HP. Survivor: heals lifesteal of the damage it deals, at most cap_maxhp of its max HP a hit. Cleaver: basic attacks also hit every other foe for splash; Hunt: +hunt_bonus damage and an area active adds hunt_area_x of its area value. Warden: allies take ally_dr less while it stands; enemies pick it taunt_w times as often. Medic: after each action heals the most hurt ally heal_after of its max HP. Controller: its debuffs ignore resolve_ignore of enemy resolve and last dur_add steps longer. Spotter: its basic attack Exposes basic_expose for basic_expose_dur steps. Herald: its basic attack Empowers the strongest attacker basic_empower. Artillery: its basic attack deals basic_x x CP and cannot miss (true_strike). The class, label and passive text are in the roles table. Nothing reads this key until combat_v2 is on.$n$),
('v2_status', '{"poison":{"tick":0.02,"burst_at":3,"burst":0.12,"dur":4,"dur_card":8,"ignore_shield":true},"burn":{"tick_x":1.5,"max":5,"decay":1,"heal_x":0.5,"vs_healer_x":1.5,"ignore_shield":true},"stunned":{"max_life":4,"max_life_card":12},"frozen":{"max_life":4,"max_life_card":12},"sleep":{"dur":3,"dur_card":10},"paralyzed":{"dur":3,"dur_card":10,"fail":0.5},"blinded":{"miss":0.25,"dur":2,"dur_card":8},"confused":{"chance":0.3,"self_x":0.5,"dur":2,"dur_card":8},"slowed":{"x":0.7,"dur":3,"dur_card":10},"quickened":{"x":1.3,"dur":3,"dur_card":10},"chill":{"dmg":0.08,"spd":0.08,"freeze_at":3,"dur":3,"dur_card":10},"exposed":{"cap":1,"dur":2,"dur_card":8},"weakened":{"cap":0.6,"dur":2,"dur_card":10},"mark":{"dur":4},"shielded":{"cap_maxhp":1},"empowered":{"cap":1.5},"focused":{"dur":10},"enraged":{"x":1.4,"dur":2},"hunt_ref_hp":700}',
 $n$Combat v2: the numbers of the 16 statuses and the enemy state Enraged (plan 6). Durations count clock steps: dur on an enemy, dur_card on a card (cards act less often). Poison: each stack ticks tick x ref HP at step end; stack burst_at bursts for burst x ref HP, then Poison resets. Burn: each stack ticks tick_x x the Poison tick then loses decay stacks, max stacks max; a Burning unit heals heal_x; x vs_healer_x vs a healer. Stunned / Frozen: skip the next action (max_life = the safety limit of steps). Paralyzed: each action fails with fail. Blinded: +miss. Confused: chance that a single attack hits a wrong target (self_x of its attack). Slowed / Quickened: speed x x. Chill: each stack -dmg damage and -spd speed; at freeze_at stacks Frozen. Exposed / Weakened: value caps cap. Shielded: at most cap_maxhp x max HP. Empowered: at most cap. Enraged: x x for dur steps. hunt_ref_hp = the ref HP of the Hunt boss (the Dungeon uses the foe max HP). The family, the stacking rule, the icon and the rule text of each status are in the statuses table. Nothing reads this key until combat_v2 is on.$n$),
('v2_control', '{"immune":2,"immune_card":8,"boss_immune":2,"boss_max_dur":1}',
 $n$Combat v2: ONE control immunity (plan 6.2, decided). Stunned, Frozen, Sleep and Paralyzed share it; it starts when a control status ends and lasts immune steps on a foe, immune_card on a card, boss_immune on the Hunt boss. On the Hunt boss a control lasts at most boss_max_dur steps (the no-lock bound: the boss loses at most 1 action in 1 + boss_immune). Nothing reads this key until combat_v2 is on.$n$),
('v2_enemy', '{"hunt":{"Normal":{"hp":70000,"atk":58,"def":0.1,"evasion":0,"resolve":0,"keen":0,"speed":100,"atk_x":1,"signatures":1},"Heroic":{"hp":80000,"atk":73,"def":0.15,"evasion":0.04,"resolve":0.1,"keen":0,"speed":100,"atk_x":1,"signatures":1},"Mythic":{"hp":80000,"atk":93,"def":0.2,"evasion":0.08,"resolve":0.2,"keen":0.25,"speed":110,"atk_x":0.91,"signatures":2}},"boss_heal_ref":3000,"boss_moves":{"strike":0.4,"strike_x":1,"slam":0.22,"slam_x":0.35,"drain":0.1,"drain_x":0.8,"drain_heal":0.015,"stun":0.08,"stun_x":0.45,"enrage":0.07,"enrage_x":1.4,"enrage_dur":2,"curse":0.06,"curse_weaken":0.3,"curse_dur":10,"regenerate":0.07,"regenerate_heal":0.03,"regenerate_heal_rage":0.05,"cycle":8,"cataclysm_x":0.75,"rage_at":0.5,"rage_x":1.3},"signature_pool":["purify","ironhide","true_strike","shatter","regrowth","frost_aura","thick_hide","unstoppable","venom","sunder","slowing","elusive","dispeller"],"mechanics":{"purify":{"every":3},"ironhide":{},"true_strike":{},"shatter":{"shield_x":2},"regrowth":{"heal":0.01,"below_half_x":2},"frost_aura":{"chill":1},"thick_hide":{"expose_cap":0.15},"unstoppable":{"control_fail":0.9},"venom":{"poison":1},"burning":{"burn":2},"sunder":{"pierce":0.5},"slowing":{},"elusive":{},"toxic_born":{"immune":["poison"]},"fireborn":{"immune":["burn"]},"frostborn":{"immune":["chill","frozen"]},"steadfast":{"dr":0.4,"kinds":3},"dispeller":{"x":0.1}}}',
 $n$Combat v2: the Hunt boss and the enemy mechanics (plan 3.3, 8). hunt.<tier>: hp and atk (the live v1 values of 2026-10-18; v2 has its own copy because ASC-3 raises card CP and the Lab must set them again, plan 2.3), def (Defense), evasion, resolve (a debuff fails with this chance), keen (cuts card Dodge), speed (act_at = one action a step; Mythic 110 with atk_x 0.91), signatures (the number of signature mechanics). boss_heal_ref = the HP that boss heals are measured on (drain_heal, regenerate_heal). boss_moves = the v2 move table: the chances strike, slam, drain, stun, enrage, curse and regenerate add up to 1 (balance_check_combat_v2); *_x = x ATK; enrage_dur and curse_dur in steps; the Cataclysm every cycle-th boss turn after one Charging turn; rage below rage_at HP gives rage_x. signature_pool = the mechanics a boss can draw. mechanics.<name> = the numbers of each enemy mechanic (purify every Nth action; shatter x to shields; regrowth heal a step, x below half; frost_aura / venom / burning stacks a single hit applies; thick_hide caps Exposed; unstoppable control fail chance; sunder card Defense ignored; steadfast less damage until N different negative statuses; dispeller Empowered and Exposed at x; *_born immune lists). Their texts come with the passives rows (PR E7). Nothing reads this key until combat_v2 hunt is on.$n$),
('v2_dungeon', '{"round_cap":40,"hp_x":1,"atk_x":1,"growth":{"hp":1.42,"atk":1.22,"room":0.06,"early_floors":1,"early_hp":0.5,"early_atk":0.5},"kinds":{"fight":{"hp":1,"atk":1,"def":0.05,"speed":50,"passives":0,"charge":false},"horde":{"hp":0.6,"atk":0.75,"def":0,"speed":55,"passives":0,"charge":false},"elite":{"hp":1.9,"atk":1.3,"def":0.1,"speed":50,"passives":1,"charge":false},"miniboss":{"hp":2.6,"atk":1.45,"def":0.15,"speed":48,"passives":1,"charge":true},"guardian":{"hp":2.5,"atk":1.7,"def":0.2,"speed":45,"passives":2,"charge":true}},"foe_resolve":{"fight":0,"horde":0,"elite":0.1,"miniboss":0.1,"guardian":0.2},"foe_evasion_per_floor":0.01,"foe_evasion_max":0.08,"pool_moves":{"cycle":6,"cataclysm_x":0.75,"heavy_x":1.5,"flurry_x":0.55,"slam_x":0.35,"stun_x":0.45,"drain_x":0.8,"drain_heal":0.08,"poison_x":0.35,"regenerate_heal":0.1,"regenerate_heal_rage":0.14,"guard":0.2,"curse_weaken":0.3},"passive_pool":["purify","ironhide","thick_hide","regrowth","unstoppable","frost_aura","venom","burning","true_strike","shatter","toxic_born","fireborn","frostborn","sunder"]}',
 $n$Combat v2: Dungeon and Gauntlet foes (plan 3.3, 8.3). round_cap = clock steps a fight. Foe stats = monster x growth x kinds.<room kind> x hp_x / atk_x (hp_x and atk_x are the v2 tuning dials, 1 = none). growth, kinds.hp and kinds.atk equal the live v1 numbers today (balance dungeon); v2 has its own copy because ASC-3 raises card CP and the Lab must set the foe growth again (plan 2.3). kinds.<kind>: def (Defense), speed (act_at = one action a step), passives (mechanics drawn from passive_pool), charge (the kind charges a Cataclysm). foe_resolve.<kind> = the chance a debuff fails. Foe evasion grows foe_evasion_per_floor a floor up to foe_evasion_max. pool_moves = the v2 monster move numbers (x ATK, heal shares). The floor plan (rooms, room weights, foe counts, rest rooms) and the monster rows stay v1 data (balance dungeon, dungeon_monsters). Nothing reads this key until combat_v2 dungeon or gauntlet is on.$n$),
('v2_hunt', '{"round_cap":40}',
 $n$Combat v2: the Hunt day cap is round_cap clock STEPS (not card actions; plan 3.3 and decision 8), so Speed gives more actions inside a fixed cap. Nothing reads this key until combat_v2 hunt is on.$n$),
('v2_pp', '{"budget":10,"tolerance":0.6,"ref":{"enemy_def":0.15,"miss":0.1,"foes_other":0.75,"crit_share":0.3,"frozen_share":0.2,"shield_share":0.15,"stacks":1.5,"kinds":1.5,"payoff":0.6,"heal_value":0.4},"status_pp":{"poison":4,"burn":1.5,"chill":2,"mark":16,"exposed":25,"weakened":23.3,"stunned":8,"frozen":8,"sleep":5,"paralyzed":5,"blinded":3,"confused":4,"slowed":3,"shield_self":20,"empower_ally":10},"support_pp":{"shield":25,"shield_all":75,"heal":16.7,"heal_all":60,"empower":20,"rally":50,"quicken":13.3,"focus_crit":20,"focus_crd":5,"smite":5,"cleanse":4,"dispel":4,"consume":4}}',
 $n$Combat v2: power points (PP), the price list of the ability blocks (plan 5.2). 1 PP = +2.5% of the card's expected damage per own turn. Every subject's active costs budget PP, plus or minus tolerance. ref = the reference fight that the prices assume (enemy Defense, miss, other foes, the shares of crits, Frozen and shields, mean stacks and status kinds, payoff = the price share of a payoff block, heal_value). status_pp = PP for each 1.0 of value or each stack of a status a block applies; support_pp = PP of each support main block. Read by the ability validator (PR E6) and the studio builder (PR T1); no fight reads it.$n$),
('v2_power', '{"k":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"abl_x":0.25,"support_abl_ref":25,"ddg_x":0.7}',
 $n$Combat v2: the Power number of a card (plan 2.5). Offense (attacker) = CP x (1 + crit x (critdmg - 1)) x hit chance x speed x (1 + abl_x x (ABL - 1)); Offense (support) = (basic hit + support_abl_ref x F x ABL) x the crit term x speed; Survival = HP / (1 - DEF) / (1 - ddg_x x DDG); Power = Offense x Survival x k[role]. k is 1 for every role here = NOT FITTED YET: E9 adds the smite, status and control value to the Offense term (decision 3) and fits k on the Lab (target 0.85 to 1.15). Read by card_power_v2 (PR E9); no fight reads it.$n$)
on conflict (key) do nothing;

-- ============================================================ 5. the one reader of the flag (fails closed)
create or replace function public.combat_v2_on(p_mode text) returns boolean language plpgsql stable set search_path = public as $fn$
declare v jsonb;
begin
  -- only the four capabilities of the fixed shape (an unknown name is OFF even when a value has it)
  if p_mode is null or p_mode not in ('gauntlet', 'dungeon', 'hunt', 'progress') then return false; end if;
  select b.value -> p_mode into v from balance b where b.key = 'combat_v2';
  return coalesce(v = 'true'::jsonb, false);
exception when others then
  return false;
end $fn$;

-- ============================================================ 6. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['balance_shape_errors(jsonb, jsonb, text)', 'balance_v2_spec(text)', 'balance_check_combat_v2()', 'combat_v2_on(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.balance_shape_errors(jsonb, jsonb, text) is $cm$[combat] The shape walker of the combat v2 balance keys (combat_v2_flags_balance.sql): the list of problems of a value against a spec ("num lo hi", "int lo hi", "bool", "enum a|b", an object with exactly its keys, ["list"|"set", spec, min, max]); empty = fine.$cm$;
comment on function public.balance_v2_spec(text) is $cm$[combat] The fixed shape with the limits of each combat v2 balance key (combat_v2, v2_stats, v2_card_hp, v2_asc, v2_level, card_level, v2_support, v2_speed, v2_charge, v2_hit, v2_roles, v2_status, v2_control, v2_enemy, v2_dungeon, v2_hunt, v2_pp, v2_power); NULL for every other key. A new v2 leaf needs a new spec in this function.$cm$;
comment on function public.balance_check_combat_v2() is $cm$Trigger (before insert, update on balance): every combat v2 key must match its fixed shape and limits (balance_v2_spec): no missing, extra or wrong leaf. A key named v2_* with no shape is refused. Extra rules: v2_asc (the curve from 0 to 1, never falling; base not above top; every card rarity has a base or an alias), v2_enemy (the boss move chances add up to 1). The limits of v2_speed keep status_min_x at or below 1 and safety_max_x at or above 1. combat_v2_flags_balance.sql.$cm$;
comment on function public.combat_v2_on(text) is $cm$[combat] The ONE reader of the combat v2 switch (balance combat_v2, plan 14.2): true only when combat_v2.<p_mode> is the JSON boolean true (p_mode = gauntlet, dungeon, hunt or progress). Fails closed: a missing key, another type, a name that is not one of the four capabilities or any error gives false. No v1 function calls it.$cm$;

notify pgrst, 'reload schema';
