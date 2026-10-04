-- Reward card odds (Nathan, 2026-10-03): a reward card after a room rolls its rarity on the same tier odds
-- as a chest card (settings.dungeon.chest_rarity, dungeon_chest_odds.sql), when it is picked. Before, each tier
-- gave one fixed rarity (Common/Uncommon a Normal, Rare/Ultra an IR, Legend an SR).
-- dungeon_offers (dungeon_v2.sql) and dungeon_choose (dungeon_chest_odds.sql) are rebuilt from the live text with
-- that one change each; the guard refuses if either live function changed since.
-- Test: card-studio/scripts/test-dungeon.mjs (rewardodds).
do $g$ begin
  if md5(replace(pg_get_functiondef('public.dungeon_offers'::regproc), chr(13), '')) not in ('fa9c1d96e58b0806d12c3adcb3e5b365', 'f683173e2aea7385570805f9f4c118e5')
     or md5(replace(pg_get_functiondef('public.dungeon_choose'::regproc), chr(13), '')) not in ('b102526831296918c830ec2b5222cfce', '4d00387fadf3af14c85e3662f94573a6') then
    raise exception 'dungeon_reward_odds.sql: a live function changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;

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
    v := v || jsonb_build_object('kind', k, 'tier', t, 'amount', amt,   -- a card rolls its rarity when picked; the offer shows the odds
      'odds', case when k = 'card' then dungeon_cfg()->'chest_rarity'->(t::text) end);
    n := n + 1;
  end loop;
  return v;
end $$;
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
notify pgrst, 'reload schema';
