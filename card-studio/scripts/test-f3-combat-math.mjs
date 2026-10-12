/**
 * Acceptance test for tcg-bot/supabase/f3_one_combat_math.sql (F-3 PR 1), with NO lasting change (one DO block, rolled back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-f3-combat-math.mjs [file.sql]
 * Without a file it tests the CURRENT functions (test-all-local.mjs and rehearse-sql.mjs: the file is applied already).
 *   1. Haste lowers the support cooldown in the Hunt and the Dungeon (raw 3, 5 points: 2), never below 1 round (15 points on
 *      a cooldown of 2: 1); with no points the cooldown is the raw one. combat_cooldown at the edges.
 *   2. One Attack point raises the CP and NOT the HP; one Vitality point raises the HP and NOT the CP (card_combat and a fight).
 *      Flag OFF: card_combat = card_power + card_max_hp.
 *   3. The auto-pick and the fight give the same team value for the same squad: hunt_squad_value (the value hunt_autopick
 *      maximizes) per card = the damage of hunt_attack for that card with the random parts fixed (roll 1, no miss, crit, block),
 *      on an armored boss with a weakness, every squad card in the fight.
 *   4. hunt_autopick: never a downed card; 6 attackers + 2 supports; the daily limit; its squad has the highest value of every
 *      squad of a small pool (full search).
 *   5. combat_squad and combat_weak answer EXACTLY as the texts before the file (db/schema of 2026-10-11) for 400 random squads
 *      of real cards and boss weaknesses; combat_card_facts: elem = card_element and els = element_of for every subject.
 *   6. hunt_view crit (the card viewer) = combat_crit_chance of each attacker.
 * Mutations (each must FAIL): MUTATE=haste|floor|dhaste|attackhp|vitality|value|synergy|crit
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GATE, mutation } from './fixtures.mjs';
const ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)?.[1] || 'local';
const file = process.argv[2];
const mig = file ? readFileSync(file, 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
if (mig.includes('$m$')) throw new Error('the file must not contain $m$');
const MUT = mutation({
  haste: ['public.hunt_support(text,bigint,bigint,bigint)', `combat_cooldown(coalesce((v_ability->>'cooldown')::int, 1), (v_scmb->>'haste')::numeric)`, `coalesce((v_ability->>'cooldown')::int, 1)`],
  floor: ['public.combat_cooldown(integer,numeric)', 'greatest(1, ', 'greatest(0, '],
  dhaste: ['public.dungeon_support(text,bigint,bigint,integer,text)', `combat_cooldown(coalesce((v_ab->>'cooldown')::int, 1), (info->'cmb'->>'haste')::numeric)`, `coalesce((v_ab->>'cooldown')::int, 1)`],
  attackhp: ['public.card_combat(text,integer,numeric,jsonb,jsonb)', 'card_max_hp(round(v_x)::int, fl, per)', 'card_max_hp(v_cp, fl, per)'],
  vitality: ['public.card_combat(text,integer,numeric,jsonb,jsonb)', `* (1 + (c->>'vitality')::numeric * sv))::int`, ')::int'],
  value: ['public.combat_squad_value(jsonb,integer,jsonb)', `* (e->>'arm')::numeric`, ''],
  crit: ['public.hunt_card_crits(text,bigint)', `card_combat('normal', 0, 1, d.pts, v_b)`, `card_combat('normal', 0, 1, '{}'::jsonb, v_b)`],
  synergy: ['public.combat_squad_core(jsonb,boolean,jsonb,jsonb)', `count(*) filter (where o->'els' ? v_elem) + 1`, `count(*) filter (where o->'els' ? v_elem) + 2`],
});
const P = 'tst_f3m';

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; r2 jsonb; h bigint; h2 bigint; sup3 bigint; sup2 bigint; atk bigint[]; melee bigint; pool bigint[];
  v_day date := (now() at time zone 'America/Denver')::date; sv jsonb; e jsonb; d int; bad text; n int; ok boolean; i int; ids bigint[];
  best numeric; v numeric; s bigint[]; run bigint; st jsonb; cmb0 jsonb; cmb1 jsonb; cmb2 jsonb; c3 bigint; c2 bigint;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  ${MUT}
  perform set_config('tcg.skip_welcome', 'on', true);
  update balance set value = value || '{"enabled": true}' where key = 'stat_points';

  -- 1. Haste in the Hunt: a support with cooldown 3 and one with cooldown 2 (the lowest normal ids).
  select min(c.id) into c3 from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') and (s.ability->>'cooldown')::int = 3 and s.ability->>'target' = 'boss';
  select min(c.id) into c2 from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') and (s.ability->>'cooldown')::int = 2 and s.ability->>'target' = 'team';
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 4) x;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, hp_share, opens_at, closes_at, status, passive)
    values ('F3 Boss', 'Normal', '[]', '[]', 900000, 900000, 900000, now() - interval '1 hour', now() + interval '1 day', 'active', '{}') returning id into h;
  for i in 0..2 loop   -- 0: no points, 1: 5 Haste points (cooldown 3 -> 2), 2: 15 Haste points (cooldown 2 -> 1, never 0)
    insert into players (id, username) values ('${P}h' || i, 'f3 haste');
    insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
      select '${P}h' || i, x, 1, 5, case when x in (c3, c2) and i > 0 then jsonb_build_object('haste', case i when 1 then 5 else 15 end) else '{}'::jsonb end
        from unnest(atk || array[c3, c2]) x;
    ${GATE("tst_f3mh' || i || '")}
    r := lock_hunt_squad('${P}h' || i, h, atk || array[c3, c2]);
    if not coalesce((r->>'ok')::boolean, false) then raise exception 'lock %', r; end if;
    r := hunt_support('${P}h' || i, h, case when i = 2 then c2 else c3 end, null);
    res := res || jsonb_build_object('case', 'Hunt: ' || case i when 0 then 'no Haste: cooldown 3 stays 3' when 1 then '5 Haste points: cooldown 3 -> 2' else '15 Haste points: cooldown 2 -> 1 (never below 1)' end,
      'ok', coalesce((r->>'ok')::boolean, false) and (r->>'ready_round')::int - (r->>'round')::int = case i when 0 then 3 when 1 then 2 else 1 end, 'r', r);
  end loop;
  res := res || jsonb_build_object('case', 'combat_cooldown: (3, 1) = 3, (3, 0.8) = 2, (2, 0.4) = 1, (2, 0.2) = 1, (1, 0.2) = 1, (5, 0.88) = 4, (4, 0.96) = 4',
    'ok', combat_cooldown(3, 1) = 3 and combat_cooldown(3, 0.8) = 2 and combat_cooldown(2, 0.4) = 1 and combat_cooldown(2, 0.2) = 1
      and combat_cooldown(1, 0.2) = 1 and combat_cooldown(5, 0.88) = 4 and combat_cooldown(4, 0.96) = 4);
  -- Haste in the Dungeon (daily run): the same support with 5 Haste points.
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  perform dungeon_generate(dungeon_day());
  update dungeon_days set rule = '{}'::jsonb where day = dungeon_day();
  for i in 0..1 loop
    perform setseed(0.3);
    r := dungeon_start('${P}h' || i, atk || array[c3]);
    if not coalesce((r->>'ok')::boolean, false) then raise exception 'dungeon_start %', r; end if;
    r := dungeon_support('${P}h' || i, c3, null, 0, 'daily');
    res := res || jsonb_build_object('case', 'Dungeon: ' || case i when 0 then 'no Haste: cooldown 3 stays 3' else '5 Haste points: cooldown 3 -> 2' end,
      'ok', coalesce((r->>'ok')::boolean, false) and (r->>'ready_round')::int - (r->'state'->>'round')::int = case i when 0 then 3 else 2 end,
      'r', r - 'state', 'round', r->'state'->'round');
  end loop;

  -- 2. Attack raises only the CP; Vitality only the HP (card_combat), every rarity and star.
  bad := '';
  for e in select jsonb_build_object('r', rr, 'a', a) from unnest(array['normal', 'illustrated_rare', 'full_art', 'gold', 'secret_rare']) rr, generate_series(0, 5) a loop
    cmb0 := card_combat(e->>'r', (e->>'a')::int, 1.0, '{}'); cmb1 := card_combat(e->>'r', (e->>'a')::int, 1.0, '{"attack": 1}');
    cmb2 := card_combat(e->>'r', (e->>'a')::int, 1.0, '{"vitality": 1}');
    if (cmb1->>'hp') <> (cmb0->>'hp') or (cmb1->>'cp')::int <= (cmb0->>'cp')::int or (cmb2->>'cp') <> (cmb0->>'cp') or (cmb2->>'hp')::int <= (cmb0->>'hp')::int
       or (card_combat(e->>'r', (e->>'a')::int, 1.0, '{"attack": 15}')->>'hp') <> (cmb0->>'hp') then
      bad := bad || e::text || ' ' || cmb0::text || ' ' || cmb1::text || ' ' || cmb2::text || '; ';
    end if;
  end loop;
  res := res || jsonb_build_object('case', '1 Attack point: CP up, HP the same (15 points too); 1 Vitality point: HP up, CP the same (5 rarities x 0-5 stars)', 'ok', bad = '', 'bad', left(bad, 600));
  -- In a fight: the card_max_hp of hunt_attack for an Attack card = the same card with no points.
  insert into players (id, username) values ('${P}a0', 'f3 atk'), ('${P}a1', 'f3 atk');
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select p, x, 1, 3, case when p = '${P}a1' and x = atk[1] then '{"attack": 9}'::jsonb else '{}'::jsonb end
      from unnest(atk) x, unnest(array['${P}a0', '${P}a1']) p;
  ${GATE('tst_f3ma0')}
  ${GATE('tst_f3ma1')}
  perform lock_hunt_squad('${P}a0', h, atk); perform lock_hunt_squad('${P}a1', h, atk);
  r := hunt_attack('${P}a0', h, atk[1]); r2 := hunt_attack('${P}a1', h, atk[1]);
  res := res || jsonb_build_object('case', 'a fight: 9 Attack points raise the CP, not the card''s max HP', 'ok',
    (r->>'card_max_hp') = (r2->>'card_max_hp') and (r2->>'cp')::int > (r->>'cp')::int, 'no_pts', jsonb_build_array(r->'cp', r->'card_max_hp'), 'attack9', jsonb_build_array(r2->'cp', r2->'card_max_hp'));
  update balance set value = value || '{"enabled": false}' where key = 'stat_points';
  res := res || jsonb_build_object('case', 'flag OFF: card_combat = card_power + card_max_hp, haste 1 (any points)', 'ok', not exists (
    select 1 from unnest(array['normal', 'gold']) rr, generate_series(0, 5) a, unnest(array['{}', '{"attack": 5, "haste": 9}']::jsonb[]) pt
     where card_combat(rr, a, 1.0, pt) <> jsonb_build_object('on', false, 'cp', card_power(rr, a, 1.0), 'hp', card_max_hp(card_power(rr, a, 1.0)), 'crit', 0, 'potency', 1, 'haste', 1, 'free', 0)));
  update balance set value = value || '{"enabled": true}' where key = 'stat_points';

  -- 3. The auto-pick value = the fight value. 7 attackers (one melee) + 1 support, an armored boss weak to the first card's
  --    element tag and to Creatures. The random parts fixed: roll 1, no miss, no crit, no block; no focus / rampage cards.
  select array_agg(id order by id) into pool from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character', 'Creature') and coalesce(s.ability->>'effect', '') not in ('focus', 'rampage')
      and not ('trait:melee' = any(s.tag_slugs)) order by c.rarity = 'normal' desc, c.id limit 6) x;
  select min(c.id) into melee from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character', 'Creature') and coalesce(s.ability->>'effect', '') not in ('focus', 'rampage') and 'trait:melee' = any(s.tag_slugs);
  pool := pool || melee || c3;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, hp_share, opens_at, closes_at, status, passive)
    values ('F3 Value', 'Normal',
      jsonb_build_array(jsonb_build_object('kind', 'type', 'value', 'Creature'),
        jsonb_build_object('kind', 'tag', 'value', (select t from cards c join subjects s on s.id = c.subject_id, unnest(s.tag_slugs) t where c.id = pool[1] and t like 'trait:%' limit 1))),
      '[{"kind": "rarity", "value": "secret_rare"}]', 900000, 900000, 900000, now() - interval '1 hour', now() + interval '1 day', 'active',
      '{"kind": "armored", "list": [{"kind": "armored"}]}') returning id into h2;
  insert into players (id, username) values ('${P}v', 'f3 value');
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select '${P}v', x, 1, 2, case when x = pool[2] then '{"attack": 4, "precision": 2}'::jsonb else '{}'::jsonb end from unnest(pool) x;
  ${GATE('tst_f3mv')}
  r := lock_hunt_squad('${P}v', h2, pool);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'lock value %', r; end if;
  sv := hunt_squad_value('${P}v', h2, pool);
  -- the crit chance of the card viewer (hunt_view crit = hunt_card_crits) = combat_crit_chance with each card's own card_combat
  update player_cards set stat_points = '{"precision": 4}' where player_id = '${P}v' and card_id = pool[3];
  res := res || jsonb_build_object('case', 'hunt_view crit = combat_crit_chance(weak bonus, ability, card_combat) of each attacker (Precision points, a weakness)', 'ok',
    (hunt_view('${P}v', h2, v_day)->'crit') = hunt_card_crits('${P}v', h2)
    and (select count(*) from jsonb_object_keys(hunt_card_crits('${P}v', h2))) = (select count(*) from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
          where pc.player_id = '${P}v' and s.type in ('Character', 'Creature'))
    and (select count(distinct x.value) from jsonb_each(hunt_card_crits('${P}v', h2)) x) >= 3
    and not exists (select 1 from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id, hunts hh
      where pc.player_id = '${P}v' and hh.id = h2 and s.type in ('Character', 'Creature')
        and (hunt_card_crits('${P}v', h2)->>c.id::text)::numeric is distinct from combat_crit_chance(
          (combat_weak(hh.weak_points, hh.resist_points, s.type, c.rarity::text, c.season, s.tag_slugs, 0)->>'wm')::int > 0,
          case when s.ability->>'kind' = 'attack' then s.ability->>'effect' end, coalesce((s.ability->>'amount')::numeric, 0),
          card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points))),
    'crits', hunt_card_crits('${P}v', h2));
  update player_cards set stat_points = '{}' where player_id = '${P}v' and card_id = pool[3];
  update balance set value = value || '{"roll_min": 1, "roll_span": 0, "miss": 0, "crit": 0, "crit_weak": 0, "block": 0}' where key = 'combat';
  update balance set value = value || '{"crit_cap": 0}' where key = 'stat_points';
  -- every squad card enters the fight first (the synergy counts the cards in the fight)
  perform hunt_commit_card(h2, '${P}v', x, v_day, 100000) from unnest(pool) x;
  bad := ''; n := 0;
  for e in select x from jsonb_array_elements(sv->'cards') x loop
    begin
      r := hunt_attack('${P}v', h2, (e->>'id')::bigint);
      n := n + 1;
      if not coalesce((r->>'ok')::boolean, false) or (r->>'damage')::int <> greatest(1, round((e->>'value')::numeric)) then
        bad := bad || (e->>'id') || ': fight ' || coalesce(r->>'damage', r::text) || ' vs value ' || round((e->>'value')::numeric, 2) || '; ';
      end if;
      raise exception using errcode = 'U0001', message = 'undo';
    exception when sqlstate 'U0001' then null;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the auto-pick value (hunt_squad_value) of each of 7 attackers = its fight damage (armored boss, weakness, synergy, stat points)',
    'ok', bad = '' and n = 7 and (sv->>'value')::numeric > 0 and exists (select 1 from jsonb_array_elements(sv->'cards') x where (x->>'wmult')::numeric > 1)
      and exists (select 1 from jsonb_array_elements(sv->'cards') x where (x->>'synmult')::numeric > 1),
    'bad', left(bad, 800), 'n', n, 'sv', sv - 'groups');
  update balance set value = value || '{"roll_min": 0.85, "roll_span": 0.3}' where key = 'combat';   -- not needed below; keeps the block honest

  -- 4. hunt_autopick. A member with 10 attackers and 3 supports, one attacker down today.
  insert into players (id, username) values ('${P}p', 'f3 pick');
  insert into player_cards (player_id, card_id, quantity)
    select '${P}p', id, 1 from (select c.id from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') order by c.id limit 10) x
    union all select '${P}p', id, 1 from (select c.id from cards c join subjects s on s.id = c.subject_id
      where s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') order by c.id limit 3) y;
  ids := hunt_autopick('${P}p', h, 8);
  res := res || jsonb_build_object('case', 'auto-pick: 8 cards = 6 attackers (first) + 2 supports', 'ok', cardinality(ids) = 8
      and (select bool_and(s.type in ('Character', 'Creature')) from unnest(ids[1:6]) x join cards c on c.id = x join subjects s on s.id = c.subject_id)
      and (select bool_and(s.type not in ('Character', 'Creature')) from unnest(ids[7:8]) x join cards c on c.id = x join subjects s on s.id = c.subject_id),
    'ids', to_jsonb(ids));
  -- the strongest attacker is knocked out today: never picked, and it used 1 of the 8 daily slots (7 cards: 5 attackers + 2 supports)
  select x into d from unnest(ids[1:1]) x;
  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed) values (h, '${P}p', d, v_day, 0, 100, true);
  ids := hunt_autopick('${P}p', h, 8);
  res := res || jsonb_build_object('case', 'auto-pick: a card knocked out today is not in, and it used 1 of the 8 slots: 5 attackers + 2 supports', 'ok',
    cardinality(ids) = 7 and not (d = any(ids))
      and (select count(*) from unnest(ids) x join cards c on c.id = x join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature')) = 5,
    'ids', to_jsonb(ids), 'downed', d);
  -- the daily limit (cap 4): the downed card used 1 slot, so 3 new cards
  ids := hunt_autopick('${P}p', h, 4);
  res := res || jsonb_build_object('case', 'auto-pick: the daily limit 4 with 1 card used (down): 3 new cards', 'ok', cardinality(ids) = 3 and not (d = any(ids)), 'ids', to_jsonb(ids));
  -- full search: a pool of 7 attackers, a squad of 4, no support; the pick has the highest value of the 35 squads
  insert into players (id, username) values ('${P}f', 'f3 full');
  insert into player_cards (player_id, card_id, quantity, ascension) select '${P}f', x, 1, 0 from unnest(pool[1:7]) x;
  ids := hunt_autopick('${P}f', h2, 4);
  best := -1;
  for s in select array[a, b, c, dd] from unnest(pool[1:7]) a, unnest(pool[1:7]) b, unnest(pool[1:7]) c, unnest(pool[1:7]) dd where a < b and b < c and c < dd loop
    v := (hunt_squad_value('${P}f', h2, s)->>'value')::numeric;
    if v > best then best := v; end if;
  end loop;
  v := (hunt_squad_value('${P}f', h2, ids)->>'value')::numeric;
  res := res || jsonb_build_object('case', 'auto-pick: its squad of 4 has the highest value of all 35 squads of 7 attackers (full search)', 'ok', cardinality(ids) = 4 and v >= best - 1e-9,
    'pick', v, 'best', best, 'ids', to_jsonb(ids));

  -- 4b. The search on made-up pools: the cases of squad-pick.test.js (the JS search before F-3), ported. The boss is weak to
  --     trait:strong and resists trait:ice (wm, rm); a support is a non-attacker with an effect.
  create function pg_temp.pc(p_id int, p_cp numeric, p_tags text[], p_more jsonb default '{}') returns jsonb language sql as $f$
    select jsonb_build_object('id', p_id, 'atk', true, 'used', false, 'downed', false, 'cp', p_cp, 'potency', 1,
      'wm', case when p_tags && array['trait:strong'] then 1 else 0 end, 'rm', case when p_tags && array['trait:ice'] then 1 else 0 end,
      'arm', 1, 'eff', null, 'aff', null, 'fx', combat_card_facts(p_tags, array['trait:strong'])) || p_more $f$;
  create function pg_temp.sp(p_id int, p_eff text, p_more jsonb default '{}') returns jsonb language sql as $f$
    select pg_temp.pc(p_id, 10, '{}', jsonb_build_object('atk', false, 'eff', p_eff) || p_more) $f$;
  create function pg_temp.pick(p_pool jsonb[], p_cap int default 8) returns bigint[] language sql as $f$ select hunt_autopick_pool(to_jsonb(p_pool), p_cap) $f$;
  create function pg_temp.nsup(p_pool jsonb[], p_ids bigint[]) returns int language sql as $f$
    select count(*)::int from unnest(p_pool) e where (e->>'id')::bigint = any(p_ids) and not (e->>'atk')::boolean $f$;
  declare pl jsonb[]; ids2 bigint[]; k int; a int; b int; cc int; seed int; best2 numeric; got numeric; tg text[] := array['trait:fire', 'trait:water', 'trait:strong', 'trait:ice', 'origin:a', 'origin:b', 'trait:beast', 'trait:melee']; cmb jsonb := balance_get('combat');
  begin
    pl := array[pg_temp.pc(1, 40, '{trait:strong}'), pg_temp.pc(2, 45, '{trait:strong}')] || array(select pg_temp.pc(2 + g, 29 + g, '{}') from generate_series(1, 10) g);
    res := res || jsonb_build_object('case', 'search: a member with only 2 weak-matching cards still gets a full squad of 8', 'ok', cardinality(pg_temp.pick(pl)) = 8);
    pl := array(select pg_temp.pc(g, 49 + g, '{}', case when g = 12 then '{"used": true, "downed": true}' else '{}' end::jsonb) from generate_series(1, 12) g);
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: a card knocked out today is never picked (and it used 1 of the 8 daily slots)', 'ok', cardinality(ids2) = 7 and not (12 = any(ids2)), 'ids', to_jsonb(ids2));
    pl := array(select pg_temp.pc(g, 49 + g, '{}', jsonb_build_object('used', g <= 4, 'downed', g <= 2)) from generate_series(1, 14) g);
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: the daily limit: 4 cards used today (2 down) leaves 4 new + the 2 standing = 6', 'ok',
      cardinality(ids2) = 6 and (select count(*) from unnest(ids2) x where x > 4) = 4 and 3 = any(ids2) and 4 = any(ids2), 'ids', to_jsonb(ids2));
    perform setseed(0.25);
    bad := '';
    for seed in 1 .. 25 loop
      pl := array(select pg_temp.pc(g, round(20 + random() * 120)::numeric, array(select t from unnest(tg) t where random() < 0.3)) from generate_series(1, 11) g);
      best2 := -1;
      for a in 0 .. 8 loop for b in a + 1 .. 9 loop for cc in b + 1 .. 10 loop   -- the 3 cards left out: every squad of 8
        v := hunt_autopick_val(pl, array(select z from generate_series(0, 10) z where z not in (a, b, cc)), '{}', cmb);
        if v > best2 then best2 := v; end if;
      end loop; end loop; end loop;
      ids2 := pg_temp.pick(pl);
      got := hunt_autopick_val(pl, array(select (z - 1)::int from unnest(ids2) z), '{}', cmb);
      if got < best2 - 1e-6 * best2 then bad := bad || 'seed ' || seed || ': ' || round(got, 1) || ' < ' || round(best2, 1) || '; '; end if;
    end loop;
    res := res || jsonb_build_object('case', 'search: the pick has the highest team value of every squad of 8 of 11 cards (full search, 25 random pools)', 'ok', bad = '', 'bad', bad);
    pl := array[pg_temp.pc(1, 20, '{trait:strong}')] || array(select pg_temp.pc(1 + g, 99 + g, '{}') from generate_series(1, 8) g);
    res := res || jsonb_build_object('case', 'search: the strongest cards win over a weak card that only matches the boss', 'ok', not (1 = any(pg_temp.pick(pl))));
    pl := array(select pg_temp.pc(g, 59 + g, '{}') from generate_series(1, 10) g) || array[pg_temp.sp(11, 'heal'), pg_temp.sp(12, 'empower'), pg_temp.sp(13, 'expose')];
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: a squad keeps 2 support slots: the 6 strongest attackers (strongest first) + 2 supports', 'ok',
      cardinality(ids2) = 8 and ids2[1:6] = array[10, 9, 8, 7, 6, 5]::bigint[] and pg_temp.nsup(pl, ids2) = 2, 'ids', to_jsonb(ids2));
    pl := array(select pg_temp.pc(g, 59 + g, '{}') from generate_series(1, 8) g) || array[pg_temp.sp(9, 'empower'), pg_temp.sp(10, 'empower'), pg_temp.sp(11, 'expose'), pg_temp.sp(12, 'heal')];
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: the 2 supports mix a heal/shield/weaken with a damage effect (not two of one kind)', 'ok',
      12 = any(ids2) and (9 = any(ids2) or 10 = any(ids2) or 11 = any(ids2)) and pg_temp.nsup(pl, ids2) = 2, 'ids', to_jsonb(ids2));
    pl := array(select pg_temp.pc(g, 59 + g, '{trait:beast}') from generate_series(1, 8) g)
      || array[pg_temp.sp(9, 'empower', '{"aff": "trait:beast"}'), pg_temp.sp(10, 'empower'), pg_temp.sp(11, 'shield')];
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: a support whose affinity matches the squad wins over the same effect without it', 'ok', 9 = any(ids2) and not (10 = any(ids2)), 'ids', to_jsonb(ids2));
    pl := array(select pg_temp.pc(g, 59 + g, '{}') from generate_series(1, 8) g) || array[pg_temp.sp(9, 'shield'), pg_temp.sp(10, 'shield', '{"potency": 1.1}'), pg_temp.sp(11, 'expose')];
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: Potency points make a support stronger', 'ok', 10 = any(ids2) and not (9 = any(ids2)), 'ids', to_jsonb(ids2));
    pl := array(select pg_temp.pc(g, 59 + g, '{}') from generate_series(1, 5) g) || array(select pg_temp.sp(5 + u.o::int, u.ef) from unnest(array['heal', 'shield', 'empower', 'expose', 'stun']) with ordinality u(ef, o));
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: support cards fill the squad when there are too few attackers', 'ok', cardinality(ids2) = 8 and pg_temp.nsup(pl, ids2) = 3, 'ids', to_jsonb(ids2));
    pl := array(select pg_temp.pc(g, 59 + g, '{}', jsonb_build_object('used', g <= 6)) from generate_series(1, 10) g) || array[pg_temp.sp(11, 'heal'), pg_temp.sp(12, 'empower')];
    ids2 := pg_temp.pick(pl);
    res := res || jsonb_build_object('case', 'search: the daily limit keeps room for the supports: 6 attackers used today + 2 new supports', 'ok', cardinality(ids2) = 8 and pg_temp.nsup(pl, ids2) = 2, 'ids', to_jsonb(ids2));
  end;

  -- 5. combat_squad and combat_weak = the texts before this file (db/schema 2026-10-11), 400 random squads of real cards.
  create function pg_temp.old_squad(p_tags text[], p_self_in boolean, p_others jsonb, p_weak jsonb) returns jsonb language plpgsql stable as $f$
  declare v_wtags text[]; v_stack int := 0; v_elem text; v_syn int; v_synmult numeric := 1;
    v_origin text; v_osyn int; v_omult numeric := 1; v_ksyn int; v_kmult numeric := 1;
    v_o jsonb := coalesce(p_others, '[]'::jsonb);
  begin
    select array_agg(w->>'value') into v_wtags from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w where w->>'kind' = 'tag';
    if v_wtags is not null and array_length(v_wtags, 1) > 0 then
      select count(*) into v_stack from jsonb_array_elements(v_o) o where array(select jsonb_array_elements_text(o)) && v_wtags;
      if p_self_in and p_tags && v_wtags then v_stack := v_stack + 1; end if;
    end if;
    v_elem := public.card_element(p_tags);
    if v_elem is not null then
      select count(*) into v_syn from jsonb_array_elements(v_o) o where exists (select 1 from jsonb_array_elements_text(o) t where public.element_of(t) = v_elem);
      v_syn := coalesce(v_syn, 0) + 1;
      if v_syn >= public.balance_num('combat', 'syn_big_at') then v_synmult := public.balance_num('combat', 'element_big'); elsif v_syn >= public.balance_num('combat', 'syn_small_at') then v_synmult := public.balance_num('combat', 'element_small'); end if;
    else v_syn := 0; end if;
    v_origin := (select t from unnest(p_tags) t where t like 'origin:%' limit 1);
    if v_origin is not null then
      select count(*) into v_osyn from jsonb_array_elements(v_o) o where o ? v_origin;
      v_osyn := coalesce(v_osyn, 0) + 1;
      if v_osyn >= public.balance_num('combat', 'syn_big_at') then v_omult := public.balance_num('combat', 'origin_big'); elsif v_osyn >= public.balance_num('combat', 'syn_small_at') then v_omult := public.balance_num('combat', 'origin_small'); end if;
    end if;
    select coalesce(max(cnt), 0) into v_ksyn from (select count(*) as cnt from unnest(p_tags) tg cross join jsonb_array_elements(v_o) o
        where tg like 'trait:%' and tg not in (select 'trait:' || a.element from public.element_aliases() a) and o ? tg group by tg) k;
    if v_ksyn > 0 then v_ksyn := v_ksyn + 1; if v_ksyn >= public.balance_num('combat', 'syn_big_at') then v_kmult := public.balance_num('combat', 'trait_big'); elsif v_ksyn >= public.balance_num('combat', 'syn_small_at') then v_kmult := public.balance_num('combat', 'trait_small'); end if; end if;
    v_synmult := least(public.balance_num('combat', 'syn_cap'), v_synmult * v_omult * v_kmult);
    return jsonb_build_object('stack', v_stack, 'elem', v_elem, 'syn', v_syn, 'synmult', v_synmult);
  end $f$;
  create function pg_temp.old_weak(p_weak jsonb, p_resist jsonb, p_type text, p_rarity text, p_season text, p_tags text[], p_stack integer) returns jsonb language plpgsql stable as $f$
  declare v_wm int; v_rm int; v_wmult numeric;
  begin
    select count(*) into v_wm from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w
      where (w->>'kind' = 'type' and w->>'value' = p_type) or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
         or (w->>'kind' = 'season' and w->>'value' = p_season) or (w->>'kind' = 'tag' and w->>'value' = any(p_tags));
    select count(*) into v_rm from jsonb_array_elements(coalesce(p_resist, '[]'::jsonb)) w
      where (w->>'kind' = 'type' and w->>'value' = p_type) or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
         or (w->>'kind' = 'season' and w->>'value' = p_season) or (w->>'kind' = 'tag' and w->>'value' = any(p_tags));
    v_wmult := 1
      + (1 - power(public.balance_num('combat', 'weak_step'), v_wm)) * (case when p_stack <= public.balance_num('combat', 'weak_stack_free') then 1 else power(public.balance_num('combat', 'weak_step'), p_stack - public.balance_num('combat', 'weak_stack_free')) end)
      - public.balance_num('combat', 'resist_step') * (1 - power(public.balance_num('combat', 'resist_decay'), v_rm));
    v_wmult := greatest(public.balance_num('combat', 'weak_min'), least(public.balance_num('combat', 'weak_max'), v_wmult));
    return jsonb_build_object('wm', v_wm, 'rm', v_rm, 'mult', v_wmult);
  end $f$;
  perform setseed(0.77);
  bad := ''; n := 0;
  for e in
    with subj as (select s.id, s.tag_slugs, s.type, row_number() over (order by s.id) rn, count(*) over () cnt from subjects s),
    k as (select g, (select array_agg(t) from (select t from subjects s2, unnest(s2.tag_slugs) t order by random() limit 1 + (g % 3)) tt) wt,
                 (1 + floor(random() * (select count(*) from subjects)))::int self, (g % 8) nother, g % 2 = 0 self_in, (g % 9) stack from generate_series(1, 400) g)
    select jsonb_build_object('tags', to_jsonb((select tag_slugs from subj where rn = k.self)), 'type', (select type from subj where rn = k.self),
      'self_in', k.self_in, 'stack', k.stack,
      'others', (select coalesce(jsonb_agg(to_jsonb(tag_slugs)), '[]'::jsonb) from (select tag_slugs from subjects order by random() limit k.nother) o),
      'weak', (select jsonb_agg(jsonb_build_object('kind', 'tag', 'value', w)) from unnest(k.wt) w) || case when k.g % 4 = 0 then '[{"kind": "type", "value": "Creature"}]'::jsonb else '[]'::jsonb end,
      'resist', case when k.g % 3 = 0 then jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', k.wt[1])) else '[]'::jsonb end) from k
  loop
    n := n + 1;
    r := combat_squad(array(select jsonb_array_elements_text(e->'tags')), (e->>'self_in')::boolean, e->'others', e->'weak');
    r2 := pg_temp.old_squad(array(select jsonb_array_elements_text(e->'tags')), (e->>'self_in')::boolean, e->'others', e->'weak');
    if r - array['origin', 'osyn', 'kind', 'ksyn'] <> r2 then bad := bad || 'squad ' || e::text || ' new ' || r::text || ' old ' || r2::text || '; '; end if;
    r := combat_weak(e->'weak', e->'resist', e->>'type', 'normal', null, array(select jsonb_array_elements_text(e->'tags')), (e->>'stack')::int);
    r2 := pg_temp.old_weak(e->'weak', e->'resist', e->>'type', 'normal', null, array(select jsonb_array_elements_text(e->'tags')), (e->>'stack')::int);
    if r <> r2 then bad := bad || 'weak ' || e::text || ' new ' || r::text || ' old ' || r2::text || '; '; end if;
  end loop;
  res := res || jsonb_build_object('case', 'combat_squad and combat_weak = the texts before the file (400 random squads and weaknesses)', 'ok', bad = '' and n = 400,
    'n', n, 'bad', left(bad, 900),
    'hits', (select count(*) from jsonb_array_elements('[]'::jsonb)));
  res := res || jsonb_build_object('case', 'combat_card_facts: elem = card_element, els = element_of of each tag (every subject)', 'ok', not exists (
    select 1 from subjects s where (combat_card_facts(s.tag_slugs, null)->>'elem') is distinct from card_element(s.tag_slugs)
       or (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(combat_card_facts(s.tag_slugs, null)->'els') x)
          <> (select coalesce(array_agg(distinct element_of(t) order by element_of(t)) filter (where element_of(t) is not null), '{}') from unnest(s.tag_slugs) t)));

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS %' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'error', 'ok', false, 'err', sqlerrm);
end $t$;`;
const out = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: body }) })).json();
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS', JSON.stringify(out).slice(0, 1500)); process.exit(1); }
const rows = JSON.parse(JSON.parse(`"${m[1]}"`));
let fails = 0;
for (const r of rows) {
  if (!r.ok) fails++;
  const { case: c, ok, ...rest } = r;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 1200)}`);
}
console.log(`FAILS ${fails}`);
if (fails) process.exitCode = 1;
