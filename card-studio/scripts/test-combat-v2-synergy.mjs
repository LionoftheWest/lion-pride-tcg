/**
 * Test of tcg-bot/supabase/combat_v2_synergy.sql (combat v2 item SYN: the element, affinity and set synergy; docs/combat-redesign-plan.md 7.1 to
 * 7.5 and 20.18). One rolled-back block on the LOCAL copy: the file is applied inside the block, every case runs, the block raises its result.
 * Nothing is kept. Conditions of SPEC SYN v3 section 6:
 *   C1   the md5 of every public function that the file does not replace or add is the same before and after the file
 *   C3a  combat_v2_card_tags = card_element, the first origin: slug and the element_counters list (no proposal) of each named card
 *   C3b  the element chart in combat_v2_hit with fixed draws (x bonus exactly on a beaten foe; x1 and chart false on the other cases)
 *   C3c  the element synergy of combat_v2_synergy on 4 named squads
 *   C3d  the support affinity (aff_tag, aff_n, aff_x) and every support amount block x aff_x with the same draws, stacks, chances, durations
 *   C3e  the set synergy (distinct pieces, 3 / 5 / 7, the top step only in the Hunt with the head) on synthetic subjects
 *   C3f  fight_state_check_v2 accepts a state after combat_v2_synergy; the balance trigger refuses a bad v2_synergy
 *   C3g  the card unit (with tags) = the Lab unit (the text of fightSql, read from the file) for every card with an ability_v2
 *   C3h  elem_x and set_x in the hit core (x1.232), not on the enemy side, no aff_x on a support basic hit, the 3-argument hit the same
 *   C3i  one set_x on a support smite, area and shield (combat_v2_card_act)
 *   C3k  a card with no tags: every factor 1, it counts for no tag, no chart on its hit
 *   C3j  the R1b room start gauntlet_v2_fight calls combat_v2_synergy once (rooms of the week 2026-10-25), draws nothing more, and differs from
 *        the R1b text by its one SYN line only
 * C2 and C4 (the benches) and C1 (the goldens) run in their own scripts (out/syn, SPEC 8.5).
 * Usage (a local copy, its lock held; LOCALDB_ENV names the copy):
 *   LOCALDB=1 LOCALDB_ENV=%TEMP%/localdb3.env node scripts/test-combat-v2-synergy.mjs           PASS / FAIL lines, exit 1 on a FAIL
 *   MUTATE=all ...                                                                                 the baseline PASS, then every mutation must FAIL its case
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBlock, assertLocal } from './lab-lib.mjs';

assertLocal('test-combat-v2-synergy.mjs');
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
let mig = read('../../tcg-bot/supabase/combat_v2_synergy.sql');
let LAB_SRC = read('../src/combat-lab-routes.js');

// the replaced and the new functions (SPEC 4; balance_check_combat_v2 holds the step order of the shape)
const REPLACED = ['balance_v2_spec(text)', 'balance_check_combat_v2()', 'combat_v2_status_numbers()', 'combat_v2_card_unit(bigint,jsonb)',
  'gauntlet_v2_foes(jsonb,integer,integer,jsonb)', 'combat_v2_hit(jsonb,jsonb,jsonb)', 'combat_v2_hit(jsonb,jsonb,jsonb,jsonb)',
  'combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'gauntlet_v2_fight(jsonb,jsonb,integer,integer,jsonb)'];
const NEW = ['combat_v2_card_tags(bigint)', 'combat_v2_synergy(jsonb,jsonb)'];

// Each mutation: [the file ('mig' or 'lab'), [text, replacement] pairs, the case prefix that must FAIL, optional: the error text that counts as
// caught when the mutated SQL raises and stops the block (the file does not apply, or a fight function raises)]
const MUT = {
  // C1
  M1b_other_function: ['mig', [['-- ============================================================ 6. server only',
    "create or replace function public.card_element(p_tags text[]) returns text language sql stable parallel safe set search_path = public as $ce$\n  select a.element from unnest(coalesce(p_tags, '{}'::text[])) t join public.element_aliases() a on a.alias = lower(trim(regexp_replace(t, '^trait:', '', 'i'))) order by a.ord limit 1 $ce$;\n-- ============================================================ 6. server only"]], 'C1'],
  // C3d (review r1 B-1): the focus crd without the affinity and set factor
  REVR2_quicken_all_unscaled: ['mig', [["id::numeric), 'quickened', jsonb_build_object('value', 1 + amt * ab", "id::numeric), 'quickened', jsonb_build_object('value', 1 + amt / sf * ab"]], 'C3d'],   // review r2 R2-1
  // C3d (review r3 R3-1): the set_x part of sf dropped (sf -> sa) at the focus crd, the apply value and the random_apply value
  R3_863_focus_crd_set_x: ['mig', [["(blk->>'crd')::numeric * ab * sf)", "(blk->>'crd')::numeric * ab * sa)"]], 'C3d'],
  R3_910_apply_set_x: ['mig', [["amt := (am->>'v')::numeric * cnt * ab * cr * sf;", "amt := (am->>'v')::numeric * cnt * ab * cr * sa;"]], 'C3d'],
  R3_925_random_apply_set_x: ['mig', [["jsonb_build_object('value', (op->>'value')::numeric * sf)", "jsonb_build_object('value', (op->>'value')::numeric * sa)"]], 'C3d'],
  REV_focus_crd_no_sf: ['mig', [["(blk->>'crd')::numeric * ab * sf)", "(blk->>'crd')::numeric * ab)"]], 'C3d'],
  // C3a
  M3a_beats_proposal: ['mig', [['where e.beater = el and not e.proposal), ', 'where e.beater = el), ']], 'C3a'],
  M3b_family_last: ['mig', [["where q.t like 'origin:%' order by q.o limit 1;", "where q.t like 'origin:%' order by q.o desc limit 1;"]], 'C3a'],
  // C3b
  M3c_reversed_pair: ['mig', [["coalesce(p_att->'tags'->'beats' ? (p_tgt->>'element'), false);",
    "(coalesce(p_att->'tags'->'beats' ? (p_tgt->>'element'), false) or exists (select 1 from public.element_counters z where z.target = p_att->'tags'->>'element' and z.beater = p_tgt->>'element'));"]], 'C3b'],
  M3d_enemy_chart: ['mig', [["    -- 4. Sunder and Shatter (the unit's own params count)\n",
    "    if p_tgt->'tags'->'beats' ? (p_att->>'element') or p_att->'tags'->'beats' ? (p_tgt->>'element') or p_att->>'element' is not null then mult := mult * (p_b->'v2_synergy'->'chart'->>'bonus')::numeric; end if;\n    -- 4. Sunder and Shatter (the unit's own params count)\n"]], 'C3b'],
  M4b_chart_reads_target_as_attacker: ['mig', [["coalesce(p_att->'tags'->'beats' ? (p_tgt->>'element'), false);",
    "exists (select 1 from public.element_counters z where z.beater = p_tgt->>'element' and z.target = p_att->'tags'->>'element' and not z.proposal);"]], 'C3b'],
  // C3c
  M3e_elem_n_not_self: ['mig', [["select count(*)::int into en from jsonb_each(cards) q where el is not null and q.value->'tags'->>'element' = el;",
    "select count(*)::int into en from jsonb_each(cards) q where el is not null and q.value->'tags'->>'element' = el and q.key <> c.key;"]], 'C3c'],
  M3f_small_big_swapped: ['mig', [["ex := case when en >= (ce->>'big_at')::int then (ce->>'big')::numeric when en >= (ce->>'small_at')::int then (ce->>'small')::numeric else 1 end;",
    "ex := case when en >= (ce->>'big_at')::int then (ce->>'small')::numeric when en >= (ce->>'small_at')::int then (ce->>'big')::numeric else 1 end;"]], 'C3c'],
  elem_n_attackers_only: ['mig', [["select count(*)::int into en from jsonb_each(cards) q where el is not null and q.value->'tags'->>'element' = el;",
    "select count(*)::int into en from jsonb_each(cards) q where el is not null and q.value->'tags'->>'element' = el and q.value->>'class' = 'attacker';"]], 'C3c'],
  // C3d
  M3g_cap_ignored: ['mig', [["ax := 1 + least((ca->>'cap')::numeric, (ca->>'step')::numeric * an);", "ax := 1 + (ca->>'step')::numeric * an;"]], 'C3d'],
  M3h_attacker_aff: ['mig', [["    if c.value->>'class' = 'support' then\n      ne :=", "    if c.value->>'class' in ('support', 'attacker') then\n      ne :="]], 'C3d'],
  M3i_chance_scaled: ['mig', [["    elsif k = 'apply' then\n      ch := (blk->>'chance')::numeric;\n", "    elsif k = 'apply' then\n      ch := (blk->>'chance')::numeric * sa;\n"],
    ["    elsif k = 'random_apply' then\n      ch := coalesce((blk->>'chance')::numeric, 1);\n", "    elsif k = 'random_apply' then\n      ch := coalesce((blk->>'chance')::numeric, 1) * sa;\n"]], 'C3d'],
  M2c_counts_self: ['mig', [["ax := 1 + least((ca->>'cap')::numeric, (ca->>'step')::numeric * an);", "ax := 1 + least((ca->>'cap')::numeric, (ca->>'step')::numeric * (an + 1));"]], 'C3d'],
  // C3e
  M3j_cards_not_subjects: ['mig', [["select count(distinct q.value->'tags'->>'piece')::int,", "select count(q.value->'tags'->>'piece')::int,"]], 'C3e'],
  M3k_top_no_head: ['mig', [["and p_state->>'mode' = 'hunt' and head then", "and p_state->>'mode' = 'hunt' then"]], 'C3e'],
  M3l_top_outside_hunt: ['mig', [["and p_state->>'mode' = 'hunt' and head then", "and head then"]], 'C3e'],
  // C3f
  M3m_no_spec_branch: ['mig', [[/  when 'v2_synergy' then '\{\n[\s\S]*?"enum ottozone-s-head"\}\}\}'::jsonb\n/, '']], 'C3f', 'v2_synergy: a combat v2 key needs a shape in balance_v2_spec'],
  M3m_loose_step: ['mig', [['"affinity": {"step": "num 0 0.3", "cap": "num 0 1"},', '"affinity": {"step": "num 0 1", "cap": "num 0 1"},']], 'C3f'],
  // C3g
  REV_lab_no_synergy: ['lab', [['  s := combat_v2_synergy(s, b);\n', '']], 'C3g'],   // review r1 B-2: the Lab fight without the synergy call
  M3n_lab_no_beats: ['lab', [["'tags', combat_v2_card_tags((x->>'card_id')::bigint)", "'tags', combat_v2_card_tags((x->>'card_id')::bigint) - 'beats'"]], 'C3g'],
  // C3h
  hit_no_elem_x: ['mig', [["fx := coalesce((p_att->'syn'->>'elem_x')::numeric, 1) * coalesce((p_att->'syn'->>'set_x')::numeric, 1);", "fx := coalesce((p_att->'syn'->>'set_x')::numeric, 1);"]], 'C3h'],
  hit_no_set_x: ['mig', [["fx := coalesce((p_att->'syn'->>'elem_x')::numeric, 1) * coalesce((p_att->'syn'->>'set_x')::numeric, 1);", "fx := coalesce((p_att->'syn'->>'elem_x')::numeric, 1);"]], 'C3h'],
  enemy_side_elem_x: ['mig', [["    -- 4. Sunder and Shatter (the unit's own params count)\n", "    mult := mult * coalesce((p_tgt->'syn'->>'elem_x')::numeric, 1);\n    -- 4. Sunder and Shatter (the unit's own params count)\n"]], 'C3h'],
  aff_in_hit_core: ['mig', [["fx := coalesce((p_att->'syn'->>'elem_x')::numeric, 1) * coalesce((p_att->'syn'->>'set_x')::numeric, 1);",
    "fx := coalesce((p_att->'syn'->>'elem_x')::numeric, 1) * coalesce((p_att->'syn'->>'set_x')::numeric, 1) * coalesce((p_att->'syn'->>'aff_x')::numeric, 1);"]], 'C3h'],
  hit3_no_synergy: ['mig', [["'v2_enemy', 'v2_support', 'v2_synergy']));", "'v2_enemy', 'v2_support']));"]], 'C3h'],
  // C3i
  smite_set_x_twice: ['mig', [["    elsif k = 'smite' then smite_x := (blk->>'x')::numeric * ab * sa;\n", "    elsif k = 'smite' then smite_x := (blk->>'x')::numeric * ab * sf;\n"]], 'C3i'],
  area_set_x_twice: ['mig', [["    elsif k = 'area' then area_x := (blk->>'x')::numeric * ab * sa;\n", "    elsif k = 'area' then area_x := (blk->>'x')::numeric * ab * sf;\n"]], 'C3i'],
  shield_no_set_x: ['mig', [["amt := (am->>'v')::numeric * sf;", "amt := (am->>'v')::numeric * sa;"]], 'C3i'],
  // C3k
  notags_raise: ['mig', [["      -- a unit with no tags (a snapshot made before SYN): it counts for no tag, and every factor is 1\n",
    "      raise exception 'combat_v2_synergy: card % has no tags', c.key;\n"]], 'C3k', 'combat_v2_synergy: card 3 has no tags'],
  notags_counts: ['mig', [["select count(*)::int into en from jsonb_each(cards) q where el is not null and q.value->'tags'->>'element' = el;",
    "select count(*)::int into en from jsonb_each(cards) q where el is not null and (q.value->'tags'->>'element' = el or jsonb_typeof(q.value->'tags') is distinct from 'object');"]], 'C3k'],
  // C3j (the R1b room start gauntlet_v2_fight)
  room_no_synergy: ['mig', [['  s := combat_v2_synergy(s, b);   -- SYN: the squad factors, once, at the room start (20.18, C3j)\n', '']], 'C3j'],
  synergy_room_1_only: ['mig', [['  s := combat_v2_synergy(s, b);   -- SYN: the squad factors, once, at the room start (20.18, C3j)\n',
    '  if p_room_no = 1 then s := combat_v2_synergy(s, b); end if;   -- SYN: the squad factors, once, at the room start (20.18, C3j)\n']], 'C3j'],
  synergy_draws: ['mig', [["  if sx = 1 then sx := 1; end if;\n", "  if sx = 1 then sx := 1; end if;\n  perform random();\n"]], 'C3j'],
  r1b_extra_change: ['mig', [["'round', 0, 'clock', 0, 'squad', p_state->'squad', 'cards', cards, 'enemies', en,", "'round', 0, 'clock', 0 + 0, 'squad', p_state->'squad', 'cards', cards, 'enemies', en,"]], 'C3j'],
  // M2a (C2 bench; here: the synergy draws a random number = the C3f purity case)
  M2a_synergy_random: ['mig', [["  if sx = 1 then sx := 1; end if;\n", "  if sx = 1 then sx := 1; end if;\n  perform random();\n"]], 'C3f'],
};
const pairs = (m) => m[1];

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  const baseOk = base.status === 0 && /^PASS/.test(bl);
  console.log(`baseline (no mutation)                 ${baseOk ? 'PASS' : 'FAIL'}  ${bl.slice(0, 160)}`);
  if (!baseOk) { ok = false; console.log(((base.stdout || '') + (base.stderr || '')).split(/\r?\n/).filter((l) => /FAIL|Error/.test(l)).join('\n').slice(0, 4000)); }
  for (const [name, m] of Object.entries(MUT)) {
    const r = runOne(name);
    const out = r.stdout || '';
    const fails = out.split(/\r?\n/).filter((l) => /^FAIL /.test(l));
    const errTxt = (r.stderr || '').split(/\r?\n/).find((l) => /^Error: NO RESULT/.test(l)) || '';
    const hit = fails.some((l) => l.startsWith(`FAIL ${m[2]} `)) || (!!m[3] && errTxt.includes(m[3]));
    const caught = r.status !== 0 && hit;
    if (!caught) ok = false;
    console.log(`FAIL ${name.padEnd(36)} ${caught ? (fails.length ? `caught: ${m[2]} FAILS` : 'caught: the SQL raises') : `NOT CAUGHT (exit ${r.status})`}  ${(fails.find((l) => l.startsWith(`FAIL ${m[2]} `)) || fails[0] || errTxt.replace(/^.*?ERROR: +/, 'ERROR ') || '').slice(0, 170)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught (each FAILS its own case)` : 'mutations: FAILED (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
const MUTATING = !!process.env.MUTATE;
if (MUTATING) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (const [a, b] of pairs(m)) {
    const src = m[0] === 'lab' ? LAB_SRC : mig;
    const n = a instanceof RegExp ? (src.match(new RegExp(a.source, 'g')) || []).length : src.split(a).length - 1;
    if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match ${m[0]} exactly once (${n})`);
    const out = a instanceof RegExp ? src.replace(a, b) : src.split(a).join(b);
    if (m[0] === 'lab') LAB_SRC = out; else mig = out;
  }
}
// the Lab card unit WITH tags: the real text of fightSql (as the R1a test reads it, with the tags entry)
const LAB_CC = (LAB_SRC.match(/cc := (card_combat_v2\(x->>'rarity'[^;]*\));/) || [])[1];
const LAB_UNIT0 = (LAB_SRC.match(/cards := cards \|\| jsonb_build_object\(i::text, (jsonb_build_object\('role'[\s\S]*?'active', jsonb_build_object\('blocks', x->'blocks'\), 'tags', [^\n]*?\))\);\n/) || [])[1];
if (!LAB_CC || !LAB_UNIT0 || LAB_UNIT0.split("round((random() * 100)::numeric, 2)").length !== 2) throw new Error('the Lab card unit with tags (fightSql) was not found in card-studio/src/combat-lab-routes.js');
const LAB_UNIT = LAB_UNIT0.replace("round((random() * 100)::numeric, 2)", '0');
// C3j: the R1b room start of this file minus its SYN line = the R1b text (as pg_temp.o_fight); the guard row holds the md5 of the R1b text
const FIGHT = (mig.match(/CREATE OR REPLACE FUNCTION public\.gauntlet_v2_fight\([\s\S]*?end \$function\$;/) || [])[0];
if (!FIGHT) throw new Error('gauntlet_v2_fight was not found in the SYN file');
const OLD_FIGHT = FIGHT.replace(/\n[^\n]*-- SYN[^\n]*/g, '').replace('FUNCTION public.gauntlet_v2_fight(', 'FUNCTION pg_temp.o_fight(');
const FIGHT_OLD_MD5 = (mig.match(/\('public\.gauntlet_v2_fight\(jsonb, jsonb, integer, integer, jsonb\)', '([0-9a-f]{32})'/) || [])[1];
if (!FIGHT_OLD_MD5) throw new Error('the guard row of gauntlet_v2_fight was not found');
for (const t of [mig, LAB_CC, LAB_UNIT, OLD_FIGHT]) if (['$o$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $o$');
for (const t of [mig, LAB_CC, LAB_UNIT]) if (['$m$', '$t$', '$x$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $x$');

// C3d: each support amount block and every number that must scale by aff_x (paths in the state after the act; 'hit n' = the n-th hit)
const C3D_CASES = [
  { b: [{ k: 'shield', v: 0.1 }], e: ['cards.2.status.shielded.value'] },
  { b: [{ k: 'shield_all', v: 0.1 }], e: ['cards.1.status.shielded.value', 'cards.2.status.shielded.value', 'cards.3.status.shielded.value'] },
  { b: [{ k: 'heal', v: 0.1 }], e: ['cards.2.healed.v', 'cards.2.hp', 'ext.healed.v'] },
  { b: [{ k: 'heal_all', v: 0.1 }], e: ['cards.2.healed.v', 'cards.2.hp', 'cards.3.healed.v', 'cards.3.hp', 'ext.healed.v'] },
  { b: [{ k: 'empower', v: 0.2 }], e: ['cards.2.status.empowered.value'] },
  { b: [{ k: 'rally', v: 0.2 }], e: ['cards.2.status.empowered.value', 'cards.3.status.empowered.value'] },
  { b: [{ k: 'focus', crit: 0.2, crd: 0.5 }], e: ['cards.2.status.focused.crd', 'cards.2.status.focused.value'] },
  { b: [{ k: 'quicken', v: 0.2 }], e: ['cards.2.status.quickened.value'] },
  { b: [{ k: 'quicken', v: 0.2, all: true }], e: ['cards.2.status.quickened.value', 'cards.3.status.quickened.value'] },   // review r2 R2-1: the all branch has its own line
  { b: [{ k: 'smite', x: 1 }], e: ['enemies.0.hp', 'enemies.0.last_smite', 'hit 1'] },
  { b: [{ k: 'smite', x: 1 }, { k: 'area', x: 0.5 }], e: ['enemies.0.hp', 'enemies.0.last_smite', 'enemies.1.hp', 'hit 1', 'hit 2'] },
  { b: [{ k: 'apply', status: 'exposed', chance: 0.5, value: 0.2 }], e: ['enemies.0.status.exposed.value'] },
  { b: [{ k: 'random_apply', chance: 0.5, options: [{ status: 'exposed', value: 0.2 }, { status: 'weakened', value: 0.1 }] }], e: ['enemies.0.status.exposed.value'] },
];
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(lit).join(', ')}]::text[]`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
const OK_V2 = `jsonb_typeof(s3.ability_v2) = 'object' and jsonb_typeof(s3.ability_v2->'blocks') = 'array' and exists (select 1 from public.roles ro where ro.key = s3.ability_v2->>'role')`;

const HELPERS = String.raw`
  -- a unit of a card side (the fields of combat_v2_card_unit) with the given class, role and extra keys
  create function pg_temp.su(cls text, role text, extra jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('role', role, 'class', cls, 'atk', 100, 'crt', 0, 'crd', 1.5, 'abl', 1, 'acc', 0, 'def', 0, 'ddg', 0, 'max', 1000, 'hp', 1000,
      'down', false, 'speed', 100, 'spd', 0, 'power', 1, 'extra_stack', 0, 'meter', 0, 'charge', 5, 'held', 0, 'status', '{}'::jsonb,
      'active', jsonb_build_object('blocks', '[]'::jsonb)) || coalesce(extra, '{}'::jsonb)
  $x$;
  create function pg_temp.tg(el text, fam text, piece text) returns jsonb language sql as $x$
    select jsonb_build_object('element', el, 'family', fam, 'piece', piece,
      'beats', coalesce((select jsonb_agg(e.target order by e.target) from public.element_counters e where e.beater = el and not e.proposal), '[]'::jsonb))
  $x$;
  create function pg_temp.st(cards jsonb, mode text, enemies jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('v', 2, 'mode', mode, 'round', 0, 'clock', 1, 'squad', (select jsonb_agg(k::int order by k::int) from jsonb_object_keys(cards) k),
      'cards', cards, 'enemies', coalesce(enemies, '[]'::jsonb), 'marks', '{}'::jsonb, 'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb)
  $x$;
  -- the Lab card unit (the text of fightSql) for a card x {card_id, rarity, cp_mod, role, blocks} at 0 stars, level 0, no points, meter 0
  create function pg_temp.lab_unit(x0 jsonb, b jsonb) returns jsonb language plpgsql as $x$
  declare x jsonb := x0 || jsonb_build_object('stars', 0, 'level', 0, 'points', '{}'::jsonb); cc jsonb;
  begin
    cc := ${LAB_CC};
    return ${LAB_UNIT};
  end $x$;`;

// the ratio helper: compares two answers of combat_v2_card_act from the start state s0. Every number that differs gives its ratio: of the change from
// s0 (HP, a status that s0 had), of the value - 1 (Quickened), else of the value. ok = the draws, stacks, until and every other key are the same, and
// every ratio is the same number (not 1)
const RATIOS = String.raw`
create function pg_temp.syn_ratios(s0 jsonb, a jsonb, b2 jsonb) returns jsonb language plpgsql as $x$
declare out jsonb := '[]'; bad jsonb := '[]'; p record; q record; ra numeric; rs numeric[] := '{}'; v0 numeric; last text;
begin
  if a->'draws' is distinct from b2->'draws' then bad := bad || to_jsonb('draws'::text); end if;
  for p in select path, va, vb from (
      with recursive w(path, va, vb) as (
        select array[k], a->'state'->k, b2->'state'->k from jsonb_object_keys(a->'state') k
        union all
        select w.path || e.key, w.va #> array[e.key], w.vb #> array[e.key] from w,
          lateral (select jsonb_object_keys(w.va) where jsonb_typeof(w.va) = 'object' and jsonb_typeof(w.vb) = 'object'
                   union all select g::text from generate_series(0, jsonb_array_length(w.va) - 1) g
                    where jsonb_typeof(w.va) = 'array' and jsonb_typeof(w.vb) = 'array' and jsonb_array_length(w.va) = jsonb_array_length(w.vb)) e(key)
      ) select * from w where (coalesce(jsonb_typeof(va), '') not in ('object', 'array') or jsonb_typeof(va) is distinct from jsonb_typeof(vb)
          or (jsonb_typeof(va) = 'array' and jsonb_array_length(va) <> jsonb_array_length(vb))) and not ('syn' = any(path))) z loop
    continue when p.va is not distinct from p.vb;
    last := p.path[array_length(p.path, 1)];
    if jsonb_typeof(p.va) = 'number' and jsonb_typeof(p.vb) = 'number' and last in ('value', 'v', 'crd', 'hp', 'last_smite') then
      v0 := case when jsonb_typeof(s0 #> p.path) = 'number' then (s0 #>> p.path)::numeric when p.path[array_length(p.path, 1) - 1] = 'quickened' then 1 else 0 end;
      ra := ((p.vb)::text::numeric - v0) / nullif((p.va)::text::numeric - v0, 0);
      rs := rs || ra; out := out || jsonb_build_object('path', array_to_string(p.path, '.'), 'r', ra);
    else bad := bad || jsonb_build_object('path', array_to_string(p.path, '.'), 'a', p.va, 'b', p.vb);
    end if;
  end loop;
  for q in select x.o, x.ha, b2->'hits'->(x.o::int - 1) hb from jsonb_array_elements(a->'hits') with ordinality x(ha, o) loop
    if (q.ha - 'dmg') is distinct from (q.hb - 'dmg') then bad := bad || jsonb_build_object('hit', q.o, 'a', q.ha, 'b', q.hb); continue; end if;
    continue when (q.ha->>'dmg')::numeric = 0;
    ra := (q.hb->>'dmg')::numeric / (q.ha->>'dmg')::numeric; rs := rs || ra; out := out || jsonb_build_object('hit', q.o, 'r', ra);
  end loop;
  if jsonb_array_length(a->'hits') <> jsonb_array_length(b2->'hits') then bad := bad || to_jsonb('hit count'::text); end if;
  return jsonb_build_object('ok', bad = '[]'::jsonb and cardinality(rs) > 0 and (select count(distinct v) from unnest(rs) v) = 1 and array_position(rs, null) is null and rs[1] <> 1,
    'ratios', out, 'bad', bad);
end $x$;`;

const body = String.raw`do $t$
declare res jsonb := '[]'; o jsonb; o2 jsonb; md5_a jsonb; md5_b jsonb; b jsonb; ba jsonb; x jsonb; u jsonb; lab jsonb; n int := 0; m int := 0; k int; i int;
  t jsonb; s jsonb; s2 jsonb; r jsonb; r2 jsonb; foe jsonb; foe2 jsonb; at jsonb; at2 jsonb; sp jsonb; ctx jsonb; dr jsonb; el text; tel text; rev text; boss jsonb;
  cards jsonb; c jsonb; v_subj bigint; v_card bigint; ids bigint[] := '{}'; heads bigint; e text; msg text; ok boolean; d1 numeric; d2 numeric; got jsonb; want jsonb;
  mine text[] := ${arr([...REPLACED, ...NEW])}; blk jsonb; pieces bigint[] := '{}'; fam_ids bigint[];
  wk record; un jsonb; st0 jsonb; f1 jsonb; f0 jsonb; nread int;
begin
  -- M1e (combat_v2_convert.sql) adds ONE line (mark "-- M1e") to balance_v2_spec in place. The guard of this file knows the SYN text without it:
  -- put that text back first (rolled back with the block), as docs/foundations.md says for a guard that refuses a newer function
  execute regexp_replace(replace(pg_get_functiondef('public.balance_v2_spec(text)'::regprocedure), chr(13), ''), E'\n[^\n]*-- M1e[^\n]*', '', 'g');
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${SIG} <> all (mine);
  -- C3a M3a: a planted proposal pair (fire beats a target that it does not beat in the rows of the table)
  select x2.key into tel from public.elements x2 where x2.key <> 'fire' and not exists (select 1 from public.element_counters z where z.beater = 'fire' and z.target = x2.key) order by x2.key limit 1;
  insert into public.element_counters (beater, target, proposal) values ('fire', tel, true);

  execute $m$${mig}$m$;
  ${HELPERS}
  ${RATIOS}

  -- ========== C1: the md5 of every other public function is the same
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${SIG} <> all (mine);
  res := res || jsonb_build_object('case', format('C1 the md5 of the %s public functions that the file does not replace or add is the same (no other function added, changed or gone)', (select count(*) from jsonb_object_keys(md5_a))),
    'ok', md5_a = md5_b,
    'changed', (select jsonb_agg(x2.key) from jsonb_each_text(md5_b) x2 where md5_a->>x2.key is distinct from x2.value),
    'gone', (select jsonb_agg(x2.key) from jsonb_each_text(md5_a) x2 where not md5_b ? x2.key));
  select coalesce(jsonb_agg(f2), '[]') into o from unnest(mine) f2 where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = f2);
  res := res || jsonb_build_object('case', 'C1 the 9 replaced and the 2 new functions exist', 'ok', o = '[]'::jsonb, 'missing', o);

  b := combat_v2_action_numbers();
  res := res || jsonb_build_object('case', 'C1 the bundle carries v2_synergy (combat_v2_status_numbers, the root of combat_v2_action_numbers and combat_v2_enemy_numbers)',
    'ok', b ? 'v2_synergy' and combat_v2_enemy_numbers() ? 'v2_synergy' and b->'v2_synergy' = (select value from public.balance where key = 'v2_synergy'));

  -- ========== C3a: the tags of the named cards and one card with no element
  o := '[]'; n := 0;
  for x in select jsonb_build_object('id', c2.id, 'tags', s3.tag_slugs) v from public.cards c2 join public.subjects s3 on s3.id = c2.subject_id
            where c2.id in (94, 99, 227, 335, 355) or c2.id = (select c4.id from public.cards c4 join public.subjects s4 on s4.id = c4.subject_id
                                                               where card_element(s4.tag_slugs) is null and s4.ability_v2 is not null order by c4.id limit 1) order by c2.id loop
    n := n + 1;
    t := combat_v2_card_tags((x->>'id')::bigint);
    el := card_element(array(select jsonb_array_elements_text(x->'tags')));
    want := jsonb_build_object('element', el, 'family', (select q.v from jsonb_array_elements_text(x->'tags') with ordinality q(v, o) where q.v like 'origin:%' order by q.o limit 1),
      'piece', null, 'beats', coalesce((select jsonb_agg(z.target order by z.target) from public.element_counters z where z.beater = el and not z.proposal), '[]'::jsonb));
    if t is distinct from want then o := o || jsonb_build_array(jsonb_build_object('card', x->'id', 'got', t, 'want', want)); end if;
  end loop;
  res := res || jsonb_build_object('case', format('C3a combat_v2_card_tags = card_element, the first origin: slug and the element_counters list (no proposal; a planted proposal fire -> %s) for cards 94, 99, 227, 335, 355 and 1 card with no element (%s cards)', tel, n),
    'ok', n = 6 and o = '[]'::jsonb and (select count(*) from public.element_counters z where z.beater = 'fire' and z.proposal) >= 1, 'bad', o);
  -- a planted subject with 2 families: the FIRST origin: slug
  select s3.id, c2.id into v_subj, v_card from public.cards c2 join public.subjects s3 on s3.id = c2.subject_id where c2.id = 94;
  update public.subjects set tag_slugs = array_remove(array_remove(tag_slugs, 'origin:zz-first'), 'origin:zz-last') where id = v_subj;
  update public.subjects set tag_slugs = array['origin:aa-first'] || array(select q from unnest(tag_slugs) q where q not like 'origin:%') || array['origin:zz-last'] where id = v_subj;
  t := combat_v2_card_tags(v_card);
  res := res || jsonb_build_object('case', 'C3a a planted subject with 2 origin: slugs: family = the first one', 'ok', t->>'family' = 'origin:aa-first', 'got', t);

  -- ========== C3b: the element chart in the hit core (fixed draws: no miss, roll 0.5, no crit)
  ba := b;
  select z.target into el from public.element_counters z where z.beater = 'fire' and not z.proposal
     and not exists (select 1 from public.element_counters y where y.beater = z.target and y.target = 'fire') order by z.target limit 1;
  foe := jsonb_build_object('hp', 100000, 'max', 100000, 'def', 0, 'evasion', 0, 'status', '{}'::jsonb, 'mechanics', '[]'::jsonb);
  at := pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:x', null)));
  at2 := pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg(el, 'origin:x', null)));
  sp := pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:x', null)));
  dr := '[0.99, 0.5, 0.99, 0.99, 0.5, 0.99]'::jsonb;
  ctx := jsonb_build_object('side', 'card', 'draws', dr);
  d1 := (combat_v2_hit(at, foe, ctx, ba)->>'dmg')::numeric;
  r := combat_v2_hit(at, foe || jsonb_build_object('element', el), ctx, ba);
  o := jsonb_build_array(jsonb_build_object('case', 1, 'chart', r->'chart', 'ratio', (r->>'dmg')::numeric / d1, 'ok', (r->>'chart')::boolean and (r->>'dmg')::numeric = d1 * (ba->'v2_synergy'->'chart'->>'bonus')::numeric));
  d1 := (combat_v2_hit(at2, foe, ctx, ba)->>'dmg')::numeric;
  r := combat_v2_hit(at2, foe || jsonb_build_object('element', 'fire'), ctx, ba);
  o := o || jsonb_build_object('case', 2, 'chart', r->'chart', 'ok', not (r->>'chart')::boolean and (r->>'dmg')::numeric = d1);
  r := combat_v2_hit(at, foe, ctx, ba);
  o := o || jsonb_build_object('case', 3, 'chart', r->'chart', 'ok', not (r->>'chart')::boolean and (r->>'dmg')::numeric = d1 * 0 + (combat_v2_hit(at - 'tags', foe, ctx, ba)->>'dmg')::numeric);
  boss := combat_v2_hunt_boss('Heroic', null, '{"start_frac": 1}'::jsonb, ba) || jsonb_build_object('mechanics', '[]'::jsonb, 'evasion', 0);
  r := combat_v2_hit(at, boss, ctx || jsonb_build_object('mode', 'hunt'), ba);
  o := o || jsonb_build_object('case', 4, 'chart', r->'chart', 'ok', not (r->>'chart')::boolean and boss->>'element' is null
     and (r->>'dmg')::numeric = (combat_v2_hit(at - 'tags', boss, ctx || jsonb_build_object('mode', 'hunt'), ba)->>'dmg')::numeric);
  ctx := jsonb_build_object('side', 'card', 'draws', dr, 'x', 1.5, 'true_strike', true);
  d1 := (combat_v2_hit(sp, foe, ctx, ba)->>'dmg')::numeric;
  r := combat_v2_hit(sp, foe || jsonb_build_object('element', el), ctx, ba);
  o := o || jsonb_build_object('case', 5, 'chart', r->'chart', 'ok', (r->>'chart')::boolean and (r->>'dmg')::numeric = d1 * (ba->'v2_synergy'->'chart'->>'bonus')::numeric);
  ctx := jsonb_build_object('side', 'enemy', 'draws', dr);
  foe2 := foe || jsonb_build_object('atk', 100, 'element', el);
  r := combat_v2_hit(foe2, at, ctx, ba); r2 := combat_v2_hit(foe2 - 'element', at - 'tags', ctx, ba);
  o := o || jsonb_build_object('case', 6, 'chart', r->'chart', 'ok', not (r->>'chart')::boolean and (r->>'dmg')::numeric = (r2->>'dmg')::numeric);
  foe2 := foe || jsonb_build_object('atk', 100, 'element', 'fire');
  r := combat_v2_hit(foe2, at2, ctx, ba); r2 := combat_v2_hit(foe2 - 'element', at2 - 'tags', ctx, ba);
  o := o || jsonb_build_object('case', '6b', 'chart', r->'chart', 'ok', not (r->>'chart')::boolean and (r->>'dmg')::numeric = (r2->>'dmg')::numeric);
  res := res || jsonb_build_object('case', format('C3b the chart (fire beats %s): 1 fire vs %s x bonus; 2 the reversed pair x1; 3 no element x1; 4 the Hunt boss x1; 5 a support smite x bonus; 6 enemy hits on a card x1', el, el),
    'ok', not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean), 'cases', o);

  -- ========== C3c: the element synergy on 4 named squads (fire; the other cards have no element)
  o := '[]';
  for k in 1..5 loop
    cards := '{}';
    for i in 1..5 loop
      cards := cards || jsonb_build_object(i::text, pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg(case when i <= k then 'fire' end, 'origin:f' || i, null))));
    end loop;
    s := combat_v2_synergy(pg_temp.st(cards, 'dungeon', null), b);
    got := (select jsonb_agg((s->'cards'->(i2::text)->'syn'->>'elem_x')::numeric order by i2) from generate_series(1, 5) i2);
    want := (select jsonb_agg(case when i2 > k then 1 when k >= 5 then 1.20 when k >= 3 then 1.12 else 1 end order by i2) from generate_series(1, 5) i2);
    o := o || jsonb_build_object('squad', 'a', 'k', k, 'ok', got = want, 'got', got);
  end loop;
  -- (b) 2 fire attackers + 1 fire support + 2 no element; (c) 4 fire attackers + 1 fire support; (d) 2 fire attackers + 1 card with no tags
  cards := jsonb_build_object('1', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:a', null))),
    '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:b', null))),
    '3', pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:c', null))),
    '4', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg(null, 'origin:d', null))),
    '5', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg(null, 'origin:e', null))));
  s := combat_v2_synergy(pg_temp.st(cards, 'dungeon', null), b);
  got := (select jsonb_object_agg(q.key, jsonb_build_array((q.value->'syn'->>'elem_n')::int, (q.value->'syn'->>'elem_x')::numeric)) from jsonb_each(s->'cards') q);
  o := o || jsonb_build_object('squad', 'b', 'ok', got = '{"1": [3, 1.12], "2": [3, 1.12], "3": [3, 1], "4": [0, 1], "5": [0, 1]}'::jsonb, 'got', got);
  cards := '{}';
  for i in 1..4 loop cards := cards || jsonb_build_object(i::text, pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:f' || i, null)))); end loop;
  cards := cards || jsonb_build_object('5', pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:s', null))));
  s := combat_v2_synergy(pg_temp.st(cards, 'dungeon', null), b);
  got := (select jsonb_object_agg(q.key, jsonb_build_array((q.value->'syn'->>'elem_n')::int, (q.value->'syn'->>'elem_x')::numeric)) from jsonb_each(s->'cards') q);
  o := o || jsonb_build_object('squad', 'c', 'ok', got = '{"1": [5, 1.20], "2": [5, 1.20], "3": [5, 1.20], "4": [5, 1.20], "5": [5, 1]}'::jsonb, 'got', got);
  cards := jsonb_build_object('1', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:a', null))),
    '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:b', null))), '3', pg_temp.su('attacker', 'breaker', null));
  s := combat_v2_synergy(pg_temp.st(cards, 'dungeon', null), b);
  got := (select jsonb_object_agg(q.key, jsonb_build_array((q.value->'syn'->>'elem_n')::int, (q.value->'syn'->>'elem_x')::numeric)) from jsonb_each(s->'cards') q);
  o := o || jsonb_build_object('squad', 'd', 'ok', got = '{"1": [2, 1], "2": [2, 1], "3": [0, 1]}'::jsonb, 'got', got);
  res := res || jsonb_build_object('case', 'C3c the element synergy: (a) k = 1..5 fire attackers: 1, 1, 1.12, 1.12, 1.20; (b) a fire support counts (elem_n 3) and has elem_x 1; (c) 5 -> 1.20; (d) a card with no tags does not count',
    'ok', not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean), 'cases', o);

  -- ========== C3d: the affinity (squads of 8)
  o := '[]';
  for k in 0..7 loop
    cards := jsonb_build_object('1', pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg(null, 'origin:fam', null))));
    for i in 2..8 loop
      cards := cards || jsonb_build_object(i::text, pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg(null, case when i - 1 <= k then 'origin:fam' else 'origin:o' || i end, null))));
    end loop;
    s := combat_v2_synergy(pg_temp.st(cards, 'hunt', null), b);
    got := s->'cards'->'1'->'syn';
    o := o || jsonb_build_object('n', k, 'ok', got->>'aff_tag' = 'origin:fam' and (got->>'aff_n')::int = k
      and (got->>'aff_x')::numeric = 1 + least((b->'v2_synergy'->'affinity'->>'cap')::numeric, (b->'v2_synergy'->'affinity'->>'step')::numeric * k)
      and (got->>'aff_x')::numeric = (array[1, 1.1, 1.2, 1.3, 1.3, 1.3, 1.3, 1.3])[k + 1], 'got', got);
  end loop;
  -- the element count is higher (2 other ice, 1 family mate); a tie (1 ice, 1 family mate: the element); an attacker (aff_x 1)
  cards := jsonb_build_object('1', pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg('ice', 'origin:fam', null))),
    '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('ice', 'origin:a', null))),
    '3', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('ice', 'origin:b', null))),
    '4', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg(null, 'origin:fam', null))));
  s := combat_v2_synergy(pg_temp.st(cards, 'hunt', null), b);
  got := s->'cards'->'1'->'syn';
  o := o || jsonb_build_object('n', 'element higher', 'ok', got->>'aff_tag' = 'ice' and (got->>'aff_n')::int = 2 and (got->>'aff_x')::numeric = 1.2, 'got', got);
  o := o || jsonb_build_object('n', 'attacker', 'ok', (s->'cards'->'4'->'syn'->>'aff_x')::numeric = 1 and s->'cards'->'4'->'syn'->>'aff_tag' is null and (s->'cards'->'2'->'syn'->>'aff_x')::numeric = 1,
    'got', s->'cards'->'4'->'syn');
  s := combat_v2_synergy(pg_temp.st(cards - '3', 'hunt', null), b);
  got := s->'cards'->'1'->'syn';
  o := o || jsonb_build_object('n', 'tie', 'ok', got->>'aff_tag' = 'ice' and (got->>'aff_n')::int = 1 and (got->>'aff_x')::numeric = 1.1, 'got', got);
  -- a support whose element no other card has (the 7.2 "ice" defect): the family counts
  s := combat_v2_synergy(pg_temp.st(jsonb_build_object('1', pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg('ice', 'origin:fam', null))),
    '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg(null, 'origin:fam', null)))), 'hunt', null), b);
  got := s->'cards'->'1'->'syn';
  o := o || jsonb_build_object('n', 'lone element', 'ok', got->>'aff_tag' = 'origin:fam' and (got->>'aff_n')::int = 1, 'got', got);
  res := res || jsonb_build_object('case', 'C3d the affinity: aff_x = 1 + min(0.30, 0.10 n) for n = 0..7 other family cards; the element when it has more (and on a tie); an attacker 1',
    'ok', not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean), 'cases', o);

  -- C3d: each support amount block x aff_x (planted syn aff_x 1.30, set_x 1) with the same draws; stacks, chances, durations and draws the same
  o := '[]';
  foe := combat_v2_dungeon_foe((select m2.key from public.dungeon_monsters_v2 m2 order by m2.key limit 1), 1, 1, 'fight', null, b)
         || jsonb_build_object('hp', 100000, 'max', 100000, 'def', 0, 'evasion', 0, 'mechanics', '[]'::jsonb, 'meter', 0);
  -- each case names every number that must scale (review r1 B-1: a number that does not change is not seen, so a missed factor on one of
  -- two numbers passed): the scaled paths (and hits) must be exactly this list, each x 1.30
  for x in select v from jsonb_array_elements(${lit(JSON.stringify(C3D_CASES))}::jsonb) v loop
    blk := x->'b';
    cards := jsonb_build_object('1', pg_temp.su('support', 'herald', jsonb_build_object('active', jsonb_build_object('blocks', blk))),
      '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('hp', 300)), '3', pg_temp.su('attacker', 'striker', jsonb_build_object('hp', 300)));
    s := pg_temp.st(cards, 'dungeon', jsonb_build_array(foe, foe));
    dr := (select jsonb_agg(0.3) from generate_series(1, 40));
    r := combat_v2_card_act(s, '{"side": "card", "id": 1}'::jsonb, jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', 0),
      'ally', jsonb_build_object('side', 'card', 'id', 2), 'draws', dr), b);
    s2 := jsonb_set(s, '{cards,1,syn}', '{"aff_x": 1.30, "set_x": 1}'::jsonb);
    r2 := combat_v2_card_act(s2, '{"side": "card", "id": 1}'::jsonb, jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', 0),
      'ally', jsonb_build_object('side', 'card', 'id', 2), 'draws', dr), b);
    -- every number that changed: its ratio; every other key the same
    got := pg_temp.syn_ratios(s, r, r2);
    want := coalesce((select jsonb_agg(p order by p) from jsonb_array_elements_text(x->'e') p), '[]'::jsonb);
    t := coalesce((select jsonb_agg(coalesce(q->>'path', 'hit ' || (q->>'hit')) order by coalesce(q->>'path', 'hit ' || (q->>'hit'))) from jsonb_array_elements(got->'ratios') q), '[]'::jsonb);
    o := o || jsonb_build_object('blocks', blk, 'ok', (got->>'ok')::boolean and t = want
      and not exists (select 1 from jsonb_array_elements(got->'ratios') q where (q->>'r')::numeric <> 1.30), 'scaled', t, 'want', want, 'got', got);
    -- review r3 R3-1: the same case with set_x 1.10 (aff_x 1): the same paths, each x 1.10 (the set_x part of sf at the crd, apply and
    -- random_apply lines; with aff_x 1.30 and set_x 1 a site that uses sa in place of sf gives the same result)
    r2 := combat_v2_card_act(jsonb_set(s, '{cards,1,syn}', '{"aff_x": 1, "set_x": 1.10}'::jsonb), '{"side": "card", "id": 1}'::jsonb, jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', 0),
      'ally', jsonb_build_object('side', 'card', 'id', 2), 'draws', dr), b);
    got := pg_temp.syn_ratios(s, r, r2);
    t := coalesce((select jsonb_agg(coalesce(q->>'path', 'hit ' || (q->>'hit')) order by coalesce(q->>'path', 'hit ' || (q->>'hit'))) from jsonb_array_elements(got->'ratios') q), '[]'::jsonb);
    o := o || jsonb_build_object('set_x', 1.10, 'blocks', blk, 'ok', (got->>'ok')::boolean and t = want
      and not exists (select 1 from jsonb_array_elements(got->'ratios') q where (q->>'r')::numeric <> 1.10), 'scaled', t, 'want', want, 'got', got);
  end loop;
  -- the chance is not scaled (M3i): every draw 0.6 (0.5 <= 0.6 < 0.5 x 1.30), so the status lands in neither run
  for blk in select v from jsonb_array_elements(${lit(JSON.stringify([
    [{ k: 'apply', status: 'exposed', chance: 0.5, value: 0.2 }], [{ k: 'random_apply', chance: 0.5, options: [{ status: 'exposed', value: 0.2 }, { status: 'weakened', value: 0.1 }] }],
  ]))}::jsonb) v loop
    cards := jsonb_build_object('1', pg_temp.su('support', 'herald', jsonb_build_object('active', jsonb_build_object('blocks', blk))),
      '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('hp', 300)), '3', pg_temp.su('attacker', 'striker', jsonb_build_object('hp', 300)));
    s := pg_temp.st(cards, 'dungeon', jsonb_build_array(foe, foe));
    dr := (select jsonb_agg(0.6) from generate_series(1, 40));
    r := combat_v2_card_act(s, '{"side": "card", "id": 1}'::jsonb, jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', 0),
      'ally', jsonb_build_object('side', 'card', 'id', 2), 'draws', dr), b);
    r2 := combat_v2_card_act(jsonb_set(s, '{cards,1,syn}', '{"aff_x": 1.30, "set_x": 1}'::jsonb), '{"side": "card", "id": 1}'::jsonb,
      jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', 0), 'ally', jsonb_build_object('side', 'card', 'id', 2), 'draws', dr), b);
    got := pg_temp.syn_ratios(s, r, r2);
    o := o || jsonb_build_object('blocks', blk, 'draw', 0.6, 'ok', got->'bad' = '[]'::jsonb and got->'ratios' = '[]'::jsonb
      and r->'state'->'enemies'->0->'status' is not distinct from foe->'status', 'got', got);
  end loop;
  res := res || jsonb_build_object('case', 'C3d every support amount block (shield, shield_all, heal, heal_all, empower, rally, focus value and crd, quicken, smite, area, apply exposed, random_apply value) x aff_x 1.30 exactly, and x set_x 1.10 exactly (aff_x 1); stacks, chances, durations and the draw list the same; a draw of 0.6 lands no status (chance 0.5) with aff_x 1.30',
    'ok', not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean), 'cases', o);

  -- ========== C3e: the set synergy on synthetic subjects (set values 1.05 / 1.10 / 1.15 in this block)
  update public.balance set value = jsonb_set(jsonb_set(jsonb_set(value, '{sets,forbidden_pride,small}', '1.05'), '{sets,forbidden_pride,big}', '1.10'), '{sets,forbidden_pride,top}', '1.15')
   where key = 'v2_synergy';
  b := combat_v2_action_numbers();
  for i in 1..8 loop
    -- the trigger subjects_flatten_tags rebuilds tag_slugs from tags on insert and on an update of tags: plant tags
    insert into public.subjects (key, name, type, tags)
      values (case when i = 8 then 'ottozone-s-head' else 'syn-test-piece-' || i end, 'SYN test piece ' || i, 'Item', '{"traits": ["forbidden-pride"], "origin": "community"}'::jsonb)
      on conflict (key) do update set tags = excluded.tags returning id into v_subj;
    insert into public.cards (subject_id, name, rarity, set_id, set_number) values (v_subj, 'SYN test ' || i, 'normal', (select min(c5.set_id) from public.cards c5), 90000 + i) returning id into v_card;
    pieces := pieces || v_card;
  end loop;
  insert into public.cards (subject_id, name, rarity, set_id, set_number) select subject_id, 'SYN test 1 b', 'gold', set_id, 90099 from public.cards where id = pieces[1] returning id into v_card;
  o := '[]';
  -- 2 finishes of one subject + 1 other piece = 2 pieces (below small_at 3)
  s := combat_v2_synergy(pg_temp.st(jsonb_build_object('1', pg_temp.su('support', 'herald', jsonb_build_object('tags', combat_v2_card_tags(pieces[1]))),
    '2', pg_temp.su('support', 'herald', jsonb_build_object('tags', combat_v2_card_tags(v_card))), '3', pg_temp.su('support', 'herald', jsonb_build_object('tags', combat_v2_card_tags(pieces[2])))), 'hunt', null), b);
  o := o || jsonb_build_object('n', '2 finishes of one subject + 1 = 2 pieces', 'ok', (s->'cards'->'1'->'syn'->>'set_n')::int = 2 and (s->'cards'->'1'->'syn'->>'set_x')::numeric = 1,
    'got', s->'cards'->'1'->'syn', 'tags', combat_v2_card_tags(v_card));
  -- pieces[1..7] are not the head, pieces[8] is the head subject
  for x in select v from jsonb_array_elements('[{"ids": [1, 2, 3], "mode": "hunt", "x": 1.05}, {"ids": [1, 2, 3, 4, 5], "mode": "dungeon", "x": 1.10},
      {"ids": [2, 3, 4, 5, 6, 7, 8], "mode": "hunt", "x": 1.15}, {"ids": [1, 2, 3, 4, 5, 6, 7], "mode": "hunt", "x": 1.10},
      {"ids": [2, 3, 4, 5, 6, 7, 8], "mode": "gauntlet", "x": 1.10}, {"ids": [2, 3, 4, 5, 6, 7, 8], "mode": "dungeon", "x": 1.10}]'::jsonb) v loop
    cards := jsonb_build_object('9', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:x', null))));
    for i in 1..jsonb_array_length(x->'ids') loop
      cards := cards || jsonb_build_object(i::text, pg_temp.su('support', 'herald', jsonb_build_object('tags', combat_v2_card_tags(pieces[(x->'ids'->>(i - 1))::int]))));
    end loop;
    s := combat_v2_synergy(pg_temp.st(cards, x->>'mode', null), b);
    o := o || jsonb_build_object('n', x, 'ok', (s->'cards'->'1'->'syn'->>'set_n')::int = jsonb_array_length(x->'ids') and (s->'cards'->'1'->'syn'->>'set_x')::numeric = (x->>'x')::numeric
      and (s->'cards'->'9'->'syn'->>'set_x')::numeric = (x->>'x')::numeric, 'got', s->'cards'->'1'->'syn', 'attacker', s->'cards'->'9'->'syn');
  end loop;
  res := res || jsonb_build_object('case', 'C3e the set synergy: distinct pieces; 3 -> 1.05; 5 -> 1.10; 7 with the head in the Hunt -> 1.15; 7 with no head, or in the Gauntlet or the Dungeon -> 1.10; an attacker the same set_x as a support',
    'ok', not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean) and (select bool_and(combat_v2_card_tags(q)->>'piece' is not null) from unnest(pieces) q), 'cases', o);
  update public.balance set value = jsonb_set(jsonb_set(jsonb_set(value, '{sets,forbidden_pride,small}', '1'), '{sets,forbidden_pride,big}', '1'), '{sets,forbidden_pride,top}', '1')
   where key = 'v2_synergy';
  b := combat_v2_action_numbers();

  -- ========== C3f: the state check, the purity and the balance shape
  s := combat_v2_synergy(pg_temp.st(jsonb_build_object('1', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:a', null))),
    '2', pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg(null, 'origin:a', null)))), 'gauntlet', jsonb_build_array(foe || jsonb_build_object('element', el))), b);
  res := res || jsonb_build_object('case', 'C3f fight_state_check_v2 accepts a state after combat_v2_synergy (unit keys tags, syn, element)', 'ok', cardinality(fight_state_check_v2(s)) = 0, 'got', fight_state_check_v2(s));
  perform setseed(0.25); d1 := random(); perform setseed(0.25); perform combat_v2_synergy(s, b); d2 := random();
  res := res || jsonb_build_object('case', 'C3f combat_v2_synergy draws no random number (the next random() after setseed is the same) and is IMMUTABLE', 'ok', d1 = d2
    and (select p.provolatile = 'i' from pg_proc p where p.oid = 'public.combat_v2_synergy(jsonb, jsonb)'::regprocedure));
  o := '[]';
  for x in select v from jsonb_array_elements(${lit(JSON.stringify([
    ['a missing leaf', "value #- '{chart,bonus}'", 'chart.bonus'],
    ['step 0.5', "jsonb_set(value, '{affinity,step}', '0.5')", 'affinity.step'],
    ['small_at above big_at', "jsonb_set(value, '{element,small_at}', '6')", 'small_at must not be above big_at'],
    ['a set small_at above big_at', "jsonb_set(value, '{sets,forbidden_pride,small_at}', '6')", 'small_at <= big_at <= top_at'],
    ['an extra leaf', "jsonb_set(value, '{chart,penalty}', '1')", 'penalty'],
    ['another head', "jsonb_set(value, '{sets,forbidden_pride,head}', '\"x\"')", 'head'],
  ]))}::jsonb) v loop
    begin
      execute format('update public.balance set value = %s where key = ''v2_synergy''', x->>1);
      o := o || to_jsonb('accepted: ' || (x->>0));
    exception when others then
      if position(x->>2 in sqlerrm) = 0 then o := o || to_jsonb('refused for another reason: ' || (x->>0) || ': ' || sqlerrm); end if;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'C3f the balance trigger refuses 6 bad v2_synergy values, each with its own text', 'ok', o = '[]'::jsonb, 'got', o);
  res := res || jsonb_build_object('case', 'C3f the key v2_synergy has a note and the section 9 values', 'ok',
    (select length(note) > 100 and value = '{"element": {"small_at": 3, "big_at": 5, "small": 1.12, "big": 1.20}, "chart": {"bonus": 1.25}, "affinity": {"step": 0.10, "cap": 0.30}, "sets": {"forbidden_pride": {"small_at": 3, "big_at": 5, "top_at": 7, "small": 1, "big": 1, "top": 1, "head": "ottozone-s-head"}}}'::jsonb
       from public.balance where key = 'v2_synergy'));

  -- ========== C3g: the card unit (with tags) = the Lab unit for every card with an ability_v2
  o := '[]'; n := 0; m := 0;
  for x in select jsonb_build_object('id', c2.id, 'card_id', c2.id, 'rarity', c2.rarity::text, 'cp_mod', to_jsonb(coalesce(s3.cp_mod, 1)), 'role', s3.ability_v2->>'role', 'blocks', s3.ability_v2->'blocks') v
             from public.cards c2 join public.subjects s3 on s3.id = c2.subject_id where ${OK_V2} order by c2.id loop
    lab := pg_temp.lab_unit(x, b);
    u := combat_v2_card_unit((x->>'id')::bigint);
    n := n + 1;
    if u is distinct from lab or jsonb_typeof(u->'tags'->'beats') is distinct from 'array' then m := m + 1; if jsonb_array_length(o) < 3 then o := o || jsonb_build_array(jsonb_build_object('card', x->'id', 'diff',
      (select jsonb_object_agg(q.key, jsonb_build_array(lab->q.key, u->q.key)) from (select jsonb_object_keys(lab) key union select jsonb_object_keys(u)) q where lab->q.key is distinct from u->q.key))); end if; end if;
  end loop;
  res := res || jsonb_build_object('case', format('C3g the card unit with tags = the Lab unit (fightSql, read from the file) for every card with an ability_v2 (%s cards)', n),
    'ok', n > 300 and m = 0, 'differ', m, 'first', o);

  -- ========== C3h: elem_x and set_x in the hit core (planted syn 1.12 and 1.10 = x1.232), the same draws, a foe with no element
  dr := '[0.99, 0.5, 0.99, 0.99, 0.5, 0.99]'::jsonb;
  foe := jsonb_build_object('hp', 100000, 'max', 100000, 'def', 0, 'evasion', 0, 'status', '{}'::jsonb, 'mechanics', '[]'::jsonb);
  at := pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:x', null)));
  at2 := at || jsonb_build_object('syn', '{"elem_x": 1.12, "set_x": 1.10, "aff_x": 1}'::jsonb);
  o := '[]';
  for x in select v from jsonb_array_elements('[{"n": "basic", "c": {"basic": true}}, {"n": "active hit", "c": {"x": 1.4}}, {"n": "area", "c": {"x": 0.5, "kind": "area"}}]'::jsonb) v loop
    ctx := jsonb_build_object('side', 'card', 'draws', dr) || (x->'c');
    r := combat_v2_hit(at2, foe, ctx, b); r2 := combat_v2_hit(at, foe, ctx, b);
    o := o || jsonb_build_object('n', x->'n', 'ok', (r->>'dmg')::numeric = (r2->>'dmg')::numeric * 1.232 and not (r->>'chart')::boolean, 'ratio', (r->>'dmg')::numeric / (r2->>'dmg')::numeric);
  end loop;
  ctx := jsonb_build_object('side', 'enemy', 'draws', dr);
  foe2 := foe || jsonb_build_object('atk', 100);
  r := combat_v2_hit(foe2, at2, ctx, b); r2 := combat_v2_hit(foe2, at, ctx, b);
  o := o || jsonb_build_object('n', 'enemy hit on the planted card', 'ok', (r->>'dmg')::numeric = (r2->>'dmg')::numeric, 'ratio', (r->>'dmg')::numeric / (r2->>'dmg')::numeric);
  sp := pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg(null, 'origin:x', null)));
  ctx := jsonb_build_object('side', 'card', 'draws', dr, 'basic', true);
  r := combat_v2_hit(sp || jsonb_build_object('syn', '{"elem_x": 1, "aff_x": 1.30, "set_x": 1}'::jsonb), foe, ctx, b); r2 := combat_v2_hit(sp, foe, ctx, b);
  o := o || jsonb_build_object('n', '4 a support basic hit with aff_x 1.30', 'ok', (r->>'dmg')::numeric = (r2->>'dmg')::numeric, 'ratio', (r->>'dmg')::numeric / (r2->>'dmg')::numeric);
  begin
    ctx := jsonb_build_object('side', 'card', 'draws', dr, 'basic', true);
    r := combat_v2_hit(at2, foe, ctx); r2 := combat_v2_hit(at2, foe, ctx, b);
    o := o || jsonb_build_object('n', '5 the 3-argument hit', 'ok', (r->>'dmg')::numeric = (r2->>'dmg')::numeric, 'dmg', r->'dmg');
  exception when others then o := o || jsonb_build_object('n', '5 the 3-argument hit', 'ok', false, 'error', sqlerrm);
  end;
  begin
    perform combat_v2_hit(at, foe, ctx, b - 'v2_synergy');
    o := o || jsonb_build_object('n', 'a bundle with no v2_synergy raises', 'ok', false);
  exception when others then o := o || jsonb_build_object('n', 'a bundle with no v2_synergy raises', 'ok', position('v2_synergy' in sqlerrm) > 0);
  end;
  res := res || jsonb_build_object('case', 'C3h the hit core: basic, active hit and area x1.232 (elem_x 1.12 x set_x 1.10) with the same draws; the enemy hit x1; a support basic hit with aff_x 1.30 x1; the 3-argument hit the same; no v2_synergy raises',
    'ok', not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean), 'cases', o);

  -- ========== C3i: one set_x on a support smite, area and shield (combat_v2_card_act; set_x 1.10)
  foe := combat_v2_dungeon_foe((select m2.key from public.dungeon_monsters_v2 m2 order by m2.key limit 1), 1, 1, 'fight', null, b)
         || jsonb_build_object('hp', 100000, 'max', 100000, 'def', 0, 'evasion', 0, 'mechanics', '[]'::jsonb, 'meter', 0);
  o := '[]';
  for blk in select v from jsonb_array_elements('[[{"k": "smite", "x": 1}, {"k": "area", "x": 0.5}], [{"k": "shield", "v": 0.1}]]'::jsonb) v loop
    cards := jsonb_build_object('1', pg_temp.su('support', 'herald', jsonb_build_object('active', jsonb_build_object('blocks', blk))),
      '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('hp', 300)));
    s := pg_temp.st(cards, 'dungeon', jsonb_build_array(foe, foe));
    dr := (select jsonb_agg(0.3) from generate_series(1, 40));
    r := combat_v2_card_act(s, '{"side": "card", "id": 1}'::jsonb, jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', 0),
      'ally', jsonb_build_object('side', 'card', 'id', 2), 'draws', dr), b);
    r2 := combat_v2_card_act(jsonb_set(s, '{cards,1,syn}', '{"aff_x": 1, "set_x": 1.10}'::jsonb), '{"side": "card", "id": 1}'::jsonb,
      jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', 0), 'ally', jsonb_build_object('side', 'card', 'id', 2), 'draws', dr), b);
    got := pg_temp.syn_ratios(s, r, r2);
    o := o || jsonb_build_object('blocks', blk, 'ok', (got->>'ok')::boolean and (got->'ratios') <> '[]'::jsonb
      and not exists (select 1 from jsonb_array_elements(got->'ratios') q where (q->>'r')::numeric <> 1.10), 'got', got);
  end loop;
  res := res || jsonb_build_object('case', 'C3i one set_x (1.10) on a support smite and its area (the hit core) and on a shield (the active): x1.10 exactly, never 1.21',
    'ok', not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean), 'cases', o);

  -- ========== C3k: a card with no tags
  select z.target into el from public.element_counters z where z.beater = 'fire' and not z.proposal order by z.target limit 1;
  cards := jsonb_build_object('1', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:a', null))),
    '2', pg_temp.su('attacker', 'breaker', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:b', null))),
    '3', pg_temp.su('support', 'herald', jsonb_build_object('tags', pg_temp.tg('fire', 'origin:c', null))),
    '4', pg_temp.su('attacker', 'breaker', null));
  s := combat_v2_synergy(pg_temp.st(cards, 'gauntlet', null), b);
  foe := jsonb_build_object('hp', 100000, 'max', 100000, 'def', 0, 'evasion', 0, 'status', '{}'::jsonb, 'mechanics', '[]'::jsonb, 'element', el);
  ctx := jsonb_build_object('side', 'card', 'draws', '[0.99, 0.5, 0.99]'::jsonb, 'basic', true);
  r := combat_v2_hit(s->'cards'->'4', foe, ctx, b); r2 := combat_v2_hit(s->'cards'->'4', foe - 'element', ctx, b);
  t := combat_v2_hit(s->'cards'->'1', foe, ctx, b);
  res := res || jsonb_build_object('case', 'C3k a card with no tags: every factor 1, no count from it (the fire cards elem_n 3), its hit chart false and the base dmg; a fire hit on the same foe chart true',
    'ok', (s->'cards'->'4'->'syn'->>'elem_x')::numeric = 1 and (s->'cards'->'4'->'syn'->>'aff_x')::numeric = 1 and (s->'cards'->'4'->'syn'->>'set_x')::numeric = 1
      and (select bool_and((s->'cards'->q->'syn'->>'elem_n')::int = 3) from unnest(array['1', '2', '3']) q) and (s->'cards'->'1'->'syn'->>'elem_x')::numeric = 1.12
      and not (r->>'chart')::boolean and (r->>'dmg')::numeric = (r2->>'dmg')::numeric and (t->>'chart')::boolean,
    'syn', s->'cards'->'4'->'syn', 'fire', s->'cards'->'1'->'syn');

  -- ========== C3j: the R1b room start calls the synergy (gauntlet_v2_fight; the fight rooms of the week 2026-10-25, each read at its FIRST
  -- choose; a room that ends before a card turn is skipped; at least 2 rooms, one of them not room 1 of its floor)
  execute $o$${OLD_FIGHT}$o$;
  create function pg_temp.nosyn(s jsonb) returns jsonb language sql as $x$
    select jsonb_set(s, '{cards}', coalesce((select jsonb_object_agg(q.key, q.value - 'syn') from jsonb_each(s->'cards') q), '{}'::jsonb)) $x$;
  select g.* into wk from public.gauntlet_weeks g where g.week = '2026-10-25';
  un := '{}';
  for i in 1..cardinality(wk.squad) loop
    begin un := un || jsonb_build_object(wk.squad[i]::text, combat_v2_card_unit(wk.squad[i]::bigint)); exception when others then null; end;
  end loop;
  st0 := jsonb_build_object('engine', '2'::jsonb, 'mode', 'gauntlet',
    'squad', (select jsonb_agg(z.q::bigint order by z.o) from unnest(wk.squad) with ordinality z(q, o) where un ? z.q::text), 'units', un,
    'carry', (select jsonb_object_agg(e.key, jsonb_build_object('hp', e.value->'hp', 'max', e.value->'max', 'down', false, 'charge', e.value->'charge', 'held', e.value->'held')) from jsonb_each(un) e),
    'info', gauntlet_v2_info(un));
  ba := combat_v2_enemy_numbers();   -- the R1b bundle (gauntlet_v2_enter)
  o := '[]'; nread := 0; k := 0;
  for x in select jsonb_build_object('room', rv.v, 'fl', fv.o, 'rm', rv.o) from jsonb_array_elements(wk.floors) with ordinality fv(v, o), jsonb_array_elements(fv.v) with ordinality rv(v, o)
            where rv.v->>'type' in ('fight', 'horde', 'elite', 'miniboss', 'guardian') order by fv.o, rv.o loop
    k := k + 1; exit when k > 8 or nread >= 3;
    perform setseed(0.31 + k / 100.0);
    f1 := gauntlet_v2_fight(st0 || jsonb_build_object('room_type', x->'room'->>'type'), x->'room', (x->>'fl')::int, (x->>'rm')::int, ba);
    r := combat_v2_step(f1, null, ba);
    perform setseed(0.31 + k / 100.0);
    f0 := pg_temp.o_fight(st0 || jsonb_build_object('room_type', x->'room'->>'type'), x->'room', (x->>'fl')::int, (x->>'rm')::int, ba);
    r2 := combat_v2_step(f0, null, ba);
    continue when r->>'event' is distinct from 'choose' and r2->>'event' is distinct from 'choose';
    nread := nread + 1;
    got := (select jsonb_object_agg(q.key, q.value->'syn') from jsonb_each(r->'state'->'cards') q);
    want := (select jsonb_object_agg(q.key, q.value->'syn') from jsonb_each(combat_v2_synergy(f1, ba)->'cards') q);
    o := o || jsonb_build_object('floor', x->'fl', 'room', x->'rm', 'event', r->'event', 'ok', got = want
      and not exists (select 1 from jsonb_each(got) q where jsonb_typeof(q.value) is distinct from 'object')
      and pg_temp.nosyn(f1) = f0 and pg_temp.nosyn(r->'state') = r2->'state' and (r - 'state') = (r2 - 'state'),
      'syn_ok', got = want, 'state_ok', pg_temp.nosyn(f1) = f0, 'step_ok', pg_temp.nosyn(r->'state') = r2->'state' and (r - 'state') = (r2 - 'state'),
      'first_syn', (select q.value from jsonb_each(got) q limit 1));
  end loop;
  select md5(replace(regexp_replace(pg_get_functiondef('public.gauntlet_v2_fight(jsonb, jsonb, integer, integer, jsonb)'::regprocedure), '\n[^\n]*-- SYN[^\n]*', '', 'g'), chr(13), '')),
         (length(pg_get_functiondef('public.gauntlet_v2_fight(jsonb, jsonb, integer, integer, jsonb)'::regprocedure)) - length(replace(pg_get_functiondef('public.gauntlet_v2_fight(jsonb, jsonb, integer, integer, jsonb)'::regprocedure), '-- SYN', ''))) / 6
    into e, n;
  res := res || jsonb_build_object('case', format('C3j the R1b room start gauntlet_v2_fight: each card syn = combat_v2_synergy of the room state, the room state and the first step without syn = the R1b text with the same seed (%s rooms read); its text minus its one SYN line = the R1b text (md5)', nread),
    'ok', nread >= 2 and exists (select 1 from jsonb_array_elements(o) q where (q->>'room')::int <> 1) and not exists (select 1 from jsonb_array_elements(o) q where not (q->>'ok')::boolean)
      and e = ${lit(FIGHT_OLD_MD5)} and n = 1, 'md5_minus_line', e, 'syn_lines', n, 'rooms', o);

  -- ========== the rest: server only, comments, idempotent
  select coalesce(jsonb_agg(${SIG} || ' ' || r3), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated']) r3
   where p.pronamespace = 'public'::regnamespace and ${SIG} = any(${arr(NEW)}) and has_function_privilege(r3, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'C5 server only: anon and authenticated cannot run the 2 new functions; a [combat] comment on each', 'ok', o = '[]'::jsonb
    and (select bool_and(coalesce(obj_description(p.oid, 'pg_proc'), '') like '[combat]%combat_v2_synergy.sql.') from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(${arr(NEW)})), 'got', o);
  ${MUTATING ? '' : String.raw`select jsonb_object_agg(${SIG}, ${MD5}) into md5_b from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine);
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'C5 idempotent: the file runs a second time (its guard accepts its own text) and changes no function', 'ok',
    md5_b = (select jsonb_object_agg(${SIG}, ${MD5}) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)));`}
  raise exception 'RESULT:%', res::text;
end $t$;`;

const txt = await runBlock(body);
const rows = JSON.parse(txt);
// C3g (review r1 B-2): the Lab fight (fightSql, the file text) calls combat_v2_synergy exactly once, after the state is built and before the
// turn order and the fight
{
  const a = LAB_SRC.indexOf('export function fightSql('), z = LAB_SRC.indexOf('\nexport function ', a + 1);
  const fs2 = a < 0 ? '' : LAB_SRC.slice(a, z < 0 ? undefined : z);
  const call = 's := combat_v2_synergy(s, b);';
  const i = fs2.indexOf(call), built = fs2.indexOf("  s := jsonb_build_object('v', 2,"), order = fs2.indexOf('combat_v2_turn_order(s'), fight = fs2.indexOf('pg_temp.v2lab_fight(s');
  const n = fs2.split('combat_v2_synergy(').length - 1;
  rows.splice(rows.findIndex((r) => String(r.case).startsWith('C3h')), 0, { case: 'C3g the Lab fight (fightSql) calls combat_v2_synergy exactly once, after the state is built and before the turn order and the fight',
    ok: n === 1 && built >= 0 && i > built && order > i && fight > i, calls: n, at: { built, call: i, order, fight } });
}
let fails = 0;
for (const r of rows) {
  const ok = r.ok === true;
  if (!ok) fails++;
  const extra = ok ? '' : `  ${JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['case', 'ok'].includes(k)))).slice(0, process.env.SYN_FULL ? 1e7 : 2500)}`;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.case}${extra}`);
}
console.log(fails ? `FAILED: ${fails} of ${rows.length} cases` : `PASS all ${rows.length} cases`);
process.exit(fails ? 1 : 0);
