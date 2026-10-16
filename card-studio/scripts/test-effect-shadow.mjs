/**
 * The SHADOW test of the effect engine (F-3 PR 4b, docs/f3-effect-engine.md section 3 row "4b"). NO lasting change: every request is one DO block
 * that ends with a RAISE (everything is rolled back).
 *
 * For each generated case (every kind x Hunt / Dungeon / Gauntlet x the target cases x the counter passives x the counter marks x the stat points x
 * matched / not matched x the affinity counts x several seeds):
 *   1. set up the case (a boss or a run, the card rows, the marks, the points), in a sub-block;
 *   2. OLD: setseed(s), the live function (hunt_support / hunt_attack / dungeon_support / dungeon_attack), keep the answer + the state + the log; undo;
 *   3. NEW: setseed(s), the same function where the effect branches are replaced by the engine: build the fight state (hunt_fight_state /
 *      dungeon_fight_state), combat_effect, the apply function (hunt_effect_apply / dungeon_effect_apply), and for an attack combat_crit_chance_mods +
 *      combat_hit_core; keep the same three things; undo;
 *   4. compare the two as TEXT. Every case must be equal.
 * The Dungeon and the Gauntlet (PR 4c, f3_engine_dungeon.sql) and the Hunt (PR 4d, f3_engine_hunt.sql): the NEW function is the public function after
 * the 4c and 4d files ran in the request (the switch); the OLD function is the text before the switch (test-effect-shadow.base.sql, as pg_temp.o_<name>:
 * the Dungeon before 4c; the Hunt, combat_hit, combat_crit_chance and hunt_card_crits before 4d; the old functions call each other in pg_temp). So
 * BASE = the live text before the switch and CANDIDATE = the files, before and after the files are applied.
 * The migration texts (the 4b file, the 4c file, then the 4d file) are executed in each request (so the test passes before and after they are applied).
 * A mutation changes the last of the texts that has its anchor (the function that the request installs at the end).
 *
 * LOCAL copy only:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-effect-shadow.mjs            must PASS (prints the case count)
 *   MUTATE=<name> ...                                                                             must FAIL (a planted engine change)
 *   MUTATE=all ...                                                                                the baseline, then every mutation (one line each)
 *   MIG=<file.sql>  another 4b text. MIG2=<file.sql> another 4c text (MIG2= with no file: no 4c text, the Dungeon compares the old text with the live
 *   one). MIG3=<file.sql> another 4d text (MIG3= with no file: no 4d text, the Hunt compares the old text with the live one).
 *   SHADOW_BATCH=<n> cases in one request (default 600; each request stays under 55 s).
 * Each request takes the shared lock when LAB_LOCK_OWNER is set (lab-lib.mjs).
 */
