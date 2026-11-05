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
 *            order (N-1: player_cards > 1,000 rows, paged, owner totals = SQL), stage --only <still>, verify, storage, backup, export-faces under
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
 *   OFFLINE  render-only: export-faces (copy), then stage --offline --faces with NO Supabase env and a missing .env: STAGED, "OFFLINE
 *            src/supabase.js=stub"; --shard 1/2 and 2/2 are disjoint and cover the order; import of the offline manifest on the copy = IMPORTED;
 *            a file with one byte changed = IMPORT REFUSED sha; a changed faces file (fp) = IMPORT REFUSED fp.
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
function sf(args, { env = {}, script = 'scripts/stage-faces.mjs', envFile = LOCALENV, preload = true, timeoutMin = 40 } = {}) {
  const r = spawnSync(process.execPath, [...(preload ? ['--import', './scripts/localdb-preload.mjs'] : []), script, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: timeoutMin * 60000,
    env: { ...process.env, LOCALDB_ENV: envFile, LOCALDB_QUIET: '1', S1FACE_ITEM: ITEM, S1FACE_LOG: S1LOG, ...env },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, out, lines: out.split(/\r?\n/) };
}
const man = (name) => `${ITEM}/work/${name}.jsonl`;
const stageArgs = (m, extra = []) => ['stage', '--set', 'S1', '--order', ORDER, '--manifest', m, '--until', '2099-01-01T00:00:00Z', ...extra];
const show = (r, re = /^(START|ROW|FACE|CHECK|RETRY|FAIL|STAGED|PAUSE|UNTIL|SUMMARY|WRITE BLOCKED|ERROR|TEST|refused|OFFLINE|SHARD|IMPORT|EXPORT|ORPHANS|STORAGE|VERIFY|BYTES|B11|ORDER|BACKUP|FRESH|STALE)/) =>
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
let o = sf(['order', '--set', 'S1', '--out', ORDER]);
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
  let r = sf(['stage', '--set', 'S1'], { preload: false, env: { LOCALDB: '' } });
  res('TARGET no --live, no preload', r.code === 1 && r.lines.includes('refused: the target is LIVE (use --live)'));
  r = sf(['verify', '--set', 'S1', '--live'], { preload: false, env: { LOCALDB: '', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' } });
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
    ['export-faces', ['export-faces', '--set', 'S1', '--out', `${ITEM}/work/faces-stub.json`]],
  ];
  sf(['before', '--set', 'S1', '--out', `${ITEM}/work/before-stub.json`], { envFile: stubEnv });
  for (const [name, args] of runs) {
    const from = stub.log.length;
    const r = sf(args, { envFile: stubEnv });
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
    const r = sf(stageArgs(man(`guard-${name}`), ['--only', String(STILL)]), { envFile: stubEnv, script: mutant(name, [[ANCHOR, code + ANCHOR]]) });
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
  const r = sf(stageArgs(man('nowrite'), ['--only', testIds.join(',')]));
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
  const mb = sf(stageArgs(man('nowrite-mut'), ['--only', String(STILL)]), { script: mutant('nowrite', [[GUARD_ON, '  // guard removed (mutant)\n'], [GUARD_CLIENT, ''], [AFTER_STAGED, AFTER_STAGED + WRITE]]) });
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
  let r = fresh();
  res('FP baseline FRESH n=3', r.lines.includes('FRESH n=3 stale=0'), r.lines.filter((l) => /^(FRESH n|STALE)/.test(l)).join(' | '));
  r = fresh({ script: mutant('fp', [['// ---------------------------------------------------------------- main', '// a change only in stage-faces.mjs\n// ---------------------------------------------------------------- main']]) });
  res('FP a change only in stage-faces.mjs = FRESH', r.lines.includes('FRESH n=3 stale=0'));
  cleanMutants();
  const fv = join(ROOT, 'src', 'face-v2.js'); const orig = readFileSync(fv);
  try { writeFileSync(fv, Buffer.concat([orig, Buffer.from(' ')])); r = fresh(); } finally { writeFileSync(fv, orig); }
  res('FP one char in face-v2.js = STALE (all)', r.lines.includes('FRESH n=0 stale=3') && r.lines.filter((l) => l.startsWith('STALE ')).every((l) => /\bcode\b/.test(l)), r.lines.filter((l) => /^(FRESH n|STALE)/.test(l)).join(' | '));
  res('FP face-v2.js restored', sha(readFileSync(fv)) === sha(orig));
  const key = rowOf(STILL)[1];
  const [ab] = await sql(`select ability_v2::text a from subjects where key = '${key}'`);
  try {
    await sql(`update subjects set ability_v2 = jsonb_set(ability_v2, '{name}', to_jsonb((ability_v2->>'name') || ' X')) where key = '${key}'`);
    r = fresh();
  } finally { await sql(`update subjects set ability_v2 = '${ab.a.replace(/'/g, "''")}'::jsonb where key = '${key}'`); }
  res(`FP ability_v2 of ${key} changed = STALE ${key}`, r.lines.some((l) => l.startsWith(`STALE ${key} `)) && r.lines.includes('FRESH n=2 stale=1'), r.lines.filter((l) => /^(FRESH n|STALE)/.test(l)).join(' | '));
  const [ab2] = await sql(`select ability_v2::text a from subjects where key = '${key}'`);
  res('FP ability_v2 restored', ab2.a === ab.a);
  const cf = `${ITEM}/cards-genre.json`;
  const cards = JSON.parse(readFileSync(join(ROOT, 'cards.json'), 'utf8'));
  cards.find((c) => c.id === key).genre = 'CHANGED GENRE';
  writeFileSync(cf, JSON.stringify(cards, null, 2));
  r = fresh({ env: { CARDS_FILE: cf } });
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
    const r = sf(stageArgs(man(`chk-${name}`), ['--only', String(id)]), { env: { ...env, S1FACE_TEST_ID: String(id) } });
    show(r, /^(TEST|CHECK|RETRY|FAIL|STAGED|FACE)/);
    res(`CHECKS ${name}`, r.code === 0 && r.lines.some((l) => wantRe.test(l)) && (!also || r.lines.some((l) => also.test(l))), `exit=${r.code}`);
  }
  tlog('CHECKS', t);
}

// ---------------------------------------------------------------- STORAGE
if (want('STORAGE')) {
  const M = man('nowrite');
  let r = sf(['storage', '--set', 'S1', '--manifest', M, '--order', ORDER, '--limit', '99999999999']);
  const end = Number((r.lines.find((l) => l.startsWith('STORAGE PASS')) || '').match(/end=(\d+)/)?.[1]);
  show(r, /^(STORAGE|refused|WAIT)/);
  r = sf(['storage', '--set', 'S1', '--manifest', M, '--order', ORDER, '--limit', String(end - 1)]);
  res('STORAGE limit = end - 1 = refused + WAIT storage', r.code === 1 && r.lines.some((l) => l.startsWith('refused: projected end')) && r.lines.some((l) => l.startsWith('WAIT storage rows=')), r.lines.filter((l) => /^(refused|WAIT)/.test(l)).join(' | '));
  r = sf(['storage', '--set', 'S1', '--manifest', M, '--order', ORDER, '--limit', String(end)]);
  res('STORAGE limit = end = PASS', r.code === 0 && r.lines.some((l) => l.startsWith(`STORAGE PASS now=`)));
  sf(['before', '--set', 'S1', '--out', `${ITEM}/work/before-s1.json`, '--force']);
  r = sf(['verify', '--set', 'S1', '--manifest', M, '--order', ORDER], { env: { S1FACE_S2_TERM: '900000000' } });
  const r0 = sf(['verify', '--set', 'S1', '--manifest', M, '--order', ORDER], { env: { S1FACE_S2_TERM: '0', S1FACE_LIMIT: '99999999999' } });
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
  let r = orph(['--dry']);
  res('ORPHANS the 17 (dry)', r.code === 0 && r.lines.includes('ORPHANS list n=17 bytes=19785107 target=LOCAL ' + stub.url) && !r.out.includes('card-back'), r.lines.find((l) => l.startsWith('ORPHANS list')) || '');
  const bad17 = `${ITEM}/gate/orphans-bad.txt`;
  writeFileSync(bad17, readFileSync(`${ITEM}/gate/orphans-17.txt`, 'utf8') + 'cards/card-back.png\t258366\n');
  r = orph(['--dry', '--list', bad17]);
  mut('orphans_list_with_card_back', r.code === 1 && r.lines.some((l) => /^refused: .*holds cards\/card-back\.png/.test(l)), r.lines.find((l) => l.startsWith('refused')) || '-');
  stub.mode = { extra: [{ name: 'cards/zz-extra-normal.png', size: 10 }] };
  r = orph(['--dry']);
  mut('orphans_one_extra', r.code === 1 && r.lines.some((l) => l === 'refused: list differs +cards/zz-extra-normal.png'), r.lines.find((l) => l.startsWith('refused')) || '-');
  stub.mode = { drop: [list17[0][0]] };
  r = orph(['--dry']);
  mut('orphans_one_missing', r.code === 1 && r.lines.some((l) => l === `refused: list differs -${list17[0][0]}`), r.lines.find((l) => l.startsWith('refused')) || '-');
  stub.mode = { size: { [list17[1][0]]: 5 } };
  r = orph(['--dry']);
  mut('orphans_one_size', r.code === 1 && r.lines.some((l) => l.startsWith('refused: size differs')), r.lines.find((l) => l.startsWith('refused')) || '-');
  // a real run against the stub: the backup (fake bytes), the delete of exactly the 17
  stub.mode = { fake: new Map(list17.map(([n, b]) => [n, Number(b)])) };
  const from = stub.log.length;
  r = orph();
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
  let r = sf(stageArgs(m));
  res('YIELD PAUSE = exit 3, no row', r.code === 3 && r.lines.includes('PAUSE') && !r.lines.some((l) => l.startsWith('ROW ')), `exit=${r.code}`);
  // the mutation: the PAUSE check removed (on one still row only)
  const mp = sf(stageArgs(man('yield-mut'), ['--only', String(STILL)]), { script: mutant('nopause2', [["      if (existsSync(PAUSE)) { console.log('PAUSE'); summary('PAUSE'); return 3; }\n", '']]) });
  mut('pause_check_removed', !(mp.code === 3 && !mp.lines.some((l) => l.startsWith('ROW '))), `exit ${mp.code}, rows=${mp.lines.filter((l) => l.startsWith('ROW ')).length}`);
  cleanMutants();
  rmSync(`${ITEM}/work/PAUSE`);
  r = sf(['stage', '--set', 'S1', '--order', ORDER, '--manifest', m, '--until', '2020-01-01T00:00:00Z']);
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
  r = sf(['stage', '--set', 'S1', '--order', small, '--manifest', m, '--until', '2099-01-01T00:00:00Z'], { env: { S1FACE_WAIT_S: '5', S1FACE_WAITLOG_S: '15' } });
  show(r, /^(START|RESUME|STAGED|SUMMARY)/);
  const s1 = readFileSync(S1LOG, 'utf8').split(/\n/).slice(s1before - 1).filter(Boolean);
  const waits = s1.filter((l) => new RegExp(` S1 WAIT foreign-blender pid=.*\\b${fb.pid}\\b`).test(l)).length;
  const rows = r.lines.filter((l) => l.startsWith('ROW ')).map((l) => Number(l.split(' ')[1]));
  res('YIELD resume skips a staged row', r.code === 0 && rows.length === 1 && rows[0] === Number(ordRows[1][0]) && r.lines.some((l) => /^START .* todo=1 staged=1/.test(l)), `rows=${rows.join(',')}`);
  res('YIELD foreign Blender: WAIT (repeated in the S1 log), RESUME, then the row', waits >= 2 && s1.some((l) => / S1 RESUME$/.test(l)) && r.lines.filter((l) => l.startsWith('WAIT foreign-blender')).length >= 4 && r.lines.some((l) => l.startsWith('STAGED ')),
    `s1log_waits=${waits} stage_waits=${r.lines.filter((l) => l.startsWith('WAIT foreign-blender')).length}`);
  try { fb.kill(); } catch { /* ended */ }
  tlog('YIELD', t);
}

// ---------------------------------------------------------------- OFFLINE (render-only machine)
if (want('OFFLINE')) {
  const t = Date.now();
  const faces = `${ITEM}/work/faces-s1.json`;
  let r = sf(['export-faces', '--set', 'S1', '--out', faces]);
  show(r, /^EXPORT/);
  res('OFFLINE export-faces', r.code === 0 && /^EXPORT-FACES PASS cards=130 /.test(r.lines.find((l) => l.startsWith('EXPORT')) || ''));
  // render-only: no Supabase env, a .env path that does not exist, no preload
  const off = { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ACCESS_TOKEN: '', DOTENV_CONFIG_PATH: `${ITEM}/no-such.env`, LOCALDB: '' };
  const om = man('offline');
  r = sf([...stageArgs(om, ['--only', String(STILL)]), '--offline', '--faces', faces], { preload: false, env: off });
  show(r, /^(START|OFFLINE|FACES|STAGED|FAIL|ERROR|WRITE)/);
  res('OFFLINE stage with no Supabase env and no .env', r.code === 0 && r.lines.includes('OFFLINE src/supabase.js=stub (no .env, no client)') && r.lines.some((l) => l.startsWith(`STAGED ${STILL} `)), `exit=${r.code}`);
  r = sf([...stageArgs(man('offline-x'), ['--only', String(STILL)]), '--offline', '--faces', faces, '--live'], { preload: false, env: off });
  res('OFFLINE with --live = refused', r.code === 1 && r.lines.includes('refused: --offline with --live or the localdb preload'));
  // shards: disjoint, together the whole order (the START/SHARD lines; PAUSE so no row renders)
  writeFileSync(`${ITEM}/work/PAUSE`, 'shard test');
  const keysOf = (i) => { const x = sf([...stageArgs(man(`shard${i}`), ['--shard', `${i}/2`]), '--offline', '--faces', faces], { preload: false, env: off }); return Number((x.lines.find((l) => l.startsWith('SHARD')) || '').match(/rows=(\d+)/)?.[1]); };
  const n1 = keysOf(1), n2 = keysOf(2);
  rmSync(`${ITEM}/work/PAUSE`);
  // the exact sets, computed like stage does
  const keyOrder = [...new Set(ordRows.map((x) => x[1]))];
  const k1 = new Set(keyOrder.filter((k, i) => i % 2 === 0)), k2 = new Set(keyOrder.filter((k, i) => i % 2 === 1));
  res('OFFLINE --shard 1/2 + 2/2 disjoint and complete', n1 + n2 === ordRows.length && [...k1].every((k) => !k2.has(k)), `rows ${n1} + ${n2} = ${ordRows.length}`);
  // import on the copy (the workstation side): files in a folder as scp brings them
  const drop = `${ITEM}/work/from-office`;
  mkdirSync(drop, { recursive: true });
  const line = readFileSync(om, 'utf8').trim().split(/\n/).map((l) => JSON.parse(l)).filter((l) => l.s === 'STAGED').pop();
  for (const f of Object.values(line.files).filter(Boolean)) copyFileSync(f.path, `${drop}/${f.path.split('/').pop()}`);
  const ours = man('ours');
  r = sf(['import', '--set', 'S1', '--from', om, '--files', drop, '--manifest', ours]);
  show(r, /^IMPORT/);
  const imp = existsSync(ours) ? JSON.parse(readFileSync(ours, 'utf8').trim().split(/\n/).pop()) : {};
  res('OFFLINE import = IMPORTED, old = the row image_url', r.code === 0 && r.lines.some((l) => l.startsWith(`IMPORTED ${STILL} `)) && /\/card-art\/cards\//.test(imp.old || ''));
  // mutation 1: one byte of the main file changed
  const ours2 = man('ours2');
  const mainF = `${drop}/${line.files.main.path.split('/').pop()}`; const keep = readFileSync(mainF);
  const b = Buffer.from(keep); b[b.length - 10] ^= 1; writeFileSync(mainF, b);
  r = sf(['import', '--set', 'S1', '--from', om, '--files', drop, '--manifest', ours2]);
  writeFileSync(mainF, keep);
  mut('import_one_byte', r.code === 1 && r.lines.some((l) => new RegExp(`^IMPORT REFUSED ${STILL} .*main sha`).test(l)), r.lines.find((l) => l.startsWith('IMPORT REFUSED')) || '-');
  // mutation 2: the other machine rendered from a different faces file (fp)
  const fx = JSON.parse(readFileSync(faces, 'utf8')); const k = line.key;
  fx.faces[k] = { ...fx.faces[k], active: { ...fx.faces[k].active, text: fx.faces[k].active.text + ' changed' } };
  const faces2 = `${ITEM}/work/faces-changed.json`; writeFileSync(faces2, JSON.stringify(fx));
  const om2 = man('offline-2');
  sf([...stageArgs(om2, ['--only', String(STILL)]), '--offline', '--faces', faces2], { preload: false, env: off });
  const line2 = readFileSync(om2, 'utf8').trim().split(/\n/).map((l) => JSON.parse(l)).filter((l) => l.s === 'STAGED').pop();
  const drop2 = `${ITEM}/work/from-office-2`; mkdirSync(drop2, { recursive: true });
  for (const f of Object.values(line2.files).filter(Boolean)) copyFileSync(f.path, `${drop2}/${f.path.split('/').pop()}`);
  r = sf(['import', '--set', 'S1', '--from', om2, '--files', drop2, '--manifest', man('ours3')]);
  mut('import_other_faces_fp', r.code === 1 && r.lines.some((l) => new RegExp(`^IMPORT REFUSED ${STILL} .*fp \\(face\\)`).test(l)), r.lines.find((l) => l.startsWith('IMPORT REFUSED')) || '-');
  tlog('OFFLINE', t);
}

console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} failed=${failed} item=${ITEM} time=${((Date.now() - T0) / 60000).toFixed(1)} min`);
appendFileSync('C:/Users/vaugh/lptcg-pipeline/items/S1-FACE/logs/test-times.txt', `${new Date().toISOString()} test-stage-faces ALL(${ONLY ? ONLY.join(',') : 'all'}) ${((Date.now() - T0) / 1000).toFixed(0)} s result=${failed ? 'FAIL' : 'PASS'}\n`);
process.exitCode = failed ? 1 : 0;
