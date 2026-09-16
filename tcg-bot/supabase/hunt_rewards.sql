-- Phase 2 rewards: pay packs when a hunt ends, and a weekly rollover to settle +
-- respawn. Idempotent via hunts.settled_at.

alter table hunts add column if not exists settled_at timestamptz;

-- Settle a finished hunt (defeated or expired): split a pack pool by contribution.
-- Pool = participants x 3 x tier_mult; consolation (expired) scales by HP-damaged
-- fraction x 0.5. Every participant gets at least 1 pack. Idempotent.
create or replace function settle_hunt(p_hunt bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_tier text; v_hpmax bigint; v_settled timestamptz;
  v_total bigint; v_participants int; v_defeated boolean; v_tiermult numeric;
  v_pool int; v_frac numeric; r record; v_packs int; v_paidtotal int := 0; v_paid jsonb := '[]'::jsonb;
begin
  select status, tier, hp_max, settled_at into v_status, v_tier, v_hpmax, v_settled
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_settled is not null then return jsonb_build_object('ok', false, 'error', 'already_settled'); end if;
  if v_status not in ('defeated', 'expired') then return jsonb_build_object('ok', false, 'error', 'not_ended'); end if;

  select coalesce(sum(damage), 0), count(distinct player_id) into v_total, v_participants
    from hunt_hits where hunt_id = p_hunt;
  if v_participants = 0 or v_total = 0 then
    update hunts set settled_at = now() where id = p_hunt;
    return jsonb_build_object('ok', true, 'participants', 0, 'total_packs', 0, 'paid', '[]'::jsonb);
  end if;

  v_defeated := (v_status = 'defeated');
  v_tiermult := case v_tier when 'Normal' then 1.0 when 'Heroic' then 1.5 else 2.5 end;
  if v_defeated then
    v_pool := round(v_participants * 3 * v_tiermult);
  else
    v_frac := least(1.0, v_total::numeric / nullif(v_hpmax, 0));
    v_pool := round(v_participants * 3 * v_tiermult * v_frac * 0.5);
  end if;

  for r in select player_id, sum(damage) dmg from hunt_hits where hunt_id = p_hunt group by player_id loop
    v_packs := greatest(1, round(v_pool * (r.dmg::numeric / v_total)));
    perform grant_packs(r.player_id, v_packs, 'hunt_reward', null);
    v_paidtotal := v_paidtotal + v_packs;
    v_paid := v_paid || jsonb_build_object('player_id', r.player_id, 'packs', v_packs);
  end loop;

  update hunts set settled_at = now() where id = p_hunt;
  return jsonb_build_object('ok', true, 'defeated', v_defeated, 'participants', v_participants,
    'total_packs', v_paidtotal, 'paid', v_paid);
end $$;

-- Weekly rollover: expire + settle the current active hunt (consolation payout if it
-- was not beaten), then spawn a fresh one. A defeated hunt is already settled inline,
-- so there is no active hunt then and this just respawns. Safe to call any time.
create or replace function weekly_hunt_rollover(p_days int default 3)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_old bigint; v_settle jsonb; v_new bigint;
begin
  select id into v_old from hunts where status = 'active' order by id desc limit 1;
  if v_old is not null then
    update hunts set status = 'expired' where id = v_old and status = 'active';
    v_settle := settle_hunt(v_old);
  end if;
  v_new := spawn_hunt(p_days);
  return jsonb_build_object('old', v_old, 'settled', v_settle, 'new', v_new);
end $$;

notify pgrst, 'reload schema';
