-- The Dungeon v2 (Nathan's desktop test, 2026-10-03; docs/activities/03-dungeon-run.md "v2").
-- Replaces the dungeon_* functions of dungeon.sql (create or replace). Idempotent. Apply after dungeon.sql.
--  22  faster scaling: x1.42 HP and x1.22 ATK per floor (compound); much harder guardians.
--  $   at most 300 Shards per run (settings.dungeon.run_shards_cap); a card on 6% of kills.
--  12  loot at risk: everything goes to state.pend; the floor guardian banks it (state.bank) with a floor
--      bonus; Retreat only on the "Loot gained" screen between floors; a fall loses state.pend only.
--      All loot is granted ONCE, when the run ends (dungeon_settle).
--   9  support cooldowns carry over between rooms.   17  one support per turn.
--  20  each monster type has its own named moves (dungeon_monsters.moves) on the core (combat_pool_act).
--   7  reward offers with tiers (Common 60 / Uncommon 25 / Rare 10 / Ultra 4 / Legend 1); the last pick
--      cannot come back next; Heal once per floor.
--  14  a chest room: a chest tier and its loot (into state.pend).
--  15  room types: fight, horde, elite, miniboss, treasure, rest, choice (doors); the view hides the rooms
--      ahead ("?"), except the guardian.
-- Old runs: dungeon_settle_stale() (pg_cron, daily) settles the runs of earlier days (banked loot only).
-- Test: card-studio/scripts/test-dungeon.mjs.

-- ---- Settings (new keys only; enabled, salt and the costs stay) ---------------------------------------
update public.settings set value = value || jsonb_build_object(
  'hp_growth', 1.42, 'atk_growth', 1.22, 'room_growth', 0.06,
  'elite', jsonb_build_object('hp', 1.9, 'atk', 1.3), 'miniboss', jsonb_build_object('hp', 2.6, 'atk', 1.45),
  'guardian', jsonb_build_object('hp', 4.0, 'atk', 1.7), 'horde', jsonb_build_object('hp', 0.6, 'atk', 0.75),
  'room_weights', jsonb_build_object('fight', 38, 'horde', 12, 'elite', 10, 'miniboss', 7, 'treasure', 11, 'rest', 8, 'choice', 14),
  'tier_weights', jsonb_build_array(60, 25, 10, 4, 1),
  'shards_kill', 1, 'floor_shards', 10, 'run_shards_cap', 300, 'loot_chance', 0.06)
where key = 'dungeon' and not (value ? 'hp_growth');

-- ---- The monsters' moves (Nathan item 20) -------------------------------------------------------------
alter table public.dungeon_monsters add column if not exists moves jsonb not null default '[]';
update public.dungeon_monsters m set moves = v.moves::jsonb from (values
  ('slime',    '[{"name":"Bounce","kind":"strike","w":4},{"name":"Splash","kind":"slam","w":3},{"name":"Engulf","kind":"drain","w":3}]'),
  ('ooze',     '[{"name":"Acid Spit","kind":"poison","w":4},{"name":"Bounce","kind":"strike","w":3},{"name":"Splash","kind":"slam","w":2},{"name":"Ooze Shield","kind":"guard","w":1}]'),
  ('skeleton', '[{"name":"Bone Slash","kind":"strike","w":4},{"name":"Bone Throw","kind":"heavy","w":2},{"name":"Rattle","kind":"curse","w":2},{"name":"Shield Up","kind":"guard","w":1}]'),
  ('zombie',   '[{"name":"Claw","kind":"strike","w":4},{"name":"Bite","kind":"drain","w":3},{"name":"Infect","kind":"poison","w":2},{"name":"Groan","kind":"enrage","w":1}]'),
  ('giant',    '[{"name":"Punch","kind":"strike","w":3},{"name":"Smash","kind":"heavy","w":3},{"name":"Stomp","kind":"slam","w":3},{"name":"Roar","kind":"enrage","w":1}]'),
  ('yeti',     '[{"name":"Maul","kind":"strike","w":4},{"name":"Avalanche","kind":"slam","w":3},{"name":"Frost Punch","kind":"stun","w":2},{"name":"Rage","kind":"enrage","w":1}]'),
  ('demon',    '[{"name":"Claw","kind":"strike","w":3},{"name":"Hex","kind":"curse","w":3},{"name":"Hellfire","kind":"heavy","w":2},{"name":"Dark Pact","kind":"regenerate","w":1}]'),
  ('golem',    '[{"name":"Slam","kind":"strike","w":2},{"name":"Rock Fist","kind":"heavy","w":3},{"name":"Quake","kind":"slam","w":3},{"name":"Stone Skin","kind":"guard","w":2}]'),
  ('squid',    '[{"name":"Lash","kind":"strike","w":2},{"name":"Tentacles","kind":"flurry","w":4},{"name":"Squeeze","kind":"stun","w":2},{"name":"Ink Blast","kind":"curse","w":2}]'),
  ('raptor',   '[{"name":"Bite","kind":"strike","w":3},{"name":"Claw Flurry","kind":"flurry","w":4},{"name":"Pounce","kind":"heavy","w":2},{"name":"Howl","kind":"enrage","w":1}]')
) as v(key, moves) where m.key = v.key and m.moves = '[]'::jsonb;

-- The enemy move pool roll lives in the core: combat_pool_act (combat_core.sql).

-- ---- The dungeon: rooms and monsters ------------------------------------------------------------------
-- A seeded weighted pick from a {key: weight} object.
create or replace function public.dungeon_pick(p_weights jsonb, p_x numeric) returns text language plpgsql immutable as $$
declare v_total numeric; v_r numeric; k text; w numeric;
begin
  select sum(value::numeric) into v_total from jsonb_each_text(p_weights);
  v_r := p_x * v_total;
  for k, w in select key, value::numeric from jsonb_each_text(p_weights) order by key loop
    v_r := v_r - w;
    if v_r <= 0 then return k; end if;
  end loop;
  return k;
end $$;

-- A tier 1..5 (Common, Uncommon, Rare, Ultra, Legend) from settings.dungeon.tier_weights.
create or replace function public.dungeon_tier(p_x double precision) returns int language plpgsql stable set search_path = public as $$
declare w jsonb := coalesce(dungeon_cfg()->'tier_weights', '[60,25,10,4,1]'); v_total numeric := 0; v_r numeric; i int;
begin
  for i in 0..jsonb_array_length(w) - 1 loop v_total := v_total + (w->>i)::numeric; end loop;
  v_r := p_x * v_total;
  for i in 0..jsonb_array_length(w) - 1 loop
    v_r := v_r - (w->>i)::numeric;
    if v_r <= 0 then return i + 1; end if;
  end loop;
  return 1;
end $$;

-- One monster: a template, an element, the floor scaling and the room kind (fight / horde / elite /
-- miniboss / guardian). p_x(n) = the seeded draws.
create or replace function public.dungeon_make_foe(p_k text, p_floor int, p_room int, p_kind text) returns jsonb
language plpgsql stable set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); m dungeon_monsters; v_el text; v_hp numeric; v_atk numeric; v_pass jsonb := '[]'; mul jsonb; n int;
  els text[] := array['fire','water','lightning','earth','nature','ice','shadow','light'];
  counter jsonb := '{"fire":"water","water":"lightning","lightning":"earth","earth":"nature","nature":"fire","ice":"fire","shadow":"light","light":"shadow"}';
  kinds text[] := array['melee','ranged','caster','beast','hero','strong','agile'];
  passives text[] := array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied'];
