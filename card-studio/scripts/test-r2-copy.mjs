// R2-MOVE G1: r2-copy.mjs and r2-verify.mjs against stubs (no network, no vault, no live write).
//   node scripts/test-r2-copy.mjs
// Stubs (real local HTTP servers): Supabase storage (list, upload, delete, authenticated GET, the rest rows), the Activity
// proxy (stale answers, a 429), and S3 (R2): it CHECKS Content-MD5 like R2 (400 on a mismatch) and answers ETag = MD5;
// it can corrupt one PUT body "in transit" and records whether it stored a corrupted body.
// Cases: baseline (6 objects, one stale twice then right, one 429 at the proxy) -> R2VERIFY PASS n=6; a missing key ->
// missing=1; I-7 other host; --delta refusals; the overwrite test (H1) with DELTA-DEL; the post-S4 test (M1) with --reverse.
// Output: TEST <name> PASS|FAIL lines, then RESULT PASS|FAIL (exit 1 on any FAIL).
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArtStore } from '../src/art-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const md5 = (b) => createHash('md5').update(b).digest('hex');
const B = 'test-bucket';

function listen(handler) {
  return new Promise((res) => {
    const s = http.createServer(async (req, rs) => {
      const chunks = []; for await (const c of req) chunks.push(c);
      try { await handler(req, rs, Buffer.concat(chunks)); } catch (e) { rs.writeHead(500); rs.end(String(e)); }
    });
    s.listen(0, '127.0.0.1', () => res({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

// ---- stub Supabase
const supa = { objs: new Map(), authGets: 0, uploads: 0 };
const setSupa = (name, buf, type) => supa.objs.set(name, { buf, type, etag: md5(buf), updated_at: new Date().toISOString() });
const S = await listen(async (req, res, body) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.method === 'POST' && p === '/storage/v1/object/list/card-art') {
    const { prefix = '', limit = 100, offset = 0 } = JSON.parse(body.toString());
    const pre = prefix ? `${prefix}/` : '';
    const folders = new Set(); const files = [];
    for (const [name, o] of supa.objs) {
      if (!name.startsWith(pre)) continue;
      const rest = name.slice(pre.length);
      if (rest.includes('/')) folders.add(rest.split('/')[0]);
      else files.push({ name: rest, id: `id-${name}`, updated_at: o.updated_at, created_at: o.updated_at, metadata: { eTag: `"${o.etag}"`, size: o.buf.length, mimetype: o.type, lastModified: o.updated_at } });
    }
    const all = [...[...folders].sort().map((f) => ({ name: f, id: null, metadata: null })), ...files.sort((a, b) => (a.name < b.name ? -1 : 1))];
    return json(200, all.slice(offset, offset + limit));
  }
  if (req.method === 'POST' && p.startsWith('/storage/v1/object/card-art/')) {
    supa.uploads += 1; setSupa(p.slice('/storage/v1/object/card-art/'.length), body, req.headers['content-type']);
    return json(200, { Key: p });
  }
  if (req.method === 'DELETE' && p === '/storage/v1/object/card-art') {
    const { prefixes } = JSON.parse(body.toString());
    for (const n of prefixes) supa.objs.delete(n);
    return json(200, prefixes.map((name) => ({ name })));
  }
  if (req.method === 'GET' && p.startsWith('/storage/v1/object/authenticated/card-art/')) {
    supa.authGets += 1;
    const o = supa.objs.get(p.slice('/storage/v1/object/authenticated/card-art/'.length));
    if (!o) return json(404, { error: 'not found' });
    res.writeHead(200, { 'content-type': o.type }); return res.end(o.buf);
  }
  if (req.method === 'GET' && p.startsWith('/rest/v1/')) return json(200, []);
  json(404, { error: `stub: ${req.method} ${p}` });
});

// ---- stub Activity proxy: mode per name { stale: n } (n stale answers first) or { s429: true }
const proxy = { mode: new Map(), gets: 0 };
const P = await listen(async (req, res) => {
  proxy.gets += 1;
  const m = /^\/storage\/v1\/object\/public\/card-art\/([^?]+)/.exec(req.url);
  const name = m && decodeURIComponent(m[1]);
  const o = name && supa.objs.get(name);
  const md = proxy.mode.get(name) || {};
  if (md.s429) { res.writeHead(429); return res.end(); }
  if (!o) { res.writeHead(404); return res.end(); }
  if (md.stale > 0) { md.stale -= 1; res.writeHead(200, { 'content-type': o.type }); return res.end(Buffer.concat([o.buf, Buffer.from('STALE')])); }
  res.writeHead(200, { 'content-type': o.type }); res.end(o.buf);
});

// ---- stub S3 (R2)
const s3 = { objs: new Map(), corruptOnce: new Set(), corruptAccepted: 0, putsNoMd5: 0, md5Refused: 0, puts: 0, cacheBad: 0 };
const X = await listen(async (req, res, body) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/pub/')) { // the public domain (img.lionpridetcg.com)
    const o = s3.objs.get(p.slice(5));
    if (!o) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': o.type, etag: `"${o.etag}"` }); return res.end(o.buf);
  }
  if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256')) { res.writeHead(403); return res.end('unsigned'); }
  if (p === `/${B}` && u.searchParams.get('list-type') === '2') {
    const pre = u.searchParams.get('prefix') || '';
    const items = [...s3.objs].filter(([k]) => k.startsWith(pre)).sort();
    res.writeHead(200, { 'content-type': 'application/xml' });
    return res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${items.map(([k, o]) => `<Contents><Key>${k}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>${o.buf.length}</Size><LastModified>${o.at}</LastModified></Contents>`).join('')}</ListBucketResult>`);
  }
  const key = p.slice(B.length + 2);
  if (req.method === 'PUT') {
    s3.puts += 1;
    if (req.headers['cache-control'] !== 'public, max-age=604800') s3.cacheBad += 1;
    let buf = body;
    let corrupted = false;
    if (s3.corruptOnce.has(key)) { s3.corruptOnce.delete(key); buf = Buffer.from(body); buf[0] ^= 0xff; corrupted = true; }
    const cm = req.headers['content-md5'];
    if (!cm) s3.putsNoMd5 += 1;
    else if (Buffer.from(cm, 'base64').toString('hex') !== md5(buf)) { s3.md5Refused += 1; res.writeHead(400); return res.end('<Error><Code>BadDigest</Code></Error>'); }
    if (corrupted) s3.corruptAccepted += 1;
    s3.objs.set(key, { buf, type: req.headers['content-type'] || 'application/octet-stream', etag: md5(buf), at: new Date().toISOString() });
    res.writeHead(200, { etag: `"${md5(buf)}"` }); return res.end();
  }
  const o = s3.objs.get(key);
  if (req.method === 'DELETE') { s3.objs.delete(key); res.writeHead(204); return res.end(); }
  if (!o) { res.writeHead(404); return res.end(); }
  const h = { 'content-type': o.type, etag: `"${o.etag}"`, 'content-length': String(o.buf.length) };
  if (req.method === 'HEAD') { res.writeHead(200, h); return res.end(); }
  res.writeHead(200, h); res.end(o.buf);
});

// ---- the child runs
const tmp = mkdtempSync(join(tmpdir(), 'r2-copy-'));
const STATE = join(tmp, 'state'); const BACKUP = join(tmp, 'backup');
mkdirSync(STATE, { recursive: true }); mkdirSync(join(BACKUP, 'cards'), { recursive: true });
const ENV = {
  ...process.env, R2_TEST: '1', SUPABASE_URL: S.url, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', R2_ENDPOINT: X.url, R2_BUCKET: B,
  R2_PROXY_BASE: P.url, R2_BACKUP_DIR: BACKUP, ART_STATE_DIR: STATE, ART_WRITE_LOG: join(STATE, 'art-writes.jsonl'), R2_WORK_DIR: join(tmp, 'work'), ART_STORE: '',
};
const node = (script, args, env = {}) => new Promise((res) => {
  execFile(process.execPath, [join(here, script), ...args], { env: { ...ENV, ...env }, timeout: 120_000 }, (err, stdout, stderr) =>
    res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`TEST ${name} ${ok ? 'PASS' : 'FAIL'}${ok || !detail ? '' : `\n${detail.trim().split('\n').map((l) => `    | ${l}`).join('\n')}`}`);
  if (!ok) failed += 1;
}
const r2Etag = (k) => s3.objs.get(k)?.etag;

try {
  // ---- baseline: 6 objects of 5 types
  const objs = [
    ['cards/a-normal.png', 'image/png'], ['cards/b-gold.webp', 'image/webp'], ['boss/models/c.glb', 'model/gltf-binary'],
    ['boss/behemoth/d.webm', 'video/webm'], ['boss/behemoth/e.mp4', 'video/mp4'], ['grid/cards/a-normal.webp', 'image/webp'],
  ];
  for (const [n, t] of objs) setSupa(n, Buffer.from(`bytes of ${n} ${'x'.repeat(50)}`), t);
  writeFileSync(join(BACKUP, 'cards/a-normal.png'), supa.objs.get('cards/a-normal.png').buf);
  proxy.mode.set('cards/b-gold.webp', { stale: 2 });
  proxy.mode.set('boss/models/c.glb', { s429: true });
  s3.corruptOnce.add('card-art/boss/behemoth/e.mp4');

  const plan = await node('r2-copy.mjs', []);
  check('plan-only-writes-nothing', plan.code === 0 && s3.puts === 0 && /PLAN card-art\/cards\/a-normal.png/.test(plan.out), plan.out);
  const c1 = await node('r2-copy.mjs', ['--live']);
  check('copy-live', c1.code === 0 && /copied=6/.test(c1.out), c1.out);
  check('source-1-backup', /COPY card-art\/cards\/a-normal.png src=1/.test(c1.out), c1.out);
  check('source-2-proxy-after-2-stale', /COPY card-art\/cards\/b-gold.webp src=2/.test(c1.out), c1.out);
  check('source-3-supabase-after-429', /COPY card-art\/boss\/models\/c.glb src=3/.test(c1.out), c1.out);
  check('content-md5-every-put', s3.putsNoMd5 === 0, `puts without Content-MD5: ${s3.putsNoMd5}`);
  check('corrupt-in-transit-refused', s3.md5Refused === 1 && s3.corruptAccepted === 0, `md5Refused=${s3.md5Refused} corruptAccepted=${s3.corruptAccepted}`);
  check('cache-control-every-put', s3.cacheBad === 0, `puts with another Cache-Control: ${s3.cacheBad}`);
  const v1 = await node('r2-verify.mjs', ['--exact']);
  check('baseline-verify-pass-n6', v1.code === 0 && /R2VERIFY PASS n=6 /.test(v1.out), v1.out);
  const c2 = await node('r2-copy.mjs', ['--live']);
  check('second-copy-skips-all', c2.code === 0 && /copied=0 skipped=6/.test(c2.out), c2.out);

  // ---- a missing key and a wrong type are seen
  const saved = s3.objs.get('card-art/boss/behemoth/d.webm');
  s3.objs.delete('card-art/boss/behemoth/d.webm');
  const v2 = await node('r2-verify.mjs', ['--exact']);
  check('verify-sees-missing', v2.code === 1 && /missing=1/.test(v2.out) && /DIFF card-art\/boss\/behemoth\/d.webm exists yes no/.test(v2.out), v2.out);
  s3.objs.set('card-art/boss/behemoth/d.webm', { ...saved, type: 'application/octet-stream' });
  const v3 = await node('r2-verify.mjs', ['--exact']);
  check('verify-sees-type', v3.code === 1 && /type=1/.test(v3.out), v3.out);
  s3.objs.set('card-art/boss/behemoth/d.webm', saved);

  // ---- --before (S4 step 3)
  const v4 = await node('r2-verify.mjs', ['--exact', '--before', new Date(Date.now() + 60_000).toISOString()]);
  check('before-future-pass', v4.code === 0 && /R2VERIFY PASS/.test(v4.out), v4.out);
  const v5 = await node('r2-verify.mjs', ['--exact', '--before', '2000-01-01T00:00:00Z']);
  check('before-past-fail', v5.code === 1 && /after=6/.test(v5.out) && /AFTER-T0 card-art\/cards\/a-normal.png/.test(v5.out), v5.out);

  // ---- I-7: another Supabase host, and a localhost stub without R2_TEST
  const i7 = await node('r2-copy.mjs', ['--live'], { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' });
  check('i7-other-host-refused', i7.code !== 0 && /refused: SUPABASE_URL is not kgvdqqehefezbypozvrh \(I-7\)/.test(i7.out), i7.out);
  const i7b = await node('r2-copy.mjs', ['--live'], { R2_TEST: '' });
  check('i7-stub-needs-r2-test', i7b.code !== 0 && /I-7/.test(i7b.out), i7b.out);
  const d0 = await node('r2-copy.mjs', ['--live', '--delta']);
  check('delta-needs-frozen', d0.code !== 0 && /refused: --delta without FROZEN/.test(d0.out), d0.out);

  // ---- the overwrite test (H1): K overwritten in Supabase after the first copy; D deleted in Supabase
  const K = 'cards/b-gold.webp';
  setSupa(K, Buffer.from(`NEW bytes of ${K} ${'y'.repeat(60)}`), 'image/webp');
  supa.objs.delete('grid/cards/a-normal.webp');
  const v6 = await node('r2-verify.mjs', ['--exact']);
  check('overwrite-seen-before-delta', v6.code === 1 && new RegExp(`DIFF card-art/${K} etag`).test(v6.out), v6.out);
  writeFileSync(join(STATE, 'FROZEN'), `${new Date().toISOString()} test\n`);
  const d1 = await node('r2-copy.mjs', ['--live', '--delta']);
  check('delta-copies-K', d1.code === 0 && new RegExp(`COPY card-art/${K} src=`).test(d1.out), d1.out);
  check('delta-del-D', /DELTA-DEL card-art\/grid\/cards\/a-normal.webp/.test(d1.out) && !s3.objs.has('card-art/grid/cards/a-normal.webp'), d1.out);
  const v7 = await node('r2-verify.mjs', ['--exact', '--write-manifest', join(STATE, 'manifest.json')]);
  check('delta-exact-pass', v7.code === 0 && /R2VERIFY PASS n=5 /.test(v7.out) && /MANIFEST/.test(v7.out), v7.out);
  const pub = await fetch(`${X.url}/pub/card-art/${K}`);
  const pubBuf = Buffer.from(await pub.arrayBuffer());
  check('r2-public-serves-new-bytes', pub.status === 200 && md5(pubBuf) === supa.objs.get(K).etag, `status ${pub.status}`);

  // ---- the post-S4 test (M1): CUTOVER, ART_STORE=r2, a push overwrites K in R2 through art-store (write log line)
  writeFileSync(join(STATE, 'CUTOVER'), `${new Date().toISOString()} test\n`);
  rmSync(join(STATE, 'FROZEN'));
  const store = createArtStore({
    env: { ART_STORE: 'r2', ART_STATE_DIR: STATE, ART_WRITE_LOG: ENV.ART_WRITE_LOG, R2_BUCKET: B },
    vault: () => ({ accountId: 'test', accessKeyId: 'test-key-id', secretAccessKey: 'test-secret', bucket: B }),
    endpoint: X.url,
  });
  const pushed = Buffer.from(`PUSHED after the cut ${K} ${'z'.repeat(70)}`);
  await store.withWrite(`push b gold`, () => store.put(K, pushed, 'image/webp'));
  check('push-wrote-r2', r2Etag(`card-art/${K}`) === md5(pushed));
  const v8 = await node('r2-verify.mjs', ['--manifest', join(STATE, 'manifest.json')]);
  check('post-cut-verify-newer', v8.code === 0 && /R2VERIFY PASS n=5 .*newer=1/.test(v8.out), v8.out);
  const c3 = await node('r2-copy.mjs', ['--live']);
  check('copy-after-cut-refused', c3.code !== 0 && /refused: cut to R2/.test(c3.out) && r2Etag(`card-art/${K}`) === md5(pushed), c3.out);
  const v8b = await node('r2-verify.mjs', ['--manifest', join(STATE, 'manifest.json')]);
  check('post-cut-verify-still-newer', v8b.code === 0 && /newer=1/.test(v8b.out), v8b.out);
  const rv = await node('r2-copy.mjs', ['--live', '--reverse']);
  check('reverse-copies-K', rv.code === 0 && new RegExp(`COPY card-art/${K} src=r2`).test(rv.out) && supa.objs.get(K).etag === md5(pushed), rv.out);
  const v9 = await node('r2-verify.mjs', ['--exact']);
  check('reverse-exact-pass', v9.code === 0 && /R2VERIFY PASS n=5 /.test(v9.out), v9.out);
} catch (e) {
  check('no-exception', false, e.stack);
} finally {
  for (const x of [S, P, X]) x.s.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `RESULT FAIL failed=${failed}` : 'RESULT PASS failed=0');
process.exit(failed ? 1 : 0);
