// node --test img-cache.test.js : the /api/img disk cache (img-cache.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImgCache, normalizeImgUrl } from './img-cache.js';

function fakeUpstream(files) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    await new Promise((r) => setTimeout(r, 20));
    const f = files[url];
    if (!f) return new Response(null, { status: 404 });
    return new Response(f.body, { status: 200, headers: { 'content-type': f.type } });
  };
  return { calls, fetchFn };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'imgc-'));

test('a second request, and a new process on the same dir, do not reach upstream', async () => {
  const dir = tmp();
  const url = 'https://x.supabase.co/storage/v1/object/public/card-art/boss/models/a.glb';
  const up = fakeUpstream({ [url]: { body: Buffer.from('GLB-BYTES'), type: 'model/gltf-binary' } });
  const c = createImgCache({ dir, fetchFn: up.fetchFn });
  const a = await c.get(url), b = await c.get(url);
  assert.equal(up.calls.length, 1);
  assert.equal(b.buf.toString(), 'GLB-BYTES');
  assert.equal(b.type, 'model/gltf-binary');
  assert.deepEqual(a.buf, b.buf);
  const c2 = createImgCache({ dir, fetchFn: up.fetchFn });
  assert.equal((await c2.get(url)).buf.toString(), 'GLB-BYTES');
  assert.equal(up.calls.length, 1);
  rmSync(dir, { recursive: true });
});

test('50 requests at once for one new object make ONE upstream fetch', async () => {
  const dir = tmp();
  const url = 'https://x.supabase.co/storage/v1/object/public/card-art/cards/k.png?v=1';
  const up = fakeUpstream({ [url]: { body: Buffer.alloc(1000, 7), type: 'image/png' } });
  const c = createImgCache({ dir, fetchFn: up.fetchFn });
  const all = await Promise.all(Array.from({ length: 50 }, () => c.get(url)));
  assert.equal(up.calls.length, 1);
  assert.ok(all.every((r) => r.status === 200 && r.buf.length === 1000));
  rmSync(dir, { recursive: true });
});

test('a 404 is not stored, so the object shows once it exists', async () => {
  const dir = tmp();
  const url = 'https://x.supabase.co/storage/v1/object/public/card-art/grid/cards/new.webp';
  const files = {};
  const up = fakeUpstream(files);
  const c = createImgCache({ dir, fetchFn: up.fetchFn });
  assert.equal((await c.get(url)).status, 404);
  files[url] = { body: Buffer.from('NEW'), type: 'image/webp' };
  assert.equal((await c.get(url)).buf.toString(), 'NEW');
  assert.equal(up.calls.length, 2);
  rmSync(dir, { recursive: true });
});

test('past maxBytes it still serves, but does not write', async () => {
  const dir = tmp();
  const url = 'https://x.supabase.co/storage/v1/object/public/card-art/cards/big.png';
  const up = fakeUpstream({ [url]: { body: Buffer.alloc(500), type: 'image/png' } });
  const c = createImgCache({ dir, maxBytes: 100, fetchFn: up.fetchFn });
  assert.equal((await c.get(url)).buf.length, 500);
  assert.equal((await c.get(url)).buf.length, 500);
  assert.equal(up.calls.length, 2);
  assert.equal(c.used(), 0);
  rmSync(dir, { recursive: true });
});

test('the key keeps only ?v, so a changed file (new ?v) is fetched again', () => {
  const B = 'https://x.supabase.co';
  const p = 'storage/v1/object/public/card-art/cards/a.png';
  assert.equal(normalizeImgUrl(B, p, '?v=17&junk=1'), `${B}/${p}?v=17`);
  assert.equal(normalizeImgUrl(B, p, '?junk=1'), `${B}/${p}`);
  assert.equal(normalizeImgUrl(B, p, ''), `${B}/${p}`);
  assert.notEqual(normalizeImgUrl(B, p, '?v=17'), normalizeImgUrl(B, p, '?v=18'));
});
