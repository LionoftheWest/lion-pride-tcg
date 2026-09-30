-- Dailies (Nathan, 2026-09-30): more ways to earn packs by being active, redeemed in the
-- Activity's Dailies window. Each task pays once per UTC day (the same day as the chat
-- earn and the hunt), and a member can EARN at most settings.dailies.cap (7) packs a day:
-- chat + the tasks here (gifts, welcome, and hunt payouts are not earnings).
--   checkin  claim once a day in the window: 1 pack, +1 on streak day 3 and 7 of each week
--   hunt     used hunt_daily_card_cap (8) different cards on today's boss: 1 pack
--   voice    settings.dailies.voice_minutes (30) minutes in voice with someone: 1 pack
--   social   today's first accepted trade (2 different cards) or boon on another member: 1
-- Chat stays automatic (the bot, claim_daily_earn); the window only shows it.
-- The dial pack_earn_multiplier scales every reward, and 0 = paused (nothing counts).
-- Flag: settings.dailies.enabled, default false (the window stays hidden, claims refused).

insert into public.settings (key, value) values ('dailies',
  '{"enabled": false, "cap": 7, "voice_minutes": 30}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.daily_claims (
  player_id  text not null references public.players(id) on delete cascade,
  day        date not null,
  task       text not null,
  amount     int  not null,
  created_at timestamptz not null default now(),
  primary key (player_id, day, task)
);
alter table public.daily_claims enable row level security;

create table if not exists public.voice_minutes (
  player_id text not null references public.players(id) on delete cascade,
  day       date not null,
  minutes   int  not null default 0,
  primary key (player_id, day)
);
alter table public.voice_minutes enable row level security;

-- Packs EARNED today (every earned_* ledger reason, chat included), for the cap.
create or replace function public.earned_today(p_player text) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0)::int from pack_ledger
  where player_id = p_player and reason like 'earned\_%'
    and created_at >= ((now() at time zone 'utc')::date)::timestamp at time zone 'utc';
$$;

-- Consecutive check-in days BEFORE p_day (today's claim is added by the caller).
create or replace function public.checkin_streak(p_player text, p_day date) returns int
language plpgsql stable set search_path = public as $$
declare n int := 0;
begin
  while exists (select 1 from daily_claims where player_id = p_player and task = 'checkin' and day = p_day - (n + 1)) loop
    n := n + 1;
  end loop;
  return n;
end $$;

-- Today's tasks for one member: progress, done, claimed, reward.
create or replace function public.dailies_tasks(p_player text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  d date := (now() at time zone 'utc')::date;
  t0 timestamptz := d::timestamp at time zone 'utc';
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  vneed int := coalesce((cfg->>'voice_minutes')::int, 30);
  hneed int := coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8);
  msgs int; base boolean; bonus boolean; used int; mins int; social boolean; live boolean;
  prior int; ci boolean;
  claimed text[];
begin
  select message_count, base_claimed, bonus_claimed into msgs, base, bonus
    from daily_activity where player_id = p_player and activity_date = d;
  select count(distinct card_id) into used from hunt_hits where player_id = p_player and hit_date = d;
  live := exists (select 1 from hunts where status = 'active' and opens_at <= now() and closes_at > now());
  select minutes into mins from voice_minutes where player_id = p_player and day = d;
  social := exists (select 1 from trade_offers where status = 'accepted' and resolved_at >= t0
                      and (from_id = p_player or to_id = p_player) and offer_card_id <> request_card_id)
         or exists (select 1 from card_plays where player_id = p_player and kind = 'boon' and created_at >= t0
                      and aimed_at is not null and aimed_at <> p_player and outcome <> 'blocked');
  select coalesce(array_agg(task), '{}') into claimed from daily_claims where player_id = p_player and day = d;
  prior := checkin_streak(p_player, d);
  ci := 'checkin' = any(claimed);
  return jsonb_build_array(
    jsonb_build_object('task', 'checkin', 'done', true, 'claimed', ci,
      'streak', prior + case when ci then 1 else 0 end,
      'reward', 1 + case when (prior + 1) % 7 in (3, 0) then 1 else 0 end),
    jsonb_build_object('task', 'chat', 'auto', true, 'have', coalesce(msgs, 0), 'need', 25,
      'packs', (case when coalesce(base, false) then 1 else 0 end) + (case when coalesce(bonus, false) then 1 else 0 end), 'max', 2),
    jsonb_build_object('task', 'hunt', 'have', least(coalesce(used, 0), hneed), 'need', hneed, 'live', live,
      'done', coalesce(used, 0) >= hneed, 'claimed', 'hunt' = any(claimed), 'reward', 1),
    jsonb_build_object('task', 'voice', 'have', least(coalesce(mins, 0), vneed), 'need', vneed,
      'done', coalesce(mins, 0) >= vneed, 'claimed', 'voice' = any(claimed), 'reward', 1),
    jsonb_build_object('task', 'social', 'have', case when social then 1 else 0 end, 'need', 1,
      'done', social, 'claimed', 'social' = any(claimed), 'reward', 1));
end $$;

-- The window: the flag, the pause, the cap, and the tasks.
create or replace function public.dailies_view(p_player text) returns jsonb
language plpgsql stable set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  d date := (now() at time zone 'utc')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'paused', mult <= 0,
    'day', d, 'resets_at', (d + 1)::timestamp at time zone 'utc',
    'cap', coalesce((cfg->>'cap')::int, 7), 'earned', earned_today(p_player),
    'tasks', dailies_tasks(p_player));
end $$;

-- Redeem one task. Locks the member row, so two taps cannot both pay.
create or replace function public.claim_daily(p_player text, p_task text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  per int; t jsonb; cap int; amt int; base_amt int; bal int;
  d date := (now() at time zone 'utc')::date;
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
  amt := least((t->>'reward')::int * per, greatest(cap - earned_today(p_player), 0));
  if amt <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;
  insert into daily_claims (player_id, day, task, amount) values (p_player, d, p_task, amt);
  if p_task = 'checkin' and amt > per then
    perform grant_packs(p_player, per, 'earned_checkin', null);
    bal := grant_packs(p_player, amt - per, 'earned_streak', null);
  else
    bal := grant_packs(p_player, amt, 'earned_' || p_task, null);
  end if;
  return jsonb_build_object('ok', true, 'task', p_task, 'packs', amt, 'balance', bal, 'view', dailies_view(p_player));
end $$;

-- The bot calls this once a minute with the members in voice with someone else.
create or replace function public.add_voice_minutes(p_ids text[]) returns int
language plpgsql set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  n int;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true or mult <= 0 then return 0; end if;
  insert into voice_minutes as v (player_id, day, minutes)
    select distinct u.id, (now() at time zone 'utc')::date, 1
    from unnest(p_ids) as u(id) join players p on p.id = u.id
  on conflict (player_id, day) do update set minutes = v.minutes + 1;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.earned_today(text), public.checkin_streak(text, date), public.dailies_tasks(text),
  public.dailies_view(text), public.claim_daily(text, text), public.add_voice_minutes(text[])
  from public, anon, authenticated;

notify pgrst, 'reload schema';
