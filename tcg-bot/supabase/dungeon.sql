-- The Dungeon Run (docs/activities/03-dungeon-run.md; design 30 approved by Nathan 2026-10-03).
-- A new dungeon every day, the same for everyone; one run a day; a 5-card squad on a rarity budget;
-- floors of 5 rooms (room 5 = the floor guardian); loot (Shards + Normal / IR / SR cards); retreat;
-- one leaderboard by depth. THE COMBAT IS THE HUNT'S: every roll uses combat_core.sql (the same
-- functions as hunt_attack / hunt_support); this file keeps only the Dungeon's storage and its rules
-- on top (the daily rule, the run buff, loot, rooms).
-- The unlock gate (Nathan 2026-10-03): the starter gifts redeemed + at least 8 attackers.
-- Flag: settings.dungeon.enabled (default false). Test: card-studio/scripts/test-dungeon.mjs. Idempotent.

-- ---- Settings (every number is tunable without a migration) ------------------------------------------
insert into public.settings (key, value) values ('dungeon', jsonb_build_object(
  'enabled', false,
  'salt', md5(random()::text || clock_timestamp()::text),   -- a member cannot compute a future dungeon
  'squad', 5, 'budget', 12,
  'cost', jsonb_build_object('normal', 1, 'illustrated_rare', 2, 'secret_rare', 3, 'full_art', 4, 'gold', 5, 'event', 4, 'promo', 3),
  'floors', 30, 'round_cap', 40,
  'hp_floor', 0.30, 'hp_room', 0.05, 'atk_floor', 0.15,
  'elite', jsonb_build_object('hp', 1.8, 'atk', 1.25), 'guardian', jsonb_build_object('hp', 3.0, 'atk', 1.4),
  'shards_room', 5, 'shards_kill', 3, 'loot_chance', 0.15,
  'loot', jsonb_build_array(                         -- the card tier by depth (never Full Art or Gold)
    jsonb_build_object('to', 3,  'normal', 1.00, 'illustrated_rare', 0.00, 'secret_rare', 0.00),
    jsonb_build_object('to', 6,  'normal', 0.90, 'illustrated_rare', 0.10, 'secret_rare', 0.00),
    jsonb_build_object('to', 9,  'normal', 0.80, 'illustrated_rare', 0.18, 'secret_rare', 0.02),
    jsonb_build_object('to', 999,'normal', 0.70, 'illustrated_rare', 0.25, 'secret_rare', 0.05)),
  'heal', 0.30, 'run_buff', 0.10, 'rest_heal', 0.40, 'rest_revive', 0.25))
on conflict (key) do nothing;

create or replace function public.dungeon_cfg() returns jsonb language sql stable set search_path = public as $$
  select coalesce((select value from settings where key = 'dungeon'), '{}'::jsonb);
$$;

-- ---- The monsters (Quaternius CC0 models from poly.pizza, docs/activities/02-fight-engine.md 7.1) --------
-- model = the file tcg-activity/public/dungeon/monsters/<model>.glb (Idle, Attack/Punch/Bite, HitReact, Death).
create table if not exists public.dungeon_monsters (
  key text primary key, name text not null, model text not null,
  hp int not null, atk int not null, tags text[] not null default '{}'
);
insert into public.dungeon_monsters (key, name, model, hp, atk, tags) values
  ('slime',    'Slime',    'green_blob', 40, 10, '{trait:monster}'),
  ('ooze',     'Ooze',     'pink_slime', 45, 10, '{trait:monster,trait:toxic}'),
  ('skeleton', 'Skeleton', 'skeleton',   50, 13, '{trait:monster,trait:melee}'),
  ('zombie',   'Zombie',   'zombie',     60, 11, '{trait:monster,trait:melee}'),
  ('giant',    'Giant',    'giant',      75, 15, '{trait:humanoid,trait:strong}'),
  ('yeti',     'Yeti',     'yeti',       70, 13, '{trait:beast,trait:strong}'),
  ('demon',    'Demon',    'blue_demon', 55, 14, '{trait:spirit,trait:shadow}'),
  ('golem',    'Golem',    'goleling',   85, 12, '{trait:earth,trait:armored}'),
  ('squid',    'Squid',    'squidle',    45, 12, '{trait:beast,trait:air}'),
  ('raptor',   'Raptor',   'dino',       50, 14, '{trait:beast,trait:agile}')