import { runBlock, rawQuery, assertLocal } from './lab-lib.mjs';
import { installHelpers, PLAN } from './lab-sql.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
assertLocal('test-effect-shadow.mjs');

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
let mig = readFileSync(process.env.MIG || here('../../tcg-bot/supabase/f3_effect_engine.sql'), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');

// Planted engine changes: [an anchor in the file, the text to find after it, the text that replaces it]. Each one must make the test FAIL.
const MUT = {
  heal_plus_1: ["    if v_prim = 'heal' then", 'v_val := greatest(1, v_val);', 'v_val := greatest(1, v_val) + 1;'],
  scale_on_empower: ["elsif v_prim = 'buff' and v_step->>'stat' = 'attack' then", "v_val := public.combat_effect_value(v_step->'value', v_env);", "v_val := public.combat_effect_value(v_step->'value', v_env) * v_scale;"],
  stun_plus_1: ['      if not v_fail then', "v_until := v_round + public.combat_effect_value(v_step->'rounds', v_env)::int;", "v_until := v_round + public.combat_effect_value(v_step->'rounds', v_env)::int + 1;"],
  cleanse_keeps_poison: ['-- the Dungeon and the Gauntlet (1.4 item 5)', `'{"psn": 0, "psnu": -1}'::jsonb`, "'{}'::jsonb"],
  matched_skipped: ["elsif r = 'matched_x' then", "continue when not coalesce((p_env->>'matched')::boolean, false);", 'continue;'],
  // 4c (f3_engine_dungeon.sql): the fast paths
  lifesteal_skipped: ['  -- on_hit (lifesteal as data)', "coalesce(v_facts->(p_card::text)->'hit_on' ? 'on_hit', true)", 'false'],
  empower_kept: ["  if p_on = 'after_attack' then", `v_cset := coalesce(v_cset, '{}'::jsonb) || '{"buff": 1}'::jsonb;`, 'null;'],
  target_tags_lost: ['create or replace function public.dungeon_fight_state_info', "then v_facts->v_t->'tags'", "then '[]'::jsonb"],
  target_owner_skipped: ['create or replace function public.dungeon_fight_state_info', 'and pc.quantity > 0) end)', 'or true) end)'],
  hit_on_wrong: ['create or replace function public.dungeon_fight_state_info', "st2->>'on' in ('before_hit', 'on_hit', 'after_attack')", "st2->>'on' in ('on_hit', 'after_attack')"],
  // 4d (f3_engine_hunt.sql): the Hunt fight state, the apply, the hit
  hunt_stunned_free: ['CREATE OR REPLACE FUNCTION public.hunt_attack(', "v_free := jsonb_array_length(v_fight->'squad') < v_cap;", "v_free := jsonb_array_length(v_fight->'squad') <= v_cap;"],
  hunt_stunned_down_mate: ['CREATE OR REPLACE FUNCTION public.hunt_attack(', "and not (v_fight->'cards'->v_x->>'down')::boolean", ''],
  hunt_target_tags_lost: ['create or replace function public.hunt_fight_state_info', "'match_tags', v_facts->v_ts->'tags'", "'match_tags', '[]'::jsonb"],
  hunt_target_owner_skipped: ['create or replace function public.hunt_fight_state_info', "'ok', coalesce((select pc.quantity >= 1 from public.player_cards pc where pc.player_id = p_player and pc.card_id = p_target), false)", "'ok', true"],
  hunt_commit_over_cap: ['create or replace function public.hunt_fight_state_info', 'and v_n < public.hunt_card_cap()', 'and v_n <= public.hunt_card_cap()'],
  hunt_squad_facts_lost: ['create or replace function public.hunt_fight_state_info', "(select jsonb_build_object('tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type)\n", "(select jsonb_build_object('tags', '[]'::jsonb, 'subject', s.key, 'type', s.type)\n"],
  hunt_hit_on_wrong: ['CREATE OR REPLACE FUNCTION public.hunt_attack(', "st2->>'on' in ('before_hit', 'on_hit', 'after_attack')", "st2->>'on' in ('before_hit', 'after_attack')"],
  hunt_dhp_sign: ['create or replace function public.hunt_effect_apply', 'hp_remaining = greatest(0, hp_remaining + v_d)', 'hp_remaining = greatest(0, hp_remaining - v_d)'],
  hunt_undying_dead: ['create or replace function public.hunt_effect_apply', 'least(hp_max, hp_remaining + v_d)', 'least(hp_max, hp_remaining)'],
  hunt_lifesteal_skipped: ['CREATE OR REPLACE FUNCTION public.hunt_attack(', "if v_dmg > 0 and v_hiton ? 'on_hit' then", 'if false then'],
  hunt_crit_kinds_lost: ['CREATE OR REPLACE FUNCTION public.hunt_card_crits(', 'case when v_sq or d.aeff = any(v_ck)', 'case when v_sq'],
  hunt_noab_hit_changed: ['CREATE OR REPLACE FUNCTION public.hunt_attack(', 'v_hit := combat_hit_core(v_cp,', 'v_hit := combat_hit_core(v_cp + case when v_ability is null then 1 else 0 end,'],
  hunt_others_tags_lost: ['CREATE OR REPLACE FUNCTION public.hunt_attack(', "v_others := v_others || jsonb_build_array(v_facts->v_x->'tags');", "v_others := v_others || '[[]]'::jsonb;"],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  const run = (env) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, ...env, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const last = (r) => ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).filter((l) => /^(PASS|FAIL|ERROR)/.test(l)).pop() || ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).pop() || '';
  const b = run({ MUTATE: '' });
  console.log(`baseline                 ${b.status === 0 ? 'PASS' : 'FAIL (the baseline is red: the mutation results are not valid)'}  ${last(b).slice(0, 160)}`);
  if (b.status !== 0) { ok = false; }
  for (const name of Object.keys(MUT)) {
    const r = run({ MUTATE: name });
    const caught = r.status !== 0;
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${last(r).slice(0, 160)}`);
  }
  console.log(ok ? 'mutations: baseline PASS, all caught' : 'mutations: FAIL');
  process.exit(ok ? 0 : 1);
}
// The 4c file (f3_engine_dungeon.sql; MIG2=<file.sql> for another text) runs after the 4b file in each request: it replaces engine functions of 4b and
// switches the Dungeon. A mutation changes the LAST of the two texts that has its anchor (the engine function that is installed at the end).
let mig2 = process.env.MIG2 === '' ? '' : readFileSync(process.env.MIG2 || here('../../tcg-bot/supabase/f3_engine_dungeon.sql'), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
// The 4d file (f3_engine_hunt.sql; MIG3=<file.sql> for another text, MIG3= for none) runs after the 4c file: it switches the Hunt.
let mig3 = process.env.MIG3 === '' ? '' : readFileSync(process.env.MIG3 || here('../../tcg-bot/supabase/f3_engine_hunt.sql'), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  const at = (t) => { const s = t.indexOf(m[0]); const i = s >= 0 ? t.indexOf(m[1], s) : -1; return i; };
  const put = (t, i) => t.slice(0, i) + m[2] + t.slice(i + m[1].length);
  if (mig3 && at(mig3) >= 0) mig3 = put(mig3, at(mig3));
  else if (mig2 && at(mig2) >= 0) mig2 = put(mig2, at(mig2));
  else if (at(mig) >= 0) mig = put(mig, at(mig));
  else throw new Error(`the mutation ${process.env.MUTATE} does not match the migrations`);
}
for (const d of ['$m$', '$v$', '$t$', '$g$x']) if (mig.includes(d) || mig2.includes(d) || mig3.includes(d)) throw new Error(`the migrations must not contain ${d}`);

const replaceOnce = (text, from, to, what) => {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`variant ${what}: the text to replace is ${i < 0 ? 'not found' : 'found twice'}: ${from.slice(0, 80)}`);
  return text.slice(0, i) + to + text.slice(i + from.length);
};
// OLD_BASE: the functions before the switch (test-effect-shadow.base.sql) as pg_temp.o_<name>: the Dungeon before 4c, the Hunt, combat_hit,
// combat_crit_chance and hunt_card_crits before 4d. The 4c and 4d files replace the public functions that the old texts call (combat_hit_elem,
// combat_hit, combat_crit_chance), so those calls go to the old texts in pg_temp too.
const OLD_BASE = (() => {
  const t = readFileSync(here('test-effect-shadow.base.sql'), 'utf8').replace(/\r/g, '');
  const out = [];
  const CALLS = {
    combat_hit_elem: [['public.combat_hit(', 'pg_temp.o_combat_hit(']],
    dungeon_attack: [['hit := combat_hit_elem(', 'hit := pg_temp.o_combat_hit_elem('], ['v_crit := combat_crit_chance(', 'v_crit := pg_temp.o_combat_crit_chance(']],
    hunt_attack: [['v_critchance := combat_crit_chance(', 'v_critchance := pg_temp.o_combat_crit_chance('], ['v_hit := combat_hit(', 'v_hit := pg_temp.o_combat_hit(']],
    hunt_card_crits: [['combat_crit_chance(d.bonus', 'pg_temp.o_combat_crit_chance(d.bonus']],
  };
  for (const m of t.matchAll(/^-- @function (\w+) md5 [0-9a-f]{32}\n(CREATE OR REPLACE FUNCTION public\.\w+\([\s\S]*?\$function\$;)/gm)) {
    let f = replaceOnce(m[2], `CREATE OR REPLACE FUNCTION public.${m[1]}(`, `CREATE FUNCTION pg_temp.o_${m[1]}(`, `o_${m[1]}`);
    for (const [from, to] of CALLS[m[1]] || []) f = replaceOnce(f, from, to, `o_${m[1]}`);
    if (f.includes('$v$')) throw new Error(`o_${m[1]}: contains $v$`);
    out.push(f);
  }
  if (out.length !== 8) throw new Error(`test-effect-shadow.base.sql: 8 functions expected, ${out.length} found`);
  return out;
})();

// ------------------------------------------------------------------------------------------------ the SQL of one case
const CASE_SQL = String.raw`
create function pg_temp.sh_hunt_setup(c jsonb, p text) returns bigint language plpgsql as $g$
declare h bigint; d date := (now() at time zone 'America/Denver')::date; x jsonb; v_max int; v_id bigint; v_tier text := coalesce(c->>'tier', 'Heroic');
begin
  update player_cards set stat_points = coalesce(c->'pts', '{}'::jsonb), ascension = coalesce((c->>'asc')::int, 0) where player_id = p and card_id = (c->>'card')::bigint;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, hp_share, opens_at, closes_at, status, passive, stats)
    values ('Shadow Boss', v_tier, coalesce(c->'weak', '[]'::jsonb), coalesce(c->'resist', '[]'::jsonb), (c->>'hpmax')::bigint, (c->>'hp')::bigint, (c->>'hpmax')::bigint,
      now() - interval '1 hour', now() + interval '1 day', 'active',
      jsonb_build_object('kind', c->'passive'->>0, 'list', coalesce((select jsonb_agg(jsonb_build_object('kind', k)) from jsonb_array_elements_text(c->'passive') k), '[]'::jsonb)),
      jsonb_build_object('atk', balance_num('boss_atk', v_tier)))
    returning id into h;
  if jsonb_typeof(c->'locked') = 'array' then
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids, locked_at) values (h, p, d, array(select (jsonb_array_elements_text(c->'locked'))::bigint), now());
  end if;
  insert into hunt_combat_state (hunt_id, player_id, hit_date, round, marks, stunned_until, boss_weaken, weaken_until, boss_expose, expose_until)
    values (h, p, d, coalesce((c->>'round')::int, 0), coalesce(c->'marks', '{}'::jsonb), coalesce((c->>'st')::int, 0), coalesce((c->>'wk')::numeric, 0),
            coalesce((c->>'wku')::int, 0), coalesce((c->>'ex')::numeric, 0), coalesce((c->>'exu')::int, 0));
  for x in select jsonb_array_elements(coalesce(c->'rows', '[]'::jsonb)) loop
    v_id := (x->>0)::bigint;
    select case when s.ability->>'kind' = 'support' then card_max_hp(0) else (card_combat(cc.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'hp')::int end into v_max
      from cards cc join subjects s on s.id = cc.subject_id join player_cards pc on pc.card_id = cc.id and pc.player_id = p where cc.id = v_id;
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, shield, dmg_buff, dmg_debuff, cd_until_round)
      values (h, p, v_id, d, case when (x->>2)::boolean then 0 else greatest(1, round(v_max * (x->>1)::numeric))::int end, v_max, (x->>2)::boolean,
              (x->>3)::int, (x->>4)::numeric, (x->>5)::numeric, (x->>6)::int);
  end loop;
  delete from player_cards where player_id = p and card_id in (select (jsonb_array_elements_text(coalesce(c->'unowned', '[]'::jsonb)))::bigint);
  return h;
end $g$;

create function pg_temp.sh_dungeon_setup(c jsonb, p text, foes jsonb) returns bigint language plpgsql as $g$
declare v_cards jsonb := '{}'; x bigint; v_max int; v_sup boolean; cc jsonb; ci jsonb; v_foes jsonb := '[]'; f jsonb; b jsonb; st jsonb; v_id bigint;
  v_mode text := case when c->>'m' = 'gauntlet' then 'gauntlet' else 'daily' end;
begin
  update player_cards set stat_points = coalesce(c->'pts', '{}'::jsonb), ascension = coalesce((c->>'asc')::int, 0) where player_id = p and card_id = (c->>'card')::bigint;
  foreach x in array array(select (jsonb_array_elements_text(c->'squad'))::bigint) loop
    ci := case when v_mode = 'gauntlet' then dungeon_card_base(x) else dungeon_card(p, x) end;
    v_sup := ci->>'type' not in ('Character', 'Creature');
    v_max := case when v_sup then card_max_hp(0) else (ci->'cmb'->>'hp')::int end;
    cc := coalesce(c->'cards'->(x::text), '{}'::jsonb);
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object(
      'hp', case when coalesce((cc->>'down')::boolean, false) then 0 else greatest(1, round(v_max * coalesce((cc->>'hpf')::numeric, 1)))::int end,
      'max', v_max, 'down', coalesce((cc->>'down')::boolean, false), 'shield', coalesce((cc->>'shield')::int, 0),
      'buff', coalesce((cc->>'buff')::numeric, 1), 'debuff', coalesce((cc->>'debuff')::numeric, 1), 'cd', coalesce((cc->>'cd')::int, 0), 'sup', v_sup,
      'psn', coalesce((cc->>'psn')::int, 0), 'psnu', coalesce((cc->>'psnu')::int, -1)));
  end loop;
  for f in select jsonb_array_elements(coalesce(c->'foes', '[{"base": 0}, {"base": 1}]'::jsonb)) loop
    b := foes->((f->>'base')::int);
    v_foes := v_foes || jsonb_build_array(b || '{"enr": 0, "enru": 0, "wk": 0, "wku": 0, "ex": 0, "exu": 0, "st": 0, "sh": 0}'::jsonb || (f - 'base' - 'hpf')
      || case when f ? 'hpf' then jsonb_build_object('hp', greatest(0, round((b->>'max')::int * (f->>'hpf')::numeric))::int) else '{}'::jsonb end);
  end loop;
  st := jsonb_build_object('phase', 'fight', 'room_type', 'fight', 'round', coalesce((c->>'round')::int, 1), 'sup_round', -1, 'buff', 1, 'cards', v_cards, 'foes', v_foes,
          'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb), 'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb))
     || case when v_mode = 'gauntlet' then '{"mode": "gauntlet"}'::jsonb else '{}'::jsonb end;
  insert into dungeon_runs (player_id, day, squad, state, mode) values (p, dungeon_day(), array(select (jsonb_array_elements_text(c->'squad'))::bigint), st, v_mode) returning id into v_id;
  delete from player_cards where player_id = p and card_id in (select (jsonb_array_elements_text(coalesce(c->'unowned', '[]'::jsonb)))::bigint);
  return v_id;
