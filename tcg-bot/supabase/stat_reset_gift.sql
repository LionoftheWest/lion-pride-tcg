-- stat_reset_gift.sql (2026-10-15): ONE extra free stat reset for every player, when stat_points_r_stars_s1.sql goes live.
-- Why: option R (Health 0.06 -> 0.05 per point, and new Attack, Crit, Support and Recharge values) and the S1 star curve change what a
-- stat point is worth, so every player may move the points of ONE card for free. Nathan, 2026-10-15 ("Yes to all recommendations"
-- on the stat study).
-- How resets work today: ONE free reset per player per week (players.stat_reset_week = the Mountain ISO week of the last free reset).
-- reset_stat_points and buy_shop_item('stat_reset') use it; after it every further reset costs Shards (shop_purchases + shard ledger).
-- The gift: a row of the new ledger table stat_reset_gifts (player_id, gift, granted_at, expires_at, used_at, used_card). It is the
-- NEXT free reset after the weekly one: stat_reset_gift_use() marks the row used (with the card) and the reset runs at 0 Shards.
--   - one row for each player, gift 'r_s1_2026_10', deadline 14 days after this file runs (to change it: update expires_at of the rows);
--   - used once at most (the primary key and used_at); an expired row is never used; a re-run adds NO row (the gift key exists);
--   - NO points are reset here. A player who does nothing keeps the points; the gift only makes one reset free when the player chooses;
--   - the weekly reset is used first (it ends sooner), so a player has two free resets in the first week at most.
-- shop_today gets gift_reset and gift_reset_until (free_reset is true while a gift is left): the screens show a free reset with no change.
-- GUARD: each replaced function must be the live text of 2026-10-15 (db/schema) or the text this file made.
-- Test: card-studio/scripts/test-stat-reset-gift.mjs (rolled back; MUTATE=<name> must FAIL).

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.reset_stat_points(text, bigint)', 'f70fcb81484d6404383d0322cfd9ec15', 'd86606fdd8fe2f9e3a7f4cb8ef75d064'),
    ('public.buy_shop_item(text, text, integer, bigint, integer)', 'c2140bff412bfbca74d97a1167457733', 'e2856fa90e8246f9023a62bcf456b951'),
    ('public.shop_today(text)', '31248b4eff93f9c43bd03b9a9774397c', 'd8508da3888ccfa7a02fd92a82e2e4e4')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'stat_reset_gift.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

create table if not exists public.stat_reset_gifts (
  player_id  text not null references public.players (id) on delete cascade,
  gift       text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_card  bigint references public.cards (id),
  primary key (player_id, gift),
  constraint stat_reset_gifts_used_check check ((used_at is null) = (used_card is null))
);
alter table public.stat_reset_gifts enable row level security;
revoke all on public.stat_reset_gifts from anon, authenticated;
comment on table public.stat_reset_gifts is 'One-time free stat resets (a gift on top of the weekly one). One row per player and gift. used_at and used_card say when and for which card it was used. A row after expires_at is never used. Written by stat_reset_gift.sql (the grant) and stat_reset_gift_use() (the use).';

-- Use the gift of a player for one reset (the earliest deadline first). true = used (the caller resets the card at 0 Shards).
create or replace function public.stat_reset_gift_use(p_player text, p_card bigint) returns boolean
language plpgsql set search_path to 'public' as $f$
begin
  with g as (
    select gift from stat_reset_gifts
     where player_id = p_player and used_at is null and expires_at > now()
     order by expires_at limit 1 for update)
  update stat_reset_gifts s set used_at = now(), used_card = p_card from g where s.player_id = p_player and s.gift = g.gift;
  return found;
