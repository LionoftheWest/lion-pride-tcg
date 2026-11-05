-- combat_v2_on_hunt.sql (2026-11-04): combat v2 step R3-ON, the Hunt in combat v2 for every member
-- (docs/combat-redesign-plan.md 20.21 "R3-ON"; pipeline item ON SPEC v6.1 section 3.4, gate 6.3; Nathan N-1 to N-10).
-- Needs R3a (combat_v2_hunt_practice.sql: hunt_v2_days and the hunt_v2_ functions), R2a (dungeon_v2_unit, dungeon_v2_play) and SYN
-- (combat_v2_synergy). SQL merge order: R1b -> SYN -> R1-ON -> M1e -> R2a -> R2-ON -> R3a -> R3-ON.
-- Before: the Hunt practice of testers is private (R3a): no shared write, no reward.
-- After this file, with the flag combat_v2.hunt ON (the switch file sets it):
--   EVERY member plays the Hunt in v2. A live day (hunt_v2_days.live = the flag at the start) credits the shared boss: each decrease of the
--     private boss HP in the call log, x hunts.hp_max / the private boss max, per card by the largest remainder (hunt_v2_credit). The shared
--     write (hunt_v2_shared): hunts FOR NO KEY UPDATE, then the status and the close time again, then hunt_hits, the boss HP, one
--     hunt_combat_log row per credited card, credited; only the call that moves active -> defeated settles (settle_hunt) and writes the
--     defeat event (the v1 text).
--   A live start takes NO boss-row write lock: FIRST hunts FOR KEY SHARE (the lock that the bridge-row FK takes), THEN the players row
--     FOR UPDATE (the defeat settle locks hunts, then players: the same order). It refuses v1_today when the member played v1 today, and
--     writes one downed hunt_card_hp bridge row per squad card (so the v1 readers count the day: the daily task, raider, slayer).
--   hunt_attack and hunt_support (v1) refuse v2_on with the flag ON, and v2_today when a live v2 day of today exists (also after a rollback).
--   The auto-pick ranks the unit stats of dungeon_v2_unit (the live level and points) with the fight speed (combat_v2_speed).
-- With the flag OFF: the R3a practice for testers (no shared write, no boss lock), and a tester with no active Hunt practises against the
--   newest ended Hunt (live frac 1). Readers read the day mark (live), never the flag (INV-ON-1).
-- Idempotent. Server only. GUARD: each replaced function must be its R3a text, its live text or the text that this file made.
-- Test: card-studio/scripts/test-combat-v2-on-hunt.mjs (rolled back; MUTATE=all must catch every mutation).

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.hunt_v2_start(text, bigint[])', 'a5ef6f142d4e8d534b6ebb340320bdb9', '398e21c9c00dd9eddfbdf539969cf676'),
    ('public.hunt_v2_turns(text, jsonb, boolean, integer)', 'b919b65305454dd9e66c2829b0619892', '32480034440a93d10fc5b671aba81d65'),
    ('public.hunt_v2_view(text)', 'f0f6d797e4fa2b88037206920baf9fd4', '44ada58cd6bcc7b6ed02606810d7fbb8'),
    ('public.hunt_attack(text, bigint, bigint)', 'ae6228037f627e2413b9693f22e345c7', '7f71eebe29b73b15f7c46d2b7a44c4b0'),
    ('public.hunt_support(text, bigint, bigint, bigint)', 'a43dd44ac4cdf5a4286bde1a5da3febc', 'e3f4fa9d381f6e8779e6151830a3c2ae')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_on_hunt.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the day mark and the credit of a day
alter table public.hunt_v2_days add column if not exists live boolean not null default false;
alter table public.hunt_v2_days add column if not exists credited bigint not null default 0;
comment on column public.hunt_v2_days.live is $cm$true when the day started while the flag combat_v2.hunt was ON (INV-ON-1): a live day writes its credit to the shared boss (hunt_hits, hp_remaining) and counts for the board and the prizes. Readers read this mark, never the flag. A tester practice day is false.$cm$;
comment on column public.hunt_v2_days.credited is $cm$The shared boss damage that this day wrote (the sum of its hunt_hits credit, v1 HP units). 0 for a practice day.$cm$;

-- ============================================================ 2. the credit of a call (pure)
create or replace function public.hunt_v2_credit(p_log jsonb, p_squad jsonb, p_scale numeric) returns jsonb
language sql immutable set search_path = public as $fn$
  -- each DECREASE of the private boss HP (the hp entries of enemy 0 with after < before; a heal is not credited) x the scale; an act
  -- decrease to its card actor, any other decrease (a tick, an enemy act) to the first card of the squad (the engine keeps no status
  -- source); per card the largest remainder rule, so the card credits add up to the rounded total
  with d as (
    select case when e->>'k' = 'act' and e->'actor'->>'side' = 'card' then e->'actor'->>'id' else p_squad->>0 end as card,
           ((h->>'before')::numeric - (h->>'after')::numeric) * p_scale as amt
      from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) e
     cross join lateral jsonb_array_elements(coalesce(e->'hp', '[]'::jsonb)) h
     where h->>'side' = 'enemy' and (h->>'id')::int = 0 and (h->>'after')::numeric < (h->>'before')::numeric
  ), per as (select card, sum(amt) as a from d group by card),
  t as (select coalesce(round(sum(a)), 0)::bigint as total from per),
  fl as (select card, floor(a)::bigint as f, a - floor(a) as r from per),
  rk as (select card, f, row_number() over (order by r desc, card) as n from fl)
  select jsonb_build_object('total', (select total from t),
    'cards', coalesce((select jsonb_object_agg(card, f + case when n <= (select total from t) - (select coalesce(sum(f), 0) from fl) then 1 else 0 end) from rk), '{}'::jsonb));
$fn$;

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

-- ============================================================ 4. the day answer: the mark and the credit
create or replace function public.hunt_v2_day_json(r public.hunt_v2_days) returns jsonb
language sql stable set search_path = public as $fn$
  select case when r.hunt_id is null then null else jsonb_build_object('hunt_id', r.hunt_id, 'day', r.day, 'boss', r.boss, 'squad', to_jsonb(r.squad),
    'status', r.status, 'ended_by', r.ended_by, 'damage', r.damage, 'steps', r.steps, 'start_hp', r.start_hp,
    'started_at', r.started_at, 'ended_at', r.ended_at, 'live', r.live, 'credited', r.credited) end;
$fn$;