end $g$;

create function pg_temp.sh_call(c jsonb, p text, ref bigint, eng boolean) returns jsonb language plpgsql as $g$
declare v_card bigint := (c->>'card')::bigint; v_tgt bigint := (c->>'target')::bigint; v_foe int := (c->>'target_foe')::int;
  v_mode text := case when c->>'m' = 'gauntlet' then 'gauntlet' else 'daily' end;
begin
  if c->>'m' = 'hunt' then
    if c->>'fn' = 'support' then return case when eng then hunt_support(p, ref, v_card, v_tgt) else pg_temp.o_hunt_support(p, ref, v_card, v_tgt) end; end if;
    return case when eng then hunt_attack(p, ref, v_card) else pg_temp.o_hunt_attack(p, ref, v_card) end;
  end if;
  if c->>'fn' = 'support' then return case when eng then dungeon_support(p, v_card, v_tgt, v_foe, v_mode) else pg_temp.o_dungeon_support(p, v_card, v_tgt, v_foe, v_mode) end; end if;
  return case when eng then dungeon_attack(p, v_card, v_foe, v_mode) else pg_temp.o_dungeon_attack(p, v_card, v_foe, v_mode) end;
end $g$;

-- What a call changed: the answer, the rows of the fight, the log rows (no id, no sequence value).
create function pg_temp.sh_capture(c jsonb, p text, ref bigint, r jsonb) returns text language plpgsql as $g$
begin
  if c->>'m' = 'hunt' then
    return 'R ' || coalesce(r::text, 'NULL')
      || E'\nH ' || coalesce((select (to_jsonb(h) - 'id' - 'event_id')::text from hunts h where h.id = ref), '-')
      || E'\nC ' || coalesce((select jsonb_agg(to_jsonb(x) - 'hunt_id' order by x.card_id)::text from hunt_card_hp x where x.hunt_id = ref), '-')
      || E'\nS ' || coalesce((select jsonb_agg(to_jsonb(x) - 'hunt_id')::text from hunt_combat_state x where x.hunt_id = ref), '-')
      || E'\nHH ' || coalesce((select jsonb_agg(to_jsonb(x) - 'id' - 'hunt_id' order by x.player_id, x.card_id)::text from hunt_hits x where x.hunt_id = ref), '-')
      || E'\nA ' || coalesce((select jsonb_agg(to_jsonb(x) - 'id' - 'ref_id' order by x.id)::text from combat_actions x where x.mode = 'hunt' and x.ref_id = ref), '-')
      || E'\nL ' || coalesce((select jsonb_agg(to_jsonb(x) - 'id' - 'hunt_id' order by x.id)::text from hunt_combat_log x where x.hunt_id = ref), '-')
      || E'\nE ' || coalesce((select jsonb_agg(to_jsonb(x) - 'id' - 'hunt_id' order by x.id)::text from hunt_events x where x.hunt_id = ref), '-');
  end if;
  return 'R ' || coalesce(r::text, 'NULL')
    || E'\nRUN ' || coalesce((select (to_jsonb(x) - 'id')::text from dungeon_runs x where x.id = ref), '-')
    || E'\nA ' || coalesce((select jsonb_agg(to_jsonb(x) - 'id' - 'ref_id' order by x.id)::text from combat_actions x where x.mode in ('dungeon', 'gauntlet') and x.ref_id = ref), '-')
    || E'\nDL ' || coalesce((select jsonb_agg(to_jsonb(x) - 'run_id' order by x.n)::text from dungeon_log x where x.run_id = ref), '-')
    || E'\nDP ' || coalesce((select jsonb_agg(to_jsonb(x) order by x.mode, x.period)::text from dungeon_payouts x where x.winners::text like '%' || p || '%'), '-');
end $g$;

