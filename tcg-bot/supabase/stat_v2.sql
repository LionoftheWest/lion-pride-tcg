-- stat_v2.sql (2026-11-06): STAT-V2, the v2 stat points of a card on the Activity stat screen (SYS-1 item STAT-V2, SPEC v3 sections 4.2
-- and 4.3; register UI-10). Needs combat_v2_progress_spend.sql (M1c), combat_v2_progress_freeze_v1.sql (M1d), combat_v2_convert.sql (M1e)
-- and combat_v2_testers.sql. Apply it only after combat_v2_switch_on.sql ran (a combat_v2_switch_log row with action on).
-- Before: after the switch the old 5-stat editor cannot save (the v1 spend and reset answer disabled), no Activity route calls the v2 spend
--   and reset, a starred card with no v1 points has no card_progress_v2 row (the M1c spend refuses it: no_progress), the M1c budget is the
--   STORED level while a fight uses v2_convert.level_per_star x the CURRENT stars, and the Shop stat reset is paused for everyone (M1e).
-- After this file:
--   settings stat_v2 = {"enabled": false, "users": [...]}: the flag. users starts as a copy of balance combat_v2.testers (no member id is
--     written in this public repo; ui_v3_flag.sql and combat_v2_testers.sql have the same rule). stat_v2_on.sql and stat_v2_off.sql set
--     enabled. The trigger settings_log_write records every change.
--   stat_v2_on(player): true when combat_v2_on('progress') (ONE argument: the global flag, the same term as card_progress_v2_fight) AND
--     (stat_v2.enabled is true OR the player is in stat_v2.users). A bad shape, no row or an error = false. A combat_v2 tester alone = false.
--   card_progress_v2_sync(player, card, level): server only, called only by stat_v2_spend (which holds the player_cards row lock). Makes the
--     progress row if none (insert ... on conflict do nothing, then select ... for update). When the stored level is below the given level:
--     ONE ledger row FIRST (grant_level, ref stars:<n> of card_progress_v2_ref_seq), then the row (level, xp = card_level_xp_at(level)).
--     It never lowers a level. A negative XP step raises.
--   stat_v2_spend(player, card, add): every refusal BEFORE any write: disabled, the M1c input checks (bad_request, bad_stat, bad_amount),
--     not_owned (the player_cards row is locked for update: it serializes two calls on one card, also with no progress row), no_role,
--     stat_cap (with cap), not_enough (with free; the budget = the FIGHT level x v2_level.points_per_level + bonus_points). Only then the
--     sync to the fight level and the M1c spend_card_points_v2 (unchanged). A refusal of the inner call raises (all rolls back).
--     Answer: the M1c answer with stats = the screen line of the card (card_stats_v2_entry).
--   stat_v2_reset(player, card): disabled unless stat_v2_on, else reset_card_points_v2 (M1c / M1d, unchanged).
--   card_stats_v2_entry(player, card, numbers): the screen line of one owned card with a v2 role: {v2, level, bonus, points (9), free, cap,
--     cp, hp, crit, potency, haste}. level, points, bonus = card_progress_v2_fight; cp, hp = card_combat_v2 stats atk and hp of that line;
--     crit = stats.crt - v2_stats.crt.base (the tile adds the base); potency and haste = the v1 numbers of card_stats_for (play_card_effect
--     still uses the v1 points), 1 for a card that card_stats_for does not list.
--   card_stats_v2_for(player): {on, week, reset_week, cards: {card_id: entry}} for every owned card with a role; flag off = {on: false}.
--   buy_shop_item, shop_today: the M1e pause holds only while stat_v2_on is false for the player (-- STAT-V2). With the flag on, the M1d
--     route runs (the v2 reset with the Shop price).
--   combat_v2_convert_check: the expected row = combat_v2_convert_expect(the current input) PLUS the ledger rows of that progress row whose
--     reason is spend, reset or xp, or grant_level with a ref stars:<n> (the later rows). The T6 ledger sum check does not change.
--   combat_v2_convert_fix: a row with a grant_level stars:<n> row is reported (never deleted), like a row with a spend, reset or xp row.
--   balance stat_labels_v2 (the names of the 9 v2 stats, public) and its limits trigger balance_check_stat_labels_v2. The name is not
--     v2_stat_labels: balance_check_combat_v2 refuses a v2_ key with no shape in balance_v2_spec, and that shape language has no text type.
-- FLAG OFF = NO CHANGE: with stat_v2 off for a player, every answer of the replaced functions is the answer of before (G-S5, G-S10).
-- Every number comes from balance. Idempotent. Server only (no grant to anon or authenticated).
-- GUARD: each replaced function is the live text of 2026-11-06 (db/schema at 37f3025b, M1e) or the text of this file.
-- Test: card-studio/scripts/test-stat-v2.mjs (rolled back; MUTATE=all) and test-stat-v2-concurrency.mjs (two sessions). Undo: stat_v2_undo.sql.

