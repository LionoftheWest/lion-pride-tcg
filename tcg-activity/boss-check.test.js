// S1-FACE B11: ops/boss-check.sh against a local server that runs the real /api/img/ handler (img-route.js + boss-files.js).
// Baseline: BOSS PASS host=game models=36 clips=30 source=vm. Mutations: a served file with other bytes = BOSS FAIL ... sha; the flag OFF
// (the Supabase path answers the same bytes) = BOSS FAIL ... source; another type in the list = BOSS FAIL ... type; one folder file
// missing = BOSS FAIL ... missing / folder names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createImgHandler } from './img-route.js';
import { createBossFiles } from './boss-files.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ops', 'boss-check.sh');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const posix = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`) : p);

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'boss-check-'));
  mkdirSync(join(dir, 'models')); mkdirSync(join(dir, 'behemoth'));
  const lines = [];
  for (let i = 0; i < 36; i++) { const b = Buffer.from(`model ${i}`); writeFileSync(join(dir, 'models', `m${i}-z2.glb`), b); lines.push(`${sha(b)}  models/m${i}-z2.glb  model/gltf-binary`); }
  for (let i = 0; i < 30; i++) { const b = Buffer.from(`clip ${i}`); writeFileSync(join(dir, 'behemoth', `c${i}.webm`), b); lines.push(`${sha(b)}  behemoth/c${i}.webm  video/webm`); }
  writeFileSync(join(dir, 'ENABLED'), '');
  writeFileSync(join(dir, 'list.txt'), lines.join('\n') + '\n');
  return dir;
}
async function serve(servedDir, { stubBytesFrom = null } = {}) {
  const fetchImpl = async (url) => { const p = url.split('/card-art/boss/')[1].split('?')[0]; return new Response(readFileSync(join(stubBytesFrom, p)), { status: 200, headers: { 'content-type': 'application/octet-stream' } }); };
  const h = createImgHandler({ supaHost: 'https://x.supabase.co', bossFiles: createBossFiles({ dir: servedDir }), fetchImpl });
  const server = http.createServer((req, res) => {
    const m = req.url.match(/^\/api\/img\/([^?]+)/);
    if (!m) { res.statusCode = 404; return res.end(); }
    res.status = (s) => { res.statusCode = s; return res; };
    h({ params: [m[1]], originalUrl: req.url, headers: req.headers, socket: req.socket }, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
// async: the server runs in this process
const check = (dir, base, list = join(dir, 'list.txt'), host = 'game') => new Promise((resolve) => {
  import('node:child_process').then(({ spawn }) => {
    const c = spawn(bash, [posix(SCRIPT), posix(list), '--host', host, '--base', base, '--dir', posix(dir)]);
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out, last: out.trim().split(/\r?\n/).pop() }));
  });
});

test('baseline: BOSS PASS host=game models=36 clips=30 source=vm; --host backup prints host=backup', async () => {
  const dir = folder(); const s = await serve(dir);
  const r = await check(dir, s.base);
  assert.equal(r.last, 'BOSS PASS host=game models=36 clips=30 source=vm', r.out);
  const r2 = await check(dir, s.base, join(dir, 'list.txt'), 'backup');
  assert.equal(r2.last, 'BOSS PASS host=backup models=36 clips=30 source=vm', r2.out);
  await s.close(); rmSync(dir, { recursive: true, force: true });
});

test('mutation: the served file has other bytes = BOSS FAIL <name> sha', async () => {
  const dir = folder(); const served = mkdtempSync(join(tmpdir(), 'boss-served-')); cpSync(dir, served, { recursive: true });
  writeFileSync(join(served, 'models', 'm3-z2.glb'), 'other bytes');
  const s = await serve(served);
  const r = await check(dir, s.base);
  assert.equal(r.code, 1); assert.match(r.out, /BOSS FAIL host=game models\/m3-z2\.glb sha/);
  await s.close(); rmSync(dir, { recursive: true, force: true }); rmSync(served, { recursive: true, force: true });
});

test('mutation: the flag OFF (Supabase answers the same bytes) = BOSS FAIL <name> source', async () => {
  const dir = folder(); const served = mkdtempSync(join(tmpdir(), 'boss-served-')); cpSync(dir, served, { recursive: true });
  rmSync(join(served, 'ENABLED'));
  const s = await serve(served, { stubBytesFrom: dir });
  const r = await check(dir, s.base);
  assert.equal(r.code, 1); assert.match(r.out, /BOSS FAIL host=game models\/m0-z2\.glb source/); assert.match(r.last, /^BOSS FAIL host=game n=\d+/);
  await s.close(); rmSync(dir, { recursive: true, force: true }); rmSync(served, { recursive: true, force: true });
});

test('mutation: another type in the list = BOSS FAIL <name> type', async () => {
  const dir = folder(); const s = await serve(dir);
  const list = join(dir, 'list2.txt');
  writeFileSync(list, readFileSync(join(dir, 'list.txt'), 'utf8').replace('behemoth/c7.webm  video/webm', 'behemoth/c7.webm  video/mp4'));
  const r = await check(dir, s.base, list);
  assert.equal(r.code, 1); assert.match(r.out, /BOSS FAIL host=game behemoth\/c7\.webm type video\/webm != video\/mp4/);
  await s.close(); rmSync(dir, { recursive: true, force: true });
});

test('mutation: one folder file missing (35 models) = BOSS FAIL', async () => {
  const dir = folder(); const s = await serve(dir);
  rmSync(join(dir, 'models', 'm5-z2.glb'));
  const r = await check(dir, s.base);
  assert.equal(r.code, 1); assert.match(r.out, /BOSS FAIL host=game models folder names differ/); assert.match(r.out, /BOSS FAIL host=game models\/m5-z2\.glb missing/);
  await s.close(); rmSync(dir, { recursive: true, force: true });
});
