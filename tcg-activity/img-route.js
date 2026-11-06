// The /api/img/ card-art proxy handler (moved from server.js unchanged, S1-FACE B11 adds the boss-files branch):
// stream a card-art object through this server. This replaces Discord's flaky /cdn image proxy. Only the public card-art
// storage path is allowed. With an imgCache (IMG_CACHE=1) each object is kept on disk (img-cache.js), so it leaves the store once.
// B11 (boss-files.js): a boss model or clip comes from the game server's disk when the flag file exists (X-Boss-Source: vm).
// R2-MOVE: IMG_UPSTREAM picks the store (REQUIRED, unset or unknown = refuse to start, parseImgMode):
//   supabase  the Supabase public URL (the code of before)
//   r2-first  R2 (R2_PUBLIC_BASE/card-art/<name>?v=<v>); on ANY non-200 or error, Supabase. Each fallback prints one line at
//             once, `img-fallback <key> <status|error> mode=r2-first` (R2-MOVE G5), and counts fallback (+ r2err when not a 404)
//   r2        R2 only (a failure = that status, or 502)
// The request path stays the logical Supabase path (I-4, I-8): only the fetch URL changes. The disk-cache key stays the
// logical URL in every mode (spec D4), so a switch of mode keeps the warm cache.
import { normalizeImgUrl } from './img-cache.js';
import { artKey, r2Url } from './art-url.js';

export const IMG_MODES = ['supabase', 'r2-first', 'r2'];

/** The mode from the env. Throws the refusal line: the server does not start without a valid mode (R2-MOVE H4). */
export function parseImgMode(env = process.env) {
  const mode = env.IMG_UPSTREAM;
  if (!mode) throw new Error('refused: IMG_UPSTREAM unset (supabase | r2-first | r2)');
  if (!IMG_MODES.includes(mode)) throw new Error(`refused: IMG_UPSTREAM=${mode} unknown`);
  const r2Base = (env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');
  if (mode !== 'supabase' && !/^https?:\/\/[^/]+$/.test(r2Base)) throw new Error(`refused: IMG_UPSTREAM=${mode} needs R2_PUBLIC_BASE`);
  return { mode, r2Base };
}

export function createImgStats() { return { fallback: 0, r2err: 0, r2: 0 }; }

export function createImgHandler({ supaHost, imgMode = { mode: 'supabase', r2Base: '' }, imgStats = createImgStats(), imgCache = null, missLimit = null, clientIp = () => '', bossFiles = null, fetchImpl = (...a) => fetch(...a), log = (line) => console.log(line) }) {
  const { mode, r2Base } = imgMode;
  // The upstream answer for one object: a fetch Response, with r.imgSource = 'r2' | 'supabase'.
  async function upstream(url, key, v) {
    if (mode === 'supabase') {
      const r = await fetchImpl(url);
      r.imgSource = 'supabase';
      return r;
    }
    const r2u = r2Url(key, v, r2Base);
    let status;
    try {
      const r = await fetchImpl(r2u);
      if (r.ok) { imgStats.r2 += 1; r.imgSource = 'r2'; return r; }
      status = r.status;
      if (mode === 'r2') { r.imgSource = 'r2'; return r; }
    } catch (e) {
      if (mode === 'r2') throw e;
      status = 'error';
    }
    // r2-first: R2 did not answer 200. One line at once (a stop or restart cannot lose it), then Supabase.
    imgStats.fallback += 1;
    if (status !== 404) imgStats.r2err += 1;
    log(`img-fallback ${key} ${status} mode=${mode}`);
    const r = await fetchImpl(url);
    r.imgSource = 'supabase';
    return r;
  }

  return async (req, res) => {
    if (!supaHost) return res.status(404).end();
    const path = decodeURIComponent(req.params[0] || '');
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    if (!path.startsWith('storage/v1/object/public/card-art/') || /\.\.|\\|\/\/|%/.test(path)) return res.status(400).end(); // no traversal, no double-encoding
    // Only a short plain ?v (img-cache.js): every new v is a new upstream fetch and disk copy.
    const url = normalizeImgUrl(supaHost, path, query);
    if (!url) return res.status(400).end();
    const key = artKey(path);
    if (!key) return res.status(400).end();
    const v = new URLSearchParams(query.replace(/^\?/, '')).get('v');
    // B11: the boss files from this server's disk (flag file ON + the file exists); else the code path of before
    const boss = bossFiles ? bossFiles.lookup(path) : null;
    if (boss) {
      res.setHeader('Content-Type', boss.type);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('X-Boss-Source', 'vm');
      res.setHeader('Content-Length', String(boss.buf.length));
      return res.end(boss.buf);
    }
    if (imgCache) {
      try {
        // A miss costs upstream egress, so misses are limited per IP (v=1,2,3... each miss). The cache key is the logical URL.
        const r = await imgCache.get(url, { allowMiss: () => missLimit.take(clientIp(req)), fetcher: () => upstream(url, key, v) });
        if (r.status === 429) res.setHeader('Retry-After', '5');
        if (r.status !== 200) return res.status(r.status).end();
        res.setHeader('Content-Type', r.type);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        if (r.source) res.setHeader('X-Img-Source', r.source); // a disk hit has no source header
        return res.end(r.buf);
      } catch { return res.status(502).end(); }
    }
    try {
      const r = await upstream(url, key, v);
      if (!r.ok || !r.body) return res.status(r.ok ? 502 : r.status).end();
      // The body is read whole, so Content-Length is the length of the bytes sent (fetch decodes a gzip answer, so the
      // upstream Content-Length would be wrong). The largest object is 7.5 MB.
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('X-Img-Source', r.imgSource);
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
    } catch { if (!res.headersSent) res.status(502).end(); else res.destroy(); }
  };
}
