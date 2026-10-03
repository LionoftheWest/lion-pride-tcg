-- ascend_card: two rule gaps (Nathan, 2026-10-03: "lets fix the bugs you found"). Built from the LIVE
-- definition (hall_auctions.sql), only these two checks change:
-- 1. The copy that stays must be FREE. Before: free_copies >= cost. With 5 copies and 1 in an auction,
--    a 4-copy ascend was allowed; the copy left was the auctioned one, and when the auction ended the
--    row was deleted with its star. Now: free_copies >= cost + 1 (error 'held').
-- 2. Event and Promo cards do not ascend (event_cards.sql says so; ascend_cost gave them the Normal
--    costs and nothing blocked it). Error 'no_ascend'.
create or replace function public.ascend_card(p_player_id text, p_card_id bigint)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_qty int; v_asc int; v_rarity text; v_cost int; v_mod numeric;
begin
  select pc.quantity, pc.ascension, c.rarity, s.cp_mod
    into v_qty, v_asc, v_rarity, v_mod
  from player_cards pc
  join cards c    on c.id = pc.card_id
  join subjects s on s.id = c.subject_id
  where pc.player_id = p_player_id and pc.card_id = p_card_id
  for update of pc;

  if not found then return jsonb_build_object('ok', false, 'error', 'not owned'); end if;
  if v_rarity in ('event', 'promo') then return jsonb_build_object('ok', false, 'error', 'no_ascend'); end if;
  if v_asc >= 5 then return jsonb_build_object('ok', false, 'error', 'maxed'); end if;

  v_cost := ascend_cost(v_rarity, v_asc);
  if v_qty < 1 + v_cost then
    return jsonb_build_object('ok', false, 'error', 'need_more', 'have', v_qty, 'need', 1 + v_cost);
  end if;
  -- A copy held by a trade offer, an auction or a bid is not free to spend, and the copy that
  -- stays must be free too (else it leaves with the trade, the auction or the bid).
  if free_copies(p_player_id, p_card_id) < v_cost + 1 then
    return jsonb_build_object('ok', false, 'error', 'held', 'free', free_copies(p_player_id, p_card_id), 'need', v_cost + 1);
  end if;

  update player_cards set quantity = quantity - v_cost, ascension = ascension + 1
   where player_id = p_player_id and card_id = p_card_id;

  return jsonb_build_object('ok', true, 'ascension', v_asc + 1,
    'quantity', v_qty - v_cost, 'power', card_power(v_rarity, v_asc + 1, v_mod),
    'next_cost', ascend_cost(v_rarity, v_asc + 1));
end;
$function$;
