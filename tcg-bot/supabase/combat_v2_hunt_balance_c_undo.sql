-- combat_v2_hunt_balance_c_undo.sql (2026-11-04): the undo of combat_v2_hunt_balance_c.sql (decision D-223). It puts back the values
-- of 2026-11-04 (live before D-223) of exactly the leaves that the C file changes, as two logged balance changes ("by" = nathan):
--   v2_enemy.hunt.<tier>: hp, atk, speed, def; enemy_v2.bosses.<key>.hp_factor of the 12 rotation bosses.
-- It also puts back the exact v2_enemy note of 2026-11-04 (md5 d190366ab7376e893f0d01331175dabb; the file checks the md5).
-- Apply only when Nathan or the orchestrator wants the old Hunt v2 boss numbers back. A second run changes nothing.
-- card-studio/v2sim/config.json keeps the C numbers (v2_enemy.hunt and v2_bosses hp_factor). After a live undo, revert those config.json
-- values in a PR as well (and take combat_v2_hunt_balance_c.sql out of the chain of test-combat-v2-balance, -monsters and -monster-tuning),
-- or the Lab and those tests use the C numbers while the database has the old ones.
do $mh$
declare
  t jsonb := '{"Normal": {"hp": 70000, "atk": 58, "speed": 100, "def": 0.1},
               "Heroic": {"hp": 80000, "atk": 73, "speed": 100, "def": 0.15},
               "Mythic": {"hp": 80000, "atk": 93, "speed": 110, "def": 0.2}}';
  f jsonb := '{"warlord": 0.71, "netcode": 0.87, "maw": 1.1, "lagspike": 0.88, "pumpkin": 0.95, "nightshade": 0.73, "vampire": 0.92,
               "banwave": 1.02, "smurf": 1.26, "warzombie": 1.08, "skeleton": 0.79, "zerg": 0.64}';
  old_note text := $old$Combat v2: the Hunt boss and the enemy mechanics (plan 3.3, 8). hunt.<tier>: hp and atk (the live v1 values of 2026-10-18; v2 has its own copy because ASC-3 raises card CP and the Lab must set them again, plan 2.3), def (Defense), evasion, resolve (a debuff fails with this chance), keen (cuts card Dodge), speed (act_at = one action a step; Mythic 110 with atk_x 0.91), signatures (the number of signature mechanics). boss_heal_ref = the HP that boss heals are measured on (drain_heal, regenerate_heal, mechanics.regrowth.boss_heal). boss_moves = the v2 move table: the chances strike, slam, drain, stun, enrage, curse and regenerate add up to 1 (balance_check_combat_v2); *_x = x ATK; enrage_dur and curse_dur in steps; the Cataclysm every cycle-th boss turn after one Charging turn; rage below rage_at HP gives rage_x. signature_pool = the mechanics a boss can draw. mechanics.<name> = the numbers of each enemy mechanic (purify every Nth action; shatter x to shields; regrowth: a Dungeon foe heals heal x its max HP each step, the Hunt boss heals boss_heal x boss_heal_ref each step, x below_half_x below half HP (1 = no x2: Nathan approved 0.4% flat for the boss and 1% for foes, monsters-v2.md 9.4, 2026-10-19); frost_aura / venom / burning stacks a single hit applies; thick_hide caps Exposed; unstoppable control fail chance; sunder card Defense ignored; steadfast less damage until N different negative statuses; dispeller Empowered and Exposed at x; *_born immune lists). Their texts come with the passives rows (PR E7). asc3_hp_x: Hunt boss HP = hunt.<tier>.hp x asc3_hp_x x the hp_factor of the boss (the rule approved 2026-10-19, monsters-v2.md 9.3; 1.7 is a first proposal; hp_factor comes with the boss rows). weak_role_x: in a "Weak to: role" week the cards of that role deal +weak_role_x damage (approved, 9.6). weak_role_rules.<role> replaces that rule for one role: a Controller week gives damage_x more damage (0) and each control of a Controller on the boss lasts control_add more boss actions (Nathan 2026-10-19). Nothing reads this key until combat_v2 hunt is on. The E7 tuning (2026-10-21, combat_v2_monster_tuning.sql, the Lab set each number): mechanics.ironhide.crit_x = the crit chance factor of the cards against it unless it is Marked (0 = no crit); mechanics.venom.chance and mechanics.slowing.chance = the chance that a hit applies the status (1 = every hit); mechanics.regrowth.heal of a Dungeon foe 1% -> 0.7%. The E7 follow-up (2026-10-21, combat_v2_e7_followup.sql; Nathan chose the value from the Lab table of PR #463): weak_role_x 0.3 -> 0.5 (a Weak to week: cards of that role deal +50%).$old$;
  k text; v jsonb; b jsonb;
begin
  perform set_config('balance.by', 'nathan', true);
  select value into v from public.balance where key = 'v2_enemy' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c_undo: no balance key v2_enemy'; end if;
  for k in select jsonb_object_keys(t) loop
    if not v->'hunt' ? k then raise exception 'combat_v2_hunt_balance_c_undo: no v2_enemy.hunt.%', k; end if;
    v := jsonb_set(v, array['hunt', k], (v->'hunt'->k) || (t->k));
  end loop;
  update public.balance set value = v, note = old_note where key = 'v2_enemy';
  select value into b from public.balance where key = 'enemy_v2' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c_undo: no balance key enemy_v2'; end if;
  for k in select jsonb_object_keys(f) loop
    if not b->'bosses' ? k then raise exception 'combat_v2_hunt_balance_c_undo: no enemy_v2.bosses.%', k; end if;
    b := jsonb_set(b, array['bosses', k, 'hp_factor'], f->k);
  end loop;
  update public.balance set value = b where key = 'enemy_v2';
  for k in select jsonb_object_keys(t) loop
    if exists (select 1 from jsonb_each(t->k) e where (select value->'hunt'->k->e.key from public.balance where key = 'v2_enemy') is distinct from e.value) then
      raise exception 'combat_v2_hunt_balance_c_undo: v2_enemy.hunt.% is not the old value', k;
    end if;
  end loop;
  if exists (select 1 from jsonb_each(f) e where (select value->'bosses'->e.key->'hp_factor' from public.balance where key = 'enemy_v2') is distinct from e.value) then
    raise exception 'combat_v2_hunt_balance_c_undo: an enemy_v2 hp_factor is not the old value';
  end if;
  if (select md5(note) from public.balance where key = 'v2_enemy') <> 'd190366ab7376e893f0d01331175dabb' then
    raise exception 'combat_v2_hunt_balance_c_undo: the v2_enemy note is not the old note';
  end if;
end $mh$;
