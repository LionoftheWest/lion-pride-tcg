// R2-MOVE: copy the card art (bucket card-art) from Supabase Storage to R2 (bucket lptcg-media, key card-art/<name>).
//   node scripts/r2-copy.mjs                    the plan only (no write)
//   node scripts/r2-copy.mjs --live             S2: copy every object whose R2 ETag is not the DB eTag
//   node scripts/r2-copy.mjs --live --delta     S4 step 2 (needs FROZEN): the same, and DELTA-DEL of R2 keys not in the DB
//       --max-deletes <n>                       allow more than 200 DELTA-DEL (default limit 200, see DELTA_DEL_MAX)
//   node scripts/r2-copy.mjs --live --reverse   I-5 rollback (needs FROZEN): every write-log key R2 -> Supabase (a del line: delete there)
//   --keys a,b                                  only these names (cards/x.png, ...)
// Sources in order (spec G1): (1) the S1 backup file when its MD5 = eTag; (2) the Activity proxy (no Supabase egress for a
// cached key); (3) the Supabase authenticated GET with ?cb=<random>. Each must give MD5 = eTag (3 tries for 2 and 3; a 429
// = the next source), else COPY FAIL. The Supabase CDN can answer an old copy of an overwritten key (spec 2.6).
// One PUT per key with Content-MD5, Content-Type = mimetype, Cache-Control public, max-age=604800 (3 tries).
// Refuses with CUTOVER (except --reverse): after the cut R2 is newer than Supabase. --delta refuses without FROZEN.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readState, writeLogPath } from '../src/art-store.js';
import { args, assertProject, BUCKET, dbClient, getS3, listDbObjects, loadEnv, md5hex, readWriteLog, rowVersions } from './r2-lib.mjs';

const DEFAULT_BACKUP = 'C:/Users/vaugh/lptcg-pipeline/items/S1-FACE/work/backup';
const DEFAULT_PROXY = 'https://play.lionpridetcg.com/app/api/img';
const DEFAULT_WORK = 'C:/Users/vaugh/lptcg-pipeline/items/R2-MOVE/work';
const CACHE = 'public, max-age=604800';
// The DELTA-DEL limit (review r1 L5). A DELTA-DEL is an R2 key whose object was deleted in Supabase between S2 and S4. Each
// one is part of the S2..S4 delta, and the spec expects that delta below 200 objects. So more than 200 deletes means a
// short DB list (a failed or partial listDbObjects), not real deletes: refuse before ANY write. --max-deletes <n> overrides.
export const DELTA_DEL_MAX = 200;

async function getOk(url, headers = {}) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return { status: r.status };
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return { status: 'error', error: e.message }; }
}

/** The bytes of one DB object with MD5 = eTag, or null. { buf, src } */
export async function fetchSource(o, { env, versions }) {
  const backup = join(env.R2_BACKUP_DIR || DEFAULT_BACKUP, o.name);
  if (existsSync(backup)) {
    const buf = readFileSync(backup);
    if (md5hex(buf) === o.eTag) return { buf, src: 1 };
  }
  const proxy = (env.R2_PROXY_BASE || DEFAULT_PROXY).replace(/\/+$/, '');
  for (let i = 0; i < 3; i += 1) {
    const r = await getOk(`${proxy}/storage/v1/object/public/${BUCKET}/${o.name}?v=${versions.get(o.name) || 'r2c1'}`);
    if (r.status === 429) break; // the miss limit of the proxy: the next source
    if (r.buf && md5hex(r.buf) === o.eTag) return { buf: r.buf, src: 2 };
  }
  const supa = String(env.SUPABASE_URL).replace(/\/+$/, '');
  const auth = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  for (let i = 0; i < 3; i += 1) {
    const r = await getOk(`${supa}/storage/v1/object/authenticated/${BUCKET}/${o.name}?cb=${randomBytes(6).toString('hex')}`, auth);
    if (r.buf && md5hex(r.buf) === o.eTag) return { buf: r.buf, src: 3 };
  }
  return null;
}

async function putTries(s3, key, buf, contentType) {
  let last;
  for (let i = 0; i < 3; i += 1) {
    try { return await s3.put(key, buf, { contentType, cacheControl: CACHE }); } catch (e) { last = e; }
  }
  throw last;
}

