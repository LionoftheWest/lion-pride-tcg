-- Two changes (Nathan, 2026-10-03). Test: card-studio/scripts/test-trade-ledger-raid-credit.mjs.
--
-- A. Raid Crasher credit counts ONLY for the raid. hunt_attack writes a hunt_hits row for the
--    prankster (options.credit_to) with the Raider card, so the hunt daily (count of hunt_hits
--    cards today) was done with no fight: player 147400772320100352 claimed it at 15:16 UTC with
--    only a credit row (their own first fight was at 15:28). The hunt daily now counts the cards
--    the player committed today (hunt_card_hp: hunt_commit_card, by an attack or a support play).
--    The crash credit makes no hunt_card_hp row. Raid damage, prizes and the leaderboard stay on
--    hunt_hits. (server.js: huntsJoined / bossesDefeated also read hunt_card_hp now.)
--
-- B. A trade ledger: public.card_trades, one row for each completed trade, with the cards that
--    each side gave. An auction is a trade too, and its winning bid can be several cards.
--      offer:   from_id = the sender (gave offer_card_id), to_id = the receiver (gave request_card_id)
--               (the card moves in accept_trade)
--      auction: from_id = the seller (gave auctions.card_id), to_id = the winning bidder (gave the
--               bid's cards) (the card moves in confirm_bid)
--    Triggers write the row in the same transaction as the trade: trade_offers.status becomes
--    'accepted' (accept_trade is the only live writer) and auctions.status becomes 'sold'
--    (confirm_bid is the only live writer). A trigger also catches any later writer, and
--    accept_trade / confirm_bid stay as they are live. The accepted offers and the sold auctions
--    before this file are backfilled (on conflict do nothing: safe to apply again).
--    Readers moved to card_trades: dailies_tasks (the social daily) and tradesDone (server.js).

create table if not exists public.card_trades (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('offer', 'auction')),
  from_id    text not null,
  to_id      text not null,
  from_cards bigint[] not null,
  to_cards   bigint[] not null,
  offer_id   bigint unique references public.trade_offers(id) on delete set null,
  auction_id bigint unique references public.auctions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists card_trades_from on public.card_trades (from_id, created_at);
create index if not exists card_trades_to on public.card_trades (to_id, created_at);
alter table public.card_trades enable row level security;
-- No anon / authenticated grants (lockdown_grants.sql). The service_role writes it through the triggers.
revoke all on public.card_trades from anon, authenticated;
grant select, insert, update, delete on public.card_trades to service_role;

create or replace function public.card_trades_from_offer()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into card_trades (kind, from_id, to_id, from_cards, to_cards, offer_id, created_at)
  values ('offer', new.from_id, new.to_id, array[new.offer_card_id],
          case when new.request_card_id is null then '{}'::bigint[] else array[new.request_card_id] end,
          new.id, coalesce(new.resolved_at, now()))
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists card_trades_offer on public.trade_offers;
create trigger card_trades_offer after insert or update of status on public.trade_offers
  for each row when (new.status = 'accepted') execute function public.card_trades_from_offer();

create or replace function public.card_trades_from_auction()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into card_trades (kind, from_id, to_id, from_cards, to_cards, auction_id, created_at)
  select 'auction', new.seller_id, b.bidder_id, array[new.card_id], b.cards, new.id, coalesce(new.settled_at, now())
    from auction_bids b where b.id = new.accepted_bid_id
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists card_trades_auction on public.auctions;
create trigger card_trades_auction after insert or update of status on public.auctions
  for each row when (new.status = 'sold') execute function public.card_trades_from_auction();

-- Backfill (idempotent).
insert into public.card_trades (kind, from_id, to_id, from_cards, to_cards, offer_id, created_at)
select 'offer', o.from_id, o.to_id, array[o.offer_card_id],
       case when o.request_card_id is null then '{}'::bigint[] else array[o.request_card_id] end,
       o.id, coalesce(o.resolved_at, o.created_at)
  from public.trade_offers o where o.status = 'accepted'
on conflict do nothing;

insert into public.card_trades (kind, from_id, to_id, from_cards, to_cards, auction_id, created_at)
select 'auction', a.seller_id, b.bidder_id, array[a.card_id], b.cards, a.id, coalesce(a.settled_at, now())
  from public.auctions a join public.auction_bids b on b.id = a.accepted_bid_id
 where a.status = 'sold'
on conflict do nothing;

-- The live dailies_tasks (pg_get_functiondef, 2026-10-03). Changed: the hunt count (hunt_card_hp)
-- and the social trade (card_trades, still not a same-card swap).
CREATE OR REPLACE FUNCTION public.dailies_tasks(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  d date := (now() at time zone 'America/Denver')::date;
  t0 timestamptz := d::timestamp at time zone 'America/Denver';
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  vneed int := coalesce((cfg->>'voice_minutes')::int, 30);
  hneed int := 1; -- one fight with the boss (an attack or a support play), not the 8-card daily cap
  msgs int; base boolean; bonus boolean; used int; mins int; social boolean; live boolean;
  prior int; ci boolean;
  claimed text[];
begin
  select message_count, base_claimed, bonus_claimed into msgs, base, bonus
    from daily_activity where player_id = p_player and activity_date = d;
  -- The player's own committed cards (an attack or a support play). Not hunt_hits: a Raid
  -- Crasher credit row there is raid damage only (trade_ledger_raid_credit.sql).
  select count(distinct card_id) into used from hunt_card_hp where player_id = p_player and hit_date = d;
  live := exists (select 1 from hunts where status = 'active' and opens_at <= now() and closes_at > now());
  select minutes into mins from voice_minutes where player_id = p_player and day = d;
  social := exists (select 1 from card_trades where created_at >= t0
                      and (from_id = p_player or to_id = p_player) and from_cards <> to_cards)
         or exists (select 1 from card_plays where player_id = p_player and kind = 'boon' and created_at >= t0
                      and aimed_at is not null and aimed_at <> p_player and outcome <> 'blocked');
  select coalesce(array_agg(task), '{}') into claimed from daily_claims where player_id = p_player and day = d;
  prior := checkin_streak(p_player, d);
  ci := 'checkin' = any(claimed);
  return jsonb_build_array(
    jsonb_build_object('task', 'checkin', 'done', true, 'claimed', ci,
      'streak', prior + case when ci then 1 else 0 end,
      'reward', 1 + case when (prior + 1) % 7 in (3, 0) then 1 else 0 end),
    jsonb_build_object('task', 'chat', 'auto', true, 'have', coalesce(msgs, 0), 'need', 25,
      'packs', (select coalesce(sum(amount), 0) from pack_ledger where player_id = p_player and reason in ('earned_daily', 'earned_bonus') and created_at >= t0), 'max', 2),
    jsonb_build_object('task', 'hunt', 'have', least(coalesce(used, 0), hneed), 'need', hneed, 'live', live,
      'done', coalesce(used, 0) >= hneed, 'claimed', 'hunt' = any(claimed), 'reward', 1),
    jsonb_build_object('task', 'voice', 'have', least(coalesce(mins, 0), vneed), 'need', vneed,
      'done', coalesce(mins, 0) >= vneed, 'claimed', 'voice' = any(claimed), 'reward', 1),
    jsonb_build_object('task', 'social', 'have', case when social then 1 else 0 end, 'need', 1,
      'done', social, 'claimed', 'social' = any(claimed), 'reward', 1));
end $function$;

notify pgrst, 'reload schema';
