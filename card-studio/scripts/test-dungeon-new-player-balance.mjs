/**
 * Acceptance test for tcg-bot/supabase/dungeon_new_player_balance.sql, NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-dungeon-new-player-balance.mjs     must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                                      must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                         runs every mutation and prints one line each
 * Invariants:
 *   1. Today's values: the 8 new keys of balance dungeon have the values of the code before the file (nothing changes in play).
 *   2. The limits: each key refuses a value outside its limits (whole numbers, ranges) and a lost key; a value inside is accepted.
 *   3. The keys change the behavior: the number of foes of a fight and a horde (dungeon_room_foes), the early floors (dungeon_make_foe:
 *      HP and attack of the first early_floors floors only), and the heal cap (dungeon_enemy_turn: the foes together heal back at most
 *      cap x the damage of the round; 0 = no cap; a pass of the turn with 0 damage heals 0 under a cap).
 * The golden tests (dungeon-golden.mjs, combat-golden.mjs) prove that today's values play exactly as the old code.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/dungeon_new_player_balance.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const MUT = {
  nocap: ['if v_capl is not null then v_heal := least(v_heal, v_capl); v_capl := v_capl - v_heal; end if;', ''],
  capsum: ['v_capl := v_capl - v_heal; end if;', 'end if;'],
  capdmg: ["greatest(0, coalesce(p_dmg, 0))", '1000'],
  capoff: ["if balance_num('dungeon', 'foe_heal_cap') > 0 then v_capl", "if balance_num('dungeon', 'foe_heal_cap') >= 0 then v_capl"],
  hordemin: ["balance_num('dungeon', 'horde_min')::int +", '4 +'],
  hordespread: ["balance_num('dungeon', 'horde_spread')", '2'],
  fightmin: ["balance_num('dungeon', 'fight_min')::int +", '1 +'],
  fightspread: ["balance_num('dungeon', 'fight_spread')", '3'],
  earlyhp: ["v_hp := v_hp * balance_num('dungeon', 'early_hp'); v_atk", 'v_atk'],
  earlyatk: ["v_atk := v_atk * balance_num('dungeon', 'early_atk'); end if;", 'end if;'],
  earlyfloors: ["if p_floor <= balance_num('dungeon', 'early_floors')::int", "if p_floor < balance_num('dungeon', 'early_floors')::int"],
  defaultcap: ["'foe_heal_cap', 0)", "'foe_heal_cap', 0.5)"],
  defaulthorde: ["'horde_min', 4,", "'horde_min', 3,"],
  limminfoes: ['not between 1 and 8', 'not between 1 and 80'],
  limspread: ['not between 1 and 4', 'not between 1 and 40'],
  limfloors: ['not between 0 and 30', 'not between 0 and 300'],
  limearly: ['not between 0.1 and 1 then', 'not between 0.1 and 10 then'],
  limcap: ['not between 0 and 5 then', 'not between 0 and 500 then'],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(12)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.split(m[0]).join(m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; k text; v jsonb; f jsonb; f1 jsonb; st jsonb; et jsonb; n int; lo int; hi int; a int; b int; h int;
  want jsonb := '{"fight_min": 1, "fight_spread": 3, "horde_min": 4, "horde_spread": 2, "early_floors": 1, "early_hp": 1, "early_atk": 1, "foe_heal_cap": 0}';
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_dnpb', true);
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent

  -- 1. Today's values (all 8 keys, the old ones stay).
  for k, v in select e.key, e.value from jsonb_each(want) e loop
    if (select value->k from balance where key = 'dungeon') is distinct from v then bad := bad || '1: ' || k || ' is ' || coalesce((select (value->k)::text from balance where key = 'dungeon'), 'missing') || ', want ' || v::text || '; '; end if;
  end loop;
  if (select value->'foe_mult'->'horde'->>'atk' from balance where key = 'dungeon') <> '0.75' or (select value->>'hp_growth' from balance where key = 'dungeon') <> '1.42' then bad := bad || '1: an old key changed; '; end if;
  if (select note from balance where key = 'dungeon') not like '%early_floors%' then bad := bad || '1: the note does not name the new keys; '; end if;
  -- balance_log: a change of one of the new keys is recorded (who, old, new).
  select count(*) into n from balance_log where key = 'dungeon';
  update balance set value = jsonb_set(value, '{foe_heal_cap}', '0.5') where key = 'dungeon';
  if (select count(*) from balance_log where key = 'dungeon') <> n + 1
     or (select (old_value->>'foe_heal_cap') || '/' || (new_value->>'foe_heal_cap') from balance_log where key = 'dungeon' order by id desc limit 1) <> '0/0.5'
     or (select changed_by from balance_log where key = 'dungeon' order by id desc limit 1) <> 'tst_dnpb' then bad := bad || '1: balance_log does not record a change of foe_heal_cap; '; end if;
  update balance set value = jsonb_set(value, '{foe_heal_cap}', '0') where key = 'dungeon';

  -- 2. The limits: each value outside is refused; a value inside is accepted.
  foreach k in array array['fight_min:0', 'fight_min:9', 'fight_min:1.5', 'horde_min:0', 'horde_min:9', 'horde_min:2.5', 'fight_spread:0', 'fight_spread:5', 'horde_spread:0', 'horde_spread:5', 'horde_spread:1.5',
                           'early_floors:-1', 'early_floors:31', 'early_floors:0.5', 'early_hp:0.05', 'early_hp:1.1', 'early_atk:0', 'early_atk:2', 'foe_heal_cap:-0.1', 'foe_heal_cap:5.1'] loop
    begin
      update balance set value = jsonb_set(value, array[split_part(k, ':', 1)], to_jsonb(split_part(k, ':', 2)::numeric)) where key = 'dungeon';
      bad := bad || '2: ' || k || ' was accepted; ';
    exception when raise_exception then null; end;
  end loop;
  begin update balance set value = value - 'foe_heal_cap' where key = 'dungeon'; bad := bad || '2: a lost key was accepted; '; exception when raise_exception then null; end;
  begin update balance set value = jsonb_set(value, '{horde_min}', '"4"') where key = 'dungeon'; bad := bad || '2: a text value was accepted; '; exception when raise_exception then null; end;
  foreach k in array array['fight_min:8', 'horde_min:1', 'fight_spread:4', 'horde_spread:1', 'early_floors:0', 'early_floors:30', 'early_hp:0.1', 'early_atk:1', 'foe_heal_cap:0', 'foe_heal_cap:5', 'foe_heal_cap:0.5'] loop
    begin
      update balance set value = jsonb_set(value, array[split_part(k, ':', 1)], to_jsonb(split_part(k, ':', 2)::numeric)) where key = 'dungeon';
    exception when raise_exception then bad := bad || '2: ' || k || ' was refused: ' || sqlerrm || '; '; end;
  end loop;
  update balance set value = value || want where key = 'dungeon';   -- back to today's values

  -- 3a. The number of foes. Today: a fight 1 to 3, a horde 4 to 5, both seen. Then 2 to 2 and 6 to 8.
  lo := 99; hi := 0; a := 99; b := 0;
  for n in 1..60 loop
    h := jsonb_array_length(dungeon_room_foes('tst|' || n, 1, 2, 'fight')); lo := least(lo, h); hi := greatest(hi, h);
    h := jsonb_array_length(dungeon_room_foes('tst|' || n, 1, 3, 'horde')); a := least(a, h); b := greatest(b, h);
  end loop;
  if lo <> 1 or hi <> 3 then bad := bad || format('3a: a fight has %s to %s foes, want 1 to 3; ', lo, hi); end if;
  if a <> 4 or b <> 5 then bad := bad || format('3a: a horde has %s to %s foes, want 4 to 5; ', a, b); end if;
  update balance set value = value || '{"fight_min": 2, "fight_spread": 1, "horde_min": 6, "horde_spread": 3}' where key = 'dungeon';
  lo := 99; hi := 0; a := 99; b := 0;
  for n in 1..60 loop
    h := jsonb_array_length(dungeon_room_foes('tst|' || n, 1, 2, 'fight')); lo := least(lo, h); hi := greatest(hi, h);
    h := jsonb_array_length(dungeon_room_foes('tst|' || n, 1, 3, 'horde')); a := least(a, h); b := greatest(b, h);
  end loop;
  if lo <> 2 or hi <> 2 then bad := bad || format('3a: a fight has %s to %s foes, want 2 to 2; ', lo, hi); end if;
  if a <> 6 or b <> 8 then bad := bad || format('3a: a horde has %s to %s foes, want 6 to 8; ', a, b); end if;
  if jsonb_array_length(dungeon_room_foes('tst|1', 1, 3, 'elite')) <> 1 or jsonb_array_length(dungeon_room_foes('tst|1', 1, 5, 'guardian')) <> 1 then bad := bad || '3a: an elite or a Guardian is not alone; '; end if;
  update balance set value = value || want where key = 'dungeon';

  -- 3b. The early floors: HP and attack of a foe on floors 1 to early_floors only.
  f1 := dungeon_make_foe('tst|early', 1, 2, 'fight'); f := dungeon_make_foe('tst|early', 2, 2, 'fight');
  update balance set value = value || '{"early_hp": 0.5, "early_atk": 0.5}' where key = 'dungeon';
  if (dungeon_make_foe('tst|early', 1, 2, 'fight')->>'hp')::int <> round((f1->>'hp')::int * 0.5)::int and abs((dungeon_make_foe('tst|early', 1, 2, 'fight')->>'hp')::int - (f1->>'hp')::int * 0.5) > 1
    then bad := bad || '3b: floor 1 HP is not eased by early_hp; '; end if;
  if abs((dungeon_make_foe('tst|early', 1, 2, 'fight')->>'atk')::int - (f1->>'atk')::int * 0.5) > 1 then bad := bad || '3b: floor 1 attack is not eased by early_atk; '; end if;
  if dungeon_make_foe('tst|early', 2, 2, 'fight') is distinct from f then bad := bad || '3b: floor 2 changed while early_floors is 1; '; end if;
  update balance set value = value || '{"early_floors": 2}' where key = 'dungeon';
  if abs((dungeon_make_foe('tst|early', 2, 2, 'fight')->>'hp')::int - (f->>'hp')::int * 0.5) > 1 then bad := bad || '3b: floor 2 HP is not eased with early_floors 2; '; end if;
  update balance set value = value || '{"early_floors": 0}' where key = 'dungeon';
  if dungeon_make_foe('tst|early', 1, 2, 'fight') is distinct from f1 then bad := bad || '3b: floor 1 changed with early_floors 0; '; end if;
  update balance set value = value || want where key = 'dungeon';
  if dungeon_make_foe('tst|early', 1, 2, 'fight') is distinct from f1 or dungeon_make_foe('tst|early', 2, 2, 'fight') is distinct from f then bad := bad || '3b: today''s values changed a foe; '; end if;

  -- 3c. The heal cap. Two foes that regenerate 3% of their 1000 HP a turn (30 each), a squad that dealt p_dmg this round.
  f := dungeon_make_foe('tst|heal', 1, 5, 'guardian') || '{"hp": 500, "max": 1000, "passives": ["regenerating"], "moves": [{"kind": "strike", "name": "Strike", "w": 1}], "charge": false, "st": 0, "sh": 0}'::jsonb;
  st := jsonb_build_object('round', 0, 'cards', jsonb_build_object('1', '{"hp": 100000, "max": 100000, "down": false, "shield": 0, "buff": 1, "debuff": 1, "cd": 0, "sup": false}'::jsonb),
                           'foes', jsonb_build_array(f, f));
  -- no cap: 30 + 30 whatever the damage
  et := dungeon_enemy_turn(st, null, null, 0);
  if (et->'state'->'foes'->0->>'hp')::int <> 530 or (et->'state'->'foes'->1->>'hp')::int <> 530 then bad := bad || '3c: with no cap the foes did not heal 30 each (' || (et->'state'->'foes'->0->>'hp') || ', ' || (et->'state'->'foes'->1->>'hp') || '); '; end if;
  update balance set value = value || '{"foe_heal_cap": 0.5}' where key = 'dungeon';
  -- cap 0.5 x 40 damage = 20 in all: the first foe takes 20, the second 0
  et := dungeon_enemy_turn(st, null, null, 40);
  a := (et->'state'->'foes'->0->>'hp')::int - 500; b := (et->'state'->'foes'->1->>'hp')::int - 500;
  if a + b <> 20 or a > 30 or b > 30 then bad := bad || format('3c: cap 0.5 and 40 damage healed %s + %s, want 20 in all; ', a, b); end if;
  -- cap 0.5 x 100 damage = 50: 30 + 20
  et := dungeon_enemy_turn(st, null, null, 100);
  a := (et->'state'->'foes'->0->>'hp')::int - 500; b := (et->'state'->'foes'->1->>'hp')::int - 500;
  if a <> 30 or b <> 20 then bad := bad || format('3c: cap 0.5 and 100 damage healed %s + %s, want 30 + 20; ', a, b); end if;
  -- a large damage: no cap in effect
  et := dungeon_enemy_turn(st, null, null, 100000);
  if (et->'state'->'foes'->0->>'hp')::int <> 530 or (et->'state'->'foes'->1->>'hp')::int <> 530 then bad := bad || '3c: a large damage still capped the heal; '; end if;
  -- a pass of the turn (0 damage) under a cap: no heal at all
  et := dungeon_enemy_turn(st, null, null, 0);
  if (et->'state'->'foes'->0->>'hp')::int <> 500 or (et->'state'->'foes'->1->>'hp')::int <> 500 then bad := bad || '3c: a turn with 0 damage healed under a cap; '; end if;
  -- the heal never exceeds the damage, for every damage from 0 to 80 and the caps 0.25, 0.5, 0.75, 1
  foreach k in array array['0.25', '0.5', '0.75', '1'] loop
    update balance set value = jsonb_set(value, '{foe_heal_cap}', to_jsonb(k::numeric)) where key = 'dungeon';
    for n in 0..80 loop
      et := dungeon_enemy_turn(st, null, null, n);
      h := (et->'state'->'foes'->0->>'hp')::int - 500 + (et->'state'->'foes'->1->>'hp')::int - 500;
      if h > n * k::numeric or h > n then bad := bad || format('3c: cap %s, damage %s: the foes healed %s; ', k, n, h); exit; end if;
    end loop;
  end loop;
  update balance set value = value || want where key = 'dungeon';
  -- the log carries the capped heal (value = the HP gained), so the Lab sees it
  update balance set value = value || '{"foe_heal_cap": 0.5}' where key = 'dungeon';
  et := dungeon_enemy_turn(st, null, null, 40);
  if (select coalesce(sum((e->'result'->>'value')::int), 0) from jsonb_array_elements(et->'hp_log') e where e->'result'->>'side' = 'foe' and e->'result'->>'dir' = 'heal') <> 20 then bad := bad || '3c: the HP log does not show the 20 healed; '; end if;
  update balance set value = value || want where key = 'dungeon';

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
