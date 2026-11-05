/**
 * S1-FACE swap build (SPEC v2.4 2.4, 2.5, B9 SWAP / GUARD-ROW / UNSWAP / STORAGE GRACE FLUSH; review r1 L-3, L-4; the CDN defect of
 * BOARD 2026-11-04 22:15): the tests of `stage-faces.mjs swap | unswap | art-report` on a LOCAL copy, through the recording stub
 * (scripts/stage-stub.mjs) with a CDN in front of the public object reads (mode.cdn: a 200 is cached by path + query, like Cloudflare).
 *   node scripts/test-stage-swap.mjs --env <localdb env file> [--only BLOCK,BLOCK]
 * Take the copy lock first (mkdir lock + owner). The test changes only its 5 test rows and their objects, and restores them (RESTORE).
 * Inputs: REAL files only: the staged rows (work/staged.jsonl + work/stage/), the backup (work/backup.jsonl + work/backup/), the order.
 * Each check prints PASS or FAIL. Each mutation prints "MUT <name> caught (...)" or "MUT <name> NOT CAUGHT" (= a FAIL). A mutation is
 * valid only with its baseline PASS in the same run (each block runs its baseline first).
 * The I-1 check of this test is its OWN code: SQL on the copy (storage.objects + cards), not the code under test.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { startStub } from './stage-stub.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const ENVF = val('--env', null);
if (!ENVF || !existsSync(ENVF)) { console.log('usage: node scripts/test-stage-swap.mjs --env <localdb env file> (explicit; take its lock first)'); process.exit(1); }
const ONLY = val('--only', null)?.split(',');
const want = (t) => !ONLY || ONLY.includes(t);
const REAL = val('--item', 'C:/Users/vaugh/lptcg-pipeline/items/S1-FACE');
const T0 = Date.now();
const ITEM = join(process.env.TEMP || tmpdir(), `s1swap-test-${Date.now()}`).replace(/\\/g, '/');
const WORK = `${ITEM}/work`;
mkdirSync(`${WORK}/stage`, { recursive: true }); mkdirSync(`${WORK}/backup`, { recursive: true }); mkdirSync(`${ITEM}/logs`, { recursive: true });
let failed = 0;
const res = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`); if (!ok) failed += 1; return ok; };
const mut = (name, caught, how) => { console.log(`MUT ${name} ${caught ? `caught (${how})` : `NOT CAUGHT (${how})`}`); if (!caught) failed += 1; };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const env = Object.fromEntries(readFileSync(ENVF, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const API = env.SUPABASE_URL.replace(/\/+$/, ''), KEY = env.SUPABASE_SERVICE_ROLE_KEY, META = env.PGMETA_URL.replace(/\/+$/, '');
const sql = async (query) => {
  const r = await fetch(`${META}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
};
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// direct storage calls of the HARNESS (not through the stub): the truth of the copy
const objGet = async (name) => { const r = await fetch(`${API}/storage/v1/object/public/card-art/${name}?harness=${Date.now()}`); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; };
const objPut = async (name, buf, type) => { const r = await fetch(`${API}/storage/v1/object/card-art/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': type, 'x-upsert': 'true' }, body: buf }); if (!r.ok) throw new Error(`harness put ${name}: ${r.status} ${await r.text()}`); };
const objDel = async (names) => { if (!names.length) return; const r = await fetch(`${API}/storage/v1/object/card-art`, { method: 'DELETE', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: names }) }); if (!r.ok) throw new Error(`harness delete: ${r.status}`); };

// ---------------------------------------------------------------- the fixture: 5 REAL rows (still, event, gold, 2 stills)
const ROWS = val('--rows', '174,383,346,321,324').split(',').map(Number);
const [A, B, C, D, E] = ROWS;
const readJl = (f) => readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const staged = new Map(); for (const m of readJl(`${REAL}/work/staged.jsonl`)) if (m.s === 'STAGED' && ROWS.includes(m.card_id)) staged.set(m.card_id, m);
const backup = new Map(readJl(`${REAL}/work/backup.jsonl`).filter((b) => ROWS.includes(b.card_id)).map((b) => [b.card_id, b]));
const MAN = `${WORK}/staged.jsonl`, BJ = `${WORK}/backup.jsonl`, ORDER = `${WORK}/order.txt`, FRESH = `${WORK}/fresh.txt`;
const manLines = [];
for (const id of ROWS) {
  const m = structuredClone(staged.get(id));
  for (const [k, f] of Object.entries(m.files)) if (f) { const to = `${WORK}/stage/${f.path.split('/').pop()}`; copyFileSync(f.path, to); m.files[k] = { ...f, path: to }; }
  manLines.push(m);
}
writeFileSync(MAN, manLines.map((m) => JSON.stringify(m)).join('\n') + '\n');
for (const b of backup.values()) for (const o of b.objects) { mkdirSync(dirname(`${WORK}/backup/${o.name}`), { recursive: true }); copyFileSync(`${REAL}/work/backup/${o.name}`, `${WORK}/backup/${o.name}`); }
writeFileSync(BJ, ROWS.map((id) => JSON.stringify(backup.get(id))).join('\n') + '\n');
const ordAll = readFileSync(`${REAL}/work/order.txt`, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
writeFileSync(ORDER, ordAll.filter((l) => ROWS.includes(Number(l.split('\t')[0]))).join('\n') + '\n');
// the fresh log (the input that F2 "fresh" writes; here: its lines for the 5 rows)
writeFileSync(FRESH, ROWS.map((id) => `FRESH ${staged.get(id).key} ${staged.get(id).rarity} ${id}`).join('\n') + `\nFRESH n=${ROWS.length} stale=0\n`);
const RID = ROWS.map((id) => `${id} ${staged.get(id).key} ${staged.get(id).rarity}`).join(', ');
console.log(`   rows: ${RID}`);
const ext = (m) => m.files.main.path.split('.').pop();
const newOf = (id) => { const m = staged.get(id); const main = `cards/face2/${m.key}-${m.rarity}-${m.stamp}.${ext(m)}`; const base = main.replace(/\.[a-z0-9]+$/i, ''); return { main, names: [main, `grid/${base}.webp`, ...(m.files.reveal ? [`reveal/${base}.webp`] : [])], path: `/storage/v1/object/public/card-art/${main}?v=${m.stamp}` }; };
const oldOf = (id) => backup.get(id).objects.map((o) => o.name);
const pathOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '');

// ---------------------------------------------------------------- the harness checks (SQL on the copy)
const ANIM = new Set(['secret_rare', 'full_art', 'gold', 'event', 'promo']);
const objectSet = async () => new Set((await sql(`select name from storage.objects where bucket_id = 'card-art'`)).map((r) => r.name));
const rowsNow = async () => new Map((await sql(`select id, image_url from cards where id in (${ROWS.join(',')})`)).map((r) => [r.id, r.image_url]));
/** I-1 (own code): every S1 row's main, grid (and reveal) exist in storage.objects. */
async function I1() {
  const rows = await sql(`select id, rarity, image_url from cards where set_id = 'S1'`);
  const objs = await objectSet();
  const bad = [];
  for (const r of rows) {
    const m = pathOf(r.image_url).match(/\/object\/public\/card-art\/([^?]+)/);
    if (!m) { bad.push(`${r.id}:url`); continue; }
    const main = decodeURIComponent(m[1]), base = main.replace(/\.[a-z0-9]+$/i, '');
    for (const n of [main, `grid/${base}.webp`, ...(ANIM.has(r.rarity) ? [`reveal/${base}.webp`] : [])]) if (!objs.has(n)) bad.push(`${r.id}:${n}`);
  }
  return { ok: !bad.length, n: rows.length, bad };
}
/** each test row is old or new (path), never a third value. */
async function oldOrNew() {
  const now = await rowsNow();
  const bad = ROWS.filter((id) => ![backup.get(id).old_path, newOf(id).path].includes(pathOf(now.get(id))));
  return { ok: !bad.length, bad, now };
}
/** the face2 objects of the test rows that no row points at (orphans), and the old objects of rows on the new path (not deleted). */
async function leftovers() {
  const objs = await objectSet(), now = await rowsNow();
  const orph = [], oldLeft = [];
  for (const id of ROWS) {
    const onNew = pathOf(now.get(id)) === newOf(id).path;
    if (!onNew) for (const n of newOf(id).names) if (objs.has(n)) orph.push(n);
    if (onNew) for (const n of oldOf(id)) if (objs.has(n)) oldLeft.push(n);
  }
  return { orph, oldLeft };
}
const BEFORE = {};
/** the restore check: each test row = its exact URL before the test, each old object = the backup bytes, no face2 object. */
async function restoredExact() {
  const now = await rowsNow(); const objs = await objectSet(); const bad = [];
  for (const id of ROWS) {
    if (now.get(id) !== BEFORE[id]) bad.push(`${id} url`);
    for (const o of backup.get(id).objects) { const b = await objGet(o.name); if (!b || sha(b) !== o.sha256) bad.push(`${id} ${o.name} bytes`); }
    for (const n of newOf(id).names) if (objs.has(n)) bad.push(`${id} ${n} left`);
  }
  return { ok: !bad.length, bad };
}
/** put the copy back to the start state (rows = old URL, old objects = backup bytes, no face2), by the harness. */
async function hardRestore() {
  for (const id of ROWS) {
    await sql(`update cards set image_url = ${q(BEFORE[id])} where id = ${id}`);
    for (const o of backup.get(id).objects) { const b = await objGet(o.name); if (!b || sha(b) !== o.sha256) await objPut(o.name, readFileSync(`${WORK}/backup/${o.name}`), o.contentType); }
    const objs = await objectSet(); await objDel(newOf(id).names.filter((n) => objs.has(n)));
  }
}