-- ============================================================ 5. the start (members with the flag ON; testers with it OFF)
create or replace function public.hunt_v2_start(p_player text, p_cards bigint[] default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_day date := hunt_v2_today(); v_live boolean := combat_v2_on('hunt'); v_practice boolean := false; h public.hunts; v_key text; b jsonb; bu jsonb;
  v_cap int; act numeric; v_frac numeric; boss jsonb; v_st text; v_cl timestamptz;
  pool jsonb := '[]'; v_ids bigint[]; bad bigint[] := '{}'; x bigint; rr record; u jsonb;
  v_units jsonb := '{}'; v_info jsonb := '{}'; cards jsonb := '{}'; s jsonb; r jsonb; sh jsonb;
begin
  -- who: everyone with the flag ON; with it OFF the testers (R3)
  if not v_live and not combat_v2_on('hunt', p_player) then return jsonb_build_object('ok', false, 'error', 'not_tester'); end if;
  perform hunt_v2_abandon(p_player, v_day);
  -- the live Hunt, read with NO lock
  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1;
  if not found then
    -- a TESTER with no active Hunt practises against the newest ended Hunt (live frac 1, no shared write)
    if v_live or not combat_v2_on('hunt', p_player) then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
    select * into h from public.hunts order by opens_at desc limit 1;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
    v_practice := true;
  end if;
  v_key := hunt_v2_boss_key(h.name);
  if v_key is null then return jsonb_build_object('ok', false, 'error', 'no_v2_boss', 'name', h.name); end if;
  if exists (select 1 from public.hunt_v2_days d where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day) then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;
  if v_live then
    -- the lock order of a live start (r3 L-1): FIRST the boss row FOR KEY SHARE (no write lock: it never waits on a v2 shared write),
    -- the status and the close time again under it; THEN the player's row (two starts of one player serialize)
    select status, closes_at into v_st, v_cl from public.hunts where id = h.id for key share;
    if v_st <> 'active' or now() >= v_cl then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
    perform 1 from public.players where id = p_player for update;
    -- INV-ON-3: a member who played the v1 Hunt today (hunt_card_hp rows of today, no v2 day) plays v1 today
    if exists (select 1 from public.hunt_card_hp hc where hc.hunt_id = h.id and hc.player_id = p_player and hc.hit_date = v_day) then
      return jsonb_build_object('ok', false, 'error', 'v1_today');
    end if;
  end if;
  b := combat_v2_enemy_numbers();
  bu := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']);
  v_cap := hunt_card_cap();
  act := (b->'v2_speed'->>'act_at')::numeric;
  if act is null then raise exception 'hunt_v2_start: no balance value for v2_speed.act_at'; end if;
  v_frac := case when v_practice then 1 else h.hp_remaining::numeric / h.hp_max end;
  boss := combat_v2_hunt_boss(h.tier, v_key, jsonb_build_object('start_frac', v_frac, 'meter', round((random() * act)::numeric, 2)), b);
  if p_cards is null then
    -- the auto-pick (r3 L-5, r4 L-4): the unit stats of dungeon_v2_unit (the live level and points, as the fight) and the fight speed,
    -- one bundle for every call; a card with no usable ability_v2 is left out
    for rr in select pc.card_id, s0.ability_v2 as a
                from public.player_cards pc join public.cards c on c.id = pc.card_id join public.subjects s0 on s0.id = c.subject_id
               where pc.player_id = p_player and pc.quantity > 0 order by pc.card_id loop
      continue when jsonb_typeof(rr.a) is distinct from 'object' or jsonb_typeof(rr.a->'role') is distinct from 'string'
        or jsonb_typeof(rr.a->'blocks') is distinct from 'array' or not exists (select 1 from public.roles y where y.key = rr.a->>'role');
      u := dungeon_v2_unit(p_player, rr.card_id, bu);
      pool := pool || jsonb_build_array(jsonb_build_object('id', rr.card_id, 'role', u->>'role', 'class', u->>'class', 'atk', u->'atk',
        'crt', u->'crt', 'crd', u->'crd', 'spd', combat_v2_speed(u, 0, b), 'blocks', u->'active'->'blocks', 'pick_factor', rr.a->'pick_factor'));
    end loop;
    if jsonb_array_length(pool) = 0 then return jsonb_build_object('ok', false, 'error', 'squad_size', 'cap', v_cap); end if;
    v_ids := array(select (z #>> '{}')::bigint from jsonb_array_elements(combat_v2_autopick(pool,
               jsonb_build_object('mechanics', coalesce(boss->'mechanics', '[]'::jsonb), 'weak_role', boss->'weak_role'), v_cap, b, null)->'ids') z);
  else
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
  foreach x in array v_ids loop
    begin
      u := dungeon_v2_unit(p_player, x, bu);
      v_units := v_units || jsonb_build_object(x::text, u);
      v_info := v_info || jsonb_build_object(x::text, dungeon_v2_info(x));
    exception when no_data_found then
      bad := bad || x;
    end;
  end loop;
  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'no_v2', 'cards', to_jsonb(bad)); end if;
  foreach x in array v_ids loop
    cards := cards || jsonb_build_object(x::text, (v_units->(x::text)) || jsonb_build_object('meter', round((random() * act)::numeric, 2)));
  end loop;
  s := jsonb_build_object('v', '2'::jsonb, 'mode', 'hunt', 'round', 0, 'clock', 0, 'squad', to_jsonb(v_ids), 'cards', cards, 'enemies', jsonb_build_array(boss),
    'marks', '{}'::jsonb, 'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
  s := combat_v2_synergy(s, b);
  r := combat_v2_step(s, null, b);
  begin
    insert into public.hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp, live)
    values (h.id, p_player, v_day, v_key, v_ids,
            jsonb_build_object('engine', '2'::jsonb, 'tier', h.tier, 'squad', to_jsonb(v_ids), 'units', v_units, 'info', v_info, 'fight', r->'state')
              || case when v_practice then jsonb_build_object('practice_ended', true) else '{}'::jsonb end,
            (boss->>'hp')::numeric, v_live);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already');
  end;
  if v_live then
    -- the bridge rows: one downed hunt_card_hp row per squad card (the v1 readers count the day; every v1 path refuses these cards)
    insert into public.hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
      select h.id, p_player, z, v_day, round((v_units->(z::text)->>'max')::numeric)::int, round((v_units->(z::text)->>'max')::numeric)::int, true
        from unnest(v_ids) z
      on conflict (hunt_id, player_id, card_id, hit_date) do update set downed = true, updated_at = now();
  end if;
  perform hunt_v2_save(h.id, p_player, v_day, r->'state', r->>'event', jsonb_build_object('kind', 'start', 'event', r->'event', 'won', r->'won', 'log', r->'log'));
  -- HO2b: the start step runs like an act: a boss HP decrease is credited (the shared write)
  sh := hunt_v2_live_credit(h.id, p_player, v_day, r->'log');
  return hunt_v2_out(h.id, p_player, v_day, jsonb_build_object('event', r->'event', 'won', r->'won', 'actor', r->'actor', 'steps_left', r->'steps_left',
    'played', 0, 'log', coalesce(r->'log', '[]'::jsonb), 'hp_changes', dungeon_v2_hp(s, r->'state'), 'credit', sh));
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

