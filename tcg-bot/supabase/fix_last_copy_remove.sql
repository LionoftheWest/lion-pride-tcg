-- Fix (2026-10-01): a trade or a card gift of a member's LAST copy always failed.
-- remove_card_from_player set quantity to 0 before it deleted the row, and
-- player_cards_quantity_check (quantity > 0) refused that update. accept_trade then
-- raised an error, so Accept did nothing. Now the last copy deletes the row and a
-- duplicate takes one off the count. Test: card-studio/scripts/test-trade-accept.mjs.
create or replace function public.remove_card_from_player(p_player_id text, p_card_id bigint)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare q int;
begin
  select quantity into q from player_cards
    where player_id = p_player_id and card_id = p_card_id for update;
  if q is null or q < 1 then return false; end if;
  if q = 1 then
    delete from player_cards where player_id = p_player_id and card_id = p_card_id;
  else
    update player_cards set quantity = quantity - 1 where player_id = p_player_id and card_id = p_card_id;
  end if;
  return true;
end; $$;

notify pgrst, 'reload schema';
