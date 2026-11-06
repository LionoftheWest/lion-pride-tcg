// R2-MOVE: shared helpers of the move tools (r2-copy, r2-verify, r2-retire-supabase). A move tool: on the G3a allow list.
//   assertProject(url)      I-7: only Supabase kgvdqqehefezbypozvrh (a 127.0.0.1 / localhost stub only with R2_TEST=1)
//   dbClient(env)           the supabase-js client of SUPABASE_URL (after assertProject)
//   listDbObjects(db)       every object of bucket card-art: { name, key, size, eTag, mimetype, updated_at }
//   readWriteLog(path)      the art-store write log -> Map key -> { puts: Set(md5), last: 'put'|'del', lines }
//   getS3(env)              the R2 S3 client (vault keys; with R2_TEST=1 and a localhost R2_ENDPOINT: dummy keys for a stub)
//   md5hex(buf)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createS3, md5hex } from '../src/r2-s3.js';
import { readR2Vault } from '../src/r2-vault.js';

export { md5hex };
export const BUCKET = 'card-art';
export const LIVE_REF = 'kgvdqqehefezbypozvrh';
const here = dirname(fileURLToPath(import.meta.url));

/** card-studio/.env (never overrides an env value that is set). */
export async function loadEnv() {
  const p = join(here, '..', '.env');
  if (existsSync(p)) (await import('dotenv')).config({ path: p, override: false });
}

const isLocal = (host) => host === '127.0.0.1' || host === 'localhost';

export function assertProject(url, env = process.env) {
  let host = '';
  try { host = new URL(String(url)).hostname; } catch { /* not a URL */ }
  if (host === `${LIVE_REF}.supabase.co`) return;
  if (isLocal(host) && env.R2_TEST === '1') return;
  throw new Error(`refused: SUPABASE_URL is not ${LIVE_REF} (I-7)`);
}

export function dbClient(env = process.env) {
  assertProject(env.SUPABASE_URL, env);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('refused: SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const unq = (e) => (e ? String(e).replace(/"/g, '') : null);

/** Every object of the bucket (the storage list API, recursive). The eTag is the plain MD5 (spec 2.1 L8). */
export async function listDbObjects(db) {
  const out = [];
  async function walk(prefix) {
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
      for (const f of data || []) {
        const name = prefix ? `${prefix}/${f.name}` : f.name;
        if (f.id == null && !f.metadata) { await walk(name); continue; }
        if (f.name === '.emptyFolderPlaceholder') continue;
        const m = f.metadata || {};
        out.push({ name, key: `${BUCKET}/${name}`, size: Number(m.size ?? m.contentLength ?? 0), eTag: unq(m.eTag), mimetype: m.mimetype || null, updated_at: f.updated_at || m.lastModified || null });
      }
      if (!data || data.length < 1000) break;
    }
  }
  await walk('');
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** The art-store write log. A 'put' line is written BEFORE its PUT: newer = the R2 ETag is the md5 of ANY put line of the key. */
export function readWriteLog(path) {
  const m = new Map();
  if (!path || !existsSync(path)) return m;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (!j.key || !['put', 'del'].includes(j.op)) continue;
    const e = m.get(j.key) || { puts: new Set(), last: null, lines: [] };
    if (j.op === 'put') e.puts.add(j.md5);
    e.last = j.op;
    e.lines.push(j);
    m.set(j.key, e);
  }
  return m;
}

export async function getS3(env = process.env, { creds } = {}) {
  let c = creds;
  if (!c) {
    let host = '';
    try { host = new URL(String(env.R2_ENDPOINT || '')).hostname; } catch { /* none */ }
    c = env.R2_TEST === '1' && isLocal(host)
      ? { accountId: 'test', accessKeyId: 'test-key-id', secretAccessKey: 'test-secret', bucket: env.R2_BUCKET || 'test-bucket' }
      : readR2Vault({ env });
  }
  return createS3({ creds: c, endpoint: env.R2_ENDPOINT, bucket: env.R2_BUCKET || c.bucket });
}

/** The ?v of each stored URL (cards.image_url, card_sets.pack_art_url): name -> v. Empty when the read fails. */
export async function rowVersions(db) {
  const v = new Map();
  const add = (u) => {
    const m = /\/storage\/v1\/object\/public\/card-art\/([^?#]+)\?(?:.*&)?v=([\w.-]{1,32})/.exec(String(u || ''));
    if (m) v.set(m[1], m[2]);
  };
  try {
    const { data } = await db.from('cards').select('image_url');
    for (const r of data || []) add(r.image_url);
    const { data: s } = await db.from('card_sets').select('pack_art_url');
    for (const r of s || []) add(r.pack_art_url);
  } catch { /* no versions: r2c1 */ }
  return v;
}

export const args = (argv = process.argv.slice(2)) => ({
  has: (f) => argv.includes(f),
  val: (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; },
});
