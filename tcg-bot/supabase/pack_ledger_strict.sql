-- Pack ledger strict (database audit 2026-10-03, plan steps 3 and 7; Nathan: "Yep do option 1").
-- Each pack move is traceable to its source, and a bad reason or a negative balance is refused:
--   1. pack_ledger.ref_kind + ref_id (the shape of shard_ledger): what caused the row (a gift, a daily
--      claim, an achievement key, a shop purchase, a Hunt, an open...). Old rows are filled from what
--      is known (granted_by, the reason, the row written in the same transaction).
--   2. pack_ledger.granted_by has ONE meaning: the other member in the move (a gift sender or
--      receiver, a boon caster, the admin who gave a promo). The achievement keys move to ref_id.
--   3. A check on pack_ledger.reason (the full list) and on gift_claims.reason (a pack gift must have
--      a reason that the ledger accepts, so the claim cannot fail later). earned_today() reads an
--      explicit list, not LIKE 'earned_%': a misspelled reason can no longer escape the daily cap.
--   4. players.pack_balance >= 0.
--   5. Step 7: the chat dailies write daily_claims rows ('chat', 'chat_bonus') like the other dailies,
--      also at the cap (amount 0). The old chat claims are copied from daily_activity once.
--   6. pack_ledger_reconcile(): sum(pack_ledger.amount) = players.pack_balance for each member, every
--      row has a ref, the two checks are valid.
-- Every function below that writes packs starts from the live text of 2026-10-06 (a fresh dump of the
-- local copy, the same md5 as live). play_card_effect also writes packs (reason 'boon', through
-- grant_packs) but balance_table.sql guards it: it is NOT replaced. grant_packs gives its rows the
-- ref ('player', the caster) from the p_by argument that it already passes.
-- Runs more than once with the same result.

