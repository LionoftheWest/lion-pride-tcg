-- CP algorithm v2: Middle rarity curve + per-card variance + set-completion bonus.
--   CP(card)   = round( RarityBase x AscensionMult x cp_mod )
--   CP(subject)= sum(card CP); x1.25 if the player owns EVERY variant of the subject
-- RarityBase (Middle): 10 / 20 / 40 / 75 / 140.  AscensionMult: 1.00..2.50.

-- Per-subject variance, deterministic + stable from the key (0.90..1.10). No manual
-- authoring; override any subject's cp_mod later to hand-tune a "hero" card.
alter table subjects add column if not exists cp_mod numeric not null default 1.0;
update subjects
  set cp_mod = 0.90 + (abs(hashtext(key)) % 21) * 0.01
  where cp_mod = 1.0;

-- Replace the 2-arg power fn with a 3-arg one (cp_mod, defaulted so old 2-arg calls
-- still resolve). Dropping first avoids an overload ambiguity.
drop function if exists card_power(text, int);
create or replace function card_power(p_rarity text, p_ascension int, p_mod numeric default 1.0)
returns int language sql immutable as $$
  select round(
    (case p_rarity
       when 'normal'           then 10
       when 'illustrated_rare' then 20
       when 'full_art'         then 40
       when 'gold'             then 75
       when 'secret_rare'      then 140
       else 10 end)::numeric
    * (case greatest(0, least(5, coalesce(p_ascension, 0)))
         when 0 then 1.00 when 1 then 1.25 when 2 then 1.50
         when 3 then 1.75 when 4 then 2.00 when 5 then 2.50 end)
    * coalesce(p_mod, 1.0)
  )::int;
$$;

-- ascend_card: now also reads the subject cp_mod so the returned per-card power
-- includes variance.
create or replace function ascend_card(p_player_id text, p_card_id bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_qty int; v_asc int; v_rarity text; v_cost int; v_mod numeric;
begin
  select pc.quantity, pc.ascension, c.rarity, s.cp_mod
    into v_qty, v_asc, v_rarity, v_mod
  from player_cards pc
  join cards c    on c.id = pc.card_id
  join subjects s on s.id = c.subject_id
  where pc.player_id = p_player_id and pc.card_id = p_card_id
  for update of pc;

  if not found then return jsonb_build_object('ok', false, 'error', 'not owned'); end if;
  if v_asc >= 5 then return jsonb_build_object('ok', false, 'error', 'maxed'); end if;

  v_cost := ascend_cost(v_rarity, v_asc);
  if v_qty < 1 + v_cost then
    return jsonb_build_object('ok', false, 'error', 'need_more', 'have', v_qty, 'need', 1 + v_cost);
  end if;

  update player_cards set quantity = quantity - v_cost, ascension = ascension + 1
   where player_id = p_player_id and card_id = p_card_id;

  return jsonb_build_object('ok', true, 'ascension', v_asc + 1,
    'quantity', v_qty - v_cost, 'power', card_power(v_rarity, v_asc + 1, v_mod),
    'next_cost', ascend_cost(v_rarity, v_asc + 1));
end;
$$;

-- A player's Total CP = sum of per-subject CP, with a +25% set-completion bonus
-- for any subject whose every variant the player owns.
create or replace function my_collection_power(p_player_id text)
returns bigint language sql stable set search_path = public as $$
  with subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select c.subject_id,
           sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)) base_cp,
           count(*) ov
    from player_cards pc
    join cards c    on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.player_id = p_player_id and pc.quantity >= 1
    group by c.subject_id
  )
  select coalesce(sum(case when ps.ov = st.tv then round(ps.base_cp * 1.25) else ps.base_cp end), 0)::bigint
  from ps join subj_totals st on st.subject_id = ps.subject_id;
$$;

-- Leaderboard: top players by Total CP (same set-completion rule).
create or replace function top_collection_power(p_limit int default 20)
returns table(player_id text, username text, power bigint)
language sql stable set search_path = public as $$
  with subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select pc.player_id, c.subject_id,
           sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)) base_cp,
           count(*) ov
    from player_cards pc
    join cards c    on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.quantity >= 1
    group by pc.player_id, c.subject_id
  ),
  totals as (
    select ps.player_id,
           sum(case when ps.ov = st.tv then round(ps.base_cp * 1.25) else ps.base_cp end)::bigint cp
    from ps join subj_totals st on st.subject_id = ps.subject_id
    group by ps.player_id
  )
  select t.player_id, p.username, t.cp
  from totals t join players p on p.id = t.player_id
  order by t.cp desc
  limit greatest(1, least(100, coalesce(p_limit, 20)));
$$;

notify pgrst, 'reload schema';
