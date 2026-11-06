// R2-MOVE G4: the art writers (spec 6.2 G4) and the art-url vectors of the card studio copies.
//   node scripts/test-art-store.mjs       prints TEST <name> PASS|FAIL, then RESULT PASS failed=0 (exit 0) or RESULT FAIL (exit 1)
// No live request: a stub S3 (it checks Content-MD5 like R2), a stub Supabase (http, records every request), mock db
// clients, a test vault (injected), and a temp state folder (ART_STATE_DIR) for FROZEN / CUTOVER / inflight.
// Writers by name: W1 push (storeTier), W2 pack art (setsRouter), W3 card back (src/upload-back.js), W4 tier delete and card
// delete, W5 make-thumbs, W6 stage-faces, W7 upload-boss-clips and upload-boss-thumbs, W8 upload-anim (W7/W8 run with their
// OWN folder as the working directory, with a .env there that says ART_STORE=supabase: the state files decide, N1).
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const STUDIO = join(here, '..');
const REPO = join(STUDIO, '..');
let failed = 0;
const check = (name, ok, info = '') => { console.log(`TEST ${name} ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ` ${String(info).slice(0, 600)}`}`); if (!ok) failed += 1; };
const md5 = (b) => createHash('md5').update(b).digest('hex');
const md5b64 = (b) => createHash('md5').update(b).digest('base64');

// ---- the stub Supabase (http): every request is recorded --------------------------------------------------------------
const supaLog = [];
const PNG = await sharp({ create: { width: 50, height: 70, channels: 3, background: '#884422' } }).png().toBuffer();
const supa = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  supaLog.push({ method: req.method, url: req.url });
  const base = `http://127.0.0.1:${supa.address().port}`;
  if (req.method === 'GET' && req.url.startsWith('/rest/v1/cards')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify([{ id: 1, image_url: `${base}/storage/v1/object/public/card-art/cards/zz-common.png?v=1` }])); return; }
  if (req.method === 'POST' && req.url.startsWith('/storage/v1/object/list/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); return; }
  if (req.method === 'GET' && req.url.startsWith('/storage/v1/object/public/card-art/')) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
});
await new Promise((r) => supa.listen(0, '127.0.0.1', r));
const SUPA = `http://127.0.0.1:${supa.address().port}`;
const supaWrites = (from = 0) => supaLog.slice(from).filter((r) => r.method !== 'GET' && !r.url.startsWith('/storage/v1/object/list/') && !(r.method === 'HEAD'));

// ---- the stub S3 (R2): checks Content-MD5 (400 on a mismatch), ETag = MD5 ---------------------------------------------
const s3Log = [];
const s3Store = new Map();
let onPut = null;
const s3 = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/[^/]+\//, ''); // drop /<bucket>/
  s3Log.push({ method: req.method, path, type: req.headers['content-type'], md5h: req.headers['content-md5'] });
  if (req.method === 'PUT') {
    if (!req.headers['content-md5'] || req.headers['content-md5'] !== md5b64(body)) { res.writeHead(400); res.end('BadDigest'); return; }
    s3Store.set(path, { body, type: req.headers['content-type'] });
    if (onPut) onPut(path);
    res.writeHead(200, { etag: `"${md5(body)}"` }); res.end(); return;
  }
  if (req.method === 'DELETE') { s3Store.delete(path); res.writeHead(204); res.end(); return; }
  if (req.method === 'HEAD' || req.method === 'GET') {
    const o = s3Store.get(path);
    if (!o) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { etag: `"${md5(o.body)}"`, 'content-type': o.type, 'content-length': o.body.length }); res.end(req.method === 'GET' ? o.body : undefined); return;
  }
  res.writeHead(400); res.end();
});
await new Promise((r) => s3.listen(0, '127.0.0.1', r));
const S3 = `http://127.0.0.1:${s3.address().port}`;
const TEST_VAULT = () => ({ accountId: 'test', accessKeyId: 'AKIATESTTESTTESTTEST', secretAccessKey: 'test-secret-not-real', bucket: 'lptcg-media-test' });

