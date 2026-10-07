-- Tiered achievement tracks (Nathan, 2026-10-03; draft fxdraft/3-achievements.md + his changes).
--
-- 24 tracks replace 38 old one-off achievements. Each track has 5 tiers (Bronze, Silver, Gold,
-- Diamond, Mythic). The activity tracks go on after Mythic in "+N" steps. The rewards are the same
-- for every track (ach_tier_reward):
--   Bronze 1 pack + 50 Shards        Silver 1 pack + 150 Shards     Gold 2 packs + 200 Shards + title
--   Diamond 3 packs + 400 Shards + title + Diamond frame (track icon)
--   Mythic 5 packs + 800 Shards + title + animated Mythic frame (track icon)
--   Mythic +N (each step) 5 packs + 200 Shards, the Mythic title with "+N"
-- New one-time "tag set" badges: own any version of every card subject with one origin or type
-- tag in a season (generated from the data, so Season 2 gets its own). Reward: ceil(n/10)+1 packs (balance achievement_rewards)
-- and the title "<Tag> Master S<n>". The 12 narrow one-offs and Season 1 Complete stay on the old
-- path (claim_achievement, rewards in tcg-activity/src/achievements.js).
--
-- The switch rule (Nathan): at the switch a member gets every tier already reached. Shards,
-- titles and frames are paid for all of them. Packs are NOT paid for a tier that the member's
-- CLAIMED old achievements already prove (achievement_switch_map: what each old key proves, in the
-- track's own unit). After the switch the 38 old keys are retired (claim_achievement refuses them).
--
-- One claim path: the SQL measures the tracks itself (ach_track_values), so the server cannot pay
-- a tier that is not reached. Each tier is one achievement_claims row (key 'track:<track>:<tier>',
-- a tag badge 'tag:<season>:<slug>'), so a tier pays once; the player row lock makes a repeated or
-- parallel call safe. Packs: grant_packs(.., 'achievement', key). Shards: grant_shards(.., 'milestone').
--
-- Data that did not exist (draft section 7): Wish Granter is captured from now on (wish_grants,
-- written by triggers on card_trades and on a card gift). On a Roll (best check-in streak),
-- Podium (top 3 of a settled raid), Trainer (stat points assigned) and Voice + Chat come from rows
-- that already exist (daily_claims, hunt_hits, player_cards.stat_points, daily_activity).
--
-- Flag: settings.achievement_tracks = {"enabled": false, "users": []} (default OFF, fails closed).
-- OFF: the old 50 achievements work as before; every tier RPC refuses. "users" turns it on for
-- named members first. Test: card-studio/scripts/test-achievement-tracks.mjs. Idempotent.

-- Needs the trade ledger (trade_ledger_raid_credit.sql): Trader and Wish Granter read card_trades.
-- balance_table.sql first (the rewards live in public.balance), and claim_achievement only from the live text it was
-- built from (or its own result): another change to it stops the file, so that change is never reverted.
do $g$ begin
  if to_regclass('public.balance') is null then raise exception 'apply balance_table.sql first (public.balance is missing)'; end if;
  if md5(replace(pg_get_functiondef('public.claim_achievement(text,text,integer,text,text)'::regprocedure), chr(13), '')) not in ('15d09cb60014fc959b647d1c3dc55ebb', 'd0bb69a4c07462ca5db3b9c97ab457b3') then
    raise exception 'achievement_tracks.sql: the live claim_achievement changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;

do $guard$ begin
  if to_regclass('public.card_trades') is null then
    raise exception 'apply trade_ledger_raid_credit.sql first (public.card_trades is missing)';
  end if;
end $guard$;

alter table public.achievement_claims add column if not exists shards integer not null default 0;

insert into public.settings (key, value) values ('achievement_tracks', '{"enabled": false, "users": []}'::jsonb)
  on conflict (key) do nothing;

-- ---- The 24 tracks --------------------------------------------------------------------------
create table if not exists public.achievement_tracks (
  key        text primary key,
  ord        int  not null,
  grp        text not null,
  name       text not null,
  tiers      int[] not null check (cardinality(tiers) = 5),
  step       int check (step is null or step > 0),   -- null = finite (no Mythic +N)
  titles     text[] not null check (cardinality(titles) = 3) -- Gold, Diamond, Mythic
);
alter table public.achievement_tracks enable row level security;

insert into public.achievement_tracks (key, ord, grp, name, tiers, step, titles) values
  ('collector',    1, 'Collection', 'Collector',     '{25,75,150,250,350}',            null,   '{"Collector","Archivist","Living Library"}'),
  ('shine',        2, 'Collection', 'Shine',         '{1,10,30,75,150}',               null,   '{"Shiny Hunter","Prism Seeker","Radiant"}'),
  ('elementalist', 3, 'Collection', 'Elementalist',  '{10,30,60,110,167}',             null,   '{"Elementalist","Element Sage","Avatar of the Pride"}'),
  ('fullsets',     4, 'Collection', 'Full Sets',     '{1,5,15,35,71}',                 null,   '{"Completionist","Set Master","Grand Curator"}'),
  ('ascension',    5, 'Collection', 'Ascension',     '{1,10,40,100,200}',              null,   '{"Rising Star","Star Forger","Ascended"}'),
  ('trainer',      6, 'Collection', 'Trainer',       '{3,15,45,120,300}',              null,   '{"Coach","Head Trainer","Legendary Trainer"}'),
  ('packs',        7, 'Packs',      'Pack Opener',   '{10,50,150,400,1000}',           250,    '{"Pack Rat","Rip King","Pack Legend"}'),
  ('generous',     8, 'Packs',      'Generous',      '{1,5,15,40,100}',                50,     '{"Generous","Big Heart","Patron of the Pride"}'),
  ('trader',       9, 'Market',     'Trader',        '{1,5,15,40,100}',                50,     '{"Trader","Deal Maker","Trade Baron"}'),
  ('market',      10, 'Market',     'Market',        '{1,5,15,40,100}',                50,     '{"Merchant","Auctioneer","Market Mogul"}'),
  ('wish',        11, 'Market',     'Wish Granter',  '{1,3,10,25,60}',                 25,     '{"Wish Granter","Genie","Fairy Godparent"}'),
  ('shards',      12, 'Shards',     'Shard Earner',  '{500,2500,10000,30000,75000}',   25000,  '{"Shard Miner","Crystal Keeper","Shard Tycoon"}'),
  ('shopper',     13, 'Shards',     'Shopper',       '{1,10,30,75,150}',               50,     '{"Shopper","VIP","Big Spender"}'),
  ('recycler',    14, 'Shards',     'Recycler',      '{10,50,200,500,1500}',           500,    '{"Recycler","Dupe Smelter","Alchemist"}'),
  ('grind',       15, 'Dailies',    'Daily Grind',   '{10,50,150,400,1000}',           250,    '{"Grinder","Clockwork","Never Misses"}'),
  ('streak',      16, 'Dailies',    'On a Roll',     '{3,7,14,30,60}',                 30,     '{"On a Roll","Unbroken","Eternal Flame"}'),
  ('raider',      17, 'Hunt',       'Hunter',        '{1,4,10,20,40}',                 10,     '{"Hunter","Veteran Hunter","Warlord"}'),
  ('heavy',       18, 'Hunt',       'Heavy Hitter',  '{2500,10000,40000,100000,250000}', 100000, '{"Heavy Hitter","Wrecking Ball","Titan Breaker"}'),
  ('bighit',      19, 'Hunt',       'Big Hit',       '{400,900,1600,2600,4000}',       null,   '{"Big Hitter","One-Shot","Meteor"}'),
  ('slayer',      20, 'Hunt',       'Boss Slayer',   '{1,3,8,15,30}',                  10,     '{"Boss Slayer","Titan Slayer","Dragon''s Bane"}'),
  ('podium',      21, 'Hunt',       'Podium',        '{1,3,8,15,30}',                  10,     '{"Podium Finisher","Champion","Hall of Famer"}'),
  ('prankster',   22, 'Social',     'Prankster',     '{5,25,75,200,500}',              100,    '{"Prankster","Menace","Agent of Chaos"}'),
  ('vibes',       23, 'Social',     'Good Vibes',    '{1,10,30,75,200}',               50,     '{"Good Vibes","Ray of Sunshine","Heart of the Pride"}'),
  ('voice',       24, 'Social',     'Voice + Chat',  '{3,10,30,75,150}',               50,     '{"Chatterbox","Life of the Party","Voice of the Pride"}')
on conflict (key) do update set ord = excluded.ord, grp = excluded.grp, name = excluded.name,
  tiers = excluded.tiers, step = excluded.step, titles = excluded.titles;

-- ---- The switch: what each claimed old key proves, in the track's own unit ------------------
-- A tier's packs count as already paid when the proven value reaches the tier's need.
-- adds = true: the old keys count disjoint sets, so their proofs add up (the 7 element keys,
-- 5 element cards each). Otherwise the largest proof counts. A key that proves less than Bronze
-- (first, own10, dmg1k, double5) saves no tier.
create table if not exists public.achievement_switch_map (
  old_key text primary key,
  track   text not null references public.achievement_tracks (key),
  proves  int  not null check (proves >= 0),
  adds    boolean not null default false
);
alter table public.achievement_switch_map enable row level security;

insert into public.achievement_switch_map (old_key, track, proves, adds) values
  ('first', 'collector', 1, false), ('own10', 'collector', 10, false), ('own25', 'collector', 25, false),
  ('own50', 'collector', 50, false), ('own100', 'collector', 100, false),
  ('ir1', 'shine', 1, false), ('sr1', 'shine', 1, false), ('fa1', 'shine', 1, false), ('g1', 'shine', 1, false),
  ('ir10', 'shine', 10, false), ('sr5', 'shine', 5, false), ('fa5', 'shine', 5, false), ('g5', 'shine', 5, false),
  ('fire5', 'elementalist', 5, true), ('light5', 'elementalist', 5, true), ('lightning5', 'elementalist', 5, true),
  ('nature5', 'elementalist', 5, true), ('shadow5', 'elementalist', 5, true), ('psychic5', 'elementalist', 5, true),
  ('water5', 'elementalist', 5, true), ('rainbow', 'elementalist', 8, false),
  ('fullset', 'fullsets', 1, false), ('double5', 'fullsets', 0, false),
  ('asc1', 'ascension', 1, false), ('asc3', 'ascension', 3, false), ('asc5', 'ascension', 5, false),
  ('packs10', 'packs', 10, false), ('gift1', 'generous', 1, false), ('trade1', 'trader', 1, false),
  ('hunt1', 'raider', 1, false), ('hunt4', 'raider', 4, false),
  ('dmg1k', 'heavy', 1000, false), ('hit500', 'bighit', 500, false),
  ('slay1', 'slayer', 1, false), ('slay3', 'slayer', 3, false),
  ('boon1', 'vibes', 1, false), ('prank5', 'prankster', 5, false)
on conflict (old_key) do update set track = excluded.track, proves = excluded.proves, adds = excluded.adds;

-- ---- Wish Granter: captured from now on ------------------------------------------------------
-- One row for each card that a member gave (trade, sold auction, card gift) while the card was on
-- the receiver's wishlist. No back-history: the wishlist at the time of older trades is unknown.
create table if not exists public.wish_grants (
  id          bigint generated always as identity primary key,
  giver_id    text not null references public.players (id) on delete cascade,
  receiver_id text not null references public.players (id) on delete cascade,
  card_id     bigint not null,
  source      text not null check (source in ('trade', 'auction', 'gift')),
  ref_id      bigint not null,
  created_at  timestamptz not null default now(),
  unique (source, ref_id, giver_id, card_id)
);
create index if not exists wish_grants_giver on public.wish_grants (giver_id);
alter table public.wish_grants enable row level security;

create or replace function public.ach_wish_grant(p_giver text, p_receiver text, p_card bigint, p_source text, p_ref bigint)
returns void language sql set search_path = public as $$
  insert into wish_grants (giver_id, receiver_id, card_id, source, ref_id)
  select p_giver, p_receiver, p_card, p_source, p_ref
   where p_giver is not null and p_receiver is not null and p_card is not null and p_giver <> p_receiver
     and exists (select 1 from wishlists w where w.player_id = p_receiver and w.card_id = p_card)
  on conflict do nothing;
$$;

-- A trade or a sold auction: one card_trades row (trade_ledger_raid_credit.sql). from_id gave
-- from_cards to to_id; to_id gave to_cards to from_id.
create or replace function public.ach_wish_trade() returns trigger
language plpgsql set search_path = public as $$
declare x bigint; src text := case when new.kind = 'auction' then 'auction' else 'trade' end;
begin
  foreach x in array new.from_cards loop perform ach_wish_grant(new.from_id, new.to_id, x, src, new.id); end loop;
  foreach x in array new.to_cards loop perform ach_wish_grant(new.to_id, new.from_id, x, src, new.id); end loop;
  return null;
end $$;
drop trigger if exists ach_wish_trade on public.card_trades;
create trigger ach_wish_trade after insert on public.card_trades
  for each row execute function public.ach_wish_trade();

create or replace function public.ach_wish_gift() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.kind = 'card' and new.reason = 'member_gift' and new.from_id is not null then
    perform ach_wish_grant(new.from_id, new.player_id, new.card_id, 'gift', new.id);
  end if;
  return new;
end $$;
drop trigger if exists ach_wish_gift on public.gift_claims;
create trigger ach_wish_gift after insert on public.gift_claims
  for each row execute function public.ach_wish_gift();

-- ---- Measuring --------------------------------------------------------------------------------
create or replace function public.ach_tracks_on(p_player text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select coalesce((value->>'enabled')::boolean, false)
                       or coalesce(value->'users', '[]'::jsonb) ? p_player
                     from settings where key = 'achievement_tracks'), false);
