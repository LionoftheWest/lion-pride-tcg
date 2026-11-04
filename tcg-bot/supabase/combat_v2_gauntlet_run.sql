-- combat_v2_gauntlet_run.sql (2026-11-03): combat v2 step R1b, the v2 Gauntlet run for testers
-- (docs/combat-redesign-plan.md 20.15 "R1: Gauntlet v2 for testers", section R1b; Nathan's decisions D1-D7 and Q1-Q5).
-- Needs combat_v2_gauntlet_builders.sql (R1a: combat_v2_card_unit, gauntlet_v2_foes, combat_v2_step) and the combat v2 engine on main.
-- Before: gauntlet_start always builds a v1 run; no function plays a v2 run (room entry with meters, the carry, the offers, the run row).
-- After this file:
--   dungeon_runs.mode has a third value gauntlet_v2. The board, the prizes, gauntlet_view and the v1 action functions filter
--     mode = 'gauntlet' (or p_mode), so they never see a v2 run (D1). dungeon_settle ends a v2 run with 0 Shards and 0 cards (no bank, no pend).
--   gauntlet_start (replaced, rebuilt from the live text): a player for whom combat_v2_on('gauntlet', player) is true (a tester; the flag
--     combat_v2.gauntlet stays false) starts a gauntlet_v2 run when every squad card has a usable ability_v2; else (SQLSTATE no_data_found
--     of combat_v2_card_unit) the v1 run (D2). The count of today's runs and the "one active run" check read both modes (Q5). Every other
--     player gets the v1 run, byte for byte.
--   dailies_tasks (replaced): the Gauntlet daily task counts a gauntlet_v2 run too (D1).
--   combat_v2_step (replaced, the R1a text plus ONE change): each act and clock log entry has hp = the units whose hp, down or shield value
--     (Shielded on a card, Guarded on an enemy) changed in that entry, with before, after, down, shield_before, shield_after.
--   The v2 run functions (server only; R1c routes): gauntlet_v2_act (one card turn: the player's choice, D6), gauntlet_v2_auto (Auto v2 for
--     up to p_max card turns: Auto and Finish Room), gauntlet_v2_choose (offers, doors, the next floor), gauntlet_v2_retreat (at floor_done),
--     gauntlet_v2_view (runs left of both modes, the active mode, the last run, the floor map). Every answer has the screen fields
--     (need, squad_hp, order, targets, allies, status_lines) and the floor map (rooms, floors).
--   The room, fight, play, offer and screen helpers take a run state and a room (not a week read), so the Dungeon and Hunt v2 runs (R2, R3)
--     can call them; the door list and the offers follow state.mode (the shim of dungeon_enter / dungeon_offers).
-- NO CHANGE IN PLAY: the flag combat_v2 and the tester list do not change; with no tester nothing changes. Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-gauntlet-run.mjs (rolled back; MUTATE=all must catch every mutation).

-- GUARD (the runs_per_day.sql rule): each replaced function must be the live text this file was built from (or the text this file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.gauntlet_start(text)', 'a9223065ba351464603e3a656e18029f', 'NEW_GAUNTLET_START'),
    ('public.dailies_tasks(text)', '4fe738d217b6a115b373e6f4dca111c1', 'NEW_DAILIES_TASKS'),
    ('public.combat_v2_step(jsonb, jsonb, jsonb)', 'f5d524aae116f633820abffc89d957c6', 'NEW_COMBAT_V2_STEP')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_gauntlet_run.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the run mode gauntlet_v2 (a later file may add more modes: keep them)
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'dungeon_runs_mode_check' and conrelid = 'public.dungeon_runs'::regclass
                   and pg_get_constraintdef(oid) like '%gauntlet_v2%') then
    alter table public.dungeon_runs drop constraint if exists dungeon_runs_mode_check;
    alter table public.dungeon_runs add constraint dungeon_runs_mode_check check (mode in ('daily', 'gauntlet', 'gauntlet_v2'));
  end if;
end $c$;

-- ============================================================ 2. the HP changes of one log entry (combat_v2_step)
create or replace function public.gauntlet_v2_hp(p_before jsonb, p_after jsonb) returns jsonb
language sql immutable set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('side', q.side, 'id', q.id::numeric, 'before', q.b->'hp', 'after', q.a->'hp',
      'down', coalesce((q.a->>'down')::boolean, false), 'shield_before', q.sb, 'shield_after', q.sa) order by q.n), '[]'::jsonb)
  from (select x.side, x.id, x.n, u.b, u.a,
               coalesce((u.b->'status'->k.sk->>'value')::numeric, 0) as sb, coalesce((u.a->'status'->k.sk->>'value')::numeric, 0) as sa
          from combat_v2_units(p_after) x
          cross join lateral (select case when x.side = 'card' then 'shielded' else 'guarded' end as sk) k
          cross join lateral (select case when x.side = 'card' then p_before->'cards'->x.id else p_before->'enemies'->(x.id::int) end as b,
                                     case when x.side = 'card' then p_after->'cards'->x.id else p_after->'enemies'->(x.id::int) end as a) u) q
  where q.b->'hp' is distinct from q.a->'hp' or coalesce((q.b->>'down')::boolean, false) is distinct from coalesce((q.a->>'down')::boolean, false) or q.sb <> q.sa;
$fn$;

-- ============================================================ 3. combat_v2_step: the R1a text, plus hp on each act and clock log entry
create or replace function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); s jsonb := p_state; turn jsonb := p_state->'ext'->'turn';
  ckey text; cap int; bad text[]; r jsonb; a jsonb; ev text; log jsonb := '[]'::jsonb; n int := 0; k text; won boolean; s0 jsonb;
