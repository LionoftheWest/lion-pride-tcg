-- Shards and the Shop (docs/activities/01-shards-and-shop.md; Nathan, 2026-10-02).
--
-- Shards are a currency that members earn in the new modes and spend in the Shop.
-- - players.shard_balance + shard_ledger: every change to a balance writes one ledger row.
-- - grant_shards(): the only writer of the balance. Other RPCs call it; no route calls it.
-- - The Shop sells packs (no limit: a bought pack is a purchase, not an earning, so it does
--   not count toward the 5-pack daily earn limit - earned_today() counts only 'earned_%'),
--   a random card stock that changes each day at 00:00 MT, and a stat reset.
-- - The daily stock: 6 Normal, 3 Illustrated Rare, 1 Secret Rare (settings.shards.stock),
--   the same for all members. A card that shows on day D cannot show again before day D+7.
--   Never Gold, never Full Art (the season event sells Full Art later), never Event/Promo,
--   never a card outside the draw pool.
-- - convert_dupes(): copies above the ones that ascension still needs (and above 1 kept
--   copy) convert to Shards. Held copies (trades, auctions, bids) never convert.
--
-- Flag: settings.shards.enabled (default false). While it is false, every Shop RPC refuses.
-- The Activity server also gates each route (SHARDS_USERS / FEATURE_SHARDS).
-- Test: card-studio/scripts/test-shards-shop.mjs. Idempotent.

alter table public.players add column if not exists shard_balance integer not null default 0;
do $$ begin
  alter table public.players add constraint players_shard_balance_nonneg check (shard_balance >= 0);
exception when duplicate_object then null; end $$;

create table if not exists public.shard_ledger (
  id         bigint generated always as identity primary key,
  player_id  text not null references public.players (id) on delete cascade,
  amount     integer not null,
  reason     text not null check (reason in ('dungeon', 'expedition', 'arena', 'wandering', 'minigame',
                                             'event', 'milestone', 'dupes', 'shop', 'admin')),
  ref_kind   text,
  ref_id     text,
  created_at timestamptz not null default now()
);
create index if not exists shard_ledger_player on public.shard_ledger (player_id, created_at desc);

create table if not exists public.shop_stock (
  day      date not null,
  slot     integer not null,
  card_id  bigint not null references public.cards (id) on delete cascade,
  rarity   text not null,
  price    integer not null check (price > 0),
  primary key (day, slot)
);
create index if not exists shop_stock_card on public.shop_stock (card_id, day);

create table if not exists public.shop_purchases (
  id         bigint generated always as identity primary key,
  player_id  text not null references public.players (id) on delete cascade,
  day        date not null,
  kind       text not null check (kind in ('pack', 'card', 'stat_reset')),
  slot       integer,
  card_id    bigint,
  qty        integer not null default 1,
  price      integer not null,
  created_at timestamptz not null default now()
);
-- Each stock card: 1 time each day for each member.
create unique index if not exists shop_purchases_one_slot on public.shop_purchases (player_id, day, slot) where kind = 'card';
create index if not exists shop_purchases_player on public.shop_purchases (player_id, day);

alter table public.shard_ledger enable row level security;
alter table public.shop_stock enable row level security;
alter table public.shop_purchases enable row level security;

insert into public.settings (key, value) values ('shards', jsonb_build_object(
  'enabled', false,
  'pack_price', 100,
  'stat_reset_price', 150,
  'stock', jsonb_build_object('normal', 6, 'illustrated_rare', 3, 'secret_rare', 1),
  'prices', jsonb_build_object('normal', 150, 'illustrated_rare', 450, 'secret_rare', 1500),
  'cooldown_days', 7,
  'max_packs_per_buy', 10,
  'dupe_values', jsonb_build_object('normal', 5, 'illustrated_rare', 15, 'secret_rare', 40, 'full_art', 100, 'gold', 250)))
on conflict (key) do nothing;

create or replace function public.shard_cfg() returns jsonb
language sql stable set search_path = public as $$
  select coalesce((select value from settings where key = 'shards'), '{}'::jsonb);
$$;

-- The Shop day: midnight to midnight MT (mt_clock.sql).
create or replace function public.shop_day() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'America/Denver')::date;
$$;

-- The only writer of shard_balance. A spend is a negative amount; the check constraint
-- refuses a negative balance, so a caller must check the balance first (and lock the row).
-- Returns the new balance, or null for an unknown player.
create or replace function public.grant_shards(p_player text, p_amount integer, p_reason text,
                                               p_ref_kind text default null, p_ref_id text default null)
