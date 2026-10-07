-- Card ledger (database audit 2026-10-03, plan step 4; Nathan: "keep going").
-- Each change of a member's card copies (player_cards.quantity) is one card_ledger row with a checked reason
-- and a ref to its source row, the shape of pack_ledger (pack_ledger_strict.sql):
--   1. card_ledger(id, player_id, card_id, amount = signed copies, reason (checked list), ref_kind, ref_id,
--      created_at). ref_kind + ref_id are required.
--   2. card_move(): the ONE function that changes player_cards.quantity. It writes the ledger row in the same
--      transaction and never takes a member below 0 copies (it returns null and changes nothing).
--   3. The old helpers (add_card_to_player, add_cards_to_player, remove_card_from_player) call card_move.
--      The functions that call them and that another file guards (open_packs, claim_gift, buy_shop_item,
--      dungeon_pay: pack_ledger_strict.sql; dungeon_settle: gauntlet.sql) are NOT replaced: the helper finds
--      the source row that its caller wrote earlier in the same transaction (the same now()):
--        add_cards_to_player  <- open_packs:      the pack_ledger 'opened' rows -> ('open', the open id)
--        add_card_to_player 'gift'               <- claim_gift: the gift_claims row claimed now -> ('gift', id)
--        add_card_to_player 'shop'               <- buy_shop_item: today's shop_stock slot -> ('shop_card', '<day>:<slot>')
--        add_card_to_player 'dungeon'            <- dungeon_settle: the active run that holds the card -> ('dungeon_run', id)
--        add_card_to_player 'dungeon_prize'      <- dungeon_pay: the payout paid now -> ('dungeon_payout', '<mode>:<period>')
--      add_cards_to_player with no open in the transaction = the bot's openTestPacks (testers draw with no
--      pack spent): reason test_pack, ref ('test_open', a new id). Any other call with no known source:
--      reason admin, ref ('tx', the transaction id).
--   4. The functions that move cards and that no file guards call card_move with their own ref:
--      gift_card, accept_trade, confirm_bid, ascend_card, convert_dupes (from the live text of 2026-10-07).
--   5. The seed: one opening_balance row per (member, card) = the copies held + the copies spent on
--      ascension + the copies converted to Shards; then one ascend row per star reached and one convert row
--      per Shards row (shard_ledger reason 'dupes'). So card_ledger_reconcile() is ok from the first day.
--      Nothing is invented: the opening row is the received total that the current state proves; when and
--      how each copy came before the ledger is not known (open_packs did not store the card ids).
--   6. card_ledger_reconcile(): for each (member, card) sum(card_ledger.amount) = player_cards.quantity.
-- Runs more than once with the same result (the seed runs only on an empty ledger).