-- ============================================================ 7. the screen (the flag for the screen rule, the mark of the day)
create or replace function public.hunt_v2_view(p_player text) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare v_day date := hunt_v2_today(); v_live boolean := combat_v2_on('hunt'); v_tester boolean := combat_v2_on('hunt', p_player); h public.hunts; v_has boolean;
  v_key text; r public.hunt_v2_days; o jsonb; v_end public.hunts; v_endkey text;
begin
  perform hunt_v2_abandon(p_player, v_day);
  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1;
  v_has := found;
  if v_has then v_key := hunt_v2_boss_key(h.name); end if;
  select * into r from public.hunt_v2_days d where d.player_id = p_player and d.day = v_day and (not v_has or d.hunt_id = h.id) order by d.started_at desc limit 1;
  if not v_has and v_tester and not v_live then
    select * into v_end from public.hunts order by opens_at desc limit 1;
    if found then v_endkey := hunt_v2_boss_key(v_end.name); end if;
  end if;
  o := jsonb_build_object('ok', true, 'tester', v_tester, 'live', v_live, 'practice', not v_live,
    'hunt', case when v_has then jsonb_build_object('id', h.id, 'name', h.name, 'tier', h.tier, 'closes_at', h.closes_at,
              'live_frac', h.hp_remaining::numeric / h.hp_max) end,
    'boss', case when v_key is not null then hunt_boss_v2_card(v_key, h.tier) when v_endkey is not null then hunt_boss_v2_card(v_endkey, v_end.tier) end,
    'day', hunt_v2_day_json(r),
    'can_start', (v_live or v_tester) and ((v_has and v_key is not null
                   and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day))
                 or (v_endkey is not null and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = v_end.id and d.player_id = p_player and d.day = v_day))));
  if r.status = 'active' then
    return hunt_v2_out(r.hunt_id, r.player_id, r.day, '{}'::jsonb) || o;
  end if;
  return o;
end $fn$;