-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the
-- live text it was built from (the first md5) or on its own result (the second md5). Any other change
-- to one of them stops it here, so that change is never reverted: rebuild this file from the live text.
do $g$
declare x text[]; m text;
begin
  -- balance_economy.sql (2026-10-06): the daily, achievement, Raid and Dungeon prize numbers below are read from
  -- public.balance, so its keys must exist first.
  if to_regclass('public.balance') is null or not exists (select 1 from public.balance where key = 'daily') then
    raise exception 'pack_ledger_strict.sql: apply balance_economy.sql first (these functions read its balance keys)';
  end if;
  foreach x slice 1 in array array[
  -- shard_ledger_strict.sql (2026-10-07) rebuilt the Shard refs: the second md5 of claim_daily, claim_daily_earn, buy_shop_item and dungeon_pay is its result.
    ['spend_pack(text)', '14090957d61b2cf32dcdd89fa0dcf5e3', '9f1f0ea5cc914f9ddd1bd66fdb2f0e03'],
    ['open_packs(text,bigint[],integer)', '4ad361ee52c0e9c5c32f51c226cfb51a', '78cb45be91d898fa0b3dcbde7c8dcd10'],
    ['gift_packs(text,text,integer)', '2eee04ca8a531b64508211cff497bb17', '79ef0b450bc2e9c462daf48283d21cf7'],
    ['claim_gift(text,bigint)', '05851263957dcad0a3d133e9369118d2', '3492a584dd9a8a56a934ce91b8374c4d'],
    ['claim_daily(text,text)', '795445a3e1d7086d0a6e92cccb8635bc', '06541bd131cdb91d3af34abdcf87b675'],
    ['claim_daily_earn(text,date,integer,integer,integer)', 'de096113f5594a1ccd29cfebafb9eddb', '11c7903f3652523f35e4860e43e0710e'],
    ['claim_achievement(text,text,integer,text,text)', 'd0bb69a4c07462ca5db3b9c97ab457b3', '34f4be6488a0d45577e2745381e41f11'],
    ['claim_achievement_tiers(text,text)', '584b13e1e47fd81e339ccab16c5a86db', '3c0b94a5e0c95bea4922a1ba615f389c'],
    ['buy_shop_item(text,text,integer,bigint,integer)', '0ef076d1806e22d835b25e128e156a9f', '024201884993cc4fd231dae26319661e'],
    ['settle_hunt(bigint)', '273e0b4c036dfb06217414c3f54d7cbf', 'bb5cc060c1966f554db98be41bee7c44'],
    ['dungeon_pay(text,date)', '5ee9ef4a43b9bc99b235d5ca86af8f02', 'c39c6a3b51b2206c2416412a1f49e6cb'],
    ['claim_tutorial_reward(text)', '943aed1c01973dbe24171adfbe579492', 'eec8f640fdc2ea7e70177e68532b43be'],
    ['earned_today(text)', 'e91cf80c468952921856183df5a35ab5', 'ecfaa5439465eecb93af46d51598ce38'],
    ['ach_track_values(text)', '2b337b52301f7c9536bf989031f49cd4', 'a4816a46ab5d8db754a8d37e222f5e07']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'pack_ledger_strict.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
  -- grant_packs: the old 4-argument version (dropped below) or this file's 6-argument version.
  if to_regprocedure('public.grant_packs(text,integer,text,text)') is not null
     and md5(replace(pg_get_functiondef(to_regprocedure('public.grant_packs(text,integer,text,text)')), chr(13), '')) <> '3f6ed3a81715b9b0244d3faa0519da8c' then
    raise exception 'pack_ledger_strict.sql: the live grant_packs changed since this file was built. Rebuild it from the live text.';
  end if;
  if to_regprocedure('public.grant_packs(text,integer,text,text,text,text)') is not null
     and md5(replace(pg_get_functiondef(to_regprocedure('public.grant_packs(text,integer,text,text,text,text)')), chr(13), '')) <> 'e416fd83997f7dc4c60519c0bf58b4de' then
    raise exception 'pack_ledger_strict.sql: the live 6-argument grant_packs changed since this file was built.';
  end if;
end $g$;
-- GUARD-END

-- 1. The ref columns ---------------------------------------------------------------------------------
alter table public.pack_ledger add column if not exists ref_kind text;
alter table public.pack_ledger add column if not exists ref_id text;

-- 2. Fill the ref of the old rows from what is known. Only rows with no ref; a row is filled only
--    when exactly one source matches. The source row was written in the same transaction, so it has
--    the same now() (created_at / claimed_at / settled_at / paid_at).
-- 2a. Achievements: granted_by held the achievement key. It moves to ref_id; granted_by keeps one meaning.
update public.pack_ledger set ref_kind = 'achievement', ref_id = granted_by, granted_by = null
 where reason = 'achievement' and ref_kind is null and granted_by is not null;
-- 2b. A gift claimed with claim_gift (welcome, launch_gift, raid_makeup_oct1, bug_reward, gift_received...).
with m as (
  select l.id, min(g.id) as gid, count(*) as n
    from public.pack_ledger l
    join public.gift_claims g on g.player_id = l.player_id and g.claimed_at = l.created_at
                             and g.reason = l.reason and g.amount = l.amount and g.kind <> 'card'
   where l.ref_kind is null and l.amount > 0
   group by l.id)
update public.pack_ledger l set ref_kind = 'gift', ref_id = m.gid::text from m where m.id = l.id and m.n = 1;
-- 2c. A gift sent with gift_packs: the gift row made in the same transaction for the receiver (granted_by).
with m as (
  select l.id, min(g.id) as gid, count(*) as n
    from public.pack_ledger l
    join public.gift_claims g on g.from_id = l.player_id and g.player_id = l.granted_by and g.created_at = l.created_at
                             and g.amount = -l.amount and g.kind = 'member_gift'
   where l.ref_kind is null and l.reason = 'gift_sent'
   group by l.id)
update public.pack_ledger l set ref_kind = 'gift', ref_id = m.gid::text from m where m.id = l.id and m.n = 1;
-- 2d. A daily claimed with claim_daily: its daily_claims row ('<day>:<task>'; the streak bonus belongs to the checkin).
with m as (
  select l.id, min(d.day::text || ':' || d.task) as r, count(*) as n
    from public.pack_ledger l
    join public.daily_claims d on d.player_id = l.player_id and d.created_at = l.created_at
                              and d.task = case l.reason when 'earned_streak' then 'checkin' else substr(l.reason, 8) end
   where l.ref_kind is null
     and l.reason in ('earned_checkin', 'earned_streak', 'earned_hunt', 'earned_voice', 'earned_social', 'earned_dungeon', 'earned_gauntlet')
   group by l.id)
update public.pack_ledger l set ref_kind = 'daily_claim', ref_id = m.r from m where m.id = l.id and m.n = 1;
-- 2e. Step 7: the old chat claims (the flags in daily_activity) become daily_claims rows. The amount
--     is the packs paid that game day (0 = the cap applied). created_at = the time of the pack row,
--     or the start of that game day when no pack was paid (the claim time was not recorded).
insert into public.daily_claims (player_id, day, task, amount, created_at)
select a.player_id, a.activity_date, t.task, coalesce(sum(l.amount), 0)::int,
       coalesce(min(l.created_at), a.activity_date::timestamp at time zone 'America/Denver')
  from public.daily_activity a
  cross join lateral (values ('chat', 'earned_daily', a.base_claimed), ('chat_bonus', 'earned_bonus', a.bonus_claimed)) t(task, reason, claimed)
  left join public.pack_ledger l on l.player_id = a.player_id and l.reason = t.reason
                                and (l.created_at at time zone 'America/Denver')::date = a.activity_date
 where t.claimed
 group by a.player_id, a.activity_date, t.task
on conflict (player_id, day, task) do nothing;
-- 2f. The chat pack rows point at those claims.
update public.pack_ledger l
   set ref_kind = 'daily_claim',
       ref_id = ((l.created_at at time zone 'America/Denver')::date)::text || case l.reason when 'earned_daily' then ':chat' else ':chat_bonus' end
 where l.ref_kind is null and l.reason in ('earned_daily', 'earned_bonus')
   and exists (select 1 from public.daily_claims d
                where d.player_id = l.player_id and d.day = (l.created_at at time zone 'America/Denver')::date
                  and d.task = case l.reason when 'earned_daily' then 'chat' else 'chat_bonus' end);
-- 2g. A shop pack purchase: its shop_purchases row.
with m as (
  select l.id, min(s.id) as sid, count(*) as n
    from public.pack_ledger l
    join public.shop_purchases s on s.player_id = l.player_id and s.created_at = l.created_at and s.kind = 'pack' and s.qty = l.amount
   where l.ref_kind is null and l.reason = 'shop'
   group by l.id)
update public.pack_ledger l set ref_kind = 'shop_purchase', ref_id = m.sid::text from m where m.id = l.id and m.n = 1;
-- 2h. A Hunt prize: the Hunt settled in the same transaction.
with m as (
  select l.id, min(h.id) as hid, count(*) as n
    from public.pack_ledger l join public.hunts h on h.settled_at = l.created_at
   where l.ref_kind is null and l.reason = 'hunt_reward'
   group by l.id)
update public.pack_ledger l set ref_kind = 'hunt', ref_id = m.hid::text from m where m.id = l.id and m.n = 1;
-- 2i. A Dungeon / Gauntlet prize: the payout paid in the same transaction.
with m as (
  select l.id, min(p.mode || ':' || p.period::text) as r, count(*) as n
    from public.pack_ledger l join public.dungeon_payouts p on p.paid_at = l.created_at
   where l.ref_kind is null and l.reason = 'dungeon_prize'
   group by l.id)
update public.pack_ledger l set ref_kind = 'dungeon_payout', ref_id = m.r from m where m.id = l.id and m.n = 1;
-- 2j. The tutorial pack (one per member) and a boon (granted_by = the caster).
update public.pack_ledger set ref_kind = 'tutorial', ref_id = 'complete' where ref_kind is null and reason = 'tutorial';
update public.pack_ledger set ref_kind = 'player', ref_id = granted_by where ref_kind is null and reason = 'boon' and granted_by is not null;
-- 2k. Opened packs: one open = the rows of one member in one transaction (the same created_at). The
--     open id is a uuid made from (member, time), so the packs of one old open share one ref_id.
update public.pack_ledger
   set ref_kind = 'open', ref_id = md5(player_id || '|' || (extract(epoch from created_at) * 1000000)::bigint::text)::uuid::text
 where ref_kind is null and reason = 'opened';

-- 3. Only known reasons ------------------------------------------------------------------------------
-- Since ledger_reasons.sql (2026-10-07) the reasons are rows of public.ledger_reasons: add a new reason
-- there (and, if it counts to the daily cap, in earned_today()).
-- The check below is the state before that file. Once public.ledger_reasons exists, its foreign key (the same
-- name) replaces the check and this step is skipped, so a re-run of this file keeps the new state.
do $r$
begin
  if to_regclass('public.ledger_reasons') is not null then return; end if;
  alter table public.pack_ledger drop constraint if exists pack_ledger_reason_check;
  alter table public.pack_ledger add constraint pack_ledger_reason_check check (reason in (
    'opened', 'gift_sent', 'gift_received', 'welcome', 'launch_gift', 'raid_makeup_oct1', 'bug_reward', 'admin', 'event',
    'tutorial', 'achievement', 'shop', 'hunt_reward', 'dungeon_prize', 'boon',
    'earned_checkin', 'earned_streak', 'earned_hunt', 'earned_voice', 'earned_social', 'earned_dungeon', 'earned_gauntlet',
    'earned_daily', 'earned_bonus'));
end $r$;
-- A pack gift waits in gift_claims until the member claims it; its reason goes into pack_ledger then.
-- The same list here, so a gift with a bad reason is refused when it is made, not when it is claimed.
-- The same rule for the gift check (ledger_reasons.sql replaces it with a foreign key of the same name).
do $r$
begin
  if to_regclass('public.ledger_reasons') is not null then return; end if;
  alter table public.gift_claims drop constraint if exists gift_claims_pack_reason_check;
  alter table public.gift_claims add constraint gift_claims_pack_reason_check check (kind = 'card' or amount = 0 or reason in (
    'opened', 'gift_sent', 'gift_received', 'welcome', 'launch_gift', 'raid_makeup_oct1', 'bug_reward', 'admin', 'event',
    'tutorial', 'achievement', 'shop', 'hunt_reward', 'dungeon_prize', 'boon',
    'earned_checkin', 'earned_streak', 'earned_hunt', 'earned_voice', 'earned_social', 'earned_dungeon', 'earned_gauntlet',
    'earned_daily', 'earned_bonus'));
end $r$;

-- 4. No negative pack balance ------------------------------------------------------------------------
alter table public.players drop constraint if exists players_pack_balance_nonneg;
alter table public.players add constraint players_pack_balance_nonneg check (pack_balance >= 0);

-- 5. grant_packs with the ref ------------------------------------------------------------------------
-- The old 4-argument version goes: a 4-argument call (play_card_effect, the bot grantPacks) uses the
-- defaults of the new one.
drop function if exists public.grant_packs(text, integer, text, text);
create or replace function public.grant_packs(p_player_id text, p_amount integer, p_reason text, p_by text default null,
  p_ref_kind text default null, p_ref_id text default null)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare new_balance int;
begin
  update players set pack_balance = pack_balance + p_amount
    where id = p_player_id
    returning pack_balance into new_balance;
  if new_balance is null then
    return null;  -- unknown player
  end if;
  if p_amount <> 0 then
    -- No ref given but a member (p_by): the ref is that member (play_card_effect: the boon caster).
    insert into pack_ledger (player_id, amount, reason, granted_by, ref_kind, ref_id)
      values (p_player_id, p_amount, p_reason, p_by,
              coalesce(p_ref_kind, case when p_by is not null then 'player' end),
              case when p_ref_kind is null then p_by else p_ref_id end);
  end if;
  return new_balance;
end $function$;

-- 6. The functions that write packs, with their ref -------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_pack(p_player_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare spent boolean := false;
begin
  update players set pack_balance = pack_balance - 1
    where id = p_player_id and pack_balance > 0
    returning true into spent;
  if spent then
    insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id) values (p_player_id, -1, 'opened', 'open', gen_random_uuid()::text);
    return true;
  end if;
  return false;
end; $function$;

CREATE OR REPLACE FUNCTION public.open_packs(p_player_id text, p_cards bigint[], p_size integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_want int; v_have int; v_n int; v_open text := gen_random_uuid()::text; -- one id for the packs of this open
begin
  v_want := coalesce(array_length(p_cards, 1), 0) / greatest(1, p_size);
  if v_want < 1 or v_want > 10 then return 0; end if;
  -- The row lock makes concurrent opens of one player wait, so the balance never goes below 0.
  select pack_balance into v_have from players where id = p_player_id for update;
  v_n := least(coalesce(v_have, 0), v_want);
  if v_n <= 0 then return 0; end if;
  update players set pack_balance = pack_balance - v_n where id = p_player_id;
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id)
    select p_player_id, -1, 'opened', 'open', v_open from generate_series(1, v_n);
  perform add_cards_to_player(p_player_id, p_cards[1 : v_n * p_size]);
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.gift_packs(p_from text, p_to text, p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare moved boolean := false; v_gift bigint;
begin
  if p_amount is null or p_amount < 1 or p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  update players set pack_balance = pack_balance - p_amount
    where id = p_from and pack_balance >= p_amount returning true into moved;
  if moved is not true then return false; end if; -- NULL when the sender has too few (gift_packs_fix.sql)
  -- The gift row first: the sender's row points at it (ref 'gift'), as the receiver's row does when claimed.
  v_gift := give_gift(p_to, 'member_gift', 'Gift from ' || coalesce((select username from players where id = p_from), 'a member'), p_amount, 'gift_received', p_from);
  insert into pack_ledger (player_id, amount, reason, granted_by, ref_kind, ref_id) values (p_from, -p_amount, 'gift_sent', p_to, 'gift', v_gift::text);
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_gift(p_player text, p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare g gift_claims; bal int; sbal int;
begin
  select * into g from gift_claims where id = p_id and player_id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if g.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  update gift_claims set claimed_at = now() where id = p_id;
  if g.kind = 'card' then
    -- A card gift (launch_event_cards.sql): the card goes to the collection.
    perform add_card_to_player(p_player, g.card_id, 'gift'); -- the same path as a trade
    return jsonb_build_object('ok', true, 'packs', 0, 'card_id', g.card_id, 'title', g.title);
  end if;
  if g.amount > 0 then bal := grant_packs(p_player, g.amount, g.reason, g.from_id, 'gift', g.id::text); end if;
  if g.shards > 0 then sbal := grant_shards(p_player, g.shards, 'event', 'gift', g.id::text); end if;
  return jsonb_build_object('ok', true, 'packs', g.amount, 'shards', g.shards, 'title', g.title,
    'balance', coalesce(bal, (select pack_balance from players where id = p_player)), 'shard_balance', sbal);
end $function$;

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

CREATE OR REPLACE FUNCTION public.claim_achievement(p_player text, p_key text, p_packs integer DEFAULT NULL::integer, p_title text DEFAULT NULL::text, p_frame text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare inserted int; bal int; r jsonb; v_packs int;
begin
  -- The reward is balance achievement_rewards.badges (balance_economy.sql). p_packs, p_title and p_frame are no
  -- longer read: an older Activity still sends them.
  r := balance_get('achievement_rewards')->'badges'->p_key;
  if r is null then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  v_packs := coalesce((r->>'packs')::int, 0);
  -- The tracks replace these keys (achievement_tracks.sql): never paid again once they are on.
  if ach_tracks_on(p_player) and exists (select 1 from achievement_switch_map where old_key = p_key) then
    return jsonb_build_object('ok', false, 'error', 'retired'); end if;
  insert into achievement_claims (player_id, key, packs, title, frame)
    values (p_player, p_key, v_packs, r->>'title', r->>'frame')
    on conflict (player_id, key) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if v_packs > 0 then
    bal := grant_packs(p_player, v_packs, 'achievement', null, 'achievement', p_key);
    if bal is null then raise exception 'unknown player %', p_player; end if; -- rolls the claim back
  end if;
  return jsonb_build_object('ok', true, 'balance', bal, 'packs', v_packs, 'title', r->>'title', 'frame', r->>'frame');
end; $function$;

CREATE OR REPLACE FUNCTION public.claim_achievement_tiers(p_player text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
          if pk > 0 then perform grant_packs(p_player, pk, 'achievement', null, 'achievement', k); end if;
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
      perform grant_packs(p_player, b.packs, 'achievement', null, 'achievement', b.key);
      got_packs := got_packs + b.packs; keys := keys || b.key; titles := titles || b.title;
    end if;
  end loop;
  return jsonb_build_object('ok', cardinality(keys) > 0, 'error', case when cardinality(keys) = 0 then 'nothing' end,
    'claimed', to_jsonb(keys), 'packs', got_packs, 'shards', got_shards, 'titles', to_jsonb(titles), 'frames', to_jsonb(frames),
    'balance', (select pack_balance from players where id = p_player), 'shard_balance', (select shard_balance from players where id = p_player));
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

CREATE OR REPLACE FUNCTION public.settle_hunt(p_hunt bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_status text; v_settled timestamptz; v_cfg jsonb; v_base int; v_ranks jsonb;
  v_participants int := 0; r record; v_packs int; v_paidtotal int := 0; v_paid jsonb := '[]'::jsonb;
begin
  select status, settled_at into v_status, v_settled from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_settled is not null then return jsonb_build_object('ok', false, 'error', 'already_settled'); end if;
  if v_status not in ('defeated', 'expired') then return jsonb_build_object('ok', false, 'error', 'not_ended'); end if;

  v_cfg := balance_get('hunt_prizes');
  v_base := balance_num('hunt_prizes', 'base')::int;
  v_ranks := coalesce(v_cfg->'ranks', '[]'::jsonb);

  for r in
    select t.player_id, t.dmg,
           case when t.dmg > 0 then row_number() over (order by t.dmg desc, t.first_hit) end as place
      from (select player_id, sum(damage) as dmg, min(id) as first_hit
              from hunt_hits where hunt_id = p_hunt group by player_id) t
     order by t.dmg desc, t.first_hit
  loop
    v_participants := v_participants + 1;
    v_packs := case when r.place is not null and r.place <= jsonb_array_length(v_ranks)
                    then (v_ranks->>(r.place::int - 1))::int else v_base end;
    if v_packs > 0 then perform grant_packs(r.player_id, v_packs, 'hunt_reward', null, 'hunt', p_hunt::text); end if;
    v_paidtotal := v_paidtotal + v_packs;
    v_paid := v_paid || jsonb_build_object('player_id', r.player_id, 'packs', v_packs, 'place', r.place);
  end loop;

  update hunts set settled_at = now() where id = p_hunt;
  return jsonb_build_object('ok', true, 'defeated', v_status = 'defeated', 'participants', v_participants,
    'total_packs', v_paidtotal, 'paid', v_paid);
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

CREATE OR REPLACE FUNCTION public.claim_tutorial_reward(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare t jsonb; bal int;
  steps text[] := array['open', 'rarity', 'collection', 'hunt', 'community', 'dailies', 'voice'];
begin
  select tutorial into t from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  if exists (select 1 from pack_ledger where player_id = p_player and reason = 'tutorial') then
    return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if exists (select 1 from unnest(steps) s where not coalesce(t->'done', '[]'::jsonb) ? s) then
    return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  bal := grant_packs(p_player, 1, 'tutorial', null, 'tutorial', 'complete');
  insert into notifications (player_id, kind, message) values (p_player, 'pack_gift', '🎁 Tutorial complete! Here is 1 free pack.');
  perform launch_player_gift(p_player); -- the Launch Day Player card (launch_event_cards.sql)
  return jsonb_build_object('ok', true, 'packs', 1, 'balance', bal);
end $function$;

CREATE OR REPLACE FUNCTION public.earned_today(p_player text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(amount), 0)::int from pack_ledger
  where player_id = p_player and reason in ('earned_checkin', 'earned_streak', 'earned_hunt', 'earned_voice', 'earned_social', 'earned_dungeon', 'earned_gauntlet', 'earned_daily', 'earned_bonus') -- the list in pack_ledger_reason_check that counts to the daily cap
    and created_at >= ((now() at time zone 'America/Denver')::date)::timestamp at time zone 'America/Denver';
$function$;

CREATE OR REPLACE FUNCTION public.ach_track_values(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      -- every claim except the plain chat daily (before pack_ledger_strict.sql: daily_claims + the chat bonus flags)
      (select count(*) from daily_claims where player_id = p_player and task <> 'chat'));
  v := v || jsonb_build_object('streak', (select coalesce(max(run_len), 0) from (
      select count(*) run_len from (select day, day - (row_number() over (order by day))::int g
                                from (select distinct day from daily_claims where player_id = p_player and task = 'checkin') d) x
       group by g) y));
  v := v || jsonb_build_object('voice', (select count(*) from (
      select day from daily_claims where player_id = p_player and task = 'voice'
      union select day from daily_claims where player_id = p_player and task = 'chat_bonus') d));
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
end $function$;

-- 7. The reconcile -----------------------------------------------------------------------------------
-- ok = true when: each member's pack_balance = the sum of their pack_ledger rows, every row has a ref,
-- and the two checks are valid (so every row has a known reason and no balance is negative).
-- mismatched lists the member ids that do not match: run it only where member data may be shown.
create or replace function public.pack_ledger_reconcile()
returns jsonb
language sql stable security invoker set search_path = public as $function$
  with s as (
    select p.id, p.pack_balance, coalesce(sum(l.amount), 0)::bigint as ledger
      from players p left join pack_ledger l on l.player_id = p.id
     group by p.id, p.pack_balance
  ), x as (
    select (select count(*) from s) as players,
           (select count(*) from s where s.ledger <> s.pack_balance) as mismatched,
           (select coalesce(jsonb_agg(jsonb_build_object('player_id', s.id, 'balance', s.pack_balance, 'ledger', s.ledger)), '[]'::jsonb)
              from s where s.ledger <> s.pack_balance) as mismatched_rows,
           (select count(*) from pack_ledger) as rows,
           (select count(*) from pack_ledger where ref_kind is null or ref_id is null) as rows_without_ref,
           coalesce((select convalidated from pg_constraint where conname = 'pack_ledger_reason_check' and conrelid = 'public.pack_ledger'::regclass), false) as reason_check,
           coalesce((select convalidated from pg_constraint where conname = 'players_pack_balance_nonneg' and conrelid = 'public.players'::regclass), false) as balance_check
  )
  select jsonb_build_object('ok', x.mismatched = 0 and x.rows_without_ref = 0 and x.reason_check and x.balance_check,
    'players', x.players, 'mismatched', x.mismatched, 'rows', x.rows, 'rows_without_ref', x.rows_without_ref,
    'reason_check', x.reason_check, 'balance_check', x.balance_check, 'mismatched_rows', x.mismatched_rows)
    from x;
$function$;

-- 8. Documentation -----------------------------------------------------------------------------------
comment on table public.pack_ledger is
  '[players-economy] One row per change of a member''s pack balance (players.pack_balance): + for a grant, - for an open or a gift sent. sum(amount) per member = pack_balance (pack_ledger_reconcile()). Written only by the pack functions (grant_packs, open_packs, spend_pack, gift_packs).';
comment on column public.pack_ledger.id is 'Row id.';
comment on column public.pack_ledger.player_id is 'The member (players.id) whose balance changed.';
comment on column public.pack_ledger.amount is 'The change in packs: positive = packs added, negative = packs used (opened) or given away (gift_sent).';
-- The comment before ledger_reasons.sql (2026-10-07); once that table exists, its own comment stays.
do $r$
begin
  if to_regclass('public.ledger_reasons') is not null then return; end if;
  comment on column public.pack_ledger.reason is
    'Why (pack_ledger_reason_check lists the allowed values): opened; gift_sent / gift_received (member gifts); welcome, launch_gift, raid_makeup_oct1, bug_reward, admin, event (gifts claimed in the bell); tutorial; achievement; shop; hunt_reward; dungeon_prize; boon (a pack boon card); earned_checkin, earned_streak, earned_hunt, earned_voice, earned_social, earned_dungeon, earned_gauntlet (claim_daily), earned_daily, earned_bonus (the chat dailies). The earned_ reasons count to the daily cap (earned_today()).';
end $r$;
comment on column public.pack_ledger.granted_by is
  'The other member in the move, or null: the gift sender (gift_received), the gift receiver (gift_sent), the boon caster (boon), the admin who gave a promo or launch gift. Before pack_ledger_strict.sql it also held achievement keys; those are now in ref_id.';
comment on column public.pack_ledger.ref_kind is
  'The kind of source row (null only for an old row that could not be matched): gift (gift_claims.id), daily_claim (daily_claims, ref_id = ''<day>:<task>''), achievement (achievement_claims.key), shop_purchase (shop_purchases.id), hunt (hunts.id), dungeon_payout (dungeon_payouts, ref_id = ''<mode>:<period>''), open (one pack open; ref_id = the open id, the same for the packs of one open), tutorial (ref_id = ''complete''), player (ref_id = a member id: the boon caster).';
comment on column public.pack_ledger.ref_id is 'The id of the source row (see ref_kind), as text.';
comment on column public.pack_ledger.created_at is 'When the row was written (the transaction time, the same as the source row).';

comment on table public.players is '[players-economy] One row per member (the Discord user id) with their balances and profile settings.';
comment on column public.players.pack_balance is 'Unopened packs. Never negative (players_pack_balance_nonneg). Changed only with a pack_ledger row: sum(pack_ledger.amount) = pack_balance.';

comment on table public.gift_claims is '[players-economy] Gifts that wait in a member''s bell until they claim them (packs, Shards or a card). claim_gift() pays them; a pack gift writes a pack_ledger row with ref (''gift'', id).';
-- The comment before ledger_reasons.sql (2026-10-07); once that table exists, its own comment stays.
do $r$
begin
  if to_regclass('public.ledger_reasons') is not null then return; end if;
  comment on column public.gift_claims.reason is 'The pack_ledger reason used when the gift is claimed. A pack gift must use a reason that pack_ledger accepts (gift_claims_pack_reason_check, the same list as pack_ledger_reason_check).';
end $r$;

comment on table public.daily_claims is '[players-economy] One row per daily task claimed by a member on a game day (America/Denver). amount = the packs paid (0 = the daily cap applied). Since pack_ledger_strict.sql the chat dailies are here too.';
comment on column public.daily_claims.player_id is 'The member (players.id).';
comment on column public.daily_claims.day is 'The game day (America/Denver) of the claim.';
comment on column public.daily_claims.task is 'The task: checkin, hunt, voice, social, dungeon, gauntlet (claim_daily), chat (the first message of the day) and chat_bonus (the message count threshold; claim_daily_earn).';
comment on column public.daily_claims.amount is 'Packs paid for this claim (0 = the daily cap applied). The pack_ledger row has ref (''daily_claim'', ''<day>:<task>'').';
comment on column public.daily_claims.created_at is 'When the claim was made. For chat claims copied from daily_activity with 0 packs: the start of that game day (the time was not recorded).';

comment on table public.daily_activity is '[players-economy] The chat message count of a member per game day (record_activity, the bot). The chat claims are in daily_claims; the two flags stay as the lock of claim_daily_earn and for dailies_tasks.';
comment on column public.daily_activity.player_id is 'The member (players.id).';
comment on column public.daily_activity.activity_date is 'The game day (America/Denver; the bot utcToday() returns that day).';
comment on column public.daily_activity.message_count is 'Messages counted on that day.';
comment on column public.daily_activity.base_claimed is 'The chat daily was claimed (the same as a daily_claims row with task chat).';
comment on column public.daily_activity.bonus_claimed is 'The chat bonus daily was claimed (the same as a daily_claims row with task chat_bonus).';

comment on function public.grant_packs(text, integer, text, text, text, text) is 'Adds p_amount packs (negative: removes) to a member and writes the pack_ledger row with its reason and ref. Returns the new balance, or null for an unknown member. With no ref but p_by, the ref is (''player'', p_by).';
comment on function public.spend_pack(text) is 'Uses one pack of a member (an open of one pack): pack_ledger row reason opened, ref (''open'', a new id). False when the balance is 0.';
comment on function public.open_packs(text, bigint[], integer) is 'Opens up to 10 packs in one call: takes the packs, writes one opened row per pack with one shared ref (''open'', id), adds the cards. Returns the packs opened.';
comment on function public.gift_packs(text, text, integer) is 'A member gives packs to another member: the sender''s gift_sent row and the receiver''s gift_claims row (claimed later) share the gift id as ref.';
comment on function public.claim_gift(text, bigint) is 'A member claims a gift from the bell: packs (ref (''gift'', id)), Shards or a card.';
comment on function public.claim_daily(text, text) is 'A member claims a daily task (not chat): a daily_claims row, the packs up to the daily cap (ref (''daily_claim'', ''<day>:<task>'')) and the Shards.';
comment on function public.claim_daily_earn(text, date, integer, integer, integer) is 'The bot pays the two chat dailies (chat, chat_bonus) when the message count crosses 1 and the threshold: a daily_claims row each (amount 0 at the cap), the packs up to the daily cap (ref (''daily_claim'', ''<day>:<task>'')) and the Shards.';
comment on function public.claim_achievement(text, text, integer, text, text) is 'A member claims an old-style achievement: the achievement_claims row and the packs (ref (''achievement'', key)).';
comment on function public.claim_achievement_tiers(text, text) is 'A member claims the reached track tiers and tag badges: achievement_claims rows, packs (ref (''achievement'', key)) and Shards.';
comment on function public.buy_shop_item(text, text, integer, bigint, integer) is 'A member buys with Shards: packs (ref (''shop_purchase'', shop_purchases.id)), a card of the day or a stat reset.';
comment on function public.settle_hunt(bigint) is 'Pays the prizes of an ended Hunt once: packs by damage rank (ref (''hunt'', hunt id)).';
comment on function public.dungeon_pay(text, date) is 'Pays the Dungeon (daily) or Gauntlet (weekly) prizes once per period: Shards, packs (ref (''dungeon_payout'', ''<mode>:<period>'')) and cards.';
comment on function public.claim_tutorial_reward(text) is 'Pays the one tutorial pack (ref (''tutorial'', ''complete'')) when all the steps are done.';
comment on function public.earned_today(text) is 'Packs a member earned today (America/Denver) from the dailies: the earned_ reasons in an explicit list. The daily cap compares with it.';
comment on function public.ach_track_values(text) is 'The values of the achievement tracks for a member (packs opened, dailies, voice days, raids...). The dailies count reads daily_claims only (chat_bonus included, the plain chat daily not).';
comment on function public.pack_ledger_reconcile() is 'Proof that the pack ledger is complete: each member''s pack_balance = sum(pack_ledger.amount), every row has a ref, the reason and balance checks are valid. ok = true when all hold.';

notify pgrst, 'reload schema';