-- One case: the OLD call and the NEW call, each in an undone sub-block after the same setup and the same setseed.
create function pg_temp.sh_case(c jsonb, p text, foes jsonb) returns text[] language plpgsql as $g$
declare v_old text; v_new text; v_ref bigint; r jsonb; v_seed float8 := (c->>'seed')::float8;
begin
  begin
    v_ref := case when c->>'m' = 'hunt' then pg_temp.sh_hunt_setup(c, p) else pg_temp.sh_dungeon_setup(c, p, foes) end;
    begin
      perform setseed(v_seed);
      r := pg_temp.sh_call(c, p, v_ref, false);
      v_old := pg_temp.sh_capture(c, p, v_ref, r);
      raise exception using errcode = 'U0001', message = 'undo';
    exception when sqlstate 'U0001' then null;
      when others then v_old := 'SQLERR ' || sqlerrm;
    end;
    begin
      perform setseed(v_seed);
      r := pg_temp.sh_call(c, p, v_ref, true);
      v_new := pg_temp.sh_capture(c, p, v_ref, r);
      raise exception using errcode = 'U0001', message = 'undo';
    exception when sqlstate 'U0001' then null;
      when others then v_new := 'SQLERR ' || sqlerrm;
    end;
    raise exception using errcode = 'U0001', message = 'undo';
  exception when sqlstate 'U0001' then null;
    when others then v_old := 'SETUP ' || sqlerrm; v_new := v_old;
  end;
  return array[v_old, v_new];
end $g$;`;

// ------------------------------------------------------------------------------------------------ the cases
const SUP = { heal: 82, shield: 79, empower: 64, weaken: 91, expose: 92, stun: 254, smite: 97, cleanse: 96 };
const ATK = { execute: 24, focus: 29, lifesteal: 44, pierce: 34, rampage: 49 };
const ALLY = new Set(['heal', 'shield', 'empower']);
const facts = JSON.parse(JSON.parse(await rawQuery(`select jsonb_build_object('cap', hunt_card_cap(),
  'cards', (select jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'kind', s.ability->>'kind', 'aff', s.ability->>'affinity') order by c.id)
            from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal'))::text as r`))[0].r);
const CARDS = facts.cards; const CAP = facts.cap;
const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const isAtk = (c) => c.type === 'Character' || c.type === 'Creature';
const SEEDS = [0.11, -0.42];
const SEEDS_RANDOM = [0.11, -0.42, 0.77, 0.3, -0.9];   // the random() cases: the Juggernaut stun fail, the attacks
const POINTS = [[{}, 0], [{ potency: 3 }, 2], [{ potency: 2, haste: 4, precision: 1 }, 3]];
const ROUND = 3;
const cases = [];
const add = (c, tag) => { for (const seed of c.seeds || SEEDS) cases.push({ ...c, seeds: undefined, seed, tag }); };
const pick = (list, n, not = []) => list.filter((x) => !not.includes(x)).slice(0, n);

// The cards of a support: the attackers with and without its affinity tag, the other cards with the tag (for the affinity count).
const supInfo = (kind) => {
  const s = SUP[kind]; const aff = byId[s].aff;
  const has = (c) => c.tags.includes(aff);
  return { s, aff,
    atkWith: CARDS.filter((c) => isAtk(c) && has(c) && c.id !== s).map((c) => c.id),
    atkWithout: CARDS.filter((c) => isAtk(c) && !has(c) && c.id !== s).map((c) => c.id),
    tagged: CARDS.filter((c) => has(c) && c.id !== s && !isAtk(c)).map((c) => c.id).concat(CARDS.filter((c) => has(c) && c.id !== s && isAtk(c)).map((c) => c.id)),
    untagged: CARDS.filter((c) => !has(c) && c.id !== s && !isAtk(c)).map((c) => c.id) };
};
// marks of the Hunt boss for a kind (ck = the kind key): every reaction of 2.6, an expired mark, and a mark with no mult (hunt_counter_mult).
const NO_MULT_HALF = new Set(['heal', 'expose', 'smite', 'shield', 'empower']);
const markSets = (k, target) => {
  const m = [['none', {}], ['null_next_1', { null_next: 1 }], ['null_next_2', { null_next: 2 }],
    ['block', { [`block_${k}`]: { until: 999, mult: 0.1 } }], ['block_nomult', { [`block_${k}`]: { until: 999 } }], ['block_expired', { [`block_${k}`]: { until: ROUND - 1, mult: 0.1 } }],
    ['half', { [`half_${k}`]: { until: 999, mult: 0.5 } }],
    ['undying', { undying: { until: 999 } }], ['spiral_0', { spiral: { until: 999, bonus: 0 } }], ['spiral_04', { spiral: { until: 999, bonus: 0.4 } }],
    ['stun_fail', { stun_fail: true }], ['lock_cleanse', { lock_cleanse: { until: 999 } }], ['rot', { rot: { until: 999 } }], ['mirror', { mirror: true }],
    ['many', { [`half_${k}`]: { until: 999, mult: 0.5 }, undying: { until: 999 }, spiral: { until: 999, bonus: 0.2 }, rot: { until: 999 }, mirror: true, stun_fail: true }]];
  if (k === 'weaken' || k === 'expose') m.find((x) => x[0] === 'block_nomult')[1] = { [`block_${k}`]: { until: 999 } };   // a rule: it blocks (hunt_counter_mult = 0)
  if (!['shield', 'empower', 'weaken', 'expose', 'smite'].includes(k)) m.splice(m.findIndex((x) => x[0] === 'block_nomult'), 1);   // block_<k> is not read for this kind
  if (NO_MULT_HALF.has(k)) m.push(['half_nomult', { [`half_${k}`]: { until: 999 } }]);
  if (target) m.push(['heal_block_0', { heal_block_card: { [target]: { until: 999, mult: 0 } } }], ['heal_block_nomult', { heal_block_card: { [target]: { until: 999 } } }]);
  return m;
};
const PASSIVES = [[], ['plague'], ['shatterer'], ['dispeller'], ['juggernaut'], ['armored', 'plague', 'juggernaut']];

