// Route timing log (2026-10-11): how long each API route takes, p50 / p95 / max over a window (5 minutes), printed to the
// container log once per window. It holds no member data: the key is the route PATTERN ("GET /api/hunt"), never the URL,
// the query or the member. Only the durations are kept (the last `cap` per route, so the memory stays small).
export function createRouteTiming({ windowMs = 300_000, cap = 5000, now = () => performance.now(), log = console.log, extra = null } = {}) {
  let rows = new Map();   // route -> { n, ms:[], errors }
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  function record(route, ms, status) {
    let r = rows.get(route); if (!r) rows.set(route, (r = { n: 0, ms: [], errors: 0 }));
    r.n += 1; if (status >= 500) r.errors += 1;
    if (r.ms.length < cap) r.ms.push(ms); else r.ms[r.n % cap] = ms;
  }
  // Express middleware: records when the answer is sent. A request that no route handled (a static file) is not counted.
  function middleware(req, res, next) {
    const t0 = now();
    res.on('finish', () => {
      const pattern = req.route?.path;
      if (pattern === undefined) return;
      record(`${req.method} ${typeof pattern === 'string' ? pattern : String(pattern)}`, now() - t0, res.statusCode);
    });
    next();
  }
  // The report of the window (and the start of the next one): one line per route, the most called first.
  function report() {
    const out = [...rows].map(([route, r]) => { const s = [...r.ms].sort((a, b) => a - b); return { route, n: r.n, p50: pct(s, 0.5), p95: pct(s, 0.95), max: s[s.length - 1], errors: r.errors }; })
      .sort((a, b) => b.n - a.n);
    rows = new Map();
    return out;
  }
  function flush() {
    const out = report();
    if (!out.length) return out;
    log(`route-timing window=${Math.round(windowMs / 1000)}s routes=${out.length}`);
    for (const r of out.slice(0, 40)) log(`route-timing ${r.route} n=${r.n} p50=${r.p50.toFixed(0)}ms p95=${r.p95.toFixed(0)}ms max=${r.max.toFixed(0)}ms${r.errors ? ` errors=${r.errors}` : ''}`);
    if (extra) { try { const e = extra(); if (e) log(`route-timing ${e}`); } catch { /* the log is best effort */ } }
    return out;
  }
  const timer = () => setInterval(flush, windowMs).unref();
  return { middleware, report, flush, record, timer };
}
