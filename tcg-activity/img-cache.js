// A disk cache for the /api/img proxy (Supabase egress, 2026-09-29). Without it each
// member's first view of each image and boss model came from Supabase: the Raid Bosses tab
// alone is 19 MB per member. With it each object leaves Supabase once per deploy (the
// cache dir is inside the container, so a deploy starts it empty).
// - The key is the upstream URL, and only the ?v= version is kept (a changed file gets a
//   new ?v or a new file name, the same rule as the browser's week-long cache). A v that is
//   not short and plain is refused (null): each new v is a new Supabase fetch and disk copy.
// - get(url, { allowMiss }): a miss that would fetch upstream first asks allowMiss() (the
//   per-IP miss limit in server.js); no = { status: 429 }. A hit never asks.
// - Only 200 responses are stored. Many requests for one missing object share one fetch.
// - Past maxBytes it still serves, but stops writing (the whole bucket is ~0.6 GB).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function normalizeImgUrl(base, path, query) {
  const v = new URLSearchParams(query.replace(/^\?/, '')).get('v');
  if (v && !/^[\w.-]{1,32}$/.test(v)) return null;
  return `${base}/${path}${v ? `?v=${encodeURIComponent(v)}` : ''}`;
}

export function createImgCache({ dir, maxBytes = 1.5e9, fetchFn = fetch }) {
  mkdirSync(dir, { recursive: true });
  let used = 0;
  for (const f of readdirSync(dir)) { try { used += statSync(join(dir, f)).size; } catch { /* gone */ } }
  const stats = { hits: 0, upstream: 0, upstreamBytes: 0 };
  const inflight = new Map();

  const save = (file, data) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, data); renameSync(tmp, file); };

  async function get(url, { allowMiss } = {}) {
    const key = createHash('sha256').update(url).digest('hex');
    const body = join(dir, key);
    try {
      const buf = readFileSync(body);
      stats.hits += 1;
      return { status: 200, type: readFileSync(`${body}.type`, 'utf8'), buf };
    } catch { /* a miss */ }
    if (inflight.has(key)) return inflight.get(key);
    if (allowMiss && !allowMiss()) return { status: 429 };
    const p = (async () => {
      stats.upstream += 1;
      const r = await fetchFn(url);
      if (!r.ok) return { status: r.status };
      const buf = Buffer.from(await r.arrayBuffer());
      const type = r.headers.get('content-type') || 'application/octet-stream';
      stats.upstreamBytes += buf.length;
      if (used + buf.length <= maxBytes) {
        try { save(`${body}.type`, type); save(body, buf); used += buf.length; } catch { /* disk full: serve anyway */ }
      }
      return { status: 200, type, buf };
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }
  return { get, stats, used: () => used };
}
