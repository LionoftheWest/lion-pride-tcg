-- Hunt damage trace (build audit step 2, Nathan 2026-10-04). Each point of Hunt damage on the
-- leaderboard (hunt_hits) must trace to a source:
--   hunt_combat_log  one row per attack (hunt_attack)
--   hunt_adjustments one row per manual credit or cut (this table)
--   Smite            hunt_support writes hunt_hits for a support card, with no log row
--   Raid Crasher     hunt_attack writes a hunt_hits row for the prankster (their Raider card), no log row
-- hunt_damage_reconcile(hunt) shows the rest per player as "unexplained" (it must be 0).
-- This file does NOT change hunt_attack / hunt_support (combat_core.sql has an md5 guard on them).
-- Runs more than once with the same result.

-- 1. The card that an adjustment changed in hunt_hits (null = no single card: the change was spread
--    over the member's cards that day, or hunt_hits did not change).
alter table public.hunt_adjustments add column if not exists card_id bigint references public.cards(id);

-- raid_makeup_oct1.sql added each oct1_squad_bug credit to the member's top card that day
-- (order by damage desc). The credit made that card larger, so it is still the top card. Record it.
do $$
declare v_tie int; v_left int;
begin
  select count(*) into v_tie
    from public.hunt_adjustments a
   where a.reason = 'oct1_squad_bug' and a.card_id is null
     and (select count(*) from public.hunt_hits h
           where h.hunt_id = a.hunt_id and h.player_id = a.player_id and h.hit_date = a.hit_date
             and h.damage = (select max(h2.damage) from public.hunt_hits h2
                              where h2.hunt_id = a.hunt_id and h2.player_id = a.player_id and h2.hit_date = a.hit_date)) <> 1;
  if v_tie > 0 then
    raise exception 'hunt_damage_trace: % oct1_squad_bug rows have no single top card', v_tie;
  end if;
  update public.hunt_adjustments a
     set card_id = (select h.card_id from public.hunt_hits h
                     where h.hunt_id = a.hunt_id and h.player_id = a.player_id and h.hit_date = a.hit_date
                     order by h.damage desc limit 1)
   where a.reason = 'oct1_squad_bug' and a.card_id is null;
  select count(*) into v_left from public.hunt_adjustments where reason = 'oct1_squad_bug' and card_id is null;
  if v_left > 0 then
    raise exception 'hunt_damage_trace: % oct1_squad_bug rows still have no card', v_left;
  end if;
end $$;

-- 2. The heal-loop cut of 2026-10-02 (PR #121, "Data correction"): one member's 2026-10-02 damage
--    in hunt 101698 was cut to 18 % (13,325 -> 2,399) and the boss got 10,926 HP back. No row
--    recorded it. The member is found by the data: the only (player, day) on 2026-10-02 where
--    hunt_hits minus the logged attacks (day = the Mountain Time day of the log row, as hunt_attack
--    sets hit_date) is -10,926. hunt_hits is not changed (the cut is already in it).
do $$
declare v_n int; v_player text;
begin
  if not exists (select 1 from public.hunts where id = 101698) then
    raise notice 'hunt_damage_trace: hunt 101698 is not here, no cut row';
    return;
  end if;
  if exists (select 1 from public.hunt_adjustments
              where hunt_id = 101698 and hit_date = '2026-10-02' and reason = 'oct2_heal_loop_cut') then
    raise notice 'hunt_damage_trace: the oct2_heal_loop_cut row exists, skip';
    return;
  end if;
  with h as (
    select player_id, sum(damage) as d from public.hunt_hits
     where hunt_id = 101698 and hit_date = '2026-10-02' group by player_id
  ), l as (
    select player_id, sum(damage) as d from public.hunt_combat_log
     where hunt_id = 101698 and (ts at time zone 'America/Denver')::date = '2026-10-02' group by player_id
  ), m as (
    select coalesce(h.player_id, l.player_id) as player_id
      from h full join l on l.player_id = h.player_id
     where coalesce(h.d, 0) - coalesce(l.d, 0) = -10926
  )
  select count(*), min(player_id) into v_n, v_player from m;
  if v_n <> 1 then
    raise exception 'hunt_damage_trace: expected 1 member with the -10,926 cut on 2026-10-02, found %', v_n;
  end if;
  insert into public.hunt_adjustments (hunt_id, player_id, hit_date, damage, reason, card_id)
    values (101698, v_player, '2026-10-02', -10926, 'oct2_heal_loop_cut', null);
end $$;

-- 3. Only known reasons. Add a new reason here (and in its comment) before a new kind of adjustment.
alter table public.hunt_adjustments drop constraint if exists hunt_adjustments_reason_check;
alter table public.hunt_adjustments add constraint hunt_adjustments_reason_check
  check (reason in ('oct1_squad_bug', 'oct2_squad_reset', 'oct2_heal_loop_cut'));

comment on table public.hunt_adjustments is
  '[hunt] Manual changes to Hunt leaderboard damage (hunt_hits) that no attack made: make-up credit, cuts and markers. One row per (hunt, player, day, reason). hunt_damage_reconcile() uses it to trace each point of damage.';
comment on column public.hunt_adjustments.id is 'Row id.';
comment on column public.hunt_adjustments.hunt_id is 'The Hunt (hunts.id).';
comment on column public.hunt_adjustments.player_id is 'The member (players.id) whose damage changed.';
comment on column public.hunt_adjustments.hit_date is 'The Hunt day (hunt_hits.hit_date, the Mountain Time day) that changed.';
comment on column public.hunt_adjustments.damage is 'The change to hunt_hits damage: positive = credit added, negative = damage cut, 0 = a marker only.';
comment on column public.hunt_adjustments.reason is 'Why: oct1_squad_bug (Oct 1 squad bug make-up credit, raid_makeup_oct1.sql), oct2_squad_reset (marker: squad reset, 0 damage), oct2_heal_loop_cut (Oct 2 heal-loop cut to 18 %, PR #121). The check constraint lists the allowed values.';
comment on column public.hunt_adjustments.created_at is 'When the row was written.';
comment on column public.hunt_adjustments.card_id is 'The card whose hunt_hits row changed. Null = no single card (spread over the member''s cards that day, or a marker).';

-- 4. The reconcile: one row per player in the hunt. All damage numbers are sums over all days.
--    smite / crasher are clamped at 0 per card (these sources only add damage); a negative rest
--    stays in unexplained.
create or replace function public.hunt_damage_reconcile(p_hunt bigint)
returns table (player_id text, hits bigint, logged bigint, adjusted bigint, smite bigint, crasher bigint, unexplained bigint)
language sql stable security invoker set search_path = public as $$
  with h as (
    select hh.player_id, hh.card_id, sum(hh.damage)::bigint as d from hunt_hits hh where hh.hunt_id = p_hunt group by 1, 2
  ), l as (
    select cl.player_id, cl.card_id, sum(cl.damage)::bigint as d from hunt_combat_log cl where cl.hunt_id = p_hunt group by 1, 2
  ), a as (
    select ha.player_id, ha.card_id, sum(ha.damage)::bigint as d from hunt_adjustments ha where ha.hunt_id = p_hunt group by 1, 2
  ), keys as (
    select h.player_id, h.card_id from h union select l.player_id, l.card_id from l
    union select a.player_id, a.card_id from a where a.card_id is not null
  ), per_card as (
    select k.player_id, k.card_id,
           coalesce(h.d, 0) - coalesce(l.d, 0) - coalesce(a.d, 0) as rest,
           s.ability->>'effect' = 'smite' as is_smite,
           s.effect->>'primitive' = 'raid_crasher' as is_crasher
      from keys k
      left join h on h.player_id = k.player_id and h.card_id = k.card_id
      left join l on l.player_id = k.player_id and l.card_id = k.card_id
      left join a on a.player_id = k.player_id and a.card_id = k.card_id
      left join cards c on c.id = k.card_id
      left join subjects s on s.id = c.subject_id
  ), p as (
    select pc.player_id,
           coalesce(sum(greatest(0, pc.rest)) filter (where pc.is_smite), 0)::bigint as smite,
           coalesce(sum(greatest(0, pc.rest)) filter (where pc.is_crasher and not coalesce(pc.is_smite, false)), 0)::bigint as crasher
      from per_card pc group by pc.player_id
  ), players_in as (
    select player_id from h union select player_id from l union select player_id from a
  )
  select pi.player_id,
         coalesce((select sum(d) from h where h.player_id = pi.player_id), 0)::bigint,
         coalesce((select sum(d) from l where l.player_id = pi.player_id), 0)::bigint,
         coalesce((select sum(d) from a where a.player_id = pi.player_id), 0)::bigint,
         coalesce(p.smite, 0),
         coalesce(p.crasher, 0),
         (coalesce((select sum(d) from h where h.player_id = pi.player_id), 0)
          - coalesce((select sum(d) from l where l.player_id = pi.player_id), 0)
          - coalesce((select sum(d) from a where a.player_id = pi.player_id), 0)
          - coalesce(p.smite, 0) - coalesce(p.crasher, 0))::bigint
    from players_in pi left join p on p.player_id = pi.player_id
   order by 1
$$;

comment on function public.hunt_damage_reconcile(bigint) is
  '[hunt] Traces Hunt damage per player: hits (hunt_hits) = logged (hunt_combat_log) + adjusted (hunt_adjustments) + smite (Smite support-card damage, no log row) + crasher (Raid Crasher credit on the prankster''s Raider card, no log row) + unexplained. unexplained must be 0. smite / crasher = hits minus logs minus card adjustments on those cards, at least 0. Service role only.';

revoke execute on function public.hunt_damage_reconcile(bigint) from public, anon, authenticated;
grant execute on function public.hunt_damage_reconcile(bigint) to service_role;

notify pgrst, 'reload schema';