$$;

-- A card's element (the same aliases as tcg-activity/src/elements.js cardElement).
create or replace function public.ach_has_element(p_tags jsonb) returns boolean
language sql immutable set search_path = public as $$
  select exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(p_tags->'traits') = 'array' then p_tags->'traits' else '[]'::jsonb end) t
                  where lower(t) = any (array['fire','flame','burning','water','aqua','ocean','lightning','electric','thunder',
                    'ice','frost','frozen','nature','grass','plant','wood','earth','rock','stone','ground','air','wind','flying',
                    'shadow','dark','ghost','light','holy','radiant','arcane','magic','fairy','mystic','psychic','psi',
                    'toxic','poison','venom','metal','robot','mechanical','tech','steel']));
$$;

-- Every track's value for one member, in the track's unit.
create or replace function public.ach_track_values(p_player text) returns jsonb
language plpgsql stable set search_path = public as $$
declare v jsonb := '{}'::jsonb; n bigint; dv jsonb := coalesce(shard_cfg()->'dupe_values', '{}'::jsonb);
begin
  -- Collection (draw-pool cards only: Event cards do not count)
  select jsonb_build_object(
           'collector', count(*),
           'shine', count(*) filter (where c.rarity in ('illustrated_rare', 'secret_rare', 'full_art', 'gold')),
           'elementalist', count(*) filter (where ach_has_element(s.tags)))
    into v
    from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
   where pc.player_id = p_player and pc.quantity > 0 and c.in_draw_pool;
  select count(*) into n from (
    select c.subject_id from cards c left join player_cards pc on pc.card_id = c.id and pc.player_id = p_player and pc.quantity > 0
     where c.in_draw_pool group by c.subject_id having count(*) >= 2 and count(pc.card_id) = count(*)) x;
  v := v || jsonb_build_object('fullsets', n);
  v := v || (select jsonb_build_object(
      'ascension', coalesce(sum(pc.ascension), 0),
      'trainer', coalesce(sum(stat_pt(pc.stat_points, 'attack') + stat_pt(pc.stat_points, 'vitality') + stat_pt(pc.stat_points, 'precision')
                              + stat_pt(pc.stat_points, 'potency') + stat_pt(pc.stat_points, 'haste')), 0))
    from player_cards pc where pc.player_id = p_player and pc.quantity > 0);
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
      (select count(*) from daily_claims where player_id = p_player)
    + (select count(*) from daily_activity where player_id = p_player and bonus_claimed));
  v := v || jsonb_build_object('streak', (select coalesce(max(run_len), 0) from (
      select count(*) run_len from (select day, day - (row_number() over (order by day))::int g
                                from (select distinct day from daily_claims where player_id = p_player and task = 'checkin') d) x
       group by g) y));
  v := v || jsonb_build_object('voice', (select count(*) from (
      select day from daily_claims where player_id = p_player and task = 'voice'
      union select activity_date from daily_activity where player_id = p_player and bonus_claimed) d));
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
end $$;

