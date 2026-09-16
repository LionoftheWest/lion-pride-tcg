/**
 * Scale test for the TCG Activity read path.
 *
 * Ramps concurrency and hammers the authenticated read endpoints with synthetic
 * "lt:<n>" tokens (the server must run with LOADTEST=1). Reports RPS, latency
 * percentiles, and error rate per stage so we can see where it bends.
 *
 * Run:  TARGET=http://localhost:4441 node tools/loadtest.mjs
 *       STAGES=10,50,100,200,400 DURATION=8 node tools/loadtest.mjs
 *
 * Read-only by default. Set INCLUDE_OPEN=1 to also fire a few /api/open calls
 * (writes — only against a scratch backend).
 */
const TARGET = (process.env.TARGET || 'http://localhost:4441').replace(/\/+$/, '');
const STAGES = (process.env.STAGES || '10,50,100,200,400').split(',').map((n) => parseInt(n, 10));
const DURATION = Number(process.env.DURATION || 8) * 1000; // per stage
const INCLUDE_OPEN = process.env.INCLUDE_OPEN === '1';
// USERS caps the number of DISTINCT synthetic identities. With it unset every
// worker is a brand-new user (worst case, all caches cold). Set it to model N
// ACTIVE users who each make many repeat requests and so hit warm per-user
// caches — the realistic "hundreds of concurrent players" shape.
const USERS = Number(process.env.USERS || 0);

// Weighted mix of what a real session does (mostly reads; the feed + collection
// are the chatty ones).
const MIX = [
  { path: '/api/catalog', w: 3, auth: true },
  { path: '/api/collection', w: 4, auth: true },
  { path: '/api/pulls', w: 3, auth: true },
  { path: '/api/pack-status', w: 3, auth: true },
  { path: '/api/players', w: 1, auth: true },
  { path: '/api/config', w: 1, auth: false },
];
if (INCLUDE_OPEN) MIX.push({ path: '/api/open', w: 1, auth: true, method: 'POST' });

const bag = [];
for (const m of MIX) for (let i = 0; i < m.w; i += 1) bag.push(m);
const pick = () => bag[(Math.random() * bag.length) | 0];

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function oneRequest(uid, stat) {
  const m = pick();
  const t0 = performance.now();
  try {
    const headers = {};
    if (m.auth) headers.authorization = `Bearer lt:${uid}`;
    const opts = { method: m.method || 'GET', headers };
    if (m.method === 'POST') { opts.headers['content-type'] = 'application/json'; opts.body = '{}'; }
    const r = await fetch(TARGET + m.path, opts);
    await r.arrayBuffer(); // drain the body so keep-alive can reuse the socket
    const dt = performance.now() - t0;
    stat.lat.push(dt);
    stat.status[r.status] = (stat.status[r.status] || 0) + 1;
    if (r.status >= 400) stat.errors += 1;
  } catch (e) {
    stat.lat.push(performance.now() - t0);
    stat.errors += 1;
    stat.status.EXC = (stat.status.EXC || 0) + 1;
  }
  stat.count += 1;
}

async function worker(uid, until, stat) {
  while (performance.now() < until) await oneRequest(uid, stat);
}

async function runStage(concurrency) {
  const stat = { count: 0, errors: 0, lat: [], status: {} };
  const until = performance.now() + DURATION;
  const workers = [];
  for (let i = 0; i < concurrency; i += 1) workers.push(worker(USERS ? i % USERS : i, until, stat));
  const wall0 = performance.now();
  await Promise.all(workers);
  const wall = (performance.now() - wall0) / 1000;
  const sorted = stat.lat.sort((a, b) => a - b);
  return {
    concurrency,
    rps: (stat.count / wall).toFixed(0),
    total: stat.count,
    errPct: ((stat.errors / stat.count) * 100).toFixed(1),
    p50: pct(sorted, 50).toFixed(0),
    p95: pct(sorted, 95).toFixed(0),
    p99: pct(sorted, 99).toFixed(0),
    max: (sorted[sorted.length - 1] || 0).toFixed(0),
    status: stat.status,
  };
}

(async () => {
  console.log(`\nTARGET ${TARGET}  stages=${STAGES.join(',')}  ${DURATION / 1000}s each  open=${INCLUDE_OPEN}\n`);
  console.log('conc    RPS     total   err%   p50ms   p95ms   p99ms   maxms   statuses');
  for (const c of STAGES) {
    const r = await runStage(c);
    console.log(
      `${String(r.concurrency).padEnd(6)}  ${String(r.rps).padEnd(6)}  ${String(r.total).padEnd(6)}  ${String(r.errPct).padEnd(5)}  ${String(r.p50).padEnd(6)}  ${String(r.p95).padEnd(6)}  ${String(r.p99).padEnd(6)}  ${String(r.max).padEnd(6)}  ${JSON.stringify(r.status)}`,
    );
  }
  console.log('');
})();
