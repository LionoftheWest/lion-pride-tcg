// The Combat Lab items of 2026-10-19: one unit check for each mechanic (lab-checks.mjs) and one planted fault for each.
// The baseline runs first in the same process and is printed. Each fault must turn its own check red; the checks are
// green again after the faults (no leak). Faults: a config patch, or an engine method that loses one mechanic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, patch } from './util.mjs';
import { Battle } from './engine.mjs';
import { labChecks } from './lab-checks.mjs';

const cfg = loadConfig();
const failing = c => labChecks(c).filter(x => !x.ok).map(x => x.id);

test('lab baseline: every Lab check is green', () => {
  const r = labChecks(cfg); console.log(`  baseline: ${r.length} checks, failing: ${r.filter(x => !x.ok).map(x => x.id).join(' ') || 'none'}`);
  for (const c of r) assert.ok(c.ok, `${c.id}: expect ${c.expect}, got ${c.got}`);
});

// engine faults (apply, undo)
const swap = (key, make) => { const o = Battle.prototype[key]; return [() => { Battle.prototype[key] = make(o); }, () => { Battle.prototype[key] = o; }]; };
const afterUnit = f => swap('unit', o => function (...a) { const u = o.apply(this, a); f(u); return u; });
const dropMech = m => afterUnit(u => u.mech.delete(m)); // the engine loses one mechanic
const cfgFault = p => patch(cfg, p);

