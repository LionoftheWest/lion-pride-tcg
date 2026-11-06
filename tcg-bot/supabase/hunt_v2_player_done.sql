-- hunt_v2_player_done.sql (2026-11-06): item HUNT-V2-POSTS, the per-member Hunt damage post for a LIVE Combat v2 Hunt day.
-- Needs R3-ON (combat_v2_on_hunt.sql) and HBP (combat_v2_hunt_boons.sql). SQL merge order: ... R3-ON -> HBP -> R3-ON-FIX -> this file.
-- Defect: the bot posts the daily damage summary of a member from hunt_events kind 'player_done' (tcg-bot/src/hunt-notify.ts:111).
--   Only v1 hunt_attack writes it (combat_v2_on_hunt.sql:714-725). No hunt_v2_* function writes it, so a live v2 day that ends posts
--   nothing (Hunt 148564: 4 live v2 days over, hunt_hits written, 0 player_done).
-- After this file:
--   hunt_v2_player_done(hunt, player, day) writes ONE player_done event when the day row is LIVE (hunt_v2_days.live, the mark; the flag is
--     not read), over, ended by cap, squad_down or boss_down (the member's day ended; hunt_over and abandoned do not post: v1 posts only
--     when the squad is down or at the round limit), the Hunt is not defeated (the v1 rule: the defeat post covers that call), and no
--     player_done of this member and day exists. The payload is the v1 payload (player_id, total, cards_used, top_card, top_damage,
--     boss_hp, boss_hp_max, from hunt_hits of the day and the hunts row) plus 'day' (the bot does not read it; it makes the once-check
--     exact for a later call). A v1 player_done of the same Denver day (no 'day' key) also counts as written.
--     It locks the day row FOR UPDATE first: the turn call already holds it; the backfill and a turn call serialize on it.
--   hunt_v2_live_credit (HBP text) calls it as its last step, so hunt_v2_start, hunt_v2_act and hunt_v2_auto post once at the day end, after
--     the credit of that call (the total includes the last hits). A practice day returns before (live false): no post.
--   Backfill (once, idempotent): the live days of TODAY (hunt_v2_today) of the open Hunt that ended before this file. An earlier day is not
--     posted (the post says "for today", and the bot picture reads hunt_hits of the event day).
-- Cost (DB-MEM): per call one primary-key read of the day row; only at a day end one hunt_events read by hunt_id (index) and two
--   hunt_hits reads by (hunt_id, player_id) (index). No new table, no new index.
-- The signature, volatility, search_path and grants of hunt_v2_live_credit are unchanged. Server only. Idempotent.
-- GUARD: the live hunt_v2_live_credit must be its HBP text or the text that this file made. Undo: hunt_v2_player_done_undo.sql.
-- Test: card-studio/scripts/test-hunt-v2-player-done.mjs (MUTATE=all: the baseline, then each mutation must FAIL, the baseline again).

do $g$
declare m text;
begin
  if to_regprocedure('public.hunt_v2_live_credit(bigint, text, date, jsonb)') is null then
    raise exception 'hunt_v2_player_done.sql: HBP (combat_v2_hunt_boons.sql) is not applied.';
  end if;
  select md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('2e2f2b28bf7309ed1053610593128c40', 'a1f7b402daa9e35d8dcded191acaffa0') then
    raise exception 'hunt_v2_player_done.sql: the live hunt_v2_live_credit changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

-- ============================================================ 1. the post of one live day end (once)
create or replace function public.hunt_v2_player_done(p_hunt bigint, p_player text, p_day date) returns boolean
language plpgsql set search_path = public as $fn$
declare r public.hunt_v2_days; h public.hunts; v_total bigint; v_used int; v_topcard text; v_topdmg bigint;
  v_from timestamptz := p_day::timestamp at time zone 'America/Denver';
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day for update;
  if not found or not r.live or r.status <> 'over' or coalesce(r.ended_by, '') not in ('cap', 'squad_down', 'boss_down') then return false; end if;
  select * into h from public.hunts where id = p_hunt;
  if not found or h.status = 'defeated' then return false; end if;
  if exists (select 1 from public.hunt_events e where e.hunt_id = p_hunt and e.kind = 'player_done' and e.payload->>'player_id' = p_player
               and (e.payload->>'day' = p_day::text
                    or (e.payload->>'day' is null and e.created_at >= v_from and e.created_at < v_from + interval '1 day'))) then
    return false;
  end if;
  -- the v1 payload (hunt_attack): the day totals of hunt_hits, the top card, the boss HP now
  select coalesce(sum(damage), 0), count(distinct card_id) into v_total, v_used
    from public.hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  select c.name, sub.d into v_topcard, v_topdmg
    from (select card_id, sum(damage) d from public.hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = p_day
          group by card_id order by d desc, card_id limit 1) sub join public.cards c on c.id = sub.card_id;
  insert into public.hunt_events (hunt_id, kind, payload)
    values (p_hunt, 'player_done', jsonb_build_object('player_id', p_player,
      'total', v_total, 'cards_used', v_used, 'top_card', v_topcard, 'top_damage', v_topdmg,
      'boss_hp', h.hp_remaining, 'boss_hp_max', h.hp_max, 'day', p_day));
  return true;
end $fn$;

