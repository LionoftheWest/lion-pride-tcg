-- perf_five_slow_calls.sql (2026-10-11). docs foundations "Performance and cost budget", rule 5: a speed PR for the slowest calls
-- (card_powers, dungeon_attack, dungeon_view, gauntlet_view, achievement_view). The goal: 50+ daily players on the free plan.
-- Causes (measured on the local copy with track_functions = all, member with 185 cards):
--   card_powers(player): card_combat ran once per card (185 calls, each with 5 stat_pt, 2 card_cp_exact, 1 card_max_hp), but the
--     member has only 24 different inputs (rarity, stars, cp_mod, stat points). card_powers(null): 352 cards, 37 different inputs.
--   dungeon_view ('mine'): the same per-card card_combat, and the LATERAL subquery was pulled up, so card_combat ran once for each
--     reference to its result (289 calls for 185 cards).
--   gauntlet_view ('squad'): the same pull-up: dungeon_card_base (a card_balance() read and a card_combat each) ran 33 times
--     for the 5 squad cards.
--   achievement_view: ach_track_values called the 2-argument stat_pt 5 times per card (925 balance table reads for 185 cards)
--     and ach_has_element once per card (an element_aliases() table per call), although it depends only on the subject.
--   dungeon_attack: NOT changed here. Its time is in the combat code (combat_squad element lookups) and in the log inserts;
--     the combat code is out of scope of this PR (Haste and Attack-HP work in parallel).
-- Change (built from the LIVE text of 2026-10-11; the md5s are in the guard):
--   card_powers: card_combat (and the 'power' card_cp_exact) once per DIFFERENT input, then joined back to each card.
--     card_combat stays the one calculation (F-3): no copy of the formula, only fewer calls of it.
--   dungeon_view_core: 'mine' computes card_combat once per different input (as card_powers). Sorted by cp as before (cards with
--     the same cp have no defined order, as before; on the local copy all 218 answers were byte-identical).
--   gauntlet_view: OFFSET 0 keeps the squad LATERAL as one call of dungeon_card_base per card.
--   ach_track_values: the 3-argument stat_pt with the limit read once (a lazy subquery: no read when the member has no card),
--     ach_has_element once per different subject.
-- The answers are the same, key by key: the test compares the old and the new answer for every member.
-- No balance number and no rule changes. Test: card-studio/scripts/test-perf-five-slow-calls.mjs.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or the text this file made.
do $g$
declare m1 text; m2 text; m3 text; m4 text;
begin
  select md5(replace(pg_get_functiondef('public.card_powers(text)'::regprocedure), chr(13), '')) into strict m1;
  select md5(replace(pg_get_functiondef('public.dungeon_view_core(text, boolean)'::regprocedure), chr(13), '')) into strict m2;
  select md5(replace(pg_get_functiondef('public.gauntlet_view(text)'::regprocedure), chr(13), '')) into strict m3;
  select md5(replace(pg_get_functiondef('public.ach_track_values(text)'::regprocedure), chr(13), '')) into strict m4;
  if m1 not in ('26523cb226facd148993e069a064aa85', '62c2883f976c480c8f817f8249e6c053') then
    raise exception 'perf_five_slow_calls.sql: the live card_powers changed since this file was built. Rebuild it from the live text.';
  end if;
  if m2 not in ('56225e90cb1741b61612b61d82558988', '7b7ae8216c958c8f9da0365120c0536b') then
    raise exception 'perf_five_slow_calls.sql: the live dungeon_view_core changed since this file was built. Rebuild it from the live text.';
  end if;
  if m3 not in ('76df0a1b192308eba8b1422c670d7956', 'a37af9d2320ec9f6a443fce2046e9732') then
    raise exception 'perf_five_slow_calls.sql: the live gauntlet_view changed since this file was built. Rebuild it from the live text.';
  end if;
  if m4 not in ('a4816a46ab5d8db754a8d37e222f5e07', '8aaca289690d7134433622782013d90e') then
    raise exception 'perf_five_slow_calls.sql: the live ach_track_values changed since this file was built. Rebuild it from the live text.';
  end if;
end $g$;
-- GUARD-END

