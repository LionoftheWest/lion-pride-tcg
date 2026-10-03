-- Shards for every daily + Shards in bell gifts (Nathan, 2026-10-02).
--
-- 1. Every daily pays settings.dailies.shards (40) Shards: "50 shards for each thing so that
--    they're incentivized to complete all the dailies, even though it's maxed out at 5 packs"
--    -> 40 each (Nathan: "do 40 shards per daily"): all 40 dailies of a week = 1,600 = one
--    Secret Rare a week.
--    - claim_daily (check in, hunt, voice, social): the Shards come with the claim. A daily
--      claimed AFTER the 5-pack earn limit pays 0 packs and still pays its Shards (before, the
--      claim was refused as 'capped', so the Shards would have been lost).
--    - claim_daily_earn (the two chat dailies, paid by the bot): the Shards come when each
--      chat milestone completes (the first message, 25 messages), also after the limit.
--    - While the earn dial is paused (pack_earn_multiplier <= 0) or the dailies are off,
--      nothing pays (as before).
-- 2. A bell gift can hold Shards (gift_claims.shards). claim_gift adds them (ledger 'event').
--    give_shards_gift_all puts a one-time Shards gift in every member's bell (a kind that
--    starts with 'once_' exists at most once per member), for the 1,000 Shards stimulus.
-- Built from the LIVE definitions of claim_daily, claim_daily_earn, claim_gift, dailies_view
-- (2026-10-02). Test: card-studio/scripts/test-shards-dailies.mjs. Idempotent.

alter table public.shard_ledger drop constraint if exists shard_ledger_reason_check;
alter table public.shard_ledger add constraint shard_ledger_reason_check check (reason in ('dungeon', 'expedition', 'arena',
  'wandering', 'minigame', 'event', 'milestone', 'dupes', 'shop', 'admin', 'daily'));

update public.settings set value = value || '{"shards": 40}'::jsonb, updated_at = now()
 where key = 'dailies' and not (value ? 'shards');

alter table public.gift_claims add column if not exists shards integer not null default 0;
alter table public.gift_claims drop constraint if exists gift_claims_amount_check;
alter table public.gift_claims add constraint gift_claims_amount_check check (
  amount between 0 and 999 and shards between 0 and 100000 and (amount > 0 or shards > 0 or kind = 'card'));
create unique index if not exists gift_claims_once_kind on public.gift_claims (player_id, kind) where kind like 'once\_%';

-- Redeem a gift: a card goes to the collection; packs to the OPEN balance; Shards to the balance.
create or replace function public.claim_gift(p_player text, p_id bigint) returns jsonb
language plpgsql set search_path = public as $$
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
  if g.amount > 0 then bal := grant_packs(p_player, g.amount, g.reason, g.from_id); end if;
  if g.shards > 0 then sbal := grant_shards(p_player, g.shards, 'event', 'gift', g.id::text); end if;
  return jsonb_build_object('ok', true, 'packs', g.amount, 'shards', g.shards, 'title', g.title,
    'balance', coalesce(bal, (select pack_balance from players where id = p_player)), 'shard_balance', sbal);
end $$;

-- A one-time Shards gift in every member's bell. p_kind must start with 'once_' (once per member).
create or replace function public.give_shards_gift_all(p_kind text, p_title text, p_shards int, p_by text default null)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  if p_kind not like 'once\_%' then raise exception 'a Shards gift for everyone needs a once_ kind'; end if;
  if p_shards is null or p_shards < 1 then return 0; end if;
  insert into gift_claims (player_id, kind, title, amount, shards, reason, from_id)
    select id, p_kind, left(coalesce(nullif(trim(p_title), ''), 'A gift'), 80), 0, p_shards, 'event', p_by from players
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- One daily redeem: the packs (inside the earn limit) and the Shards (always).
create or replace function public.claim_daily(p_player text, p_task text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  per int; t jsonb; cap int; amt int; bal int; sh int := greatest(coalesce((cfg->>'shards')::int, 0), 0); sbal int;
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if mult <= 0 then return jsonb_build_object('ok', false, 'error', 'paused'); end if;
  if p_task not in ('checkin', 'hunt', 'voice', 'social') then return jsonb_build_object('ok', false, 'error', 'bad_task'); end if;
  perform 1 from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  select x into t from jsonb_array_elements(dailies_tasks(p_player)) x where x->>'task' = p_task;
  if coalesce((t->>'claimed')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if not coalesce((t->>'done')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  per := greatest(round(mult), 0)::int;
  cap := coalesce((cfg->>'cap')::int, 7);
  amt := greatest(least((t->>'reward')::int * per, greatest(cap - earned_today(p_player), 0)), 0);
  -- At the earn limit a daily still pays its Shards (0 packs); with no Shards set, it is capped.
  if amt <= 0 and sh <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;
  insert into daily_claims (player_id, day, task, amount) values (p_player, d, p_task, amt);
  if amt > 0 then
    if p_task = 'checkin' and amt > per then
      perform grant_packs(p_player, per, 'earned_checkin', null);
      bal := grant_packs(p_player, amt - per, 'earned_streak', null);
    else
      bal := grant_packs(p_player, amt, 'earned_' || p_task, null);
    end if;
  else
    bal := (select pack_balance from players where id = p_player);
  end if;
  if sh > 0 then sbal := grant_shards(p_player, sh, 'daily', 'daily', p_task); end if;
  return jsonb_build_object('ok', true, 'task', p_task, 'packs', amt, 'shards', sh, 'balance', bal, 'shard_balance', sbal,
    'view', dailies_view(p_player));
end $$;

-- The chat dailies (the bot): the packs inside the earn limit, the Shards when each milestone
-- completes (the flag flips once a day, so each pays once).
create or replace function public.claim_daily_earn(p_player_id text, p_date date, p_base integer, p_bonus integer, p_bonus_threshold integer)
returns integer language plpgsql set search_path to 'public' as $$
declare a record; granted int := 0; amt int;
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  cap int := coalesce((cfg->>'cap')::int, 5);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  sh int := case when coalesce((cfg->>'enabled')::boolean, false) and mult > 0 then greatest(coalesce((cfg->>'shards')::int, 0), 0) else 0 end;
begin
  select message_count, base_claimed, bonus_claimed into a
    from daily_activity where player_id = p_player_id and activity_date = p_date for update;
  if not found then return 0; end if;
  if a.message_count >= 1 and not a.base_claimed then
    update daily_activity set base_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(p_base, greatest(cap - earned_today(p_player_id), 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_daily', null); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily', 'chat'); end if;
  end if;
  if a.message_count >= p_bonus_threshold and not a.bonus_claimed then
    update daily_activity set bonus_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(p_bonus, greatest(cap - earned_today(p_player_id), 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_bonus', null); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily', 'chat_bonus'); end if;
  end if;
  return granted;
end $$;

-- The Dailies window: + the Shards for each daily and the Shards earned today.
create or replace function public.dailies_view(p_player text) returns jsonb
language plpgsql stable set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'paused', mult <= 0,
    'day', d, 'resets_at', (d + 1)::timestamp at time zone 'America/Denver',
    'cap', coalesce((cfg->>'cap')::int, 7), 'earned', earned_today(p_player),
    'shards', greatest(coalesce((cfg->>'shards')::int, 0), 0),
    'shards_today', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p_player and reason = 'daily'
                      and created_at >= d::timestamp at time zone 'America/Denver'),
    'tasks', dailies_tasks(p_player));
end $$;

notify pgrst, 'reload schema';
