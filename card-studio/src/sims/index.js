/**
 * The simulations the Admin Test lab can run (each one a module of this folder, each one also a CLI in scripts/).
 * fields: the parameters the lab form shows (the module's params() checks them again). compare: false = a report of
 * recorded data (the scenario cannot change it): the lab runs it once.
 */
import * as hunt from './hunt-balance.js';
import * as bossMoves from './boss-moves.js';
import * as supportValue from './support-value.js';
import * as dungeon from './dungeon.js';
import * as economy from './economy.js';
import * as combatStats from './combat-stats.js';

const seed = { name: 'seed', label: 'Seed', type: 'num', min: -1, max: 1, step: 0.01, def: 0.42 };
export const SIMS = {
  hunt: { label: 'Hunt: damage and kill odds', mod: hunt, compare: true, fields: [
    { name: 'tier', label: 'Tier', type: 'select', options: hunt.TIERS, def: 'Normal' },
    { name: 'spawns', label: 'Bosses', type: 'int', min: 1, max: 6, def: 2 },
    { name: 'members', label: 'Members per group', type: 'int', min: 1, max: 8, def: 4 },
    { name: 'crew', label: 'Crew', type: 'int', min: 1, max: 60, def: 10 },
    { name: 'days', label: 'Days', type: 'int', min: 1, max: 7, def: 4 }, seed] },
  dungeon: { label: 'Dungeon and Gauntlet runs', mod: dungeon, compare: true, fields: [
    { name: 'mode', label: 'Mode', type: 'select', options: ['both', 'daily', 'gauntlet'], def: 'both' },
    { name: 'runs', label: 'Runs per tier', type: 'int', min: 1, max: 10, def: 2 },
    { name: 'max_floors', label: 'Max floors', type: 'int', min: 1, max: 30, def: 30 }, seed] },
  boss_moves: { label: 'Boss counter moves', mod: bossMoves, compare: true, fields: [
    { name: 'bosses', label: 'Boss', type: 'select', options: ['', ...bossMoves.ALL_BOSSES], optionLabels: { '': 'All bosses' }, def: '' },
    { name: 'days', label: 'Days', type: 'int', min: 1, max: 60, def: 6 }] },
  support_value: { label: 'Support value against counters', mod: supportValue, compare: true, fields: [
    { name: 'bosses', label: 'Boss', type: 'select', options: ['', ...Object.keys(supportValue.DEFAULT_BOSSES)], optionLabels: { '': 'All bosses' }, def: '' },
    { name: 'days', label: 'Days', type: 'int', min: 1, max: 300, def: 30 }] },
  economy: { label: 'Economy: pulls and Shards (estimate)', mod: economy, compare: true, fields: [
    { name: 'days', label: 'Average of the last days', type: 'int', min: 1, max: 90, def: 14 }] },
  combat_stats: { label: 'Hunt combat log (recorded)', mod: combatStats, compare: false, fields: [
    { name: 'limit', label: 'Hunts', type: 'int', min: 1, max: 50, def: 15 }] },
};

/** The parameters of a lab run: only the fields of the form (for example, no card HP floor: it needs DDL). */
export function labParams(id, raw = {}) {
  const s = SIMS[id];
  if (!s) throw new Error('sim is not allowed');
  const picked = {};
  for (const f of s.fields) if (raw[f.name] !== undefined && raw[f.name] !== null) picked[f.name] = raw[f.name];
  for (const k of Object.keys(raw)) if (!s.fields.some((f) => f.name === k)) throw new Error(`${k} is not a parameter of ${id}`);
  return s.mod.params(picked);
}

/** Baseline vs scenario: every metric of the two summaries, with the difference. */
export function compareMetrics(id, base, scen) {
  const m = SIMS[id].mod.metrics;
  const a = m(base), b = scen ? m(scen) : [];
  const keys = [...new Set([...a.map((x) => x.key), ...b.map((x) => x.key)])];
  return keys.map((k) => {
    const x = a.find((y) => y.key === k), y = b.find((z) => z.key === k);
    const before = x?.value ?? null, after = scen ? (y?.value ?? null) : null;
    const diff = before != null && after != null ? after - before : null;
    return { key: k, label: (x || y).label, fmt: (x || y).fmt || null, chart: (x || y).chart || null, short: (x || y).short || null,
      before, after, diff, pct: diff != null && before ? diff / Math.abs(before) : null };
  });
}
