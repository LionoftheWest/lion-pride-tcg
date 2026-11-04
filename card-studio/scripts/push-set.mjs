import './localdb-guard.mjs';
/**
 * Push the cards of one set, in cards.json order, with a log (S2-PUB). The same code path as the studio push (src/push.js pushCard)
 * and the same art resolver (src/artsources.js resolveArtFile: _sources.json first).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/push-set.mjs --set S2 [--only k1,k2] [--dry]    the LOCAL copy
 *   node scripts/push-set.mjs --set S2 [--only k1,k2] [--dry] --live                                              the LIVE project
 * Without the preload and without --live it refuses (the token in .env is the live one).
 * CARDS_FILE: the cards file to read (default: the repo cards.json). Only a --live run writes pushedAt into it.
 * Selection: the cards of --set in cards.json order that have a finish with no cards row on the target (subject key + rarity),
 * or, with --only, exactly the named cards. Fail-fast: the first error stops the run (STOPPED at <key>), so a second run continues
 * with that card and the numbers stay in order.
 * Lines (the gate reads them):
 *   CARDS_FILE <path> sha256=<x>                                   first line
 *   ART <key> <finish> <path relative to card-studio> <sha256>    every finish of a card, before its push
 *   WOULD PUSH <key>                                               --dry
 *   ROW <key> <finish> id=<row id> number=<set_number> image_url=<url>   read from the target after the push
 *   PUSHED <key> <n> tiers numbers=<list>
 *   ERROR <key>: <message> / STOPPED at <key>
 *   SUMMARY pushed=<n> errors=<n> selected=<n> target=<LOCAL <url>|LIVE <ref>>   last line
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_REF = 'kgvdqqehefezbypozvrh';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const SET = val('--set');
const ONLY = val('--only') ? val('--only').split(',').map((s) => s.trim()).filter(Boolean) : null;
const DRY = flag('--dry');
const LIVE = flag('--live');

async function main() {
  if (!SET || SET.startsWith('--')) { console.error('usage: node scripts/push-set.mjs --set <id> [--only <k1,k2>] [--dry] [--live]'); return 1; }
  const local = globalThis.__LOCALDB_API || null; // set only by the localdb preload
  if (!local && !LIVE) { console.log('refused: the target is LIVE (use --live)'); return 1; }
  if (local && LIVE) { console.log('refused: --live with the localdb preload (the target would be LOCAL)'); return 1; }
  if (LIVE && !new RegExp(`^https://${LIVE_REF}\\.supabase\\.co`).test(process.env.SUPABASE_URL || '')) {
    // dotenv has not run yet: read the .env value the client will use
    const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
    const url = process.env.SUPABASE_URL || env.SUPABASE_URL || '';
    if (!new RegExp(`^https://${LIVE_REF}\\.supabase\\.co`).test(url)) { console.log(`refused: the live project is not ${LIVE_REF}`); return 1; }
  }
  const target = local ? `LOCAL ${local}` : `LIVE ${LIVE_REF}`;

  const cardsPath = process.env.CARDS_FILE || join(ROOT, 'cards.json');
  const raw = readFileSync(cardsPath);
  console.log(`CARDS_FILE ${process.env.CARDS_FILE || 'cards.json'} sha256=${createHash('sha256').update(raw).digest('hex')}`);
  const cards = JSON.parse(raw.toString('utf8')).filter((c) => c.set === SET);

  // These imports read .env and the cards file (CARDS_FILE) at load time: after the target checks above.
  const { supabase } = await import('../src/supabase.js');
  const { pushCard } = await import('../src/push.js');
  const { artKeyFor } = await import('../src/rarity.js');
  const { resolveArtFile } = await import('../src/artsources.js');
  const { updateCard } = await import('../src/cardstore.js');

  let pushed = 0, errors = 0, selected = 0;
  const summary = () => console.log(`SUMMARY pushed=${pushed} errors=${errors} selected=${selected} target=${target}`);
  const stop = (key, msg) => { errors += 1; console.log(`ERROR ${key}: ${msg}`); console.log(`STOPPED at ${key}`); summary(); return 1; };

  if (ONLY) for (const k of ONLY) if (!cards.some((c) => c.id === k)) return stop(k, `not a card of set ${SET} in ${process.env.CARDS_FILE || 'cards.json'}`);

  // The rows that exist on the target (subject key + rarity), every set.
  const have = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('cards').select('rarity, subject:subjects!inner(key)').order('id').range(from, from + 999);
    if (error) return stop(SET, `cards: ${error.message}`);
    for (const r of data) have.add(`${r.subject.key}|${r.rarity}`);
    if (data.length < 1000) break;
  }
  const todo = ONLY ? cards.filter((c) => ONLY.includes(c.id)) : cards.filter((c) => (c.finishes || []).some((f) => !have.has(`${c.id}|${f}`)));
  selected = todo.length;
  const outDir = join(ROOT, 'out', 'push-set');
  mkdirSync(outDir, { recursive: true });

  for (const card of todo) {
    // Every finish must have its art before anything of this card is written.
    for (const f of card.finishes || []) {
      const file = resolveArtFile(card.id, artKeyFor(f));
      if (!file) return stop(card.id, `${f} has no art`);
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      console.log(`ART ${card.id} ${f} ${relative(ROOT, file).replace(/\\/g, '/')} ${sha}`);
    }
    if (DRY) { console.log(`WOULD PUSH ${card.id}`); continue; }
    console.error(`[push-set] ${new Date().toISOString()} rendering ${card.id} (${card.finishes.length} tiers)`);
    try {
      await pushCard(card, (r) => resolveArtFile(card.id, artKeyFor(r)), outDir);
    } catch (e) {
      return stop(card.id, e.message || String(e));
    }
    const { data: rows, error } = await supabase.from('cards').select('id, rarity, set_number, image_url, subject:subjects!inner(key)').eq('subject.key', card.id);
    if (error) return stop(card.id, `read back: ${error.message}`);
    const byRarity = new Map(rows.map((r) => [r.rarity, r]));
    const nums = [];
    for (const f of card.finishes) {
      const r = byRarity.get(f);
      if (!r) return stop(card.id, `read back: no cards row for ${f}`);
      nums.push(r.set_number);
      console.log(`ROW ${card.id} ${f} id=${r.id} number=${r.set_number} image_url=${r.image_url}`);
    }
    console.log(`PUSHED ${card.id} ${card.finishes.length} tiers numbers=${nums.join(',')}`);
    pushed += 1;
    if (LIVE) updateCard(card.id, { pushedAt: Date.now() }); // only a LIVE push stamps the cards file (S2-PUB INV-6)
  }
  summary();
  return 0;
}

// process.exitCode, not process.exit: an exit while fetch sockets close crashes node on Windows
process.exitCode = await main();