// ---------------- Hunt supports
for (const kind of Object.keys(SUP)) {
  const I = supInfo(kind); const ally = ALLY.has(kind);
  const seeds = kind === 'stun' ? SEEDS_RANDOM : SEEDS;
  // base: the support and 2 attackers committed, one more card with the tag, a hurt matched target
  const base = (o = {}) => {
    const matched = o.matched ?? true; const affN = o.affN ?? 1;
    const target = ally ? ((matched && I.atkWith.length ? I.atkWith : I.atkWithout)[0]) : null;
    const fillAtk = pick(I.atkWithout, 2, [target]);
    const fillTag = pick(I.tagged, affN, [target, ...fillAtk]);
    const debuffRow = kind === 'cleanse';
    const rows = [[I.s, 1, false, 0, '1', '1', 0], ...fillAtk.map((x, i) => [x, 0.8, false, debuffRow ? 12 : 0, debuffRow && i === 0 ? '1.3' : '1.0', debuffRow ? (i === 0 ? '0.7' : '1.0') : '1', 0]),
      ...fillTag.map((x) => [x, 1, false, 0, '1', debuffRow ? '0.55' : '1', 0])];
    const ts = o.ts || 'hurt';
    let t = target;
    if (ally) {
      if (ts === 'hurt') rows.push([t, 0.5, false, 5, '1', '1', 0]);
      else if (ts === 'full') rows.push([t, 1, false, 0, '1', '1', 0]);
      else if (ts === 'downed') rows.push([t, 0, true, 0, '1', '1', 0]);
      else if (ts === 'overcap') for (const x of pick(CARDS.map((c) => c.id), CAP - rows.length, [t, ...rows.map((r) => r[0])])) rows.push([x, 1, false, 0, '1', '1', 0]);
      else if (ts === 'unowned_row') rows.push([t, 0.5, false, 5, '1', '1', 0]);   // 4d: a target with a row that the member does not own
      else if (ts === 'none') t = null;
    } else if (ts === 'ignored') t = I.atkWithout[3];
    // over the cap: no locked squad (a member with no locked squad; the adventure gate allows), 8 rows: hunt_commit_card refuses the target
    const locked = ts === 'overcap' ? null : [...new Set(rows.map((r) => r[0]).concat(t && ts !== 'notsquad' ? [t] : []))];
    return { m: 'hunt', fn: 'support', card: I.s, target: t, round: ROUND, hp: 40000, hpmax: 50000, tier: 'Heroic', passive: o.passive || [], marks: o.marks || {},
      st: o.st ?? 0, wk: '0.2', wku: 1, ex: '0.1', exu: 1, rows, locked, pts: o.pts || {}, asc: o.asc || 0, unowned: ts === 'unowned' || ts === 'unowned_row' ? [t] : [], seeds,
      ...(o.boss || {}) };
  };
  const tstates = ally ? ['hurt', 'full', 'fresh', 'downed', 'overcap', 'notsquad', 'unowned', 'unowned_row', 'none'] : ['none', 'ignored'];
  for (const ts of tstates) add(base({ ts }), `hunt ${kind} target=${ts}`);
  for (const matched of [true, false]) for (const affN of [0, 2, 4]) add(base({ matched, affN }), `hunt ${kind} matched=${matched} aff+${affN}`);
  for (const [pts, asc] of POINTS) add(base({ pts, asc }), `hunt ${kind} pts=${JSON.stringify(pts)}`);
  const target0 = base().target;
  for (const passive of PASSIVES) for (const [mn, marks] of markSets(kind, target0)) add(base({ passive, marks }), `hunt ${kind} passive=${passive.join('+') || '-'} mark=${mn}`);
  if (ally) for (const ts of ['fresh', 'overcap', 'notsquad']) for (const [mn, marks] of markSets(kind, target0)) add(base({ ts, marks, passive: ['plague', 'shatterer', 'dispeller'] }), `hunt ${kind} target=${ts} mark=${mn}`);
  if (kind === 'stun') for (const st of [ROUND - 1, ROUND - 2, ROUND + 1]) for (const passive of [[], ['juggernaut']]) add(base({ st, passive }), `hunt stun st=${st} passive=${passive.join('+') || '-'}`);
  if (kind === 'smite') for (const hp of [50, 200, 201]) for (const [mn, marks] of [['none', {}], ['mirror', { mirror: true }]]) add(base({ boss: { hp }, marks }), `hunt smite boss hp=${hp} mark=${mn}`);
  if (kind === 'smite') add(base({ boss: { hp: 60 }, pts: { potency: 3 }, asc: 2, passive: ['shatterer'] }), 'hunt smite kill with potency and shatterer');
}

// ---------------- Dungeon and Gauntlet supports
for (const m of ['dungeon', 'gauntlet']) for (const kind of Object.keys(SUP)) {
  const I = supInfo(kind); const ally = ALLY.has(kind);
  const base = (o = {}) => {
    const matched = o.matched ?? true; const affN = o.affN ?? 1;
    const target = ally ? ((matched && I.atkWith.length ? I.atkWith : I.atkWithout)[0]) : null;
    const others = pick(I.atkWithout, 4 - affN - (target ? 1 : 0), [target]);
    const tag = pick(I.tagged, affN, [target, ...others]);
    const squad = [I.s, ...(target && o.ts !== 'missing' ? [target] : []), ...others, ...tag].slice(0, 5);
    const cards = {};
    for (const x of squad) cards[x] = kind === 'cleanse' ? { hpf: 0.9, debuff: 0.7, psn: 5, psnu: 4 } : {};
    let t = target;
    if (ally) {
      const ts = o.ts || 'hurt';
      if (ts === 'hurt') cards[t] = { hpf: 0.5, shield: 4 };
      else if (ts === 'downed') cards[t] = { down: true };
      else if (ts === 'none') t = null;
    }
    return { m, fn: 'support', card: I.s, target: t, target_foe: o.foe ?? null, squad, cards, round: ROUND, foes: o.foes, pts: o.pts || {}, asc: o.asc || 0,
      unowned: o.ts === 'unowned' ? [t] : [], seeds: SEEDS };
  };
  const tstates = ally ? ['hurt', 'full', 'downed', 'missing', ...(m === 'dungeon' ? ['unowned'] : []), 'none'] : ['none'];
  for (const ts of tstates) add(base({ ts }), `${m} ${kind} target=${ts}`);
  for (const matched of [true, false]) for (const affN of [0, 2, 3]) add(base({ matched, affN }), `${m} ${kind} matched=${matched} aff+${affN}`);
  for (const [pts, asc] of POINTS) add(base({ pts, asc }), `${m} ${kind} pts=${JSON.stringify(pts)}`);
  if (!ally && kind !== 'cleanse') {
    add(base({ foe: 1 }), `${m} ${kind} target foe 1`);
    add(base({ foe: 0, foes: [{ base: 0, hp: 0 }, { base: 1 }] }), `${m} ${kind} target foe 0 is dead`);
    add(base({ foe: 5 }), `${m} ${kind} target foe out of range`);
    add(base({ foes: [{ base: 0, st: ROUND - 1 }, { base: 1 }] }), `${m} ${kind} foe stunned last round`);
    add(base({ foes: [{ base: 0, st: ROUND - 2, wk: 0.3, wku: ROUND + 2 }, { base: 1 }] }), `${m} ${kind} foe stunned 2 rounds ago, weakened`);
  }
  if (kind === 'smite') {
    add(base({ foes: [{ base: 0, hp: 1 }, { base: 1 }] }), `${m} smite kills foe 0`);
    add(base({ foes: [{ base: 0, hp: 1 }, { base: 1, hp: 0 }] }), `${m} smite kills the last foe`);
  }
}