begin
  select count(*) into n from dungeon_monsters;
  select * into m from dungeon_monsters order by key offset floor(dungeon_rand(p_k || '|m') * n)::int limit 1;
  v_el := els[1 + floor(dungeon_rand(p_k || '|e') * 8)::int];
  v_hp := m.hp * power(coalesce((cfg->>'hp_growth')::numeric, 1.42), p_floor - 1) * (1 + coalesce((cfg->>'room_growth')::numeric, 0.06) * (p_room - 1));
  v_atk := m.atk * power(coalesce((cfg->>'atk_growth')::numeric, 1.22), p_floor - 1);
  mul := cfg->p_kind;
  if mul is not null then v_hp := v_hp * coalesce((mul->>'hp')::numeric, 1); v_atk := v_atk * coalesce((mul->>'atk')::numeric, 1); end if;
  if p_kind in ('elite', 'miniboss') then v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * 7)::int]);
  elsif p_kind = 'guardian' then
    v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * 7)::int], passives[1 + floor(dungeon_rand(p_k || '|q') * 7)::int]);
  end if;
  return jsonb_build_object('key', m.key, 'model', m.model, 'element', v_el, 'level', p_floor, 'kind', p_kind,
    'name', initcap(v_el) || ' ' || m.name || case p_kind when 'elite' then ' (Elite)' when 'miniboss' then ' Mini-Boss' when 'guardian' then ' Guardian' else '' end,
    'hp', round(v_hp)::int, 'max', round(v_hp)::int, 'atk', greatest(1, round(v_atk))::int, 'moves', m.moves,
    'charge', p_kind in ('miniboss', 'guardian'),
    'tags', to_jsonb(m.tags || array['trait:' || v_el]),
    'weak', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || (counter->>v_el)),
                              jsonb_build_object('kind', 'tag', 'value', 'trait:' || kinds[1 + floor(dungeon_rand(p_k || '|w') * 7)::int])),
    'resist', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || v_el)),
    'passives', (select coalesce(jsonb_agg(distinct p), '[]'::jsonb) from jsonb_array_elements_text(v_pass) p));
end $$;

-- The monsters of a room of a given type.
create or replace function public.dungeon_room_foes(p_k text, p_floor int, p_room int, p_type text) returns jsonb
language plpgsql stable set search_path = public as $$
declare v jsonb := '[]'; n int; i int;
begin
  n := case p_type when 'fight' then 1 + floor(dungeon_rand(p_k || '|n') * 3)::int when 'horde' then 4 + floor(dungeon_rand(p_k || '|n') * 2)::int else 1 end;
  for i in 1..n loop
    v := v || dungeon_make_foe(p_k || '|' || i, p_floor, p_room, case p_type when 'fight' then 'fight' when 'horde' then 'horde' else p_type end);
  end loop;
  return v;
end $$;

-- Build one day's dungeon (idempotent: a day that exists is kept). Every draw is seeded, so the same day
-- always gives the same dungeon. Room 1 = a fight, room 5 = the guardian, rooms 2-4 by room_weights.
create or replace function public.dungeon_generate(p_day date) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); k text := coalesce(cfg->>'salt', 'lion') || '|' || p_day::text;
  v_floors jsonb := '[]'; v_rooms jsonb; v_type text; f int; r int; v_rule jsonb; v_name text; rk text;
  names text[] := array['The Sunken Crypt','The Ember Halls','Frostfang Caverns','The Rotting Grove','The Clockwork Depths','Shadowmere Keep','The Hollow Mines','Stormspire Tower'];
  w jsonb := coalesce(cfg->'room_weights', '{"fight":38,"horde":12,"elite":10,"miniboss":7,"treasure":11,"rest":8,"choice":14}');
begin
  if exists (select 1 from dungeon_days where day = p_day) then return (select to_jsonb(d) from dungeon_days d where day = p_day); end if;
  v_rule := dungeon_rules() -> (floor(dungeon_rand(k || '|rule') * jsonb_array_length(dungeon_rules())))::int;
  v_name := names[1 + floor(dungeon_rand(k || '|name') * array_length(names, 1))::int];
  for f in 1..coalesce((cfg->>'floors')::int, 30) loop
    v_rooms := '[]';
    for r in 1..5 loop
      rk := k || '|' || f || '|' || r;
      v_type := case when r = 5 then 'guardian' when r = 1 then 'fight' else dungeon_pick(w, dungeon_rand(rk || '|t')) end;
      v_rooms := v_rooms || jsonb_build_object('type', v_type,
        'foes', case when v_type in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then dungeon_room_foes(rk, f, r, v_type) else '[]'::jsonb end);
    end loop;
    v_floors := v_floors || jsonb_build_array(v_rooms);
  end loop;
  insert into dungeon_days (day, name, rule, floors) values (p_day, v_name, v_rule, v_floors) on conflict (day) do nothing;
  return (select to_jsonb(d) from dungeon_days d where day = p_day);
