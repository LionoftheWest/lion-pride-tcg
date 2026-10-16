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
 * The NEW function is the LIVE text of the old function (db/schema/functions/<name>.sql, its md5 checked against the database) with only the effect
 * lines replaced (VARIANTS below; a replace that finds nothing is an error). It lives in pg_temp, inside the rolled-back block: nothing calls the engine.
 * The migration text is executed in each request (so the test passes before and after the file is applied).
 *
 * LOCAL copy only:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-effect-shadow.mjs            must PASS (prints the case count)
 *   MUTATE=<name> ...                                                                             must FAIL (a planted engine change)
 *   MUTATE=all ...                                                                                the baseline, then every mutation (one line each)
 *   MIG=<file.sql>  another migration text. SHADOW_BATCH=<n> cases in one request (default 600; each request stays under 55 s).
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
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const s = m && mig.indexOf(m[0]); const i = s >= 0 ? mig.indexOf(m[1], s) : -1;
  if (!m || s < 0 || i < 0) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.slice(0, i) + m[2] + mig.slice(i + m[1].length);
}
for (const d of ['$m$', '$v$', '$t$', '$g$x']) if (mig.includes(d)) throw new Error(`the migration must not contain ${d}`);

// ------------------------------------------------------------------------------------------------ the NEW functions (the live text + the engine)
const live = (name) => {
  const t = readFileSync(here(`../../db/schema/functions/${name}.sql`), 'utf8').replace(/\r/g, '');
  const md5 = t.match(/^-- md5: ([0-9a-f]{32})/m)[1];
  const sig = t.match(/^-- @function public\.(.+)$/m)[1];
  const s = t.indexOf('CREATE OR REPLACE FUNCTION'); const e = t.indexOf('$function$;', s);
  return { md5, sig, text: t.slice(s, e + '$function$'.length) };
};
const replaceOnce = (text, from, to, what) => {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`variant ${what}: the text to replace is ${i < 0 ? 'not found' : 'found twice'}: ${from.slice(0, 80)}`);
  return text.slice(0, i) + to + text.slice(i + from.length);
};
const replaceRegion = (text, start, end, to, what, { keepEnd = false } = {}) => {
  const i = text.indexOf(start); const j = i < 0 ? -1 : text.indexOf(end, i);
  if (i < 0 || j < 0 || text.indexOf(start, i + 1) >= 0) throw new Error(`variant ${what}: the region ${start.slice(0, 60)} ... ${end.slice(0, 60)} is not found once`);
  return text.slice(0, i) + to + (keepEnd ? text.slice(j) : text.slice(j + end.length));
};
const variant = (name, edit) => {
  const L = live(name);
  let t = replaceOnce(L.text, `CREATE OR REPLACE FUNCTION public.${name}(`, `CREATE FUNCTION pg_temp.e_${name}(`, name);
  t = replaceOnce(t, 'AS $function$\ndeclare', 'AS $function$\ndeclare v_fight jsonb; v_eng jsonb; v_l jsonb; v_st0 jsonb;\n ', name);
  t = edit(t);
  if (t.includes('$v$')) throw new Error(`variant ${name}: contains $v$`);
  return { name, md5: L.md5, sig: L.sig, text: t };
};
const VARIANTS = [
  variant('hunt_support', (t) => replaceRegion(t, "  -- Affinity synergy: how many committed squad cards share this support's affinity tag.\n",
    "  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()\n    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;\n\n  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount'",
    String.raw`  -- F-3 4b SHADOW (test only): the effect engine in place of the effect branches
  v_fight := hunt_fight_state(p_hunt, p_player, v_day, p_card, p_target);
  v_eng := combat_effect(v_fight, p_card, 'use', jsonb_build_object('target_card', p_target));
  if not (v_eng->>'ok')::boolean then return v_eng; end if;
  perform hunt_effect_apply(p_hunt, p_player, v_day, v_eng->'changes');
  v_l := v_eng->'log';
  if coalesce((v_eng->>'nullified')::boolean, false) then
    update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
      values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, (v_l->>'amount')::numeric, case when v_tgt in ('ally', 'self') then p_target end,
              jsonb_build_object('nullified', true, 'countered', v_l->'countered'));
    return jsonb_build_object('ok', true, 'effect', v_eff, 'nullified', true, 'countered', v_l->'countered',
      'ready_round', v_round + v_cd, 'round', v_round, 'boss_hp', (select hp_remaining from hunts where id = p_hunt), 'defeated', false);
  end if;
  v_amt := (v_l->>'amount')::numeric; v_matched := (v_l->>'matched')::boolean; v_affcount := (v_l->>'aff_count')::int;
  v_ctr := array(select jsonb_array_elements_text(v_l->'countered'));
  if coalesce((v_l->>'kill')::boolean, false) then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
  values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, v_amt,
    case when v_tgt in ('ally', 'self') then p_target end,
    jsonb_build_object('gained', v_l->'gained', 'mirrored', 'mirror' = any(v_ctr), 'countered', v_l->'countered',
      'scale', v_l->'scale', 'matched', v_l->'matched', 'aff_count', v_l->'aff_count', 'affinity', v_l->'affinity', 'cooldown', v_cd,
      'value', v_l->'value',
      'target_after', (select jsonb_build_object('hp', h.hp_remaining, 'max_hp', h.max_hp, 'shield', h.shield, 'dmg_buff', h.dmg_buff, 'downed', h.downed)
        from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)));

`, 'hunt_support', { keepEnd: true })),
  variant('hunt_attack', (t) => {
    t = replaceRegion(t, '  v_critchance := combat_crit_chance(v_bonus, v_aeff, v_aamt, v_cmb);\n', 'v_hp, v_hpmax);   -- Veil (hunt_boss_moves.sql)\n', String.raw`  v_fight := hunt_fight_state(p_hunt, p_player, v_day, p_card, null);
  v_eng := combat_effect(v_fight, p_card, 'before_hit', '{"target_foe": 0}'::jsonb);
  v_critchance := combat_crit_chance_mods(v_bonus, v_eng->'mods', v_cmb);
  v_hit := combat_hit_core(v_cp, v_wmult, v_buff, v_debuff, v_synmult, v_critchance, combat_miss('shrouded' = any(v_plist)),
    'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end, v_eng->'mods');
`, 'hunt_attack');
    t = replaceRegion(t, "  if v_aeff = 'lifesteal' and v_dmg > 0 then\n", '    v_cardhp := least(v_maxhp, v_cardhp + v_heal);\n  end if;\n', String.raw`  v_eng := combat_effect(jsonb_set(v_fight, array['cards', p_card::text], coalesce(v_fight->'cards'->p_card::text, '{"down": false, "shield": 0, "buff": 1, "debuff": 1, "cd": 0}'::jsonb)
    || jsonb_build_object('hp', v_cardhp, 'max', v_maxhp)), p_card, 'on_hit', jsonb_build_object('dealt', v_dmg, 'target_foe', 0));
  if v_eng->'log'->>'heal' is not null then
    v_heal := (v_eng->'log'->>'heal')::int;
    v_cardhp := (select (c->'set'->>'hp')::int from jsonb_array_elements(v_eng->'changes') c where c->>'op' = 'card' and (c->>'id')::bigint = p_card);
  end if;
`, 'hunt_attack');
    return replaceOnce(t, '  v_ubuff := v_buff;   -- the empower this attack used (Tier List)\n  v_buff := 1;\n', String.raw`  v_ubuff := v_buff;   -- the empower this attack used (Tier List)
  v_eng := combat_effect(v_fight, p_card, 'after_attack', '{}'::jsonb);
  v_buff := coalesce((select (c->'set'->>'buff')::numeric from jsonb_array_elements(v_eng->'changes') c where c->>'op' = 'card' and (c->>'id')::bigint = p_card), v_buff);
`, 'hunt_attack');
  }),
  variant('dungeon_support', (t) => replaceRegion(t, '  if v_aff is not null then\n    select count(*) into v_affc', "  st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + v_cd));\n", String.raw`  v_fight := dungeon_fight_state(r, p_card, p_target_card);
  v_eng := combat_effect(v_fight, p_card, 'use', jsonb_build_object('target_card', p_target_card, 'target_foe', p_target_foe));
  if not (v_eng->>'ok')::boolean then return v_eng; end if;
  v_l := v_eng->'log';
  v_amt := (v_l->>'amount')::numeric; v_matched := (v_l->>'matched')::boolean; v_affc := (v_l->>'aff_count')::int; v_scale := (v_l->>'scale')::numeric;
  v_t := (v_l->>'target_foe')::int;
  v_st0 := st;
  st := dungeon_effect_apply(st, v_eng->'changes');
  if v_l->>'side' = 'card' then
    tc := st->'cards'->p_target_card::text;
    v_log := dungeon_hp_event('support', v_eff, p_card, p_target_card, null, v_round, 'card', v_l->>'dir',
      (tc->>'hp')::int - (v_st0->'cards'->p_target_card::text->>'hp')::int, tc, jsonb_build_object('applied', v_l->'applied'));
  elsif v_l->>'side' = 'foe' then
    f := st->'foes'->v_t;
    v_log := dungeon_hp_event('support', v_eff, p_card, null, v_t, v_round, 'foe', v_l->>'dir',
      (v_st0->'foes'->v_t->>'hp')::int - (f->>'hp')::int, f, jsonb_build_object('applied', v_l->'applied', 'until', v_l->'until'));
    if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  else
    v_log := dungeon_hp_event('support', v_eff, p_card, null, null, v_round, null, null, 0, null, null);
  end if;
`, 'dungeon_support', { keepEnd: true })),
  variant('dungeon_attack', (t) => {
    t = replaceRegion(t, "  v_crit := combat_crit_chance((wk->>'wm')::int > 0, v_aeff, v_aamt, v_cmb);\n",
      "card_element(v_tags), f->>'element');   -- f3_element_bonus.sql: the element chart (the Gauntlet plays through this function too)\n", String.raw`  v_fight := dungeon_fight_state(r, p_card, null);
  v_eng := combat_effect(v_fight, p_card, 'before_hit', jsonb_build_object('target_foe', v_t));
  v_crit := combat_crit_chance_mods((wk->>'wm')::int > 0, v_eng->'mods', v_cmb);
  hit := combat_hit_core((v_cmb->>'cp')::int, (wk->>'mult')::numeric, (c->>'buff')::numeric, (c->>'debuff')::numeric, (sq->>'synmult')::numeric,
    v_crit, combat_miss('shrouded' = any(v_pl)), 'armored' = any(v_pl) and 'trait:melee' = any(v_tags),
    case when (f->>'exu')::int >= v_round and (f->>'ex')::numeric > 0 then (f->>'ex')::numeric else 0 end,
    v_eng->'mods', combat_element(card_element(v_tags), f->>'element'));
`, 'dungeon_attack');
    return replaceRegion(t, "  if v_aeff = 'lifesteal' and v_dmg > 0 then\n", "  st := jsonb_set(st, array['cards', p_card::text, 'buff'], '1');\n", String.raw`  v_eng := combat_effect(v_fight || jsonb_build_object('cards', st->'cards', 'enemies', st->'foes'), p_card, 'on_hit', jsonb_build_object('dealt', v_dmg, 'target_foe', v_t));
  if v_eng->'log'->>'heal' is not null then
    v_heal := (v_eng->'log'->>'heal')::int;
    st := dungeon_effect_apply(st, v_eng->'changes');
    v_log := v_log || dungeon_hp_event('effect', v_eng->'log'->>'effect', p_card, p_card, v_t, v_round, 'card', 'heal',
      (st->'cards'->p_card::text->>'hp')::int - (c->>'hp')::int, st->'cards'->p_card::text, jsonb_build_object('raw', v_heal));
  end if;
  v_eng := combat_effect(v_fight, p_card, 'after_attack', '{}'::jsonb);
  st := dungeon_effect_apply(st, v_eng->'changes');
`, 'dungeon_attack');
  }),
];

