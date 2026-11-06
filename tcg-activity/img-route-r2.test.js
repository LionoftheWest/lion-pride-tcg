// R2-MOVE G2: the /api/img/ handler (img-route.js) in each IMG_UPSTREAM mode, with stub upstreams.
// Every case runs twice: with the disk cache (IMG_CACHE=1, a temp dir) and without it (spec L6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import { createImgHandler, createImgStats, parseImgMode } from './img-route.js';
import { createImgCache, normalizeImgUrl } from './img-cache.js';
import { createBossFiles } from './boss-files.js';

const here = dirname(fileURLToPath(import.meta.url));
const SUPA = 'https://kgvdqqehefezbypozvrh.supabase.co';
const R2 = 'https://img.lionpridetcg.test';
const P = 'storage/v1/object/public/card-art/';
// The 5 vectors (cards, grid, reveal, boss, sets) and the 14f533ea fetch URL of each (normalizeImgUrl of before).
const VECTORS = [
  { path: `${P}cards/abc-common.png`, q: '?v=1730000000000', key: 'card-art/cards/abc-common.png' },
  { path: `${P}grid/cards/abc-common.webp`, q: '?v=17', key: 'card-art/grid/cards/abc-common.webp' },
  { path: `${P}reveal/cards/abc-gold.webp`, q: '?v=r2m1', key: 'card-art/reveal/cards/abc-gold.webp' },
  { path: `${P}boss/models/warrok-z2.glb`, q: '', key: 'card-art/boss/models/warrok-z2.glb' },
  { path: `${P}sets/s1-still.png`, q: '?v=9', key: 'card-art/sets/s1-still.png' },
];
const BEFORE = (v) => `${SUPA}/${v.path}${v.q}`; // the 14f533ea upstream URL = the cache key

// A stub fetch: R2 answers r2 (a status, 'error' = a network error), Supabase answers supa. Each call is recorded.
function stubFetch({ r2 = 200, supa = 200, gzipLen = false } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const isR2 = url.startsWith(R2 + '/');
    const st = isR2 ? r2 : supa;
    if (st === 'error') throw new TypeError('fetch failed');
    const body = Buffer.from(isR2 ? 'FROM-R2' : 'FROM-SUPABASE');
    const headers = { 'content-type': 'image/webp', 'content-length': gzipLen ? '999' : String(body.length) };
    return new Response(st === 200 ? body : null, { status: st, headers });
  };
  return { f, calls, r2Calls: () => calls.filter((u) => u.startsWith(R2 + '/')), supaCalls: () => calls.filter((u) => u.startsWith(SUPA + '/')) };
}

// a minimal express-like req/res (a Writable, so the old pipe path also works)
async function call(handler, path, query = '?v=1') {
  const headers = {}; let status = 200; const chunks = [];
  let done; const finished = new Promise((r) => { done = r; });
  const w = new Writable({ write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); }, final(cb) { done(); cb(); } });
  w.setHeader = (k, v) => { headers[k.toLowerCase()] = String(v); };
  w.headersSent = false;
  const origEnd = w.end.bind(w);
  w.end = (b) => { if (b) chunks.push(Buffer.from(b)); done(); return origEnd(); };
  w.status = (s) => { status = s; return w; };
  await handler({ params: [path], originalUrl: `/api/img/${path}${query}`, headers: {}, socket: {} }, w);
  await Promise.race([finished, new Promise((r) => setTimeout(r, 2000))]);
  return { status, headers, body: Buffer.concat(chunks).toString() };
}

const CACHE_BRANCHES = ['cache', 'nocache'];
function handlerFor(branch, mode, stub, extra = {}) {
  const dir = branch === 'cache' ? mkdtempSync(join(tmpdir(), 'img-r2-')) : null;
  const imgCache = dir ? (extra.imgCache || createImgCache({ dir, fetchFn: stub.f })) : null;
  const imgStats = createImgStats();
  const lines = [];
  const h = createImgHandler({
    supaHost: SUPA, imgMode: { mode, r2Base: R2 }, imgStats, imgCache, fetchImpl: stub.f,
    missLimit: { take: () => true }, log: (l) => lines.push(l), ...extra,
  });
  return { h, imgStats, lines, dir, imgCache };
}