end $$;

-- ---- Loot at risk ---------------------------------------------------------------------------------------
-- Add Shards and / or a card to state.pend (the floor's loot at risk). The run total (bank + pend) never
-- passes run_shards_cap.
create or replace function public.dungeon_loot(p_state jsonb, p_shards int, p_card bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare st jsonb := p_state; cap int := coalesce((dungeon_cfg()->>'run_shards_cap')::int, 300);
  have int := coalesce((p_state->'bank'->>'shards')::int, 0) + coalesce((p_state->'pend'->>'shards')::int, 0);
  add int := greatest(0, least(coalesce(p_shards, 0), cap - have));
begin
  st := jsonb_set(st, '{pend}', coalesce(st->'pend', '{"shards":0,"cards":[]}') || jsonb_build_object(
    'shards', coalesce((st->'pend'->>'shards')::int, 0) + add,
    'cards', coalesce(st->'pend'->'cards', '[]') || case when p_card is null then '[]'::jsonb else jsonb_build_array(p_card) end));
  return st;
end $$;

-- A card of a rarity from the draw pool (never Full Art, Gold, Event or Promo). Not granted here.
create or replace function public.dungeon_card_of(p_rarity text) returns bigint language sql volatile set search_path = public as $$
  select id from cards where rarity::text = p_rarity and source::text = 'draw' and in_draw_pool order by random() limit 1;
$$;
-- The rarity of a dropped card by depth (settings.dungeon.loot).
create or replace function public.dungeon_drop_rarity(p_floor int) returns text language plpgsql volatile set search_path = public as $$
declare t jsonb; x numeric := random();
begin
  select e into t from jsonb_array_elements(dungeon_cfg()->'loot') e where p_floor <= (e->>'to')::int order by (e->>'to')::int limit 1;
  return case when x < coalesce((t->>'secret_rare')::numeric, 0) then 'secret_rare'
              when x < coalesce((t->>'secret_rare')::numeric, 0) + coalesce((t->>'illustrated_rare')::numeric, 0) then 'illustrated_rare'
              else 'normal' end;
end $$;

-- Settle the run ONCE: grant the banked loot (and the floor's loot when the floor was completed:
-- p_with_pend), write the totals, end the run. 'fell' and 'abandoned' grant the bank only.
create or replace function public.dungeon_settle(p_run_id bigint, p_how text, p_with_pend boolean) returns jsonb
language plpgsql set search_path = public as $$
declare r dungeon_runs; v_sh int; v_cards jsonb; x jsonb;
begin
  select * into r from dungeon_runs where id = p_run_id for update;
  if r.status <> 'active' then return jsonb_build_object('shards', r.shards, 'cards', to_jsonb(r.cards)); end if;
  v_sh := coalesce((r.state->'bank'->>'shards')::int, 0) + case when p_with_pend then coalesce((r.state->'pend'->>'shards')::int, 0) else 0 end;
  v_cards := coalesce(r.state->'bank'->'cards', '[]') || case when p_with_pend then coalesce(r.state->'pend'->'cards', '[]') else '[]'::jsonb end;
  if v_sh > 0 then perform grant_shards(r.player_id, v_sh, 'dungeon', 'run', r.id::text); end if;
  for x in select e from jsonb_array_elements(v_cards) e loop perform add_card_to_player(r.player_id, (x #>> '{}')::bigint, 'dungeon'); end loop;
  update dungeon_runs set status = 'over', ended_by = p_how, ended_at = now(), shards = v_sh,
    cards = coalesce(array(select (e #>> '{}')::bigint from jsonb_array_elements(v_cards) e), '{}'),
    state = jsonb_set(state, '{phase}', '"over"') || jsonb_build_object('lost', case when p_with_pend then null else state->'pend' end)
  where id = r.id;
  return jsonb_build_object('shards', v_sh, 'cards', v_cards);
end $$;

-- The runs of earlier days that are still open: settled with the banked loot (pg_cron, daily).
create or replace function public.dungeon_settle_stale() returns int language plpgsql set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from dungeon_runs where status = 'active' and day < dungeon_day() loop
    perform dungeon_settle(r.id, 'abandoned', false); n := n + 1;
  end loop;
  return n;
end $$;
alter table public.dungeon_runs drop constraint if exists dungeon_runs_status_check;
alter table public.dungeon_runs add constraint dungeon_runs_status_check check (status in ('active', 'over'));
do $c$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dungeon-settle-stale';
    perform cron.schedule('dungeon-settle-stale', '20 6 * * *', 'select public.dungeon_settle_stale()');
  end if;
end $c$;

-- ---- Rewards ---------------------------------------------------------------------------------------------
-- 3 offers after a cleared room, each with a tier. The kind picked last time cannot come back; Heal and
-- Revive only once per floor (no heal loop: Nathan item 7).
create or replace function public.dungeon_offers(p_state jsonb, p_floor int) returns jsonb
language plpgsql volatile set search_path = public as $$
declare pool text[] := array['heal','buff','shards','card','ward','reset','revive']; v jsonb := '[]'; k text; t int; n int := 0;
  amt numeric; tries int := 0;
  healed boolean := coalesce((p_state->>'heal_floor')::int, 0) = p_floor;
begin
  while n < 3 and tries < 40 loop
    tries := tries + 1;
    k := pool[1 + floor(random() * array_length(pool, 1))::int];
    continue when k = p_state->>'last_pick';
    continue when k in ('heal', 'revive') and healed;
    continue when exists (select 1 from jsonb_array_elements(v) o where o->>'kind' = k);
    t := dungeon_tier(random());
    continue when k = 'reset' and t < 3;          -- a cooldown reset is Rare or better
    continue when k = 'revive' and t < 2;
    continue when k = 'revive' and not exists (select 1 from jsonb_each(p_state->'cards') c where (c.value->>'down')::boolean);
    amt := case k
      when 'heal' then (array[0.25, 0.35, 0.5, 0.75, 1.0])[t]
      when 'buff' then (array[0.05, 0.08, 0.12, 0.18, 0.25])[t]
      when 'shards' then (array[8, 15, 25, 40, 70])[t] + 2 * p_floor
      when 'ward' then (array[0.1, 0.15, 0.2, 0.3, 0.4])[t]
      when 'revive' then (array[0.3, 0.3, 0.4, 0.6, 1.0])[t]
      else 0 end;
    v := v || jsonb_build_object('kind', k, 'tier', t, 'amount', amt,
      'rarity', case when k = 'card' then (array['normal', 'normal', 'illustrated_rare', 'illustrated_rare', 'secret_rare'])[t] end);
    n := n + 1;
  end loop;
  return v;
end $$;

-- Enter a room. A fight loads its monsters; the support cooldowns carry over (as rounds left, item 9); a
-- ward from a reward shields every card. A rest heals and revives. A treasure rolls a chest (item 14).
-- A choice offers 2-3 doors (item 15).
create or replace function public.dungeon_enter(p_state jsonb, p_floors jsonb, p_floor int, p_room int) returns jsonb
language plpgsql volatile set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_room jsonb := p_floors -> (p_floor - 1) -> (p_room - 1); st jsonb := p_state; k text; c jsonb;
  v_old int := coalesce((p_state->>'round')::int, 0); v_left int; t int; v_sh int; v_card bigint; doors text[] := array['elite','rest','treasure','horde','gamble']; d jsonb := '[]'; x text;
begin
  st := st || jsonb_build_object('round', 0, 'room_type', v_room->>'type', 'sup_round', -1) - 'chest' - 'offers';
  if v_room->>'type' in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then
    st := st || jsonb_build_object('phase', 'fight', 'foes',
      (select coalesce(jsonb_agg(f || jsonb_build_object('enr', 0, 'enru', 0, 'wk', 0, 'wku', 0, 'ex', 0, 'exu', 0, 'st', 0, 'sh', 0)), '[]'::jsonb)
         from jsonb_array_elements(v_room->'foes') f));
    for k in select jsonb_object_keys(st->'cards') loop
      c := st->'cards'->k;
      v_left := case when coalesce((c->>'sup')::boolean, false) then greatest(0, coalesce((c->>'cd')::int, 0) - v_old) else 0 end;
      c := c || jsonb_build_object('buff', 1, 'debuff', 1, 'cd', v_left, 'psn', 0, 'psnu', -1);
      if coalesce((st->>'ward')::numeric, 0) > 0 and not (c->>'down')::boolean then
        c := c || jsonb_build_object('shield', coalesce((c->>'shield')::int, 0) + round((c->>'max')::int * (st->>'ward')::numeric)::int);
      end if;
      st := jsonb_set(st, array['cards', k], c);
    end loop;
    st := st - 'ward';
  elsif v_room->>'type' = 'rest' then
    for k in select jsonb_object_keys(st->'cards') loop
      c := st->'cards'->k;
      if (c->>'down')::boolean then
        c := c || jsonb_build_object('down', false, 'hp', greatest(1, round((c->>'max')::int * coalesce((cfg->>'rest_revive')::numeric, 0.25)))::int);
      else
        c := c || jsonb_build_object('hp', least((c->>'max')::int, (c->>'hp')::int + round((c->>'max')::int * coalesce((cfg->>'rest_heal')::numeric, 0.4))::int));
      end if;
      st := jsonb_set(st, array['cards', k], c);
    end loop;
    st := st || jsonb_build_object('phase', 'rest', 'foes', '[]'::jsonb, 'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  elsif v_room->>'type' = 'choice' then
    for x in select u from unnest(doors) u order by random() limit 2 + floor(random() * 2)::int loop
      d := d || jsonb_build_object('kind', 'door', 'to', x);
    end loop;
    st := st || jsonb_build_object('phase', 'path', 'foes', '[]'::jsonb, 'offers', d);
  else -- treasure: a chest of a tier (the loot goes to pend: at risk until the floor is cleared)
    t := dungeon_tier(random());
    v_sh := (array[15, 25, 40, 65, 110])[t] + 3 * p_floor;
    v_card := case when random() < (array[0, 0.35, 0.6, 1, 1])[t] then dungeon_card_of((array['normal', 'normal', 'illustrated_rare', 'illustrated_rare', 'secret_rare'])[t]) end;
    st := dungeon_loot(st, v_sh, v_card);
    st := st || jsonb_build_object('phase', 'chest', 'foes', '[]'::jsonb, 'chest', jsonb_build_object('tier', t, 'shards', v_sh, 'card', v_card),
      'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  end if;
  return st;
end $$;

-- After a kill: the kill Shards and the card roll (into pend). After the last kill: the rewards, or after
-- the guardian the floor is done (pend -> bank + the floor bonus), or the run is cleared.
create or replace function public.dungeon_after_kill(p_run dungeon_runs, p_state jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); st jsonb := p_state; v_card bigint := null; v_cleared boolean; v_last int;
begin
  if random() < coalesce((cfg->>'loot_chance')::numeric, 0.06) then v_card := dungeon_card_of(dungeon_drop_rarity(p_run.floor)); end if;
  st := dungeon_loot(st, coalesce((cfg->>'shards_kill')::int, 1), v_card);
  v_cleared := not exists (select 1 from jsonb_array_elements(st->'foes') f where (f->>'hp')::int > 0);
  if v_cleared then
    if st->>'room_type' = 'guardian' then
      st := dungeon_loot(st, coalesce((cfg->>'floor_shards')::int, 10) * p_run.floor, null);
      -- The floor is done: its loot is banked (safe from now on).
      st := st || jsonb_build_object('floor_loot', st->'pend',
        'bank', jsonb_build_object('shards', coalesce((st->'bank'->>'shards')::int, 0) + coalesce((st->'pend'->>'shards')::int, 0),
                                   'cards', coalesce(st->'bank'->'cards', '[]') || coalesce(st->'pend'->'cards', '[]')),
        'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb));
      select jsonb_array_length(floors) into v_last from dungeon_days where day = p_run.day;
      st := st || jsonb_build_object('phase', case when p_run.floor >= v_last then 'cleared' else 'floor_done' end, 'offers', '[]'::jsonb);
    else
      st := st || jsonb_build_object('phase', 'choose', 'offers', dungeon_offers(st, p_run.floor));
    end if;
  end if;
  return jsonb_build_object('state', st, 'shards', coalesce((cfg->>'shards_kill')::int, 1), 'card', v_card, 'cleared', v_cleared);
end $$;

-- The enemy turn: poison ticks first; then every monster standing uses a move from its pool
-- (combat_pool_act: a surprise) on the attacking card (or the next card standing); area moves roll on every
-- other card; then the attacked monster's passives (thorns, flaming).
create or replace function public.dungeon_enemy_turn(p_state jsonb, p_attacker bigint, p_attacked int, p_dmg int) returns jsonb
language plpgsql volatile set search_path = public as $$
declare st jsonb := p_state; v_round int := (p_state->>'round')::int + 1; i int; f jsonb; act jsonb; v_lost numeric; v_bmult numeric;
  v_tgt text; c jsonb; v_d int; ab jsonb; k text; raw int; v_out jsonb := '[]'; v_heal int; v_pl text[]; v_burn int; v_area jsonb; v_ticks jsonb := '[]'; p int;
begin
  st := st || jsonb_build_object('round', v_round);
  -- Poison: each poisoned card loses its poison damage this round.
  for k in select key from jsonb_each(st->'cards') where not (value->>'down')::boolean and coalesce((value->>'psnu')::int, -1) >= v_round order by key loop
    c := st->'cards'->k; p := coalesce((c->>'psn')::int, 0);
    c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - p)); c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
    st := jsonb_set(st, array['cards', k], c);
    v_ticks := v_ticks || jsonb_build_object('card', k::bigint, 'dmg', p);
  end loop;
  for i in 0..jsonb_array_length(st->'foes') - 1 loop
    f := st->'foes'->i;
    continue when (f->>'hp')::int <= 0;
    v_pl := dungeon_txt(f->'passives');
    v_lost := 1 - (f->>'hp')::numeric / greatest(1, (f->>'max')::int);
    v_bmult := combat_enemy_mult((f->>'enr')::numeric, (f->>'enru')::int, (f->>'wk')::numeric, (f->>'wku')::int, v_round,
                                 'volatile' = any(v_pl), v_lost, 'frenzied' = any(v_pl));
    act := combat_pool_act((f->>'atk')::numeric, v_bmult, v_round, (f->>'st')::int, v_lost, (f->>'max')::int, f->'moves', coalesce((f->>'charge')::boolean, false));
    v_tgt := case when not coalesce((st->'cards'->p_attacker::text->>'down')::boolean, true) then p_attacker::text
                  else (select key from jsonb_each(st->'cards') where not (value->>'down')::boolean order by key limit 1) end;
    exit when v_tgt is null;   -- the squad is down
    v_area := '[]';
    if (act->>'dmg')::int > 0 then
      c := st->'cards'->v_tgt;
      ab := combat_absorb((c->>'shield')::int, (act->>'dmg')::int);
      v_d := (ab->>'dmg')::int;
      c := c || jsonb_build_object('shield', (ab->>'shield')::int, 'hp', greatest(0, (c->>'hp')::int - v_d));
      c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
      if act->>'action' = 'stun' then c := c || jsonb_build_object('cd', greatest((c->>'cd')::int, v_round + 1)); end if;
      if (act->>'dot')::int > 0 then c := c || jsonb_build_object('psn', (act->>'dot')::int, 'psnu', v_round + 3); end if;
      st := jsonb_set(st, array['cards', v_tgt], c);
    end if;
    if (act->>'area')::numeric > 0 then
      for k in select key from jsonb_each(st->'cards') where key <> v_tgt and not (value->>'down')::boolean order by key loop
        c := st->'cards'->k;
        raw := combat_area_roll((f->>'atk')::numeric, (act->>'area')::numeric, v_bmult);
        ab := combat_absorb((c->>'shield')::int, raw);
        c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - (ab->>'dmg')::int), 'shield', (ab->>'shield')::int);
        c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
        st := jsonb_set(st, array['cards', k], c);
        v_area := v_area || jsonb_build_object('card', k::bigint, 'dmg', (ab->>'dmg')::int);
      end loop;
    end if;
    if act->>'action' = 'enrage' then f := f || jsonb_build_object('enr', 1.4, 'enru', v_round + 2);
    elsif act->>'action' = 'curse' then st := jsonb_set(st, array['cards', v_tgt, 'debuff'], '0.7');
    elsif act->>'action' = 'guard' then f := f || jsonb_build_object('sh', coalesce((f->>'sh')::int, 0) + (act->>'guard')::int);
    end if;
    v_heal := (act->>'heal')::int;
    if 'regenerating' = any(v_pl) and act->>'action' <> 'stunned' then v_heal := v_heal + greatest(1, round((f->>'max')::int * 0.03))::int; end if;
    if v_heal > 0 then f := f || jsonb_build_object('hp', least((f->>'max')::int, (f->>'hp')::int + v_heal)); end if;
    st := jsonb_set(st, array['foes', i::text], f);
    v_out := v_out || jsonb_build_object('foe', i, 'action', act->>'action', 'move', act->>'move', 'card', v_tgt::bigint, 'dmg', coalesce(v_d, 0),
      'hits', (act->>'hits')::int, 'area', v_area, 'heal', v_heal, 'guard', (act->>'guard')::int, 'dot', (act->>'dot')::int);
    v_d := null;
  end loop;
  f := st->'foes'->p_attacked;
  if f is not null and (f->>'hp')::int > 0 and not coalesce((st->'cards'->p_attacker::text->>'down')::boolean, true) then
    v_pl := dungeon_txt(f->'passives');
    c := st->'cards'->p_attacker::text;
    if 'thorns' = any(v_pl) and p_dmg > 0 then c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - combat_thorns(p_dmg))); end if;
    if 'flaming' = any(v_pl) then
      v_burn := combat_burn((f->>'atk')::numeric);
      if v_burn > 0 then
        ab := combat_absorb((c->>'shield')::int, v_burn);
        c := c || jsonb_build_object('shield', (ab->>'shield')::int, 'hp', greatest(0, (c->>'hp')::int - (ab->>'dmg')::int));
      end if;
    end if;
    c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
    st := jsonb_set(st, array['cards', p_attacker::text], c);
  end if;
  return jsonb_build_object('state', st, 'actions', v_out, 'burned', coalesce(v_burn, 0), 'poison', v_ticks);
end $$;

-- ---- The member's actions -------------------------------------------------------------------------
-- Start today's run (as v1, plus: the support flag for the cooldown carry-over; the loot boxes).
create or replace function public.dungeon_start(p_player text, p_cards bigint[]) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d dungeon_days; g jsonb; v_n int := coalesce((cfg->>'squad')::int, 5);
  v_cost int := 0; v_budget int; c jsonb; v_cards jsonb := '{}'; x bigint; v_att int := 0; v_hp int; st jsonb; v_id bigint; v_sup boolean;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  perform 1 from players where id = p_player for update;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  if exists (select 1 from dungeon_runs where player_id = p_player and day = v_day) then return jsonb_build_object('ok', false, 'error', 'already'); end if;
  if p_cards is null or array_length(p_cards, 1) <> v_n or (select count(distinct y) from unnest(p_cards) y) <> v_n then
    return jsonb_build_object('ok', false, 'error', 'squad_size', 'need', v_n); end if;
  perform dungeon_generate(v_day);
  select * into d from dungeon_days where day = v_day;
  v_budget := coalesce((d.rule->>'budget')::int, (cfg->>'budget')::int, 12);
  foreach x in array p_cards loop
    c := dungeon_card(p_player, x);
    if c is null then return jsonb_build_object('ok', false, 'error', 'not_owned', 'card', x); end if;
    if d.rule ? 'types' and not (d.rule->'types' ? (c->>'type')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    if d.rule ? 'no_rarity' and (d.rule->'no_rarity' ? (c->>'rarity')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    v_cost := v_cost + coalesce((cfg->'cost'->>(c->>'rarity'))::int, 1);
    v_sup := c->>'type' not in ('Character', 'Creature');
    if not v_sup then v_att := v_att + 1; v_hp := (c->'cmb'->>'hp')::int; else v_hp := card_max_hp(0); end if;
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup));
  end loop;
  if v_att = 0 then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;
  if v_cost > v_budget then return jsonb_build_object('ok', false, 'error', 'budget', 'cost', v_cost, 'budget', v_budget); end if;
  st := dungeon_enter(jsonb_build_object('cards', v_cards, 'buff', 1, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
          'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb)), d.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state) values (p_player, v_day, p_cards, st) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'squad', to_jsonb(p_cards)), jsonb_build_object('cost', v_cost));
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $$;

-- An attack (ends the turn): the core's attack roll on one monster (a monster's guard absorbs first), then
-- the monsters' turn. A fall ends the run (the banked loot only).
create or replace function public.dungeon_attack(p_player text, p_card bigint, p_target int default null) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; f jsonb; v_t int; v_tags text[];
  v_ab jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; sq jsonb; wk jsonb; v_crit numeric; hit jsonb; v_dmg int := 0; v_heal int := 0;
  v_round int; v_pl text[]; ek text; kill jsonb := null; v_cmb jsonb; v_boost numeric := 0; et jsonb := null; v_maxhp int; v_guard int := 0; v_end jsonb := null;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_card(p_player, p_card);
  if info is null then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if info->>'type' not in ('Character', 'Creature') then return jsonb_build_object('ok', false, 'error', 'not_attacker'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'downed'); end if;
  v_round := (st->>'round')::int;
  if v_round >= coalesce((cfg->>'round_cap')::int, 40) then
    perform dungeon_settle(r.id, 'fell', false); return jsonb_build_object('ok', false, 'error', 'round_cap'); end if;
  if (c->>'cd')::int >= v_round + 1 and exists (
      select 1 from jsonb_each(st->'cards') e join cards cc on cc.id = e.key::bigint join subjects s on s.id = cc.subject_id
      where e.key <> p_card::text and not (e.value->>'down')::boolean and (e.value->>'cd')::int < v_round + 1 and s.type in ('Character', 'Creature')) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target then 0 else 1 end), e.ord limit 1;
  f := st->'foes'->v_t;
  v_tags := dungeon_txt(info->'tags'); v_pl := dungeon_txt(f->'passives');
  v_ab := info->'ability'; v_cmb := info->'cmb'; v_maxhp := (c->>'max')::int;
  v_aeff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' else null end;
  v_aamt := coalesce((v_ab->>'amount')::numeric, 0); v_athresh := coalesce((v_ab->>'threshold')::numeric, 0);
  sq := combat_squad(v_tags, true,
    (select coalesce(jsonb_agg(coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)), '[]'::jsonb) from unnest(r.squad) x
       join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where x <> p_card), f->'weak');
  wk := combat_weak(f->'weak', f->'resist', info->>'type', info->>'rarity', info->>'season', v_tags, (sq->>'stack')::int);
  v_crit := combat_crit_chance((wk->>'wm')::int > 0, v_aeff, v_aamt, v_cmb);
  hit := combat_hit((v_cmb->>'cp')::int, (wk->>'mult')::numeric, (c->>'buff')::numeric, (c->>'debuff')::numeric, (sq->>'synmult')::numeric,
    v_crit, 0.08 + case when 'shrouded' = any(v_pl) then 0.10 else 0 end, v_aeff, v_aamt, v_athresh,
    'armored' = any(v_pl) and 'trait:melee' = any(v_tags),
    case when (f->>'exu')::int >= v_round and (f->>'ex')::numeric > 0 then (f->>'ex')::numeric else 0 end,
    (f->>'hp')::bigint, (f->>'max')::bigint);
  v_dmg := (hit->>'dmg')::int;
  if v_dmg > 0 then
    select rule->>'boost_tag', coalesce((rule->>'boost')::numeric, 0) into ek, v_boost from dungeon_days where day = r.day;
    v_dmg := greatest(1, round(v_dmg * (st->>'buff')::numeric * (1 + case when ek is not null and ek = any(v_tags) then v_boost else 0 end)))::int;
    -- A monster's guard (Stone Skin, Shield Up ...) absorbs first.
    v_guard := least(coalesce((f->>'sh')::int, 0), v_dmg);
    f := f || jsonb_build_object('sh', coalesce((f->>'sh')::int, 0) - v_guard);
    v_dmg := v_dmg - v_guard;
  end if;
  f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_dmg));
  st := jsonb_set(st, array['foes', v_t::text], f);
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);
    st := jsonb_set(st, array['cards', p_card::text, 'hp'], to_jsonb(least(v_maxhp, (c->>'hp')::int + v_heal)));
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'buff'], '1');
  if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  if st->>'phase' = 'fight' then
    et := dungeon_enemy_turn(st, p_card, v_t, v_dmg); st := et->'state';
    if not exists (select 1 from jsonb_each(st->'cards') where not (value->>'down')::boolean) then st := st || '{"phase": "fell"}'; end if;
  end if;
  update dungeon_runs set state = st, turns = turns + 1 where id = r.id;
  if st->>'phase' = 'fell' then v_end := dungeon_settle(r.id, 'fell', false);
  elsif st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'attack', 'card', p_card, 'target', v_t),
    jsonb_build_object('dmg', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'double', hit->'double', 'heal', v_heal, 'enemy', et->'actions', 'kill', kill));
  return jsonb_build_object('ok', true, 'damage', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'crit', hit->'crit', 'double', hit->'double',
    'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'heal', v_heal, 'target', v_t,
    'kill', kill is not null, 'loot', case when kill is null then null else jsonb_build_object('shards', kill->'shards', 'card', kill->'card') end,
    'enemy', coalesce(et->'actions', '[]'::jsonb), 'burned', coalesce(et->'burned', '0'), 'poison', coalesce(et->'poison', '[]'::jsonb),
    'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $$;

-- A support (does not end the turn; ONE support per turn, item 17): the Hunt's support rules.
create or replace function public.dungeon_support(p_player text, p_card bigint, p_target_card bigint default null, p_target_foe int default null) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; v_ab jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text; v_aff text;
  v_round int; v_affc int := 0; v_scale numeric; v_matched boolean := false; tc jsonb; tinfo jsonb; f jsonb; v_t int; v_val numeric; k text; kill jsonb := null; v_end jsonb := null;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_card(p_player, p_card);
  v_ab := info->'ability';
  if v_ab is null or v_ab->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  v_round := (st->>'round')::int;
  if coalesce((st->>'sup_round')::int, -1) = v_round then return jsonb_build_object('ok', false, 'error', 'one_support'); end if;
  if v_round < (c->>'cd')::int then return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', (c->>'cd')::int, 'round', v_round); end if;
  v_eff := v_ab->>'effect';
  v_amt := coalesce((v_ab->>'amount')::numeric, 0) * coalesce((info->'cmb'->>'potency')::numeric, 1);
  v_dur := coalesce((v_ab->>'duration')::int, 1); v_cd := coalesce((v_ab->>'cooldown')::int, 1);
  v_tgt := coalesce(v_ab->>'target', 'boss'); v_aff := v_ab->>'affinity';
  if v_aff is not null then
    select count(*) into v_affc from unnest(r.squad) x join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affc);
  if v_tgt in ('ally', 'self') then
    if p_target_card is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    tc := st->'cards'->p_target_card::text;
    if tc is null then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    tinfo := dungeon_card(p_player, p_target_card);
    v_matched := v_aff is not null and v_aff = any(dungeon_txt(tinfo->'tags'));
    if v_matched then v_amt := v_amt * 1.8; end if;
    if v_eff = 'empower' then tc := tc || jsonb_build_object('buff', combat_support_value('empower', v_amt, 1, null));
    elsif v_eff = 'shield' then tc := tc || jsonb_build_object('shield', (tc->>'shield')::int + combat_support_value('shield', v_amt, 1, (tc->>'max')::int)::int);
    elsif v_eff = 'heal' then
      if (tc->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'target_downed'); end if;
      tc := tc || jsonb_build_object('hp', least((tc->>'max')::int, (tc->>'hp')::int + combat_support_value('heal', v_amt, 1, (tc->>'max')::int)::int));
    else return jsonb_build_object('ok', false, 'error', 'bad_ally_effect'); end if;
    st := jsonb_set(st, array['cards', p_target_card::text], tc);
  elsif v_eff = 'cleanse' then
    for k in select jsonb_object_keys(st->'cards') loop st := jsonb_set(st, array['cards', k], (st->'cards'->k) || '{"debuff": 1, "psn": 0, "psnu": -1}'); end loop;
  else
    select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
      where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target_foe then 0 else 1 end), e.ord limit 1;
    f := st->'foes'->v_t;
    if v_eff = 'weaken' then f := f || jsonb_build_object('wk', combat_support_value('weaken', v_amt, v_scale, null), 'wku', v_round + v_dur);
    elsif v_eff = 'expose' then f := f || jsonb_build_object('ex', combat_support_value('expose', v_amt, v_scale, null), 'exu', v_round + v_dur);
    elsif v_eff = 'stun' then
      if combat_stun_immune((f->>'st')::int, v_round) then return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', (f->>'st')::int + 2); end if;
      f := f || jsonb_build_object('st', v_round + 1);
    elsif v_eff = 'smite' then
      v_val := combat_support_value('smite', v_amt, v_scale, null);
      f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_val::int));
    else return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff); end if;
    st := jsonb_set(st, array['foes', v_t::text], f);
    if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + v_cd));
  st := st || jsonb_build_object('sup_round', v_round);
  update dungeon_runs set state = st where id = r.id;
  if st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'support', 'card', p_card, 'target_card', p_target_card, 'target_foe', v_t),
    jsonb_build_object('effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'kill', kill));
  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'aff_count', v_affc,
    'ready_round', v_round + v_cd, 'kill', kill is not null, 'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $$;

-- Pick a reward / continue (rest, chest) / a door (choice) / the next floor (floor done).
create or replace function public.dungeon_choose(p_player text, p_pick int) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; d dungeon_days; st jsonb; o jsonb; k text; c jsonb; v_f int; v_r int; v_card bigint := null; v_to text; rk text;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  select * into d from dungeon_days where day = r.day;
  if st->>'phase' = 'floor_done' then
    -- The next floor, room 1.
    st := dungeon_enter(st - 'floor_loot', d.floors, r.floor + 1, 1);
    update dungeon_runs set state = st, floor = r.floor + 1, room = 1 where id = r.id;
    perform dungeon_log_add(r.id, '{"kind": "next_floor"}', jsonb_build_object('floor', r.floor + 1));
    return jsonb_build_object('ok', true, 'state', st, 'floor', r.floor + 1, 'room', 1, 'status', 'active');
  end if;
  if st->>'phase' not in ('choose', 'rest', 'chest', 'path') then return jsonb_build_object('ok', false, 'error', 'not_choosing'); end if;
  o := st->'offers'->coalesce(p_pick, 0);
  if o is null then return jsonb_build_object('ok', false, 'error', 'bad_pick'); end if;
  if o->>'kind' = 'door' then
    -- A door turns this room into another room (a gamble: a rare chest or an ambush).
    v_to := o->>'to';
    if v_to = 'gamble' then v_to := case when random() < 0.5 then 'treasure_rare' else 'elite' end; end if;
    rk := 'door|' || r.id || '|' || r.floor || '|' || r.room;
    if v_to = 'treasure_rare' then
      st := dungeon_loot(st, 65 + 3 * r.floor, dungeon_card_of('illustrated_rare'));
      st := st || jsonb_build_object('phase', 'chest', 'room_type', 'treasure', 'chest', jsonb_build_object('tier', 4, 'shards', 65 + 3 * r.floor, 'card', st->'pend'->'cards'->-1),
        'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
    else
      st := dungeon_enter(st, jsonb_build_array(jsonb_build_array(jsonb_build_object('type', v_to,
        'foes', case when v_to in ('elite', 'horde') then dungeon_room_foes(rk, r.floor, r.room, v_to) else '[]'::jsonb end))), 1, 1);
    end if;
    update dungeon_runs set state = st where id = r.id;
    perform dungeon_log_add(r.id, jsonb_build_object('kind', 'door', 'to', v_to), '{}');
    return jsonb_build_object('ok', true, 'picked', o, 'door', v_to, 'state', st, 'floor', r.floor, 'room', r.room, 'status', 'active');
  end if;
  if o->>'kind' = 'heal' then
    for k in select key from jsonb_each(st->'cards') where not (value->>'down')::boolean loop
      c := st->'cards'->k;
      st := jsonb_set(st, array['cards', k, 'hp'], to_jsonb(least((c->>'max')::int, (c->>'hp')::int + round((c->>'max')::int * (o->>'amount')::numeric)::int)));
    end loop;
    st := st || jsonb_build_object('heal_floor', r.floor);
  elsif o->>'kind' = 'revive' then
    for k in select key from jsonb_each(st->'cards') where (value->>'down')::boolean loop
      c := st->'cards'->k;
      st := jsonb_set(st, array['cards', k], c || jsonb_build_object('down', false, 'hp', greatest(1, round((c->>'max')::int * (o->>'amount')::numeric))::int));
    end loop;
    st := st || jsonb_build_object('heal_floor', r.floor);
  elsif o->>'kind' = 'buff' then st := st || jsonb_build_object('buff', round((st->>'buff')::numeric + (o->>'amount')::numeric, 2));
  elsif o->>'kind' = 'ward' then st := st || jsonb_build_object('ward', (o->>'amount')::numeric);
  elsif o->>'kind' = 'reset' then
    for k in select key from jsonb_each(st->'cards') loop st := jsonb_set(st, array['cards', k, 'cd'], '0'); end loop;
  elsif o->>'kind' = 'shards' then st := dungeon_loot(st, (o->>'amount')::int, null);
  elsif o->>'kind' = 'card' then v_card := dungeon_card_of(coalesce(o->>'rarity', 'normal')); st := dungeon_loot(st, 0, v_card);
  end if;
  if o->>'kind' <> 'continue' then st := st || jsonb_build_object('last_pick', o->>'kind'); end if;
  v_f := r.floor; v_r := r.room + 1;
  if v_r > 5 then v_r := 5; end if;   -- the guardian ends a floor through floor_done, never here
  st := dungeon_enter(st, d.floors, v_f, v_r);
  update dungeon_runs set state = st, room = v_r where id = r.id;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'choose', 'pick', o), jsonb_build_object('card', v_card));
  return jsonb_build_object('ok', true, 'picked', o, 'card', v_card, 'state', st, 'floor', v_f, 'room', v_r, 'status', 'active');
