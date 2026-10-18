// Planted faults: each one breaks one formula or rule. The checks must go red for each, on a green baseline
// (the baseline runs in the same process first and is printed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, patch } from './util.mjs';
import { F } from './formulas.mjs';
import { Battle } from './engine.mjs';
import { allChecks } from './checks.mjs';

const cfg = loadConfig();
const failing = c => allChecks(c).filter(x => !x.ok).map(x => x.id);
function planted(name, apply, undo, c = cfg) { apply(); try { return failing(c); } finally { undo(); } }

test('baseline: every check is green', () => {
  const f = failing(cfg); console.log(`baseline failing checks: ${f.length} ${f.join(' ')}`);
  assert.deepEqual(f, []);
});
const swap = (obj, key, fn) => { const old = obj[key]; return [() => { obj[key] = fn(old); }, () => { obj[key] = old; }];
};
const FAULTS = {
  'Defense adds damage (1 + def)': swap(F, 'afterDefense', () => (raw, def, pierce = 0) => raw * (1 + def * (1 - pierce))),
  'Pierce ignored': swap(F, 'afterDefense', () => (raw, def) => raw * (1 - def)),
  'meter gains 2 x speed': swap(F, 'meterGain', () => s => 2 * s),
  'ASC-3 curve off by one star': swap(F, 'ascCp', old => (c, r, s) => old(c, r, Math.min(5, s + 1))),
  'flat Attack becomes 4 a point': swap(F, 'stats', old => (c, b, p) => ({ ...old(c, b, p), cp: b + 4 * Math.min(10, p.atk || 0) })),
  'Toxic burst never happens': swap(F, 'toxicBurst', () => () => 0),
  'Burn does not halve heals': swap(F, 'healAmount', () => (c, a) => a),
  'no control immunity': swap(Battle.prototype, 'remove', () => function (u, n) { delete u.st[n]; }),
};
for (const [name, [apply, undo]] of Object.entries(FAULTS)) {
  test(`planted fault is caught: ${name}`, () => {
    const f = planted(name, apply, undo); console.log(`  ${name}: ${f.length} checks fail (${f.slice(0, 6).join(', ')})`);
    assert.ok(f.length > 0, `no check failed for the planted fault "${name}"`);
  });
}
test('planted fault is caught: Toxic burst threshold 4 (config)', () => {
  const f = failing(patch(cfg, { v2_status: { poison: { burst_at: 4 } } })); console.log(`  burst_at 4: ${f.join(', ')}`);
  assert.ok(f.includes('poison.burst'));
});
test('the checks are green again after the faults (no leak)', () => assert.deepEqual(failing(cfg), []));
