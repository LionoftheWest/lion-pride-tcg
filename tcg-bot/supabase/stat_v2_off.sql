-- stat_v2_off.sql (2026-11-06): STAT-V2 release step 7, the rollback of the flag.
-- It sets settings stat_v2.enabled to false. The users list does not change (the listed members keep the v2 screen). settings_log_write records
-- the change. Needs stat_v2.sql.
-- Effect: the members who are not in users get the state after the switch again (D1: the old 5-stat editor that cannot save; the Shop stat reset
-- paused). The card_progress_v2 rows and ledger rows stay. To remove the code too, apply stat_v2_undo.sql after this file.
-- The Activity reads the flag once a minute (statV2 in /api/flags). A second run changes nothing.
do $sw$
begin
  perform set_config('balance.by', 'nathan', true);
  if not exists (select 1 from public.settings where key = 'stat_v2') then raise exception 'stat_v2_off.sql: no settings row stat_v2 (apply stat_v2.sql first)'; end if;
  update public.settings set value = jsonb_set(value, '{enabled}', 'false'::jsonb), updated_at = now()
   where key = 'stat_v2' and value->'enabled' is distinct from 'false'::jsonb;
end $sw$;