end $$;

-- Leave with the loot: only on the "Loot gained" screen between floors (item 12).
create or replace function public.dungeon_retreat(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare r dungeon_runs; v jsonb;
begin
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' <> 'floor_done' then return jsonb_build_object('ok', false, 'error', 'not_between_floors'); end if;
  v := dungeon_settle(r.id, 'retreat', false);
  perform dungeon_log_add(r.id, '{"kind": "retreat"}', v);
  return jsonb_build_object('ok', true, 'floor', r.floor, 'room', r.room, 'shards', v->'shards', 'cards', v->'cards');
end $$;

-- The view (as v1) + the rooms ahead hidden ("?") except the guardian, and the old runs settled.
create or replace function public.dungeon_view(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day;
  select (e->>'rank')::int into v_rank from jsonb_array_elements(dungeon_board(v_day, 1000)) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, (cfg->>'budget')::int, 12),
    'squad', coalesce((cfg->>'squad')::int, 5), 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', coalesce((cfg->>'run_shards_cap')::int, 300),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'rarity', c.rarity::text,
               'cost', coalesce((cfg->'cost'->>c.rarity::text)::int, 1), 'cp', (x.cmb->>'cp')::int,
               'hp', case when s.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else card_max_hp(0) end,
               'slugs', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
             cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) cmb) x
             where pc.player_id = p_player and pc.quantity > 0),
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day),
    'top', dungeon_board(v_day, 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player
                    order by floor desc, room desc, turns limit 1));
end $$;

-- Today (and later) without a run yet: generated again with the v2 rooms and scaling.
delete from public.dungeon_days d where d.day >= dungeon_day() and not exists (select 1 from public.dungeon_runs r where r.day = d.day);

notify pgrst, 'reload schema';
