-- stat_v2_undo.sql (2026-11-06): the undo of stat_v2.sql (STAT-V2). It puts back the M1e text (combat_v2_convert.sql) of buy_shop_item,
-- shop_today, combat_v2_convert_check and combat_v2_convert_fix and their M1e comments, and drops the 6 STAT-V2 functions, the labels trigger
-- and the settings row stat_v2. After it the Shop stat reset is paused for everyone again (M1e) and the Activity reads no v2 stat screen
-- (card_stats_v2_for is gone: the Activity answers as with the flag off). It does NOT change data: the card_progress_v2 rows and ledger rows that
-- the stat screen wrote stay (they are valid v2 rows; card_progress_v2_fight reads them). The balance key stat_labels_v2 stays (balance_check
-- refuses a delete of a key; no game function reads it). For a rollback of the flag only, use stat_v2_off.sql, not this file.
-- NOTE: after this undo combat_v2_convert_check is the M1e text again: it reports progress_mismatch for every row with a later spend, reset
-- or stars: row (review r1 H1). Apply only when Nathan or the orchestrator wants the M1e state back. A second run changes nothing.

-- GUARD: each function is the text of stat_v2.sql or the M1e text.
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.buy_shop_item(text, text, integer, bigint, integer)', '8533f2ba1f335adf480056a3209a3de1', '31d8c4a659dce0389c6e10002eeb5f64'),
    ('public.shop_today(text)', 'b9e70bc35a593b918e310effb19c2a1d', '843444fd75d6cede06dc81a0eedf5a35'),
    ('public.combat_v2_convert_check(bigint[])', 'e000b29a81d4871e91fca994a6b171ef', '9b36127eaf6cbe2428d3c228aafac059'),
    ('public.combat_v2_convert_fix(bigint[])', '83b8a9b451da09194bcb83517736cd70', '720743b7c0ca03686eea58e8c365a940')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'stat_v2_undo.sql: the live % is not the stat_v2.sql text or the M1e text (md5 %)', f.fn, m;
    end if;
  end loop;
end $g$;

-- the M1e texts (combat_v2_convert.sql, exact copies)
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
  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) then   -- M1e
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
    'stat_reset_paused', v_v2,   -- M1e: the Shop stat reset refuses stat_reset_paused (buy_shop_item) while v2 progress is ON for this player
    'free_reset_next', ((date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver'),
    'max_packs_per_buy', coalesce((cfg->>'max_packs_per_buy')::int, 10),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('slot', s.slot, 'card_id', s.card_id, 'rarity', s.rarity, 'price', game_shop_price(s.price),
                 'bought', exists (select 1 from shop_purchases p where p.player_id = p_player and p.day = v_day and p.kind = 'card' and p.slot = s.slot))
                 order by s.slot) from shop_stock s where s.day = v_day), '[]'::jsonb));
end $function$;

create or replace function public.combat_v2_convert_check(p_cards bigint[] default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  v_on timestamptz := (select max(at) from public.combat_v2_switch_log where action = 'on');
  r record; e jsonb; p public.card_progress_v2%rowtype; why text[]; items jsonb := '[]';
  n_miss int := 0; n_bad int := 0; n_live int := 0; n_log int := 0; n_cards int := 0; s text; led record;
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

comment on function public.combat_v2_convert_check(bigint[]) is $cm$[combat] Combat v2 M1e live check (SPEC ON 6.7 rows 2a and 2b). Reads only. For each card whose player_cards row exists: input_missing (v1 points and no input row), progress_mismatch (the progress row is not combat_v2_convert_expect of the current input row, or its ledger rows do not sum to it), live_differs (the live v1 points are not the current input), log_after_switch (a stat_point_log spend or reset after the newest combat_v2_switch_log on row). Answer: the counts and the items (ok = no item). combat_v2_convert.sql.$cm$;
comment on function public.combat_v2_convert_fix(bigint[]) is $cm$[combat] Combat v2 M1e fix path (SPEC ON 3.7 rule 8b): for each card that combat_v2_convert_check finds with a difference: a progress row with a spend, reset or xp ledger row is reported; a card with an m1b input row is reported; else its progress row is deleted, a new input row m1b with the live values is written and converted into a NEW progress row. A card with only a log row is reported. A second call adds 0 rows. combat_v2_convert.sql.$cm$;

-- the STAT-V2 objects
drop trigger if exists balance_check_stat_labels_v2 on public.balance;
drop function if exists public.balance_check_stat_labels_v2();
drop function if exists public.stat_v2_spend(text, bigint, jsonb);
drop function if exists public.stat_v2_reset(text, bigint);
drop function if exists public.card_stats_v2_for(text);
drop function if exists public.card_stats_v2_entry(text, bigint, jsonb);
drop function if exists public.card_progress_v2_sync(text, bigint, integer);
drop function if exists public.stat_v2_on(text);
delete from public.settings where key = 'stat_v2';

notify pgrst, 'reload schema';
