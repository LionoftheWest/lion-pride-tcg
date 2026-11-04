-- combat_v2_on_dungeon.sql (2026-11-04): combat v2 step R2-ON, the Dungeon in combat v2 for every member
-- (pipeline item ON SPEC v6.1 section 3.3 "R2-ON", gate 6.2 DO1-DO10; docs/combat-redesign-plan.md 20.19b).
-- Needs combat_v2_dungeon_run.sql (R2a), combat_v2_gauntlet_run.sql (R1b: its dailies_tasks text) and, for the live level of N-7b,
-- combat_v2_convert.sql (M1e: the balance key v2_convert.level_per_star; read only while combat_v2_on('progress') is true).
-- Before: a v2 Dungeon run is a tester run with 0 loot, an extra run, in its own table; the board, the prizes, the daily task and the stale
--   settle read dungeon_runs only; the v1 start does not know v2.
-- After this file:
--   dungeon_v2_runs gets live (the mark, INV-ON-1: the run started while combat_v2_on('dungeon') was true), shards, cards, settled_at.
--   A live run gets the v1 loot with the v1 functions and keys: the kill rule per foe (dungeon_after_kill on a shim), the guardian floor
--     Shards and pend -> bank, the v1 chest, the v1 offer pool with shards and card. A tester run (live false) keeps the R2a rules (0 loot).
--   Every end (fell, cleared, retreat, abandoned at the next start or by dungeon_settle_stale) goes through dungeon_v2_settle: one ledger row
--     per grant (shards ref run_v2 + id, cards ref dungeon_v2_run + id), the run row gets shards, cards, settled_at; a second settle grants 0.
--   One run a day across v1 and v2: a live start counts the v1 daily runs and the live v2 runs of today; dungeon_start refuses v2_on while
--     the flag is on and already when a live v2 run of today exists (also after a rollback, review H-2).
--   dungeon_board: the v1 daily runs and the live v2 runs of the day, then one row per player (the best); dungeon_pay('daily') reads it.
--   dailies_tasks: the dungeon task counts a live v2 run of today.
--   dungeon_v2_unit: with combat_v2_on('progress'), the live level (N-7b: v2_convert.level_per_star x the current stars, at most
--     v2_level.max_level), the points and the bonus of the card_progress_v2 row (none: 0).
-- NO CHANGE IN PLAY: the flags stay false. With all flags off every v1 answer and every tester answer is the R2a / v1 answer. Idempotent.
-- Test: card-studio/scripts/test-combat-v2-on-dungeon.mjs (rolled back; MUTATE=all must catch every mutation).

-- GUARD (the runs_per_day.sql rule): each replaced function must be the text this file was built from (or the text this file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.dungeon_v2_unit(text, bigint, jsonb)', '0477eca57b5b001075aae0213441d4a2', '6578aa1258c8efc73fa9749c1f68c964'),
    ('public.dungeon_v2_end(bigint, text)', '5123880c61271af938f96c43467bc398', '279bd670f9ea98efcf1df1a7f95cf523'),
    ('public.dungeon_v2_start(text, bigint[])', 'e63a9f59d6cda733388d813a5c7eeca9', '30bf4ab022c0b01ca266658523527750'),
    ('public.dungeon_v2_retreat(text)', '42285e6fbb2e9af2a72649d99cf3d937', '122ed8f33b43442ce695727edeb0ce51'),
    ('public.dungeon_v2_room(jsonb, jsonb, integer, integer, text)', 'be06c31e5ae17890a6c0afe804e19e81', 'e76d4fe95cb876310abbc4fdb2b6ae26'),
    ('public.dungeon_v2_pick(jsonb, jsonb, integer)', '49184bcf28db0b9fc9d14fa724df9802', '322d8deba470b9cee13eda6beb0489b4'),
    ('public.dungeon_v2_after(jsonb, jsonb, integer, integer)', '4990b85cefa7591d3fd9f6caf05f9b9d', 'da429cdcc3cc3bcf5ce0f69438eebc05'),
    ('public.dungeon_v2_view(text)', '21e697fad51339b90534ddda03cc13fa', 'b93a25ffb303a04ba8e04d1370238cc6'),
    ('public.dungeon_board(date, integer)', '5f00c4c5b2d9f1043548d8819e91a78f', '8b264276f88dfc16c33d4be311f2e2f6'),
    ('public.dungeon_settle_stale()', '427240d67aa2e15e078f7d18db7ea414', '94d1e189c230092aa4f3b9bc494b137a'),
    ('public.dailies_tasks(text)', 'd8ec8b9f34bfae2432bd15cadab8a8d6', '48a62a301434f4e87f03d9815cf5c899'),
    ('public.dungeon_start(text, bigint[])', 'e7a308246d6e7cf0fc5905742b5a1fbe', '9cb2a6d28e107d62658087d97d581ce5')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_on_dungeon.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the run row: the live mark and the settled loot
alter table public.dungeon_v2_runs add column if not exists live boolean not null default false;
alter table public.dungeon_v2_runs add column if not exists shards int not null default 0;
alter table public.dungeon_v2_runs add column if not exists cards bigint[] not null default '{}';
alter table public.dungeon_v2_runs add column if not exists settled_at timestamptz;
do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'dungeon_v2_runs_shards_check' and conrelid = 'public.dungeon_v2_runs'::regclass) then
    alter table public.dungeon_v2_runs add constraint dungeon_v2_runs_shards_check check (shards >= 0);
  end if;