-- The need of tier n (1 Bronze .. 5 Mythic, 6 = Mythic +1, ...). Null = no such tier.
create or replace function public.ach_tier_need(p_track text, p_tier int) returns bigint
language sql stable set search_path = public as $$
  select case when p_tier between 1 and 5 then t.tiers[p_tier]::bigint
              when p_tier > 5 and t.step is not null then t.tiers[5]::bigint + (p_tier - 5)::bigint * t.step
         end
    from achievement_tracks t where t.key = p_track;
$$;

-- The reward of tier n (the same for every track).
-- The tier and tag badge rewards: balance achievement_rewards (one source; change them there, balance_log keeps it).
insert into public.balance (key, value, note) values ('achievement_rewards',
  '{"tiers": [{"packs": 1, "shards": 50}, {"packs": 1, "shards": 150}, {"packs": 2, "shards": 200}, {"packs": 3, "shards": 400}, {"packs": 5, "shards": 800}],
    "step": {"packs": 5, "shards": 200}, "tag_badge": {"cards_per_pack": 10, "extra_packs": 1}}'::jsonb,
  'Achievement tracks (achievement_tracks.sql): tiers = Bronze, Silver, Gold, Diamond, Mythic (packs + Shards each; Gold adds a title, Diamond and Mythic a title + a frame); step = each Mythic +N tier; tag_badge = ceil(cards / cards_per_pack) + extra_packs packs.')