// ---------------------------------------------------------------- the child runs (through the stub)
const stub = await startStub({ upstream: API, meta: META });
stub.mode = { cdn: true, forwardDelete: true };
const STUBENV = `${ITEM}/stub.env`;
writeFileSync(STUBENV, `SUPABASE_URL=${stub.url}\nSUPABASE_SERVICE_ROLE_KEY=${KEY}\nPGMETA_URL=${stub.metaUrl}\n`);
const ORIGIN = new URL(stub.url).origin;
const WRITE_RE = /^(POST|PATCH|DELETE|PUT)$/;
const writesFrom = (from) => stub.log.slice(from).filter((x) => WRITE_RE.test(x.method) && !(x.method === 'POST' && x.path.startsWith('/storage/v1/object/list/')));
let held = [];
function sf(args, { env: extra = {}, script = 'scripts/stage-faces.mjs', onHold = null, preload = true } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [...(preload ? ['--import', './scripts/localdb-preload.mjs'] : []), script, ...args], {
      cwd: ROOT,
      env: { ...process.env, LOCALDB: preload ? '1' : '', LOCALDB_ENV: STUBENV, LOCALDB_QUIET: '1', S1FACE_ITEM: ITEM, S1FACE_LOG: `${ITEM}/logs/s1-supervisor.txt`,
        SUPABASE_URL: 'https://kgvdqqehefezbypozvrh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-placeholder', DOTENV_CONFIG_PATH: `${ITEM}/no-such.env`,
        S1FACE_PROXY: stub.url, S1FACE_FINAL_WAIT_S: '1', ...extra },
    });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    let busy = false;
    const poll = setInterval(async () => {
      if (busy) return; busy = true;
      try {
        for (const f of readdirSync(WORK).filter((n) => n.startsWith('held-'))) {
          const tag = f.slice(5);
          if (onHold) await onHold(tag);
          held.push(tag);
          writeFileSync(`${WORK}/release-${tag}`, 'go');
          while (existsSync(`${WORK}/${f}`)) await new Promise((r) => setTimeout(r, 50));
        }
      } finally { busy = false; }
    }, 100);
    const timer = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 15 * 60000);
    c.on('close', (code) => { clearTimeout(timer); clearInterval(poll); resolve({ code, out, lines: out.split(/\r?\n/) }); });
  });
}
const show = (r, re = /^(SWAP|UNSWAP|UPDATED|DELETED|SKIP|CLEAN|RESUME|DONE|KEEP|UPLOAD|UNSWAPPED|ERROR|WRITE BLOCKED|refused|I-1|STORAGE|GRACE|WAIT|PROXY|TEST|GUARD|ART|ORPHANS|STILL)/) =>
  r.lines.filter((l) => re.test(l)).forEach((l) => console.log('   | ' + l.slice(0, 220)));