end $ck$;
comment on column public.dungeon_v2_runs.live is $cm$The mark (INV-ON-1): true when the run started while combat_v2_on('dungeon') was true (every member). A live run gets the v1 loot, counts for the board, the prizes and the daily task. False = a tester run (0 loot). Readers read this mark, never the flag.$cm$;
comment on column public.dungeon_v2_runs.shards is $cm$The Shards that dungeon_v2_settle granted for this run (= the sum of its shard_ledger rows, ref run_v2 + id). 0 for a tester run and before the settle.$cm$;
comment on column public.dungeon_v2_runs.cards is $cm$The card ids that dungeon_v2_settle granted for this run (one card_ledger row each, ref dungeon_v2_run + id). Empty for a tester run and before the settle.$cm$;
comment on column public.dungeon_v2_runs.settled_at is $cm$When dungeon_v2_settle ended the run (fell, cleared, retreat, abandoned). Set once: a second settle grants nothing. Null while active.$cm$;

-- ============================================================ 2. the card unit: the converted progress when combat_v2_on('progress') (N-7b)
create or replace function public.dungeon_v2_unit(p_player text, p_card bigint, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']));
  u jsonb; r record; cc jsonb; g public.card_progress_v2%rowtype; lvl int;
begin
  -- the R1a unit (after SYN it carries tags); a card with no usable ability_v2 raises no_data_found here (D2, QD4)
  u := combat_v2_card_unit(p_card, b);
  select c.rarity::text as rarity, s.cp_mod, coalesce(pc.ascension, 0) as stars into r
    from public.cards c join public.subjects s on s.id = c.subject_id
    left join public.player_cards pc on pc.card_id = c.id and pc.player_id = p_player
   where c.id = p_card;
  if combat_v2_on('progress') then
    -- N-7b: the live level = v2_convert.level_per_star x the CURRENT stars, at most v2_level.max_level, read at each fight;
    -- the points and the bonus points of the card_progress_v2 row of the card (no row: 0)
    lvl := least(balance_num('v2_level', 'max_level'), balance_num('v2_convert', 'level_per_star') * r.stars)::int;
    select * into g from public.card_progress_v2 where player_id = p_player and card_id = p_card;
    cc := card_combat_v2(r.rarity, r.stars, r.cp_mod, lvl,
      jsonb_build_object('atk', coalesce(g.atk_pts, 0), 'def', coalesce(g.def_pts, 0), 'hp', coalesce(g.hp_pts, 0), 'crd', coalesce(g.crd_pts, 0),
        'crt', coalesce(g.crt_pts, 0), 'abl', coalesce(g.abl_pts, 0), 'ddg', coalesce(g.ddg_pts, 0), 'acc', coalesce(g.acc_pts, 0), 'spd', coalesce(g.spd_pts, 0)),
      u->>'role', b, coalesce(g.bonus_points, 0));
  else
    -- QD3: the player's stars count, level 0, no points; only the star-dependent stat keys change
    cc := card_combat_v2(r.rarity, r.stars, r.cp_mod, 0, '{}'::jsonb, u->>'role', b);
  end if;
  return u || jsonb_build_object('atk', cc->'stats'->'atk', 'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'abl', cc->'stats'->'abl',
    'acc', cc->'stats'->'acc', 'def', cc->'stats'->'def', 'ddg', cc->'stats'->'ddg', 'max', cc->'stats'->'hp', 'hp', cc->'stats'->'hp',
    'spd', coalesce(cc->'points'->'spd', '0'::jsonb), 'power', cc->'power', 'extra_stack', cc->'extra_stack');
end $fn$;

-- ============================================================ 3. the settle: every end of a v2 run (review M-1)
create or replace function public.dungeon_v2_settle(p_run bigint, p_how text, p_with_pend boolean) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_v2_runs; v_sh int := 0; v_cards jsonb := '[]'::jsonb; x jsonb;
begin
  select * into r from dungeon_v2_runs where id = p_run for update;
  if not found then raise exception 'dungeon_v2_settle: no run %', p_run; end if;
  -- once: a settled (or ended) run returns its stored result and grants nothing
  if r.settled_at is not null or r.status <> 'active' then return jsonb_build_object('shards', r.shards, 'cards', to_jsonb(r.cards), 'again', true); end if;
  if r.live then
    -- the v1 settle rule (dungeon_settle): the bank, and the pend only when p_with_pend (fell, retreat, abandoned lose it)
    v_sh := coalesce((r.state->'bank'->>'shards')::int, 0) + case when p_with_pend then coalesce((r.state->'pend'->>'shards')::int, 0) else 0 end;
    v_cards := coalesce(r.state->'bank'->'cards', '[]'::jsonb) || case when p_with_pend then coalesce(r.state->'pend'->'cards', '[]'::jsonb) else '[]'::jsonb end;
    if v_sh > 0 then perform grant_shards(r.player_id, v_sh, 'dungeon', 'run_v2', r.id::text); end if;
    for x in select e from jsonb_array_elements(v_cards) e loop
      perform card_move(r.player_id, (x #>> '{}')::bigint, 1, 'dungeon_loot', 'dungeon_v2_run', r.id::text, 'dungeon');
    end loop;
  end if;
  update dungeon_v2_runs set status = 'over', ended_by = p_how, ended_at = now(), settled_at = now(), shards = v_sh,
    cards = coalesce(array(select (e #>> '{}')::bigint from jsonb_array_elements(v_cards) e), '{}'),
    state = state || case when r.live and not p_with_pend then jsonb_build_object('lost', state->'pend') else '{}'::jsonb end
  where id = r.id;
  return jsonb_build_object('shards', v_sh, 'cards', v_cards, 'again', false);
end $fn$;

-- the end of a run in a fight (fell, cleared): the settle (the v1 flags: fell loses the pend, cleared keeps it)
create or replace function public.dungeon_v2_end(p_run bigint, p_phase text) returns void
language plpgsql set search_path = public as $fn$
begin
  if p_phase in ('fell', 'cleared') then
    perform dungeon_v2_settle(p_run, p_phase, p_phase = 'cleared');
  end if;
end $fn$;

-- ============================================================ 4. the loot of a won fight room of a live run (the v1 functions)
create or replace function public.dungeon_v2_loot(p_state jsonb, p_fight jsonb, p_floor int) returns jsonb
language plpgsql set search_path = public as $fn$
declare rr dungeon_runs; sh jsonb; n int := jsonb_array_length(coalesce(p_fight->'enemies', '[]'::jsonb)); i int; o jsonb;
begin
  -- the v1 run of the day (dungeon_after_kill reads its floor and, through dungeon_run_floors, the floors of its day)
  rr.mode := 'daily'; rr.floor := p_floor; rr.day := (p_state->>'day')::date;
  -- the shim: the v1 state keys that dungeon_after_kill, dungeon_loot and dungeon_offers read (the carry as the cards)
  sh := jsonb_build_object('mode', 'daily', 'cards', p_state->'carry', 'bank', p_state->'bank', 'pend', p_state->'pend',
    'last_pick', p_state->'last_pick', 'heal_floor', p_state->'heal_floor', 'room_type', p_state->'room_type');
  -- one v1 kill per foe of the fight (each foe is down when the fight is won), the last kill clears the room
  for i in 1 .. n loop
    sh := sh || jsonb_build_object('foes', (select jsonb_agg(jsonb_build_object('hp', case when k <= i then 0 else 1 end)) from generate_series(1, n) k));
    sh := dungeon_after_kill(rr, sh)->'state';
  end loop;
  o := sh->'offers';
  if sh->>'phase' = 'choose' and jsonb_array_length(coalesce(o, '[]'::jsonb)) = 0 then o := jsonb_build_array(jsonb_build_object('kind', 'continue')); end if;
  return p_state || jsonb_build_object('bank', sh->'bank', 'pend', sh->'pend', 'phase', sh->>'phase', 'offers', coalesce(o, '[]'::jsonb))
    || case when sh ? 'floor_loot' then jsonb_build_object('floor_loot', sh->'floor_loot') else '{}'::jsonb end;
end $fn$;

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
  if won and coalesce((st->>'live')::boolean, false) then
    -- R2-ON: a live run gets the v1 loot of the room (the kills, the guardian floor Shards and the bank, the v1 offer pool)
    return dungeon_v2_loot(st, f, p_floor);
  end if;
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

-- ============================================================ 5. enter a room: {state, step}; a live run gets the v1 chest
create or replace function public.dungeon_v2_room(p_state jsonb, p_floors jsonb, p_floor int, p_room int, p_key text) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  b jsonb := combat_v2_enemy_numbers(); rm jsonb; t text; st jsonb; f jsonb; r jsonb; x text; c jsonb; n int := jsonb_array_length(p_floors);
  v_t int; v_sh int; e jsonb; ch jsonb;
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
  -- the chest and the floor loot of the room before end with it (dungeon_enter, dungeon_choose)
  st := (p_state - 'fight' - 'offers' - 'turn' - 'door' - 'chest' - 'floor_loot') || jsonb_build_object('room_type', t);
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
  elsif coalesce((st->>'live')::boolean, false) then
    -- R2-ON, a live run: the v1 chest (the loot goes to pend, at risk until the floor is cleared)
    if p_key is not null and p_state->>'door' = 'gamble' then
      -- the rare result of the gamble door (dungeon_choose): a chest of tier door.rare_tier
      v_t := balance_num('dungeon_rewards', 'door', 'rare_tier')::int;
      v_sh := dungeon_chest_shards(v_t, p_floor);
      st := dungeon_loot(st, v_sh, dungeon_card_of(dungeon_chest_rarity(v_t)));
      ch := jsonb_build_object('tier', v_t, 'shards', v_sh, 'card', st->'pend'->'cards'->-1);
    else
      -- a treasure room of the floor map, or the treasure door (dungeon_choose: a one-room floor): dungeon_enter on a shim
      e := dungeon_enter(jsonb_build_object('mode', 'daily', 'cards', '{}'::jsonb, 'bank', st->'bank', 'pend', st->'pend'),
        case when p_key is null then p_floors else jsonb_build_array(jsonb_build_array(jsonb_build_object('type', 'treasure', 'foes', '[]'::jsonb))) end,
        case when p_key is null then p_floor else 1 end, case when p_key is null then p_room else 1 end);
      st := st || jsonb_build_object('pend', e->'pend');
      ch := e->'chest';
    end if;
    st := st || jsonb_build_object('room_type', 'treasure', 'phase', 'pass', 'chest', ch, 'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  else
    -- treasure (QD1: 0 loot): an empty chest pass room, no chest, one continue
    st := st || jsonb_build_object('room_type', 'treasure', 'phase', 'pass', 'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  end if;
  return jsonb_build_object('state', st, 'step', null);
end $fn$;

-- ============================================================ 6. an offer between rooms; a live run also gets the v1 shards and card offers
create or replace function public.dungeon_v2_pick(p_state jsonb, p_offer jsonb, p_floor int) returns jsonb
language plpgsql set search_path = public as $fn$
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
  elsif k = 'shards' and coalesce((st->>'live')::boolean, false) then
    -- R2-ON (dungeon_choose): the Shards of the offer go to pend
    st := dungeon_loot(st, amt::int, null);
  elsif k = 'card' and coalesce((st->>'live')::boolean, false) then
    -- R2-ON (dungeon_choose): a card of the offer tier odds goes to pend
    st := dungeon_loot(st, 0, dungeon_card_of(dungeon_chest_rarity(coalesce((p_offer->>'tier')::int, 1))));
  end if;
  if k <> 'continue' then st := st || jsonb_build_object('last_pick', k); end if;
  return st;
end $fn$;

-- ============================================================ 7. the start: every member when the flag is on; one run a day across v1 and v2
create or replace function public.dungeon_v2_start(p_player text, p_cards bigint[]) returns jsonb
language plpgsql set search_path = public as $fn$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d dungeon_days; g jsonb; v_n int := balance_num('dungeon', 'squad')::int;
  v_cost int := 0; v_budget int; c jsonb; x bigint; v_att int := 0; v_runs int; v_last int; v_active int; bad bigint[] := '{}';
  v_units jsonb := '{}'; v_info jsonb := '{}'; st jsonb; e jsonb; v_id bigint; n int; v_live boolean;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  -- the mark (INV-ON-1): the flag at the start; with the flag off only a tester starts (a tester run, 0 loot)
  v_live := combat_v2_on('dungeon');
  if not v_live and not combat_v2_on('dungeon', p_player) then return jsonb_build_object('ok', false, 'error', 'not_tester'); end if;
  perform 1 from players where id = p_player for update;
  -- each active v2 run of an earlier day settles as abandoned (the bank only, review M-1)
  perform dungeon_v2_settle(id, 'abandoned', false) from dungeon_v2_runs where player_id = p_player and status = 'active' and day < v_day;
  if v_live then
    -- a v1 daily run of an earlier day settles as dungeon_start does (abandoned, the bank only: 3.6)
    perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day and mode = 'daily';
    -- one run a day across v1 and v2 (INV-ON-3): the v1 daily runs and the live v2 runs of today, one active run at a time
    select count(*) filter (where live), coalesce(max(attempt), 0), count(*) filter (where status = 'active') into v_runs, v_last, v_active
      from dungeon_v2_runs where player_id = p_player and day = v_day;
    select v_runs + count(*), v_active + count(*) filter (where status = 'active') into v_runs, v_active
      from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  else
    -- QD2: an extra run; the count of today is the v2 table only (game_var dungeon_runs_per_day, one active run at a time)
    select count(*), coalesce(max(attempt), 0), count(*) filter (where status = 'active') into v_runs, v_last, v_active
      from dungeon_v2_runs where player_id = p_player and day = v_day;
  end if;
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
  -- a live run: the mark, the day (the v1 loot functions read the floors of the day) and the v1 bank and pend
  if v_live then
    st := st || jsonb_build_object('live', true, 'day', v_day, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
      'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb));
  end if;
  e := dungeon_v2_room(st, d.floors, 1, 1, null);
  st := (e->'state') || jsonb_build_object('last', jsonb_build_object('kind', 'start', 'event', e->'step'->'event', 'won', e->'step'->'won', 'log', e->'step'->'log'));
  insert into dungeon_v2_runs (player_id, day, squad, state, attempt, live) values (p_player, v_day, p_cards, st, v_last + 1, v_live) returning id into v_id;
  perform dungeon_v2_end(v_id, st->>'phase');
  return dungeon_v2_out(v_id, jsonb_build_object('engine', '2'::jsonb, 'event', e->'step'->'event', 'won', e->'step'->'won', 'actor', e->'step'->'actor',
    'steps_left', e->'step'->'steps_left', 'played', 0, 'log', coalesce(e->'step'->'log', '[]'::jsonb), 'hp_changes', coalesce(e->'step'->'hp_changes', '[]'::jsonb)));
end $fn$;

create or replace function public.dungeon_v2_retreat(p_player text) returns jsonb
language plpgsql set search_path = public as $fn$
declare r dungeon_v2_runs; s jsonb;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_v2_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' is distinct from 'floor_done' then return jsonb_build_object('ok', false, 'error', 'not_between_floors'); end if;
  -- the settle: the bank only (the v1 retreat rule; the floor loot is already banked at floor_done)
  s := dungeon_v2_settle(r.id, 'retreat', false);
  return jsonb_build_object('ok', true, 'floor', r.floor, 'room', r.room, 'shards', s->'shards', 'cards', s->'cards');
end $fn$;

-- ============================================================ 8. the view: the mark of the run and an active v1 run of today
create or replace function public.dungeon_v2_view(p_player text) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare v_day date := dungeon_day(); d jsonb; r dungeon_v2_runs; v_left int; v_active boolean; v_last jsonb; v_tester boolean; o jsonb; v_on boolean; v1 jsonb;
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- the day (as dungeon_view_core: a day with no row is made first); no run row is written
  d := dungeon_generate(v_day);
  v_on := combat_v2_on('dungeon');
  v_tester := combat_v2_on('dungeon', p_player);
  select * into r from dungeon_v2_runs where player_id = p_player and day = v_day order by attempt desc limit 1;
  -- the active v1 daily run of today (the screen opens v1 while it is active: review M-2)
  v1 := (select jsonb_build_object('id', x.id, 'floor', x.floor, 'room', x.room, 'attempt', x.attempt) from dungeon_runs x
          where x.player_id = p_player and x.day = v_day and x.mode = 'daily' and x.status = 'active' order by x.attempt desc limit 1);
  if v_on then
    -- one run a day across v1 and v2 (INV-ON-3): the v1 daily runs and the live v2 runs of today
    v_left := greatest(0, game_var('dungeon_runs_per_day')::int - (select count(*) from dungeon_v2_runs where player_id = p_player and day = v_day and live)::int
      - (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily')::int);
    v_active := v1 is not null or exists (select 1 from dungeon_v2_runs where player_id = p_player and day = v_day and status = 'active');
  else
    -- QD2: the v2 runs of today only (an extra run; the v1 count is not read)
    v_left := greatest(0, game_var('dungeon_runs_per_day')::int - (select count(*) from dungeon_v2_runs where player_id = p_player and day = v_day)::int);
    v_active := exists (select 1 from dungeon_v2_runs where player_id = p_player and day = v_day and status = 'active');
  end if;
  v_last := (select jsonb_build_object('id', e.id, 'attempt', e.attempt, 'ended_by', e.ended_by, 'floor', e.floor, 'room', e.room, 'turns', e.turns,
                'live', e.live, 'shards', e.shards, 'cards', to_jsonb(e.cards))
               from dungeon_v2_runs e where e.player_id = p_player and e.day = v_day and e.status = 'over' order by e.attempt desc limit 1);
  if r.status = 'over' and v_left > 0 then r := null; end if;
  o := jsonb_build_object('ok', true, 'tester', v_tester, 'member', v_on, 'live', r.live, 'v1_run', v1,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room,
             'turns', r.turns, 'attempt', r.attempt, 'state', r.state, 'live', r.live, 'shards', r.shards, 'cards', to_jsonb(r.cards)) end,
    'runs_left', v_left, 'last_run', v_last, 'can_start', v_tester and not v_active and v_left > 0);
  if r.id is not null then
    return dungeon_v2_out(r.id, '{}'::jsonb) - 'ok' - 'run' - 'state' - 'floor' - 'room' - 'status' - 'ended_by' || o;
  end if;
  return o || dungeon_v2_rooms(d->'floors', null, null, false) || dungeon_v2_screen(null);
end $fn$;

-- ============================================================ 9. the v1 side: the stale settle, the board, the daily task, the v1 start
create or replace function public.dungeon_settle_stale() returns integer
language plpgsql set search_path = public as $fn$
declare r record; n int := 0;
begin
  for r in select id from dungeon_runs where status = 'active' and day < dungeon_day() loop
    perform dungeon_settle(r.id, 'abandoned', false); n := n + 1;
  end loop;
  -- R2-ON: the active v2 runs of an earlier day settle as abandoned too (the bank only; a tester run with 0)
  for r in select id from dungeon_v2_runs where status = 'active' and day < dungeon_day() loop
    perform dungeon_v2_settle(r.id, 'abandoned', false); n := n + 1;
  end loop;
  return n;
end $fn$;

create or replace function public.dungeon_board(p_day date default null, p_limit integer default 20) returns jsonb
language sql stable set search_path = public as $fn$
  -- R2-ON: the v1 daily runs and the LIVE v2 runs of the day, then one row per player (the best run), then the rank
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now()), r.player_id) rank,
           r.player_id, p.username, r.floor, r.room, r.turns, r.status, to_jsonb(r.squad) squad
    from (select distinct on (x.player_id) x.* from (
            select v.id, v.player_id, v.floor, v.room, v.turns, v.ended_at, v.status, v.squad from dungeon_runs v
             where v.day = coalesce(p_day, dungeon_day()) and v.mode = 'daily'
            union all
            select w.id, w.player_id, w.floor, w.room, w.turns, w.ended_at, w.status, w.squad from dungeon_v2_runs w
             where w.day = coalesce(p_day, dungeon_day()) and w.live) x
          order by x.player_id, x.floor desc, x.room desc, x.turns, coalesce(x.ended_at, now()), x.id) r join players p on p.id = r.player_id
    order by rank limit p_limit) x;
$fn$;

create or replace function public.dailies_tasks(p_player text) returns jsonb
language plpgsql stable set search_path = public as $fn$
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
  -- R2-ON: a LIVE v2 Dungeon run of today (dungeon_v2_runs.live, combat_v2_on_dungeon.sql) does the Dungeon daily; a tester run does not.
  dgon := coalesce((select (value->>'enabled')::boolean from settings where key = 'dungeon'), false);
  gaon := dgon and coalesce((select (value->>'enabled')::boolean from settings where key = 'gauntlet'), false);
  dg := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode = 'daily')
     or exists (select 1 from dungeon_v2_runs w where w.player_id = p_player and w.day = d and w.live);
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
end $fn$;

create or replace function public.dungeon_start(p_player text, p_cards bigint[]) returns jsonb
language plpgsql set search_path = public as $fn$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d dungeon_days; g jsonb; v_n int := balance_num('dungeon', 'squad')::int;
  v_cost int := 0; v_budget int; c jsonb; v_cards jsonb := '{}'; x bigint; v_att int := 0; v_hp int; st jsonb; v_id bigint; v_sup boolean;
  v_runs int; v_last int; v_active int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  -- R2-ON (review H-2): no v1 start while the Dungeon plays combat v2 for everyone (the open v1 run of today keeps its v1 actions)
  if combat_v2_on('dungeon') then return jsonb_build_object('ok', false, 'error', 'v2_on'); end if;
  perform 1 from players where id = p_player for update;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  -- R2-ON (review H-2): a live v2 run of today is the run of the day, also after a rollback (by row, not by flag)
  if exists (select 1 from dungeon_v2_runs where player_id = p_player and day = v_day and live) then return jsonb_build_object('ok', false, 'error', 'already'); end if;
  -- One run at a time; at most game_var('dungeon_runs_per_day') runs a game day (balance dungeon_runs_per_day, an event can raise it).
  select count(*), coalesce(max(attempt), 0), count(*) filter (where status = 'active') into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  if v_active > 0 or v_runs >= game_var('dungeon_runs_per_day') then return jsonb_build_object('ok', false, 'error', 'already'); end if;
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
    v_sup := c->>'type' not in ('Character', 'Creature');
    if not v_sup then v_att := v_att + 1; v_hp := (c->'cmb'->>'hp')::int; else v_hp := card_max_hp(0); end if;
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup));
  end loop;
  if v_att = 0 then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;
  if v_cost > v_budget then return jsonb_build_object('ok', false, 'error', 'budget', 'cost', v_cost, 'budget', v_budget); end if;
  st := dungeon_enter(jsonb_build_object('cards', v_cards, 'buff', 1, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
          'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb)), d.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state, attempt) values (p_player, v_day, p_cards, st, v_last + 1) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'squad', to_jsonb(p_cards)), jsonb_build_object('cost', v_cost));
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $fn$;

-- ============================================================ 10. server only, and the comments of the generated docs
do $gr$
declare f text;
begin
  foreach f in array array['dungeon_v2_unit(text, bigint, jsonb)', 'dungeon_v2_settle(bigint, text, boolean)', 'dungeon_v2_end(bigint, text)',
      'dungeon_v2_loot(jsonb, jsonb, integer)', 'dungeon_v2_after(jsonb, jsonb, integer, integer)', 'dungeon_v2_room(jsonb, jsonb, integer, integer, text)',
      'dungeon_v2_pick(jsonb, jsonb, integer)', 'dungeon_v2_start(text, bigint[])', 'dungeon_v2_retreat(text)', 'dungeon_v2_view(text)',
      'dungeon_settle_stale()', 'dungeon_board(date, integer)', 'dailies_tasks(text)', 'dungeon_start(text, bigint[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $gr$;

comment on function public.dungeon_v2_unit(text, bigint, jsonb) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON; R3 reuses it): the v2 unit of a player's card: combat_v2_card_unit (after SYN with tags) with the 12 star-dependent stat keys (atk, crt, crd, abl, acc, def, ddg, max, hp, spd, power, extra_stack) from card_combat_v2. With combat_v2_on('progress'): the live level (N-7b: v2_convert.level_per_star x the current stars, at most v2_level.max_level), the 9 points and the bonus points of the card_progress_v2 row (no row: 0). Else the player's stars, level 0, no points (QD3). Every other key stays. A card with no usable ability_v2 raises no_data_found. Reads only. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_settle(bigint, text, boolean) is $cm$[combat] Combat v2 Dungeon (20.19b R2-ON): the end of a v2 Dungeon run (fell, cleared, retreat, abandoned), once: the row is locked; a settled or ended run returns its stored shards and cards (again true) and grants nothing. A live run grants the bank (and the pend when p_with_pend: cleared) with grant_shards (reason dungeon, ref run_v2 + id) and card_move per card (dungeon_loot, ref dungeon_v2_run + id); a tester run grants 0. Then status over, ended_by, ended_at, settled_at, shards, cards (and state.lost = the pend when it is lost). combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_end(bigint, text) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON): ends a v2 Dungeon run at fell or cleared through dungeon_v2_settle (the v1 flags: fell loses the pend, cleared keeps it). combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_loot(jsonb, jsonb, integer) is $cm$[combat] Combat v2 Dungeon (20.19b R2-ON): the v1 loot of a won fight room of a live run: one dungeon_after_kill per foe on a shim (mode daily, the carry as cards, bank, pend, last_pick, heal_floor, room_type; the run of the day state.day): the kill Shards and card chance, then at the last kill the guardian floor Shards and pend to bank (floor_done or cleared) or the v1 offers with shards and card (none: continue). Draws random numbers. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_after(jsonb, jsonb, integer, integer) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON): the run state after a play answer: the next card turn (phase fight), or the end of the fight: the carry of each card, then won: a live run gets dungeon_v2_loot; a tester run: floor_done or cleared after a guardian, else choose with the v1 daily offers minus shards and card (QD1; none left = continue); lost or the step cap: fell. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_room(jsonb, jsonb, integer, integer, text) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON): enter one room of a v2 Dungeon run (p_key null: room p_room of floor p_floor; p_key given: the door state.door with the v1 door foes of that key; gamble = balance dungeon_rewards.door.gamble_rare the chest room, else an elite fight): a fight room (dungeon_v2_fight, then combat_v2_step to the first card turn), rest (the v1 rest numbers on the carry), choice (the v1 daily doors), treasure: a live run gets the v1 chest (dungeon_enter on a shim; the gamble rare chest of door.rare_tier as dungeon_choose) into pend; a tester run an empty pass room (QD1). Returns {state, step}. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_pick(jsonb, jsonb, integer) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON): one offer between rooms on the carry: heal and revive (the v1 numbers), buff (a pending Empowered, the higher amount stays: Q4, until the next fight room: Q3), ward (a pending Shielded: Q2), reset (every charge = v2_charge of the class: D3); a live run also: shards (the amount to pend) and card (a card of the tier odds to pend), as dungeon_choose. Draws random numbers. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_start(text, bigint[]) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON; server only, R2b route): starts a v2 Dungeon run. The mark live = combat_v2_on('dungeon') (every member); with the flag off only a tester starts (not_tester; a tester run, 0 loot, an extra run). disabled, locked, not_tester, then the player row lock; each active v2 run of an earlier day settles abandoned; a live start also settles the stale v1 daily runs and counts the v1 daily runs and the live v2 runs of today (one run a day across v1 and v2, INV-ON-3); already; the squad checks of dungeon_start (squad_size, not_owned, rule, no_attacker, budget), then no_v2 + cards (QD4). A live run state has live, day, bank, pend. Room 1 of floor 1 plays to its first card turn. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_retreat(text) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON; server only, R2b route): ends the v2 Dungeon run at floor_done as retreat through dungeon_v2_settle (the bank only). Returns ok, floor, room, shards, cards. Errors: disabled, no_run, not_between_floors. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_v2_view(text) is $cm$[combat] Combat v2 Dungeon (20.19 R2, 20.19b R2-ON; server only, R2b route): the v2 part of the Dungeon screen of a player: tester (combat_v2_on dungeon of the player), member (the flag), live (the mark of the run), v1_run (the active v1 daily run of today, or null: the screen opens v1 then), run, runs_left and can_start (flag on: the v1 daily runs and the live v2 runs of today; flag off: the v2 runs of today, QD2), last_run (with live, shards, cards), the floor map and the screen fields. Makes the day first; writes no run row. combat_v2_on_dungeon.sql.$cm$;
comment on function public.dungeon_settle_stale() is $cm$Ends every active run of an earlier day as abandoned (dungeon_settle, banked loot only). Called by the pg_cron job dungeon-settle-stale and by dungeon_pay. Returns the count. R2-ON (combat_v2_on_dungeon.sql): also every active v2 Dungeon run of an earlier day (dungeon_v2_settle, the bank only; a tester run grants 0).$cm$;
comment on function public.dungeon_board(date, integer) is $cm$GET /api/dungeon/board, dungeon_view and dungeon_pay: the daily board of a day (default today): the best run of each member, ranked by floor, room, turns, end time (an active run: now), then the member id, so a tie always has the same order (board_tie_order.sql). Returns a jsonb array with rank, member and depth. R2-ON (combat_v2_on_dungeon.sql): the v1 daily runs and the LIVE v2 runs (dungeon_v2_runs.live) of the day, then one row per member (review H-2); a tester run is not on it.$cm$;
comment on function public.dailies_tasks(text) is $cm$Returns the daily tasks of a member today (jsonb array): checkin, chat, hunt, voice, social, and dungeon and gauntlet when their mode is on, with progress, done, claimed and reward. Internal helper of dailies_view and claim_daily. R2-ON (combat_v2_on_dungeon.sql): the dungeon task also counts a LIVE v2 run of today (not a tester run).$cm$;
comment on function public.dungeon_start(text, bigint[]) is $cm$POST /api/dungeon/start: starts a daily run with the squad (balance dungeon.squad cards). Checks the flag, adventure_gate, one active run at a time and at most game_var('dungeon_runs_per_day') runs today (else already), the daily rule and the budget (the rule's budget, else balance dungeon.budget; the costs are balance dungeon.cost). Writes dungeon_runs (the next attempt) and dungeon_log. Returns ok, run and state. R2-ON (combat_v2_on_dungeon.sql, review H-2): refuses v2_on while combat_v2_on('dungeon') is true, and already when a live v2 run of today exists (by row, also after a rollback).$cm$;

notify pgrst, 'reload schema';