on conflict (key) do nothing;
alter table public.dungeon_monsters enable row level security;

-- ---- The daily dungeon -------------------------------------------------------------------------------
create table if not exists public.dungeon_days (
  day date primary key,
  name text not null,
  rule jsonb not null,
  floors jsonb not null,
  checked jsonb,
  created_at timestamptz not null default now()
);
alter table public.dungeon_days enable row level security;

create table if not exists public.dungeon_runs (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  day date not null,
  squad bigint[] not null,
  state jsonb not null,
  floor int not null default 1,
  room int not null default 1,
  turns int not null default 0,
  status text not null default 'active' check (status in ('active', 'over')),
  ended_by text,                         -- 'fell' | 'retreat' | 'cleared'
  shards int not null default 0,
  cards bigint[] not null default '{}',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists dungeon_runs_one_a_day on public.dungeon_runs (player_id, day);
create index if not exists dungeon_runs_board on public.dungeon_runs (day, floor desc, room desc, turns);
alter table public.dungeon_runs enable row level security;

create table if not exists public.dungeon_log (
  run_id bigint not null references public.dungeon_runs(id) on delete cascade,
  n int not null,
  action jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, n)
);
alter table public.dungeon_log enable row level security;

-- The game day (mt_clock.sql).
create or replace function public.dungeon_day() returns date language sql stable set search_path = public as $$ select (now() at time zone 'America/Denver')::date; $$;

-- The unlock gate is adventure_gate() (adventure_gate.sql, applied first).

-- The daily rules (one is drawn each day). types = allowed card types (always with an attacker type).
create or replace function public.dungeon_rules() returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_array(
    jsonb_build_object('name', 'Creatures and Items only', 'note', 'Heroes, Spells and Memes stay home today.', 'types', jsonb_build_array('Creature', 'Item')),
    jsonb_build_object('name', 'Characters and Moments only', 'note', 'Only people and big moments today.', 'types', jsonb_build_array('Character', 'Moment')),
    jsonb_build_object('name', 'Characters and Places only', 'note', 'Bring your heroes and their home turf.', 'types', jsonb_build_array('Character', 'Place')),
    jsonb_build_object('name', 'No Gold today', 'note', 'Gold cards rest today.', 'no_rarity', jsonb_build_array('gold')),
    jsonb_build_object('name', 'Fire cards deal +25%', 'note', 'Bring the heat.', 'boost_tag', 'trait:fire', 'boost', 0.25),
    jsonb_build_object('name', 'Water cards deal +25%', 'note', 'Make a splash.', 'boost_tag', 'trait:water', 'boost', 0.25),
    jsonb_build_object('name', 'Shadow cards deal +25%', 'note', 'Lights out.', 'boost_tag', 'trait:shadow', 'boost', 0.25),
    jsonb_build_object('name', 'A budget of 9', 'note', 'Do more with less.', 'budget', 9),
    jsonb_build_object('name', 'Everything goes', 'note', 'Any card, the normal budget.'));
$$;

-- A seeded draw in 0..1 from a text key (stable for the day; never the session random state).
create or replace function public.dungeon_rand(p_key text) returns numeric language sql immutable set search_path = public as $$
  select (('x' || substr(md5(p_key), 1, 8))::bit(32)::bigint & 2147483647)::numeric / 2147483647;
$$;

-- Build one day's dungeon (idempotent: a day that exists is kept). Every draw comes from
-- dungeon_rand(salt|day|...), so the same day always gives the same dungeon.
create or replace function public.dungeon_generate(p_day date) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); k text := coalesce(cfg->>'salt', 'lion') || '|' || p_day::text;
  v_floors jsonb := '[]'; v_rooms jsonb; v_foes jsonb; v_type text; f int; r int; i int; n int; x numeric;
  m dungeon_monsters; v_el text; v_hp int; v_atk int; v_pass jsonb; v_rule jsonb; v_name text;
  els text[] := array['fire','water','lightning','earth','nature','ice','shadow','light'];
  counter jsonb := '{"fire":"water","water":"lightning","lightning":"earth","earth":"nature","nature":"fire","ice":"fire","shadow":"light","light":"shadow"}';
  kinds text[] := array['melee','ranged','caster','beast','hero','strong','agile'];
  passives text[] := array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied'];
  names text[] := array['The Sunken Crypt','The Ember Halls','Frostfang Caverns','The Rotting Grove','The Clockwork Depths','Shadowmere Keep','The Hollow Mines','Stormspire Tower'];
  v_monsters dungeon_monsters[];
