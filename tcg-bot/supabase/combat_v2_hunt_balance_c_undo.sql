-- combat_v2_hunt_balance_c_undo.sql (2026-11-04): the undo of combat_v2_hunt_balance_c.sql (decision D-223). It puts back the values
-- of 2026-11-04 (live before D-223) of exactly the leaves that the C file changes, as two logged balance changes ("by" = nathan:D-223-undo):
--   v2_enemy.hunt.<tier>: hp, atk, speed, def; enemy_v2.bosses.<key>.hp_factor of the 12 rotation bosses.
-- Apply only when Nathan or the orchestrator wants the old Hunt v2 boss numbers back. A second run changes nothing.
do $mh$
declare
  t jsonb := '{"Normal": {"hp": 70000, "atk": 58, "speed": 100, "def": 0.1},
               "Heroic": {"hp": 80000, "atk": 73, "speed": 100, "def": 0.15},
               "Mythic": {"hp": 80000, "atk": 93, "speed": 110, "def": 0.2}}';
  f jsonb := '{"warlord": 0.71, "netcode": 0.87, "maw": 1.1, "lagspike": 0.88, "pumpkin": 0.95, "nightshade": 0.73, "vampire": 0.92,
               "banwave": 1.02, "smurf": 1.26, "warzombie": 1.08, "skeleton": 0.79, "zerg": 0.64}';
  k text; v jsonb; b jsonb;
begin
  perform set_config('balance.by', 'nathan:D-223-undo', true);
  select value into v from public.balance where key = 'v2_enemy' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c_undo: no balance key v2_enemy'; end if;
  for k in select jsonb_object_keys(t) loop
    if not v->'hunt' ? k then raise exception 'combat_v2_hunt_balance_c_undo: no v2_enemy.hunt.%', k; end if;
    v := jsonb_set(v, array['hunt', k], (v->'hunt'->k) || (t->k));
  end loop;
  update public.balance set value = v where key = 'v2_enemy';
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
end $mh$;
