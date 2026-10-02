-- Wishlists, the Trading Hall and Auctions (Nathan, 2026-10-01; design 26, all frames approved).
-- Privacy rule: on the Hall and trade screens a member sees another member's WISHLIST and the
-- cards they LIST for trade, never their collection.
--
-- Wishlist: up to 5 slots, each one card (a card row is one rarity). Anyone can see it.
-- For trade: a member lists a card for anyone. An offer gives a card from the lister's wishlist
--   for the listed card (a normal trade: the same rarity, both tradeable); the lister accepts.
--   The first accepted offer closes the listing and declines the others.
-- Auctions: a seller puts up one card (Gold allowed; Event allowed) for 1..14 days, with a
--   minimum: a rarity + count ("2 Full Art", that rarity or rarer) and/or specific cards, AND/OR.
--   One live auction per member; a bid holds 1..5 cards; a Gold auction takes only Full Art,
--   Promo or Event bid cards; a non-Gold auction takes no Gold cards. Bid cards and the auctioned
--   card are held (free_copies). The seller accepts a bid at any time (or closes early); the
--   bidder then confirms (the swap) or declines (the auction goes on). At the end, every open
--   bid returns. expire_auctions() runs every 10 minutes (pg_cron).

create table if not exists public.wishlists (
  player_id text not null references public.players(id) on delete cascade,
  slot int not null check (slot between 1 and 5),
  card_id bigint not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_id, slot)
);
create table if not exists public.trade_listings (
  id bigserial primary key,
  player_id text not null references public.players(id) on delete cascade,
  card_id bigint not null references public.cards(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists trade_listings_open_once on public.trade_listings (player_id, card_id) where status = 'open';
alter table public.trade_offers add column if not exists listing_id bigint references public.trade_listings(id);

create table if not exists public.auctions (
  id bigserial primary key,
  seller_id text not null references public.players(id) on delete cascade,
  card_id bigint not null references public.cards(id),
  min_rarity text,
  min_count int not null default 0 check (min_count between 0 and 5),
  min_cards bigint[] not null default '{}',
  min_mode text not null default 'and' check (min_mode in ('and', 'or')),
  status text not null default 'live' check (status in ('live', 'accepted', 'sold', 'closed', 'expired')),
  accepted_bid_id bigint,
  created_at timestamptz not null default now(),
  ends_at timestamptz not null,
  settled_at timestamptz,
  notice_message_id text,
  notice_dirty boolean not null default true,
  notice_at timestamptz
);
create unique index if not exists auctions_one_live on public.auctions (seller_id) where status in ('live', 'accepted');
create index if not exists auctions_status on public.auctions (status, ends_at);
create table if not exists public.auction_bids (
  id bigserial primary key,
  auction_id bigint not null references public.auctions(id) on delete cascade,
  bidder_id text not null references public.players(id) on delete cascade,
  cards bigint[] not null check (cardinality(cards) between 1 and 5),
  status text not null default 'open' check (status in ('open', 'accepted', 'won', 'declined', 'returned', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists auction_bids_one_open on public.auction_bids (auction_id, bidder_id) where status in ('open', 'accepted');
create index if not exists auction_bids_bidder on public.auction_bids (bidder_id, status);

alter table public.wishlists enable row level security;
alter table public.trade_listings enable row level security;
alter table public.auctions enable row level security;
alter table public.auction_bids enable row level security;

-- Held copies: a trade offer, the auctioned card, and the cards in an open or accepted bid.
create or replace function public.free_copies(p_player text, p_card bigint)
returns integer language sql set search_path to 'public' as $$
  select coalesce((select quantity from player_cards where player_id = p_player and card_id = p_card), 0)
       - (select count(*)::int from trade_offers
            where from_id = p_player and offer_card_id = p_card and status in ('pending', 'countered'))
       - (select count(*)::int from trade_offers
            where to_id = p_player and request_card_id = p_card and status = 'countered')
       - (select count(*)::int from auctions where seller_id = p_player and card_id = p_card and status in ('live', 'accepted'))
       - (select coalesce(sum((select count(*) from unnest(b.cards) x where x = p_card)), 0)::int
            from auction_bids b where b.bidder_id = p_player and b.status in ('open', 'accepted'));
$$;

create or replace function public.rarity_rank(p text)
returns int language sql immutable as $$
  select case p when 'normal' then 0 when 'illustrated_rare' then 1 when 'secret_rare' then 2 when 'promo' then 2
                when 'full_art' then 3 when 'event' then 3 when 'gold' then 4 else 0 end;
$$;

-- Does a bid meet the seller's minimum? The count rule counts cards of that rarity or rarer.
create or replace function public.auction_meets(p_auction bigint, p_cards bigint[])
returns boolean language plpgsql stable set search_path = public as $$
declare a auctions; n int; count_ok boolean; cards_ok boolean;
begin
  select * into a from auctions where id = p_auction;
  if not found then return false; end if;
  select count(*) into n from unnest(p_cards) x join cards c on c.id = x
   where a.min_rarity is not null and rarity_rank(c.rarity::text) >= rarity_rank(a.min_rarity);
  count_ok := a.min_count = 0 or a.min_rarity is null or n >= a.min_count;
  cards_ok := cardinality(a.min_cards) = 0 or a.min_cards <@ p_cards;
  if a.min_mode = 'or' and (a.min_count > 0 and a.min_rarity is not null) and cardinality(a.min_cards) > 0 then
    return count_ok or cards_ok;
  end if;
  return count_ok and cards_ok;
end $$;

create or replace function public.set_wishlist(p_player text, p_slot int, p_card bigint)
returns jsonb language plpgsql set search_path = public as $$
begin
  if p_slot not between 1 and 5 then return jsonb_build_object('ok', false, 'error', 'bad_slot'); end if;
  if p_card is null then
    delete from wishlists where player_id = p_player and slot = p_slot;
    return jsonb_build_object('ok', true);
  end if;
  if not exists (select 1 from cards where id = p_card) then return jsonb_build_object('ok', false, 'error', 'no_card'); end if;
  if exists (select 1 from wishlists where player_id = p_player and card_id = p_card and slot <> p_slot) then
    return jsonb_build_object('ok', false, 'error', 'already_listed');
  end if;
  insert into wishlists (player_id, slot, card_id) values (p_player, p_slot, p_card)
    on conflict (player_id, slot) do update set card_id = excluded.card_id, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_for_trade(p_player text, p_card bigint)
returns jsonb language plpgsql set search_path = public as $$
declare c record; lid bigint;
begin
  select rarity::text as rarity, tradeable into c from cards where id = p_card;
  if not found or not c.tradeable then return jsonb_build_object('ok', false, 'error', 'not_tradeable'); end if;
  if free_copies(p_player, p_card) < 1 then return jsonb_build_object('ok', false, 'error', 'no_copy'); end if;
  if (select count(*) from trade_listings where player_id = p_player and status = 'open') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into trade_listings (player_id, card_id) values (p_player, p_card)
    on conflict (player_id, card_id) where status = 'open' do nothing returning id into lid;
  if lid is null then return jsonb_build_object('ok', false, 'error', 'already_listed'); end if;
  return jsonb_build_object('ok', true, 'id', lid);
end $$;

create or replace function public.unlist_for_trade(p_player text, p_listing bigint)
returns jsonb language plpgsql set search_path = public as $$
begin
  update trade_listings set status = 'closed', closed_at = now() where id = p_listing and player_id = p_player and status = 'open';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update trade_offers set status = 'declined', resolved_at = now() where listing_id = p_listing and status = 'pending';
  return jsonb_build_object('ok', true);
end $$;

-- An offer on a listed card: a card from the lister's wishlist for the listed card (a normal
-- trade: create_trade checks the same rarity and that both are tradeable). The lister accepts.
create or replace function public.offer_on_listing(p_from text, p_listing bigint, p_offer bigint)
returns jsonb language plpgsql set search_path = public as $$
declare l trade_listings; oid bigint;
begin
  select * into l from trade_listings where id = p_listing and status = 'open';
  if not found then return jsonb_build_object('ok', false, 'error', 'listing_closed'); end if;
  if l.player_id = p_from then return jsonb_build_object('ok', false, 'error', 'own_listing'); end if;
  if not exists (select 1 from wishlists where player_id = l.player_id and card_id = p_offer) then
    return jsonb_build_object('ok', false, 'error', 'not_on_wishlist');
  end if;
  if free_copies(l.player_id, l.card_id) < 1 then return jsonb_build_object('ok', false, 'error', 'listing_gone'); end if;
  if exists (select 1 from trade_offers where from_id = p_from and listing_id = p_listing and status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'already_offered');
  end if;
  oid := create_trade(p_from, l.player_id, p_offer, l.card_id);
  if oid is null then return jsonb_build_object('ok', false, 'error', 'cannot_trade'); end if;
  update trade_offers set listing_id = p_listing where id = oid;
  return jsonb_build_object('ok', true, 'id', oid, 'to', l.player_id);
end $$;

-- The first accepted offer on a listing closes it and declines the other offers on it.
create or replace function public.trade_listing_close()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.listing_id is not null then
    update trade_listings set status = 'closed', closed_at = now() where id = new.listing_id and status = 'open';
    update trade_offers set status = 'declined', resolved_at = now()
     where listing_id = new.listing_id and id <> new.id and status = 'pending';
  end if;
  return new;
end $$;
drop trigger if exists trade_listing_close on public.trade_offers;
create trigger trade_listing_close after update of status on public.trade_offers
  for each row execute function public.trade_listing_close();

-- Auctions --------------------------------------------------------------------------------
create or replace function public.start_auction(p_seller text, p_card bigint, p_min_rarity text, p_min_count int,
  p_min_cards bigint[], p_mode text, p_days int)
returns jsonb language plpgsql set search_path = public as $$
declare c record; gold boolean; aid bigint; bad int;
begin
  if p_days is null or p_days not between 1 and 14 then return jsonb_build_object('ok', false, 'error', 'bad_length'); end if;
  if coalesce(p_min_count, 0) not between 0 and 5 then return jsonb_build_object('ok', false, 'error', 'bad_min'); end if;
  if cardinality(coalesce(p_min_cards, '{}')) > 3 then return jsonb_build_object('ok', false, 'error', 'too_many_cards'); end if;
  if coalesce(p_mode, 'and') not in ('and', 'or') then return jsonb_build_object('ok', false, 'error', 'bad_mode'); end if;
  select rarity::text as rarity into c from cards where id = p_card;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_card'); end if;
  if free_copies(p_seller, p_card) < 1 then return jsonb_build_object('ok', false, 'error', 'no_copy'); end if;
  if exists (select 1 from auctions where seller_id = p_seller and status in ('live', 'accepted')) then
    return jsonb_build_object('ok', false, 'error', 'one_live');
  end if;
  gold := c.rarity = 'gold';
  if p_min_rarity is not null and p_min_rarity not in ('normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'promo', 'event') then
    return jsonb_build_object('ok', false, 'error', 'bad_rarity');
  end if;
  -- The minimum may only ask for what a bid can hold.
  if gold and coalesce(p_min_count, 0) > 0 and p_min_rarity not in ('full_art', 'promo', 'event') then
    return jsonb_build_object('ok', false, 'error', 'gold_min');
  end if;
  if not gold and p_min_rarity = 'gold' then return jsonb_build_object('ok', false, 'error', 'no_gold_bids'); end if;
  select count(*) into bad from unnest(coalesce(p_min_cards, '{}')) x join cards cc on cc.id = x
   where (gold and cc.rarity::text not in ('full_art', 'promo', 'event')) or (not gold and cc.rarity::text = 'gold');
  if bad > 0 then return jsonb_build_object('ok', false, 'error', 'bad_min_card'); end if;
  insert into auctions (seller_id, card_id, min_rarity, min_count, min_cards, min_mode, ends_at)
  values (p_seller, p_card, case when coalesce(p_min_count, 0) > 0 then p_min_rarity end, coalesce(p_min_count, 0),
          coalesce(p_min_cards, '{}'), coalesce(p_mode, 'and'), now() + make_interval(days => p_days))
  returning id into aid;
  return jsonb_build_object('ok', true, 'id', aid);
end $$;

-- A bid (it replaces my open bid on this auction).
create or replace function public.place_bid(p_bidder text, p_auction bigint, p_cards bigint[])
returns jsonb language plpgsql set search_path = public as $$
declare a auctions; gold boolean; bad int; r record; bid bigint;
begin
  select * into a from auctions where id = p_auction for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_auction'); end if;
  if a.status <> 'live' or a.ends_at <= now() then return jsonb_build_object('ok', false, 'error', 'not_live'); end if;
  if a.seller_id = p_bidder then return jsonb_build_object('ok', false, 'error', 'own_auction'); end if;
  if p_cards is null or cardinality(p_cards) not between 1 and 5 then return jsonb_build_object('ok', false, 'error', 'bad_count'); end if;
  gold := (select rarity::text from cards where id = a.card_id) = 'gold';
  select count(*) into bad from unnest(p_cards) x left join cards cc on cc.id = x
   where cc.id is null or (gold and cc.rarity::text not in ('full_art', 'promo', 'event')) or (not gold and cc.rarity::text = 'gold');
  if bad > 0 then return jsonb_build_object('ok', false, 'error', case when gold then 'gold_bid_rarity' else 'no_gold_bids' end); end if;
  -- My old bid on this auction is replaced: its cards count as free for the new one.
  update auction_bids set status = 'withdrawn', updated_at = now() where auction_id = p_auction and bidder_id = p_bidder and status = 'open';
  for r in select x as card, count(*) as n from unnest(p_cards) x group by x loop
    if free_copies(p_bidder, r.card) < r.n then
      raise exception 'no_copy:%', r.card using errcode = 'P0001';
    end if;
  end loop;
  insert into auction_bids (auction_id, bidder_id, cards) values (p_auction, p_bidder, p_cards) returning id into bid;
  update auctions set notice_dirty = true where id = p_auction;
  return jsonb_build_object('ok', true, 'id', bid, 'meets', auction_meets(p_auction, p_cards));
exception when sqlstate 'P0001' then
  if sqlerrm like 'no_copy:%' then return jsonb_build_object('ok', false, 'error', 'no_copy'); end if;
  raise;
end $$;

create or replace function public.withdraw_bid(p_bidder text, p_auction bigint)
returns jsonb language plpgsql set search_path = public as $$
begin
  update auction_bids set status = 'withdrawn', updated_at = now() where auction_id = p_auction and bidder_id = p_bidder and status = 'open';
  if not found then return jsonb_build_object('ok', false, 'error', 'no_bid'); end if;
  update auctions set notice_dirty = true where id = p_auction;
  return jsonb_build_object('ok', true);
end $$;

-- The seller accepts a bid (any time while live); the bidder confirms next.
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
  update auctions set status = 'accepted', accepted_bid_id = p_bid, notice_dirty = true where id = a.id;
  return jsonb_build_object('ok', true, 'bidder', b.bidder_id, 'auction', a.id);
end $$;

-- Every open bid (and an accepted one) returns: the cards were only held.
create or replace function public.return_bids(p_auction bigint, p_keep bigint default null)
returns void language sql set search_path = public as $$
  update auction_bids set status = 'returned', updated_at = now()
   where auction_id = p_auction and status in ('open', 'accepted') and id is distinct from p_keep;
$$;

-- The bidder confirms: the swap. The seller's card to the bidder, the bid cards to the seller.
create or replace function public.confirm_bid(p_bidder text, p_auction bigint)
returns jsonb language plpgsql set search_path = public as $$
declare a auctions; b auction_bids; x bigint;
begin
  select * into a from auctions where id = p_auction for update;
  if not found or a.status <> 'accepted' then return jsonb_build_object('ok', false, 'error', 'not_accepted'); end if;
  select * into b from auction_bids where id = a.accepted_bid_id for update;
  if b.bidder_id <> p_bidder or b.status <> 'accepted' then return jsonb_build_object('ok', false, 'error', 'not_your_bid'); end if;
  begin
    if not remove_card_from_player(a.seller_id, a.card_id) then raise exception 'gone'; end if;
    foreach x in array b.cards loop
      if not remove_card_from_player(p_bidder, x) then raise exception 'gone'; end if;
      perform add_card_to_player(a.seller_id, x, 'auction');
    end loop;
    perform add_card_to_player(p_bidder, a.card_id, 'auction');
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'cards_gone');
  end;
  update auction_bids set status = 'won', updated_at = now() where id = b.id;
  perform return_bids(a.id, b.id);
  update auctions set status = 'sold', settled_at = now(), notice_dirty = true where id = a.id;
  return jsonb_build_object('ok', true, 'seller', a.seller_id, 'card_id', a.card_id, 'cards', b.cards);
end $$;

-- The bidder declines: the auction goes on (or ends if its time is up).
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
    update auctions set status = 'live', accepted_bid_id = null, notice_dirty = true where id = a.id;
  else
    perform return_bids(a.id);
    update auctions set status = 'expired', accepted_bid_id = null, settled_at = now(), notice_dirty = true where id = a.id;
  end if;
  return jsonb_build_object('ok', true, 'seller', a.seller_id);
end $$;

-- The seller closes early (no sale): every bid returns.
create or replace function public.close_auction(p_seller text, p_auction bigint)
returns jsonb language plpgsql set search_path = public as $$
declare a auctions;
begin
  select * into a from auctions where id = p_auction for update;
  if not found or a.seller_id <> p_seller then return jsonb_build_object('ok', false, 'error', 'not_seller'); end if;
  if a.status not in ('live', 'accepted') then return jsonb_build_object('ok', false, 'error', 'not_live'); end if;
  perform return_bids(a.id);
  update auctions set status = 'closed', settled_at = now(), notice_dirty = true where id = a.id;
  return jsonb_build_object('ok', true);
end $$;

-- Time is up: a live auction ends and its bids return (an accepted one waits for the bidder).
create or replace function public.expire_auctions()
returns int language plpgsql set search_path = public as $$
declare a record; n int := 0;
begin
  for a in select id from auctions where status = 'live' and ends_at <= now() for update skip locked loop
    perform return_bids(a.id);
    update auctions set status = 'expired', settled_at = now(), notice_dirty = true where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

do $c$ begin
  perform cron.unschedule('expire-auctions') where exists (select 1 from cron.job where jobname = 'expire-auctions');
  perform cron.schedule('expire-auctions', '*/10 * * * *', 'select expire_auctions();');
end $c$;


-- A trade accept takes a card by count only: it must not take a card held by an auction or a bid.
create or replace function public.accept_trade(p_offer_id bigint, p_accepter text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status in ('pending', 'countered') for update;
  if not found or t.request_card_id is null then return false; end if;
  if t.status = 'countered' and t.from_id <> p_accepter then return false; end if;
  if t.status = 'pending' and t.to_id <> p_accepter then return false; end if;
  -- A card held by an auction or a bid (hall_auctions.sql) is not free to trade away.
  if t.status = 'pending' and free_copies(t.to_id, t.request_card_id) < 1 then return false; end if;
  if not remove_card_from_player(t.from_id, t.offer_card_id) then return false; end if;
  if not remove_card_from_player(t.to_id, t.request_card_id) then
    perform add_card_to_player(t.from_id, t.offer_card_id, 'trade'); -- give it back
    return false;
  end if;
  perform add_card_to_player(t.to_id, t.offer_card_id, 'trade');
  perform add_card_to_player(t.from_id, t.request_card_id, 'trade');
  update trade_offers set status = 'accepted', resolved_at = now() where id = p_offer_id;
  return true;
end; $function$;

-- Ascension spends duplicate copies: it must leave the copies held by a trade offer, an auction or
-- a bid (before, a member could auction a card and then ascend the held copy away).
CREATE OR REPLACE FUNCTION public.ascend_card(p_player_id text, p_card_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  if v_asc >= 5 then return jsonb_build_object('ok', false, 'error', 'maxed'); end if;

  v_cost := ascend_cost(v_rarity, v_asc);
  if v_qty < 1 + v_cost then
    return jsonb_build_object('ok', false, 'error', 'need_more', 'have', v_qty, 'need', 1 + v_cost);
  end if;
  -- A copy held by a trade offer, an auction or a bid is not free to spend (hall_auctions.sql).
  if free_copies(p_player_id, p_card_id) < v_cost then
    return jsonb_build_object('ok', false, 'error', 'held', 'free', free_copies(p_player_id, p_card_id), 'need', v_cost);
  end if;

  update player_cards set quantity = quantity - v_cost, ascension = ascension + 1
   where player_id = p_player_id and card_id = p_card_id;

  return jsonb_build_object('ok', true, 'ascension', v_asc + 1,
    'quantity', v_qty - v_cost, 'power', card_power(v_rarity, v_asc + 1, v_mod),
    'next_cost', ascend_cost(v_rarity, v_asc + 1));
end;
$function$;
