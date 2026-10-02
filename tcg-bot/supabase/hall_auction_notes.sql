-- Auction expiry notes (2026-10-02): expire_auctions() (pg_cron, every 10 minutes) ended an auction and
-- returned the bids, but told no one. Now the seller and every bidder with a returned bid get a bell
-- note. Same function otherwise (hall_auctions.sql).
create or replace function public.expire_auctions()
returns int language plpgsql set search_path = public as $$
declare a record; b record; n int := 0; cname text;
begin
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