begin
  if exists (select 1 from dungeon_days where day = p_day) then return (select to_jsonb(d) from dungeon_days d where day = p_day); end if;
  select array_agg(dm order by dm.key) into v_monsters from dungeon_monsters dm;
  v_rule := dungeon_rules() -> (floor(dungeon_rand(k || '|rule') * jsonb_array_length(dungeon_rules())))::int;
  v_name := names[1 + floor(dungeon_rand(k || '|name') * array_length(names, 1))::int];
  for f in 1..coalesce((cfg->>'floors')::int, 30) loop
    v_rooms := '[]';
    for r in 1..5 loop
      x := dungeon_rand(k || '|t|' || f || '|' || r);
      v_type := case when r = 5 then 'guardian'
                     when r = 1 then 'fight'
                     when x < 0.60 then 'fight' when x < 0.75 then 'elite' when x < 0.85 then 'treasure' else 'rest' end;
      v_foes := '[]';
      if v_type in ('fight', 'elite', 'guardian') then
        n := case when v_type = 'fight' then 1 + floor(dungeon_rand(k || '|n|' || f || '|' || r) * 3)::int else 1 end;
        for i in 1..n loop
          m := v_monsters[1 + floor(dungeon_rand(k || '|m|' || f || '|' || r || '|' || i) * array_length(v_monsters, 1))::int];
          v_el := els[1 + floor(dungeon_rand(k || '|e|' || f || '|' || r || '|' || i) * array_length(els, 1))::int];
          v_hp := round(m.hp * (1 + coalesce((cfg->>'hp_floor')::numeric, 0.3) * (f - 1)) * (1 + coalesce((cfg->>'hp_room')::numeric, 0.05) * (r - 1)));
          v_atk := round(m.atk * (1 + coalesce((cfg->>'atk_floor')::numeric, 0.15) * (f - 1)));
          v_pass := '[]';
          if v_type = 'elite' then
            v_hp := round(v_hp * coalesce((cfg->'elite'->>'hp')::numeric, 1.8)); v_atk := round(v_atk * coalesce((cfg->'elite'->>'atk')::numeric, 1.25));
            v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(k || '|p|' || f || '|' || r) * 7)::int]);
          elsif v_type = 'guardian' then
            v_hp := round(v_hp * coalesce((cfg->'guardian'->>'hp')::numeric, 3.0)); v_atk := round(v_atk * coalesce((cfg->'guardian'->>'atk')::numeric, 1.4));
            v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(k || '|p|' || f || '|' || r) * 7)::int],
                                        passives[1 + floor(dungeon_rand(k || '|q|' || f || '|' || r) * 7)::int]);
          end if;
          v_foes := v_foes || jsonb_build_object(
            'key', m.key, 'model', m.model, 'element', v_el, 'level', f,
            'name', initcap(v_el) || ' ' || m.name || case when v_type = 'elite' then ' (Elite)' when v_type = 'guardian' then ' Guardian' else '' end,
            'hp', v_hp, 'max', v_hp, 'atk', v_atk,
            'tags', to_jsonb(m.tags || array['trait:' || v_el]),
            'weak', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || (counter->>v_el)),
                                      jsonb_build_object('kind', 'tag', 'value', 'trait:' || kinds[1 + floor(dungeon_rand(k || '|w|' || f || '|' || r || '|' || i) * array_length(kinds, 1))::int])),
            'resist', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || v_el)),
            'passives', (select coalesce(jsonb_agg(distinct p), '[]'::jsonb) from jsonb_array_elements_text(v_pass) p));
        end loop;
      end if;
      v_rooms := v_rooms || jsonb_build_object('type', v_type, 'foes', v_foes);
    end loop;
    v_floors := v_floors || jsonb_build_array(v_rooms);
  end loop;
  insert into dungeon_days (day, name, rule, floors) values (p_day, v_name, v_rule, v_floors) on conflict (day) do nothing;
  return (select to_jsonb(d) from dungeon_days d where day = p_day);
