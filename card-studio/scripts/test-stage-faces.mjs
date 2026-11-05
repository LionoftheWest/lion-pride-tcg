import './localdb-guard.mjs';
/**
 * S1-FACE B9 (SPEC v2.2/v2.3): the tests of scripts/stage-faces.mjs, its write guard (scripts/stage-guard.mjs) and the render-only mode.
 * LOCAL copy only (take its lock first):
 *   LOCALDB=1 LOCALDB_ENV=<env> node --import ./scripts/localdb-preload.mjs scripts/test-stage-faces.mjs [--only BLOCK,BLOCK] [--rows still,anim,gold]
 * Each check prints PASS or FAIL; each mutation prints "MUT <name> caught (<how>)" or "MUT <name> NOT CAUGHT" (= a FAIL).
 * Blocks:
 *   UNIT     allowed(): every allowed row of SPEC 2.1 passes; the 7 forbidden requests (a)-(g) and offline mode are blocked.
 *   STATIC   stage-faces.mjs up to the WRITE COMMANDS line: no pushCard, writeTierRow, .insert( .update( .upsert( .delete( .remove(; push.js
 *            gives only renderTier. Mutation: a planted .update( call.
 *   TARGET   no preload and no --live = refused; --live with another project ref = "refused: not the TCG project".
 *   SETUP    (L-b) the main, grid, reveal of the 3 test rows: GET from live (curl, public objects), upload to the LOCAL bucket.
 *   GUARD    against the LOCAL STUB (scripts/stage-stub.mjs, a recording proxy in front of the copy, also for the Management SQL):
 *            order (N-1: player_cards > 1,000 rows, paged, owner totals = SQL), stage --only <still>, verify, storage, backup, face-export under
 *            the guard: exit 0, no WRITE BLOCKED, every recorded request is allowed. Mutations (a) writeTierRow (b) storage upload (c) rpc
 *            admin_set_save (d) GET players (e) Management SQL (f) /read-only (g) storage DELETE: each WRITE BLOCKED, exit 5, and the stub
 *            records NO request that the allow-list forbids.
 *   NOWRITE  (copy) stage --only <3 rows>: hash of cards, subjects and storage.objects before = after: "NOWRITE PASS db storage".
 *            Mutation: the guard removed + writeTierRow: "NOWRITE FAIL db".
 *   FP       fresh on the NOWRITE manifest: FRESH 3; a change only in stage-faces.mjs (a copy) = FRESH; one char in src/face-v2.js = STALE (all);
 *            one S1 ability_v2 name changed on the copy = STALE <key>; genre changed (CARDS_FILE) = STALE <key>.
 *   CHECKS   the UI-68 cut PNG = FAIL clearRows; a white half = FAIL white; a different 2nd face once = RETRY twice-differ then STAGED;
 *            always = FAIL twice-differ; a different 2nd text mask once (animated) = RETRY textmask-differ; FACE_V2=0 = FAIL face v1.
 *   STORAGE  limit = end - 1 = "refused: projected end" + "WAIT storage"; limit = end = PASS; verify with a big S2 term = B11 NEEDED, 0 = NOT NEEDED.
 *   ORPHANS  (stub LIST) the 17 = PASS (--dry) and a real run against the stub deletes exactly the 17 (never the card back); list file + card
 *            back = refused; one extra name = "refused: list differs +<name>"; one missing = "-<name>"; one size = "refused: size differs".
 *   YIELD    PAUSE = exit 3 no ROW; --until past = exit 4; resume skips a staged row; a real foreign "blender --background" = WAIT lines, S1 log
 *            "S1 WAIT foreign-blender" (repeated) and "S1 RESUME", then STAGED. Mutation: the PAUSE check removed = the PAUSE case FAILs.
 *   RENDERONLY (2.8) face-export; stage --render-only with the preload, NO Supabase env and no .env: 1 still + 1 animated STAGED;
 *            --live = refused; no preload = refused. Mutations: a fetch to another host = NET BLOCKED; a use of the client = RENDER-ONLY: no database.
 *   INGEST   the remote folder (staged.jsonl + stage/) = INGEST PASS n=2; the same rows staged here = CALIB lines (r5 L-3). Mutations: one byte,
 *            another fp, another Edge, another font sha, another commit, another stage-faces.mjs, the UI-68 cut PNG = INGEST FAIL; the
 *            workstation tools changed after S2n = refused (r5 L-2). fp-code is CRLF/LF neutral (P-3).
 *   KEYS     keys (index mod 2) + keys-check = KEYS PASS ws=<a> no=<b> total=352 overlap=0; calib.txt = 2 rows; stage --keys rows add up.
 *            Mutations: one key in both lists, one key missing = KEYS FAIL.
 */
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { allowed } from './stage-guard.mjs';
import { startStub } from './stage-stub.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!globalThis.__LOCALDB_API) { console.log('refused: LOCAL only (LOCALDB=1 with the localdb preload)'); process.exit(1); }
const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const [STILL, ANIM, GOLD] = val('--rows', '174,383,0').split(',').map(Number); // 0 = the most owned gold row of the order
const ONLY = val('--only', null)?.split(',');
const want = (t) => !ONLY || ONLY.includes(t);
const FIXTURE = val('--fixture', 'C:/Users/vaugh/lptcg-pipeline/items/S1-FACE/gate/fixtures/cut-ottozone-s-head-full_art.png');
const LIVE_HOST = 'https://kgvdqqehefezbypozvrh.supabase.co';
const T0 = Date.now();
const ITEM = join(process.env.TEMP || tmpdir(), `s1face-test-${Date.now()}`).replace(/\\/g, '/');
mkdirSync(`${ITEM}/work`, { recursive: true }); mkdirSync(`${ITEM}/gate/fixtures`, { recursive: true }); mkdirSync(`${ITEM}/logs`, { recursive: true });
copyFileSync(FIXTURE, `${ITEM}/gate/fixtures/cut-ottozone-s-head-full_art.png`);
copyFileSync('C:/Users/vaugh/lptcg-pipeline/items/S1-FACE/gate/orphans-17.txt', `${ITEM}/gate/orphans-17.txt`);
const S1LOG = `${ITEM}/logs/s1-supervisor.txt`;
const ORDER = `${ITEM}/work/order.txt`;
let failed = 0;
const res = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`); if (!ok) failed += 1; };
const mut = (name, caught, how) => { console.log(`MUT ${name} ${caught ? `caught (${how})` : `NOT CAUGHT (${how})`}`); if (!caught) failed += 1; };
const sha = (b) => createHash('sha256').update(b).digest('hex');

const sql = async (query) => {
  const r = await fetch('https://api.supabase.com/v1/projects/kgvdqqehefezbypozvrh/database/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
};
const H = async () => (await sql(`select
    (select md5(string_agg(t::text, '|' order by t.id)) from cards t) as cards,
    (select md5(string_agg(t::text, '|' order by t.id)) from subjects t) as subjects,
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from storage.objects t) as storage`))[0];
const sameH = (a, b) => a.cards === b.cards && a.subjects === b.subjects && a.storage === b.storage;

// a child run of stage-faces (or a mutated copy) on the copy, or on the stub (envFile)
const LOCALENV = process.env.LOCALDB_ENV;
// async: the stub (stage-stub.mjs) runs in THIS process and must answer while the child runs (spawnSync would block it)
// wait: false (default) = S1FACE_TEST_NOWAIT=1 (a still row that does not test the foreign-Blender rule); true = the real rule (a Blender row)
function sf(args, { env = {}, script = 'scripts/stage-faces.mjs', envFile = LOCALENV, preload = true, timeoutMin = 40, wait = false } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [...(preload ? ['--import', './scripts/localdb-preload.mjs'] : []), script, ...args], {
      cwd: ROOT, env: { ...process.env, LOCALDB_ENV: envFile, LOCALDB_QUIET: '1', S1FACE_ITEM: ITEM, S1FACE_LOG: S1LOG, ...(wait ? {} : { S1FACE_TEST_NOWAIT: '1' }), ...(preload ? {} : { LOCALDB: '' }), ...env },
    });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, timeoutMin * 60000);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, out, lines: out.split(/\r?\n/) }); });
  });
}
const man = (name) => `${ITEM}/work/${name}.jsonl`;
const stageArgs = (m, extra = []) => ['stage', '--set', 'S1', '--order', ORDER, '--manifest', m, '--until', '2099-01-01T00:00:00Z', ...extra];
const show = (r, re = /^(START|ROW|FACE|CHECK|RETRY|FAIL|STAGED|PAUSE|UNTIL|SUMMARY|WRITE BLOCKED|ERROR|TEST|refused|RENDER-ONLY|SHARD|INGEST|FACE-EXPORT|ORPHANS|STORAGE|VERIFY|BYTES|B11|ORDER|BACKUP|FRESH|STALE)/) =>
  r.lines.filter((l) => re.test(l)).forEach((l) => console.log('   | ' + l.slice(0, 230)));
function mutant(name, edits) {
  let s = readFileSync(join(ROOT, 'scripts', 'stage-faces.mjs'), 'utf8');
  for (const [a, b] of edits) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`mutant ${name}: ${n} matches of ${a.slice(0, 60)}`); s = s.replace(a, () => b); }
  const f = join(ROOT, 'scripts', `.tmp-stage-mut-${name}.mjs`);
  writeFileSync(f, s);
  return `scripts/.tmp-stage-mut-${name}.mjs`;
}
const cleanMutants = () => { for (const f of readdirSync(join(ROOT, 'scripts')).filter((n) => n.startsWith('.tmp-stage-mut-'))) rmSync(join(ROOT, 'scripts', f), { force: true }); };
const ANCHOR = '  const ordAll = readOrder(ordf);\n'; // in stage(), before any row
const GUARD1 = '    installFetchGuard(null, { offline: true });\n'; // not removed: offline stays guarded
const GUARD_ON = '  if (read) installFetchGuard(); // before the client is made\n';
const GUARD_CLIENT = '  if (read) guardClient(supabase);\n';
const AFTER_STAGED = '    nStaged += 1;\n';
const WRITE = "    { const { writeTierRow } = await import('../src/tier-set.js'); await writeTierRow({ db, existing: row, subjectId: null, rarity, fields: { image_url: 'mutant://' + files.main.path } }); }\n";
const MUTS = {
  a_writeTierRow: "  { const { writeTierRow } = await import('../src/tier-set.js'); await writeTierRow({ db, existing: { id: 1 }, subjectId: null, rarity: 'normal', fields: { image_url: 'x' } }); }\n",
  b_storage_upload: "  await db.storage.from('card-art').upload('cards/face2/mutant.png', Buffer.from('x'), { upsert: false });\n",
  c_rpc_admin_set_save: "  await db.rpc('admin_set_save', { p: {} });\n",
  d_get_players: "  await db.from('players').select('id').limit(1);\n",
  e_management_sql: "  await fetch('https://api.supabase.com/v1/projects/kgvdqqehefezbypozvrh/database/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: \"update cards set lore = 'm' where id = 1\" }) });\n",
  f_read_only_sql: "  await fetch('https://api.supabase.com/v1/projects/kgvdqqehefezbypozvrh/database/query/read-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'select 1' }) });\n",
  g_storage_delete: "  await fetch('https://kgvdqqehefezbypozvrh.supabase.co/storage/v1/object/card-art', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: ['cards/x.png'] }) });\n",
};
const tlog = (block, t) => appendFileSync('C:/Users/vaugh/lptcg-pipeline/items/S1-FACE/logs/test-times.txt', `${new Date().toISOString()} test-stage-faces ${block} ${((Date.now() - t) / 1000).toFixed(0)} s\n`);

// the order file (read only, on the copy)
let o = await sf(['order', '--set', 'S1', '--out', ORDER]);
show(o, /^ORDER/);
if (o.code !== 0) { console.log(o.out); process.exit(1); }
const ordRows = readFileSync(ORDER, 'utf8').split(/\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
const gold = GOLD || Number(ordRows.find((r) => r[2] === 'gold')[0]);
const rowOf = (id) => ordRows.find((r) => Number(r[0]) === id);
console.log(`   rows: still=${STILL} ${rowOf(STILL)?.slice(1, 3).join(' ')} anim=${ANIM} ${rowOf(ANIM)?.slice(1, 3).join(' ')} gold=${gold} ${rowOf(gold)?.slice(1, 3).join(' ')}`);

// ---------------------------------------------------------------- UNIT
if (want('UNIT')) {
  const P = 'https://kgvdqqehefezbypozvrh.supabase.co', L = 'http://127.0.0.1:20242';
  const yes = [['GET', `${P}/rest/v1/cards?select=*`], ['GET', `${P}/rest/v1/subjects?select=ability_v2`], ['GET', `${P}/rest/v1/statuses?select=*`],
    ['GET', `${P}/rest/v1/player_cards?select=card_id`], ['POST', `${P}/rest/v1/rpc/ability_v2_check`], ['POST', `${P}/rest/v1/rpc/card_element`],
    ['POST', `${P}/storage/v1/object/list/card-art`], ['GET', `${P}/storage/v1/object/public/card-art/cards/x.png`], ['HEAD', `${P}/storage/v1/object/public/card-art/grid/cards/x.webp`],
    ['GET', `${L}/rest/v1/cards?select=id`], ['GET', 'https://play.lionpridetcg.com/api/img/x']];
  const no = [['PATCH', `${P}/rest/v1/cards?id=eq.1`], ['POST', `${P}/storage/v1/object/card-art/cards/x.png`], ['POST', `${P}/rest/v1/rpc/admin_set_save`],
    ['GET', `${P}/rest/v1/players?select=id`], ['POST', 'https://api.supabase.com/v1/projects/kgvdqqehefezbypozvrh/database/query'],
    ['POST', 'https://api.supabase.com/v1/projects/kgvdqqehefezbypozvrh/database/query/read-only'], ['GET', 'https://api.supabase.com/v1/projects'],
    ['DELETE', `${P}/storage/v1/object/card-art`], ['GET', `${P}/rest/v1/cards`], ['GET', `${P}/storage/v1/object/card-art/x.png`],
    ['GET', `${P}/storage/v1/object/public/card-art/../x`], ['GET', `${P}/storage/v1/object/public/card-art/%2e%2e/x`], ['POST', 'https://play.lionpridetcg.com/api/x'],
    ['PUT', `${P}/storage/v1/object/card-art/x`], ['POST', `${P}/auth/v1/admin/users`]];
  const badYes = yes.filter(([m, u]) => !allowed(m, u, L)), badNo = no.filter(([m, u]) => allowed(m, u, L));
  const off = [['GET', `${P}/rest/v1/cards?select=*`], ['POST', `${P}/rest/v1/rpc/ability_v2_check`]].filter(([m, u]) => allowed(m, u, null, { offline: true }));
  res('UNIT allow-list', !badYes.length && !badNo.length && !off.length, `allowed=${yes.length - badYes.length}/${yes.length} blocked=${no.length - badNo.length}/${no.length} offline_blocked=${2 - off.length}/2 ${[...badYes, ...badNo, ...off].map((x) => x.join(' ')).join('; ')}`);
}

// ---------------------------------------------------------------- STATIC
if (want('STATIC')) {
  const full = readFileSync(join(ROOT, 'scripts', 'stage-faces.mjs'), 'utf8');
  const cut = (s) => s.split('// ================================================================ WRITE COMMANDS')[0];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/createHash\([^)]*\)\.update\(/g, 'HASH(');
  const BAD = [/\bpushCard\b/, /\bwriteTierRow\b/, /\.(update|upsert|insert|delete|remove)\s*\(/];
  const scan = (text) => BAD.filter((re) => re.test(strip(cut(text)))).map(String);
  const pushImports = [...strip(cut(full)).matchAll(/const \{([^}]*)\} = await import\('\.\.\/src\/push\.js'\)/g)].map((m) => m[1].trim());
  const hits = scan(full);
  const okImp = pushImports.length >= 1 && pushImports.every((x) => x === 'renderTier');
  console.log(hits.length || !okImp ? `STATIC FAIL ${hits.join(' ')} push.js imports=${pushImports.join('|')}` : 'STATIC PASS');
  res('STATIC', !hits.length && okImp);
  const m = scan(full.replace(AFTER_STAGED, AFTER_STAGED + "    await db.from('cards').update({ image_url: 'x' }).eq('id', id);\n"));
  mut('static_update', m.length > 0, `STATIC FAIL ${m.join(' ')}`);
}

// ---------------------------------------------------------------- TARGET
if (want('TARGET')) {
  let r = await sf(['stage', '--set', 'S1'], { preload: false, env: { LOCALDB: '' } });
  res('TARGET no --live, no preload', r.code === 1 && r.lines.includes('refused: the target is LIVE (use --live)'));
  r = await sf(['verify', '--set', 'S1', '--live'], { preload: false, env: { LOCALDB: '', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' } });
  res('TARGET another project ref', r.code === 1 && r.lines.includes('refused: not the TCG project'), r.lines.find((l) => l.startsWith('refused')) || '');
}

// ---------------------------------------------------------------- SETUP (L-b): the 3 rows' objects into the LOCAL bucket
const testIds = [STILL, ANIM, gold];
if (want('SETUP') || want('GUARD') || want('ORPHANS')) {
  const t = Date.now();
  const { supabase } = await import('../src/supabase.js');
  const { gridObject, revealObject } = await import('../src/thumbs.js');
  const rows = await sql(`select id, rarity, image_url from cards where id in (${testIds.join(',')})`);
  let n = 0, bad = 0;
  for (const r of rows) {
    const main = decodeURIComponent(r.image_url.replace(/^https?:\/\/[^/]+/, '').match(/\/object\/public\/card-art\/([^?]+)/)[1]);
    for (const name of [main, gridObject(main), ...(['secret_rare', 'full_art', 'gold', 'event', 'promo'].includes(r.rarity) ? [revealObject(main)] : [])]) {
      const tmp = `${ITEM}/setup-${name.replace(/\//g, '_')}`;
      const c = spawnSync('curl.exe', ['-s', '-f', '-o', tmp, `${LIVE_HOST}/storage/v1/object/public/card-art/${name}`]);
      if (c.status !== 0 || !existsSync(tmp)) { bad += 1; console.log(`   SETUP GET FAIL ${name}`); continue; }
      const buf = readFileSync(tmp);
      const { error } = await supabase.storage.from('card-art').upload(name, buf, { upsert: true, contentType: name.endsWith('.png') ? 'image/png' : 'image/webp' });
      if (error) { bad += 1; console.log(`   SETUP PUT FAIL ${name} ${error.message}`); } else n += 1;
    }
  }
  res('SETUP the 3 test rows in the local bucket (from live, public GET)', !bad && n >= 7, `objects=${n} bad=${bad}`);
  tlog('SETUP', t);
}

