-- admin_read.sql: the READ ONLY data layer of the Admin view (Phase 1, Nathan 2026-10-07: "a full Admin view of
-- everything in the database: metrics, stats, ratios, any analytics, any report, any player and their history").
--
-- Every function here:
--   * only reads (no insert, update or delete); the aggregates are made IN SQL and each answer is one small jsonb;
--   * returns member data, so only the service role may call it (revoke from public, anon, authenticated at the end);
--   * has set search_path = public and a COMMENT that names the source table of each number.
-- The card studio calls them through /api/admin/* (card-studio/src/admin-routes.js).
-- The test: card-studio/scripts/test-admin-read.mjs (rolled back, fake members, a private Hunt).
-- Idempotent: create or replace only. Safe to run again.
--
-- THE "ACTIVE MEMBER" RULE (one place: admin_active_days). A member is ACTIVE on a game day (America/Denver) when the
-- member did at least one game action on that day that a ledger or a log records with its time:
--   a pack open or a pack gift sent (pack_ledger opened / gift_sent), a card gift sent, an Ascension or a convert
--   (card_ledger gift_sent / ascend / convert), a gift claimed in the bell (gift_claims.claimed_at), a Hunt attack
--   (hunt_combat_log), a support play (combat_actions mode hunt, kind support), a squad lock (hunt_squads), a Dungeon or Gauntlet
--   run (dungeon_runs), an effect played (card_plays), a trade action (trade_offers made / countered / answered,
--   trade_listings), an auction or a bid (auctions, auction_bids), a Shop purchase (shop_purchases), an achievement
--   claim (achievement_claims), a report (player_reports), a daily claimed in the Activity (daily_claims, not the
--   two chat tasks that the bot claims by itself).
-- Discord chat (daily_activity) and voice (voice_minutes) are NOT game actions: they count as "discord" activity,
-- shown on their own. The evidence (local copy of live, 2026-10-07, last 7 days): 35 members with a game action,
-- 31 with chat or voice, 3 with chat or voice only, 7 with a game action only.
-- A visit that only looks (app_sessions, page_views: logs_app.sql, 2026-10-07) is not a game action either: admin_member and the
-- timeline show the visits; the active rule stays the same.

-- ============================================================ the activity rule
create or replace function public.admin_active_days(p_from date, p_to date)
returns table(player_id text, day date, source text, game boolean)
language sql stable security invoker set search_path = public as $$
  with b as (select game_day_start(p_from) as t0, game_day_start(p_to + 1) as t1),
  ev(player_id, at, source) as (
    select l.player_id, l.created_at, case l.reason when 'opened' then 'pack_open' else 'gift_send' end
      from pack_ledger l, b where l.reason in ('opened', 'gift_sent') and l.created_at >= b.t0 and l.created_at < b.t1
    union all
    select c.player_id, c.created_at, case c.reason when 'gift_sent' then 'gift_send' else c.reason end
      from card_ledger c, b where c.reason in ('ascend', 'convert', 'gift_sent') and c.created_at >= b.t0 and c.created_at < b.t1
    union all
    select g.player_id, g.claimed_at, 'gift_claim' from gift_claims g, b where g.claimed_at >= b.t0 and g.claimed_at < b.t1
    union all
    select h.player_id, h.ts, 'hunt' from hunt_combat_log h, b where h.ts >= b.t0 and h.ts < b.t1
    union all
    select a.player_id, a.created_at, 'hunt' from combat_actions a, b where a.mode = 'hunt' and a.kind = 'support' and a.created_at >= b.t0 and a.created_at < b.t1
    union all
    select s.player_id, s.locked_at, 'hunt' from hunt_squads s, b where s.locked_at >= b.t0 and s.locked_at < b.t1
    union all
    select r.player_id, r.started_at, case r.mode when 'gauntlet' then 'gauntlet' else 'dungeon' end
      from dungeon_runs r, b where r.started_at >= b.t0 and r.started_at < b.t1
    union all
    select p.player_id, p.created_at, 'effect' from card_plays p, b where p.created_at >= b.t0 and p.created_at < b.t1
    union all
    select o.from_id, o.created_at, 'trade' from trade_offers o, b where o.created_at >= b.t0 and o.created_at < b.t1
    union all
    select o.to_id, o.countered_at, 'trade' from trade_offers o, b where o.countered_at >= b.t0 and o.countered_at < b.t1
    union all   -- the answer: after a counter (or a cancel) the maker acts, else the receiver
    select case when o.status = 'cancelled' or o.countered_at is not null then o.from_id else o.to_id end, o.resolved_at, 'trade'
      from trade_offers o, b where o.status in ('accepted', 'declined', 'cancelled') and o.resolved_at >= b.t0 and o.resolved_at < b.t1
    union all
    select t.player_id, t.created_at, 'trade' from trade_listings t, b where t.created_at >= b.t0 and t.created_at < b.t1
    union all
    select u.seller_id, u.created_at, 'auction' from auctions u, b where u.created_at >= b.t0 and u.created_at < b.t1
    union all
    select d.bidder_id, d.created_at, 'auction' from auction_bids d, b where d.created_at >= b.t0 and d.created_at < b.t1
    union all
    select s.player_id, s.created_at, 'shop' from shop_purchases s, b where s.created_at >= b.t0 and s.created_at < b.t1
    union all
    select a.player_id, a.claimed_at, 'achievement' from achievement_claims a, b where a.claimed_at >= b.t0 and a.claimed_at < b.t1
    union all
    select r.player_id, r.created_at, 'report' from player_reports r, b where r.created_at >= b.t0 and r.created_at < b.t1
    union all
    select d.player_id, game_day_start(d.day), 'daily' from daily_claims d
     where d.task not in ('chat', 'chat_bonus') and d.day between p_from and p_to
  )
  select distinct e.player_id, game_day(e.at), e.source, true from ev e
  union
  select d.player_id, d.activity_date, 'chat', false from daily_activity d
   where d.message_count > 0 and d.activity_date between p_from and p_to
  union
  select v.player_id, v.day, 'voice', false from voice_minutes v where v.minutes > 0 and v.day between p_from and p_to;
$$;

comment on function public.admin_active_days(date, date) is
$c$[admin] The one "active member" rule of the Admin view: one row per (member, game day, source) in the period. game = true for a game action that a ledger or a log records with its time: pack_open and gift_send (pack_ledger opened / gift_sent; card_ledger gift_sent), ascend and convert (card_ledger), gift_claim (gift_claims.claimed_at), hunt (hunt_combat_log, combat_actions mode hunt, kind support, hunt_squads), dungeon and gauntlet (dungeon_runs.started_at), effect (card_plays), trade (trade_offers made, countered or answered; trade_listings), auction (auctions, auction_bids), shop (shop_purchases), achievement (achievement_claims), report (player_reports), daily (daily_claims, not chat and chat_bonus). game = false: chat (daily_activity.message_count > 0) and voice (voice_minutes). A member is active on a day with a game row. Service role only.$c$;

-- ============================================================ shared small helpers
create or replace function public.admin_period(p_from date, p_to date, p_default_days integer default 7)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_to date := coalesce(p_to, game_day()); v_from date := coalesce(p_from, coalesce(p_to, game_day()) - (p_default_days - 1));
begin
  if v_from > v_to then raise exception 'admin: p_from (%) is after p_to (%)', v_from, v_to; end if;
  if v_to - v_from > 731 then raise exception 'admin: the period is longer than 2 years (% days)', v_to - v_from + 1; end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'days', v_to - v_from + 1, 't0', game_day_start(v_from), 't1', game_day_start(v_to + 1));
end $$;

comment on function public.admin_period(date, date, integer) is
$c$[admin] The period rule of the Admin view functions: null p_to = today (game_day()), null p_from = p_default_days days that end on p_to. Refuses p_from after p_to and a period longer than 2 years. Returns from, to, days and the time bounds t0 (game_day_start(from)) and t1 (game_day_start(to + 1)). Service role only.$c$;

-- THE PULL SOURCE (one place: admin_pulls_since). Each pulled card with its rarity and time is only in card_ledger reason
-- 'pack' (open_packs -> add_cards_to_player -> card_move). The card ledger started with card_ledger.sql (2026-10-07 03:40 UTC);
-- before it, open_packs did not store the card ids: pack_ledger 'opened' rows give the packs and the time but no card, the
-- card_ledger opening_balance rows give the copies held per member (pulls, trades, gifts and prizes together), and
-- player_cards.first_obtained_at (the Activity pull feed) gives only the first copy of each card. So no source gives each pull
-- before the ledger, and the pull numbers say the time they start from (since).
create or replace function public.admin_pulls_since()
returns timestamptz language sql stable security invoker set search_path = public as $$
  select min(applied_at) from schema_migrations where file = 'card_ledger.sql';
$$;

comment on function public.admin_pulls_since() is
$c$[admin] The time from which card_ledger reason pack holds every pulled card: the first schema_migrations row of card_ledger.sql (null when that file is not applied). Before it no table holds each pulled card (open_packs did not store the card ids). Service role only.$c$;

-- ============================================================ 1. overview
create or replace function public.admin_overview(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  pr jsonb := admin_period(p_from, p_to, 7);
  d0 date := (pr->>'from')::date; d1 date := (pr->>'to')::date;
  t0 timestamptz := (pr->>'t0')::timestamptz; t1 timestamptz := (pr->>'t1')::timestamptz;
  rates jsonb := coalesce(balance_get('pulls')->'rates', '{}'::jsonb);
  v_members jsonb; v_packs jsonb; v_shards jsonb; v_cards jsonb; v_pulls jsonb; v_trade jsonb; v_auction jsonb; v_gifts jsonb;
  v_hunt jsonb; v_dungeon jsonb; v_effects jsonb; v_reports jsonb; n_pulled bigint;
  v_since timestamptz := admin_pulls_since();
begin
  -- members (players, admin_active_days)
  with act as (select * from admin_active_days(d0, d1)),
  g as (select distinct a.player_id, a.day from act a where a.game),
  dd as (select distinct a.player_id, a.day from act a where not a.game),
  days as (select x::date as day from generate_series(d0, d1, interval '1 day') x),
  per_day as (
    select dy.day,
           (select count(*) from g where g.day = dy.day) as active,
           (select count(*) from dd where dd.day = dy.day and not exists (select 1 from g where g.player_id = dd.player_id and g.day = dy.day)) as discord_only,
           (select count(*) from players p where game_day(p.created_at) = dy.day) as new
      from days dy),
  per_week as (select date_trunc('week', g.day)::date as week, count(distinct g.player_id) as active from g group by 1)
  select jsonb_build_object(
    'total', (select count(*) from players p where p.created_at < t1),
    'new', (select count(*) from players p where p.created_at >= t0 and p.created_at < t1),
    'active', (select count(distinct player_id) from g),
    'discord_only', (select count(distinct dd.player_id) from dd where not exists (select 1 from g where g.player_id = dd.player_id)),
    'avg_daily_active', (select round(avg(active), 2) from per_day),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'active', active, 'discord_only', discord_only, 'new', new) order by day), '[]') from per_day),
    'by_week', (select coalesce(jsonb_agg(jsonb_build_object('week', week, 'active', active) order by week), '[]') from per_week))
  into v_members;

  -- packs (pack_ledger, players.pack_balance, gift_claims)
  select jsonb_build_object(
    'by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'rows', n, 'packs', s) order by reason)
        from (select l.reason, count(*) n, sum(l.amount) s from pack_ledger l where l.created_at >= t0 and l.created_at < t1 group by 1) x), '[]'),
    'earned', (select coalesce(sum(l.amount), 0) from pack_ledger l where l.created_at >= t0 and l.created_at < t1 and l.amount > 0 and l.reason <> 'gift_received'),
    'opened', (select coalesce(-sum(l.amount), 0) from pack_ledger l where l.created_at >= t0 and l.created_at < t1 and l.reason = 'opened'),
    'gifted_between_members', (select coalesce(-sum(l.amount), 0) from pack_ledger l where l.created_at >= t0 and l.created_at < t1 and l.reason = 'gift_sent'),
    'held_at_end', (select coalesce(sum(l.amount), 0) from pack_ledger l where l.created_at < t1),
    'held_now', (select coalesce(sum(p.pack_balance), 0) from players p),
    'waiting_in_bell_now', (select coalesce(sum(g.amount), 0) from gift_claims g where g.claimed_at is null and g.kind <> 'card'))
  into v_packs;
  v_packs := v_packs || jsonb_build_object('open_earn_ratio', case when (v_packs->>'earned')::numeric > 0 then round((v_packs->>'opened')::numeric / (v_packs->>'earned')::numeric, 4) end);

  -- Shards (shard_ledger, players.shard_balance, gift_claims.shards)
  select jsonb_build_object(
    'earned_by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'rows', n, 'shards', s) order by reason)
        from (select l.reason, count(*) n, sum(l.amount) s from shard_ledger l where l.created_at >= t0 and l.created_at < t1 and l.amount > 0 group by 1) x), '[]'),
    'spent_by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'rows', n, 'shards', s) order by reason)
        from (select l.reason, count(*) n, -sum(l.amount) s from shard_ledger l where l.created_at >= t0 and l.created_at < t1 and l.amount < 0 group by 1) x), '[]'),
    'earned', (select coalesce(sum(l.amount), 0) from shard_ledger l where l.created_at >= t0 and l.created_at < t1 and l.amount > 0),
    'spent', (select coalesce(-sum(l.amount), 0) from shard_ledger l where l.created_at >= t0 and l.created_at < t1 and l.amount < 0),
    'held_at_end', (select coalesce(sum(l.amount), 0) from shard_ledger l where l.created_at < t1),
    'held_now', (select coalesce(sum(p.shard_balance), 0) from players p),
    'waiting_in_bell_now', (select coalesce(sum(g.shards), 0) from gift_claims g where g.claimed_at is null))
  into v_shards;
  v_shards := v_shards || jsonb_build_object('spend_earn_ratio', case when (v_shards->>'earned')::numeric > 0 then round((v_shards->>'spent')::numeric / (v_shards->>'earned')::numeric, 4) end);

  -- cards in and out (card_ledger)
  select jsonb_build_object(
    'in_by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'copies', s) order by reason)
        from (select c.reason, sum(c.amount) s from card_ledger c where c.created_at >= t0 and c.created_at < t1 and c.amount > 0 group by 1) x), '[]'),
    'out_by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'copies', s) order by reason)
        from (select c.reason, -sum(c.amount) s from card_ledger c where c.created_at >= t0 and c.created_at < t1 and c.amount < 0 group by 1) x), '[]'),
    'copies_held_at_end', (select coalesce(sum(c.amount), 0) from card_ledger c where c.created_at < t1))
  into v_cards;

  -- pulls by rarity vs the set rates (card_ledger reason pack, balance pulls.rates); since = the ledger start when it cuts the period,
  -- packs_opened = the pack_ledger opens from that time (the same window as the pulls: packs_opened x pack_size = cards_pulled)
  select coalesce(sum(c.amount), 0) into n_pulled from card_ledger c where c.reason = 'pack' and c.amount > 0 and c.created_at >= t0 and c.created_at < t1;
  with r as (select key as rarity, value::numeric as rate from jsonb_each_text(rates)),
  a as (select k.rarity::text as rarity, sum(c.amount) n from card_ledger c join cards k on k.id = c.card_id
         where c.reason = 'pack' and c.amount > 0 and c.created_at >= t0 and c.created_at < t1 group by 1),
  m as (select coalesce(r.rarity, a.rarity) rarity, coalesce(a.n, 0) actual, r.rate from r full join a on a.rarity = r.rarity)
  select jsonb_build_object('cards_pulled', n_pulled, 'pack_size', balance_get('pulls')->'pack_size',
    'since', case when v_since > t0 then v_since end,
    'packs_opened', (select coalesce(-sum(l.amount), 0) from pack_ledger l
                      where l.reason = 'opened' and l.created_at >= greatest(t0, v_since) and l.created_at < t1),
    'by_rarity', coalesce(jsonb_agg(jsonb_build_object('rarity', m.rarity, 'rate', m.rate, 'actual', m.actual,
        'expected', round(n_pulled * coalesce(m.rate, 0), 2),
        'ratio', case when n_pulled * coalesce(m.rate, 0) > 0 then round(m.actual / (n_pulled * m.rate), 3) end,
        'z', case when n_pulled > 0 and m.rate > 0 and m.rate < 1 then round((m.actual - n_pulled * m.rate) / sqrt(n_pulled * m.rate * (1 - m.rate)), 2) end)
      order by m.rate desc nulls last, m.rarity), '[]'))
  into v_pulls from m;

  -- trades (trade_offers, card_trades, trade_listings)
  select jsonb_build_object(
    'offers_made', (select count(*) from trade_offers o where o.created_at >= t0 and o.created_at < t1),
    'accepted', (select count(*) from trade_offers o where o.status = 'accepted' and o.resolved_at >= t0 and o.resolved_at < t1),
    'declined', (select count(*) from trade_offers o where o.status = 'declined' and o.resolved_at >= t0 and o.resolved_at < t1),
    'cancelled', (select count(*) from trade_offers o where o.status = 'cancelled' and o.resolved_at >= t0 and o.resolved_at < t1),
    'swaps', (select count(*) from card_trades t where t.created_at >= t0 and t.created_at < t1),
    'traders', (select count(distinct x) from card_trades t, unnest(array[t.from_id, t.to_id]) x where t.created_at >= t0 and t.created_at < t1),
    'listings', (select count(*) from trade_listings l where l.created_at >= t0 and l.created_at < t1))
  into v_trade;

  -- auctions (auctions, auction_bids)
  select jsonb_build_object(
    'started', (select count(*) from auctions a where a.created_at >= t0 and a.created_at < t1),
    'sold', (select count(*) from auctions a where a.status = 'sold' and a.settled_at >= t0 and a.settled_at < t1),
    'expired', (select count(*) from auctions a where a.status = 'expired' and a.settled_at >= t0 and a.settled_at < t1),
    'closed', (select count(*) from auctions a where a.status = 'closed' and a.settled_at >= t0 and a.settled_at < t1),
    'bids', (select count(*) from auction_bids b where b.created_at >= t0 and b.created_at < t1))
  into v_auction;

  -- gifts (gift_claims)
  select jsonb_build_object(
    'made_by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'made', n, 'packs', p, 'shards', s) order by k)
        from (select case when g.kind like 'once_%' then 'once' else g.kind end k, count(*) n, sum(g.amount) filter (where g.kind <> 'card') p, sum(g.shards) s
                from gift_claims g where g.created_at >= t0 and g.created_at < t1 group by 1) x), '[]'),
    'claimed', (select count(*) from gift_claims g where g.claimed_at >= t0 and g.claimed_at < t1),
    'member_to_member', (select count(*) from gift_claims g where g.from_id is not null and g.created_at >= t0 and g.created_at < t1))
  into v_gifts;

  -- Hunt (hunts, hunt_hits, hunt_combat_log, combat_actions, pack_ledger hunt_reward)
  select jsonb_build_object(
    'hunts', (select count(*) from hunts h where h.opens_at < t1 and h.closes_at >= t0),
    'fighters', (select count(distinct x.player_id) from (select player_id from hunt_combat_log where ts >= t0 and ts < t1
                   union select player_id from combat_actions where mode = 'hunt' and kind = 'support' and created_at >= t0 and created_at < t1) x),
    'attacks', (select count(*) from hunt_combat_log l where l.ts >= t0 and l.ts < t1),
    'supports', (select count(*) from combat_actions a where a.mode = 'hunt' and a.kind = 'support' and a.created_at >= t0 and a.created_at < t1),
    'damage', (select coalesce(sum(h.damage), 0) from hunt_hits h where h.hit_date between d0 and d1),
    'prize_packs', (select coalesce(sum(l.amount), 0) from pack_ledger l where l.reason = 'hunt_reward' and l.created_at >= t0 and l.created_at < t1))
  into v_hunt;

  -- Dungeon and Gauntlet (dungeon_runs)
  select jsonb_build_object('by_mode', coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'runs', n, 'players', p, 'shards', s, 'cleared', c, 'fell', f, 'retreat', r) order by mode), '[]'))
    into v_dungeon
    from (select r.mode, count(*) n, count(distinct r.player_id) p, sum(r.shards) s, count(*) filter (where r.ended_by = 'cleared') c,
                 count(*) filter (where r.ended_by = 'fell') f, count(*) filter (where r.ended_by = 'retreat') r
            from dungeon_runs r where r.started_at >= t0 and r.started_at < t1 group by 1) x;

  -- effects (card_plays)
  select jsonb_build_object('by_kind', coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'plays', n, 'senders', s, 'targets', t, 'applied', a, 'blocked', b, 'refunded', rf) order by kind), '[]'))
    into v_effects
    from (select p.kind, count(*) n, count(distinct p.player_id) s, count(distinct p.target_id) t, count(*) filter (where p.outcome = 'applied') a,
                 count(*) filter (where p.outcome = 'blocked') b, count(*) filter (where p.outcome = 'refunded') rf
            from card_plays p where p.created_at >= t0 and p.created_at < t1 group by 1) x;

  -- reports (player_reports)
  select jsonb_build_object('by_kind', coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'reports', n) order by kind), '[]'),
                            'waiting_sync_now', (select count(*) from player_reports r where r.synced_at is null))
    into v_reports
    from (select r.kind, count(*) n from player_reports r where r.created_at >= t0 and r.created_at < t1 group by 1) x;

  return jsonb_build_object('period', pr - 't0' - 't1', 'members', v_members, 'packs', v_packs, 'shards', v_shards, 'cards', v_cards,
    'pulls', v_pulls, 'trades', v_trade, 'auctions', v_auction, 'gifts', v_gifts, 'hunt', v_hunt, 'dungeon', v_dungeon,
    'effects', v_effects, 'reports', v_reports);
end $$;

comment on function public.admin_overview(date, date) is
$c$[admin] The Admin view home: the numbers of one period (default the last 7 game days). members: total and new (players.created_at), active and by_day / by_week (admin_active_days, game rows), discord_only (chat or voice with no game action). packs: by_reason, earned (+ rows, not gift_received), opened, gifted_between_members, held_at_end (pack_ledger), held_now (players.pack_balance), waiting_in_bell_now (gift_claims unclaimed). shards: earned and spent by reason, held (shard_ledger, players.shard_balance), waiting_in_bell_now (gift_claims.shards). cards: copies in and out by reason (card_ledger). pulls: cards pulled from packs by rarity (card_ledger reason pack, the only source of each pull) against balance pulls.rates: expected, ratio and z (a small sample shows in cards_pulled); since = admin_pulls_since() when it is after the period start (the pulls before it are not in any table), else null; packs_opened = pack_ledger opened from since (or the period start) to the period end. trades (trade_offers, card_trades, trade_listings), auctions (auctions, auction_bids), gifts (gift_claims), hunt (hunts, hunt_combat_log, combat_actions, hunt_hits, pack_ledger hunt_reward), dungeon (dungeon_runs), effects (card_plays), reports (player_reports). Service role only.$c$;

-- ============================================================ 2. economy time series
create or replace function public.admin_economy(p_from date default null, p_to date default null, p_bucket text default 'day')
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  pr jsonb := admin_period(p_from, p_to, 30);
  d0 date := (pr->>'from')::date; d1 date := (pr->>'to')::date;
  t0 timestamptz := (pr->>'t0')::timestamptz; t1 timestamptz := (pr->>'t1')::timestamptz;
  v jsonb;
begin
  if p_bucket not in ('day', 'week') then raise exception 'admin_economy: p_bucket must be day or week, not %', p_bucket; end if;
  with
  rows_all as (
    select 'pack' as ledger, l.created_at, l.reason, l.amount from pack_ledger l where l.created_at >= t0 and l.created_at < t1
    union all select 'card', c.created_at, c.reason, c.amount from card_ledger c where c.created_at >= t0 and c.created_at < t1
    union all select 'shard', s.created_at, s.reason, s.amount from shard_ledger s where s.created_at >= t0 and s.created_at < t1),
  bk as (select ledger, case when p_bucket = 'week' then date_trunc('week', game_day(created_at))::date else game_day(created_at) end as t, reason, amount from rows_all),
  buckets as (select distinct case when p_bucket = 'week' then date_trunc('week', x)::date else x::date end as t
                from generate_series(d0, d1, interval '1 day') x),
  by_reason as (select ledger, t, reason, count(*) n, coalesce(sum(amount) filter (where amount > 0), 0) i, coalesce(-sum(amount) filter (where amount < 0), 0) o
                  from bk group by 1, 2, 3),
  net as (select b.t, l.ledger,
                 coalesce((select sum(amount) from bk where bk.ledger = l.ledger and bk.t = b.t), 0) as net,
                 coalesce((select sum(amount) from bk where bk.ledger = l.ledger and bk.t = b.t and amount > 0 and reason not in ('gift_received')), 0) as earned,
                 coalesce((select -sum(amount) from bk where bk.ledger = l.ledger and bk.t = b.t and amount < 0 and reason not in ('gift_sent')), 0) as used
            from buckets b cross join (values ('pack'), ('card'), ('shard')) l(ledger)),
  base as (select (select coalesce(sum(amount), 0) from pack_ledger where created_at < t0) as pack,
                  (select coalesce(sum(amount), 0) from card_ledger where created_at < t0) as card,
                  (select coalesce(sum(amount), 0) from shard_ledger where created_at < t0) as shard)
  select jsonb_build_object(
    'period', pr - 't0' - 't1', 'bucket', p_bucket,
    'series', jsonb_build_object(
      'pack', (select coalesce(jsonb_agg(jsonb_build_object('t', t, 'reason', reason, 'rows', n, 'in', i, 'out', o) order by t, reason), '[]') from by_reason where ledger = 'pack'),
      'card', (select coalesce(jsonb_agg(jsonb_build_object('t', t, 'reason', reason, 'rows', n, 'in', i, 'out', o) order by t, reason), '[]') from by_reason where ledger = 'card'),
      'shard', (select coalesce(jsonb_agg(jsonb_build_object('t', t, 'reason', reason, 'rows', n, 'in', i, 'out', o) order by t, reason), '[]') from by_reason where ledger = 'shard')),
    'supply', (select coalesce(jsonb_agg(jsonb_build_object('t', s.t, 'packs_held', s.packs, 'copies_held', s.copies, 'shards_held', s.shards) order by s.t), '[]')
                 from (select n.t,
                              (select pack from base) + (select coalesce(sum(n2.net), 0) from net n2 where n2.ledger = 'pack' and n2.t <= n.t) as packs,
                              (select card from base) + (select coalesce(sum(n2.net), 0) from net n2 where n2.ledger = 'card' and n2.t <= n.t) as copies,
                              (select shard from base) + (select coalesce(sum(n2.net), 0) from net n2 where n2.ledger = 'shard' and n2.t <= n.t) as shards
                         from (select distinct t from net) n) s),
    'ratios', (select coalesce(jsonb_agg(jsonb_build_object('t', p.t,
                   'packs_earned', p.earned, 'packs_opened', p.used, 'open_earn', case when p.earned > 0 then round(p.used::numeric / p.earned, 4) end,
                   'shards_earned', s.earned, 'shards_spent', s.used, 'spend_earn', case when s.earned > 0 then round(s.used::numeric / s.earned, 4) end) order by p.t), '[]')
                 from net p join net s on s.t = p.t and s.ledger = 'shard' where p.ledger = 'pack'))
  into v;
  return v;
end $$;

comment on function public.admin_economy(date, date, text) is
$c$[admin] The economy over time (default the last 30 game days), in day or week buckets (a week starts on Monday). series: for each ledger (pack_ledger, card_ledger, shard_ledger), each bucket and reason: rows, in (the + amounts) and out (the - amounts). supply: the packs, copies and Shards that all members hold at the end of each bucket (the ledger sum up to then; the ledgers are complete: *_ledger_reconcile). ratios per bucket: packs opened / packs earned (+ rows, not gift_received; - rows, not gift_sent) and Shards spent / Shards earned. Service role only.$c$;

-- ============================================================ 3. member list
create or replace function public.admin_members(p_search text default null, p_sort text default 'last_active', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_sort text := coalesce(nullif(p_sort, ''), 'last_active');
  v_key text := regexp_replace(v_sort, '_asc$', '');
  v_asc boolean := v_sort like '%\_asc';
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_like text := '%' || replace(replace(replace(coalesce(p_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_first date := coalesce((select game_day(min(created_at)) from players), game_day());
  v jsonb;
begin
  if v_key not in ('joined', 'last_active', 'power', 'packs', 'shards', 'cards', 'hunts', 'name', 'active_days_30') then
    raise exception 'admin_members: unknown sort % (joined, last_active, power, packs, shards, cards, hunts, name, active_days_30; add _asc)', p_sort;
  end if;
  with m as (
    select p.* from players p
     where p_search is null or p_search = '' or p.id ilike v_like or p.username ilike v_like),
  act as (select a.player_id, max(a.day) last_active, count(distinct a.day) filter (where a.day > game_day() - 30) d30
            from admin_active_days(v_first, game_day()) a where a.game and a.player_id in (select id from m) group by 1),
  pc as (select player_id, sum(quantity) copies, count(*) uniq from player_cards where player_id in (select id from m) group by 1),
  pw as (select * from collection_power_all()),
  hu as (select player_id, count(distinct hunt_id) hunts, sum(damage) dmg from hunt_hits where player_id in (select id from m) group by 1),
  imm as (select jsonb_array_elements_text(case when jsonb_typeof(value) = 'array' then value else '[]' end) id from settings where key = 'discord_immune'),
  r as (
    select m.id, m.username, m.created_at, game_day(m.created_at) joined, act.last_active, coalesce(act.d30, 0) d30,
           m.pack_balance, m.shard_balance, coalesce(pc.copies, 0) copies, coalesce(pc.uniq, 0) uniq, coalesce(pw.power, 0) power,
           coalesce(hu.hunts, 0) hunts, coalesce(hu.dmg, 0) dmg, coalesce(m.notify_prefs->>'all' = 'false', false) muted,
           exists (select 1 from imm where imm.id = m.id) immune, m.title,
           (m.tutorial->>'skipped')::boolean is true tutorial_skipped, jsonb_array_length(case when jsonb_typeof(m.tutorial->'done') = 'array' then m.tutorial->'done' else '[]' end) tutorial_steps
      from m left join act on act.player_id = m.id left join pc on pc.player_id = m.id left join pw on pw.player_id = m.id left join hu on hu.player_id = m.id),
  s as (
    select r.*, case v_key
             when 'joined' then extract(epoch from r.created_at)
             when 'last_active' then r.last_active - date '2000-01-01'
             when 'power' then r.power when 'packs' then r.pack_balance when 'shards' then r.shard_balance
             when 'cards' then r.copies when 'hunts' then r.hunts when 'active_days_30' then r.d30 end as k
      from r),
  o as (
    select s.*, row_number() over (order by
             case when v_key = 'name' and not v_asc then lower(s.username) end desc,
             case when v_key = 'name' and v_asc then lower(s.username) end asc,
             case when not v_asc then s.k end desc nulls last,
             case when v_asc then s.k end asc nulls last,
             s.id) as rn
      from s)
  select jsonb_build_object('total', (select count(*) from o), 'limit', v_lim, 'offset', v_off, 'sort', v_sort,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'username', o.username, 'joined', o.joined, 'last_active', o.last_active,
        'active_days_30', o.d30, 'packs', o.pack_balance, 'shards', o.shard_balance, 'copies', o.copies, 'unique_cards', o.uniq, 'power', o.power,
        'hunts', o.hunts, 'hunt_damage', o.dmg, 'muted', o.muted, 'discord_immune', o.immune, 'title', o.title,
        'tutorial_steps', o.tutorial_steps, 'tutorial_skipped', o.tutorial_skipped) order by o.rn)
      from o where o.rn > v_off and o.rn <= v_off + v_lim), '[]'))
  into v;
  return v;
end $$;

comment on function public.admin_members(text, text, integer, integer) is
$c$[admin] The member list, one page (default 50, max 200; offset paging, the order ends on the member id so a page is stable). p_search: a part of the member id or of the name (case does not matter). p_sort: joined, last_active, power, packs, shards, cards, hunts, name, active_days_30 (descending; add _asc). Each row: joined (players.created_at as a game day), last_active and active_days_30 (admin_active_days), packs and shards (players balances), copies and unique_cards (player_cards), power (collection_power_all), hunts and hunt_damage (hunt_hits), muted (players.notify_prefs all = false), discord_immune (settings discord_immune), title, tutorial steps (players.tutorial). Service role only.$c$;

-- ============================================================ 4. one member
create or replace function public.admin_member(p_player text)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare p players; v_first date; v_out jsonb; v_pw bigint; v_rank bigint; v_of bigint;
begin
  select * into p from players where id = p_player;
  if not found then return jsonb_build_object('found', false, 'player', p_player); end if;
  v_first := game_day(p.created_at);
  -- The power rank: 1 + the members with more power (collection_power_all, the leaderboard numbers); null with no power.
  select coalesce(max(w.power) filter (where w.player_id = p_player), 0), count(*) filter (where w.power > 0) into v_pw, v_of from collection_power_all() w;
  if v_pw > 0 then select 1 + count(*) into v_rank from collection_power_all() w where w.power > v_pw; end if;
  with act as (select * from admin_active_days(v_first, game_day()) a where a.player_id = p_player)
  select jsonb_build_object(
    'found', true,
    'profile', jsonb_build_object('id', p.id, 'username', p.username, 'joined', p.created_at, 'has_avatar', p.avatar is not null, 'title', p.title, 'frame', p.frame,
        'spotlight', p.spotlight, 'notify_prefs', p.notify_prefs, 'muted', coalesce(p.notify_prefs->>'all' = 'false', false), 'tutorial', p.tutorial,
        'first_pack_ping_at', p.first_pack_ping_at, 'stat_reset_week', p.stat_reset_week,
        'discord_immune', exists (select 1 from settings s where s.key = 'discord_immune' and jsonb_typeof(s.value) = 'array' and s.value ? p.id),
        -- The Discord CDN picture, the same URL as the Activity server (/api/avatar: a 32-hex hash, a_ for an animated one).
        'avatar_url', case when p.avatar ~ '^(a_)?[0-9a-f]{32}$' then 'https://cdn.discordapp.com/avatars/' || p.id || '/' || p.avatar || '.png?size=128' end,
        'guild_joined_at', p.guild_joined_at, 'left_guild_at', p.left_guild_at,
        'in_guild', case when p.guild_joined_at is null and p.left_guild_at is null then null else p.left_guild_at is null or p.left_guild_at < p.guild_joined_at end),
    'app', jsonb_build_object(
        'visits', (select count(*) from app_sessions where player_id = p_player),
        'last_visit', (select max(last_seen_at) from app_sessions where player_id = p_player),
        'views', (select count(*) from page_views where player_id = p_player),
        'views_by_screen', (select coalesce(jsonb_object_agg(view, n), '{}') from (select view, count(*) n from page_views where player_id = p_player group by 1) x),
        'tutorial_steps', (select count(*) from tutorial_steps where player_id = p_player),
        'notes', (select count(*) from notifications where player_id = p_player),
        'notes_unread', (select count(*) from notifications where player_id = p_player and not read),
        'profile_changes', (select count(*) from profile_log where player_id = p_player and field not like 'tutorial%'),
        'wishlist_changes', (select count(*) from wishlist_log where player_id = p_player),
        'admin_actions', (select count(*) from admin_actions where target_id = p_player and coalesce(target_kind, 'player') in ('player', 'member'))),
    'activity', jsonb_build_object(
        'first_active', (select min(day) from act where game), 'last_active', (select max(day) from act where game),
        'active_days', (select count(distinct day) from act where game),
        'active_days_7', (select count(distinct day) from act where game and day > game_day() - 7),
        'active_days_30', (select count(distinct day) from act where game and day > game_day() - 30),
        'chat_days', (select count(distinct day) from act where source = 'chat'), 'voice_days', (select count(distinct day) from act where source = 'voice'),
        'by_source', (select coalesce(jsonb_object_agg(source, n), '{}') from (select source, count(distinct day) n from act group by 1) x)),
    'balances', jsonb_build_object('packs', p.pack_balance, 'shards', p.shard_balance,
        'pack_ledger_sum', (select coalesce(sum(amount), 0) from pack_ledger where player_id = p_player),
        'shard_ledger_sum', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p_player),
        'gifts_waiting', (select count(*) from gift_claims where player_id = p_player and claimed_at is null),
        'gift_packs_waiting', (select coalesce(sum(amount), 0) from gift_claims where player_id = p_player and claimed_at is null and kind <> 'card'),
        'gift_shards_waiting', (select coalesce(sum(shards), 0) from gift_claims where player_id = p_player and claimed_at is null),
        'packs_earned', (select coalesce(sum(amount), 0) from pack_ledger where player_id = p_player and amount > 0),
        'packs_opened', (select coalesce(-sum(amount), 0) from pack_ledger where player_id = p_player and reason = 'opened'),
        'shards_earned', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p_player and amount > 0),
        'shards_spent', (select coalesce(-sum(amount), 0) from shard_ledger where player_id = p_player and amount < 0)),
    'collection', jsonb_build_object(
        'power', my_collection_power(p_player),
        'power_rank', v_rank, 'power_rank_of', v_of,
        'copies', (select coalesce(sum(quantity), 0) from player_cards where player_id = p_player),
        'unique_cards', (select count(*) from player_cards where player_id = p_player),
        'stars', (select coalesce(sum(ascension), 0) from player_cards where player_id = p_player),
        'by_rarity', (select coalesce(jsonb_agg(jsonb_build_object('rarity', r, 'unique', u, 'copies', c) order by rarity_rank(r), r), '[]')
                        from (select k.rarity::text r, count(*) u, sum(pc.quantity) c from player_cards pc join cards k on k.id = pc.card_id
                               where pc.player_id = p_player group by 1) x),
        'by_season', (select coalesce(jsonb_agg(jsonb_build_object('season', s, 'unique', u, 'of', t) order by s), '[]')
                        from (select coalesce(k.season, '(none)') s, count(pc.card_id) u, count(*) t from cards k
                                left join player_cards pc on pc.card_id = k.id and pc.player_id = p_player group by 1) x),
        'pulls', (select coalesce(sum(amount), 0) from card_ledger where player_id = p_player and reason = 'pack' and amount > 0),
        'pulls_since', admin_pulls_since(),
        'pulls_rare_plus', (select coalesce(sum(c.amount), 0) from card_ledger c join cards k on k.id = c.card_id
                              where c.player_id = p_player and c.reason = 'pack' and c.amount > 0 and k.rarity::text <> 'normal')),
    'stat_points', jsonb_build_object(
        'cards_with_points', (select count(*) from player_cards where player_id = p_player and stat_points <> '{}'::jsonb),
        'points_spent', (select coalesce(sum(v::numeric), 0) from player_cards pc, jsonb_each_text(case when jsonb_typeof(pc.stat_points) = 'object' then pc.stat_points else '{}' end) e(k, v)
                           where pc.player_id = p_player and v ~ '^-?[0-9]+(\.[0-9]+)?$'),
        'by_stat', (select coalesce(jsonb_object_agg(k, s), '{}') from (select k, sum(v::numeric) s from player_cards pc, jsonb_each_text(case when jsonb_typeof(pc.stat_points) = 'object' then pc.stat_points else '{}' end) e(k, v)
                      where pc.player_id = p_player and v ~ '^-?[0-9]+(\.[0-9]+)?$' group by 1) x)),
    'achievements', jsonb_build_object(
        'claims', (select count(*) from achievement_claims where player_id = p_player),
        'packs', (select coalesce(sum(packs), 0) from achievement_claims where player_id = p_player),
        'shards', (select coalesce(sum(shards), 0) from achievement_claims where player_id = p_player),
        'titles', (select coalesce(jsonb_agg(distinct title), '[]') from achievement_claims where player_id = p_player and title is not null),
        'frames', (select coalesce(jsonb_agg(distinct frame), '[]') from achievement_claims where player_id = p_player and frame is not null),
        'last', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'at', claimed_at) order by claimed_at desc), '[]')
                   from (select key, claimed_at from achievement_claims where player_id = p_player order by claimed_at desc, key limit 10) x)),
    'effects_now', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'primitive', e.primitive, 'amount', e.amount, 'starts_at', e.starts_at,
                        'expires_at', e.expires_at, 'uses', e.options->'uses', 'from', e.options->>'sender_id') order by e.id), '[]')
                      from player_effects e where e.player_id = p_player and e.consumed_at is null and (e.expires_at is null or e.expires_at > now())),
    'discord_effects_now', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'primitive', d.primitive, 'status', d.status, 'revert_at', d.revert_at) order by d.id), '[]')
                              from discord_effects d where d.target_id = p_player and d.status in ('pending', 'active')),
    'effect_plays', jsonb_build_object(
        'sent', (select count(*) from card_plays where player_id = p_player),
        'received', (select count(*) from card_plays where target_id = p_player and player_id <> p_player),
        'cooldowns_now', (select count(*) from card_effect_cooldowns where player_id = p_player and ready_at > now())),
    'hunt', jsonb_build_object(
        'hunts', (select count(distinct hunt_id) from hunt_hits where player_id = p_player),
        'damage', (select coalesce(sum(damage), 0) from hunt_hits where player_id = p_player),
        'attacks', (select count(*) from hunt_combat_log where player_id = p_player),
        'supports', (select count(*) from combat_actions where player_id = p_player and mode = 'hunt' and kind = 'support'),
        'prize_packs', (select coalesce(sum(amount), 0) from pack_ledger where player_id = p_player and reason = 'hunt_reward')),
    'dungeon', (select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'runs', n, 'best_floor', f, 'shards', s) order by mode), '[]')
                  from (select mode, count(*) n, max(floor) f, sum(shards) s from dungeon_runs where player_id = p_player group by 1) x),
    'trading', jsonb_build_object(
        'swaps', (select count(*) from card_trades where from_id = p_player or to_id = p_player),
        'open_offers', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'side', case when o.from_id = p_player then 'made' else 'received' end,
                            'offer_card', o.offer_card_id, 'request_card', o.request_card_id, 'created_at', o.created_at) order by o.id), '[]')
                          from trade_offers o where (o.from_id = p_player or o.to_id = p_player) and o.status in ('pending', 'countered')),
        'open_listings', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'card', l.card_id, 'created_at', l.created_at) order by l.id), '[]')
                            from trade_listings l where l.player_id = p_player and l.status = 'open'),
        'live_auctions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'card', a.card_id, 'status', a.status, 'ends_at', a.ends_at) order by a.id), '[]')
                            from auctions a where a.seller_id = p_player and a.status in ('live', 'accepted')),
        'open_bids', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'auction', b.auction_id, 'status', b.status, 'cards', b.cards) order by b.id), '[]')
                        from auction_bids b where b.bidder_id = p_player and b.status in ('open', 'accepted')),
        'wishlist', (select coalesce(jsonb_agg(jsonb_build_object('slot', w.slot, 'card', w.card_id, 'top', w.top) order by w.slot), '[]')
                       from wishlists w where w.player_id = p_player)),
    'reports', jsonb_build_object(
        'by', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'at', r.created_at, 'issue', r.issue_number, 'text', left(r.body, 200)) order by r.id desc), '[]')
                 from (select * from player_reports where player_id = p_player order by id desc limit 20) r),
        'by_count', (select count(*) from player_reports where player_id = p_player),
        'against', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'at', r.created_at, 'by', r.player_id, 'issue', r.issue_number, 'text', left(r.body, 200)) order by r.id desc), '[]')
                      from (select * from player_reports where target_id = p_player and player_id <> p_player order by id desc limit 20) r),
        'against_count', (select count(*) from player_reports where target_id = p_player and player_id <> p_player)))
  into v_out;
  return v_out;
end $$;

comment on function public.admin_member(text) is
$c$[admin] One member on one page: profile (players; avatar_url = the Discord CDN picture of players.avatar, the URL the Activity uses; guild_joined_at, left_guild_at, in_guild), app (app_sessions visits and the last one, page_views by screen, tutorial_steps, notifications and unread, profile_log and wishlist_log changes, admin_actions on the member), activity (admin_active_days: first and last active, active days, chat and voice days, days by source), balances with the ledger sums as a check (players, pack_ledger, shard_ledger, gift_claims waiting), collection (my_collection_power, power_rank = 1 + the members with more power in collection_power_all and power_rank_of = the members with power, player_cards by rarity and by season of cards, stars, pulls and pulls_rare_plus from card_ledger reason pack since pulls_since = admin_pulls_since()), stat_points (player_cards.stat_points), achievements (achievement_claims), effects_now (player_effects not used up, discord_effects pending or active), effect_plays (card_plays, card_effect_cooldowns), hunt (hunt_hits, hunt_combat_log, combat_actions, pack_ledger hunt_reward), dungeon (dungeon_runs), trading (card_trades, open trade_offers, trade_listings, auctions, auction_bids, wishlists), reports by the member and against the member (player_reports.player_id and target_id, the newest 20 each, text cut to 200 characters). {found: false} for an unknown id. Service role only.$c$;

-- ============================================================ 5. one member's timeline
-- The signature changed (p_kinds, 2026-10-07): the old 4-argument version goes, so a call by name is not ambiguous.
drop function if exists public.admin_member_timeline(text, timestamp with time zone, integer, text);

-- The kinds of the timeline, one list (admin_member_timeline refuses another kind; the Admin view chips use it).
create or replace function public.admin_timeline_kinds()
returns text[] language sql immutable security invoker set search_path = public as $$
  select array['joined', 'guild', 'visit', 'tutorial', 'profile', 'pack', 'card', 'shard', 'daily', 'gift', 'gift_claim', 'hunt', 'combat',
    'squad', 'hunt_adjustment', 'dungeon', 'dungeon_over', 'dungeon_combat', 'effect_sent', 'effect_received', 'trade', 'wishlist', 'auction',
    'shop', 'stat_points', 'achievement', 'report', 'report_about', 'note', 'note_read', 'admin', 'chat', 'voice']::text[];
$$;

comment on function public.admin_timeline_kinds() is
$c$[admin] The kinds of admin_member_timeline, one list: joined, guild, visit, tutorial, profile, pack, card, shard, daily, gift, gift_claim, hunt, combat, squad, hunt_adjustment, dungeon, dungeon_over, dungeon_combat, effect_sent, effect_received, trade, wishlist, auction, shop, stat_points, achievement, report, report_about, note, note_read, admin, chat, voice. Service role only.$c$;

create or replace function public.admin_member_timeline(p_player text, p_before timestamptz default null, p_limit integer default 50,
  p_before_key text default null, p_kinds text[] default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_all text[] := admin_timeline_kinds();
  v_kinds text[] := case when p_kinds is null or cardinality(p_kinds) = 0 then admin_timeline_kinds() else p_kinds end;
  v_bad text[];
  v jsonb;
begin
  select array_agg(k order by k) into v_bad from unnest(v_kinds) k where not k = any (v_all);
  if v_bad is not null then raise exception 'admin_member_timeline: unknown kind % (see admin_timeline_kinds)', array_to_string(v_bad, ', '); end if;
  with ev(at, key, kind, text, amount, ref) as (
    select p.created_at, 'joined:' || p.id, 'joined', 'Joined (first seen by the bot, the Activity or a gift)', null::numeric, null::text
      from players p where p.id = p_player
    union all
    select p.guild_joined_at, 'guild_join:' || p.id, 'guild', 'Joined the Discord server', null, null from players p where p.id = p_player and p.guild_joined_at is not null
    union all
    select p.left_guild_at, 'guild_left:' || p.id, 'guild', 'Left the Discord server', null, null from players p where p.id = p_player and p.left_guild_at is not null
    union all
    -- A visit: one row per app_sessions row, with the screens (page_views) of the visit in the text, so the feed stays short.
    -- A view belongs to the newest visit that started up to 1 minute after it (the view and the visit touch come from one
    -- request); a view with no visit groups per game day (row key views:<day>). amount = the minutes of the visit.
    select s.started_at, 'visit:' || s.id, 'visit',
           'Visit to the Activity' || coalesce(' (' || nullif(coalesce(s.client->>'sdk_platform', s.client->>'platform'), '') || ')', '')
             || coalesce(', screens: ' || w.txt, ''),
           round(extract(epoch from (s.last_seen_at - s.started_at)) / 60), 'app_session:' || s.id
      from app_sessions s
      left join (select x.sid, string_agg(x.view || case when x.n > 1 then ' x' || x.n else '' end, ', ' order by x.first_at, x.view) txt
                   from (select pv.sid, pv.view, count(*) n, min(pv.at) first_at
                           from (select v.view, v.at, (select s2.id from app_sessions s2 where s2.player_id = p_player and s2.started_at <= v.at + interval '1 minute'
                                                         order by s2.started_at desc, s2.id desc limit 1) sid
                                   from page_views v where v.player_id = p_player) pv
                          where pv.sid is not null group by pv.sid, pv.view) x group by x.sid) w on w.sid = s.id
     where s.player_id = p_player
    union all
    select min(y.first_at), 'views:' || y.d, 'visit', 'Screens viewed: ' || string_agg(y.view || case when y.n > 1 then ' x' || y.n else '' end, ', ' order by y.first_at, y.view),
           null, null
      from (select game_day(v.at) d, v.view, count(*) n, min(v.at) first_at from page_views v
             where v.player_id = p_player
               and not exists (select 1 from app_sessions s2 where s2.player_id = p_player and s2.started_at <= v.at + interval '1 minute')
             group by 1, 2) y group by y.d
    union all
    select t.done_at, 'tutorial:' || t.step, 'tutorial',
           case when t.step like 'seen:%' then 'Explainer seen: ' || substr(t.step, 6) else 'Walkthrough: ' || t.step end, null, null
      from tutorial_steps t where t.player_id = p_player
    union all
    -- profile_log: the tutorial.* rows are left out (tutorial_steps has each step with its own time).
    select f.changed_at, 'profile:' || f.id, 'profile',
           case f.field
             when 'username' then 'Name changed: ' || coalesce(f.old_value #>> '{}', '-') || ' to ' || coalesce(f.new_value #>> '{}', '-')
             when 'avatar' then 'Avatar changed'
             when 'title' then 'Title: ' || coalesce(f.new_value #>> '{}', 'none')
             when 'frame' then 'Frame: ' || coalesce(f.new_value #>> '{}', 'none')
             when 'spotlight' then 'Spotlight cards changed'
             else 'Setting ' || f.field || ': ' || coalesce(f.new_value::text, 'none') end
           || case when f.changed_by in ('authenticator', 'service_role', 'postgres', 'supabase_admin') then '' else ' (by ' || f.changed_by || ')' end,
           null, 'profile_log:' || f.id
      from profile_log f where f.player_id = p_player and f.field not like 'tutorial%'
    union all
    select min(l.created_at), 'pack:' || min(l.id), 'pack', l.reason || case when count(*) > 1 then ' (' || count(*) || ' rows)' else '' end, sum(l.amount),
           l.ref_kind || ':' || l.ref_id
      from pack_ledger l where l.player_id = p_player group by l.reason, l.ref_kind, l.ref_id, l.created_at
    union all
    select min(c.created_at), 'card:' || min(c.id), 'card', c.reason || ': ' || string_agg(distinct k.rarity::text, ', ') || ' (' || count(*) || ' cards)', sum(c.amount),
           c.ref_kind || ':' || c.ref_id
      from card_ledger c join cards k on k.id = c.card_id where c.player_id = p_player group by c.reason, c.ref_kind, c.ref_id, c.created_at
    union all
    select s.created_at, 'shard:' || s.id, 'shard', s.reason, s.amount, s.ref_kind || ':' || s.ref_id from shard_ledger s where s.player_id = p_player
    union all
    select d.created_at, 'daily:' || d.day || ':' || d.task, 'daily', 'Daily ' || d.task || ' claimed', d.amount, 'daily_claim:' || d.day || ':' || d.task
      from daily_claims d where d.player_id = p_player
    union all
    select g.created_at, 'gift_in:' || g.id, 'gift', 'Gift in the bell: ' || g.title || case when g.from_id is not null then ' (from a member)' else '' end,
           case when g.kind = 'card' then 1 else g.amount end, 'gift:' || g.id
      from gift_claims g where g.player_id = p_player
    union all
    select g.claimed_at, 'gift_claim:' || g.id, 'gift_claim', 'Gift claimed: ' || g.title, case when g.kind = 'card' then 1 else g.amount end, 'gift:' || g.id
      from gift_claims g where g.player_id = p_player and g.claimed_at is not null
    union all
    select max(h.ts), 'hunt:' || h.hunt_id || ':' || game_day(h.ts), 'hunt', 'Hunt ' || h.hunt_id || ': ' || count(*) || ' attacks', sum(h.damage), 'hunt:' || h.hunt_id
      from hunt_combat_log h where h.player_id = p_player group by h.hunt_id, game_day(h.ts)
    union all
    select a.created_at, 'combat:' || a.id, 'combat', a.kind || ' ' || coalesce(a.effect, '') || ' (' || a.mode || ' ' || a.ref_id || ')',
           (a.result->>'value')::numeric, a.mode || ':' || a.ref_id
      from combat_actions a where a.player_id = p_player and a.mode = 'hunt'   -- the Dungeon rows (one per HP change) are summed per run below
    union all
    select s.locked_at, 'squad:' || s.hunt_id || ':' || s.hit_date, 'squad', 'Hunt squad locked: ' || cardinality(s.card_ids) || ' cards', null, 'hunt:' || s.hunt_id
      from hunt_squads s where s.player_id = p_player
    union all
    select j.created_at, 'hunt_adj:' || j.id, 'hunt_adjustment', 'Hunt damage changed by an admin: ' || j.reason, j.damage, 'hunt:' || j.hunt_id
      from hunt_adjustments j where j.player_id = p_player
    union all
    select r.started_at, 'run:' || r.id, 'dungeon', initcap(r.mode) || ' run started', null, 'dungeon_run:' || r.id from dungeon_runs r where r.player_id = p_player
    union all
    select r.ended_at, 'run_end:' || r.id, 'dungeon_over', initcap(r.mode) || ' run ended (' || coalesce(r.ended_by, '?') || ', floor ' || r.floor || ', room ' || r.room || ')', r.shards,
           'dungeon_run:' || r.id
      from dungeon_runs r where r.player_id = p_player and r.ended_at is not null
    union all
    -- The Dungeon and Gauntlet fight (combat_actions mode dungeon / gauntlet: one row per HP change) is ONE row per run, at its
    -- last action, so the feed stays readable. amount = the damage the squad dealt to the foes.
    select max(a.created_at), 'run_fight:' || a.ref_id, 'dungeon_combat',
           initcap(case when a.mode = 'dungeon' then 'daily' else a.mode end) || ' run fight: '
             || count(*) filter (where a.kind = 'attack') || ' attacks, '
             || coalesce(sum((a.result->>'value')::numeric) filter (where a.result->>'side' = 'foe' and a.result->>'dir' = 'dmg'), 0) || ' damage dealt, '
             || coalesce(sum((a.result->>'value')::numeric) filter (where a.result->>'side' = 'card' and a.result->>'dir' = 'dmg'), 0) || ' taken, '
             || count(*) filter (where a.kind = 'support') || ' supports, '
             || count(*) filter (where a.result->>'side' = 'foe' and a.result->>'dir' = 'dmg' and (a.result->>'hp_after')::numeric = 0 and (a.result->>'value')::numeric > 0) || ' foes down, '
             || count(*) filter (where a.result->>'side' = 'card' and a.result->>'dir' = 'dmg' and (a.result->>'hp_after')::numeric = 0 and (a.result->>'value')::numeric > 0) || ' cards down',
           coalesce(sum((a.result->>'value')::numeric) filter (where a.result->>'side' = 'foe' and a.result->>'dir' = 'dmg'), 0), 'dungeon_run:' || a.ref_id
      from combat_actions a where a.player_id = p_player and a.mode in ('dungeon', 'gauntlet') group by a.mode, a.ref_id
    union all
    select e.created_at, 'play:' || e.id, 'effect_sent', 'Played ' || e.primitive || ' (' || e.kind || ') on ' || case when e.target_id = e.player_id then 'self' else 'a member' end || ': ' || e.outcome,
           e.amount, 'card_play:' || e.id
      from card_plays e where e.player_id = p_player
    union all
    select e.created_at, 'played_on:' || e.id, 'effect_received', 'Got ' || e.primitive || ' (' || e.kind || '): ' || e.outcome, e.amount, 'card_play:' || e.id
      from card_plays e where e.target_id = p_player and e.player_id <> p_player
    union all
    select o.created_at, 'offer:' || o.id, 'trade', case when o.from_id = p_player then 'Trade offer made' else 'Trade offer received' end, null, 'trade_offer:' || o.id
      from trade_offers o where o.from_id = p_player or o.to_id = p_player
    union all
    select o.countered_at, 'offer_counter:' || o.id, 'trade', 'Trade offer countered', null, 'trade_offer:' || o.id
      from trade_offers o where (o.from_id = p_player or o.to_id = p_player) and o.countered_at is not null
    union all
    select o.resolved_at, 'offer_end:' || o.id, 'trade', 'Trade offer ' || o.status, null, 'trade_offer:' || o.id
      from trade_offers o where (o.from_id = p_player or o.to_id = p_player) and o.resolved_at is not null
    union all
    select l.created_at, 'listing:' || l.id, 'trade', 'Card listed in the Trading Hall', null, 'trade_listing:' || l.id from trade_listings l where l.player_id = p_player
    union all
    select w.changed_at, 'wish:' || w.id, 'wishlist',
           'Wishlist slot ' || w.slot || ': ' || case w.op
             when 'add' then 'added ' || coalesce(k.name, 'card ' || w.card_id)
             when 'remove' then 'removed ' || coalesce(k.name, 'card ' || w.card_id)
             when 'replace' then coalesce(ko.name, 'card ' || w.old_card_id) || ' replaced by ' || coalesce(k.name, 'card ' || w.card_id)
             when 'set_top' then coalesce(k.name, 'card ' || w.card_id) || ' is the top want'
             else coalesce(k.name, 'card ' || w.card_id) || ' is no longer the top want' end,
           null, 'wishlist_log:' || w.id
      from wishlist_log w left join cards k on k.id = w.card_id left join cards ko on ko.id = w.old_card_id where w.player_id = p_player
    union all
    select u.created_at, 'auction:' || u.id, 'auction', 'Auction started', null, 'auction:' || u.id from auctions u where u.seller_id = p_player
    union all
    select u.settled_at, 'auction_end:' || u.id, 'auction', 'Auction ' || u.status, null, 'auction:' || u.id from auctions u where u.seller_id = p_player and u.settled_at is not null
    union all
    select b.created_at, 'bid:' || b.id, 'auction', 'Bid placed (' || cardinality(b.cards) || ' cards), now ' || b.status, null, 'auction:' || b.auction_id
      from auction_bids b where b.bidder_id = p_player
    union all
    select s.created_at, 'shop:' || s.id, 'shop', 'Shop: ' || s.kind || case when s.qty > 1 then ' x' || s.qty else '' end, -s.price, 'shop_purchase:' || s.id
      from shop_purchases s where s.player_id = p_player
    union all
    -- stat_point_log: one row per card and change (a spend of several stats at once is one row). amount = the points added.
    select sp.changed_at, 'stat:' || min(sp.id), 'stat_points',
           'Stat points ' || sp.reason || ' on ' || coalesce(min(k.name), 'card ' || sp.card_id) || ': '
             || string_agg(sp.stat || ' ' || case when sp.delta > 0 then '+' else '' end || sp.delta, ', ' order by sp.stat),
           sum(sp.delta), 'card:' || sp.card_id
      from stat_point_log sp left join cards k on k.id = sp.card_id where sp.player_id = p_player group by sp.card_id, sp.reason, sp.changed_at
    union all
    select a.claimed_at, 'ach:' || a.key, 'achievement', 'Achievement claimed: ' || a.key, a.packs, 'achievement:' || a.key from achievement_claims a where a.player_id = p_player
    union all
    select r.created_at, 'report:' || r.id, 'report', 'Report sent: ' || r.kind, null, 'player_report:' || r.id from player_reports r where r.player_id = p_player
    union all
    select r.created_at, 'report_about:' || r.id, 'report_about', 'Named in a report by a member: ' || r.kind, null, 'player_report:' || r.id
      from player_reports r where r.target_id = p_player and r.player_id <> p_player
    union all
    select n.created_at, 'note:' || n.id, 'note', 'Bell note: ' || n.kind, null, 'notification:' || n.id from notifications n where n.player_id = p_player
    union all
    -- notifications.read_at: the bell marks the notes read together, so one row per read time.
    select n.read_at, 'note_read:' || min(n.id), 'note_read', 'Bell notes read: ' || count(*), count(*), null
      from notifications n where n.player_id = p_player and n.read_at is not null group by n.read_at
    union all
    select a.at, 'admin:' || a.id, 'admin', 'Admin ' || a.action || ' by ' || a.actor || ' (' || a.source || ')' || coalesce(': ' || nullif(a.reason, ''), ''),
           null, 'admin_action:' || a.id
      from admin_actions a where a.target_id = p_player and coalesce(a.target_kind, 'player') in ('player', 'member')
    union all
    select game_day_start(d.activity_date), 'chat:' || d.activity_date, 'chat', 'Chat messages that day', d.message_count, null
      from daily_activity d where d.player_id = p_player and d.message_count > 0
    union all
    select game_day_start(v.day), 'voice:' || v.day, 'voice', 'Voice minutes that day', v.minutes, null from voice_minutes v where v.player_id = p_player and v.minutes > 0
  ),
  tot as (select ev.kind, count(*) n from ev group by 1),
  sel as (select * from ev where ev.kind = any (v_kinds)),
  page as (
    select * from sel
     where p_before is null or sel.at < p_before or (sel.at = p_before and p_before_key is not null and sel.key < p_before_key)
     order by sel.at desc, sel.key desc
     limit v_lim)
  select jsonb_build_object(
    'player', p_player,
    'kinds', case when p_kinds is null or cardinality(p_kinds) = 0 then null else to_jsonb(v_kinds) end,
    'totals', coalesce((select jsonb_object_agg(kind, n order by kind) from tot), '{}'),
    'total', (select coalesce(sum(n), 0) from tot),
    'matching', (select count(*) from sel),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'key', key, 'kind', kind, 'text', text, 'amount', amount, 'ref', ref) order by at desc, key desc) from page), '[]'),
    'next', (select jsonb_build_object('before', at, 'before_key', key) from (select * from page order by at, key limit 1) l
              where (select count(*) from page) = v_lim))
  into v;
  return v;
end $$;

comment on function public.admin_member_timeline(text, timestamp with time zone, integer, text, text[]) is
$c$[admin] The history of one member: ONE feed, newest first, of everything the member did or got: joined (players), guild (players.guild_joined_at, left_guild_at), visit (one row per app_sessions visit with the screens of its page_views in the text, amount = minutes; views with no visit group per game day), tutorial (tutorial_steps), profile (profile_log, not the tutorial.* rows), pack, card and shard moves (pack_ledger and card_ledger grouped by transaction and ref; shard_ledger), daily claims (daily_claims), gifts made and claimed (gift_claims), Hunt attacks per Hunt day (hunt_combat_log), support and Crasher rows (combat_actions mode hunt), squads (hunt_squads), admin damage changes (hunt_adjustments), Dungeon runs (dungeon_runs start and end), dungeon_combat (combat_actions mode dungeon / gauntlet: one row per run with attacks, damage dealt and taken, supports, foes and cards down), effects sent and received (card_plays), trades (trade_offers made, countered, ended; trade_listings), wishlist (wishlist_log), auctions and bids (auctions, auction_bids), Shop (shop_purchases), stat_points (stat_point_log, one row per card and change), achievements (achievement_claims), reports by and about the member (player_reports, target_id), bell notes (notifications, pruned after 30 to 90 days) and their reads (read_at, one row per read time), admin (admin_actions on this member), chat and voice per day (daily_activity, voice_minutes). p_kinds: only these kinds (null or empty = all; admin_timeline_kinds lists them; another kind is refused). totals: the rows of each kind (all kinds, no filter), total, matching (the rows of the filter). Keyset pages: (at, key) below (p_before, p_before_key); next gives the values for the next page (null on the last page). p_limit default 50, max 200. Service role only.$c$;

-- ============================================================ 6. cards
-- The signature changed (p_search, 2026-10-07): the old 5-argument version goes.
drop function if exists public.admin_cards(date, date, text, integer, integer);
create or replace function public.admin_cards(p_from date default null, p_to date default null, p_sort text default 'copies', p_limit integer default 50,
  p_offset integer default 0, p_search text default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  pr jsonb := admin_period(p_from, p_to, 30);
  d0 date := (pr->>'from')::date; d1 date := (pr->>'to')::date;
  t0 timestamptz := (pr->>'t0')::timestamptz; t1 timestamptz := (pr->>'t1')::timestamptz;
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_sort text := coalesce(nullif(p_sort, ''), 'copies');
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_like text := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v jsonb;
begin
  if v_sort not in ('copies', 'owners', 'pulls', 'trades', 'attacks', 'damage', 'plays', 'id') then
    raise exception 'admin_cards: unknown sort % (copies, owners, pulls, trades, attacks, damage, plays, id)', p_sort;
  end if;
  with
  own as (select card_id, sum(quantity) copies, count(*) owners, sum(ascension) stars from player_cards group by 1),
  pul as (select card_id, sum(amount) n from card_ledger where reason = 'pack' and amount > 0 and created_at >= t0 and created_at < t1 group by 1),
  trd as (select x card_id, count(*) n from card_trades t, unnest(t.from_cards || t.to_cards) x where t.created_at >= t0 and t.created_at < t1 group by 1),
  atk as (select card_id, count(*) n, sum(damage) dmg from hunt_combat_log where ts >= t0 and ts < t1 group by 1),
  hit as (select h.card_id, sum(h.damage) dmg, sum(h.damage) filter (where u.status = 'defeated') dmg_won from hunt_hits h join hunts u on u.id = h.hunt_id
           where h.hit_date between d0 and d1 group by 1),
  tot as (select coalesce(sum(damage), 0) d from hunt_hits where hit_date between d0 and d1),
  sup as (select card_id, count(*) n from combat_actions where mode = 'hunt' and kind = 'support' and created_at >= t0 and created_at < t1 group by 1),
  ply as (select card_id, count(*) n from card_plays where created_at >= t0 and created_at < t1 group by 1),
  r as (
    select k.id, k.name, k.rarity::text rarity, k.subject_id, s.type, k.season, k.in_draw_pool, k.tradeable,
           coalesce(own.copies, 0) copies, coalesce(own.owners, 0) owners, coalesce(own.stars, 0) stars, coalesce(pul.n, 0) pulls,
           coalesce(trd.n, 0) trades, coalesce(atk.n, 0) attacks, coalesce(hit.dmg, 0) damage, coalesce(hit.dmg_won, 0) damage_won,
           case when (select d from tot) > 0 then round(coalesce(hit.dmg, 0)::numeric / (select d from tot), 5) else 0 end damage_share,
           coalesce(sup.n, 0) supports, coalesce(ply.n, 0) plays
      from cards k join subjects s on s.id = k.subject_id
      left join own on own.card_id = k.id left join pul on pul.card_id = k.id left join trd on trd.card_id = k.id
      left join atk on atk.card_id = k.id left join hit on hit.card_id = k.id left join sup on sup.card_id = k.id left join ply on ply.card_id = k.id
     where v_q is null or k.name ilike v_like or k.id::text = v_q),
  o as (select r.*, row_number() over (order by case v_sort when 'copies' then copies when 'owners' then owners when 'pulls' then pulls when 'trades' then trades
                       when 'attacks' then attacks when 'damage' then damage when 'plays' then plays + supports else 0 end desc, id) rn from r)
  select jsonb_build_object('period', pr - 't0' - 't1', 'total', (select count(*) from o), 'limit', v_lim, 'offset', v_off, 'sort', v_sort, 'search', v_q,
    'hunt_damage_total', (select d from tot), 'pulls_since', case when admin_pulls_since() > t0 then admin_pulls_since() end,
    'rows', coalesce((select jsonb_agg(to_jsonb(o) - 'rn' order by o.rn) from o where o.rn > v_off and o.rn <= v_off + v_lim), '[]'))
  into v;
  return v;
end $$;

comment on function public.admin_cards(date, date, text, integer, integer, text) is
$c$[admin] Each card (one page, default 50, max 200; sort copies, owners, pulls, trades, attacks, damage, plays or id, descending, then id; p_search: a part of the card name, case does not matter, or the card id; total = the matching cards): copies, owners and stars now (player_cards); in the period (default 30 days): pulls (card_ledger reason pack; pulls_since = admin_pulls_since() when it is after the period start, else null), trades (card_trades, each side that holds the card), attacks (hunt_combat_log), damage and damage_won (hunt_hits, damage_won in Hunts with status defeated), damage_share (of all hunt_hits damage in the period), supports (combat_actions mode hunt, kind support), plays (card_plays). Service role only.$c$;

-- ============================================================ 7. Hunts
create or replace function public.admin_hunts(p_limit integer default 20, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = public as $$
  with h as (select * from hunts order by id desc limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object('total', (select count(*) from hunts), 'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'name', h.name, 'tier', h.tier, 'status', h.status, 'hp_max', h.hp_max, 'hp_remaining', h.hp_remaining,
      'opens_at', h.opens_at, 'closes_at', h.closes_at, 'defeated_at', h.defeated_at, 'settled_at', h.settled_at,
      'fighters', (select count(distinct player_id) from hunt_hits x where x.hunt_id = h.id),
      'damage', (select coalesce(sum(damage), 0) from hunt_hits x where x.hunt_id = h.id),
      'attacks', (select count(*) from hunt_combat_log x where x.hunt_id = h.id),
      'prize_packs', (select coalesce(sum(amount), 0) from pack_ledger l where l.reason = 'hunt_reward' and l.ref_kind = 'hunt' and l.ref_id = h.id::text)) order by h.id desc), '[]'))
  from h;
$$;

comment on function public.admin_hunts(integer, integer) is
$c$[admin] The Hunts, newest first (default 20, max 100): the hunts row (name, tier, status, HP, times), fighters and damage (hunt_hits), attacks (hunt_combat_log), prize_packs (pack_ledger hunt_reward, ref hunt). Service role only.$c$;

create or replace function public.admin_hunt(p_hunt bigint)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare h hunts; v jsonb;
begin
  select * into h from hunts where id = p_hunt;
  if not found then return jsonb_build_object('found', false, 'hunt', p_hunt); end if;
  with m as (select player_id, sum(damage) dmg from hunt_hits where hunt_id = p_hunt group by 1),
  rk as (select m.*, row_number() over (order by dmg desc, player_id) rk from m),
  tot as (select coalesce(sum(dmg), 0) d, count(*) n from m),
  rec as (select * from hunt_damage_reconcile(p_hunt))
  select jsonb_build_object('found', true,
    'hunt', to_jsonb(h),
    'hp_dealt', h.hp_max - h.hp_remaining,
    'fighters', (select n from tot), 'damage', (select d from tot),
    'attacks', (select count(*) from hunt_combat_log where hunt_id = p_hunt),
    'supports', (select count(*) from combat_actions where mode = 'hunt' and ref_id = p_hunt and kind = 'support'),
    'squads', (select count(*) from hunt_squads where hunt_id = p_hunt),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'fighters', f, 'damage', s) order by d), '[]')
                 from (select hit_date d, count(distinct player_id) f, sum(damage) s from hunt_hits where hunt_id = p_hunt group by 1) x),
    'rank_buckets', (select coalesce(jsonb_agg(jsonb_build_object('ranks', b, 'members', n, 'damage', s,
                        'share', case when (select d from tot) > 0 then round(s::numeric / (select d from tot), 4) end) order by o), '[]')
                       from (select case when rk = 1 then '1' when rk <= 3 then '2-3' when rk <= 10 then '4-10' when rk <= 25 then '11-25' else '26+' end b,
                                    min(rk) o, count(*) n, sum(dmg) s from rk group by 1) x),
    'damage_buckets', (select coalesce(jsonb_agg(jsonb_build_object('damage_from', lo, 'members', n, 'damage', s) order by lo), '[]')
                         from (select case when dmg < 1000 then 0 when dmg < 5000 then 1000 when dmg < 20000 then 5000 when dmg < 50000 then 20000 else 50000 end lo,
                                      count(*) n, sum(dmg) s from m group by 1) x),
    'top_share', case when (select d from tot) > 0 then round((select max(dmg) from m)::numeric / (select d from tot), 4) end,
    'top3_share', case when (select d from tot) > 0 then round((select coalesce(sum(dmg), 0) from rk where rk <= 3)::numeric / (select d from tot), 4) end,
    'prizes', jsonb_build_object('members', (select count(distinct player_id) from pack_ledger where reason = 'hunt_reward' and ref_kind = 'hunt' and ref_id = p_hunt::text),
                                 'packs', (select coalesce(sum(amount), 0) from pack_ledger where reason = 'hunt_reward' and ref_kind = 'hunt' and ref_id = p_hunt::text)),
    'reconcile', jsonb_build_object('members', (select count(*) from rec), 'members_unexplained', (select count(*) from rec where unexplained <> 0),
        'hits', (select coalesce(sum(hits), 0) from rec), 'logged', (select coalesce(sum(logged), 0) from rec), 'smite', (select coalesce(sum(smite), 0) from rec),
        'crasher', (select coalesce(sum(crasher), 0) from rec), 'adjusted', (select coalesce(sum(adjusted), 0) from rec),
        'unexplained', (select coalesce(sum(unexplained), 0) from rec), 'ok', not exists (select 1 from rec where unexplained <> 0)))
  into v;
  return v;
end $$;

comment on function public.admin_hunt(bigint) is
$c$[admin] One Hunt: the hunts row, hp_dealt, fighters and damage (hunt_hits), attacks (hunt_combat_log), supports (combat_actions), squads (hunt_squads), damage by day, rank_buckets (members and damage share of ranks 1, 2-3, 4-10, 11-25, 26+), damage_buckets (members by damage: under 1k, 1k, 5k, 20k, 50k+), top_share and top3_share, prizes (pack_ledger hunt_reward, ref hunt), reconcile (the sums of hunt_damage_reconcile: ok = no member with unexplained damage). {found: false} for an unknown id. Service role only.$c$;

-- ============================================================ 8. data health
create or replace function public.admin_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cron jsonb := null; v jsonb;
begin
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active, 'last_status', r.status,
               'last_start', r.start_time, 'last_end', r.end_time, 'last_message', left(r.return_message, 160),
               'failed_7d', (select count(*) from cron.job_run_details f where f.jobid = j.jobid and f.status = 'failed' and f.start_time > now() - interval '7 days'))
             order by j.jobname), '[]')
        from cron.job j left join lateral (select * from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true $q$
      into v_cron;
  end if;
  select jsonb_build_object(
    'at', now(),
    'reconcile', jsonb_build_object(
        'pack', pack_ledger_reconcile() - 'mismatched_rows', 'card', card_ledger_reconcile() - 'mismatched_rows',
        'shard', shard_ledger_reconcile() - 'mismatched_rows' - 'mismatched_runs'),
    'reconcile_detail_counts', jsonb_build_object(
        'pack_mismatched_rows', jsonb_array_length(coalesce(pack_ledger_reconcile()->'mismatched_rows', '[]')),
        'shard_mismatched_rows', jsonb_array_length(coalesce(shard_ledger_reconcile()->'mismatched_rows', '[]'))),
    'hunts', (select coalesce(jsonb_agg(x order by (x->>'hunt')::bigint desc), '[]') from (
        select jsonb_build_object('hunt', h.id, 'status', h.status,
          'members', (select count(*) from hunt_damage_reconcile(h.id)),
          'members_unexplained', (select count(*) from hunt_damage_reconcile(h.id) r where r.unexplained <> 0),
          'unexplained', (select coalesce(sum(r.unexplained), 0) from hunt_damage_reconcile(h.id) r)) x
          from (select * from hunts order by id desc limit 3) h) y),
    -- dungeon_combat_log.sql: the HP trace of the last 5 Dungeon / Gauntlet runs started after the log began.
    'dungeon_runs', (select coalesce(jsonb_agg(x order by (x->>'run')::bigint desc), '[]') from (
        select jsonb_build_object('run', d.id, 'mode', d.mode, 'status', d.status,
          'rows_unexplained', (select count(*) from dungeon_damage_reconcile(d.id) r where r.unexplained <> 0),
          'unexplained', (select coalesce(sum(abs(r.unexplained)), 0) from dungeon_damage_reconcile(d.id) r)) x
          from (select * from dungeon_runs where started_at >= coalesce((select min(applied_at) from schema_migrations where file = 'dungeon_combat_log.sql'), 'infinity')
                 order by id desc limit 5) d) y),
    'refs_missing', jsonb_build_object(
        'pack_gift', (select count(*) from pack_ledger l where l.ref_kind = 'gift' and not exists (select 1 from gift_claims g where g.id::text = l.ref_id)),
        'pack_shop', (select count(*) from pack_ledger l where l.ref_kind = 'shop_purchase' and not exists (select 1 from shop_purchases s where s.id::text = l.ref_id)),
        'pack_hunt', (select count(*) from pack_ledger l where l.ref_kind = 'hunt' and not exists (select 1 from hunts h where h.id::text = l.ref_id)),
        'pack_daily', (select count(*) from pack_ledger l where l.ref_kind = 'daily_claim' and not exists
                         (select 1 from daily_claims d where d.player_id = l.player_id and d.day::text || ':' || d.task = l.ref_id)),
        'card_trade', (select count(*) from card_ledger c where c.ref_kind = 'trade_offer' and not exists (select 1 from trade_offers o where o.id::text = c.ref_id)),
        'card_auction', (select count(*) from card_ledger c where c.ref_kind = 'auction' and not exists (select 1 from auctions a where a.id::text = c.ref_id)),
        'card_gift', (select count(*) from card_ledger c where c.ref_kind = 'gift' and not exists (select 1 from gift_claims g where g.id::text = c.ref_id)),
        'card_run', (select count(*) from card_ledger c where c.ref_kind = 'dungeon_run' and not exists (select 1 from dungeon_runs r where r.id::text = c.ref_id)),
        'shard_run', (select count(*) from shard_ledger s where s.ref_kind = 'run' and not exists (select 1 from dungeon_runs r where r.id::text = s.ref_id)),
        'shard_shop', (select count(*) from shard_ledger s where s.ref_kind = 'shop_purchase' and not exists (select 1 from shop_purchases p where p.id::text = s.ref_id)),
        'shard_gift', (select count(*) from shard_ledger s where s.ref_kind = 'gift' and not exists (select 1 from gift_claims g where g.id::text = s.ref_id))),
    'rows_without_ref', jsonb_build_object(
        'pack', (select count(*) from pack_ledger where ref_kind is null or ref_id is null),
        'card', (select count(*) from card_ledger where ref_kind is null or ref_id is null),
        'shard', (select count(*) from shard_ledger where ref_kind is null or ref_id is null)),
    'queues', jsonb_build_object(
        'hunt_events_unposted', (select count(*) from hunt_events where posted_at is null and kind <> 'attack'),
        'hunt_events_oldest_unposted', (select min(created_at) from hunt_events where posted_at is null and kind <> 'attack'),
        'reports_unsynced', (select count(*) from player_reports where synced_at is null),
        'discord_effects_pending', (select count(*) from discord_effects where status = 'pending'),
        'discord_effects_failed_7d', (select count(*) from discord_effects where status = 'failed' and updated_at > now() - interval '7 days'),
        'card_plays_unposted_1h', (select count(*) from card_plays where posted_at is null and created_at < now() - interval '1 hour' and created_at > now() - interval '7 days')),
    'cron', v_cron,
    'database_bytes', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'bytes', b, 'rows_estimate', n) order by b desc), '[]')
                 from (select c.relname, pg_total_relation_size(c.oid) b, greatest(c.reltuples, 0)::bigint n from pg_class c
                        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 2 desc limit 25) t),
    'migrations_last', (select coalesce(jsonb_agg(jsonb_build_object('file', file, 'applied_at', applied_at) order by id desc), '[]')
                          from (select * from schema_migrations order by id desc limit 10) m),
    'balance_last', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'op', op, 'at', changed_at, 'by', changed_by) order by id desc), '[]')
                       from (select * from balance_log order by id desc limit 10) b))
  into v;
  return v;
end $$;

comment on function public.admin_health() is
$c$[admin] The data health in one call: reconcile (pack_ledger_reconcile, card_ledger_reconcile, shard_ledger_reconcile without the long lists), hunts (hunt_damage_reconcile of the last 3 Hunts: members with unexplained damage), dungeon_runs (dungeon_damage_reconcile of the last 5 Dungeon and Gauntlet runs started after dungeon_combat_log.sql: rows and HP unexplained), refs_missing (ledger rows whose ref points at no row: gift_claims, shop_purchases, hunts, daily_claims, trade_offers, auctions, dungeon_runs), rows_without_ref (the three ledgers), queues (hunt_events not posted, player_reports not synced, discord_effects pending and failed, card_plays not posted), cron (cron.job with the last cron.job_run_details row and the failures of 7 days; null when pg_cron is absent), database_bytes and the 25 largest tables (pg_class), migrations_last (schema_migrations), balance_last (balance_log). Security definer (owner postgres) for the cron schema and the catalog. Service role only.$c$;

-- ============================================================ 9. reports
create or replace function public.admin_report_catalog()
returns jsonb language sql immutable security invoker set search_path = public as $$
  select $j$[
    {"key": "top_power", "title": "Top members by collection power", "params": {"limit": 100},
     "columns": ["rank", "player_id", "username", "power", "copies", "unique_cards"],
     "about": "collection_power_all and player_cards."},
    {"key": "inactive", "title": "Members not active in the last N days", "params": {"days": 7, "limit": 100},
     "columns": ["player_id", "username", "joined", "last_active", "days_since", "packs", "shards"],
     "about": "Members with at least one active day (admin_active_days) and none in the last N game days."},
    {"key": "packs_unopened", "title": "Members who hold packs and do not open them", "params": {"min": 1, "limit": 100},
     "columns": ["player_id", "username", "packs", "gift_packs_waiting", "last_open", "last_active"],
     "about": "players.pack_balance, gift_claims not claimed, pack_ledger opened, admin_active_days."},
    {"key": "pull_luck", "title": "Pull luck by member against the set rates", "params": {"min_pulls": 25, "limit": 100},
     "columns": ["player_id", "username", "pulls", "rare_plus", "expected_rare_plus", "ratio", "z"],
     "about": "card_ledger reason pack (from since = admin_pulls_since(), the card ledger start) and balance pulls.rates. rare_plus = every rarity but normal. z = (actual - expected) / sqrt(n p (1 - p))."},
    {"key": "shard_sinks", "title": "Where Shards go and come from", "params": {"days": 30},
     "columns": ["direction", "reason", "detail", "shards", "rows", "members"],
     "about": "shard_ledger by reason, and the Shop spend by shop_purchases.kind."},
    {"key": "effect_usage", "title": "Effect plays by type", "params": {"days": 30},
     "columns": ["primitive", "kind", "plays", "senders", "targets", "applied", "blocked", "reflected", "refunded"],
     "about": "card_plays."},
    {"key": "unclaimed_gifts", "title": "Gifts that wait in the bell", "params": {},
     "columns": ["kind", "reason", "waiting", "members", "packs", "shards", "oldest"],
     "about": "gift_claims with no claimed_at."},
    {"key": "hunt_board", "title": "The damage board of one Hunt", "params": {"hunt": null, "limit": 100},
     "columns": ["rank", "player_id", "username", "damage", "share", "prize_packs"],
     "about": "hunt_hits and pack_ledger hunt_reward. hunt = null: the newest Hunt."}
  ]$j$::jsonb;
$$;

comment on function public.admin_report_catalog() is
$c$[admin] The ready-made Admin reports (the one list): key, title, params with their defaults, the columns in CSV order and the sources. admin_report runs them. Service role only.$c$;

create or replace function public.admin_report(p_key text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  cat jsonb := (select e from jsonb_array_elements(admin_report_catalog()) e where e->>'key' = p_key);
  prm jsonb; lim int; v_days int; rows jsonb; v_hunt bigint; v_first date := coalesce((select game_day(min(created_at)) from players), game_day());
  rates jsonb := coalesce(balance_get('pulls')->'rates', '{}'::jsonb); p_rare numeric;
begin
  if cat is null then raise exception 'admin_report: unknown report % (see admin_report_catalog)', p_key; end if;
  prm := (cat->'params') || coalesce(p_params, '{}'::jsonb);
  lim := least(greatest(coalesce((prm->>'limit')::int, 100), 1), 1000);
  v_days := least(greatest(coalesce((prm->>'days')::int, 7), 1), 731);

  if p_key = 'top_power' then
    select coalesce(jsonb_agg(x order by (x->>'rank')::int), '[]') into rows from (
      select jsonb_build_object('rank', row_number() over (order by w.power desc, w.player_id), 'player_id', w.player_id, 'username', p.username, 'power', w.power,
               'copies', (select coalesce(sum(quantity), 0) from player_cards c where c.player_id = w.player_id),
               'unique_cards', (select count(*) from player_cards c where c.player_id = w.player_id)) x
        from collection_power_all() w join players p on p.id = w.player_id order by w.power desc, w.player_id limit lim) y;

  elsif p_key = 'inactive' then
    with la as (select player_id, max(day) last_active from admin_active_days(v_first, game_day()) where game group by 1)
    select coalesce(jsonb_agg(jsonb_build_object('player_id', p.id, 'username', p.username, 'joined', game_day(p.created_at), 'last_active', la.last_active,
             'days_since', game_day() - la.last_active, 'packs', p.pack_balance, 'shards', p.shard_balance) order by la.last_active desc, p.id), '[]') into rows
      from (select * from la where la.last_active <= game_day() - v_days order by la.last_active desc, la.player_id limit lim) la join players p on p.id = la.player_id;

  elsif p_key = 'packs_unopened' then
    with la as (select player_id, max(day) last_active from admin_active_days(v_first, game_day()) where game group by 1),
    g as (select player_id, sum(amount) n from gift_claims where claimed_at is null and kind <> 'card' group by 1),
    lo as (select player_id, max(created_at) t from pack_ledger where reason = 'opened' group by 1),
    r as (select p.id, p.username, p.pack_balance, coalesce(g.n, 0) gw, lo.t, la.last_active from players p
            left join g on g.player_id = p.id left join lo on lo.player_id = p.id left join la on la.player_id = p.id
           where p.pack_balance + coalesce(g.n, 0) >= coalesce((prm->>'min')::int, 1)
           order by p.pack_balance + coalesce(g.n, 0) desc, p.id limit lim)
    select coalesce(jsonb_agg(jsonb_build_object('player_id', id, 'username', username, 'packs', pack_balance, 'gift_packs_waiting', gw, 'last_open', t,
             'last_active', last_active) order by pack_balance + gw desc, id), '[]') into rows from r;

  elsif p_key = 'pull_luck' then
    p_rare := 1 - coalesce((rates->>'normal')::numeric, 1);
    with x as (select c.player_id, sum(c.amount) n, sum(c.amount) filter (where k.rarity::text <> 'normal') rp
                 from card_ledger c join cards k on k.id = c.card_id where c.reason = 'pack' and c.amount > 0 group by 1
                having sum(c.amount) >= coalesce((prm->>'min_pulls')::int, 25)),
    r as (select x.*, coalesce(x.rp, 0) rare, x.n * p_rare ex,
                 case when p_rare > 0 and p_rare < 1 then (coalesce(x.rp, 0) - x.n * p_rare) / sqrt(x.n * p_rare * (1 - p_rare)) end z from x)
    select coalesce(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'username', p.username, 'pulls', r.n, 'rare_plus', r.rare,
             'expected_rare_plus', round(r.ex, 2), 'ratio', case when r.ex > 0 then round(r.rare / r.ex, 3) end, 'z', round(r.z, 2)) order by r.z desc nulls last, r.player_id), '[]')
      into rows from (select * from r order by z desc nulls last, player_id limit lim) r join players p on p.id = r.player_id;

  elsif p_key = 'shard_sinks' then
    v_days := least(greatest(coalesce((prm->>'days')::int, 30), 1), 731);
    with l as (select * from shard_ledger where created_at >= game_day_start(game_day() - v_days + 1)),
    s as (select * from shop_purchases where created_at >= game_day_start(game_day() - v_days + 1)),
    u as (select case when amount > 0 then 'in' else 'out' end dir, reason, null::text detail, abs(sum(amount)) shards, count(*) n, count(distinct player_id) m from l group by 1, 2
          union all
          select 'out', 'shop', kind, sum(price), count(*), count(distinct player_id) from s group by kind)
    select coalesce(jsonb_agg(jsonb_build_object('direction', dir, 'reason', reason, 'detail', detail, 'shards', shards, 'rows', n, 'members', m)
             order by dir, shards desc, reason, detail nulls first), '[]') into rows from u;

  elsif p_key = 'effect_usage' then
    v_days := least(greatest(coalesce((prm->>'days')::int, 30), 1), 731);
    select coalesce(jsonb_agg(jsonb_build_object('primitive', primitive, 'kind', kind, 'plays', n, 'senders', s, 'targets', t, 'applied', a, 'blocked', b,
             'reflected', rf, 'refunded', rd) order by n desc, primitive), '[]') into rows
      from (select primitive, kind, count(*) n, count(distinct player_id) s, count(distinct target_id) t,
                   count(*) filter (where outcome = 'applied') a, count(*) filter (where outcome = 'blocked') b,
                   count(*) filter (where outcome = 'reflected') rf, count(*) filter (where outcome = 'refunded') rd
              from card_plays where created_at >= game_day_start(game_day() - v_days + 1) group by 1, 2) x;

  elsif p_key = 'unclaimed_gifts' then
    select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'reason', reason, 'waiting', n, 'members', m, 'packs', p, 'shards', s, 'oldest', o)
             order by n desc, k, reason), '[]') into rows
      from (select kind k, reason, count(*) n, count(distinct player_id) m,
                   sum(amount) filter (where kind <> 'card') p, sum(shards) s, min(created_at) o
              from gift_claims where claimed_at is null group by 1, 2) x;

  elsif p_key = 'hunt_board' then
    v_hunt := coalesce((prm->>'hunt')::bigint, (select max(id) from hunts));
    with m as (select player_id, sum(damage) dmg from hunt_hits where hunt_id = v_hunt group by 1),
    t as (select coalesce(sum(dmg), 0) d from m),
    pz as (select player_id, sum(amount) n from pack_ledger where reason = 'hunt_reward' and ref_kind = 'hunt' and ref_id = v_hunt::text group by 1),
    r as (select m.*, row_number() over (order by dmg desc, player_id) rk from m)
    select coalesce(jsonb_agg(jsonb_build_object('rank', r.rk, 'player_id', r.player_id, 'username', p.username, 'damage', r.dmg,
             'share', case when (select d from t) > 0 then round(r.dmg::numeric / (select d from t), 4) end, 'prize_packs', coalesce(pz.n, 0)) order by r.rk), '[]')
      into rows from r join players p on p.id = r.player_id left join pz on pz.player_id = r.player_id where r.rk <= lim;
    prm := prm || jsonb_build_object('hunt', v_hunt);
  else
    raise exception 'admin_report: % is in the catalog but has no query', p_key;
  end if;

  return jsonb_build_object('key', p_key, 'title', cat->>'title', 'params', prm, 'columns', cat->'columns', 'rows', rows,
    'row_count', jsonb_array_length(rows), 'limit', lim)
    || case when p_key = 'pull_luck' then jsonb_build_object('since', admin_pulls_since()) else '{}'::jsonb end;
end $$;

comment on function public.admin_report(text, jsonb) is
$c$[admin] Runs one report of admin_report_catalog: p_params over the catalog defaults (limit default 100, max 1000). Returns key, title, params, columns (the CSV order), rows (objects) and row_count; pull_luck also since (admin_pulls_since()). An unknown key is refused. Service role only.$c$;

-- ============================================================ 10. growth
create or replace function public.admin_growth(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  pr jsonb := admin_period(p_from, p_to, 28);
  d0 date := (pr->>'from')::date; d1 date := (pr->>'to')::date;
  t0 timestamptz := (pr->>'t0')::timestamptz; t1 timestamptz := (pr->>'t1')::timestamptz;
  n int := (pr->>'days')::int;
  v jsonb;
begin
  with
  joined as (select p.id, game_day(p.created_at) jd from players p where p.created_at >= t0 and p.created_at < t1),
  act as (select distinct a.player_id, a.day, a.source from admin_active_days(d0 - n, d1) a where a.game),
  ad as (select distinct player_id, day from act),
  -- retention by join week
  cw as (select date_trunc('week', jd)::date w, id from joined),
  cs as (select w, count(*) size from cw group by w),
  cohorts as (
    select cs.w, cs.size,
           (select coalesce(jsonb_agg(jsonb_build_object('week', z.k, 'active', z.a, 'share', round(z.a::numeric / cs.size, 4)) order by z.k), '[]')
              from (select k, (select count(distinct c2.id) from cw c2 join ad on ad.player_id = c2.id
                                 and ad.day >= cs.w + 7 * k and ad.day < cs.w + 7 * k + 7 where c2.w = cs.w) a
                      from generate_series(0, 8) k where cs.w + 7 * k + 6 <= d1) z) as weeks
      from cs),
  dn as (select x.nd, count(*) filter (where j.jd + x.nd <= d1) eligible,
                count(*) filter (where j.jd + x.nd <= d1 and exists (select 1 from ad where ad.player_id = j.id and ad.day = j.jd + x.nd)) kept
           from joined j cross join (values (1), (7), (30)) x(nd) group by x.nd),
  -- the funnel of the members who joined in the period (each step any time up to the period end)
  f as (
    select j.id, j.jd,
      exists (select 1 from gift_claims g where g.player_id = j.id and g.kind = 'new_player' and g.claimed_at < t1) welcome,
      (select min(l.created_at) from pack_ledger l where l.player_id = j.id and l.reason = 'opened' and l.created_at < t1) first_open,
      exists (select 1 from hunt_combat_log h where h.player_id = j.id and h.ts < t1)
        or exists (select 1 from combat_actions a where a.player_id = j.id and a.kind = 'support' and a.created_at < t1)
        or exists (select 1 from dungeon_runs r where r.player_id = j.id and r.started_at < t1) fought,
      exists (select 1 from trade_offers o where (o.from_id = j.id and o.created_at < t1) or (o.to_id = j.id and o.countered_at < t1))
        or exists (select 1 from trade_listings l where l.player_id = j.id and l.created_at < t1)
        or exists (select 1 from auctions u where u.seller_id = j.id and u.created_at < t1)
        or exists (select 1 from auction_bids b where b.bidder_id = j.id and b.created_at < t1)
        or exists (select 1 from card_trades t where (t.from_id = j.id or t.to_id = j.id) and t.created_at < t1) traded,
      j.jd + 13 <= d1 week2_eligible,
      exists (select 1 from ad where ad.player_id = j.id and ad.day between j.jd + 7 and j.jd + 13) week2
    from joined j),
  prev as (select distinct player_id from ad where day between d0 - n and d0 - 1),
  cur as (select distinct player_id from ad where day between d0 and d1),
  feat as (select case source when 'pack_open' then 'packs' when 'hunt' then 'hunt' when 'dungeon' then 'dungeon' when 'gauntlet' then 'gauntlet'
                    when 'trade' then 'trades' when 'auction' then 'auctions' when 'effect' then 'effects' when 'daily' then 'dailies'
                    when 'achievement' then 'achievements' when 'shop' then 'shop' when 'gift_claim' then 'gifts' else null end f, player_id
             from act where day between d0 and d1)
  select jsonb_build_object(
    'period', pr - 't0' - 't1',
    'new_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', x::date, 'new', (select count(*) from joined where jd = x::date)) order by x), '[]')
                     from generate_series(d0, d1, interval '1 day') x),
    'new_by_week', (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'new', c) order by w), '[]') from (select w, count(*) c from cw group by 1) x),
    'cohorts', (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'size', size, 'weeks', weeks) order by w), '[]') from cohorts),
    'retention', (select coalesce(jsonb_object_agg('d' || nd, jsonb_build_object('eligible', eligible, 'kept', kept,
                     'share', case when eligible > 0 then round(kept::numeric / eligible, 4) end)), '{}') from dn),
    'funnel', jsonb_build_object(
        'joined', (select count(*) from f),
        'claimed_welcome', (select count(*) from f where welcome),
        'opened_first_pack', (select count(*) from f where first_open is not null),
        'first_fight', (select count(*) from f where fought),
        'first_trade', (select count(*) from f where traded),
        'week2_eligible', (select count(*) from f where week2_eligible),
        'active_week2', (select count(*) from f where week2_eligible and week2),
        'median_hours_to_first_open', (select round((percentile_cont(0.5) within group (order by extract(epoch from first_open - p.created_at) / 3600))::numeric, 2)
                                         from f join players p on p.id = f.id where first_open is not null)),
    'churn', jsonb_build_object(
        'previous_period', jsonb_build_object('from', d0 - n, 'to', d0 - 1),
        'active_previous', (select count(*) from prev), 'active_now', (select count(*) from cur),
        'kept', (select count(*) from prev where player_id in (select player_id from cur)),
        'churned', (select count(*) from prev where player_id not in (select player_id from cur)),
        'churn_rate', case when (select count(*) from prev) > 0 then round((select count(*) from prev where player_id not in (select player_id from cur))::numeric / (select count(*) from prev), 4) end,
        'new_active', (select count(*) from cur where player_id in (select id from joined)),
        'returned', (select count(*) from cur where player_id not in (select player_id from prev) and player_id not in (select id from joined))),
    'feature_reach', jsonb_build_object('active', (select count(*) from cur),
        'features', (select coalesce(jsonb_agg(jsonb_build_object('feature', f, 'members', m,
                       'share', case when (select count(*) from cur) > 0 then round(m::numeric / (select count(*) from cur), 4) end) order by f), '[]')
                       from (select f, count(distinct player_id) m from feat where f is not null group by 1) x)))
  into v;
  return v;
end $$;

comment on function public.admin_growth(date, date) is
$c$[admin] Growth of one period (default the last 28 game days). new_by_day and new_by_week (players.created_at as a game day; a week starts on Monday). cohorts: for each join week, the share of its members active (admin_active_days, game rows) in week 0, 1, 2 ... (only weeks that ended by p_to). retention d1, d7, d30: of the members who joined in the period with join day + N <= p_to, the share active on exactly join day + N. funnel of the members who joined in the period, each step up to the period end: claimed_welcome (gift_claims kind new_player claimed), opened_first_pack (pack_ledger opened), first_fight (hunt_combat_log, combat_actions support or dungeon_runs), first_trade (trade_offers made or countered, trade_listings, auctions, auction_bids, a card_trades swap on either side), active_week2 (active on a day from join + 7 to join + 13, only members with join + 13 <= p_to), median_hours_to_first_open. churn: the period before of the same length against this one (kept, churned, churn_rate, new_active, returned). feature_reach: of the members active in the period, the share that used packs, hunt, dungeon, gauntlet, trades, auctions, effects, dailies, achievements, shop, gifts. Service role only.$c$;

-- ============================================================ 11. one card
create or replace function public.admin_card(p_card bigint)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare k cards; v jsonb;
begin
  select * into k from cards where id = p_card;
  if not found then return jsonb_build_object('found', false, 'card', p_card); end if;
  with ca as (select a.mode, a.kind, a.card_id, a.target_card, a.result from combat_actions a
               where a.mode in ('dungeon', 'gauntlet') and (a.card_id = p_card or a.target_card = p_card))
  select jsonb_build_object('found', true,
    'card', jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity::text, 'source', k.source::text, 'subject_id', k.subject_id,
        'subject', (select s.name from subjects s where s.id = k.subject_id), 'type', (select s.type from subjects s where s.id = k.subject_id),
        'season', k.season, 'event', k.event, 'in_draw_pool', k.in_draw_pool, 'tradeable', k.tradeable, 'image_url', k.image_url, 'created_at', k.created_at),
    'owners', (select count(*) from player_cards where card_id = p_card and quantity > 0),
    'copies', (select coalesce(sum(quantity), 0) from player_cards where card_id = p_card),
    'stars', (select coalesce(sum(ascension), 0) from player_cards where card_id = p_card),
    'by_star', (select coalesce(jsonb_agg(jsonb_build_object('stars', a, 'owners', o, 'copies', c) order by a), '[]')
                  from (select ascension a, count(*) o, sum(quantity) c from player_cards where card_id = p_card group by 1) x),
    'with_stat_points', (select count(*) from player_cards where card_id = p_card and stat_points <> '{}'::jsonb),
    'top_owners', (select coalesce(jsonb_agg(jsonb_build_object('player_id', x.player_id, 'username', x.username, 'copies', x.quantity, 'stars', x.ascension)
                                 order by x.ascension desc, x.quantity desc, x.player_id), '[]')
                     from (select pc.player_id, p.username, pc.quantity, pc.ascension from player_cards pc join players p on p.id = pc.player_id
                            where pc.card_id = p_card order by pc.ascension desc, pc.quantity desc, pc.player_id limit 10) x),
    'pulls', jsonb_build_object(
        'since', admin_pulls_since(),
        'total', (select coalesce(sum(amount), 0) from card_ledger where card_id = p_card and reason = 'pack' and amount > 0),
        'first', (select min(created_at) from card_ledger where card_id = p_card and reason = 'pack' and amount > 0),
        'last', (select max(created_at) from card_ledger where card_id = p_card and reason = 'pack' and amount > 0),
        'by_week', (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'pulls', n) order by w), '[]')
                      from (select date_trunc('week', game_day(created_at))::date w, sum(amount) n from card_ledger
                             where card_id = p_card and reason = 'pack' and amount > 0 group by 1) x)),
    'in_by_reason', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'copies', s) order by reason), '[]')
                       from (select reason, sum(amount) s from card_ledger where card_id = p_card and amount > 0 group by 1) x),
    'out_by_reason', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'copies', s) order by reason), '[]')
                        from (select reason, -sum(amount) s from card_ledger where card_id = p_card and amount < 0 group by 1) x),
    'trading', jsonb_build_object(
        'swaps', (select count(*) from card_trades t where p_card = any (t.from_cards || t.to_cards)),
        'offers_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from trade_offers
                               where offer_card_id = p_card or request_card_id = p_card group by 1) x),
        'listings', (select count(*) from trade_listings where card_id = p_card),
        'listings_open', (select count(*) from trade_listings where card_id = p_card and status = 'open'),
        'auctions', (select count(*) from auctions where card_id = p_card),
        'auctions_sold', (select count(*) from auctions where card_id = p_card and status = 'sold'),
        'wishlisted_now', (select count(*) from wishlists where card_id = p_card),
        'top_want_now', (select count(*) from wishlists where card_id = p_card and top),
        'wishlist_adds', (select count(*) from wishlist_log where card_id = p_card and op in ('add', 'replace'))),
    'hunt', jsonb_build_object(
        'hunts', (select count(distinct hunt_id) from hunt_hits where card_id = p_card),
        'damage', (select coalesce(sum(damage), 0) from hunt_hits where card_id = p_card),
        'attacks', (select count(*) from hunt_combat_log where card_id = p_card),
        'supports', (select count(*) from combat_actions where mode = 'hunt' and kind = 'support' and card_id = p_card),
        'squads', (select count(*) from hunt_squads where p_card = any (card_ids))),
    'dungeon', (select coalesce(jsonb_agg(jsonb_build_object('mode', m.mode,
                    'runs', (select count(*) from dungeon_runs r where r.mode = m.run_mode and p_card = any (r.squad)),
                    'attacks', (select count(*) from ca where ca.mode = m.mode and ca.kind = 'attack' and ca.card_id = p_card),
                    'damage', (select coalesce(sum((ca.result->>'value')::numeric), 0) from ca where ca.mode = m.mode and ca.card_id = p_card
                                 and ca.kind in ('attack', 'support') and ca.result->>'side' = 'foe' and ca.result->>'dir' = 'dmg'),
                    'supports', (select count(*) from ca where ca.mode = m.mode and ca.kind = 'support' and ca.card_id = p_card),
                    'healed', (select coalesce(sum((ca.result->>'value')::numeric), 0) from ca where ca.mode = m.mode and ca.card_id = p_card
                                 and ca.result->>'side' = 'card' and ca.result->>'dir' = 'heal'),
                    'taken', (select coalesce(sum((ca.result->>'value')::numeric), 0) from ca where ca.mode = m.mode and ca.target_card = p_card
                                and ca.result->>'side' = 'card' and ca.result->>'dir' = 'dmg'),
                    'downs', (select count(*) from ca where ca.mode = m.mode and ca.target_card = p_card and ca.result->>'side' = 'card'
                                and ca.result->>'dir' = 'dmg' and (ca.result->>'hp_after')::numeric = 0 and (ca.result->>'value')::numeric > 0)) order by m.mode), '[]')
                  from (values ('dungeon', 'daily'), ('gauntlet', 'gauntlet')) m(mode, run_mode)),
    'plays', jsonb_build_object(
        'total', (select count(*) from card_plays where card_id = p_card),
        'by_primitive', (select coalesce(jsonb_agg(jsonb_build_object('primitive', primitive, 'kind', kind, 'plays', n, 'applied', a, 'blocked', b, 'refunded', r)
                                   order by n desc, primitive), '[]')
                           from (select primitive, kind, count(*) n, count(*) filter (where outcome = 'applied') a, count(*) filter (where outcome = 'blocked') b,
                                        count(*) filter (where outcome = 'refunded') r from card_plays where card_id = p_card group by 1, 2) x)))
  into v;
  return v;
end $$;

comment on function public.admin_card(bigint) is
$c$[admin] One card on one page: the card (cards, subjects name and type), owners, copies and stars now and by star level (player_cards), with_stat_points, top_owners (the 10 owners with the most stars, then copies), pulls (card_ledger reason pack: since = admin_pulls_since(), total, first, last, by week), in_by_reason and out_by_reason (card_ledger, all time), trading (card_trades swaps that hold the card, trade_offers by status, trade_listings, auctions, wishlists now, wishlist_log adds), hunt (hunt_hits hunts and damage, hunt_combat_log attacks, combat_actions supports, hunt_squads), dungeon per mode (dungeon_runs with the card in the squad; combat_actions mode dungeon / gauntlet: attacks, damage to foes, supports, HP healed, damage taken, downs), plays (card_plays by primitive). {found: false} for an unknown id. Service role only.$c$;

-- ============================================================ 12. the Dungeon and the Gauntlet
create or replace function public.admin_dungeon(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  pr jsonb := admin_period(p_from, p_to, 30);
  d0 date := (pr->>'from')::date; d1 date := (pr->>'to')::date;
  t0 timestamptz := (pr->>'t0')::timestamptz; t1 timestamptz := (pr->>'t1')::timestamptz;
  -- The combat log began with dungeon_combat_log.sql: an older run has no combat_actions rows and is not reconciled.
  v_log timestamptz := coalesce((select min(applied_at) from schema_migrations where file = 'dungeon_combat_log.sql'), 'infinity');
  v jsonb;
begin
  with
  runs as (select * from dungeon_runs r where r.day between d0 and d1),
  ca as (select a.* from combat_actions a where a.mode in ('dungeon', 'gauntlet') and a.created_at >= t0 and a.created_at < t1),
  -- A kill: a dungeon_log attack or support whose result holds the kill state; the foe is the target slot of that state.
  kills as (
    select r.mode, f->>'key' as key, coalesce(f->>'kind', 'fight') as kind
      from runs r join dungeon_log l on l.run_id = r.id
      cross join lateral (select l.result->'kill'->'state'->'foes'->(coalesce(l.action->>'target', l.action->>'target_foe'))::int as f) x
     where jsonb_typeof(l.result->'kill') = 'object' and coalesce(l.action->>'target', l.action->>'target_foe') ~ '^[0-9]+$'),
  downs as (
    select r.mode, count(*) n from runs r, jsonb_each(case when jsonb_typeof(r.state->'cards') = 'object' then r.state->'cards' else '{}' end) c
     where r.status = 'over' and (c.value->>'down')::boolean is true group by 1),
  rec as (select r.id, r.mode, (select count(*) from dungeon_damage_reconcile(r.id) d where d.unexplained <> 0) rows_bad,
                 (select coalesce(sum(abs(d.unexplained)), 0) from dungeon_damage_reconcile(r.id) d) hp_bad
            from runs r where r.started_at >= v_log),
  cards_dmg as (
    select coalesce(a.card_id, a.target_card) card_id, a.mode,
           count(*) filter (where a.kind = 'attack' and a.card_id is not null) attacks,
           coalesce(sum((a.result->>'value')::numeric) filter (where a.card_id is not null and a.kind in ('attack', 'support') and a.result->>'side' = 'foe' and a.result->>'dir' = 'dmg'), 0) damage,
           count(*) filter (where a.card_id is not null and a.kind in ('attack', 'support') and a.result->>'side' = 'foe' and a.result->>'dir' = 'dmg'
                              and (a.result->>'hp_after')::numeric = 0 and (a.result->>'value')::numeric > 0) foes_down,
           count(*) filter (where a.kind = 'attack' and (a.result->>'crit')::boolean is true) crits,
           count(*) filter (where a.kind = 'support' and a.card_id is not null) supports,
           coalesce(sum((a.result->>'value')::numeric) filter (where a.card_id is not null and a.result->>'side' = 'card' and a.result->>'dir' = 'heal'), 0) healed,
           coalesce(sum((a.result->>'value')::numeric) filter (where a.card_id is null and a.result->>'side' = 'card' and a.result->>'dir' = 'dmg'), 0) taken,
           count(*) filter (where a.card_id is null and a.result->>'side' = 'card' and a.result->>'dir' = 'dmg'
                              and (a.result->>'hp_after')::numeric = 0 and (a.result->>'value')::numeric > 0) downs
      from (select a.mode, a.kind, a.card_id, null::bigint target_card, a.result from ca a where a.card_id is not null
            union all
            -- the damage a card took: the row of the foe (or the poison, the thorns) that hit it, counted on the target card
            select a.mode, a.kind, null, a.target_card, a.result from ca a where a.target_card is not null and a.result->>'side' = 'card') a
     group by 1, 2),
  cd as (select c.card_id, sum(c.attacks) attacks, sum(c.damage) damage, sum(c.damage) filter (where c.mode = 'dungeon') damage_dungeon,
                sum(c.damage) filter (where c.mode = 'gauntlet') damage_gauntlet, sum(c.foes_down) foes_down, sum(c.crits) crits, sum(c.supports) supports,
                sum(c.healed) healed, sum(c.taken) taken, sum(c.downs) downs
           from cards_dmg c group by 1),
  pay as (select * from dungeon_payouts p where p.paid_at >= t0 and p.paid_at < t1)
  select jsonb_build_object(
    'period', pr - 't0' - 't1',
    'by_mode', (select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'runs', n, 'members', m, 'cleared', c, 'fell', f, 'retreat', rt, 'abandoned', ab, 'active', act,
                    'shards', s, 'cards', cs, 'best_floor', bf, 'avg_floor', af, 'avg_rooms', ar, 'avg_turns', avg_t) order by mode), '[]')
                  from (select r.mode, count(*) n, count(distinct r.player_id) m, count(*) filter (where r.ended_by = 'cleared') c,
                               count(*) filter (where r.ended_by = 'fell') f, count(*) filter (where r.ended_by = 'retreat') rt,
                               count(*) filter (where r.ended_by = 'abandoned') ab, count(*) filter (where r.status = 'active') act,
                               sum(r.shards) s, sum(cardinality(r.cards)) cs, max(r.floor) bf, round(avg(r.floor), 2) af,
                               round(avg((r.floor - 1) * 5 + r.room), 2) ar, round(avg(r.turns), 2) avg_t from runs r group by 1) x),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'mode', mode, 'runs', n, 'members', m, 'cleared', c, 'fell', f, 'shards', s) order by day, mode), '[]')
                 from (select r.day, r.mode, count(*) n, count(distinct r.player_id) m, count(*) filter (where r.ended_by = 'cleared') c,
                              count(*) filter (where r.ended_by = 'fell') f, sum(r.shards) s from runs r group by 1, 2) x),
    -- floors and rooms reached: where each run stands (active) or ended
    'reached', (select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'floor', floor, 'room', room, 'runs', n, 'fell', f) order by mode, floor, room), '[]')
                  from (select r.mode, r.floor, r.room, count(*) n, count(*) filter (where r.ended_by = 'fell') f from runs r group by 1, 2, 3) x),
    'deaths', jsonb_build_object(
        'runs_fell', (select count(*) from runs where ended_by = 'fell'),
        'cards_down_at_end', (select coalesce(jsonb_object_agg(mode, n), '{}') from downs),
        'card_downs_logged', (select count(*) from ca where ca.result->>'side' = 'card' and ca.result->>'dir' = 'dmg'
                                and (ca.result->>'hp_after')::numeric = 0 and (ca.result->>'value')::numeric > 0)),
    'kills', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'kills', n, 'daily', dl, 'gauntlet', gt, 'by_kind', bk) order by n desc, key), '[]')
                from (select k.key, (select m.name from dungeon_monsters m where m.key = k.key) name, count(*) n,
                             count(*) filter (where k.mode = 'daily') dl, count(*) filter (where k.mode = 'gauntlet') gt,
                             (select jsonb_object_agg(kind, c) from (select k2.kind, count(*) c from kills k2 where k2.key is not distinct from k.key group by 1) z) bk
                        from kills k group by k.key) x),
    'kills_total', (select count(*) from kills),
    'paid', jsonb_build_object(
        'shards_by_source', (select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'source', src, 'shards', s, 'rows', n) order by mode, src), '[]')
                               from (select case when l.ref_kind = 'dungeon_payout' then split_part(l.ref_id, ':', 1) else coalesce(r.mode, 'no_run') end mode,
                                            l.ref_kind src, sum(l.amount) s, count(*) n
                                       from shard_ledger l left join dungeon_runs r on l.ref_kind <> 'dungeon_payout' and r.id::text = l.ref_id
                                      where l.reason = 'dungeon' and l.created_at >= t0 and l.created_at < t1 group by 1, 2) x),
        'shards', (select coalesce(sum(amount), 0) from shard_ledger where reason = 'dungeon' and created_at >= t0 and created_at < t1),
        'cards_by_rarity', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'rarity', rarity, 'copies', s) order by reason, rarity_rank(rarity), rarity), '[]')
                              from (select c.reason, k.rarity::text rarity, sum(c.amount) s from card_ledger c join cards k on k.id = c.card_id
                                     where c.reason in ('dungeon_loot', 'dungeon_prize') and c.amount > 0 and c.created_at >= t0 and c.created_at < t1 group by 1, 2) x),
        'cards', (select coalesce(sum(amount), 0) from card_ledger where reason in ('dungeon_loot', 'dungeon_prize') and amount > 0 and created_at >= t0 and created_at < t1),
        'packs', (select coalesce(sum(amount), 0) from pack_ledger where reason = 'dungeon_prize' and created_at >= t0 and created_at < t1),
        'boards', (select coalesce(jsonb_agg(jsonb_build_object('mode', p.mode, 'period', p.period, 'paid_at', p.paid_at, 'winners', jsonb_array_length(p.winners),
                        'shards', (select coalesce(sum((w->>'shards')::int), 0) from jsonb_array_elements(p.winners) w),
                        'packs', (select coalesce(sum((w->>'packs')::int), 0) from jsonb_array_elements(p.winners) w),
                        'cards', (select coalesce(sum(jsonb_array_length(coalesce(w->'cards', '[]'))), 0) from jsonb_array_elements(p.winners) w)) order by p.paid_at, p.mode), '[]')
                     from pay p)),
    'gauntlet_weeks', (select coalesce(jsonb_agg(jsonb_build_object('week', g.week, 'name', g.name, 'theme', g.theme,
                           'squad', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity::text) order by o), '[]')
                                       from unnest(g.squad) with ordinality u(cid, o) left join cards k on k.id = u.cid),
                           'runs', (select count(*) from dungeon_runs r where r.mode = 'gauntlet' and r.day between g.week and g.week + 6),
                           'members', (select count(distinct player_id) from dungeon_runs r where r.mode = 'gauntlet' and r.day between g.week and g.week + 6),
                           'cleared', (select count(*) from dungeon_runs r where r.mode = 'gauntlet' and r.day between g.week and g.week + 6 and r.ended_by = 'cleared'),
                           'best', (select jsonb_build_object('floor', r.floor, 'room', r.room, 'turns', r.turns) from dungeon_runs r
                                     where r.mode = 'gauntlet' and r.day between g.week and g.week + 6 order by r.floor desc, r.room desc, r.turns, r.id limit 1),
                           'paid', exists (select 1 from dungeon_payouts p where p.mode = 'gauntlet' and p.period = g.week)) order by g.week desc), '[]')
                         from gauntlet_weeks g where g.week <= d1 and g.week + 6 >= d0),
    'card_damage', (select coalesce(jsonb_agg(jsonb_build_object('card_id', cd.card_id, 'name', k.name, 'rarity', k.rarity::text, 'attacks', cd.attacks,
                        'damage', cd.damage, 'damage_dungeon', coalesce(cd.damage_dungeon, 0), 'damage_gauntlet', coalesce(cd.damage_gauntlet, 0),
                        'foes_down', cd.foes_down, 'crits', cd.crits, 'supports', cd.supports, 'healed', cd.healed, 'taken', cd.taken, 'downs', cd.downs)
                        order by cd.damage desc, cd.card_id), '[]')
                      from (select * from cd order by damage desc, card_id limit 100) cd left join cards k on k.id = cd.card_id),
    'combat_rows', (select count(*) from ca),
    'reconcile', jsonb_build_object(
        'log_from', case when v_log = 'infinity' then null else v_log end,
        'runs_checked', (select count(*) from rec),
        'runs_ok', (select count(*) from rec where rows_bad = 0),
        'runs_before_log', (select count(*) from runs where started_at < v_log),
        'rows_unexplained', (select coalesce(sum(rows_bad), 0) from rec),
        'hp_unexplained', (select coalesce(sum(hp_bad), 0) from rec),
        'ok', not exists (select 1 from rec where rows_bad <> 0),
        'bad_runs', (select coalesce(jsonb_agg(jsonb_build_object('run', id, 'mode', mode, 'rows', rows_bad, 'hp', hp_bad) order by id desc), '[]')
                       from (select * from rec where rows_bad <> 0 order by id desc limit 20) x)))
  into v;
  return v;
end $$;

comment on function public.admin_dungeon(date, date) is
$c$[admin] The Dungeon and the Gauntlet in one period (default the last 30 game days; a run counts on dungeon_runs.day). by_mode (runs, members, cleared, fell, retreat, abandoned, active, shards and cards paid by the runs, best and average floor, average rooms reached = (floor - 1) x 5 + room, average turns) and by_day (dungeon_runs). reached: runs by the floor and room where they stand or ended. deaths: runs that fell, the cards down at the end (dungeon_runs.state), the card downs in the log (combat_actions). kills: foes killed by monster type (dungeon_log attack and support rows with a kill: the foe of the target slot; dungeon_monsters name) by mode and kind. paid: Shards by mode and source (shard_ledger reason dungeon: run, kill, room, reward, dungeon_payout; mode no_run = the ref names no dungeon_runs row), cards by rarity (card_ledger dungeon_loot, dungeon_prize), packs (pack_ledger dungeon_prize), the boards paid (dungeon_payouts). gauntlet_weeks: the weeks that touch the period (gauntlet_weeks with the squad, runs, members, cleared, best run, paid). card_damage: the top 100 cards (combat_actions mode dungeon / gauntlet in the period: attacks, damage to foes split by mode, foes down, crits, supports, HP healed, damage taken, downs). reconcile: dungeon_damage_reconcile of each run of the period started after dungeon_combat_log.sql (schema_migrations): runs checked and ok, rows and HP unexplained, the bad runs; older runs have no log. Service role only.$c$;

-- ============================================================ 13. the game feed
create or replace function public.admin_feed_kinds()
returns text[] language sql immutable security invoker set search_path = public as $$
  select array['admin', 'settings', 'balance', 'member', 'pull', 'trade', 'auction', 'hunt', 'dungeon', 'effect', 'report']::text[];
$$;

comment on function public.admin_feed_kinds() is
$c$[admin] The kinds of admin_feed, one list: admin, settings, balance, member, pull, trade, auction, hunt, dungeon, effect, report. Service role only.$c$;

create or replace function public.admin_feed(p_kinds text[] default null, p_before timestamptz default null, p_limit integer default 50, p_before_key text default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_all text[] := admin_feed_kinds();
  v_k text[] := case when p_kinds is null or cardinality(p_kinds) = 0 then admin_feed_kinds() else p_kinds end;
  v_bad text[];
  v jsonb;
begin
  select array_agg(k order by k) into v_bad from unnest(v_k) k where not k = any (v_all);
  if v_bad is not null then raise exception 'admin_feed: unknown kind % (see admin_feed_kinds)', array_to_string(v_bad, ', '); end if;
  with ev(at, key, kind, text, player_id, other_id, actor, amount, ref) as (
    select a.at, 'admin:' || a.id, 'admin', 'Admin ' || a.action || coalesce(' on ' || a.target_kind || coalesce(' ' || a.target_id, ''), '') || coalesce(': ' || nullif(a.reason, ''), ''),
           case when a.target_kind in ('player', 'member') then a.target_id end, null::text, a.actor || ' (' || a.source || ')', null::numeric, 'admin_action:' || a.id
      from admin_actions a where 'admin' = any (v_k)
    union all
    select s.changed_at, 'settings:' || s.id, 'settings', 'Setting ' || s.key || ' ' || s.op, null, null, s.changed_by, null, 'settings_log:' || s.id
      from settings_log s where 'settings' = any (v_k)
    union all
    select b.changed_at, 'balance:' || b.id, 'balance', 'Balance ' || b.key || ' ' || b.op, null, null, b.changed_by, null, 'balance_log:' || b.id
      from balance_log b where 'balance' = any (v_k)
    union all
    select p.created_at, 'member_new:' || p.id, 'member', 'New member', p.id, null, null, null, null from players p where 'member' = any (v_k)
    union all
    select p.left_guild_at, 'member_left:' || p.id, 'member', 'Left the Discord server', p.id, null, null, null, null
      from players p where 'member' = any (v_k) and p.left_guild_at is not null
    union all
    -- a big pull: a Secret Rare or rarer from a pack (rarity_rank 2 or more)
    select c.created_at, 'pull:' || c.id, 'pull', 'Pulled ' || initcap(replace(k.rarity::text, '_', ' ')) || ': ' || k.name, c.player_id, null, null, null, 'card:' || k.id
      from card_ledger c join cards k on k.id = c.card_id
     where 'pull' = any (v_k) and c.reason = 'pack' and c.amount > 0 and rarity_rank(k.rarity::text) >= 2
    union all
    select t.created_at, 'trade:' || t.id, 'trade', 'Trade (' || t.kind || '): ' || cardinality(t.from_cards) || ' for ' || cardinality(t.to_cards) || ' cards',
           t.from_id, t.to_id, null, null, coalesce('trade_offer:' || t.offer_id, 'auction:' || t.auction_id)
      from card_trades t where 'trade' = any (v_k)
    union all
    select u.created_at, 'auction:' || u.id, 'auction', 'Auction started: ' || coalesce(k.name, 'card ' || u.card_id), u.seller_id, null, null, null, 'auction:' || u.id
      from auctions u left join cards k on k.id = u.card_id where 'auction' = any (v_k)
    union all
    select u.settled_at, 'auction_end:' || u.id, 'auction', 'Auction ' || u.status || ': ' || coalesce(k.name, 'card ' || u.card_id), u.seller_id,
           (select b.bidder_id from auction_bids b where b.id = u.accepted_bid_id), null, null, 'auction:' || u.id
      from auctions u left join cards k on k.id = u.card_id where 'auction' = any (v_k) and u.settled_at is not null
    union all
    select h.opens_at, 'hunt_open:' || h.id, 'hunt', 'Boss spawned: ' || h.name || ' (' || h.tier || ')', null, null, null, h.hp_max, 'hunt:' || h.id
      from hunts h where 'hunt' = any (v_k) and h.opens_at <= now()
    union all
    select h.defeated_at, 'hunt_kill:' || h.id, 'hunt', 'Boss defeated: ' || h.name, null, null, null, null, 'hunt:' || h.id
      from hunts h where 'hunt' = any (v_k) and h.defeated_at is not null
    union all
    select h.settled_at, 'hunt_end:' || h.id, 'hunt', 'Hunt settled: ' || h.name || ' (' || h.status || ')', null, null, null, null, 'hunt:' || h.id
      from hunts h where 'hunt' = any (v_k) and h.settled_at is not null
    union all
    select r.ended_at, 'run_clear:' || r.id, 'dungeon', initcap(r.mode) || ' cleared (floor ' || r.floor || ')', r.player_id, null, null, r.shards, 'dungeon_run:' || r.id
      from dungeon_runs r where 'dungeon' = any (v_k) and r.ended_by = 'cleared' and r.ended_at is not null
    union all
    select p.paid_at, 'board:' || p.mode || ':' || p.period, 'dungeon',
           case when p.mode = 'daily' then 'Dungeon' else 'Gauntlet' end || ' board paid (' || p.period || '), winners: ' || jsonb_array_length(p.winners),
           null, null, null, null, 'dungeon_payout:' || p.mode || ':' || p.period
      from dungeon_payouts p where 'dungeon' = any (v_k)
    union all
    select e.created_at, 'play:' || e.id, 'effect', 'Played ' || e.primitive || ' (' || e.kind || '): ' || e.outcome, e.player_id,
           case when e.target_id <> e.player_id then e.target_id end, null, e.amount, 'card_play:' || e.id
      from card_plays e where 'effect' = any (v_k)
    union all
    select r.created_at, 'report:' || r.id, 'report', 'Report: ' || r.kind || coalesce(' (issue ' || r.issue_number || ')', ''), r.player_id, r.target_id, null, null,
           'player_report:' || r.id
      from player_reports r where 'report' = any (v_k)
  ),
  page as (
    select * from ev
     where ev.at is not null and (p_before is null or ev.at < p_before or (ev.at = p_before and p_before_key is not null and ev.key < p_before_key))
     order by ev.at desc, ev.key desc
     limit v_lim)
  select jsonb_build_object(
    'kinds', to_jsonb(v_k),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('at', pg.at, 'key', pg.key, 'kind', pg.kind, 'text', pg.text,
        'player_id', pg.player_id, 'username', (select p.username from players p where p.id = pg.player_id),
        'other_id', pg.other_id, 'other_name', (select p.username from players p where p.id = pg.other_id),
        'actor', pg.actor, 'amount', pg.amount, 'ref', pg.ref) order by pg.at desc, pg.key desc) from page pg), '[]'),
    'next', (select jsonb_build_object('before', at, 'before_key', key) from (select * from page order by at, key limit 1) l
              where (select count(*) from page) = v_lim))
  into v;
  return v;
end $$;

comment on function public.admin_feed(text[], timestamp with time zone, integer, text) is
$c$[admin] The newest events of the whole game, one feed, newest first: admin (admin_actions), settings (settings_log), balance (balance_log), member (players.created_at: new member; players.left_guild_at), pull (card_ledger reason pack of a Secret Rare or rarer: rarity_rank 2+), trade (card_trades), auction (auctions started and settled, the accepted bidder), hunt (hunts spawned, defeated, settled), dungeon (dungeon_runs cleared, dungeon_payouts boards paid), effect (card_plays), report (player_reports with target_id). p_kinds: only these kinds (null or empty = all; admin_feed_kinds lists them; another kind is refused). Each row: at, key, kind, text, player_id and username (the member who did it or the target of an admin action), other_id and other_name (the other side), actor (admin, settings and balance rows), amount, ref. Keyset pages like admin_member_timeline: (at, key) below (p_before, p_before_key); next is null on the last page. p_limit default 50, max 200. Service role only.$c$;

-- ============================================================ only the service role
do $g$
declare f text;
begin
  foreach f in array array[
    'public.admin_active_days(date,date)', 'public.admin_period(date,date,integer)', 'public.admin_overview(date,date)',
    'public.admin_economy(date,date,text)', 'public.admin_members(text,text,integer,integer)', 'public.admin_member(text)',
    'public.admin_member_timeline(text,timestamp with time zone,integer,text,text[])', 'public.admin_cards(date,date,text,integer,integer,text)',
    'public.admin_hunts(integer,integer)', 'public.admin_hunt(bigint)', 'public.admin_health()', 'public.admin_report_catalog()',
    'public.admin_report(text,jsonb)', 'public.admin_growth(date,date)', 'public.admin_timeline_kinds()', 'public.admin_card(bigint)',
    'public.admin_dungeon(date,date)', 'public.admin_feed_kinds()', 'public.admin_feed(text[],timestamp with time zone,integer,text)',
    'public.admin_pulls_since()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $g$;

notify pgrst, 'reload schema';
