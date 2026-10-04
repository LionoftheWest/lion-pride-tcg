-- The daily Dungeon prizes are Shards only (Nathan, 2026-10-03): the packs are for the weekly Gauntlet only.
-- Rank 1..10: 300, 200, 150, then 50 Shards. The weekly Gauntlet prizes do not change. Idempotent.
-- Test: card-studio/scripts/test-dungeon.mjs (16g, mutation dailypacks).
update public.settings set value = jsonb_set(value, '{daily}',
  '[{"shards":300},{"shards":200},{"shards":150},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50}]'::jsonb)
where key = 'dungeon_prizes';
