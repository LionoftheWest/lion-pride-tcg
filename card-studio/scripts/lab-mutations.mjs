/**
 * A mutation: a one-place change of a live function, for the acceptance tests of the Combat Lab and of the golden tests (F-3 acceptance
 * test 2: "a planted infinite loop (a mutation) makes the Combat Lab fail"). The text of the function comes from the schema snapshot
 * (db/schema/functions, the live text); the change is made with a string replace that MUST find its text (a mutation that changes
 * nothing is an error, not a pass). The result is an SQL file in the temp folder: LAB_MUTATE=<file> for the Lab, CANDIDATE=<file> for a golden test.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export function mutationFile(name, file, from, to, pre = '') {   // pre: SQL run before the function text (undone with the request)
  const src = readFileSync(join(ROOT, 'db', 'schema', 'functions', `${file}.sql`), 'utf8').replace(/\r/g, '');
  if (!src.includes(from)) throw new Error(`mutation ${name}: the text is not in ${file}.sql:\n${from}`);
  const out = src.split(from).join(to);   // every place
  if (out === src) throw new Error(`mutation ${name}: nothing changed`);
  const dir = join(tmpdir(), 'lab-mutations'); mkdirSync(dir, { recursive: true });
  const f = join(dir, `${name}.sql`);
  writeFileSync(f, pre ? `${pre}
${out}` : out);
  return f;
}

/** The mutations of the Combat Lab. `expect` = the finding classes of which one must appear as a NEW failure. */
export const LAB_MUTATIONS = [
  { name: 'cooldown-0', sections: 'data', expect: ['COOLDOWN'], what: 'combat_cooldown can return 0 (a support with a cooldown of 0)',
    file: 'combat_cooldown', from: 'greatest(1, round(coalesce(p_raw, 1) * coalesce(p_haste, 1)))::int', to: 'greatest(0, round(coalesce(p_raw, 1) * coalesce(p_haste, 1)))::int' },
  { name: 'infinite-loop', sections: 'dungeon', expect: ['LOOP'], what: 'dungeon_attack never returns (a busy loop)',
    file: 'dungeon_attack', from: "begin\n  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  select * into r from dungeon_runs",
    to: "begin\n  loop null; end loop;\n  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  select * into r from dungeon_runs" },
  { name: 'foes-heal-everything', sections: 'dungeon', expect: ['LOOP', 'LOCK'], what: 'every foe heals to full HP each round: a fight that cannot end, a heal larger than all damage',
    // pre: live has a foe heal cap (balance dungeon.foe_heal_cap, a pick of Nathan) that limits this very heal; the mutation puts the no-cap value (0) in
    // the request, so it proves the Lab catches a heal larger than all damage whatever the live pick is.
    pre: `update public.balance set value = value || '{"foe_heal_cap": 0}'::jsonb where key = 'dungeon';`,
    file: 'dungeon_enemy_turn', from: "v_heal := (act->>'heal')::int;", to: "v_heal := (f->>'max')::int;" },
  { name: 'negative-hp', sections: 'dungeon', expect: ['INVARIANT'], what: 'the HP of a card can go below 0 (the floor is removed from the enemy turn)',
    file: 'dungeon_enemy_turn', from: "'hp', greatest(0, (c->>'hp')::int - v_d));", to: "'hp', (c->>'hp')::int - v_d);" },
  { name: 'hunt-negative-hp', sections: 'rewards', expect: ['INVARIANT'], what: 'the HP of a Hunt card can go below 0 (the floor is removed from hunt_attack)',
    file: 'hunt_attack', from: 'v_cardhp := greatest(0, v_cardhp - v_cdmg);', to: 'v_cardhp := v_cardhp - v_cdmg;' },
  { name: 'prize-paid-twice', sections: 'rewards', expect: ['REWARD', 'INVARIANT'], what: 'settle_hunt pays each prize twice',
    file: 'settle_hunt', from: "if v_packs > 0 then perform grant_packs(r.player_id, v_packs, 'hunt_reward', null, 'hunt', p_hunt::text); end if;",
    to: "if v_packs > 0 then perform grant_packs(r.player_id, v_packs, 'hunt_reward', null, 'hunt', p_hunt::text); perform grant_packs(r.player_id, v_packs, 'hunt_reward', null, 'hunt', p_hunt::text); end if;" },
];

