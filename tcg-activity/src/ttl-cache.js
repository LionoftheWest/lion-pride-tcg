// A small keyed cache for the Activity server: a value lives `ttl` ms, one load runs at a time for a key
// (single flight), a failed load is never kept, and `bust(key)` drops a key at once.
// Why (2026-10-11): every member screen asked the database again for the same answer; the database was the
// bottleneck (card_powers, hunt_view, dailies_view stalled for 5-7 s under load). Only data of ONE member goes in a
// per-member cache (the key is the member id): never share a private answer across members.
//   valid(value, now): optional. false = the value is out of date before its ttl (a day rolled over).
//   stale: serve an expired value at once and refresh in the background (stale-while-revalidate).
export function makeTtlCache({ ttl, valid = () => true, stale = false, now = () => Date.now() }) {
  const hits = new Map();   // key -> { at, value }
  const loads = new Map();  // key -> Promise
  const stats = { hit: 0, miss: 0, stale: 0 };
  const fresh = (e) => e && now() - e.at < ttl && valid(e.value, now());
  const load = (key, loader) => {
    if (loads.has(key)) return loads.get(key);
    const p = Promise.resolve().then(loader).then((value) => { hits.set(key, { at: now(), value }); return value; }).finally(() => loads.delete(key));
    loads.set(key, p);
    return p;
  };
  return {
    stats,
    async get(key, loader) {
      const e = hits.get(key);
      if (fresh(e)) { stats.hit += 1; return e.value; }
      if (stale && e && valid(e.value, now())) { stats.stale += 1; load(key, loader).catch(() => {}); return e.value; }
      stats.miss += 1;
      return load(key, loader);
    },
    bust(key) { hits.delete(key); },
    clear() { hits.clear(); },
    size: () => hits.size,
  };
}
