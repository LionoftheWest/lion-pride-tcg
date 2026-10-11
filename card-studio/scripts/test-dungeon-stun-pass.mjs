/**
 * Acceptance test for tcg-bot/supabase/dungeon_stun_pass.sql (D-182, Nathan 2026-10-11): a stunned card never attacks; with no action left the turn passes.
 * Invariants:
 *   S1/S2  a stunned card is refused ("stunned") whether or not another attacker is ready (the bug: with EVERY attacker stunned the card attacked)
 *   S3     with no action (every attacker stunned, no support ready) dungeon_pass_turn advances the round, the monsters act (dungeon_enemy_turn), the stun is over
 *          the next round and the card attacks again
 *   S4     the pass is refused while the member can act (an attacker is not stunned; a support is ready and not used this round); force skips only the support check
 *   S5     a normal attack is unchanged: the new dungeon_attack and the live text give the same answer and the same state with the same seed
 *   S6-S9  the round cap refuses the pass; the Gauntlet goes through p_mode; a squad that falls on a pass ends the run; a pass writes no attack turn
 * One DO block, fake members, rolled back:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-dungeon-stun-pass.mjs             the migration file (must PASS)
 *   ... --old          the file with the OLD stun clause of dungeon_attack: the baseline, it must FAIL (S2)
 *   ... --mutations    each mutation of the file must make a case FAIL
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const repo = fileURLToPath(new URL('../../', import.meta.url));
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '').replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');   // the guard checks the live database, not this block
const src = strip(readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/dungeon_stun_pass.sql', import.meta.url)), 'utf8'));
// The dungeon_attack of the schema snapshot at the commit before the file (the live text of 2026-10-11, md5 b43992e3...).
const oldAttack = (() => {
  const s = execFileSync('git', ['log', '--format=%H', '-1', '--', 'db/schema/functions/dungeon_attack.sql'], { cwd: repo, encoding: 'utf8' }).trim();
  const f = execFileSync('git', ['show', `${s}:db/schema/functions/dungeon_attack.sql`], { cwd: repo, encoding: 'utf8' }).replace(/\r/g, '');
  const a = f.indexOf('CREATE OR REPLACE FUNCTION'), b = f.indexOf('$function$;', a);
  return f.slice(a, b + '$function$;'.length);
})();
const NEW_CLAUSE = "  if (c->>'cd')::int >= v_round + 1 then return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', (c->>'cd')::int); end if;\n";
const OLD_CLAUSE = `  if (c->>'cd')::int >= v_round + 1 and exists (
      select 1 from jsonb_each(st->'cards') e join cards cc on cc.id = e.key::bigint join subjects s on s.id = cc.subject_id
      where e.key <> p_card::text and not (e.value->>'down')::boolean and (e.value->>'cd')::int < v_round + 1 and s.type in ('Character', 'Creature')) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
`;
if (!src.includes(NEW_CLAUSE)) throw new Error('the new clause is not in the file');
for (const s of [src, oldAttack]) if (s.includes('$m$') || s.includes('$t$') || s.includes('$f$')) throw new Error('a file contains $m$, $t$ or $f$');
const refAttack = oldAttack.replace(/CREATE OR REPLACE FUNCTION public\.dungeon_attack\(/, 'create or replace function public.ref_dungeon_attack(');

const MUTATIONS = {
  'a stunned card attacks again when every attacker is stunned (the old clause)': [NEW_CLAUSE, OLD_CLAUSE],
  'the pass ignores a standing attacker that is not stunned': ["(c.value->>'cd')::int < v_round + 1) then\n    return jsonb_build_object('ok', false, 'error', 'can_act', 'why', 'attacker'", "(c.value->>'cd')::int < v_round + 1 and false) then\n    return jsonb_build_object('ok', false, 'error', 'can_act', 'why', 'attacker'"],
  'the pass ignores a ready support': ["if not p_force and coalesce((st->>'sup_round')::int, -1) <> v_round and exists (", "if false and exists ("],
  'a support used this round still blocks the pass': ["if not p_force and coalesce((st->>'sup_round')::int, -1) <> v_round and exists (", 'if not p_force and exists ('],
  'force does not skip the support check': ['if not p_force and coalesce', 'if coalesce'],
  'the pass does not run the monsters turn': ['et := dungeon_enemy_turn(st, null::bigint, null::int, 0); st := et->\'state\';', "et := jsonb_build_object('state', st, 'actions', '[]'::jsonb); st := et->'state';"],
  'the pass ignores the round cap': ["if v_round >= balance_num('dungeon', 'round_cap')::int then   -- balance dungeon.round_cap (as dungeon_attack)", 'if false then'],
  'a squad that falls on a pass keeps the run open': ["if st->>'phase' = 'fell' then v_end := dungeon_settle(r.id, 'fell', false); end if;\n  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'pass')", "perform dungeon_log_add(r.id, jsonb_build_object('kind', 'pass')"],
  'the pass ignores p_mode': ["and status = 'active' and mode = v_mode for update;\n  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;\n  st := r.state;\n  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;\n  v_round := (st->>'round')::int;\n  if v_round >=", "and status = 'active' and mode = 'daily' for update;\n  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;\n  st := r.state;\n  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;\n  v_round := (st->>'round')::int;\n  if v_round >="],
};

const P = 'tst_dsp_';
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; ra jsonb; rb jsonb; v_day date; ls bigint; atk bigint[]; sups jsonb; foe jsonb; j int; r dungeon_runs; st jsonb; seqa jsonb; seqb jsonb; fa jsonb; fb jsonb; v_cap int; v_rd int;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  execute $m$${mig}$m$;
  execute $m$${refAttack}$m$;
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  v_day := dungeon_day();
  perform dungeon_generate(v_day);
  update dungeon_days set rule = '{}'::jsonb where day = v_day;
  select min(c.id) into ls from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal';
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id <> ls order by c.id limit 9) z;
  select jsonb_object_agg(e2, id) into sups from (select s.ability->>'effect' e2, min(c.id) id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by 1) z;
  create function pg_temp.dsp_member(p text) returns void language plpgsql as $f$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity)
      select p, z, 1 from unnest(array[(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal')]
        || (select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 10) w)
        || array(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by s.ability->>'effect')) z
      on conflict do nothing;
  end $f$;
  -- a run: 3 attackers (atk1..3) and 2 supports (heal, smite); a monster with huge HP, strike and slam, every card at 10 million HP
  create function pg_temp.dsp_run(p text, p_mode text, p_sup_cd int, p_stun int) returns jsonb language plpgsql as $f$
  declare a jsonb; k text;
  begin
    perform pg_temp.dsp_member(p);
    a := case when p_mode = 'gauntlet' then gauntlet_start(p) else dungeon_start(p, array[(select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id
        where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 3) w)[1], (select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id
        where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 3) w)[2], (select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id
        where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 3) w)[3], (select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'effect' = 'heal' and s.type not in ('Character', 'Creature')),
        (select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'effect' = 'smite' and s.type not in ('Character', 'Creature'))]) end;
    if not coalesce((a->>'ok')::boolean, false) then raise exception 'start %: %', p, a; end if;
    update dungeon_runs set state = jsonb_set(jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || '{"hp": 2000000000, "max": 2000000000, "atk": 50, "enr": 0, "enru": 0, "wk": 0, "wku": 0, "ex": 0, "exu": 0, "st": 0, "sh": 0, "passives": [], "charge": false, "moves": [{"w": 1, "kind": "strike", "name": "Hit"}, {"w": 1, "kind": "slam", "name": "Stomp"}]}'::jsonb)),
        '{cards}', (select jsonb_object_agg(key, case when coalesce((value->>'sup')::boolean, false) then value || jsonb_build_object('hp', 10000000, 'max', 10000000, 'cd', p_sup_cd)
                                                      else value || jsonb_build_object('hp', 10000000, 'max', 10000000, 'cd', p_stun) end) from jsonb_each(state->'cards')))
      where player_id = p and mode = coalesce(p_mode, 'daily') and day = dungeon_day();
    return a;
  end $f$;
  create function pg_temp.dsp_cards(p text, p_mode text) returns bigint[] language sql as $f$
    select array_agg(key::bigint order by key::bigint) from dungeon_runs, jsonb_each(state->'cards') where player_id = p and mode = p_mode and day = dungeon_day() and not coalesce((value->>'sup')::boolean, false) $f$;

  -- S1 one attacker stunned (cd = round + 1 = 1), another ready: the stunned one is refused
  ra := pg_temp.dsp_run('${P}1', 'daily', 0, 0);
  update dungeon_runs set state = jsonb_set(state, ('{cards,' || (pg_temp.dsp_cards('${P}1', 'daily'))[1] || ',cd}')::text[], '1') where player_id = '${P}1' and day = v_day;
  rb := dungeon_attack('${P}1', (pg_temp.dsp_cards('${P}1', 'daily'))[1], 0, 'daily');
  res := res || jsonb_build_object('case', 'S1 a stunned card is refused while another attacker is ready', 'ok', not (rb->>'ok')::boolean and rb->>'error' = 'stunned', 'answer', rb->'error');

  -- S2 EVERY attacker stunned: the stunned card is refused too (the bug: it attacked)
  update dungeon_runs set state = (select jsonb_set(state, '{cards}', (select jsonb_object_agg(key, case when coalesce((value->>'sup')::boolean, false) then value else value || '{"cd": 1}' end) from jsonb_each(state->'cards'))))
   where player_id = '${P}1' and day = v_day;
  rb := dungeon_attack('${P}1', (pg_temp.dsp_cards('${P}1', 'daily'))[1], 0, 'daily');
  res := res || jsonb_build_object('case', 'S2 every attacker stunned: a stunned card is still refused (stunned)', 'ok', not (rb->>'ok')::boolean and rb->>'error' = 'stunned', 'answer', coalesce(rb->'error', to_jsonb(rb->>'damage')));

  -- S4 can_act: attackers stunned but a support is ready and unused -> refused (why support); forced -> played; a support used this round -> played
  rb := dungeon_pass_turn('${P}1', 'daily');
  res := res || jsonb_build_object('case', 'S4a no attacker can act but a support is ready: the pass is refused (can_act, support)', 'ok', not (rb->>'ok')::boolean and rb->>'error' = 'can_act' and rb->>'why' = 'support', 'answer', rb);
  update dungeon_runs set state = jsonb_set(state, '{sup_round}', '0') where player_id = '${P}1' and day = v_day;
  ra := dungeon_pass_turn('${P}1', 'daily');
  res := res || jsonb_build_object('case', 'S4b every attacker stunned and the one support turn of this round used: the pass is played', 'ok', (ra->>'ok')::boolean and (ra->>'round')::int = 1, 'round', ra->'round');
  -- S3 the pass: the round advanced, the monsters acted, the stun is over, the card attacks again
  res := res || jsonb_build_object('case', 'S3a the pass runs the monsters turn: actions listed, round 1, no_action true, no attack turn counted', 'ok',
    (ra->>'no_action')::boolean and jsonb_array_length(ra->'enemy') >= 1 and (select turns from dungeon_runs where player_id = '${P}1' and day = v_day) = 0, 'enemy', jsonb_array_length(ra->'enemy'));
  rb := dungeon_attack('${P}1', (pg_temp.dsp_cards('${P}1', 'daily'))[1], 0, 'daily');
  res := res || jsonb_build_object('case', 'S3b the next round the stun is over: the card attacks', 'ok', (rb->>'ok')::boolean, 'answer', rb->'error');
  -- S4c can_act attacker: a ready attacker blocks the pass
  rb := dungeon_pass_turn('${P}1', 'daily', true);
  res := res || jsonb_build_object('case', 'S4c an attacker that is not stunned blocks the pass, forced or not', 'ok', not (rb->>'ok')::boolean and rb->>'error' = 'can_act' and rb->>'why' = 'attacker');
  -- S4d force skips only the support check: stun all again, support ready and unused
  update dungeon_runs set state = (select jsonb_set(jsonb_set(state, '{cards}', (select jsonb_object_agg(key, case when coalesce((value->>'sup')::boolean, false) then value || '{"cd": 0}' else value || jsonb_build_object('cd', (state->>'round')::int + 1) end) from jsonb_each(state->'cards'))), '{sup_round}', '-1'))
   where player_id = '${P}1' and day = v_day;
  rb := dungeon_pass_turn('${P}1', 'daily', true);
  res := res || jsonb_build_object('case', 'S4d forced (Auto): every attacker stunned and a support ready: the pass is played', 'ok', (rb->>'ok')::boolean, 'answer', rb->'error');

  -- S5 a normal attack is the same as the live text: same seed, same answer, same state (two identical members)
  perform pg_temp.dsp_run('${P}5a', 'daily', 0, 0); perform pg_temp.dsp_run('${P}5b', 'daily', 0, 0);
  seqa := '[]'; seqb := '[]';
  perform setseed(0.42);
  for j in 1..4 loop
    seqa := seqa || jsonb_build_array(ref_dungeon_attack('${P}5a', (pg_temp.dsp_cards('${P}5a', 'daily'))[1 + (j % 3)], 0, 'daily') - 'state');
  end loop;
  perform setseed(0.42);
  for j in 1..4 loop
    seqb := seqb || jsonb_build_array(dungeon_attack('${P}5b', (pg_temp.dsp_cards('${P}5b', 'daily'))[1 + (j % 3)], 0, 'daily') - 'state');
  end loop;
  select state into fa from dungeon_runs where player_id = '${P}5a' and day = v_day; select state into fb from dungeon_runs where player_id = '${P}5b' and day = v_day;
  res := res || jsonb_build_object('case', 'S5 4 normal attacks: the new dungeon_attack = the live text (same answers, same final state, same seed)', 'ok', seqa = seqb and fa = fb and jsonb_array_length(seqa) = 4 and (seqa->0->>'ok')::boolean, 'a', left(seqa::text, 160), 'b', left(seqb::text, 160));

  -- S6 the round cap refuses the pass
  perform pg_temp.dsp_run('${P}6', 'daily', 5, 100);
  v_cap := balance_num('dungeon', 'round_cap')::int;
  update dungeon_runs set state = jsonb_set(state, '{round}', to_jsonb(v_cap)) where player_id = '${P}6' and day = v_day;
  rb := dungeon_pass_turn('${P}6', 'daily', true);
  res := res || jsonb_build_object('case', 'S6 the round cap refuses the pass (round_cap)', 'ok', not (rb->>'ok')::boolean and rb->>'error' = 'round_cap', 'answer', rb);

  -- S7 the Gauntlet through p_mode (the daily mode finds no run); not_fighting / no_run / disabled shapes
  ra := pg_temp.dsp_run('${P}7', 'gauntlet', 5, 100);
  rb := dungeon_pass_turn('${P}7', 'gauntlet', true);
  res := res || jsonb_build_object('case', 'S7 a Gauntlet run passes through p_mode; the daily mode finds no run for the member; no run at all: no_run', 'ok',
    (rb->>'ok')::boolean and rb->'state'->>'mode' = 'gauntlet' and dungeon_pass_turn('${P}7', 'daily', true)->>'error' = 'no_run' and dungeon_pass_turn('${P}nobody', 'daily')->>'error' = 'no_run', 'mode', rb->'state'->>'mode');

  -- S8 the squad falls on the pass: every attacker stunned at 1 HP, a heavy monster
  perform pg_temp.dsp_run('${P}8', 'daily', 5, 100);
  update dungeon_runs set state = jsonb_set(jsonb_set(state, '{foes}', jsonb_build_array((state->'foes'->0) || '{"atk": 100000, "moves": [{"w": 1, "kind": "slam", "name": "Stomp"}]}')),
      '{cards}', (select jsonb_object_agg(key, case when coalesce((value->>'sup')::boolean, false) then value else value || '{"hp": 1, "max": 100}' end) from jsonb_each(state->'cards')))
    where player_id = '${P}8' and day = v_day;
  rb := dungeon_pass_turn('${P}8', 'daily', true);
  res := res || jsonb_build_object('case', 'S8 a squad that falls during the pass ends the run (status not active, the run is settled)', 'ok', (rb->>'ok')::boolean and rb->>'status' <> 'active' and rb->'state'->>'phase' in ('fell', 'over'), 'status', rb->>'status', 'phase', rb->'state'->>'phase');

  -- S9 not a fight: a run in a reward step refuses the pass
  perform pg_temp.dsp_run('${P}9', 'daily', 5, 100);
  update dungeon_runs set state = jsonb_set(state, '{phase}', '"choose"') where player_id = '${P}9' and day = v_day;
  rb := dungeon_pass_turn('${P}9', 'daily', true);
  res := res || jsonb_build_object('case', 'S9 a step that is not a fight refuses the pass (not_fighting)', 'ok', rb->>'error' = 'not_fighting');

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
  const old = process.argv.includes('--old');
  const { results, raw } = await runOnce(old ? src.replace(NEW_CLAUSE, OLD_CLAUSE) : src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 700)}`); }
  console.log(`${old ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
