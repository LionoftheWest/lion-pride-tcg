-- Reserve a card while it is committed in a pending trade offer. No per-copy IDs:
-- available copies = owned quantity minus copies locked in your pending offers.
-- Idempotent.

create or replace function free_copies(p_player text, p_card bigint)
returns int language sql security invoker set search_path = public as $$
  select coalesce((select quantity from player_cards where player_id = p_player and card_id = p_card), 0)
       - (select count(*)::int from trade_offers
            where from_id = p_player and offer_card_id = p_card and status = 'pending');
$$;

-- Gifting now requires an UNRESERVED copy (not promised in a pending trade).
create or replace function gift_card(p_from text, p_to text, p_card_id bigint)
returns boolean language plpgsql security invoker set search_path = public as $$
declare c record;
begin
  if p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  select rarity::text as rarity, tradeable into c from cards where id = p_card_id;
  if not found or not c.tradeable or c.rarity = 'gold' then return false; end if;
  if free_copies(p_from, p_card_id) < 1 then return false; end if; -- reserved or not owned
  if not remove_card_from_player(p_from, p_card_id) then return false; end if;
  perform add_card_to_player(p_to, p_card_id);
  return true;
end; $$;

-- Creating an offer requires a FREE copy of the offered card, and it reserves it
-- (this new pending row is counted by free_copies from now on).
create or replace function create_trade(p_from text, p_to text, p_offer bigint, p_request bigint)
returns bigint language plpgsql security invoker set search_path = public as $$
declare oid bigint; ro record; rr record;
begin
  if p_from = p_to or p_offer = p_request then return null; end if;
  perform 1 from players where id = p_to;
  if not found then return null; end if;
  select rarity::text as rarity, tradeable into ro from cards where id = p_offer;
  if not found then return null; end if;
  select rarity::text as rarity, tradeable into rr from cards where id = p_request;
  if not found then return null; end if;
  if not ro.tradeable or not rr.tradeable then return null; end if;
  if ro.rarity <> rr.rarity then return null; end if;
  if free_copies(p_from, p_offer) < 1 then return null; end if; -- no unreserved copy to commit
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id)
    values (p_from, p_to, p_offer, p_request) returning id into oid;
  return oid;
end; $$;

notify pgrst, 'reload schema';