-- ============================================================ 8. the v1 Hunt functions refuse with combat v2 (the live text + the R3-ON lines)
CREATE OR REPLACE FUNCTION public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int;
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_set text; v_type text; v_mod numeric; v_cardname text;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint; v_hpmax bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
  v_feed text; v_settle jsonb; v_milestone boolean;
  v_total bigint; v_used int; v_topcard text; v_topdmg bigint; v_cap int;
  v_bossact text; v_slam jsonb; v_round int; v_targets jsonb;
  v_ability jsonb; v_aeff text; v_heal int;
  v_buff numeric; v_debuff numeric; v_shield int; v_absorb int; v_critchance numeric;
  v_enrage numeric; v_enr_until int; v_weaken numeric; v_wk_until int; v_expose numeric; v_exp_until int; v_stun_until int;
  v_bmult numeric; v_r numeric;
  v_resist jsonb; v_tags text[]; v_wtags text[]; v_wm int; v_rm int; v_stack int; v_wmult numeric;
  v_plist text[]; v_share bigint; v_bheal int; v_lost numeric; v_phase text; v_extra text; v_stunned_card boolean;
  v_passive jsonb; v_pk text; v_elem text; v_syn int; v_synmult numeric; v_burn int; v_burned boolean;
  v_origin text; v_osyn int; v_omult numeric; v_ksyn int; v_kmult numeric;
  v_stats jsonb; v_atk numeric; v_pts jsonb; v_cmb jsonb;
  v_double boolean := false; v_rally numeric; v_mend numeric; v_bf numeric;
  v_party jsonb; v_crash jsonb; v_crash_dmg int := 0; v_crash_to text; v_crash_card bigint;
  v_crash_fb boolean := false; v_crash_round int; v_clog bigint;
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
  v_bname text; v_marks jsonb; v_pick jsonb; v_ctr jsonb; v_tick jsonb; v_ubuff numeric := 1;
  v_rtgt bigint; v_redir jsonb; v_squad bigint[];   -- D-129 / D-132: the card a single boss hit lands on, when it is not the attacking card
  v_rrar text; v_rasc int; v_rmod numeric; v_rpts jsonb; v_rkind text; v_rmax int;
  v_skey text; v_fight jsonb; v_eng jsonb; v_facts jsonb; v_others jsonb := '[]'::jsonb; v_x text; i int; v_e jsonb; v_free boolean; v_hiton jsonb;   -- f3_engine_hunt.sql: the fight state, the engine answer
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive, coalesce(hp_share, hp_max), stats, hp_remaining, name
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive, v_share, v_stats, v_hp, v_bname
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  -- R3-ON (combat_v2_on_hunt.sql): the Hunt is combat v2 for everyone with the flag ON; a live v2 day of today keeps v1 off (also after a rollback)
  if combat_v2_on('hunt') then return jsonb_build_object('ok', false, 'error', 'v2_on'); end if;   -- R3-ON
  if exists (select 1 from hunt_v2_days d where d.hunt_id = p_hunt and d.player_id = p_player and d.day = (now() at time zone 'America/Denver')::date and d.live) then   -- R3-ON
    return jsonb_build_object('ok', false, 'error', 'v2_today'); end if;   -- R3-ON
  v_pk := v_passive->>'kind';
  -- Every passive the boss has (passive.list; an older hunt has only passive.kind).
  select coalesce(array_agg(x->>'kind'), array[v_pk]) into v_plist
    from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;
  v_plist := array_remove(v_plist, null);

  -- f3_engine_hunt.sql: also the subject key and hit_on (the hit triggers that have a step: the card's attack kind, the enabled squad rows), so the
  -- engine skips a trigger with no step (in this statement: no new query)
  select pc.quantity, pc.ascension, c.rarity::text, c.set_id, s.type, s.cp_mod, c.name, s.ability, s.tag_slugs, pc.stat_points, s.key,
         (select coalesce(jsonb_agg(distinct st2->>'on'), '[]'::jsonb) from ability_kinds a cross join jsonb_array_elements(a.steps) st2
           where ((a.key = s.ability->>'effect' and s.ability->>'kind' = 'attack' and a.slot = 'attack') or (a.slot = 'squad' and a.enabled))
             and st2->>'on' in ('before_hit', 'on_hit', 'after_attack'))
    into v_qty, v_asc, v_rarity, v_set, v_type, v_mod, v_cardname, v_ability, v_tags, v_pts, v_skey, v_hiton
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'America/Denver')::date;
  -- One squad per day (hunt_squads.sql): a locked squad fights only with its own cards.
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  -- The round limit (hunt_loop_caps.sql): a squad fights at most hunt_round_cap rounds a day.
  v_rcap := hunt_round_cap();
  if coalesce((select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day), 0) >= v_rcap then
    return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap);
  end if;
  -- The stat points of this copy (stat_points.sql). With the flag off: card_power + card_max_hp.
  v_cmb := card_combat(v_rarity, v_asc, v_mod, v_pts);
  v_cp := (v_cmb->>'cp')::int;
  v_maxhp := (v_cmb->>'hp')::int;

  select hp_remaining, downed, coalesce(dmg_buff, 1), coalesce(dmg_debuff, 1), coalesce(shield, 0)
    into v_cardhp, v_downed, v_buff, v_debuff, v_shield
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then
    v_cardhp := v_maxhp; v_downed := false; v_buff := 1; v_debuff := 1; v_shield := 0;
    v_cap := hunt_card_cap();
    if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap then
      return jsonb_build_object('ok', false, 'error', 'day_limit', 'cap', v_cap);
    end if;
  else
    v_cap := hunt_card_cap();
  end if;
  if v_downed or v_cardhp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'downed', 'card_hp', 0, 'card_max_hp', v_maxhp);
  end if;

  v_round := hunt_state_round(p_hunt, p_player, v_day);
  -- F-3 4d (f3_engine_hunt.sql): the fight state from the rows read above and ONE statement over the committed cards (hunt_fight_state_info, with the
  -- combat state row). The checks below and the boss state of this member read it (in place of three old queries over the same rows: the same values),
  -- and its squad facts give the tags of the other committed cards for the squad synergy (combat_core.sql: combat_squad).
  v_fight := hunt_fight_state_info(p_hunt, p_player, v_day,
    jsonb_build_object('hp', v_hp, 'max', v_hpmax, 'status', v_status, 'tier', v_tier, 'passives', to_jsonb(v_plist)), null,
    p_card, jsonb_build_object('ability', v_ability, 'tags', coalesce(to_jsonb(v_tags), '[]'::jsonb), 'subject', v_skey, 'type', v_type, 'hit_on', v_hiton), null);
  v_facts := v_fight->'facts'->'cards';
  -- A stunned card waits while another attacker can act or the squad can still bring a card (the old checks, on the rows of the fight state).
  v_stunned_card := case when v_fight->'cards' ? p_card::text then coalesce((v_fight->'cards'->p_card::text->>'cd')::int, 0) >= v_round + 1 end;
  if coalesce(v_stunned_card, false) then
    v_free := jsonb_array_length(v_fight->'squad') < v_cap;
    for i in 0 .. jsonb_array_length(v_fight->'squad') - 1 loop
      exit when v_free;
      v_x := v_fight->'squad'->>i;
      v_free := v_x <> p_card::text and not (v_fight->'cards'->v_x->>'down')::boolean and coalesce((v_fight->'cards'->v_x->>'cd')::int, 0) < v_round + 1
                and coalesce(v_facts->v_x->>'type' in ('Character', 'Creature'), false);
    end loop;
    if v_free then
      return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
    end if;
  end if;
  -- Mend (a boon): the first hurt card that attacks heals the waiting amount first
  -- (after the downed / stunned checks, so a refused attack keeps the boon).
  if v_cardhp < v_maxhp then
    v_mend := take_player_effect(p_player, 'mend');
    if v_mend is not null then v_cardhp := least(v_maxhp, v_cardhp + greatest(1, round(v_mend))::int); end if;
  end if;
  -- the boss state of this member (hunt_combat_state, in the fight state)
  v_e := v_fight->'enemies'->0;
  v_enrage := (v_e->>'enr')::numeric; v_enr_until := (v_e->>'enru')::int; v_weaken := (v_e->>'wk')::numeric; v_wk_until := (v_e->>'wku')::int;
  v_expose := (v_e->>'ex')::numeric; v_exp_until := (v_e->>'exu')::int; v_stun_until := (v_e->>'st')::int; v_marks := v_fight->'marks';

  v_aeff := case when v_ability->>'kind' = 'attack' then v_ability->>'effect' else null end;   -- the answer key 'ability'

  for i in 0 .. jsonb_array_length(v_fight->'squad') - 1 loop
    v_x := v_fight->'squad'->>i;
    if v_x <> p_card::text then v_others := v_others || jsonb_build_array(v_facts->v_x->'tags'); end if;
  end loop;
  v_sq := combat_squad(v_tags, v_fight->'cards' ? p_card::text, v_others, v_weak);
  v_stack := (v_sq->>'stack')::int;
  v_wk := combat_weak(v_weak, v_resist, v_type, v_rarity, v_set, v_tags, v_stack);
  v_wm := (v_wk->>'wm')::int; v_rm := (v_wk->>'rm')::int; v_wmult := (v_wk->>'mult')::numeric;
  v_bonus := v_wm > 0;
  v_elem := v_sq->>'elem'; v_syn := (v_sq->>'syn')::int; v_synmult := (v_sq->>'synmult')::numeric;

  -- before_hit: the hit mods of the engine (focus, pierce, execute, rampage as data; no random()) in place of the effect names
  v_eng := combat_effect(v_fight, p_card, 'before_hit', '{"target_foe": 0}'::jsonb);
  v_critchance := combat_crit_chance_mods(v_bonus, v_eng->'mods', v_cmb);
  v_hit := combat_hit_core(v_cp, v_wmult, v_buff, v_debuff, v_synmult, v_critchance,
    combat_miss('shrouded' = any(v_plist)),                                          -- shrouded: more misses
    'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end,   -- Veil (hunt_boss_moves.sql)
    v_eng->'mods');
  v_miss := (v_hit->>'miss')::boolean; v_crit := (v_hit->>'crit')::boolean; v_block := (v_hit->>'block')::boolean;
  v_dmg := (v_hit->>'dmg')::int; v_outcome := v_hit->>'outcome'; v_double := (v_hit->>'double')::boolean;
  if not v_miss then
    -- Rally (a boon): the next hit deals +amount % (the boon is used up by this hit).
    v_rally := take_player_effect(p_player, 'rally');
    if v_rally is not null then v_dmg := greatest(1, round(v_dmg * (1 + least(v_rally, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Butterfingers (a prank, effects_outside.sql): the next hit deals -amount % (used up by this hit).
    v_bf := take_player_effect(p_player, 'butterfingers');
    if v_bf is not null and v_dmg > 0 then v_dmg := greatest(1, round(v_dmg * (1 - least(v_bf, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Launch Party (the Launch Day Player boon, launch_event_cards.sql): +amount % on each of the
    -- next N hits (options.uses), one charge per hit.
    v_party := use_effect_charge(p_player, 'launch_party');
    if v_party is not null then v_dmg := greatest(1, round(v_dmg * (1 + least((v_party->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Raid Crasher (the Launch Day Raider prank): the boss takes +amount % more on each of the next N
    -- hits, and that extra damage counts for the prankster (options.credit_to) on the leaderboard.
    v_crash := use_effect_charge(p_player, 'raid_crasher');
    if v_crash is not null then
      v_crash_dmg := greatest(1, round(v_dmg * least((v_crash->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))::int;
      v_crash_to := coalesce(v_crash->'options'->>'credit_to', v_crash->'options'->>'sender_id');
      v_crash_card := (v_crash->'options'->>'card_id')::bigint;
      -- No owner or no card (damage_log.sql): the extra damage still hits the boss, so the attacker gets the credit on
      -- the attacking card. Boss HP and hunt_hits then agree; the log row says fallback.
      if v_crash_to is null or v_crash_card is null then
        v_crash_to := p_player; v_crash_card := p_card; v_crash_fb := true;
      end if;
      v_crash_round := v_round;
    end if;
  end if;

  if v_dmg > 0 then
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
      values (p_hunt, p_player, p_card, v_day, v_dmg)
      on conflict (hunt_id, player_id, card_id, hit_date)
      do update set damage = hunt_hits.damage + excluded.damage;
    -- The Raid Crasher share: the prankster's own hunt_hits row (their Raider card), so it counts
    -- for the leaderboard and the prizes.
    if v_crash_dmg > 0 and v_crash_to is not null and v_crash_card is not null then
      insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
        values (p_hunt, v_crash_to, v_crash_card, v_day, v_crash_dmg)
        on conflict (hunt_id, player_id, card_id, hit_date)
        do update set damage = hunt_hits.damage + excluded.damage;
    end if;
    update hunts set hp_remaining = greatest(0, hp_remaining - v_dmg - v_crash_dmg),
      status      = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then now() else defeated_at end
      where id = p_hunt;
  end if;
  select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;

  v_heal := 0;
  -- on_hit (lifesteal as data; cap: lifesteal cannot out-heal the boss): only when the hit dealt damage and the card has an on_hit step (hit_on). The
  -- card as it stands now (Mend included; a first attack has no row yet).
  if v_dmg > 0 and v_hiton ? 'on_hit' then
    v_eng := combat_effect(v_fight || jsonb_build_object('cards', v_fight->'cards' || jsonb_build_object(p_card::text,
        coalesce(v_fight->'cards'->(p_card::text), '{"down": false, "shield": 0, "buff": 1, "debuff": 1, "cd": 0}'::jsonb)
        || jsonb_build_object('hp', v_cardhp, 'max', v_maxhp))),
      p_card, 'on_hit', jsonb_build_object('dealt', v_dmg, 'target_foe', 0));
    if v_eng->'log'->>'heal' is not null then
      v_heal := (v_eng->'log'->>'heal')::int;
      v_cardhp := (v_eng->'changes'->0->'set'->>'hp')::int;
    end if;
  end if;
  -- Counter marks on this attack (hunt_boss_moves.sql): Counter-pick (an empowered attack hurts the attacker by the
  -- bonus x counterpick.x) and Demotion (an attack on an exposed boss sends demotion.back back): balance boss_counters.
  if v_dmg > 0 and v_buff > 1 and hunt_mark_on(v_marks, 'counterpick', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(hunt_counter_num('counterpick', 'x') * v_dmg * (v_buff - 1) / v_buff))::int);
  end if;
  if v_dmg > 0 and v_exp_until >= v_round and v_expose > 0 and hunt_mark_on(v_marks, 'demotion', v_round)
     and not hunt_mark_on(v_marks, 'block_expose', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * hunt_counter_num('demotion', 'back')))::int);
  end if;
  v_ubuff := v_buff;   -- the empower this attack used (Tier List)
  -- after_attack: a buff until next_attack (empower) ends with this attack
  v_eng := combat_effect(v_fight, p_card, 'after_attack', '{}'::jsonb);
  v_buff := coalesce((v_eng->'changes'->0->'set'->>'buff')::numeric, v_buff);

  -- The boss ATK (Nathan, 2026-09-28: flat stats, so tougher cards survive more hits).
  -- hunts.stats.atk is set at spawn; an older hunt uses the tier default.
  v_atk := coalesce((v_stats->>'atk')::numeric, balance_num('boss_atk', v_tier));
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    update hunt_combat_state set round = round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
      returning round into v_round;
    -- Phase 1 below 50% HP: permanent rage. Frenzied: +5% per 10% of HP lost (combat_enemy_mult).
    v_lost := 1 - v_hp::numeric / greatest(1, v_hpmax);
    v_bmult := combat_enemy_mult(v_enrage, v_enr_until,
      case when hunt_mark_on(v_marks, 'block_weaken', v_round) then 0 else v_weaken end,   -- Alt-F4 (hunt_boss_moves.sql)
      v_wk_until, v_round, 'volatile' = any(v_plist), v_lost, 'frenzied' = any(v_plist));
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: + spiral.step for each weaken played
      v_bmult := v_bmult * (1 + coalesce((v_marks->'spiral'->>'bonus')::numeric, 0));
    end if;
    v_bheal := 0;

    -- The enemy turn (combat_core.sql: combat_enemy_act): a surprise draw.
    -- The damage-over-time marks tick first (hunt_boss_moves.sql: Infect, Nightshade).
    v_tick := hunt_counter_tick(p_hunt, p_player, v_day, p_card, v_round);
    if (v_tick->>'attacker')::int > 0 then
      v_ab := combat_absorb(v_shield, (v_tick->>'attacker')::int); v_shield := (v_ab->>'shield')::int;
      v_cardhp := greatest(0, v_cardhp - (v_ab->>'dmg')::int);
    end if;
    v_act := combat_enemy_act(v_atk, v_bmult, v_round, v_stun_until, v_lost, v_share);
    v_bossact := v_act->>'action'; v_cdmg := (v_act->>'dmg')::int; v_area := (v_act->>'area')::numeric;
    v_bheal := v_bheal + (v_act->>'heal')::int;
    -- A counter move (hunt_boss_moves.sql): a share of the normal turns of a boss with a move pool (balance boss_counters). An effect move comes on
    -- top of the usual turn (base); a hit move replaces it.
    v_pick := hunt_counter_pick(p_hunt, p_player, v_day, v_bname, v_bossact);
    if v_pick is not null then
      v_ctr := hunt_counter_act(p_hunt, p_player, v_day, p_card, v_round, v_atk, v_bmult, v_pick->>'key', v_pick->>'name',
        v_cardhp, v_maxhp, v_shield, v_ubuff);
      if v_ctr->>'shield' is not null then v_shield := (v_ctr->>'shield')::int; end if;
      if v_ctr->>'debuff' is not null then v_debuff := (v_ctr->>'debuff')::numeric; end if;
      v_cardhp := greatest(0, v_cardhp - (v_ctr->>'loss')::int);
      v_bheal := v_bheal + (v_ctr->>'heal')::int;
      if not (v_ctr->>'base')::boolean then   -- a hit move: no usual turn
        v_bheal := v_bheal - (v_act->>'heal')::int;
        v_bossact := 'counter'; v_area := 0; v_cdmg := (v_ctr->>'dmg')::int;
        if not (v_ctr->>'pierce')::boolean then
          v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
        end if;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      end if;
    end if;
    -- D-129 (Nathan, 2026-10-08) and D-132 (2026-10-09): the boss's SINGLE hit (strike, drain, stun) picks a RANDOM card of the
    -- WHOLE LOCKED SQUAD, the attacking card and the supports included, from the first attack of the day. A support can go
    -- down here (D-126: only in the Hunt and the Arena). The pool: the attacking card, and every card of today's locked squad
    -- (hunt_squads.card_ids) that is owned and not down. A squad card that has not acted yet has no hunt_card_hp row: it enters
    -- with full HP when it is hit (hunt_commit_card; if the cap refuses, the same insert, so the hit is never lost). With no
    -- locked squad (a member who never locked one) the pool is the attacking card and the cards that already have a row.
    -- Slam and Cataclysm keep their own targets (the attacking card takes the main hit, every other card WITH A ROW its own
    -- area hit), and so do the counter moves.
    v_rtgt := null; v_redir := null;
    if v_bossact in ('strike', 'drain', 'stun') then
      select card_ids into v_squad from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      select t.cid into v_rtgt from (select p_card as cid
          union select x from unnest(coalesce(v_squad, '{}'::bigint[])) x
            where x <> p_card
              and not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = x and h.downed)
              and exists (select 1 from player_cards pc where pc.player_id = p_player and pc.card_id = x and pc.quantity > 0)
          union select h.card_id from hunt_card_hp h
            where v_squad is null and h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card and not h.downed) t
        order by random() limit 1;
    end if;
    if v_rtgt is not null and v_rtgt <> p_card then   -- the hit lands on another card: it takes the hit (and the stun) instead
      if not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = v_rtgt) then
        -- D-132: a squad card that never acted enters with full HP (the HP rule of hunt_support: card_combat, a support card_max_hp(0))
        select pc.ascension, c.rarity::text, s.cp_mod, pc.stat_points, s.ability->>'kind'
          into v_rasc, v_rrar, v_rmod, v_rpts, v_rkind
          from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
          where pc.player_id = p_player and pc.card_id = v_rtgt;
        v_rmax := (card_combat(v_rrar, v_rasc, v_rmod, v_rpts)->>'hp')::int;
        if v_rkind = 'support' then v_rmax := card_max_hp(0); end if;
        if not hunt_commit_card(p_hunt, p_player, v_rtgt, v_day, v_rmax) then   -- refused (the daily card cap): the hit is not lost
          insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
            values (p_hunt, p_player, v_rtgt, v_day, v_rmax, v_rmax, false)
            on conflict (hunt_id, player_id, card_id, hit_date) do nothing;
        end if;
      end if;
      v_redir := hunt_counter_hit(p_hunt, p_player, v_day, v_rtgt, v_cdmg, false);
      if v_bossact = 'stun' then
        update hunt_card_hp set cd_until_round = greatest(coalesce(cd_until_round, 0), v_round + 1), updated_at = now()
          where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and card_id = v_rtgt;
      end if;
      v_cdmg := 0;
    elsif v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then
      v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
    end if;
    if v_area > 0 then   -- Slam / Cataclysm: every other card standing rolls its own hit
      with tgt as (
        select h.card_id, greatest(0, h.raw - coalesce(h.shield, 0)) as dmg,
               greatest(0, coalesce(h.shield, 0) - h.raw) as shleft
               from (select x.*, combat_area_roll(v_atk, v_area, v_bmult) as raw
                     from hunt_card_hp x
                     where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = v_day and x.card_id <> p_card and not x.downed) h
      ), upd as (
        update hunt_card_hp h set hp_remaining = greatest(0, h.hp_remaining - t.dmg),
            shield = t.shleft, downed = (h.hp_remaining - t.dmg) <= 0, updated_at = now()
        from tgt t where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = t.card_id
        returning h.card_id, h.hp_remaining, h.max_hp, h.downed, t.dmg
      )
      select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'dmg', dmg, 'hp', hp_remaining, 'max_hp', max_hp, 'downed', downed)), '[]'::jsonb)
        into v_slam from upd;
    end if;
    if v_bossact = 'enrage' then
      update hunt_combat_state set boss_enrage = balance_num('boss_moves', 'enrage_x'), enrage_until = v_round + balance_num('boss_moves', 'enrage_rounds')::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif v_bossact = 'curse' then
      v_debuff := balance_num('boss_moves', 'curse_x');
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + combat_regen(v_share); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - combat_thorns(v_dmg));
    end if;
    if v_bheal > 0 then
      update hunts set hp_remaining = least(hp_max, hp_remaining + v_bheal) where id = p_hunt and status = 'active'
        returning hp_remaining into v_hp;
    end if;
    -- Phase 2 below boss_moves.phase2_at HP: the boss gains one more passive (once per hunt).
    v_phase := null;
    if v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'phase2_at') and not coalesce((v_passive->>'phase2')::boolean, false) then
      select k into v_extra from unnest(passives_for('phase2')) k
        where k <> all(v_plist) order by random() limit 1;
      update hunts set passive = coalesce(passive, '{}'::jsonb) || jsonb_build_object('phase2', true,
          'list', coalesce(passive->'list', '[]'::jsonb) || case when v_extra is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('kind', v_extra, 'label', passive_label(v_extra))) end)
        where id = p_hunt;
      v_phase := coalesce(v_extra, 'phase2');
    elsif (v_hp + v_dmg)::numeric / greatest(1, v_hpmax) >= balance_num('boss_moves', 'rage_at') and v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'rage_at') then
      v_phase := 'rage';                            -- this hit took the boss below rage_at
    end if;
  end if;

  -- Flaming boss: a chance the attacking card catches burn after acting.
  v_burned := false;
  if 'flaming' = any(v_plist) and v_status <> 'defeated' then
    v_burn := combat_burn(v_atk);
    if v_burn > 0 then
      v_ab := combat_absorb(v_shield, v_burn); v_shield := (v_ab->>'shield')::int; v_burn := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_burn); v_burned := v_burn > 0;
    end if;
  end if;

  v_downed := v_cardhp <= 0;
  v_counter := v_bossact is not null and v_bossact not in ('stunned', 'enrage', 'curse', 'regenerate', 'charging');

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, dmg_buff, dmg_debuff, shield, cd_until_round)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed, v_buff, v_debuff, v_shield,
            case when v_bossact = 'stun' and v_redir is null then v_round + 1 else 0 end)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed,
      dmg_buff = excluded.dmg_buff, dmg_debuff = excluded.dmg_debuff, shield = excluded.shield,
      cd_until_round = greatest(excluded.cd_until_round, hunt_card_hp.cd_until_round), updated_at = now();

  insert into hunt_combat_log (hunt_id, player_id, card_id, cp, outcome, bonus, crit, block,
    damage, countered, counter_dmg, card_hp_after, card_downed, boss_hp_after)
  values (p_hunt, p_player, p_card, v_cp, v_outcome, v_bonus, v_crit, v_block,
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp)
  returning id into v_clog;

  -- The Hunt Crasher log row (damage_log.sql): the extra damage that hunt_hits credits to the prankster's Raider card.
  -- amount = the charge amount (%), result.value = the damage, combat_log_id = the attack it rode on.
  if v_dmg > 0 and v_crash_dmg > 0 then
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)
    values ('hunt', p_hunt, v_crash_to, v_crash_card, 'effect', v_day, v_crash_round, 'raid_crasher', (v_crash->>'amount')::numeric,
      jsonb_build_object('value', v_crash_dmg, 'attacker', p_player, 'attack_card', p_card, 'combat_log_id', v_clog, 'fallback', v_crash_fb));
  end if;

  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  select coalesce((select value #>> '{}' from settings where key = 'hunt_attack_feed'), 'milestones') into v_feed;
  v_milestone := v_crit or v_downed;
  if v_status <> 'defeated' and not v_miss and (v_feed = 'all' or (v_feed = 'milestones' and v_milestone)) then
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'attack', jsonb_build_object('player_id', p_player, 'card', v_cardname,
        'damage', v_dmg, 'outcome', v_outcome, 'crit', v_crit, 'bonus', v_bonus, 'downed', v_downed));
  end if;

  -- The end-of-day summary (hunt_squad_done.sql): when every attacker of the locked squad is down,
  -- once per member per day. It needed 8 cards used, so a short squad (or the old squad bug) never posted.
  -- The round limit also ends the squad, so its summary posts then too (hunt_loop_caps.sql).
  if v_status <> 'defeated' and ((v_downed and hunt_squad_done(p_hunt, p_player, v_day, v_cap)) or v_round >= v_rcap)
     and not exists (select 1 from hunt_events where hunt_id = p_hunt and kind = 'player_done'
                       and payload->>'player_id' = p_player and created_at >= (v_day::timestamp at time zone 'America/Denver')) then
    select coalesce(sum(damage), 0), count(distinct card_id) into v_total, v_used
      from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    select c.name, sub.d into v_topcard, v_topdmg
      from (select card_id, sum(damage) d from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
            group by card_id order by d desc limit 1) sub join cards c on c.id = sub.card_id;
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'player_done', jsonb_build_object('player_id', p_player,
        'total', v_total, 'cards_used', v_used, 'top_card', v_topcard, 'top_damage', v_topdmg,
        'boss_hp', v_hp, 'boss_hp_max', v_hpmax));
  end if;

  v_targets := case when v_redir is null then '[]'::jsonb else jsonb_build_array(v_redir) end   -- the HIT card is targets[0] (the client marks a stun / curse on targets[0])
      || jsonb_build_array(jsonb_build_object('card_id', p_card, 'dmg', v_cdmg,
      'hp', v_cardhp, 'max_hp', v_maxhp, 'downed', v_downed)) || coalesce(v_slam, '[]'::jsonb) || coalesce(v_tick->'targets', '[]'::jsonb)
      || coalesce(v_ctr->'targets', '[]'::jsonb);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'resisted', v_rm > 0, 'crit', v_crit, 'cp', v_cp, 'heal', v_heal, 'ability', v_aeff,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'round', v_round, 'round_cap', v_rcap,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed, 'shield', v_shield,
    'burned', v_burned, 'double', v_double, 'rally', v_rally, 'butterfingers', v_bf, 'mend', v_mend, 'party', v_party->'amount', 'crashed', nullif(v_crash_dmg, 0), 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
    'synergy', case when v_syn >= balance_num('combat', 'syn_small_at') then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', case when v_bossact = 'counter' then v_ctr->>'anim' else v_bossact end, 'round', v_round, 'targets', v_targets)
        || case when v_ctr is null then '{}'::jsonb else jsonb_build_object('move', v_ctr->>'move', 'counter', v_ctr->>'key') end end);