let logN = 0;
const ART = `${WORK}/art-report.txt`;
const swapArgs = (ids, extra = []) => ['swap', '--set', 'S1', '--until', '2099-01-01T00:00:00Z', '--fresh', FRESH, '--art', ART, '--manifest', MAN, '--backup', BJ, '--order', ORDER, '--only', ids.join(','), ...extra];
const unswapArgs = (sel, log, extra = []) => ['unswap', '--set', 'S1', '--manifest', MAN, '--backup', BJ, '--order', ORDER, '--swapped', log, ...sel, ...extra];
const newLog = () => `${WORK}/swapped-${++logN}.jsonl`;
const sum = (r, re) => (r.lines.find((l) => re.test(l)) || '');
function mutant(name, edits) {
  let s = readFileSync(join(ROOT, 'scripts', 'stage-faces.mjs'), 'utf8').replace(/\r\n/g, '\n');
  for (const [a, b] of edits) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`mutant ${name}: ${n} matches of ${a.slice(0, 70)}`); s = s.replace(a, () => b); }
  writeFileSync(join(ROOT, 'scripts', `.tmp-stage-mut-${name}.mjs`), s);
  return `scripts/.tmp-stage-mut-${name}.mjs`;
}
const cleanMutants = () => { for (const f of readdirSync(join(ROOT, 'scripts')).filter((n) => n.startsWith('.tmp-stage-mut-'))) rmSync(join(ROOT, 'scripts', f), { force: true }); };
/** arm the CDN: a member's plain GET (and HEAD) of each old object and its ?v URL, through the stub = a cached 200. */
async function armCdn(ids) {
  for (const id of ids) for (const o of backup.get(id).objects) for (const u of [`/storage/v1/object/public/card-art/${o.name}`, ...(o.name.startsWith('cards/') ? [backup.get(id).old_path] : [])]) {
    await fetch(ORIGIN + u).then((x) => x.arrayBuffer()); await fetch(ORIGIN + u, { method: 'HEAD' });
  }
}
const cdnPlain200 = async (name) => (await fetch(`${ORIGIN}/storage/v1/object/public/card-art/${name}`)).status;
const tlog = (block, t) => appendFileSync(`${REAL}/logs/test-times.txt`, `${new Date().toISOString()} test-stage-swap ${block} ${((Date.now() - t) / 1000).toFixed(0)} s\n`);

// ---------------------------------------------------------------- PRE: the copy has the 5 rows on their old path with the backup bytes
{
  const now = await rowsNow();
  for (const id of ROWS) BEFORE[id] = now.get(id);
  const pathsOk = ROWS.every((id) => pathOf(now.get(id)) === backup.get(id).old_path);
  await hardRestore(); // the old objects = the backup bytes (uploads only a differing object), no face2 object
  const r0 = await restoredExact();
  const i1 = await I1();
  res('PRE the 5 rows: old path = backup old_path, old bytes = backup sha, no face2', pathsOk && r0.ok, r0.bad.slice(0, 5).join(' '));
  res('PRE I-1 on the copy (all S1 rows)', i1.ok, `rows=${i1.n} ${i1.bad.slice(0, 5).join(' ')}`);
  if (!pathsOk || !r0.ok || !i1.ok) { console.log('RESULT FAIL (the copy is not in the start state)'); await stub.close(); process.exit(1); }
  // the art report of the 3 still rows (a REAL run; the swap tests use its file)
  const ra = await sf(['art-report', '--set', 'S1', '--manifest', MAN, '--backup', BJ, '--order', ORDER, '--out', ART]);
  show(ra, /^(ART|refused|ERROR|WRITE)/);
  res('PRE art-report: the 3 still rows = ART SAME, under the guard, exit 0', ra.code === 0 && [A, D, E].every((id) => ra.lines.some((l) => l.startsWith(`ART SAME ${id} `))) && ra.lines.some((l) => /^ART-REPORT rows=3 same=3 differ=0 bad=0/.test(l)));
}

// ---------------------------------------------------------------- SWAP: I-1 at every step, the grace, the end state (baseline)
const S3 = [A, B, C];
if (want('SWAP')) {
  const t = Date.now();
  await armCdn(S3);
  const log = newLog();
  const pts = S3.flatMap((id) => ['after-read', 'after-upload', 'after-update', 'after-delete-main'].map((p) => `hold:${p}:${id}`)).join(';');
  const seen = []; let graceOk = null; let stepFail = [];
  held = [];
  const r = await sf([...swapArgs(S3, ['--grace', '1', '--storage-every', '1']), '--swapped', log], { env: { S1FACE_TEST_POINT: pts }, onHold: async (tag) => {
    const i = await I1(), o = await oldOrNew();
    seen.push(`${tag}:${i.ok && o.ok ? 'ok' : 'FAIL'}`);
    if (!i.ok || !o.ok) stepFail.push(`${tag} ${i.bad.slice(0, 3).join(' ')} ${o.bad.join(',')}`);
    // the grace (grace = 1): at the update of row 2, the old objects of row 1 still exist
    if (tag === `after-update-${B}`) { const objs = await objectSet(); graceOk = oldOf(A).every((n) => objs.has(n)); }
  } });
  show(r);
  res('SWAP I-1 and old-or-new at every step', !stepFail.length && seen.length >= 11, `steps=${seen.length} ${stepFail.join(' | ')}`);
  res('SWAP grace: old objects of row 1 kept until row 2 is UPDATED', graceOk === true);
  const lo = await leftovers(), i1 = await I1(), on = await oldOrNew();
  const allNew = S3.every((id) => pathOf(on.now.get(id)) === newOf(id).path);
  const okSum = /^SWAP SUMMARY updated=3 deleted=3 done=0 skip=0 /.test(sum(r, /^SWAP SUMMARY/));
  res('SWAP end: 3 rows new, old objects gone, 0 orphans, I-1 PASS (own + the script line), exit 0', r.code === 0 && okSum && allNew && !lo.orph.length && !lo.oldLeft.length && i1.ok && r.lines.some((l) => /^I-1 PASS rows=/.test(l)),
    `exit=${r.code} orph=${lo.orph.length} oldLeft=${lo.oldLeft.length}`);
  res('SWAP proxy HEAD per row (--storage-every 1) = 200', r.lines.filter((l) => /^PROXY \d+ 200$/.test(l)).length === 3);
  // the CDN trap was armed: a plain GET of a deleted old object is still a cached 200, but the swap counted them as deleted (LIST + cache-busted)
  const trap = await cdnPlain200(oldOf(A)[0]);
  res('SWAP CDN trap armed and not counted: plain GET of a deleted object = 200 (HIT), DELETED 3', trap === 200 && r.lines.filter((l) => l.startsWith('DELETED ')).length === 3, `plain=${trap} hits=${stub.cdnHits}`);
  // IDEMPOTENT: a re-run of the swap = no write request, DONE 3
  let from = stub.log.length;
  const r2 = await sf([...swapArgs(S3), '--swapped', log]);
  res('IDEMPOTENT swap re-run: 0 write requests, DONE 3, exit 0', r2.code === 0 && !writesFrom(from).length && r2.lines.filter((l) => /^DONE /.test(l)).length === 3, `writes=${writesFrom(from).length}`);
  from = stub.log.length;
  const r3 = await sf([...swapArgs(S3), '--swapped', log], { script: mutant('nodone', [["    if (s.deleted) { nDone += 1; console.log(`DONE ${id}`); continue; }\n", '']]) });
  mut('idempotent_done_check_removed', writesFrom(from).length > 0, `writes=${writesFrom(from).length} exit=${r3.code}`);
  cleanMutants();

  // UNSWAP: row A alone, then --all (A = skip-expected); rows = the exact old URL, old bytes = backup; the CDN cached 200s do not count
  let u = await sf(unswapArgs(['--only', staged.get(A).key], log));
  show(u);
  res('UNSWAP --only <key>: UNSWAPPED A, old objects uploaded (not KEEP: the CDN 200 is not "present")', u.code === 0 && u.lines.some((l) => l.startsWith(`UNSWAPPED ${A} `)) && u.lines.filter((l) => l.startsWith(`UPLOAD ${A} `)).length === oldOf(A).length && !u.lines.some((l) => l.startsWith('KEEP')));
  u = await sf(unswapArgs(['--all'], log));
  show(u);
  res('UNSWAP --all: A skip-expected, others UNSWAPPED, exit 0', u.code === 0 && /^UNSWAP SUMMARY done=2 skip-expected=1 skip-unexpected=0 refused=0 /.test(sum(u, /^UNSWAP SUMMARY/)), sum(u, /^UNSWAP SUMMARY/));
  const rx = await restoredExact();
  res('ROLLBACK exact: each row = its exact old URL, each old object = the backup bytes, no face2 left', rx.ok, rx.bad.join(' '));
  res('ROLLBACK I-1', (await I1()).ok);
  from = stub.log.length;
  u = await sf(unswapArgs(['--all'], log));
  res('IDEMPOTENT unswap re-run: all skip-expected, 0 write requests, exit 0', u.code === 0 && /done=0 skip-expected=3 skip-unexpected=0 refused=0/.test(sum(u, /^UNSWAP SUMMARY/)) && !writesFrom(from).length, `writes=${writesFrom(from).length}`);
  tlog('SWAP', t);
}