end $$;

-- ---- Helpers ------------------------------------------------------------------------------------------

-- One card of the member, as the combat core needs it (card_combat: the stat points of this copy).
create or replace function public.dungeon_card(p_player text, p_card bigint) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'type', s.type, 'rarity', c.rarity::text, 'season', c.season,
    'tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'ability', s.ability,
    'cmb', card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points))
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0;
$$;

create or replace function public.dungeon_txt(p jsonb) returns text[] language sql immutable set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(p, '[]'::jsonb))), '{}');
$$;

-- Enter a room: a fight loads its monsters (fresh statuses, the round restarts); a rest heals the squad
-- and revives the downed cards; a treasure offers 3 picks.
create or replace function public.dungeon_enter(p_state jsonb, p_floors jsonb, p_floor int, p_room int) returns jsonb
language plpgsql stable set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_room jsonb := p_floors -> (p_floor - 1) -> (p_room - 1); st jsonb := p_state; k text; c jsonb;
begin
  st := st || jsonb_build_object('round', 0, 'room_type', v_room->>'type');
  if v_room->>'type' in ('fight', 'elite', 'guardian') then
    st := st || jsonb_build_object('phase', 'fight', 'foes',
      (select coalesce(jsonb_agg(f || jsonb_build_object('enr', 0, 'enru', 0, 'wk', 0, 'wku', 0, 'ex', 0, 'exu', 0, 'st', 0)), '[]'::jsonb)
         from jsonb_array_elements(v_room->'foes') f));
    -- The statuses of the cards end with the room (the Hunt's end with the day): buffs, curses, cooldowns.
    for k in select jsonb_object_keys(st->'cards') loop
      st := jsonb_set(st, array['cards', k], (st->'cards'->k) || '{"buff": 1, "debuff": 1, "cd": 0}');
    end loop;
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
  else -- treasure
    st := st || jsonb_build_object('phase', 'choose', 'foes', '[]'::jsonb, 'offers', jsonb_build_array(
      jsonb_build_object('kind', 'shards', 'amount', 40 + 10 * p_floor),
      jsonb_build_object('kind', 'card'),
      jsonb_build_object('kind', 'heal', 'amount', 0.5)));
  end if;
  return st;
end $$;

-- A card drop: the tier by depth (settings.dungeon.loot; never Full Art or Gold), then one draw-pool card.
create or replace function public.dungeon_drop_card(p_player text, p_floor int) returns bigint
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); t jsonb; x numeric := random(); v_rar text; v_card bigint;
begin
  select e into t from jsonb_array_elements(cfg->'loot') e where p_floor <= (e->>'to')::int order by (e->>'to')::int limit 1;
  v_rar := case when x < (t->>'secret_rare')::numeric then 'secret_rare'
                when x < (t->>'secret_rare')::numeric + (t->>'illustrated_rare')::numeric then 'illustrated_rare'
                else 'normal' end;
  select id into v_card from cards where rarity::text = v_rar and source::text = 'draw' and in_draw_pool order by random() limit 1;
  if v_card is not null then perform add_card_to_player(p_player, v_card, 'dungeon'); end if;
  return v_card;
end $$;