for (const branch of CACHE_BRANCHES) {
  test(`[${branch}] supabase: the fetch URL and the cache key = the 14f533ea values, 0 R2 calls`, async () => {
    for (const v of VECTORS) {
      const s = stubFetch();
      const { h, dir } = handlerFor(branch, 'supabase', s);
      const r = await call(h, v.path, v.q);
      assert.equal(r.status, 200); assert.equal(r.body, 'FROM-SUPABASE');
      assert.deepEqual(s.calls, [BEFORE(v)], 'the upstream URL of before');
      assert.equal(normalizeImgUrl(SUPA, v.path, v.q), BEFORE(v));
      assert.equal(r.headers['x-img-source'], 'supabase');
      if (dir) {
        const key = createHash('sha256').update(BEFORE(v)).digest('hex');
        assert.ok(existsSync(join(dir, key)), 'the cache file name = sha256 of the URL of before');
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test(`[${branch}] r2-first: R2 200 -> served from R2, X-Img-Source r2, 0 Supabase calls; the R2 URL = base/card-art/<name>?v=<v>`, async () => {
    for (const v of VECTORS) {
      const s = stubFetch();
      const { h, imgStats, lines } = handlerFor(branch, 'r2-first', s);
      const r = await call(h, v.path, v.q);
      assert.equal(r.status, 200); assert.equal(r.body, 'FROM-R2'); assert.equal(r.headers['x-img-source'], 'r2');
      assert.deepEqual(s.calls, [`${R2}/${v.key}${v.q}`]);
      assert.equal(s.supaCalls().length, 0);
      assert.deepEqual({ ...imgStats }, { fallback: 0, r2err: 0, r2: 1 }); assert.deepEqual(lines, []);
    }
  });

  for (const st of [404, 403, 500, 'error']) {
    test(`[${branch}] r2-first: R2 ${st} -> Supabase, X-Img-Source supabase, fallback +1${st === 404 ? '' : ', r2err +1'}, one img-fallback line`, async () => {
      const s = stubFetch({ r2: st });
      const { h, imgStats, lines } = handlerFor(branch, 'r2-first', s);
      const v = VECTORS[0];
      const r = await call(h, v.path, v.q);
      assert.equal(r.status, 200); assert.equal(r.body, 'FROM-SUPABASE'); assert.equal(r.headers['x-img-source'], 'supabase');
      assert.equal(s.r2Calls().length, 1); assert.deepEqual(s.supaCalls(), [BEFORE(v)]);
      assert.equal(imgStats.fallback, 1); assert.equal(imgStats.r2err, st === 404 ? 0 : 1);
      assert.deepEqual(lines, [`img-fallback ${v.key} ${st} mode=r2-first`]);
    });
  }

  test(`[${branch}] r2-first: both fail -> the Supabase status`, async () => {
    const s = stubFetch({ r2: 404, supa: 404 });
    const { h } = handlerFor(branch, 'r2-first', s);
    const r = await call(h, VECTORS[0].path, VECTORS[0].q);
    assert.equal(r.status, 404);
    const s2 = stubFetch({ r2: 500, supa: 'error' });
    const r2 = await call(handlerFor(branch, 'r2-first', s2).h, VECTORS[0].path, VECTORS[0].q);
    assert.equal(r2.status, 502);
  });

  for (const st of [404, 403, 500, 'error']) {
    test(`[${branch}] r2: R2 ${st} -> ${st === 'error' ? 502 : st}, 0 Supabase calls`, async () => {
      const s = stubFetch({ r2: st });
      const { h, imgStats, lines } = handlerFor(branch, 'r2', s);
      const r = await call(h, VECTORS[1].path, VECTORS[1].q);
      assert.equal(r.status, st === 'error' ? 502 : st);
      assert.equal(s.supaCalls().length, 0); assert.equal(s.r2Calls().length, 1);
      assert.equal(imgStats.fallback, 0); assert.deepEqual(lines, []);
    });
  }

  test(`[${branch}] all modes: the path rule unchanged, and the B11 boss branch first (X-Boss-Source: vm, 0 fetch)`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boss-'));
    mkdirSync(join(dir, 'models')); mkdirSync(join(dir, 'behemoth'));
    writeFileSync(join(dir, 'models', 'warrok-z2.glb'), 'GLB-FROM-VM'); writeFileSync(join(dir, 'ENABLED'), '');
    for (const mode of ['supabase', 'r2-first', 'r2']) {
      const s = stubFetch();
      const { h } = handlerFor(branch, mode, s, { bossFiles: createBossFiles({ dir }) });
      const b = await call(h, VECTORS[3].path, '');
      assert.equal(b.body, 'GLB-FROM-VM'); assert.equal(b.headers['x-boss-source'], 'vm'); assert.equal(s.calls.length, 0);
      for (const bad of ['storage/v1/object/public/report-shots/a.png', `${P}../x.png`, `${P}cards//a.png`, `${P}a%2e.png`]) {
        assert.equal((await call(h, bad)).status, 400, `${mode} ${bad}`);
      }
      assert.equal((await call(h, VECTORS[0].path, '?v=' + 'x'.repeat(40))).status, 400, 'a long v');
      assert.equal(s.calls.length, 0);
    }
    rmSync(dir, { recursive: true, force: true });
  });
}

test('[nocache] Content-Length = the length of the bytes sent (an upstream gzip length is not copied)', async () => {
  for (const mode of ['supabase', 'r2-first', 'r2']) {
    const s = stubFetch({ gzipLen: true });
    const { h } = handlerFor('nocache', mode, s);
    const r = await call(h, VECTORS[0].path, VECTORS[0].q);
    assert.equal(r.headers['content-length'], String(Buffer.byteLength(r.body)), mode);
  }
});

test('[cache] warm cache: fetched in supabase, switched to r2 with R2 down -> 200 from disk (the key is the logical URL)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'img-warm-'));
  const s1 = stubFetch();
  const c1 = createImgCache({ dir, fetchFn: s1.f });
  const h1 = createImgHandler({ supaHost: SUPA, imgMode: { mode: 'supabase', r2Base: R2 }, imgCache: c1, fetchImpl: s1.f, missLimit: { take: () => true } });
  assert.equal((await call(h1, VECTORS[0].path, VECTORS[0].q)).body, 'FROM-SUPABASE');
  const s2 = stubFetch({ r2: 'error', supa: 'error' });
  const c2 = createImgCache({ dir, fetchFn: s2.f }); // a restart with the new env: the same disk
  const h2 = createImgHandler({ supaHost: SUPA, imgMode: { mode: 'r2', r2Base: R2 }, imgCache: c2, fetchImpl: s2.f, missLimit: { take: () => true } });
  const r = await call(h2, VECTORS[0].path, VECTORS[0].q);
  assert.equal(r.status, 200); assert.equal(r.body, 'FROM-SUPABASE'); assert.equal(s2.calls.length, 0);
  assert.equal(r.headers['x-img-source'], undefined, 'a disk hit has no source header');
  rmSync(dir, { recursive: true, force: true });
});

test('parseImgMode: the 3 modes; unset, unknown and r2 without a base are refused', () => {
  assert.deepEqual(parseImgMode({ IMG_UPSTREAM: 'supabase' }), { mode: 'supabase', r2Base: '' });
  assert.deepEqual(parseImgMode({ IMG_UPSTREAM: 'r2-first', R2_PUBLIC_BASE: 'https://img.lionpridetcg.com/' }), { mode: 'r2-first', r2Base: 'https://img.lionpridetcg.com' });
  assert.throws(() => parseImgMode({}), /refused: IMG_UPSTREAM unset/);
  assert.throws(() => parseImgMode({ IMG_UPSTREAM: 'r3' }), /refused: IMG_UPSTREAM=r3 unknown/);
  assert.throws(() => parseImgMode({ IMG_UPSTREAM: 'r2' }), /needs R2_PUBLIC_BASE/);
});

// The real server.js: it refuses to start without a valid mode, and /api/config has "img". A temp cwd (no .env file).
const serverEnv = (extra) => {
  const env = { ...process.env, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x', ...extra };
  for (const k of ['IMG_UPSTREAM', 'R2_PUBLIC_BASE', 'IMG_CACHE']) if (!(k in extra)) delete env[k];
  return env;
};
test('server.js start: unset, r3, and r2 without a base -> refused (exit 1)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'srv-'));
  for (const [extra, msg] of [[{}, 'refused: IMG_UPSTREAM unset'], [{ IMG_UPSTREAM: 'r3' }, 'refused: IMG_UPSTREAM=r3 unknown'], [{ IMG_UPSTREAM: 'r2' }, 'needs R2_PUBLIC_BASE']]) {
    const r = spawnSync(process.execPath, [join(here, 'server.js')], { cwd, env: serverEnv({ ...extra, PORT: '4997' }), encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 1, `${JSON.stringify(extra)} exit ${r.status} ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(msg));
  }
  rmSync(cwd, { recursive: true, force: true });
});

test('server.js start: a valid mode starts; /api/config has "img":"<mode>"', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'srv-'));
  for (const [mode, port] of [['supabase', 4995], ['r2-first', 4994]]) {
    const p = spawn(process.execPath, [join(here, 'server.js')], { cwd, env: serverEnv({ IMG_UPSTREAM: mode, R2_PUBLIC_BASE: 'https://img.lionpridetcg.com', PORT: String(port) }) });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    try {
      for (let i = 0; i < 100 && !out.includes('TCG Activity ->'); i += 1) await new Promise((r) => setTimeout(r, 200));
      assert.match(out, new RegExp(`img=${mode}`));
      const j = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
      assert.equal(j.img, mode);
    } finally { const gone = new Promise((r) => p.once('exit', r)); p.kill(); await gone; }
  }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* Windows: the folder of a child that just stopped */ }
});

// N4 stop test: one fallback, then the process exits at once. The img-fallback line must be in the captured stdout.
test('stop test: one r2-first fallback, then process.exit at once -> stdout holds the img-fallback line (both cache branches)', () => {
  for (const branch of CACHE_BRANCHES) {
    const dir = mkdtempSync(join(tmpdir(), 'img-stop-'));
    const script = `
      import { createImgHandler, createImgStats } from ${JSON.stringify(pathToFileURL(join(here, 'img-route.js')).href)};
      import { createImgCache } from ${JSON.stringify(pathToFileURL(join(here, 'img-cache.js')).href)};
      const f = async (u) => u.startsWith(${JSON.stringify(R2)}) ? new Response(null, { status: 404 }) : new Response('X', { status: 200, headers: { 'content-type': 'image/png' } });
      const imgCache = ${branch === 'cache'} ? createImgCache({ dir: ${JSON.stringify(dir)}, fetchFn: f }) : null;
      const h = createImgHandler({ supaHost: ${JSON.stringify(SUPA)}, imgMode: { mode: 'r2-first', r2Base: ${JSON.stringify(R2)} }, imgStats: createImgStats(), imgCache, fetchImpl: f, missLimit: { take: () => true } });
      const res = { setHeader() {}, status() { return res; }, end() { process.exit(0); }, headersSent: false, destroy() { process.exit(0); } };
      await h({ params: [${JSON.stringify(VECTORS[0].path)}], originalUrl: '/api/img/x?v=1', headers: {}, socket: {} }, res);
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`img-fallback ${VECTORS[0].key} 404 mode=r2-first`), `[${branch}] stdout: ${JSON.stringify(r.stdout)}`);
    rmSync(dir, { recursive: true, force: true });
  }
});