on conflict (key) do nothing;

create or replace function public.ach_tier_reward(p_track text, p_tier int) returns jsonb
language sql stable set search_path = public as $$
  select case p_tier
    when 1 then balance_get('achievement_rewards')->'tiers'->0
    when 2 then balance_get('achievement_rewards')->'tiers'->1
    when 3 then balance_get('achievement_rewards')->'tiers'->2 || jsonb_build_object('title', t.titles[1])
    when 4 then balance_get('achievement_rewards')->'tiers'->3 || jsonb_build_object('title', t.titles[2], 'frame', 'diamond:' || t.key)
    when 5 then balance_get('achievement_rewards')->'tiers'->4 || jsonb_build_object('title', t.titles[3], 'frame', 'mythic:' || t.key)
    else balance_get('achievement_rewards')->'step' || jsonb_build_object('title', t.titles[3] || ' +' || (p_tier - 5))
  end from achievement_tracks t where t.key = p_track and p_tier >= 1;
$$;

-- The switch rule: true when the member's claimed old achievements prove this tier (no packs).
create or replace function public.ach_tier_paid_before(p_player text, p_track text, p_tier int) returns boolean
language sql stable set search_path = public as $$
  select p_tier between 1 and 5 and ach_tier_need(p_track, p_tier) <= (
    select greatest(coalesce(sum(m.proves) filter (where m.adds), 0), coalesce(max(m.proves) filter (where not m.adds), 0))
      from achievement_switch_map m join achievement_claims c on c.key = m.old_key and c.player_id = p_player
     where m.track = p_track);
