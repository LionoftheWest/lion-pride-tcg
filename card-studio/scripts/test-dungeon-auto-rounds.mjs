/**
 * Acceptance test for tcg-bot/supabase/dungeon_auto_rounds.sql (Auto mode on the server).
 * Invariants:
 *   P  the choice (dungeon_auto_action): target = the monster closest to falling; attack = a ready attacker, a weakness hit first, then CP,
 *      then the squad order; support = the first useful support in squad order (heal / shield below their limits, empower the attacker,
 *      cleanse only with a curse or poison, stun only when not stunned, any other effect the target); never a card that is down, on
 *      cooldown, in the tried list, or that is not a support.
 *   B  N rounds in ONE call end in EXACTLY the state of the same actions as single dungeon_support / dungeon_attack calls with the same
 *      random seed (setseed): the same final state, the same damage, the same rows in dungeon_log and combat_actions.
 *   C  the stops: a kill, the maximum (1 to 10), a squad that falls, a refused attack (the refusal itself when nothing was played),
 *      a step that is not a fight, no run; a support that the rules refuse is skipped; the Gauntlet goes through p_mode.
 * One DO block with fake members; the last RAISE rolls everything back:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-dungeon-auto-rounds.mjs              the migration file (must PASS)
 *   ... --mutations                                                           each mutation of the file must make a case FAIL
 * (rehearse-sql.mjs runs it with the other SQL tests; the file must be applied locally first for the other tests, this one applies it itself.)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const src = strip(readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/dungeon_auto_rounds.sql', import.meta.url)), 'utf8'));
if (src.includes('$m$') || src.includes('$t$') || src.includes('$f$')) throw new Error('the file contains $m$, $t$ or $f$');

// One mutation per mechanism: [text, replacement]. Each text is in the file exactly once.
const MUTATIONS = {
  'the target is the monster with the MOST HP': ["order by (e.f->>'hp')::int, e.ord limit 1;", "order by (e.f->>'hp')::int desc, e.ord limit 1;"],
  'a stunned attacker can attack (the ready filter is gone)': ['where a.ready order by a.weak desc, a.cp desc, a.ord limit 1', 'order by a.weak desc, a.cp desc, a.ord limit 1'],
  'a weakness is ignored': ['where a.ready order by a.weak desc, a.cp desc, a.ord limit 1', 'where a.ready order by a.cp desc, a.ord limit 1'],
  'the LOWEST CP attacks': ['where a.ready order by a.weak desc, a.cp desc, a.ord limit 1', 'where a.ready order by a.weak desc, a.cp, a.ord limit 1'],
  'Auto does not pass the turn when every attacker is stunned': ["v_res := dungeon_pass_turn(p_player, v_mode, true);", "v_res := jsonb_build_object('ok', false, 'error', 'x');"],
  'a card that is down can attack': ["and not coalesce((p_run.state->'cards'->(x.id::text)->>'down')::boolean, false);", ';'],
  'a heal goes to a card under 100% (not 50%)': ["when 'heal' then (select a.id from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.hp < 0.5", "when 'heal' then (select a.id from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.hp < 1.01"],
  'a cleanse plays with nothing to cleanse': ["if exists (select 1 from jsonb_each(st->'cards') c", 'if true or exists (select 1 from jsonb_each(st->\'cards\') c'],
  'a stun plays on a stunned monster': ["if coalesce((v_foe->>'st')::int, 0) < v_round then return", 'if true then return'],
  'a support on cooldown is chosen': ["and v_round >= coalesce((st->'cards'->(x.id::text)->>'cd')::int, 0)\n", '\n'],
  'a support in the tried list is chosen again (the choice, P9)': ["and not (x.id = any(coalesce(p_tried, '{}'::bigint[])))", 'and true'],
  'a kill does not stop the call': ["if coalesce((v_res->>'kill')::boolean, false) then v_stop := 'kill'; exit; end if;", ''],
  'the maximum is ignored (always 10)': ['while v_n < v_max loop', 'while v_n < 10 loop'],
  'the attacks ignore p_mode (always daily)': ["v_res := dungeon_attack(p_player, (v_act->>'card')::bigint, (v_act->>'target')::int, v_mode);", "v_res := dungeon_attack(p_player, (v_act->>'card')::bigint, (v_act->>'target')::int, 'daily');"],
  'a refused attack is swallowed (the answer says ok with no rounds)': ['if v_err is not null then return v_err; end if;', ''],
};

const P = 'tst_dar_';
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; r dungeon_runs; sq jsonb; act jsonb; x jsonb; y jsonb; i int; j int; v_day date; ls bigint; atk bigint[]; sups jsonb; ids bigint[];
  run1 bigint; run2 bigint; sq1 jsonb; foe jsonb; ra jsonb; rb jsonb; ref_dmg jsonb := '[]'; got_dmg jsonb := '[]'; s0a jsonb; s0b jsonb; f1 jsonb; f2 jsonb;
  n_log1 int; n_log2 int; n_act1 int; n_act2 int; v_cap int; v_hp int;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  -- 0. the file under test (all its statements), inside this block.
  execute $m$${mig}$m$;
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  v_day := dungeon_day();
  perform dungeon_generate(v_day);
  update dungeon_days set rule = '{}'::jsonb where day = v_day;

  -- ===== P: the choice, on a fabricated run (the function reads only the run's squad and state, and the squad info) =====
  create function pg_temp.cs(p_hp int, p_down boolean default false, p_cd int default 0) returns jsonb language sql as $f$
    select jsonb_build_object('hp', p_hp, 'max', 100, 'down', p_down, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', p_cd, 'psn', 0, 'psnu', -1) $f$;
  create function pg_temp.ci(p_type text, p_cp int, p_tags jsonb default '[]', p_ab jsonb default null) returns jsonb language sql as $f$
    select jsonb_build_object('type', p_type, 'cmb', jsonb_build_object('cp', p_cp), 'tags', p_tags, 'ability', p_ab) $f$;
  create function pg_temp.fo(p_hp int, p_st int default 0, p_weak jsonb default '[]') returns jsonb language sql as $f$
    select jsonb_build_object('hp', p_hp, 'max', 1000, 'st', p_st, 'weak', p_weak) $f$;
  -- the members: the cards of a member who passes the Adventure gate (10 attackers, a lifesteal card and one support of each effect)
  select min(c.id) into ls from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal';
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id <> ls order by c.id limit 9) z;
  select jsonb_object_agg(e2, id) into sups from (select s.ability->>'effect' e2, min(c.id) id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by 1) z;
  create function pg_temp.dar_member(p text) returns void language plpgsql as $f$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity)
      select p, z, 1 from unnest(array[(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal')]
        || (select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 10) w)
        || array(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by s.ability->>'effect')) z
      on conflict do nothing;
  end $f$;
  perform pg_temp.dar_member('${P}0');
  ra := dungeon_start('${P}0', array[atk[1], atk[2], atk[3], (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  select * into r from dungeon_runs where player_id = '${P}0' and day = v_day and mode = 'daily';
  if r.id is null then raise exception 'no run for the fabricated cases: %', ra; end if;
  r.squad := array[1, 2, 3, 4, 5]::bigint[];

  -- P1 the target: the lowest HP, the first of equals; the attack is on that monster
  r.state := jsonb_build_object('round', 0, 'foes', jsonb_build_array(pg_temp.fo(500), pg_temp.fo(100), pg_temp.fo(300), pg_temp.fo(100)),
    'cards', jsonb_build_object('1', pg_temp.cs(100), '2', pg_temp.cs(100), '3', pg_temp.cs(100), '4', pg_temp.cs(100), '5', pg_temp.cs(100)));
  sq := jsonb_build_object('1', pg_temp.ci('Character', 100), '2', pg_temp.ci('Character', 90));
  act := dungeon_auto_action(r, sq, null, 'attack');
  res := res || jsonb_build_object('case', 'P1 the target is the monster with the lowest HP (the first of two equals)', 'ok', (act->>'target')::int = 1 and act->>'kind' = 'attack', 'act', act);

  -- P2 a ready attacker beats a stronger one on cooldown
  r.state := jsonb_build_object('round', 0, 'foes', jsonb_build_array(pg_temp.fo(100)),
    'cards', jsonb_build_object('1', pg_temp.cs(100, false, 5), '2', pg_temp.cs(100)));
  sq := jsonb_build_object('1', pg_temp.ci('Character', 300), '2', pg_temp.ci('Character', 100));
  act := dungeon_auto_action(r, sq, null, 'attack');
  res := res || jsonb_build_object('case', 'P2 a ready attacker (CP 100) is chosen, not the stronger one on cooldown (CP 300)', 'ok', (act->>'card')::bigint = 2, 'act', act);

  -- P3 a weakness hit beats the CP
  r.state := jsonb_build_object('round', 0, 'foes', jsonb_build_array(pg_temp.fo(100, 0, '[{"kind": "tag", "value": "trait:fire"}]')),
    'cards', jsonb_build_object('1', pg_temp.cs(100), '2', pg_temp.cs(100)));
  sq := jsonb_build_object('1', pg_temp.ci('Character', 100, '["trait:fire"]'), '2', pg_temp.ci('Character', 300, '["trait:water"]'));
  act := dungeon_auto_action(r, sq, null, 'attack');
  res := res || jsonb_build_object('case', 'P3 the attacker that hits a weakness (CP 100) is chosen before the stronger one (CP 300)', 'ok', (act->>'card')::bigint = 1, 'act', act);

  -- P4 the CP, then the squad order (equal CP: the first in the squad)
  r.state := jsonb_build_object('round', 0, 'foes', jsonb_build_array(pg_temp.fo(100)),
    'cards', jsonb_build_object('1', pg_temp.cs(100), '2', pg_temp.cs(100), '3', pg_temp.cs(100)));
  sq := jsonb_build_object('1', pg_temp.ci('Creature', 100), '2', pg_temp.ci('Character', 200), '3', pg_temp.ci('Character', 200));
  act := dungeon_auto_action(r, sq, null, 'attack');
  res := res || jsonb_build_object('case', 'P4 the highest CP attacks; equal CP: the first card of the squad', 'ok', (act->>'card')::bigint = 2, 'act', act);

  -- P5 every attacker stunned (D-182): no attack at all; a card that is down never attacks, and with none standing there is no action
  r.state := jsonb_build_object('round', 0, 'foes', jsonb_build_array(pg_temp.fo(100)),
    'cards', jsonb_build_object('1', pg_temp.cs(100, false, 4), '2', pg_temp.cs(100, false, 4), '3', pg_temp.cs(100, true)));
  sq := jsonb_build_object('1', pg_temp.ci('Character', 100), '2', pg_temp.ci('Character', 200), '3', pg_temp.ci('Character', 900));
  act := dungeon_auto_action(r, sq, null, 'attack');
  x := dungeon_auto_action(jsonb_populate_record(r, jsonb_build_object('state', jsonb_set(r.state, '{cards}', jsonb_build_object('1', pg_temp.cs(0, true), '2', pg_temp.cs(0, true), '3', pg_temp.cs(0, true))))), sq, null, 'attack');
  res := res || jsonb_build_object('case', 'P5 every attacker stunned: no attack (D-182); nobody standing: no action', 'ok',
    act is null and x is null, 'act', act, 'none', x);

  -- P6 the heal: the lowest attacker under 50%; nobody under 50% = this support does nothing; the next useful support is chosen
  r.state := jsonb_build_object('round', 0, 'foes', jsonb_build_array(pg_temp.fo(100)),
    'cards', jsonb_build_object('1', pg_temp.cs(40), '2', pg_temp.cs(20), '3', pg_temp.cs(90), '4', pg_temp.cs(100), '5', pg_temp.cs(100)));
  sq := jsonb_build_object('1', pg_temp.ci('Character', 100), '2', pg_temp.ci('Character', 90), '3', pg_temp.ci('Character', 80),
    '4', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "heal", "target": "ally"}'),
    '5', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "smite", "target": "boss"}'));
  act := dungeon_auto_action(r, sq, null, 'support');
  r.state := jsonb_set(r.state, '{cards}', jsonb_build_object('1', pg_temp.cs(60), '2', pg_temp.cs(70), '3', pg_temp.cs(90), '4', pg_temp.cs(100), '5', pg_temp.cs(100)));
  x := dungeon_auto_action(r, sq, null, 'support');
  res := res || jsonb_build_object('case', 'P6 heal: the lowest attacker under 50% (card 2); nobody under 50%: the next useful support (the smite, card 5) is chosen', 'ok',
    (act->>'card')::bigint = 4 and (act->>'target_card')::bigint = 2 and (x->>'card')::bigint = 5 and (x->>'target_foe')::int = 0, 'heal', act, 'then', x);

  -- P7 the shield limit is 60%
  r.state := jsonb_build_object('round', 0, 'foes', jsonb_build_array(pg_temp.fo(100)),
    'cards', jsonb_build_object('1', pg_temp.cs(65), '2', pg_temp.cs(55), '3', pg_temp.cs(100), '4', pg_temp.cs(100)));
  sq := jsonb_build_object('1', pg_temp.ci('Character', 100), '2', pg_temp.ci('Character', 90), '3', pg_temp.ci('Character', 80),
    '4', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "shield", "target": "ally"}'));
  r.squad := array[1, 2, 3, 4]::bigint[];
  act := dungeon_auto_action(r, sq, null, 'support');
  r.state := jsonb_set(r.state, '{cards}', jsonb_build_object('1', pg_temp.cs(65), '2', pg_temp.cs(61), '3', pg_temp.cs(100), '4', pg_temp.cs(100)));
  x := dungeon_auto_action(r, sq, null, 'support');
  res := res || jsonb_build_object('case', 'P7 shield: the lowest attacker under 60% (card 2 at 55%); nobody under 60% = no support', 'ok',
    (act->>'target_card')::bigint = 2 and x is null, 'shield', act, 'none', x);

  -- P8 empower goes to the attacker that attacks; cleanse only with a curse or poison; stun only when the monster is not stunned
  r.state := jsonb_build_object('round', 3, 'foes', jsonb_build_array(pg_temp.fo(100, 5)),
    'cards', jsonb_build_object('1', pg_temp.cs(100), '2', pg_temp.cs(100), '3', pg_temp.cs(100), '4', pg_temp.cs(100)));
  sq := jsonb_build_object('1', pg_temp.ci('Character', 100), '2', pg_temp.ci('Character', 250), '3', pg_temp.ci('Character', 80),
    '4', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "empower", "target": "ally"}'));
  act := dungeon_auto_action(r, sq, null, 'support');
  sq := jsonb_set(sq, '{4}', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "cleanse", "target": "team"}'));
  x := dungeon_auto_action(r, sq, null, 'support');
  y := dungeon_auto_action(jsonb_populate_record(r, jsonb_build_object('state', jsonb_set(r.state, '{cards,2,debuff}', '0.5'))), sq, null, 'support');
  res := res || jsonb_build_object('case', 'P8 empower: the best attacker (card 2); cleanse: nothing when nobody is cursed or poisoned, a play when a card is cursed', 'ok',
    (act->>'target_card')::bigint = 2 and x is null and (y->>'card')::bigint = 4 and y->'target_card' is null, 'empower', act, 'clean', x, 'cursed', y);
  y := dungeon_auto_action(jsonb_populate_record(r, jsonb_build_object('state', jsonb_set(jsonb_set(r.state, '{cards,3,psn}', '10'), '{cards,3,psnu}', '9'))), sq, null, 'support');
  res := res || jsonb_build_object('case', 'P8b cleanse also plays when a card is poisoned (poison until round 9, now round 3)', 'ok', (y->>'card')::bigint = 4, 'act', y);
  sq := jsonb_set(sq, '{4}', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "stun", "target": "boss"}'));
  x := dungeon_auto_action(r, sq, null, 'support');   -- the monster is stunned until round 5, now round 3
  y := dungeon_auto_action(jsonb_populate_record(r, jsonb_build_object('state', jsonb_set(r.state, '{foes,0,st}', '1'))), sq, null, 'support');
  res := res || jsonb_build_object('case', 'P8c stun: nothing while the monster is stunned (until round 5), a stun on the monster when it is not', 'ok',
    x is null and (y->>'card')::bigint = 4 and (y->>'target_foe')::int = 0, 'stunned', x, 'free', y);

  -- P9 a support that is on cooldown, down, in the tried list or not a support is never chosen; the first useful one in squad order wins
  r.state := jsonb_build_object('round', 2, 'foes', jsonb_build_array(pg_temp.fo(100)),
    'cards', jsonb_build_object('1', pg_temp.cs(100), '2', pg_temp.cs(100, false, 5), '3', pg_temp.cs(100, true), '4', pg_temp.cs(100), '5', pg_temp.cs(100), '6', pg_temp.cs(100)));
  r.squad := array[1, 2, 3, 4, 5, 6]::bigint[];
  sq := jsonb_build_object('1', pg_temp.ci('Character', 100),
    '2', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "weaken", "target": "boss"}'),
    '3', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "weaken", "target": "boss"}'),
    '4', pg_temp.ci('Item', 0, '[]', '{"kind": "attack", "effect": "pierce"}'),
    '5', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "expose", "target": "boss"}'),
    '6', pg_temp.ci('Item', 0, '[]', '{"kind": "support", "effect": "smite", "target": "boss"}'));
  act := dungeon_auto_action(r, sq, null, 'support');
  x := dungeon_auto_action(r, sq, array[5]::bigint[], 'support');
  res := res || jsonb_build_object('case', 'P9 cooldown (2), down (3) and not-a-support (4) are skipped: card 5 plays; with card 5 tried: card 6', 'ok',
    (act->>'card')::bigint = 5 and (x->>'card')::bigint = 6, 'first', act, 'second', x);

  -- P10 no monster alive = no action
  r.state := jsonb_set(r.state, '{foes}', jsonb_build_array(pg_temp.fo(0)));
  res := res || jsonb_build_object('case', 'P10 no monster alive: no action', 'ok', dungeon_auto_action(r, sq, null, 'attack') is null);

  -- ===== B: N rounds in one call = the same actions as single calls, same seed =====
  foe := '{"hp": 2000000000, "max": 2000000000, "atk": 50, "enr": 0, "enru": 0, "wk": 0, "wku": 0, "ex": 0, "exu": 0, "st": 0, "sh": 0, "passives": [], "charge": false,
           "moves": [{"w": 1, "kind": "strike", "name": "Hit"}, {"w": 1, "kind": "slam", "name": "Stomp"}]}'::jsonb;
  for j in 1..2 loop
    perform pg_temp.dar_member('${P}b' || j);
    ra := dungeon_start('${P}b' || j, array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
    if not coalesce((ra->>'ok')::boolean, false) then raise exception 'start %: %', j, ra; end if;
    if j = 1 then run1 := (ra->>'run')::bigint; else run2 := (ra->>'run')::bigint; end if;
  end loop;
  for j in 1..2 loop
    update dungeon_runs set state = jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || foe)) where id = case when j = 1 then run1 else run2 end;
    update dungeon_runs set state = jsonb_set(state, '{cards}', (select jsonb_object_agg(key, value || '{"hp": 10000000, "max": 10000000}'::jsonb) from jsonb_each(state->'cards')))
      where id = case when j = 1 then run1 else run2 end;
  end loop;
  select state into s0a from dungeon_runs where id = run1; select state into s0b from dungeon_runs where id = run2;
  res := res || jsonb_build_object('case', 'B0 the two fake members start with the same run state', 'ok', s0a = s0b);

  -- the reference: single calls, the choice from dungeon_auto_action (the cards and the seed are the same)
  select coalesce(jsonb_object_agg(z::text, dungeon_run_card(rr, z)), '{}') into sq1 from dungeon_runs rr, unnest(rr.squad) z where rr.id = run1;
  perform setseed(0.37);
  for i in 1..4 loop
    select * into r from dungeon_runs where id = run1;
    exit when r.state->>'phase' <> 'fight';
    if coalesce((r.state->>'sup_round')::int, -1) <> (r.state->>'round')::int then
      act := dungeon_auto_action(r, sq1, null, 'support');
      if act is not null then
        rb := dungeon_support('${P}b1', (act->>'card')::bigint, (act->>'target_card')::bigint, (act->>'target_foe')::int, 'daily');
        if not (rb->>'ok')::boolean then raise exception 'reference support refused: %', rb; end if;
        select * into r from dungeon_runs where id = run1;
      end if;
    end if;
    act := dungeon_auto_action(r, sq1, null, 'attack');
    rb := dungeon_attack('${P}b1', (act->>'card')::bigint, (act->>'target')::int, 'daily');
    ref_dmg := ref_dmg || jsonb_build_array(jsonb_build_object('d', rb->'damage', 'c', rb->'crit', 't', rb->'target', 'e', rb->'enemy'));
  end loop;
  select state into f1 from dungeon_runs where id = run1;
  -- the call
  perform setseed(0.37);
  ra := dungeon_auto_rounds('${P}b2', 'daily', 4);
  select state into f2 from dungeon_runs where id = run2;
  select coalesce(jsonb_agg(jsonb_build_object('d', e->'atk'->'damage', 'c', e->'atk'->'crit', 't', e->'atk'->'target', 'e', e->'atk'->'enemy') order by o), '[]') into got_dmg
    from jsonb_array_elements(ra->'rounds') with ordinality z(e, o);
  select count(*) into n_log1 from dungeon_log where run_id = run1; select count(*) into n_log2 from dungeon_log where run_id = run2;
  select count(*) into n_act1 from combat_actions where ref_id = run1 and mode = 'dungeon'; select count(*) into n_act2 from combat_actions where ref_id = run2 and mode = 'dungeon';
  res := res || jsonb_build_object('case', 'B1 4 rounds in one call = 4 rounds of single calls with the same seed: the same final state, the same damage and enemy actions, the same log rows',
    'ok', (ra->>'ok')::boolean and (ra->>'played')::int = 4 and ra->>'stopped' = 'max' and jsonb_array_length(ra->'rounds') = 4
          and f1 = f2 and ref_dmg = got_dmg and n_log1 = n_log2 and n_log1 >= 5 and n_act1 = n_act2 and n_act1 >= 5 and (f2->>'round')::int = 4,
    'played', ra->'played', 'stopped', ra->>'stopped', 'state_equal', f1 = f2, 'damage_equal', ref_dmg = got_dmg, 'log', jsonb_build_array(n_log1, n_log2), 'actions', jsonb_build_array(n_act1, n_act2),
    'rounds', f2->'round');
  res := res || jsonb_build_object('case', 'B2 a support played in the call is in its round (sup + atk), once a round', 'ok',
    ra->'rounds'->0->'sup'->>'effect' is not null and ra->'rounds'->0->'atk'->>'card' is not null
      and (select count(*) from jsonb_array_elements(ra->'rounds') e where e->'sup' is not null) <= 4, 'first', ra->'rounds'->0->'sup'->'effect');

  -- ===== C: the stops =====
  -- C1 the maximum: 0 = 1 round, 99 = at most 10
  update dungeon_runs set state = jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || foe)) where id = run2;
  update dungeon_runs set state = jsonb_set(jsonb_set(state, '{round}', '0'), '{sup_round}', '-1') where id = run2;
  ra := dungeon_auto_rounds('${P}b2', 'daily', 0);
  res := res || jsonb_build_object('case', 'C1a max 0 plays exactly 1 round', 'ok', (ra->>'played')::int = 1 and ra->>'stopped' = 'max', 'played', ra->'played', 'stopped', ra->>'stopped');
  ra := dungeon_auto_rounds('${P}b2', 'daily', 99);
  res := res || jsonb_build_object('case', 'C1b max 99 plays at most 10 rounds', 'ok', (ra->>'played')::int = 10 and ra->>'stopped' = 'max', 'played', ra->'played', 'stopped', ra->>'stopped');
  -- C2 a kill stops the call (the first attack kills the only monster: the step changes too)
  update dungeon_runs set state = jsonb_set(jsonb_set(jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || '{"hp": 1}')), '{round}', '1'), '{sup_round}', '-1') where id = run2;
  ra := dungeon_auto_rounds('${P}b2', 'daily', 5);
  res := res || jsonb_build_object('case', 'C2 a kill stops the call after its round (played 1, stopped kill, the step is not a fight any more)', 'ok',
    (ra->>'played')::int = 1 and ra->>'stopped' = 'kill' and (ra->'rounds'->0->'atk'->>'kill')::boolean and ra->'state'->>'phase' <> 'fight', 'played', ra->'played', 'stopped', ra->>'stopped', 'phase', ra->'state'->>'phase');
  -- C3 not a fight, and no run
  ra := dungeon_auto_rounds('${P}b2', 'daily', 5);
  res := res || jsonb_build_object('case', 'C3 a step that is not a fight: not_fighting; no run today: no_run; the Dungeon closed: disabled', 'ok',
    ra->>'error' = 'not_fighting' and not (ra->>'ok')::boolean and dungeon_auto_rounds('${P}nobody', 'daily', 5)->>'error' = 'no_run', 'a', ra->>'error');
  -- C4 a squad that falls: every card 1 HP, a strong monster
  perform pg_temp.dar_member('${P}c');
  ra := dungeon_start('${P}c', array[atk[1], atk[2], atk[3], (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  update dungeon_runs set state = jsonb_set(jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || foe || '{"atk": 100000, "moves": [{"w": 1, "kind": "slam", "name": "Stomp"}]}')),
      '{cards}', (select jsonb_object_agg(key, value || '{"hp": 1, "max": 100}'::jsonb) from jsonb_each(state->'cards'))) where player_id = '${P}c' and day = v_day;
  ra := dungeon_auto_rounds('${P}c', 'daily', 5);
  res := res || jsonb_build_object('case', 'C4 a squad that falls ends the run inside the call: stopped over, status not active', 'ok',
    (ra->>'ok')::boolean and ra->>'stopped' = 'over' and ra->>'status' <> 'active' and (ra->>'played')::int between 1 and 5, 'stopped', ra->>'stopped', 'status', ra->>'status', 'played', ra->'played');
  -- C5 an attack that the rules refuse, with nothing played: the refusal itself
  perform pg_temp.dar_member('${P}d');
  ra := dungeon_start('${P}d', array[atk[1], atk[2], atk[3], atk[4], atk[5]]);
  v_cap := balance_num('dungeon', 'round_cap')::int;
  update dungeon_runs set state = jsonb_set(state, '{round}', to_jsonb(v_cap)) where player_id = '${P}d' and day = v_day;
  ra := dungeon_auto_rounds('${P}d', 'daily', 5);
  res := res || jsonb_build_object('case', 'C5 the round cap refuses the first attack and nothing was played: the answer is the refusal itself (ok false, round_cap)', 'ok',
    not (ra->>'ok')::boolean and ra->>'error' = 'round_cap', 'answer', ra);
  -- C5b the same with a support that can play first: the support is in the answer, the call stops with the reason
  perform pg_temp.dar_member('${P}d2');
  ra := dungeon_start('${P}d2', array[atk[1], atk[2], atk[3], (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  update dungeon_runs set state = jsonb_set(jsonb_set(state, '{round}', to_jsonb(v_cap)), '{foes}', jsonb_build_array((state->'foes'->0) || foe)) where player_id = '${P}d2' and day = v_day;
  ra := dungeon_auto_rounds('${P}d2', 'daily', 5);
  res := res || jsonb_build_object('case', 'C5b the round cap after a support that played: ok, 1 round with only the support, stopped error round_cap', 'ok',
    (ra->>'ok')::boolean and ra->>'stopped' = 'error' and ra->'error'->>'error' = 'round_cap' and jsonb_array_length(ra->'rounds') = 1 and ra->'rounds'->0->'atk' is null and ra->'rounds'->0->'sup' is not null and (ra->>'played')::int = 0, 'stopped', ra->>'stopped', 'error', ra->'error'->>'error');
  -- C6 a support that the rules refuse is skipped: a stun inside the stun immunity (the policy tries it: the monster is not stunned NOW)
  perform pg_temp.dar_member('${P}e');
  ra := dungeon_start('${P}e', array[atk[1], atk[2], atk[3], (sups->>'stun')::bigint, (sups->>'heal')::bigint]);
  update dungeon_runs set state = jsonb_set(jsonb_set(jsonb_set(jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || foe || '{"st": 1}')), '{round}', '2'), '{sup_round}', '-1'),
      '{cards}', (select jsonb_object_agg(key, value || '{"hp": 10000000, "max": 10000000}'::jsonb) from jsonb_each(state->'cards'))) where player_id = '${P}e' and day = v_day;
  ra := dungeon_auto_rounds('${P}e', 'daily', 1);
  res := res || jsonb_build_object('case', 'C6 a stun that the rules refuse (the monster was stunned a round ago) is skipped: the round plays its attack', 'ok',
    (ra->>'ok')::boolean and (ra->>'played')::int = 1 and ra->'rounds'->0->'sup' is null and ra->'rounds'->0->'atk'->>'card' is not null, 'round0', ra->'rounds'->0);
  -- C8 every attacker stunned and the supports on cooldown: Auto passes (the monsters act), never attacks with a stunned card, and attacks again once the stun is over
  perform pg_temp.dar_member('${P}s');
  ra := dungeon_start('${P}s', array[atk[1], atk[2], atk[3], (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  update dungeon_runs set state = jsonb_set(jsonb_set(jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || foe)), '{sup_round}', '0'),
      '{cards}', (select jsonb_object_agg(key, case when coalesce((value->>'sup')::boolean, false) then value || '{"cd": 9}' else value || '{"hp": 10000000, "max": 10000000, "cd": 1}' end) from jsonb_each(state->'cards'))) where player_id = '${P}s' and day = v_day;
  ra := dungeon_auto_rounds('${P}s', 'daily', 3);
  res := res || jsonb_build_object('case', 'C8 every attacker stunned: Auto passes the turn (pass entry, the monsters act), then attacks when the stun is over', 'ok',
    (ra->>'ok')::boolean and ra->'rounds'->0->'pass' is not null and ra->'rounds'->0->'atk' is null and jsonb_array_length(ra->'rounds'->0->'pass'->'enemy') >= 1
    and ra->'rounds'->1->'atk'->>'card' is not null and (ra->>'played')::int = 3 and not exists (select 1 from jsonb_array_elements(ra->'rounds') e where e->'atk' is not null and e->'pass' is not null), 'first', ra->'rounds'->0->'pass'->'no_action', 'second', ra->'rounds'->1->'atk'->'card', 'played', ra->'played');
  -- C7 the Gauntlet: p_mode reaches the rules (the run is a gauntlet run)
  perform pg_temp.dar_member('${P}g');
  ra := gauntlet_start('${P}g');
  if coalesce((ra->>'ok')::boolean, false) then
    update dungeon_runs set state = jsonb_set(jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || foe)),
        '{cards}', (select jsonb_object_agg(key, value || '{"hp": 10000000, "max": 10000000}'::jsonb) from jsonb_each(state->'cards'))) where player_id = '${P}g' and mode = 'gauntlet' and day = v_day;
    rb := dungeon_auto_rounds('${P}g', 'gauntlet', 2);
    res := res || jsonb_build_object('case', 'C7 the Gauntlet through p_mode: 2 rounds played on a gauntlet run; the daily mode finds no run for this member', 'ok',
      (rb->>'ok')::boolean and (rb->>'played')::int = 2 and rb->'state'->>'mode' = 'gauntlet' and dungeon_auto_rounds('${P}g', 'daily', 2)->>'error' = 'no_run', 'played', rb->'played', 'mode', rb->'state'->>'mode');
  else
    res := res || jsonb_build_object('case', 'C7 the Gauntlet run starts', 'ok', false, 'start', ra);
  end if;

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1800) };
  return { results: JSON.parse(m[1]) };
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, [a, b]] of Object.entries(MUTATIONS)) {
    if (src.split(a).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const { results, raw } = await runOnce(src.replace(a, () => b));
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0].slice(0, 90)}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 900)}`); }
  console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
  process.exitCode = fail ? 1 : 0;
}