// ---------------- attacks: Hunt, Dungeon, Gauntlet
for (const kind of Object.keys(ATK)) {
  const a = ATK[kind]; const mates = Object.values(ATK).filter((x) => x !== a);
  const hunt = (o = {}) => ({ m: 'hunt', fn: 'attack', card: a, round: ROUND, hp: o.hp ?? 40000, hpmax: 50000, tier: o.tier || 'Heroic', passive: o.passive || [], marks: o.marks || {},
    st: 0, wk: '0', wku: 0, ex: o.ex ?? '0', exu: o.exu ?? 0, weak: o.weak || [],
    rows: [...(o.norow ? [] : [[a, o.hpf ?? 1, false, 0, o.buff ?? '1', o.debuff ?? '1', 0]]), ...mates.slice(0, 2).map((x) => [x, 1, false, 0, '1', '1', 0])],
    locked: [a, ...mates], pts: o.pts || {}, asc: o.asc || 0, seeds: SEEDS_RANDOM });
  add(hunt(), `hunt attack ${kind}`);
  add(hunt({ hp: 9000 }), `hunt attack ${kind} boss below 25%`);
  add(hunt({ hpf: 0.4 }), `hunt attack ${kind} hurt attacker`);
  add(hunt({ buff: '1.3', debuff: '0.7' }), `hunt attack ${kind} empowered and cursed`);
  add(hunt({ norow: true }), `hunt attack ${kind} first attack (no row)`);
  add(hunt({ ex: '0.3', exu: ROUND + 1, passive: ['armored', 'shrouded'] }), `hunt attack ${kind} exposed, armored, shrouded`);
  add(hunt({ passive: ['thorns', 'regenerating', 'flaming'], weak: [{ kind: 'type', value: 'Creature' }] }), `hunt attack ${kind} thorns, weak to Creature`);
  add(hunt({ pts: { attack: 2, precision: 3 }, asc: 3, hp: 5000 }), `hunt attack ${kind} points, low boss`);
  // 4d: a stunned attacker (cd = the next round) waits while another attacker can act or the squad can still bring a card (the old hunt_attack checks)
  // the two mates: [cd, down] each; fill: the squad is full (supports with no cooldown fill the daily cap)
  const stunRows = (m0, m1, fill) => [[a, 1, false, 0, '1', '1', ROUND + 1], ...mates.slice(0, 2).map((x, i) => [x, 1, (i ? m1 : m0)[1], 0, '1', '1', (i ? m1 : m0)[0]]),
    ...(fill ? CARDS.filter((c) => !isAtk(c) && c.id !== a && !mates.includes(c.id)).slice(0, CAP - 3).map((c) => [c.id, 1, false, 0, '1', '1', 0]) : [])];
  const S = [ROUND + 1, false], R = [0, false], D = [0, true];   // stunned, ready, down (no cooldown)
  for (const [tag, rows] of [['another attacker ready', stunRows(R, R, false)], ['the others stunned, a free slot', stunRows(S, S, false)],
    ['the others stunned, the squad full', stunRows(S, S, true)], ['the only mate with no cooldown is down, the squad full', stunRows(S, D, true)],
    ['a ready mate, the squad full', stunRows(S, R, true)]]) {
    add({ ...hunt(), rows, locked: rows.map((r) => r[0]) }, `hunt attack ${kind} stunned card: ${tag}`);
  }
  for (const m of ['dungeon', 'gauntlet']) {
    const dun = (o = {}) => ({ m, fn: 'attack', card: a, target_foe: o.foe ?? 0, squad: [a, ...mates], round: ROUND, foes: o.foes,
      cards: { [a]: { hpf: o.hpf ?? 1, buff: o.buff ?? 1, debuff: o.debuff ?? 1 } }, pts: o.pts || {}, asc: o.asc || 0, seeds: SEEDS_RANDOM });
    add(dun(), `${m} attack ${kind}`);
    add(dun({ foes: [{ base: 0, hpf: 0.2 }, { base: 1 }] }), `${m} attack ${kind} foe below 25%`);
    add(dun({ hpf: 0.4 }), `${m} attack ${kind} hurt attacker`);
    add(dun({ buff: 1.3, debuff: 0.7 }), `${m} attack ${kind} empowered and cursed`);
    add(dun({ foes: [{ base: 0, sh: 15, ex: 0.3, exu: ROUND + 1 }, { base: 1 }] }), `${m} attack ${kind} guarded, exposed foe`);
    add(dun({ foe: 1, foes: [{ base: 0, hp: 0 }, { base: 1, hp: 2 }] }), `${m} attack ${kind} the last foe nearly dead`);
    add(dun({ pts: { attack: 2, precision: 3 }, asc: 3 }), `${m} attack ${kind} points`);
    add(dun({ foes: [{ base: 2 }, { base: 1 }] }), `${m} attack ${kind} water foe (the element chart)`);
  }
}

// ---------------- an attacker with NO ability (4d, the event cards Launch Day Raider / Player). The old combat_hit evaluates
// "p_aeff = 'rampage' and random() < p_aamt" with a NULL effect, so it draws one random() after each hit that is not a miss; the engine draws none.
// Decision A (Nathan, 2026-10-16, docs/f3-effect-engine.md 9): the new random order is accepted. So for these cases (noab) only THE HIT must be equal
// (the answer keys of the hit, HIT_KEYS below, and the case must answer ok); the boss turn after it may use other random numbers. Every other case must
// stay equal as text. The count of noab cases whose later stream differs is printed (expected above 0).
{
  const NOAB = 378; const mates = Object.values(ATK).slice(0, 2);
  const hunt = (o = {}) => ({ m: 'hunt', fn: 'attack', card: NOAB, round: ROUND, hp: 40000, hpmax: 50000, tier: 'Heroic', passive: o.passive || [], marks: {},
    st: 0, wk: '0', wku: 0, ex: '0', exu: 0, weak: [], rows: [[NOAB, 1, false, 0, '1', '1', 0], ...mates.map((x) => [x, 1, false, 0, '1', '1', 0])],
    locked: [NOAB, ...mates], pts: {}, asc: 0, seeds: SEEDS_RANDOM });
  add({ ...hunt(), noab: true }, 'hunt attack no ability');
  add({ ...hunt({ passive: ['shrouded'] }), noab: true }, 'hunt attack no ability, shrouded');
  add({ ...hunt({ passive: ['armored', 'thorns'] }), weak: [{ kind: 'type', value: 'Character' }], noab: true }, 'hunt attack no ability, armored, weak to Character');
  for (const m of ['dungeon', 'gauntlet']) {
    add({ m, fn: 'attack', card: NOAB, target_foe: 0, squad: [NOAB, ...mates], round: ROUND, cards: {}, pts: {}, asc: 0, seeds: SEEDS_RANDOM, noab: true }, `${m} attack no ability`);
    add({ m, fn: 'attack', card: NOAB, target_foe: 0, squad: [NOAB, ...mates], round: ROUND, foes: [{ base: 2 }, { base: 1 }], cards: {}, pts: {}, asc: 0, seeds: SEEDS_RANDOM, noab: true },
      `${m} attack no ability, water foe`);
  }
}

// ------------------------------------------------------------------------------------------------ run
const ids = [...new Set(cases.flatMap((c) => [c.card, c.target, ...(c.rows || []).map((r) => r[0]), ...(c.squad || []), ...(c.locked || [])]).filter((x) => x != null))];
const BATCH = Number(process.env.SHADOW_BATCH || 600);
// The keys of the hit in the answer of hunt_attack / dungeon_attack (the noab cases compare only these: decision A)
const HIT_KEYS = "array['ok', 'damage', 'outcome', 'crit', 'double', 'bonus', 'resisted', 'cp', 'heal', 'ability', 'guarded', 'target', 'elem', 'elem_mult']";
// What the OLD transcripts must show (PostgreSQL regular expressions): a case set that never meets a reaction proves nothing about it (COVERAGE GAP).
const COVER = ['"gained": [1-9]', '"effect": "stun".*"countered": [[]"juggernaut"]', '"error": "boss_stun_immune"', '"nullified": true', '"mirrored": true', '"defeated": true',
  '"undying"', '"spiral"', '"desync"', '"hotfix"', '"rot"', '"bloodrot"', '"countered": [[]"plague"]', '"shatterer"', '"dispeller"', '"block_', '"half_',
  '"error": "target_downed"', '"error": "need_target"', '"error": "bad_target"', '"matched": true', '"double": true', '"heal": [1-9]', '"kill": true',
  '"target_after": null', '"elem": "', '"error": "stunned"'];
