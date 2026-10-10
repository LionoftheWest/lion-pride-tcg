-- Trade REQUESTS and FULL PROPOSALS (Nathan, decision D-168: "fix this right so that requests are possible").
-- The mirror of the two-step offer (trade_two_step.sql):
--   OFFER    the sender gives a card; the receiver picks one of THEIR cards back; the sender accepts.
--   REQUEST  the sender asks for one of THEIR cards and gives nothing yet (offer_card_id NULL, status
--            'pending'); the card owner (to_id) picks one of the REQUESTER's cards (counter_trade_request,
--            status 'countered'); the requester (from_id) accepts: the swap (accept_trade, unchanged rule:
--            a countered offer is accepted by from_id).
--   FULL PROPOSAL  create_trade (both cards named, the receiver accepts) already exists; the Activity
--            server allowed it only with two-step trades off. No change in SQL.
-- Reserves: free_copies is NOT changed. A countered request reserves the requester's picked copy
-- (from_id, offer_card_id) and the owner's requested copy (to_id, request_card_id), like an offer.
-- A pending request holds no copy: the owner's card is checked when the request is made, when the
-- owner picks, and by card_move in the swap. Decline and cancel release by status (set_trade_status).
-- Test: card-studio/scripts/test-trade-request.mjs.

alter table public.trade_offers alter column offer_card_id drop not null;
-- A row always names at least one card: a request names the requested card, an offer the offered card.
alter table public.trade_offers drop constraint if exists trade_offers_has_card_check;
alter table public.trade_offers add constraint trade_offers_has_card_check
  check (offer_card_id is not null or request_card_id is not null);

-- Step 1 of a request: ask for one card of another member. Gives nothing yet.
create or replace function public.create_trade_request(p_from text, p_to text, p_request bigint)
returns bigint
language plpgsql
set search_path to 'public'
as $$
declare oid bigint; rr record;
begin
  if p_from = p_to then return null; end if;
  perform 1 from players where id = p_to;
  if not found then return null; end if;
  select tradeable into rr from cards where id = p_request;
  if not found or not rr.tradeable then return null; end if;
  if free_copies(p_to, p_request) < 1 then return null; end if; -- the owner has no free copy to give
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id)
    values (p_from, p_to, null, p_request) returning id into oid;
  return oid;
end; $$;

-- Step 2 of a request: the card owner picks one of the requester's cards (the same rarity as the
-- requested card, a free copy of the requester, not the same card).
create or replace function public.counter_trade_request(p_offer_id bigint, p_actor text, p_card bigint)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare t record; rq record; rr record;
begin
  select * into t from trade_offers
    where id = p_offer_id and status = 'pending' and offer_card_id is null and request_card_id is not null for update;
  if not found or t.to_id <> p_actor then return false; end if;
  if p_card = t.request_card_id then return false; end if;
  select rarity::text as rarity into rq from cards where id = t.request_card_id;
  select rarity::text as rarity, tradeable into rr from cards where id = p_card;
  if not found or not rr.tradeable or rr.rarity <> rq.rarity then return false; end if;
  if free_copies(t.from_id, p_card) < 1 then return false; end if;      -- the requester must have the picked card free
  if free_copies(t.to_id, t.request_card_id) < 1 then return false; end if; -- the owner still has the requested card free
  update trade_offers set offer_card_id = p_card, status = 'countered', countered_at = now() where id = p_offer_id;
  return true;
end; $$;

-- The swap. Same as before, plus one guard: a request that nobody has picked for yet (offer_card_id
-- NULL) cannot be accepted.
create or replace function public.accept_trade(p_offer_id bigint, p_accepter text)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status in ('pending', 'countered') for update;
  if not found or t.request_card_id is null or t.offer_card_id is null then return false; end if;
  if t.status = 'countered' and t.from_id <> p_accepter then return false; end if;
  if t.status = 'pending' and t.to_id <> p_accepter then return false; end if;
  -- A card held by an auction or a bid (hall_auctions.sql) is not free to trade away.
  if t.status = 'pending' and free_copies(t.to_id, t.request_card_id) < 1 then return false; end if;
  -- The four moves are one unit: when a copy is gone, the block rolls back the moves already made.
  begin
    if card_move(t.from_id, t.offer_card_id, -1, 'trade', 'trade_offer', p_offer_id::text) is null then raise exception 'trade_gone'; end if;
    if card_move(t.to_id, t.request_card_id, -1, 'trade', 'trade_offer', p_offer_id::text) is null then raise exception 'trade_gone'; end if;
    perform card_move(t.to_id, t.offer_card_id, 1, 'trade', 'trade_offer', p_offer_id::text, 'trade');
    perform card_move(t.from_id, t.request_card_id, 1, 'trade', 'trade_offer', p_offer_id::text, 'trade');
  exception when raise_exception then
    if sqlerrm = 'trade_gone' then return false; end if;
    raise;
  end;
  update trade_offers set status = 'accepted', resolved_at = now() where id = p_offer_id;
  return true;
end; $$;

comment on function public.create_trade_request(text, text, bigint) is $c$Trade request, step 1 (D-168). p_from asks p_to for one card (p_request) and gives nothing yet: a pending trade_offers row with offer_card_id null. Returns the offer id, or null when the members are the same, p_to is unknown, the card is not tradeable or p_to has no free copy (free_copies). The owner then picks a card with counter_trade_request.$c$;
comment on function public.counter_trade_request(bigint, text, bigint) is $c$Trade request, step 2 (D-168). The card owner (to_id) picks one of the requester's cards: the same rarity as the requested card, tradeable, a free copy of the requester, not the same card. Sets offer_card_id and status countered (both cards are then held by free_copies). The requester then accepts with accept_trade. Returns false when any check fails.$c$;
comment on function public.accept_trade(bigint, text) is $c$The swap of a trade offer. A countered offer (the receiver picked a card, also a request the owner picked for) is accepted by from_id. An old pending offer that names both cards (create_trade, the full proposal) is accepted by to_id. A request with no picked card (offer_card_id null) is refused. The four card_move rows are one unit; the trigger card_trades_offer logs the swap.$c$;
comment on column public.trade_offers.offer_card_id is $c$The card that from_id gives (cards.id). One copy is held (free_copies) while the offer is pending or countered. Null for a request (create_trade_request) until the owner picks a card with counter_trade_request.$c$;
comment on table public.trade_offers is $c$[trading] One row per one-for-one trade offer between two members. create_trade (full proposal), create_trade_open (offer), create_trade_request (request) and offer_on_listing write it. counter_trade and counter_trade_request pick the second card. accept_trade and set_trade_status change it. The Activity /api/trades reads it.$c$;

notify pgrst, 'reload schema';
