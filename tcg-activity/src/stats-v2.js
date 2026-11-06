// STAT-V2 (register UI-10; SPEC v3 4.4): the stat points payload of /api/collection and the input check of the v2 spend.
// Pure, no I/O. Every number comes from SQL: card_stats_for (v1) and card_stats_v2_for (v2, stat_v2.sql). The server joins them here so the
// route and the G3 fixture (ci/ui-check, cookie ci_col=points9) build the SAME payload: a field that this module drops is missing in G3 too.
//
// CLIENT HOOK (UI-10 review-3 waits for Nathan's approval; the client is NOT built yet):
//   - flag on: payload.stats = { on: true, v2: true, week, resetUsed } and each card c.stat = the card_stats_v2_for entry
//     { v2: true, level, bonus, points: { atk, def, hp, crd, crt, abl, ddg, acc, spd }, free, cap, cp, hp, crit, potency, haste }.
//     The tiles (ui-v2.js 841-844) read cp, hp, crit as today; the effect card (effects-ui.js) reads potency and haste as today.
//   - /api/flags statV2 = the flag of the member; balance.stat_labels_v2 = the 9 names (public).
//   - the editor sends POST /api/stats/spend { cardId, add: { <v2 key>: n } } and /api/stats/reset { cardId }: the server routes them to
//     stat_v2_spend / stat_v2_reset while the flag is on (parseSpendV2 below), else to the v1 RPCs.

// The 9 v2 stats in the plan 2.2 order (the card_progress_v2 columns).
export const V2_STAT_KEYS = ['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd'];

/**
 * The stats part of /api/collection. cards: the card list (each { id, ... }); v1: the card_stats_for answer (or null); v2: the
 * card_stats_v2_for answer (or null). Flag off (v2 null, or v2.on not true): exactly the code of server.js before STAT-V2.
 * Sets c.stat on the cards it finds (as before). Returns { stats, cards }.
 */
export function statsPayload(cards, v1, v2) {
  let stats = null;
  if (v2?.on === true) {
    stats = { on: true, v2: true, week: v2.week, resetUsed: v2.reset_week === v2.week };
    for (const c of cards) { const x = v2.cards?.[String(c.id)]; if (x) c.stat = x; }
    return { stats, cards };
  }
  const st = v1;
  if (st?.on) {
    stats = { on: true, week: st.week, resetUsed: st.reset_week === st.week };
    for (const c of cards) { const x = st.cards?.[String(c.id)]; if (x) c.stat = x; }
  }
  return { stats, cards };
}

/**
 * The body of a v2 spend: { cardId, add: { <v2 key>: n } }, each n a whole number from 1 to cap (balance v2_stats.max_per_stat).
 * Returns { cardId, add } or { error } with one of: 'bad card', 'bad request', 'bad stat', 'bad amount'. SQL checks again (stat_v2_spend).
 */
export function parseSpendV2(body, cap) {
  const cardId = Number(body?.cardId);
  if (!Number.isInteger(cardId) || cardId <= 0) return { error: 'bad card' };
  const src = body?.add;
  if (!src || typeof src !== 'object' || Array.isArray(src) || !Object.keys(src).length) return { error: 'bad request' };
  const max = Number(cap);
  if (!Number.isInteger(max) || max < 1) return { error: 'bad request' };
  const add = {};
  for (const [k, n] of Object.entries(src)) {
    if (!V2_STAT_KEYS.includes(k)) return { error: 'bad stat' };
    if (!Number.isInteger(n) || n < 1 || n > max) return { error: 'bad amount' };
    add[k] = n;
  }
  return { cardId, add };
}

/** The flag of a member, the same rule as SQL stat_v2_on: combat_v2.progress (global) AND (stat_v2.enabled OR the member in users). */
export function statV2Allowed(progress, cfg, id) {
  if (progress !== true || !cfg || typeof cfg !== 'object') return false;
  if (typeof cfg.enabled !== 'boolean' || !Array.isArray(cfg.users)) return false;
  return cfg.enabled === true || cfg.users.map(String).includes(String(id));
}
