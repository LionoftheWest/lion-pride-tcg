-- Card trading: one-sided card gifts + two-sided swaps (offer -> accept).
-- Rules: swaps stay in the SAME rarity lane; GOLD cards cannot be gifted (only
-- traded gold-for-gold); a card marked tradeable=false cannot move at all.
-- Idempotent. Paste into the Supabase SQL editor or apply via apply-sql.mjs.

-- A per-card lock. false = this card can never be traded or gifted (special).
alter table cards add column if not exists tradeable boolean not null default true;

-- Remove ONE copy of a card from a player (decrement, delete the row at 0).
-- Returns true only if the player actually owned a copy.
create or replace function remove_card_from_player(p_player_id text, p_card_id bigint)
returns boolean language plpgsql security invoker set search_path = public as $$
declare had boolean := false;
begin
  update player_cards set quantity = quantity - 1
    where player_id = p_player_id and card_id = p_card_id and quantity > 0
    returning true into had;
  if had then
    delete from player_cards where player_id = p_player_id and card_id = p_card_id and quantity <= 0;
    return true;
  end if;
  return false;
end; $$;

-- One-sided card gift: move one copy from -> to, atomically. GOLD cards and
-- locked (tradeable=false) cards cannot be gifted.
create or replace function gift_card(p_from text, p_to text, p_card_id bigint)
returns boolean language plpgsql security invoker set search_path = public as $$
declare c record;
begin
  if p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  select rarity::text as rarity, tradeable into c from cards where id = p_card_id;
  if not found or not c.tradeable or c.rarity = 'gold' then return false; end if;
  if not remove_card_from_player(p_from, p_card_id) then return false; end if;
  perform add_card_to_player(p_to, p_card_id);
  return true;
end; $$;

-- Pending / resolved swap offers.
create table if not exists trade_offers (
  id              bigint generated always as identity primary key,
  from_id         text   not null references players (id) on delete cascade,
  to_id           text   not null references players (id) on delete cascade,
  offer_card_id   bigint not null references cards (id) on delete cascade,
  request_card_id bigint not null references cards (id) on delete cascade,
  status          text   not null default 'pending',  -- pending | accepted | declined | cancelled
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists trade_offers_to_idx on trade_offers (to_id, status);
create index if not exists trade_offers_from_idx on trade_offers (from_id, status);
alter table trade_offers enable row level security;

-- Create a swap offer. Both cards must be tradeable and the SAME rarity, and the
-- proposer must own the offered card right now.
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
  if not ro.tradeable or not rr.tradeable then return null; end if;  -- a card is locked
  if ro.rarity <> rr.rarity then return null; end if;                -- rarities stay laned
  perform 1 from player_cards where player_id = p_from and card_id = p_offer and quantity > 0;
  if not found then return null; end if;
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id)
    values (p_from, p_to, p_offer, p_request) returning id into oid;
  return oid;
end; $$;

-- Accept a swap: only the recipient, only while pending, only if BOTH still own
-- their side. Swaps one copy each, atomically; aborts + refunds on any failure.
create or replace function accept_trade(p_offer_id bigint, p_accepter text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status = 'pending' for update;
  if not found or t.to_id <> p_accepter then return false; end if;
  if not remove_card_from_player(t.from_id, t.offer_card_id) then return false; end if;
  if not remove_card_from_player(t.to_id, t.request_card_id) then
    perform add_card_to_player(t.from_id, t.offer_card_id); -- give it back
    return false;
  end if;
  perform add_card_to_player(t.to_id, t.offer_card_id);
  perform add_card_to_player(t.from_id, t.request_card_id);
  update trade_offers set status = 'accepted', resolved_at = now() where id = p_offer_id;
  return true;
end; $$;

-- Decline (recipient) or cancel (sender) a pending offer.
create or replace function set_trade_status(p_offer_id bigint, p_actor text, p_status text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status = 'pending' for update;
  if not found then return false; end if;
  if p_status = 'declined' and t.to_id <> p_actor then return false; end if;
  if p_status = 'cancelled' and t.from_id <> p_actor then return false; end if;
  if p_status not in ('declined', 'cancelled') then return false; end if;
  update trade_offers set status = p_status, resolved_at = now() where id = p_offer_id;
  return true;
end; $$;

notify pgrst, 'reload schema';