end $function$;
CREATE OR REPLACE FUNCTION public.hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int; v_sdown boolean;
  v_status text; v_closes timestamptz; v_tier text; v_hp bigint;
  v_qty int; v_type text; v_ability jsonb; v_eff text; v_amt numeric; v_cd int; v_tgt text;
  v_day date; v_round int; v_cd_until int; v_maxhp int;
  v_srar text; v_sasc int; v_smod numeric; v_spts jsonb; v_scmb jsonb;
  v_aff text; v_affcount int := 0; v_matched boolean := false;
  v_settle jsonb; v_ctr text[] := '{}';
  v_hpmax bigint; v_passive jsonb; v_pl jsonb; v_fight jsonb; v_eng jsonb; v_l jsonb; v_ch jsonb; i int;   -- f3_engine_hunt.sql: the boss row, the fight state, the engine answer
begin
  select status, closes_at, tier, hp_remaining, hp_max, passive into v_status, v_closes, v_tier, v_hp, v_hpmax, v_passive from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  -- R3-ON (combat_v2_on_hunt.sql): the Hunt is combat v2 for everyone with the flag ON; a live v2 day of today keeps v1 off (also after a rollback)
  if combat_v2_on('hunt') then return jsonb_build_object('ok', false, 'error', 'v2_on'); end if;   -- R3-ON
  if exists (select 1 from hunt_v2_days d where d.hunt_id = p_hunt and d.player_id = p_player and d.day = (now() at time zone 'America/Denver')::date and d.live) then   -- R3-ON
    return jsonb_build_object('ok', false, 'error', 'v2_today'); end if;   -- R3-ON

  select pc.quantity, s.type, s.ability, c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points
    into v_qty, v_type, v_ability, v_srar, v_sasc, v_smod, v_spts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_ability is null or v_ability->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;

  v_eff := v_ability->>'effect';
  -- Potency points of this support copy make its effect stronger (1 with the flag off): the engine reads them from the fight state.
  v_scmb := card_combat(v_srar, v_sasc, v_smod, v_spts);
  -- F-3: Haste points shorten the cooldown (combat_cooldown: never below 1 round).
  v_cd  := combat_cooldown(coalesce((v_ability->>'cooldown')::int, 1), (v_scmb->>'haste')::numeric);
  v_tgt := coalesce(v_ability->>'target', 'boss');
  v_aff := v_ability->>'affinity';
  v_day := (now() at time zone 'America/Denver')::date;
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then -- hunt_squads.sql
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  v_round := hunt_state_round(p_hunt, p_player, v_day);

  -- The round limit (hunt_loop_caps.sql).
  v_rcap := hunt_round_cap();
  if v_round >= v_rcap then return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap); end if;
  select cd_until_round, downed or hp_remaining <= 0 into v_cd_until, v_sdown from hunt_card_hp
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  -- A support card that is down does nothing (hunt_loop_caps.sql: a downed heal card kept a squad alive).
  if coalesce(v_sdown, false) then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  if found and v_round < coalesce(v_cd_until, 0) then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', v_cd_until, 'round', v_round);
  end if;

  v_maxhp := card_max_hp(0);   -- a support card: the HP floor (60 since hunt_launch_balance.sql)
  if not hunt_commit_card(p_hunt, p_player, p_card, v_day, v_maxhp) then
    return jsonb_build_object('ok', false, 'error', 'day_limit');
  end if;

  -- F-3 4d (f3_engine_hunt.sql): the effect engine (ability_kinds, docs/f3-effect-engine.md 2.5-2.6) in place of the effect branches and the counters.
  -- The fight state comes from the rows read above (the locked boss row, the passives, this support copy) and ONE statement over the committed cards
  -- (hunt_fight_state_info). The engine keeps the Hunt rules: Packet Loss first, the affinity count over the committed cards, the ally target committed
  -- with full HP (after Packet Loss; over the daily cap it gets no row), every counter passive and mark, the refusals in the old order.
  select coalesce(jsonb_agg(x->>'kind'), '[]'::jsonb) into v_pl from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;   -- passive.list (as before)
  v_fight := hunt_fight_state_info(p_hunt, p_player, v_day,
    jsonb_build_object('hp', v_hp, 'max', v_hpmax, 'status', v_status, 'tier', v_tier, 'passives', v_pl), null,
    p_card, jsonb_build_object('ability', v_ability, 'potency', v_scmb->'potency', 'haste', v_scmb->'haste'),
    case when v_tgt in ('ally', 'self') then p_target end);
  v_eng := combat_effect(v_fight, p_card, 'use', jsonb_build_object('target_card', p_target));
  if not (v_eng->>'ok')::boolean then return v_eng; end if;
  v_l := v_eng->'log';
  -- The boss HP is a change of the shared hunts row, which this call holds FOR UPDATE: it is written as a delta (dhp) to the locked row.
  v_ch := v_eng->'changes';
  for i in 0 .. jsonb_array_length(v_ch) - 1 loop
    if v_ch->i->>'op' = 'enemy' and v_ch->i->'set' ? 'hp' then
      v_ch := jsonb_set(v_ch, array[i::text, 'set'], ((v_ch->i->'set') - 'hp')
        || jsonb_build_object('dhp', (v_ch->i->'set'->>'hp')::bigint - (v_fight->'enemies'->0->>'hp')::bigint));
    end if;
  end loop;
  perform hunt_effect_apply(p_hunt, p_player, v_day, v_ch);
  if coalesce((v_eng->>'nullified')::boolean, false) then   -- Packet Loss (1) / Shadow Ban (2): this play does nothing
    update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
      values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, (v_l->>'amount')::numeric, case when v_tgt in ('ally', 'self') then p_target end,
              jsonb_build_object('nullified', true, 'countered', v_l->'countered'));
    return jsonb_build_object('ok', true, 'effect', v_eff, 'nullified', true, 'countered', v_l->'countered',
      'ready_round', v_round + v_cd, 'round', v_round, 'boss_hp', (select hp_remaining from hunts where id = p_hunt), 'defeated', false);
  end if;
  v_amt := (v_l->>'amount')::numeric; v_matched := (v_l->>'matched')::boolean; v_affcount := (v_l->>'aff_count')::int;
  v_ctr := array(select jsonb_array_elements_text(v_l->'countered'));
  -- The killing Smite: settle once + the same 'defeat' notification as hunt_attack (2026-10-03).
  if coalesce((v_l->>'kill')::boolean, false) then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  -- The action log (combat_actions.sql, Nathan 2026-10-06): every support play that worked, for the balance data. The values come from the engine log.
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
  values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, v_amt,
    case when v_tgt in ('ally', 'self') then p_target end,
    jsonb_build_object('gained', v_l->'gained', 'mirrored', 'mirror' = any(v_ctr), 'countered', v_l->'countered',
      'scale', v_l->'scale', 'matched', v_l->'matched', 'aff_count', v_l->'aff_count', 'affinity', v_l->'affinity', 'cooldown', v_cd,
      'value', v_l->'value',
      'target_after', (select jsonb_build_object('hp', h.hp_remaining, 'max_hp', h.max_hp, 'shield', h.shield, 'dmg_buff', h.dmg_buff, 'downed', h.downed)
        from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)));

  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'affinity', v_aff, 'aff_count', v_affcount, 'matched', v_matched,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated')
    || case when cardinality(v_ctr) > 0 then jsonb_build_object('countered', to_jsonb(v_ctr)) else '{}'::jsonb end;
