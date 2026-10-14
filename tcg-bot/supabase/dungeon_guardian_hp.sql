-- Nathan's pick (2026-10-14: "Agreed on 2.5x"): the Dungeon Guardian HP multiplier 4 -> 2.5 (balance.dungeon.foe_mult.guardian.hp).
-- Measured on the local copy with Medium + Medium applied (dungeon-balance.mjs --big): a 1-star squad wins the floor 2 Guardian
-- 88% of the time (was 50%), 1-star runs past floor 2 18% (was 7%), 3-star Shards per run 140 (was 118, +19%); LOCK 0, LOOP 0,
-- the longest Guardian stress fight 29 rounds (was 36). No code change: dungeon_make_foe reads the key. balance_log records it.
select set_config('balance.by', 'nathan', true);
update public.balance
   set value = jsonb_set(value, '{foe_mult,guardian,hp}', '2.5'::jsonb)
 where key = 'dungeon';

do $$ begin
  if (select (value #>> '{foe_mult,guardian,hp}')::numeric from public.balance where key = 'dungeon') <> 2.5 then
    raise exception 'dungeon_guardian_hp: balance.dungeon.foe_mult.guardian.hp is not 2.5';
  end if;
end $$;
