import './localdb-guard.mjs';
/**
 * S1-FACE (SPEC v2.4): render the UI-68 card face of the Set 1 rows to the LOCAL DISK, then (Friday) swap each card version in place.
 * READ commands (the write guard is on: any write = "WRITE BLOCKED ...", exit 5):
 *   stage   --set S1 --order <file> --manifest <file> --until <ISO> [--only id,id] [--keys <list> | --shard i/n]   render to <manifest dir>/stage/
 *   order   --set S1 [--out <file>]                    the row order: stills first, then animated; owners desc, copies desc, id
 *   before  --set S1 [--out <file>] [--force]          the baseline: the hash of every row of the set + the list of its old objects
 *   verify  --set S1 --manifest <file> [--order <f>] [--before <f>]   live-unchanged, files, counts, eta, projected-end(-with-s2), B11 line
 *   fresh   --set S1 --manifest <file>                 each staged row: FRESH or STALE (fp of the render inputs)
 *   storage --set S1 --manifest <file> [--limit <bytes>]   now, the projected end, the cut list (S1FACE_LIMIT, default 950000000)
 *   backup  --set S1 [--out <folder>]                   download every old object of the set (main, grid, reveal) with sha256
 *   face-export --set S1 [--out <file>]                 the loadFaceV2 output of every S1 card (the input of the render-only machine)
 *   ingest  --set S1 --from <dir> --manifest <ours> [--tools-ref <f>]   take the rows of the render-only machine (checks, see the function)
 * FILE commands (no database): tools [--save <f>] (the tools print, fp-code, scripts sha), keys / keys-check (the two machines' lists).
 * WRITE commands (no guard; each prints its write list first): orphans (B10). swap, unswap: not built yet (SPEC B4/B5, before Friday).
 * Every database command: --live, or a local copy (LOCALDB=1 with the localdb preload). Without both: refused (the push-set.mjs target rule).
 * --render-only (SPEC 2.8, a second machine, with --import ./scripts/render-only-preload.mjs --cards <f> --face-export <f>): stage with no
 * project and no keys, exempt from the target rule.
 *
 * The write guard (SPEC 2.1, scripts/stage-guard.mjs), installed before the Supabase client is made: an allow-list by method + host + path
 * on fetch (REST GET of cards, subjects, statuses, player_cards; POST of the 2 STABLE read rpcs; the storage LIST call; GET/HEAD of public
 * objects; nothing to api.supabase.com), and the client layer (.insert/.update/.upsert/.delete, storage writes, other rpcs throw).
 * A block prints "WRITE BLOCKED <what>" and the run ends with exit 5 (the supervisor does not restart on 5).
 *
 * stage, per row of the order file (and of --keys) with no STAGED line in the manifest (--only: exactly the named ids; the newest line counts):
 *   before the row: work/PAUSE = "PAUSE", exit 3; now >= --until = "UNTIL reached", exit 4; a blender.exe --background that is not a child
 *   of this job = "WAIT foreign-blender pid=<p>" (every check; the S1 log at once and every 5 min), "RESUME" when it ends.
 *   then the face data (loadFaceV2 once per card, or the face export), renderTier, a 2nd renderPng of the face and of the text mask, the
 *   checks (SPEC 4), the thumbs (src/thumbs.js makeThumbs), and one manifest line: { s:"STAGED", card_id, key, rarity, host, cls, old,
 *   files:{main,grid,reveal}, fp, fpParts, face, checks, sec, attempts, commit, stageSha, tools, toolsSha, at } or { s:"FAIL", ..., why }.
 *   A failed check renders the row again (max 2 times, "RETRY <id> <why>"), then FAIL; the run goes on. Exit 0 when every row is done.
 * It never writes cards.json.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { installFetchGuard, guardClient, isBlocked } from './stage-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_REF = 'kgvdqqehefezbypozvrh';
const BUCKET = 'card-art';
const ITEM = process.env.S1FACE_ITEM || 'C:/Users/vaugh/lptcg-pipeline/items/S1-FACE';
const S1LOG = process.env.S1FACE_LOG || `${ITEM}/logs/s1-supervisor.txt`;
const ANIM_PAGES = 24; // the page count of a known good WebP (UI-68 u6b: Full Art, Secret Rare, Gold: 24 pages of 500x700)
const LIMIT = Number(process.env.S1FACE_LIMIT || 950000000);
// SPEC 2.2: the FIXED list of render code files (never HEAD). The templates load no other file (grep of the templates: only the art).
const CODE_FILES = () => [
  ...['push', 'render', 'face-v2', 'face-data', 'face-icons', 'rarity', 'frames', 'artists', 'cardstore', 'thumbs'].map((n) => `src/${n}.js`),
  ...readdirSync(join(ROOT, 'templates')).filter((f) => f.endsWith('.html')).sort().map((f) => `templates/${f}`),
  ...readdirSync(join(ROOT, 'blender')).filter((f) => f.endsWith('.py')).sort().map((f) => `blender/${f}`),
];

const argv = process.argv.slice(2);
const CMD = argv[0];
const flag = (n) => argv.includes(n);
const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const LIVE = flag('--live');
// --render-only (SPEC v2.4 name; --offline = the same): the render machine mode, exempt from the target rule (no database at all)
const OFFLINE = flag('--render-only') || flag('--offline');
const SET = val('--set');
const now = () => new Date().toISOString();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
const s1log = (s) => { try { mkdirSync(dirname(S1LOG), { recursive: true }); appendFileSync(S1LOG, `${now()} ${s}\n`); } catch { /* no log */ } };
/** path(u): the URL without its scheme and host (the path and ?v). SPEC 2.4, H-3. */
export const pathOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '');
/** The storage object name of a public URL of the bucket (no ?v). */
export const objectOf = (u) => { const m = pathOf(u).match(new RegExp(`/object/public/${BUCKET}/([^?]+)`)); return m ? decodeURIComponent(m[1]) : null; };

// the write guard: scripts/stage-guard.mjs (an allow-list by method + host + path, and the client layer)

function targetCheck() {
  const local = globalThis.__LOCALDB_API || null; // set only by the localdb preload
  if (!local && !LIVE) return 'refused: the target is LIVE (use --live)';
  if (local && LIVE) return 'refused: --live with the localdb preload (the target would be LOCAL)';
  if (LIVE) {
    let url = process.env.SUPABASE_URL || '';
    // dotenv has not run yet: read the value the client will use (DOTENV_CONFIG_PATH, else card-studio/.env)
    const envFile = process.env.DOTENV_CONFIG_PATH || join(ROOT, '.env');
    if (!url && existsSync(envFile)) {
      const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
      url = env.SUPABASE_URL || '';
    }
    if (!new RegExp(`^https://${LIVE_REF}\\.supabase\\.co`).test(url)) return 'refused: not the TCG project';
  }
  return null;
}
const git = (...x) => { try { return execFileSync('git', ['-C', ROOT, ...x], { encoding: 'utf8' }).trim(); } catch { return '?'; } };