// ---------------------------------------------------------------- the mutations of the swap path (each on the start state)
if (want('SWAPMUT')) {
  const t = Date.now();
  // M1 delete before the update: the crash after the upload leaves a row on its old path with its old objects deleted = I-1 FAIL
  await hardRestore();
  let r = await sf([...swapArgs([A], ['--grace', '1']), '--swapped', newLog()], { env: { S1FACE_TEST_POINT: `crash:after-upload:${A}` },
    script: mutant('delbefore', [["    await point('after-upload', id);\n", "    await deleteObjects(db, oldNamesOf(id));\n    await point('after-upload', id);\n"]]) });
  let i1 = await I1();
  mut('delete_before_update', !i1.ok, `I-1 ${i1.ok ? 'PASS' : 'FAIL ' + i1.bad.slice(0, 2).join(' ')}, exit ${r.code}`);
  // M2 grace removed: the old objects of row 1 are gone at the update of row 2
  await hardRestore();
  let graceOk = null;
  r = await sf([...swapArgs([A, B], ['--grace', '1']), '--swapped', newLog()], { env: { S1FACE_TEST_POINT: `hold:after-update:${B}` },
    script: mutant('nograce', [['    while (queue.length > GRACE) if', '    while (queue.length > 0) if']]),
    onHold: async () => { const objs = await objectSet(); graceOk = oldOf(A).every((n) => objs.has(n)); } });
  mut('grace_removed', graceOk === false, `old objects of row 1 at the update of row 2: ${graceOk ? 'present' : 'gone'}`);
  // M3 the CDN trap, delete side: the delete proof by a plain GET (a cached 200) = a false "still served", no DELETED
  await hardRestore(); await armCdn([A]);
  r = await sf([...swapArgs([A], ['--grace', '0']), '--swapped', newLog()], { script: mutant('cdnabsent', [['    const b = await objectBytes(db, n);\n', "    const b = await fetch((await import('../src/storage-url.js')).publicUrl(db, BUCKET, n)).then((x) => ({ status: x.status }));\n"]]) });
  mut('cdn_delete_proof_plain_get', !r.lines.some((l) => l.startsWith(`DELETED ${A}`)) && r.code !== 0, `${r.lines.find((l) => l.startsWith('ERROR')) || '-'} exit ${r.code}`);
  // M4 the CDN trap, present side: unswap decides "present" by a plain GET: it does not upload the deleted old objects = no rollback
  await hardRestore(); await armCdn([A]);
  const log4 = newLog();
  r = await sf([...swapArgs([A], ['--grace', '0']), '--swapped', log4]);
  const okSwap = r.code === 0 && r.lines.some((l) => l.startsWith(`DELETED ${A}`));
  const u4 = await sf(unswapArgs(['--only', String(A)], log4), { script: mutant('cdnpresent', [["export async function objectState(db, name) {\n", "export async function objectState(db, name) {\n  { const x = await fetch((await import('../src/storage-url.js')).publicUrl(db, BUCKET, name)); const b = x.ok ? Buffer.from(await x.arrayBuffer()) : null; return x.ok ? { present: true, size: b.length } : { present: false, size: null }; }\n"]]) });
  const rx4 = await restoredExact();
  mut('cdn_present_plain_get', okSwap && !rx4.ok, `swap ok=${okSwap}; unswap: ${sum(u4, /^UNSWAP SUMMARY/) || u4.lines.find((l) => /refused|ERROR/.test(l))}; restored=${rx4.ok}`);
  // M5 rollback bytes: a backup file with one byte changed = "refused: sha <name>" (input mutation; and the code without the sha check = wrong bytes)
  await hardRestore();
  const log5 = newLog();
  r = await sf([...swapArgs([D], ['--grace', '0']), '--swapped', log5]);
  const bf = `${WORK}/backup/${oldOf(D)[0]}`, orig = readFileSync(bf);
  const bad = Buffer.from(orig); bad[bad.length - 20] ^= 1; writeFileSync(bf, bad);
  let u5 = await sf(unswapArgs(['--only', String(D)], log5));
  res('UNSWAP backup file one byte changed = refused: sha <name>, exit 1, row stays new', u5.code === 1 && u5.lines.some((l) => l.startsWith(`refused: sha ${oldOf(D)[0]}`)) && (await I1()).ok && pathOf((await rowsNow()).get(D)) === newOf(D).path, u5.lines.find((l) => l.startsWith('refused')) || '-');
  u5 = await sf(unswapArgs(['--only', String(D)], log5), { script: mutant('noshacheck', [['        if (!buf || sha(buf) !== o.sha256 || buf.length !== o.bytes) { bad', '        if (!buf) { bad']]) });
  const rx5 = await restoredExact();
  mut('rollback_backup_sha_check_removed', !rx5.ok, rx5.bad.slice(0, 2).join(' ') || 'restored exact');
  writeFileSync(bf, orig);
  await hardRestore();
  // M6 rollback URL: the old ?v dropped = WRITE BLOCKED (the guard names the exact old path) and the row is not restored
  const log6 = newLog();
  await sf([...swapArgs([D], ['--grace', '0']), '--swapped', log6]);
  const u6 = await sf(unswapArgs(['--only', String(D)], log6), { script: mutant('nov', [['    const oldUrl = originOf(row.image_url) + b.old_path;\n', "    const oldUrl = originOf(row.image_url) + b.old_path.split('?')[0];\n"]]) });
  mut('rollback_url_without_v', u6.code === 5 && u6.lines.some((l) => l.startsWith('WRITE BLOCKED PATCH')) && pathOf((await rowsNow()).get(D)) === newOf(D).path, `${u6.lines.find((l) => l.startsWith('WRITE BLOCKED')) || '-'} exit ${u6.code}`);
  const u6b = await sf(unswapArgs(['--only', String(D)], log6));
  res('UNSWAP after the blocked mutant: the real unswap restores D exactly', u6b.code === 0 && (await restoredExact()).ok);
  cleanMutants();
  tlog('SWAPMUT', t);
}

