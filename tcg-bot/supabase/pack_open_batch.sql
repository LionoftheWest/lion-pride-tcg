-- Batch card grant: add every card in a pack in ONE statement instead of one
-- RPC per card. Opening a pack drew 5 cards and made 5 separate
-- add_card_to_player round-trips — the dominant open latency under load. This
-- collapses them to a single insert. Duplicates within a pack aggregate via
-- count(*); first_obtained_at keeps its insert default (untouched on conflict),
-- so the community-pulls feed is unchanged. Equivalent to N add_card_to_player.
create or replace function add_cards_to_player(p_player_id text, p_card_ids bigint[])
returns void
language sql
security invoker
set search_path = public
as $$
  insert into player_cards (player_id, card_id, quantity)
  select p_player_id, cid, count(*)
  from unnest(p_card_ids) as cid
  group by cid
  on conflict (player_id, card_id)
  do update set quantity = player_cards.quantity + excluded.quantity;
$$;

-- PostgREST must see the new function before the bot can call it via RPC.
notify pgrst, 'reload schema';
