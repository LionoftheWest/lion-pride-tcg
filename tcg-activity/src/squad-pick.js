// The squad rules the client checks without combat math: who can attack, the free daily slots, a squad that is down and a
// turn with no action. F-3 (docs/foundations.md, 2026-10-11): the auto-pick and the team value moved to SQL (hunt_autopick,
// hunt_squad_value: the fight's own calculation), so this file has no synergy, weakness or crit number.
export const ATTACKERS = new Set(['Character', 'Creature']);

// A squad needs at least 1 attacker (Nathan, 2026-10-03): supports alone deal no damage, so the
// member would get no raid prize. lock_hunt_squad refuses it too ('no_attacker').
export function hasAttacker(cards, selectedIds) {
  const sel = new Set(selectedIds);
  return cards.some((c) => sel.has(c.id) && ATTACKERS.has(c.type));
}

// How many more cards the member could still add to `selected` today (the lock-in warning).
export function openSlots(cards, selectedIds, { cap = 8 } = {}) {
  const sel = new Set(selectedIds);
  const used = cards.filter((c) => c.used).length;
  const freshIn = cards.filter((c) => sel.has(c.id) && !c.used).length;
  const room = cap - sel.size;
  if (room <= 0) return 0;
  const freeOld = cards.filter((c) => c.used && !c.downed && !sel.has(c.id)).length;
  const freshLeft = Math.max(0, cap - used - freshIn);
  const freshAvail = cards.filter((c) => !c.used && !c.downed && !sel.has(c.id)).length;
  return Math.min(room, freeOld + Math.min(freshLeft, freshAvail));
}

// Is the squad down? (Nathan, 2026-10-02: "halfway through my squad, when one of my cards got
// knocked out, it said my squad was wiped out completely". The old check looked only at the
// cards that had FOUGHT: the first card downed before the others attacked was 1 of 1 down.)
// One squad of 8 a day (attackers + supports), locked in (hunt_squads on the server). D-173 (2026-10-10):
// the squad is down only when EVERY card of it is down, supports too (the same rule as the SQL
// hunt_squad_done). When only supports stand and all are on cooldown, noAction() below is true and the
// server plays the boss turn (hunt_pass_turn). A card of the squad that has not fought yet is alive.
// Without a locked squad (a member who fought before hunt_squads.sql), the cards that fought count.
export function squadDown(cards, selIds) {
  const sel = new Set((selIds || []).map(Number));
  const squad = cards.filter((c) => sel.has(Number(c.id)) || c.used);
  return squad.length > 0 && squad.every((c) => c.downed);
}

// D-173: the member has no action when no attacker of the squad stands, at least one support stands, and
// every standing support is on cooldown (cdReady > round: the same test as hunt_support and the server
// hunt_pass_turn). Then the turn shows "No action can be taken" and the boss acts.
export function noAction(cards, selIds, round) {
  const sel = new Set((selIds || []).map(Number));
  const standing = cards.filter((c) => (sel.has(Number(c.id)) || c.used) && !c.downed);
  if (!standing.length || standing.some((c) => ATTACKERS.has(c.type))) return false;
  return standing.every((c) => (c.cdReady || 0) > (round || 0));
}