do $g$
declare m text; f record;
begin
  if not exists (select 1 from public.combat_v2_switch_log where action = 'on') then
    raise exception 'stat_v2.sql: no combat_v2_switch_log row with action on (apply it only after combat_v2_switch_on.sql)';
  end if;
  for f in select * from (values
    ('public.buy_shop_item(text, text, integer, bigint, integer)', '8533f2ba1f335adf480056a3209a3de1', '31d8c4a659dce0389c6e10002eeb5f64'),
    ('public.shop_today(text)', 'b9e70bc35a593b918e310effb19c2a1d', '843444fd75d6cede06dc81a0eedf5a35'),
    ('public.combat_v2_convert_check(bigint[])', 'e000b29a81d4871e91fca994a6b171ef', '9b36127eaf6cbe2428d3c228aafac059'),
    ('public.combat_v2_convert_fix(bigint[])', '83b8a9b451da09194bcb83517736cd70', '720743b7c0ca03686eea58e8c365a940')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'stat_v2.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the flag (settings stat_v2) and its reader
insert into public.settings (key, value)
select 'stat_v2', jsonb_build_object('enabled', false, 'users', coalesce((select b.value->'testers' from public.balance b where b.key = 'combat_v2'), '[]'::jsonb))
on conflict (key) do nothing;

create or replace function public.stat_v2_on(p_player text) returns boolean
language plpgsql stable set search_path = public as $fn$
declare v jsonb;
begin
  -- the global progress flag (one argument): card_progress_v2_fight gives level 0 without it, so a tester alone never turns this on
  if not combat_v2_on('progress') then return false; end if;
  select s.value into v from settings s where s.key = 'stat_v2';
  if v is null or jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'enabled') is distinct from 'boolean'
     or jsonb_typeof(v->'users') is distinct from 'array' then return false; end if;
  if v->'enabled' = 'true'::jsonb then return true; end if;
  return p_player is not null and v->'users' ? p_player;
exception when others then
  return false;
end $fn$;

-- ============================================================ 2. the sync of the stored level to the fight level (server only)
create or replace function public.card_progress_v2_sync(p_player text, p_card bigint, p_level integer) returns void
language plpgsql set search_path = public as $fn$
declare r public.card_progress_v2%rowtype; v_dxp int;
begin
  if p_level is null or p_level < 0 then raise exception 'card_progress_v2_sync: the level must be 0 or more'; end if;
  -- the row (level 0, xp 0) if none: a second caller waits on the player_cards lock of stat_v2_spend, then finds the row
  insert into card_progress_v2 (player_id, card_id) values (p_player, p_card) on conflict (player_id, card_id) do nothing;
  select * into strict r from card_progress_v2 where player_id = p_player and card_id = p_card for update;
  if r.level < p_level then
    v_dxp := card_level_xp_at(p_level) - r.xp;
    if v_dxp < 0 then
      raise exception 'card_progress_v2_sync: the XP % of the row is above the XP of level % (a later XP rule must say how XP and the stars combine)', r.xp, p_level;
    end if;
    -- the ledger FIRST (one grant_level row, one ref for the call), then the row
    insert into card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp)
      values (r.id, p_player, p_card, 'grant_level', '', 'stars:' || nextval('public.card_progress_v2_ref_seq'), p_level - r.level, v_dxp);
    update card_progress_v2 set level = p_level, xp = r.xp + v_dxp where id = r.id;
  end if;
end $fn$;