// SHADOW_WRITE_VARIANTS=<file.sql>: write the four NEW functions as public replacements (a preview of the 4c / 4d switch for fight-timing.mjs
// CANDIDATE=...; never applied) and stop.
if (process.env.SHADOW_WRITE_VARIANTS) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SHADOW_WRITE_VARIANTS, `-- A PREVIEW ONLY (test-effect-shadow.mjs): the live fight functions with the effect lines replaced by the engine. Never apply it.\n`
    + VARIANTS.map((v) => v.text.replace(`CREATE FUNCTION pg_temp.e_${v.name}(`, `CREATE OR REPLACE FUNCTION public.${v.name}(`) + ';\n').join('\n'));
  console.log(`wrote ${process.env.SHADOW_WRITE_VARIANTS}`);
  process.exit(0);
}

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
    if c->>'fn' = 'support' then return case when eng then pg_temp.e_hunt_support(p, ref, v_card, v_tgt) else hunt_support(p, ref, v_card, v_tgt) end; end if;
    return case when eng then pg_temp.e_hunt_attack(p, ref, v_card) else hunt_attack(p, ref, v_card) end;
  end if;
  if c->>'fn' = 'support' then return case when eng then pg_temp.e_dungeon_support(p, v_card, v_tgt, v_foe, v_mode) else dungeon_support(p, v_card, v_tgt, v_foe, v_mode) end; end if;
  return case when eng then pg_temp.e_dungeon_attack(p, v_card, v_foe, v_mode) else dungeon_attack(p, v_card, v_foe, v_mode) end;
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
      else if (ts === 'none') t = null;
    } else if (ts === 'ignored') t = I.atkWithout[3];
    // over the cap: no locked squad (a member with no locked squad; the adventure gate allows), 8 rows: hunt_commit_card refuses the target
    const locked = ts === 'overcap' ? null : [...new Set(rows.map((r) => r[0]).concat(t && ts !== 'notsquad' ? [t] : []))];
    return { m: 'hunt', fn: 'support', card: I.s, target: t, round: ROUND, hp: 40000, hpmax: 50000, tier: 'Heroic', passive: o.passive || [], marks: o.marks || {},
      st: o.st ?? 0, wk: '0.2', wku: 1, ex: '0.1', exu: 1, rows, locked, pts: o.pts || {}, asc: o.asc || 0, unowned: ts === 'unowned' ? [t] : [], seeds,
      ...(o.boss || {}) };
  };
  const tstates = ally ? ['hurt', 'full', 'fresh', 'downed', 'overcap', 'notsquad', 'unowned', 'none'] : ['none', 'ignored'];
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

