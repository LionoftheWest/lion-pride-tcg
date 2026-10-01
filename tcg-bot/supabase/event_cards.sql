-- Event cards (Nathan, 2026-10-01, launch day): the power of a Full Art (75 base), so they are
-- special and useful but not overpowered (members cannot ascend them), and they NEVER trade
-- the normal way (no trade, no gift): only special auctions and events. A trigger keeps every
-- Event card untradeable and out of the pack draw, whatever tool saves it.

create or replace function public.card_power(p_rarity text, p_ascension integer, p_mod numeric default 1.0)
returns integer language sql immutable as $$
  select round(
    (case p_rarity
       when 'normal'           then 10
       when 'illustrated_rare' then 20
       when 'secret_rare'      then 40
       when 'full_art'         then 75
       when 'event'            then 75
       when 'gold'             then 140
       else 10 end)::numeric
    * (case greatest(0, least(5, coalesce(p_ascension, 0)))
         when 0 then 1.00 when 1 then 1.25 when 2 then 1.50
         when 3 then 1.75 when 4 then 2.00 when 5 then 2.50 end)
    * coalesce(p_mod, 1.0)
  )::int;
$$;

create or replace function public.cards_event_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.rarity::text = 'event' then
    new.tradeable := false;      -- trades and gifts refuse a card with tradeable = false
    new.in_draw_pool := false;   -- never in a pack
  end if;
  return new;
end $$;

drop trigger if exists cards_event_rules on public.cards;
create trigger cards_event_rules before insert or update of rarity, tradeable, in_draw_pool on public.cards
  for each row execute function public.cards_event_rules();

update public.cards set tradeable = false, in_draw_pool = false where rarity::text = 'event';
