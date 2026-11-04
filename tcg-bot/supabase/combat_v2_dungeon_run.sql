-- combat_v2_dungeon_run.sql (2026-11-03): combat v2 step R2a, the v2 Dungeon run for testers
-- (docs/combat-redesign-plan.md 20.18 "R2: Dungeon v2 for testers"; pipeline item R2 SPEC v3; Nathan's decisions QD1-QD5).
-- Needs the combat v2 engine on main (R1a: combat_v2_card_unit, gauntlet_v2_foes, combat_v2_step, combat_v2_auto) and SYN
-- (combat_v2_synergy; SYN also adds the card tags to combat_v2_card_unit and the foe element to gauntlet_v2_foes).
-- Before: no function plays a Dungeon run in v2. dungeon_start builds a v1 card map.
-- After this file:
--   A NEW table dungeon_v2_runs holds the v2 Dungeon runs of testers (RLS on, no policy, service_role only). No v1 function, table,
--     constraint or grant changes: the 38 readers of dungeon_runs, Admin, the bot and the feed never see a v2 Dungeon run (INV-3).
--   dungeon_v2_start: a tester (combat_v2_on('dungeon', player); the flag combat_v2.dungeon stays false) starts an EXTRA daily run (QD2)
--     with the same squad checks as dungeon_start, the same codes and keys; a card with no usable ability_v2 refuses the start (no_v2, QD4).
--   The card unit (dungeon_v2_unit) = combat_v2_card_unit with the star-dependent stats of the player's stars (QD3: level 0, no points).
--   The run plays the R1b rules (copied, no R1b function is called): HP, down, charge and held carry; statuses and meters reset; the offers
--     heal, revive, buff, ward, reset; the doors; rest; an empty treasure room. 0 loot (QD1): no Shards, no cards, no bank, no pend, no XP.
--   The run functions (server only; R2b routes): dungeon_v2_act, dungeon_v2_auto, dungeon_v2_choose, dungeon_v2_retreat, dungeon_v2_view.
--   The helpers for R3 (fixed signatures): dungeon_v2_unit, dungeon_v2_info, dungeon_v2_play, dungeon_v2_screen; and dungeon_v2_room.
-- NO CHANGE IN PLAY: the flag combat_v2 and the tester list do not change; with no tester nothing changes. Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-dungeon-run.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the table of the v2 Dungeon runs (its own table: no v1 reader sees it)
create table if not exists public.dungeon_v2_runs (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  day date not null,
  squad bigint[] not null,
  state jsonb not null,
  floor int not null default 1,
  room int not null default 1,
  turns int not null default 0,
  status text not null default 'active' check (status in ('active', 'over')),
  ended_by text check (ended_by in ('cleared', 'fell', 'retreat', 'abandoned')),
  attempt smallint not null default 1,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (player_id, day, attempt)
);
alter table public.dungeon_v2_runs enable row level security;
revoke all on table public.dungeon_v2_runs from public, anon, authenticated;
grant all on table public.dungeon_v2_runs to service_role;
comment on table public.dungeon_v2_runs is $cm$[combat] Combat v2 Dungeon runs of testers (20.18 R2): one row per run (attempt of the day), the run state (engine 2: units, info, carry, the fight, the offers; never bank or pend: 0 loot, QD1), status active or over, ended_by. Only the dungeon_v2_ functions read or write it; no v1 reader of dungeon_runs sees it (INV-3). RLS on, no policy, service_role only. combat_v2_dungeon_run.sql.$cm$;

-- ============================================================ 2. the card unit and the screen facts of a card
create or replace function public.dungeon_v2_unit(p_player text, p_card bigint, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']));
  u jsonb; r record; cc jsonb;
begin
  -- the R1a unit (after SYN it carries tags); a card with no usable ability_v2 raises no_data_found here (D2, QD4)
  u := combat_v2_card_unit(p_card, b);
  select c.rarity::text as rarity, s.cp_mod, coalesce(pc.ascension, 0) as stars into r
    from public.cards c join public.subjects s on s.id = c.subject_id
    left join public.player_cards pc on pc.card_id = c.id and pc.player_id = p_player
   where c.id = p_card;
  -- QD3: the player's stars count, level 0, no points (M1e adds them later); only the star-dependent stat keys change
  cc := card_combat_v2(r.rarity, r.stars, r.cp_mod, 0, '{}'::jsonb, u->>'role', b);
  return u || jsonb_build_object('atk', cc->'stats'->'atk', 'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'abl', cc->'stats'->'abl',
    'acc', cc->'stats'->'acc', 'def', cc->'stats'->'def', 'ddg', cc->'stats'->'ddg', 'max', cc->'stats'->'hp', 'hp', cc->'stats'->'hp',
    'spd', coalesce(cc->'points'->'spd', '0'::jsonb), 'power', cc->'power', 'extra_stack', cc->'extra_stack');
end $fn$;

create or replace function public.dungeon_v2_needs_ally(p_blocks jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  -- the engine rule of combat_effect_v2_active (R1b 3.2 item 3): a single-ally block (shield, heal, empower, focus, cure; quicken without
  -- all) whose "to" is not most_hurt or strongest asks for opts.ally
  select coalesce(bool_or((x->>'k' in ('shield', 'heal', 'empower', 'focus', 'cure') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false)))
                          and coalesce(x->>'to', '') not in ('most_hurt', 'strongest')), false)
    from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) x;
