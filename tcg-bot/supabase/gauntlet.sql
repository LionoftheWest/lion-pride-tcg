-- The Gauntlet (Nathan 2026-10-03; docs/activities/03-dungeon-run.md "Gauntlet"): a weekly mode on the SAME
-- Dungeon engine. One squad and one dungeon for the whole week (Sunday to Saturday, America/Denver), the same for
-- everyone: 3 attackers + 2 supports, seeded, on the budget, no Event or Promo card, the supports fit the squad's
-- theme. All cards at base level (nobody needs to own them). One Gauntlet run a day; the best run of the week counts.
-- No loot in the Gauntlet (no Shards or cards from rooms, no treasure rooms); the room rewards still work.
-- Plus the leaderboard prizes for both boards (settings.dungeon_prizes, paid once by an hourly pg_cron tick).
-- A run carries a mode ('daily' | 'gauntlet'). The shared functions below are rebuilt from the live text with
-- the mode changes only; the guard refuses if any of them changed since. The member actions get p_mode
-- (default 'daily'), so the Dungeon calls stay the same.
-- Flags: settings.gauntlet.enabled, settings.dungeon_prizes.enabled (both default false).
-- Test: card-studio/scripts/test-dungeon.mjs (gauntlet*, prize*).
do $g$
declare x text[]; m text;
begin
  foreach x slice 1 in array array[['dungeon_offers', 'f683173e2aea7385570805f9f4c118e5', '96c341db587398eb879b07c969500409'],
    ['dungeon_enter', '8feecf401e00ed762e33125448a2dfff', '591317f3b1b3ef398d22ff0a4518b788'],
    ['dungeon_after_kill', '3a1f54b7341b4982fd63e8ac7d94658b', '7089cf3176ce3e6593fc48208b4cdee6'],
    ['dungeon_settle', '3ae0933a2aefdb6c53c21c0bc88163d9', '5d493824f4f6080d9a08c3491d9dc595'],
    ['dungeon_start', 'bb04624da5692c5d634e988e91e89c9f', 'e952ba662c6903abdbd766629f25a9b4'],
    ['dungeon_attack', 'c9858340b49c8040414bbe7a9cc976a1', '90585187581590dd5cbf03d936c92f33'],
    ['dungeon_support', '2a585109eb24719dbd354e50061967f9', '07722fee6e10161a268b477402eb66f4'],
    ['dungeon_choose', '4d00387fadf3af14c85e3662f94573a6', 'd4fae931e80f8ee8879efe0344a06ceb'],
    ['dungeon_retreat', '0e0ceb456382ba4bbd1a47e51df5b183', '370d82a58009283e749f5a8d3e89b99a'],
    ['dungeon_view', 'a63a0710d6f89738a69def51c811b097', 'f6dd1098039c4c09a693f1e39b80250b'],
    ['dungeon_board', '8952252f1741fc5ed771452d7ec5783d', 'e5e302af2f0732b67abb8394d3c071e9']] loop
    select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) into strict m from pg_proc p where p.proname = x[1] and p.pronamespace = 'public'::regnamespace;
    if m not in (x[2], x[3]) then raise exception 'gauntlet.sql: the live % changed since this file was built. Rebuild from the live text.', x[1]; end if;
  end loop;
end $g$;

-- ---- Settings ------------------------------------------------------------------------------------------
-- The Gauntlet (Nathan 2026-10-03): one squad and one dungeon for the whole week (Sunday to Saturday,
-- America/Denver), the same for everyone; one run a day; the best run of the week counts.
insert into public.settings (key, value) values ('gauntlet', jsonb_build_object(
  'enabled', false,
  'attackers', 3, 'supports', 2,           -- the squad: 3 attackers + 2 supports, on the Dungeon budget
  'budget', 12,
  'room_weights', jsonb_build_object('fight', 40, 'horde', 14, 'elite', 12, 'miniboss', 8, 'rest', 10, 'choice', 16)))   -- no treasure: no loot
on conflict (key) do nothing;

