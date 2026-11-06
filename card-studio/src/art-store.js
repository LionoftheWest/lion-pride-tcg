// R2-MOVE: THE one store module for the card art (bucket card-art). Every art writer (push, pack art, card back, tier and
// card delete, make-thumbs, the boss uploads, the shimmer upload) writes and deletes ONLY through it (G3a checks this).
//
// Backend: ART_STORE = supabase (default: the storage calls of before) | r2 (the S3 API of bucket lptcg-media, key
// card-art/<name>). It ONLY picks the backend. The freeze and the cut are FILES in the state folder (ART_STATE_DIR, default
// ~/.lptcg/r2 = C:\Users\vaugh\.lptcg\r2), read on EVERY call, in every process, whatever its .env (R2-MOVE spec 4.2a):
//   FROZEN    no NEW logical write starts. A write that started before may finish (its in-flight file is open).
//   CUTOVER   the writers use R2 only: backend supabase = 'refused: cut to R2 (R2-MOVE)'.
//   inflight/<pid>-<n>   one open logical write (beginWrite .. endWrite). S4 waits until the folder is empty.
// Every r2 write and delete first appends one JSON line to the write log (ART_WRITE_LOG, default <state>/art-writes.jsonl):
// { t, op, key, md5, bytes, type }. A failed append fails the write before the PUT.
//
//   const store = createArtStore({ db });            // db = the supabase client of the caller (backend supabase)
//   await store.withWrite('push abc gold', async () => { await store.put('cards/abc-gold.webp', buf, 'image/webp'); ... });
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { md5hex } from './r2-s3.js';
import { readR2Vault } from './r2-vault.js';

export const BUCKET = 'card-art';
export const BACKENDS = ['supabase', 'r2'];
export const REFUSED_FROZEN = 'refused: art-store frozen (R2-MOVE S4)';
export const REFUSED_CUT = 'refused: cut to R2 (R2-MOVE)';
export const REFUSED_STAGE = 'refused: stage-faces writes Supabase storage (R2-MOVE)';
export const DEFAULT_R2_PUBLIC_BASE = 'https://img.lionpridetcg.com';

export const stateDir = (env = process.env) => env.ART_STATE_DIR || join(homedir(), '.lptcg', 'r2');
export const writeLogPath = (env = process.env) => env.ART_WRITE_LOG || join(stateDir(env), 'art-writes.jsonl');

/** The state files, read NOW (never cached). */
export function readState(env = process.env) {
  const dir = stateDir(env);
  return { dir, frozen: existsSync(join(dir, 'FROZEN')), cutover: existsSync(join(dir, 'CUTOVER')) };
}

export function backendOf(env = process.env) {
  const v = env.ART_STORE || 'supabase';
  if (!BACKENDS.includes(v)) throw new Error(`refused: ART_STORE=${v} unknown`);
  return v;
}

/** The in-flight files of every process (the S4 wait) or of one pid. */
export function inflightFiles(env = process.env, pid = null) {
  const d = join(stateDir(env), 'inflight');
  let names = [];
  try { names = readdirSync(d); } catch { return []; }
  return names.filter((n) => pid == null || n.startsWith(`${pid}-`)).map((n) => join(d, n));
}

/**
 * stage-faces (W6) writes Supabase storage only. It runs only while the art is in Supabase: no FROZEN, no CUTOVER, and
 * ART_STORE = supabase. Returns the refusal line, or null. Called at the start and before each storage write.
 */
