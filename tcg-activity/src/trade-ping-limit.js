// The public trade ping limit (audit, 2026-10-03). Each trade offer and each picked card posts a
// public ping with a picture in the notifications channel. A member could send and cancel offers
// in a loop and ping one target again and again. So: at most one PUBLIC ping per sender -> target
// pair in 10 minutes. The trade itself and the in-app notification are not limited here.
// In memory: a restart forgets the pairs (at most one extra ping). The map is bounded.
export const PING_WINDOW_MS = 10 * 60 * 1000;

export function makePingLimiter({ windowMs = PING_WINDOW_MS, max = 5000, now = Date.now } = {}) {
  const last = new Map(); // "from>to" -> the time of the last public ping (insertion order = time order)
  const prune = (t) => {
    for (const [k, at] of last) { if (t - at >= windowMs) last.delete(k); else break; }
  };
  return {
    /** True when this pair may ping now (and records the ping); false while the pair waits. */
    allow(from, to) {
      const t = now(), key = `${String(from)}>${String(to)}`;
      const at = last.get(key);
      if (at !== undefined && t - at < windowMs) return false;
      last.delete(key);
      if (last.size >= max) prune(t);
      while (last.size >= max) last.delete(last.keys().next().value);
      last.set(key, t);
      return true;
    },
    size: () => last.size,
  };
}
