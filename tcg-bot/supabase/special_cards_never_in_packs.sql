-- Event AND Promo cards never come from a pack (Nathan, 2026-10-01). event_cards.sql covered
-- Event only. Both tiers: never in the draw pool, never traded or gifted the normal way.

create or replace function public.cards_event_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.rarity::text in ('event', 'promo') then
    new.tradeable := false;      -- trades and gifts refuse a card with tradeable = false
    new.in_draw_pool := false;   -- never in a pack
  end if;
  return new;
end $$;

update public.cards set tradeable = false, in_draw_pool = false where rarity::text in ('event', 'promo');
