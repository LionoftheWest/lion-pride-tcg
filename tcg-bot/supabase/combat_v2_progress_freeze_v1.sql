-- combat_v2_progress_freeze_v1.sql (2026-10-23): combat v2 step M1d, the v1 stat paths are frozen when v2 progress is ON
-- (docs/combat-redesign-plan.md 11 "Timing", 20.11 trap a, 20.13 "Open for M1d" items 1 and 6, and 20.14 "M1d as built").
-- Needs combat_v2_testers.sql (combat_v2_on with a player), stat_reset_gift.sql (stat_reset_gifts) and combat_v2_progress_spend.sql (M1c:
-- the v2 spend and reset, and the v2_ gift rule).
-- Before: the v1 spend, reset and Shop reset do not read the combat v2 switch, and the v1 gift use takes any open gift (also a v2_ gift).
-- After this file (each v1 function is the live text with ADDED lines only; each added line has the mark "-- M1d"):
--   spend_stat_points(player, card, add): answers {ok: false, error: 'disabled'} when combat_v2_on('progress', player) is true (the
--     2-argument form: progress ON for everyone, or the player is a tester). The check is the first statement: before any lock or write.
--   reset_stat_points(player, card): the same answer and the same check, before the lock of the player row (players.stat_reset_week).
--   buy_shop_item(player, 'stat_reset', card): under the same condition the Shop reset ROUTES to the v2 reset (Nathan, 2026-10-23, "Yes A"):
--     card_progress_v2_reset with the Shop price: the free Mountain week, then one open v2_ gift, else the price (not_enough before any
--     write); then the shop_purchases row (price 0 when free), then the Shards only when the price > 0. The answer: {ok, kind, free, price,
--     balance} and the v2 answer (used, progress, stats) in place of the v1 points and stats. The kinds pack and card do not change.
--   card_progress_v2_reset(player, card, price) (NEW, server only): the body of the M1c reset_card_points_v2, written once for both callers.
--     price null = the M1c rule (reset_used with next after the week and the v2 gift). reset_card_points_v2 now calls it: the same answers.
--   stat_reset_gift_use(player, card): skips every gift whose key starts with 'v2_' (starts_with, not like: in like the '_' matches any
--     character, so 'v2xfoo' would be skipped too). A v2_ gift is for stat_reset_gift_use_v2 (the v2 reset) only.
-- Why (plan 20.11 trap a): with progress ON a player could still spend v1 points that the v1 Hunt reads and that the M1h conversion
-- counted, and the v1 and v2 resets would compete for the one weekly marker players.stat_reset_week. The freeze is a refusal, never
-- stat_points.enabled = false: with that, card_combat returns the base CP with NO points, so the v1 Hunt and Dungeon lose every v1 bonus.
-- The answer 'disabled' exists today (stat_points.enabled = false) and the Activity shows it (server.js /api/stats/*). The routed Shop
-- reset adds the answers no_progress and no_role, which src/shop-routes.js shows as the code. No Activity or bot code changes (U0).
-- FLAG OFF = NO CHANGE IN PLAY: combat_v2.progress is false and the tester list is empty on live, so every answer and every write is the
-- same as before. No 'v2_' gift exists before M1h. No number in this file. Idempotent. Server only.
-- GUARD: each replaced function must be the live text of 2026-10-23 (db/schema at d575b7f8, with M1c) or the text this file made.
-- Test: card-studio/scripts/test-combat-v2-progress-freeze.mjs (rolled back; MUTATE=all must catch every mutation).

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.spend_stat_points(text, bigint, jsonb)', '37f6cdc603e05ba871f5d9f1dadb80a6', 'c999b954be5f70fe14ce7b2aa1ce2ddd'),
    ('public.reset_stat_points(text, bigint)', 'd86606fdd8fe2f9e3a7f4cb8ef75d064', '2865e8f99d62af7a326b7051ff57473e'),
    ('public.stat_reset_gift_use(text, bigint)', '36102de297b7c70871508c74c8aef9c9', 'df0bfa3058c605a80937702406e99a65'),
    ('public.buy_shop_item(text, text, integer, bigint, integer)', 'e2856fa90e8246f9023a62bcf456b951', 'ab70278a3a0dc906a7a8a8a67e395ba9'),
    ('public.reset_card_points_v2(text, bigint)', 'b3278aac743a4eaca4e3a07f6414bc1e', '09dfeb345fafdf77808098e681ae44a8')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_progress_freeze_v1.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the v2 reset, ONE function for the two callers (reset_card_points_v2, the Shop)
-- The M1c body of reset_card_points_v2 (combat_v2_progress_spend.sql), with one change: p_price. Null = the M1c rule (after the week and the
-- v2 gift: reset_used with next). A price = the Shop (after the week and the v2 gift: paid, with not_enough before any write).
create or replace function public.card_progress_v2_reset(p_player text, p_card bigint, p_price integer) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW'); v_used text; v_how text; v_bal int;
  r public.card_progress_v2%rowtype; v_role text; v_ref text; v_n int; v_want int;
begin
  -- the lock order of v1 (reset_stat_points): the player row, then the card
  select stat_reset_week, shard_balance into v_used, v_bal from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  if not exists (select 1 from player_cards where player_id = p_player and card_id = p_card and quantity > 0) then
    return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_progress'); end if;
  select s.ability_v2->>'role' into v_role from cards c left join subjects s on s.id = c.subject_id where c.id = p_card;
  if v_role is null or not exists (select 1 from roles where key = v_role) then
    return jsonb_build_object('ok', false, 'error', 'no_role'); end if;
  v_want := (r.atk_pts > 0)::int + (r.def_pts > 0)::int + (r.hp_pts > 0)::int + (r.crd_pts > 0)::int + (r.crt_pts > 0)::int
          + (r.abl_pts > 0)::int + (r.ddg_pts > 0)::int + (r.acc_pts > 0)::int + (r.spd_pts > 0)::int;
  if v_want = 0 then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
  -- the free reset: the weekly one (the v1 marker), else one open v2 gift (taken only when the week is used), else the price or reset_used
  if v_used is distinct from v_week then
    v_how := 'week';
  elsif stat_reset_gift_use_v2(p_player, p_card) then
    v_how := 'gift';
  elsif p_price is null then
    return jsonb_build_object('ok', false, 'error', 'reset_used',
      'next', (date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver');
  else
    if coalesce(v_bal, 0) < p_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', p_price); end if;
    v_how := 'paid';
  end if;
  -- the ledger FIRST: one row for each stat above 0, d_points = minus the count, one ref for the call
  v_ref := 'reset:' || nextval('public.card_progress_v2_ref_seq');
  insert into card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points)
  select r.id, p_player, p_card, 'reset', x.stat, v_ref, -x.n
    from (values ('atk', r.atk_pts), ('def', r.def_pts), ('hp', r.hp_pts), ('crd', r.crd_pts), ('crt', r.crt_pts),
                 ('abl', r.abl_pts), ('ddg', r.ddg_pts), ('acc', r.acc_pts), ('spd', r.spd_pts)) x(stat, n)
   where x.n > 0;
  get diagnostics v_n = row_count;
  if v_n <> v_want then raise exception 'card_progress_v2_reset: the ledger took % of % rows', v_n, v_want; end if;
  update card_progress_v2 set atk_pts = 0, def_pts = 0, hp_pts = 0, crd_pts = 0, crt_pts = 0, abl_pts = 0, ddg_pts = 0, acc_pts = 0, spd_pts = 0
   where id = r.id;
  if v_how = 'week' then update players set stat_reset_week = v_week where id = p_player; end if;
  return jsonb_build_object('ok', true, 'used', v_how) || card_progress_v2_view(p_player, p_card);
end $fn$;

-- ============================================================ 2. reset_card_points_v2 (M1c): the same answers, through the shared function
create or replace function public.reset_card_points_v2(p_player text, p_card bigint) returns jsonb
language plpgsql set search_path = public as $fn$
begin
  if not combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  return card_progress_v2_reset(p_player, p_card, null);
end $fn$;

-- ============================================================ 3. the v1 paths: the live text with added lines ("-- M1d")

CREATE OR REPLACE FUNCTION public.spend_stat_points(p_player text, p_card bigint, p_add jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_asc int; v_pts jsonb; v_rar text; v_mod numeric; v_new jsonb; k text; v jsonb; v_n int; v_total int; v_cap int;
begin
  -- M1d (plan 20.11 trap a, 20.14): v2 progress ON for this player (everyone or a tester) = the v1 points are frozen. Before any lock or write.
  if combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;   -- M1d
  if not coalesce((stat_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if p_add is null or jsonb_typeof(p_add) <> 'object' or p_add = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select pc.ascension, pc.stat_points, c.rarity::text, s.cp_mod into v_asc, v_pts, v_rar, v_mod
    from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0
    for update of pc;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  v_new := coalesce(v_pts, '{}'::jsonb);
  for k, v in select * from jsonb_each(p_add) loop
    if k not in ('attack', 'vitality', 'precision', 'potency', 'haste') then
      return jsonb_build_object('ok', false, 'error', 'bad_stat', 'stat', k); end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,2}$' then
      return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
    v_n := (v #>> '{}')::int;
    if v_n > 0 then v_new := v_new || jsonb_build_object(k, stat_pt(v_new, k) + v_n); end if;
  end loop;
  v_total := stat_pt(v_new, 'attack') + stat_pt(v_new, 'vitality') + stat_pt(v_new, 'precision')
           + stat_pt(v_new, 'potency') + stat_pt(v_new, 'haste');
  v_cap := coalesce((stat_cfg()->>'per_star')::int, 3) * coalesce(v_asc, 0);
  if v_total > v_cap then
    return jsonb_build_object('ok', false, 'error', 'not_enough',
      'free', (card_combat(v_rar, v_asc, v_mod, v_pts)->>'free')::int); end if;
  update player_cards set stat_points = v_new where player_id = p_player and card_id = p_card;
  return jsonb_build_object('ok', true, 'points', v_new, 'stats', card_combat(v_rar, v_asc, v_mod, v_new));
end $function$;


CREATE OR REPLACE FUNCTION public.reset_stat_points(p_player text, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW'); v_used text; v_pts jsonb;
  v_asc int; v_rar text; v_mod numeric;
begin
  -- M1d (plan 20.11 trap a, 20.14): v2 progress ON for this player (everyone or a tester) = the v1 points are frozen. Before any lock or write.
  if combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;   -- M1d
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
end $function$;


CREATE OR REPLACE FUNCTION public.stat_reset_gift_use(p_player text, p_card bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  with g as (
    select gift from stat_reset_gifts
     where player_id = p_player and used_at is null and expires_at > now()
       and not starts_with(gift, 'v2_')   -- M1d: a v2_ gift is for the v2 reset only (stat_reset_gift_use_v2). starts_with, not like ('_' is a wildcard in like)
     order by expires_at limit 1 for update)
  update stat_reset_gifts s set used_at = now(), used_card = p_card from g where s.player_id = p_player and s.gift = g.gift;
  return found;
end $function$;


CREATE OR REPLACE FUNCTION public.buy_shop_item(p_player text, p_kind text, p_slot integer DEFAULT NULL::integer, p_card bigint DEFAULT NULL::bigint, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_day date := shop_day(); v_bal int; v_price int; s shop_stock;
  v_pts jsonb; v_asc int; v_rar text; v_mod numeric; v_new int; v_used text; v_purchase bigint;
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  v_v2 jsonb;   -- M1d: the answer of the v2 reset (card_progress_v2_reset)
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
    -- M1d (plan 20.11 trap a, 20.14; Nathan 2026-10-23 "Yes A"): v2 progress ON for this player (everyone or a tester) = the Shop
    -- M1d: reset is the v2 reset (card_progress_v2_reset, one function for the Shop and the v2 reset): the free Mountain week first, then one
    -- M1d: open v2_ gift, else this price (not_enough before any write). Then the purchase row, then the Shards only when the price > 0.
    -- M1d: The v1 points (player_cards.stat_points) do not change. Before the stat_points flag: the v2 reset does not read that v1 flag.
    if combat_v2_on('progress', p_player) then   -- M1d
      v_price := game_shop_price((cfg->>'stat_reset_price')::int);   -- M1d
      v_v2 := card_progress_v2_reset(p_player, p_card, v_price);   -- M1d
      if not (v_v2->>'ok')::boolean then return v_v2; end if;   -- M1d
      if v_v2->>'used' <> 'paid' then v_price := 0; end if;   -- M1d
      insert into shop_purchases (player_id, day, kind, card_id, price) values (p_player, v_day, 'stat_reset', p_card, v_price) returning id into v_purchase;   -- M1d
      v_new := v_bal;   -- M1d
      if v_price > 0 then v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text); end if;   -- M1d
      return jsonb_build_object('ok', true, 'kind', 'stat_reset', 'free', v_price = 0, 'price', v_price, 'balance', v_new) || (v_v2 - 'ok');   -- M1d
    end if;   -- M1d
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
end $function$;


-- ============================================================ 4. server only (no change for the live functions), and the comments
revoke all on function public.card_progress_v2_reset(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.card_progress_v2_reset(text, bigint, integer) to service_role;
revoke all on function public.reset_card_points_v2(text, bigint) from public, anon, authenticated;
grant execute on function public.reset_card_points_v2(text, bigint) to service_role;
revoke all on function public.spend_stat_points(text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.reset_stat_points(text, bigint) from public, anon, authenticated;
revoke all on function public.stat_reset_gift_use(text, bigint) from public, anon, authenticated;
revoke all on function public.buy_shop_item(text, text, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.spend_stat_points(text, bigint, jsonb) to service_role;
grant execute on function public.reset_stat_points(text, bigint) to service_role;
grant execute on function public.stat_reset_gift_use(text, bigint) to service_role;
grant execute on function public.buy_shop_item(text, text, integer, bigint, integer) to service_role;

comment on function public.spend_stat_points(text, bigint, jsonb) is $c$Adds stat points to one card (attack, vitality, precision, potency, haste) up to the cap of its stars (balance key stat_points). Activity /api/stats/spend. Returns ok, points and stats, or an error. Frozen when combat v2 progress is ON for the player (combat_v2_on('progress', player): everyone or a tester): the answer disabled, before any lock or write (plan 20.11 trap a, combat_v2_progress_freeze_v1.sql).$c$;
comment on function public.reset_stat_points(text, bigint) is $c$Clears the stat points of one card, once per game week (players.stat_reset_week, America/Denver), then with one open v1 gift reset (stat_reset_gift_use). Activity /api/stats/reset. Returns ok and the new stats, or an error. Frozen when combat v2 progress is ON for the player (combat_v2_on('progress', player): everyone or a tester): the answer disabled, before any lock or write (plan 20.11 trap a, combat_v2_progress_freeze_v1.sql).$c$;
comment on function public.stat_reset_gift_use(text, bigint) is $c$Uses the next v1 gift reset of a player (stat_reset_gifts, not used, not expired, the earliest deadline first): true = used. Skips every gift whose key starts with v2_ (starts_with): those are for the v2 reset only (stat_reset_gift_use_v2). Called by reset_stat_points and buy_shop_item after the weekly free reset. combat_v2_progress_freeze_v1.sql.$c$;
comment on function public.buy_shop_item(text, text, integer, bigint, integer) is $c$A member buys with Shards: packs, a card of the day or a stat reset. The shop_purchases row comes first; the Shards row and the pack row have ref ('shop_purchase', its id). A free weekly stat reset writes no Shards row. When combat v2 progress is ON for the player (combat_v2_on('progress', player): everyone or a tester) the stat reset is the v2 reset (card_progress_v2_reset with the Shop price: the free week, then one v2_ gift, else the price; Nathan 2026-10-23 "Yes A"), then the shop_purchases row, then the Shards when the price > 0; the answer has the v2 progress and stats. Packs and cards do not change (plan 20.11 trap a, 20.14, combat_v2_progress_freeze_v1.sql).$c$;
comment on function public.card_progress_v2_reset(text, bigint, integer) is $cm$[combat] Combat v2 (plan 20.13, 20.14): the v2 reset of one card, written once for reset_card_points_v2 and the Shop (buy_shop_item stat_reset when progress is ON). The 9 point columns to 0; the level, the XP and bonus_points do not change. Free: one reset for each Mountain ISO week for each player (players.stat_reset_week), then one open v2 gift (stat_reset_gift_use_v2). Then: p_price null = reset_used with next; a price = paid (not_enough with balance and price when the Shards are less). Refuses with an answer before any write: no_player, not_owned, no_progress, no_role, nothing_spent. Writes the ledger FIRST (reason reset, one row for each stat above 0, one ref reset:<n>), then card_progress_v2. Answer {ok, used (week, gift or paid), progress, stats}. No flag check: its two callers check combat_v2_on. combat_v2_progress_freeze_v1.sql.$cm$;
comment on function public.reset_card_points_v2(text, bigint) is $cm$[combat] Combat v2 (plan 2.2, 20.13): a player resets the v2 points of a card to 0; the level, the XP and bonus_points do not change. Free: one reset for each Mountain ISO week for each player (players.stat_reset_week, the v1 marker), then one open v2 gift (stat_reset_gift_use_v2); else reset_used with next. Refuses with an answer before any write: disabled, no_player, not_owned, no_progress, no_role, nothing_spent. Writes the ledger FIRST (reason reset, one row for each stat above 0, d_points = minus the count, one ref reset:<n>), then card_progress_v2. Answer {ok, used (week or gift), progress, stats}. Since M1d the work is card_progress_v2_reset (price null), shared with the Shop: the same answers. combat_v2_progress_spend.sql, combat_v2_progress_freeze_v1.sql.$cm$;
comment on function public.combat_v2_on(text) is $cm$[combat] The ONE reader of the combat v2 switch (balance combat_v2, plan 14.2): true only when combat_v2.<p_mode> is the JSON boolean true (p_mode = gauntlet, dungeon, hunt or progress). Fails closed: a missing key, another type, a name that is not one of the four capabilities or any error gives false. Its only caller is combat_v2_on(text, text). Since combat_v2_progress_freeze_v1.sql (M1d) three v1 functions read the switch through that form: spend_stat_points and reset_stat_points (they refuse when progress is ON) and buy_shop_item (its stat reset is the v2 reset when progress is ON).$cm$;
comment on function public.combat_v2_on(text, text) is $cm$[combat] The combat v2 switch for one player (plan 14.2, the go-live steps): true when combat_v2_on(p_mode) is true (the mode is on for everyone), or when p_mode is gauntlet, dungeon, hunt or progress and p_player is in balance combat_v2.testers. The tester part fails closed: a NULL mode or player, an unknown capability, a value that does not match the fixed shape (balance_v2_spec), no row or any error gives false. Its readers: the v2 spend and reset (spend_card_points_v2, reset_card_points_v2) and, since combat_v2_progress_freeze_v1.sql (M1d), the v1 freeze of spend_stat_points and reset_stat_points and the Shop route of buy_shop_item (stat_reset) with progress. combat_v2_testers.sql.$cm$;

notify pgrst, 'reload schema';