// ---------------------------------------------------------------- L-h: an old object left with the backup sha = kept; another sha = refused
if (want('LH')) {
  await hardRestore();
  const log = newLog();
  let r = await sf([...swapArgs([D, E], ['--grace', '0']), '--swapped', log]);
  res('LH setup: D and E swapped, old objects deleted', r.code === 0 && r.lines.filter((l) => /^DELETED /.test(l)).length === 2);
  const oD = backup.get(D).objects[0], oE = backup.get(E).objects[0];
  await objPut(oD.name, readFileSync(`${WORK}/backup/${oD.name}`), oD.contentType); // the backup bytes
  await objPut(oE.name, Buffer.from('another object'), oE.contentType); // another sha
  const u = await sf(unswapArgs(['--only', `${D},${E}`], log));
  show(u);
  res('LH same sha = KEEP, row UNSWAPPED; another sha = refused: <name> differs (that row only), exit 1',
    u.code === 1 && u.lines.some((l) => l === `KEEP ${D} ${oD.name}`) && u.lines.some((l) => l.startsWith(`UNSWAPPED ${D} `)) && u.lines.some((l) => l.startsWith(`refused: ${oE.name} differs`)) && pathOf((await rowsNow()).get(E)) === newOf(E).path && (await I1()).ok,
    sum(u, /^UNSWAP SUMMARY/));
  await objDel([oE.name]);
  const u2 = await sf(unswapArgs(['--only', String(E)], log));
  res('LH after the other object is gone: E UNSWAPPED', u2.code === 0 && u2.lines.some((l) => l.startsWith(`UNSWAPPED ${E} `)) && (await restoredExact()).ok);
  // a row changed by hand = skip-unexpected (exit 1), the other rows done
  const log2 = newLog();
  await sf([...swapArgs([D, E], ['--grace', '0']), '--swapped', log2]);
  const nowE = (await rowsNow()).get(E);
  await sql(`update cards set image_url = ${q(nowE.replace(/\?v=\d+/, '?v=1'))} where id = ${E}`);
  const u3 = await sf(unswapArgs(['--all'], log2));
  res('UNSWAP a row changed by hand = skip-unexpected=1, exit 1, the other row UNSWAPPED', u3.code === 1 && /done=1 skip-expected=0 skip-unexpected=1 refused=0/.test(sum(u3, /^UNSWAP SUMMARY/)) && u3.lines.some((l) => l.startsWith(`UNSWAPPED ${D} `)), sum(u3, /^UNSWAP SUMMARY/));
  await sql(`update cards set image_url = ${q(nowE)} where id = ${E}`);
  await sf(unswapArgs(['--all'], log2));
  res('LH restored', (await restoredExact()).ok);
}

// ---------------------------------------------------------------- GUARD-ROW: a row changed before the swap / between the read and the update
if (want('GUARDROW')) {
  await hardRestore();
  await sql(`update cards set image_url = ${q(BEFORE[E].replace(/\?v=\d+/, '?v=2'))} where id = ${E}`);
  let r = await sf([...swapArgs([E]), '--swapped', newLog()]);
  let lo = await leftovers();
  res('GUARD-ROW changed before the swap = SKIP <id> changed, no new object', r.lines.some((l) => l.startsWith(`SKIP ${E} changed`)) && !lo.orph.length && !(await objectSet()).has(newOf(E).main));
  await sql(`update cards set image_url = ${q(BEFORE[E])} where id = ${E}`);
  r = await sf([...swapArgs([E]), '--swapped', newLog()], { env: { S1FACE_TEST_POINT: `hold:after-upload:${E}` }, onHold: async () => { await sql(`update cards set image_url = ${q(BEFORE[E].replace(/\?v=\d+/, '?v=3'))} where id = ${E}`); } });
  lo = await leftovers();
  const objs = await objectSet();
  res('GUARD-ROW changed between the read and the update = SKIP <id> changed, the uploaded objects deleted', r.lines.some((l) => l.startsWith(`SKIP ${E} changed`)) && newOf(E).names.every((n) => !objs.has(n)) && oldOf(E).every((n) => objs.has(n)), lo.orph.join(','));
  await sql(`update cards set image_url = ${q(BEFORE[E])} where id = ${E}`);
  res('GUARD-ROW restored', (await restoredExact()).ok);
}