-- After a kill: the kill Shards and the card roll. After the last kill: the room Shards and the
-- rewards (a fight: Heal / Run buff / Shards; the guardian of the last floor ends the run as 'cleared').
create or replace function public.dungeon_after_kill(p_run dungeon_runs, p_state jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); st jsonb := p_state; v_sh int := coalesce((cfg->>'shards_kill')::int, 3); v_card bigint := null; v_cleared boolean;
begin
  perform grant_shards(p_run.player_id, v_sh, 'dungeon', 'kill', p_run.id::text);
  if random() < coalesce((cfg->>'loot_chance')::numeric, 0.15) then v_card := dungeon_drop_card(p_run.player_id, p_run.floor); end if;
  v_cleared := not exists (select 1 from jsonb_array_elements(st->'foes') f where (f->>'hp')::int > 0);
  if v_cleared then
    perform grant_shards(p_run.player_id, coalesce((cfg->>'shards_room')::int, 5), 'dungeon', 'room', p_run.id::text);
    v_sh := v_sh + coalesce((cfg->>'shards_room')::int, 5);
    st := st || jsonb_build_object('phase', case when p_run.room = 5 and p_run.floor >= jsonb_array_length((select floors from dungeon_days where day = p_run.day)) then 'cleared' else 'choose' end,
      'offers', jsonb_build_array(
        jsonb_build_object('kind', 'heal', 'amount', coalesce((cfg->>'heal')::numeric, 0.3)),
        jsonb_build_object('kind', 'buff', 'amount', coalesce((cfg->>'run_buff')::numeric, 0.1)),
        jsonb_build_object('kind', 'shards', 'amount', 20 + 5 * p_run.floor)));
  end if;
  return jsonb_build_object('state', st, 'shards', v_sh, 'card', v_card, 'cleared', v_cleared);
end $$;

-- The enemy turn: every monster still standing draws its action (combat_enemy_act, a surprise) against the
-- attacking card (the next card standing if it is down), area hits roll on every other card; then the
-- attacked monster's passives (thorns, flaming). Returns the new state and what happened.
create or replace function public.dungeon_enemy_turn(p_state jsonb, p_attacker bigint, p_attacked int, p_dmg int) returns jsonb
language plpgsql volatile set search_path = public as $$
declare st jsonb := p_state; v_round int := (p_state->>'round')::int + 1; i int; f jsonb; act jsonb; v_lost numeric; v_bmult numeric;
  v_tgt text; c jsonb; v_d int; ab jsonb; k text; raw int; v_out jsonb := '[]'; v_heal int; v_pl text[]; v_burn int; v_area jsonb;
begin
  st := st || jsonb_build_object('round', v_round);
  for i in 0..jsonb_array_length(st->'foes') - 1 loop
    f := st->'foes'->i;
    continue when (f->>'hp')::int <= 0;
    v_pl := dungeon_txt(f->'passives');
    v_lost := 1 - (f->>'hp')::numeric / greatest(1, (f->>'max')::int);
    v_bmult := combat_enemy_mult((f->>'enr')::numeric, (f->>'enru')::int, (f->>'wk')::numeric, (f->>'wku')::int, v_round,
                                 'volatile' = any(v_pl), v_lost, 'frenzied' = any(v_pl));
    act := combat_enemy_act((f->>'atk')::numeric, v_bmult, v_round, (f->>'st')::int, v_lost, (f->>'max')::int);
    -- The target: the attacking card, or the next card standing.
    v_tgt := case when not coalesce((st->'cards'->p_attacker::text->>'down')::boolean, true) then p_attacker::text
                  else (select key from jsonb_each(st->'cards') where not (value->>'down')::boolean order by key limit 1) end;
    exit when v_tgt is null;   -- the squad is down
    v_area := '[]';
    if act->>'action' in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then
      c := st->'cards'->v_tgt;
      ab := combat_absorb((c->>'shield')::int, (act->>'dmg')::int);
      v_d := (ab->>'dmg')::int;
      c := c || jsonb_build_object('shield', (ab->>'shield')::int, 'hp', greatest(0, (c->>'hp')::int - v_d));
      c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
      if act->>'action' = 'stun' then c := c || jsonb_build_object('cd', greatest((c->>'cd')::int, v_round + 1)); end if;
      st := jsonb_set(st, array['cards', v_tgt], c);
    end if;
    if (act->>'area')::numeric > 0 then   -- Slam / Cataclysm: every other card standing rolls its own hit
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
    end if;
    v_heal := (act->>'heal')::int;
    if 'regenerating' = any(v_pl) and act->>'action' <> 'stunned' then v_heal := v_heal + combat_regen((f->>'max')::int); end if;
    if v_heal > 0 then f := f || jsonb_build_object('hp', least((f->>'max')::int, (f->>'hp')::int + v_heal)); end if;
    st := jsonb_set(st, array['foes', i::text], f);
    v_out := v_out || jsonb_build_object('foe', i, 'action', act->>'action', 'card', v_tgt::bigint, 'dmg', coalesce(v_d, 0), 'area', v_area, 'heal', v_heal);
    v_d := null;
  end loop;
  -- The attacked monster's passives, if it still stands: Thorns (10% of the damage back), Flaming (a burn).
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
  return jsonb_build_object('state', st, 'actions', v_out, 'burned', coalesce(v_burn, 0));
