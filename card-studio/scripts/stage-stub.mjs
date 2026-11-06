// S1-FACE B9: the LOCAL STUB of the guard and orphans tests. A recording HTTP proxy in front of a local Supabase copy.
//   const stub = await startStub({ upstream: 'http://127.0.0.1:20242', meta: 'http://127.0.0.1:28799' });
//   stub.url (the base of the API), stub.metaUrl (the base of the postgres-meta /query: the Management SQL of the preload), stub.log
//   (every request: { method, path, body }), stub.mode (see below), stub.close()
// It forwards each request to the upstream copy and records it. stub.mode changes the answer of the storage LIST call of the prefix
// "cards" (the orphans tests): { extra: [{ name, size }], drop: [names], size: { name: bytes }, fake: Map(name -> size) }.
// fake: GET of /storage/v1/object/public/card-art/<name> returns <size> bytes (the local copy has the metadata but not the files);
// DELETE /storage/v1/object/card-art (body { prefixes }) is recorded, NOT forwarded, and the names then answer 404.
import http from 'node:http';

export async function startStub({ upstream, meta }) {
  const log = [];
  const stub = { log, mode: {}, deleted: new Set(), cdnCache: new Map(), cdnHits: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const isMeta = req.url.startsWith('/__meta');
    const path = isMeta ? req.url.slice(7) : req.url;
    log.push({ method: req.method, path, meta: isMeta, body: body.length ? body.toString('utf8').slice(0, 2000) : '' });
    const m = stub.mode;
    const pub = path.match(/^\/storage\/v1\/object\/public\/card-art\/([^?]+)/);
    const name = pub ? decodeURIComponent(pub[1]) : null;
    // the CDN (S1-FACE swap: Cloudflare kept a 200 of deleted objects, BOARD 2026-11-04 22:15): mode.cdn = true caches each 200 answer of a
    // public GET/HEAD by the FULL path + query, and answers a repeat from the cache (a deleted object stays "200"); a new query = a MISS.
    if (pub && m.cdn && stub.cdnCache.has(`${req.method} ${path}`)) {
      const c = stub.cdnCache.get(`${req.method} ${path}`);
      stub.cdnHits += 1;
      res.writeHead(200, { ...c.h, 'cf-cache-status': 'HIT' }); res.end(req.method === 'HEAD' ? undefined : c.body); return;
    }
    if (name && stub.deleted.has(name)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not found"}'); return; }
    if (name && m.fake?.has(name)) { const n = m.fake.get(name); res.writeHead(200, { 'content-type': 'image/png', 'content-length': n }); res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(n, 7)); return; }
    // mode.forwardDelete (the swap tests): a DELETE goes to the copy like every other request
    if (req.method === 'DELETE' && path === '/storage/v1/object/card-art' && !m.forwardDelete) {
      const names = JSON.parse(body.toString('utf8')).prefixes || [];
      for (const n of names) stub.deleted.add(n);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(names.map((n) => ({ name: n })))); return;
    }
    const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
    const r = await fetch((isMeta ? meta : upstream) + path, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    let out = Buffer.from(await r.arrayBuffer());
    if (req.method === 'POST' && path === '/storage/v1/object/list/card-art') {
      const q = JSON.parse(body.toString('utf8') || '{}');
      if (q.prefix === 'cards' && (m.extra || m.drop || m.size)) {
        let list = JSON.parse(out.toString('utf8'));
        if (m.drop) list = list.filter((e) => !m.drop.includes(`cards/${e.name}`));
        if (m.size) for (const e of list) if (m.size[`cards/${e.name}`] != null) e.metadata = { ...e.metadata, size: m.size[`cards/${e.name}`] };
        for (const x of m.extra || []) if ((q.offset || 0) === 0) list.push({ name: x.name.replace(/^cards\//, ''), id: 'stub', metadata: { size: x.size, eTag: '"stub"' } });
        out = Buffer.from(JSON.stringify(list));
      }
      // a name that the stub "deleted" (fake mode) is not listed any more; mode.inflate = <bytes>: one more file in the root (the limit tests)
      if (r.ok && (stub.deleted.size || (m.inflate && !q.prefix && !(q.offset > 0)))) {
        let list = JSON.parse(out.toString('utf8'));
        if (stub.deleted.size) list = list.filter((e) => !stub.deleted.has(q.prefix ? `${q.prefix}/${e.name}` : e.name));
        if (m.inflate && !q.prefix && !(q.offset > 0)) list.push({ name: 'zz-stub-inflate.bin', id: 'stub-inflate', metadata: { size: m.inflate, eTag: '"stub"' } });
        out = Buffer.from(JSON.stringify(list));
      }
    }
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    if (pub && req.method === 'HEAD' && r.headers.get('content-length')) h['content-length'] = r.headers.get('content-length');
    if (pub && m.cdn && r.status === 200) stub.cdnCache.set(`${req.method} ${path}`, { h: { ...h, 'content-length': req.method === 'HEAD' ? h['content-length'] : String(out.length) }, body: out });
    res.writeHead(r.status, h); res.end(req.method === 'HEAD' ? undefined : out);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  stub.url = `http://127.0.0.1:${port}`;
  stub.metaUrl = `http://127.0.0.1:${port}/__meta`;
  stub.close = () => new Promise((r) => server.close(r));
  return stub;
}