$$;

-- The tag set badges for one member: every (season, origin/type tag) with its subjects, generated
-- from the cards (draw pool only; Event cards never count).
create or replace function public.ach_tag_badges(p_player text)
returns table (key text, season text, short text, tag text, label text, title text, need int, have int, packs int)
language sql stable set search_path = public as $$
  with pool as (
    select coalesce(c.season, 'Season 1') season, c.subject_id, c.id card_id, s.tag_slugs
      from cards c join subjects s on s.id = c.subject_id
     where c.in_draw_pool and c.rarity::text <> 'event'),
  subj as (
    select p.season, p.subject_id, t.slug
      from pool p cross join lateral unnest(p.tag_slugs) t(slug)
     where t.slug like 'origin:%' or t.slug like 'type:%'
     group by 1, 2, 3),
  mine as (
    select distinct p.season, p.subject_id from pool p
      join player_cards pc on pc.card_id = p.card_id and pc.player_id = p_player and pc.quantity > 0),
  b as (
    select s.season, s.slug, count(*)::int need, count(m.subject_id)::int have
      from subj s left join mine m on m.season = s.season and m.subject_id = s.subject_id
     group by 1, 2)
  select 'tag:' || sh.short || ':' || b.slug, b.season, sh.short, b.slug,
         initcap(split_part(b.slug, ':', 2)), initcap(split_part(b.slug, ':', 2)) || ' Master ' || sh.short,
         b.need, b.have, (ceil(b.need / balance_num('achievement_rewards', 'tag_badge', 'cards_per_pack')) + balance_num('achievement_rewards', 'tag_badge', 'extra_packs'))::int
    from b cross join lateral (select coalesce('S' || substring(b.season from '(\d+)'), b.season) short) sh
   order by b.season, b.slug like 'type:%', b.need desc, b.slug;
