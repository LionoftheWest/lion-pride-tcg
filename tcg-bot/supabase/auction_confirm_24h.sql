-- The bidder has 24 hours to confirm an accepted bid (Nathan, 2026-10-02). Before, an accepted auction
-- waited forever: expire_auctions() only ended live auctions, so an unanswered accept held the seller's
-- card and the bid cards for good. Now, 24 hours after the accept, the bid is declined for the bidder:
-- the auction reopens if its time is not up, else it ends and every bid returns. Both are told.
alter table public.auctions add column if not exists accepted_at timestamptz;
update public.auctions set accepted_at = now() where status = 'accepted' and accepted_at is null;

create or replace function public.accept_bid(p_seller text, p_bid bigint)
returns jsonb language plpgsql set search_path = public as $$
declare b auction_bids; a auctions;
begin
  select * into b from auction_bids where id = p_bid for update;
  if not found or b.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'no_bid'); end if;
  select * into a from auctions where id = b.auction_id for update;
  if a.seller_id <> p_seller then return jsonb_build_object('ok', false, 'error', 'not_seller'); end if;
  if a.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'not_live'); end if;
  update auction_bids set status = 'accepted', updated_at = now() where id = p_bid;
  update auctions set status = 'accepted', accepted_bid_id = p_bid, accepted_at = now(), notice_dirty = true where id = a.id;
  return jsonb_build_object('ok', true, 'bidder', b.bidder_id, 'auction', a.id, 'confirm_by', now() + interval '24 hours');
end $$;

create or replace function public.expire_auctions()
returns int language plpgsql set search_path = public as $$
declare a record; b record; n int := 0; cname text;
begin
  -- 1. An accepted bid not confirmed in 24 hours: declined for the bidder.
  for a in select id, seller_id, card_id, accepted_bid_id, ends_at from auctions
            where status = 'accepted' and accepted_at <= now() - interval '24 hours' for update skip locked loop
    select name into cname from cards where id = a.card_id;
    select * into b from auction_bids where id = a.accepted_bid_id;
    update auction_bids set status = 'declined', updated_at = now() where id = a.accepted_bid_id;
    if b.bidder_id is not null then
      perform notify_player(b.bidder_id, 'auction_ended', '🔨 You did not confirm the accepted bid for ' || coalesce(cname, 'a card') || ' within 24 hours. Your bid cards are free again.');
    end if;
    if a.ends_at > now() then
      update auctions set status = 'live', accepted_bid_id = null, accepted_at = null, notice_dirty = true where id = a.id;
      perform notify_player(a.seller_id, 'auction_declined', '🔨 The bidder did not confirm within 24 hours. Your auction for ' || coalesce(cname, 'your card') || ' is open again.');
    else
      for b in select distinct bidder_id from auction_bids where auction_id = a.id and status = 'open' loop
        perform notify_player(b.bidder_id, 'auction_ended', '🔨 The auction for ' || coalesce(cname, 'a card') || ' ended with no sale. Your bid cards are free again.');
      end loop;
      perform return_bids(a.id);
      update auctions set status = 'expired', accepted_bid_id = null, settled_at = now(), notice_dirty = true where id = a.id;
      perform notify_player(a.seller_id, 'auction_ended', '🔨 The bidder did not confirm within 24 hours. Your auction for ' || coalesce(cname, 'your card') || ' ended with no sale. The card is free again.');
    end if;
    n := n + 1;
  end loop;
  -- 2. A live auction whose time is up (hall_auction_notes.sql).
  for a in select id, seller_id, card_id from auctions where status = 'live' and ends_at <= now() for update skip locked loop
    select name into cname from cards where id = a.card_id;
    for b in select distinct bidder_id from auction_bids where auction_id = a.id and status in ('open', 'accepted') loop
      perform notify_player(b.bidder_id, 'auction_ended', '🔨 The auction for ' || coalesce(cname, 'a card') || ' ended with no sale. Your bid cards are free again.');
    end loop;
    perform return_bids(a.id);
    update auctions set status = 'expired', settled_at = now(), notice_dirty = true where id = a.id;
    perform notify_player(a.seller_id, 'auction_ended', '🔨 Your auction for ' || coalesce(cname, 'your card') || ' ended with no sale. The card is free again.');
    n := n + 1;
  end loop;
  return n;
end $$;

-- The decline path reopens an auction: clear the accept time too.
create or replace function public.decline_accepted_bid(p_bidder text, p_auction bigint)
returns jsonb language plpgsql set search_path = public as $$
declare a auctions; b auction_bids;
begin
  select * into a from auctions where id = p_auction for update;
  if not found or a.status <> 'accepted' then return jsonb_build_object('ok', false, 'error', 'not_accepted'); end if;
  select * into b from auction_bids where id = a.accepted_bid_id for update;
  if b.bidder_id <> p_bidder then return jsonb_build_object('ok', false, 'error', 'not_your_bid'); end if;
  update auction_bids set status = 'declined', updated_at = now() where id = b.id;
  if a.ends_at > now() then
    update auctions set status = 'live', accepted_bid_id = null, accepted_at = null, notice_dirty = true where id = a.id;
  else
    perform return_bids(a.id);
    update auctions set status = 'expired', accepted_bid_id = null, settled_at = now(), notice_dirty = true where id = a.id;
  end if;
  return jsonb_build_object('ok', true, 'seller', a.seller_id);
end $$;