// ---------------------------------------------------------------- CRASH: each point, then a re-run = the no-crash end state
if (want('CRASH')) {
  const t = Date.now();
  const cases = [['after-upload', B], ['after-update', B], ['after-delete-main', A], ['after-read', C]];
  const endOk = async () => { const lo = await leftovers(), i = await I1(), o = await oldOrNew(); return { ok: i.ok && o.ok && !lo.orph.length && !lo.oldLeft.length && S3.every((id) => pathOf(o.now.get(id)) === newOf(id).path), lo, i }; };
  const crashOne = async (point, id, script) => {
    await hardRestore();
    const log = newLog();
    const r = await sf([...swapArgs(S3, ['--grace', '1']), '--swapped', log], { env: { S1FACE_TEST_POINT: `crash:${point}:${id}` }, script });
    const i = await I1(), o = await oldOrNew();
    const r2 = await sf([...swapArgs(S3, ['--grace', '1', '--resume']), '--swapped', log], { script });
    const e = await endOk();
    return { r, r2, mid: i.ok && o.ok, e, log };
  };
  for (const [point, id] of cases) {
    const x = await crashOne(point, id);
    res(`CRASH ${point} ${id}: exit 9, then every row old or new + I-1; --resume = the no-crash end state (3 new, 0 orphans, old gone)`, x.r.code === 9 && x.mid && x.e.ok && x.r2.code === 0,
      `crash exit=${x.r.code} mid=${x.mid} resume exit=${x.r2.code} orph=${x.e.lo.orph.length} oldLeft=${x.e.lo.oldLeft.length} | ${sum(x.r2, /^SWAP SUMMARY/)}`);
  }
  // mutation: no UPLOADING line = a crash after the upload is not cleaned on the re-run: the re-run fails (an upload over a left object)
  const xm = await crashOne('after-upload', B, mutant('nouploading', [['    ev({ ev: \'UPLOADING\', card_id: id, names, newPath, oldUrl: row.image_url });\n', '']]));
  mut('crash_no_uploading_line', !(xm.e.ok && xm.r2.code === 0), `resume exit=${xm.r2.code} end=${xm.e.ok} ${xm.r2.lines.find((l) => l.startsWith('ERROR')) || ''}`);
  // mutation: the resume of an UPDATED row removed = its old objects are never deleted (crash after the update)
  const xr = await crashOne('after-update', B, mutant('noresume', [['      queue.push({ id, names: oldNamesOf(id), newPath });\n      console.log(`RESUME', '      console.log(`RESUME']]));
  mut('crash_resume_queue_removed', !xr.e.ok, `oldLeft=${xr.e.lo.oldLeft.length}`);
  cleanMutants();
  await sf(unswapArgs(['--all'], xr.log));
  await hardRestore();
  res('CRASH restored', (await restoredExact()).ok);
  tlog('CRASH', t);
}

// ---------------------------------------------------------------- GUARD: the write guard blocks every write except the named ones
if (want('GUARD')) {
  await hardRestore();
  const AFTER = '  for (const id of ids) {\n    const m = staged.get(id), b = backup.get(id);\n    if (!m || !b) { console.log(`PLAN ${id} -`); continue; }\n';
  const nB = newOf(B), urlA = `${pathOf(BEFORE[A]).split('?')[0]}`;
  const MUTS = {
    a_update_subjects: "  await db.from('subjects').update({ lore: 'm' }).eq('id', 1);\n",
    b_cards_row_not_named: "  await db.from('cards').update({ image_url: 'x' }).eq('id', 1).eq('image_url', 'y');\n",
    c_cards_other_field: `  await db.from('cards').update({ lore: 'm' }).eq('id', ${B}).eq('image_url', 'y');\n`,
    d_cards_no_compare_and_set: `  await db.from('cards').update({ image_url: 'http://h${nB.path}' }).eq('id', ${B});\n`,
    e_delete_card_back: "  await db.storage.from('card-art').remove(['cards/card-back.png']);\n",
    f_upload_not_named: "  await db.storage.from('card-art').upload('cards/zz-mutant.png', Buffer.from('x'), { upsert: false });\n",
    g_upsert_named: `  await db.storage.from('card-art').upload('${nB.main}', Buffer.from('x'), { upsert: true });\n`,
    h_management_sql: "  await fetch('https://api.supabase.com/v1/projects/kgvdqqehefezbypozvrh/database/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'update cards set lore = 1' }) });\n",
    i_rpc_admin_set_save: "  await db.rpc('admin_set_save', { p: {} });\n",
    j_delete_old_of_unnamed_row: `  await db.storage.from('card-art').remove(['${urlA.replace('/storage/v1/object/public/card-art/', '')}', 'cards/card-back.png']);\n`,
  };
  for (const [name, code] of Object.entries(MUTS)) {
    const from = stub.log.length;
    const r = await sf([...swapArgs([B]), '--swapped', newLog()], { script: mutant(name, [[AFTER, code + AFTER]]) });
    const w = writesFrom(from);
    mut(`guard_${name}`, r.code === 5 && r.lines.some((l) => l.startsWith('WRITE BLOCKED')) && !w.length && !r.lines.some((l) => l.startsWith('UPDATED')), `${r.lines.find((l) => l.startsWith('WRITE BLOCKED')) || '-'} exit=${r.code} writes at the stub=${w.length}`);
  }
  // the check itself can fail: the guard OFF + a harmless write (a compare-and-set that never matches) = a write request at the stub
  const from = stub.log.length;
  const r = await sf([...swapArgs([B]), '--swapped', newLog()], { script: mutant('guardoff', [["    installFetchGuard(undefined, { named, pathOf });\n", ''], [AFTER, "  await db.from('cards').update({ lore: 'm' }).eq('id', 1).eq('image_url', '__never__');\n" + AFTER]]) });
  mut('guard_off_check_sees_the_write', writesFrom(from).length > 0, `writes at the stub=${writesFrom(from).length} exit=${r.code}`);
  cleanMutants();
  await hardRestore();
  res('GUARD restored (no mutant changed the copy)', (await restoredExact()).ok && (await I1()).ok && (await objectSet()).has('cards/card-back.png'));
}