-- ============================================================ 2. the credit of one live call (HBP text + the post as the last step)
create or replace function public.hunt_v2_live_credit(p_hunt bigint, p_player text, p_day date, p_log jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare r public.hunt_v2_days; c jsonb; s jsonb; v_max numeric; v_hpmax numeric; fx jsonb; u jsonb;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;
  v_max := (r.state->'fight'->'enemies'->0->>'max')::numeric;
  v_hpmax := (select hp_max from public.hunts where id = p_hunt);
  -- HBP: the waiting Hunt boons and pranks of the member, oldest first, locked BEFORE the boss lock with SKIP LOCKED (a call never waits on an
  -- effect row). A prankster with no players row or a card with no cards row is passed as missing, so the plan uses the fallback (review F-6).
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'primitive', e.primitive, 'amount', coalesce(e.amount, 0), 'created_at', e.created_at,
           'options', e.options
             - case when exists (select 1 from public.players p where p.id = coalesce(e.options->>'credit_to', e.options->>'sender_id')) then '{}'::text[] else array['credit_to', 'sender_id'] end
             - case when coalesce(e.options->>'card_id', '') ~ '^[0-9]{1,18}$' and exists (select 1 from public.cards k where k.id = (e.options->>'card_id')::bigint) then '{}'::text[] else array['card_id'] end)
           order by e.created_at, e.id), '[]'::jsonb) into fx
    from (select pe.* from public.player_effects pe
           where pe.player_id = p_player and pe.primitive in ('rally', 'butterfingers', 'launch_party', 'raid_crasher') and pe.consumed_at is null
             and (pe.starts_at is null or pe.starts_at <= now()) and (pe.expires_at is null or pe.expires_at > now())
           order by pe.created_at, pe.id for update skip locked) e;
  c := hunt_v2_boon_plan(p_log, to_jsonb(r.squad), v_hpmax / v_max, fx, coalesce(balance_num('combat', 'effect_cap_pct'), 100));
  -- a fallback extra goes to the member (the plan does not know the member)
  c := jsonb_set(c, '{extras}', (select coalesce(jsonb_agg(case when z->>'player' is null then z || jsonb_build_object('player', p_player) else z end), '[]'::jsonb)
                                   from jsonb_array_elements(c->'extras') z));
  s := hunt_v2_shared(p_hunt, p_player, p_day, c);
  if coalesce((s->>'over')::boolean, false) then
    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = coalesce(ended_at, now())
     where hunt_id = p_hunt and player_id = p_player and day = p_day and (status = 'active' or ended_by is distinct from 'hunt_over');
  end if;
  -- HBP: the uses, only in the transaction that wrote their credit (a closed Hunt, no credit: the boons wait)
  if coalesce((s->>'written')::boolean, false) then
    for u in select z from jsonb_array_elements(c->'uses') z loop
      if (u->>'left')::int <= 0 then
        update public.player_effects set consumed_at = now() where id = (u->>'id')::bigint;
      else
        update public.player_effects set options = options || jsonb_build_object('uses', (u->>'left')::int) where id = (u->>'id')::bigint;
      end if;
    end loop;
  end if;
  -- HUNT-V2-POSTS: the daily damage post when this call ended the live day (once; after the credit, so the total has the last hits)
  perform hunt_v2_player_done(p_hunt, p_player, p_day);
  return s || jsonb_build_object('cards', c->'cards', 'boons', case when coalesce((s->>'written')::boolean, false) then c->'boons' else null end,
    'extras', case when coalesce((s->>'written')::boolean, false) then c->'extras' else '[]'::jsonb end);
end $fn$;

-- ============================================================ 3. server only, and the comments of the generated docs
revoke all on function public.hunt_v2_player_done(bigint, text, date) from public, anon, authenticated;
grant execute on function public.hunt_v2_player_done(bigint, text, date) to service_role;
revoke all on function public.hunt_v2_live_credit(bigint, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.hunt_v2_live_credit(bigint, text, date, jsonb) to service_role;

comment on function public.hunt_v2_player_done(bigint, text, date) is $cm$[combat] Combat v2 Hunt (HUNT-V2-POSTS): the daily damage post of a member (hunt_events kind player_done, the v1 payload + day) when the day row is live (the mark), over, ended by cap, squad_down or boss_down, the Hunt is not defeated, and no player_done of this member and day exists (once). Locks the day row. Returns true when it wrote. hunt_v2_player_done.sql.$cm$;
comment on function public.hunt_v2_live_credit(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, HBP, HUNT-V2-POSTS): the credit and the shared write of one call of a LIVE day (the row mark, never the flag): the waiting Hunt boons and pranks (FOR UPDATE SKIP LOCKED), hunt_v2_boon_plan, hunt_v2_shared, then the uses (only when written); a closed Hunt ends the day as hunt_over; last, hunt_v2_player_done (the daily damage post once at the day end). hunt_v2_player_done.sql.$cm$;

-- ============================================================ 4. backfill (once): the live days of today of the open Hunt that ended before this file
do $bf$
declare d record; n int := 0;
begin
  for d in select v.hunt_id, v.player_id, v.day from public.hunt_v2_days v join public.hunts h on h.id = v.hunt_id
            where h.status = 'active' and now() < h.closes_at and v.day = hunt_v2_today() and v.live and v.status = 'over'
              and v.ended_by in ('cap', 'squad_down', 'boss_down')
            order by v.ended_at, v.player_id loop
    if hunt_v2_player_done(d.hunt_id, d.player_id, d.day) then n := n + 1; end if;
  end loop;
  raise notice 'hunt_v2_player_done.sql: backfill wrote % player_done event(s)', n;
end $bf$;
-- BACKFILL-END

notify pgrst, 'reload schema';