-- The leaderboard prizes (Nathan 2026-10-03). Rank 1..10. odds = card rarity weights (rolled per card).
insert into public.settings (key, value) values ('dungeon_prizes', jsonb_build_object(
  'enabled', false,
  'from', '2026-10-04',
  'daily', '[{"shards":300,"packs":2},{"shards":200,"packs":1},{"shards":150,"packs":1},
             {"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50}]'::jsonb,
  'weekly', '[{"shards":500,"packs":5,"cards":3,"odds":{"illustrated_rare":70,"secret_rare":30}},
              {"shards":300,"packs":3,"cards":2,"odds":{"normal":60,"illustrated_rare":32,"secret_rare":8}},
              {"shards":200,"packs":2,"cards":1,"odds":{"normal":75,"illustrated_rare":25}},
              {"packs":1},{"packs":1},{"packs":1},{"packs":1},{"packs":1},{"packs":1},{"packs":1}]'::jsonb))
on conflict (key) do nothing;

create or replace function public.gauntlet_cfg() returns jsonb language sql stable set search_path = public as $$
  select coalesce((select value from settings where key = 'gauntlet'), '{}'::jsonb);
$$;

-- ---- Storage ---------------------------------------------------------------------------------------------
-- A run is a Dungeon run with mode 'gauntlet' (the same engine). One run a day for each mode.
alter table public.dungeon_runs add column if not exists mode text not null default 'daily';
alter table public.dungeon_runs drop constraint if exists dungeon_runs_mode_check;
alter table public.dungeon_runs add constraint dungeon_runs_mode_check check (mode in ('daily', 'gauntlet'));
create unique index if not exists dungeon_runs_one_a_day_mode on public.dungeon_runs (player_id, day, mode);
drop index if exists public.dungeon_runs_one_a_day;

create table if not exists public.gauntlet_weeks (
  week date primary key,                 -- the Sunday
  name text not null,
  squad bigint[] not null,               -- 3 attackers, then 2 supports
  theme text,                            -- the tag the squad shares (a support's affinity), or null
  floors jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.gauntlet_weeks enable row level security;

-- Each paid leaderboard (a day of the Dungeon, a week of the Gauntlet), once.
create table if not exists public.dungeon_payouts (
  mode text not null check (mode in ('daily', 'gauntlet')),
  period date not null,
  winners jsonb not null default '[]',
  paid_at timestamptz not null default now(),
  primary key (mode, period)
);
alter table public.dungeon_payouts enable row level security;

-- ---- Helpers ---------------------------------------------------------------------------------------------
-- The Sunday of a day's week.
create or replace function public.gauntlet_week(p_day date) returns date language sql immutable as $$
  select p_day - extract(dow from p_day)::int;
$$;

-- A card at its base level (no ascension, no stat points): the Gauntlet squad is the same for everyone.
create or replace function public.dungeon_card_base(p_card bigint) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'type', s.type, 'rarity', c.rarity::text, 'season', c.season,
    'tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'ability', s.ability,
    'cmb', card_combat(c.rarity::text, 0, s.cp_mod, '{}'::jsonb))
  from cards c join subjects s on s.id = c.subject_id where c.id = p_card;
$$;

-- A squad card of a run: the member's own copy (Dungeon) or the base card (Gauntlet, only the week's squad).
create or replace function public.dungeon_run_card(p_run dungeon_runs, p_card bigint) returns jsonb
language sql stable set search_path = public as $$
  select case when p_run.mode = 'gauntlet' then case when p_card = any(p_run.squad) then dungeon_card_base(p_card) end
              else dungeon_card(p_run.player_id, p_card) end;
$$;

-- The floors of a run: the day's dungeon, or the week's Gauntlet.
create or replace function public.dungeon_run_floors(p_run dungeon_runs) returns jsonb
language sql stable set search_path = public as $$
  select case when p_run.mode = 'gauntlet' then (select floors from gauntlet_weeks where week = gauntlet_week(p_run.day))
              else (select floors from dungeon_days where day = p_run.day) end;
$$;

-- ---- The week's squad -------------------------------------------------------------------------------------
-- The cards the Gauntlet can seed: every card except Event and Promo cards (by source and by rarity), with
-- its role (an attacker: Character / Creature; a support: any other type with a support move), its cost, its
-- character key (two members' cards of one character share it: "A's Link" and "B's Link"), its tags and its
-- support affinity.
create or replace function public.gauntlet_pool() returns table (id bigint, ckey bigint, role text, cost int, tags text[], aff text)
language sql stable set search_path = public as $$
  select c.id, hashtext(lower(regexp_replace(c.name, '^[^'']*''s[[:space:]]+', '')))::bigint,
         case when s.type in ('Character', 'Creature') then 'attacker' else 'support' end,
         coalesce((dungeon_cfg()->'cost'->>c.rarity::text)::int, 1), coalesce(s.tag_slugs, '{}'), s.ability->>'affinity'
  from cards c join subjects s on s.id = c.subject_id
  where c.source::text not in ('event', 'promo') and c.rarity::text not in ('event', 'promo')
    and (s.type in ('Character', 'Creature') or (s.type is not null and s.ability->>'kind' = 'support'));
$$;

-- 3 attackers + 2 supports, 5 different characters, the cost within the budget (as close to it as possible:
-- a Gold card leaves less for the others). The theme: a support's affinity tag that at least 3 different
-- attackers carry; the attackers carry it and the supports match it, so the supports help the squad (the
-- x1.8 ally boost and the team scale). Every draw is seeded (the salt + the week): the same week always gives
-- the same squad. Without a theme, any attackers, and supports that match them where possible.
create or replace function public.gauntlet_squad(p_week date) returns jsonb
language plpgsql stable set search_path = public as $$
declare cfg jsonb := gauntlet_cfg();
  k text := coalesce(dungeon_cfg()->>'salt', 'lion') || '|gauntlet|' || p_week::text;
  v_budget int := coalesce((cfg->>'budget')::int, (dungeon_cfg()->>'budget')::int, 12);
  th text; pass int; a_id bigint[]; a_key bigint[]; a_cost int[]; a_tags text[]; s_id bigint[]; s_key bigint[]; s_cost int[]; s_aff text[];
  i int; j int; l int; m int; n int; c int; sc int; best int := -1; pick bigint[]; v_tags text[];
begin
  for pass in 1..2 loop
    th := null;
    if pass = 1 then
      select t.aff into th from (select distinct p.aff from gauntlet_pool() p where p.role = 'support' and p.aff is not null) t
      where (select count(distinct a.ckey) from gauntlet_pool() a where a.role = 'attacker' and t.aff = any(a.tags)) >= 3
      order by dungeon_rand(k || '|theme|' || t.aff) limit 1;
      continue when th is null;
    end if;
    -- The candidates (seeded order): 14 attacker cards (with the theme), 8 support cards (the theme first).
    select array_agg(x.id order by x.o), array_agg(x.ckey order by x.o), array_agg(x.cost order by x.o), array_agg(x.tg order by x.o)
      into a_id, a_key, a_cost, a_tags from (
      select p.id, p.ckey, p.cost, array_to_string(p.tags, ',') tg, dungeon_rand(k || '|a|' || p.id) o
      from gauntlet_pool() p where p.role = 'attacker' and (th is null or th = any(p.tags))
      order by o limit 14) x;
    select array_agg(y.id order by y.o), array_agg(y.ckey order by y.o), array_agg(y.cost order by y.o), array_agg(y.aff order by y.o)
      into s_id, s_key, s_cost, s_aff from (
      select p.id, p.ckey, p.cost, p.aff, (case when th is not null and p.aff = th then 0 else 1 end) + dungeon_rand(k || '|s|' || p.id) o
      from gauntlet_pool() p where p.role = 'support'
      order by o limit case when th is null then 12 else 8 end) y;
    continue when coalesce(array_length(a_id, 1), 0) < 3 or coalesce(array_length(s_id, 1), 0) < 2;
    -- Every combination: within the budget, 5 different characters; the best score wins (the first in seeded order).
    for i in 1..array_length(a_id, 1) - 2 loop for j in i + 1..array_length(a_id, 1) - 1 loop for l in j + 1..array_length(a_id, 1) loop
      continue when a_key[i] = a_key[j] or a_key[i] = a_key[l] or a_key[j] = a_key[l];
      v_tags := string_to_array(a_tags[i] || ',' || a_tags[j] || ',' || a_tags[l], ',');
      for m in 1..array_length(s_id, 1) - 1 loop for n in m + 1..array_length(s_id, 1) loop
        continue when s_key[m] = s_key[n] or s_key[m] = any(array[a_key[i], a_key[j], a_key[l]]) or s_key[n] = any(array[a_key[i], a_key[j], a_key[l]]);
        c := a_cost[i] + a_cost[j] + a_cost[l] + s_cost[m] + s_cost[n];
        continue when c > v_budget;
        sc := 100 * (case when c = v_budget then 2 when c = v_budget - 1 then 1 else 0 end)
            + 20 * ((case when th is not null and s_aff[m] = th then 1 else 0 end) + (case when th is not null and s_aff[n] = th then 1 else 0 end))
            + 10 * ((case when s_aff[m] = any(v_tags) then 1 else 0 end) + (case when s_aff[n] = any(v_tags) then 1 else 0 end));
        if sc > best then best := sc; pick := array[a_id[i], a_id[j], a_id[l], s_id[m], s_id[n]]; end if;
      end loop; end loop;
    end loop; end loop; end loop;
    exit when pick is not null;
  end loop;
  if pick is null then return null; end if;
  return jsonb_build_object('squad', to_jsonb(pick), 'theme', th,
    'cost', (select sum(p.cost) from gauntlet_pool() p where p.id = any(pick)));
end $$;

-- Build one week's Gauntlet (idempotent: a week that exists is kept): the squad and the floors (the Dungeon's
-- rooms and scaling, no treasure rooms: the Gauntlet has no loot).
create or replace function public.gauntlet_generate(p_week date) returns gauntlet_weeks
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); gc jsonb := gauntlet_cfg(); k text := coalesce(cfg->>'salt', 'lion') || '|gauntlet|' || p_week::text;
  v_floors jsonb := '[]'; v_rooms jsonb; v_type text; f int; r int; v_name text; rk text; sq jsonb; w gauntlet_weeks;
  names text[] := array['The Proving Grounds','The Iron Trial','The Long Descent','The Lion''s Gauntlet','The Endless Stair','The Crucible'];
  wts jsonb := coalesce(gc->'room_weights', '{"fight":40,"horde":14,"elite":12,"miniboss":8,"rest":10,"choice":16}');
begin
  select * into w from gauntlet_weeks where week = p_week;
  if found then return w; end if;
  sq := gauntlet_squad(p_week);
  if sq is null then raise exception 'gauntlet_generate: no squad fits the budget'; end if;
  v_name := names[1 + floor(dungeon_rand(k || '|name') * array_length(names, 1))::int];
  for f in 1..coalesce((cfg->>'floors')::int, 30) loop
    v_rooms := '[]';
    for r in 1..5 loop
      rk := k || '|' || f || '|' || r;
      v_type := case when r = 5 then 'guardian' when r = 1 then 'fight' else dungeon_pick(wts, dungeon_rand(rk || '|t')) end;
      v_rooms := v_rooms || jsonb_build_object('type', v_type,
        'foes', case when v_type in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then dungeon_room_foes(rk, f, r, v_type) else '[]'::jsonb end);
    end loop;
    v_floors := v_floors || jsonb_build_array(v_rooms);
  end loop;
  insert into gauntlet_weeks (week, name, squad, theme, floors)
  values (p_week, v_name, array(select (e #>> '{}')::bigint from jsonb_array_elements(sq->'squad') e), sq->>'theme', v_floors)
  on conflict (week) do nothing;
  select * into w from gauntlet_weeks where week = p_week;
  return w;
end $$;

-- The member actions get p_mode: the old signatures go (a new argument is a new function).
drop function if exists public.dungeon_attack(text, bigint, integer);
drop function if exists public.dungeon_support(text, bigint, bigint, integer);
drop function if exists public.dungeon_choose(text, integer);
drop function if exists public.dungeon_retreat(text);

-- ---- The shared Dungeon functions, with the mode ------------------------------------------------------
create or replace function public.dungeon_offers(p_state jsonb, p_floor int) returns jsonb
language plpgsql volatile set search_path = public as $$
declare pool text[] := case when p_state->>'mode' = 'gauntlet' then array['heal','buff','ward','reset','revive']   -- the Gauntlet: no loot
    else array['heal','buff','shards','card','ward','reset','revive'] end; v jsonb := '[]'; k text; t int; n int := 0;
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
    v := v || jsonb_build_object('kind', k, 'tier', t, 'amount', amt,   -- a card rolls its rarity when picked; the offer shows the odds
      'odds', case when k = 'card' then dungeon_cfg()->'chest_rarity'->(t::text) end);
    n := n + 1;
  end loop;
  return v;
end $$;

create or replace function public.dungeon_enter(p_state jsonb, p_floors jsonb, p_floor int, p_room int) returns jsonb
language plpgsql volatile set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_room jsonb := p_floors -> (p_floor - 1) -> (p_room - 1); st jsonb := p_state; k text; c jsonb;
  v_old int := coalesce((p_state->>'round')::int, 0); v_left int; t int; v_sh int; v_card bigint; doors text[] := case when p_state->>'mode' = 'gauntlet' then array['elite','rest','horde'] else array['elite','rest','treasure','horde','gamble'] end; d jsonb := '[]'; x text;
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
    v_card := case when random() < (array[0, 0.35, 0.6, 1, 1])[t] then dungeon_card_of(dungeon_chest_rarity(t)) end;   -- each tier rolls the rarity (Nathan)
    st := dungeon_loot(st, v_sh, v_card);
    st := st || jsonb_build_object('phase', 'chest', 'foes', '[]'::jsonb, 'chest', jsonb_build_object('tier', t, 'shards', v_sh, 'card', v_card),
      'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  end if;
  return st;
end $$;

create or replace function public.dungeon_after_kill(p_run dungeon_runs, p_state jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); st jsonb := p_state; v_card bigint := null; v_cleared boolean; v_last int; v_loot boolean := coalesce(p_state->>'mode', 'daily') <> 'gauntlet';   -- the Gauntlet: no loot
begin
  if v_loot then
    if random() < coalesce((cfg->>'loot_chance')::numeric, 0.06) then v_card := dungeon_card_of(dungeon_drop_rarity(p_run.floor)); end if;
    st := dungeon_loot(st, coalesce((cfg->>'shards_kill')::int, 1), v_card);
  end if;
  v_cleared := not exists (select 1 from jsonb_array_elements(st->'foes') f where (f->>'hp')::int > 0);
  if v_cleared then
    if st->>'room_type' = 'guardian' then
      if v_loot then st := dungeon_loot(st, coalesce((cfg->>'floor_shards')::int, 10) * p_run.floor, null); end if;
      -- The floor is done: its loot is banked (safe from now on).
      st := st || jsonb_build_object('floor_loot', st->'pend',
        'bank', jsonb_build_object('shards', coalesce((st->'bank'->>'shards')::int, 0) + coalesce((st->'pend'->>'shards')::int, 0),
                                   'cards', coalesce(st->'bank'->'cards', '[]') || coalesce(st->'pend'->'cards', '[]')),
        'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb));
      v_last := jsonb_array_length(dungeon_run_floors(p_run));
      st := st || jsonb_build_object('phase', case when p_run.floor >= v_last then 'cleared' else 'floor_done' end, 'offers', '[]'::jsonb);
    else
      st := st || jsonb_build_object('phase', 'choose', 'offers', dungeon_offers(st, p_run.floor));
    end if;
  end if;
  return jsonb_build_object('state', st, 'shards', case when v_loot then coalesce((cfg->>'shards_kill')::int, 1) else 0 end, 'card', v_card, 'cleared', v_cleared);
end $$;

create or replace function public.dungeon_settle(p_run_id bigint, p_how text, p_with_pend boolean) returns jsonb
language plpgsql set search_path = public as $$
declare r dungeon_runs; v_sh int; v_cards jsonb; x jsonb;
begin
  select * into r from dungeon_runs where id = p_run_id for update;
  if r.status <> 'active' then return jsonb_build_object('shards', r.shards, 'cards', to_jsonb(r.cards)); end if;
  if r.mode = 'gauntlet' then r.state := r.state - 'bank' - 'pend'; end if;   -- the Gauntlet grants no loot
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
  if exists (select 1 from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily') then return jsonb_build_object('ok', false, 'error', 'already'); end if;
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

create or replace function public.dungeon_attack(p_player text, p_card bigint, p_target int default null, p_mode text default 'daily') returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; f jsonb; v_t int; v_tags text[];
  v_ab jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; sq jsonb; wk jsonb; v_crit numeric; hit jsonb; v_dmg int := 0; v_heal int := 0;
  v_round int; v_pl text[]; ek text; kill jsonb := null; v_cmb jsonb; v_boost numeric := 0; et jsonb := null; v_maxhp int; v_guard int := 0; v_end jsonb := null;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
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
    select rule->>'boost_tag', coalesce((rule->>'boost')::numeric, 0) into ek, v_boost from dungeon_days where day = r.day and r.mode = 'daily';
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
    -- The squad falls when no ATTACKER stands (support cards alone cannot attack: the run was stuck).
    if not exists (select 1 from jsonb_each(st->'cards') where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false)) then st := st || '{"phase": "fell"}'; end if;
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

create or replace function public.dungeon_support(p_player text, p_card bigint, p_target_card bigint default null, p_target_foe int default null, p_mode text default 'daily') returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; v_ab jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text; v_aff text;
  v_round int; v_affc int := 0; v_scale numeric; v_matched boolean := false; tc jsonb; tinfo jsonb; f jsonb; v_t int; v_val numeric; k text; kill jsonb := null; v_end jsonb := null;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
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
    tinfo := dungeon_run_card(r, p_target_card);
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

create or replace function public.dungeon_choose(p_player text, p_pick int, p_mode text default 'daily') returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; d dungeon_days; st jsonb; o jsonb; k text; c jsonb; v_f int; v_r int; v_card bigint := null; v_to text; rk text;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  select * into d from dungeon_days where day = r.day;
  d.floors := dungeon_run_floors(r);   -- the day's dungeon or the week's Gauntlet
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
      st := dungeon_loot(st, 65 + 3 * r.floor, dungeon_card_of(dungeon_chest_rarity(4)));   -- the Ultra odds
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
  elsif o->>'kind' = 'card' then v_card := dungeon_card_of(dungeon_chest_rarity(coalesce((o->>'tier')::int, 1))); st := dungeon_loot(st, 0, v_card);   -- the tier odds (Nathan)
  end if;
  if o->>'kind' <> 'continue' then st := st || jsonb_build_object('last_pick', o->>'kind'); end if;
  v_f := r.floor; v_r := r.room + 1;
  if v_r > 5 then v_r := 5; end if;   -- the guardian ends a floor through floor_done, never here
  st := dungeon_enter(st, d.floors, v_f, v_r);
  update dungeon_runs set state = st, room = v_r where id = r.id;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'choose', 'pick', o), jsonb_build_object('card', v_card));
  return jsonb_build_object('ok', true, 'picked', o, 'card', v_card, 'state', st, 'floor', v_f, 'room', v_r, 'status', 'active');
end $$;

create or replace function public.dungeon_retreat(p_player text, p_mode text default 'daily') returns jsonb
language plpgsql set search_path = public as $$
declare r dungeon_runs; v jsonb;
begin
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if r.state->>'phase' <> 'floor_done' then return jsonb_build_object('ok', false, 'error', 'not_between_floors'); end if;
  v := dungeon_settle(r.id, 'retreat', false);
  perform dungeon_log_add(r.id, '{"kind": "retreat"}', v);
  return jsonb_build_object('ok', true, 'floor', r.floor, 'room', r.room, 'shards', v->'shards', 'cards', v->'cards');
end $$;

create or replace function public.dungeon_view(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
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
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'top', dungeon_board(v_day, 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1));
end $$;

create or replace function public.dungeon_board(p_day date default null, p_limit int default 20) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now())) rank,
           r.player_id, p.username, r.floor, r.room, r.turns, r.status, to_jsonb(r.squad) squad
    from dungeon_runs r join players p on p.id = r.player_id
    where r.day = coalesce(p_day, dungeon_day()) and r.mode = 'daily'
    order by r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now()) limit p_limit) x;
