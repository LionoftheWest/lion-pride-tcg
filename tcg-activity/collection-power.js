// Total CP with the set-completion bonus, in JS: the same rule as my_collection_power (SQL,
// ascension_cp_v2.sql). Per subject (set): the sum of card_power of the owned cards, x1.25
// (rounded) when every card of the subject is owned. A card with no subject counts 0 (the
// SQL joins subjects). The v2 board used one RPC per player for this (~45 a rebuild).
// owned: [{ card_id, ascension }] (quantity >= 1). catalog: [{ id, rarity, cp_mod, sid }].
export function setTotals(catalog) {
  const n = new Map();
  for (const c of catalog) if (c.sid != null) n.set(c.sid, (n.get(c.sid) || 0) + 1);
  return n;
}

export function collectionPower(owned, byId, totals, cardPower) {
  const per = new Map(); // sid -> { cp, n }
  for (const r of owned) {
    const c = byId.get(r.card_id);
    if (!c || c.sid == null) continue;
    const s = per.get(c.sid) || { cp: 0, n: 0 };
    s.cp += cardPower(c.rarity, r.ascension, c.cp_mod);
    s.n += 1;
    per.set(c.sid, s);
  }
  let total = 0;
  for (const [sid, s] of per) total += s.n === totals.get(sid) ? Math.round(s.cp * 1.25) : s.cp;
  return total;
}