end $$;

-- End the run: 'fell' | 'retreat' | 'cleared'. The depth is the room reached.
create or replace function public.dungeon_end(p_run_id bigint, p_how text) returns void language sql set search_path = public as $$
  update dungeon_runs set status = 'over', ended_by = p_how, ended_at = now(),
    state = jsonb_set(state, '{phase}', '"over"') where id = p_run_id;
$$;

create or replace function public.dungeon_log_add(p_run bigint, p_action jsonb, p_result jsonb) returns void language sql set search_path = public as $$
  insert into dungeon_log (run_id, n, action, result)
    values (p_run, coalesce((select max(n) from dungeon_log where run_id = p_run), 0) + 1, p_action, p_result);
$$;

-- ---- The member's actions -------------------------------------------------------------------------

-- Start today's run with a squad (the gate, 5 owned cards, an attacker, today's rule, the budget).
create or replace function public.dungeon_start(p_player text, p_cards bigint[]) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d dungeon_days; g jsonb; v_n int := coalesce((cfg->>'squad')::int, 5);
  v_cost int := 0; v_budget int; c jsonb; v_cards jsonb := '{}'; x bigint; v_att int := 0; v_hp int; st jsonb; v_id bigint;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  perform 1 from players where id = p_player for update;
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
    if c->>'type' in ('Character', 'Creature') then v_att := v_att + 1; v_hp := (c->'cmb'->>'hp')::int;
    else v_hp := card_max_hp(0); end if;   -- a support card: the Hunt's HP floor
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0));
  end loop;
  if v_att = 0 then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;
  if v_cost > v_budget then return jsonb_build_object('ok', false, 'error', 'budget', 'cost', v_cost, 'budget', v_budget); end if;
  st := dungeon_enter(jsonb_build_object('cards', v_cards, 'buff', 1), d.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state) values (p_player, v_day, p_cards, st) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'squad', to_jsonb(p_cards)), jsonb_build_object('cost', v_cost));
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $$;

