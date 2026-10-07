-- Shard ledger strict (database audit 2026-10-03; Nathan 2026-10-07: "all data properly logged" before design v2).
-- The same rules as pack_ledger_strict.sql and card_ledger.sql, for Shards:
--   1. Every shard_ledger row points at ONE source row (ref_kind + ref_id), with the same ref words as the pack and
--      card ledgers. Three writers wrote a ref that did not name one row; they now do:
--        claim_daily, claim_daily_earn  ('daily', '<task>')           -> ('daily_claim', '<day>:<task>')   (daily_claims)
--        buy_shop_item                  ('pack', '<qty>') / ('card' | 'stat_reset', '<card id>')
--                                                                      -> ('shop_purchase', shop_purchases.id)
--        dungeon_pay                    ('prize_<mode>', '<period>')   -> ('dungeon_payout', '<mode>:<period>')
--      The old rows are moved to the new refs where exactly one source row matches. The other writers already
--      name one row and do not change: claim_gift ('gift', id), claim_achievement_tiers ('achievement', key),
--      convert_dupes ('card', card id; the card_ledger 'convert' row points back at this Shards row),
--      dungeon_settle ('run', dungeon_runs.id).
--   2. A ref is required (shard_ledger_ref_check): a writer that passes no ref is refused.
--   3. The reason list (shard_ledger_reason_check) = the reasons of the writers plus four reserved for planned
--      features (expedition, arena, wandering, minigame; Nathan 2026-10-07: keep them). Any other reason is refused.
--   4. players.shard_balance >= 0 (players_shard_balance_nonneg, from shards_shop.sql) is asserted again.
--   5. shard_ledger_reconcile(): sum(shard_ledger.amount) = players.shard_balance for each member, every row has a
--      ref, the three checks are valid, and the Dungeon run totals equal the ledgers:
--        dungeon_runs.shards = the run's 'dungeon' Shard rows (ref run / kill / room / reward, ref_id = the run id);
--        dungeon_runs.cards  = the run's card_ledger 'dungeon_loot' rows (ref dungeon_run), for the runs that ended
--                              after card_ledger.sql (the copies of older runs are in its opening_balance seed).
--      The two columns stay: dungeon_settle (a second call returns them) and dungeon_view read them, and other
--      files guard both functions. They are the receipt of the run, written in the same statement as the ledger
--      rows; the reconcile proves that they agree.
--   6. dungeon_settle writes each loot card with the ref of its own run (card_move, ('dungeon_run', run id)).
--      Before, add_card_to_player looked for 'the newest active run of the member that holds the card': with two
--      active runs (a daily and a Gauntlet run, or a stale run of an earlier day) the row pointed at the wrong run.
-- Every function below starts from the live text of 2026-10-07 (the same md5 as live). Runs more than once with
-- the same result.