begin
  bad := fight_state_check_v2(p_state);
  if cardinality(bad) > 0 then raise exception 'combat_v2_step: the state is not a fight state v 2: %', array_to_string(bad, '; '); end if;
  ckey := case when p_state->>'mode' = 'hunt' then 'v2_hunt' else 'v2_dungeon' end;
  cap := (b->ckey->>'round_cap')::int;
  if cap is null then raise exception 'combat_v2_step: no balance value for %.round_cap', ckey; end if;
  if turn is not null then
    -- decision D6: the clock picked the card (ext.turn); the player picks basic or active, the target and the ally
    if jsonb_typeof(turn) is distinct from 'object' or turn->>'side' is distinct from 'card' then
      raise exception 'combat_v2_step: ext.turn must be the card that has the turn ({side: card, id})';
    end if;
    if jsonb_typeof(p_choice) is distinct from 'object' then raise exception 'combat_v2_step: card % has the turn: the choice {use, target, ally} is needed', turn->>'id'; end if;
    for k in select jsonb_object_keys(p_choice) loop
      if k not in ('use', 'target', 'ally') then raise exception 'combat_v2_step: the choice has only use, target and ally (not %)', k; end if;
    end loop;
    if jsonb_typeof(p_choice->'use') is distinct from 'boolean' then raise exception 'combat_v2_step: choice.use must be true (the active) or false (the basic attack)'; end if;
    s := s #- '{ext,turn}';
    a := combat_v2_card_act(s, turn, jsonb_build_object('use', p_choice->'use', 'target', p_choice->'target', 'ally', p_choice->'ally'), b);
    s0 := s; s := a->'state'; n := n + 1;
    log := log || jsonb_build_array(jsonb_build_object('k', 'act', 'actor', turn, 'action', a->'action', 'target', p_choice->'target', 'ally', p_choice->'ally',
      'hits', coalesce(a->'hits', '[]'::jsonb), 'hp', gauntlet_v2_hp(s0, s)));
  elsif p_choice is not null and p_choice <> 'null'::jsonb then
    raise exception 'combat_v2_step: no card has the turn (the start of a fight): the choice must be null';
  end if;
  -- the clock: every enemy turn and every skipped turn, until a card has the turn, the fight ends or the step cap
  loop
    s0 := s; r := combat_v2_next(s, null, b); s := r->'state'; ev := r->>'event';
    log := log || jsonb_build_array(jsonb_build_object('k', 'clock', 'clock', s->'clock', 'event', ev, 'actor', r->'actor', 'skip', coalesce(r->'skip', 'false'::jsonb),
      'reason', r->'reason', 'ticks', coalesce(r->'ticks', '[]'::jsonb), 'ended', coalesce(r->'ended', '[]'::jsonb), 'hp', gauntlet_v2_hp(s0, s)));
    exit when ev <> 'act';
    continue when coalesce((r->>'skip')::boolean, false);
    if r->'actor'->>'side' = 'card' then
      s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('turn', r->'actor'));
      ev := 'choose'; exit;
    end if;
    a := combat_v2_enemy_act(s, r->'actor', '{}'::jsonb, b);
    s0 := s; s := a->'state'; n := n + 1;
    log := log || jsonb_build_array(jsonb_build_object('k', 'act', 'actor', r->'actor', 'move', a->'move', 'hp', gauntlet_v2_hp(s0, s)));
  end loop;
  if ev = 'end' then
    won := not exists (select 1 from combat_v2_units(s) x where x.side = 'enemy' and combat_v2_up(s->'enemies'->x.id::int));
  end if;
  return jsonb_build_object('state', s, 'event', ev, 'actor', case when ev = 'choose' then s->'ext'->'turn' end, 'won', won,
    'clock', s->'clock', 'steps_left', greatest(0, cap - (s->>'clock')::int), 'actions', n, 'log', log);
end $fn$;

-- ============================================================ 4. dailies_tasks: the Gauntlet daily counts a gauntlet_v2 run (D1)
create or replace function public.dailies_tasks(p_player text) returns jsonb
language plpgsql stable set search_path = public as $function$
declare
  d date := (now() at time zone 'America/Denver')::date;
  t0 timestamptz := d::timestamp at time zone 'America/Denver';
  vneed int := balance_num('daily', 'voice_minutes')::int;
  hneed int := balance_num('daily', 'hunt_need')::int; -- one fight with the boss (an attack or a support play), not the 8-card daily cap
  msgs int; base boolean; bonus boolean; used int; mins int; social boolean; live boolean;
  prior int; ci boolean;
  dgon boolean; gaon boolean; dg boolean; ga boolean;   -- the Dungeon and the Gauntlet dailies (Nathan, 2026-10-03)
  claimed text[];
begin
  select message_count, base_claimed, bonus_claimed into msgs, base, bonus
    from daily_activity where player_id = p_player and activity_date = d;
  -- The player's own committed cards (an attack or a support play). Not hunt_hits: a Raid
  -- Crasher credit row there is raid damage only (trade_ledger_raid_credit.sql).
  select count(distinct card_id) into used from hunt_card_hp where player_id = p_player and hit_date = d;
  live := exists (select 1 from hunts where status = 'active' and opens_at <= now() and closes_at > now());
  select minutes into mins from voice_minutes where player_id = p_player and day = d;
  social := exists (select 1 from card_trades where created_at >= t0
                      and (from_id = p_player or to_id = p_player) and from_cards <> to_cards)
         or exists (select 1 from card_plays where player_id = p_player and kind = 'boon' and created_at >= t0
                      and aimed_at is not null and aimed_at <> p_player and outcome <> 'blocked');
  select coalesce(array_agg(task), '{}') into claimed from daily_claims where player_id = p_player and day = d;
  prior := checkin_streak(p_player, d);
  ci := 'checkin' = any(claimed);
  -- A run started today (the Denver day, the same as dungeon_day()) does the daily of its mode. Each daily shows
  -- only while its mode is on. A v2 Gauntlet run of a tester (mode gauntlet_v2, combat_v2_gauntlet_run.sql) does the Gauntlet daily (D1).
  dgon := coalesce((select (value->>'enabled')::boolean from settings where key = 'dungeon'), false);
  gaon := dgon and coalesce((select (value->>'enabled')::boolean from settings where key = 'gauntlet'), false);
  dg := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode = 'daily');
  ga := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode in ('gauntlet', 'gauntlet_v2'));
  return jsonb_build_array(
    jsonb_build_object('task', 'checkin', 'done', true, 'claimed', ci,
      'streak', prior + case when ci then 1 else 0 end,
      'reward', balance_num('daily', 'checkin')::int
        + case when prior % balance_num('daily', 'streak_cycle')::int + 1 in (select x::int from jsonb_array_elements_text(balance_get('daily')->'streak_days') x)
               then balance_num('daily', 'streak_bonus')::int else 0 end),
    jsonb_build_object('task', 'chat', 'auto', true, 'have', coalesce(msgs, 0), 'need', balance_num('daily', 'chat_bonus_at')::int,
      'packs', (select coalesce(sum(amount), 0) from pack_ledger where player_id = p_player and reason in ('earned_daily', 'earned_bonus') and created_at >= t0), 'max', (balance_num('daily', 'chat') + balance_num('daily', 'chat_bonus'))::int),
    jsonb_build_object('task', 'hunt', 'have', least(coalesce(used, 0), hneed), 'need', hneed, 'live', live,
      'done', coalesce(used, 0) >= hneed, 'claimed', 'hunt' = any(claimed), 'reward', balance_num('daily', 'tasks', 'hunt')::int),
    jsonb_build_object('task', 'voice', 'have', least(coalesce(mins, 0), vneed), 'need', vneed,
      'done', coalesce(mins, 0) >= vneed, 'claimed', 'voice' = any(claimed), 'reward', balance_num('daily', 'tasks', 'voice')::int),
    jsonb_build_object('task', 'social', 'have', case when social then 1 else 0 end, 'need', 1,
      'done', social, 'claimed', 'social' = any(claimed), 'reward', balance_num('daily', 'tasks', 'social')::int))
    || case when dgon then jsonb_build_array(jsonb_build_object('task', 'dungeon', 'have', case when dg then 1 else 0 end, 'need', 1,
         'done', dg, 'claimed', 'dungeon' = any(claimed), 'reward', balance_num('daily', 'tasks', 'dungeon')::int)) else '[]'::jsonb end
    || case when gaon then jsonb_build_array(jsonb_build_object('task', 'gauntlet', 'have', case when ga then 1 else 0 end, 'need', 1,
         'done', ga, 'claimed', 'gauntlet' = any(claimed), 'reward', balance_num('daily', 'tasks', 'gauntlet')::int)) else '[]'::jsonb end;