-- An attack (ends the turn): the Hunt's attack roll on one monster, then the monsters' turn.
create or replace function public.dungeon_attack(p_player text, p_card bigint, p_target int default null) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; f jsonb; v_t int; v_tags text[];
  v_ab jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; sq jsonb; wk jsonb; v_crit numeric; hit jsonb; v_dmg int := 0; v_heal int := 0;
  v_round int; v_pl text[]; ek text; kill jsonb := null; v_cmb jsonb; v_boost numeric := 0; et jsonb := null; v_maxhp int;
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
    perform dungeon_end(r.id, 'fell'); return jsonb_build_object('ok', false, 'error', 'round_cap'); end if;
  -- Stunned: it waits a round while another attacker can act (the Hunt's rule).
  if (c->>'cd')::int >= v_round + 1 and exists (
      select 1 from jsonb_each(st->'cards') e join cards cc on cc.id = e.key::bigint join subjects s on s.id = cc.subject_id
      where e.key <> p_card::text and not (e.value->>'down')::boolean and (e.value->>'cd')::int < v_round + 1 and s.type in ('Character', 'Creature')) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  -- The target: the chosen monster if it stands, else the first one standing.
  select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target then 0 else 1 end), e.ord limit 1;
  f := st->'foes'->v_t;
  v_tags := dungeon_txt(info->'tags'); v_pl := dungeon_txt(f->'passives');
  v_ab := info->'ability'; v_cmb := info->'cmb'; v_maxhp := (c->>'max')::int;
  v_aeff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' else null end;
  v_aamt := coalesce((v_ab->>'amount')::numeric, 0); v_athresh := coalesce((v_ab->>'threshold')::numeric, 0);
  -- THE COMBAT CORE (the same functions as hunt_attack).
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
  -- The Dungeon's rules on top: the run buff and today's rule boost.
  if v_dmg > 0 then
    select rule->>'boost_tag', coalesce((rule->>'boost')::numeric, 0) into ek, v_boost from dungeon_days where day = r.day;
    v_dmg := greatest(1, round(v_dmg * (st->>'buff')::numeric * (1 + case when ek is not null and ek = any(v_tags) then v_boost else 0 end)))::int;
  end if;
  f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_dmg));
  st := jsonb_set(st, array['foes', v_t::text], f);
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);
    st := jsonb_set(st, array['cards', p_card::text, 'hp'], to_jsonb(least(v_maxhp, (c->>'hp')::int + v_heal)));
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'buff'], '1');   -- Empower is used by this attack (the Hunt's rule)
  if (f->>'hp')::int <= 0 then
    kill := dungeon_after_kill(r, st); st := kill->'state';
    update dungeon_runs set shards = shards + (kill->>'shards')::int,
      cards = cards || case when kill->>'card' is null then '{}'::bigint[] else array[(kill->>'card')::bigint] end where id = r.id;
  end if;
  if st->>'phase' = 'fight' then
    et := dungeon_enemy_turn(st, p_card, v_t, v_dmg); st := et->'state';
    if not exists (select 1 from jsonb_each(st->'cards') where not (value->>'down')::boolean) then st := st || '{"phase": "fell"}'; end if;
  end if;
  update dungeon_runs set state = st, turns = turns + 1 where id = r.id;
  if st->>'phase' = 'fell' then perform dungeon_end(r.id, 'fell'); elsif st->>'phase' = 'cleared' then perform dungeon_end(r.id, 'cleared'); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'attack', 'card', p_card, 'target', v_t),
    jsonb_build_object('dmg', v_dmg, 'outcome', hit->>'outcome', 'double', hit->'double', 'heal', v_heal, 'enemy', et->'actions', 'kill', kill));
  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', hit->>'outcome', 'crit', hit->'crit', 'double', hit->'double',
    'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'heal', v_heal, 'target', v_t,
    'kill', kill is not null, 'loot', case when kill is null then null else jsonb_build_object('shards', kill->'shards', 'card', kill->'card') end,
    'enemy', coalesce(et->'actions', '[]'::jsonb), 'burned', coalesce(et->'burned', '0'),
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $$;