// ------------------------------------------------------------------------------------------------ run
const ids = [...new Set(cases.flatMap((c) => [c.card, c.target, ...(c.rows || []).map((r) => r[0]), ...(c.squad || []), ...(c.locked || [])]).filter((x) => x != null))];
const BATCH = Number(process.env.SHADOW_BATCH || 600);
// What the OLD transcripts must show (PostgreSQL regular expressions): a case set that never meets a reaction proves nothing about it (COVERAGE GAP).
const COVER = ['"gained": [1-9]', '"effect": "stun".*"countered": [[]"juggernaut"]', '"error": "boss_stun_immune"', '"nullified": true', '"mirrored": true', '"defeated": true',
  '"undying"', '"spiral"', '"desync"', '"hotfix"', '"rot"', '"bloodrot"', '"countered": [[]"plague"]', '"shatterer"', '"dispeller"', '"block_', '"half_',
  '"error": "target_downed"', '"error": "need_target"', '"error": "bad_target"', '"matched": true', '"double": true', '"heal": [1-9]', '"kill": true',
  '"target_after": null', '"elem": "'];
const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const md5Checks = VARIANTS.map((v) => `if md5(replace(pg_get_functiondef('public.${v.sig}'::regprocedure), chr(13), '')) <> '${v.md5}' then
    raise exception 'RESULT:%', jsonb_build_object('fatal', 'the live ${v.name} is not the text of db/schema/functions/${v.name}.sql: regenerate the snapshot first')::text; end if;`).join('\n  ');
