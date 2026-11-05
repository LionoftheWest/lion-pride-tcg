// PACK-SET-B: the set of a pack open (Nathan 2026-11-03: "each set has its own pack. So no mixed packs").
// bodySet: the set of the request (undefined = none). pullableIds: the ids of the pullable sets from a fresh read of
// card_sets (null = the read failed). The answer: { set } = the set to send to the bot (undefined = none, as today),
// or { status, error } = refuse with no bot call, so no pack is spent.
// - A request set goes to the bot as today (the bot refuses a set that is not pullable: 400 set_not_pullable).
// - No set and 1 pullable set: that set by name (INV-B2). No set and 2 or more: set_required (INV-B1).
export function resolveOpenSet(bodySet, pullableIds) {
  if (bodySet !== undefined) return { set: bodySet };
  if (!Array.isArray(pullableIds)) return { status: 503, error: 'sets_unavailable' };
  if (pullableIds.length >= 2) return { status: 400, error: 'set_required' };
  return { set: pullableIds[0] };   // 0 pullable sets: undefined, the request to the bot as today
}