export function checkArtState(env = process.env) {
  const s = readState(env);
  if (s.frozen || s.cutover || (env.ART_STORE || 'supabase') !== 'supabase') return REFUSED_STAGE;
  return null;
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * The S4 wait (spec 4.2a, 6.1 S4 step 1): poll until inflight/ is empty. A file whose pid is not alive is reported as
 * `STALE-INFLIGHT <file> <label>` and removed (the logical write it names goes to the step-3 FAIL rule).
 * Returns { ok, waitedMs, stale: [{ file, label }], left: [files] } (ok = false after timeoutMs).
 */
export async function waitInflight({ env = process.env, timeoutMs = 600_000, pollMs = 5000, isAlive = pidAlive, log = (l) => console.log(l) } = {}) {
  const t0 = Date.now();
  const stale = [];
  for (;;) {
    for (const f of inflightFiles(env)) {
      const pid = Number(String(f).split(/[\\/]/).pop().split('-')[0]);
      if (!isAlive(pid)) {
        let label = '';
        try { label = readFileSync(f, 'utf8').split('\n')[1] || ''; } catch { /* gone */ }
        log(`STALE-INFLIGHT ${f} ${label}`);
        stale.push({ file: f, label });
        rmSync(f, { force: true });
      }
    }
    const left = inflightFiles(env);
    if (!left.length) return { ok: true, waitedMs: Date.now() - t0, stale, left };
    if (Date.now() - t0 >= timeoutMs) return { ok: false, waitedMs: Date.now() - t0, stale, left };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

let seq = 0;

export function createArtStore({ db = null, env = process.env, vault = () => readR2Vault({ env }), endpoint = env.R2_ENDPOINT, fetchImpl, s3 = null } = {}) {
  let s3p = s3 ? Promise.resolve(s3) : null;
  const r2 = () => {
    if (!s3p) {
      s3p = (async () => {
        const creds = vault(); // throws 'refused: R2 vault missing' before any request
        const { createS3 } = await import('./r2-s3.js');
        return createS3({ creds, endpoint, bucket: env.R2_BUCKET || creds.bucket, ...(fetchImpl ? { fetchImpl } : {}) });
      })();
      s3p.catch(() => { s3p = null; });
    }
    return s3p;
  };
  const ownOpen = () => inflightFiles(env, process.pid).length > 0;
  const state = () => readState(env); // the state files NOW, on every call (never cached: spec N1)
  const cutRefused = (s, backend) => s.cutover && backend === 'supabase';

  // put / remove / ensureBucket: FROZEN refuses unless this process has an open logical write (it may finish, spec N2).
  function guard(label) {
    const backend = backendOf(env);
    const s = state();
    if (cutRefused(s, backend)) throw new Error(`${REFUSED_CUT} ${label}`);
    if (s.frozen && !ownOpen()) throw new Error(`${REFUSED_FROZEN} ${label}`);
    return backend;
  }

  function log(line) {
    const p = writeLogPath(env);
    mkdirSync(join(p, '..'), { recursive: true });
    appendFileSync(p, `${JSON.stringify({ t: new Date().toISOString(), ...line })}\n`);
  }

  function beginWrite(label) {
    const backend = backendOf(env);
    const s = state();
    // A NEW logical write: refused under FROZEN. The label is printed (for a push: card id + tier), so the S4 REPORT lists it.
    if (s.frozen) { console.log(`${REFUSED_FROZEN} ${label}`); throw new Error(`${REFUSED_FROZEN} ${label}`); }
    if (cutRefused(s, backend)) { console.log(`${REFUSED_CUT} ${label}`); throw new Error(`${REFUSED_CUT} ${label}`); }
    const d = join(s.dir, 'inflight');
    mkdirSync(d, { recursive: true });
    seq += 1;
    const file = join(d, `${process.pid}-${seq}`);
    writeFileSync(file, `${process.pid}\n${label}\n${new Date().toISOString()}\n`);
    return { file, label };
  }
  function endWrite(h) { if (h?.file) rmSync(h.file, { force: true }); }
  async function withWrite(label, fn) {
    const h = beginWrite(label);
    try { return await fn(); } finally { endWrite(h); }
  }

  async function put(name, buf, contentType, { cacheControl } = {}) {
    const backend = guard(name);
    if (backend === 'supabase') {
      const { error } = await db.storage.from(BUCKET).upload(name, buf, { contentType, upsert: true, ...(cacheControl ? { cacheControl } : {}) });
      if (error) throw new Error(error.message);
      return { backend };
    }
    const c = await r2();
    const key = `${BUCKET}/${name}`;
    log({ op: 'put', key, md5: md5hex(buf), bytes: buf.length, type: contentType });
    await c.put(key, buf, { contentType, ...(cacheControl ? { cacheControl: `public, max-age=${cacheControl}` } : {}) });
    return { backend };
  }

  async function remove(names) {
    const backend = guard(names.join(','));
    if (backend === 'supabase') {
      const { error } = await db.storage.from(BUCKET).remove(names);
      if (error) throw new Error(error.message);
      return { backend };
    }
    const c = await r2();
    for (const name of names) {
      const key = `${BUCKET}/${name}`;
      log({ op: 'del', key, md5: null, bytes: 0, type: null });
      await c.del(key);
    }
    return { backend };
  }

  async function head(name) {
    const backend = backendOf(env);
    if (backend === 'supabase') {
      const r = await fetch(readUrl(name), { method: 'HEAD' });
      return { status: r.status, etag: (r.headers.get('etag') || '').replace(/"/g, '') || null, size: Number(r.headers.get('content-length') || 0), type: r.headers.get('content-type') };
    }
    return (await r2()).head(`${BUCKET}/${name}`);
  }

  /** The names (and times) under a folder of the bucket, e.g. list('grid/cards'). */
  async function list(folder) {
    const backend = backendOf(env);
    const out = [];
    if (backend === 'supabase') {
      for (let off = 0; ; off += 1000) {
        const { data } = await db.storage.from(BUCKET).list(folder, { limit: 1000, offset: off });
        for (const f of data || []) out.push({ name: `${folder}/${f.name}`, updated: Date.parse(f.updated_at || f.created_at || 0) });
        if (!data || data.length < 1000) break;
      }
      return out;
    }
    for (const o of await (await r2()).list(`${BUCKET}/${folder}/`)) {
      const rest = o.key.slice(BUCKET.length + 1 + folder.length + 1);
      if (!rest.includes('/')) out.push({ name: `${folder}/${rest}`, updated: Date.parse(o.modified || 0) });
    }
    return out;
  }

  /** A public read address of the store (make-thumbs downloads the source image from it). */
  function readUrl(name) {
    if (backendOf(env) === 'r2') return `${(env.R2_PUBLIC_BASE || DEFAULT_R2_PUBLIC_BASE).replace(/\/+$/, '')}/${BUCKET}/${name}`;
    return `${String(env.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${name}`;
  }

  /** The bucket exists (push.js ensureBucket, the pack art, the shimmer upload). R2: the bucket is made in the dashboard. */
  async function ensureBucket() {
    const backend = guard('ensureBucket');
    if (backend === 'r2') return;
    const { error } = await db.storage.createBucket(BUCKET, { public: true });
    if (error && !/exist/i.test(error.message)) throw new Error(`bucket: ${error.message}`);
  }

  return { beginWrite, endWrite, withWrite, put, remove, head, list, readUrl, ensureBucket, backend: () => backendOf(env) };
}