-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the live text it
-- was built from (the first md5) or on its own result (the second md5). Any other change to one of them stops it
-- here, so that change is never reverted: rebuild this file from the live text. pack_ledger_strict.sql,
-- balance_economy.sql and gauntlet.sql carry the same texts (rebuilt in the same change), card_ledger.sql pins
-- the new md5s.
do $g$
declare x text[]; m text;
begin
  if to_regclass('public.card_ledger') is null or to_regprocedure('public.grant_packs(text,integer,text,text,text,text)') is null then
    raise exception 'shard_ledger_strict.sql: apply pack_ledger_strict.sql and card_ledger.sql first';
  end if;
  foreach x slice 1 in array array[
    ['claim_daily(text,text)', '56cfe6262392048820acff539666b318', '06541bd131cdb91d3af34abdcf87b675'],
    ['claim_daily_earn(text,date,integer,integer,integer)', 'c18f34c4d6b7a18dce0edae2d0bcb1a2', '11c7903f3652523f35e4860e43e0710e'],
    ['buy_shop_item(text,text,integer,bigint,integer)', 'c84f7625fb66024c8d15bfec410e01ff', '024201884993cc4fd231dae26319661e'],
    ['dungeon_pay(text,date)', '95c577bb1b5334fe7b30b5d6e4458791', 'c39c6a3b51b2206c2416412a1f49e6cb'],
    ['dungeon_settle(bigint,text,boolean)', '5d493824f4f6080d9a08c3491d9dc595', '6c71965b6ec5f325566aeb9d65053a9e']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'shard_ledger_strict.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. Move the old rows to the new refs. Only rows with an old ref kind; a row moves only when exactly one source
--    row matches. The source row was written in the same transaction (the same now()).
-- 1a. A daily: the daily_claims row of that member, game day (America/Denver) and task (one per day and task).
update public.shard_ledger l
   set ref_kind = 'daily_claim', ref_id = ((l.created_at at time zone 'America/Denver')::date)::text || ':' || l.ref_id
 where l.reason = 'daily' and l.ref_kind = 'daily'
   and exists (select 1 from public.daily_claims d
                where d.player_id = l.player_id and d.day = (l.created_at at time zone 'America/Denver')::date and d.task = l.ref_id);
-- 1b. A Shop purchase: its shop_purchases row (the same member, time, kind, price and quantity or card).
with m as (
  select l.id, min(s.id) as sid, count(*) as n
    from public.shard_ledger l
    join public.shop_purchases s on s.player_id = l.player_id and s.created_at = l.created_at and s.kind = l.ref_kind
                                and s.price = -l.amount
                                and case when s.kind = 'pack' then s.qty::text = l.ref_id else s.card_id::text = l.ref_id end
   where l.reason = 'shop' and l.ref_kind in ('pack', 'card', 'stat_reset')
   group by l.id)
update public.shard_ledger l set ref_kind = 'shop_purchase', ref_id = m.sid::text from m where m.id = l.id and m.n = 1;
-- 1c. A Dungeon / Gauntlet board prize: its dungeon_payouts row (mode, period), the ref of the pack and card rows.
update public.shard_ledger
   set ref_kind = 'dungeon_payout', ref_id = substr(ref_kind, 7) || ':' || ref_id
 where reason = 'dungeon' and ref_kind in ('prize_daily', 'prize_gauntlet');

-- 2. Only known reasons -----------------------------------------------------------------------------------------
-- Since ledger_reasons.sql (2026-10-07) the reasons are rows of public.ledger_reasons: add a new reason there.
-- The check below is the state before that file. Once public.ledger_reasons exists, its foreign key (the same
-- name) replaces the check and this step is skipped, so a re-run of this file keeps the new state.
do $r$
begin
  if to_regclass('public.ledger_reasons') is not null then return; end if;
  alter table public.shard_ledger drop constraint if exists shard_ledger_reason_check;
  alter table public.shard_ledger add constraint shard_ledger_reason_check check (reason in (
    'daily', 'dungeon', 'dupes', 'event', 'milestone', 'shop', 'admin',
    'expedition', 'arena', 'wandering', 'minigame'));   -- reserved: planned features, no writer yet
end $r$;

-- 3. Every row has a ref ----------------------------------------------------------------------------------------
alter table public.shard_ledger drop constraint if exists shard_ledger_ref_check;
alter table public.shard_ledger add constraint shard_ledger_ref_check check (ref_kind is not null and ref_id is not null);

-- 4. No negative Shard balance (shards_shop.sql made it; asserted again, the same definition) ---------------------
alter table public.players drop constraint if exists players_shard_balance_nonneg;
alter table public.players add constraint players_shard_balance_nonneg check (shard_balance >= 0);

-- 5. The writers with the new refs -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_daily(p_player text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;
  per int; ck int; t jsonb; cap int; amt int; bal int; sh int := balance_num('daily', 'shards')::int; sbal int;
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if mult <= 0 then return jsonb_build_object('ok', false, 'error', 'paused'); end if;
  if p_task not in ('checkin', 'hunt', 'voice', 'social', 'dungeon', 'gauntlet') then return jsonb_build_object('ok', false, 'error', 'bad_task'); end if;
  perform 1 from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  select x into t from jsonb_array_elements(dailies_tasks(p_player)) x where x->>'task' = p_task;
  if coalesce((t->>'claimed')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if not coalesce((t->>'done')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  per := greatest(round(mult), 0)::int;
  ck := balance_num('daily', 'checkin')::int * per; -- the check-in packs; the rest of a check-in claim is the streak bonus
  cap := balance_num('daily', 'cap')::int;
  amt := greatest(least((t->>'reward')::int * per, greatest(cap - earned_today(p_player), 0)), 0);
  -- At the earn limit a daily still pays its Shards (0 packs); with no Shards set, it is capped.
  if amt <= 0 and sh <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;
  -- Stream Saver (effects_outside.sql): a gap of exactly one missed day and an unused streak_shield:
  -- the shield covers yesterday (options.shield_day, counted by checkin_streak) and is used up.
  if p_task = 'checkin' and streak_shield_waiting(p_player, d) then
    update player_effects set consumed_at = now(), options = options || jsonb_build_object('shield_day', to_char(d - 1, 'YYYY-MM-DD'))
     where id = (select id from player_effects
                  where player_id = p_player and primitive = 'streak_shield' and consumed_at is null
                    and starts_at <= now() and (expires_at is null or expires_at > now())
                  order by created_at limit 1 for update skip locked);
  end if;
  insert into daily_claims (player_id, day, task, amount) values (p_player, d, p_task, amt);
  if amt > 0 then
    if p_task = 'checkin' and amt > ck then
      perform grant_packs(p_player, ck, 'earned_checkin', null, 'daily_claim', d::text || ':checkin');
      bal := grant_packs(p_player, amt - ck, 'earned_streak', null, 'daily_claim', d::text || ':checkin');
    else
      bal := grant_packs(p_player, amt, 'earned_' || p_task, null, 'daily_claim', d::text || ':' || p_task);
    end if;
  else
    bal := (select pack_balance from players where id = p_player);
  end if;
  if sh > 0 then sbal := grant_shards(p_player, sh, 'daily', 'daily_claim', d::text || ':' || p_task); end if;
  return jsonb_build_object('ok', true, 'task', p_task, 'packs', amt, 'shards', sh, 'balance', bal, 'shard_balance', sbal,
    'view', dailies_view(p_player));
end $function$;

CREATE OR REPLACE FUNCTION public.claim_daily_earn(p_player_id text, p_date date, p_base integer, p_bonus integer, p_bonus_threshold integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare a record; granted int := 0; amt int;
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  cap int := balance_num('daily', 'cap')::int;
  mult numeric := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;
  sh int := case when coalesce((cfg->>'enabled')::boolean, false) and mult > 0 then balance_num('daily', 'shards')::int else 0 end;
begin
  -- p_base, p_bonus and p_bonus_threshold are no longer read (balance_economy.sql): the packs are balance daily.chat /
  -- daily.chat_bonus x pack_earn_multiplier, the bonus at daily.chat_bonus_at messages. The bot still sends them.
  select message_count, base_claimed, bonus_claimed into a
    from daily_activity where player_id = p_player_id and activity_date = p_date for update;
  if not found then return 0; end if;
  if a.message_count >= 1 and not a.base_claimed then
    update daily_activity set base_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(balance_num('daily', 'chat')::int * greatest(round(mult), 0)::int, greatest(cap - earned_today(p_player_id), 0));
    -- One daily_claims row per chat claim, also at the cap (amount 0), as claim_daily does: each claim is traceable.
    insert into daily_claims (player_id, day, task, amount) values (p_player_id, p_date, 'chat', greatest(amt, 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_daily', null, 'daily_claim', p_date::text || ':chat'); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily_claim', p_date::text || ':chat'); end if;
  end if;
  if a.message_count >= balance_num('daily', 'chat_bonus_at') and not a.bonus_claimed then
    update daily_activity set bonus_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(balance_num('daily', 'chat_bonus')::int * greatest(round(mult), 0)::int, greatest(cap - earned_today(p_player_id), 0));
    insert into daily_claims (player_id, day, task, amount) values (p_player_id, p_date, 'chat_bonus', greatest(amt, 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_bonus', null, 'daily_claim', p_date::text || ':chat_bonus'); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily_claim', p_date::text || ':chat_bonus'); end if;
  end if;
  return granted;
end $function$;

CREATE OR REPLACE FUNCTION public.buy_shop_item(p_player text, p_kind text, p_slot integer DEFAULT NULL::integer, p_card bigint DEFAULT NULL::bigint, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    v_price := (cfg->>'pack_price')::int * p_qty;
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
    else
      v_price := (cfg->>'stat_reset_price')::int;
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

CREATE OR REPLACE FUNCTION public.dungeon_pay(p_mode text, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare pz jsonb := dungeon_prizes_cfg(); board jsonb; e jsonb; p jsonb;
  i int; v_cards jsonb; v_card bigint; v_out jsonb := '[]'; v_rar text; v_msg text;
begin
  if p_mode not in ('daily', 'gauntlet') then raise exception 'dungeon_pay: bad mode %', p_mode; end if;
  insert into dungeon_payouts (mode, period) values (p_mode, p_period) on conflict do nothing;
  if not found then return jsonb_build_object('ok', false, 'error', 'already_paid'); end if;
  perform dungeon_settle_stale();
  board := case when p_mode = 'daily' then dungeon_board(p_period, 10) else gauntlet_board(p_period, 10) end;
  for e in select x from jsonb_array_elements(board) x order by (x->>'rank')::int loop
    p := pz->(case when p_mode = 'daily' then 'daily' else 'weekly' end)->((e->>'rank')::int - 1);
    continue when p is null;
    if coalesce((p->>'shards')::int, 0) > 0 then
      perform grant_shards(e->>'player_id', (p->>'shards')::int, 'dungeon', 'dungeon_payout', p_mode || ':' || p_period::text); end if;
    if coalesce((p->>'packs')::int, 0) > 0 then
      perform grant_packs(e->>'player_id', (p->>'packs')::int, 'dungeon_prize', null, 'dungeon_payout', p_mode || ':' || p_period::text); end if;
    v_cards := '[]';
    for i in 1..coalesce((p->>'cards')::int, 0) loop
      v_rar := dungeon_pick(p->'odds', random()::numeric);
      v_card := dungeon_card_of(v_rar);
      if v_card is not null then
        perform add_card_to_player(e->>'player_id', v_card, 'dungeon_prize');
        v_cards := v_cards || jsonb_build_object('id', v_card, 'rarity', v_rar);
      end if;
    end loop;
    v_msg := format('%s #%s: %s', case when p_mode = 'daily' then 'Dungeon' else 'Gauntlet' end, e->>'rank',
      concat_ws(', ', case when coalesce((p->>'shards')::int, 0) > 0 then (p->>'shards') || ' Shards' end,
                      case when coalesce((p->>'packs')::int, 0) > 0 then (p->>'packs') || case when (p->>'packs')::int = 1 then ' pack' else ' packs' end end,
                      case when jsonb_array_length(v_cards) > 0 then jsonb_array_length(v_cards) || case when jsonb_array_length(v_cards) = 1 then ' card' else ' cards' end end));
    perform notify_player(e->>'player_id', 'dungeon_prize', v_msg);
    v_out := v_out || jsonb_build_object('rank', (e->>'rank')::int, 'player_id', e->>'player_id', 'shards', coalesce((p->>'shards')::int, 0),
      'packs', coalesce((p->>'packs')::int, 0), 'cards', v_cards);
  end loop;
  update dungeon_payouts set winners = v_out where mode = p_mode and period = p_period;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'period', p_period, 'winners', v_out);
end $function$;

CREATE OR REPLACE FUNCTION public.dungeon_settle(p_run_id bigint, p_how text, p_with_pend boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r dungeon_runs; v_sh int; v_cards jsonb; x jsonb;
begin
  select * into r from dungeon_runs where id = p_run_id for update;
  if r.status <> 'active' then return jsonb_build_object('shards', r.shards, 'cards', to_jsonb(r.cards)); end if;
  if r.mode = 'gauntlet' then r.state := r.state - 'bank' - 'pend'; end if;   -- the Gauntlet grants no loot
  v_sh := coalesce((r.state->'bank'->>'shards')::int, 0) + case when p_with_pend then coalesce((r.state->'pend'->>'shards')::int, 0) else 0 end;
  v_cards := coalesce(r.state->'bank'->'cards', '[]') || case when p_with_pend then coalesce(r.state->'pend'->'cards', '[]') else '[]'::jsonb end;
  if v_sh > 0 then perform grant_shards(r.player_id, v_sh, 'dungeon', 'run', r.id::text); end if;
  -- Each card with the ref of THIS run (shard_ledger_strict.sql): add_card_to_player found 'the newest active run that
  -- holds the card', the wrong run when a member has two active runs (a daily and a Gauntlet run, or a stale one).
  for x in select e from jsonb_array_elements(v_cards) e loop
    perform card_move(r.player_id, (x #>> '{}')::bigint, 1, 'dungeon_loot', 'dungeon_run', r.id::text, 'dungeon');
  end loop;
  update dungeon_runs set status = 'over', ended_by = p_how, ended_at = now(), shards = v_sh,
    cards = coalesce(array(select (e #>> '{}')::bigint from jsonb_array_elements(v_cards) e), '{}'),
    state = jsonb_set(state, '{phase}', '"over"') || jsonb_build_object('lost', case when p_with_pend then null else state->'pend' end)
  where id = r.id;
  return jsonb_build_object('shards', v_sh, 'cards', v_cards);
end $function$;

-- 6. The reconcile -----------------------------------------------------------------------------------------------
-- ok = true when: each member's shard_balance = the sum of their shard_ledger rows, every row has a ref, the three
-- checks are valid, and every Dungeon run's shards and cards equal the ledgers (see the header).
-- run_rows_without_run counts 'dungeon' rows with a run ref whose run no longer exists (Dungeon v1 test runs that
-- were deleted in the switch to v2; their Shards stay paid and in the balance). It is shown, not part of ok.
-- mismatched_rows lists member ids: run it only where member data may be shown.
create or replace function public.shard_ledger_reconcile()
returns jsonb
language sql stable security invoker set search_path = public as $function$
  with s as (
    select p.id, p.shard_balance, coalesce(sum(l.amount), 0)::bigint as ledger
      from players p left join shard_ledger l on l.player_id = p.id
     group by p.id, p.shard_balance
  ), r as (
    select d.id, d.shards, d.cards, d.status, d.ended_at,
           (select coalesce(sum(l.amount), 0) from shard_ledger l
             where l.reason = 'dungeon' and l.ref_kind in ('run', 'kill', 'room', 'reward') and l.ref_id = d.id::text)::bigint as ledger_shards,
           coalesce((select array_agg(c.card_id order by c.card_id) from card_ledger c cross join generate_series(1, c.amount)
                      where c.reason = 'dungeon_loot' and c.ref_kind = 'dungeon_run' and c.ref_id = d.id::text), '{}') as ledger_cards,
           d.ended_at is null
             or d.ended_at >= coalesce((select min(m.applied_at) from schema_migrations m where m.file = 'card_ledger.sql'), '-infinity') as cards_in_ledger
      from dungeon_runs d
  ), x as (
    select (select count(*) from s) as players,
           (select count(*) from s where s.ledger <> s.shard_balance) as mismatched,
           (select coalesce(jsonb_agg(jsonb_build_object('player_id', s.id, 'balance', s.shard_balance, 'ledger', s.ledger)), '[]'::jsonb)
              from s where s.ledger <> s.shard_balance) as mismatched_rows,
           (select count(*) from shard_ledger) as rows,
           (select count(*) from shard_ledger where ref_kind is null or ref_id is null) as rows_without_ref,
           coalesce((select convalidated from pg_constraint where conname = 'shard_ledger_reason_check' and conrelid = 'public.shard_ledger'::regclass), false) as reason_check,
           coalesce((select convalidated from pg_constraint where conname = 'shard_ledger_ref_check' and conrelid = 'public.shard_ledger'::regclass), false) as ref_check,
           coalesce((select convalidated from pg_constraint where conname = 'players_shard_balance_nonneg' and conrelid = 'public.players'::regclass), false) as balance_check,
           (select count(*) from r) as runs,
           (select count(*) from r where r.shards <> r.ledger_shards) as runs_shards_mismatched,
           (select count(*) from r where r.cards_in_ledger) as runs_cards_checked,
           (select count(*) from r where r.cards_in_ledger
                and array(select unnest(r.cards) order by 1) <> r.ledger_cards) as runs_cards_mismatched,
           (select coalesce(jsonb_agg(jsonb_build_object('run_id', r.id, 'shards', r.shards, 'ledger_shards', r.ledger_shards,
                     'cards', cardinality(r.cards), 'ledger_cards', cardinality(r.ledger_cards)) order by r.id), '[]'::jsonb)
              from r where r.shards <> r.ledger_shards
                 or (r.cards_in_ledger and array(select unnest(r.cards) order by 1) <> r.ledger_cards)) as mismatched_runs,
           (select count(*) from shard_ledger l where l.reason = 'dungeon' and l.ref_kind in ('run', 'kill', 'room', 'reward')
                and not exists (select 1 from dungeon_runs d where d.id::text = l.ref_id)) as run_rows_without_run
  )
  select jsonb_build_object('ok', x.mismatched = 0 and x.rows_without_ref = 0 and x.reason_check and x.ref_check and x.balance_check
                                  and x.runs_shards_mismatched = 0 and x.runs_cards_mismatched = 0,
    'players', x.players, 'mismatched', x.mismatched, 'rows', x.rows, 'rows_without_ref', x.rows_without_ref,
    'reason_check', x.reason_check, 'ref_check', x.ref_check, 'balance_check', x.balance_check,
    'runs', x.runs, 'runs_shards_mismatched', x.runs_shards_mismatched, 'runs_cards_checked', x.runs_cards_checked,
    'runs_cards_mismatched', x.runs_cards_mismatched, 'run_rows_without_run', x.run_rows_without_run,
    'mismatched_runs', x.mismatched_runs, 'mismatched_rows', x.mismatched_rows)
    from x;
$function$;

-- 7. Documentation -----------------------------------------------------------------------------------------------
comment on table public.shard_ledger is
  '[players-economy] One row per change of a member''s Shard balance (players.shard_balance): + earned, - spent. sum(amount) per member = shard_balance (shard_ledger_reconcile()). Written only by grant_shards().';
comment on column public.shard_ledger.id is 'Row id. A card_ledger convert row points at it (ref_kind shard_ledger).';
comment on column public.shard_ledger.player_id is 'The member (players.id) whose Shard balance changed.';
comment on column public.shard_ledger.amount is 'The change in Shards: positive = earned or given, negative = spent (shop) or taken back (admin).';
-- The comment before ledger_reasons.sql (2026-10-07); once that table exists, its own comment stays.
do $r$
begin
  if to_regclass('public.ledger_reasons') is not null then return; end if;
  comment on column public.shard_ledger.reason is
    'Why (shard_ledger_reason_check lists the allowed values): daily (a daily task, claim_daily / claim_daily_earn); dungeon (Dungeon run loot, dungeon_settle; a Dungeon or Gauntlet board prize, dungeon_pay); dupes (copies turned into Shards, convert_dupes); event (Shards in a bell gift, claim_gift); milestone (an achievement tier, claim_achievement_tiers); shop (a Shop purchase, buy_shop_item); admin (a manual grant or reversal); expedition, arena, wandering, minigame (reserved for planned features; no writer yet).';
end $r$;
comment on column public.shard_ledger.ref_kind is
  'The kind of source row (required, shard_ledger_ref_check): daily_claim (daily_claims, ref_id = ''<day>:<task>''); run (dungeon_runs.id; Dungeon v1 rows also kill / room / reward with the run id); dungeon_payout (dungeon_payouts, ref_id = ''<mode>:<period>''); card (convert_dupes: the card id); gift (gift_claims.id); achievement (the achievement key); shop_purchase (shop_purchases.id); for admin rows a short label of the manual action. Old rows that matched no source row keep their old kind (daily, pack, card, stat_reset).';
comment on column public.shard_ledger.ref_id is 'The id of the source row (see ref_kind), as text. Required.';
comment on column public.shard_ledger.created_at is 'When the row was written (the transaction time, the same as the source row).';
comment on column public.players.shard_balance is 'Shards to spend in the Shop. Never negative (players_shard_balance_nonneg). Changed only by grant_shards() with a shard_ledger row: sum(shard_ledger.amount) = shard_balance.';
comment on column public.dungeon_runs.shards is 'The Shards the run paid when it ended (dungeon_settle; 0 while active). = the sum of its shard_ledger ''dungeon'' rows (ref run, ref_id = this id): shard_ledger_reconcile() checks it.';
comment on column public.dungeon_runs.cards is 'The cards the run paid when it ended (dungeon_settle; empty while active). = its card_ledger ''dungeon_loot'' rows (ref dungeon_run, ref_id = this id) for runs ended after card_ledger.sql: shard_ledger_reconcile() checks it.';

comment on function public.grant_shards(text, integer, text, text, text) is 'The only writer of shard_balance: adds p_amount Shards (negative: spends) and writes the shard_ledger row with its reason and ref (both required). Returns the new balance, or null for an unknown member. A negative balance is refused (players_shard_balance_nonneg).';
comment on function public.claim_daily(text, text) is 'A member claims a daily task (not chat): a daily_claims row, the packs up to the daily cap and the Shards, both with ref (''daily_claim'', ''<day>:<task>'').';
comment on function public.claim_daily_earn(text, date, integer, integer, integer) is 'The bot pays the two chat dailies (chat, chat_bonus) when the message count crosses 1 and the threshold: a daily_claims row each (amount 0 at the cap), the packs up to the daily cap and the Shards, both with ref (''daily_claim'', ''<day>:<task>'').';
comment on function public.buy_shop_item(text, text, integer, bigint, integer) is 'A member buys with Shards: packs, a card of the day or a stat reset. The shop_purchases row comes first; the Shards row and the pack row have ref (''shop_purchase'', its id). A free weekly stat reset writes no Shards row.';
comment on function public.dungeon_pay(text, date) is 'Pays the Dungeon (daily) or Gauntlet (weekly) prizes once per period: Shards, packs and cards, all with ref (''dungeon_payout'', ''<mode>:<period>'').';
comment on function public.dungeon_settle(bigint, text, boolean) is 'Ends a Dungeon or Gauntlet run once: pays the banked Shards (and the pending ones when cleared) with ref (''run'', run id), each loot card through card_move with ref (''dungeon_run'', run id), and stores the paid totals in dungeon_runs.shards / cards. A second call returns the stored totals.';
comment on function public.add_card_to_player(text, bigint, text) is 'Adds one copy for a caller that passes only a source (claim_gift, buy_shop_item, dungeon_pay): the ref is the source row that the caller wrote in this transaction. The dungeon source is not used since shard_ledger_strict.sql (dungeon_settle calls card_move with its own run). With no known source row: reason admin, ref (''tx'', the transaction id).';
comment on function public.shard_ledger_reconcile() is 'Proof that the Shard ledger is complete: each member''s shard_balance = sum(shard_ledger.amount), every row has a ref, the reason, ref and balance checks are valid, and each Dungeon run''s shards and cards equal its ledger rows. ok = true when all hold.';

notify pgrst, 'reload schema';