-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the
-- live text it was built from (the first md5) or on its own result (the second md5). Any other change
-- to one of them stops it here, so that change is never reverted: rebuild this file from the live text.
do $g$
declare x text[]; m text;
begin
  foreach x slice 1 in array array[
    ['add_card_to_player(text,bigint,text)', '94ff6e067c257ee6b0480271991dc048', 'de0c71f999a111e3b5ca9138fc4e3dc5'],
    ['add_cards_to_player(text,bigint[])', 'bbf6efbebd9e6a5185907902d166b8a4', '95870387c3be9cb49983099a84d4ca94'],
    ['remove_card_from_player(text,bigint)', 'e095f3fb0aeac6302967cbe0a3556dab', '21d5736103da9e8c5f082ef0e5662867'],
    ['gift_card(text,text,bigint)', '024ef82348f935313189159889efc28b', '7115dbfa61f8d04307aecff0b0ad1165'],
    ['accept_trade(bigint,text)', 'b15f29f8dd6193d8b64051d0024cfdd3', '01f88e6f078190ef575fd1201396e0b5'],
    ['confirm_bid(text,bigint)', '5f13b5afd663744a382902b1ee91a61e', '6ac442cd582125b90b0a0de03b03b009'],
    ['ascend_card(text,bigint)', 'a85e5f0cef6cbd2e59464c94eedce83f', '0b8f5728ecc8b1c69a5721d28a8da536'],
    ['convert_dupes(text,bigint,integer)', '931db28ed179ddf43b33f2983b0bc7a7', 'c1afa328d3a94dba53074edc0b040832']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'card_ledger.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
  -- The callers that this file does NOT replace (other files guard them): the helpers depend on what they
  -- write before the call. A change to one of them must be checked against the helpers here.
  foreach x slice 1 in array array[
    ['open_packs(text,bigint[],integer)', '78cb45be91d898fa0b3dcbde7c8dcd10'],
    ['claim_gift(text,bigint)', '3492a584dd9a8a56a934ce91b8374c4d'],
    ['buy_shop_item(text,text,integer,bigint,integer)', 'c84f7625fb66024c8d15bfec410e01ff'],
    ['dungeon_pay(text,date)', '95c577bb1b5334fe7b30b5d6e4458791'],
    ['dungeon_settle(bigint,text,boolean)', '5d493824f4f6080d9a08c3491d9dc595']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m <> x[2] then raise exception 'card_ledger.sql: the live % changed since this file was built. Check the card helpers against it and rebuild.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. The table ---------------------------------------------------------------------------------------
create table if not exists public.card_ledger (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  card_id bigint not null references public.cards(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null,
  ref_kind text not null,
  ref_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists card_ledger_player_idx on public.card_ledger (player_id, created_at desc);
create index if not exists card_ledger_player_card_idx on public.card_ledger (player_id, card_id);
alter table public.card_ledger enable row level security;

-- 2. Only known reasons ------------------------------------------------------------------------------
-- Add a new reason HERE and in the column comment before code writes it.
alter table public.card_ledger drop constraint if exists card_ledger_reason_check;
alter table public.card_ledger add constraint card_ledger_reason_check check (reason in (
  'opening_balance', 'pack', 'test_pack', 'gift_sent', 'gift_received', 'event', 'trade', 'auction', 'shop',
  'convert', 'ascend', 'dungeon_loot', 'dungeon_prize', 'admin'));

-- 3. card_move: the one function that changes the copies ---------------------------------------------
create or replace function public.card_move(p_player text, p_card bigint, p_amount integer, p_reason text,
  p_ref_kind text, p_ref_id text, p_source text default null)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare v_q int;
begin
  if p_amount is null or p_amount = 0 then raise exception 'card_move: the amount must not be 0'; end if;
  if p_ref_kind is null or p_ref_id is null then raise exception 'card_move: a ref (kind and id) is required'; end if;
  if p_amount > 0 then
    insert into player_cards (player_id, card_id, quantity, first_source)
    values (p_player, p_card, p_amount, coalesce(p_source, 'pull'))
    on conflict (player_id, card_id) do update set quantity = player_cards.quantity + excluded.quantity
    returning quantity into v_q;
  else
    select quantity into v_q from player_cards where player_id = p_player and card_id = p_card for update;
    if v_q is null or v_q < -p_amount then return null; end if; -- too few copies: nothing changes
    if v_q = -p_amount then
      delete from player_cards where player_id = p_player and card_id = p_card; -- the last copy (quantity > 0 check)
      v_q := 0;
    else
      update player_cards set quantity = quantity + p_amount where player_id = p_player and card_id = p_card
      returning quantity into v_q;
    end if;
  end if;
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id)
  values (p_player, p_card, p_amount, p_reason, p_ref_kind, p_ref_id);
  return v_q;
end $function$;

-- 4. The old helpers call card_move ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_cards_to_player(p_player_id text, p_card_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_open text; v_reason text := 'pack'; r record;
begin
  -- open_packs wrote its pack_ledger 'opened' rows (one open id) just before this call, in this transaction.
  select ref_id into v_open from pack_ledger
   where player_id = p_player_id and reason = 'opened' and ref_kind = 'open' and created_at = now()
   order by id desc limit 1;
  if v_open is null then
    -- No pack spent: the bot's openTestPacks (testers draw without a pack). One id for the cards of this call.
    v_reason := 'test_pack'; v_open := gen_random_uuid()::text;
  end if;
  for r in select cid, count(*)::int as n from unnest(p_card_ids) as cid group by cid order by cid loop
    perform card_move(p_player_id, r.cid, r.n, v_reason, case when v_reason = 'pack' then 'open' else 'test_open' end, v_open, 'pull');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.add_card_to_player(p_player_id text, p_card_id bigint, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_reason text; v_kind text; v_ref text; g record;
begin
  -- The callers that other files guard pass only a source; the ref is the source row they wrote earlier in
  -- this transaction (the same now()). The other paths call card_move with their ref directly.
  if p_source = 'gift' then  -- claim_gift: the card gift claimed now
    select id, reason into g from gift_claims
     where player_id = p_player_id and card_id = p_card_id and kind = 'card' and claimed_at = now()
     order by id desc limit 1;
    if g.id is not null then
      v_reason := case when g.reason = 'member_gift' then 'gift_received' else 'event' end;
      v_kind := 'gift'; v_ref := g.id::text;
    end if;
  elsif p_source = 'shop' then  -- buy_shop_item: today's slot with this card that the member has not bought yet
    select s.day::text || ':' || s.slot into v_ref from shop_stock s
     where s.day = shop_day() and s.card_id = p_card_id
       and not exists (select 1 from shop_purchases x where x.player_id = p_player_id and x.day = s.day and x.kind = 'card' and x.slot = s.slot)
     order by s.slot limit 1;
    if v_ref is not null then v_reason := 'shop'; v_kind := 'shop_card'; end if;
  elsif p_source = 'dungeon' then  -- dungeon_settle: the member's active run that holds the card
    select r.id::text into v_ref from dungeon_runs r
     where r.player_id = p_player_id and r.status = 'active'
       and exists (select 1 from jsonb_array_elements_text(coalesce(r.state->'bank'->'cards', '[]') || coalesce(r.state->'pend'->'cards', '[]')) e
                    where e = p_card_id::text)
     order by r.id desc limit 1;
    if v_ref is not null then v_reason := 'dungeon_loot'; v_kind := 'dungeon_run'; end if;
  elsif p_source = 'dungeon_prize' then  -- dungeon_pay: the payout row made now
    select mode || ':' || period::text into v_ref from dungeon_payouts where paid_at = now() order by mode, period limit 1;
    if v_ref is not null then v_reason := 'dungeon_prize'; v_kind := 'dungeon_payout'; end if;
  end if;
  if v_kind is null then  -- no known source row: an admin move, traceable to its transaction
    v_reason := 'admin'; v_kind := 'tx'; v_ref := txid_current()::text;
  end if;
  perform card_move(p_player_id, p_card_id, 1, v_reason, v_kind, v_ref, coalesce(p_source, 'pull'));
end $function$;

CREATE OR REPLACE FUNCTION public.remove_card_from_player(p_player_id text, p_card_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- No path calls it since card_ledger.sql (each calls card_move with its ref). Kept for old callers: an admin move.
  return card_move(p_player_id, p_card_id, -1, 'admin', 'tx', txid_current()::text) is not null;
end; $function$;

-- 5. The functions that move cards, with their ref ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_card(p_from text, p_to text, p_card_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c record; v_gift bigint;
begin
  if p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  select rarity::text as rarity, tradeable into c from cards where id = p_card_id;
  if not found or not c.tradeable or c.rarity = 'gold' then return false; end if;
  if free_copies(p_from, p_card_id) < 1 then return false; end if; -- reserved or not owned
  -- The card waits in the receiver's bell (gift_claims) until they redeem it, like a pack gift
  -- (Nathan, 2026-10-01: a gifted card plays the card animation on redeem). It leaves the sender now;
  -- the sender's row and the receiver's row (claim_gift) point at the same gift.
  insert into gift_claims (player_id, kind, title, amount, reason, from_id, card_id)
  values (p_to, 'card', coalesce((select name from cards where id = p_card_id), 'A card'), 1, 'member_gift', p_from, p_card_id)
  returning id into v_gift;
  if card_move(p_from, p_card_id, -1, 'gift_sent', 'gift', v_gift::text) is null then
    delete from gift_claims where id = v_gift;
    return false;
  end if;
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.accept_trade(p_offer_id bigint, p_accepter text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare t record;
begin
  select * into t from trade_offers where id = p_offer_id and status in ('pending', 'countered') for update;
  if not found or t.request_card_id is null then return false; end if;
  if t.status = 'countered' and t.from_id <> p_accepter then return false; end if;
  if t.status = 'pending' and t.to_id <> p_accepter then return false; end if;
  -- A card held by an auction or a bid (hall_auctions.sql) is not free to trade away.
  if t.status = 'pending' and free_copies(t.to_id, t.request_card_id) < 1 then return false; end if;
  -- The four moves are one unit: when a copy is gone, the block rolls back the moves already made.
  begin
    if card_move(t.from_id, t.offer_card_id, -1, 'trade', 'trade_offer', p_offer_id::text) is null then raise exception 'trade_gone'; end if;
    if card_move(t.to_id, t.request_card_id, -1, 'trade', 'trade_offer', p_offer_id::text) is null then raise exception 'trade_gone'; end if;
    perform card_move(t.to_id, t.offer_card_id, 1, 'trade', 'trade_offer', p_offer_id::text, 'trade');
    perform card_move(t.from_id, t.request_card_id, 1, 'trade', 'trade_offer', p_offer_id::text, 'trade');
  exception when raise_exception then
    if sqlerrm = 'trade_gone' then return false; end if;
    raise;
  end;
  update trade_offers set status = 'accepted', resolved_at = now() where id = p_offer_id;
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.confirm_bid(p_bidder text, p_auction bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare a auctions; b auction_bids; x bigint;
begin
  select * into a from auctions where id = p_auction for update;
  if not found or a.status <> 'accepted' then return jsonb_build_object('ok', false, 'error', 'not_accepted'); end if;
  select * into b from auction_bids where id = a.accepted_bid_id for update;
  if b.bidder_id <> p_bidder or b.status <> 'accepted' then return jsonb_build_object('ok', false, 'error', 'not_your_bid'); end if;
  begin
    if card_move(a.seller_id, a.card_id, -1, 'auction', 'auction', a.id::text) is null then raise exception 'gone'; end if;
    foreach x in array b.cards loop
      if card_move(p_bidder, x, -1, 'auction', 'auction', a.id::text) is null then raise exception 'gone'; end if;
      perform card_move(a.seller_id, x, 1, 'auction', 'auction', a.id::text, 'auction');
    end loop;
    perform card_move(p_bidder, a.card_id, 1, 'auction', 'auction', a.id::text, 'auction');
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'cards_gone');
  end;
  update auction_bids set status = 'won', updated_at = now() where id = b.id;
  perform return_bids(a.id, b.id);
  update auctions set status = 'sold', settled_at = now(), notice_dirty = true where id = a.id;
  return jsonb_build_object('ok', true, 'seller', a.seller_id, 'card_id', a.card_id, 'cards', b.cards);
end $function$;

CREATE OR REPLACE FUNCTION public.ascend_card(p_player_id text, p_card_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_qty int; v_asc int; v_rarity text; v_cost int; v_mod numeric;
begin
  select pc.quantity, pc.ascension, c.rarity, s.cp_mod
    into v_qty, v_asc, v_rarity, v_mod
  from player_cards pc
  join cards c    on c.id = pc.card_id
  join subjects s on s.id = c.subject_id
  where pc.player_id = p_player_id and pc.card_id = p_card_id
  for update of pc;

  if not found then return jsonb_build_object('ok', false, 'error', 'not owned'); end if;
  if v_rarity in ('event', 'promo') then return jsonb_build_object('ok', false, 'error', 'no_ascend'); end if;
  if v_asc >= 5 then return jsonb_build_object('ok', false, 'error', 'maxed'); end if;

  v_cost := ascend_cost(v_rarity, v_asc);
  if v_qty < 1 + v_cost then
    return jsonb_build_object('ok', false, 'error', 'need_more', 'have', v_qty, 'need', 1 + v_cost);
  end if;
  -- A copy held by a trade offer, an auction or a bid is not free to spend, and the copy that
  -- stays must be free too (else it leaves with the trade, the auction or the bid).
  if free_copies(p_player_id, p_card_id) < v_cost + 1 then
    return jsonb_build_object('ok', false, 'error', 'held', 'free', free_copies(p_player_id, p_card_id), 'need', v_cost + 1);
  end if;

  -- The copies spent: one ledger row, ref ('ascension', '<card>:<the star reached>').
  if v_cost > 0 then
    perform card_move(p_player_id, p_card_id, -v_cost, 'ascend', 'ascension', p_card_id::text || ':' || (v_asc + 1));
  end if;
  update player_cards set ascension = ascension + 1
   where player_id = p_player_id and card_id = p_card_id;

  return jsonb_build_object('ok', true, 'ascension', v_asc + 1,
    'quantity', v_qty - v_cost, 'power', card_power(v_rarity, v_asc + 1, v_mod),
    'next_cost', ascend_cost(v_rarity, v_asc + 1));
end;
$function$;

CREATE OR REPLACE FUNCTION public.convert_dupes(p_player text, p_card bigint, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_rar text; v_val int; v_max int; v_new int; v_row bigint;
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
  v_new := grant_shards(p_player, p_count * v_val, 'dupes', 'card', p_card::text);
  -- The copies leave with a ref to the Shards row they paid for (the copies are recorded, not rebuilt
  -- from the Shards with today's dupe value).
  select id into v_row from shard_ledger
   where player_id = p_player and reason = 'dupes' and ref_kind = 'card' and ref_id = p_card::text and created_at = now()
   order by id desc limit 1;
  perform card_move(p_player, p_card, -p_count, 'convert', 'shard_ledger', v_row::text);
  return jsonb_build_object('ok', true, 'converted', p_count, 'shards', p_count * v_val, 'balance', v_new,
    'quantity', (select quantity from player_cards where player_id = p_player and card_id = p_card));
end $function$;

-- 6. The reconcile -----------------------------------------------------------------------------------
-- ok = true when: for each (member, card) player_cards.quantity (0 when there is no row) = the sum of the
-- card_ledger rows, no row has a 'tx' ref (a move with no known source), and the reason and quantity
-- checks are valid. mismatched_rows lists member ids: run it only where member data may be shown.
create or replace function public.card_ledger_reconcile()
returns jsonb
language sql stable security invoker set search_path = public as $function$
  with l as (
    select player_id, card_id, sum(amount)::bigint as ledger from card_ledger group by player_id, card_id
  ), s as (
    select coalesce(pc.player_id, l.player_id) as player_id, coalesce(pc.card_id, l.card_id) as card_id,
           coalesce(pc.quantity, 0)::bigint as quantity, coalesce(l.ledger, 0) as ledger
      from player_cards pc full join l on l.player_id = pc.player_id and l.card_id = pc.card_id
  ), x as (
    select (select count(distinct player_id) from s) as players,
           (select count(*) from s where s.ledger <> s.quantity) as mismatched,
           (select count(distinct player_id) from s where s.ledger <> s.quantity) as players_mismatched,
           (select coalesce(sum(abs(s.ledger - s.quantity)), 0) from s) as copies_gap,
           (select coalesce(jsonb_agg(jsonb_build_object('player_id', s.player_id, 'card_id', s.card_id, 'quantity', s.quantity, 'ledger', s.ledger)), '[]'::jsonb)
              from s where s.ledger <> s.quantity) as mismatched_rows,
           (select count(*) from card_ledger) as rows,
           (select count(*) from card_ledger where ref_kind = 'tx') as rows_tx_ref,
           coalesce((select convalidated from pg_constraint where conname = 'card_ledger_reason_check' and conrelid = 'public.card_ledger'::regclass), false) as reason_check,
           coalesce((select convalidated from pg_constraint where conname = 'player_cards_quantity_check' and conrelid = 'public.player_cards'::regclass), false) as quantity_check
  )
  select jsonb_build_object('ok', x.mismatched = 0 and x.rows_tx_ref = 0 and x.reason_check and x.quantity_check,
    'players', x.players, 'mismatched', x.mismatched, 'players_mismatched', x.players_mismatched, 'copies_gap', x.copies_gap,
    'rows', x.rows, 'rows_tx_ref', x.rows_tx_ref, 'reason_check', x.reason_check, 'quantity_check', x.quantity_check,
    'mismatched_rows', x.mismatched_rows)
    from x;
$function$;

-- 7. The seed: the opening balance (only on an empty ledger) -----------------------------------------
-- The lock stops every card move until the end of this transaction, so no move falls between the seed
-- and the reconcile below.
lock table public.player_cards in share row exclusive mode;
do $seed$
declare r jsonb;
begin
  if exists (select 1 from card_ledger) then return; end if;
  -- The dupe values must divide every old convert row exactly (they have not changed since the Shop
  -- started); else the copies of a row are not known and the seed stops.
  if exists (select 1 from shard_ledger l join cards c on c.id::text = l.ref_id
              where l.reason = 'dupes' and l.ref_kind = 'card'
                and (l.amount <= 0 or coalesce((shard_cfg()->'dupe_values'->>c.rarity::text)::int, 0) <= 0
                     or l.amount % (shard_cfg()->'dupe_values'->>c.rarity::text)::int <> 0)) then
    raise exception 'card_ledger.sql: a convert row does not divide by the dupe value: the seed cannot know its copies';
  end if;
  create temp table cl_seed_conv on commit drop as
    select l.id, l.player_id, c.id as card_id, l.amount / (shard_cfg()->'dupe_values'->>c.rarity::text)::int as copies, l.created_at
      from shard_ledger l join cards c on c.id::text = l.ref_id
     where l.reason = 'dupes' and l.ref_kind = 'card';
  create temp table cl_seed_asc on commit drop as
    select pc.player_id, pc.card_id, g + 1 as star, ascend_cost(c.rarity::text, g) as copies
      from player_cards pc join cards c on c.id = pc.card_id cross join lateral generate_series(0, pc.ascension - 1) g
     where pc.ascension > 0;
  -- a. The opening balance: held + spent on ascension + converted. The time = the first copy.
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at)
  select p.player_id, p.card_id, p.q + p.a + p.v, 'opening_balance', 'opening', 'card_ledger.sql', p.t
    from (select coalesce(pc.player_id, v.player_id) as player_id, coalesce(pc.card_id, v.card_id) as card_id,
                 coalesce(pc.quantity, 0) as q,
                 coalesce((select sum(a.copies) from cl_seed_asc a where a.player_id = pc.player_id and a.card_id = pc.card_id), 0) as a,
                 coalesce(v.copies, 0) as v,
                 least(pc.first_obtained_at, v.first) as t
            from player_cards pc
            full join (select player_id, card_id, sum(copies) as copies, min(created_at) as first from cl_seed_conv group by 1, 2) v
              on v.player_id = pc.player_id and v.card_id = pc.card_id) p
   order by p.t, p.player_id, p.card_id;
  -- b. The copies converted: one row per Shards row, at its time.
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at)
  select player_id, card_id, -copies, 'convert', 'shard_ledger', id::text, created_at from cl_seed_conv order by created_at, id;
  -- c. The copies spent on ascension: one row per star reached (the cost of that star in the balance table,
  --    unchanged since ascension_cost_v3.sql, before the launch reset). The time of an old ascension is not
  --    known: the row has the time of this migration.
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id)
  select player_id, card_id, -copies, 'ascend', 'ascension', card_id::text || ':' || star from cl_seed_asc
   where copies > 0 order by player_id, card_id, star;
  r := card_ledger_reconcile();
  if not (r->>'ok')::boolean then raise exception 'card_ledger.sql: the seed does not reconcile: %', r - 'mismatched_rows'; end if;
end $seed$;

-- 8. Documentation -----------------------------------------------------------------------------------
comment on table public.card_ledger is
  '[players-economy] One row per change of a member''s copies of a card (player_cards.quantity): + copies in, - copies out. sum(amount) per (member, card) = player_cards.quantity (card_ledger_reconcile()). Written only by card_move().';
comment on column public.card_ledger.id is 'Row id.';
comment on column public.card_ledger.player_id is 'The member (players.id) whose copies changed.';
comment on column public.card_ledger.card_id is 'The card (cards.id).';
comment on column public.card_ledger.amount is 'The change in copies: positive = copies added, negative = copies removed. Never 0.';
comment on column public.card_ledger.reason is
  'Why (card_ledger_reason_check lists the allowed values): opening_balance (the seed: copies received before the ledger); pack (open_packs); test_pack (a tester open with no pack spent, the bot openTestPacks); gift_sent / gift_received (member card gifts); event (an event or launch card gift claimed in the bell); trade (accept_trade, both sides); auction (confirm_bid, both sides); shop (a card of the day); convert (copies turned into Shards); ascend (copies spent on a star); dungeon_loot (cards from a Dungeon run); dungeon_prize (Dungeon / Gauntlet board prizes); admin (a move with no known source).';
comment on column public.card_ledger.ref_kind is
  'The kind of source row: opening (ref_id = ''card_ledger.sql''), open (pack_ledger.ref_id of the open), test_open (one tester open), gift (gift_claims.id), trade_offer (trade_offers.id), auction (auctions.id), shop_card (shop_purchases of the member, ref_id = ''<day>:<slot>''), shard_ledger (shard_ledger.id of the convert), ascension (ref_id = ''<card>:<star reached>''), dungeon_run (dungeon_runs.id), dungeon_payout (dungeon_payouts, ref_id = ''<mode>:<period>''), tx (an admin move: ref_id = the transaction id).';
comment on column public.card_ledger.ref_id is 'The id of the source row (see ref_kind), as text.';
comment on column public.card_ledger.created_at is 'When the row was written (the transaction time, the same as the source row). Seed rows: the first copy (opening_balance), the Shards row (convert), the migration (ascend).';

comment on table public.player_cards is '[cards] The copies of each card that a member holds (one row per member and card; no row = 0 copies). quantity changes only through card_move() with a card_ledger row.';
comment on column public.player_cards.quantity is 'Copies held, always > 0 (player_cards_quantity_check; the row goes at 0). sum(card_ledger.amount) for the member and card = quantity.';

comment on function public.card_move(text, bigint, integer, text, text, text, text) is 'The one function that changes a member''s copies: adds (amount > 0) or removes (amount < 0) copies and writes the card_ledger row with its reason and ref in the same transaction. Returns the new quantity, or null (nothing changes) when the member has too few copies. p_source = player_cards.first_source for a new row.';
comment on function public.add_cards_to_player(text, bigint[]) is 'Adds the cards of a pack open: reason pack with ref (''open'', the open id of the pack_ledger rows written in this transaction), or test_pack (ref (''test_open'', a new id)) when no pack was spent (the bot openTestPacks).';
comment on function public.add_card_to_player(text, bigint, text) is 'Adds one copy for a caller that passes only a source (claim_gift, buy_shop_item, dungeon_settle, dungeon_pay): the ref is the source row that the caller wrote in this transaction. With no known source row: reason admin, ref (''tx'', the transaction id).';
comment on function public.remove_card_from_player(text, bigint) is 'Removes one copy as an admin move (ref (''tx'', the transaction id)). No game path calls it since card_ledger.sql.';
comment on function public.gift_card(text, text, bigint) is 'A member gives a card to another member: the copy leaves now (gift_sent, ref (''gift'', gift_claims.id)) and waits in the receiver''s bell (claim_gift writes gift_received with the same ref).';
comment on function public.accept_trade(bigint, text) is 'Accepts a trade offer: the four moves (ref (''trade_offer'', id)) are one unit; when a copy is gone nothing moves.';
comment on function public.confirm_bid(text, bigint) is 'The bidder confirms an accepted auction bid: the card and the bid cards change hands (ref (''auction'', id)); when a copy is gone nothing moves.';
comment on function public.ascend_card(text, bigint) is 'Spends copies of a card for one more star: an ascend row (ref (''ascension'', ''<card>:<star>'')).';
comment on function public.convert_dupes(text, bigint, integer) is 'Turns free copies into Shards: a convert row with ref (''shard_ledger'', the id of the Shards row).';
comment on function public.card_ledger_reconcile() is 'Proof that the card ledger is complete: for each (member, card) player_cards.quantity = sum(card_ledger.amount), no admin (''tx'') row, the reason and quantity checks are valid. ok = true when all hold.';

notify pgrst, 'reload schema';