$$;

-- ---- The Gauntlet: start, board, view ------------------------------------------------------------------
-- Start today's Gauntlet run with the week's squad (the gate; one Gauntlet run a day).
create or replace function public.gauntlet_start(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); w gauntlet_weeks; g jsonb; c jsonb; x bigint;
  v_cards jsonb := '{}'; v_hp int; v_sup boolean; st jsonb; v_id bigint;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  perform 1 from players where id = p_player for update;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  if exists (select 1 from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet') then
    return jsonb_build_object('ok', false, 'error', 'already_gauntlet'); end if;
  w := gauntlet_generate(gauntlet_week(v_day));
  foreach x in array w.squad loop
    c := dungeon_card_base(x);
    v_sup := c->>'type' not in ('Character', 'Creature');
    v_hp := case when v_sup then card_max_hp(0) else (c->'cmb'->>'hp')::int end;
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup));
  end loop;
  st := dungeon_enter(jsonb_build_object('mode', 'gauntlet', 'cards', v_cards, 'buff', 1, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
          'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb)), w.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state, mode) values (p_player, v_day, w.squad, st, 'gauntlet') returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'mode', 'gauntlet', 'squad', to_jsonb(w.squad)), '{}');
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $$;

-- The week's leaderboard: each member's best run of the week (the deepest point, then fewer turns, then the
-- earlier finish).
create or replace function public.gauntlet_board(p_week date default null, p_limit int default 20) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by b.floor desc, b.room desc, b.turns, coalesce(b.ended_at, now())) rank,
           b.player_id, p.username, b.floor, b.room, b.turns, b.status, b.day, b.runs
    from (select distinct on (r.player_id) r.player_id, r.floor, r.room, r.turns, r.status, r.ended_at, r.day,
                 count(*) over (partition by r.player_id) runs
          from dungeon_runs r
          where r.mode = 'gauntlet' and r.day between coalesce(p_week, gauntlet_week(dungeon_day())) and coalesce(p_week, gauntlet_week(dungeon_day())) + 6
          order by r.player_id, r.floor desc, r.room desc, r.turns, coalesce(r.ended_at, now())) b
    join players p on p.id = b.player_id
    order by b.floor desc, b.room desc, b.turns, coalesce(b.ended_at, now()) limit p_limit) x;