export async function copy({ env = process.env, live = false, delta = false, keys = null, maxDeletes = DELTA_DEL_MAX, out = console.log } = {}) {
  const st = readState(env);
  if (st.cutover) { out('refused: cut to R2 (CUTOVER exists: R2 is newer than Supabase; use --reverse)'); return 2; }
  if (delta && !st.frozen) { out('refused: --delta without FROZEN (R2-MOVE S4 step 1)'); return 2; }
  const db = dbClient(env);
  const s3 = await getS3(env);
  let objs = await listDbObjects(db);
  if (keys) objs = objs.filter((o) => keys.includes(o.name));
  const r2 = new Map((await s3.list(`${BUCKET}/`)).map((o) => [o.key, o.etag]));
  // The DELTA-DEL list is known before any write: over the limit = refused, nothing copied, nothing deleted.
  const dbKeys = new Set(objs.map((o) => o.key));
  const dels = delta && !keys ? [...r2.keys()].filter((k) => !dbKeys.has(k)) : [];
  if (dels.length > maxDeletes) {
    out(`refused: DELTA-DEL ${dels.length} > ${maxDeletes} (a short DB list?). Check the list, then run again with --max-deletes ${dels.length}`);
    return 2;
  }
  const versions = await rowVersions(db);
  const work = env.R2_WORK_DIR || DEFAULT_WORK;
  const rec = live ? join(work, `copy-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`) : null;
  if (rec) mkdirSync(work, { recursive: true });
  let copied = 0, skipped = 0, failed = 0, bytes = 0, deleted = 0;
  for (const o of objs) {
    if (r2.get(o.key) === o.eTag) { skipped += 1; continue; }
    if (!live) { out(`PLAN ${o.key} bytes=${o.size}`); continue; }
    const got = await fetchSource(o, { env, versions });
    if (!got) { failed += 1; out(`COPY FAIL ${o.key} (no source with MD5 = eTag ${o.eTag})`); continue; }
    try {
      await putTries(s3, o.key, got.buf, o.mimetype);
    } catch (e) { failed += 1; out(`COPY FAIL ${o.key} (${e.message})`); continue; }
    copied += 1; bytes += got.buf.length;
    out(`COPY ${o.key} src=${got.src} bytes=${got.buf.length}`);
    appendFileSync(rec, `${JSON.stringify({ t: new Date().toISOString(), key: o.key, src: got.src, bytes: got.buf.length, md5: o.eTag })}\n`);
  }
  if (delta && !keys) {
    for (const k of r2.keys()) {
      if (dbKeys.has(k)) continue;
      if (!live) { out(`PLAN DELTA-DEL ${k}`); continue; }
      await s3.del(k);
      deleted += 1;
      out(`DELTA-DEL ${k}`);
      appendFileSync(rec, `${JSON.stringify({ t: new Date().toISOString(), key: k, op: 'delta-del' })}\n`);
    }
  }
  out(`COPY DONE copied=${copied} skipped=${skipped} deleted=${deleted} failed=${failed} bytes=${bytes}${live ? '' : ' (plan only, no --live)'}`);
  return failed ? 1 : 0;
}

/** I-5: every key of the write log, R2 -> Supabase (a key whose last line is del: removed in Supabase). */
export async function reverse({ env = process.env, live = false, out = console.log } = {}) {
  // I-5 step 1 is FROZEN (review r1 L2): a writer that runs during the reverse can write R2 after its key was copied.
  if (live && !readState(env).frozen) { out('refused: --reverse --live without FROZEN (I-5 step 1)'); return 2; }
  const db = dbClient(env);
  const s3 = await getS3(env);
  const log = readWriteLog(writeLogPath(env));
  let copied = 0, deleted = 0, failed = 0;
  for (const [key, e] of log) {
    if (!key.startsWith(`${BUCKET}/`)) continue;
    const name = key.slice(BUCKET.length + 1);
    if (!live) { out(`PLAN REVERSE ${e.last} ${key}`); continue; }
    if (e.last === 'del') {
      const { error } = await db.storage.from(BUCKET).remove([name]);
      if (error) { failed += 1; out(`REVERSE FAIL ${key} (${error.message})`); } else { deleted += 1; out(`REVERSE-DEL ${key}`); }
      continue;
    }
    const g = await s3.get(key);
    if (g.status !== 200 || !g.buf || (g.etag && md5hex(g.buf) !== g.etag)) { failed += 1; out(`REVERSE FAIL ${key} (R2 ${g.status})`); continue; }
    const { error } = await db.storage.from(BUCKET).upload(name, g.buf, { contentType: g.type || 'application/octet-stream', upsert: true, cacheControl: '604800' });
    if (error) { failed += 1; out(`REVERSE FAIL ${key} (${error.message})`); continue; }
    copied += 1;
    out(`COPY ${key} src=r2 bytes=${g.buf.length}`);
  }
  out(`REVERSE DONE copied=${copied} deleted=${deleted} failed=${failed}${live ? '' : ' (plan only, no --live)'}`);
  return failed ? 1 : 0;
}

async function main() {
  await loadEnv();
  const a = args();
  try {
    assertProject(process.env.SUPABASE_URL);
    const keys = a.val('--keys') ? a.val('--keys').split(',').filter(Boolean) : null;
    if (a.has('--reverse')) return await reverse({ live: a.has('--live') });
    const md = a.val('--max-deletes');
    if (md !== null && !/^[0-9]+$/.test(md)) { console.log(`refused: --max-deletes ${md} (a whole number)`); return 2; }
    return await copy({ live: a.has('--live'), delta: a.has('--delta'), keys, maxDeletes: md === null ? DELTA_DEL_MAX : Number(md) });
  } catch (e) {
    console.log(e.message.startsWith('refused') ? e.message : `COPY ERROR ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(); // no process.exit: on Windows it can abort while fetch sockets close
