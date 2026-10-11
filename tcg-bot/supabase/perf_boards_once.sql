-- perf_boards_once.sql (2026-10-11). Database load: dungeon_view_core (the Home slide, the lobby) and gauntlet_view read the day's
-- (the week's) board TWICE per call: the whole board to find the member's rank, then the board again for the top 3. The board is a
-- window over every run of the day joined to players, built to JSON, so with many members each call paid for it twice.
-- Change (built from the LIVE text of 2026-10-11): read the board once into v_board; the rank and the top 3 both come from it.
--   The answer is the same, key by key. (When two runs tie on floor, room, turns and end time, the old text ordered them
--   twice, in two sorts, and could rank the member and the top 3 differently; now both come from one order.)
-- No balance number and no rule changes. Test: card-studio/scripts/test-boards-once.mjs.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or the text this file made.
do $g$
declare m1 text; m2 text;
begin
  select md5(replace(pg_get_functiondef('public.dungeon_view_core(text, boolean)'::regprocedure), chr(13), '')) into strict m1;
  select md5(replace(pg_get_functiondef('public.gauntlet_view(text)'::regprocedure), chr(13), '')) into strict m2;
  if m1 not in ('4f02385121c6ef7960cfb2da85b91edf', '56225e90cb1741b61612b61d82558988') then
    raise exception 'perf_boards_once.sql: the live dungeon_view_core changed since this file was built. Rebuild it from the live text.';
  end if;
  if m2 not in ('0b729835b6ce3b124f0c947b1098a8de', '76df0a1b192308eba8b1422c670d7956') then
    raise exception 'perf_boards_once.sql: the live gauntlet_view changed since this file was built. Rebuild it from the live text.';
  end if;
end $g$;
-- GUARD-END

create or replace function public.dungeon_view_core(p_player text, p_mine boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int; v_mine jsonb := '{}'::jsonb;
  v_b jsonb; v_cost jsonb; v_h0 int; v_board jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  v_board := dungeon_board(v_day, 1000);   -- read ONCE: the member's rank and the top 3 both come from it
  select (e->>'rank')::int into v_rank from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  if p_mine then
    v_b := card_balance(); v_cost := balance_get('dungeon')->'cost'; v_h0 := card_max_hp(0);
    v_mine := jsonb_build_object('mine', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'rarity', c.rarity::text,
               'cost', coalesce((v_cost->>c.rarity::text)::numeric, balance_num('dungeon', 'cost', c.rarity::text))::int, 'cp', (x.cmb->>'cp')::int,
               'hp', case when s.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else v_h0 end,
               'slugs', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
             cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points, v_b) cmb) x
             where pc.player_id = p_player and pc.quantity > 0));
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
    'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', balance_num('dungeon_rewards', 'run_shards_cap')::int,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1)) || v_mine;
end $function$;

create or replace function public.gauntlet_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb; v_board jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  v_board := gauntlet_board(v_week, 100000);   -- read ONCE: the member's row and the top 3 both come from it
  select e into b from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', balance_num('gauntlet', 'budget')::int,
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', balance_num('dungeon', 'cost', x.c->>'rarity')::int, 'cp', (x.c->'cmb'->>'cp')::int,
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
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $function$;

grant execute on function public.dungeon_view_core(text, boolean) to postgres, service_role;
grant execute on function public.gauntlet_view(text) to postgres, service_role;
notify pgrst, 'reload schema';
