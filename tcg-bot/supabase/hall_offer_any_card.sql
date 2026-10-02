-- An offer on a For trade card can be ANY card of the same rarity (Nathan, 2026-10-02: "it should show
-- ALL the normals ... and highlight the soggy bread as a wishlisted item"). The wishlist only
-- highlights. create_trade still checks the same rarity and that both cards are tradeable.
create or replace function public.offer_on_listing(p_from text, p_listing bigint, p_offer bigint)
returns jsonb language plpgsql set search_path = public as $$
declare l trade_listings; oid bigint;
begin
  select * into l from trade_listings where id = p_listing and status = 'open';
  if not found then return jsonb_build_object('ok', false, 'error', 'listing_closed'); end if;
  if l.player_id = p_from then return jsonb_build_object('ok', false, 'error', 'own_listing'); end if;
  if free_copies(l.player_id, l.card_id) < 1 then return jsonb_build_object('ok', false, 'error', 'listing_gone'); end if;
  if exists (select 1 from trade_offers where from_id = p_from and listing_id = p_listing and status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'already_offered');
  end if;
  oid := create_trade(p_from, l.player_id, p_offer, l.card_id);
  if oid is null then return jsonb_build_object('ok', false, 'error', 'cannot_trade'); end if;
  update trade_offers set listing_id = p_listing where id = oid;
  return jsonb_build_object('ok', true, 'id', oid, 'to', l.player_id);
end $$;
