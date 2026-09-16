-- Fix rarity power ordering (2026-09-15): power must track scarcity. The pull rates rank
-- rarity normal > illustrated_rare > secret_rare > full_art > gold (gold rarest, 0.002).
-- The old bases gave secret_rare 140 and gold 75, so a gold card hit weaker than a secret
-- rare. Reorder so gold is the strongest: secret_rare 40, full_art 75, gold 140.
create or replace function card_power(p_rarity text, p_ascension int, p_mod numeric default 1.0)
returns int language sql immutable as $$
  select round(
    (case p_rarity
       when 'normal'           then 10
       when 'illustrated_rare' then 20
       when 'secret_rare'      then 40
       when 'full_art'         then 75
       when 'gold'             then 140
       else 10 end)::numeric
    * (case greatest(0, least(5, coalesce(p_ascension, 0)))
         when 0 then 1.00 when 1 then 1.25 when 2 then 1.50
         when 3 then 1.75 when 4 then 2.00 when 5 then 2.50 end)
    * coalesce(p_mod, 1.0)
  )::int;
$$;

notify pgrst, 'reload schema';