$fn$;

create or replace function public.dungeon_v2_info(p_card bigint) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare u jsonb := combat_v2_card_unit(p_card);
begin
  return jsonb_build_object('name', (select s.ability_v2->>'name' from public.cards c join public.subjects s on s.id = c.subject_id where c.id = p_card),
    'role', u->'role', 'class', u->'class', 'needs_ally', dungeon_v2_needs_ally(u->'active'->'blocks'));
end $fn$;

-- ============================================================ 3. the HP changes between two fight states (the screen log fallback)
create or replace function public.dungeon_v2_hp(p_before jsonb, p_after jsonb) returns jsonb
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

-- ============================================================ 4. card turns on a fight state (no table: R3 calls it for the Hunt too)
create or replace function public.dungeon_v2_play(p_fight jsonb, p_choice jsonb, p_max int, p_b jsonb default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare b jsonb; f jsonb := p_fight; bad text[]; r jsonb; d jsonb; i int; log jsonb := '[]'::jsonb; au jsonb := '[]'::jsonb; played int;
begin
  -- outside every exception block: the numbers (a missing balance row is a real error) and the fight (bad_state)
  b := coalesce(p_b, combat_v2_enemy_numbers());
  bad := fight_state_check_v2(f);
  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'bad_state', 'detail', array_to_string(bad, '; ')); end if;
  if p_choice is not null then
    -- the player's choice (D6): only a raise of the step (P0001) is a bad choice
    begin
      r := combat_v2_step(f, p_choice, b);
    exception when raise_exception then
      return jsonb_build_object('ok', false, 'error', 'bad_choice', 'detail', sqlerrm);
    end;
    log := r->'log';
  else
    if p_max is null or p_max < 1 then return jsonb_build_object('ok', false, 'error', 'bad_max'); end if;
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
  -- steps_left: the answer of the LAST step call (its own cap key: v2_hunt for mode hunt, else v2_dungeon)
  return jsonb_build_object('ok', true, 'fight', r->'state', 'event', r->'event', 'won', r->'won', 'actor', r->'actor', 'steps_left', r->'steps_left',
    'played', played, 'log', log, 'auto', au, 'hp_changes', dungeon_v2_hp(p_fight, r->'state'));
end $fn$;