$$;

-- ---- Claiming -----------------------------------------------------------------------------------
-- Claim every reached, unclaimed tier and tag badge (p_key null), one track ('track:<key>') or one
-- badge ('tag:...'). Returns { ok, claimed: [keys], packs, shards, titles, frames, balance }.
create or replace function public.claim_achievement_tiers(p_player text, p_key text default null) returns jsonb
language plpgsql set search_path = public as $$
declare vals jsonb; t record; b record; n int; need bigint; val bigint; rw jsonb; k text; inserted int;
  pk int; got_packs int := 0; got_shards int := 0; keys text[] := '{}'; titles text[] := '{}'; frames text[] := '{}';
begin
  if not ach_tracks_on(p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform 1 from players where id = p_player for update; -- one claim at a time for each member
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  if p_key is not null and p_key not like 'track:%' and p_key not like 'tag:%' then
    return jsonb_build_object('ok', false, 'error', 'bad_key'); end if;
  vals := ach_track_values(p_player);
  for t in select * from achievement_tracks order by ord loop
    if p_key is not null and p_key <> 'track:' || t.key then continue; end if;
    val := coalesce((vals->>t.key)::bigint, 0);
    n := 1;
    loop
      need := ach_tier_need(t.key, n);
      exit when need is null or val < need or n > 2000;
      k := 'track:' || t.key || ':' || n;
      if not exists (select 1 from achievement_claims where player_id = p_player and key = k) then
        rw := ach_tier_reward(t.key, n);
        pk := case when ach_tier_paid_before(p_player, t.key, n) then 0 else (rw->>'packs')::int end;
        insert into achievement_claims (player_id, key, packs, shards, title, frame)
          values (p_player, k, pk, (rw->>'shards')::int, rw->>'title', rw->>'frame') on conflict do nothing;
        get diagnostics inserted = row_count;
        if inserted = 1 then
          if pk > 0 then perform grant_packs(p_player, pk, 'achievement', k); end if;
          perform grant_shards(p_player, (rw->>'shards')::int, 'milestone', 'achievement', k);
          got_packs := got_packs + pk; got_shards := got_shards + (rw->>'shards')::int; keys := keys || k;
          if rw ? 'title' then titles := titles || (rw->>'title'); end if;
          if rw ? 'frame' then frames := frames || (rw->>'frame'); end if;
        end if;
      end if;
      n := n + 1;
    end loop;
  end loop;
  for b in select * from ach_tag_badges(p_player) x where x.have >= x.need loop
    if p_key is not null and p_key <> b.key then continue; end if;
    insert into achievement_claims (player_id, key, packs, shards, title)
      values (p_player, b.key, b.packs, 0, b.title) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted = 1 then
      perform grant_packs(p_player, b.packs, 'achievement', b.key);
      got_packs := got_packs + b.packs; keys := keys || b.key; titles := titles || b.title;
    end if;
  end loop;
  return jsonb_build_object('ok', cardinality(keys) > 0, 'error', case when cardinality(keys) = 0 then 'nothing' end,
    'claimed', to_jsonb(keys), 'packs', got_packs, 'shards', got_shards, 'titles', to_jsonb(titles), 'frames', to_jsonb(frames),
    'balance', (select pack_balance from players where id = p_player), 'shard_balance', (select shard_balance from players where id = p_player));
end $$;

-- The Achievements view for one member: each track with its value, tiers and claims, each tag
-- badge, and the number of rewards ready to redeem (the Collection dock number).
create or replace function public.achievement_view(p_player text) returns jsonb
language plpgsql stable set search_path = public as $$
declare vals jsonb; tracks jsonb := '[]'::jsonb; badges jsonb := '[]'::jsonb; t record; b record;
  val bigint; reached int; claimed int; ready int := 0; nxt bigint;
begin
  if not ach_tracks_on(p_player) then return jsonb_build_object('enabled', false); end if;
  vals := ach_track_values(p_player);
  for t in select * from achievement_tracks order by ord loop
    val := coalesce((vals->>t.key)::bigint, 0);
    reached := 0;
    loop
      nxt := ach_tier_need(t.key, reached + 1);
      exit when nxt is null or val < nxt or reached > 2000;
      reached := reached + 1;
    end loop;
    select count(*) into claimed from achievement_claims where player_id = p_player and key like 'track:' || t.key || ':%';
    -- claimed counts the tiers paid; a tier is never claimed out of order, so reached - claimed is ready
    ready := ready + greatest(reached - claimed, 0);
    tracks := tracks || jsonb_build_object('key', t.key, 'group', t.grp, 'name', t.name, 'value', val,
      'tiers', to_jsonb(t.tiers), 'step', t.step, 'titles', to_jsonb(t.titles),
      'reached', reached, 'claimed', claimed, 'next', nxt);
  end loop;
  for b in select x.*, exists (select 1 from achievement_claims c where c.player_id = p_player and c.key = x.key) done
             from ach_tag_badges(p_player) x loop
    if b.have >= b.need and not b.done then ready := ready + 1; end if;
    badges := badges || jsonb_build_object('key', b.key, 'season', b.season, 'short', b.short, 'tag', b.tag, 'label', b.label,
      'title', b.title, 'need', b.need, 'have', b.have, 'packs', b.packs, 'claimed', b.done);
  end loop;
  return jsonb_build_object('enabled', true, 'tracks', tracks, 'badges', badges, 'ready', ready,
    'retired', (select coalesce(jsonb_agg(old_key), '[]'::jsonb) from achievement_switch_map));
end $$;

-- Every title and frame (tracks and tag badges) with how many members own it, and whether the
-- caller owns it. 'owned' lists every title and frame in achievement_claims with its owner count
-- (the old rewards too: the server names those from tcg-activity/src/achievements.js).
create or replace function public.achievement_gallery(p_player text) returns jsonb
language sql stable set search_path = public as $$
  with own_t as (select title v, count(distinct player_id) n, bool_or(player_id = p_player) mine
                   from achievement_claims where title is not null group by title),
       own_f as (select frame v, count(distinct player_id) n, bool_or(player_id = p_player) mine
                   from achievement_claims where frame is not null group by frame),
       plus as (select t.key, max(substring(c.title from ' \+(\d+)$')::int) best
                  from achievement_tracks t join achievement_claims c on c.player_id = p_player and c.key like 'track:' || t.key || ':%'
                 where c.title like t.titles[3] || ' +%' group by t.key),
       items as (
         select t.ord, t.key track, 'title' kind, t.titles[i] v, i + 2 tier, t.tiers[i + 2] need, null::text badge
           from achievement_tracks t cross join generate_series(1, 3) i
         union all
         select t.ord, t.key, 'frame', f || ':' || t.key, case f when 'diamond' then 4 else 5 end,
                t.tiers[case f when 'diamond' then 4 else 5 end], null
           from achievement_tracks t cross join unnest(array['diamond', 'mythic']) f
         union all
         select 1000, null, 'title', b.title, null, b.need, b.key from ach_tag_badges(p_player) b)
  select jsonb_build_object(
    'members', (select count(distinct player_id) from achievement_claims),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'value', i.v, 'track', i.track, 'tier', i.tier,
               'need', i.need, 'badge', i.badge, 'owners', coalesce(case i.kind when 'title' then ot.n else of.n end, 0),
               'mine', coalesce(case i.kind when 'title' then ot.mine else of.mine end, false),
               'plus', case when i.kind = 'title' and i.tier = 5 then p.best end)
               order by i.ord, i.kind desc, i.tier)
             from items i left join own_t ot on i.kind = 'title' and ot.v = i.v left join own_f of on i.kind = 'frame' and of.v = i.v
             left join plus p on p.key = i.track), '[]'::jsonb),
    'owned', jsonb_build_object(
      'titles', coalesce((select jsonb_object_agg(v, jsonb_build_object('owners', n, 'mine', mine)) from own_t), '{}'::jsonb),
      'frames', coalesce((select jsonb_object_agg(v, jsonb_build_object('owners', n, 'mine', mine)) from own_f), '{}'::jsonb)));
