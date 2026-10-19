// The three combat checks fail on a planted violation and pass on the real repository (docs/f3-effect-engine.md section 3, row "4e":
// "each check fails on a planted violation"). No database.   node --test ci/combat/combat-checks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readJson, snapshotFunctions, sqlFunctions } from './lib.mjs';
import * as c1 from './c1-numbers.mjs';
import * as c2 from './c2-effect-names.mjs';
import * as c3 from './c3-client-math.mjs';

const SNAP = snapshotFunctions();
const cfg1 = readJson('c1-numbers.json');
const cfg2 = readJson('c2-effect-names.json');
const cfg3 = readJson('c3-client-math.json');
const MD = readFileSync(join(ROOT, 'docs', 'data', 'balance.md'), 'utf8');
const FILES = c3.clientFiles();

// A copy of the snapshot where one function body gets a planted line (after its first "begin").
const plant = (name, line) => {
  let done = false;
  const out = SNAP.map((f) => {
    if (f.name !== name || done) return f;
    const i = f.body.search(/\bbegin\b/i);
    assert.ok(i >= 0, `${name} has a begin`);
    done = true;
    return { ...f, body: `${f.body.slice(0, i + 5)}\n  ${line}\n${f.body.slice(i + 5)}` };
  });
  assert.ok(done, `the snapshot has ${name}`);
  return out;
};
const migration = (sql) => sqlFunctions(sql).map((f) => ({ ...f, where: 'tcg-bot/supabase/planted.sql' }));

// ------------------------------------------------------------------------------------------------ check 1
test('c1: the real snapshot passes', () => {
  assert.deepEqual(c1.check(SNAP, [], cfg1).problems, []);
});
test('c1: a planted combat number in a fight function fails', () => {
  const r = c1.check(plant('hunt_attack', 'v_dmg := round(v_dmg * 1.35);'), [], cfg1);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /hunt_attack has the number 1\.35/);
});
test('c1: one more use of an allowed literal fails (the count, not only the literal)', () => {
  const r = c1.check(plant('hunt_counter_act', "perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('x', jsonb_build_object('until', 999)));"), [], cfg1);
  assert.match(r.problems.join('\n'), /hunt_counter_act has the number 999 22 time/);
});
test('c1: a planted number in a changed migration fails', () => {
  const sql = "create or replace function public.dungeon_enemy_turn(p jsonb) returns jsonb language plpgsql set search_path to 'public' as $f$ begin return jsonb_build_object('psnu', 4); end $f$;";
  const r = c1.check(SNAP, migration(sql), cfg1);
  assert.match(r.problems.join('\n'), /planted\.sql: dungeon_enemy_turn has the number 4/);
});
test('c1: a number in a comment or a string, or in a function outside the fight, passes', () => {
  assert.deepEqual(c1.check(plant('hunt_attack', "-- 3 rounds\n  perform 1 where 'x 7' is not null;"), [], cfg1).problems, []);
  assert.deepEqual(c1.check(plant('admin_overview', 'perform 42;'), [], cfg1).problems, []);
});
test('c1: the ratchet: an allowlist count above the live count fails, an entry with no reason fails', () => {
  const up = structuredClone(cfg1); up.allow.hunt_attack['3'].count = 2;
  assert.match(c1.check(SNAP, [], up).problems.join('\n'), /ratchet: .*hunt_attack 3 1 time/);
  const nr = structuredClone(cfg1); nr.allow.hunt_attack['3'].reason = '';
  assert.match(c1.check(SNAP, [], nr).problems.join('\n'), /allowlist hunt_attack 3: no reason/);
});
test('c1: Flurry hits and poison rounds are balance numbers (f3_engine_cleanup.sql)', () => {
  const pool = SNAP.find((f) => f.name === 'combat_pool_act'), et = SNAP.find((f) => f.name === 'dungeon_enemy_turn');
  assert.match(pool.body, /m2->>'flurry_hits'/);
  assert.match(et.body, /balance_num\('pool_moves', 'poison_rounds'\)/);
  assert.equal(c1.literals(pool.body)['2'], undefined);
  assert.equal(c1.literals(et.body)['3'], undefined);
});

