// R2-MOVE: is R2 a complete and exact copy? (spec G1)
//   node scripts/r2-verify.mjs --exact [--before <iso T0>] [--write-manifest <file>]
//       every storage.objects key of card-art: R2 card-art/<name> exists, size = DB size, ETag = DB eTag, Content-Type =
//       DB mimetype. --before: also FAIL every object with updated_at >= T0 (S4 step 3). --write-manifest: the S4 manifest.
//   node scripts/r2-verify.mjs --manifest <file>          after S4 (the writers write R2): a key of the write log is
//       `newer` when its R2 ETag is the md5 of a put line; a key whose last log line is del must be absent; every other
//       manifest key must match the manifest.
//   node scripts/r2-verify.mjs --exact --source <dir>     the S7 second copy (rclone copy of the bucket, <dir>/card-art/..):
//       every R2 key is in <dir> with the same size and MD5.
// Output: R2VERIFY PASS n=<N> bytes=<B> [newer=<k>], else R2VERIFY FAIL missing=a differ=b type=c + DIFF lines, exit 1.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeLogPath } from '../src/art-store.js';
import { args, assertProject, BUCKET, dbClient, getS3, listDbObjects, loadEnv, md5hex, readWriteLog } from './r2-lib.mjs';

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i; i += 1; await fn(items[k]); } }));
}

/** --exact against the DB. Returns { pass, n, bytes, missing, differ, type, diffs, after, maxUpdated, objs }. */
export async function verifyExact({ db, s3, before = null }) {
  const dbObjs = await listDbObjects(db);
  const r2Keys = new Set((await s3.list(`${BUCKET}/`)).map((o) => o.key));
  const subject = dbObjs;
  const diffs = [];
  let missing = 0, differ = 0, type = 0, bytes = 0;
  await pool(subject, 8, async (o) => {
    const h = await s3.head(o.key);
    if (h.status === 404 || !r2Keys.has(o.key)) { missing += 1; diffs.push(`DIFF ${o.key} exists yes no`); return; }
    if (h.status !== 200) { missing += 1; diffs.push(`DIFF ${o.key} status 200 ${h.status}`); return; }
    let bad = false;
    if (h.size !== o.size) { bad = true; diffs.push(`DIFF ${o.key} size ${o.size} ${h.size}`); }
    if (h.etag !== o.eTag) { bad = true; diffs.push(`DIFF ${o.key} etag ${o.eTag} ${h.etag}`); }
    if (bad) differ += 1;
    if ((h.type || '') !== (o.mimetype || '')) { type += 1; diffs.push(`DIFF ${o.key} type ${o.mimetype} ${h.type}`); }
    bytes += o.size;
  });
  const after = before ? dbObjs.filter((o) => o.updated_at && Date.parse(o.updated_at) >= Date.parse(before)) : [];
  const maxUpdated = dbObjs.reduce((m, o) => (o.updated_at && (!m || Date.parse(o.updated_at) > Date.parse(m)) ? o.updated_at : m), null);
  return { pass: !missing && !differ && !type && !after.length, n: dbObjs.length, bytes, missing, differ, type, diffs: diffs.sort(), after, maxUpdated, objs: dbObjs };
}

/** After S4: the manifest + the write log. */
export async function verifyPostCut({ s3, manifest, log }) {
  const r2 = new Map((await s3.list(`${BUCKET}/`)).map((o) => [o.key, o]));
  const man = new Map(manifest.objects.map((o) => [o.key, o]));
  const keys = new Set([...man.keys(), ...log.keys()]);
  const diffs = [];
  let missing = 0, differ = 0, newer = 0, bytes = 0, n = 0;
  for (const key of [...keys].sort()) {
    const e = log.get(key);
    const r = r2.get(key);
    if (e && e.last === 'del') {
      if (r) { differ += 1; diffs.push(`DIFF ${key} deleted absent present`); }
      continue;
    }
    n += 1;
    if (!r) { missing += 1; diffs.push(`DIFF ${key} exists yes no`); continue; }
    bytes += r.size;
    if (e) {
      if (e.puts.has(r.etag)) newer += 1;
      else { differ += 1; diffs.push(`DIFF ${key} etag ${[...e.puts].join('|')} ${r.etag}`); }
      continue;
    }
    const m = man.get(key);
    if (r.etag !== m.md5 || r.size !== m.size) { differ += 1; diffs.push(`DIFF ${key} etag ${m.md5} ${r.etag}`); }
  }
  return { pass: !missing && !differ, n, bytes, missing, differ, type: 0, newer, diffs };
}