// ---------------------------------------------------------------- STORAGE: GRACE FLUSH at 940 MB, stop at 960 MB with an empty queue, the start cut
if (want('STORAGE')) {
  const t = Date.now();
  await hardRestore();
  const total = async () => Number((await sql(`select sum((metadata->>'size')::bigint) b from storage.objects where bucket_id = 'card-art'`))[0].b);
  const now0 = await total();
  stub.mode = { cdn: true, forwardDelete: true, inflate: 945000000 - now0 };
  const log = newLog();
  let r = await sf([...swapArgs(S3, ['--grace', '20', '--storage-every', '1']), '--swapped', log]);
  show(r, /^(STORAGE|GRACE|SWAP SUMMARY|UPDATED|DELETED)/);
  const flushOk = r.lines.some((l) => /^GRACE FLUSH 1$/.test(l)) && /^SWAP SUMMARY updated=3 deleted=3 .* stop=- /.test(sum(r, /^SWAP SUMMARY/)) && r.code === 0;
  res('STORAGE > 940,000,000 = GRACE FLUSH <n>, the swap goes on (3 updated)', flushOk, sum(r, /^SWAP SUMMARY/));
  await sf(unswapArgs(['--all'], log)); await hardRestore();
  r = await sf([...swapArgs(S3, ['--grace', '20', '--storage-every', '1']), '--swapped', newLog()], { script: mutant('noflush', [['    if (tot > 940000000 && queue.length) {', '    if (false) {']]) });
  mut('storage_flush_removed', !r.lines.some((l) => l.startsWith('GRACE FLUSH')), sum(r, /^SWAP SUMMARY/));
  await hardRestore();
  stub.mode = { cdn: true, forwardDelete: true }; // the inflate comes AFTER the start (the start projection would refuse it): at the read of row 1
  const late = { env: { S1FACE_TEST_POINT: `hold:after-read:${A}` }, onHold: async () => { stub.mode = { cdn: true, forwardDelete: true, inflate: 965000000 - now0 }; } };
  const log2 = newLog();
  r = await sf([...swapArgs(S3, ['--grace', '20', '--storage-every', '1']), '--swapped', log2], late);
  show(r, /^(STORAGE|GRACE|SWAP SUMMARY)/);
  const on = await oldOrNew();
  res('STORAGE > 960,000,000 with an empty queue = STORAGE STOP after row 1, rows 2-3 old, I-1, exit 1',
    r.code === 1 && r.lines.some((l) => l.startsWith('STORAGE STOP')) && /updated=1 /.test(sum(r, /^SWAP SUMMARY/)) && pathOf(on.now.get(B)) === backup.get(B).old_path && (await I1()).ok, sum(r, /^SWAP SUMMARY/));
  stub.mode = { cdn: true, forwardDelete: true }; await sf(unswapArgs(['--all'], log2)); await hardRestore();
  r = await sf([...swapArgs(S3, ['--grace', '20', '--storage-every', '1']), '--swapped', newLog()], { ...late, script: mutant('nostop', [["    } else if (tot > 960000000) return `storage now=${tot} > 960000000 with an empty queue`;\n", '    }\n'], ['      if (t2 > 960000000) return `storage now=${t2} > 960000000 with an empty queue`;\n', '']]) });
  mut('storage_stop_removed', !r.lines.some((l) => l.startsWith('STORAGE STOP')) && /updated=3 /.test(sum(r, /^SWAP SUMMARY/)), sum(r, /^SWAP SUMMARY/));
  stub.mode = { cdn: true, forwardDelete: true };
  await hardRestore();
  // the start projection: a limit just above now = the rows that add bytes are cut (WAIT storage), none swapped
  // the 3 rows together free bytes (O: deltas 174 +12,670, 383 -102,334, 346 -315,280); a limit 1 B under their projected end = cut 174
  const dsum = S3.reduce((t, id) => t + Object.values(staged.get(id).files).filter(Boolean).reduce((a, x) => a + x.bytes, 0) - backup.get(id).objects.reduce((a, o) => a + o.bytes, 0), 0);
  r = await sf([...swapArgs(S3), '--swapped', newLog()], { env: { S1FACE_LIMIT: String(now0 + dsum - 1) } });
  show(r, /^(WAIT|refused|SWAP)/);
  const cutIds = ((r.lines.find((l) => l.startsWith('WAIT storage rows=')) || '').match(/ids=([\d,]+)/)?.[1] || '').split(',').filter(Boolean).map(Number);
  res('STORAGE start projection over the limit = WAIT storage: the adding rows are cut and not swapped', cutIds.length > 0 && cutIds.every((id) => !r.lines.some((l) => l.startsWith(`UPDATED ${id} `)) && r.lines.some((l) => l.startsWith(`WAIT ${id} storage`))), `cut=${cutIds.join(',')}`);
  await hardRestore();
  tlog('STORAGE', t);
}

// ---------------------------------------------------------------- TREE (L-3) and L-4
if (want('RULES')) {
  const f = join(ROOT, 'scripts', 'test-stage-faces.mjs'), orig = readFileSync(f);
  let r;
  try { writeFileSync(f, Buffer.concat([orig, Buffer.from('\n// dirty\n')])); r = await sf([...swapArgs([A]), '--swapped', newLog()]); } finally { writeFileSync(f, orig); }
  res('L-3 a tracked file changed = refused: the tree is dirty (no request)', r.code === 1 && r.lines.some((l) => l.startsWith('refused: the tree is dirty')), r.lines.find((l) => l.startsWith('refused')) || '-');
  r = await sf(['orphans', '--set', 'S1', '--live', '--list', `${ITEM}/x.txt`]);
  res('L-4 orphans --live --list <file> = refused', r.code === 1 && r.lines.includes('refused: --list with --live (the B10 list is fixed)'));
  r = await sf(['swap', '--set', 'S1', '--until', '2099-01-01T00:00:00Z', '--manifest', MAN, '--backup', BJ, '--order', ORDER, '--swapped', newLog()]);
  res('swap without --fresh = refused', r.code === 1 && r.lines.some((l) => l.startsWith('refused: --fresh')));
  const stale = `${WORK}/fresh-stale.txt`; writeFileSync(stale, readFileSync(FRESH, 'utf8').split('\n').filter((l) => !l.endsWith(` ${A}`)).join('\n'));
  r = await sf([...swapArgs([A]).map((x) => (x === FRESH ? stale : x)), '--swapped', newLog()]);
  res('swap of a row with no FRESH line = SKIP <id> not-fresh, nothing written', r.lines.some((l) => l.startsWith(`SKIP ${A} not-fresh`)) && (await restoredExact()).ok);
}

