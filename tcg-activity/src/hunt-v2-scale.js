// HUNT-HEADER-V2 (Nathan, 2026-11-06: "Yes everything needs to be accurate to the damage people ACTUALLY do now in combat v2").
// The server side of the Hunt scale. The ONE factor comes from SQL: hunt_fight_scales(ids) = { id: combat_v2_hunt_boss max / hunts.hp_max }
// (hunt_fight_scale.sql), null = no factor (flag OFF, a past v1 Hunt, no v2 boss). Every shared-scale number of a Hunt (boss HP, damage) is
// multiplied by the same factor in the server answer, so the bar, the HP numbers and the damage numbers agree. No balance number is here:
// the factor is read, never computed. With no factor every value passes through unchanged (flag OFF: today's answers, byte for byte).

/** A shared-scale number on the v2 scale: round(n x f); without a factor the value itself (not even a copy). */
export const scaleNum = (n, f) => (f ? Math.round(Number(n || 0) * f) : n);

/** The boss row on the v2 scale: hp_max and hp_remaining converted, scale 'v2' (the client hides the v1 boss facts). */
export function scaleHunt(h, f) {
  if (!h || !f) return h;
  const max = scaleNum(h.hp_max, f);
  // the shown HP stays in [0, max] (review r1 L4)
  return { ...h, hp_max: max, hp_remaining: Math.max(0, Math.min(max, scaleNum(h.hp_remaining, f))), scale: 'v2' };
}

/** Rows with damage-like keys on the v2 scale (the leaderboard, the feed, the last board). */
export function scaleRows(rows, f, keys = ['damage']) {
  if (!f || !Array.isArray(rows)) return rows;
  return rows.map((r) => { const o = { ...r }; for (const k of keys) if (o[k] != null) o[k] = scaleNum(o[k], f); return o; });
}

/** The sum of shared damage rows, each on the scale of its own Hunt ({ hunt_id, damage }); scales = Map id -> factor. */
export function scaledSum(rows, scales, key = 'damage') {
  let t = 0;
  for (const r of rows || []) { const f = scales?.get(Number(r.hunt_id)); t += f ? Number(r[key] || 0) * f : Number(r[key] || 0); }
  return Math.round(t);
}

/**
 * The factor reader: one RPC (hunt_fight_scales) for the ids that are not cached; each id is cached ttl ms (the flag and the boss change
 * rarely). A failed read keeps the last factor (no flip between scales) and is retried on the next call; an id never read has no factor.
 * Returns get(ids) -> Map(id -> factor) with only the ids that have a factor, and one(id) -> factor or null.
 */
export function createHuntScales({ rpc, ttl = 30000, now = () => Date.now() }) {
  const cache = new Map();   // id -> { at, f }
  async function get(ids) {
    const want = [...new Set((ids || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
    const miss = want.filter((id) => { const c = cache.get(id); return !c || now() - c.at >= ttl; });
    if (miss.length) {
      try {
        const { data, error } = await rpc('hunt_fight_scales', { p_hunts: miss });
        if (error) throw new Error(error.message);
        for (const id of miss) { const f = Number(data?.[String(id)]); cache.set(id, { at: now(), f: f > 0 ? f : null }); }
      } catch (e) {
        console.error('hunt_fight_scales failed:', e.message);
      }
    }
    const out = new Map();
    for (const id of want) { const f = cache.get(id)?.f; if (f) out.set(id, f); }
    return out;
  }
  return { get, one: async (id) => (await get([id])).get(Number(id)) || null };
}