/** The S7 second copy: every R2 key is a file of <dir> with the same size and MD5. */
export async function verifySource({ s3, dir }) {
  const diffs = [];
  let missing = 0, differ = 0, bytes = 0;
  const list = await s3.list(`${BUCKET}/`);
  for (const o of list) {
    const f = join(dir, o.key);
    if (!existsSync(f)) { missing += 1; diffs.push(`DIFF ${o.key} exists yes no`); continue; }
    if (statSync(f).size !== o.size || md5hex(readFileSync(f)) !== o.etag) { differ += 1; diffs.push(`DIFF ${o.key} md5 ${o.etag} copy`); continue; }
    bytes += o.size;
  }
  return { pass: !missing && !differ, n: list.length, bytes, missing, differ, type: 0, diffs };
}

/** One entry point (r2-retire-supabase imports it). mode: 'exact' | 'post' | 'source'. */
export async function verify({ env = process.env, mode = 'exact', before = null, manifestPath = null, sourceDir = null, s3 = null, db = null } = {}) {
  const c = s3 || await getS3(env);
  if (mode === 'source') return verifySource({ s3: c, dir: sourceDir });
  if (mode === 'post') {
    if (!manifestPath || !existsSync(manifestPath)) throw new Error('refused: --manifest <file> (the S4 manifest) is needed after S4');
    return verifyPostCut({ s3: c, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')), log: readWriteLog(writeLogPath(env)) });
  }
  return verifyExact({ db: db || dbClient(env), s3: c, before });
}

export function report(r, out = console.log) {
  for (const d of r.diffs) out(d);
  for (const o of r.after || []) out(`AFTER-T0 ${o.key} ${o.updated_at}`);
  if (r.maxUpdated !== undefined) out(`MAX-UPDATED ${r.maxUpdated}`);
  if (r.pass) out(`R2VERIFY PASS n=${r.n} bytes=${r.bytes}${r.newer !== undefined ? ` newer=${r.newer}` : ''}`);
  else out(`R2VERIFY FAIL missing=${r.missing} differ=${r.differ} type=${r.type}${r.after?.length ? ` after=${r.after.length}` : ''}`);
}

async function main() {
  await loadEnv();
  const a = args();
  try {
    const mode = a.val('--source') ? 'source' : a.has('--exact') ? 'exact' : 'post';
    if (mode !== 'source') assertProject(process.env.SUPABASE_URL);
    const r = await verify({ mode, before: a.val('--before'), manifestPath: a.val('--manifest'), sourceDir: a.val('--source') });
    report(r);
    const wm = a.val('--write-manifest');
    if (wm) {
      if (!r.pass || mode !== 'exact') { console.log('refused: --write-manifest needs an --exact PASS'); return 1; }
      writeFileSync(wm, JSON.stringify({ t: new Date().toISOString(), maxUpdated: r.maxUpdated, objects: r.objs.map((o) => ({ key: o.key, md5: o.eTag, size: o.size, type: o.mimetype })) }, null, 1));
      console.log(`MANIFEST ${wm} n=${r.objs.length}`);
    }
    return r.pass ? 0 : 1;
  } catch (e) {
    console.log(e.message.startsWith('refused') ? e.message : `R2VERIFY ERROR ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(); // no process.exit: on Windows it can abort while fetch sockets close