/** The sha256 of each render code file (SPEC 2.2). */
export function codeHashes() { return Object.fromEntries(CODE_FILES().map((f) => [f, sha(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'))])); }

/** The sha256 of stage-faces.mjs itself (LF-normalized): import refuses a row made by another version of this script. */
// SPEC v2.4 P-6: ingest compares the LF sha of the render scripts of both machines. ONE list (the spec names stage-faces.mjs and
// render-only-preload.mjs; the files they load at render time are added): printed by `tools`, stored per row as stageSha.
export const SCRIPT_FILES = ['scripts/stage-faces.mjs', 'scripts/render-only-preload.mjs', 'scripts/render-only-hooks.mjs', 'scripts/render-only-supabase.mjs', 'scripts/stage-guard.mjs', 'scripts/face-check.mjs'];
export const stageSha = () => sha(canon(Object.fromEntries(SCRIPT_FILES.map((f) => [f, existsSync(join(ROOT, f)) ? sha(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')) : null]))));
/** The tools print (SPEC v2.4 r4 item 3): Edge, Blender, Python, Pillow, sharp/libvips, node, and the sha256 of the font files that the
 *  templates name (Segoe UI, Georgia, Times New Roman: system fonts; the templates load no font file). Two machines must give the
 *  same print, else import refuses their rows. Measured once per run. */
export function toolsPrint(sharpMod) {
  const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 120000, windowsHide: true }).trim().split(/\r?\n/)[0].trim(); } catch { return null; } };
  const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
  const BLENDER = ['C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'].find(existsSync);
  const FONTS = 'C:/Windows/Fonts';
  let fonts = {};
  try { fonts = Object.fromEntries(readdirSync(FONTS).filter((f) => /^(segoeui|segui|georgia|times)[a-z]*\.ttf$/i.test(f)).sort().map((f) => [f.toLowerCase(), sha(readFileSync(join(FONTS, f)))])); } catch { /* none */ }
  const t = {
    edge: EDGE ? run('powershell', ['-NoProfile', '-c', `(Get-Item '${EDGE}').VersionInfo.ProductVersion`]) : null,
    blender: BLENDER ? (run(BLENDER, ['--factory-startup', '--version']) || '').replace(/\s+/g, ' ') : null,
    python: run('python', ['--version']),
    pillow: run('python', ['-c', 'import PIL; print(PIL.__version__)']),
    sharp: sharpMod?.versions ? `sharp ${sharpMod.versions.sharp} vips ${sharpMod.versions.vips}` : null,
    node: process.version,
    fonts,
  };
  return { tools: t, toolsSha: sha(canon(t)) };
}

/** The art file of a slot, following art/_sources.json (the studio resolver of src/server.js; not exported on main). */
async function artResolver() {
  const { getSource } = await import('../src/artsources.js');
  const ART = join(ROOT, 'art');
  const artFile = (id, slot) => { const f = readdirSync(ART).find((n) => n.startsWith(`${id}-${slot}.`)); return f ? join(ART, f) : null; };
  return (id, slot) => { const s = getSource(id, slot); return s ? artFile(s.fromId, s.fromSlot) : artFile(id, slot); };
}

async function setRows(db, cols = '*') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('cards').select(cols).eq('set_id', SET).order('id').range(from, from + 999);
    if (error) throw new Error(`cards: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const rowsHash = (rows) => sha(rows.map((r) => canon(r)).join('\n'));

/** Every object of the bucket: [{ name, size, etag }] (the storage list API, recursive). */
async function listAll(db) {
  const out = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error(`storage list ${prefix}: ${error.message}`);
      for (const e of data) {
        const name = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) await walk(name);
        else out.push({ name, size: Number(e.metadata?.size ?? 0), etag: e.metadata?.eTag ?? null });
      }
      if (data.length < 1000) break;
    }
  };
  await walk('');
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}
/** The old objects of one row: main (from image_url), grid, and reveal (animated). */
async function oldObjects(row) {
  const { gridObject, revealObject } = await import('../src/thumbs.js');
  const { ANIMATED } = await import('../src/rarity.js');
  const main = objectOf(row.image_url);
  if (!main) return null;
  return [main, gridObject(main), ...(ANIMATED.has(row.rarity) ? [revealObject(main)] : [])];
}

const readManifest = (f) => (f && existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
function manifestState(lines) {
  const newest = new Map(), staged = new Map();
  for (const m of lines) { newest.set(m.card_id, m); if (m.s === 'STAGED') staged.set(m.card_id, m); }
  return { newest, staged };
}
const readOrder = (f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => { const t = l.split('\t'); return { id: Number(t[0]), key: t[1], rarity: t[2], cls: t[3] }; });

/** fp (SPEC 2.2): sha256 of the canonical JSON of the render inputs. Returns { fp, fpParts }. */
async function faceInputs(card, rarity, v2, code, resolve) {
  const { artKeyFor } = await import('../src/rarity.js');
  const { slotDetails } = await import('../src/cardstore.js');
  const { getFrame } = await import('../src/frames.js');
  const { getArtist } = await import('../src/artists.js');
  const slot = artKeyFor(rarity);
  const art = resolve(card.id, slot);
  const slotDet = slotDetails(card, slot);
  const frame = getFrame(card.id, slot), artist = getArtist(card.id, slot);
  const meta = (f) => (existsSync(join(ROOT, 'art', f)) ? sha(readFileSync(join(ROOT, 'art', f))) : null);
  const fpParts = {
    art: art ? sha(readFileSync(art)) : null,
    artMeta: { frames: meta('_frames.json'), artists: meta('_artists.json'), sources: meta('_sources.json') },
    face: v2,
    card: { name: card.name, genre: card.genre ?? null, tierDetails: card.tierDetails?.[slot] ?? null, lore: slotDet.lore, season: slotDet.season, event: slotDet.event, set: card.set, frame, artist, rarity },
    code,
  };
  return { art, slot, slotDet, frame, artist, fpParts, fp: sha(canon(fpParts)) };
}
const faceLine = (v2) => (v2 ? `v2 role=${v2.role} name="${v2.active?.name ?? ''}"` : 'v1');

// ---------------------------------------------------------------- foreign Blender (SPEC 6.2 (3))
function foreignBlender() {
  // a blender.exe with --background whose parent is not this job (between rows this job has no Blender child)
  const ps = "Get-CimInstance Win32_Process -Filter \"name='blender.exe'\" | ? { $_.CommandLine -match '--background' } | % { \"$($_.ProcessId) $($_.ParentProcessId)\" }";
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-c', ps], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim().split(/\s+/).map(Number)).filter((p) => p[0] && p[1] !== process.pid).map((p) => p[0]);
  } catch { return null; }
}

// ---------------------------------------------------------------- image checks
async function pixelDiff(sharp, a, b) {
  // a buffer, not a path: sharp keeps no handle on the file (Windows: an open handle made the retry's cleanup fail with EPERM)
  const raw = (f) => sharp(typeof f === 'string' ? readFileSync(f) : f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const A = await raw(a), B = await raw(b);
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) return { equal: false, px: -1 };
  if (A.data.equals(B.data)) return { equal: true, px: 0 };
  let px = 0;
  for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3]) px += 1;
  return { equal: false, px };
}
const failedOf = (c, mask, lim) => {
  const f = [];
  if (!mask && c.white > lim.WHITE_MAX) f.push('white');
  if (!mask && c.blankRows > lim.BLANKROWS_MAX) f.push('blankRows');
  if (c.clear > lim.CLEAR_MAX) f.push('clear');
  if (c.clearRows > lim.CLEARROWS_MAX) f.push('clearRows');
  return f;
};

// ---------------------------------------------------------------- main
const READ_CMDS = ['stage', 'order', 'before', 'verify', 'fresh', 'storage', 'backup', 'face-export', 'ingest'];
const WRITE_CMDS = ['orphans', 'swap', 'unswap'];
const FILE_CMDS = ['tools', 'keys', 'keys-check']; // no database, no target: local files only
async function main() {
  if (![...READ_CMDS, ...WRITE_CMDS, ...FILE_CMDS].includes(CMD) || !SET || SET.startsWith('--')) {
    console.error(`usage: node scripts/stage-faces.mjs ${[...READ_CMDS, ...WRITE_CMDS, ...FILE_CMDS].join('|')} --set S1 [options] [--live]  (see the head of this file)`);
    return 1;
  }
  if (CMD === 'tools') {
    // the tools print of this machine (S2n: compare the two machines before a start); --save <f> writes it (the S2n reference of ingest)
    const tp = toolsPrint((await import('sharp')).default);
    const rec = { at: now(), host: hostname(), toolsSha: tp.toolsSha, tools: tp.tools, stageSha: stageSha(), commit: git('rev-parse', 'HEAD'), fpCode: sha(canon(codeHashes())) };
    console.log(`TOOLS ${tp.toolsSha} host=${rec.host} scripts=${rec.stageSha} commit=${rec.commit} fp-code=${rec.fpCode}`);
    console.log(JSON.stringify(tp.tools, null, 1));
    if (val('--save')) { writeFileSync(val('--save'), JSON.stringify(rec, null, 1)); console.log(`TOOLS SAVED ${val('--save')}`); }
    return 0;
  }
  if (CMD === 'keys') return keysCommand();
  if (CMD === 'keys-check') return keysCommand(true);
  if (OFFLINE) {
    // render-only mode (SPEC 2.8, a second render machine): no project, no keys, exempt from the target rule. The preload
    // (render-only-preload.mjs) maps src/supabase.js to a stub and blocks every non-local fetch; the guard blocks every Supabase request too.
    if (CMD !== 'stage') { console.log('refused: --render-only is for stage only'); return 1; }
    if (LIVE || globalThis.__LOCALDB_API) { console.log('refused: --render-only with --live or the localdb preload'); return 1; }
    if (!globalThis.__S1FACE_RENDER_ONLY) { console.log('refused: --render-only needs --import ./scripts/render-only-preload.mjs'); return 1; }
    if (!val('--face-export') || !val('--cards')) { console.log('refused: --render-only needs --face-export <file> and --cards <file>'); return 1; }
    process.env.CARDS_FILE = val('--cards'); // src/cardstore.js reads it at import (after this line)
    installFetchGuard(null, { offline: true });
    return stage(null, `RENDER-ONLY ${hostname()}`);
  }
  const refused = targetCheck();
  if (refused) { console.log(refused); return 1; }
  const target = globalThis.__LOCALDB_API ? `LOCAL ${globalThis.__LOCALDB_API}` : `LIVE ${LIVE_REF}`;
  const read = READ_CMDS.includes(CMD);
  if (read) installFetchGuard(); // before the client is made
  const { supabase } = await import('../src/supabase.js');
  if (read) guardClient(supabase);
  else return writeCommand(CMD, supabase, target);
  return { stage, order, before, verify, fresh, storage, backup, 'face-export': exportFaces, ingest: importStaged }[CMD](supabase, target);
}

async function order(db, target) {
  const { ANIMATED } = await import('../src/rarity.js');
  const rows = await setRows(db, 'id, rarity, subject:subjects!inner(key)');
  const own = new Map();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('player_cards').select('card_id, player_id, quantity').in('card_id', ids.slice(i, i + 200)).order('card_id').order('player_id').range(from, from + 999);
      if (error) throw new Error(`player_cards: ${error.message}`);
      for (const p of data) { const o = own.get(p.card_id) || { owners: 0, copies: 0 }; o.owners += 1; o.copies += p.quantity; own.set(p.card_id, o); }
      if (data.length < 1000) break;
    }
  }
  const items = rows.map((r) => ({ id: r.id, key: r.subject.key, rarity: r.rarity, cls: ANIMATED.has(r.rarity) ? 'animated' : 'still', ...(own.get(r.id) || { owners: 0, copies: 0 }) }));
  const by = (a, b) => b.owners - a.owners || b.copies - a.copies || a.id - b.id;
  const list = [...items.filter((x) => x.cls === 'still').sort(by), ...items.filter((x) => x.cls === 'animated').sort(by)];
  const out = val('--out') || join(ITEM, 'work', 'order.txt');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `# stage-faces order ${now()} set=${SET} target=${target}: stills first, then animated; owners desc, copies desc, id\n`
    + list.map((x) => `${x.id}\t${x.key}\t${x.rarity}\t${x.cls}\towners=${x.owners}\tcopies=${x.copies}`).join('\n') + '\n');
  const n = (c) => list.filter((x) => x.cls === c).length;
  console.log(`ORDER rows=${list.length} still=${n('still')} animated=${n('animated')} unowned_animated=${list.filter((x) => x.cls === 'animated' && !x.owners).length} out=${out}`);
  return 0;
}

/** The S1 rows and their old objects (name, size, etag) as one state. */
async function setState(db) {
  const rows = await setRows(db);
  const all = new Map((await listAll(db)).map((o) => [o.name, o]));
  const objs = [];
  for (const r of rows) for (const n of (await oldObjects(r)) || []) objs.push(all.get(n) || { name: n, size: null, etag: null, missing: true });
  objs.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { rows, objs, all, rowsSha: rowsHash(rows), objsSha: sha(objs.map((o) => canon(o)).join('\n')) };
}

async function before(db, target) {
  const out = val('--out') || join(ITEM, 'work', `before-${SET.toLowerCase()}.json`);
  if (existsSync(out) && !flag('--force')) { console.log(`refused: ${out} exists (use --force)`); return 1; }
  const s = await setState(db);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: now(), set: SET, target, n: s.rows.length, sha256: s.rowsSha, objects: s.objs.length, objectsSha256: s.objsSha,
    oldBytes: s.objs.reduce((t, o) => t + (o.size || 0), 0), rows: Object.fromEntries(s.rows.map((r) => [r.id, sha(canon(r))])), objectList: s.objs }, null, 1));
  console.log(`BEFORE n=${s.rows.length} sha256=${s.rowsSha} objects=${s.objs.length} missing=${s.objs.filter((o) => o.missing).length} objectsSha256=${s.objsSha} out=${out}`);
  return 0;
}

const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const stagedBytes = (m) => Object.values(m.files || {}).reduce((t, f) => t + (f?.bytes || 0), 0);
// SPEC 9: the per-row bytes before a measure (still 0.45 MB, animated 2.68 MB)
const DEFAULT_BYTES = { still: 450000, animated: 2680000 };

async function verify(db, target) {
  const bf = val('--before') || join(ITEM, 'work', `before-${SET.toLowerCase()}.json`);
  let pass = true;
  const s = await setState(db);
  let b = null;
  if (!existsSync(bf)) { console.log(`VERIFY FAIL no baseline ${bf}`); pass = false; }
  else {
    b = JSON.parse(readFileSync(bf, 'utf8'));
    if (s.rowsSha === b.sha256 && s.objsSha === b.objectsSha256) console.log(`VERIFY PASS live-unchanged rows=${s.rows.length} objects=${s.objs.length} target=${target}`);
    else {
      pass = false;
      const changed = s.rows.filter((r) => b.rows[r.id] !== sha(canon(r))).map((r) => r.id);
      const bo = new Map(b.objectList.map((o) => [o.name, canon(o)]));
      const objChanged = s.objs.filter((o) => bo.get(o.name) !== canon(o)).map((o) => o.name);
      console.log(`VERIFY FAIL live-changed rows=${changed.join(',') || '-'} objects=${objChanged.slice(0, 10).join(',') || '-'}${objChanged.length > 10 ? ` (+${objChanged.length - 10})` : ''}`);
    }
  }
  const man = val('--manifest');
  if (man) {
    const { newest, staged } = manifestState(readManifest(man));
    let bad = 0;
    for (const m of staged.values()) for (const f of Object.values(m.files || {})) if (f && (!existsSync(f.path) || sha(readFileSync(f.path)) !== f.sha256)) { bad += 1; console.log(`FILE BAD ${m.card_id} ${f.path}`); }
    if (bad) pass = false;
    const fail = [...newest.values()].filter((m) => m.s === 'FAIL').length;
    const ordf = val('--order') || join(ITEM, 'work', 'order.txt');
    const ord = existsSync(ordf) ? readOrder(ordf) : [];
    const left = ord.filter((o) => !staged.has(o.id));
    const st = [...staged.values()];
    const sec = { still: meanOf(st.filter((m) => m.cls === 'still').map((m) => m.sec)) ?? 23, animated: meanOf(st.filter((m) => m.cls === 'animated').map((m) => m.sec)) ?? 447 };
    const bytes = { still: meanOf(st.filter((m) => m.cls === 'still').map(stagedBytes)) ?? DEFAULT_BYTES.still, animated: meanOf(st.filter((m) => m.cls === 'animated').map(stagedBytes)) ?? DEFAULT_BYTES.animated };
    const eta = left.reduce((t, o) => t + sec[o.cls], 0) / 3600;
    const nowBytes = [...s.all.values()].reduce((t, o) => t + o.size, 0);
    const oldBytes = s.objs.reduce((t, o) => t + (o.size || 0), 0);
    const newBytes = st.reduce((t, m) => t + stagedBytes(m), 0) + left.reduce((t, o) => t + bytes[o.cls], 0);
    console.log(`COUNTS staged=${staged.size} fail=${fail} left=${left.length} files_bad=${bad} mean_sec still=${sec.still.toFixed(0)} animated=${sec.animated.toFixed(0)} eta=${eta.toFixed(2)}h`);
    // SPEC v2.2 section 4: projected-end (the mean case) and projected-end-with-s2 (the B11c value: the high case, the S1 new set x 1.15,
    // + the S2 term 150,000,000 x 1.15 until the S2 push is in `now`: --s2-in-now, or S1FACE_S2_TERM)
    const s2 = flag('--s2-in-now') ? 0 : Number(process.env.S1FACE_S2_TERM ?? 172500000);
    const end = nowBytes - oldBytes + newBytes;
    const endS2 = Math.round(nowBytes - oldBytes + newBytes * 1.15 + s2);
    console.log(`BYTES mean still=${Math.round(bytes.still)} animated=${Math.round(bytes.animated)} now=${nowBytes} old=${oldBytes} new=${newBytes} projected-end=${end} projected-end-with-s2=${endS2} s2-term=${s2} limit=${LIMIT}`);
    console.log(endS2 > LIMIT ? `B11 NEEDED projected-end-with-s2=${endS2} > ${LIMIT}` : `B11 NOT NEEDED projected-end-with-s2=${endS2} <= ${LIMIT}`);
  }
  console.log(pass ? 'VERIFY PASS' : 'VERIFY FAIL');
  return pass ? 0 : 1;
}

async function fresh(db) {
  const man = val('--manifest');
  if (!man) { console.error('usage: fresh --set S1 --manifest <file>'); return 1; }
  const { loadFaceV2 } = await import('../src/face-data.js');
  const { getCards } = await import('../src/cardstore.js');
  const resolve = await artResolver();
  const code = codeHashes();
  const cards = new Map(getCards().map((c) => [c.id, c]));
  const { staged } = manifestState(readManifest(man));
  const v2s = new Map();
  let nf = 0, ns = 0;
  for (const m of staged.values()) {
    const card = cards.get(m.key);
    let why = null;
    if (!card) why = 'no card in cards.json';
    else {
      if (!v2s.has(m.key)) v2s.set(m.key, await loadFaceV2(db, card).catch((e) => ({ error: e.message })));
      const v2 = v2s.get(m.key);
      if (v2?.error) why = v2.error;
      else {
        const inp = await faceInputs(card, m.rarity, v2, code, resolve);
        if (inp.fp !== m.fp) why = Object.keys(inp.fpParts).filter((k) => canon(inp.fpParts[k]) !== canon(m.fpParts?.[k])).join(',') || 'fp';
      }
    }
    if (why) { ns += 1; console.log(`STALE ${m.key} ${m.rarity} ${m.card_id} ${why}`); } else { nf += 1; console.log(`FRESH ${m.key} ${m.rarity} ${m.card_id}`); }
  }
  console.log(`FRESH n=${nf} stale=${ns}`);
  return 0;
}

/** storage (SPEC 4): now, the projected end of a swap of the staged rows, the cut list in the order of section 5. */
async function storage(db) {
  const man = val('--manifest');
  const limit = Number(val('--limit') || LIMIT);
  const s = await setState(db);
  const nowBytes = [...s.all.values()].reduce((t, o) => t + o.size, 0);
  const { staged } = manifestState(readManifest(man));
  const ordf = val('--order') || join(ITEM, 'work', 'order.txt');
  const ids = existsSync(ordf) ? readOrder(ordf).map((o) => o.id).filter((id) => staged.has(id)) : [...staged.keys()];
  const byId = new Map(s.rows.map((r) => [r.id, r]));
  // the projected end of a swap of ALL these rows; over the limit: cut rows from the END of the order (the least owned) until it is
  // under (SPEC section 4 and 5: the same order for the render, the swap and a storage cut)
  const delta = [];
  for (const id of ids) {
    const row = byId.get(id); const m = staged.get(id);
    const old = ((row && (await oldObjects(row))) || []).reduce((t, n) => t + (s.all.get(n)?.size || 0), 0);
    delta.push({ id, d: stagedBytes(m) - old });
  }
  const full = nowBytes + delta.reduce((t, x) => t + x.d, 0);
  let end = full;
  const cut = [];
  // only a row that ADDS bytes is cut (a row whose swap frees bytes always helps)
  for (let i = delta.length - 1; i >= 0 && end > limit; i--) if (delta[i].d > 0) { end -= delta[i].d; cut.unshift(delta[i].id); }
  if (!cut.length) { console.log(`STORAGE PASS now=${nowBytes} end=${end} limit=${limit} rows=${ids.length}`); return 0; }
  console.log(`refused: projected end over the limit: now=${nowBytes} end=${full} limit=${limit}`);
  console.log(end <= limit ? `WAIT storage rows=${cut.length} ids=${cut.join(',')} end-without-them=${end}` : `WAIT storage rows=${cut.length} (all) end-without-them=${end} > limit`);
  return 1;
}

/** backup (SPEC 2.3): download every old object of the set to <out>/<object name>; work/backup.jsonl. Read only. */
async function backup(db, target) {
  const out = val('--out') || join(ITEM, 'work', 'backup');
  const jl = join(dirname(out), 'backup.jsonl');
  if (existsSync(jl) && !flag('--force')) { console.log(`refused: ${jl} exists (never changed after the backup; use --force on a test only)`); return 1; }
  const { publicUrl } = await import('../src/storage-url.js');
  const s = await setState(db);
  const only = val('--only') ? new Set(val('--only').split(',').map(Number)) : null; // a test: some rows only
  let n = 0, bytes = 0, bad = 0;
  const lines = [];
  for (const r of s.rows.filter((x) => !only || only.has(x.id))) {
    const names = await oldObjects(r);
    if (!names) { bad += 1; console.log(`BACKUP BAD ${r.id} image_url not in ${BUCKET}`); continue; }
    const objects = [];
    for (const name of names) {
      const meta = s.all.get(name);
      const res = await fetch(publicUrl(db, BUCKET, name));
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !meta || buf.length !== meta.size) { bad += 1; console.log(`BACKUP BAD ${r.id} ${name} http=${res.status} bytes=${buf.length} listed=${meta?.size ?? 'none'}`); continue; }
      const f = join(out, name);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, buf);
      objects.push({ name, sha256: sha(buf), bytes: buf.length, contentType: res.headers.get('content-type') });
      n += 1; bytes += buf.length;
    }
    lines.push(JSON.stringify({ card_id: r.id, old_path: pathOf(r.image_url), objects }));
  }
  writeFileSync(jl, lines.join('\n') + '\n');
  console.log(bad ? `BACKUP FAIL objects=${n} bytes=${bytes} bad=${bad} target=${target}` : `BACKUP PASS objects=${n} bytes=${bytes} target=${target}`);
  return bad ? 1 : 0;
}

/** The key lists of the two machines, from ONE order file (SPEC v2.4 2.8 P-2, r5 L-3). No database.
 *   keys --set S1 --order <f> --out ws.txt,no.txt [--split <still s>/<anim s>,<still s>/<anim s>] [--calib calib.txt]
 *        default: the card keys in the order of the file, index mod 2 = 0 -> ws.txt, = 1 -> no.txt (P-2). --split: each key to the machine
 *        that ends first with the given seconds per row (for example 23/447,2.1/171). --calib: the first still row and the first animated
 *        row of ws.txt as "<key> <rarity>" lines (r5 L-3: a SEPARATE --keys run on BOTH machines; not in no.txt). Then keys-check.
 *   keys-check --set S1 --order <f> --keys ws.txt,no.txt
 *        "KEYS PASS ws=<rows> no=<rows> total=352 overlap=0": the union of both lists = exactly the rows of the order file, no overlap.
 * A list line is "<key>" (every row of the key) or "<key> <rarity>" (one row). */
export function listRows(text, ord) {
  const out = [];
  for (const l of text.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))) {
    const [k, r] = l.split(/\s+/);
    const rows = ord.filter((o) => o.key === k && (!r || o.rarity === r));
    out.push({ line: l, rows });
  }
  return out;
}
function keysCommand(checkOnly = false) {
  const ordf = val('--order');
  if (!ordf) { console.error('usage: keys --set S1 --order <f> --out ws.txt,no.txt [--split s/a,s/a] [--calib calib.txt] | keys-check --set S1 --order <f> --keys ws.txt,no.txt'); return 1; }
  const ord = readOrder(ordf);
  const keyOrder = [...new Set(ord.map((o) => o.key))];
  let files = (val('--keys') || val('--out') || '').split(',').filter(Boolean);
  if (files.length !== 2) { console.error('keys: two lists (ws,no)'); return 1; }
  if (!checkOnly) {
    const lists = [[], []];
    let note = 'index mod 2';
    if (val('--split')) {
      const sp = val('--split').split(',').map((x) => x.split('/').map(Number));
      if (sp.length !== 2 || sp.some((x) => x.length !== 2 || x.some((n) => !(n > 0)))) { console.error('usage: --split 23/447,2.1/171'); return 1; }
      const tot = [0, 0];
      for (const key of keyOrder) {
        const rows = ord.filter((o) => o.key === key);
        const cost = sp.map(([s, a]) => rows.reduce((t, r) => t + (r.cls === 'animated' ? a : s), 0));
        const m = tot[0] + cost[0] <= tot[1] + cost[1] ? 0 : 1;
        tot[m] += cost[m]; lists[m].push(key);
      }
      note = `split ${val('--split')}: ws ${(tot[0] / 3600).toFixed(2)} h, no ${(tot[1] / 3600).toFixed(2)} h`;
    } else keyOrder.forEach((k, i) => lists[i % 2].push(k));
    files.forEach((f, i) => writeFileSync(f, `# stage-faces keys ${now()} ${i ? 'no' : 'ws'} from ${ordf} (${note})\n${lists[i].join('\n')}\n`));
    console.log(`KEYS WRITTEN ws=${lists[0].length} keys no=${lists[1].length} keys (${note})`);
    if (val('--calib')) {
      const wsRows = ord.filter((o) => lists[0].includes(o.key));
      const st = wsRows.find((o) => o.cls === 'still'), an = wsRows.find((o) => o.cls === 'animated');
      writeFileSync(val('--calib'), `# stage-faces calibration rows (r5 L-3): the first still and the first animated row of ws; a separate --keys run on BOTH machines\n${st.key} ${st.rarity}\n${an.key} ${an.rarity}\n`);
      console.log(`CALIB WRITTEN ${st.id} ${st.key} ${st.rarity} + ${an.id} ${an.key} ${an.rarity}`);
    }
  }
  const sets = files.map((f) => listRows(readFileSync(f, 'utf8'), ord));
  const bad = [];
  const seen = new Map();
  sets.forEach((s, i) => s.forEach((x) => {
    if (!x.rows.length) bad.push(`${x.line} not in the order`);
    for (const r of x.rows) { if (seen.has(r.id)) bad.push(`${r.key} ${r.rarity} in ${seen.get(r.id) ? 'no' : 'ws'} and ${i ? 'no' : 'ws'}`); else seen.set(r.id, i); }
  }));
  const missing = ord.filter((o) => !seen.has(o.id));
  for (const o of missing.slice(0, 10)) bad.push(`${o.key} ${o.rarity} in no list`);
  const n = sets.map((s) => s.reduce((t, x) => t + x.rows.length, 0));
  const overlap = n[0] + n[1] - seen.size;
  if (seen.size !== ord.length) bad.push(`total ${seen.size} != ${ord.length}`);
  console.log(bad.length ? `KEYS FAIL ws=${n[0]} no=${n[1]} total=${seen.size} overlap=${overlap} ${bad.slice(0, 10).join('; ')}` : `KEYS PASS ws=${n[0]} no=${n[1]} total=${seen.size} overlap=0`);
  return bad.length ? 1 : 0;
}

