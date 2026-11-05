// The /api/img/ card-art proxy handler (moved from server.js unchanged, S1-FACE B11 adds the boss-files branch):
// stream a Supabase storage object through this server. This replaces Discord's flaky /cdn image proxy. Only the public card-art
// storage path is allowed. With an imgCache (IMG_CACHE=1) each object is kept on disk (img-cache.js), so it leaves Supabase once.
// B11 (boss-files.js): a boss model or clip comes from the game server's disk when the flag file exists (X-Boss-Source: vm).
import { Readable } from 'node:stream';
import { normalizeImgUrl } from './img-cache.js';

export function createImgHandler({ supaHost, imgCache = null, missLimit = null, clientIp = () => '', bossFiles = null, fetchImpl = (...a) => fetch(...a) }) {
  return async (req, res) => {
    if (!supaHost) return res.status(404).end();
    const path = decodeURIComponent(req.params[0] || '');
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    if (!path.startsWith('storage/v1/object/public/card-art/') || /\.\.|\\|\/\/|%/.test(path)) return res.status(400).end(); // no traversal, no double-encoding
    // Only a short plain ?v (img-cache.js): every new v is a new Supabase fetch and disk copy.
    const url = normalizeImgUrl(supaHost, path, query);
    if (!url) return res.status(400).end();
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
        // A miss costs Supabase egress, so misses are limited per IP (v=1,2,3... each miss).
        const r = await imgCache.get(url, { allowMiss: () => missLimit.take(clientIp(req)) });
        if (r.status === 429) res.setHeader('Retry-After', '5');
        if (r.status !== 200) return res.status(r.status).end();
        res.setHeader('Content-Type', r.type);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        return res.end(r.buf);
      } catch { return res.status(502).end(); }
    }
    try {
      const r = await fetchImpl(url);
      if (!r.ok || !r.body) return res.status(r.ok ? 502 : r.status).end();
      res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      const len = r.headers.get('content-length');
      if (len) res.setHeader('Content-Length', len);
      Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) res.status(502).end(); else res.destroy(); }
  };
}
