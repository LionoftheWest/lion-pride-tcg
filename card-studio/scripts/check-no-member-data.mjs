/**
 * Gate G5 "Member data" (docs/design.md): no member data in the public repo (Nathan, 2026-10-03:
 * "there should be no personal information of any members in any public repo. All data related to
 * members must be in Supabase, locked behind RLS policy.").
 *
 * Two checks. The gate fails (exit 1) if either check finds a problem.
 *  A. Text: every git-tracked text file is scanned for the member ids, usernames and avatar hashes.
 *  B. Images: every git-tracked image must be REVIEWED. A person opens the image and confirms that
 *     it shows no member name, avatar or member-specific data. The reviewed content hash is in
 *     scripts/member-data-images.json. A new or changed image fails until it is reviewed.
 *     (There is no OCR here: an unreviewed image always fails, so a screenshot cannot slip in.)
 *     An image embedded in a text file (a base64 data:image URI, for example in a .pen design) is
 *     a hit too: it cannot get this review. Save it as an image file instead.
 *
 * Run (from card-studio/):
 *   Local copy (preferred, no live cost):
 *     LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/check-no-member-data.mjs
 *   Live, read-only (two SELECTs, needs SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env):
 *     node scripts/check-no-member-data.mjs
 *   No database (for example CI with a secret file): --members-file <path> or MEMBER_DATA_FILE=<path>.
 *     Make the file with --export-members <path> on a machine with database access. Never commit it.
 *   Images only (no member list needed): --images-only
 * Options:
 *   --show                  also print the matched word. LOCAL USE ONLY: it prints member data.
 *   --card-names            only count the card names that contain a member username.
 *   --review-images <path>  after YOU opened the image and found no member data: record its hash.
 * Exit codes: 0 = clean, 1 = member data or an unreviewed image found, 2 = the check could not run.
 *
 * What is NOT a hit in text:
 * - The card catalog (card-studio/cards.json): card names are published game content.
 * - A username inside a card text (card name, subject key, ability or effect text, for example
 *   "<name>'s Pikachu" or "<name>-s-pikachu"): the card text is masked first.
 * - A word in scripts/member-data-allow.json. The list holds the sha256 of the lowercase word,
 *   never the word, and a reason without a name. Add a word only after a review that it is a
 *   common word or a code identifier at that place, not a member. The output prints the hash.
 * The output prints file:line, the kind (id / username / avatar) and the hash, never the value.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : (argv[i + 1] ?? ''); };
const SHOW = argv.includes('--show');
const CARD_NAMES = argv.includes('--card-names');
const IMAGES_ONLY = argv.includes('--images-only');
const MEMBERS_FILE = opt('--members-file') || process.env.MEMBER_DATA_FILE || '';
const EXPORT = opt('--export-members');
const REVIEW = opt('--review-images');
const MIN_NAME = 4; // a shorter username matches too many ordinary words
const EXCLUDE = [/^card-studio\/cards\.json$/, /^card-studio\/scripts\/member-data-(allow|images)\.json$/];
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|svg|ico)$/i;
const sha = (s) => createHash('sha256').update(s).digest('hex');
// An SVG is text: git can change its line endings on checkout (autocrlf), so hash it with LF only.
const imageHash = (f) => { const b = readFileSync(join(root, f)); return sha(/\.svg$/i.test(f) ? b.toString('utf8').replace(/\r\n/g, '\n') : b); };
// The script returns its exit code instead of process.exit(): on Windows, process.exit() right after a
// fetch() can crash Node (libuv UV_HANDLE_CLOSING assertion, exit 127) and hide the real result.
class CannotRun extends Error {}
const die = (msg) => { throw new CannotRun(msg); };

const here = fileURLToPath(new URL('.', import.meta.url));
const allowFile = join(here, 'member-data-allow.json'), imagesFile = join(here, 'member-data-images.json');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here }).toString().trim();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1e8 }).toString().split('\0').filter(Boolean)
  .filter((f) => !EXCLUDE.some((re) => re.test(f)));

async function main() {
  // B. Images.
  const reviewed = JSON.parse(readFileSync(imagesFile, 'utf8'));
  reviewed.files ??= {};
  if (REVIEW) {
    const f = REVIEW.replace(/\\/g, '/');
    if (!tracked.includes(f) || !IMAGE.test(f)) die(`${f} is not a tracked image (give the path from the repo root)`);
    reviewed.files[f] = imageHash(f);
    reviewed.files = Object.fromEntries(Object.entries(reviewed.files).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(imagesFile, JSON.stringify(reviewed, null, 2) + '\n');
    console.log(`recorded the review of ${f}`);
    return 0;
  }
  const images = tracked.filter((f) => IMAGE.test(f));
  const imageProblems = [];
  for (const f of images) {
    const want = reviewed.files[f];
    if (!want) imageProblems.push(`${f}  image  NOT REVIEWED`);
    else if (want !== imageHash(f)) imageProblems.push(`${f}  image  CHANGED since the review`);
  }
  const imageSummary = `${images.length} images, ${imageProblems.length} not reviewed or changed`;
  if (IMAGES_ONLY) {
    for (const p of imageProblems) console.log(p);
    console.log(`check-no-member-data: ${imageProblems.length ? 'FAIL' : 'PASS'}: ${imageSummary}`);
    return imageProblems.length ? 1 : 0;
  }

  // The member list: a local file, or the database (read-only).
  const q = async (sql) => {
    const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)/)?.[1];
    if (!t || !ref) die('no member list: use LOCALDB=1 with the preload, SUPABASE_URL + SUPABASE_ACCESS_TOKEN, or --members-file');
    let r; try { r = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json(); } catch (e) { die(`the database cannot be reached: ${e.message}`); }
    if (!Array.isArray(r)) die(`the query failed: ${JSON.stringify(r).slice(0, 300)}`);
    return r;
  };
  let players, cardText;
  if (MEMBERS_FILE) {
    let j; try { j = JSON.parse(readFileSync(MEMBERS_FILE, 'utf8')); } catch (e) { die(`the members file cannot be read: ${e.message}`); }
    players = j.players; cardText = j.cardText ?? [];
  } else {
    players = await q('select id, username, avatar from public.players');
    cardText = (await q(`select distinct lower(v) v from (
        select key v from public.subjects union all select name from public.subjects union all select name from public.cards
        union all select x #>> '{}' from public.subjects, jsonb_path_query(coalesce(ability, 'null') || coalesce(effect, 'null'), 'strict $.**') x where jsonb_typeof(x) = 'string'
      ) s where v is not null and length(v) >= ${MIN_NAME}`)).map((r) => r.v);
  }
  if (!Array.isArray(players) || !players.length) die('the member list is empty');
  if (EXPORT) {
    writeFileSync(EXPORT, JSON.stringify({ players, cardText }));
    console.log(`wrote ${players.length} players and ${cardText.length} card texts to ${EXPORT}. It holds member data: never commit it.`);
    return 0;
  }
  cardText = [...new Set(cardText.map((s) => String(s).toLowerCase()))].filter((s) => s.length >= MIN_NAME).sort((a, b) => b.length - a.length);

  const ids = new Set(players.map((p) => String(p.id)).filter((s) => /^\d{15,21}$/.test(s)));
  const avatars = new Set(players.map((p) => p.avatar).filter((a) => typeof a === 'string' && /^(a_)?[0-9a-f]{32}$/.test(a)).map((a) => a.replace(/^a_/, '')));
  const names = [...new Set(players.map((p) => String(p.username ?? '').trim().toLowerCase()).filter((n) => [...n].length >= MIN_NAME))];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A word boundary that also works for non-Latin letters and emoji.
  const nameRe = names.map((n) => [n, new RegExp(`(?<![\\p{L}\\p{N}_])${esc(n)}(?![\\p{L}\\p{N}_])`, 'u')]);

  if (CARD_NAMES) {
    if (MEMBERS_FILE) die('--card-names needs the database');
    const rows = await q('select distinct lower(name) n from public.subjects union select distinct lower(name) from public.cards');
    const hit = rows.filter((c) => nameRe.some(([, re]) => re.test(c.n)));
    console.log(`card names: ${rows.length}, with a member username: ${hit.length}`);
    return 0;
  }

  // A. Text.
  const allow = new Set(Object.keys(JSON.parse(readFileSync(allowFile, 'utf8')).sha256 || {}));
  const mask = (line) => { let l = line.toLowerCase(); for (const c of cardText) if (l.includes(c)) l = l.split(c).join(' '.repeat(c.length)); return l; };
  const hits = [];
  let scanned = 0;
  for (const f of tracked) {
    if (IMAGE.test(f) && !/\.svg$/i.test(f)) continue;
    let buf; try { buf = readFileSync(join(root, f)); } catch { continue; }
    if (buf.includes(0)) continue; // other binary files (models, audio)
    scanned++;
    buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/\d{15,21}/g)) if (ids.has(m[0])) hits.push({ f, line: i + 1, kind: 'id', word: m[0] });
      // An image inside a text file (for example a .pen design or an HTML page) cannot get the image review.
      if (/data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/]{200}/.test(line)) hits.push({ f, line: i + 1, kind: 'embedded-image', word: 'data:image' });
      for (const m of line.toLowerCase().matchAll(/[0-9a-f]{32}/g)) if (avatars.has(m[0])) hits.push({ f, line: i + 1, kind: 'avatar', word: m[0] });
      const low = line.toLowerCase();
      let masked = null;
      for (const [n, re] of nameRe) {
        if (!low.includes(n) || !re.test(low)) continue;
        masked ??= mask(line);
        if (re.test(masked) && !allow.has(sha(n))) hits.push({ f, line: i + 1, kind: 'username', word: n });
      }
    });
  }

  for (const h of hits) console.log(`${h.f}:${h.line}  ${h.kind}  sha256:${sha(h.word)}${SHOW ? `  ${h.word}` : ''}`);
  for (const p of imageProblems) console.log(p);
  const byKind = hits.reduce((a, h) => ((a[h.kind] = (a[h.kind] || 0) + 1), a), {});
  const bad = hits.length + imageProblems.length;
  console.log(`check-no-member-data: ${bad ? 'FAIL' : 'PASS'}: ${players.length} members; ${scanned} text files, ${hits.length} hit(s) ${JSON.stringify(byKind)} in ${new Set(hits.map((h) => h.f)).size} file(s); ${imageSummary}`);
  return bad ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  if (!(e instanceof CannotRun)) throw e;
  console.error(`check-no-member-data: CANNOT RUN: ${e.message}`);
  process.exitCode = 2;
});