$$;

-- Everything the Gauntlet tab needs for one member.
create or replace function public.gauntlet_view(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  select e into b from jsonb_array_elements(gauntlet_board(v_week, 100000)) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', coalesce((gauntlet_cfg()->>'budget')::int, (cfg->>'budget')::int, 12),
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', coalesce((cfg->'cost'->>(x.c->>'rarity'))::int, 1), 'cp', (x.c->'cmb'->>'cp')::int,
               'hp', case when x.c->>'type' in ('Character', 'Creature') then (x.c->'cmb'->>'hp')::int else card_max_hp(0) end,
               'slugs', x.c->'tags') order by x.o)
             from unnest(w.squad) with ordinality x0(id, o) cross join lateral (select x0.id, x0.o, dungeon_card_base(x0.id) c) x),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', 0, 'cards', '[]'::jsonb, 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', (b->>'rank')::int) end,
    'best', b,
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(w.floors->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(w.floors),
    'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet' and day between v_week and v_week + 6),
    'top', gauntlet_board(v_week, 3),
    'prizes', coalesce((select value->'weekly' from settings where key = 'dungeon_prizes'), '[]'::jsonb));
end $$;

-- ---- The leaderboard prizes ----------------------------------------------------------------------------
-- Pay one finished leaderboard ONCE (the payouts row is the lock): the Dungeon day ('daily', the day) or the
-- Gauntlet week ('gauntlet', the Sunday). Shards, packs, and for the Gauntlet podium random cards (each card
-- rolls its rarity on the place's odds). Every winner gets a notification.
create or replace function public.dungeon_pay(p_mode text, p_period date) returns jsonb
language plpgsql set search_path = public as $$
declare pz jsonb := coalesce((select value from settings where key = 'dungeon_prizes'), '{}'::jsonb); board jsonb; e jsonb; p jsonb;
  i int; v_cards jsonb; v_card bigint; v_out jsonb := '[]'; v_rar text; v_msg text;
begin
  if p_mode not in ('daily', 'gauntlet') then raise exception 'dungeon_pay: bad mode %', p_mode; end if;
  insert into dungeon_payouts (mode, period) values (p_mode, p_period) on conflict do nothing;
  if not found then return jsonb_build_object('ok', false, 'error', 'already_paid'); end if;
  perform dungeon_settle_stale();
  board := case when p_mode = 'daily' then dungeon_board(p_period, 10) else gauntlet_board(p_period, 10) end;
  for e in select x from jsonb_array_elements(board) x order by (x->>'rank')::int loop
    p := pz->(case when p_mode = 'daily' then 'daily' else 'weekly' end)->((e->>'rank')::int - 1);
    continue when p is null;
    if coalesce((p->>'shards')::int, 0) > 0 then
      perform grant_shards(e->>'player_id', (p->>'shards')::int, 'dungeon', 'prize_' || p_mode, p_period::text); end if;
    if coalesce((p->>'packs')::int, 0) > 0 then
      perform grant_packs(e->>'player_id', (p->>'packs')::int, 'dungeon_prize', null); end if;
    v_cards := '[]';
    for i in 1..coalesce((p->>'cards')::int, 0) loop
      v_rar := dungeon_pick(p->'odds', random()::numeric);
      v_card := dungeon_card_of(v_rar);
      if v_card is not null then
        perform add_card_to_player(e->>'player_id', v_card, 'dungeon_prize');
        v_cards := v_cards || jsonb_build_object('id', v_card, 'rarity', v_rar);
      end if;
    end loop;
    v_msg := format('%s #%s: %s', case when p_mode = 'daily' then 'Dungeon' else 'Gauntlet' end, e->>'rank',
      concat_ws(', ', case when coalesce((p->>'shards')::int, 0) > 0 then (p->>'shards') || ' Shards' end,
                      case when coalesce((p->>'packs')::int, 0) > 0 then (p->>'packs') || case when (p->>'packs')::int = 1 then ' pack' else ' packs' end end,
                      case when jsonb_array_length(v_cards) > 0 then jsonb_array_length(v_cards) || case when jsonb_array_length(v_cards) = 1 then ' card' else ' cards' end end));
    perform notify_player(e->>'player_id', 'dungeon_prize', v_msg);
    v_out := v_out || jsonb_build_object('rank', (e->>'rank')::int, 'player_id', e->>'player_id', 'shards', coalesce((p->>'shards')::int, 0),
      'packs', coalesce((p->>'packs')::int, 0), 'cards', v_cards);
  end loop;
  update dungeon_payouts set winners = v_out where mode = p_mode and period = p_period;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'period', p_period, 'winners', v_out);
