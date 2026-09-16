-- Phase 1: Ascension. Duplicates raise a card's star level (0-5), which adds
-- power (for the Hunt) and a flair tier (client-side). All additive + inert until
-- the API calls it. Concurrency-safe like spend_pack (row lock).

-- Per-owned-card star level.
alter table player_cards add column if not exists ascension int not null default 0;

-- Power a single card contributes: rarity base x ascension multiplier.
create or replace function card_power(p_rarity text, p_ascension int)
returns int language sql immutable as $$
  select round(
    (case p_rarity
       when 'normal'           then 10
       when 'illustrated_rare' then 25
       when 'full_art'         then 50
       when 'gold'             then 100
       when 'secret_rare'      then 200
       else 10 end)::numeric
    *
    (case greatest(0, least(5, coalesce(p_ascension, 0)))
       when 0 then 1.00 when 1 then 1.25 when 2 then 1.50
       when 3 then 1.75 when 4 then 2.00 when 5 then 2.50 end)
  )::int;
$$;

-- Duplicates consumed to go from the CURRENT star to the next, by rarity.
-- Commons need more copies; rares need fewer (matches how often they are pulled).
-- Returns null at 5 (maxed).
create or replace function ascend_cost(p_rarity text, p_ascension int)
returns int language sql immutable as $$
  select case when coalesce(p_ascension,0) >= 5 then null else (
    case p_rarity
      when 'normal'           then (array[2,3,4,6,8])[p_ascension+1]
      when 'illustrated_rare' then (array[2,2,3,4,5])[p_ascension+1]
      when 'full_art'         then (array[1,2,2,3,4])[p_ascension+1]
      when 'gold'             then (array[1,1,2,2,3])[p_ascension+1]
      when 'secret_rare'      then (array[1,1,1,2,2])[p_ascension+1]
      else (array[2,3,4,6,8])[p_ascension+1]
    end) end;
$$;

-- Atomic ascension: consume duplicates, raise the star. Row-locked so two
-- concurrent calls can never double-spend the same copies. The caller (activity
-- server) always passes the VERIFIED player id, never a client-claimed one.
create or replace function ascend_card(p_player_id text, p_card_id bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_qty int; v_asc int; v_rarity text; v_cost int;
begin
  select pc.quantity, pc.ascension, c.rarity
    into v_qty, v_asc, v_rarity
  from player_cards pc
  join cards c on c.id = pc.card_id
  where pc.player_id = p_player_id and pc.card_id = p_card_id
  for update of pc;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not owned');
  end if;
  if v_asc >= 5 then
    return jsonb_build_object('ok', false, 'error', 'maxed');
  end if;

  v_cost := ascend_cost(v_rarity, v_asc);
  -- Keep 1 copy as the card itself; ascension consumes v_cost EXTRA copies.
  if v_qty < 1 + v_cost then
    return jsonb_build_object('ok', false, 'error', 'need_more',
      'have', v_qty, 'need', 1 + v_cost);
  end if;

  update player_cards
     set quantity = quantity - v_cost, ascension = ascension + 1
   where player_id = p_player_id and card_id = p_card_id;

  return jsonb_build_object('ok', true, 'ascension', v_asc + 1,
    'quantity', v_qty - v_cost, 'power', card_power(v_rarity, v_asc + 1),
    'next_cost', ascend_cost(v_rarity, v_asc + 1));
end;
$$;

-- A player's Total Collection Power = sum of each owned card's power (each card
-- counts once, regardless of duplicate count).
create or replace function my_collection_power(p_player_id text)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(card_power(c.rarity::text, pc.ascension)), 0)::bigint
  from player_cards pc join cards c on c.id = pc.card_id
  where pc.player_id = p_player_id and pc.quantity >= 1;
$$;

-- Leaderboard: top players by Total Collection Power.
create or replace function top_collection_power(p_limit int default 20)
returns table(player_id text, username text, power bigint)
language sql stable set search_path = public as $$
  select pc.player_id, p.username,
         sum(card_power(c.rarity::text, pc.ascension))::bigint as power
  from player_cards pc
  join cards c   on c.id = pc.card_id
  join players p on p.id = pc.player_id
  where pc.quantity >= 1
  group by pc.player_id, p.username
  order by power desc
  limit greatest(1, least(100, coalesce(p_limit, 20)));
$$;

notify pgrst, 'reload schema';