end $function$;

-- ============================================================ 5. the ally mark, the active names (snapshots of the run start)
create or replace function public.gauntlet_v2_needs_ally(p_blocks jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  -- the engine rule of combat_effect_v2_active: a single-ally block (shield, heal, empower, focus, cure; quicken without all) whose "to"
  -- is not most_hurt or strongest asks for opts.ally
  select coalesce(bool_or((x->>'k' in ('shield', 'heal', 'empower', 'focus', 'cure') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false)))
                          and coalesce(x->>'to', '') not in ('most_hurt', 'strongest')), false)
    from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) x;
$fn$;

create or replace function public.gauntlet_v2_info(p_units jsonb) returns jsonb
language sql stable set search_path = public as $fn$
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object(
      'name', (select s.ability_v2->>'name' from public.cards c join public.subjects s on s.id = c.subject_id where c.id = e.key::bigint),
      'role', e.value->'role', 'class', e.value->'class',
      'needs_ally', gauntlet_v2_needs_ally(e.value->'active'->'blocks'))), '{}'::jsonb)
    from jsonb_each(coalesce(p_units, '{}'::jsonb)) e;
$fn$;

-- ============================================================ 6. a fight room: the fight state at the room start (D5, D3)
create or replace function public.gauntlet_v2_fight(p_state jsonb, p_room jsonb, p_floor int, p_room_no int, p_b jsonb default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); act numeric := (b->'v2_speed'->>'act_at')::numeric;
  cards jsonb := '{}'::jsonb; en jsonb := '[]'::jsonb; fo jsonb; x text; u jsonb; cr jsonb; i int; s jsonb; up jsonb; ref jsonb;
begin
  if act is null then raise exception 'gauntlet_v2_fight: no balance value for v2_speed.act_at'; end if;
  -- the cards: the run unit + the carry (HP, down, charge, held carry; D5, Q1), no status, a new meter (cards in squad order, then the foes)
  for x in select jsonb_array_elements_text(p_state->'squad') loop
    u := p_state->'units'->x; cr := p_state->'carry'->x;
    cards := cards || jsonb_build_object(x, u || jsonb_build_object('hp', cr->'hp', 'max', cr->'max', 'down', cr->'down',
      'charge', cr->'charge', 'held', cr->'held', 'status', '{}'::jsonb, 'meter', round((random() * act)::numeric, 2)));
  end loop;
  -- the foes of the room (R1a); show gets the level and the kind of the week foe (display only)
  fo := gauntlet_v2_foes(p_room->'foes', p_floor, p_room_no, b);
  for i in 0 .. jsonb_array_length(fo) - 1 loop
    en := en || jsonb_build_array(fo->i || jsonb_build_object('meter', round((random() * act)::numeric, 2),
      'show', (fo->i->'show') || jsonb_build_object('level', p_room->'foes'->i->'level', 'kind', p_room->'foes'->i->'kind')));
  end loop;
  s := jsonb_build_object('v', '2'::jsonb, 'mode', p_state->>'mode', 'round', 0, 'clock', 0, 'squad', p_state->'squad', 'cards', cards, 'enemies', en,
    'marks', '{}'::jsonb, 'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
  -- the pending offers (D3, Q2, Q3): buff = Empowered on each standing attacker, ward = Shielded max HP x the amount on each standing card
  for x in select jsonb_array_elements_text(p_state->'squad') loop
    up := s->'cards'->x; ref := jsonb_build_object('side', 'card', 'id', x::numeric);
    continue when not combat_v2_up(up);
    if (p_state->>'empower') is not null and up->>'class' = 'attacker' then
      s := combat_v2_status_apply(s, ref, 'empowered', jsonb_build_object('value', (p_state->>'empower')::numeric), b)->'state';
    end if;
    if (p_state->>'ward') is not null then
      s := combat_v2_status_apply(s, ref, 'shielded', jsonb_build_object('value', round((up->>'max')::numeric * (p_state->>'ward')::numeric)), b)->'state';
    end if;
  end loop;
  return s;
end $fn$;

-- ============================================================ 7. after a step: the next card turn, or the end of the fight
create or replace function public.gauntlet_v2_after(p_state jsonb, p_r jsonb, p_floor int, p_floors_n int) returns jsonb
language plpgsql set search_path = public as $fn$
declare st jsonb := p_state || jsonb_build_object('steps_left', p_r->'steps_left'); f jsonb := p_r->'state'; won boolean;
begin
  if p_r->>'event' = 'choose' then
    return st || jsonb_build_object('phase', 'fight', 'fight', f, 'turn', p_r->'actor');
  end if;
  -- the end or the cap: the carry of each card (D5: HP and down; Q1: the charge and the held turns); statuses and meters end with the room
  st := (st - 'fight' - 'turn') || jsonb_build_object('last', jsonb_build_object('event', p_r->'event', 'won', p_r->'won'),
    'carry', (select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'max', c.value->'max', 'down', coalesce(c.value->'down', 'false'::jsonb),
               'charge', c.value->'charge', 'held', c.value->'held')) from jsonb_each(f->'cards') c));
  won := p_r->>'event' = 'end' and coalesce((p_r->>'won')::boolean, false);
  if won then
    if st->>'room_type' = 'guardian' then
      st := st || jsonb_build_object('phase', case when p_floor >= p_floors_n then 'cleared' else 'floor_done' end, 'offers', '[]'::jsonb);
    else
      -- the v1 offers of the mode (dungeon_offers on a shim state: the mode, the carry as cards, the last pick, the healed floor)
      st := st || jsonb_build_object('phase', 'choose', 'offers', dungeon_offers(jsonb_build_object('mode', st->>'mode', 'cards', st->'carry',
        'last_pick', st->'last_pick', 'heal_floor', st->'heal_floor'), p_floor));
    end if;
  else
    -- lost, or the step cap of the mode (the v1 round cap also ends the run as fell)
    st := st || jsonb_build_object('phase', 'fell', 'offers', '[]'::jsonb);
  end if;
  return st;
end $fn$;

