-- Two-step trades (Nathan, 2026-10-01): "the person offering the trade should not be able to
-- see the other person's cards. The offer goes, then the person receiving the offer chooses
-- their card, and when both people have offered a card, both have to accept."
--   1. The sender offers one card            -> status 'pending', request_card_id NULL
--   2. The receiver picks a card back         -> status 'countered' (the same rarity, Nathan)
--   3. The sender accepts                     -> the swap ('accepted')
-- The receiver accepted by picking. Either side can stop it before the swap (declined /
-- cancelled). An old pending offer that already names both cards still accepts as before.
-- Test: card-studio/scripts/test-trade-two-step.mjs.
alter table public.trade_offers alter column request_card_id drop not null;
alter table public.trade_offers add column if not exists countered_at timestamptz;

-- A copy in an open offer, or a copy picked back in a countered offer, is reserved.
create or replace function public.free_copies(p_player text, p_card bigint)
returns integer
language sql
set search_path to 'public'
as $$
  select coalesce((select quantity from player_cards where player_id = p_player and card_id = p_card), 0)
       - (select count(*)::int from trade_offers
            where from_id = p_player and offer_card_id = p_card and status in ('pending', 'countered'))
       - (select count(*)::int from trade_offers
            where to_id = p_player and request_card_id = p_card and status = 'countered');
$$;

-- Step 1: offer one card. The sender does not name (or see) the other member's card.
create or replace function public.create_trade_open(p_from text, p_to text, p_offer bigint)
returns bigint
language plpgsql
set search_path to 'public'
as $$
declare oid bigint; ro record;
begin
  if p_from = p_to then return null; end if;
  perform 1 from players where id = p_to;
  if not found then return null; end if;
  select rarity::text as rarity, tradeable into ro from cards where id = p_offer;
  if not found or not ro.tradeable then return null; end if;
  if free_copies(p_from, p_offer) < 1 then return null; end if;
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id)
    values (p_from, p_to, p_offer, null) returning id into oid;
  return oid;
end; $$;

-- Step 2: the receiver picks their card (the same rarity, a free copy, not the same card).
create or replace function public.counter_trade(p_offer_id bigint, p_actor text, p_card bigint)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare t record; ro record; rr record;
begin
  select * into t from trade_offers where id = p_offer_id and status = 'pending' and request_card_id is null for update;
  if not found or t.to_id <> p_actor then return false; end if;
  if p_card = t.offer_card_id then return false; end if;
  select rarity::text as rarity into ro from cards where id = t.offer_card_id;
  select rarity::text as rarity, tradeable into rr from cards where id = p_card;
  if not found or not rr.tradeable or rr.rarity <> ro.rarity then return false; end if;
  if free_copies(p_actor, p_card) < 1 then return false; end if;
  update trade_offers set request_card_id = p_card, status = 'countered', countered_at = now() where id = p_offer_id;
  return true;
end; $$;

-- Step 3: the swap. A countered offer: only the sender accepts (the receiver accepted by
-- picking). An old pending offer that names both cards: only the receiver accepts.
create or replace function public.accept_trade(p_offer_id bigint, p_accepter text)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status in ('pending', 'countered') for update;
  if not found or t.request_card_id is null then return false; end if;
  if t.status = 'countered' and t.from_id <> p_accepter then return false; end if;
  if t.status = 'pending' and t.to_id <> p_accepter then return false; end if;
  if not remove_card_from_player(t.from_id, t.offer_card_id) then return false; end if;
  if not remove_card_from_player(t.to_id, t.request_card_id) then
    perform add_card_to_player(t.from_id, t.offer_card_id, 'trade'); -- give it back
    return false;
  end if;
  perform add_card_to_player(t.to_id, t.offer_card_id, 'trade');
  perform add_card_to_player(t.from_id, t.request_card_id, 'trade');
  update trade_offers set status = 'accepted', resolved_at = now() where id = p_offer_id;
  return true;
end; $$;

-- Stop an open trade: the receiver declines, the sender cancels (before the swap).
create or replace function public.set_trade_status(p_offer_id bigint, p_actor text, p_status text)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status in ('pending', 'countered') for update;
  if not found then return false; end if;
  if p_status = 'declined' and t.to_id <> p_actor then return false; end if;
  if p_status = 'cancelled' and t.from_id <> p_actor then return false; end if;
  if p_status not in ('declined', 'cancelled') then return false; end if;
  update trade_offers set status = p_status, resolved_at = now() where id = p_offer_id;
  return true;
end; $$;

notify pgrst, 'reload schema';
