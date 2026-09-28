-- Run with the Management API (card-studio q helper) BEFORE tools/pressure.mjs; pressure_teardown.sql after.
-- Run it only when no boss with a higher id is closing soon: the scratch boss (id 2) is
-- active, and the Hunt view shows it once no newer boss is active.
-- Pressure test setup (scratch only; teardown removes all of it).
-- 100 players lt_open_0000..0099, 20 packs each, 8 random draw-pool attackers each.
insert into players (id, username, pack_balance)
  select 'lt_open_' || lpad(g::text, 4, '0'), 'zzz_loadtest_' || g, 20 from generate_series(0, 99) g
  on conflict (id) do update set pack_balance = 20;
insert into player_cards (player_id, card_id, quantity)
  select p.id, c.card_id, 1
  from (select 'lt_open_' || lpad(g::text, 4, '0') id from generate_series(0, 99) g) p
  cross join lateral (
    select c.id card_id from cards c join subjects s on s.id = c.subject_id
    where c.in_draw_pool and s.type in ('Character', 'Creature') and s.tags->>'class' = 'attacker' and p.id is not null
    order by random() limit 8) c
  on conflict do nothing;
-- The scratch boss: a Mythic at the real HP (80,000), id 2, so the live view keeps the newest boss.
insert into hunts (id, name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, hp_share, closes_at, stats)
  values (2, 'zzz Pressure Test Boss', 'Mythic', '[]', '[]',
          '{"kind":"armored","list":[{"kind":"armored","label":"Armored"},{"kind":"thorns","label":"Thorns"},{"kind":"frenzied","label":"Frenzied"}]}',
          80000, 80000, 8000, now() + interval '3 hours', '{"atk": 93}');
-- No Discord posts from the scratch boss: its events are marked posted on insert.
create or replace function zzz_pressure_mute() returns trigger language plpgsql as $$
begin if new.hunt_id = 2 then new.posted_at := now(); end if; return new; end $$;
drop trigger if exists zzz_pressure_mute on hunt_events;
create trigger zzz_pressure_mute before insert on hunt_events for each row execute function zzz_pressure_mute();
select (select count(*) from players where id like 'lt_open_%') players,
       (select count(*) from player_cards where player_id like 'lt_open_%') cards,
       (select hp_remaining from hunts where id = 2) boss_hp,
       (select count(*) from pg_trigger where tgname = 'zzz_pressure_mute') trigger_on;
