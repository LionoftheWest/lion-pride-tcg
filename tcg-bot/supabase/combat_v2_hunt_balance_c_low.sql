-- combat_v2_hunt_balance_c_low.sql (2026-11-05): M-H option C-low, decision D-223b. Nathan chose C-low (2026-11-05 about 05:30 MT). The
-- orchestrator's rule for the other tiers (D-223b): each tier must win the event >= 90 % at 16 member-days; a tier below that gets only the
-- smallest HP cut that reaches 90 %. Measured on a local copy (live + M1e + R2-ON + R3-ON + combat_v2_hunt_balance_c.sql + the switch file;
-- 5 real squads, 5 seeds, Auto days, the credit at 6 boss HP levels, full-event simulation; lptcg-pipeline items/ON/M-H-report.md section 10):
--   Heroic hp 32500 -> 26000 (Nathan's value): 90 % at 16 member-days (was 4 %).
--   Mythic hp 28500 -> 18500 (the smallest cut in steps of 500 that reaches 90 %: 19000 gives 84 %): 90 % at 16 (was 0 %).
--   Normal hp 35000: 97 % at 16, not changed. ATK, speed, DEF of every tier and the enemy_v2 hp_factor values are not changed.
-- Needs combat_v2_hunt_balance_c.sql first (it refuses otherwise). One logged balance change of v2_enemy ("by" = nathan, the repo rule):
-- the two hp leaves and one D-223b sentence at the end of the note. A second run changes nothing.
-- Undo (back to C): combat_v2_hunt_balance_c_low_undo.sql.
do $mh$
declare
  t jsonb := '{"Heroic": {"hp": 26000}, "Mythic": {"hp": 18500}}';
  s text := 'M-H option C-low, decision D-223b (2026-11-05, combat_v2_hunt_balance_c_low.sql; Nathan chose C-low, and each tier must win '
    || '>= 90 % at 16 member-days): hunt.Heroic.hp 32500 -> 26000, hunt.Mythic.hp 28500 -> 18500; Normal, ATK, speed, DEF and the hp_factor '
    || 'values unchanged. Undo to C: combat_v2_hunt_balance_c_low_undo.sql.';
  k text; v jsonb; n text;
begin
  perform set_config('balance.by', 'nathan', true);
  select value, note into v, n from public.balance where key = 'v2_enemy' for update;
  if not found then raise exception 'combat_v2_hunt_balance_c_low: no balance key v2_enemy'; end if;
  if position('decision D-223 ' in n) = 0 then
    raise exception 'combat_v2_hunt_balance_c_low: combat_v2_hunt_balance_c.sql (D-223) is not applied (the v2_enemy note has no D-223 sentence)';
  end if;
  for k in select jsonb_object_keys(t) loop
    if not v->'hunt' ? k then raise exception 'combat_v2_hunt_balance_c_low: no v2_enemy.hunt.%', k; end if;
    v := jsonb_set(v, array['hunt', k], (v->'hunt'->k) || (t->k));
  end loop;
  -- a second run finds the D-223b sentence and keeps it
  if position('decision D-223b' in n) = 0 then n := n || ' ' || s; end if;
  update public.balance set value = v, note = n where key = 'v2_enemy';
  -- the check: the two leaves have the D-223b value, the note has the sentence once
  for k in select jsonb_object_keys(t) loop
    if (select value->'hunt'->k->'hp' from public.balance where key = 'v2_enemy') is distinct from t->k->'hp' then
      raise exception 'combat_v2_hunt_balance_c_low: v2_enemy.hunt.%.hp is not the D-223b value', k;
    end if;
  end loop;
  if (select (length(note) - length(replace(note, 'decision D-223b', ''))) / length('decision D-223b') <> 1 from public.balance where key = 'v2_enemy') then
    raise exception 'combat_v2_hunt_balance_c_low: the v2_enemy note does not name D-223b once';
  end if;
end $mh$;