const FAULTS = [
  // 1. support area smite
  ['area.pp', 'the area block is priced as free (no other foes in the price)', cfgFault({ v2_pp: { ref: { foes_other: 0 } } })],
  ['area.multi', 'area hits on the other foes are lost', swap('cardHit', o => function (u, t, h) { return h.kind === 'area' ? { dealt: 0, crit: false, miss: true } : o.call(this, u, t, h); })],
  ['area.one', 'the one-foe area value is dropped', cfgFault({ v2_support: { area_one_foe_x: 0 } })],
  // 2. free cure
  ['cure.pp', 'the cure costs 4 PP again (the old cleanse price)', cfgFault({ v2_pp: { support_pp: { cure: 4 } } })],
  ['cure.one', 'the cure cleanses every ally (the old squad-wide stand-in)', swap('cure', o => function (u, b) { const t = o.call(this, u, b); for (const c of this.alive('card')) this.cleanseNeg(c); return t; })],
  ['cure.immune', 'the cure gives no immunity', swap('cure', o => function (u, b) { const t = o.call(this, u, b); if (t) t.immuneTo = {}; return t; })],
  ['cure.shield', 'the shield does not follow the cured ally', swap('cure', o => function (u, b) { o.call(this, u, b); return null; })],
  // 3. Empower stacking
  ['empower.default', 'the switch defaults to ON', cfgFault({ v2_status: { empowered: { stack: true } } })],
  ['empower.stack', 'stacking ignores the x1.5 cap', cfgFault({ v2_status: { empowered: { stack_cap: 9 } } })],
  // 4. enemies put statuses on cards
  ['foe.moves', 'the monster status moves are off', cfgFault({ v2_dungeon: { moves_v2: { on: false } } })],
  ['foe.statuses', 'the monster status moves are off (no Burn on cards)', cfgFault({ v2_dungeon: { moves_v2: { on: false } } })],
  ['foe.plaguebearer', 'the engine loses Plaguebearer', dropMech('plaguebearer')],
  ['foe.undying', 'the engine loses Undying', dropMech('undying')],
  ['foe.volatile', 'the engine loses Volatile Core', dropMech('volatile_core')],
  ['foe.bulwark', 'the engine loses Bulwark', dropMech('bulwark')],
  ['foe.pack', 'the engine loses Pack', dropMech('pack')],
  ['boss.statuses', 'boss counter moves lose their status rider', swap('bossMove', o => function (e, m) { return o.call(this, e, { ...m, apply: undefined }); })],
  // 5. Auto hold
  ['auto.hold', 'Auto never holds (hold_max 0)', cfgFault({ v2_auto: { hold_max: 0 } })],
  // 6. monsters
  ['boss.hp', 'the boss HP factor is ignored', cfgFault({ v2_bosses: { skeleton: { hp_factor: null } } })],
  ['boss.roster', 'a boss loses its counter moves', cfgFault({ v2_bosses: { maw: { moves: [] } } })],
  ['boss.resists', 'the engine loses the Resists line', afterUnit(u => u.immune.clear())],
  ['regrowth', 'Regrowth x2 below half again', cfgFault({ v2_enemy: { mechanics: { regrowth: { below_half_x: 2 } } } })],
  ['boss.rollback', 'the engine loses Rollback', dropMech('rollback')],
  ['boss.bloodrot', 'the engine loses Bloodrot', dropMech('bloodrot')],
  ['boss.brittle', 'the engine loses the shield cut', dropMech('brittle')],
  ['boss.time_lock', 'the engine loses Time Lock', dropMech('time_lock')],
  ['boss.mirror_hide', 'the engine loses Mirror Hide', dropMech('mirror_hide')],
  ['boss.stats', 'Plated gives the tier Defense only', cfgFault({ v2_boss_rules: { plated: { def: 0.15 } } })],
  ['boss.brood', 'Brood takes no damage cut', cfgFault({ v2_boss_rules: { brood: { dr: 0 } } })],
  ['boss.permafrost_heart', 'the engine loses Permafrost Heart', dropMech('permafrost_heart')],
  ['boss.siphon', 'the engine loses Siphon', dropMech('siphon')],
  ['boss.crush', 'the engine loses Crush', dropMech('crush')],
  ['boss.weak_role', 'the weak-to-role bonus is 0', cfgFault({ v2_enemy: { weak_role_x: 0 } })],
  ['boss.weak_to', 'the named boss loses its Weak to tag (two homes again: a caller must give the role)', cfgFault({ v2_bosses: { zerg: { weak_to: [] } } })],
  ['foe.rider_chance', 'Venom poisons every single hit again (the chance is lost)', swap('enemyHit', o => function (e, t, x, area, op) { const r = o.call(this, e, t, x, area, op); if (!area && e.mech.has('venom') && !t.down && !t.st.poison) this.apply(e, t, 'poison', { stacks: 1 }); return r; })],
  ['boss.weak_controller', 'a Controller week gives control no extra action', cfgFault({ v2_enemy: { weak_role_rules: { controller: { control_add: 0 } } } })],
  ['boss.cap_numbers', 'the Hydra keeps its old Regrow', cfgFault({ v2_bosses: { hydra: { moves: [{ id: 'regrow', k: 'heal', v: 0.03 }, { id: 'new_head', k: 'extra_action' }, { id: 'bite', k: 'hit', x: 1, tgt: 'random', apply: { status: 'poison', stacks: 1 } }] } } })],
  ['boss.moves', 'one counter move kind has no handler', swap('bossMove', o => function (e, m) { if (m.k === 'charge') throw new Error('no handler: charge'); return o.call(this, e, m); })],
  ['dungeon.cataclysm', 'the old defect: the foe Cataclysm flag is overwritten', afterUnit(u => { u.cataclysm = 0; })],
  ['gauntlet.cfg', 'the Gauntlet keeps 12 floors', cfgFault({ v2_gauntlet: { floors: 12 } })],
  ['gauntlet.depth', 'the Gauntlet uses the Dungeon foes (no foe scale, Dungeon growth)', cfgFault({ v2_gauntlet: { foe_x: { hp: 1, atk: 1 }, growth: { hp: 1.42, atk: 1.22 } } })],
  ['counter.cap', 'the cap value lets a x0.60 cut pass', cfgFault({ v2_enemy: { counter_cut_min: 0.5 } })],
  // 7. Flurry
  ['flurry.text', 'the value and the text disagree', cfgFault({ v2_roles: { flurry: { extra_chance: 0.25 } } })],
];

test('every Lab check has a planted fault', () => {
  const ids = labChecks(cfg).map(c => c.id).sort(), planted = [...new Set(FAULTS.map(f => f[0]))].sort();
  assert.deepEqual(planted, ids);
});
for (const [id, what, f] of FAULTS) {
  test(`planted fault is caught: ${id} (${what})`, () => {
    let fails;
    if (Array.isArray(f)) { f[0](); try { fails = failing(cfg); } finally { f[1](); } } else fails = failing(f);
    console.log(`  ${id}: failing ${fails.join(', ')}`);
    assert.ok(fails.includes(id), `the fault "${what}" did not turn ${id} red`);
  });
}
test('the Lab checks are green again after the faults (no leak)', () => assert.deepEqual(failing(cfg), []));
