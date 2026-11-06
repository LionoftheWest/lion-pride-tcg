// The red number of the bell (GET /api/notifications/count) and "mark all read" (POST /api/notifications/read).
// DB-MEM A3 (2026-11-06): the free Supabase host ran out of memory under load. Every open Activity polls the count
// each 45 s (main.js refreshNotifBadge), plus once at each start and each welcome, and each poll is 2 PostgREST reads.
// So the answer is kept for one member for 10 s.
// Invalidation in this process (the member's own writes): "mark all read", a gift claim and bustUser (server.js) drop the
// key at once (bustCount). notify() in server.js drops the key of the member who gets a new note.
// A bust also detaches a read that is in flight: that read saw the old rows, so its answer is never kept, and a poll
// after the bust reads again. (src/ttl-cache.js keeps a load in flight after a bust: this small cache does not use it.)
// A note or a gift that ANOTHER process writes (the bot, pg_cron) shows at most 10 s late. The poll is 45 s anyway.
export const NOTIF_COUNT_TTL = 10000;

/** A per-member cache of one number: ttl, one read at a time per member, a failed read is never kept, bust is exact. */
export function makeCountCache({ ttl = NOTIF_COUNT_TTL, now = () => Date.now() } = {}) {
  const hits = new Map();  // id -> { at, value }
  const loads = new Map(); // id -> { gen, p }
  const gens = new Map();  // id -> the bust count
  const stats = { hit: 0, miss: 0 };
  return {
    stats,
    get(id, loader) {
      const e = hits.get(id);
      if (e && now() - e.at < ttl) { stats.hit += 1; return Promise.resolve(e.value); }
      const gen = gens.get(id) || 0;
      const l = loads.get(id);
      if (l && l.gen === gen) return l.p;
      stats.miss += 1;
      const p = Promise.resolve().then(loader).then((value) => {
        if ((gens.get(id) || 0) === gen) hits.set(id, { at: now(), value });
        return value;
      }).finally(() => { if (loads.get(id)?.p === p) loads.delete(id); });
      loads.set(id, { gen, p });
      return p;
    },
    // A load in flight keeps its old gen: get() does not join it and its answer is not kept.
    bust(id) { hits.delete(id); gens.set(id, (gens.get(id) || 0) + 1); },
  };
}

export function registerNotifRoutes(app, { supabase, caller, rateLimit, readAtOn = () => false, now }) {
  const counts = makeCountCache({ ttl: NOTIF_COUNT_TTL, now });
  // A failed read throws, so the cache never keeps it.
  const loadCount = async (id) => {
    const [n, g] = await Promise.all([
      supabase.from('notifications').select('read').eq('player_id', id).order('created_at', { ascending: false }).limit(30),
      supabase.from('gift_claims').select('id', { count: 'exact', head: true }).eq('player_id', id).is('claimed_at', null),
    ]);
    if (n.error) throw new Error(n.error.message);
    return (n.data || []).filter((x) => !x.read).length + Math.min(g.count || 0, 20);
  };

  // Only the red number of the bell: the same count as /api/notifications (the unread among the newest 30, plus the
  // unredeemed gifts up to 20) with no joins and no text.
  app.get('/api/notifications/count', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    try { res.json({ unread: await counts.get(String(me.id), () => loadCount(String(me.id))) }); }
    catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // Mark all the caller's notifications as read.
  app.post('/api/notifications/read', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
    // read_at (logs_app.sql) only with the app logs on: the column comes with that migration.
    try {
      await supabase.from('notifications').update(readAtOn() ? { read: true, read_at: new Date().toISOString() } : { read: true }).eq('player_id', me.id).eq('read', false);
    } finally { counts.bust(String(me.id)); }
    res.json({ ok: true });
  });

  return { bustCount: (id) => counts.bust(String(id)), stats: counts.stats };
}
