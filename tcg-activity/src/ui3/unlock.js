// UI-53 Unlock gate: the pure logic (which steps, the texts, the progress, which button is primary).
// The server decides the unlock (adventure_gate.sql); this reads its answer only: { need, attackers, gifts_open, gifts_total }.
// Words follow design.md 10.1: Claim, not Redeem. One primary button at most (5.3, D-80): the first unfinished step.
export const GATE_NEED = 8;

/** what: 'the Hunt' | 'the Dungeon' | 'the Gauntlet'. Returns { title, steps: [{ key, done, title, prog, label, act, variant }] }. */
export function gateModel(g = {}, what = 'the Hunt') {
  const need = g.need || GATE_NEED;
  const total = g.gifts_total || 0;
  const open = g.gifts_open || 0;
  const attackers = g.attackers || 0;
  const steps = [
    { key: 'gifts', done: open === 0, title: 'Claim your starter gifts', prog: `${Math.max(0, total - open)} / ${total} claimed`, label: 'Open the bell', act: 'bell' },
    { key: 'attackers', done: attackers >= need, title: `Own ${need} attackers`, prog: `${Math.min(attackers, need)} / ${need} Characters or Creatures`, label: 'Open a pack', act: 'open' },
  ];
  const first = steps.findIndex((s) => !s.done);
  steps.forEach((s, i) => { s.variant = i === first ? 'primary' : 'secondary'; });
  return { title: `Unlock ${what}`, steps };
}