-- A support (does not end the turn): the Hunt's support rules (cooldown, affinity, matched, potency, the
-- stun immunity) on a squad card or a monster.
create or replace function public.dungeon_support(p_player text, p_card bigint, p_target_card bigint default null, p_target_foe int default null) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; v_ab jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text; v_aff text;
  v_round int; v_affc int := 0; v_scale numeric; v_matched boolean := false; tc jsonb; tinfo jsonb; f jsonb; v_t int; v_val numeric; k text; kill jsonb := null;
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
  if v_round < (c->>'cd')::int then return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', (c->>'cd')::int, 'round', v_round); end if;
  v_eff := v_ab->>'effect';
  v_amt := coalesce((v_ab->>'amount')::numeric, 0) * coalesce((info->'cmb'->>'potency')::numeric, 1);   -- Potency points
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
    for k in select jsonb_object_keys(st->'cards') loop st := jsonb_set(st, array['cards', k, 'debuff'], '1'); end loop;
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
    if (f->>'hp')::int <= 0 then
      kill := dungeon_after_kill(r, st); st := kill->'state';
      update dungeon_runs set shards = shards + (kill->>'shards')::int,
        cards = cards || case when kill->>'card' is null then '{}'::bigint[] else array[(kill->>'card')::bigint] end where id = r.id;
    end if;
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + v_cd));
  update dungeon_runs set state = st where id = r.id;
  if st->>'phase' = 'cleared' then perform dungeon_end(r.id, 'cleared'); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'support', 'card', p_card, 'target_card', p_target_card, 'target_foe', v_t),
    jsonb_build_object('effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'kill', kill));
  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'aff_count', v_affc,
    'ready_round', v_round + v_cd, 'kill', kill is not null,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $$;

-- Pick a reward (or continue after a rest), then enter the next room.
create or replace function public.dungeon_choose(p_player text, p_pick int) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; d dungeon_days; st jsonb; o jsonb; k text; c jsonb; v_card bigint := null; v_sh int := 0; v_f int; v_r int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' not in ('choose', 'rest') then return jsonb_build_object('ok', false, 'error', 'not_choosing'); end if;
  o := st->'offers'->coalesce(p_pick, 0);
  if o is null then return jsonb_build_object('ok', false, 'error', 'bad_pick'); end if;
  if o->>'kind' = 'heal' then
    for k in select key from jsonb_each(st->'cards') where not (value->>'down')::boolean loop
      c := st->'cards'->k;
      st := jsonb_set(st, array['cards', k, 'hp'], to_jsonb(least((c->>'max')::int, (c->>'hp')::int + round((c->>'max')::int * (o->>'amount')::numeric)::int)));
    end loop;
  elsif o->>'kind' = 'buff' then
    st := st || jsonb_build_object('buff', round((st->>'buff')::numeric + (o->>'amount')::numeric, 2));
  elsif o->>'kind' = 'shards' then
    v_sh := (o->>'amount')::int; perform grant_shards(p_player, v_sh, 'dungeon', 'reward', r.id::text);
  elsif o->>'kind' = 'card' then
    v_card := dungeon_drop_card(p_player, r.floor);
  end if;
  select * into d from dungeon_days where day = r.day;
  v_f := r.floor + case when r.room = 5 then 1 else 0 end;
  v_r := case when r.room = 5 then 1 else r.room + 1 end;
  if v_f > jsonb_array_length(d.floors) then
    update dungeon_runs set state = st where id = r.id; perform dungeon_end(r.id, 'cleared');
  else
    st := dungeon_enter(st - 'offers', d.floors, v_f, v_r);
    update dungeon_runs set state = st, floor = v_f, room = v_r, shards = shards + v_sh,
      cards = cards || case when v_card is null then '{}'::bigint[] else array[v_card] end where id = r.id;
  end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'choose', 'pick', o), jsonb_build_object('card', v_card, 'shards', v_sh));
  return jsonb_build_object('ok', true, 'picked', o, 'card', v_card, 'shards', v_sh,
    'state', (select state from dungeon_runs where id = r.id), 'floor', (select floor from dungeon_runs where id = r.id),
    'room', (select room from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $$;

-- Retreat: the run ends here; the member keeps the depth and all the loot (the same result as a fall).
create or replace function public.dungeon_retreat(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare r dungeon_runs;
begin
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  perform dungeon_end(r.id, 'retreat');
  perform dungeon_log_add(r.id, '{"kind": "retreat"}', '{}');
  return jsonb_build_object('ok', true, 'floor', r.floor, 'room', r.room, 'shards', r.shards, 'cards', to_jsonb(r.cards));
end $$;

-- ---- The view and the leaderboard -------------------------------------------------------------------

-- Today's leaderboard: the deepest point (floor, then room), then fewer turns, then the earlier finish.
create or replace function public.dungeon_board(p_day date default null, p_limit int default 20) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now())) rank,
           r.player_id, p.username, r.floor, r.room, r.turns, r.status, to_jsonb(r.squad) squad
    from dungeon_runs r join players p on p.id = r.player_id
    where r.day = coalesce(p_day, dungeon_day())
    order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now()) limit p_limit) x;
$$;

-- Everything the Dungeon tab needs for one member.
create or replace function public.dungeon_view(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day;
  select (e->>'rank')::int into v_rank from jsonb_array_elements(dungeon_board(v_day, 1000)) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, (cfg->>'budget')::int, 12),
    'squad', coalesce((cfg->>'squad')::int, 5), 'cost', cfg->'cost', 'gate', adventure_gate(p_player),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    -- The rooms of the member's floor (the progress bar): the type and the guardian's name.
    'rooms', (select jsonb_agg(jsonb_build_object('type', rm->>'type', 'name', rm->'foes'->0->>'name')) from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) rm),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day),
    -- The member's cards with the stats of each copy (card_combat: the one stat source).
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'rarity', c.rarity::text,
               'cost', coalesce((cfg->'cost'->>c.rarity::text)::int, 1), 'cp', (x.cmb->>'cp')::int,
               'hp', case when s.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else card_max_hp(0) end,
               'slugs', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
             cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) cmb) x
             where pc.player_id = p_player and pc.quantity > 0),
    'top', dungeon_board(v_day, 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player
                    order by floor desc, room desc, turns limit 1));
end $$;

notify pgrst, 'reload schema';
