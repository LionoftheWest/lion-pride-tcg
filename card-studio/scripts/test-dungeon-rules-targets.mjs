/**
 * Acceptance test for dungeon_rules_supports_targets.sql (Nathan 2026-10-08, D-126 and D-127):
 *   D-126  supports are never knocked out (and never hit, poisoned or area-hit) in the Dungeon and the Gauntlet
 *   D-127  a monster's single-target hit picks a RANDOM attacker; an area hit still hits every attacker
 *   The Hunt keeps its rules (supports can go down there).
 * One DO block, rolled back (the final RAISE), fake members, fixed random seeds (setseed):
 *   node scripts/test-dungeon-rules-targets.mjs              the migration file, executed inside the block (must PASS)
 *   node scripts/test-dungeon-rules-targets.mjs --old        the dungeon_enemy_turn text of git 19cb666 (the live text
 *                                                            before the file): the baseline, it must FAIL
 *   node scripts/test-dungeon-rules-targets.mjs --mutations  each mutation of the file must make a case FAIL
 * Run it on the local copy: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-dungeon-rules-targets.mjs
 * Cases:
 *   U1 a standing attacker attacks: 300 foe turns hit BOTH attackers (random), never the support card
 *   U2 the attacking card is down, a support has the lowest id: the support is never hit (old: first card by id)
 *   U3 a Slam: the hit card plus the area cards are all the attackers, every attacker takes a hit, the supports none
 *   U4 poison: an attacker still loses HP to its poison, a support card does not
 *   U5 only a support stands: nobody is hit, no error
 *   E1 / E2 a seeded daily run and a seeded Gauntlet run through dungeon_attack(p_mode): the supports end at full HP,
 *      never down, never a target; the single hits reach more than the attacking card; a Slam hits every attacker
 *   (The Hunt keeps its own rules: card-studio/scripts/test-hunt-random-target.mjs, D-129.)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const old = process.argv.includes('--old');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const src = strip(readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/dungeon_rules_supports_targets.sql', import.meta.url)), 'utf8'));
// The function BEFORE the file: the live text of 2026-10-08 (the schema snapshot at git 19cb666).
const oldText = (() => {
  const s = execFileSync('git', ['show', '19cb666:db/schema/functions/dungeon_enemy_turn.sql'], { cwd: repo, encoding: 'utf8' }).replace(/\r/g, '');
  const a = s.indexOf('CREATE OR REPLACE FUNCTION'), b = s.indexOf('$function$;', a);
  return s.slice(a, b + '$function$;'.length);
})();
for (const s of [src, oldText]) if (s.includes('$m$') || s.includes('$t$') || s.includes('$f$')) throw new Error('a file contains $m$, $t$ or $f$');

// One mutation per mechanism, on the migration text: [text, replacement].
const MUTATIONS = {
  'the single hit goes to the attacking card again (D-127)': ['order by random() limit 1);', 'order by (key = p_attacker::text) desc, key limit 1);'],
  'the single hit goes to the first attacker by id, not random (D-127)': ['order by random() limit 1);', 'order by key limit 1);'],
  'a support can be the single target (D-126)': ["where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false) order by random() limit 1);", "where not (value->>'down')::boolean order by random() limit 1);"],
  'an area hit reaches the supports (D-126)': ["where key <> v_tgt and not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false) order by key loop", "where key <> v_tgt and not (value->>'down')::boolean order by key loop"],
  'an area hit skips the other attackers (D-127: area still hits all)': ["if (act->>'area')::numeric > 0 then", 'if false then'],
  'poison ticks on a support (D-126)': ["where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false) and coalesce((value->>'psnu')::int, -1) >= v_round", "where not (value->>'down')::boolean and coalesce((value->>'psnu')::int, -1) >= v_round"],
};

const P = 'tst_drt_';
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; i int; j int; bad text; r jsonb; st jsonb; act jsonb; foe jsonb;
  cnt3 int; cnt4 int; supc int; v_day date; ls bigint; atk bigint[]; sups jsonb; v_run bigint; a bigint[];
  hit text; ids text; v_cap int; v_slams int; v_other int; v_supbad int; v_area_bad int; e jsonb;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  -- 0. the function under test: the file, or the text before it (--old).
  ${mig ? `execute $m$${mig}$m$;` : `execute $m$${oldText}$m$;`}

  -- A crafted foe: huge HP, strike moves only, no passives (no thorns, burn, regeneration).
  foe := '{"hp": 2000000000, "max": 2000000000, "atk": 50, "enr": 0, "enru": 0, "wk": 0, "wku": 0, "ex": 0, "exu": 0, "st": 0, "sh": 0, "passives": [], "charge": false,
           "moves": [{"w": 1, "kind": "strike", "name": "Hit"}]}'::jsonb;
  -- A card: 10 million HP (a hit never downs it), no shield.
  create function pg_temp.drt_card(p_sup boolean, p_down boolean) returns jsonb language sql as $f$
    select jsonb_build_object('hp', case when p_down then 0 else 10000000 end, 'max', 10000000, 'down', p_down, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', p_sup, 'psn', 0, 'psnu', -1) $f$;

  -- U1 a standing attacker (3) attacks; the other attacker is 4, the support is 1
  perform setseed(0.31);
  st := jsonb_build_object('round', 0, 'foes', jsonb_build_array(foe),
    'cards', jsonb_build_object('1', pg_temp.drt_card(true, false), '3', pg_temp.drt_card(false, false), '4', pg_temp.drt_card(false, false)));
  cnt3 := 0; cnt4 := 0; supc := 0;
  for i in 1..300 loop
    r := dungeon_enemy_turn(st, 3, 0, 0);
    hit := r->'actions'->0->>'card';
    if hit = '3' then cnt3 := cnt3 + 1; elsif hit = '4' then cnt4 := cnt4 + 1; else supc := supc + 1; end if;
    st := (r->'state') || jsonb_build_object('round', 0);
  end loop;
  res := res || jsonb_build_object('case', 'U1 300 single hits: both attackers are hit (random, not the attacking card only), the support never', 'ok',
    supc = 0 and cnt3 >= 80 and cnt4 >= 80 and (st->'cards'->'1'->>'hp')::int = 10000000 and not (st->'cards'->'1'->>'down')::boolean,
    'attacker3', cnt3, 'attacker4', cnt4, 'support', supc);

  -- U2 the attacking card (2) is down, the support (1) has the lowest id
  perform setseed(0.47);
  st := jsonb_build_object('round', 0, 'foes', jsonb_build_array(foe),
    'cards', jsonb_build_object('1', pg_temp.drt_card(true, false), '2', pg_temp.drt_card(false, true), '3', pg_temp.drt_card(false, false)));
  supc := 0; cnt3 := 0;
  for i in 1..100 loop
    r := dungeon_enemy_turn(st, 2, 0, 0);
    hit := r->'actions'->0->>'card';
    if hit = '1' then supc := supc + 1; elsif hit = '3' then cnt3 := cnt3 + 1; end if;
    st := (r->'state') || jsonb_build_object('round', 0);
  end loop;
  res := res || jsonb_build_object('case', 'U2 the attacker is down and a support has the lowest id: 100 hits all land on the standing attacker', 'ok',
    supc = 0 and cnt3 = 100 and (st->'cards'->'1'->>'hp')::int = 10000000 and not (st->'cards'->'1'->>'down')::boolean, 'support', supc, 'attacker', cnt3);

  -- U3 a Slam (a single hit plus an area hit on the others): 2 supports, 3 attackers
  perform setseed(0.59);
  st := jsonb_build_object('round', 0, 'foes', jsonb_build_array(jsonb_set(foe, '{moves}', '[{"w": 1, "kind": "slam", "name": "Stomp"}]')),
    'cards', jsonb_build_object('1', pg_temp.drt_card(true, false), '2', pg_temp.drt_card(true, false), '3', pg_temp.drt_card(false, false),
      '4', pg_temp.drt_card(false, false), '5', pg_temp.drt_card(false, false)));
  bad := '';
  for i in 1..60 loop
    r := dungeon_enemy_turn(st, 3, 0, 0);
    act := r->'actions'->0;
    ids := (select string_agg(x, ',' order by x) from (select act->>'card' x union all select y->>'card' from jsonb_array_elements(act->'area') y) z);
    if ids is distinct from '3,4,5' then bad := bad || i || ':' || coalesce(ids, 'null') || ' '; end if;
    st := (r->'state') || jsonb_build_object('round', 0);
  end loop;
  res := res || jsonb_build_object('case', 'U3 60 Slams: the single hit plus the area hit reach exactly the 3 attackers each time, never the 2 supports', 'ok',
    bad = '' and (st->'cards'->'1'->>'hp')::int = 10000000 and (st->'cards'->'2'->>'hp')::int = 10000000
      and (st->'cards'->'3'->>'hp')::int < 10000000 and (st->'cards'->'4'->>'hp')::int < 10000000 and (st->'cards'->'5'->>'hp')::int < 10000000, 'bad', left(bad, 300));

  -- U4 poison: an attacker (3) and a support (1) both carry poison until round 99
  perform setseed(0.71);
  st := jsonb_build_object('round', 0, 'foes', '[]'::jsonb,
    'cards', jsonb_build_object('1', pg_temp.drt_card(true, false) || '{"psn": 500, "psnu": 99}', '3', pg_temp.drt_card(false, false) || '{"psn": 500, "psnu": 99}'));
  r := dungeon_enemy_turn(st, 3, 0, 0);
  res := res || jsonb_build_object('case', 'U4 poison: the attacker loses its poison damage, the support card loses nothing', 'ok',
    (r->'state'->'cards'->'3'->>'hp')::int = 10000000 - 500 and (r->'state'->'cards'->'1'->>'hp')::int = 10000000, 'state', r->'state'->'cards');

  -- U5 only a support stands
  st := jsonb_build_object('round', 0, 'foes', jsonb_build_array(foe),
    'cards', jsonb_build_object('1', pg_temp.drt_card(true, false), '3', pg_temp.drt_card(false, true)));
  r := dungeon_enemy_turn(st, 3, 0, 0);
  res := res || jsonb_build_object('case', 'U5 only a support stands: nobody is hit, no error', 'ok',
    jsonb_array_length(r->'actions') = 0 and (r->'state'->'cards'->'1'->>'hp')::int = 10000000 and not (r->'state'->'cards'->'1'->>'down')::boolean);

  -- E1 / E2 the real run functions: a daily run and a Gauntlet run. The Dungeon and the Gauntlet on (rolled back).
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  v_day := dungeon_day();
  perform dungeon_generate(v_day);
  update dungeon_days set rule = '{}'::jsonb where day = v_day;
  select min(c.id) into ls from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal';
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id <> ls order by c.id limit 9) x;
  select jsonb_object_agg(e2, id) into sups from (select s.ability->>'effect' e2, min(c.id) id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by 1) x;
  for i in 1..2 loop
    insert into players (id, username) values ('${P}' || i, 'tst drt ' || i);
    insert into player_cards (player_id, card_id, quantity)
      select '${P}' || i, x, 1 from unnest(array[ls] || atk || array(select (v #>> '{}')::bigint from jsonb_each(sups) e(k2, v))) x;
  end loop;
  v_cap := balance_num('dungeon', 'round_cap')::int;
  for j in 1..2 loop
    perform setseed(0.13 * j);
    if j = 1 then r := dungeon_start('${P}1', array[ls, atk[1], atk[2], (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
    else r := gauntlet_start('${P}2'); end if;
    if not coalesce((r->>'ok')::boolean, false) then
      res := res || jsonb_build_object('case', 'E' || j || ' the run starts', 'ok', false, 'r', r); continue; end if;
    v_run := (r->>'run')::bigint;
    -- the crafted foe (strike weight 1, slam weight 3), every card at 10 million HP
    update dungeon_runs set state = jsonb_set(state, '{foes}', jsonb_build_array(
        (state->'foes'->0) || (foe || '{"moves": [{"w": 1, "kind": "strike", "name": "Hit"}, {"w": 3, "kind": "slam", "name": "Stomp"}]}'::jsonb))) where id = v_run;
    update dungeon_runs set state = jsonb_set(state, '{cards}', (select jsonb_object_agg(key, value || '{"hp": 10000000, "max": 10000000}'::jsonb)
        from jsonb_each(state->'cards'))) where id = v_run;
    select array_agg(key::bigint order by key::bigint) filter (where not coalesce((value->>'sup')::boolean, false)) into a
      from dungeon_runs, jsonb_each(state->'cards') where id = v_run;
    v_slams := 0; v_other := 0; v_supbad := 0; v_area_bad := 0;
    for i in 1..(v_cap - 2) loop
      r := dungeon_attack('${P}' || j, a[1], 0, case when j = 1 then 'daily' else 'gauntlet' end);
      exit when not coalesce((r->>'ok')::boolean, false);
      for e in select x from jsonb_array_elements(r->'enemy') x loop
        if (e->>'card') is null then continue; end if;
        if (e->>'card')::bigint <> a[1] then v_other := v_other + 1; end if;
        if exists (select 1 from dungeon_runs d where d.id = v_run and coalesce((d.state->'cards'->(e->>'card')->>'sup')::boolean, false)) then v_supbad := v_supbad + 1; end if;
        if jsonb_array_length(coalesce(e->'area', '[]')) > 0 then
          v_slams := v_slams + 1;
          -- the hit card plus the area cards are all the attackers
          if (select count(distinct y) from (select e->>'card' y union all select z->>'card' from jsonb_array_elements(e->'area') z) w)
             <> (select count(*) from dungeon_runs d, jsonb_each(d.state->'cards') where d.id = v_run and not coalesce((value->>'sup')::boolean, false)) then
            v_area_bad := v_area_bad + 1; end if;
          if exists (select 1 from jsonb_array_elements(e->'area') z join dungeon_runs d on d.id = v_run
                       where coalesce((d.state->'cards'->(z->>'card')->>'sup')::boolean, false)) then v_supbad := v_supbad + 1; end if;
        end if;
      end loop;
    end loop;
    select state into st from dungeon_runs where id = v_run;
    res := res || jsonb_build_object('case', 'E' || j || ' a seeded ' || case when j = 1 then 'daily' else 'Gauntlet' end ||
      ' run: supports never hit and never down, single hits reach other attackers than the attacking card, every Slam hits all attackers', 'ok',
      v_supbad = 0 and v_other > 0 and v_slams > 0 and v_area_bad = 0
        and not exists (select 1 from jsonb_each(st->'cards') where coalesce((value->>'sup')::boolean, false) and ((value->>'down')::boolean or (value->>'hp')::int <> 10000000))
        and exists (select 1 from jsonb_each(st->'cards') where coalesce((value->>'sup')::boolean, false)),
      'supports_hit', v_supbad, 'hits_on_other_cards', v_other, 'slams', v_slams, 'slams_missing_an_attacker', v_area_bad, 'mode', st->>'mode');
  end loop;

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
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
  const { results, raw } = await runOnce(old ? '' : src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 700)}`); }
  console.log(`${old ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
