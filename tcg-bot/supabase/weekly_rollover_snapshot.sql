-- Wire roster_snapshot into the weekly rollover (2026-09-15): record the community
-- roster power at the exact moment each boss spawns, so roster_power_history holds the
-- growth curve automatically. Only weekly_hunt_rollover changes.

create or replace function weekly_hunt_rollover(p_days int default 3)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_old bigint; v_settle jsonb; v_new bigint; v_snap bigint;
begin
  select id into v_old from hunts where status = 'active' order by id desc limit 1;
  if v_old is not null then
    update hunts set status = 'expired' where id = v_old and status = 'active';
    v_settle := settle_hunt(v_old);
  end if;
  v_snap := roster_snapshot();      -- record community power for this spawn
  v_new := spawn_hunt(p_days);
  return jsonb_build_object('old', v_old, 'settled', v_settle, 'new', v_new, 'snapshot', v_snap);
end $$;

notify pgrst, 'reload schema';
