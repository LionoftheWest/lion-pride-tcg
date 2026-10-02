-- Member card gifts wait in the bell (Nathan, 2026-10-01): a gifted card is redeemed like a pack
-- gift, and the redeem plays the card animation. The card leaves the sender at once (it is theirs
-- no more); the receiver gets it on Redeem. claim_gift adds a card through add_card_to_player.

create or replace function public.gift_card(p_from text, p_to text, p_card_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  if p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  select rarity::text as rarity, tradeable into c from cards where id = p_card_id;
  if not found or not c.tradeable or c.rarity = 'gold' then return false; end if;
  if free_copies(p_from, p_card_id) < 1 then return false; end if; -- reserved or not owned
  if not remove_card_from_player(p_from, p_card_id) then return false; end if;
  -- The card waits in the receiver's bell (gift_claims) until they redeem it, like a pack gift
  -- (Nathan, 2026-10-01: a gifted card plays the card animation on redeem). It left the sender above.
  insert into gift_claims (player_id, kind, title, amount, reason, from_id, card_id)
  values (p_to, 'card', coalesce((select name from cards where id = p_card_id), 'A card'), 1, 'member_gift', p_from, p_card_id);
  return true;
end; $function$;

create or replace function public.claim_gift(p_player text, p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare g gift_claims; bal int;
begin
  select * into g from gift_claims where id = p_id and player_id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if g.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  update gift_claims set claimed_at = now() where id = p_id;
  if g.kind = 'card' then
    -- A card gift (launch_event_cards.sql): the card goes to the collection.
    perform add_card_to_player(p_player, g.card_id, 'gift'); -- the same path as a trade
    return jsonb_build_object('ok', true, 'packs', 0, 'card_id', g.card_id, 'title', g.title);
  end if;
  bal := grant_packs(p_player, g.amount, g.reason, g.from_id);
  return jsonb_build_object('ok', true, 'packs', g.amount, 'title', g.title, 'balance', bal);
end $function$;