-- ============================================================ 5. the screen fields of a fight (from the engine state and the live balance)
create or replace function public.dungeon_v2_amounts(p_key text, p_status jsonb, p_b jsonb) returns jsonb
language sql stable set search_path = public as $fn$
  -- one number for each {leaf} of the status rule text: a per-stack leaf x the stacks, a status with a value also gets the unit's value
  select coalesce((select jsonb_object_agg(l.leaf, case when p_key || '.' || l.leaf in ('poison.tick', 'chill.dmg', 'chill.spd', 'burn.tick_x')
                      then to_jsonb((p_b #>> (string_to_array(t.numbers, '.') || l.leaf))::numeric * coalesce((p_status->>'stacks')::numeric, 1))
                      else p_b #> (string_to_array(t.numbers, '.') || l.leaf) end)
                    from (select distinct m[1] as leaf from regexp_matches(t.rule, '\{([a-z_]+)\}', 'g') m) l), '{}'::jsonb)
         || case when p_status ? 'value' then jsonb_build_object('value', p_status->'value') else '{}'::jsonb end
    from public.statuses t where t.key = p_key;
$fn$;

create or replace function public.dungeon_v2_screen(p_fight jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_numbers(array['v2_charge', 'v2_status'])); f jsonb := p_fight; n_order constant int := 10;
  lst jsonb; e jsonb; seen text[] := '{}'; ord jsonb := '[]'::jsonb;
begin
  if f is null or jsonb_typeof(f) is distinct from 'object' then
    return jsonb_build_object('need', '{}'::jsonb, 'squad_hp', '{}'::jsonb, 'order', '[]'::jsonb, 'targets', '[]'::jsonb, 'allies', '[]'::jsonb, 'status_lines', '{}'::jsonb);
  end if;
  -- the turn strip: the card that has the turn, then the projection; ready only while no earlier non-skip entry of the same card
  lst := case when f->'ext'->'turn' is not null then jsonb_build_array(f->'ext'->'turn') else '[]'::jsonb end
         || combat_v2_turn_order(f, n_order - jsonb_array_length(case when f->'ext'->'turn' is not null then jsonb_build_array(f->'ext'->'turn') else '[]'::jsonb end));
  for e in select v from jsonb_array_elements(lst) v loop
    if e->>'side' = 'card' then
      e := e || jsonb_build_object('ready', case when (e->>'id') = any(seen) then null
        else to_jsonb(coalesce((f->'cards'->(e->>'id')->>'charge')::int, 0) >= (b->'v2_charge'->>(f->'cards'->(e->>'id')->>'class'))::int) end);
      if e->>'skip' is null then seen := seen || (e->>'id'); end if;
    end if;
    ord := ord || jsonb_build_array(e);
  end loop;
  return jsonb_build_object(
    'need', (select coalesce(jsonb_object_agg(c.key, (b->'v2_charge'->>(c.value->>'class'))::int), '{}'::jsonb) from jsonb_each(f->'cards') c),
    'squad_hp', (select jsonb_build_object('hp', coalesce(sum((c.value->>'hp')::numeric), 0), 'max', coalesce(sum((c.value->>'max')::numeric), 0)) from jsonb_each(f->'cards') c),
    'order', ord,
    'targets', (select coalesce(jsonb_agg(x.id::int order by x.n), '[]'::jsonb) from combat_v2_units(f) x where x.side = 'enemy' and combat_v2_up(f->'enemies'->(x.id::int))),
    'allies', (select coalesce(jsonb_agg(x.id::numeric order by x.n), '[]'::jsonb) from combat_v2_units(f) x where x.side = 'card'),
    'status_lines', (select coalesce(jsonb_object_agg(q.k, q.lines), '{}'::jsonb) from (
       select x.side || ':' || x.id as k, jsonb_agg(jsonb_build_object('key', st.key, 'stacks', st.value->'stacks',
                'left', case when st.value ? 'until' then (st.value->>'until')::int - (f->>'clock')::int end,
                'amounts', dungeon_v2_amounts(st.key, st.value, b)) order by st.key) as lines
         from combat_v2_units(f) x
         cross join lateral (select case when x.side = 'card' then f->'cards'->x.id else f->'enemies'->(x.id::int) end as u) uu
         cross join lateral jsonb_each(coalesce(uu.u->'status', '{}'::jsonb)) st
        group by x.side, x.id) q));
end $fn$;

-- ============================================================ 6. a fight room: the fight state at the room start (D5, D3, SYN)
create or replace function public.dungeon_v2_fight(p_state jsonb, p_foes jsonb, p_floor int, p_room int, p_b jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  b jsonb := p_b; act numeric := (p_b->'v2_speed'->>'act_at')::numeric;
  cards jsonb := '{}'::jsonb; en jsonb := '[]'::jsonb; fo jsonb; x text; u jsonb; cr jsonb; i int; s jsonb; up jsonb; ref jsonb;
begin
  if act is null then raise exception 'dungeon_v2_fight: no balance value for v2_speed.act_at'; end if;
  -- the cards: the run unit + the carry (HP, down, charge, held: D5, Q1), no status, a new meter (cards in squad order, then the foes)
  for x in select jsonb_array_elements_text(p_state->'squad') loop
    u := p_state->'units'->x; cr := p_state->'carry'->x;
    cards := cards || jsonb_build_object(x, u || jsonb_build_object('hp', cr->'hp', 'max', cr->'max', 'down', cr->'down',
      'charge', cr->'charge', 'held', cr->'held', 'status', '{}'::jsonb, 'meter', round((random() * act)::numeric, 2)));
  end loop;
  -- the foes of the room (R1a gauntlet_v2_foes: Dungeon foes have the dungeon_make_foe shape); show gets the level and the kind
  fo := gauntlet_v2_foes(p_foes, p_floor, p_room, b);
  for i in 0 .. jsonb_array_length(fo) - 1 loop
    en := en || jsonb_build_array(fo->i || jsonb_build_object('meter', round((random() * act)::numeric, 2),
      'show', (fo->i->'show') || jsonb_build_object('level', p_foes->i->'level', 'kind', p_foes->i->'kind')));
  end loop;
  s := jsonb_build_object('v', '2'::jsonb, 'mode', 'dungeon', 'round', 0, 'clock', 0, 'squad', p_state->'squad', 'cards', cards, 'enemies', en,
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
  -- SYN: the synergy of the squad (every card of the state, standing or down), once per fight room, before the first step
  s := combat_v2_synergy(s, b);
  return s;
end $fn$;

-- ============================================================ 7. after a step: the next card turn, or the end of the fight
create or replace function public.dungeon_v2_after(p_state jsonb, p_r jsonb, p_floor int, p_floors_n int) returns jsonb
language plpgsql set search_path = public as $fn$
declare st jsonb := p_state; f jsonb := p_r->'fight'; won boolean; o jsonb;
begin
  if p_r->>'event' = 'choose' then
    return st || jsonb_build_object('phase', 'fight', 'fight', f, 'turn', p_r->'actor');
  end if;
  -- the end or the cap: the carry of each card (D5: HP and down; Q1: the charge and the held turns); statuses and meters end with the room
  st := (st - 'fight' - 'turn') || jsonb_build_object(
    'carry', (select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'max', c.value->'max', 'down', coalesce(c.value->'down', 'false'::jsonb),
               'charge', c.value->'charge', 'held', c.value->'held')) from jsonb_each(f->'cards') c));
  won := p_r->>'event' = 'end' and coalesce((p_r->>'won')::boolean, false);
  if won then
    if st->>'room_type' = 'guardian' then
      st := st || jsonb_build_object('phase', case when p_floor >= p_floors_n then 'cleared' else 'floor_done' end, 'offers', '[]'::jsonb);
    else
      -- the v1 daily offers (dungeon_offers on a shim: mode daily, the carry as cards, the last pick, the healed floor) minus the loot (QD1)
      o := (select coalesce(jsonb_agg(z order by n), '[]'::jsonb) from jsonb_array_elements(dungeon_offers(jsonb_build_object('mode', 'daily', 'cards', st->'carry',
             'last_pick', st->'last_pick', 'heal_floor', st->'heal_floor'), p_floor)) with ordinality q(z, n) where z->>'kind' not in ('shards', 'card'));
      if jsonb_array_length(o) = 0 then o := jsonb_build_array(jsonb_build_object('kind', 'continue')); end if;
      st := st || jsonb_build_object('phase', 'choose', 'offers', o);
    end if;
  else
    -- lost, or the step cap of the mode (the v1 round cap also ends the run as fell)
    st := st || jsonb_build_object('phase', 'fell', 'offers', '[]'::jsonb);
  end if;
  return st;
end $fn$;

-- ============================================================ 8. enter a room: {state, step}
-- p_key null: room p_room of floor p_floor of p_floors. p_key given: the door state.door of the current room (the v1 door foe key).
create or replace function public.dungeon_v2_room(p_state jsonb, p_floors jsonb, p_floor int, p_room int, p_key text) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  b jsonb := combat_v2_enemy_numbers(); rm jsonb; t text; st jsonb; f jsonb; r jsonb; x text; c jsonb; n int := jsonb_array_length(p_floors);
begin
  if p_key is null then
    rm := p_floors->(p_floor - 1)->(p_room - 1);
  else
    t := p_state->>'door';
    -- the gamble door: a rare result (balance dungeon_rewards.door.gamble_rare) is the empty chest room (QD1), else an elite ambush
    if t = 'gamble' then t := case when random() < balance_num('dungeon_rewards', 'door', 'gamble_rare') then 'treasure' else 'elite' end; end if;
    rm := jsonb_build_object('type', t, 'foes', case when t in ('elite', 'horde') then dungeon_room_foes(p_key, p_floor, p_room, t) else '[]'::jsonb end);
  end if;
  t := rm->>'type';
  st := (p_state - 'fight' - 'offers' - 'turn' - 'door') || jsonb_build_object('room_type', t);
  if t in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then
    f := dungeon_v2_fight(st, rm->'foes', p_floor, p_room, b);
    st := st - 'empower' - 'ward';
    r := combat_v2_step(f, null, b);
    r := jsonb_build_object('fight', r->'state', 'event', r->'event', 'won', r->'won', 'actor', r->'actor', 'steps_left', r->'steps_left',
      'played', 0, 'log', r->'log', 'hp_changes', dungeon_v2_hp(f, r->'state'));
    return jsonb_build_object('state', dungeon_v2_after(st, r, p_floor, n), 'step', r);
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
    -- the v1 daily doors and the v1 draw: dungeon_enter on a shim state (mode daily, no card), only its offers
    st := st || jsonb_build_object('phase', 'path', 'offers', dungeon_enter(jsonb_build_object('mode', 'daily', 'cards', '{}'::jsonb),
      jsonb_build_array(jsonb_build_array(jsonb_build_object('type', 'choice', 'foes', '[]'::jsonb))), 1, 1)->'offers');
  else
    -- treasure (QD1: 0 loot): an empty chest pass room, no chest, one continue
    st := st || jsonb_build_object('room_type', 'treasure', 'phase', 'pass', 'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  end if;
  return jsonb_build_object('state', st, 'step', null);
end $fn$;

-- ============================================================ 9. an offer between rooms (D3, Q2-Q4)
create or replace function public.dungeon_v2_pick(p_state jsonb, p_offer jsonb, p_floor int) returns jsonb
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

-- ============================================================ 10. the floor map and the answer of a run function
create or replace function public.dungeon_v2_rooms(p_floors jsonb, p_floor int, p_room int, p_run boolean) returns jsonb
language sql immutable set search_path = public as $fn$
  -- the dungeon_view_core mask rule: a room ahead is unknown (only the guardian shows)
  select jsonb_build_object('rooms', (select coalesce(jsonb_agg(jsonb_build_object(
      'type', case when rm.i < coalesce(p_room, 1) or (rm.i = coalesce(p_room, 1) and p_run) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
      'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i), '[]'::jsonb)
    from jsonb_array_elements(p_floors->(coalesce(p_floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(p_floors));
$fn$;

create or replace function public.dungeon_v2_out(p_run bigint, p_extra jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare r dungeon_v2_runs; fl jsonb; sc jsonb; b jsonb := combat_v2_numbers(array['v2_charge', 'v2_status']);
begin
  select * into r from dungeon_v2_runs where id = p_run;
  fl := (select floors from dungeon_days where day = r.day);
  sc := dungeon_v2_screen(case when r.state->>'phase' = 'fight' then r.state->'fight' end, b);
  if r.state->>'phase' is distinct from 'fight' then
    -- outside a fight: need from the class of each card, squad_hp from the carry
    sc := sc || jsonb_build_object(
      'need', (select coalesce(jsonb_object_agg(k.key, (b->'v2_charge'->>(k.value->>'class'))::int), '{}'::jsonb) from jsonb_each(coalesce(r.state->'info', '{}'::jsonb)) k),
      'squad_hp', (select jsonb_build_object('hp', coalesce(sum((c.value->>'hp')::numeric), 0), 'max', coalesce(sum((c.value->>'max')::numeric), 0)) from jsonb_each(coalesce(r.state->'carry', '{}'::jsonb)) c));
  end if;
  return jsonb_build_object('ok', true, 'run', r.id, 'state', r.state, 'floor', r.floor, 'room', r.room, 'status', r.status, 'ended_by', r.ended_by,
      'info', r.state->'info', 'units', r.state->'units')
    || p_extra || dungeon_v2_rooms(fl, r.floor, r.room, true) || sc;
end $fn$;

-- the end of a run (fell, cleared): status over, ended_by; no grant, no ledger row (QD1)
create or replace function public.dungeon_v2_end(p_run bigint, p_phase text) returns void
language plpgsql set search_path = public as $fn$
begin
  if p_phase in ('fell', 'cleared') then
    update dungeon_v2_runs set status = 'over', ended_by = p_phase, ended_at = now() where id = p_run and status = 'active';
  end if;
end $fn$;

-- ============================================================ 11. the start of a v2 Dungeon run (testers only)
create or replace function public.dungeon_v2_start(p_player text, p_cards bigint[]) returns jsonb
language plpgsql set search_path = public as $fn$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d dungeon_days; g jsonb; v_n int := balance_num('dungeon', 'squad')::int;
  v_cost int := 0; v_budget int; c jsonb; x bigint; v_att int := 0; v_runs int; v_last int; v_active int; bad bigint[] := '{}';
  v_units jsonb := '{}'; v_info jsonb := '{}'; st jsonb; e jsonb; v_id bigint; n int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  if not combat_v2_on('dungeon', p_player) then return jsonb_build_object('ok', false, 'error', 'not_tester'); end if;
  perform 1 from players where id = p_player for update;
  update dungeon_v2_runs set status = 'over', ended_by = 'abandoned', ended_at = now() where player_id = p_player and status = 'active' and day < v_day;
  -- QD2: an extra run; the count of today is the v2 table only (game_var dungeon_runs_per_day, one active run at a time)
  select count(*), coalesce(max(attempt), 0), count(*) filter (where status = 'active') into v_runs, v_last, v_active
    from dungeon_v2_runs where player_id = p_player and day = v_day;
  if v_active > 0 or v_runs >= game_var('dungeon_runs_per_day') then return jsonb_build_object('ok', false, 'error', 'already'); end if;
  -- the squad checks of dungeon_start, in its order, with its codes and keys (INV-4)
  if p_cards is null or array_length(p_cards, 1) <> v_n or (select count(distinct y) from unnest(p_cards) y) <> v_n then
    return jsonb_build_object('ok', false, 'error', 'squad_size', 'need', v_n); end if;
  perform dungeon_generate(v_day);
  select * into d from dungeon_days where day = v_day;
  v_budget := coalesce((d.rule->>'budget')::int, balance_num('dungeon', 'budget')::int);   -- the day's rule, else balance dungeon.budget
  foreach x in array p_cards loop
    c := dungeon_card(p_player, x);
    if c is null then return jsonb_build_object('ok', false, 'error', 'not_owned', 'card', x); end if;
    if d.rule ? 'types' and not (d.rule->'types' ? (c->>'type')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    if d.rule ? 'no_rarity' and (d.rule->'no_rarity' ? (c->>'rarity')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    v_cost := v_cost + balance_num('dungeon', 'cost', c->>'rarity')::int;
    if c->>'type' in ('Character', 'Creature') then v_att := v_att + 1; end if;
  end loop;
  if v_att = 0 then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;
  if v_cost > v_budget then return jsonb_build_object('ok', false, 'error', 'budget', 'cost', v_cost, 'budget', v_budget); end if;
  -- QD4: every card needs a usable ability_v2 (combat_v2_card_unit raises no_data_found); the start refuses with the ids
  foreach x in array p_cards loop
    begin
      v_units := v_units || jsonb_build_object(x::text, dungeon_v2_unit(p_player, x));
      v_info := v_info || jsonb_build_object(x::text, dungeon_v2_info(x));
    exception when no_data_found then
      bad := bad || x;
    end;
  end loop;
  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'no_v2', 'cards', to_jsonb(bad)); end if;
  -- the run: engine 2, the units and the screen facts of the run start (snapshots, D4), the carry
  st := jsonb_build_object('engine', '2'::jsonb, 'squad', to_jsonb(p_cards), 'units', v_units, 'info', v_info,
    'carry', (select jsonb_object_agg(u.key, jsonb_build_object('hp', u.value->'hp', 'max', u.value->'max', 'down', false,
                'charge', u.value->'charge', 'held', u.value->'held')) from jsonb_each(v_units) u));
  e := dungeon_v2_room(st, d.floors, 1, 1, null);
  st := (e->'state') || jsonb_build_object('last', jsonb_build_object('kind', 'start', 'event', e->'step'->'event', 'won', e->'step'->'won', 'log', e->'step'->'log'));
  insert into dungeon_v2_runs (player_id, day, squad, state, attempt) values (p_player, v_day, p_cards, st, v_last + 1) returning id into v_id;
  perform dungeon_v2_end(v_id, st->>'phase');
  return dungeon_v2_out(v_id, jsonb_build_object('engine', '2'::jsonb, 'event', e->'step'->'event', 'won', e->'step'->'won', 'actor', e->'step'->'actor',
    'steps_left', e->'step'->'steps_left', 'played', 0, 'log', coalesce(e->'step'->'log', '[]'::jsonb), 'hp_changes', coalesce(e->'step'->'hp_changes', '[]'::jsonb)));
end $fn$;

-- ============================================================ 12. the run functions (server only; R2b routes)
-- card turns: act (p_auto false: the player's choice) and auto (p_auto true: Auto v2 for up to p_max card turns)
create or replace function public.dungeon_v2_turns(p_player text, p_choice jsonb, p_auto boolean, p_max int) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_v2_runs; x jsonb; st jsonb;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- D4: the run of today plays to its end in v2; the tester list is not read here (INV-2)
  select * into r from dungeon_v2_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' is distinct from 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  if p_auto and (p_max is null or p_max < 1) then return jsonb_build_object('ok', false, 'error', 'bad_max'); end if;
  x := dungeon_v2_play(r.state->'fight', case when p_auto then null else coalesce(p_choice, 'null'::jsonb) end, case when p_auto then p_max end, null);
  if not (x->>'ok')::boolean then return x; end if;
  st := dungeon_v2_after(r.state, x, r.floor, jsonb_array_length((select floors from dungeon_days where day = r.day)))
        || jsonb_build_object('last', jsonb_build_object('kind', case when p_auto then 'auto' else 'act' end, 'event', x->'event', 'won', x->'won', 'log', x->'log'));
  update dungeon_v2_runs set state = st, turns = turns + (x->>'played')::int where id = r.id;
  perform dungeon_v2_end(r.id, st->>'phase');
  return dungeon_v2_out(r.id, jsonb_build_object('event', x->'event', 'won', x->'won', 'actor', x->'actor', 'steps_left', x->'steps_left',
    'played', x->'played', 'log', x->'log', 'hp_changes', x->'hp_changes') || case when p_auto then jsonb_build_object('auto', x->'auto') else '{}'::jsonb end);
end $fn$;

create or replace function public.dungeon_v2_act(p_player text, p_choice jsonb) returns jsonb
language sql set search_path = public as $fn$
  select dungeon_v2_turns(p_player, p_choice, false, null);
$fn$;

create or replace function public.dungeon_v2_auto(p_player text, p_max int default 1) returns jsonb
language sql set search_path = public as $fn$
  select dungeon_v2_turns(p_player, null, true, p_max);
$fn$;

create or replace function public.dungeon_v2_choose(p_player text, p_pick int) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_v2_runs; st jsonb; fl jsonb; o jsonb; x jsonb; v_f int; v_r int; v_door text;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_v2_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state; v_f := r.floor; v_r := r.room;
  fl := (select floors from dungeon_days where day = r.day);
  if st->>'phase' = 'floor_done' then
    -- the next floor, room 1
    v_f := r.floor + 1; v_r := 1; o := null;
    x := dungeon_v2_room(st, fl, v_f, v_r, null);
  else
    if st->>'phase' is null or st->>'phase' not in ('choose', 'rest', 'path', 'pass') then
      return jsonb_build_object('ok', false, 'error', 'not_choosing'); end if;
    o := case when p_pick >= 0 then st->'offers'->p_pick end;
    if o is null then return jsonb_build_object('ok', false, 'error', 'bad_pick'); end if;
    if o->>'kind' = 'door' then
      -- a door turns this room into another room (the v1 door foe key door|run|floor|room)
      v_door := o->>'to';
      x := dungeon_v2_room(st || jsonb_build_object('door', v_door), fl, v_f, v_r, 'door|' || r.id || '|' || r.floor || '|' || r.room);
      v_door := x->'state'->>'room_type';
    else
      st := dungeon_v2_pick(st, o, r.floor);
      -- the next room of the floor (the guardian ends a floor through floor_done); no literal room count
      v_r := least(r.room + 1, jsonb_array_length(fl->(r.floor - 1)));
      x := dungeon_v2_room(st, fl, v_f, v_r, null);
    end if;
  end if;
  st := (x->'state') || jsonb_build_object('last', jsonb_build_object('kind', case when o is null then 'next_floor' else 'choose' end, 'pick', o,
    'event', x->'step'->'event', 'won', x->'step'->'won', 'log', x->'step'->'log'));
  update dungeon_v2_runs set state = st, floor = v_f, room = v_r where id = r.id;
  perform dungeon_v2_end(r.id, st->>'phase');
  return dungeon_v2_out(r.id, jsonb_build_object('picked', o, 'door', v_door)
    || case when x->'step' is not null and x->'step' <> 'null'::jsonb then jsonb_build_object('event', x->'step'->'event', 'won', x->'step'->'won',
         'actor', x->'step'->'actor', 'steps_left', x->'step'->'steps_left', 'played', 0, 'log', x->'step'->'log', 'hp_changes', x->'step'->'hp_changes') else '{}'::jsonb end);
end $fn$;

create or replace function public.dungeon_v2_retreat(p_player text) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_v2_runs;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_v2_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' is distinct from 'floor_done' then return jsonb_build_object('ok', false, 'error', 'not_between_floors'); end if;
  update dungeon_v2_runs set status = 'over', ended_by = 'retreat', ended_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'floor', r.floor, 'room', r.room);
end $fn$;

create or replace function public.dungeon_v2_view(p_player text) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare v_day date := dungeon_day(); d jsonb; r dungeon_v2_runs; v_left int; v_active boolean; v_last jsonb; v_tester boolean; o jsonb;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- the day (as dungeon_view_core: a day with no row is made first); no run row is written
  d := dungeon_generate(v_day);
  v_tester := combat_v2_on('dungeon', p_player);
  select * into r from dungeon_v2_runs where player_id = p_player and day = v_day order by attempt desc limit 1;
  -- QD2: the v2 runs of today only (an extra run; the v1 count is not read)
  v_left := greatest(0, game_var('dungeon_runs_per_day')::int - (select count(*) from dungeon_v2_runs where player_id = p_player and day = v_day)::int);
  v_active := exists (select 1 from dungeon_v2_runs where player_id = p_player and day = v_day and status = 'active');
  v_last := (select jsonb_build_object('id', e.id, 'attempt', e.attempt, 'ended_by', e.ended_by, 'floor', e.floor, 'room', e.room, 'turns', e.turns)
               from dungeon_v2_runs e where e.player_id = p_player and e.day = v_day and e.status = 'over' order by e.attempt desc limit 1);
  if r.status = 'over' and v_left > 0 then r := null; end if;
  o := jsonb_build_object('ok', true, 'tester', v_tester,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room,
             'turns', r.turns, 'attempt', r.attempt, 'state', r.state) end,
    'runs_left', v_left, 'last_run', v_last, 'can_start', v_tester and not v_active and v_left > 0);
  if r.id is not null then
    return dungeon_v2_out(r.id, '{}'::jsonb) - 'ok' - 'run' - 'state' - 'floor' - 'room' - 'status' - 'ended_by' || o;
  end if;
  return o || dungeon_v2_rooms(d->'floors', null, null, false) || dungeon_v2_screen(null);
end $fn$;

-- ============================================================ 13. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['dungeon_v2_unit(text, bigint, jsonb)', 'dungeon_v2_needs_ally(jsonb)', 'dungeon_v2_info(bigint)', 'dungeon_v2_hp(jsonb, jsonb)',
      'dungeon_v2_play(jsonb, jsonb, integer, jsonb)', 'dungeon_v2_amounts(text, jsonb, jsonb)', 'dungeon_v2_screen(jsonb, jsonb)',
      'dungeon_v2_fight(jsonb, jsonb, integer, integer, jsonb)', 'dungeon_v2_after(jsonb, jsonb, integer, integer)',
      'dungeon_v2_room(jsonb, jsonb, integer, integer, text)', 'dungeon_v2_pick(jsonb, jsonb, integer)', 'dungeon_v2_rooms(jsonb, integer, integer, boolean)',
      'dungeon_v2_out(bigint, jsonb)', 'dungeon_v2_end(bigint, text)', 'dungeon_v2_start(text, bigint[])', 'dungeon_v2_turns(text, jsonb, boolean, integer)',
      'dungeon_v2_act(text, jsonb)', 'dungeon_v2_auto(text, integer)', 'dungeon_v2_choose(text, integer)', 'dungeon_v2_retreat(text)', 'dungeon_v2_view(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.dungeon_v2_unit(text, bigint, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2, R3 reuses it): the v2 unit of a player's card: combat_v2_card_unit (after SYN with tags) with the 12 star-dependent stat keys (atk, crt, crd, abl, acc, def, ddg, max, hp, spd, power, extra_stack) from card_combat_v2 with the player's stars (player_cards.ascension), level 0, no points (QD3). Every other key stays. A card with no usable ability_v2 raises no_data_found (D2). Reads only. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_needs_ally(jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2): true when an active (its blocks) asks the player for an ally: a shield, heal, empower, focus or cure block, or quicken without all, whose to is not most_hurt or strongest (the engine rule of combat_effect_v2_active; R1b 3.2 item 3). Pure. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_info(bigint) is $cm$[combat] Combat v2 Dungeon (20.18 R2, R3 reuses it): the screen facts of a card: name (subjects.ability_v2 name), role, class, needs_ally. Raises no_data_found for a card with no usable ability_v2. Reads only. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_hp(jsonb, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2): the HP changes between two fight states: each unit whose hp, down or shield value (Shielded on a card, Guarded on an enemy) differs, in unit order, with before, after, down, shield_before, shield_after (the screen log fallback). Pure. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_play(jsonb, jsonb, integer, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2, R3 reuses it): card turns on a fight state, no table: the numbers and fight_state_check_v2 first (bad_state); then one manual choice (only a P0001 of combat_v2_step is bad_choice) or, with no choice, Auto v2 for up to p_max card turns (bad_max below 1). Returns fight, event, won, actor, steps_left (of the last step), played, log, auto, hp_changes. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_amounts(text, jsonb, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2): the numbers of the tap line of one status: one number for each {leaf} of its rule text (statuses): the per-stack leaves poison.tick, chill.dmg, chill.spd and burn.tick_x x the stacks, every other leaf from balance, and the unit's value when the status has one. Reads only. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_screen(jsonb, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2, R3 reuses it): the screen fields of a fight state, from the engine state and the live balance (not stored): need (v2_charge of each card's class), squad_hp, order (the card that has the turn, then combat_v2_turn_order to 10 entries; ready from the charge while no earlier non-skip entry of the same card), targets (the standing enemies), allies (every card of the fight), status_lines. A null fight gives empty values. Reads only. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_fight(jsonb, jsonb, integer, integer, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2): the fight state at the start of a fight room: each card = its run unit + its carry (HP, down, charge, held: D5, Q1), no status, a meter of 0 to v2_speed.act_at (2 decimals, cards in squad order then the foes); the foes of gauntlet_v2_foes with show level and kind; the pending buff (Empowered on each standing attacker) and ward (Shielded max HP x the amount); then combat_v2_synergy once (SYN). Draws random numbers. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_after(jsonb, jsonb, integer, integer) is $cm$[combat] Combat v2 Dungeon (20.18 R2): the run state after a play answer: the next card turn (phase fight), or the end of the fight: the carry of each card, then won: floor_done or cleared after a guardian, else choose with the v1 daily offers minus shards and card (QD1; none left = continue); lost or the step cap: fell. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_room(jsonb, jsonb, integer, integer, text) is $cm$[combat] Combat v2 Dungeon (20.18 R2): enter one room of a v2 Dungeon run (p_key null: room p_room of floor p_floor; p_key given: the door state.door with the v1 door foes of that key; gamble = balance dungeon_rewards.door.gamble_rare the empty chest room, else an elite fight): a fight room (dungeon_v2_fight, then combat_v2_step to the first card turn), rest (the v1 rest numbers on the carry), choice (the v1 daily doors: dungeon_enter on a shim, only its offers), treasure (an empty pass room, QD1). Returns {state, step}. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_pick(jsonb, jsonb, integer) is $cm$[combat] Combat v2 Dungeon (20.18 R2): one offer between rooms on the carry: heal and revive (the v1 numbers), buff (a pending Empowered, the higher amount stays: Q4, until the next fight room: Q3), ward (a pending Shielded: Q2), reset (every charge = v2_charge of the class: D3). Reads only. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_rooms(jsonb, integer, integer, boolean) is $cm$[combat] Combat v2 Dungeon (20.18 R2): the floor map of a run: rooms of the current floor with the dungeon_view_core mask rule (a room shows its type when it is before the current room, the current room of a run, or the guardian; else unknown; the guardian name) and floors = the floor count. Pure. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_out(bigint, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2): the answer of a v2 Dungeon run function: the run row, info, units, the given fields, the floor map and the screen fields (outside a fight: need from the classes, squad_hp from the carry). Reads only. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_end(bigint, text) is $cm$[combat] Combat v2 Dungeon (20.18 R2): ends a v2 Dungeon run at fell or cleared: status over, ended_by, ended_at. No grant, no ledger row (QD1). combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_start(text, bigint[]) is $cm$[combat] Combat v2 Dungeon (20.18 R2, server only, R2b route): starts a v2 Dungeon run for a tester (combat_v2_on dungeon): disabled, locked, not_tester, a stale v2 run of an earlier day ends as abandoned, already (the v2 runs of today only, QD2), then the squad checks of dungeon_start with its codes and keys (squad_size, not_owned, rule, no_attacker, budget), then no_v2 + cards (QD4). The row goes to dungeon_v2_runs; room 1 of floor 1 plays to its first card turn. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_turns(text, jsonb, boolean, integer) is $cm$[combat] Combat v2 Dungeon (20.18 R2): the body of dungeon_v2_act and dungeon_v2_auto: disabled, the active v2 run of today (locked; the tester list is not read: D4), not_fighting, bad_max, then dungeon_v2_play, the row (turns += the card turns played) and the end. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_act(text, jsonb) is $cm$[combat] Combat v2 Dungeon (20.18 R2, server only, R2b route): one card turn of the player's v2 Dungeon run: the choice {use, target, ally} for the card that has the turn (D6). Errors: disabled, no_run, not_fighting, bad_state (+ detail), bad_choice (+ detail). combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_auto(text, integer) is $cm$[combat] Combat v2 Dungeon (20.18 R2, server only, R2b route): Auto v2 for up to p_max card turns of the player's v2 Dungeon run; the answer has auto [{actor, use, why}]. Errors: disabled, no_run, not_fighting, bad_state, bad_max. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_choose(text, integer) is $cm$[combat] Combat v2 Dungeon (20.18 R2, server only, R2b route): an offer, a door or continue between rooms, or the next floor at floor_done; then the next room (a fight room plays to its first card turn). Errors: disabled, no_run, not_choosing, bad_pick. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_retreat(text) is $cm$[combat] Combat v2 Dungeon (20.18 R2, server only, R2b route): ends the v2 Dungeon run at floor_done as retreat (0 loot). Errors: disabled, no_run, not_between_floors. combat_v2_dungeon_run.sql.$cm$;
comment on function public.dungeon_v2_view(text) is $cm$[combat] Combat v2 Dungeon (20.18 R2, server only, R2b route): the v2 part of the Dungeon screen of a player: tester, run (the newest v2 run of today; null when it is over and a run is left), runs_left (the v2 runs of today only, QD2), last_run, can_start (tester, no active v2 run, a run left), the floor map and the screen fields. Makes the day first (as dungeon_view_core); writes no run row. combat_v2_dungeon_run.sql.$cm$;

notify pgrst, 'reload schema';
