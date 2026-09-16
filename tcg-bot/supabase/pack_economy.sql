-- Pack economy: a real pack inventory (balance + ledger) and a tunable earn dial.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor.
-- The bot connects with the service_role key, which bypasses RLS, so RLS-on with
-- no policy keeps these bot-only (the same deliberate pattern as the other tables).

-- 1. Each player owns a balance of packs. -----------------------------------
alter table players add column if not exists pack_balance int not null default 0;

-- 2. Every change to that balance is logged (earn / gift / event / admin / open).
create table if not exists pack_ledger (
  id         bigint generated always as identity primary key,
  player_id  text not null references players (id) on delete cascade,
  amount     int  not null,                 -- +granted, -spent
  reason     text not null,                 -- earned_daily | earned_bonus | event | gift | admin | opened
  granted_by text,                          -- who caused it (admin/gifter id), when relevant
  created_at timestamptz not null default now()
);
create index if not exists pack_ledger_player_idx on pack_ledger (player_id, created_at desc);
alter table pack_ledger enable row level security;

-- 3. Tunable dials. pack_earn_multiplier scales every earned pack (event weeks).
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;
insert into settings (key, value) values ('pack_earn_multiplier', '1'::jsonb)
  on conflict (key) do nothing;

-- 4. Atomic helpers ----------------------------------------------------------
-- Grant packs (earn / gift / event / admin). Updates balance + logs, atomically.
create or replace function grant_packs(p_player_id text, p_amount int, p_reason text, p_by text default null)
returns int language plpgsql security invoker set search_path = public as $$
declare new_balance int;
begin
  update players set pack_balance = pack_balance + p_amount
    where id = p_player_id
    returning pack_balance into new_balance;
  if new_balance is null then
    return null;  -- unknown player
  end if;
  if p_amount <> 0 then
    insert into pack_ledger (player_id, amount, reason, granted_by)
      values (p_player_id, p_amount, p_reason, p_by);
  end if;
  return new_balance;
end; $$;

-- Spend one pack (opening). Returns true only if a pack was available.
create or replace function spend_pack(p_player_id text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare spent boolean := false;
begin
  update players set pack_balance = pack_balance - 1
    where id = p_player_id and pack_balance > 0
    returning true into spent;
  if spent then
    insert into pack_ledger (player_id, amount, reason) values (p_player_id, -1, 'opened');
    return true;
  end if;
  return false;
end; $$;

-- Grant packs to EVERY player at once (a server-wide event reward).
create or replace function grant_packs_all(p_amount int, p_reason text, p_by text default null)
returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update players set pack_balance = pack_balance + p_amount;
  insert into pack_ledger (player_id, amount, reason, granted_by)
    select id, p_amount, p_reason, p_by from players;
  get diagnostics n = row_count;
  return n;
end; $$;

-- Earn today's daily packs into the balance the first time each threshold is hit.
-- Race-safe: it locks the day row, flips the flag, and grants only once per flag.
create or replace function claim_daily_earn(p_player_id text, p_date date, p_base int, p_bonus int, p_bonus_threshold int)
returns int language plpgsql security invoker set search_path = public as $$
declare a record; granted int := 0;
begin
  select message_count, base_claimed, bonus_claimed into a
    from daily_activity where player_id = p_player_id and activity_date = p_date for update;
  if not found then return 0; end if;
  if a.message_count >= 1 and not a.base_claimed then
    update daily_activity set base_claimed = true where player_id = p_player_id and activity_date = p_date;
    perform grant_packs(p_player_id, p_base, 'earned_daily', null);
    granted := granted + p_base;
  end if;
  if a.message_count >= p_bonus_threshold and not a.bonus_claimed then
    update daily_activity set bonus_claimed = true where player_id = p_player_id and activity_date = p_date;
    perform grant_packs(p_player_id, p_bonus, 'earned_bonus', null);
    granted := granted + p_bonus;
  end if;
  return granted;
end; $$;

-- 5. record_activity now RETURNS the new message count, so the bot only runs the
--    earn check on the message that actually crosses a threshold. (Changing the
--    return type needs a DROP first.)
drop function if exists record_activity(text, date);
create or replace function record_activity(p_player_id text, p_date date)
returns int language plpgsql security invoker set search_path = public as $$
declare new_count int;
begin
  insert into daily_activity (player_id, activity_date, message_count)
  values (p_player_id, p_date, 1)
  on conflict (player_id, activity_date)
  do update set message_count = daily_activity.message_count + 1
  returning message_count into new_count;
  return new_count;
end; $$;

notify pgrst, 'reload schema';