end $$;

-- The hourly tick (pg_cron): pay every finished day and week since settings.dungeon_prizes.from that is not
-- paid yet. Off while settings.dungeon_prizes.enabled is false.
create or replace function public.dungeon_prize_tick() returns jsonb
language plpgsql set search_path = public as $$
declare pz jsonb := coalesce((select value from settings where key = 'dungeon_prizes'), '{}'::jsonb); v_from date; d date; v jsonb := '[]'; x jsonb;
begin
  if not coalesce((pz->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  v_from := coalesce((pz->>'from')::date, dungeon_day());
  for d in select g::date from generate_series(greatest(v_from, dungeon_day() - 7), dungeon_day() - 1, interval '1 day') g loop
    continue when exists (select 1 from dungeon_payouts where mode = 'daily' and period = d);
    x := dungeon_pay('daily', d); v := v || x;
  end loop;
  d := gauntlet_week(dungeon_day()) - 7;   -- the last finished week
  if d >= gauntlet_week(v_from) and not exists (select 1 from dungeon_payouts where mode = 'gauntlet' and period = d) then
    x := dungeon_pay('gauntlet', d); v := v || x;
  end if;
  return jsonb_build_object('ok', true, 'paid', v);
end $$;

do $c$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dungeon-prizes';
    perform cron.schedule('dungeon-prizes', '5 * * * *', 'select public.dungeon_prize_tick()');
  end if;
end $c$;

notify pgrst, 'reload schema';
