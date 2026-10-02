-- The daily raid leaderboard post (Nathan, 2026-10-02): every day at 6 AM Mountain Time while a
-- boss is live, one 'leaderboard' event (the top 10 + the boss HP + the close time); the bot draws
-- the picture (raid-cards.ts) and posts it to #tcg-notifications without pinging anyone.
-- pg_cron fires at 12:00 and 13:00 UTC (6 AM MDT / MST); hunt_mt_slot('board') keeps the one in MT.

create or replace function public.hunt_mt_slot(p_kind text, p_at timestamp with time zone default now())
returns boolean language sql immutable set search_path to 'public' as $$
  select case p_kind
    when 'spawn' then extract(isodow from p_at at time zone 'America/Denver') = 4 and extract(hour from p_at at time zone 'America/Denver') = 15
    when 'nudge' then extract(isodow from p_at at time zone 'America/Denver') = 1 and extract(hour from p_at at time zone 'America/Denver') = 11
    when 'close' then extract(isodow from p_at at time zone 'America/Denver') = 1 and extract(hour from p_at at time zone 'America/Denver') = 17
    when 'board' then extract(hour from p_at at time zone 'America/Denver') = 6
    else false end;
$$;

create or replace function public.daily_raid_board(p_at timestamptz default now())
returns boolean language plpgsql set search_path = public as $$
declare h hunts; d date := (p_at at time zone 'America/Denver')::date;
begin
  if not hunt_mt_slot('board', p_at) then return false; end if;
  select * into h from hunts where status = 'active' order by id desc limit 1;
  if not found then return false; end if;
  -- One a day: the event keeps its MT day.
  if exists (select 1 from hunt_events where hunt_id = h.id and kind = 'leaderboard' and payload->>'day' = d::text) then return false; end if;
  insert into hunt_events (hunt_id, kind, payload)
  values (h.id, 'leaderboard', jsonb_build_object('day', d, 'name', h.name, 'tier', h.tier, 'hp_remaining', h.hp_remaining, 'hp_max', h.hp_max,
    'closes_at', h.closes_at,
    'top', coalesce((select jsonb_agg(jsonb_build_object('player_id', l.player_id, 'username', l.username, 'damage', l.damage, 'avatar', p.avatar) order by l.damage desc)
                     from hunt_leaderboard(h.id, 10) l join players p on p.id = l.player_id), '[]'::jsonb)));
  return true;
end $$;

do $c$ begin
  perform cron.unschedule('raid-board-mt') where exists (select 1 from cron.job where jobname = 'raid-board-mt');
  perform cron.schedule('raid-board-mt', '0 12,13 * * *', 'select daily_raid_board();');
end $c$;
