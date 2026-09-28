-- Pressure test teardown: removes every scratch row (lt_open_*), the scratch boss (id 2)
-- and the mute trigger. Then check that nothing is left:
--   every public text column named player_id/from_id/to_id/... must have 0 rows like 'lt_open_%'.
delete from hunt_events where hunt_id = 2;
delete from hunt_combat_log where hunt_id = 2 or player_id like 'lt_open_%';
delete from hunt_hits where hunt_id = 2 or player_id like 'lt_open_%';
delete from hunt_card_hp where hunt_id = 2 or player_id like 'lt_open_%';
delete from hunt_combat_state where hunt_id = 2 or player_id like 'lt_open_%';
delete from hunts where id = 2;
drop trigger if exists zzz_pressure_mute on hunt_events;
drop function if exists zzz_pressure_mute();
delete from player_cards where player_id like 'lt_open_%';
delete from pack_ledger where player_id like 'lt_open_%';
delete from daily_activity where player_id like 'lt_open_%';
delete from players where id like 'lt_open_%';