/** face-export (for a render-only machine): the loadFaceV2 output of every card of the set that has a cards row on the target.
 *  { at, target, set, cards: <sha256 of the cards file>, faces: { <key>: <v2> } }. Read only. */
async function exportFaces(db, target) {
  const out = val('--out') || join(ITEM, 'work', `faces-${SET.toLowerCase()}.json`);
  const { loadFaceV2 } = await import('../src/face-data.js');
  const { getCards } = await import('../src/cardstore.js');
  const rows = await setRows(db, 'id, subject:subjects!inner(key)');
  const keys = new Set(rows.map((r) => r.subject.key));
  const faces = {};
  let bad = 0;
  for (const card of getCards().filter((c) => c.set === SET && keys.has(c.id))) {
    try { faces[card.id] = await loadFaceV2(db, card); } catch (e) { bad += 1; console.log(`FACE-ERROR ${card.id} ${e.message}`); }
    if (isBlocked()) return 5;
  }
  const cardsFile = process.env.CARDS_FILE || join(ROOT, 'cards.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: now(), target, set: SET, cards: sha(readFileSync(cardsFile)), faces }, null, 1));
  const v1 = Object.values(faces).filter((v) => !v).length;
  console.log(`FACE-EXPORT ${bad || v1 ? 'FAIL' : 'PASS'} cards=${Object.keys(faces).length} keys_with_rows=${keys.size} v1=${v1} errors=${bad} out=${out} sha256=${sha(readFileSync(out))}`);
  return bad || v1 ? 1 : 0;
}

/** ingest (SPEC v2.4 2.8, the workstation): take the STAGED rows of the render-only machine. --from <dir> holds its manifest
 *  (staged.jsonl, or --remote-manifest <f>) and its row files (<dir>/stage/ or <dir>). For each row (the newest STAGED line):
 *  (1) fp RECOMPUTED here from the local inputs and the target's face data = the row fp; (1b) the row commit = this HEAD, and the row
 *  stageSha = the LF sha of this machine's render scripts (SCRIPT_FILES); (1c) the row tools = this machine's tools, AND this machine's
 *  tools now = the S2n reference (--tools-ref, default <item>/work/tools-s2n.json; r5 L-2: a tools change here after S2n refuses);
 *  (2) each file sha and bytes = the row; (3) the content checks again (face check of the main file, page count, last page, thumbs decode).
 *  Pass: the files are copied to work/stage/, a STAGED line with host=<the other machine> and old=<the target image_url> is appended:
 *  "INGESTED <id> ...". Else "INGEST FAIL <id> <key> <rarity> <why>" (the row is rendered again on the workstation).
 *  A row that is STAGED here already (the calibration rows, r5 L-3): "CALIB <id> still pixel-equal|differs px=<n>" or, animated, the last
 *  frame of both to work/calib/ for Nathan; not ingested. Last line "INGEST PASS n=<k>" or "INGEST FAIL n=<k> fail=<f>". Read only. */
async function importStaged(db, target) {
  const from = val('--from'), man = val('--manifest');
  if (!from || !man) { console.error('usage: ingest --set S1 --from <dir> --manifest <ours> [--remote-manifest <f>] [--tools-ref <f>] [--live]'); return 1; }
  const remoteMan = val('--remote-manifest') || join(from, 'staged.jsonl');
  const filesDir = existsSync(join(from, 'stage')) ? join(from, 'stage') : from;
  const sharp = (await import('sharp')).default;
  const { loadFaceV2 } = await import('../src/face-data.js');
  const { getCards } = await import('../src/cardstore.js');
  const { ANIMATED } = await import('../src/rarity.js');
  const fc = await import('./face-check.mjs');
  const resolve = await artResolver();
  const code = codeHashes();
  const cards = new Map(getCards().filter((c) => c.set === SET).map((c) => [c.id, c]));
  const tp = toolsPrint(sharp), myStage = stageSha(), myHead = git('rev-parse', 'HEAD');
  console.log(`TOOLS ${tp.toolsSha.slice(0, 12)} commit=${myHead.slice(0, 8)} scripts=${myStage.slice(0, 12)}`);
  // r5 L-2: this machine's tools must still be the tools of the S2n check
  const refF = val('--tools-ref') || join(ITEM, 'work', 'tools-s2n.json');
  if (!existsSync(refF)) { console.log(`refused: no S2n tools reference ${refF} (stage-faces tools --save)`); return 1; }
  const ref = JSON.parse(readFileSync(refF, 'utf8'));
  if (ref.toolsSha !== tp.toolsSha) {
    console.log(`refused: the tools of this machine changed after S2n (${Object.keys(tp.tools).filter((k) => canon(tp.tools[k]) !== canon(ref.tools?.[k])).join(',')})`);
    return 1;
  }
  if (!existsSync(remoteMan)) { console.log(`refused: no remote manifest ${remoteMan}`); return 1; }
  const { staged: theirs } = manifestState(readManifest(remoteMan));
  const { staged: ours } = manifestState(readManifest(man));
  const STAGE = join(dirname(man), 'stage'), CALIB = join(dirname(man), 'calib');
  mkdirSync(STAGE, { recursive: true });
  const v2s = new Map();
  let ok = 0, failed = 0, calib = 0;
  const base = (p) => String(p).replace(/\\/g, '/').split('/').pop();
  for (const m of theirs.values()) {
    const why = [];
    const local = {};
    for (const [k, f] of Object.entries(m.files || {})) {
      if (!f) continue;
      const p = join(filesDir, base(f.path));
      if (!existsSync(p)) { why.push(`${k} missing`); continue; }
      const buf = readFileSync(p);
      if (sha(buf) !== f.sha256 || buf.length !== f.bytes) why.push(`${k} sha`);
      local[k] = { p, buf };
    }
    if (ours.has(m.card_id)) {
      // the calibration rows (r5 L-3): staged on both machines. Compare, do not ingest.
      calib += 1;
      const mine = ours.get(m.card_id);
      if (why.length || !local.main) { console.log(`CALIB ${m.card_id} ${m.key} ${m.rarity} remote file ${why.join(',') || 'missing'}`); continue; }
      if (!ANIMATED.has(m.rarity)) {
        const d = await pixelDiff(sharp, local.main.p, mine.files.main.path);
        console.log(`CALIB ${m.card_id} ${m.key} ${m.rarity} still ${d.equal ? 'pixel-equal' : `differs px=${d.px}`}`);
      } else {
        mkdirSync(CALIB, { recursive: true });
        for (const [who, f] of [['remote', local.main.p], ['here', mine.files.main.path]]) {
          const md = await sharp(f, { animated: true }).metadata();
          await sharp(f, { page: md.pages - 1 }).png().toFile(join(CALIB, `${m.key}-${m.rarity}-last-${who}.png`));
        }
        const d = await pixelDiff(sharp, join(CALIB, `${m.key}-${m.rarity}-last-remote.png`), join(CALIB, `${m.key}-${m.rarity}-last-here.png`));
        console.log(`CALIB ${m.card_id} ${m.key} ${m.rarity} animated last-frame ${d.equal ? 'pixel-equal' : `differs px=${d.px}`} files=${CALIB.replace(/\\/g, '/')}`);
      }
      continue;
    }
    const card = cards.get(m.key);
    const { data: row, error } = await db.from('cards').select('id, rarity, image_url, set_id, subject:subjects!inner(key)').eq('id', m.card_id).maybeSingle();
    if (error) throw new Error(`cards ${m.card_id}: ${error.message}`);
    if (!row || row.subject.key !== m.key || row.rarity !== m.rarity || row.set_id !== SET) why.push('row');
    if (!card) why.push('card');
    if (m.commit !== myHead) why.push(`commit ${String(m.commit).slice(0, 8)}`);
    if (m.stageSha !== myStage) why.push('code');
    if (m.toolsSha !== tp.toolsSha) why.push(`tools (${Object.keys(tp.tools).filter((k) => canon(tp.tools[k]) !== canon(m.tools?.[k])).join(',') || 'tools'})`);
    if (!why.length) {
      const anim = ANIMATED.has(m.rarity);
      try {
        const c0 = await fc.faceCheck(local.main.buf);
        for (const x of failedOf(c0, false, fc)) why.push(`check ${x}`);
        if (anim) {
          const md = await sharp(local.main.buf, { animated: true }).metadata();
          if (md.pages !== ANIM_PAGES || md.width !== 500 || md.pageHeight !== 700) why.push(`pages=${md.pages}`);
          else for (const x of failedOf(await fc.faceCheck(await sharp(local.main.buf, { page: md.pages - 1 }).png().toBuffer()), false, fc)) why.push(`last ${x}`);
          if (!local.reveal) why.push('no reveal'); else await sharp(local.reveal.buf, { animated: true }).metadata();
        }
        await sharp(local.grid.buf).metadata();
      } catch (e) { why.push(`decode: ${(e.message || String(e)).split('\n')[0]}`); }
    }
    if (!why.length) {
      if (!v2s.has(m.key)) v2s.set(m.key, await loadFaceV2(db, card).catch((e) => ({ error: e.message })));
      if (isBlocked()) return 5;
      const v2 = v2s.get(m.key);
      if (v2?.error) why.push(`face: ${v2.error}`);
      else {
        const inp = await faceInputs(card, m.rarity, v2, code, resolve);
        if (inp.fp !== m.fp) why.push(`fp (${Object.keys(inp.fpParts).filter((k) => canon(inp.fpParts[k]) !== canon(m.fpParts?.[k])).join(',') || 'fp'})`);
      }
    }
    if (why.length) { failed += 1; console.log(`INGEST FAIL ${m.card_id} ${m.key} ${m.rarity} ${why.join(',')}`); continue; }
    const files = {};
    for (const [k, { p, buf }] of Object.entries(local)) { const dest = join(STAGE, base(p)); writeFileSync(dest, buf); files[k] = { path: dest.replace(/\\/g, '/'), sha256: sha(buf), bytes: buf.length }; }
    if (!files.reveal) files.reveal = null;
    appendFileSync(man, JSON.stringify({ ...m, old: row.image_url, files, host: m.host || 'other', ingestedAt: now() }) + '\n');
    ok += 1;
    console.log(`INGESTED ${m.card_id} ${m.key} ${m.rarity} host=${m.host}`);
  }
  console.log(failed ? `INGEST FAIL n=${ok} fail=${failed} calib=${calib} target=${target}` : `INGEST PASS n=${ok} calib=${calib} target=${target}`);
  return failed ? 1 : 0;
}

async function stage(db, target) {
  const ordf = val('--order'), man = val('--manifest'), untilS = val('--until');
  const ONLY = val('--only') ? val('--only').split(',').map((s) => Number(s.trim())).filter(Boolean) : null;
  const until = Date.parse(untilS || '');
  if (!ordf || !man || !Number.isFinite(until)) { console.error('usage: stage --set S1 --order <file> --manifest <file> --until <ISO> [--only id,id] [--live]'); return 1; }
  const local = Boolean(globalThis.__LOCALDB_API);
  const head = git('rev-parse', 'HEAD');
  const sharp = (await import('sharp')).default;
  sharp.cache(false); // no file handles kept open (Windows: the retry removes the files of the attempt before)
  const { renderTier } = await import('../src/push.js');
  const { renderPng } = await import('../src/render.js');
  const { loadFaceV2 } = await import('../src/face-data.js');
  const { ANIMATED, artKeyFor } = await import('../src/rarity.js');
  const { getCards } = await import('../src/cardstore.js');
  const facesFile = OFFLINE ? JSON.parse(readFileSync(val('--face-export'), 'utf8')) : null;
  if (facesFile) console.log(`FACE-EXPORT ${val('--face-export')} sha256=${sha(readFileSync(val('--face-export')))} cards=${Object.keys(facesFile.faces).length} at=${facesFile.at} from=${facesFile.target}`);
  if (OFFLINE && globalThis.__S1FACE_RENDER_ONLY_SUPABASE !== true) throw new Error('render-only: the supabase stub is not in place');
  if (OFFLINE) console.log(`RENDER-ONLY src/supabase.js=stub (no .env, no client) cards=${val('--cards')}`);
  const { makeThumbs } = await import('../src/thumbs.js');
  const fc = await import('./face-check.mjs');
  const resolve = await artResolver();
  const code = codeHashes();
  const tp = toolsPrint(sharp);
  const scriptSha = stageSha();
  console.log(`TOOLS ${tp.toolsSha.slice(0, 12)} edge=${tp.tools.edge} blender="${tp.tools.blender}" python="${tp.tools.python}" pillow=${tp.tools.pillow} ${tp.tools.sharp} node=${tp.tools.node} fonts=${Object.keys(tp.tools.fonts).length} stage-faces=${scriptSha.slice(0, 12)}`);
  const cardsFile = process.env.CARDS_FILE || join(ROOT, 'cards.json');
  console.log(`CARDS_FILE ${process.env.CARDS_FILE || 'cards.json'} sha256=${sha(readFileSync(cardsFile))}`);
  const cards = new Map(getCards().filter((c) => c.set === SET).map((c) => [c.id, c]));
  // SPEC 2.2: the fixed code list of fp, with the sha256 of each file (CRLF-neutral)
  try { mkdirSync(join(ITEM, 'logs'), { recursive: true }); writeFileSync(join(ITEM, 'logs', 'fp-code-list.txt'), Object.entries(code).map(([k, v]) => `${v}  ${k}`).join('\n') + '\n'); } catch { /* no log folder */ }
  const ordAll = readOrder(ordf);
  const byId = new Map(ordAll.map((o) => [o.id, o]));
  // the machine's card set: --shard i/n (by card key, in the order of first appearance) or --keys <file> (one key per line)
  const keyOrder = [...new Set(ordAll.map((o) => o.key))];
  const shard = val('--shard') ? val('--shard').split('/').map(Number) : null;
  if (shard && !(shard[1] >= 1 && shard[0] >= 1 && shard[0] <= shard[1])) { console.error('usage: --shard i/n (1 <= i <= n)'); return 1; }
  const keyRows = val('--keys') ? new Set(listRows(readFileSync(val('--keys'), 'utf8'), ordAll).flatMap((x) => x.rows.map((r) => r.id))) : null;
  const keySet = keyRows ? new Set(ordAll.filter((o) => keyRows.has(o.id)).map((o) => o.key))
    : shard ? new Set(keyOrder.filter((k, i) => i % shard[1] === shard[0] - 1)) : null;
  const ord = ordAll.filter((o) => (keyRows ? keyRows.has(o.id) : !keySet || keySet.has(o.key))).map((o) => o.id);
  const { staged } = manifestState(readManifest(man));
  const todo = ONLY || ord.filter((id) => !staged.has(id));
  if (keySet) console.log(`SHARD ${val('--shard') || 'keys ' + val('--keys')} keys=${keySet.size} rows=${ord.length}`);
  console.log(`START head=${head.slice(0, 8)} rows=${ord.length} todo=${todo.length} staged=${staged.size} until=${new Date(until).toISOString()} target=${target} code=${sha(canon(code)).slice(0, 12)}`);
  const OUT = join(ROOT, 'out', 'stage-faces');
  const STAGE = join(dirname(man), 'stage');
  mkdirSync(OUT, { recursive: true }); mkdirSync(STAGE, { recursive: true });
  const write = (o) => appendFileSync(man, JSON.stringify(o) + '\n');
  // test hooks, LOCAL only (the CHECKS tests): plant a cut face, a white half, a different 2nd face or text mask render, for one row id
  const plant = local ? process.env.S1FACE_TEST_PLANT || null : null;
  const plantId = local ? Number(process.env.S1FACE_TEST_ID || 0) : 0;
  const waitMs = Number(((local || OFFLINE) && process.env.S1FACE_WAIT_S) || 60) * 1000;
  const v2s = new Map();
  let nStaged = 0, nFail = 0;
  const summary = (end) => console.log(`SUMMARY staged=${nStaged} fail=${nFail} todo=${todo.length} end=${end} target=${target}`);
  const PAUSE = join(ITEM, 'work', 'PAUSE');
  // stand-by (SPEC v2.2 6.2): under the supervisor (S1FACE_GO=1) the job waits for work/go-<its pid>, so the supervisor writes the
  // S1 START line and the lock owner before this job can start Blender
  if (process.env.S1FACE_GO === '1') {
    const go = join(ITEM, 'work', `go-${process.pid}`);
    for (let i = 0; !existsSync(go); i++) { if (i > 240) { console.log(`ERROR no ${go} after 60 s`); return 1; } await new Promise((r) => setTimeout(r, 250)); }
    console.log(`GO ${go}`);
  }

  for (const id of todo) {
    // the row start rule (SPEC 6.2): PAUSE, UNTIL, a foreign Blender (wait, then go on by itself)
    let waited = false, lastS1 = 0;
    for (;;) {
      if (existsSync(PAUSE)) { console.log('PAUSE'); summary('PAUSE'); return 3; }
      if (Date.now() >= until) { console.log('UNTIL reached'); summary('UNTIL'); return 4; }
      // S1FACE_TEST_NOWAIT=1: a LOCAL (or offline) test of a still row that does not test this rule (no Blender in the row)
      const fb = (local || OFFLINE) && process.env.S1FACE_TEST_NOWAIT === '1' ? [] : foreignBlender();
      if (fb && !fb.length) break;
      const why = fb ? `foreign-blender pid=${fb.join(',')}` : 'process-list-unreadable';
      console.log(`WAIT ${why} ${now()}`); // every check: the stage log moves (the stall watchdog reads it)
      // the S1 log: the first WAIT, then one line every 5 min (review r2 item 2)
      if (Date.now() - lastS1 >= Number((local && process.env.S1FACE_WAITLOG_S) || 300) * 1000) { s1log(`S1 WAIT ${why}`); lastS1 = Date.now(); }
      waited = true;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    if (waited) { console.log('RESUME'); s1log('S1 RESUME'); }
    if (isBlocked()) return 5;
    const t0 = Date.now();
    const fail = (key, rarity, why) => { nFail += 1; console.log(`FAIL ${id} ${key} ${rarity} ${why}`); write({ s: 'FAIL', card_id: id, key, rarity, why, at: now(), commit: head }); };
    let row = null;
    if (OFFLINE) { const o = byId.get(id); row = o ? { id, rarity: o.rarity, image_url: null, set_id: SET, subject: { key: o.key } } : null; }
    else {
      const { data, error: re } = await db.from('cards').select('id, rarity, image_url, set_id, subject:subjects!inner(key)').eq('id', id).maybeSingle();
      if (re) throw new Error(`cards ${id}: ${re.message}`);
      row = data;
    }
    if (!row) { fail('-', '-', 'no cards row'); continue; }
    const key = row.subject.key, rarity = row.rarity;
    console.log(`ROW ${id} ${key} ${rarity} ${now()}`);
    if (row.set_id !== SET) { fail(key, rarity, `set ${row.set_id}, not ${SET}`); continue; }
    const card = cards.get(key);
    if (!card) { fail(key, rarity, `no ${SET} card in cards.json`); continue; }
    if (!(card.finishes || []).includes(rarity)) { fail(key, rarity, 'the finish is not in cards.json'); continue; }
    if (!v2s.has(key)) {
      if (OFFLINE) v2s.set(key, key in facesFile.faces ? facesFile.faces[key] : { error: 'not in the face export' });
      else v2s.set(key, await loadFaceV2(db, card).catch((e) => ({ error: e.message || String(e) })));
    }
    if (isBlocked()) return 5;
    const v2 = v2s.get(key);
    if (v2?.error) { fail(key, rarity, `face data: ${v2.error}`); continue; }
    console.log(`FACE ${key} ${rarity} ${faceLine(v2)}`);
    if (!v2) { fail(key, rarity, 'face v1'); continue; }
    const inp = await faceInputs(card, rarity, v2, code, resolve);
    if (!inp.art) { fail(key, rarity, 'no art'); continue; }
    console.log(`ART ${key} ${rarity} ${relative(ROOT, inp.art).replace(/\\/g, '/')} ${inp.fpParts.art}`);
    const anim = ANIMATED.has(rarity);
    const facePng = join(OUT, `${key}-${rarity}.png`), face2 = join(OUT, `${key}-${rarity}-twice.png`);
    const webp = join(OUT, `${key}-${rarity}.webp`), frames = join(OUT, `frames-${key}-${rarity}`);
    const maskPng = join(OUT, `${key}-${rarity}-mask.png`), textMask = join(OUT, `${key}-${rarity}-textmask.png`), text2 = join(OUT, `${key}-${rarity}-textmask-twice.png`);
    let result = null, checks = null, why = null, attempt = 0, thumbs = null;
    for (attempt = 0; attempt < 3; attempt++) {
      // a file that cannot be removed (a handle of another process) is overwritten by the render: a warning, not a crash of the run
      for (const f of [facePng, face2, webp, maskPng, textMask, text2, frames]) {
        try { rmSync(f, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.log(`WARN cleanup ${f} ${e.code || e.message}`); }
      }
      let file;
      try {
        ({ file } = await renderTier({ ...card, v2 }, rarity, (r) => resolve(card.id, artKeyFor(r)), OUT));
      } catch (e) {
        if (isBlocked()) return 5;
        why = `render: ${(e.message || String(e)).split('\n')[0]}`; if (attempt < 2) console.log(`RETRY ${id} ${why}`); continue;
      }
      // the 2nd render of the face (and of the text mask), with the same input as renderTier (src/push.js: eff, scale, frame, artist)
      const eff = { ...card, v2, ...inp.slotDet };
      await renderPng(eff, rarity, inp.art, face2, anim ? 2 : 1, false, inp.frame, inp.artist);
      if (anim) await renderPng(eff, rarity, inp.art, text2, 2, 'text');
      if (plant && plantId === id) await doPlant(sharp, plant, attempt, { facePng, face2, textMask, text2 });
      checks = {};
      const fails = [];
      const f0 = await fc.faceCheck(readFileSync(facePng)); checks.face = f0;
      for (const m of failedOf(f0, false, fc)) fails.push(`face ${m}`);
      const d = await pixelDiff(sharp, facePng, face2); checks.twice = d;
      if (!d.equal) fails.push('twice-differ');
      if (anim) {
        if (rarity !== 'gold') { const c = await fc.faceCheck(readFileSync(maskPng)); checks.mask = c; for (const m of failedOf(c, true, fc)) fails.push(`mask ${m}`); }
        if (!existsSync(textMask)) fails.push('no textmask');
        else {
          const c = await fc.faceCheck(readFileSync(textMask)); checks.textmask = c; for (const m of failedOf(c, true, fc)) fails.push(`textmask ${m}`);
          const t = await pixelDiff(sharp, textMask, text2); checks.textTwice = t;
          if (!t.equal) fails.push('textmask-differ');
        }
        try {
          const wb = readFileSync(webp);
          const md = await sharp(wb, { animated: true }).metadata();
          checks.webp = { pages: md.pages, width: md.width, pageHeight: md.pageHeight };
          if (md.pages !== ANIM_PAGES || md.width !== 500 || md.pageHeight !== 700) fails.push(`webp pages=${md.pages} ${md.width}x${md.pageHeight}`);
          else {
            const p0 = await fc.faceCheck(wb);
            const pl = await fc.faceCheck(await sharp(wb, { page: md.pages - 1 }).png().toBuffer());
            checks.page0 = p0; checks.pageLast = pl;
            for (const m of failedOf(p0, false, fc)) fails.push(`page0 ${m}`);
            for (const m of failedOf(pl, false, fc)) fails.push(`pageLast ${m}`);
          }
        } catch (e) { fails.push(`webp decode: ${(e.message || String(e)).split('\n')[0]}`); }
      }
      // the thumbs (src/thumbs.js, as pushCard makes them) must decode
      if (!fails.length) {
        try {
          thumbs = await makeThumbs(readFileSync(file));
          const g = await sharp(thumbs.grid).metadata(); checks.grid = { width: g.width, height: g.height };
          if (anim) { const r = await sharp(thumbs.reveal, { animated: true }).metadata(); checks.reveal = { width: r.width, pages: r.pages }; if (r.pages !== ANIM_PAGES) fails.push(`reveal pages=${r.pages}`); }
        } catch (e) { fails.push(`thumbs: ${(e.message || String(e)).split('\n')[0]}`); }
      }
      console.log(`CHECK ${id} ${key} ${rarity} ${fails.length ? 'FAIL' : 'ok'} white=${f0.white} blankRows=${f0.blankRows} clear=${f0.clear} clearRows=${f0.clearRows} twice=${d.equal ? 'equal' : `differ px=${d.px}`}${checks.textTwice ? ` textTwice=${checks.textTwice.equal ? 'equal' : `differ px=${checks.textTwice.px}`}` : ''}${checks.webp ? ` pages=${checks.webp.pages}` : ''}${fails.length ? ` why=${fails.join(',')}` : ''}`);
      if (!fails.length) { result = file; why = null; break; }
      why = fails.join(',');
      if (attempt < 2) console.log(`RETRY ${id} ${why}`);
    }
    if (isBlocked()) return 5;
    if (!result) { fail(key, rarity, why); continue; }
    const stamp = Date.now();
    const base = join(STAGE, `${key}-${rarity}-${stamp}`);
    const save = (path, buf) => { writeFileSync(path, buf); return { path: path.replace(/\\/g, '/'), sha256: sha(buf), bytes: buf.length }; };
    const files = { main: save(`${base}.${anim ? 'webp' : 'png'}`, readFileSync(result)), grid: save(`${base}-grid.webp`, thumbs.grid), reveal: anim ? save(`${base}-reveal.webp`, thumbs.reveal) : null };
    if (anim) save(`${base}-face.png`, readFileSync(facePng)); // the still face, for the preview
    const sec = Math.round((Date.now() - t0) / 1000);
    write({ s: 'STAGED', card_id: id, key, rarity, host: hostname(), cls: anim ? 'animated' : 'still', old: row.image_url, files, fp: sha(canon(inp.fpParts)), fpParts: inp.fpParts,
      face: faceLine(v2), checks, sec, attempts: attempt + 1, commit: head, stageSha: scriptSha, tools: tp.tools, toolsSha: tp.toolsSha, stamp, at: now() });
    nStaged += 1;
    console.log(`STAGED ${id} ${key} ${rarity} sec=${sec} attempts=${attempt + 1} bytes=${files.main.bytes + files.grid.bytes + (files.reveal?.bytes || 0)} file=${files.main.path}`);
    try { rmSync(frames, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.log(`WARN cleanup ${frames} ${e.code}`); }
  }
  summary('done');
  return 0;
}

/** The CHECKS test hooks (LOCAL only). */
async function doPlant(sharp, plant, attempt, f) {
  const meta = await sharp(f.facePng).metadata();
  if (plant === 'cut') {
    // the real cut face of UI-68 F1 (rows 1271-1399 of 1400 transparent), scaled to this face
    const b = await sharp(join(ITEM, 'gate', 'fixtures', 'cut-ottozone-s-head-full_art.png')).resize(meta.width, meta.height, { fit: 'fill' }).png().toBuffer();
    writeFileSync(f.facePng, b); writeFileSync(f.face2, b);
  } else if (plant === 'white') {
    const half = Math.round(meta.height / 2);
    const white = await sharp({ create: { width: meta.width, height: half, channels: 4, background: '#ffffff' } }).png().toBuffer();
    for (const p of [f.facePng, f.face2]) writeFileSync(p, await sharp(p).composite([{ input: white, top: meta.height - half, left: 0 }]).png().toBuffer());
  } else if ((plant === 'twice-once' && attempt === 0) || plant === 'twice-always' || (plant === 'text-once' && attempt === 0)) {
    const p = plant === 'text-once' ? f.text2 : f.face2;
    const box = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
    writeFileSync(p, await sharp(p).composite([{ input: box, top: 100, left: 100 }]).png().toBuffer());
  } else return;
  console.log(`TEST planted ${plant} (attempt ${attempt + 1})`);
}

// ================================================================ WRITE COMMANDS (no guard; each prints its write list first)
// The STATIC test of scripts/test-stage-faces.mjs reads this file only up to the line above.
async function writeCommand(cmd, db, target) {
  if (cmd === 'orphans') return orphans(db, target);
  console.log(`refused: ${cmd} is not built yet (S1-FACE B4/B5, before Friday)`);
  return 1;
}

/** B10 (Nathan (1), SPEC v2.2 2.7): back up, re-check and delete ONLY the fixed list <item>/gate/orphans-17.txt (<name><TAB><bytes>).
 * cards/card-back.png is a named exclusion: never a candidate, and a list file that holds it is refused. Do NOT run before review OK. */
const CARD_BACK = 'cards/card-back.png';
async function orphans(db, target) {
  const out = val('--out') || join(ITEM, 'work', 'orphans-backup');
  const listFile = val('--list') || join(ITEM, 'gate', 'orphans-17.txt');
  const { publicUrl } = await import('../src/storage-url.js');
  const fixedList = readFileSync(listFile, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => { const [name, bytes] = l.split('\t'); return { name, size: Number(bytes) }; });
  if (fixedList.some((o) => o.name === CARD_BACK)) { console.log(`refused: ${listFile} holds ${CARD_BACK}`); return 1; }
  const used = async () => {
    const set = new Set();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('cards').select('id, image_url').order('id').range(from, from + 999);
      if (error) throw new Error(`cards: ${error.message}`);
      for (const r of data) { const o = objectOf(r.image_url); if (o) set.add(o); }
      if (data.length < 1000) break;
    }
    return set;
  };
  const all = await listAll(db);
  const u1 = await used();
  // the live candidate set: cards/ objects (not cards/face2/) that no cards.image_url uses, minus the card back
  const found = all.filter((o) => /^cards\/[^/]+$/.test(o.name) && !u1.has(o.name) && o.name !== CARD_BACK);
  const fixed = new Map(fixedList.map((o) => [o.name, o.size]));
  const plus = found.filter((o) => !fixed.has(o.name)).map((o) => o.name);
  const minus = fixedList.filter((o) => !found.some((x) => x.name === o.name)).map((o) => o.name);
  const size = found.filter((o) => fixed.has(o.name) && fixed.get(o.name) !== o.size).map((o) => `${o.name}:${o.size}!=${fixed.get(o.name)}`);
  const list = found.filter((o) => fixed.has(o.name));
  const total = list.reduce((t, o) => t + o.size, 0);
  console.log(`ORPHANS list n=${list.length} bytes=${total} target=${target}`);
  for (const o of list) console.log(`  WILL DELETE ${o.name} ${o.size}`);
  if (plus.length || minus.length) { console.log(`refused: list differs ${[...plus.map((n) => '+' + n), ...minus.map((n) => '-' + n)].join(' ')}`); return 1; }
  if (size.length) { console.log(`refused: size differs ${size.join(' ')}`); return 1; }
  if (flag('--dry')) { console.log('ORPHANS DRY (nothing written)'); return 0; }
  // backup with sha, before any delete
  const bl = [];
  for (const o of list) {
    const res = await fetch(publicUrl(db, BUCKET, o.name));
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length !== o.size) { console.log(`refused: backup ${o.name} http=${res.status} bytes=${buf.length} listed=${o.size}`); return 1; }
    const f = join(out, o.name); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, buf);
    bl.push({ name: o.name, sha256: sha(buf), bytes: buf.length, contentType: res.headers.get('content-type') });
  }
  writeFileSync(join(dirname(out), 'orphans-backup.jsonl'), bl.map((x) => JSON.stringify(x)).join('\n') + '\n');
  // re-check: still unused now
  const u2 = await used();
  const again = list.filter((o) => u2.has(o.name));
  if (again.length) { console.log(`refused: now used: ${again.map((o) => o.name).join(',')}`); return 1; }
  const { error } = await db.storage.from(BUCKET).remove(list.map((o) => o.name));
  if (error) { console.log(`ERROR delete: ${error.message}`); return 1; }
  let gone = 0;
  for (const o of list) { const r = await fetch(publicUrl(db, BUCKET, o.name)); if (r.status === 400 || r.status === 404) gone += 1; else console.log(`STILL THERE ${o.name} http=${r.status}`); }
  const ok = gone === list.length;
  console.log(`ORPHANS ${ok ? 'PASS' : 'FAIL'} deleted=${gone} bytes=${total} backup=${bl.length}`);
  return ok ? 0 : 1;
}

// process.exitCode, not process.exit: an exit while fetch sockets close crashes node on Windows
const rc = await main().catch((e) => { console.log(`ERROR ${(e.message || String(e)).split('\n')[0]}`); return 1; });
process.exitCode = isBlocked() ? 5 : rc;