-- ============================================================ 8. enter a room: {state, step}
create or replace function public.gauntlet_v2_enter(p_state jsonb, p_room jsonb, p_floor int, p_room_no int, p_floors_n int, p_b jsonb default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); t text := p_room->>'type'; st jsonb; f jsonb; r jsonb; x text; c jsonb;
begin
  st := (p_state - 'fight' - 'offers' - 'turn' - 'steps_left') || jsonb_build_object('room_type', t);
  if t in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then
    f := gauntlet_v2_fight(st, p_room, p_floor, p_room_no, b);
    st := st - 'empower' - 'ward';
    r := combat_v2_step(f, null, b);
    return jsonb_build_object('state', gauntlet_v2_after(st, r, p_floor, p_floors_n), 'step', r);
  elsif t = 'rest' then
    -- the v1 rest rule on the carry (balance dungeon rest_heal, rest_revive); a pending buff or ward waits for the next fight room (Q3)
    for x in select jsonb_object_keys(st->'carry') loop
      c := st->'carry'->x;
      if coalesce((c->>'down')::boolean, false) then
        c := c || jsonb_build_object('down', false, 'hp', greatest(1, round((c->>'max')::numeric * balance_num('dungeon', 'rest_revive'))));
      else
        c := c || jsonb_build_object('hp', least((c->>'max')::numeric, (c->>'hp')::numeric + round((c->>'max')::numeric * balance_num('dungeon', 'rest_heal'))));
      end if;
      st := jsonb_set(st, array['carry', x], c);
    end loop;
    st := st || jsonb_build_object('phase', 'rest', 'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  elsif t = 'choice' then
    -- the v1 doors of the mode and the v1 draw: dungeon_enter on a shim state, only its offers
    st := st || jsonb_build_object('phase', 'path', 'offers', dungeon_enter(jsonb_build_object('mode', st->>'mode', 'cards', '{}'::jsonb),
      jsonb_build_array(jsonb_build_array(jsonb_build_object('type', 'choice', 'foes', '[]'::jsonb))), 1, 1)->'offers');
  else
    -- another room type (the Gauntlet week has none): no loot, one continue
    st := st || jsonb_build_object('phase', 'pass', 'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  end if;
  return jsonb_build_object('state', st, 'step', null);
end $fn$;

-- ============================================================ 9. play card turns: one manual choice, or Auto v2 for up to p_max card turns
create or replace function public.gauntlet_v2_play(p_state jsonb, p_choice jsonb, p_max int, p_floor int, p_floors_n int) returns jsonb
language plpgsql set search_path = public as $fn$
declare b jsonb; f jsonb := p_state->'fight'; bad text[]; r jsonb; d jsonb; i int; log jsonb := '[]'::jsonb; au jsonb := '[]'::jsonb; played int;
begin
  -- outside every exception block: the numbers (a missing balance row is a real error) and the saved fight (bad_state, no write)
  b := combat_v2_enemy_numbers();
  bad := fight_state_check_v2(f);
  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'bad_state', 'detail', array_to_string(bad, '; ')); end if;
  if p_max is null then
    -- the player's choice (D6): only a raise of the step (P0001) is a bad choice
    begin
      r := combat_v2_step(f, p_choice, b);
    exception when raise_exception then
      return jsonb_build_object('ok', false, 'error', 'bad_choice', 'detail', sqlerrm);
    end;
    log := r->'log';
  else
    -- Auto v2 decides for the card that has the turn (ext.turn)
    for i in 1 .. p_max loop
      d := combat_v2_auto(f, f->'ext'->'turn', b, null);
      au := au || jsonb_build_array(jsonb_build_object('actor', f->'ext'->'turn', 'use', d->'use', 'why', d->'why'));
      r := combat_v2_step(f, jsonb_build_object('use', d->'use', 'target', d->'target', 'ally', d->'ally'), b);
      log := log || (r->'log'); f := r->'state';
      exit when r->>'event' <> 'choose';
    end loop;
  end if;
  played := (select count(*)::int from jsonb_array_elements(log) z where z->>'k' = 'act' and z->'actor'->>'side' = 'card');
  return jsonb_build_object('ok', true, 'state', gauntlet_v2_after(p_state, r, p_floor, p_floors_n), 'log', log, 'played', played, 'auto', au,
    'event', r->'event', 'won', r->'won', 'actor', r->'actor', 'steps_left', r->'steps_left');
end $fn$;

-- ============================================================ 10. an offer between rooms (D3, Q2-Q4)
create or replace function public.gauntlet_v2_pick(p_state jsonb, p_offer jsonb, p_floor int) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare st jsonb := p_state; k text := p_offer->>'kind'; amt numeric := (p_offer->>'amount')::numeric; x text; c jsonb; b jsonb;
begin
  if k = 'heal' then
    for x in select key from jsonb_each(st->'carry') where not coalesce((value->>'down')::boolean, false) loop
      c := st->'carry'->x;
      st := jsonb_set(st, array['carry', x, 'hp'], to_jsonb(least((c->>'max')::numeric, (c->>'hp')::numeric + round((c->>'max')::numeric * amt))));
    end loop;
    st := st || jsonb_build_object('heal_floor', p_floor);
  elsif k = 'revive' then
    for x in select key from jsonb_each(st->'carry') where coalesce((value->>'down')::boolean, false) loop
      c := st->'carry'->x;
      st := jsonb_set(st, array['carry', x], c || jsonb_build_object('down', false, 'hp', greatest(1, round((c->>'max')::numeric * amt))));
    end loop;
    st := st || jsonb_build_object('heal_floor', p_floor);
  elsif k = 'buff' then
    -- Q4: the higher amount stays (the Empowered rule); it waits for the next fight room (Q3)
    st := st || jsonb_build_object('empower', greatest(coalesce((st->>'empower')::numeric, 0), amt));
  elsif k = 'ward' then
    st := st || jsonb_build_object('ward', amt);
  elsif k = 'reset' then
    -- D3: reset fills every charge (v2_charge of the card's class, live)
    b := combat_v2_numbers(array['v2_charge']);
    for x in select jsonb_object_keys(st->'carry') loop
      st := jsonb_set(st, array['carry', x, 'charge'], to_jsonb((b->'v2_charge'->>(st->'units'->x->>'class'))::int));
    end loop;
  end if;
  if k <> 'continue' then st := st || jsonb_build_object('last_pick', k); end if;
  return st;
end $fn$;

-- ============================================================ 11. the floor map (the gauntlet_view mask rule)
create or replace function public.gauntlet_v2_rooms(p_floors jsonb, p_floor int, p_room int, p_run boolean) returns jsonb
language sql immutable set search_path = public as $fn$
  select jsonb_build_object('rooms', (select coalesce(jsonb_agg(jsonb_build_object(
      'type', case when rm.i < coalesce(p_room, 1) or (rm.i = coalesce(p_room, 1) and p_run) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
      'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i), '[]'::jsonb)
    from jsonb_array_elements(p_floors->(coalesce(p_floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(p_floors));
$fn$;

-- ============================================================ 12. the screen fields (from the engine state and the live balance; not stored)
create or replace function public.gauntlet_v2_amounts(p_key text, p_status jsonb, p_b jsonb) returns jsonb
language sql stable set search_path = public as $fn$
  -- one number for each {leaf} of the status rule text: a per-stack leaf x the stacks, a status with a value also gets the unit's value
  select coalesce((select jsonb_object_agg(l.leaf, case when p_key || '.' || l.leaf in ('poison.tick', 'chill.dmg', 'chill.spd', 'burn.tick_x')
                      then to_jsonb((p_b #>> (string_to_array(t.numbers, '.') || l.leaf))::numeric * coalesce((p_status->>'stacks')::numeric, 1))
                      else p_b #> (string_to_array(t.numbers, '.') || l.leaf) end)
                    from (select distinct m[1] as leaf from regexp_matches(t.rule, '\{([a-z_]+)\}', 'g') m) l), '{}'::jsonb)
         || case when p_status ? 'value' then jsonb_build_object('value', p_status->'value') else '{}'::jsonb end
    from public.statuses t where t.key = p_key;
$fn$;

create or replace function public.gauntlet_v2_screen(p_state jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := combat_v2_numbers(array['v2_charge', 'v2_status']); f jsonb := p_state->'fight'; n_order constant int := 10;
  need jsonb; hp jsonb; lst jsonb; e jsonb; seen text[] := '{}'; ord jsonb := '[]'::jsonb;
begin
  need := (select coalesce(jsonb_object_agg(k.key, (b->'v2_charge'->>(k.value->>'class'))::int), '{}'::jsonb) from jsonb_each(coalesce(p_state->'info', '{}'::jsonb)) k);
  hp := (select case when count(*) > 0 then jsonb_build_object('hp', sum((c.value->>'hp')::numeric), 'max', sum((c.value->>'max')::numeric)) end
           from jsonb_each(coalesce(case when f is not null then f->'cards' else p_state->'carry' end, '{}'::jsonb)) c);
  if p_state->>'phase' is distinct from 'fight' or f is null then
    return jsonb_build_object('need', need, 'squad_hp', hp, 'order', '[]'::jsonb, 'targets', '[]'::jsonb, 'allies', '[]'::jsonb, 'status_lines', '{}'::jsonb);
  end if;
  -- the turn strip: the card that has the turn, then the projection; ready only while no earlier non-skip entry of the same card
  lst := jsonb_build_array(f->'ext'->'turn') || combat_v2_turn_order(f, n_order - 1);
  for e in select v from jsonb_array_elements(lst) v loop
    if e->>'side' = 'card' then
      e := e || jsonb_build_object('ready', case when (e->>'id') = any(seen) then null
        else to_jsonb(coalesce((f->'cards'->(e->>'id')->>'charge')::int, 0) >= (b->'v2_charge'->>(f->'cards'->(e->>'id')->>'class'))::int) end);
      if e->>'skip' is null then seen := seen || (e->>'id'); end if;
    end if;
    ord := ord || jsonb_build_array(e);
  end loop;
  return jsonb_build_object('need', need, 'squad_hp', hp, 'order', ord,
    'targets', (select coalesce(jsonb_agg(x.id::int order by x.n), '[]'::jsonb) from combat_v2_units(f) x where x.side = 'enemy' and combat_v2_up(f->'enemies'->(x.id::int))),
    'allies', (select coalesce(jsonb_agg(x.id::numeric order by x.n), '[]'::jsonb) from combat_v2_units(f) x where x.side = 'card'),
    'status_lines', (select coalesce(jsonb_object_agg(q.k, q.lines), '{}'::jsonb) from (
       select x.side || ':' || x.id as k, jsonb_agg(jsonb_build_object('key', st.key, 'stacks', st.value->'stacks',
                'left', case when st.value ? 'until' then (st.value->>'until')::int - (f->>'clock')::int end,
                'amounts', gauntlet_v2_amounts(st.key, st.value, b)) order by st.key) as lines
         from combat_v2_units(f) x
         cross join lateral (select case when x.side = 'card' then f->'cards'->x.id else f->'enemies'->(x.id::int) end as u) uu
         cross join lateral jsonb_each(coalesce(uu.u->'status', '{}'::jsonb)) st
        group by x.side, x.id) q));
end $fn$;

-- ============================================================ 13. the answer of a run function
create or replace function public.gauntlet_v2_out(p_run bigint, p_extra jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_runs; fl jsonb;
begin
  select * into r from dungeon_runs where id = p_run;
  fl := (select floors from gauntlet_weeks where week = gauntlet_week(r.day));
  return jsonb_build_object('ok', true, 'run', r.id, 'state', r.state, 'floor', r.floor, 'room', r.room, 'status', r.status, 'ended_by', r.ended_by)
    || p_extra || gauntlet_v2_rooms(fl, r.floor, r.room, true) || gauntlet_v2_screen(r.state);
end $fn$;

-- the end of a run: fell and cleared settle (no bank, no pend: 0 Shards, 0 cards)
create or replace function public.gauntlet_v2_end(p_run bigint, p_phase text) returns void
language plpgsql set search_path = public as $fn$
declare v jsonb;
begin
  if p_phase in ('fell', 'cleared') then
    v := dungeon_settle(p_run, p_phase, p_phase = 'cleared');
    perform dungeon_log_add(p_run, jsonb_build_object('kind', 'end', 'how', p_phase), v);
  end if;
end $fn$;

-- ============================================================ 14. the start of a v2 run (the tester branch of gauntlet_start)
create or replace function public.gauntlet_v2_begin(p_player text, p_squad bigint[], p_units jsonb, p_attempt int) returns jsonb
language plpgsql set search_path = public as $fn$
declare v_day date := dungeon_day(); fl jsonb; v_carry jsonb; st jsonb; x jsonb; v_id bigint;
begin
  fl := (select floors from gauntlet_weeks where week = gauntlet_week(v_day));
  v_carry := (select jsonb_object_agg(e.key, jsonb_build_object('hp', e.value->'hp', 'max', e.value->'max', 'down', false,
                'charge', e.value->'charge', 'held', e.value->'held')) from jsonb_each(p_units) e);
  -- the run: engine 2, the units and the active names of the run start (D4: a later ability_v2 change does not touch this run)
  st := jsonb_build_object('engine', '2'::jsonb, 'mode', 'gauntlet', 'squad', to_jsonb(p_squad), 'units', p_units,
    'carry', v_carry, 'info', gauntlet_v2_info(p_units));
  x := gauntlet_v2_enter(st, fl->0->0, 1, 1, jsonb_array_length(fl), null);
  insert into dungeon_runs (player_id, day, squad, state, mode, attempt) values (p_player, v_day, p_squad, x->'state', 'gauntlet_v2', p_attempt) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'mode', 'gauntlet_v2', 'squad', to_jsonb(p_squad)),
    jsonb_build_object('event', x->'step'->'event', 'log', x->'step'->'log'));
  perform gauntlet_v2_end(v_id, x->'state'->>'phase');
  return gauntlet_v2_out(v_id, jsonb_build_object('engine', '2'::jsonb, 'event', x->'step'->'event', 'actor', x->'step'->'actor',
    'steps_left', x->'step'->'steps_left', 'log', coalesce(x->'step'->'log', '[]'::jsonb)));
end $fn$;

-- ============================================================ 15. gauntlet_start: the tester branch (rebuilt from the live text of runs_per_day.sql)
create or replace function public.gauntlet_start(p_player text) returns jsonb
language plpgsql set search_path = public as $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); w gauntlet_weeks; g jsonb; c jsonb; x bigint;
  v_cards jsonb := '{}'; v_hp int; v_sup boolean; st jsonb; v_id bigint; v_runs int; v_last int; v_active int; v_units jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  perform 1 from players where id = p_player for update;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  -- One run at a time; at most game_var('gauntlet_runs_per_day') runs a game day (balance gauntlet_runs_per_day, an event can raise it).
  -- The v1 and the v2 Gauntlet runs share the count: Q5, combat_v2_gauntlet_run.sql.
  select count(*), coalesce(max(attempt), 0), count(*) filter (where status = 'active') into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode in ('gauntlet', 'gauntlet_v2');
  if v_active > 0 or v_runs >= game_var('gauntlet_runs_per_day') then
    return jsonb_build_object('ok', false, 'error', 'already_gauntlet'); end if;
  w := gauntlet_generate(gauntlet_week(v_day));
  -- R1b: a tester plays the v2 run when every squad card has a v2 unit; a card with no usable ability_v2 gives no_data_found: the v1 run, D2
  if combat_v2_on('gauntlet', p_player) then
    begin
      v_units := '{}';
      foreach x in array w.squad loop
        v_units := v_units || jsonb_build_object(x::text, combat_v2_card_unit(x));
      end loop;
    exception when no_data_found then
      v_units := null;
    end;
    if v_units is not null then
      return gauntlet_v2_begin(p_player, w.squad, v_units, v_last + 1);
    end if;
  end if;
  foreach x in array w.squad loop
    c := dungeon_card_base(x);
    v_sup := c->>'type' not in ('Character', 'Creature');
    v_hp := case when v_sup then card_max_hp(0) else (c->'cmb'->>'hp')::int end;
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup));
  end loop;
  st := dungeon_enter(jsonb_build_object('mode', 'gauntlet', 'cards', v_cards, 'buff', 1, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
          'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb)), w.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state, mode, attempt) values (p_player, v_day, w.squad, st, 'gauntlet', v_last + 1) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'mode', 'gauntlet', 'squad', to_jsonb(w.squad)), '{}');
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $function$;

-- ============================================================ 16. the run functions (server only; R1c)
-- card turns: act (p_auto false: the player's choice) and auto (p_auto true: Auto v2 for up to p_max card turns)
create or replace function public.gauntlet_v2_turns(p_player text, p_choice jsonb, p_auto boolean, p_max int) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_runs; x jsonb;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then   -- disabled: act and auto
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- D4: the run of today plays to its end in v2; the tester list is not read here
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = 'gauntlet_v2' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;   -- no_run: act and auto
  if r.state->>'phase' is distinct from 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  if p_auto and (p_max is null or p_max < 1) then return jsonb_build_object('ok', false, 'error', 'bad_max'); end if;
  x := gauntlet_v2_play(r.state, case when p_auto then null else p_choice end, case when p_auto then p_max end, r.floor,
         jsonb_array_length((select floors from gauntlet_weeks where week = gauntlet_week(r.day))));
  if not (x->>'ok')::boolean then return x; end if;
  update dungeon_runs set state = x->'state', turns = turns + (x->>'played')::int where id = r.id;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', case when p_auto then 'auto' else 'act' end, 'choice', p_choice, 'max', p_max),
    jsonb_build_object('event', x->'event', 'won', x->'won', 'played', x->'played', 'log', x->'log'));
  perform gauntlet_v2_end(r.id, x->'state'->>'phase');
  return gauntlet_v2_out(r.id, jsonb_build_object('event', x->'event', 'won', x->'won', 'actor', x->'actor', 'steps_left', x->'steps_left',
    'played', x->'played', 'log', x->'log') || case when p_auto then jsonb_build_object('auto', x->'auto') else '{}'::jsonb end);
end $fn$;

create or replace function public.gauntlet_v2_act(p_player text, p_choice jsonb) returns jsonb
language sql set search_path = public as $fn$
  select gauntlet_v2_turns(p_player, p_choice, false, null);
$fn$;

create or replace function public.gauntlet_v2_auto(p_player text, p_max int default 1) returns jsonb
language sql set search_path = public as $fn$
  select gauntlet_v2_turns(p_player, null, true, p_max);
$fn$;

create or replace function public.gauntlet_v2_choose(p_player text, p_pick int) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_runs; st jsonb; fl jsonb; n int; o jsonb; x jsonb; v_to text; rk text; v_f int; v_r int;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then   -- disabled: choose
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = 'gauntlet_v2' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state; v_f := r.floor; v_r := r.room;
  fl := (select floors from gauntlet_weeks where week = gauntlet_week(r.day)); n := jsonb_array_length(fl);
  if st->>'phase' = 'floor_done' then
    -- the next floor, room 1
    v_f := r.floor + 1; v_r := 1; o := null;
    x := gauntlet_v2_enter(st, fl->(v_f - 1)->0, v_f, v_r, n, null);
  else
    if st->>'phase' is distinct from 'choose' and st->>'phase' is distinct from 'rest' and st->>'phase' is distinct from 'path' and st->>'phase' is distinct from 'pass' then
      return jsonb_build_object('ok', false, 'error', 'not_choosing'); end if;
    o := case when p_pick >= 0 then st->'offers'->p_pick end;
    if o is null then return jsonb_build_object('ok', false, 'error', 'bad_pick'); end if;
    if o->>'kind' = 'door' then
      -- a door turns this room into another room with the v1 door foes (the v1 room key door|run|floor|room)
      v_to := o->>'to';
      rk := 'door|' || r.id || '|' || r.floor || '|' || r.room;
      x := gauntlet_v2_enter(st, jsonb_build_object('type', v_to,
             'foes', case when v_to in ('elite', 'horde') then dungeon_room_foes(rk, r.floor, r.room, v_to) else '[]'::jsonb end), v_f, v_r, n, null);
    else
      st := gauntlet_v2_pick(st, o, r.floor);
      -- the next room of the floor (the guardian ends a floor through floor_done)
      v_r := least(r.room + 1, jsonb_array_length(fl->(r.floor - 1)));
      x := gauntlet_v2_enter(st, fl->(r.floor - 1)->(v_r - 1), v_f, v_r, n, null);
    end if;
  end if;
  update dungeon_runs set state = x->'state', floor = v_f, room = v_r where id = r.id;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', case when o is null then 'next_floor' else 'choose' end, 'pick', o),
    jsonb_build_object('floor', v_f, 'room', v_r, 'room_type', x->'state'->'room_type', 'event', x->'step'->'event', 'log', x->'step'->'log'));
  perform gauntlet_v2_end(r.id, x->'state'->>'phase');
  return gauntlet_v2_out(r.id, jsonb_build_object('picked', o)
    || case when x->'step' is not null and x->'step' <> 'null'::jsonb then jsonb_build_object('event', x->'step'->'event', 'won', x->'step'->'won',
         'actor', x->'step'->'actor', 'steps_left', x->'step'->'steps_left', 'played', 0, 'log', x->'step'->'log') else '{}'::jsonb end);
end $fn$;

create or replace function public.gauntlet_v2_retreat(p_player text) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_runs; v jsonb;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then   -- disabled: retreat
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = 'gauntlet_v2' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' is distinct from 'floor_done' then return jsonb_build_object('ok', false, 'error', 'not_between_floors'); end if;
  v := dungeon_settle(r.id, 'retreat', false);
  perform dungeon_log_add(r.id, '{"kind": "retreat"}', v);
  return jsonb_build_object('ok', true, 'floor', r.floor, 'room', r.room);
end $fn$;

create or replace function public.gauntlet_v2_view(p_player text) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare v_day date := dungeon_day(); w gauntlet_weeks; r dungeon_runs; v_n int; v_left int; v_active text; v_last jsonb;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then   -- disabled: view
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- the week (as gauntlet_view: a week with no row is made first); no run row is written
  w := gauntlet_generate(gauntlet_week(v_day));
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet_v2' order by attempt desc limit 1;
  -- INV-8: the runs of today in BOTH Gauntlet modes (Q5); the active run of either mode; the newest ended run of either mode
  v_n := (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode in ('gauntlet', 'gauntlet_v2'));
  v_left := greatest(0, game_var('gauntlet_runs_per_day')::int - v_n);
  v_active := (select a.mode from dungeon_runs a where a.player_id = p_player and a.day = v_day and a.status = 'active' and a.mode in ('gauntlet', 'gauntlet_v2') order by a.attempt desc limit 1);
  v_last := (select jsonb_build_object('id', e.id, 'mode', e.mode, 'attempt', e.attempt, 'ended_by', e.ended_by, 'floor', e.floor, 'room', e.room, 'turns', e.turns)
               from dungeon_runs e where e.player_id = p_player and e.day = v_day and e.status = 'over' and e.mode in ('gauntlet', 'gauntlet_v2') order by e.attempt desc, e.id desc limit 1);
  if r.status = 'over' and v_left > 0 then r := null; end if;
  return jsonb_build_object('ok', true, 'tester', combat_v2_on('gauntlet', p_player),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room,
             'turns', r.turns, 'attempt', r.attempt, 'state', r.state) end,
    'runs_left', v_left, 'last_run', v_last, 'active_mode', v_active, 'can_start', v_active is null and v_left > 0)
    || gauntlet_v2_rooms(w.floors, r.floor, r.room, r.id is not null) || gauntlet_v2_screen(coalesce(r.state, '{}'::jsonb));
end $fn$;

-- ============================================================ 17. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['gauntlet_v2_hp(jsonb, jsonb)', 'gauntlet_v2_needs_ally(jsonb)', 'gauntlet_v2_info(jsonb)',
      'gauntlet_v2_fight(jsonb, jsonb, integer, integer, jsonb)', 'gauntlet_v2_after(jsonb, jsonb, integer, integer)',
      'gauntlet_v2_enter(jsonb, jsonb, integer, integer, integer, jsonb)', 'gauntlet_v2_play(jsonb, jsonb, integer, integer, integer)',
      'gauntlet_v2_pick(jsonb, jsonb, integer)', 'gauntlet_v2_rooms(jsonb, integer, integer, boolean)', 'gauntlet_v2_amounts(text, jsonb, jsonb)',
      'gauntlet_v2_screen(jsonb)', 'gauntlet_v2_out(bigint, jsonb)', 'gauntlet_v2_end(bigint, text)', 'gauntlet_v2_begin(text, bigint[], jsonb, integer)',
      'gauntlet_v2_turns(text, jsonb, boolean, integer)', 'gauntlet_v2_act(text, jsonb)', 'gauntlet_v2_auto(text, integer)',
      'gauntlet_v2_choose(text, integer)', 'gauntlet_v2_retreat(text)', 'gauntlet_v2_view(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.gauntlet_v2_hp(jsonb, jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): the HP changes of one log entry of combat_v2_step: each unit whose hp, down or shield value (Shielded on a card, Guarded on an enemy) differs between the two states, in unit order, with before, after, down, shield_before, shield_after. Pure. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_needs_ally(jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): true when an active (its blocks) asks the player for an ally: a shield, heal, empower, focus or cure block, or quicken without all, whose to is not most_hurt or strongest (the engine rule of combat_effect_v2_active). A gated block may make it true when the engine does not use the ally (harmless). Pure. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_info(jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): the screen facts of the squad at the run start (a snapshot, D4): for each card the active name (subjects.ability_v2 name), the role, the class and needs_ally. Reads only. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_fight(jsonb, jsonb, integer, integer, jsonb) is $cm$[combat] Combat v2 runs (20.15 R1b; R2 and R3 reuse it): the fight state at the start of a fight room: each card = its run unit + its carry (HP, down, charge, held: D5, Q1), no status, a meter of 0 to v2_speed.act_at (2 decimals, cards in squad order then the foes); the foes of gauntlet_v2_foes with show level and kind; then the pending buff (Empowered on each standing attacker) and ward (Shielded max HP x the amount on each standing card). Draws random numbers. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_after(jsonb, jsonb, integer, integer) is $cm$[combat] Combat v2 runs (20.15 R1b): the run state after a combat_v2_step answer: the next card turn (phase fight), or the end of the fight: the carry of each card, then won: floor_done or cleared after a guardian, else choose with the v1 offers of the mode (dungeon_offers on a shim); lost or the step cap: fell. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_enter(jsonb, jsonb, integer, integer, integer, jsonb) is $cm$[combat] Combat v2 runs (20.15 R1b; R2 and R3 reuse it): enter one room of a v2 run: a fight room (gauntlet_v2_fight, then combat_v2_step to the first card turn), a rest room (the v1 rest numbers on the carry), a choice room (the v1 doors of the mode: dungeon_enter on a shim, only its offers) or another room (one continue). Returns {state, step}. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_play(jsonb, jsonb, integer, integer, integer) is $cm$[combat] Combat v2 runs (20.15 R1b): card turns of a v2 run state: the saved fight is checked first (bad_state, no write); then one manual choice (only a P0001 of the step is bad_choice) or Auto v2 (combat_v2_auto for ext.turn) for up to p_max card turns. Returns the new state, the log, the card turns played and the Auto decisions. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_pick(jsonb, jsonb, integer) is $cm$[combat] Combat v2 runs (20.15 R1b): one offer between rooms on the carry: heal and revive (the v1 numbers), buff (a pending Empowered, the higher amount stays: Q4, until the next fight room: Q3), ward (a pending Shielded: Q2), reset (every charge = v2_charge of the class: D3). Reads only. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_rooms(jsonb, integer, integer, boolean) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): the floor map of a run: rooms of the current floor with the gauntlet_view mask rule (a room shows its type when it is before the current room, the current room of a run, or the guardian; else unknown; the guardian name) and floors = the floor count. Pure. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_amounts(text, jsonb, jsonb) is $cm$[combat] Combat v2 (20.15 R1b): the numbers of the tap line of one status: one number for each {leaf} of its rule text (statuses): the per-stack leaves poison.tick, chill.dmg, chill.spd and burn.tick_x x the stacks, every other leaf from balance, and the unit's value when the status has one. Reads only. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_screen(jsonb) is $cm$[combat] Combat v2 runs (20.15 R1b): the screen fields of a run state, from the engine state and the live balance (not stored): need (v2_charge of each card's class), squad_hp, order (the card that has the turn, then combat_v2_turn_order 9; ready from the charge while no earlier non-skip entry of the same card), targets (the standing enemies), allies (every card of the fight), status_lines. Outside a fight the lists are empty. Reads only. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_out(bigint, jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): the answer of a v2 run function: the run row, the given fields, the floor map and the screen fields. Reads only. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_end(bigint, text) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): ends a v2 run at fell or cleared with dungeon_settle (no bank, no pend: 0 Shards, 0 cards) and a log row. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_begin(text, bigint[], jsonb, integer) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): the start of a v2 run for the tester branch of gauntlet_start: the run state (engine 2, units, carry, info), room 1 of floor 1, the row (mode gauntlet_v2, the next attempt of both modes) and the start log. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_turns(text, jsonb, boolean, integer) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b): the body of gauntlet_v2_act and gauntlet_v2_auto: disabled, the active gauntlet_v2 run of today (locked; the tester list is not read: D4), not_fighting, bad_max, then gauntlet_v2_play, the row (turns += the card turns played), the log and the end. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_act(text, jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b, server only, R1c route): one card turn of the player's v2 run: the choice {use, target, ally} for the card that has the turn (D6). Errors: disabled, no_run, not_fighting, bad_state (+ detail), bad_choice (+ detail = the engine text). combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_auto(text, integer) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b, server only, R1c route): Auto v2 for up to p_max card turns of the player's v2 run (Auto: 1; Finish Room: a large number); the answer has auto [{actor, use, why}]. Errors: disabled, no_run, not_fighting, bad_state, bad_max. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_choose(text, integer) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b, server only, R1c route): an offer, a door or continue between rooms, or the next floor at floor_done; then the next room (a fight room plays to its first card turn). Errors: disabled, no_run, not_choosing, bad_pick. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_retreat(text) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b, server only, R1c route): ends the v2 run at floor_done as retreat (0 loot). Errors: disabled, no_run, not_between_floors. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.gauntlet_v2_view(text) is $cm$[combat] Combat v2 Gauntlet (20.15 R1b, server only, R1c route): the v2 part of the Gauntlet screen of a player: tester, run (the newest gauntlet_v2 run of today; null when it is over and a run is left), runs_left and can_start of both modes (Q5, INV-8), last_run and active_mode of either mode, the floor map and the screen fields. Makes the week first (as gauntlet_view); writes no run row. combat_v2_gauntlet_run.sql.$cm$;
comment on function public.combat_v2_on(text) is $cm$[combat] The ONE reader of the combat v2 switch (balance combat_v2, plan 14.2): true only when combat_v2.<p_mode> is the JSON boolean true (p_mode = gauntlet, dungeon, hunt or progress). Fails closed: a missing key, another type, a name that is not one of the four capabilities or any error gives false. Its only caller is combat_v2_on(text, text). Since combat_v2_progress_freeze_v1.sql (M1d) four v1 functions read the switch through that form: spend_stat_points and reset_stat_points (they refuse when progress is ON), buy_shop_item (its stat reset is the v2 reset when progress is ON) and shop_today (its free reset counts the gifts of that reset). Since combat_v2_gauntlet_run.sql (R1b) a fifth: gauntlet_start (its tester branch starts a gauntlet_v2 run).$cm$;
comment on function public.combat_v2_on(text, text) is $cm$[combat] The combat v2 switch for one player (plan 14.2, the go-live steps): true when combat_v2_on(p_mode) is true (the mode is on for everyone), or when p_mode is gauntlet, dungeon, hunt or progress and p_player is in balance combat_v2.testers. The tester part fails closed: a NULL mode or player, an unknown capability, a value that does not match the fixed shape (balance_v2_spec), no row or any error gives false. Its readers: the v2 spend and reset (spend_card_points_v2, reset_card_points_v2) and, since combat_v2_progress_freeze_v1.sql (M1d), the v1 freeze of spend_stat_points and reset_stat_points, the Shop route of buy_shop_item (stat_reset) with progress, and the free reset of shop_today. Since combat_v2_gauntlet_run.sql (R1b), gauntlet_start: its tester branch starts a v2 Gauntlet run (gauntlet_v2) for a tester. combat_v2_testers.sql.$cm$;
comment on function public.combat_v2_step(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.3, 20.15 R1a): one call of a v2 fight. When a card has the turn (ext.turn), the choice {use, target, ally} plays its action (decision D6: the clock picks the card, the player picks basic or active, the target and the ally); then the clock runs every enemy turn and every skipped turn until the next card turn (event choose, the card in ext.turn), the end (event end, won) or the step cap of the mode (event cap: v2_dungeon.round_cap, v2_hunt.round_cap). The first call of a fight needs choice null. The client never drives an enemy turn. Refuses a state that fight_state_check_v2 refuses. Since combat_v2_gauntlet_run.sql (R1b) each act and clock log entry has hp (gauntlet_v2_hp: the units whose hp, down or shield changed, with before and after). Pure (state in, state out; draws random numbers). combat_v2_gauntlet_builders.sql.$cm$;

notify pgrst, 'reload schema';
