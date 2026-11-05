-- combat_v2_hunt_balance_c.sql (2026-11-04): the Hunt v2 boss numbers of M-H option C, decision D-223 (the orchestrator for Nathan,
-- 2026-11-04 overnight; Nathan: "They need to be able to win but also the hunt bosses will have stats changes and the stats that players put
-- on their cards will help overall"). It replaces the M-H band of SPEC ON 6.5 (v1 parity cannot win: the last 3 Heroic v1 Hunts ended with
-- 48-55 % HP left). Measured on a local copy (lptcg-pipeline items/ON/M-H-report.md): 5 real squads, 5 seeds, Auto days, full-event
-- simulation: Normal wins 97 % at 16 member-days, Heroic 93 % at 20, Mythic 87 % at 24; every rotation boss at a Heroic mean of 4,380-4,416.
-- Two logged balance changes (balance_log, "by" = nathan:D-223), only these leaves; every value inside balance_v2_spec:
--   1. v2_enemy.hunt.<tier>: hp, atk, speed, def (the private v2 boss of a Hunt day; the shared bar stays boss_hp).
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
  k text; v jsonb; b jsonb;
begin
  perform set_config('balance.by', 'nathan:D-223', true);
  select value into v from public.balance where key = 'v2_enemy' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c: no balance key v2_enemy'; end if;
  for k in select jsonb_object_keys(t) loop
    if not v->'hunt' ? k then raise exception 'combat_v2_hunt_balance_c: no v2_enemy.hunt.%', k; end if;
    v := jsonb_set(v, array['hunt', k], (v->'hunt'->k) || (t->k));
  end loop;
  update public.balance set value = v where key = 'v2_enemy';
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
end $mh$;
