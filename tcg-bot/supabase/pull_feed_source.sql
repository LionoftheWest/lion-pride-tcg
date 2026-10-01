-- Fix (2026-10-01): a card that arrived by a trade or a card gift showed in Live pulls as
-- "pulled". The feed lists the newest player_cards rows, and a trade or a gift makes a new
-- row too. Now each row keeps how the member FIRST got the card: 'pull' (a pack), 'trade' or
-- 'gift'. The feed shows only 'pull'. Packs use add_cards_to_player (default 'pull'); trades
-- and gifts use add_card_to_player with their source.
-- Test: card-studio/scripts/test-pull-feed-source.mjs.
alter table public.player_cards add column if not exists first_source text not null default 'pull';

-- The rows from today's trades and card gifts (before this fix) are not pulls.
update public.player_cards pc set first_source = 'trade'
  from public.trade_offers o
 where o.status = 'accepted' and pc.first_obtained_at = o.resolved_at
   and ((pc.player_id = o.to_id and pc.card_id = o.offer_card_id) or (pc.player_id = o.from_id and pc.card_id = o.request_card_id));
update public.player_cards pc set first_source = 'gift'
  from public.notifications n
 where n.kind = 'card_gift' and n.player_id = pc.player_id and pc.first_source = 'pull'
   and pc.first_obtained_at between n.created_at - interval '10 seconds' and n.created_at;

create or replace function public.add_card_to_player(p_player_id text, p_card_id bigint, p_source text)
returns void
language sql
set search_path to 'public'
as $$
  insert into player_cards (player_id, card_id, quantity, first_source)
  values (p_player_id, p_card_id, 1, coalesce(p_source, 'pull'))
  on conflict (player_id, card_id)
  do update set quantity = player_cards.quantity + 1;
$$;

create or replace function public.accept_trade(p_offer_id bigint, p_accepter text)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status = 'pending' for update;
  if not found or t.to_id <> p_accepter then return false; end if;
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

create or replace function public.gift_card(p_from text, p_to text, p_card_id bigint)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare c record;
begin
  if p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  select rarity::text as rarity, tradeable into c from cards where id = p_card_id;
  if not found or not c.tradeable or c.rarity = 'gold' then return false; end if;
  if free_copies(p_from, p_card_id) < 1 then return false; end if; -- reserved or not owned
  if not remove_card_from_player(p_from, p_card_id) then return false; end if;
  perform add_card_to_player(p_to, p_card_id, 'gift');
  return true;
end; $$;

-- The feed reads the newest pulls only.
create index if not exists player_cards_pull_feed on public.player_cards (first_obtained_at desc) where first_source = 'pull';

notify pgrst, 'reload schema';
