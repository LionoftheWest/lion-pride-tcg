-- combat_v2_switch_off.sql (2026-11-04): THE combat v2 rollback (SPEC ON v6 sections 3.1 INV-ON-2 and 3.6).
-- ONE statement, so ONE transaction:
--   1. balance combat_v2: gauntlet, dungeon and hunt false. progress STAYS true: the v1 spend and the Shop reset stay frozen (M1d, M1e) and
--      the converted rows stay valid; v1 fights read the untouched v1 points (card_combat). The testers list does not change.
--   2. LAST: one combat_v2_switch_log row (action off, at = clock_timestamp()).
-- No conversion undo: the v1 points were never changed (combat_v2_convert_undo is for a full undo before members play, not for this file).
-- Started v2 runs and days finish in v2 and pay (INV-ON-1). Apply: node scripts/apply-sql.mjs <this file> --live.
do $sw$
begin
  perform set_config('balance.by', 'nathan', true);
  update public.balance set value = value || '{"gauntlet": false, "dungeon": false, "hunt": false}'::jsonb where key = 'combat_v2';
  if not found then raise exception 'combat_v2_switch_off.sql: no balance key combat_v2'; end if;
  insert into public.combat_v2_switch_log (action, at) values ('off', clock_timestamp());
end $sw$;
