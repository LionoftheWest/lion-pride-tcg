-- perf_card_power_reads.sql (2026-10-11). Database load: card_powers cost 172 ms live (max 6.6 s), dungeon_view 187 ms, card_stats_for 30 ms.
-- Cause (measured on the local copy, 185 cards: card_powers 43 ms): each card read the balance table about 17 times
-- (balance_get is a plpgsql function with one query): card_combat 15 reads (stat_cfg, card_cp_exact 2, card_max_hp 2, stat_pt 10),
-- card_power 2 more. The numbers come from the balance table (Nathan, 2026-10-03: one source of truth), so the fix reads the table
-- ONCE and passes the values down. The formulas stay in ONE place each:
--   card_cp_exact(rarity, ascension, mod, rcp, stars)   pure form of the CP formula (the 3-argument form reads balance, then calls it)
--   card_max_hp(cp, floor, per_cp)                      pure form of the HP formula (the 1-argument form reads balance, then calls it)
--   stat_pt(pts, key, max)                              pure form of the stat clamp (the 2-argument form reads balance, then calls it)
--   card_combat(rarity, asc, mod, pts, bundle)          the combat formula on a balance bundle; the 4-argument form reads card_balance()
--   card_balance()                                      the four balance keys the combat formula needs, in one read
--   card_powers(player)                                 reads the bundle once for all cards
-- Every answer is the same as before (the test card-studio/scripts/test-card-power-reads.mjs compares the old text with the new one
-- on rarities x stars x mods x point sets, flag on and off, and on every player of the database). No balance number changes.
-- The signatures of the existing functions stay, so every caller (hunt_attack, dungeon_card, effects, the bot) is untouched.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from.
do $g$
declare r record;
begin
  for r in select * from (values
    ('public.card_combat(text,integer,numeric,jsonb)', 'f7b151cfedfd8f0a595404e327f80d33'),
    ('public.card_cp_exact(text,integer,numeric)', '58e5d3a7cf343ddebb4752caf3674f5e'),
    ('public.card_max_hp(integer)', '8239c710ad593efd647ae2deb84b0b91'),
    ('public.stat_pt(jsonb,text)', '521ff10a291b32e121412cc192eef43d'),
    ('public.card_powers(text)', '6ebdafc5b7e1637d6f19d7222c9d3879')) v(fn, md5) loop
    if md5(replace(pg_get_functiondef(r.fn::regprocedure), chr(13), '')) <> r.md5 then
      raise exception 'perf_card_power_reads.sql: the live % changed since this file was built. Rebuild it from the live text.', r.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- The four balance keys of the combat formula, in one read.
create or replace function public.card_balance() returns jsonb
 language sql stable set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from balance where key in ('stat_points', 'rarity_cp', 'stars', 'card_hp');
$$;

-- CP formula, pure form.
create or replace function public.card_cp_exact(p_rarity text, p_ascension integer, p_mod numeric, p_rcp jsonb, p_st jsonb)
 returns numeric language sql immutable set search_path to 'public' as $$
  select coalesce((p_rcp->>p_rarity)::numeric, (p_rcp->>'normal')::numeric)
       * coalesce((p_st->p_rarity->>greatest(0, least(5, coalesce(p_ascension, 0))))::numeric,
                  (p_st->'normal'->>greatest(0, least(5, coalesce(p_ascension, 0))))::numeric)
       * coalesce(p_mod, 1.0);
$$;
-- The 3-argument form: the same formula on the balance table (as before).
create or replace function public.card_cp_exact(p_rarity text, p_ascension integer, p_mod numeric default 1.0)
 returns numeric language sql stable set search_path to 'public' as $$
  select card_cp_exact(p_rarity, p_ascension, p_mod, balance_get('rarity_cp'), balance_get('stars'));
$$;

-- HP formula, pure form.
create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric)
 returns integer language sql immutable set search_path to 'public' as $$
  select greatest(p_floor, round(p_cp * p_per_cp))::int;
$$;
create or replace function public.card_max_hp(p_cp integer)
 returns integer language sql stable set search_path to 'public' as $$
  select card_max_hp(p_cp, balance_num('card_hp', 'floor'), balance_num('card_hp', 'per_cp'));
$$;

-- Stat clamp, pure form.
create or replace function public.stat_pt(p_pts jsonb, p_key text, p_max integer)
 returns integer language sql immutable set search_path to 'public' as $$
  select greatest(0, least(p_max, coalesce(case when jsonb_typeof(p_pts->p_key) = 'number'
    then floor((p_pts->>p_key)::numeric)::int end, 0)));