const { createArtStore, checkArtState, readState, waitInflight, inflightFiles, REFUSED_FROZEN, REFUSED_CUT, REFUSED_R2_EARLY, REFUSED_STAGE } = await import('../src/art-store.js');

// A fresh state folder + env for each case.
function caseEnv(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'art-state-'));
  return { ...process.env, ART_STATE_DIR: dir, ART_WRITE_LOG: join(dir, 'art-writes.jsonl'), SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'x', R2_TEST: '1', ...extra };
}
const touch = (env, f) => { mkdirSync(env.ART_STATE_DIR, { recursive: true }); writeFileSync(join(env.ART_STATE_DIR, f), `${new Date().toISOString()} test\n`); };
const logLines = (env) => (existsSync(env.ART_WRITE_LOG) ? readFileSync(env.ART_WRITE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// A mock supabase client (backend supabase + the rows): records every call.
function mockDb() {
  const calls = [];
  const db = {
    storage: {
      from: (b) => ({
        upload: async (n, buf, o) => { calls.push(['upload', b, n, o?.contentType]); return { error: null }; },
        remove: async (ns) => { calls.push(['remove', b, ns]); return { error: null }; },
        list: async () => ({ data: [] }),
        getPublicUrl: (o) => ({ data: { publicUrl: `${SUPA}/storage/v1/object/public/${b}/${o}` } }),
      }),
      createBucket: async () => { calls.push(['createBucket']); return { error: { message: 'The resource already exists' } }; },
    },
    from: (t) => ({
      select: () => ({
        eq: () => ({
          in: async () => { calls.push(['select', t]); return { data: [{ id: 11 }], error: null }; },
          maybeSingle: async () => { calls.push(['select1', t]); return { data: { id: 'S9', name: 'Set 9', pack_art_url: null }, error: null }; },
        }),
      }),
      delete: () => ({ in: async (_c, ids) => { calls.push(['delete', t, ids]); return { error: null }; } }),
    }),
    rpc: async (fn) => { calls.push(['rpc', fn]); return { data: {}, error: null }; },
  };
  return { db, calls };
}
const storageCalls = (calls) => calls.filter((c) => ['upload', 'remove', 'createBucket'].includes(c[0]));
const r2Store = (env, db) => createArtStore({ db, env, vault: TEST_VAULT, endpoint: S3 });

// src/supabase.js (imported by push.js) needs a URL and a key: the stub (never a live project).
process.env.SUPABASE_URL = SUPA; process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
const { storeTier } = await import('../src/push.js');
const { removeTiers } = await import('../src/tier-delete.js');
const { deleteWholeCard } = await import('../src/card-delete.js');
const { setsRouter } = await import('../src/sets-routes.js');
const THUMBS = { grid: Buffer.from('GRID-WEBP'), reveal: Buffer.from('REVEAL-WEBP') };
const MAIN = Buffer.from('MAIN-ANIMATED-WEBP');
const tierArgs = (store, db, rows) => ({ store, db, cardId: 'zz', rarity: 'gold', object: 'cards/zz-gold.webp', buffer: MAIN, contentType: 'image/webp', thumbs: THUMBS, writeRow: async (url) => { rows.push(url); } });

// ---- art-url vectors (the card studio copy and the gallery image copy) -------------------------------------------------
{
  const V = JSON.parse(readFileSync(join(REPO, 'shared', 'art-url-vectors.json'), 'utf8'));
  for (const f of ['src/art-url.js', 'gallery-deploy/src/art-url.js']) {
    const m = await import(new URL(`../${f}`, import.meta.url));
    const bad = [
      ...V.key.filter((c) => m.artKey(c.in) !== c.key || (c.key && m.artVersion(c.in) !== c.v)).map((c) => c.in),
      ...V.r2.filter((c) => m.r2Url(c.key, c.v, V.r2Base) !== c.out).map((c) => c.key),
      ...V.logical.filter((c) => m.r2FromLogical(c.in, V.r2Base) !== c.out).map((c) => c.in),
    ];
    check(`art-url vectors ${f}`, bad.length === 0, JSON.stringify(bad));
  }
}

// ---- ART_STORE=supabase, no state file: the Supabase calls of before ---------------------------------------------------
{
  const env = caseEnv({ ART_STORE: 'supabase' });
  const { db, calls } = mockDb();
  const rows = [];
  const url = await storeTier(tierArgs(createArtStore({ db, env }), db, rows));
  check('supabase: W1 push = 3 uploads to card-art (main, grid, reveal), upsert, the types', JSON.stringify(storageCalls(calls)) === JSON.stringify([
    ['upload', 'card-art', 'cards/zz-gold.webp', 'image/webp'], ['upload', 'card-art', 'grid/cards/zz-gold.webp', 'image/webp'], ['upload', 'card-art', 'reveal/cards/zz-gold.webp', 'image/webp']]), JSON.stringify(calls));
  check('supabase: the row url = the logical form with ?v=<ms>', rows.length === 1 && rows[0] === url && new RegExp(`^${SUPA}/storage/v1/object/public/card-art/cards/zz-gold\\.webp\\?v=\\d{13}$`).test(url), url);
  check('supabase: no write-log line, inflight empty after', logLines(env).length === 0 && inflightFiles(env).length === 0);
}

// ---- ART_STORE=r2 + CUTOVER: R2 only ------------------------------------------------------------------------------------
{
  const env = caseEnv({ ART_STORE: 'r2' }); touch(env, 'CUTOVER');
  const { db, calls } = mockDb();
  const rows = []; const s0 = s3Log.length;
  const url = await storeTier(tierArgs(r2Store(env, db), db, rows));
  const puts = s3Log.slice(s0).filter((r) => r.method === 'PUT');
  check('r2+CUTOVER: one animated push = 3 PUTs (main, grid, reveal) with the right keys and types', JSON.stringify(puts.map((p) => [p.path, p.type])) === JSON.stringify([
    ['card-art/cards/zz-gold.webp', 'image/webp'], ['card-art/grid/cards/zz-gold.webp', 'image/webp'], ['card-art/reveal/cards/zz-gold.webp', 'image/webp']]), JSON.stringify(puts));
  check('r2+CUTOVER: every PUT sends Content-MD5', puts.length === 3 && puts.every((p) => p.md5h));
  check('r2+CUTOVER: 0 Supabase storage calls (I-2, no dual write)', storageCalls(calls).length === 0, JSON.stringify(calls));
  const L = logLines(env);
  check('r2+CUTOVER: 3 write-log lines {t, op, key, md5, bytes, type}', L.length === 3 && L.every((l) => l.t && l.op === 'put' && l.key.startsWith('card-art/') && /^[0-9a-f]{32}$/.test(l.md5) && l.bytes > 0 && l.type)
    && L[0].md5 === md5(MAIN), JSON.stringify(L));
  check('r2+CUTOVER: the row url = the LOGICAL Supabase form with ?v=<ms> (I-4)', rows[0] === url && new RegExp(`^${SUPA}/storage/v1/object/public/card-art/cards/zz-gold\\.webp\\?v=\\d{13}$`).test(url), url);
  // W4 tier delete in r2: one S3 DELETE per name + log lines, the rows first
  const d0 = s3Log.length;
  const r = await removeTiers({ db, bucket: 'card-art', cardId: 'zz', subjectId: 7, tiers: ['gold'], store: r2Store(env, db) });
  const dels = s3Log.slice(d0).filter((x) => x.method === 'DELETE').map((x) => x.path);
  check('r2+CUTOVER: W4 tier delete = one S3 DELETE per name + 2 del log lines, 0 Supabase storage calls', r.ok && JSON.stringify(dels) === JSON.stringify(['card-art/cards/zz-gold.webp', 'card-art/cards/zz-gold.png'])
    && logLines(env).filter((l) => l.op === 'del').length === 2 && storageCalls(calls).length === 0, JSON.stringify({ r, dels, calls }));
}

// ---- CUTOVER + ART_STORE=supabase (or unset) -> refused ----------------------------------------------------------------
for (const store of ['supabase', undefined]) {
  const env = caseEnv(store ? { ART_STORE: store } : {}); if (!store) delete env.ART_STORE; touch(env, 'CUTOVER');
  const { db, calls } = mockDb(); const rows = [];
  let err = ''; try { await storeTier(tierArgs(createArtStore({ db, env }), db, rows)); } catch (e) { err = e.message; }
  let err2 = ''; try { await createArtStore({ db, env }).put('cards/x.png', Buffer.from('x'), 'image/png'); } catch (e) { err2 = e.message; }
  check(`CUTOVER + ART_STORE=${store || 'unset'}: refused, 0 Supabase calls, no row`, err.startsWith(REFUSED_CUT) && err2.startsWith(REFUSED_CUT) && calls.length === 0 && rows.length === 0, `${err} | ${err2} | ${JSON.stringify(calls)}`);
}

// ---- FROZEN (no logical write open): every writer W1-W8 refused with its label, 0 requests, row unchanged ----------------
{
  const env = caseEnv({ ART_STORE: 'r2' }); touch(env, 'FROZEN');
  const { db, calls } = mockDb(); const rows = []; const s0 = s3Log.length;
  let err = ''; try { await storeTier(tierArgs(r2Store(env, db), db, rows)); } catch (e) { err = e.message; }
  check('FROZEN: W1 push refused with its label (card id + tier), 0 requests, no row', err === `${REFUSED_FROZEN} push zz gold` && s3Log.length === s0 && rows.length === 0 && calls.length === 0, `${err} ${JSON.stringify(calls)}`);
  let e2 = ''; try { await r2Store(env, db).put('cards/x.png', Buffer.from('x'), 'image/png'); } catch (e) { e2 = e.message; }
  check('FROZEN: a put with no open logical write = refused, 0 requests', e2.startsWith(REFUSED_FROZEN) && s3Log.length === s0, e2);
  // W2 pack art: the real route
  const env2 = caseEnv({ ART_STORE: 'supabase' }); touch(env2, 'FROZEN');
  const m2 = mockDb();
  const app = express(); app.use(express.json({ limit: '30mb' })); app.use('/api/sets', setsRouter({ db: m2.db, env: env2 }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const resp = await fetch(`http://127.0.0.1:${srv.address().port}/api/sets/S9/pack-art`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'still', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }) });
  const j = await resp.json().catch(() => ({}));
  srv.close();
  check('FROZEN: W2 pack art refused with its label, 0 storage calls, no admin_set_save', !resp.ok && String(j.error).includes(`${REFUSED_FROZEN} pack-art S9 still`) && storageCalls(m2.calls).length === 0 && !m2.calls.some((c) => c[0] === 'rpc'), JSON.stringify({ j, calls: m2.calls }));
  // W4 tier delete + card delete: refused before any row delete
  const m4 = mockDb();
  const r4 = await removeTiers({ db: m4.db, bucket: 'card-art', cardId: 'zz', subjectId: 7, tiers: ['gold'], store: createArtStore({ db: m4.db, env: env2 }) });
  check('FROZEN: W4 tier delete refused with its label, no row delete, no storage call', !r4.ok && r4.error.includes(`${REFUSED_FROZEN} tier-delete zz gold`) && m4.calls.length === 0, JSON.stringify({ r4, calls: m4.calls }));
  process.env.ART_STATE_DIR = env2.ART_STATE_DIR; // deleteWholeCard -> removeTiers with the default store (process.env)
  const m4b = mockDb();
  m4b.db.from = (t) => ({
    select: () => ({ eq: (c) => (c === 'key' ? { maybeSingle: async () => ({ data: { id: 7 }, error: null }) } : Promise.resolve({ data: [{ rarity: 'gold' }], error: null })) }),
    delete: () => ({ in: async () => { m4b.calls.push(['delete', t]); return { error: null }; }, eq: async () => { m4b.calls.push(['delete', t]); return { error: null }; } }),
  });
  let removedLocal = false;
  const r4b = await deleteWholeCard({ db: m4b.db, bucket: 'card-art', card: { id: 'zz', finishes: ['gold'] }, actor: 'studio:test', removeLocal: () => { removedLocal = true; return { files: [], orphanedSources: [] }; } });
  delete process.env.ART_STATE_DIR;
  check('FROZEN: W4 card delete refused, no row delete, no storage call, the local card stays', !r4b.ok && JSON.stringify(r4b).includes(REFUSED_FROZEN) && m4b.calls.length === 0 && !removedLocal, JSON.stringify({ r4b, calls: m4b.calls }));
}

// ---- the writers that are scripts (children), each with FROZEN in its state folder -------------------------------------
function runChild(args, { cwd, env, timeout = 120000 }) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd, env });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill(), timeout);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
// A .env in the writer's own folder that says ART_STORE=supabase (only when that folder has none; removed after).
async function withOwnEnv(dir, fn) {
  const f = join(dir, '.env');
  const made = !existsSync(f);
  if (made) writeFileSync(f, 'ART_STORE=supabase\n');
  try { return await fn(); } finally { if (made) rmSync(f, { force: true }); }
}
{
  const env = caseEnv({ ART_STORE: 'supabase' }); touch(env, 'FROZEN');
  const tsx = join(REPO, 'tcg-bot', 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs');
  const bossSrc = mkdtempSync(join(tmpdir(), 'boss-src-')); writeFileSync(join(bossSrc, 'boss_idle.webm'), 'WEBM');
  const thumbs = mkdtempSync(join(tmpdir(), 'boss-th-')); writeFileSync(join(thumbs, 'warrok.png'), PNG);
  const writers = [
    { name: 'W3 card back', args: [join(STUDIO, 'src', 'upload-back.js')], cwd: STUDIO, label: 'card-back' },
    { name: 'W5 make-thumbs', args: [join(STUDIO, 'scripts', 'make-thumbs.mjs')], cwd: STUDIO, label: 'make-thumbs cards/zz-common.png', reads: true },
    { name: 'W7 upload-boss-clips', args: [join(REPO, 'tcg-activity', 'scripts', 'upload-boss-clips.mjs')], cwd: join(REPO, 'tcg-activity'), label: 'upload-boss-clips boss/behemoth/idle.webm', extra: { BOSS_CLIPS_SRC: bossSrc } },
    { name: 'W7 upload-boss-thumbs', args: [join(REPO, 'tcg-activity', 'scripts', 'upload-boss-thumbs.mjs')], cwd: join(REPO, 'tcg-activity'), label: 'upload-boss-thumbs boss/thumbs/warrok.png', extra: { BOSS_THUMBS_DIR: thumbs } },
    { name: 'W8 upload-anim', args: ['--import', `file:///${tsx.replace(/\\/g, '/')}`, join(REPO, 'tcg-bot', 'src', 'upload-anim.ts'), 'zz'], cwd: join(REPO, 'tcg-bot'), label: 'upload-anim zz' },
  ];
  for (const w of writers) {
    const n0 = supaLog.length;
    const r = await withOwnEnv(w.cwd, () => runChild(w.args, { cwd: w.cwd, env: { ...env, ...(w.extra || {}) } }));
    const writes = supaWrites(n0);
    const all = supaLog.length - n0;
    check(`FROZEN: ${w.name} refused with its label, 0 write requests${w.reads ? '' : ', 0 requests'}`,
      r.out.includes(`${REFUSED_FROZEN} ${w.label}`) && writes.length === 0 && (w.reads || all === 0) && r.code !== 0, `exit ${r.code} writes ${JSON.stringify(writes)} all ${all} | ${r.out}`);
  }
  // W6 stage-faces: --live refused (exit 6) with FROZEN, with CUTOVER, with ART_STORE=r2; 0 stub requests
  const cases = [['FROZEN', env], ['CUTOVER', (() => { const e = caseEnv({ ART_STORE: 'supabase' }); touch(e, 'CUTOVER'); return e; })()], ['ART_STORE=r2', caseEnv({ ART_STORE: 'r2' })]];
  for (const [name, e] of cases) {
    const n0 = supaLog.length;
    const r = await runChild([join(STUDIO, 'scripts', 'stage-faces.mjs'), 'swap', '--set', 'S1', '--live'], { cwd: STUDIO, env: e });
    check(`W6 stage-faces swap --live with ${name}: exit 6, the refusal, 0 stub requests`, r.code === 6 && r.out.includes(REFUSED_STAGE) && supaLog.length === n0, `exit ${r.code} | ${r.out.slice(0, 300)}`);
  }
}

// ---- W6: the check before EACH storage write of stage-faces (static), and the state read at each call ------------------
{
  const src = readFileSync(join(STUDIO, 'scripts', 'stage-faces.mjs'), 'utf8').split(/\r?\n/);
  const writes = src.map((l, i) => [l, i]).filter(([l]) => /db\.storage\.from\(BUCKET\)\.(upload|remove)\(/.test(l));
  const unguarded = writes.filter(([, i]) => src[i - 1].trim() !== 'artGate();').map(([, i]) => i + 1);
  check('W6 stage-faces: every storage upload/remove is preceded by artGate() (FROZEN created during a run -> the next write refused)', writes.length === 4 && unguarded.length === 0, `writes ${writes.length} unguarded lines ${unguarded}`);
  const env = caseEnv({ ART_STORE: 'supabase' });
  const before = checkArtState(env); touch(env, 'FROZEN'); const after = checkArtState(env);
  check('W6 checkArtState reads the files at each call (null, then FROZEN -> refused)', before === null && after === REFUSED_STAGE, `${before} ${after}`);
}

// ---- N1: one instance (one process, like the Studio server): a write, then FROZEN, then a new logical write -> refused --
{
  const env = caseEnv({ ART_STORE: 'r2' }); touch(env, 'CUTOVER'); // r2 writes only after the cut (M1)
  const { db } = mockDb(); const store = r2Store(env, db); const rows = [];
  await storeTier(tierArgs(store, db, rows));
  touch(env, 'FROZEN');
  const s0 = s3Log.length;
  let err = ''; try { await storeTier({ ...tierArgs(store, db, rows), rarity: 'common' }); } catch (e) { err = e.message; }
  check('N1 freeze read on every call: write, FROZEN, new logical write -> refused, 0 requests', rows.length === 1 && err === `${REFUSED_FROZEN} push zz common` && s3Log.length === s0, `${err} puts ${s3Log.length - s0}`);
}

// ---- N2: FROZEN created between the main PUT and the grid PUT: the push finishes; the next push is refused --------------
{
  const env = caseEnv({ ART_STORE: 'r2' }); touch(env, 'CUTOVER'); // r2 writes only after the cut (M1)
  const { db } = mockDb(); const store = r2Store(env, db); const rows = [];
  const s0 = s3Log.length;
  onPut =(path) => { if (path === 'card-art/cards/zz-gold.webp') touch(env, 'FROZEN'); };
  let err = ''; try { await storeTier(tierArgs(store, db, rows)); } catch (e) { err = e.message; }
  onPut = null;
  const puts = s3Log.slice(s0).filter((r) => r.method === 'PUT').map((r) => r.path);
  check('N2 in flight: FROZEN after the main PUT -> grid, reveal and the row still written, inflight empty after',
    !err && JSON.stringify(puts) === JSON.stringify(['card-art/cards/zz-gold.webp', 'card-art/grid/cards/zz-gold.webp', 'card-art/reveal/cards/zz-gold.webp']) && rows.length === 1 && inflightFiles(env).length === 0 && readState(env).frozen,
    `${err} ${JSON.stringify(puts)} rows ${rows.length}`);
  let err2 = ''; try { await storeTier({ ...tierArgs(store, db, rows), rarity: 'common' }); } catch (e) { err2 = e.message; }
  check('N2 in flight: the NEXT push -> refused', err2 === `${REFUSED_FROZEN} push zz common`, err2);
  // A crash inside a logical write leaves inflight/<pid>-<n>; the S4 wait reports STALE-INFLIGHT and removes it.
  const env2 = caseEnv({ ART_STORE: 'supabase' });
  const crash = await runChild(['--input-type=module', '-e', `import { createArtStore } from ${JSON.stringify(new URL('../src/art-store.js', import.meta.url).href)}; createArtStore({}).beginWrite('push crash-card gold'); process.kill(process.pid, 'SIGKILL');`], { cwd: STUDIO, env: env2 });
  const left = inflightFiles(env2);
  const lines = [];
  touch(env2, 'FROZEN');
  const w = await waitInflight({ env: env2, timeoutMs: 2000, pollMs: 100, log: (l) => lines.push(l) });
  check('N2 crash: the killed child leaves its inflight file; the S4 wait reports STALE-INFLIGHT with the label and ends empty',
    crash.code !== 0 && left.length === 1 && w.ok && lines.length === 1 && lines[0].startsWith('STALE-INFLIGHT ') && lines[0].endsWith('push crash-card gold') && inflightFiles(env2).length === 0, JSON.stringify({ code: crash.code, left, lines, w }));
  // An open logical write of a LIVE process: the wait does not end (timeout), nothing is removed.
  const env3 = caseEnv({ ART_STORE: 'supabase' });
  const h = createArtStore({ env: env3 }).beginWrite('push live-card gold');
  const w3 = await waitInflight({ env: env3, timeoutMs: 300, pollMs: 100, log: () => {} });
  rmSync(h.file, { force: true });
  check('N2: a write in flight of a live process -> the S4 wait times out and removes nothing', !w3.ok && w3.left.length === 1 && w3.stale.length === 0, JSON.stringify(w3));
}

// ---- M1 (review r1): ART_STORE=r2 with NO CUTOVER (before S4) -> refused, no write anywhere ----------------------------------
// Before the cut an r2-only write is lost: the proxy still reads Supabase, and the next r2-copy overwrites R2 with the
// older Supabase bytes. The reviewer's probe (before this fix) gave "WROTE; r2 puts=1; supabase uploads=0".
{
  const env = caseEnv({ ART_STORE: 'r2' }); // no CUTOVER, no FROZEN
  const { db, calls } = mockDb(); const rows = []; const s0 = s3Log.length; const n0 = supaLog.length;
  let e1 = ''; try { await storeTier(tierArgs(r2Store(env, db), db, rows)); } catch (e) { e1 = e.message; }
  let e2 = ''; try { await r2Store(env, db).put('cards/x.png', Buffer.from('x'), 'image/png'); } catch (e) { e2 = e.message; }
  let e3 = ''; try { await r2Store(env, db).remove(['cards/x.png']); } catch (e) { e3 = e.message; }
  check('ART_STORE=r2 without CUTOVER: push, put and remove refused (refused: line), 0 R2 requests, 0 Supabase calls, no log line, no row, inflight empty',
    e1 === `${REFUSED_R2_EARLY} push zz gold` && e2 === `${REFUSED_R2_EARLY} cards/x.png` && e3 === `${REFUSED_R2_EARLY} cards/x.png`
    && s3Log.length === s0 && supaLog.length === n0 && calls.length === 0 && logLines(env).length === 0 && rows.length === 0 && inflightFiles(env).length === 0,
    JSON.stringify({ e1, e2, e3, r2: s3Log.length - s0, calls }));
}

// ---- L1 (review r1): beginWrite writes its in-flight file BEFORE it reads the state ---------------------------------------
// The spy writes FROZEN right after the state read (the Stager at the worst moment) and counts the in-flight files that the
// S4 wait would see at that time. Old order (read, then file): 0 files = the wait ends while this write starts.
{
  const env = caseEnv({ ART_STORE: 'supabase' });
  const seen = [];
  const spy = (e) => { const s = readState(e); if (!seen.length) { touch(e, 'FROZEN'); seen.push(inflightFiles(e).length); } return s; };
  const store = createArtStore({ env, readStateFn: spy });
  let h = null, err = ''; try { h = store.beginWrite('push race gold'); } catch (e) { err = e.message; }
  check('L1: FROZEN written right after the beginWrite state read -> the in-flight file already exists (the S4 wait sees the write)',
    !err && seen[0] === 1 && inflightFiles(env).length === 1, JSON.stringify({ err, seen }));
  store.endWrite(h);
  let err2 = ''; try { store.beginWrite('push race common'); } catch (e) { err2 = e.message; }
  check('L1: a beginWrite refused under FROZEN leaves no in-flight file', err2 === `${REFUSED_FROZEN} push race common` && inflightFiles(env).length === 0, `${err2} ${inflightFiles(env)}`);
}

// ---- L3 (review r1): under FROZEN only the OWN open write lets a bare put through, not another process's file -------------
{
  const env = caseEnv({ ART_STORE: 'supabase' }); touch(env, 'FROZEN');
  mkdirSync(join(env.ART_STATE_DIR, 'inflight'), { recursive: true });
  writeFileSync(join(env.ART_STATE_DIR, 'inflight', '999999-1'), '999999\npush other gold\n');
  const { db, calls } = mockDb();
  let err = ''; try { await createArtStore({ db, env }).put('cards/x.png', Buffer.from('x'), 'image/png'); } catch (e) { err = e.message; }
  check('L3: FROZEN + an in-flight file of ANOTHER pid + a bare put -> refused, 0 storage calls', err === `${REFUSED_FROZEN} cards/x.png` && calls.length === 0, `${err} ${JSON.stringify(calls)}`);
}

// ---- no vault, a failed log append ---------------------------------------------------------------------------------------
{
  const env = caseEnv({ ART_STORE: 'r2', R2_VAULT_SCRIPT: join(tmpdir(), 'no-such-vault.ps1') }); touch(env, 'CUTOVER');
  const { db } = mockDb(); const s0 = s3Log.length;
  let err = ''; try { await createArtStore({ db, env, endpoint: S3 }).put('cards/x.png', Buffer.from('x'), 'image/png'); } catch (e) { err = e.message; }
  check('no vault -> refused: R2 vault missing, 0 requests, no log line', err.startsWith('refused: R2 vault missing') && s3Log.length === s0 && logLines(env).length === 0, err);
  const env2 = caseEnv({ ART_STORE: 'r2' }); touch(env2, 'CUTOVER');
  mkdirSync(join(env2.ART_STATE_DIR, 'log-is-a-folder'));
  env2.ART_WRITE_LOG = join(env2.ART_STATE_DIR, 'log-is-a-folder');
  const s1 = s3Log.length;
  let err2 = ''; try { await r2Store(env2, db).put('cards/x.png', Buffer.from('x'), 'image/png'); } catch (e) { err2 = e.message; }
  check('a failed log append -> the write fails before the PUT (0 requests)', err2 !== '' && s3Log.filter((r, i) => i >= s1 && r.method === 'PUT').length === 0, err2);
}

supa.close(); s3.close();
for (const d of readdirSync(tmpdir()).filter((n) => /^(art-state|boss-src|boss-th)-/.test(n))) { try { rmSync(join(tmpdir(), d), { recursive: true, force: true }); } catch { /* in use */ } }
console.log(failed ? `RESULT FAIL failed=${failed}` : 'RESULT PASS failed=0');
process.exitCode = failed ? 1 : 0;
