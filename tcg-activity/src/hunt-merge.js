// The light Hunt answer of a fight (GET /api/hunt?fight=1: the boss, the HP rows of the cards that fought today, the round) merged into the
// roster the client already holds. The result has the same fields and the same order as the roster of the full answer (/api/hunt):
//   hp = the row's hp_remaining, max_hp = the row's max_hp (else the held one), downed, used (it fought today), shield, cdReady (cd_until_round);
//   a card without a row keeps what it has; the order is downed last, then the weak-point matches, then the power (server.js, the same sort).
export function mergeFightRows(roster, rows) {
  const by = new Map((rows || []).map((h) => [Number(h.card_id), h]));
  return (roster || []).map((c) => {
    const s = by.get(Number(c.id));
    return s ? { ...c, hp: s.hp_remaining, max_hp: s.max_hp ?? c.max_hp, downed: !!s.downed, used: true, shield: s.shield || 0, cdReady: s.cd_until_round || 0 } : c;
  }).sort((a, b) => (a.downed - b.downed) || (b.matches - a.matches) || (b.power - a.power));
}