/** The mutations of the golden tests. `golden` = 'dungeon' or 'hunt'. */
export const GOLDEN_MUTATIONS = [
  { name: 'dg-hit-plus-1', golden: 'dungeon', what: 'a Dungeon hit does 1 more damage', file: 'dungeon_attack', from: 'v_dmg := greatest(1, round(v_dmg * (st->>\'buff\')::numeric', to: 'v_dmg := 1 + greatest(1, round(v_dmg * (st->>\'buff\')::numeric' },
  { name: 'dg-support-cooldown', golden: 'dungeon', what: 'a support cooldown is 1 round shorter', file: 'dungeon_support', from: "st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + v_cd));", to: "st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + greatest(1, v_cd - 1)));" },
  { name: 'dg-gauntlet-stars', golden: 'dungeon', what: 'the Gauntlet uses the stars and stat points of the member (the 0-star rule is broken)',
    file: 'dungeon_run_card', from: "case when p_card = any(p_run.squad) then dungeon_card_base(p_card) end", to: "case when p_card = any(p_run.squad) then dungeon_card(p_run.player_id, p_card) end" },
  { name: 'dg-poison', golden: 'dungeon', what: 'poison deals 1 more damage', file: 'dungeon_enemy_turn', from: "c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - p));", to: "c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - p - 1));" },
  // F-3 4e (f3_engine_cleanup.sql): the hits of a Flurry and the rounds of a poison are balance pool_moves numbers now; the reads must matter.
  { name: 'dg-flurry-hits', golden: 'dungeon', what: 'a Flurry hits 1 more time', file: 'combat_pool_act', from: "v_hits := (m2->>'flurry_hits')::int;", to: "v_hits := (m2->>'flurry_hits')::int + 1;" },
  { name: 'dg-poison-rounds', golden: 'dungeon', what: 'a poison lasts 1 round less', file: 'dungeon_enemy_turn', from: "v_round + balance_num('pool_moves', 'poison_rounds')::int)", to: "v_round + balance_num('pool_moves', 'poison_rounds')::int - 1)" },
  { name: 'dg-guardian-pay', golden: 'dungeon', what: 'a run pays 1 Shard less', file: 'dungeon_settle', from: "if v_sh > 0 then perform grant_shards(r.player_id, v_sh, 'dungeon', 'run', r.id::text); end if;", to: "if v_sh > 1 then perform grant_shards(r.player_id, v_sh - 1, 'dungeon', 'run', r.id::text); end if;" },
  // F-3 4d (f3_engine_hunt.sql): the Hunt hit is combat_hit_core (combat_hit is a wrapper that no fight calls), and the heal and the shield are steps of the
  // engine (combat_effect_use; f3_engine_cleanup.sql dropped the old combat_support_value).
  { name: 'hunt-hit-plus-1', golden: 'hunt', what: 'a Hunt hit does 1 more damage', file: 'combat_hit_core', from: 'v_dmg := greatest(1, round(v_base));', to: 'v_dmg := greatest(1, round(v_base)) + 1;' },
  { name: 'hunt-cooldown', golden: 'hunt', what: 'combat_cooldown adds 1 round', file: 'combat_cooldown', from: 'greatest(1, round(coalesce(p_raw, 1) * coalesce(p_haste, 1)))::int', to: '1 + greatest(1, round(coalesce(p_raw, 1) * coalesce(p_haste, 1)))::int' },
  // A heal that is 1 HP larger: caught since F-3 PR 4.0 (combat-golden.mjs has fights where the heal goes to the most hurt card; before, no fight healed a damaged card: the gap found 2026-10-14).
  { name: 'hunt-heal-plus-1', golden: 'hunt', what: 'a heal is 1 HP larger', file: 'combat_effect_use', from: "v_val := greatest(1, v_val);\n        v_new := least((v_tc->>'max')::int, (v_tc->>'hp')::int + v_val::int);", to: "v_val := greatest(1, v_val) + 1;\n        v_new := least((v_tc->>'max')::int, (v_tc->>'hp')::int + v_val::int);" },
  { name: 'hunt-shield-value', golden: 'hunt', what: 'a shield is 1 HP larger', file: 'combat_effect_use', from: "v_set1 := jsonb_build_object('shield', (v_tc->>'shield')::int + v_val::int);", to: "v_set1 := jsonb_build_object('shield', (v_tc->>'shield')::int + v_val::int + 1);" },
];
