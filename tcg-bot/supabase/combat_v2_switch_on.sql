-- combat_v2_switch_on.sql (2026-11-04): THE combat v2 switch for everyone (SPEC ON v6 sections 3.1 INV-ON-2, 3.6 and 3.7 rule 0).
-- Needs every combat v2 ON file of SPEC ON section 4 (R1-ON, M1e combat_v2_convert.sql, R2-ON, R3-ON) on live first.
-- ONE statement, so ONE transaction (also when a tool sends the file as several statements):
--   1. balance combat_v2: gauntlet, dungeon, hunt and progress true (the testers list does not change). balance_log_write records the change
--      with "by" = nathan.
--   2. combat_v2_convert('m1'): the M1e conversion of every player_cards row with v1 points (it refuses unless progress is ON, so it runs
--      after step 1). A second run of this file adds 0 conversion rows (every card has an input row).
--   3. LAST: one combat_v2_switch_log row (action on, at = clock_timestamp()): the switch time of the live checks (SPEC ON 6.7 row 7).
-- The live checks after the apply: SPEC ON 6.7 (combat_v2_convert_check for rows 2a and 2b; card-studio/scripts/convert-check.mjs).
-- The rollback: combat_v2_switch_off.sql (the 3 mode flags false, progress stays true). Apply: node scripts/apply-sql.mjs <this file> --live.
do $sw$
declare r jsonb;
begin
  perform set_config('balance.by', 'nathan', true);
  update public.balance set value = value || '{"gauntlet": true, "dungeon": true, "hunt": true, "progress": true}'::jsonb where key = 'combat_v2';
  if not found then raise exception 'combat_v2_switch_on.sql: no balance key combat_v2'; end if;
  r := combat_v2_convert('m1');
  raise notice 'combat_v2_switch_on: %', r;
  insert into public.combat_v2_switch_log (action, at) values ('on', clock_timestamp());
end $sw$;
