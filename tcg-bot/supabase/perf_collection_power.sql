-- perf_collection_power.sql (2026-10-11). Database load: my_collection_power was called 25,777 times (15 ms each live); collection_power_all and
-- top_collection_power build the leaderboard. Each card called card_power, which read the balance table twice (rarity_cp, stars), and each
-- set group read set_bonus again.
-- Change (built from the LIVE texts of 2026-10-11: my_collection_power a25e996ebcfc49edfeac7d149a5ab4da, collection_power_all
-- 93f4d4c58467dade8bc7ca7b36e7dd42, top_collection_power 529a2cacae1407a63e5e304960e81f8c): the three functions read rarity_cp, stars and set_bonus
-- ONCE (a CTE) and call the pure CP formula card_cp_exact(rarity, ascension, mod, rcp, stars) of perf_card_power_reads.sql, rounded exactly as
-- card_power rounds. The formula stays in that one function; the set-completion rule and the grouping are unchanged.
-- Same answer for every player (test: card-studio/scripts/test-collection-power-reads.mjs compares the old text, every player).
-- Needs perf_card_power_reads.sql.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or the text this file made.
do $g$
declare r record;
begin
  for r in select * from (values
    ('public.my_collection_power(text)', 'a25e996ebcfc49edfeac7d149a5ab4da', 'a46f5a1c1b0da1d3459cbe48ba05216f'),
    ('public.collection_power_all()', '93f4d4c58467dade8bc7ca7b36e7dd42', '4a88bfc04b1d7492f0dc9d2cd4b239d7'),
    ('public.top_collection_power(integer)', '529a2cacae1407a63e5e304960e81f8c', '2b7b24ff314b75c8f658da47df1b4b36')) v(fn, md5, md5_after) loop
    if md5(replace(pg_get_functiondef(r.fn::regprocedure), chr(13), '')) not in (r.md5, r.md5_after) then
      raise exception 'perf_collection_power.sql: the live % changed since this file was built. Rebuild it from the live text.', r.fn;
    end if;
  end loop;
  perform 'public.card_cp_exact(text,integer,numeric,jsonb,jsonb)'::regprocedure;   -- perf_card_power_reads.sql is applied
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.my_collection_power(p_player_id text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with b as (select balance_get('rarity_cp') rcp, balance_get('stars') st, (balance_get('set_bonus') #>> '{}')::numeric sb),
  subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select c.subject_id,
           sum(round(card_cp_exact(c.rarity::text, pc.ascension, s.cp_mod, b.rcp, b.st))::int) base_cp,
           count(*) ov
    from b, player_cards pc
    join cards c    on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.player_id = p_player_id and pc.quantity >= 1
    group by c.subject_id
  )
  select coalesce(sum(case when ps.ov = st.tv then round(ps.base_cp * (select sb from b)) else ps.base_cp end), 0)::bigint
  from ps join subj_totals st on st.subject_id = ps.subject_id;
$function$;

CREATE OR REPLACE FUNCTION public.collection_power_all()
 RETURNS TABLE(player_id text, power bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with b as (select balance_get('rarity_cp') rcp, balance_get('stars') st, (balance_get('set_bonus') #>> '{}')::numeric sb),
  subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
  ps as (
    select pc.player_id, c.subject_id, sum(round(card_cp_exact(c.rarity::text, pc.ascension, s.cp_mod, b.rcp, b.st))::int) base_cp, count(*) ov
      from b, player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
     where pc.quantity >= 1 group by pc.player_id, c.subject_id
  )
  select ps.player_id, sum(case when ps.ov = st.tv then round(ps.base_cp * (select sb from b)) else ps.base_cp end)::bigint
    from ps join subj_totals st on st.subject_id = ps.subject_id group by ps.player_id;
$function$;

CREATE OR REPLACE FUNCTION public.top_collection_power(p_limit integer DEFAULT 20)
 RETURNS TABLE(player_id text, username text, power bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with totals as (select a.player_id, a.power cp from collection_power_all() a)
  select t.player_id, p.username, t.cp
  from totals t join players p on p.id = t.player_id
  order by t.cp desc
  limit greatest(1, least(100, coalesce(p_limit, 20)));
$function$;

grant execute on function public.my_collection_power(text) to postgres, service_role;
grant execute on function public.collection_power_all() to postgres, service_role;
grant execute on function public.top_collection_power(integer) to postgres, service_role;
notify pgrst, 'reload schema';