create or replace function public.card_powers(p_player text default null::text)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  -- card_combat once per DIFFERENT input (perf_five_slow_calls.sql): many copies share rarity, stars, cp_mod and stat points.
  with b as materialized (select card_balance() v),
  base as materialized (
    select c.id, c.rarity::text rarity, s.cp_mod from cards c left join subjects s on s.id = c.subject_id where p_player is null),
  base_k as materialized (
    select k.rarity, k.cp_mod, jsonb_build_object('power', round(card_cp_exact(k.rarity, 0, k.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                                  'hp', card_max_hp(round(card_cp_exact(k.rarity, 0, k.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                                                    (b.v->'card_hp'->>'floor')::numeric, (b.v->'card_hp'->>'per_cp')::numeric)) v
      from (select distinct rarity, cp_mod from base) k, b),
  own as materialized (
    select c.id, c.rarity::text rarity, pc.ascension, s.cp_mod, pc.stat_points
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
     where p_player is not null and pc.player_id = p_player and pc.quantity > 0),
  own_k as materialized (
    select k.rarity, k.ascension, k.cp_mod, k.stat_points,
           card_combat(k.rarity, k.ascension, k.cp_mod, k.stat_points, b.v)
           || jsonb_build_object('power', round(card_cp_exact(k.rarity, k.ascension, k.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int) v
      from (select distinct rarity, ascension, cp_mod, stat_points from own) k, b)
  select coalesce(jsonb_object_agg(x.id::text, x.v), '{}'::jsonb) from (
    select base.id, k.v from base join base_k k on k.rarity = base.rarity and k.cp_mod is not distinct from base.cp_mod
    union all
    select own.id, k.v from own join own_k k on k.rarity = own.rarity and k.ascension is not distinct from own.ascension
       and k.cp_mod is not distinct from own.cp_mod and k.stat_points is not distinct from own.stat_points) x;
$function$;

create or replace function public.dungeon_view_core(p_player text, p_mine boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int; v_mine jsonb := '{}'::jsonb;
  v_b jsonb; v_cost jsonb; v_h0 int; v_board jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  v_board := dungeon_board(v_day, 1000);   -- read ONCE: the member's rank and the top 3 both come from it
  select (e->>'rank')::int into v_rank from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  if p_mine then
    v_b := card_balance(); v_cost := balance_get('dungeon')->'cost'; v_h0 := card_max_hp(0);
    -- card_combat once per DIFFERENT input (perf_five_slow_calls.sql), joined back to each card.
    v_mine := jsonb_build_object('mine', (
             with own as materialized (
               select pc.card_id, c.id, s.type, c.rarity::text rarity, pc.ascension, s.cp_mod, pc.stat_points, s.tag_slugs
                 from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
                where pc.player_id = p_player and pc.quantity > 0),
             kc as materialized (
               select k.rarity, k.ascension, k.cp_mod, k.stat_points, card_combat(k.rarity, k.ascension, k.cp_mod, k.stat_points, v_b) cmb
                 from (select distinct rarity, ascension, cp_mod, stat_points from own) k)
             select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'type', o.type, 'rarity', o.rarity,
               'cost', coalesce((v_cost->>o.rarity)::numeric, balance_num('dungeon', 'cost', o.rarity))::int, 'cp', (x.cmb->>'cp')::int,
               'hp', case when o.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else v_h0 end,
               'slugs', coalesce(to_jsonb(o.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from own o join kc x on x.rarity = o.rarity and x.ascension is not distinct from o.ascension
                  and x.cp_mod is not distinct from o.cp_mod and x.stat_points is not distinct from o.stat_points));
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
    'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', balance_num('dungeon_rewards', 'run_shards_cap')::int,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1)) || v_mine;
end $function$;

create or replace function public.gauntlet_view(p_player text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb; v_board jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  v_board := gauntlet_board(v_week, 100000);   -- read ONCE: the member's row and the top 3 both come from it
  select e into b from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', balance_num('gauntlet', 'budget')::int,
    -- OFFSET 0 (perf_five_slow_calls.sql): one dungeon_card_base per card; without it the subquery was pulled up and ran per reference.
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', balance_num('dungeon', 'cost', x.c->>'rarity')::int, 'cp', (x.c->'cmb'->>'cp')::int,
               'hp', case when x.c->>'type' in ('Character', 'Creature') then (x.c->'cmb'->>'hp')::int else card_max_hp(0) end,
               'slugs', x.c->'tags') order by x.o)
             from unnest(w.squad) with ordinality x0(id, o) cross join lateral (select x0.id, x0.o, dungeon_card_base(x0.id) c offset 0) x),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', 0, 'cards', '[]'::jsonb, 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', (b->>'rank')::int) end,
    'best', b,
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(w.floors->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(w.floors),
    'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet' and day between v_week and v_week + 6),
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $function$;

create or replace function public.ach_track_values(p_player text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare v jsonb := '{}'::jsonb; n bigint; dv jsonb := coalesce(shard_cfg()->'dupe_values', '{}'::jsonb);
begin
  -- Collection (draw-pool cards only: Event cards do not count)
  -- ach_has_element once per different subject (perf_five_slow_calls.sql): it depends only on the subject's tags.
  with o as materialized (
    select c.rarity, c.subject_id from player_cards pc join cards c on c.id = pc.card_id
     where pc.player_id = p_player and pc.quantity > 0 and c.in_draw_pool),
  e as materialized (select s.id, ach_has_element(s.tags) el from subjects s where s.id in (select o.subject_id from o))
  select jsonb_build_object(
           'collector', count(*),
           'shine', count(*) filter (where o.rarity in ('illustrated_rare', 'secret_rare', 'full_art', 'gold')),
           'elementalist', count(*) filter (where e.el))
    into v
    from o left join e on e.id = o.subject_id;
  select count(*) into n from (
    select c.subject_id from cards c left join player_cards pc on pc.card_id = c.id and pc.player_id = p_player and pc.quantity > 0
     where c.in_draw_pool group by c.subject_id having count(*) >= 2 and count(pc.card_id) = count(*)) x;
  v := v || jsonb_build_object('fullsets', n);
  -- The 3-argument stat_pt with balance stat_points.max_per_stat read once (perf_five_slow_calls.sql), not once per card and stat.
  v := v || (select jsonb_build_object(
      'ascension', coalesce(sum(pc.ascension), 0),
      'trainer', coalesce(sum(stat_pt(pc.stat_points, 'attack', m.mx) + stat_pt(pc.stat_points, 'vitality', m.mx) + stat_pt(pc.stat_points, 'precision', m.mx)
                              + stat_pt(pc.stat_points, 'potency', m.mx) + stat_pt(pc.stat_points, 'haste', m.mx)), 0))
    from player_cards pc cross join lateral (select (select balance_num('stat_points', 'max_per_stat')::int) mx) m
   where pc.player_id = p_player and pc.quantity > 0);
  -- Packs
  v := v || jsonb_build_object('packs', (select count(*) from pack_ledger where player_id = p_player and reason = 'opened'));
  v := v || jsonb_build_object('generous',
      (select coalesce(sum(-amount), 0) from pack_ledger where player_id = p_player and reason = 'gift_sent')
    + (select count(*) from gift_claims where from_id = p_player and kind = 'card' and reason = 'member_gift'));
  -- Market
  -- The trade ledger (offers + auctions), as tradesDone in server.js.
  v := v || jsonb_build_object('trader', (select count(*) from card_trades where from_id = p_player or to_id = p_player));
  v := v || jsonb_build_object('market',
      (select count(*) from trade_offers where status = 'accepted' and listing_id is not null and (from_id = p_player or to_id = p_player))
    + (select count(*) from auctions where status = 'sold' and seller_id = p_player)
    + (select count(*) from auction_bids where status = 'won' and bidder_id = p_player));
  v := v || jsonb_build_object('wish', (select count(*) from wish_grants where giver_id = p_player));
  -- Shards (earned: not admin or event gifts, not the Shop, not the achievement Shards themselves)
  v := v || jsonb_build_object('shards', (select coalesce(sum(amount), 0) from shard_ledger
      where player_id = p_player and amount > 0 and reason not in ('admin', 'event', 'milestone', 'shop')));
  v := v || jsonb_build_object('shopper', (select count(*) from shop_purchases where player_id = p_player));
  -- A 'dupes' row holds the Shards; the copies = Shards / the rarity's value per copy.
  v := v || jsonb_build_object('recycler', (select coalesce(sum(round(l.amount::numeric / nullif((dv->>c.rarity::text)::numeric, 0))), 0)
      from shard_ledger l join cards c on c.id::text = l.ref_id
     where l.player_id = p_player and l.reason = 'dupes' and l.ref_kind = 'card'));
  -- Dailies
  v := v || jsonb_build_object('grind',
      -- every claim except the plain chat daily (before pack_ledger_strict.sql: daily_claims + the chat bonus flags)
      (select count(*) from daily_claims where player_id = p_player and task <> 'chat'));
  v := v || jsonb_build_object('streak', (select coalesce(max(run_len), 0) from (
      select count(*) run_len from (select day, day - (row_number() over (order by day))::int g
                                from (select distinct day from daily_claims where player_id = p_player and task = 'checkin') d) x
       group by g) y));
  v := v || jsonb_build_object('voice', (select count(*) from (
      select day from daily_claims where player_id = p_player and task = 'voice'
      union select day from daily_claims where player_id = p_player and task = 'chat_bonus') d));
  -- Raid
  -- Joined = own committed cards (hunt_card_hp), as huntsJoined in server.js: a Raid Crasher credit
  -- row in hunt_hits is raid damage only (trade_ledger_raid_credit.sql). Damage stays on hunt_hits.
  v := v || (select jsonb_build_object('heavy', coalesce(sum(damage), 0), 'bighit', coalesce(max(damage), 0))
               from hunt_hits where player_id = p_player);
  v := v || jsonb_build_object('raider', (select count(distinct hunt_id) from hunt_card_hp where player_id = p_player));
  v := v || jsonb_build_object('slayer', (select count(*) from hunts h where h.status = 'defeated'
      and exists (select 1 from hunt_card_hp x where x.hunt_id = h.id and x.player_id = p_player)));
  -- The prize order of settle_hunt: total damage, then the first hit.
  v := v || jsonb_build_object('podium', (select count(*) from (
      select x.player_id, sum(x.damage) dmg, row_number() over (partition by x.hunt_id order by sum(x.damage) desc, min(x.id)) rk
        from hunt_hits x join hunts h on h.id = x.hunt_id and h.settled_at is not null
       group by x.hunt_id, x.player_id) r where r.player_id = p_player and r.rk <= 3 and r.dmg > 0));
  -- Social
  v := v || (select jsonb_build_object('prankster', count(*) filter (where kind = 'prank'), 'vibes', count(*) filter (where kind = 'boon'))
               from card_plays where player_id = p_player);
  return v;
end $function$;
