/**
 * Acceptance test for tcg-bot/supabase/f3_element_bonus.sql (the element chart fight rule, "rule A"), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-element-bonus.mjs      must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                         must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                            runs every mutation, one line each
 * The Dungeon is fought with the real dungeon_start and dungeon_attack (the Gauntlet plays through the same function). The same seed gives the same
 * rolls, so the damage only differs by the element multiplier. The expected value is d(1,1) x the multiplier (a rounding of at most 1.6).
 * Invariants:
 *   1. Today's values: element_bonus 1 and element_penalty 1; the old keys of balance combat are unchanged; a second run keeps a value that was changed.
 *   2. The limits: a bonus below 1 or above 2, a penalty below 0.5 or above 1, a value that is not a number, and a lost key are refused. 2 and 0.5 are accepted.
 *   3. A BEATING pair (the attacker's element beats the foe's) gets x element_bonus and the answer says elem = bonus, elem_mult = the multiplier.
 *      The REVERSE pair gets x element_penalty (elem = penalty). A pair that beats both ways (light, shadow) gets both (elem = both).
 *      A neutral pair, a card with no element, a foe with no element, and a pair that is only a proposal get NO change and NO elem field.
 *   4. With the values 1 and 1 the answer has no elem field and the damage is as before (the golden tests prove the whole transcript).
 *   5. The fight log (combat_actions, the attack row) has the same elem and elem_mult as the answer of dungeon_attack.
 *   6. combat_hit (14 arguments) is NOT changed: no chart, no elem field, one function of that name. combat_hit_elem is combat_hit + the two elements: with no
 *      elements it gives the same answer; with a pair it gives bonus / penalty / both and the multiplier; a miss has no chart field. combat_element returns the
 *      pair flags and the multiplier.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installHelpers } from './lab-sql.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_element_bonus.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const ELEM = "(hit - 'dmg' - 'outcome' - 'miss' - 'crit' - 'block' - 'double')";
const MUT = {
  bonusdir: ['c.beater = p_att and c.target = p_def and not c.proposal', 'c.beater = p_def and c.target = p_att and not c.proposal'],
  proposal: ['and not c.proposal', ''],
  penaltykey: ["v_p := public.balance_num('combat', 'element_penalty')", "v_p := public.balance_num('combat', 'element_bonus')"],
  bonuskey: ["v_b := public.balance_num('combat', 'element_bonus')", "v_b := public.balance_num('combat', 'element_penalty')"],
  nopenalty: ['if v_beaten then', 'if false then'],
  nobonus: ['if v_beats  then', 'if false then'],
  swapargs: ["card_element(v_tags), f->>'element');", "f->>'element', card_element(v_tags));"],
  noatt: ["card_element(v_tags), f->>'element');", "null, f->>'element');"],
  nodef: ["card_element(v_tags), f->>'element');", "card_element(v_tags), null);"],
  nomult: ['p_wmult * v_m,', 'p_wmult,'],
  multdmg: ['p_wmult * v_m,', 'p_wmult * v_m * v_m,'],
  alwaysfield: ["if v_m <> 1 and not (v_hit->>'miss')::boolean then", 'if true then'],
  missfield: ["if v_m <> 1 and not (v_hit->>'miss')::boolean then", 'if v_m <> 1 then'],
  callold: ['hit := combat_hit_elem(', 'hit := combat_hit('],
  fieldname: ["'elem_mult', v_m)", "'elem_x', v_m)"],
  noanswer: [`\n    || ${ELEM};   -- elem, elem_mult`, ';   -- elem, elem_mult'],
  nolog: [`'cp', (v_cmb->>'cp')::int) || ${ELEM})`, "'cp', (v_cmb->>'cp')::int))"],
  defbonus: ["jsonb_build_object('element_bonus', 1, 'element_penalty', 1)", "jsonb_build_object('element_bonus', 1.25, 'element_penalty', 1)"],
  defpenalty: ["jsonb_build_object('element_bonus', 1, 'element_penalty', 1)", "jsonb_build_object('element_bonus', 1, 'element_penalty', 0.85)"],
  strictinsert: ["if new.value ? 'element_bonus' then", 'if true then'],
  limbonus: ['not between 1 and 2 then', 'not between 0 and 20 then'],
  limpenalty: ['not between 0.5 and 1 then', 'not between 0.05 and 10 then'],
  overwrite: ["set value = jsonb_build_object('element_bonus', 1, 'element_penalty', 1) || value", "set value = value || jsonb_build_object('element_bonus', 1, 'element_penalty', 1)"],
  notrigger: ['create trigger balance_check_combat before insert or update on public.balance', 'create trigger balance_check_combat before delete on public.balance'],
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
if (['$m$', '$t$', '$j$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$, $t$ or $j$');

const body = String.raw`do $t$
declare bad text := ''; before jsonb; r jsonb; k text; v jsonb; n int; pl text; run dungeon_runs; base jsonb; foe jsonb; d1 numeric; d numeric; sc record; mult numeric; w text; i int;
  pa record; pc record; ca bigint; cb bigint; cn bigint; cx bigint; cm1 bigint; cm2 bigint; ea text; eb text; eu text; ev text; fillers bigint[]; sq bigint[]; fx jsonb; lg jsonb;
begin
  ${installHelpers()}
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_eb', true);
  update settings set value = value || '{"enabled": true}'::jsonb where key in ('dungeon', 'gauntlet');
  create function pg_temp.refused(p_sql text) returns boolean language plpgsql as $f$ begin begin execute p_sql; exception when others then return true; end; return false; end $f$;
  -- the lowest card id of the wanted element (null = no element) among the attackers
  create function pg_temp.eb_card(p_el text) returns bigint language sql as $f$
    select min(c.id) from cards c join subjects s on s.id = c.subject_id
     where s.type in ('Character', 'Creature') and c.rarity = 'normal' and card_element(s.tag_slugs) is not distinct from p_el $f$;
  -- one hit: the state is put back, the seed and the two balance numbers are set, then dungeon_attack. Returns the answer and the log row.
  create function pg_temp.eb_hit(p_pl text, p_card bigint, p_run bigint, p_base jsonb, p_foe jsonb, p_seed float, p_bonus numeric, p_pen numeric) returns jsonb language plpgsql as $f$
  declare a jsonb; l jsonb;
  begin
    update balance set value = value || jsonb_build_object('element_bonus', p_bonus, 'element_penalty', p_pen) where key = 'combat';
    update dungeon_runs set state = p_base || jsonb_build_object('foes', jsonb_build_array(p_foe), 'round', 0, 'buff', 1, 'sup_round', -1) where id = p_run;
    perform setseed(p_seed);
    a := dungeon_attack(p_pl, p_card, 0);
    select ca.result into l from combat_actions ca where ca.ref_id = p_run and ca.kind = 'attack' order by ca.id desc limit 1;
    return jsonb_build_object('a', a, 'log', l);
  end $f$;

  -- The state before the file, also when the file is already applied on this copy: no element keys and the old note (the triggers are off for this step).
  alter table public.balance disable trigger user;
  update balance set value = value - 'element_bonus' - 'element_penalty', note = split_part(note, ' Element chart (f3_element_bonus', 1) where key = 'combat';
  alter table public.balance enable trigger user;
  select value into before from balance where key = 'combat';
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent

  -- ===== 1. Today's values.
  if (select value->'element_bonus' from balance where key = 'combat') is distinct from '1'::jsonb or (select value->'element_penalty' from balance where key = 'combat') is distinct from '1'::jsonb then
    bad := bad || '1: the defaults are not 1 and 1: ' || (select value->>'element_bonus' || '/' || (value->>'element_penalty') from balance where key = 'combat') || '; ';
  end if;
  if (select value - 'element_bonus' - 'element_penalty' from balance where key = 'combat') is distinct from before then bad := bad || '1: an old key of balance combat changed; '; end if;
  if (select note from balance where key = 'combat') not like '%element_bonus%' or (select note from balance where key = 'combat') not like '%element_penalty%' then bad := bad || '1: the note does not name the keys; '; end if;
  update balance set value = value || '{"element_bonus": 1.3}'::jsonb where key = 'combat';
  execute $m$${mig}$m$;
  if (select value->'element_bonus' from balance where key = 'combat') is distinct from '1.3'::jsonb then bad := bad || '1: a second run overwrote a value; '; end if;
  -- a copy that has one key only (the triggers are off for this step): the file adds the missing key and keeps the value that is there
  alter table public.balance disable trigger user;
  update balance set value = (value - 'element_penalty') || '{"element_bonus": 1.3}'::jsonb where key = 'combat';
  alter table public.balance enable trigger user;
  execute $m$${mig}$m$;
  if (select value->'element_bonus' from balance where key = 'combat') is distinct from '1.3'::jsonb or (select value->'element_penalty' from balance where key = 'combat') is distinct from '1'::jsonb then
    bad := bad || '1: a copy with one key: bonus ' || coalesce((select value->>'element_bonus' from balance where key = 'combat'), '-') || ' penalty ' || coalesce((select value->>'element_penalty' from balance where key = 'combat'), '-') || '; ';
  end if;
  update balance set value = value || '{"element_bonus": 1}'::jsonb where key = 'combat';

  -- ===== 2. The limits.
  -- The seed row of balance_table.sql (insert ... on conflict do nothing) has no element keys: the trigger runs before the conflict is found and must not refuse it.
  if pg_temp.refused('insert into balance (key, value, note) values (''combat'', ''{"miss": 0.08}''::jsonb, ''seed'') on conflict (key) do nothing') then bad := bad || '2: the seed insert of balance combat (on conflict do nothing) was refused; '; end if;
  foreach k in array array['{"element_bonus": 0.99}', '{"element_bonus": 2.01}', '{"element_bonus": "1.5"}', '{"element_bonus": null}', '{"element_penalty": 0.49}', '{"element_penalty": 1.01}', '{"element_penalty": "0.8"}'] loop
    if not pg_temp.refused('update balance set value = value || ' || quote_literal(k) || '::jsonb where key = ''combat''') then bad := bad || '2: ' || k || ' was accepted; '; end if;
  end loop;
  if not pg_temp.refused('update balance set value = value - ''element_bonus'' where key = ''combat''') or not pg_temp.refused('update balance set value = value - ''element_penalty'' where key = ''combat''') then bad := bad || '2: a lost key was accepted; '; end if;
  if pg_temp.refused('update balance set value = value || ''{"element_bonus": 2, "element_penalty": 0.5}''::jsonb where key = ''combat''') or pg_temp.refused('update balance set value = value || ''{"element_bonus": 1, "element_penalty": 1}''::jsonb where key = ''combat''') then
    bad := bad || '2: a value inside the limits was refused; ';
  end if;

  -- ===== 6. combat_hit and combat_element (units). The old 14-argument call has no chart; the 16-argument call applies it; the same seed = the same rolls.
  update balance set value = value || '{"element_bonus": 1.5, "element_penalty": 0.8}'::jsonb where key = 'combat';
  perform setseed(0.31); r := combat_hit(1000, 1, 1, 1, 1, 0, 0, null, 0, 0, false, 0, 100000, 100000);
  perform setseed(0.31); v := combat_hit_elem(1000, 1, 1, 1, 1, 0, 0, null, 0, 0, false, 0, 100000, 100000, null, null);
  if r is distinct from v or r ? 'elem' then bad := bad || '6: combat_hit_elem with no elements is not the same as combat_hit, or it has a chart: ' || r::text || ' ' || v::text || '; '; end if;
  if (select count(*) from pg_proc where proname = 'combat_hit' and pronamespace = 'public'::regnamespace) <> 1 or (select pronargs from pg_proc where proname = 'combat_hit' and pronamespace = 'public'::regnamespace) <> 14 then
    bad := bad || '6: combat_hit is not one function with 14 arguments; ';
  end if;
  perform setseed(0.31); v := combat_hit_elem(1000, 1, 1, 1, 1, 0, 0, null, 0, 0, false, 0, 100000, 100000, 'water', 'fire');
  if v->>'elem' is distinct from 'bonus' or (v->>'elem_mult')::numeric <> 1.5 or abs((v->>'dmg')::numeric - 1.5 * (r->>'dmg')::numeric) > 1 then bad := bad || '6: water against fire: ' || v::text || ' vs ' || r::text || '; '; end if;
  perform setseed(0.31); v := combat_hit_elem(1000, 1, 1, 1, 1, 0, 0, null, 0, 0, false, 0, 100000, 100000, 'fire', 'water');
  if v->>'elem' is distinct from 'penalty' or (v->>'elem_mult')::numeric <> 0.8 or abs((v->>'dmg')::numeric - 0.8 * (r->>'dmg')::numeric) > 1 then bad := bad || '6: fire against water: ' || v::text || '; '; end if;
  perform setseed(0.31); v := combat_hit_elem(1000, 1, 1, 1, 1, 0, 0, null, 0, 0, false, 0, 100000, 100000, 'light', 'shadow');
  if v->>'elem' is distinct from 'both' or (v->>'elem_mult')::numeric <> 1.2 then bad := bad || '6: light against shadow: ' || v::text || '; '; end if;
  perform setseed(0.31); v := combat_hit_elem(1000, 1, 1, 1, 1, 0, 0, null, 0, 0, false, 0, 100000, 100000, 'fire', 'fire');
  if v ? 'elem' or v->>'dmg' <> r->>'dmg' then bad := bad || '6: the same element changed the hit; '; end if;
  perform setseed(0.31); v := combat_hit_elem(1000, 1, 1, 1, 1, 0, 0, null, 0, 0, false, 0, 100000, 100000, null, 'fire');
  if v ? 'elem' or v->>'dmg' <> r->>'dmg' then bad := bad || '6: no attacker element changed the hit; '; end if;
  perform setseed(0.31); v := combat_hit_elem(1000, 1, 1, 1, 1, 0, 1, null, 0, 0, false, 0, 100000, 100000, 'water', 'fire');
  if v ? 'elem' or (v->>'dmg')::int <> 0 then bad := bad || '6: a miss has a chart field or damage: ' || v::text || '; '; end if;
  v := combat_element('water', 'fire');
  if v is distinct from '{"bonus": true, "penalty": false, "mult": 1.5}'::jsonb then bad := bad || '6: combat_element(water, fire) = ' || v::text || '; '; end if;
  v := combat_element('fire', 'water');
  if v is distinct from '{"bonus": false, "penalty": true, "mult": 0.8}'::jsonb then bad := bad || '6: combat_element(fire, water) = ' || v::text || '; '; end if;
  if combat_element(null, 'fire')->>'mult' <> '1' or combat_element('fire', null)->>'mult' <> '1' or combat_element('fire', 'fire')->>'mult' <> '1' then bad := bad || '6: a missing or same element is not 1; '; end if;
  update balance set value = value || '{"element_bonus": 1, "element_penalty": 1}'::jsonb where key = 'combat';

  -- ===== 3, 4, 5. The Dungeon, with the real dungeon_start and dungeon_attack. The data: the pairs and the cards of the local copy.
  -- A = a pair (b beats t) that beats one way only, with an attacker card for both elements and both elements foes. C = a pair with no counter either way.
  select c.beater b, c.target t into pa from element_counters c
   where not c.proposal and not exists (select 1 from element_counters x where x.beater = c.target and x.target = c.beater)
     and pg_temp.eb_card(c.beater) is not null and pg_temp.eb_card(c.target) is not null
     and (select dungeon_foe from elements where key = c.beater) and (select dungeon_foe from elements where key = c.target) order by c.beater, c.target limit 1;
  select e1.key u, e2.key v into pc from elements e1, elements e2
   where e1.key < e2.key and e1.dungeon_foe and e2.dungeon_foe and pg_temp.eb_card(e1.key) is not null and pg_temp.eb_card(e2.key) is not null
     and not exists (select 1 from element_counters x where (x.beater = e1.key and x.target = e2.key) or (x.beater = e2.key and x.target = e1.key)) order by 1, 2 limit 1;
  if pa.b is null or pc.u is null then raise exception 'RESULT:%', 'FAIL 3: the local data has no one-way pair or no neutral pair with attacker cards'; end if;
  perform dungeon_generate(dungeon_day());
  update dungeon_days set rule = '{"budget": 99}'::jsonb where day = dungeon_day();
  -- the scenarios: name, attacker element, foe element, the expected elem at bonus 1.5 / penalty 0.8 and the multiplier of each of the 4 settings
  for sc in select * from (values
      ('bonus',   pa.b, pa.t),
      ('reverse', pa.t, pa.b),
      ('neutral', pc.u, pc.v),
      ('mutual',  'light', 'shadow'),
      ('noattel', null::text, pa.t),
      ('nofoeel', pa.b, null::text),
      ('proposal', pc.u, pc.v)) x(name, ea, eb) loop
    if sc.name = 'mutual' and (pg_temp.eb_card('light') is null or pg_temp.eb_card('shadow') is null) then continue; end if;
    if pg_temp.eb_card(sc.ea) is null and sc.ea is not null then bad := bad || '3: no attacker for ' || sc.ea || '; '; continue; end if;
    if sc.name = 'noattel' and pg_temp.eb_card(null) is null then bad := bad || '3: the local data has no attacker card without an element; '; continue; end if;
    pl := 'tst_eb_' || sc.name;
    ca := pg_temp.eb_card(sc.ea);
    fillers := array(select c.id from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'normal' and c.id <> ca order by c.id limit 4);
    sq := array[ca] || fillers;
    perform pg_temp.lab_member(pl, sq, (select jsonb_object_agg(x::text, '{"asc": 5, "pts": {"attack": 6}}'::jsonb) from unnest(sq) x), true);
    if sc.name = 'proposal' then insert into element_counters (beater, target, proposal) values (pc.u, pc.v, true), (pc.v, pc.u, true); end if;
    r := dungeon_start(pl, sq);
    if not coalesce((r->>'ok')::boolean, false) then bad := bad || '3: ' || sc.name || ' the run did not start: ' || left(r::text, 200) || '; '; continue; end if;
    select * into run from dungeon_runs where player_id = pl and day = dungeon_day();
    base := run.state;
    foe := pg_temp.lab_foe('fight', 1, 1, sc.eb, null, null, 'eb' || sc.name);
    foe := foe || '{"hp": 1000000000, "max": 1000000000, "atk": 1, "passives": [], "ex": 0, "exu": 0}'::jsonb;
    if sc.eb is null then foe := foe - 'element'; end if;
    -- the four settings: bonus and penalty. d(1,1) is the base damage.
    r := pg_temp.eb_hit(pl, ca, run.id, base, foe, 0.37, 1, 1);
    d1 := (r->'a'->>'damage')::numeric;
    if not (r->'a'->>'ok')::boolean then bad := bad || '3: ' || sc.name || ' the attack was refused: ' || left(r::text, 200) || '; '; continue; end if;
    if d1 < 15 then bad := bad || '3: ' || sc.name || ' the base damage ' || d1 || ' is too small to measure; '; end if;
    if (r->'a') ? 'elem' or (r->'a') ? 'elem_mult' or (r->'log') ? 'elem' then bad := bad || '4: ' || sc.name || ' has an elem field at 1 and 1: ' || left(r::text, 300) || '; '; end if;
    for i in 1 .. 3 loop
      mult := case i when 1 then 1.5 when 2 then 0.8 else 1.5 * 0.8 end;      -- the setting; the real multiplier is chosen below
      r := pg_temp.eb_hit(pl, ca, run.id, base, foe, 0.37, case i when 2 then 1 else 1.5 end, case i when 1 then 1 else 0.8 end);
      d := (r->'a'->>'damage')::numeric;
      -- the expected multiplier of the scenario at this setting
      mult := case
        when sc.name = 'bonus'   then case i when 2 then 1 else 1.5 end
        when sc.name = 'reverse' then case i when 1 then 1 else 0.8 end
        when sc.name = 'mutual'  then case i when 1 then 1.5 when 2 then 0.8 else 1.2 end
        else 1 end;
      w := case sc.name when 'bonus' then 'bonus' when 'reverse' then 'penalty' when 'mutual' then case i when 1 then 'bonus' when 2 then 'penalty' else 'both' end else null end;
      if abs(d - mult * d1) > 0.5 + 0.5 * mult + 0.1 then bad := bad || format('3: %s setting %s: damage %s, expected %s x %s = %s; ', sc.name, i, d, mult, d1, mult * d1); end if;
      if mult <> 1 and sc.name <> 'proposal' then
        if r->'a'->>'elem' is distinct from w or (r->'a'->>'elem_mult')::numeric is distinct from mult then bad := bad || format('3: %s setting %s: the answer has elem %s x %s, expected %s x %s; ', sc.name, i, r->'a'->>'elem', r->'a'->>'elem_mult', w, mult); end if;
        -- 5. the fight log row has the same fields
        if r->'log'->>'elem' is distinct from w or (r->'log'->>'elem_mult')::numeric is distinct from mult then bad := bad || format('5: %s setting %s: the log has elem %s x %s, expected %s x %s; ', sc.name, i, r->'log'->>'elem', r->'log'->>'elem_mult', w, mult); end if;
      else
        if (r->'a') ? 'elem' or (r->'a') ? 'elem_mult' or (r->'log') ? 'elem' or (r->'log') ? 'elem_mult' then bad := bad || format('3: %s setting %s: an elem field where the multiplier is 1: %s; ', sc.name, i, left(r::text, 300)); end if;
      end if;
    end loop;
    -- the weakness bonus field keeps its own meaning ('bonus' = a weak tag), the chart has its own field
    if (r->'a') ? 'bonus' = false then bad := bad || '3: the weakness field bonus is missing; '; end if;
  end loop;
  -- 4. With 1 and 1 the damage of the scenario "bonus" is d(1,1) and an old run (a foe with no element key) is not changed even at 2 and 0.5 (the scenario nofoeel above, measured at 1.5).
  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|\\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
