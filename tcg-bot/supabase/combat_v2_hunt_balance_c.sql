-- combat_v2_hunt_balance_c.sql (2026-11-04): the Hunt v2 boss numbers of M-H option C, decision D-223 (the orchestrator for Nathan,
-- 2026-11-04 overnight; Nathan: "They need to be able to win but also the hunt bosses will have stats changes and the stats that players put
-- on their cards will help overall"). It replaces the M-H band of SPEC ON 6.5 (v1 parity cannot win: the last 3 Heroic v1 Hunts ended with
-- 48-55 % HP left). Measured on a local copy (lptcg-pipeline items/ON/M-H-report.md): 5 real squads, 5 seeds, Auto days, full-event
-- simulation: Normal wins 97 % at 16 member-days, Heroic 93 % at 20, Mythic 87 % at 24; every rotation boss at a Heroic mean of 4,380-4,416.
-- Two logged balance changes (balance_log, "by" = nathan, the repo rule; D-223 is in the v2_enemy note), only these leaves; every value inside balance_v2_spec:
--   1. v2_enemy.hunt.<tier>: hp, atk, speed, def (the private v2 boss of a Hunt day; the shared bar stays boss_hp), and the v2_enemy note:
--      its two statements that C makes false are corrected ("the live v1 values of 2026-10-18", "Mythic 110") and one D-223 sentence is added.
--   2. enemy_v2.bosses.<key>.hp_factor of the 12 rotation bosses (spawn_hunt names); the 4 other bosses are not changed.
-- Needs nothing new (both keys are live). Goes live in the Thursday chain after R3-ON (SPEC ON 10). Undo: combat_v2_hunt_balance_c_undo.sql.
-- A second run changes nothing (same values: balance_log_write skips an unchanged row).
do $mh$
declare
  t jsonb := '{"Normal": {"hp": 35000, "atk": 36, "speed": 85, "def": 0.05},
               "Heroic": {"hp": 32500, "atk": 45, "speed": 85, "def": 0.1},
               "Mythic": {"hp": 28500, "atk": 57, "speed": 94, "def": 0.15}}';
  f jsonb := '{"warlord": 0.82, "netcode": 0.9, "maw": 0.99, "lagspike": 0.74, "pumpkin": 0.77, "nightshade": 0.7, "vampire": 0.91,
               "banwave": 1.02, "smurf": 1.01, "warzombie": 1.06, "skeleton": 0.4, "zerg": 0.7}';
  -- the note: the two old statements and their D-223 text
  o1 text := 'hp and atk (the live v1 values of 2026-10-18; v2 has its own copy because ASC-3 raises card CP and the Lab must set them again, plan 2.3)';
  n1 text := 'hp and atk (v2 has its own copy because ASC-3 raises card CP and the Lab sets them, plan 2.3; since D-223 they are not the v1 values)';
  o2 text := 'Mythic 110 with atk_x 0.91';
  n2 text := 'Mythic 94 with atk_x 0.91 since D-223';
  s text := 'M-H option C, decision D-223 (2026-11-04, combat_v2_hunt_balance_c.sql; the orchestrator for Nathan: the server must be able to win '
    || 'the event; measured on a local copy, 5 real squads): hunt.<tier> hp / atk / speed / def = Normal 35000 / 36 / 85 / 0.05, Heroic 32500 / '
    || '45 / 85 / 0.1, Mythic 28500 / 57 / 94 / 0.15 (before: 70000 / 58 / 100 / 0.1, 80000 / 73 / 100 / 0.15, 80000 / 93 / 110 / 0.2); the '
    || 'hp_factor of the 12 rotation bosses changed in enemy_v2 in the same file. Undo: combat_v2_hunt_balance_c_undo.sql.';
  k text; v jsonb; b jsonb; n text;
begin
  perform set_config('balance.by', 'nathan', true);
  select value, note into v, n from public.balance where key = 'v2_enemy' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c: no balance key v2_enemy'; end if;
  for k in select jsonb_object_keys(t) loop
    if not v->'hunt' ? k then raise exception 'combat_v2_hunt_balance_c: no v2_enemy.hunt.%', k; end if;
    v := jsonb_set(v, array['hunt', k], (v->'hunt'->k) || (t->k));
  end loop;
  -- a second run finds the D-223 note and keeps it
  if position('decision D-223' in n) = 0 then
    if position(o1 in n) = 0 or position(o2 in n) = 0 then
      raise exception 'combat_v2_hunt_balance_c: the v2_enemy note does not have the expected old text (read the note, then change the old text in this file)';
    end if;
    n := replace(replace(n, o1, n1), o2, n2) || ' ' || s;
  end if;
  update public.balance set value = v, note = n where key = 'v2_enemy';
  select value into b from public.balance where key = 'enemy_v2' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c: no balance key enemy_v2'; end if;
  for k in select jsonb_object_keys(f) loop
    if not b->'bosses' ? k then raise exception 'combat_v2_hunt_balance_c: no enemy_v2.bosses.%', k; end if;
    b := jsonb_set(b, array['bosses', k, 'hp_factor'], f->k);
  end loop;
  update public.balance set value = b where key = 'enemy_v2';
  -- the check: every leaf has the D-223 value
  for k in select jsonb_object_keys(t) loop
    if exists (select 1 from jsonb_each(t->k) e where (select value->'hunt'->k->e.key from public.balance where key = 'v2_enemy') is distinct from e.value) then
      raise exception 'combat_v2_hunt_balance_c: v2_enemy.hunt.% is not the D-223 value', k;
    end if;
  end loop;
  if exists (select 1 from jsonb_each(f) e where (select value->'bosses'->e.key->'hp_factor' from public.balance where key = 'enemy_v2') is distinct from e.value) then
    raise exception 'combat_v2_hunt_balance_c: an enemy_v2 hp_factor is not the D-223 value';
  end if;
  if (select position('decision D-223' in note) = 0 or position('the live v1 values' in note) > 0 or position('Mythic 110' in note) > 0
        from public.balance where key = 'v2_enemy') then
    raise exception 'combat_v2_hunt_balance_c: the v2_enemy note is not the D-223 note';
  end if;
end $mh$;