// ------------------------------------------------------------------------------------------------ check 2
test('c2: the real snapshot passes', () => {
  assert.deepEqual(c2.check(SNAP, [], cfg2).problems, []);
});
test('c2: a planted effect-name branch outside the engine fails (each form)', () => {
  for (const line of [
    "if v_eff = 'heal' then null; end if;",
    "if v_ab->>'effect' = 'stun' then null; end if;",
    "if p_aeff in ('pierce', 'focus') then null; end if;",
    "v := case v_eff when 'smite' then 1 else 0 end;",
    "if 'weaken' <> r.eff then null; end if;",
    "if v_eff is distinct from 'cleanse' then null; end if;",
  ]) {
    const r = c2.check(plant('dungeon_support', line), [], cfg2);
    assert.equal(r.problems.length, 1, line);
    assert.match(r.problems[0], /dungeon_support compares an ability effect by its name 1 time/, line);
  }
});
test('c2: a planted branch in a changed migration fails; the dropped combat_support_value would fail', () => {
  const sql = "create or replace function public.combat_support_value(p_eff text) returns numeric language sql set search_path to 'public' as $function$ select case p_eff when 'empower' then 1 end; $function$;";
  assert.match(c2.check(SNAP, migration(sql), cfg2).problems.join('\n'), /planted\.sql: combat_support_value compares/);
});
test('c2: the engine, boon primitives (trap 12), boss actions and comments are not flagged', () => {
  assert.deepEqual(c2.check(plant('combat_effect_use', "if v_eff = 'heal' then null; end if;"), [], cfg2).problems, []);
  assert.deepEqual(c2.check(plant('play_card_effect', "if v_prim.primitive = 'timeout' or v_prim.primitive = 'cleanse' or v_prim.primitive in ('shield', 'heal') then null; end if;"), [], cfg2).problems, []);
  assert.deepEqual(c2.check(plant('hunt_attack', "if v_bossact = 'stun' then null; end if; -- if v_eff = 'heal'"), [], cfg2).problems, []);
});
test('c2: the ratchet and the reasons', () => {
  const up = structuredClone(cfg2); up.allow.hunt_counter_act.count += 1;
  assert.match(c2.check(SNAP, [], up).problems.join('\n'), /ratchet: .*hunt_counter_act/);
  const nr = structuredClone(cfg2); nr.allow.hunt_damage_reconcile.reason = 'x';
  assert.match(c2.check(SNAP, [], nr).problems.join('\n'), /allowlist hunt_damage_reconcile: no reason/);
});

// ------------------------------------------------------------------------------------------------ check 3
const plantFile = (path, add) => FILES.map((f) => (f.path === path ? { ...f, text: `${f.text}\n${add}\n` } : f));
test('c3: the real client code passes', () => {
  assert.deepEqual(c3.check(FILES, MD, cfg3).problems, []);
});
test('c3: a planted balance leaf name, old constant or old formula fails', () => {
  assert.match(c3.check(plantFile('tcg-activity/src/main.js', 'const cap = cfg.syn_cap;'), MD, cfg3).problems.join('\n'), /main\.js: 1 combat math hit.*balance leaf syn_cap/);
  assert.match(c3.check(plantFile('tcg-activity/src/squad-pick.js', 'const em = (n) => (n >= 3 ? 1.12 : 1);'), MD, cfg3).problems.join('\n'), /squad-pick\.js: 1 combat math hit.*old constant 1\.12/);
  assert.match(c3.check(plantFile('tcg-bot/src/display.ts', 'const syn = Math.min(1.6, a * b);'), MD, cfg3).problems.join('\n'), /display\.ts: 1 combat math hit.*old formula Math\.min\(1\.6/);
  assert.match(c3.check(plantFile('tcg-activity/src/main.js', 'let w = 1 + (1 - 0.5 ** wm);'), MD, cfg3).problems.join('\n'), /old formula 0\.5 \*\*/);
});
test('c3: an animation number outside the old files, and the ratchet', () => {
  assert.deepEqual(c3.check(plantFile('tcg-activity/src/boss.js', 'const s = 1.12;'), MD, cfg3).problems, []);
  const up = structuredClone(cfg3); up.allow['tcg-activity/src/stat-labels.js'].count = 2;
  assert.match(c3.check(FILES, MD, up).problems.join('\n'), /ratchet: tcg-activity\/src\/stat-labels\.js/);
});
test('c3: the leaf names come from docs/data/balance.md (the reader is not broken)', () => {
  const { leaves, missing } = c3.balanceLeaves(MD, cfg3.keys);
  assert.deepEqual(missing, []);
  for (const l of ['syn_cap', 'heal_cap', 'flurry_x', 'poison_dot', 'crit_cap']) assert.ok(leaves.includes(l), l);
});
