// The minimum share of a condition (Nathan 2026-10-20, approved after PR T1b): the simulator side of the validator rule (cards.mjs minShareErrors;
// SQL ability_v2_check, combat_v2_min_share.sql; SQL = the simulator: card-studio/scripts/test-combat-v2-min-share.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, patch } from './util.mjs';
import { minShareErrors, measuredShare, templatesOf, ROLES } from './cards.mjs';

const cfg = loadConfig();
const W = (gate) => [{ k: 'shield', v: 0.3 }, gate];
const low = (c, blocks) => minShareErrors(c, blocks).map((e) => e.block);

test('config: limits.min_share is 0.01 and every measured share is a number', () => {
  assert.equal(cfg.ability_v2.limits.min_share, 0.01);
  for (const s of Object.keys(cfg.ability_v2.share.self_has_each)) assert.equal(typeof measuredShare(cfg, { k: 'self_has', status: s }), 'number', s);
  for (const k of ['enemy_charging', 'foes_alive', 'self_shield', 'on_kill']) assert.equal(typeof measuredShare(cfg, { k }), 'number', k);
});
test('a condition below the minimum is refused, one at or above it is not', () => {
  for (const s of ['stunned', 'frozen', 'sleep', 'paralyzed', 'confused', 'focused', 'burn', 'blinded', 'exposed']) assert.deepEqual(low(cfg, W({ k: 'self_has', status: s })), [2], s);
  for (const s of ['empowered', 'quickened', 'weakened', 'poison', 'chill', 'slowed']) assert.deepEqual(low(cfg, W({ k: 'self_has', status: s })), [], s);
  for (const k of ['enemy_charging', 'foes_alive', 'self_shield']) assert.deepEqual(low(cfg, W({ k })), [], k);
  assert.deepEqual(low(cfg, [{ k: 'hit', x: 1.3 }, { k: 'on_kill', status: 'slowed', chance: 0.5 }]), []);
  const atMin = patch(cfg, { ability_v2: { limits: { min_share: cfg.ability_v2.share.self_has_each.empowered } } });
  assert.deepEqual(low(atMin, W({ k: 'self_has', status: 'empowered' })), []);
});
test('the numbers come from the config: min_share 0 turns the rule off, a changed share changes the answer', () => {
  assert.deepEqual(low(patch(cfg, { ability_v2: { limits: { min_share: 0 } } }), W({ k: 'self_has', status: 'stunned' })), []);
  assert.deepEqual(low(patch(cfg, { ability_v2: { share: { on_kill: 0.004 } } }), [{ k: 'hit', x: 1.3 }, { k: 'on_kill', status: 'slowed', chance: 0.5 }]), [2]);
  assert.deepEqual(low(patch(cfg, { ability_v2: { share: { self_has_each: { stunned: 0.3 } } } }), W({ k: 'self_has', status: 'stunned' })), []);
});
test('no limits.min_share: minShareErrors throws (never accepts by a missing number)', () => {
  const c = patch(cfg, {}); delete c.ability_v2.limits.min_share;
  assert.throws(() => minShareErrors(c, W({ k: 'self_has', status: 'stunned' })), /no limits\.min_share/);
});
test('no placeholder template has a condition below the minimum', () => {
  for (const role of ROLES) for (const t of templatesOf(cfg, role)) assert.deepEqual(minShareErrors(cfg, cfg.v2_templates[t].blocks), [], t);
});