$$;

-- ---- The old path: the 38 replaced keys retire when the tracks are on -------------------------
-- From the live definition (achievement_rewards.sql); the only change is the retired check.
create or replace function public.claim_achievement(p_player text, p_key text, p_packs int, p_title text, p_frame text)
returns jsonb language plpgsql set search_path = public as $$
declare inserted int; bal int;
begin
  if p_packs < 0 or p_packs > 10 then return jsonb_build_object('ok', false, 'error', 'bad_reward'); end if;
  -- The tracks replace these keys (achievement_tracks.sql): never paid again once they are on.
  if ach_tracks_on(p_player) and exists (select 1 from achievement_switch_map where old_key = p_key) then
    return jsonb_build_object('ok', false, 'error', 'retired'); end if;
  insert into achievement_claims (player_id, key, packs, title, frame)
    values (p_player, p_key, p_packs, p_title, p_frame)
    on conflict (player_id, key) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if p_packs > 0 then
    bal := grant_packs(p_player, p_packs, 'achievement', p_key);
    if bal is null then raise exception 'unknown player %', p_player; end if; -- rolls the claim back
  end if;
  return jsonb_build_object('ok', true, 'balance', bal);
end; $$;

revoke all on function public.claim_achievement_tiers(text, text), public.achievement_view(text), public.achievement_gallery(text),
  public.ach_track_values(text), public.ach_tag_badges(text), public.ach_wish_grant(text, text, bigint, text, bigint)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
