-- Nathan's pick (2026-10-14: "Yeah do medium medium") from the measured options of PR #406 (scripts/dungeon-balance.mjs --big):
--   F1-medium: floor 1 foes at 50% HP and ATK, a horde has 3 to 4 foes (was 4 to 5);
--   F2-medium: all foes together heal at most 50% of the squad damage of the same round.
-- Measured together on the local copy: a 0-star squad gets past floor 1 in 78% of runs (was 2%), no Guardian heal LOCK in
-- 900 fights (was 8), 3-star Shards per run 118 (was 98.5). Needs dungeon_new_player_balance.sql first (the keys).
-- balance_log records the change with "by" = nathan.
select set_config('balance.by', 'nathan', true);
update public.balance
   set value = value || '{"early_hp": 0.5, "early_atk": 0.5, "horde_min": 3, "foe_heal_cap": 0.5}'::jsonb
 where key = 'dungeon';

do $$
declare v jsonb;
begin
  select value into v from public.balance where key = 'dungeon';
  if (v->>'early_hp')::numeric <> 0.5 or (v->>'early_atk')::numeric <> 0.5 or (v->>'horde_min')::int <> 3
     or (v->>'foe_heal_cap')::numeric <> 0.5 or (v->>'early_floors')::int <> 1 then
    raise exception 'dungeon_balance_medium: balance.dungeon is not the Medium + Medium pick: %', v;
  end if;
end $$;