returns integer language plpgsql set search_path = public as $$
declare v_bal integer;
begin
  update players set shard_balance = shard_balance + p_amount where id = p_player returning shard_balance into v_bal;
  if v_bal is null then return null; end if;
  if p_amount <> 0 then
    insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id) values (p_player, p_amount, p_reason, p_ref_kind, p_ref_id);
  end if;
  return v_bal;
end $$;

-- Pick the stock for one day (idempotent: a day that has a stock keeps it). The lock stops
-- two first visitors from picking two stocks. A card in the stock in the last
-- cooldown_days - 1 days is not eligible, so the soonest a card can come back is day + 7.
-- If a rarity has too few eligible cards, the stock has fewer slots (the rule never breaks).
create or replace function public.shop_pick_stock(p_day date)
returns integer language plpgsql set search_path = public as $$
declare cfg jsonb := shard_cfg(); v_cool int := coalesce((cfg->>'cooldown_days')::int, 7);
  r record; v_slot int := 0; v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('shop_pick_stock'), (p_day - date '2000-01-01'));
  if exists (select 1 from shop_stock where day = p_day) then
    return (select count(*) from shop_stock where day = p_day);
  end if;
  for r in select k as rarity, (cfg->'stock'->>k)::int as n
             from unnest(array['normal', 'illustrated_rare', 'secret_rare']) k loop
    v_n := coalesce(r.n, 0);
    if v_n <= 0 then continue; end if;
    insert into shop_stock (day, slot, card_id, rarity, price)
    select p_day, v_slot + row_number() over (), c.id, r.rarity, (cfg->'prices'->>r.rarity)::int
      from (select c.id from cards c
             where c.rarity::text = r.rarity
               and c.rarity::text not in ('gold', 'full_art', 'event', 'promo')
               and c.source::text = 'draw' and c.in_draw_pool
               and not exists (select 1 from shop_stock s where s.card_id = c.id
                                and s.day > p_day - v_cool and s.day < p_day)
             order by random() limit v_n) c;
    get diagnostics v_n = row_count;
    v_slot := v_slot + v_n;
  end loop;
  return v_slot;
end $$;

-- Everything the Shop view needs for one member: the balance, today's stock (with what the
-- member bought today), the prices, and the next stock time.
create or replace function public.shop_today(p_player text)
returns jsonb language plpgsql set search_path = public as $$
declare cfg jsonb := shard_cfg(); v_day date := shop_day();
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform shop_pick_stock(v_day);
  return jsonb_build_object('ok', true,
    'day', v_day,
    'next_at', ((v_day + 1)::timestamp at time zone 'America/Denver'),
    'balance', coalesce((select shard_balance from players where id = p_player), 0),
    'pack_price', (cfg->>'pack_price')::int,
    'stat_reset_price', (cfg->>'stat_reset_price')::int,
    'max_packs_per_buy', coalesce((cfg->>'max_packs_per_buy')::int, 10),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('slot', s.slot, 'card_id', s.card_id, 'rarity', s.rarity, 'price', s.price,
                 'bought', exists (select 1 from shop_purchases p where p.player_id = p_player and p.day = v_day and p.kind = 'card' and p.slot = s.slot))
                 order by s.slot) from shop_stock s where s.day = v_day), '[]'::jsonb));
end $$;

-- Buy one Shop item. p_kind: 'pack' (p_qty packs), 'card' (the stock slot p_slot), or
-- 'stat_reset' (clear the stat points of the member's copy of p_card; the free weekly reset
-- stays unused). One transaction: lock the member, check, take the Shards, give the item.
create or replace function public.buy_shop_item(p_player text, p_kind text, p_slot integer default null,
                                                p_card bigint default null, p_qty integer default 1)