$$;
create or replace function public.stat_pt(p_pts jsonb, p_key text)
 returns integer language sql stable set search_path to 'public' as $$
  select stat_pt(p_pts, p_key, balance_num('stat_points', 'max_per_stat')::int);
$$;

-- The combat formula on a balance bundle (card_balance()).
create or replace function public.card_combat(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb, p_b jsonb)
 returns jsonb language plpgsql stable set search_path to 'public' as $function$
declare
  c jsonb := p_b->'stat_points';
  a int := greatest(0, least(5, coalesce(p_asc, 0)));
  pts jsonb := coalesce(p_pts, '{}'::jsonb);
  fl numeric := (p_b->'card_hp'->>'floor')::numeric; per numeric := (p_b->'card_hp'->>'per_cp')::numeric;
  mx int := (c->>'max_per_stat')::int;
  v_x numeric; v_cp int; v_spent int; sa int; sv int; sp int; sq int; sh int;
begin
  if c is null or p_b->'rarity_cp' is null or p_b->'stars' is null or fl is null or per is null or mx is null then
    raise exception 'balance: no value for the combat keys (stat_points, rarity_cp, stars, card_hp)';
  end if;
  v_x := card_cp_exact(p_rarity, a, p_mod, p_b->'rarity_cp', p_b->'stars');
  if not coalesce((c->>'enabled')::boolean, false) then
    v_cp := round(v_x)::int;
    return jsonb_build_object('on', false, 'cp', v_cp, 'hp', card_max_hp(v_cp, fl, per), 'crit', 0,
      'potency', 1, 'haste', 1, 'free', 0);
  end if;
  sa := stat_pt(pts, 'attack', mx); sv := stat_pt(pts, 'vitality', mx); sp := stat_pt(pts, 'precision', mx);
  sq := stat_pt(pts, 'potency', mx); sh := stat_pt(pts, 'haste', mx);
  v_spent := sa + sv + sp + sq + sh;
  v_cp := round(v_x * (1 + (c->>'attack')::numeric * sa))::int;
  return jsonb_build_object('on', true, 'cp', v_cp,
    'hp', round(card_max_hp(v_cp, fl, per) * (1 + (c->>'vitality')::numeric * sv))::int,
    'crit', (c->>'precision')::numeric * sp,
    'potency', 1 + (c->>'potency')::numeric * sq,
    'haste', greatest((c->>'haste_floor')::numeric, 1 - (c->>'haste')::numeric * sh),
    'free', greatest(0, (c->>'per_star')::int * a - v_spent));
end $function$;
-- The 4-argument form (every caller): one read of the bundle, then the formula.
create or replace function public.card_combat(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb)
 returns jsonb language sql stable set search_path to 'public' as $$
  select card_combat(p_rarity, p_asc, p_mod, p_pts, card_balance());
$$;

-- card_powers: the bundle once for all cards.
create or replace function public.card_powers(p_player text default null::text)
 returns jsonb language sql stable set search_path to 'public' as $function$
  with b as (select card_balance() v)
  select coalesce(jsonb_object_agg(x.id::text, x.v), '{}'::jsonb) from (
    select c.id, jsonb_build_object('power', round(card_cp_exact(c.rarity::text, 0, s.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                    'hp', card_max_hp(round(card_cp_exact(c.rarity::text, 0, s.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                                      (b.v->'card_hp'->>'floor')::numeric, (b.v->'card_hp'->>'per_cp')::numeric)) as v
      from b, cards c left join subjects s on s.id = c.subject_id where p_player is null
    union all
    select c.id, card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points, b.v)
                 || jsonb_build_object('power', round(card_cp_exact(c.rarity::text, pc.ascension, s.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int)
      from b, player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
     where p_player is not null and pc.player_id = p_player and pc.quantity > 0) x;
$function$;

grant execute on function public.card_balance() to postgres, service_role;
grant execute on function public.card_cp_exact(text, integer, numeric, jsonb, jsonb) to postgres, service_role;
grant execute on function public.card_cp_exact(text, integer, numeric) to postgres, service_role;
grant execute on function public.card_max_hp(integer, numeric, numeric) to postgres, service_role;
grant execute on function public.card_max_hp(integer) to postgres, service_role;
grant execute on function public.stat_pt(jsonb, text, integer) to postgres, service_role;
grant execute on function public.stat_pt(jsonb, text) to postgres, service_role;
grant execute on function public.card_combat(text, integer, numeric, jsonb, jsonb) to postgres, service_role;
grant execute on function public.card_combat(text, integer, numeric, jsonb) to postgres, service_role;
grant execute on function public.card_powers(text) to postgres, service_role;
notify pgrst, 'reload schema';
