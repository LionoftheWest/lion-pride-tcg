// S1-FACE B11: the /api/img/ handler (img-route.js) with the boss-files flag (boss-files.js), in both flag states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createImgHandler } from './img-route.js';
import { createBossFiles } from './boss-files.js';

const SUPA = 'https://kgvdqqehefezbypozvrh.supabase.co';
const MODEL = 'storage/v1/object/public/card-art/boss/models/warrok-z2.glb';
const CLIP = 'storage/v1/object/public/card-art/boss/behemoth/idle.webm';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'boss-files-'));
  mkdirSync(join(dir, 'models')); mkdirSync(join(dir, 'behemoth'));
  writeFileSync(join(dir, 'models', 'warrok-z2.glb'), Buffer.from('GLB-FROM-VM'));
  writeFileSync(join(dir, 'behemoth', 'idle.webm'), Buffer.from('WEBM-FROM-VM'));
  return dir;
}
// a stub fetch (the Supabase path) that counts its calls
function stubFetch() {
  const calls = [];
  const f = async (url) => { calls.push(url); return new Response(Buffer.from('FROM-SUPABASE'), { status: 200, headers: { 'content-type': 'model/gltf-binary', 'content-length': '13' } }); };
  return { f, calls };
}
// a minimal express-like req/res
async function call(handler, path, query = '?v=1') {
  const headers = {}; let status = 200; const chunks = [];
  let done; const finished = new Promise((r) => { done = r; });
  const res = {
    headersSent: false,
    setHeader: (k, v) => { headers[k.toLowerCase()] = String(v); },
    status: (s) => { status = s; return res; },
    end: (b) => { if (b) chunks.push(Buffer.from(b)); done(); return res; },
    write: (b) => { chunks.push(Buffer.from(b)); return true; },
    on: () => res, once: () => res, emit: () => true, removeListener: () => res,
    destroy: () => done(),
  };
  // Readable.pipe(res) needs a writable: a small one
  const { Writable } = await import('node:stream');
  const w = new Writable({ write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); }, final(cb) { done(); cb(); } });
  Object.assign(w, { setHeader: res.setHeader, status: res.status, headersSent: false });
  const origEnd = w.end.bind(w);
  w.end = (b) => { if (b) chunks.push(Buffer.from(b)); done(); return origEnd(); };
  w.status = (s) => { status = s; return w; };
  await handler({ params: [path], originalUrl: `/api/img/${path}${query}`, headers: {}, socket: {} }, w);
  await Promise.race([finished, new Promise((r) => setTimeout(r, 2000))]);
  return { status, headers, body: Buffer.concat(chunks).toString() };
}

