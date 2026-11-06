-- hunt_ach_damage_v2_undo.sql (2026-11-06): the undo of hunt_ach_damage_v2.sql. It puts back the origin/main text of
-- ach_track_values (no other function), drops the trigger ach_damage_sync and the functions ach_damage_rows and ach_damage_sync, and writes the v1 numbers back
-- into achievement_tracks (heavy, bighit) and achievement_switch_map (dmg1k, hit500). The balance row ach_damage_v2 stays (balance_check
-- refuses a delete); nothing reads it after the undo. The Activity must go back to the code before this PR first (it calls ach_damage_rows).
-- The undo leaves balance_v2_spec as it is (this file never changed it).

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.ach_track_values(text)', '14927afaf886b134383f4c72ec987925', '626bcac9dd629e817d22ea5642de274c')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'hunt_ach_damage_v2_undo.sql: the live % changed since this file was built. Write a new undo from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

create or replace function public.ach_track_values(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $fn$
declare v jsonb := '{}'::jsonb; n bigint; dv jsonb := coalesce(shard_cfg()->'dupe_values', '{}'::jsonb);
begin
  -- Collection (draw-pool cards only: Event cards do not count)
  -- ach_has_element once per different subject (perf_five_slow_calls.sql): it depends only on the subject's tags.
  with o as materialized (
    select c.rarity, c.subject_id from player_cards pc join cards c on c.id = pc.card_id
     where pc.player_id = p_player and pc.quantity > 0 and c.id in (select id from draw_pool)),
  e as materialized (select s.id, ach_has_element(s.tags) el from subjects s where s.id in (select o.subject_id from o))
  select jsonb_build_object(
           'collector', count(*),
           'shine', count(*) filter (where o.rarity in ('illustrated_rare', 'secret_rare', 'full_art', 'gold')),
           'elementalist', count(*) filter (where e.el))
    into v
    from o left join e on e.id = o.subject_id;
  select count(*) into n from (
    select c.subject_id from cards c left join player_cards pc on pc.card_id = c.id and pc.player_id = p_player and pc.quantity > 0
     where c.id in (select id from draw_pool) group by c.subject_id having count(*) >= 2 and count(pc.card_id) = count(*)) x;
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
end $fn$;

drop trigger if exists ach_damage_sync on public.balance;
drop function if exists public.ach_damage_sync();
drop function if exists public.ach_damage_copy(jsonb);
drop function if exists public.ach_damage_rows(text);
update public.achievement_tracks set tiers = '{2500,10000,40000,100000,250000}', step = 100000 where key = 'heavy';
update public.achievement_tracks set tiers = '{400,900,1600,2600,4000}' where key = 'bighit';
update public.achievement_switch_map set proves = 1000 where old_key = 'dmg1k';
update public.achievement_switch_map set proves = 500 where old_key = 'hit500';

notify pgrst, 'reload schema';
