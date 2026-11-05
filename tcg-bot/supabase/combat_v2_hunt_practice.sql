-- combat_v2_hunt_practice.sql (2026-11-04): combat v2 step R3a, the v2 Hunt practice for testers
-- (docs/combat-redesign-plan.md 20.20 "R3: Hunt v2 practice for testers"; pipeline item R3 SPEC v3; Nathan's decisions QH1-QH5, QT1).
-- Needs the combat v2 engine on main (combat_v2_step, combat_v2_hunt_boss, hunt_boss_v2_card, combat_v2_autopick), the R2a helpers
-- (combat_v2_dungeon_run.sql: dungeon_v2_unit, dungeon_v2_info, dungeon_v2_play, dungeon_v2_screen, dungeon_v2_hp) and SYN (combat_v2_synergy).
-- Merge order: R1b -> SYN -> R2a -> R3a.
-- Before: no function plays a Hunt day in v2. The live boss has ONE HP number (hunts.hp_remaining) on the v1 scale, so a tester cannot
--   fight the shared boss in v2 (R3 SPEC section 0).
-- After this file:
--   A NEW table hunt_v2_days holds one PRIVATE practice day for each Hunt, tester and Denver day (QH1, QH2): its own copy of the live boss
--     (the v2 template hunt_bosses_v2 of the same name, the live tier, the live HP fraction at the start). RLS on, no policy, service_role only.
--     hunt_id has NO foreign key to hunts (an insert must not take FOR KEY SHARE on the boss row).
--   hunt_v2_start: a tester (combat_v2_on('hunt', player); the flag combat_v2.hunt stays false) starts the practice day: the squad is the
--     auto-pick against the boss (QH4) or the player's own pick (up to hunt_card_cap() cards), the units have the player's stars, level 0 (QH3),
--     the synergy once, then the clock to the first card turn. 40 steps a day (balance v2_hunt.round_cap).
--   hunt_v2_act, hunt_v2_auto: card turns (dungeon_v2_play). hunt_v2_view: the screen. Server only (R3b routes).
--   NO SHARED WRITE (INV-2): no hunt_v2_ function writes any table but hunt_v2_days, and none locks the hunts row (it is read with no lock).
--   No reward, no XP, no board, no hunt_hits row: the practice damage stays in hunt_v2_days.
-- NO CHANGE IN PLAY: no v1 function, table, constraint or grant changes; the flag combat_v2 and the tester list do not change. Idempotent.
-- Test: card-studio/scripts/test-combat-v2-hunt-practice.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the table of the practice days (its own table: no v1 reader sees it)
create table if not exists public.hunt_v2_days (
  hunt_id bigint not null,
  player_id text not null references public.players(id) on delete cascade,
  day date not null,
  boss text not null,
  squad bigint[] not null,
  state jsonb not null,
  start_hp numeric not null,
  damage numeric not null default 0,
  steps int not null default 0,
  status text not null default 'active' check (status in ('active', 'over')),
  ended_by text check (ended_by in ('cap', 'squad_down', 'boss_down', 'hunt_over', 'abandoned')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (hunt_id, player_id, day)
);
alter table public.hunt_v2_days enable row level security;
revoke all on table public.hunt_v2_days from public, anon, authenticated;
grant all on table public.hunt_v2_days to service_role;
comment on table public.hunt_v2_days is $cm$[combat] Combat v2 Hunt practice days of testers (20.20 R3, QH1-QH2): one row per Hunt, tester and Denver day; a private v2 copy of the live boss (the v2 template of the same name, the live tier, the live HP fraction at the start). No reward, no board: the shared boss and hunt_hits never change. hunt_id has no foreign key to hunts (no lock on the boss row, INV-2). Only the hunt_v2_ functions read or write it. RLS on, no policy, service_role only. combat_v2_hunt_practice.sql.$cm$;
comment on column public.hunt_v2_days.hunt_id is $cm$The live Hunt (hunts.id) of the practice day. No foreign key: an insert must not lock the boss row (R3 SPEC M-1).$cm$;
comment on column public.hunt_v2_days.player_id is $cm$The tester (players.id) who plays the practice day.$cm$;
comment on column public.hunt_v2_days.day is $cm$The Denver day of the practice day ((now() at time zone 'America/Denver')::date, as hunt_attack). One practice day per Hunt, tester and day (QH2).$cm$;
comment on column public.hunt_v2_days.boss is $cm$The v2 boss key (hunt_bosses_v2.key) that hunt_v2_boss_key maps from the live Hunt name.$cm$;
comment on column public.hunt_v2_days.squad is $cm$The card ids (cards.id) of the squad in fight order: the auto-pick against the boss or the tester's own pick (QH4), at most hunt_card_cap().$cm$;
comment on column public.hunt_v2_days.state is $cm$The day state, engine 2: tier, squad, units, info, fight (the v2 fight state, mode hunt), last (the last call).$cm$;
comment on column public.hunt_v2_days.start_hp is $cm$The HP of the private boss copy at the start: the v2 boss max x the live hp_remaining / hp_max at the start (INV-4).$cm$;
comment on column public.hunt_v2_days.damage is $cm$The practice damage of the day in v2 units: start_hp minus the boss HP now. Not on the board, no reward.$cm$;
comment on column public.hunt_v2_days.steps is $cm$The fight clock (steps used of balance v2_hunt.round_cap).$cm$;
comment on column public.hunt_v2_days.status is $cm$active while the day plays, over when it ended.$cm$;
comment on column public.hunt_v2_days.ended_by is $cm$How the day ended: cap (the step cap), squad_down, boss_down, hunt_over (the Hunt closed) or abandoned (an active day of an earlier day, ended at the next start or view). Null while active.$cm$;
comment on column public.hunt_v2_days.started_at is $cm$When the practice day started.$cm$;
comment on column public.hunt_v2_days.ended_at is $cm$When the practice day ended. Null while active.$cm$;

-- ============================================================ 2. the boss map, the day, the old days
create or replace function public.hunt_v2_boss_key(p_name text) returns text
language sql stable set search_path = public as $fn$
  -- the one v2 boss whose name is the live name with or without a leading "The " (no match or two matches: null = no_v2_boss)
  select case when count(*) = 1 then min(x.key) end from public.hunt_bosses_v2 x
   where lower(x.name) = lower(regexp_replace(p_name, '^The ', '', 'i')) or lower(x.name) = lower(p_name);
$fn$;

create or replace function public.hunt_v2_today() returns date
language sql stable set search_path = public as $fn$
  -- the Hunt day of hunt_attack: the Denver date
  select (now() at time zone 'America/Denver')::date;
$fn$;

create or replace function public.hunt_v2_abandon(p_player text, p_day date) returns void
language sql set search_path = public as $fn$
  -- an active practice day of an earlier day ends (R3 SPEC L-4)
  update public.hunt_v2_days set status = 'over', ended_by = 'abandoned', ended_at = now()
   where player_id = p_player and status = 'active' and day < p_day;
$fn$;

-- ============================================================ 3. the end, the save and the answer of a practice day
create or replace function public.hunt_v2_end_of(p_event text, p_fight jsonb) returns text
language sql stable set search_path = public as $fn$
  -- choose: the day plays on; cap: the step cap; end: boss_down when the boss is down, else squad_down
  select case when p_event = 'choose' then null
              when p_event = 'cap' then 'cap'
              when not combat_v2_up(p_fight->'enemies'->0) then 'boss_down'
              else 'squad_down' end;
$fn$;

create or replace function public.hunt_v2_save(p_hunt bigint, p_player text, p_day date, p_fight jsonb, p_event text, p_last jsonb) returns void
language plpgsql set search_path = public as $fn$
declare e text := hunt_v2_end_of(p_event, p_fight);
begin
  -- damage = the start HP of the boss copy minus its HP now; steps = the fight clock
  update public.hunt_v2_days
     set state = (state || jsonb_build_object('fight', p_fight, 'last', p_last)),
         damage = start_hp - (p_fight->'enemies'->0->>'hp')::numeric,
         steps = coalesce((p_fight->>'clock')::int, 0),
         status = case when e is null then 'active' else 'over' end,
         ended_by = e,
         ended_at = case when e is null then null else now() end
   where hunt_id = p_hunt and player_id = p_player and day = p_day;
end $fn$;

create or replace function public.hunt_v2_day_json(r public.hunt_v2_days) returns jsonb
language sql stable set search_path = public as $fn$
  select case when r.hunt_id is null then null else jsonb_build_object('hunt_id', r.hunt_id, 'day', r.day, 'boss', r.boss, 'squad', to_jsonb(r.squad),
    'status', r.status, 'ended_by', r.ended_by, 'damage', r.damage, 'steps', r.steps, 'start_hp', r.start_hp,
    'started_at', r.started_at, 'ended_at', r.ended_at) end;
$fn$;

create or replace function public.hunt_v2_out(p_hunt bigint, p_player text, p_day date, p_extra jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare r public.hunt_v2_days;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  return jsonb_build_object('ok', true, 'engine', '2'::jsonb, 'practice', true, 'day', hunt_v2_day_json(r),
      'boss', hunt_boss_v2_card(r.boss, r.state->>'tier'), 'damage', r.damage, 'steps', r.steps, 'status', r.status, 'ended_by', r.ended_by,
      'fight', r.state->'fight', 'info', r.state->'info', 'units', r.state->'units')
    || p_extra || dungeon_v2_screen(r.state->'fight');
end $fn$;

-- ============================================================ 4. the start of a practice day (testers only)
create or replace function public.hunt_v2_start(p_player text, p_cards bigint[] default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_day date := hunt_v2_today(); h public.hunts; v_key text; b jsonb; v_cap int; act numeric; v_frac numeric; boss jsonb;
  pool jsonb := '[]'; v_ids bigint[]; bad bigint[] := '{}'; x bigint; rr record; cc jsonb; u jsonb;
  v_units jsonb := '{}'; v_info jsonb := '{}'; cards jsonb := '{}'; s jsonb; r jsonb;
begin
  if not combat_v2_on('hunt', p_player) then return jsonb_build_object('ok', false, 'error', 'not_tester'); end if;
  perform hunt_v2_abandon(p_player, v_day);
  -- the live Hunt, read with NO lock (INV-2: the boss row is never locked by a practice day)
  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  v_key := hunt_v2_boss_key(h.name);
  if v_key is null then return jsonb_build_object('ok', false, 'error', 'no_v2_boss', 'name', h.name); end if;
  if exists (select 1 from public.hunt_v2_days d where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day) then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;
  b := combat_v2_enemy_numbers();
  v_cap := hunt_card_cap();
  act := (b->'v2_speed'->>'act_at')::numeric;
  if act is null then raise exception 'hunt_v2_start: no balance value for v2_speed.act_at'; end if;
  -- INV-4: the v2 boss of the mapped key and the live tier, at the live HP fraction at the start
  v_frac := h.hp_remaining::numeric / h.hp_max;
  boss := combat_v2_hunt_boss(h.tier, v_key, jsonb_build_object('start_frac', v_frac, 'meter', round((random() * act)::numeric, 2)), b);
  if p_cards is null then
    -- QH4: the auto-pick (the Lab pickSql method) over the owned cards that have a v2 unit, with the boss mechanics and Weak to role
    for rr in select pc.card_id, c.rarity::text as rarity, s0.cp_mod, coalesce(pc.ascension, 0) as stars, s0.ability_v2 as a
                from public.player_cards pc join public.cards c on c.id = pc.card_id join public.subjects s0 on s0.id = c.subject_id
               where pc.player_id = p_player and pc.quantity > 0 order by pc.card_id loop
      continue when jsonb_typeof(rr.a) is distinct from 'object' or jsonb_typeof(rr.a->'role') is distinct from 'string'
        or jsonb_typeof(rr.a->'blocks') is distinct from 'array' or not exists (select 1 from public.roles y where y.key = rr.a->>'role');
      cc := card_combat_v2(rr.rarity, rr.stars, rr.cp_mod, 0, '{}'::jsonb, rr.a->>'role');
      pool := pool || jsonb_build_array(jsonb_build_object('id', rr.card_id, 'role', cc->>'role', 'class', cc->>'class', 'atk', cc->'stats'->'atk',
        'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'spd', cc->'stats'->'spd', 'blocks', rr.a->'blocks', 'pick_factor', rr.a->'pick_factor'));
    end loop;
    if jsonb_array_length(pool) = 0 then return jsonb_build_object('ok', false, 'error', 'squad_size', 'cap', v_cap); end if;
    v_ids := array(select (z #>> '{}')::bigint from jsonb_array_elements(combat_v2_autopick(pool,
               jsonb_build_object('mechanics', coalesce(boss->'mechanics', '[]'::jsonb), 'weak_role', boss->'weak_role'), v_cap, b, null)->'ids') z);
  else
    -- the player's own pick: 1 to hunt_card_cap() cards, no duplicate, each owned
    if coalesce(cardinality(p_cards), 0) = 0 or cardinality(p_cards) > v_cap or array_position(p_cards, null) is not null
       or (select count(distinct y) from unnest(p_cards) y) <> cardinality(p_cards) then
      return jsonb_build_object('ok', false, 'error', 'squad_size', 'cap', v_cap);
    end if;
    foreach x in array p_cards loop
      if not exists (select 1 from public.player_cards pc where pc.player_id = p_player and pc.card_id = x and pc.quantity > 0) then
        return jsonb_build_object('ok', false, 'error', 'not_owned', 'card', x);
      end if;
    end loop;
    v_ids := p_cards;
  end if;
  -- the units (R2a dungeon_v2_unit: the player's stars, level 0, QH3; the tags of SYN) and the screen facts; no usable ability_v2 = no_v2
  foreach x in array v_ids loop
    begin
      u := dungeon_v2_unit(p_player, x);
      v_units := v_units || jsonb_build_object(x::text, u);
      v_info := v_info || jsonb_build_object(x::text, dungeon_v2_info(x));
    exception when no_data_found then
      bad := bad || x;
    end;
  end loop;
  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'no_v2', 'cards', to_jsonb(bad)); end if;
  -- the fight: the cards in squad order with a new meter (as R2), the boss copy; mode hunt (the cap is v2_hunt.round_cap)
  foreach x in array v_ids loop
    cards := cards || jsonb_build_object(x::text, (v_units->(x::text)) || jsonb_build_object('meter', round((random() * act)::numeric, 2)));
  end loop;
  s := jsonb_build_object('v', '2'::jsonb, 'mode', 'hunt', 'round', 0, 'clock', 0, 'squad', to_jsonb(v_ids), 'cards', cards, 'enemies', jsonb_build_array(boss),
    'marks', '{}'::jsonb, 'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
  -- SYN: the synergy of the squad once, before the first step (act and auto never call it again)
  s := combat_v2_synergy(s, b);
  r := combat_v2_step(s, null, b);
  begin
    insert into public.hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp)
    values (h.id, p_player, v_day, v_key, v_ids,
            jsonb_build_object('engine', '2'::jsonb, 'tier', h.tier, 'squad', to_jsonb(v_ids), 'units', v_units, 'info', v_info, 'fight', r->'state'),
            (boss->>'hp')::numeric);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already');
  end;
  perform hunt_v2_save(h.id, p_player, v_day, r->'state', r->>'event', jsonb_build_object('kind', 'start', 'event', r->'event', 'won', r->'won', 'log', r->'log'));
  return hunt_v2_out(h.id, p_player, v_day, jsonb_build_object('event', r->'event', 'won', r->'won', 'actor', r->'actor', 'steps_left', r->'steps_left',
    'played', 0, 'log', coalesce(r->'log', '[]'::jsonb), 'hp_changes', dungeon_v2_hp(s, r->'state')));
end $fn$;

-- ============================================================ 5. card turns (server only; R3b routes)
create or replace function public.hunt_v2_turns(p_player text, p_choice jsonb, p_auto boolean, p_max int) returns jsonb
language plpgsql set search_path = public as $fn$
declare r public.hunt_v2_days; h public.hunts; x jsonb;
begin
  -- the practice day of today, locked (this row only); the tester list is not read here (D4)
  select * into r from public.hunt_v2_days d where d.player_id = p_player and d.day = hunt_v2_today() order by d.started_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_day'); end if;
  if r.status = 'over' then return jsonb_build_object('ok', false, 'error', 'not_fighting', 'ended_by', r.ended_by); end if;
  -- the Hunt of the day, read with NO lock (INV-2); a closed Hunt ends the day with no fight call
  select * into h from public.hunts where id = r.hunt_id;
  if not found or h.status <> 'active' or now() >= h.closes_at then
    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = now()
     where hunt_id = r.hunt_id and player_id = r.player_id and day = r.day;
    return jsonb_build_object('ok', false, 'error', 'hunt_over');
  end if;
  x := dungeon_v2_play(r.state->'fight', case when p_auto then null else coalesce(p_choice, 'null'::jsonb) end, case when p_auto then p_max else 1 end, null);
  if not (x->>'ok')::boolean then return x; end if;
  perform hunt_v2_save(r.hunt_id, r.player_id, r.day, x->'fight', x->>'event',
    jsonb_build_object('kind', case when p_auto then 'auto' else 'act' end, 'event', x->'event', 'won', x->'won', 'log', x->'log'));
  return hunt_v2_out(r.hunt_id, r.player_id, r.day, jsonb_build_object('event', x->'event', 'won', x->'won', 'actor', x->'actor', 'steps_left', x->'steps_left',
    'played', x->'played', 'log', x->'log', 'hp_changes', x->'hp_changes') || case when p_auto then jsonb_build_object('auto', x->'auto') else '{}'::jsonb end);
end $fn$;

create or replace function public.hunt_v2_act(p_player text, p_choice jsonb) returns jsonb
language sql set search_path = public as $fn$
  select hunt_v2_turns(p_player, p_choice, false, null);
$fn$;

create or replace function public.hunt_v2_auto(p_player text, p_max int default 1) returns jsonb
language sql set search_path = public as $fn$
  select hunt_v2_turns(p_player, null, true, p_max);
$fn$;

-- ============================================================ 6. the screen of the practice (server only; R3b route)
create or replace function public.hunt_v2_view(p_player text) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare v_day date := hunt_v2_today(); v_tester boolean := combat_v2_on('hunt', p_player); h public.hunts; v_has boolean; v_key text; r public.hunt_v2_days; o jsonb;
begin
  perform hunt_v2_abandon(p_player, v_day);
  -- the live Hunt, read with NO lock
  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1;
  v_has := found;
  if v_has then v_key := hunt_v2_boss_key(h.name); end if;
  -- the practice day of today (of the live Hunt when there is one)
  select * into r from public.hunt_v2_days d where d.player_id = p_player and d.day = v_day and (not v_has or d.hunt_id = h.id) order by d.started_at desc limit 1;
  o := jsonb_build_object('ok', true, 'tester', v_tester, 'practice', true,
    'hunt', case when v_has then jsonb_build_object('id', h.id, 'name', h.name, 'tier', h.tier, 'closes_at', h.closes_at,
              'live_frac', h.hp_remaining::numeric / h.hp_max) end,
    'boss', case when v_key is not null then hunt_boss_v2_card(v_key, h.tier) end,
    'day', hunt_v2_day_json(r),
    'can_start', v_tester and v_has and v_key is not null
                 and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day));
  if r.status = 'active' then
    return hunt_v2_out(r.hunt_id, r.player_id, r.day, '{}'::jsonb) || o;
  end if;
  return o;
end $fn$;

-- ============================================================ 7. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['hunt_v2_boss_key(text)', 'hunt_v2_today()', 'hunt_v2_abandon(text, date)', 'hunt_v2_end_of(text, jsonb)',
      'hunt_v2_save(bigint, text, date, jsonb, text, jsonb)', 'hunt_v2_day_json(public.hunt_v2_days)', 'hunt_v2_out(bigint, text, date, jsonb)',
      'hunt_v2_start(text, bigint[])', 'hunt_v2_turns(text, jsonb, boolean, integer)', 'hunt_v2_act(text, jsonb)', 'hunt_v2_auto(text, integer)',
      'hunt_v2_view(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.hunt_v2_boss_key(text) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): the v2 boss key (hunt_bosses_v2.key) of a live Hunt name: the one boss whose name is the live name with or without a leading "The " (case-insensitive); no match or more than one: null (no_v2_boss). Reads only. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_today() is $cm$[combat] Combat v2 Hunt practice (20.20 R3): the Denver day of a practice day, the day rule of hunt_attack. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_abandon(text, date) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): ends every active practice day of the player of an earlier day as abandoned (R3 SPEC L-4); hunt_v2_start and hunt_v2_view call it. Writes only hunt_v2_days. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_end_of(text, jsonb) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): how a step answer ends a practice day: choose = null (it plays on), cap = cap, end = boss_down when the boss is down, else squad_down. Reads only. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_save(bigint, text, date, jsonb, text, jsonb) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): saves a fight state on the practice day: damage = start_hp minus the boss HP now, steps = the fight clock, the end (hunt_v2_end_of) and last. Writes only hunt_v2_days. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_day_json(public.hunt_v2_days) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): the screen fields of a practice day row (hunt_id, day, boss, squad, status, ended_by, damage, steps, start_hp, started_at, ended_at); null for no row. Pure. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_out(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): the answer of a practice function: the day, the boss card (hunt_boss_v2_card), damage, steps, status, the fight, info, units, practice true, the given fields and the screen fields of dungeon_v2_screen. Reads only. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_start(text, bigint[]) is $cm$[combat] Combat v2 Hunt practice (20.20 R3, server only, R3b route): starts the private v2 practice day of a tester (combat_v2_on hunt): not_tester, the old active days end (abandoned), no_hunt (the live Hunt, read with no lock), no_v2_boss, already (one day per Hunt, tester and Denver day, QH2); the squad = the auto-pick against the boss (null, QH4) or the own pick (squad_size, not_owned), no_v2 + cards; the boss copy at the live HP fraction (INV-4), the units with the player's stars (QH3), the synergy once, the clock to the first card turn. Writes only hunt_v2_days. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_turns(text, jsonb, boolean, integer) is $cm$[combat] Combat v2 Hunt practice (20.20 R3): the body of hunt_v2_act and hunt_v2_auto: the practice day of today (locked: this row only; the tester list is not read), no_day, not_fighting, hunt_over (the Hunt closed: the day ends, no fight call), then dungeon_v2_play and the save. The hunts row is read with no lock. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_act(text, jsonb) is $cm$[combat] Combat v2 Hunt practice (20.20 R3, server only, R3b route): one card turn of the practice day: the choice {use, target, ally} for the card that has the turn (D6). Errors: no_day, not_fighting, hunt_over, bad_state (+ detail), bad_choice (+ detail). combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_auto(text, integer) is $cm$[combat] Combat v2 Hunt practice (20.20 R3, server only, R3b route): Auto v2 for up to p_max card turns of the practice day; the answer has auto [{actor, use, why}]. Errors: no_day, not_fighting, hunt_over, bad_state, bad_max. combat_v2_hunt_practice.sql.$cm$;
comment on function public.hunt_v2_view(text) is $cm$[combat] Combat v2 Hunt practice (20.20 R3, server only, R3b route): the practice part of the Hunt screen: tester, hunt (id, name, tier, closes_at, live_frac = the shared v1 boss bar, read only) or null, the boss card, today's day row, can_start (tester, a live Hunt whose boss maps, no day of this Hunt today), and the screen fields while a day is active. Ends old active days (abandoned). combat_v2_hunt_practice.sql.$cm$;

notify pgrst, 'reload schema';
