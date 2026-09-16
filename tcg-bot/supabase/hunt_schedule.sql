-- Raid boss cadence (2026-09-15): a boss spawns Thursday and must be defeated by Monday
-- evening. If the community does not defeat it, it expires as a loss (consolation payout)
-- and NO boss spawns until the next Thursday. That gap is the cooldown, so a week can be
-- lost. Two scheduled events drive this (see hunt_cron.sql):
--   spawn_weekly_boss()  -> Thursday 21:00 UTC : snapshot + spawn, deadline = Monday close
--   close_weekly_boss()  -> Monday  23:00 UTC : settle + expire, no respawn (cooldown)
-- Times live here as ONE source of truth so the app countdown matches the cron exactly.

-- Next Thursday 21:00 UTC (the spawn moment). Strictly in the future.
create or replace function next_hunt_spawn()
returns timestamptz language plpgsql stable set search_path = public as $$
declare v timestamptz;
begin
  v := (date_trunc('day', now() at time zone 'UTC')
        + make_interval(days => ((4 - extract(isodow from now() at time zone 'UTC')::int) % 7 + 7) % 7)
        + interval '21 hours') at time zone 'UTC';
  if v <= now() then v := v + interval '7 days'; end if;
  return v;
end $$;

-- Next Monday 23:00 UTC (the deadline / close moment). Strictly in the future.
create or replace function next_hunt_close()
returns timestamptz language plpgsql stable set search_path = public as $$
declare v timestamptz;
begin
  v := (date_trunc('day', now() at time zone 'UTC')
        + make_interval(days => ((1 - extract(isodow from now() at time zone 'UTC')::int) % 7 + 7) % 7)
        + interval '23 hours') at time zone 'UTC';
  if v <= now() then v := v + interval '7 days'; end if;
  return v;
end $$;

-- Thursday: record the roster snapshot, spawn the boss, set its deadline to Monday close.
create or replace function spawn_weekly_boss()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_snap bigint; v_new bigint; v_close timestamptz;
begin
  v_snap  := roster_snapshot();       -- community power at spawn time
  v_new   := spawn_hunt(7);           -- spawn_hunt expires any stale active hunt first
  v_close := next_hunt_close();       -- Monday 23:00 UTC deadline
  update hunts set closes_at = v_close where id = v_new;
  return jsonb_build_object('ok', true, 'new', v_new, 'snapshot', v_snap, 'closes_at', v_close);
end $$;

-- Monday evening: close the active boss. If it was not defeated it expires as a loss with
-- a consolation payout. No respawn here — the cooldown runs until the next Thursday spawn.
create or replace function close_weekly_boss()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_old bigint; v_settle jsonb;
begin
  select id into v_old from hunts where status = 'active' order by id desc limit 1;
  if v_old is null then
    return jsonb_build_object('ok', true, 'note', 'no_active_hunt');  -- already defeated + settled
  end if;
  update hunts set status = 'expired' where id = v_old and status = 'active';
  v_settle := settle_hunt(v_old);
  return jsonb_build_object('ok', true, 'closed', v_old, 'settled', v_settle);
end $$;

notify pgrst, 'reload schema';
