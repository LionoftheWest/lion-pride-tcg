-- The weekly boss runs on Mountain Time (Nathan, 2026-09-29): spawn Thursday 3:00 PM MT,
-- nudge Monday 11:00 AM MT, close Monday 5:00 PM MT, all year (America/Denver, so it
-- follows daylight saving time). Before: fixed UTC (Thu 21:00 / Mon 17:00 / Mon 23:00),
-- which is the same as MT only while daylight time is on.
-- pg_cron runs in UTC, so each job fires at BOTH UTC hours that the MT time can be (MDT is
-- UTC-6, MST is UTC-7), and hunt_mt_slot() lets only the right one act.
-- Idempotent.

-- True when p_at is the MT slot of that job (the day and the hour on the Denver clock).
create or replace function public.hunt_mt_slot(p_kind text, p_at timestamptz default now())
returns boolean language sql immutable set search_path to 'public' as $$
  select case p_kind
    when 'spawn' then extract(isodow from p_at at time zone 'America/Denver') = 4 and extract(hour from p_at at time zone 'America/Denver') = 15
    when 'nudge' then extract(isodow from p_at at time zone 'America/Denver') = 1 and extract(hour from p_at at time zone 'America/Denver') = 11
    when 'close' then extract(isodow from p_at at time zone 'America/Denver') = 1 and extract(hour from p_at at time zone 'America/Denver') = 17
    else false end;
$$;

-- The next MT weekday + hour after p_at (isodow 1 = Monday ... 4 = Thursday).
create or replace function public.hunt_next_mt(p_isodow int, p_hour int, p_at timestamptz default now())
returns timestamptz language plpgsql immutable set search_path to 'public' as $$
declare loc timestamp := p_at at time zone 'America/Denver'; v timestamp;
begin
  v := date_trunc('day', loc) + make_interval(days => ((p_isodow - extract(isodow from loc)::int) % 7 + 7) % 7, hours => p_hour);
  if (v at time zone 'America/Denver') <= p_at then v := v + interval '7 days'; end if;  -- add days on the local clock
  return v at time zone 'America/Denver';
end $$;

create or replace function public.next_hunt_spawn() returns timestamptz
language sql stable set search_path to 'public' as $$ select hunt_next_mt(4, 15, now()); $$;
create or replace function public.next_hunt_close() returns timestamptz
language sql stable set search_path to 'public' as $$ select hunt_next_mt(1, 17, now()); $$;

-- The cron entry point: acts only in its MT slot, and a spawn only once per week.
create or replace function public.weekly_boss_tick(p_kind text) returns jsonb
language plpgsql set search_path to 'public' as $$
begin
  if not hunt_mt_slot(p_kind, now()) then return jsonb_build_object('ok', true, 'note', 'not_this_hour'); end if;
  if p_kind = 'spawn' then
    if exists (select 1 from hunts where opens_at > now() - interval '6 hours') then
      return jsonb_build_object('ok', true, 'note', 'already_spawned'); end if;
    return spawn_weekly_boss();
  elsif p_kind = 'nudge' then return nudge_hunt();
  elsif p_kind = 'close' then return close_weekly_boss();
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $$;
revoke all on function public.weekly_boss_tick(text) from public, anon, authenticated;

-- The jobs: the old UTC ones go, the MT ones come (both possible UTC hours each).
select cron.unschedule(jobname) from cron.job where jobname in ('spawn-weekly-boss', 'nudge-weekly-boss', 'close-weekly-boss');
select cron.schedule('hunt-spawn-mt', '0 21,22 * * 4', $c$ select weekly_boss_tick('spawn'); $c$);
select cron.schedule('hunt-nudge-mt', '0 17,18 * * 1', $c$ select weekly_boss_tick('nudge'); $c$);
select cron.schedule('hunt-close-mt-mdt', '0 23 * * 1', $c$ select weekly_boss_tick('close'); $c$);  -- 5 PM MDT
select cron.schedule('hunt-close-mt-mst', '0 0 * * 2', $c$ select weekly_boss_tick('close'); $c$);   -- 5 PM MST (Tue 00:00 UTC)

notify pgrst, 'reload schema';