end $f$;
revoke all on function public.stat_reset_gift_use(text, bigint) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reset_stat_points(p_player text, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $f$
declare v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW'); v_used text; v_pts jsonb;
  v_asc int; v_rar text; v_mod numeric;
begin
  if not coalesce((stat_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select stat_reset_week into v_used from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  select pc.stat_points, pc.ascension, c.rarity::text, s.cp_mod into v_pts, v_asc, v_rar, v_mod
    from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0 for update of pc;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if coalesce(v_pts, '{}'::jsonb) = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
  if v_used = v_week then
    -- The weekly free reset is used: the one-time gift reset (stat_reset_gifts) is the next free one. A nested if, so that the
    -- function runs only when the week is used (a null week must never take the gift).
    if not stat_reset_gift_use(p_player, p_card) then
      return jsonb_build_object('ok', false, 'error', 'reset_used',
        'next', (date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver'); end if;
  end if;
  update player_cards set stat_points = '{}'::jsonb where player_id = p_player and card_id = p_card;
  update players set stat_reset_week = v_week where id = p_player;
  return jsonb_build_object('ok', true, 'points', '{}'::jsonb, 'stats', card_combat(v_rar, v_asc, v_mod, '{}'::jsonb));
end $f$;

CREATE OR REPLACE FUNCTION public.buy_shop_item(p_player text, p_kind text, p_slot integer DEFAULT NULL::integer, p_card bigint DEFAULT NULL::bigint, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $f$
declare cfg jsonb := shard_cfg(); v_day date := shop_day(); v_bal int; v_price int; s shop_stock;
  v_pts jsonb; v_asc int; v_rar text; v_mod numeric; v_new int; v_used text; v_purchase bigint;
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select shard_balance, stat_reset_week into v_bal, v_used from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;

  if p_kind = 'pack' then
    if p_qty is null or p_qty < 1 or p_qty > coalesce((cfg->>'max_packs_per_buy')::int, 10) then
      return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
    v_price := game_shop_price((cfg->>'pack_price')::int) * p_qty;
    if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    insert into shop_purchases (player_id, day, kind, qty, price) values (p_player, v_day, 'pack', p_qty, v_price) returning id into v_purchase;
    v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text);
    perform grant_packs(p_player, p_qty, 'shop', null, 'shop_purchase', v_purchase::text);
    return jsonb_build_object('ok', true, 'kind', 'pack', 'qty', p_qty, 'balance', v_new,
      'packs', (select pack_balance from players where id = p_player));

  elsif p_kind = 'card' then
    perform shop_pick_stock(v_day);
    select * into s from shop_stock where day = v_day and slot = p_slot;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_slot'); end if;
    s.price := game_shop_price(s.price);   -- the stock price x the live shop_price_mult (game_vars_all.sql)
    if exists (select 1 from shop_purchases where player_id = p_player and day = v_day and kind = 'card' and slot = p_slot) then
      return jsonb_build_object('ok', false, 'error', 'bought'); end if;
    if v_bal < s.price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', s.price); end if;
    -- The card first (add_card_to_player finds the slot that is not bought yet), then the purchase row, then its Shards.
    perform add_card_to_player(p_player, s.card_id, 'shop');
    insert into shop_purchases (player_id, day, kind, slot, card_id, price) values (p_player, v_day, 'card', p_slot, s.card_id, s.price) returning id into v_purchase;
    v_new := grant_shards(p_player, -s.price, 'shop', 'shop_purchase', v_purchase::text);
    return jsonb_build_object('ok', true, 'kind', 'card', 'card_id', s.card_id, 'balance', v_new,
      'quantity', (select quantity from player_cards where player_id = p_player and card_id = s.card_id));

  elsif p_kind = 'stat_reset' then
    if not coalesce((stat_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'stats_disabled'); end if;
    select pc.stat_points, pc.ascension, c.rarity::text, s2.cp_mod into v_pts, v_asc, v_rar, v_mod
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s2 on s2.id = c.subject_id
     where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0 for update of pc;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
    if coalesce(v_pts, '{}'::jsonb) = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
    if v_used is distinct from v_week then
      -- The free weekly reset: no Shards, the week is marked used (the same rule as reset_stat_points).
      update players set stat_reset_week = v_week where id = p_player;
      v_price := 0; v_new := v_bal;
    elsif stat_reset_gift_use(p_player, p_card) then
      -- The weekly one is used: the one-time gift reset (stat_reset_gifts, stat_reset_gift.sql) is the next free one.
      v_price := 0; v_new := v_bal;
    else
      v_price := game_shop_price((cfg->>'stat_reset_price')::int);
      if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    end if;
    update player_cards set stat_points = '{}'::jsonb where player_id = p_player and card_id = p_card;
    insert into shop_purchases (player_id, day, kind, card_id, price) values (p_player, v_day, 'stat_reset', p_card, v_price) returning id into v_purchase;
    if v_price > 0 then v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text); end if;
    return jsonb_build_object('ok', true, 'kind', 'stat_reset', 'free', v_price = 0, 'price', v_price, 'balance', v_new, 'points', '{}'::jsonb,
      'stats', card_combat(v_rar, v_asc, v_mod, '{}'::jsonb));
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $f$;

CREATE OR REPLACE FUNCTION public.shop_today(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $f$
declare cfg jsonb := shard_cfg(); v_day date := shop_day();
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform shop_pick_stock(v_day);
  return jsonb_build_object('ok', true,
    'day', v_day,
    'next_at', ((v_day + 1)::timestamp at time zone 'America/Denver'),
    'balance', coalesce((select shard_balance from players where id = p_player), 0),
    'pack_price', game_shop_price((cfg->>'pack_price')::int),
    'stat_reset_price', game_shop_price((cfg->>'stat_reset_price')::int),
    -- The free weekly reset (stat_points.sql): a Shop reset uses it first, at 0 Shards.
    -- A free reset is the weekly one OR a gift that is not used and not expired (stat_reset_gifts). gift_reset says that a gift is
    -- left, gift_reset_until is its deadline.
    'free_reset', (select stat_reset_week from players where id = p_player) is distinct from v_week
      or exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now()),
    'gift_reset', exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now()),
    'gift_reset_until', (select min(g.expires_at) from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now()),
    'free_reset_next', ((date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver'),
    'max_packs_per_buy', coalesce((cfg->>'max_packs_per_buy')::int, 10),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('slot', s.slot, 'card_id', s.card_id, 'rarity', s.rarity, 'price', game_shop_price(s.price),
                 'bought', exists (select 1 from shop_purchases p where p.player_id = p_player and p.day = v_day and p.kind = 'card' and p.slot = s.slot))
                 order by s.slot) from shop_stock s where s.day = v_day), '[]'::jsonb));
end $f$;

-- The grant: ONE row for each player, ONCE (a re-run finds the gift key and adds nothing). Nothing is reset here.
do $c$
declare n_players int; n_gifts int; n_open int; n_new int;
begin
  insert into public.stat_reset_gifts (player_id, gift, expires_at)
  select p.id, 'r_s1_2026_10', now() + interval '14 days'
    from public.players p
   where not exists (select 1 from public.stat_reset_gifts g where g.gift = 'r_s1_2026_10');
  get diagnostics n_new = row_count;
  select count(*) into n_players from public.players;
  select count(*), count(*) filter (where used_at is null) into n_gifts, n_open from public.stat_reset_gifts where gift = 'r_s1_2026_10';
  -- The run that grants: every player gets a gift. A re-run adds none (a player who joined later has no gift).
  if n_new > 0 and n_new <> n_players then
    raise exception 'stat_reset_gift: % players but % new gifts', n_players, n_new;
  end if;
  if n_gifts = 0 then
    raise exception 'stat_reset_gift: no gift rows';
  end if;
  if exists (select 1 from public.stat_reset_gifts where gift = 'r_s1_2026_10' and expires_at <= granted_at) then
    raise exception 'stat_reset_gift: a gift has no valid deadline';
  end if;
  if position('stat_reset_gift_use' in pg_get_functiondef('public.reset_stat_points(text, bigint)'::regprocedure)) = 0
     or position('stat_reset_gift_use' in pg_get_functiondef('public.buy_shop_item(text, text, integer, bigint, integer)'::regprocedure)) = 0
     or position('gift_reset_until' in pg_get_functiondef('public.shop_today(text)'::regprocedure)) = 0 then
    raise exception 'stat_reset_gift: a function does not use the gift';
  end if;
  raise notice 'stat_reset_gift: % players, % new gifts, % gifts (% open)', n_players, n_new, n_gifts, n_open;
end $c$;

comment on column public.stat_reset_gifts.player_id is 'The player who owns the gift (players.id).';
comment on column public.stat_reset_gifts.gift is 'The name of the gift. r_s1_2026_10 = the free reset for the stat points option R and the star curve S1.';
comment on column public.stat_reset_gifts.granted_at is 'When the gift was granted.';
comment on column public.stat_reset_gifts.expires_at is 'The deadline: after it the gift is never used.';
comment on column public.stat_reset_gifts.used_at is 'When the gift was used for a reset (null = still open).';
comment on column public.stat_reset_gifts.used_card is 'The card (cards.id) whose points the gift reset (null = not used).';
comment on function public.stat_reset_gift_use(text, bigint) is 'Uses the next gift reset of a player (stat_reset_gifts, the earliest deadline first): true = used. Called by reset_stat_points and buy_shop_item after the weekly free reset.';
notify pgrst, 'reload schema';
