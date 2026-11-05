-- combat_v2_hunt_boons_undo.sql (2026-11-05): the undo of combat_v2_hunt_boons.sql (item HBP). It puts back the exact R3-ON texts of
-- hunt_v2_shared, hunt_v2_live_credit and hunt_v2_turns (combat_v2_on_hunt.sql; the file checks the 3 md5s) and drops hunt_v2_boon_plan.
-- After the undo a v2 Hunt day reads no boon or prank again (the waiting rows stay waiting; the rows that HBP used stay used).
-- Apply only when Nathan or the orchestrator wants the boons out of the v2 Hunt. A second run changes nothing.

do $g$
begin
  if to_regprocedure('public.hunt_v2_shared(bigint, text, date, jsonb)') is null then
    raise exception 'combat_v2_hunt_boons_undo.sql: R3-ON (combat_v2_on_hunt.sql) is not applied.';
  end if;
end $g$;

-- ============================================================ 3. the shared write of a live call (H-1, M-A)
create or replace function public.hunt_v2_shared(p_hunt bigint, p_player text, p_day date, p_credit jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare v_status text; v_closes timestamptz; v_tier text; v_hp bigint; v_total bigint := coalesce((p_credit->>'total')::bigint, 0); c record; v_settle jsonb;
begin
  if v_total <= 0 then return jsonb_build_object('written', false, 'total', 0); end if;
  -- (1) the boss row FOR NO KEY UPDATE: it serializes with a v1 FOR UPDATE and with other shared writes; it does not block a bridge-row
  -- FK check (FOR KEY SHARE)
  select status, closes_at, tier into v_status, v_closes, v_tier from public.hunts where id = p_hunt for no key update;
  -- (2) a closed or defeated Hunt: no shared write; the caller ends the day as hunt_over
  if not found or v_status <> 'active' or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;
  -- (3) the v1 hit rule per credited card, the boss HP (it stops at 0; hunt_hits gets the full credit: the v1 clamp), the log rows
  for c in select key::bigint as card, value::bigint as dmg from jsonb_each_text(p_credit->'cards') where value::bigint > 0 loop
    insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, c.card, p_day, c.dmg)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
  end loop;
  update public.hunts set hp_remaining = greatest(0, hp_remaining - v_total),
      status = case when hp_remaining - v_total <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_total <= 0 then now() else defeated_at end
    where id = p_hunt returning hp_remaining, status into v_hp, v_status;
  for c in select key::bigint as card, value::bigint as dmg from jsonb_each_text(p_credit->'cards') where value::bigint > 0 loop
    insert into public.hunt_combat_log (hunt_id, player_id, card_id, outcome, damage, boss_hp_after) values (p_hunt, p_player, c.card, 'hit', c.dmg, v_hp);
  end loop;
  update public.hunt_v2_days set credited = credited + v_total where hunt_id = p_hunt and player_id = p_player and day = p_day;
  -- (4) only the call that moved the boss active -> defeated settles it once and writes the defeat event (the v1 text)
  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into public.hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from public.hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from public.hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;
  return jsonb_build_object('written', true, 'total', v_total, 'hp_after', v_hp, 'defeated', v_status = 'defeated');
end $fn$;