returns jsonb language plpgsql set search_path = public as $$
declare cfg jsonb := shard_cfg(); v_day date := shop_day(); v_bal int; v_price int; s shop_stock;
  v_pts jsonb; v_asc int; v_rar text; v_mod numeric; v_new int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select shard_balance into v_bal from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;

  if p_kind = 'pack' then
    if p_qty is null or p_qty < 1 or p_qty > coalesce((cfg->>'max_packs_per_buy')::int, 10) then
      return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
    v_price := (cfg->>'pack_price')::int * p_qty;
    if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    v_new := grant_shards(p_player, -v_price, 'shop', 'pack', p_qty::text);
    perform grant_packs(p_player, p_qty, 'shop', null);
    insert into shop_purchases (player_id, day, kind, qty, price) values (p_player, v_day, 'pack', p_qty, v_price);
    return jsonb_build_object('ok', true, 'kind', 'pack', 'qty', p_qty, 'balance', v_new,
      'packs', (select pack_balance from players where id = p_player));

  elsif p_kind = 'card' then
    perform shop_pick_stock(v_day);
    select * into s from shop_stock where day = v_day and slot = p_slot;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_slot'); end if;
    if exists (select 1 from shop_purchases where player_id = p_player and day = v_day and kind = 'card' and slot = p_slot) then
      return jsonb_build_object('ok', false, 'error', 'bought'); end if;
    if v_bal < s.price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', s.price); end if;
    v_new := grant_shards(p_player, -s.price, 'shop', 'card', s.card_id::text);
    perform add_card_to_player(p_player, s.card_id, 'shop');
    insert into shop_purchases (player_id, day, kind, slot, card_id, price) values (p_player, v_day, 'card', p_slot, s.card_id, s.price);
    return jsonb_build_object('ok', true, 'kind', 'card', 'card_id', s.card_id, 'balance', v_new,
      'quantity', (select quantity from player_cards where player_id = p_player and card_id = s.card_id));

  elsif p_kind = 'stat_reset' then
    if not coalesce((stat_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'stats_disabled'); end if;
    select pc.stat_points, pc.ascension, c.rarity::text, s2.cp_mod into v_pts, v_asc, v_rar, v_mod
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s2 on s2.id = c.subject_id
     where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0 for update of pc;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
    if coalesce(v_pts, '{}'::jsonb) = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
    v_price := (cfg->>'stat_reset_price')::int;
    if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    v_new := grant_shards(p_player, -v_price, 'shop', 'stat_reset', p_card::text);
    update player_cards set stat_points = '{}'::jsonb where player_id = p_player and card_id = p_card;
    insert into shop_purchases (player_id, day, kind, card_id, price) values (p_player, v_day, 'stat_reset', p_card, v_price);
    return jsonb_build_object('ok', true, 'kind', 'stat_reset', 'balance', v_new, 'points', '{}'::jsonb,
      'stats', card_combat(v_rar, v_asc, v_mod, '{}'::jsonb));
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $$;

-- How many copies of a card can convert: the free copies, minus 1 kept copy, minus the
-- copies that the remaining ascension stars still need.
create or replace function public.convertible_copies(p_player text, p_card bigint)
returns integer language sql stable set search_path = public as $$
  select greatest(0, free_copies(p_player, p_card) - 1 - coalesce((
           select sum(ascend_cost(c.rarity::text, a))::int
             from player_cards pc join cards c on c.id = pc.card_id
             cross join generate_series(coalesce(pc.ascension, 0), 4) a
            where pc.player_id = p_player and pc.card_id = p_card), 0));
$$;

-- Convert p_count extra copies to Shards. Only rarities with a value in dupe_values.
create or replace function public.convert_dupes(p_player text, p_card bigint, p_count integer)
returns jsonb language plpgsql set search_path = public as $$
declare cfg jsonb := shard_cfg(); v_rar text; v_val int; v_max int; v_new int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if p_count is null or p_count < 1 then return jsonb_build_object('ok', false, 'error', 'bad_count'); end if;
  perform 1 from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  select c.rarity::text into v_rar from player_cards pc join cards c on c.id = pc.card_id
   where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0 for update of pc;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  v_val := (cfg->'dupe_values'->>v_rar)::int;
  if v_val is null or v_val <= 0 then return jsonb_build_object('ok', false, 'error', 'no_value'); end if;
  v_max := convertible_copies(p_player, p_card);
  if p_count > v_max then return jsonb_build_object('ok', false, 'error', 'too_many', 'max', v_max); end if;
  update player_cards set quantity = quantity - p_count where player_id = p_player and card_id = p_card;
  v_new := grant_shards(p_player, p_count * v_val, 'dupes', 'card', p_card::text);
  return jsonb_build_object('ok', true, 'converted', p_count, 'shards', p_count * v_val, 'balance', v_new,
    'quantity', (select quantity from player_cards where player_id = p_player and card_id = p_card));
end $$;

notify pgrst, 'reload schema';