end $function$;

-- ============================================================ 9. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['hunt_v2_credit(jsonb, jsonb, numeric)', 'hunt_v2_shared(bigint, text, date, jsonb)', 'hunt_v2_live_credit(bigint, text, date, jsonb)',
      'hunt_v2_day_json(public.hunt_v2_days)', 'hunt_v2_start(text, bigint[])', 'hunt_v2_turns(text, jsonb, boolean, integer)', 'hunt_v2_view(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.hunt_v2_credit(jsonb, jsonb, numeric) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON): the credit of one call: each decrease of the private boss HP in the call log (heals not credited) x the scale (hunts.hp_max / the private boss max); an act decrease to its card, any other decrease (a tick) to the first squad card; per card the largest remainder rule. Returns {total, cards}. Pure. combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_shared(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON): the shared write of a live call with a credit: hunts FOR NO KEY UPDATE, the status and the close time again (closed: no write, over), then hunt_hits per card (the v1 rule), the boss HP (stops at 0), one hunt_combat_log row per credited card, credited; only the call that defeats the boss settles it (settle_hunt) and writes the defeat event. combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_live_credit(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON): the credit and the shared write of one call of a LIVE day (the row mark, never the flag); a closed Hunt ends the day as hunt_over. combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_day_json(public.hunt_v2_days) is $cm$[combat] Combat v2 Hunt practice (20.19 R3, 20.21 R3-ON): the screen fields of a day row (hunt_id, day, boss, squad, status, ended_by, damage, steps, start_hp, started_at, ended_at, live, credited); null for no row. Pure. combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_start(text, bigint[]) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, server only, route): starts the Hunt day of a member (flag combat_v2.hunt ON: everyone, a live day) or of a tester (flag OFF: the R3a practice; no active Hunt: the newest ended Hunt, live frac 1). A live start: hunts FOR KEY SHARE first, then players FOR UPDATE; refuses v1_today; writes downed hunt_card_hp bridge rows; credits a boss HP decrease of its first step. The auto-pick ranks the dungeon_v2_unit stats with the fight speed. combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_turns(text, jsonb, boolean, integer) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON): the body of hunt_v2_act and hunt_v2_auto: the day of today (locked), no_day, not_fighting, hunt_over (a practice against an ended Hunt plays on), dungeon_v2_play, the save, then the credit of a LIVE day (the mark). combat_v2_on_hunt.sql.$cm$;
comment on function public.hunt_v2_view(text) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, server only, route): the Hunt screen in v2: tester, live (the flag), practice, hunt (live_frac = the shared boss bar), the boss card, today's day row (live, credited), can_start (the flag or a tester; a tester with no active Hunt can practise against the newest ended one) and the screen fields of an active day. combat_v2_on_hunt.sql.$cm$;

notify pgrst, 'reload schema';