// ---------------------------------------------------------------- ORPHANS: the B10 delete proof with the CDN (the defect of 2026-11-04 22:15)
if (want('ORPHANS')) {
  const list17 = readFileSync(`${REAL}/gate/orphans-17.txt`, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
  const fake = new Map(list17.map(([n, b]) => [n, Number(b)]));
  const run = async (script) => {
    stub.deleted.clear(); stub.cdnCache.clear();
    stub.mode = { extra: list17.map(([n, b]) => ({ name: n, size: Number(b) })), fake, cdn: true };
    for (const [n] of list17) await fetch(`${ORIGIN}/storage/v1/object/public/card-art/${n}`).then((x) => x.arrayBuffer()); // a member's GET: a cached 200
    // the stub's fake answer goes before the CDN cache: put the cached 200s in place by hand (the fake path does not reach the cache code)
    for (const [n, b] of list17) stub.cdnCache.set(`GET /storage/v1/object/public/card-art/${n}`, { h: { 'content-type': 'image/png', 'content-length': String(b) }, body: Buffer.alloc(Number(b), 7) });
    const from = stub.log.length;
    const r = await sf(['orphans', '--set', 'S1', '--out', `${WORK}/orphans-backup-${Date.now()}`, '--list', `${REAL}/gate/orphans-17.txt`], { script });
    const dels = stub.log.slice(from).filter((x) => x.method === 'DELETE').flatMap((x) => JSON.parse(x.body).prefixes);
    return { r, dels };
  };
  // the stub "fake" mode answers before the cache: the deleted names answer 404 to a cache-busted GET and a cached 200 to a plain GET
  let { r, dels } = await run();
  show(r, /^(ORPHANS|STILL|refused|ERROR)/);
  res('ORPHANS with a CDN that holds a 200 of each: ORPHANS PASS deleted=17 (LIST + cache-busted GET), never the card back', r.code === 0 && r.lines.includes('ORPHANS PASS deleted=17 bytes=19785107 backup=17') && dels.length === 17 && !dels.includes('cards/card-back.png'));
  ({ r } = await run(mutant('orphplain', [['    const st = await objectState(db, o.name), r = await objectBytes(db, o.name);\n', '    const st = { present: false }, r = await fetch(publicUrl(db, BUCKET, o.name));\n']])));
  mut('orphans_plain_get_proof', r.lines.some((l) => l.startsWith('ORPHANS FAIL')), sum(r, /^ORPHANS (PASS|FAIL)/));
  cleanMutants();
  stub.mode = { cdn: true, forwardDelete: true }; stub.deleted.clear();
}

// ---------------------------------------------------------------- ART-REPORT
if (want('ARTREPORT')) {
  const r = await sf(['art-report', '--set', 'S1', '--manifest', MAN, '--backup', BJ, '--order', ORDER, '--out', ART]);
  show(r, /^(ART|refused|ERROR|WRITE)/);
  res('ART-REPORT runs under the guard: ART SAME 3, exit 0', r.code === 0 && r.lines.some((l) => /^ART-REPORT rows=3 same=3 differ=0 bad=0/.test(l)) && !r.lines.some((l) => l.startsWith('WRITE BLOCKED')));
  const bf = `${WORK}/backup/${oldOf(D)[0]}`, orig = readFileSync(bf), bjOrig = readFileSync(BJ, 'utf8');
  const out2 = `${WORK}/art-report-2.txt`;
  try {
    // a backup file that differs from its backup.jsonl sha = ART BAD <id> backup sha
    const one = Buffer.from(orig); one[one.length - 30] ^= 1; writeFileSync(bf, one);
    let r2 = await sf(['art-report', '--set', 'S1', '--manifest', MAN, '--backup', BJ, '--order', ORDER, '--out', out2, '--only', `${D},${E}`]);
    res('ART-REPORT a backup file with one byte changed = ART BAD <id> backup sha, exit 1', r2.code === 1 && r2.lines.some((l) => l.startsWith(`ART BAD ${D} `) && l.endsWith('backup sha')));
    // the mutation input: the old face of D = the REAL old face of E (other art), its sha recorded = ART DIFFER D, E still SAME
    const eBuf = readFileSync(`${WORK}/backup/${oldOf(E)[0]}`);
    writeFileSync(bf, eBuf);
    writeFileSync(BJ, bjOrig.split('\n').map((l) => { if (!l) return l; const b = JSON.parse(l); if (b.card_id === D) b.objects[0] = { ...b.objects[0], sha256: createHash('sha256').update(eBuf).digest('hex'), bytes: eBuf.length }; return JSON.stringify(b); }).join('\n'));
    r2 = await sf(['art-report', '--set', 'S1', '--manifest', MAN, '--backup', BJ, '--order', ORDER, '--out', out2, '--only', `${D},${E}`]);
    show(r2, /^ART/);
    mut('art_report_other_old_art', r2.code === 1 && r2.lines.some((l) => l.startsWith(`ART DIFFER ${D} `)) && r2.lines.some((l) => l.startsWith(`ART SAME ${E} `)), r2.lines.find((l) => l.startsWith(`ART DIFFER ${D}`) || l.startsWith(`ART SAME ${D}`)) || '-');
  } finally { writeFileSync(bf, orig); writeFileSync(BJ, bjOrig); }
  // the swap side: an ART DIFFER row waits (SKIP <id> art); Nathan's "ART OK <id>" line lets it go
  const artD = `${WORK}/art-differ.txt`;
  writeFileSync(artD, readFileSync(ART, 'utf8').replace(new RegExp(`^ART SAME ${D} .*$`, 'm'), `ART DIFFER ${D} test`));
  let s1 = await sf([...swapArgs([D]).map((x) => (x === ART ? artD : x)), '--swapped', newLog()]);
  res('SWAP an ART DIFFER row = SKIP <id> art, nothing written', s1.lines.some((l) => l.startsWith(`SKIP ${D} art`)) && (await restoredExact()).ok);
  appendFileSync(artD, `ART OK ${D} Nathan test\n`);
  s1 = await sf([...swapArgs([D], ['--grace', '0']).map((x) => (x === ART ? artD : x)), '--swapped', newLog()]);
  res('SWAP the same row with "ART OK <id> Nathan" = UPDATED', s1.code === 0 && s1.lines.some((l) => l.startsWith(`UPDATED ${D} `)));
  await hardRestore();
}

// ---------------------------------------------------------------- RESTORE: the copy = the start state
await hardRestore();
const fin = await restoredExact(), fi1 = await I1();
res('RESTORE the 5 rows = their exact URL, the old bytes, no face2; I-1 on the copy', fin.ok && fi1.ok, `${fin.bad.join(' ')} ${fi1.bad.slice(0, 3).join(' ')}`);
await stub.close();
cleanMutants();
console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} failed=${failed} item=${ITEM} time=${((Date.now() - T0) / 60000).toFixed(1)} min`);
appendFileSync(`${REAL}/logs/test-times.txt`, `${new Date().toISOString()} test-stage-swap ALL(${ONLY ? ONLY.join(',') : 'all'}) ${((Date.now() - T0) / 1000).toFixed(0)} s result=${failed ? 'FAIL' : 'PASS'}\n`);
process.exitCode = failed ? 1 : 0;