-- ============================================================ 3. the screen line of one card, and of every card of a player (reads only)
create or replace function public.card_stats_v2_entry(p_player text, p_card bigint, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := p_b; c record; f jsonb; pts jsonb := '{}'; k text; v_spent int := 0; v_lv int; v_bonus int; s jsonb; v1 jsonb;
begin
  if b is null or not (b ? 'v2_stats' and b ? 'v2_level' and b ? 'v2_convert' and b ? 'v1') then
    b := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_convert'])
         || jsonb_build_object('v1', card_balance());
  end if;
  select cc.rarity::text as rarity, pc.ascension, pc.stat_points, s2.cp_mod, s2.ability_v2->>'role' as role into c
    from player_cards pc join cards cc on cc.id = pc.card_id left join subjects s2 on s2.id = cc.subject_id
   where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0;
  if not found or c.role is null or not exists (select 1 from roles where key = c.role) then return null; end if;
  f := card_progress_v2_fight(p_player, p_card, b);
  v_lv := (f->>'level')::int; v_bonus := coalesce((f->>'bonus')::int, 0);
  -- the 9 stats of v2_stats (every key but max_per_stat), 0 when the row has none
  for k in select x from jsonb_object_keys(b->'v2_stats') x where x <> 'max_per_stat' order by 1 loop
    pts := pts || jsonb_build_object(k, coalesce((f->'points'->>k)::int, 0));
    v_spent := v_spent + coalesce((f->'points'->>k)::int, 0);
  end loop;
  s := card_combat_v2(c.rarity, c.ascension, c.cp_mod, v_lv, pts, c.role, b, v_bonus)->'stats';
  -- the effect card: play_card_effect uses the v1 points (card_combat potency and haste); card_stats_for lists a card with stars or v1 points
  if coalesce(c.ascension, 0) > 0 or coalesce(c.stat_points, '{}'::jsonb) <> '{}'::jsonb then
    v1 := card_combat(c.rarity, c.ascension, c.cp_mod, c.stat_points, b->'v1');
  end if;
  return jsonb_build_object('v2', true, 'level', v_lv, 'bonus', v_bonus, 'points', pts,
    'free', v_lv * (b->'v2_level'->>'points_per_level')::int + v_bonus - v_spent,
    'cap', (b->'v2_stats'->>'max_per_stat')::int,
    'cp', s->'atk', 'hp', s->'hp', 'crit', to_jsonb((s->>'crt')::numeric - (b->'v2_stats'->'crt'->>'base')::numeric),
    'potency', coalesce(v1->'potency', to_jsonb(1)), 'haste', coalesce(v1->'haste', to_jsonb(1)));
end $fn$;

create or replace function public.card_stats_v2_for(p_player text) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare b jsonb;
begin
  if not stat_v2_on(p_player) then return jsonb_build_object('on', false); end if;
  b := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_convert'])
       || jsonb_build_object('v1', card_balance());
  -- week and reset_week: the keys of card_stats_for (the free weekly reset)
  return jsonb_build_object('on', true,
    'reset_week', (select stat_reset_week from players where id = p_player),
    'week', to_char(now() at time zone 'America/Denver', 'IYYY-IW'),
    'cards', coalesce((select jsonb_object_agg(x.card_id::text, x.e) from (
        select pc.card_id, card_stats_v2_entry(p_player, pc.card_id, b) as e from player_cards pc
         where pc.player_id = p_player and pc.quantity > 0) x where x.e is not null), '{}'::jsonb));
end $fn$;

-- ============================================================ 4. the spend (every refusal before any write) and the reset
create or replace function public.stat_v2_spend(p_player text, p_card bigint, p_add jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  k text; v jsonb; v_role text; f jsonb; r public.card_progress_v2%rowtype; v_cap int; v_ppl int; v_add int := 0; v_spent int := 0;
  v_budget int; v_lv int; a jsonb;
begin
  -- 1. the flag
  if not stat_v2_on(p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- 2. the input checks of M1c (spend_card_points_v2), the same words
  if p_add is null or jsonb_typeof(p_add) <> 'object' or p_add = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  for k, v in select * from jsonb_each(p_add) loop
    if k not in ('atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd') then
      return jsonb_build_object('ok', false, 'error', 'bad_stat', 'stat', k); end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[1-9][0-9]?$' then
      return jsonb_build_object('ok', false, 'error', 'bad_amount', 'stat', k); end if;
    v_add := v_add + (v #>> '{}')::int;
  end loop;
  -- 3. the owned card, locked: two calls on one card wait here, also when the card has no progress row yet
  perform 1 from player_cards where player_id = p_player and card_id = p_card and quantity > 0 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  -- 4. the role
  select s.ability_v2->>'role' into v_role from cards c left join subjects s on s.id = c.subject_id where c.id = p_card;
  if v_role is null or not exists (select 1 from roles where key = v_role) then
    return jsonb_build_object('ok', false, 'error', 'no_role'); end if;
  -- 5. the budget of the FIGHT level (no write): fight level x points_per_level + the bonus of the stored row
  f := card_progress_v2_fight(p_player, p_card);
  v_lv := (f->>'level')::int;
  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card;
  v_cap := balance_num('v2_stats', 'max_per_stat')::int;
  v_ppl := balance_num('v2_level', 'points_per_level')::int;
  v_budget := v_lv * v_ppl + coalesce(r.bonus_points, 0);
  if r.id is not null then
    v_spent := r.atk_pts + r.def_pts + r.hp_pts + r.crd_pts + r.crt_pts + r.abl_pts + r.ddg_pts + r.acc_pts + r.spd_pts;
  end if;
  -- 6. the cap of each stat, then the budget
  if coalesce(r.atk_pts, 0) + coalesce((p_add->>'atk')::int, 0) > v_cap or coalesce(r.def_pts, 0) + coalesce((p_add->>'def')::int, 0) > v_cap
     or coalesce(r.hp_pts, 0) + coalesce((p_add->>'hp')::int, 0) > v_cap or coalesce(r.crd_pts, 0) + coalesce((p_add->>'crd')::int, 0) > v_cap
     or coalesce(r.crt_pts, 0) + coalesce((p_add->>'crt')::int, 0) > v_cap or coalesce(r.abl_pts, 0) + coalesce((p_add->>'abl')::int, 0) > v_cap
     or coalesce(r.ddg_pts, 0) + coalesce((p_add->>'ddg')::int, 0) > v_cap or coalesce(r.acc_pts, 0) + coalesce((p_add->>'acc')::int, 0) > v_cap
     or coalesce(r.spd_pts, 0) + coalesce((p_add->>'spd')::int, 0) > v_cap then
    return jsonb_build_object('ok', false, 'error', 'stat_cap', 'cap', v_cap); end if;
  if v_spent + v_add > v_budget then
    return jsonb_build_object('ok', false, 'error', 'not_enough', 'free', v_budget - v_spent); end if;
  -- 7. only now: the stored level to the fight level, then the M1c spend (unchanged). Its refusal rolls back the whole call
  perform card_progress_v2_sync(p_player, p_card, v_lv);
  a := spend_card_points_v2(p_player, p_card, p_add);
  if not coalesce((a->>'ok')::boolean, false) then
    raise exception 'stat_v2_spend: the v2 spend refused after the checks: %', a::text;
  end if;
  return (a - 'stats') || jsonb_build_object('stats', card_stats_v2_entry(p_player, p_card));
end $fn$;

create or replace function public.stat_v2_reset(p_player text, p_card bigint) returns jsonb
language plpgsql set search_path = public as $fn$
begin
  if not stat_v2_on(p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  return reset_card_points_v2(p_player, p_card);
end $fn$;

-- ============================================================ 5. the Shop: the M1e pause only while the flag is off (the live text + the STAT-V2 lines)
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
  -- M1e (SPEC ON 3.7 rule 5b, r3 M-1, N-10): with v2 progress ON for this player the Shop stat reset is paused until the v2 stats screen
  -- M1e: (no v2 spend route exists). The refusal is BEFORE the player lock, any write and any Shard charge; the free week and the gifts stay.
  -- STAT-V2: with the stat_v2 flag on for this player (stat_v2.sql) the v2 stat screen exists: no pause, the M1d route below runs.
  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) and not stat_v2_on(p_player) then   -- STAT-V2
    return jsonb_build_object('ok', false, 'error', 'stat_reset_paused', 'message', 'Stat reset returns with the v2 stats screen.');   -- M1e
  end if;   -- M1e
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
    -- M1d (plan 20.11 trap a, 20.17; Nathan 2026-10-23 "Yes A"): v2 progress ON for this player (everyone or a tester) = the Shop
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

CREATE OR REPLACE FUNCTION public.shop_today(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_day date := shop_day();
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  v_v2 boolean := combat_v2_on('progress', p_player);   -- M1d: the Shop reset of this player is the v2 reset (buy_shop_item)
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
    -- M1d (plan 20.17, REVIEW-r1 F1): the free reset that this answer shows is the one that buy_shop_item(stat_reset) then takes. v2 progress
    -- M1d: ON = the v2 reset takes only a v2_ gift; OFF = the v1 gift use skips every v2_ gift. The 3 keys below come again after the 3 keys
    -- M1d: above: in jsonb the LAST value of a key is kept, so these 3 values are the answer (and the lines above stay the live text).
    'free_reset', (select stat_reset_week from players where id = p_player) is distinct from v_week   -- M1d
      or exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now() and starts_with(g.gift, 'v2_') = v_v2),   -- M1d
    'gift_reset', exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now() and starts_with(g.gift, 'v2_') = v_v2),   -- M1d
    'gift_reset_until', (select min(g.expires_at) from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now() and starts_with(g.gift, 'v2_') = v_v2),   -- M1d
    'stat_reset_paused', v_v2 and not stat_v2_on(p_player),   -- STAT-V2: paused (buy_shop_item) while v2 progress is ON and the stat_v2 flag is off for this player
    'free_reset_next', ((date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver'),
    'max_packs_per_buy', coalesce((cfg->>'max_packs_per_buy')::int, 10),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('slot', s.slot, 'card_id', s.card_id, 'rarity', s.rarity, 'price', game_shop_price(s.price),
                 'bought', exists (select 1 from shop_purchases p where p.player_id = p_player and p.day = v_day and p.kind = 'card' and p.slot = s.slot))
                 order by s.slot) from shop_stock s where s.day = v_day), '[]'::jsonb));
end $function$;
-- ============================================================ 6. the M1e check and fix: the later ledger rows (the live text + the STAT-V2 lines)
create or replace function public.combat_v2_convert_check(p_cards bigint[] default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  v_on timestamptz := (select max(at) from public.combat_v2_switch_log where action = 'on');
  r record; e jsonb; p public.card_progress_v2%rowtype; why text[]; items jsonb := '[]';
  n_miss int := 0; n_bad int := 0; n_live int := 0; n_log int := 0; n_cards int := 0; s text; led record;
  lt_n int; lt_lv int; lt_xp int; lt_bo int; lt_pts jsonb;   -- STAT-V2: the later ledger rows of a row
begin
  for r in
    with k as (
      select player_id, card_id from public.combat_v2_convert_input
      union select player_id, card_id from public.card_progress_v2
      union select player_id, card_id from public.player_cards where stat_points is not null and stat_points <> '{}'::jsonb)
    select k.player_id, k.card_id, pc.stat_points as live,
           (select row_to_json(x)::jsonb from (select i.id, i.ref, i.stars, i.stat_points from public.combat_v2_convert_input i
             where i.player_id = k.player_id and i.card_id = k.card_id order by i.at desc, i.id desc limit 1) x) as cur
      from k join public.player_cards pc on pc.player_id = k.player_id and pc.card_id = k.card_id   -- only cards whose player_cards row exists (r3 L-4)
     where p_cards is null or k.card_id = any(p_cards)
     order by k.player_id, k.card_id
  loop
    n_cards := n_cards + 1; why := '{}';
    -- 2a: each card with v1 points has an input row
    if r.cur is null and coalesce(r.live, '{}'::jsonb) <> '{}'::jsonb then why := why || 'input_missing'::text; n_miss := n_miss + 1; end if;
    -- 2a: the progress row = combat_v2_convert_expect(the current input row), and its ledger rows sum to it (T6 of M1a). A card with no input
    -- row has no M1e row to check (a row that M1e did not make is never changed by the fix)
    select * into p from public.card_progress_v2 where player_id = r.player_id and card_id = r.card_id;
    e := case when r.cur is not null then combat_v2_convert_expect(r.card_id, (r.cur->>'stars')::int, r.cur->'stat_points') end;
    -- STAT-V2 (H1, I7): the later ledger rows of the row (reason spend, reset or xp, or a grant_level of card_progress_v2_sync with a ref
    -- STAT-V2: stars:<n>) are added to the expected row, so a spent or synced row is checked against (conversion + later rows), stat by stat.
    if r.cur is not null and p.id is not null then   -- STAT-V2
      select count(*), coalesce(sum(d_level), 0), coalesce(sum(d_xp), 0), coalesce(sum(d_bonus), 0) into lt_n, lt_lv, lt_xp, lt_bo   -- STAT-V2
        from public.card_progress_v2_log where progress_id = p.id   -- STAT-V2
         and (reason in ('spend', 'reset', 'xp') or (reason = 'grant_level' and starts_with(ref, 'stars:')));   -- STAT-V2
      if lt_n > 0 then   -- STAT-V2
        if not (e->>'row')::boolean then   -- STAT-V2: the input gave no row; the later rows made it (from level 0, no points)
          e := jsonb_build_object('row', true, 'level', 0, 'xp', 0, 'bonus', 0, 'points', jsonb_build_object('atk', 0, 'def', 0, 'hp', 0, 'crd', 0, 'crt', 0, 'abl', 0, 'ddg', 0, 'acc', 0, 'spd', 0));   -- STAT-V2
        end if;   -- STAT-V2
        select jsonb_object_agg(x.key, x.value::int + coalesce(l.n, 0)) into lt_pts from jsonb_each_text(e->'points') x   -- STAT-V2
          left join (select stat, sum(d_points) as n from public.card_progress_v2_log where progress_id = p.id and stat <> ''   -- STAT-V2
                       and (reason in ('spend', 'reset', 'xp') or (reason = 'grant_level' and starts_with(ref, 'stars:'))) group by stat) l on l.stat = x.key;   -- STAT-V2
        e := e || jsonb_build_object('level', (e->>'level')::int + lt_lv, 'xp', (e->>'xp')::int + lt_xp, 'bonus', (e->>'bonus')::int + lt_bo, 'points', lt_pts);   -- STAT-V2
      end if;   -- STAT-V2
    end if;   -- STAT-V2
    if r.cur is null then
      null;
    elsif (e->>'row')::boolean is distinct from (p.id is not null)
       or (p.id is not null and (p.level <> (e->>'level')::int or p.xp <> (e->>'xp')::int or p.bonus_points <> (e->>'bonus')::int
            or p.atk_pts <> (e->'points'->>'atk')::int or p.def_pts <> (e->'points'->>'def')::int or p.hp_pts <> (e->'points'->>'hp')::int
            or p.crd_pts <> (e->'points'->>'crd')::int or p.crt_pts <> (e->'points'->>'crt')::int or p.abl_pts <> (e->'points'->>'abl')::int
            or p.ddg_pts <> (e->'points'->>'ddg')::int or p.acc_pts <> (e->'points'->>'acc')::int or p.spd_pts <> (e->'points'->>'spd')::int)) then
      why := why || 'progress_mismatch'::text; n_bad := n_bad + 1;
    elsif p.id is not null then
      select coalesce(sum(d_level), 0) as lv, coalesce(sum(d_xp), 0) as xp, coalesce(sum(d_bonus), 0) as bo, coalesce(sum(d_points), 0) as pt into led
        from public.card_progress_v2_log where progress_id = p.id;
      if led.lv <> p.level or led.xp <> p.xp or led.bo <> p.bonus_points
         or led.pt <> p.atk_pts + p.def_pts + p.hp_pts + p.crd_pts + p.crt_pts + p.abl_pts + p.ddg_pts + p.acc_pts + p.spd_pts then
        why := why || 'progress_mismatch'::text; n_bad := n_bad + 1;
      end if;
    end if;
    -- 2b: the live v1 points = the current input row
    if r.cur is not null and coalesce(r.live, '{}'::jsonb) is distinct from r.cur->'stat_points' then why := why || 'live_differs'::text; n_live := n_live + 1; end if;
    -- 2b: no v1 spend or reset after the switch (a dust, sale or trade delete is not counted: only rows whose card still exists)
    if v_on is not null and exists (select 1 from public.stat_point_log l where l.player_id = r.player_id and l.card_id = r.card_id
                                      and l.reason in ('spend', 'reset') and l.changed_at > v_on) then
      why := why || 'log_after_switch'::text; n_log := n_log + 1;
    end if;
    if cardinality(why) > 0 then
      items := items || jsonb_build_object('player_id', r.player_id, 'card_id', r.card_id, 'why', to_jsonb(why));
    end if;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(items) = 0, 'switch_at', v_on, 'cards', n_cards, 'input_missing', n_miss,
    'progress_mismatch', n_bad, 'live_differs', n_live, 'log_after_switch', n_log, 'items', items);
end $fn$;

create or replace function public.combat_v2_convert_fix(p_cards bigint[] default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  it jsonb; pid bigint; inp bigint; w jsonb; n_fix int := 0; n_spent int := 0; n_second int := 0; n_log int := 0; n_led int := 0;
  v_p text; v_c bigint;
begin
  perform pg_advisory_xact_lock(hashtext('combat_v2_convert'));
  for it in select x from jsonb_array_elements(combat_v2_convert_check(p_cards)->'items') x loop
    v_p := it->>'player_id'; v_c := (it->>'card_id')::bigint;
    -- a card that only has a v1 log row (no difference): reported, no change
    if not (it->'why' ?| array['input_missing', 'progress_mismatch', 'live_differs']) then n_log := n_log + 1; continue; end if;
    select id into pid from public.card_progress_v2 where player_id = v_p and card_id = v_c;
    -- (1) a row with a v2 spend, reset or XP row: reported, no change
    if pid is not null and exists (select 1 from public.card_progress_v2_log where progress_id = pid and reason in ('spend', 'reset', 'xp')) then
      n_spent := n_spent + 1; continue; end if;
    -- STAT-V2: a row with a grant_level of card_progress_v2_sync (ref stars:<n>) is reported, never deleted (its level is the star level)
    if pid is not null and exists (select 1 from public.card_progress_v2_log where progress_id = pid and reason = 'grant_level' and starts_with(ref, 'stars:')) then   -- STAT-V2
      n_spent := n_spent + 1; continue; end if;   -- STAT-V2
    -- at most ONE m1b input row per card (r4 L-2): a card that needs a second one is reported
    if exists (select 1 from public.combat_v2_convert_input where ref = 'm1b' and player_id = v_p and card_id = v_c) then
      n_second := n_second + 1; continue; end if;
    -- (2) the undo of this card (its old ledger rows stay: the history of a dead progress_id)
    if pid is not null then delete from public.card_progress_v2 where id = pid; end if;
    -- (3) the new input row = the live values; (4) one clean conversion into a NEW progress row
    insert into public.combat_v2_convert_input (ref, player_id, card_id, stars, stat_points)
      select 'm1b', pc.player_id, pc.card_id, coalesce(pc.ascension, 0), coalesce(pc.stat_points, '{}'::jsonb)
        from public.player_cards pc where pc.player_id = v_p and pc.card_id = v_c
      returning id into inp;
    w := combat_v2_convert_write(inp);
    n_fix := n_fix + 1;
    if (w->>'row')::boolean then n_led := n_led + (w->>'ledger')::int; end if;
  end loop;
  return jsonb_build_object('ok', true, 'fixed', n_fix, 'ledger_rows', n_led, 'reported_spent', n_spent, 'reported_second_fix', n_second,
    'reported_log_only', n_log);
end $fn$;
-- ============================================================ 7. the names of the 9 v2 stats (public balance key) and their limits

create or replace function public.balance_check_stat_labels_v2() returns trigger language plpgsql set search_path = public as $f$
declare k text; v jsonb;
begin
  if new.key = 'stat_labels_v2' then
    foreach k in array array['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'object' then
        raise exception 'balance stat_labels_v2: % must be an object with label and short', k;
      end if;
      if jsonb_typeof(v->'label') is distinct from 'string' or length(trim(v->>'label')) not between 1 and 14 or v->>'label' <> trim(v->>'label') then
        raise exception 'balance stat_labels_v2: % label must be 1 to 14 characters', k;
      end if;
      if jsonb_typeof(v->'short') is distinct from 'string' or length(trim(v->>'short')) not between 1 and 4 or v->>'short' <> trim(v->>'short') then
        raise exception 'balance stat_labels_v2: % short must be 1 to 4 characters', k;
      end if;
      if (select count(*) from jsonb_object_keys(v)) <> 2 then
        raise exception 'balance stat_labels_v2: % has only label and short', k;
      end if;
    end loop;
    if (select count(*) from jsonb_object_keys(new.value)) <> 9 then
      raise exception 'balance stat_labels_v2: only the 9 v2 stats (atk, def, hp, crd, crt, abl, ddg, acc, spd)';
    end if;
  end if;
  return new;
end $f$;
drop trigger if exists balance_check_stat_labels_v2 on public.balance;
create trigger balance_check_stat_labels_v2 before insert or update on public.balance
  for each row execute function public.balance_check_stat_labels_v2();
-- the value (after the trigger, so the seed is checked; an existing value stays; balance_log_write records it)
select set_config('balance.by', 'nathan', true);
insert into public.balance (key, value, note) values ('stat_labels_v2', jsonb_build_object(
  'atk', jsonb_build_object('label', 'Attack',      'short', 'ATK'),
  'def', jsonb_build_object('label', 'Defense',     'short', 'DEF'),
  'hp',  jsonb_build_object('label', 'HP',          'short', 'HP'),
  'crd', jsonb_build_object('label', 'Crit Damage', 'short', 'CRD'),
  'crt', jsonb_build_object('label', 'Crit %',      'short', 'CRT'),
  'abl', jsonb_build_object('label', 'Ability',     'short', 'ABL'),
  'ddg', jsonb_build_object('label', 'Dodge',       'short', 'DDG'),
  'acc', jsonb_build_object('label', 'Accuracy',    'short', 'ACC'),
  'spd', jsonb_build_object('label', 'Speed',       'short', 'SPD')),
  'The names of the 9 combat v2 stats as a player reads them (UI-67 03 Stat icons, approved 2026-10-19; stat_v2.sql, STAT-V2). The key is the stored v2 stat (atk, def, hp, crd, crt, abl, ddg, acc, spd, the columns of card_progress_v2) and does not change; label = the name on the stat screen, short = the chip form (at most 4 letters). Read by the Activity through the public balance (/api/flags). No fight reads this key. Limits: balance_check_stat_labels_v2 (all 9 stats, a label of 1 to 14 characters, a short of 1 to 4). Not named v2_stat_labels: a v2_ key needs a shape in balance_v2_spec, which has no text type.')
on conflict (key) do nothing;

-- ============================================================ 8. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['stat_v2_on(text)', 'card_progress_v2_sync(text, bigint, integer)', 'card_stats_v2_entry(text, bigint, jsonb)',
                           'card_stats_v2_for(text)', 'stat_v2_spend(text, bigint, jsonb)', 'stat_v2_reset(text, bigint)',
                           'balance_check_stat_labels_v2()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.stat_v2_on(text) is $cm$[combat] STAT-V2 flag (stat_v2.sql): true when combat_v2_on('progress') (the global flag, one argument) and settings stat_v2 has enabled true or the player in users. A bad shape, no row or an error = false; a combat_v2 tester alone = false. Read by stat_v2_spend, stat_v2_reset, card_stats_v2_for, buy_shop_item and shop_today; the Activity reads the same row (statV2 in /api/flags).$cm$;
comment on function public.card_progress_v2_sync(text, bigint, integer) is $cm$[combat] STAT-V2 (stat_v2.sql): makes the card_progress_v2 row of a card if none (level 0) and raises its stored level to the given level (never lowers it): one grant_level ledger row FIRST (ref stars:<n> of card_progress_v2_ref_seq, d_level, d_xp to card_level_xp_at), then the row. Raises on a negative XP step. Server only; called only by stat_v2_spend, which holds the player_cards row lock.$cm$;
comment on function public.card_stats_v2_entry(text, bigint, jsonb) is $cm$[combat] STAT-V2 (stat_v2.sql): the stat screen line of one owned card with a v2 role, or null: {v2, level, bonus, points (the 9 stats), free = level x v2_level.points_per_level + bonus - spent, cap = v2_stats.max_per_stat, cp = card_combat_v2 stats.atk, hp = stats.hp, crit = stats.crt - v2_stats.crt.base, potency and haste = the v1 card_combat numbers that play_card_effect uses (1 with no stars and no v1 points)}. level, points and bonus = card_progress_v2_fight. Reads only.$cm$;
comment on function public.card_stats_v2_for(text) is $cm$[combat] STAT-V2 (stat_v2.sql): the v2 stat screen of a player: {on: true, week, reset_week, cards: {card_id: card_stats_v2_entry}} for every owned card with a v2 role; {on: false} when stat_v2_on is false. Read by the Activity /api/collection. Reads only.$cm$;
comment on function public.stat_v2_spend(text, bigint, jsonb) is $cm$[combat] STAT-V2 (stat_v2.sql): a player spends v2 points on a card from the stat screen. Refuses with an answer before any write: disabled (stat_v2_on), bad_request, bad_stat, bad_amount, not_owned (the player_cards row is locked for update), no_role, stat_cap (with cap), not_enough (with free; budget = the card_progress_v2_fight level x v2_level.points_per_level + bonus_points). Then card_progress_v2_sync to the fight level and spend_card_points_v2 (M1c); a refusal of that call raises. Answer: the M1c answer with stats = card_stats_v2_entry.$cm$;
comment on function public.stat_v2_reset(text, bigint) is $cm$[combat] STAT-V2 (stat_v2.sql): the v2 reset of a card from the stat screen: disabled unless stat_v2_on, else reset_card_points_v2 (M1c / M1d: the free week, then a v2_ gift).$cm$;
comment on function public.combat_v2_convert_check(bigint[]) is $cm$[combat] Combat v2 M1e live check (SPEC ON 6.7 rows 2a and 2b), with the STAT-V2 later rows (stat_v2.sql). Reads only. For each card whose player_cards row exists: input_missing (v1 points and no input row), progress_mismatch (the progress row is not combat_v2_convert_expect of the current input row PLUS the later ledger rows of the row: reason spend, reset or xp, or grant_level with a ref stars:<n> of card_progress_v2_sync; or its ledger rows do not sum to it), live_differs (the live v1 points are not the current input), log_after_switch (a stat_point_log spend or reset after the newest combat_v2_switch_log on row). Answer: the counts and the items (ok = no item). combat_v2_convert.sql, stat_v2.sql.$cm$;
comment on function public.combat_v2_convert_fix(bigint[]) is $cm$[combat] Combat v2 M1e fix path (SPEC ON 3.7 rule 8b): for each card that combat_v2_convert_check finds with a difference: a progress row with a spend, reset or xp ledger row, or a grant_level row with a ref stars:<n> (card_progress_v2_sync, stat_v2.sql), is reported; a card with an m1b input row is reported; else its progress row is deleted, a new input row m1b with the live values is written and converted into a NEW progress row. A card with only a log row is reported. A second call adds 0 rows. combat_v2_convert.sql, stat_v2.sql.$cm$;
comment on function public.balance_check_stat_labels_v2() is $cm$Trigger (before insert, update on balance): stat_labels_v2 must have the 9 v2 stats (atk, def, hp, crd, crt, abl, ddg, acc, spd), each with only a label (1 to 14 characters) and a short (1 to 4) (stat_v2.sql).$cm$;

notify pgrst, 'reload schema';
