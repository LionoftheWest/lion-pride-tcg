-- combat_v2_hunt_balance_c_low_undo.sql (2026-11-05): the undo of combat_v2_hunt_balance_c_low.sql (decision D-223b), back to option C
-- (D-223). One logged balance change of v2_enemy ("by" = nathan): hunt.Heroic.hp 26000 -> 32500, hunt.Mythic.hp 18500 -> 28500, and the
-- note without the D-223b sentence, = the exact C note (md5 78b88fc595479c415f2565e364dc23b7; the file checks the md5).
-- Apply only when Nathan or the orchestrator wants option C back. A second run changes nothing.
-- card-studio/v2sim/config.json keeps the C-low numbers (v2_enemy.hunt.Heroic.hp, v2_enemy.hunt.Mythic.hp). After a live undo, revert them in a
-- PR as well (and take combat_v2_hunt_balance_c_low.sql out of the chain of test-combat-v2-balance, -monsters, -monster-tuning and
-- -e7-followup), or the Lab and those tests use the C-low numbers while the database has the C ones.
do $mh$
declare
  t jsonb := '{"Heroic": {"hp": 32500}, "Mythic": {"hp": 28500}}';
  s text := 'M-H option C-low, decision D-223b (2026-11-05, combat_v2_hunt_balance_c_low.sql; Nathan chose C-low, and each tier must win '
    || '>= 90 % at 16 member-days): hunt.Heroic.hp 32500 -> 26000, hunt.Mythic.hp 28500 -> 18500; Normal, ATK, speed, DEF and the hp_factor '
    || 'values unchanged. Undo to C: combat_v2_hunt_balance_c_low_undo.sql.';
  k text; v jsonb; n text;
begin
  perform set_config('balance.by', 'nathan', true);
  select value, note into v, n from public.balance where key = 'v2_enemy' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c_low_undo: no balance key v2_enemy'; end if;
  for k in select jsonb_object_keys(t) loop
    if not v->'hunt' ? k then raise exception 'combat_v2_hunt_balance_c_low_undo: no v2_enemy.hunt.%', k; end if;
    v := jsonb_set(v, array['hunt', k], (v->'hunt'->k) || (t->k));
  end loop;
  n := replace(n, ' ' || s, '');
  update public.balance set value = v, note = n where key = 'v2_enemy';
  for k in select jsonb_object_keys(t) loop
    if (select value->'hunt'->k->'hp' from public.balance where key = 'v2_enemy') is distinct from t->k->'hp' then
      raise exception 'combat_v2_hunt_balance_c_low_undo: v2_enemy.hunt.%.hp is not the C value', k;
    end if;
  end loop;
  if (select md5(note) from public.balance where key = 'v2_enemy') <> '78b88fc595479c415f2565e364dc23b7' then
    raise exception 'combat_v2_hunt_balance_c_low_undo: the v2_enemy note is not the C note';
  end if;
end $mh$;