// ---------------------------------------------------------------- GUARD (the stub)
if (want('GUARD')) {
  const t = Date.now();
  const env = Object.fromEntries(readFileSync(LOCALENV, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const stub = await startStub({ upstream: env.SUPABASE_URL, meta: env.PGMETA_URL });
  const stubEnv = `${ITEM}/stub.env`;
  writeFileSync(stubEnv, `SUPABASE_URL=${stub.url}\nSUPABASE_SERVICE_ROLE_KEY=${env.SUPABASE_SERVICE_ROLE_KEY}\nPGMETA_URL=${stub.metaUrl}\n`);
  const origin = new URL(stub.url).origin;
  // every recorded request must be allowed (the meta requests are the Management SQL: never allowed)
  const forbidden = (from) => stub.log.slice(from).filter((q) => q.meta || !allowed(q.method, origin + q.path, origin));
  const runs = [
    ['order', ['order', '--set', 'S1', '--out', `${ITEM}/work/order-stub.txt`]],
    ['stage', stageArgs(man('guard-stage'), ['--only', String(STILL)])],
    ['verify', ['verify', '--set', 'S1', '--manifest', man('guard-stage'), '--order', ORDER, '--before', `${ITEM}/work/before-stub.json`]],
    ['storage', ['storage', '--set', 'S1', '--manifest', man('guard-stage'), '--order', ORDER]],
    ['backup', ['backup', '--set', 'S1', '--only', String(STILL), '--out', `${ITEM}/work/guard-backup/backup`]],
    ['face-export', ['face-export', '--set', 'S1', '--out', `${ITEM}/work/faces-stub.json`]],
  ];
  await sf(['before', '--set', 'S1', '--out', `${ITEM}/work/before-stub.json`], { envFile: stubEnv });
  for (const [name, args] of runs) {
    const from = stub.log.length;
    const r = await sf(args, { envFile: stubEnv });
    show(r, /^(ORDER|STAGED|FAIL|VERIFY|COUNTS|BYTES|STORAGE|WAIT storage|BACKUP|EXPORT|WRITE BLOCKED|ERROR|refused)/);
    const fb = forbidden(from);
    const okCode = name === 'storage' || name === 'verify' ? r.code === 0 || r.code === 1 : r.code === 0;
    res(`GUARD ${name} runs under the guard`, okCode && !r.lines.some((l) => l.startsWith('WRITE BLOCKED')) && !fb.length, `exit=${r.code} requests=${stub.log.length - from} forbidden=${fb.length} ${fb.slice(0, 3).map((q) => q.method + ' ' + q.path).join('; ')}`);
    if (name === 'order') {
      // N-1: player_cards of S1 > 1,000 rows, read in pages; the owner totals = SQL
      const [q] = await sql(`select count(*)::int n, count(distinct (pc.card_id, pc.player_id))::int owners, sum(pc.quantity)::int copies from player_cards pc join cards c on c.id = pc.card_id where c.set_id = 'S1'`);
      const f = readFileSync(`${ITEM}/work/order-stub.txt`, 'utf8').split(/\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
      const owners = f.reduce((t, x) => t + Number(x[4].split('=')[1]), 0), copies = f.reduce((t, x) => t + Number(x[5].split('=')[1]), 0);
      const pages = stub.log.slice(from).filter((x) => x.path.startsWith('/rest/v1/player_cards')).length;
      res('GUARD order N-1 (player_cards > 1,000 rows, paged)', q.n > 1000 && owners === q.owners && copies === q.copies, `sql rows=${q.n} owners=${q.owners} copies=${q.copies}; order owners=${owners} copies=${copies}; requests=${pages}`);
    }
  }
  // the mutations: each forbidden request, under the guard, from stage() before any row
  for (const [name, code] of Object.entries(MUTS)) {
    const from = stub.log.length;
    const r = await sf(stageArgs(man(`guard-${name}`), ['--only', String(STILL)]), { envFile: stubEnv, script: mutant(name, [[ANCHOR, code + ANCHOR]]) });
    const fb = forbidden(from);
    const bl = r.lines.find((l) => l.startsWith('WRITE BLOCKED')) || '-';
    mut(`guard_${name}`, r.code === 5 && bl !== '-' && !fb.length && !r.lines.some((l) => l.startsWith('ROW ')), `${bl}, exit ${r.code}, forbidden requests at the stub=${fb.length}`);
  }
  cleanMutants();
  await stub.close();
  tlog('GUARD', t);
}

// ---------------------------------------------------------------- NOWRITE (the copy)
if (want('NOWRITE') || want('FP') || want('STORAGE')) {
  const t = Date.now();
  const h0 = await H();
  const r = await sf(stageArgs(man('nowrite'), ['--only', testIds.join(',')]), { wait: true });
  show(r);
  const h1 = await H();
  const st = existsSync(man('nowrite')) ? readFileSync(man('nowrite'), 'utf8').trim().split(/\n/).map((l) => JSON.parse(l)).filter((l) => l.s === 'STAGED') : [];
  const filesOk = st.length === 3 && st.every((l) => Object.values(l.files).filter(Boolean).every((f) => existsSync(f.path) && sha(readFileSync(f.path)) === f.sha256));
  const db = h0.cards === h1.cards && h0.subjects === h1.subjects, stor = h0.storage === h1.storage;
  console.log(db && stor && r.code === 0 && filesOk ? 'NOWRITE PASS db storage' : `NOWRITE FAIL ${db ? '' : 'db '}${stor ? '' : 'storage '}exit=${r.code} staged=${st.length} files=${filesOk}`);
  res('NOWRITE (still + animated + gold: db and storage unchanged, 3 STAGED, files)', db && stor && r.code === 0 && filesOk);
  for (const l of st) console.log(`   ${l.card_id} ${l.key} ${l.rarity} sec=${l.sec} attempts=${l.attempts} bytes=${Object.values(l.files).filter(Boolean).reduce((a, f) => a + f.bytes, 0)} pages=${l.checks?.webp?.pages ?? '-'} textTwice=${l.checks?.textTwice?.equal ?? '-'}`);
  // the mutation: the guard removed + writeTierRow (on the still row)
  const [row] = await sql(`select image_url from cards where id = ${STILL}`);
  const mb = await sf(stageArgs(man('nowrite-mut'), ['--only', String(STILL)]), { script: mutant('nowrite', [[GUARD_ON, '  // guard removed (mutant)\n'], [GUARD_CLIENT, '  if (read) { /* guardClient removed (mutant); the "else" below keeps its meaning */ }\n'], [AFTER_STAGED, AFTER_STAGED + WRITE]]) });
  const hb = await H();
  if (hb.cards !== h0.cards) console.log('NOWRITE FAIL db');
  mut('nowrite_guard_removed_writeTierRow', hb.cards !== h0.cards, `cards hash ${hb.cards === h0.cards ? 'equal' : 'differs'}, exit ${mb.code}`);
  await sql(`update cards set image_url = '${row.image_url.replace(/'/g, "''")}' where id = ${STILL}`);
  res('NOWRITE copy restored', sameH(await H(), h0));
  cleanMutants();
  tlog('NOWRITE', t);
}

// ---------------------------------------------------------------- FP
if (want('FP')) {
  const t = Date.now();
  const M = man('nowrite');
  const fresh = (opts = {}) => sf(['fresh', '--set', 'S1', '--manifest', M], opts);
  let r = await fresh();
  res('FP baseline FRESH n=3', r.lines.includes('FRESH n=3 stale=0'), r.lines.filter((l) => /^(FRESH n|STALE)/.test(l)).join(' | '));
  r = await fresh({ script: mutant('fp', [['// ---------------------------------------------------------------- main', '// a change only in stage-faces.mjs\n// ---------------------------------------------------------------- main']]) });
  res('FP a change only in stage-faces.mjs = FRESH', r.lines.includes('FRESH n=3 stale=0'));
  cleanMutants();
  const fv = join(ROOT, 'src', 'face-v2.js'); const orig = readFileSync(fv);
  try { writeFileSync(fv, Buffer.concat([orig, Buffer.from(' ')])); r = await fresh(); } finally { writeFileSync(fv, orig); }
  res('FP one char in face-v2.js = STALE (all)', r.lines.includes('FRESH n=0 stale=3') && r.lines.filter((l) => l.startsWith('STALE ')).every((l) => /\bcode\b/.test(l)), r.lines.filter((l) => /^(FRESH n|STALE)/.test(l)).join(' | '));
  res('FP face-v2.js restored', sha(readFileSync(fv)) === sha(orig));
  const key = rowOf(STILL)[1];
  const [ab] = await sql(`select ability_v2::text a from subjects where key = '${key}'`);
  try {
    await sql(`update subjects set ability_v2 = jsonb_set(ability_v2, '{name}', to_jsonb((ability_v2->>'name') || ' X')) where key = '${key}'`);
    r = await fresh();
  } finally { await sql(`update subjects set ability_v2 = '${ab.a.replace(/'/g, "''")}'::jsonb where key = '${key}'`); }
  res(`FP ability_v2 of ${key} changed = STALE ${key}`, r.lines.some((l) => l.startsWith(`STALE ${key} `)) && r.lines.includes('FRESH n=2 stale=1'), r.lines.filter((l) => /^(FRESH n|STALE)/.test(l)).join(' | '));
  const [ab2] = await sql(`select ability_v2::text a from subjects where key = '${key}'`);
  res('FP ability_v2 restored', ab2.a === ab.a);
  const cf = `${ITEM}/cards-genre.json`;
  const cards = JSON.parse(readFileSync(join(ROOT, 'cards.json'), 'utf8'));
  cards.find((c) => c.id === key).genre = 'CHANGED GENRE';
  writeFileSync(cf, JSON.stringify(cards, null, 2));
  r = await fresh({ env: { CARDS_FILE: cf } });
  res(`FP genre of ${key} changed = STALE ${key}`, r.lines.some((l) => l.startsWith(`STALE ${key} `) && /card/.test(l)) && r.lines.includes('FRESH n=2 stale=1'), r.lines.filter((l) => /^(FRESH n|STALE)/.test(l)).join(' | '));
  tlog('FP', t);
}

// ---------------------------------------------------------------- CHECKS
if (want('CHECKS')) {
  const t = Date.now();
  const cases = [
    ['cut', STILL, { S1FACE_TEST_PLANT: 'cut' }, new RegExp(`^FAIL ${STILL} \\S+ \\S+ .*face clearRows`), null],
    ['white', STILL, { S1FACE_TEST_PLANT: 'white' }, new RegExp(`^FAIL ${STILL} \\S+ \\S+ .*face white`), null],
    ['twice-once', STILL, { S1FACE_TEST_PLANT: 'twice-once' }, new RegExp(`^STAGED ${STILL} `), new RegExp(`^RETRY ${STILL} twice-differ`)],
    ['twice-always', STILL, { S1FACE_TEST_PLANT: 'twice-always' }, new RegExp(`^FAIL ${STILL} \\S+ \\S+ twice-differ`), null],
    ['text-once', gold, { S1FACE_TEST_PLANT: 'text-once' }, new RegExp(`^STAGED ${gold} `), new RegExp(`^RETRY ${gold} textmask-differ`)],
    ['face-v1', STILL, { FACE_V2: '0' }, new RegExp(`^FAIL ${STILL} \\S+ \\S+ face v1`), null],
  ];
  for (const [name, id, env, wantRe, also] of cases) {
    const r = await sf(stageArgs(man(`chk-${name}`), ['--only', String(id)]), { env: { ...env, S1FACE_TEST_ID: String(id) }, wait: id !== STILL });
    show(r, /^(TEST|CHECK|RETRY|FAIL|STAGED|FACE)/);
    res(`CHECKS ${name}`, r.code === 0 && r.lines.some((l) => wantRe.test(l)) && (!also || r.lines.some((l) => also.test(l))), `exit=${r.code}`);
  }
  tlog('CHECKS', t);
}

// ---------------------------------------------------------------- STORAGE
if (want('STORAGE')) {
  const M = man('nowrite');
  let r = await sf(['storage', '--set', 'S1', '--manifest', M, '--order', ORDER, '--limit', '99999999999']);
  const end = Number((r.lines.find((l) => l.startsWith('STORAGE PASS')) || '').match(/end=(\d+)/)?.[1]);
  show(r, /^(STORAGE|refused|WAIT)/);
  r = await sf(['storage', '--set', 'S1', '--manifest', M, '--order', ORDER, '--limit', String(end - 1)]);
  res('STORAGE limit = end - 1 = refused + WAIT storage', r.code === 1 && r.lines.some((l) => l.startsWith('refused: projected end')) && r.lines.some((l) => l.startsWith('WAIT storage rows=')), r.lines.filter((l) => /^(refused|WAIT)/.test(l)).join(' | '));
  r = await sf(['storage', '--set', 'S1', '--manifest', M, '--order', ORDER, '--limit', String(end)]);
  res('STORAGE limit = end = PASS', r.code === 0 && r.lines.some((l) => l.startsWith(`STORAGE PASS now=`)));
  await sf(['before', '--set', 'S1', '--out', `${ITEM}/work/before-s1.json`, '--force']);
  r = await sf(['verify', '--set', 'S1', '--manifest', M, '--order', ORDER], { env: { S1FACE_S2_TERM: '900000000' } });
  const r0 = await sf(['verify', '--set', 'S1', '--manifest', M, '--order', ORDER], { env: { S1FACE_S2_TERM: '0', S1FACE_LIMIT: '99999999999' } });
  show(r, /^(VERIFY|BYTES|B11)/);
  res('STORAGE B11 NEEDED / NOT NEEDED', r.lines.some((l) => l.startsWith('B11 NEEDED')) && r0.lines.some((l) => l.startsWith('B11 NOT NEEDED')) && r.lines.some((l) => l.startsWith('VERIFY PASS live-unchanged')));
}

// ---------------------------------------------------------------- ORPHANS (the stub)
if (want('ORPHANS')) {
  const env = Object.fromEntries(readFileSync(LOCALENV, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const stub = await startStub({ upstream: env.SUPABASE_URL, meta: env.PGMETA_URL });
  const stubEnv = `${ITEM}/stub2.env`;
  writeFileSync(stubEnv, `SUPABASE_URL=${stub.url}\nSUPABASE_SERVICE_ROLE_KEY=${env.SUPABASE_SERVICE_ROLE_KEY}\nPGMETA_URL=${stub.metaUrl}\n`);
  const list17 = readFileSync(`${ITEM}/gate/orphans-17.txt`, 'utf8').split(/\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
  const orph = (extra = []) => sf(['orphans', '--set', 'S1', '--out', `${ITEM}/work/orphans-backup`, ...extra], { envFile: stubEnv });
  let r = await orph(['--dry']);
  res('ORPHANS the 17 (dry)', r.code === 0 && r.lines.includes('ORPHANS list n=17 bytes=19785107 target=LOCAL ' + stub.url) && !r.out.includes('card-back'), r.lines.find((l) => l.startsWith('ORPHANS list')) || '');
  const bad17 = `${ITEM}/gate/orphans-bad.txt`;
  writeFileSync(bad17, readFileSync(`${ITEM}/gate/orphans-17.txt`, 'utf8') + 'cards/card-back.png\t258366\n');
  r = await orph(['--dry', '--list', bad17]);
  mut('orphans_list_with_card_back', r.code === 1 && r.lines.some((l) => /^refused: .*holds cards\/card-back\.png/.test(l)), r.lines.find((l) => l.startsWith('refused')) || '-');
  stub.mode = { extra: [{ name: 'cards/zz-extra-normal.png', size: 10 }] };
  r = await orph(['--dry']);
  mut('orphans_one_extra', r.code === 1 && r.lines.some((l) => l === 'refused: list differs +cards/zz-extra-normal.png'), r.lines.find((l) => l.startsWith('refused')) || '-');
  stub.mode = { drop: [list17[0][0]] };
  r = await orph(['--dry']);
  mut('orphans_one_missing', r.code === 1 && r.lines.some((l) => l === `refused: list differs -${list17[0][0]}`), r.lines.find((l) => l.startsWith('refused')) || '-');
  stub.mode = { size: { [list17[1][0]]: 5 } };
  r = await orph(['--dry']);
  mut('orphans_one_size', r.code === 1 && r.lines.some((l) => l.startsWith('refused: size differs')), r.lines.find((l) => l.startsWith('refused')) || '-');
  // a real run against the stub: the backup (fake bytes), the delete of exactly the 17
  stub.mode = { fake: new Map(list17.map(([n, b]) => [n, Number(b)])) };
  const from = stub.log.length;
  r = await orph();
  show(r, /^(ORPHANS|refused|ERROR|STILL)/);
  const dels = stub.log.slice(from).filter((q) => q.method === 'DELETE').flatMap((q) => JSON.parse(q.body).prefixes);
  res('ORPHANS run (stub): deletes exactly the 17, never the card back, backup 17', r.code === 0 && r.lines.includes('ORPHANS PASS deleted=17 bytes=19785107 backup=17') && dels.length === 17 && !dels.includes('cards/card-back.png') && dels.every((d) => list17.some((x) => x[0] === d)),
    `deletes=${dels.length}`);
  await stub.close();
}

// ---------------------------------------------------------------- YIELD
if (want('YIELD')) {
  const t = Date.now();
  const m = man('yield');
  writeFileSync(`${ITEM}/work/PAUSE`, 'test');
  let r = await sf(stageArgs(m));
  res('YIELD PAUSE = exit 3, no row', r.code === 3 && r.lines.includes('PAUSE') && !r.lines.some((l) => l.startsWith('ROW ')), `exit=${r.code}`);
  // the mutation: the PAUSE check removed (on one still row only)
  const mp = await sf(stageArgs(man('yield-mut'), ['--only', String(STILL)]), { script: mutant('nopause2', [["      if (existsSync(PAUSE)) { console.log('PAUSE'); summary('PAUSE'); return 3; }\n", '']]) });
  mut('pause_check_removed', !(mp.code === 3 && !mp.lines.some((l) => l.startsWith('ROW '))), `exit ${mp.code}, rows=${mp.lines.filter((l) => l.startsWith('ROW ')).length}`);
  cleanMutants();
  rmSync(`${ITEM}/work/PAUSE`);
  r = await sf(['stage', '--set', 'S1', '--order', ORDER, '--manifest', m, '--until', '2020-01-01T00:00:00Z']);
  res('YIELD UNTIL = exit 4, no row', r.code === 4 && r.lines.includes('UNTIL reached') && !r.lines.some((l) => l.startsWith('ROW ')), `exit=${r.code}`);
  // resume: a 2-row order, the first row staged already
  const small = `${ITEM}/work/order-small.txt`;
  writeFileSync(small, ordRows.slice(0, 2).map((x) => x.join('\t')).join('\n') + '\n');
  writeFileSync(m, JSON.stringify({ s: 'STAGED', card_id: Number(ordRows[0][0]), key: ordRows[0][1], rarity: ordRows[0][2], files: {} }) + '\n');
  // a real foreign Blender (--background) for 45 s: the row waits, then goes on by itself
  const BL = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
  const fb = spawn(BL, ['--background', '--python-expr', 'import time; time.sleep(45)'], { stdio: 'ignore' });
  await new Promise((x) => setTimeout(x, 3000));
  const s1before = existsSync(S1LOG) ? readFileSync(S1LOG, 'utf8').split(/\n/).length : 0;
  r = await sf(['stage', '--set', 'S1', '--order', small, '--manifest', m, '--until', '2099-01-01T00:00:00Z'], { env: { S1FACE_WAIT_S: '5', S1FACE_WAITLOG_S: '15' }, wait: true });
  show(r, /^(START|RESUME|STAGED|SUMMARY)/);
  const s1 = readFileSync(S1LOG, 'utf8').split(/\n/).slice(Math.max(0, s1before - 1)).filter(Boolean);
  const waits = s1.filter((l) => new RegExp(` S1 WAIT foreign-blender pid=.*\\b${fb.pid}\\b`).test(l)).length;
  const rows = r.lines.filter((l) => l.startsWith('ROW ')).map((l) => Number(l.split(' ')[1]));
  res('YIELD resume skips a staged row', r.code === 0 && rows.length === 1 && rows[0] === Number(ordRows[1][0]) && r.lines.some((l) => /^START .* todo=1 staged=1/.test(l)), `rows=${rows.join(',')}`);
  res('YIELD foreign Blender: WAIT (repeated in the S1 log), RESUME, then the row', waits >= 2 && s1.some((l) => / S1 RESUME$/.test(l)) && r.lines.filter((l) => l.startsWith('WAIT foreign-blender')).length >= 4 && r.lines.some((l) => l.startsWith('STAGED ')),
    `s1log_waits=${waits} stage_waits=${r.lines.filter((l) => l.startsWith('WAIT foreign-blender')).length}`);
  try { fb.kill(); } catch { /* ended */ }
  tlog('YIELD', t);
}

// ---------------------------------------------------------------- RENDER-ONLY (SPEC 2.8), INGEST and KEYS
const RO = ['--import', './scripts/render-only-preload.mjs'];
// a render-only run: NO Supabase env, a .env path that does not exist, no localdb preload, the render-only preload
const roEnv = { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ACCESS_TOKEN: '', DOTENV_CONFIG_PATH: `${ITEM}/no-such.env`, LOCALDB: '' };
const ro = (args, opts = {}) => {
  // node --import render-only-preload.mjs scripts/stage-faces.mjs ... (sf adds no preload with preload:false; the script arg carries it)
  return new Promise((resolveP) => {
    const c = spawn(process.execPath, [...RO, opts.script || 'scripts/stage-faces.mjs', ...args], { cwd: ROOT, env: { ...process.env, S1FACE_ITEM: ITEM, S1FACE_LOG: S1LOG, S1FACE_TEST_NOWAIT: opts.wait ? '' : '1', ...roEnv, ...(opts.env || {}) } });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolveP({ code, out, lines: out.split(/\r?\n/) }));
  });
};
const FX = `${ITEM}/work/face-export.json`, CARDSL = `${ITEM}/work/cards.local.json`;
if (want('RENDERONLY') || want('INGEST') || want('KEYS')) {
  const r = await sf(['face-export', '--set', 'S1', '--out', FX]);
  show(r, /^FACE-EXPORT/);
  res('RENDER-ONLY face-export (130 S1 cards)', r.code === 0 && /^FACE-EXPORT PASS cards=130 /.test(r.lines.find((l) => l.startsWith('FACE-EXPORT')) || ''));
  writeFileSync(CARDSL, JSON.stringify(JSON.parse(readFileSync(join(ROOT, 'cards.json'), 'utf8')).filter((c) => c.set === 'S1'), null, 2));
}
const roArgs = (m, extra = []) => [...stageArgs(m, extra), '--render-only', '--cards', CARDSL, '--face-export', FX];
if (want('RENDERONLY') || want('INGEST')) {
  const t = Date.now();
  const om = man('remote');
  let r = await ro(roArgs(om, ['--only', `${STILL},${ANIM}`]), { wait: true });
  show(r, /^(START|RENDER-ONLY|FACE-EXPORT|STAGED|FAIL|ERROR|WRITE|NET|TOOLS)/);
  res('RENDER-ONLY 1 still + 1 animated with no env, no .env, the preload', r.code === 0 && r.lines.some((l) => l.startsWith('RENDER-ONLY src/supabase.js=stub')) && r.lines.some((l) => l.startsWith(`STAGED ${STILL} `)) && r.lines.some((l) => l.startsWith(`STAGED ${ANIM} `)), `exit=${r.code}`);
  r = await ro([...roArgs(man('ro-x'), ['--only', String(STILL)]), '--live']);
  res('RENDER-ONLY with --live = refused (P-5)', r.code === 1 && r.lines.includes('refused: --render-only with --live or the localdb preload'));
  r = await sf(roArgs(man('ro-y'), ['--only', String(STILL)]), { preload: false, env: roEnv });
  res('RENDER-ONLY without the preload = refused', r.code === 1 && r.lines.includes('refused: --render-only needs --import ./scripts/render-only-preload.mjs'));
  // the preload blocks the network, and the stub throws on any use of the client (mutations: a copy that uses them)
  r = await ro(roArgs(man('ro-net'), ['--only', String(STILL)]), { script: mutant('ro_net', [[ANCHOR, "  await fetch('https://example.com/x');\n" + ANCHOR]]) });
  mut('render_only_net', r.code !== 0 && r.lines.some((l) => l.startsWith('NET BLOCKED example.com/x')), r.lines.find((l) => /NET BLOCKED|ERROR/.test(l)) || '-');
  r = await ro(roArgs(man('ro-db'), ['--only', String(STILL)]), { script: mutant('ro_db', [[ANCHOR, "  { const { supabase } = await import('../src/supabase.js'); await supabase.from('cards'); }\n" + ANCHOR]]) });
  mut('render_only_db', r.code !== 0 && r.lines.some((l) => /RENDER-ONLY: no database \(from\)/.test(l)), r.lines.find((l) => /RENDER-ONLY: no database|ERROR/.test(l)) || '-');
  cleanMutants();
  tlog('RENDERONLY', t);
}
if (want('INGEST')) {
  const t = Date.now();
  // the remote machine's folder as the workstation receives it (scp): <dir>/staged.jsonl + <dir>/stage/
  const om = man('remote');
  const remote = `${ITEM}/work/stage-remote`;
  const pack = (srcMan, dir, edit = (l) => l) => {
    rmSync(dir, { recursive: true, force: true }); mkdirSync(`${dir}/stage`, { recursive: true });
    const lines = readFileSync(srcMan, 'utf8').trim().split(/\n/).map((l) => JSON.parse(l)).filter((l) => l.s === 'STAGED');
    for (const l of lines) for (const f of Object.values(l.files).filter(Boolean)) copyFileSync(f.path, `${dir}/stage/${f.path.split('/').pop()}`);
    writeFileSync(`${dir}/staged.jsonl`, lines.map((l) => JSON.stringify(edit({ ...l, tools: { ...l.tools } }))).join('\n') + '\n');
    return lines;
  };
  const lines = pack(om, remote);
  const toolsRef = `${ITEM}/work/tools-s2n.json`;
  let r = await sf(['tools', '--set', 'S1', '--save', toolsRef], { preload: false });
  const ours = man('ours');
  r = await sf(['ingest', '--set', 'S1', '--from', remote, '--manifest', ours, '--tools-ref', toolsRef]);
  show(r, /^(INGEST|INGESTED|CALIB|refused)/);
  const got = existsSync(ours) ? readFileSync(ours, 'utf8').trim().split(/\n/).map((l) => JSON.parse(l)) : [];
  res('INGEST 2 rows = INGEST PASS n=2, old = the row image_url', r.code === 0 && r.lines.some((l) => /^INGEST PASS n=2 /.test(l)) && got.length === 2 && got.every((l) => /\/card-art\/cards\//.test(l.old || '')));
  // calibration (r5 L-3): the same rows staged here too -> CALIB lines, not ingested again
  const here = man('here'); writeFileSync(here, readFileSync(man('nowrite'), 'utf8'));
  r = await sf(['ingest', '--set', 'S1', '--from', remote, '--manifest', here, '--tools-ref', toolsRef]);
  show(r, /^(CALIB|INGEST)/);
  res('INGEST calibration rows: CALIB still + animated, nothing ingested', r.lines.some((l) => new RegExp(`^CALIB ${STILL} .* still (pixel-equal|differs)`).test(l)) && r.lines.some((l) => new RegExp(`^CALIB ${ANIM} .* animated last-frame`).test(l)) && r.lines.some((l) => /^INGEST PASS n=0 calib=2/.test(l)));
  const ing = async (name, edit, fileEdit = null) => {
    const dir = `${ITEM}/work/remote-${name}`; pack(om, dir, edit);
    if (fileEdit) fileEdit(dir);
    return sf(['ingest', '--set', 'S1', '--from', dir, '--manifest', man(`ours-${name}`), '--tools-ref', toolsRef]);
  };
  const failOf = (x, re) => x.code === 1 && x.lines.some((l) => new RegExp(`^INGEST FAIL ${STILL} .*${re}`).test(l));
  const firstFail = (x) => x.lines.find((l) => l.startsWith('INGEST FAIL') || l.startsWith('refused')) || '-';
  const mainOf = (dir) => `${dir}/stage/${lines.find((l) => l.card_id === STILL).files.main.path.split('/').pop()}`;
  r = await ing('byte', (l) => l, (dir) => { const f = mainOf(dir); const b = readFileSync(f); b[b.length - 10] ^= 1; writeFileSync(f, b); });
  mut('ingest_one_byte', failOf(r, 'main sha'), firstFail(r));
  r = await ing('fp', (l) => (l.card_id === STILL ? { ...l, fp: 'x' + l.fp.slice(1) } : l));
  mut('ingest_other_fp', failOf(r, 'fp'), firstFail(r));
  r = await ing('tools', (l) => { l.tools.edge = '1.2.3.4'; l.toolsSha = 'other'; return l; });
  mut('ingest_other_tools_edge', failOf(r, 'tools \\(edge\\)'), firstFail(r));
  r = await ing('font', (l) => { const k = Object.keys(l.tools.fonts)[0]; l.tools.fonts = { ...l.tools.fonts, [k]: '0'.repeat(64) }; l.toolsSha = 'other'; return l; });
  mut('ingest_other_font', failOf(r, 'tools \\(fonts\\)'), firstFail(r));
  r = await ing('commit', (l) => { l.commit = '0'.repeat(40); return l; });
  mut('ingest_other_commit', failOf(r, 'commit 00000000'), firstFail(r));
  r = await ing('code', (l) => { l.stageSha = 'x'; return l; });
  mut('ingest_other_stage_faces', failOf(r, 'code'), firstFail(r));
  // the UI-68 cut PNG as a returned face (sha in the manifest made to match: only the content check can see it)
  r = await ing('cut', (l) => l, (dir) => {
    const f = mainOf(dir); const cutB = readFileSync(`${ITEM}/gate/fixtures/cut-ottozone-s-head-full_art.png`); writeFileSync(f, cutB);
    const ls = readFileSync(`${dir}/staged.jsonl`, 'utf8').trim().split(/\n/).map((x) => JSON.parse(x));
    for (const l of ls) if (l.card_id === STILL) l.files.main = { ...l.files.main, sha256: sha(cutB), bytes: cutB.length };
    writeFileSync(`${dir}/staged.jsonl`, ls.map((x) => JSON.stringify(x)).join('\n') + '\n');
  });
  mut('ingest_cut_png', failOf(r, 'check clearRows'), firstFail(r));
  // r5 L-2: the workstation tools changed after S2n
  const ref2 = `${ITEM}/work/tools-s2n-old.json`;
  const rec = JSON.parse(readFileSync(toolsRef, 'utf8')); rec.toolsSha = 'old'; rec.tools = { ...rec.tools, pillow: '0.0.1' }; writeFileSync(ref2, JSON.stringify(rec));
  r = await sf(['ingest', '--set', 'S1', '--from', remote, '--manifest', man('ours-ref'), '--tools-ref', ref2]);
  mut('ingest_workstation_tools_changed', r.code === 1 && r.lines.some((l) => /^refused: the tools of this machine changed after S2n \(pillow\)/.test(l)), r.lines.find((l) => l.startsWith('refused')) || '-');
  // P-3: the code hashes are line-ending neutral (a CRLF and an LF copy of a code file give one fp-code)
  const fv = join(ROOT, 'src', 'rarity.js'); const orig = readFileSync(fv);
  const h = async () => ((await sf(['tools', '--set', 'S1'], { preload: false })).lines.find((l) => l.startsWith('TOOLS ')) || '').match(/ fp-code=(\S+)/)?.[1];
  let hCrlf, hLf;
  try {
    writeFileSync(fv, orig.toString('utf8').replace(/\r?\n/g, '\r\n')); hCrlf = await h();
    writeFileSync(fv, orig.toString('utf8').replace(/\r\n/g, '\n')); hLf = await h();
  } finally { writeFileSync(fv, orig); }
  res('INGEST fp-code is CRLF/LF neutral (P-3)', hCrlf && hCrlf === hLf && sha(readFileSync(fv)) === sha(orig), `crlf=${hCrlf?.slice(0, 12)} lf=${hLf?.slice(0, 12)}`);
  tlog('INGEST', t);
}
if (want('KEYS')) {
  const ka = `${ITEM}/work/keys-ws.txt`, kb = `${ITEM}/work/keys-no.txt`, kc = `${ITEM}/work/calib.txt`;
  let r = await sf(['keys', '--set', 'S1', '--order', ORDER, '--out', `${ka},${kb}`, '--calib', kc], { preload: false });
  show(r, /^(KEYS|CALIB)/);
  res('KEYS ws/no (index mod 2) = KEYS PASS ws=+no=352, overlap 0', r.code === 0 && r.lines.some((l) => /^KEYS PASS ws=\d+ no=\d+ total=352 overlap=0$/.test(l)));
  r = await sf(['keys-check', '--set', 'S1', '--order', ORDER, '--keys', `${ka},${kb}`], { preload: false });
  res('KEYS keys-check', r.code === 0 && r.lines.some((l) => /^KEYS PASS ws=\d+ no=\d+ total=352 overlap=0$/.test(l)));
  const a = readFileSync(ka, 'utf8'), b = readFileSync(kb, 'utf8');
  const lastA = a.trim().split(/\n/).pop();
  writeFileSync(kb, b + lastA + '\n');
  r = await sf(['keys-check', '--set', 'S1', '--order', ORDER, '--keys', `${ka},${kb}`], { preload: false });
  mut('keys_overlap', r.code === 1 && r.lines.some((l) => /^KEYS FAIL .* overlap=[1-9]/.test(l)), r.lines.find((l) => l.startsWith('KEYS')) || '-');
  writeFileSync(kb, b.trim().split(/\n/).slice(0, -1).join('\n') + '\n');
  r = await sf(['keys-check', '--set', 'S1', '--order', ORDER, '--keys', `${ka},${kb}`], { preload: false });
  mut('keys_missing', r.code === 1 && r.lines.some((l) => /^KEYS FAIL .*total=\d+ .* in no list/.test(l)), r.lines.find((l) => l.startsWith('KEYS')) || '-');
  writeFileSync(kb, b);
  // L-3: the calibration list is 2 rows, separate from keys-no
  const cal = readFileSync(kc, 'utf8').split(/\n/).filter((l) => l && !l.startsWith('#'));
  res('KEYS calib.txt = 1 still + 1 animated row of ws, not in no', cal.length === 2 && cal.every((l) => l.split(' ').length === 2) && !b.split(/\n/).some((k) => cal.some((c) => c.startsWith(k + ' '))), cal.join(' | '));
  // the stage runs with --keys: their rows are disjoint and sum to the order; calib.txt selects exactly 2 rows
  writeFileSync(`${ITEM}/work/PAUSE`, 'keys test');
  const rowsOfK = async (kf) => Number(((await ro(roArgs(man(`keys-${kf.split('/').pop()}`), ['--keys', kf]))).lines.find((l) => l.startsWith('SHARD')) || '').match(/rows=(\d+)/)?.[1]);
  const na = await rowsOfK(ka), nb = await rowsOfK(kb), nc = await rowsOfK(kc);
  rmSync(`${ITEM}/work/PAUSE`);
  res('KEYS stage --keys rows: ws + no = 352, calib = 2', na + nb === 352 && nc === 2, `${na} + ${nb}, calib ${nc}`);
}

console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} failed=${failed} item=${ITEM} time=${((Date.now() - T0) / 60000).toFixed(1)} min`);
appendFileSync('C:/Users/vaugh/lptcg-pipeline/items/S1-FACE/logs/test-times.txt', `${new Date().toISOString()} test-stage-faces ALL(${ONLY ? ONLY.join(',') : 'all'}) ${((Date.now() - T0) / 1000).toFixed(0)} s result=${failed ? 'FAIL' : 'PASS'}\n`);
process.exitCode = failed ? 1 : 0;
