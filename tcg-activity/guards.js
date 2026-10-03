// Guards for the calls that cost something outside this server (audit, 2026-10-03):
// - whoAmI calls Discord /users/@me. Discord bans an IP after ~10,000 invalid (401) calls
//   in 10 minutes, and the VM IP is shared with the bot (--network host). So a bad token
//   is cached as bad for 60 s, and the calls that fail are limited per IP and in total.
// - /api/img cache misses cost Supabase egress (img-cache.js), so misses are limited per IP.

// A token bucket per key: `burst` at once, then `perSec`. The map stays bounded.
export function createLimiter({ burst, perSec, maxKeys = 10000, now = Date.now }) {
  const buckets = new Map();
  const fill = (key) => {
    const t = now();
    let b = buckets.get(key);
    if (!b) {
      if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
      b = { tokens: burst, at: t };
      buckets.set(key, b);
    }
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * perSec);
    b.at = t;
    return b;
  };
  return {
    /** True if the key has budget left (does not spend it). */
    ok: (key) => fill(key).tokens >= 1,
    /** Spend one; false if there was none left. */
    take: (key) => { const b = fill(key); if (b.tokens < 1) return false; b.tokens -= 1; return true; },
  };
}

// The client IP. The server binds 127.0.0.1 and Caddy is the only peer; Caddy replaces an
// X-Forwarded-For it does not trust, so its LAST entry is the address Caddy saw. A peer that
// is not loopback (a direct dev call) is its own address. Works for an Express req and the
// raw upgrade req of the WebSocket. Inside Discord the address is Discord's proxy, which many
// members share, so the per-IP budgets below are generous.
export function clientIp(req) {
  const peer = req.socket?.remoteAddress || '';
  const loop = /^(127\.|::1$|::ffff:127\.)/.test(peer);
  const xff = String(req.headers?.['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (loop && xff.length ? xff[xff.length - 1] : peer) || 'unknown';
}

// The Discord identity per token. A good token is cached 5 min (see server.js). A token
// Discord rejects (401/403) is cached as bad for 60 s, so one bad token repeated costs one call.
// A new token is checked with Discord only while its IP, and the server, have failure budget left.
export function createWhoAmI({
  fetchFn = fetch, now = Date.now, loadtest = false,
  okTtlMs = 5 * 60 * 1000, badTtlMs = 60 * 1000, maxEntries = 5000,
  perIp = createLimiter({ burst: 30, perSec: 0.5, now }),
  // ~3,000 in 10 minutes in total at most: well under Discord's invalid-request ban.
  total = createLimiter({ burst: 100, perSec: 5, now }),
} = {}) {
  const userCache = new Map(); // token -> { user, exp }
  const badCache = new Map(); // token -> exp
  const prune = (m, t) => { if (m.size > maxEntries) for (const [k, v] of m) if ((v.exp ?? v) <= t) m.delete(k); if (m.size > maxEntries) m.delete(m.keys().next().value); };
  return async function whoAmI(token, ip = 'unknown') {
    if (!token) return null;
    const t = now();
    const hit = userCache.get(token);
    if (hit && hit.exp > t) return hit.user;
    if ((badCache.get(token) || 0) > t) return null;
    if (loadtest && token.startsWith('lt:')) {
      const id = token.slice(3);
      const user = { id, username: `lt_${id}`, global_name: null };
      userCache.set(token, { user, exp: t + okTtlMs });
      return user;
    }
    if (!perIp.ok(ip) || !total.ok('all')) return null; // no budget: do not call Discord
    let r;
    try { r = await fetchFn('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${token}` } }); } catch { return null; }
    const user = r.ok ? await r.json().catch(() => null) : null;
    if (user) {
      userCache.set(token, { user, exp: t + okTtlMs });
      prune(userCache, t);
      return user;
    }
    perIp.take(ip);
    total.take('all');
    // Only a definite "bad token" is cached: a 429 or 5xx can be a good token on a bad minute.
    if (r.status === 401 || r.status === 403) { badCache.set(token, t + badTtlMs); prune(badCache, t); }
    return null;
  };
}
