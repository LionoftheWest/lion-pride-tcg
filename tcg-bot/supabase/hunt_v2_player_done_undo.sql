-- hunt_v2_player_done_undo.sql (2026-11-06): the undo of hunt_v2_player_done.sql (HUNT-V2-POSTS). It puts back the exact HBP text of
-- hunt_v2_live_credit (combat_v2_hunt_boons.sql, md5 2e2f2b28bf7309ed1053610593128c40) and its HBP comment, then drops hunt_v2_player_done.
-- After the undo a live v2 day end writes no player_done again (the defect). Events already written stay (the bot posted them).
-- Apply only when Nathan or the orchestrator wants the fix out. A second run changes nothing.
-- GUARD: the live hunt_v2_live_credit must be the text of hunt_v2_player_done.sql or the HBP text.

do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('a1f7b402daa9e35d8dcded191acaffa0', '2e2f2b28bf7309ed1053610593128c40') then
    raise exception 'hunt_v2_player_done_undo.sql: the live hunt_v2_live_credit is not the text of hunt_v2_player_done.sql (md5 %).', m;
  end if;
end $g$;
-- GUARD-END

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
  return s || jsonb_build_object('cards', c->'cards', 'boons', case when coalesce((s->>'written')::boolean, false) then c->'boons' else null end,
    'extras', case when coalesce((s->>'written')::boolean, false) then c->'extras' else '[]'::jsonb end);
end $fn$;

revoke all on function public.hunt_v2_live_credit(bigint, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.hunt_v2_live_credit(bigint, text, date, jsonb) to service_role;

comment on function public.hunt_v2_live_credit(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, HBP): the credit and the shared write of one call of a LIVE day (the row mark, never the flag): the waiting Hunt boons and pranks (FOR UPDATE SKIP LOCKED), hunt_v2_boon_plan, hunt_v2_shared, then the uses (only when written); a closed Hunt ends the day as hunt_over. combat_v2_hunt_boons.sql.$cm$;

drop function if exists public.hunt_v2_player_done(bigint, text, date);

notify pgrst, 'reload schema';
