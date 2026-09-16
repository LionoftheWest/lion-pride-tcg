-- Ascension cost v3: exponential growth. ~4 dupes for the first star, climbing to
-- ~15 for the fifth (Normal), so a Normal card costs ~44 dupes to reach 5-star and
-- ~50+ with the later Prestige craft. Rarer cards scale down (you pull fewer dupes).
create or replace function ascend_cost(p_rarity text, p_ascension int)
returns int language sql immutable as $$
  select case when coalesce(p_ascension, 0) >= 5 then null else (
    case p_rarity
      when 'normal'           then (array[4, 6, 8, 11, 15])[p_ascension + 1]
      when 'illustrated_rare' then (array[3, 4, 6, 8, 11])[p_ascension + 1]
      when 'full_art'         then (array[2, 3, 4, 6, 8])[p_ascension + 1]
      when 'gold'             then (array[1, 2, 3, 4, 5])[p_ascension + 1]
      when 'secret_rare'      then (array[1, 1, 2, 3, 4])[p_ascension + 1]
      else (array[4, 6, 8, 11, 15])[p_ascension + 1]
    end) end;
$$;
notify pgrst, 'reload schema';