const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const request = (batch) => `${PLAN}
do $t$
declare v_p text := 'tst_shadow'; cs jsonb := ${lit(batch)}; c jsonb; o text[]; v_foes jsonb; nfail int := 0; nerr int := 0; n int := 0; fails jsonb := '[]'; l1 text[]; l2 text[]; j int; h1 jsonb; h2 jsonb; nnoab int := 0; nnoabdiff int := 0;
  k text; v_cov jsonb := '{}';
begin
  ${installHelpers()}
  execute $m$${mig}$m$;
  ${mig2 ? `execute $m$${mig2}$m$;` : ''}
  ${mig3 ? `execute $m$${mig3}$m$;` : ''}
  ${OLD_BASE.map((f) => `execute $v$${f}$v$;`).join('\n  ')}
  ${CASE_SQL}
  perform pg_temp.lab_member(v_p, array[${ids.join(',')}]::bigint[], '{}'::jsonb, false);
  update settings set value = value || '{"enabled": true}'::jsonb where key = 'dungeon';
  v_foes := jsonb_build_array(pg_temp.lab_foe('fight', 1, 1, null, null, null, 'sa'), pg_temp.lab_foe('fight', 2, 1, null, null, null, 'sb'),
    pg_temp.lab_foe('fight', 1, 1, 'water', null, null, 'sc'));   -- a water foe: lightning attackers beat it (the element chart)
  for c in select x from jsonb_array_elements(cs) x loop
    n := n + 1;
    o := pg_temp.sh_case(c, v_p, v_foes);
    foreach k in array array[${COVER.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ')}]::text[] loop
      if o[1] ~ k then v_cov := v_cov || jsonb_build_object(k, coalesce((v_cov->>k)::int, 0) + 1); end if;
    end loop;
    if o[1] like 'SETUP %' or o[1] like 'SQLERR %' or o[2] like 'SQLERR %' then
      nerr := nerr + 1;
      if jsonb_array_length(fails) < 3 then fails := fails || jsonb_build_object('case', c, 'error', case when o[2] like 'SQLERR %' and o[1] not like 'SQLERR %'   -- the NEW side failed: its error first
        then left(o[2], 1500) || ' | OLD ' || left(coalesce(o[1], ''), 500) else left(coalesce(o[1], '') || ' | ' || coalesce(o[2], ''), 1500) end); end if;
    elsif c->>'noab' = 'true' then
      -- decision A: the hit of a card with no ability must be equal; the later random stream may differ
      nnoab := nnoab + 1;
      h1 := substr(split_part(o[1], chr(10), 1), 3)::jsonb; h2 := substr(split_part(o[2], chr(10), 1), 3)::jsonb;
      if not coalesce((h1->>'ok')::boolean, false) or (select jsonb_object_agg(hk, h1->hk) from unnest(${HIT_KEYS}) hk) is distinct from (select jsonb_object_agg(hk, h2->hk) from unnest(${HIT_KEYS}) hk) then
        nfail := nfail + 1;
        if jsonb_array_length(fails) < 3 then fails := fails || jsonb_build_object('case', c, 'line', 1, 'old', left(h1::text, 2500), 'new', left(h2::text, 2500)); end if;
      elsif o[1] is distinct from o[2] then nnoabdiff := nnoabdiff + 1;
      end if;
    elsif o[1] is distinct from o[2] then
      nfail := nfail + 1;
      if jsonb_array_length(fails) < 3 then
        l1 := regexp_split_to_array(o[1], E'\n'); l2 := regexp_split_to_array(o[2], E'\n'); j := 1;
        while j < greatest(array_length(l1, 1), array_length(l2, 1)) and l1[j] is not distinct from l2[j] loop j := j + 1; end loop;
        fails := fails || jsonb_build_object('case', c, 'line', j, 'old', left(coalesce(l1[j], ''), 2500), 'new', left(coalesce(l2[j], ''), 2500));
      end if;
    end if;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('n', n, 'fail', nfail, 'err', nerr, 'noab', nnoab, 'noabdiff', nnoabdiff, 'fails', fails, 'cov', v_cov${process.env.SHADOW_DUMP ? ", 'first', (select o[1])" : ''})::text;
end $t$;`;