-- the credit and the shared write of one live call; a closed Hunt ends the day hunt_over (no shared write)
create or replace function public.hunt_v2_live_credit(p_hunt bigint, p_player text, p_day date, p_log jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare r public.hunt_v2_days; c jsonb; s jsonb; v_max numeric; v_hpmax numeric;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;
  v_max := (r.state->'fight'->'enemies'->0->>'max')::numeric;
  v_hpmax := (select hp_max from public.hunts where id = p_hunt);
  c := hunt_v2_credit(p_log, to_jsonb(r.squad), v_hpmax / v_max);
  s := hunt_v2_shared(p_hunt, p_player, p_day, c);
  if coalesce((s->>'over')::boolean, false) then
    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = coalesce(ended_at, now())
     where hunt_id = p_hunt and player_id = p_player and day = p_day and (status = 'active' or ended_by is distinct from 'hunt_over');
  end if;
  return s || jsonb_build_object('cards', c->'cards');
end $fn$;

-- ============================================================ 6. card turns (the mark, never the flag: a live day credits to its end)
create or replace function public.hunt_v2_turns(p_player text, p_choice jsonb, p_auto boolean, p_max int) returns jsonb
language plpgsql set search_path = public as $fn$
declare r public.hunt_v2_days; h public.hunts; x jsonb; sh jsonb;
begin
  select * into r from public.hunt_v2_days d where d.player_id = p_player and d.day = hunt_v2_today() order by d.started_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_day'); end if;
  if r.status = 'over' then return jsonb_build_object('ok', false, 'error', 'not_fighting', 'ended_by', r.ended_by); end if;
  -- the Hunt of the day, read with NO lock; a closed Hunt ends the day (a practice against an ended Hunt plays on)
  select * into h from public.hunts where id = r.hunt_id;
  if not found or (not coalesce((r.state->>'practice_ended')::boolean, false) and (h.status <> 'active' or now() >= h.closes_at)) then
    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = now()
     where hunt_id = r.hunt_id and player_id = r.player_id and day = r.day;
    return jsonb_build_object('ok', false, 'error', 'hunt_over');
  end if;
  x := dungeon_v2_play(r.state->'fight', case when p_auto then null else coalesce(p_choice, 'null'::jsonb) end, case when p_auto then p_max else 1 end, null);
  if not (x->>'ok')::boolean then return x; end if;
  perform hunt_v2_save(r.hunt_id, r.player_id, r.day, x->'fight', x->>'event',
    jsonb_build_object('kind', case when p_auto then 'auto' else 'act' end, 'event', x->'event', 'won', x->'won', 'log', x->'log'));
  -- the shared write of a LIVE day (the row mark; the flag is not read: a day keeps crediting after a rollback, HO9)
  sh := hunt_v2_live_credit(r.hunt_id, r.player_id, r.day, x->'log');
  return hunt_v2_out(r.hunt_id, r.player_id, r.day, jsonb_build_object('event', x->'event', 'won', x->'won', 'actor', x->'actor', 'steps_left', x->'steps_left',
    'played', x->'played', 'log', x->'log', 'hp_changes', x->'hp_changes', 'credit', sh) || case when p_auto then jsonb_build_object('auto', x->'auto') else '{}'::jsonb end);
end $fn$;

drop function if exists public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric);

-- server only, the R3-ON comments, and the check: the 3 functions are the R3-ON texts again
do $g$
declare f text; m text; x record;
begin
  foreach f in array array['hunt_v2_shared(bigint, text, date, jsonb)', 'hunt_v2_live_credit(bigint, text, date, jsonb)', 'hunt_v2_turns(text, jsonb, boolean, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  for x in select * from (values
    ('public.hunt_v2_turns(text, jsonb, boolean, integer)', '32480034440a93d10fc5b671aba81d65'),
    ('public.hunt_v2_shared(bigint, text, date, jsonb)', '7633f3120651daf0a9094e43d08df801'),
    ('public.hunt_v2_live_credit(bigint, text, date, jsonb)', '187f166bf4d3e559924ca105dbaf62b1')
  ) v(fn, md5) loop
    select md5(replace(pg_get_functiondef(x.fn::regprocedure), chr(13), '')) into strict m;
    if m <> x.md5 then raise exception 'combat_v2_hunt_boons_undo.sql: % is not the R3-ON text after the undo (%).', x.fn, m; end if;
  end loop;
  if to_regprocedure('public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric)') is not null then
    raise exception 'combat_v2_hunt_boons_undo.sql: hunt_v2_boon_plan is still there.';
  end if;
end $g$;

comment on function public.hunt_v2_shared(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON): the shared write of a live call with a credit: hunts FOR NO KEY UPDATE, the status and the close time again (closed: no write, over), then hunt_hits per card (the v1 rule), the boss HP (stops at 0), one hunt_combat_log row per credited card, credited; only the call that defeats the boss settles it (settle_hunt) and writes the defeat event. combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_live_credit(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON): the credit and the shared write of one call of a LIVE day (the row mark, never the flag); a closed Hunt ends the day as hunt_over. combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_turns(text, jsonb, boolean, integer) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON): the body of hunt_v2_act and hunt_v2_auto: the day of today (locked), no_day, not_fighting, hunt_over (a practice against an ended Hunt plays on), dungeon_v2_play, the save, then the credit of a LIVE day (the mark). combat_v2_on_hunt.sql.$cm$;

notify pgrst, 'reload schema';
