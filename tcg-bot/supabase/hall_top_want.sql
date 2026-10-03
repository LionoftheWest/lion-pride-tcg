-- The top want (Nathan, 2026-10-02). The Wanted view shows ONE card for each member: their top want.
-- The full wishlist (5 slots) stays on the profile. A member marks one slot with a star; with no star,
-- the first filled slot is the top want (hall-routes.js), so a wishlist set before this shows at once.
-- The star stays with the slot: set_wishlist puts a new card in the slot, and the star does not move.

alter table public.wishlists add column if not exists top boolean not null default false;
create unique index if not exists wishlists_one_top on public.wishlists (player_id) where top;

create or replace function public.set_wish_top(p_player text, p_slot int)
returns jsonb language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from wishlists where player_id = p_player and slot = p_slot) then
    return jsonb_build_object('ok', false, 'error', 'empty_slot');
  end if;
  -- The old star goes first, so the one-star index never sees two stars, in any row order.
  update wishlists set top = false where player_id = p_player and top and slot <> p_slot;
  update wishlists set top = true where player_id = p_player and slot = p_slot;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.set_wish_top(text, int) from public, anon, authenticated;