test('flag OFF (no ENABLED file): the Supabase path, no X-Boss-Source', async () => {
  const dir = fixture(); const s = stubFetch();
  const h = createImgHandler({ supaHost: SUPA, bossFiles: createBossFiles({ dir }), fetchImpl: s.f });
  const r = await call(h, MODEL);
  assert.equal(r.status, 200); assert.equal(r.body, 'FROM-SUPABASE'); assert.equal(s.calls.length, 1);
  assert.equal(r.headers['x-boss-source'], undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('flag ON + the file exists: the file from the VM, X-Boss-Source: vm, no fetch (model and clip)', async () => {
  const dir = fixture(); writeFileSync(join(dir, 'ENABLED'), ''); const s = stubFetch();
  const h = createImgHandler({ supaHost: SUPA, bossFiles: createBossFiles({ dir }), fetchImpl: s.f });
  const m = await call(h, MODEL);
  assert.equal(m.status, 200); assert.equal(m.body, 'GLB-FROM-VM'); assert.equal(m.headers['x-boss-source'], 'vm');
  assert.equal(m.headers['content-type'], 'model/gltf-binary'); assert.match(m.headers['cache-control'], /immutable/);
  const c = await call(h, CLIP);
  assert.equal(c.body, 'WEBM-FROM-VM'); assert.equal(c.headers['content-type'], 'video/webm'); assert.equal(c.headers['x-boss-source'], 'vm');
  assert.equal(s.calls.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('flag ON + types.json: the Content-Type of the backup (Supabase) is sent', async () => {
  const dir = fixture(); writeFileSync(join(dir, 'ENABLED'), ''); writeFileSync(join(dir, 'types.json'), JSON.stringify({ 'models/warrok-z2.glb': 'application/octet-stream' }));
  const s = stubFetch();
  const h = createImgHandler({ supaHost: SUPA, bossFiles: createBossFiles({ dir }), fetchImpl: s.f });
  const m = await call(h, MODEL);
  assert.equal(m.headers['content-type'], 'application/octet-stream'); assert.equal(m.headers['x-boss-source'], 'vm');
  const c = await call(h, CLIP);
  assert.equal(c.headers['content-type'], 'video/webm', 'not in types.json: by the extension');
  rmSync(dir, { recursive: true, force: true });
});

test('flag ON + the file is missing: the Supabase path', async () => {
  const dir = fixture(); writeFileSync(join(dir, 'ENABLED'), ''); const s = stubFetch();
  const h = createImgHandler({ supaHost: SUPA, bossFiles: createBossFiles({ dir }), fetchImpl: s.f });
  const r = await call(h, 'storage/v1/object/public/card-art/boss/models/other.glb');
  assert.equal(r.body, 'FROM-SUPABASE'); assert.equal(s.calls.length, 1); assert.equal(r.headers['x-boss-source'], undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('flag ON: a non-boss path (a card) is never served from the folder', async () => {
  const dir = fixture(); writeFileSync(join(dir, 'ENABLED'), ''); mkdirSync(join(dir, 'cards')); writeFileSync(join(dir, 'cards', 'x.png'), 'X');
  const s = stubFetch();
  const h = createImgHandler({ supaHost: SUPA, bossFiles: createBossFiles({ dir }), fetchImpl: s.f });
  const r = await call(h, 'storage/v1/object/public/card-art/cards/x.png');
  assert.equal(r.body, 'FROM-SUPABASE'); assert.equal(s.calls.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('traversal: ../ and %2e%2e = 400, no fetch, no file', async () => {
  const dir = fixture(); writeFileSync(join(dir, 'ENABLED'), ''); const s = stubFetch();
  const h = createImgHandler({ supaHost: SUPA, bossFiles: createBossFiles({ dir }), fetchImpl: s.f });
  for (const p of ['storage/v1/object/public/card-art/boss/models/../ENABLED', 'storage/v1/object/public/card-art/boss/models/%2e%2e/ENABLED', 'storage/v1/object/public/card-art/boss/models/%252e%252e']) {
    const r = await call(h, p);
    assert.equal(r.status, 400, p);
  }
  assert.equal(s.calls.length, 0);
  // the module alone also refuses a name with "..", even when such a file exists in the folder
  writeFileSync(join(dir, 'models', 'a..glb'), 'X');
  assert.equal(createBossFiles({ dir }).lookup('storage/v1/object/public/card-art/boss/models/a..glb'), null);
  rmSync(dir, { recursive: true, force: true });
});

test('the flag is read at most every 30 s (ON -> OFF takes effect after the ttl)', () => {
  const dir = fixture(); writeFileSync(join(dir, 'ENABLED'), '');
  let t = 0; const bf = createBossFiles({ dir, ttlMs: 30000, now: () => t });
  assert.ok(bf.lookup(MODEL)); rmSync(join(dir, 'ENABLED'));
  t = 29000; assert.ok(bf.lookup(MODEL), 'still ON inside the ttl');
  t = 30000; assert.equal(bf.lookup(MODEL), null, 'OFF after the ttl');
  rmSync(dir, { recursive: true, force: true });
});