const request = (batch) => `${PLAN}
do $t$
declare v_p text := 'tst_shadow'; cs jsonb := ${lit(batch)}; c jsonb; o text[]; v_foes jsonb; nfail int := 0; nerr int := 0; n int := 0; fails jsonb := '[]'; l1 text[]; l2 text[]; j int;
  k text; v_cov jsonb := '{}';
begin
  ${md5Checks}
  ${installHelpers()}
  execute $m$${mig}$m$;
  ${VARIANTS.map((v) => `execute $v$${v.text}$v$;`).join('\n  ')}
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
      if jsonb_array_length(fails) < 3 then fails := fails || jsonb_build_object('case', c, 'error', left(coalesce(o[1], '') || ' | ' || coalesce(o[2], ''), 1500)); end if;
    elsif o[1] is distinct from o[2] then
      nfail := nfail + 1;
      if jsonb_array_length(fails) < 3 then
        l1 := regexp_split_to_array(o[1], E'\n'); l2 := regexp_split_to_array(o[2], E'\n'); j := 1;
        while j < greatest(array_length(l1, 1), array_length(l2, 1)) and l1[j] is not distinct from l2[j] loop j := j + 1; end loop;
        fails := fails || jsonb_build_object('case', c, 'line', j, 'old', left(coalesce(l1[j], ''), 2500), 'new', left(coalesce(l2[j], ''), 2500));
      end if;
    end if;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('n', n, 'fail', nfail, 'err', nerr, 'fails', fails, 'cov', v_cov${process.env.SHADOW_DUMP ? ", 'first', (select o[1])" : ''})::text;
end $t$;`;

