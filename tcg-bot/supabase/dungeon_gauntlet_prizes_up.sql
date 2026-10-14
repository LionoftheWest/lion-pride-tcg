-- Nathan (2026-10-14): "daily dungeons top 3 should be 3 packs, 2 packs 1 packs for 1, 2, 3 respectively and the gauntlet should
-- double in prizes for the top 3". balance.dungeon_prizes: daily = the Dungeon day board, weekly = the Gauntlet week board
-- (dungeon_pay pays shards, packs and cards from it; gauntlet_view and the prize screens read it). Places 4 to 10 do not change.
--   Dungeon 1st/2nd/3rd: the Shards stay (300/200/150) + 3/2/1 packs.
--   Gauntlet 1st/2nd/3rd: packs, Shards and cards doubled (5->10, 3->6, 2->4 packs; 500->1000, 300->600, 200->400 Shards;
--   3->6, 2->4, 1->2 cards; the card odds stay).
-- Idempotent: it sets the values, it does not add to them. balance_log records the change with by = nathan.
select set_config('balance.by', 'nathan', true);
update public.balance b
   set value = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(b.value,
         '{daily,0,packs}', '3'), '{daily,1,packs}', '2'), '{daily,2,packs}', '1'),
         '{weekly,0}', (b.value #> '{weekly,0}') || '{"packs":10,"shards":1000,"cards":6}'),
         '{weekly,1}', (b.value #> '{weekly,1}') || '{"packs":6,"shards":600,"cards":4}'),
         '{weekly,2}', (b.value #> '{weekly,2}') || '{"packs":4,"shards":400,"cards":2}')
 where b.key = 'dungeon_prizes';

do $$
declare v jsonb;
begin
  select value into v from public.balance where key = 'dungeon_prizes';
  if (v #>> '{daily,0,packs}')::int <> 3 or (v #>> '{daily,1,packs}')::int <> 2 or (v #>> '{daily,2,packs}')::int <> 1
     or (v #>> '{daily,0,shards}')::int <> 300 or (v #>> '{daily,3,packs}') is not null
     or (v #>> '{weekly,0,packs}')::int <> 10 or (v #>> '{weekly,0,shards}')::int <> 1000 or (v #>> '{weekly,0,cards}')::int <> 6
     or (v #>> '{weekly,1,packs}')::int <> 6 or (v #>> '{weekly,1,shards}')::int <> 600 or (v #>> '{weekly,1,cards}')::int <> 4
     or (v #>> '{weekly,2,packs}')::int <> 4 or (v #>> '{weekly,2,shards}')::int <> 400 or (v #>> '{weekly,2,cards}')::int <> 2
     or (v #>> '{weekly,3,packs}')::int <> 1 or (v #> '{weekly,0,odds}') is null then
    raise exception 'dungeon_gauntlet_prizes_up: dungeon_prizes is not the new values: %', v;
  end if;
end $$;
