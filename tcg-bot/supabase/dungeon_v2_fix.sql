-- The Dungeon v2 fix (2026-10-03, found in the preview): when every attacker is down but a support card
-- still stands, the run could not go on (no attack possible) and never ended. Now the squad falls when no
-- attacker stands. dungeon_attack is rebuilt from the live text (dungeon_v2.sql) with that one change; the
-- guard refuses to run if the live function changed since. Test: card-studio/scripts/test-dungeon.mjs (lastatk).
do $g$ begin
  if md5(replace(pg_get_functiondef('public.dungeon_attack(text,bigint,integer)'::regprocedure), chr(13), '')) not in ('d90317cceb1873ff5975adc3e2a9d69e', 'c9858340b49c8040414bbe7a9cc976a1') then
    raise exception 'dungeon_v2_fix.sql: the live dungeon_attack changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;

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


notify pgrst, 'reload schema';