if (process.env.SHADOW_ONLY) { const re = new RegExp(process.env.SHADOW_ONLY); cases.splice(0, cases.length, ...cases.filter((c) => re.test(c.tag))); }   // development: only the cases whose tag matches
if (process.env.SHADOW_LIST) { for (const c of cases) console.log(c.tag, c.seed); process.exit(0); }
console.log(`shadow cases: ${cases.length} (Hunt support ${cases.filter((c) => c.m === 'hunt' && c.fn === 'support').length}, Dungeon support ${cases.filter((c) => c.m === 'dungeon' && c.fn === 'support').length}, Gauntlet support ${cases.filter((c) => c.m === 'gauntlet' && c.fn === 'support').length}, attacks ${cases.filter((c) => c.fn === 'attack').length}), ${BATCH} a request`);
let total = 0, fail = 0, err = 0; const shown = []; const t0 = Date.now(); let slowest = 0; const cov = {};
for (let i = 0; i < cases.length; i += BATCH) {
  const t1 = Date.now();
  const out = JSON.parse(await runBlock(request(cases.slice(i, i + BATCH))));
  slowest = Math.max(slowest, Date.now() - t1);
  if (out.fatal) { console.log(`FAIL ${out.fatal}`); process.exit(1); }
  if (out.first) console.log(out.first);   // SHADOW_DUMP=1: the OLD transcript of the last case of the request
  total += out.n; fail += out.fail; err += out.err; shown.push(...out.fails);
  for (const [k, v] of Object.entries(out.cov || {})) cov[k] = (cov[k] || 0) + v;
  if ((out.fail || out.err) && process.env.MUTATE) break;   // a mutation run stops at the first difference
}
for (const f of shown.slice(0, 3)) {
  console.log(`\nCASE ${f.case.tag} seed ${f.case.seed}\n  ${JSON.stringify(f.case).slice(0, 600)}`);
  if (f.error) console.log(`  ERROR ${f.error}`);
  else console.log(`  line ${f.line}\n  OLD ${f.old}\n  NEW ${f.new}`);
}
const gap = process.env.MUTATE || process.env.SHADOW_ONLY ? [] : COVER.filter((k) => !cov[k]);
console.log(`\ncoverage (the cases whose OLD transcript shows it): ${COVER.map((k) => `${k} ${cov[k] || 0}`).join(' | ')}`);
if (gap.length) console.log(`FAIL COVERAGE GAP, no case shows: ${gap.join(', ')}`);
const bad = fail || err || gap.length;
console.log(`\n${bad ? 'FAIL' : 'PASS'} ${total} cases compared, ${fail} different, ${err} with an SQL error (${((Date.now() - t0) / 1000).toFixed(0)} s, the slowest request ${(slowest / 1000).toFixed(1)} s)`);
process.exit(bad ? 1 : 0);