if (process.env.SHADOW_ONLY) { const re = new RegExp(process.env.SHADOW_ONLY); cases.splice(0, cases.length, ...cases.filter((c) => re.test(c.tag))); }   // development: only the cases whose tag matches
if (process.env.SHADOW_LIST) { for (const c of cases) console.log(c.tag, c.seed); process.exit(0); }
console.log(`shadow cases: ${cases.length} (Hunt support ${cases.filter((c) => c.m === 'hunt' && c.fn === 'support').length}, Dungeon support ${cases.filter((c) => c.m === 'dungeon' && c.fn === 'support').length}, Gauntlet support ${cases.filter((c) => c.m === 'gauntlet' && c.fn === 'support').length}, attacks ${cases.filter((c) => c.fn === 'attack').length}), ${BATCH} a request`);
let total = 0, fail = 0, err = 0, noab = 0, noabdiff = 0; const shown = []; const t0 = Date.now(); let slowest = 0; const cov = {};
for (let i = 0; i < cases.length; i += BATCH) {
  const t1 = Date.now();
  const out = JSON.parse(await runBlock(request(cases.slice(i, i + BATCH))));
  slowest = Math.max(slowest, Date.now() - t1);
  if (out.fatal) { console.log(`FAIL ${out.fatal}`); process.exit(1); }
  if (out.first) console.log(out.first);   // SHADOW_DUMP=1: the OLD transcript of the last case of the request
  total += out.n; fail += out.fail; err += out.err; noab += out.noab || 0; noabdiff += out.noabdiff || 0; shown.push(...out.fails);
  for (const [k, v] of Object.entries(out.cov || {})) cov[k] = (cov[k] || 0) + v;
  if ((out.fail || out.err) && process.env.MUTATE) break;   // a mutation run stops at the first difference
}
// combat_hit_elem (4c: the hit mods from the engine): the old text against the new one over a grid (every attack effect, an unknown one and none;
// the target HP below and above the execute threshold; the element chart; a NULL amount; several seeds), compared as text.
if (mig2 && !process.env.SHADOW_ONLY) {
  const he = JSON.parse(await runBlock(`${PLAN}
do $t$
declare n int := 0; nd int := 0; nnull int := 0; a text; o jsonb; w jsonb; sd float8; hp bigint; el text[]; amt numeric; first text;
begin
  execute $m$${mig}$m$;
  execute $m$${mig2}$m$;
  ${OLD_BASE.map((f) => `execute $v$${f}$v$;`).join('\n  ')}
  foreach a in array array['', 'focus', 'pierce', 'execute', 'rampage', 'lifesteal', 'smite', 'nothing'] loop
    foreach hp in array array[10, 49, 51, 100]::bigint[] loop
      foreach amt in array array[0.3, 1, null]::numeric[] loop
        for el in select x from (values (array[null, null]::text[]), (array['lightning', 'water']), (array['water', 'lightning']), (array['fire', 'fire'])) v(x) loop
          foreach sd in array array[0.11, -0.42, 0.77, 0.3, -0.9]::float8[] loop
            perform setseed(sd); o := pg_temp.o_combat_hit_elem(100, 1.2, 1.1, 0.9, 1.05, 0.3, 0.1, nullif(a, ''), amt, 0.5, a = 'pierce', 0.2, hp, 100, el[1], el[2]);
            perform setseed(sd); w := public.combat_hit_elem(100, 1.2, 1.1, 0.9, 1.05, 0.3, 0.1, nullif(a, ''), amt, 0.5, a = 'pierce', 0.2, hp, 100, el[1], el[2]);
            n := n + 1;
            if o::text is distinct from w::text then if amt is null and a = 'execute' and hp < 50 then nnull := nnull + 1; else nd := nd + 1; if first is null then first := format('%s hp %s amt %s el %s seed %s: OLD %s NEW %s', a, hp, amt, el, sd, o, w); end if; end if; end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('n', n, 'diff', nd, 'nnull', nnull, 'first', first)::text;
end $t$;`));
  console.log(`combat_hit_elem old vs new: ${he.n} calls, ${he.diff} different, ${he.nnull} with execute + a NULL amount below the threshold${he.first ? `\n  ${he.first}` : ''}`);
  if (he.diff || !he.n) fail += 1;
}
// 4d (f3_engine_hunt.sql): the old combat_hit, combat_crit_chance and hunt_card_crits against the new ones (the engine mods), compared as text. combat_hit:
// every attack effect, an unknown one and none; the boss HP below and above the execute threshold; amounts and thresholds with NULL; several seeds.
// combat_crit_chance: the weakness, the effects, the amounts, Precision points. hunt_card_crits: a member with every normal card (some with points) on
// bosses with weak and resist tags. The NULL amount is counted on its own line (the engine reads a missing amount as 0: 4c finding 1).
if (mig3 && !process.env.SHADOW_ONLY) {
  const hg = JSON.parse(await runBlock(`${PLAN}
do $t$
declare n int := 0; nd int := 0; nnull int := 0; a text; o jsonb; w jsonb; sd float8; hp bigint; amt numeric; th numeric; first text; b boolean; cmb jsonb;
  oc numeric; wc numeric; cn int := 0; cd int := 0; cnull int := 0; v_p text := 'tst_shadow_crit'; h bigint; wk jsonb; kn int := 0; kd int := 0; kcards int := 0;
begin
  ${installHelpers()}
  execute $m$${mig}$m$;
  ${mig2 ? `execute $m$${mig2}$m$;` : ''}
  execute $m$${mig3}$m$;
  ${OLD_BASE.map((f) => `execute $v$${f}$v$;`).join('\n  ')}
  foreach a in array array['', 'focus', 'pierce', 'execute', 'rampage', 'lifesteal', 'smite', 'nothing'] loop
    foreach hp in array array[10, 49, 51, 100]::bigint[] loop
      foreach amt in array array[0.3, 1, null]::numeric[] loop
        foreach th in array array[0.5, null]::numeric[] loop
          foreach sd in array array[0.11, -0.42, 0.77, 0.3, -0.9]::float8[] loop
            perform setseed(sd); o := pg_temp.o_combat_hit(100, 1.2, 1.1, 0.9, 1.05, 0.3, 0.1, nullif(a, ''), amt, th, a = 'pierce', 0.2, hp, 100);
            perform setseed(sd); w := public.combat_hit(100, 1.2, 1.1, 0.9, 1.05, 0.3, 0.1, nullif(a, ''), amt, th, a = 'pierce', 0.2, hp, 100);
            n := n + 1;
            if o::text is distinct from w::text then
              if amt is null and a = 'execute' and hp < th * 100 then nnull := nnull + 1;
              else nd := nd + 1; if first is null then first := format('combat_hit %s hp %s amt %s th %s seed %s: OLD %s NEW %s', a, hp, amt, th, sd, o, w); end if; end if;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  foreach b in array array[false, true] loop
    foreach a in array array['', 'focus', 'pierce', 'execute', 'nothing'] loop
      foreach amt in array array[0.15, 0, 0.4, null]::numeric[] loop
        for cmb in select card_combat('normal', 0, 1, x) from (values ('{}'::jsonb), ('{"precision": 3}'), ('{"precision": 10}')) v(x) loop
          oc := pg_temp.o_combat_crit_chance(b, nullif(a, ''), amt, cmb); wc := public.combat_crit_chance(b, nullif(a, ''), amt, cmb);
          cn := cn + 1;
          if oc::text is distinct from wc::text then
            if amt is null and a = 'focus' then cnull := cnull + 1;
            else cd := cd + 1; if first is null then first := format('combat_crit_chance %s %s %s %s: OLD %s NEW %s', b, a, amt, cmb, oc, wc); end if; end if;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  perform pg_temp.lab_member(v_p, array(select c.id from cards c where c.rarity = 'normal'), '{}'::jsonb, false);
  update player_cards set stat_points = '{"precision": 2}'::jsonb where player_id = v_p and card_id % 3 = 0;
  update player_cards set stat_points = '{"precision": 5, "attack": 1}'::jsonb where player_id = v_p and card_id % 3 = 1;
  for wk in select x from (values ('[]'::jsonb), ('[{"kind": "type", "value": "Creature"}]'), ('[{"kind": "tag", "value": "element:fire"}, {"kind": "tag", "value": "trait:melee"}]'),
                           ('[{"kind": "rarity", "value": "normal"}]')) v(x) loop
    insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, hp_share, closes_at, status, passive)
      values ('Shadow Crit Boss', 'Heroic', wk, '[{"kind": "type", "value": "Character"}]', 50000, 9000, 50000, now() + interval '1 day', 'active', '{}') returning id into h;
    o := pg_temp.o_hunt_card_crits(v_p, h); w := public.hunt_card_crits(v_p, h);
    kn := kn + 1; kcards := kcards + (select count(*) from jsonb_object_keys(o));
    if o::text is distinct from w::text then kd := kd + 1; if first is null then first := format('hunt_card_crits %s: OLD %s NEW %s', wk, left(o::text, 300), left(w::text, 300)); end if; end if;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('n', n, 'diff', nd, 'nnull', nnull, 'cn', cn, 'cdiff', cd, 'cnull', cnull, 'kn', kn, 'kdiff', kd, 'kcards', kcards, 'first', first)::text;
end $t$;`));
  console.log(`combat_hit old vs new: ${hg.n} calls, ${hg.diff} different, ${hg.nnull} with execute + a NULL amount below the threshold`);
  console.log(`combat_crit_chance old vs new: ${hg.cn} calls, ${hg.cdiff} different, ${hg.cnull} with focus + a NULL amount`);
  console.log(`hunt_card_crits old vs new: ${hg.kn} bosses (${hg.kcards} card answers), ${hg.kdiff} different${hg.first ? `\n  ${hg.first}` : ''}`);
  if (hg.diff || hg.cdiff || hg.kdiff || !hg.n || !hg.cn || !hg.kcards) fail += 1;
}
for (const f of shown.slice(0, 3)) {
  console.log(`\nCASE ${f.case.tag} seed ${f.case.seed}\n  ${JSON.stringify(f.case).slice(0, 600)}`);
  if (f.error) console.log(`  ERROR ${f.error}`);
  else console.log(`  line ${f.line}\n  OLD ${f.old}\n  NEW ${f.new}`);
}
const gap = process.env.MUTATE || process.env.SHADOW_ONLY ? [] : COVER.filter((k) => !cov[k]);
if (noab || !process.env.SHADOW_ONLY) console.log(`\nno ability (decision A): ${noab} cases with the same hit, ${noabdiff} of them with another random stream after the hit (expected: above 0)`);
if (!noab && !process.env.SHADOW_ONLY && !process.env.MUTATE) { console.log('FAIL no case of an attacker with no ability ran'); fail += 1; }
console.log(`\ncoverage (the cases whose OLD transcript shows it): ${COVER.map((k) => `${k} ${cov[k] || 0}`).join(' | ')}`);
if (gap.length) console.log(`FAIL COVERAGE GAP, no case shows: ${gap.join(', ')}`);
const bad = fail || err || gap.length;
console.log(`\n${bad ? 'FAIL' : 'PASS'} ${total} cases compared, ${fail} different, ${err} with an SQL error (${((Date.now() - t0) / 1000).toFixed(0)} s, the slowest request ${(slowest / 1000).toFixed(1)} s)`);
process.exit(bad ? 1 : 0);
