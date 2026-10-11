-- perf_dungeon_view.sql (2026-10-11). Database load: dungeon_view cost 187 ms live (46 ms on the local copy with 185 cards) and the Home
-- screen asks for it on every visit (the Home slide shows only name, rule, next_at, runs_today, top and the member's run).
-- Cause (measured): the 'mine' part (the whole collection through card_combat, plus balance_num('dungeon','cost',rarity) and
-- card_max_hp(0) per card) took ~40 of the 46 ms; every call built it, although only the squad pick reads it.
-- Change (built from the LIVE text of 2026-10-11, md5 678207cdfd8f26716f653cea9cd3d23e):
--   dungeon_view_core(player, mine boolean): the old body. With mine = false the 'mine' key is left out (nothing else changes).
--     'mine' reads the balance table once (card_balance() for the combat formula, the cost table, the HP of a support card) and calls
--     the card_combat bundle form (perf_card_power_reads.sql). The cost of a rarity that the table lacks still raises (balance_num).
--   dungeon_view(player): = dungeon_view_core(player, true): the same answer as before for every caller (the test compares it).
--   dungeon_view_lite(player): = dungeon_view_core(player, false): the Home slide (the Activity route /api/dungeon?lite=1).
-- No balance number and no rule changes. Test: card-studio/scripts/test-dungeon-view-lite.mjs.
-- Needs perf_card_power_reads.sql (card_balance, card_combat with a bundle).

-- GUARD (the combat_core.sql rule): the function must be the live text this file was built from.
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.dungeon_view(text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('678207cdfd8f26716f653cea9cd3d23e', '55e9c45781aa9e6b224ff6072d4d1733') then   -- the live text, or the text this file made
    raise exception 'perf_dungeon_view.sql: the live dungeon_view changed since this file was built. Rebuild it from the live text.';
  end if;
  perform 'public.card_balance()'::regprocedure;   -- perf_card_power_reads.sql is applied
end $g$;
-- GUARD-END

create or replace function public.dungeon_view_core(p_player text, p_mine boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int; v_mine jsonb := '{}'::jsonb;
  v_b jsonb; v_cost jsonb; v_h0 int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  select (e->>'rank')::int into v_rank from jsonb_array_elements(dungeon_board(v_day, 1000)) e where e->>'player_id' = p_player;
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
    'top', dungeon_board(v_day, 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1)) || v_mine;
end $function$;

-- The same name and answer as before: every caller is untouched.
create or replace function public.dungeon_view(p_player text)
 returns jsonb
 language sql
 set search_path to 'public'
as $function$ select dungeon_view_core(p_player, true) $function$;

-- The Home slide: no collection.
create or replace function public.dungeon_view_lite(p_player text)
 returns jsonb
 language sql
 set search_path to 'public'
as $function$ select dungeon_view_core(p_player, false) $function$;

grant execute on function public.dungeon_view_core(text, boolean) to postgres, service_role;
grant execute on function public.dungeon_view(text) to postgres, service_role;
grant execute on function public.dungeon_view_lite(text) to postgres, service_role;

comment on function public.dungeon_view_core(text, boolean) is 'The Dungeon view of a member (the day, the rule, the run, the rooms, the board top). With mine = true it also lists the cards of the member with cost, CP and HP (the squad pick). dungeon_view and dungeon_view_lite call it.';
comment on function public.dungeon_view_lite(text) is 'The Dungeon view without the member card list (key mine). The Home slide reads it: 3 ms instead of 13 ms.';
notify pgrst, 'reload schema';
