/**
 * The set check (F-2 item 8): each card has a set, a number, art for every finish, and tags from the fixed library.
 *   node scripts/check-sets.mjs                 file mode: cards.json + tag-vocab.json (+ the art folder, if it exists)
 *   LOCALDB=1 node scripts/check-sets.mjs       also reads the LOCAL copy (cards, card_sets): set exists, numbers, pushed art
 *   node scripts/check-sets.mjs --set S2        check only set S2, and strictly
 *   node scripts/check-sets.mjs --strict-all    check every set strictly (an in-progress set fails too)
 * Exit 1 when a STRICT set has a defect. A set in sets-in-progress.json (and not pullable in the database) is reported as
 * "in progress": its defects are shown but do not fail. Read only: it never writes a file or a row.
 *
 * Rules (the rule name is in the report):
 *   a tier may have its own set (cards.json tierDetails[finish].set, src/tier-set.js): the tier counts for THAT set (its row, its
 *            number, its art), and the home set of the card does not require it
 *   set      each subject in cards.json has a "set" (no set key = a defect)
 *   set-db   (DB mode) the set exists in card_sets, and each finish has a cards row in that home set
 *   art      each finish has art: an art file (art/<id>-<finish>.*, or the file of its "pull art from" source) or, in DB mode,
 *            a cards row with an image_url. Skipped (said in the report) when there is no art folder and no database.
 *   tag      class is attacker|support, type matches the card type, origin has a value, and each origin/genre/realm/traits
 *            value is in tag-vocab.json (the subject line is compared as text, with accents and case ignored)
 *   number   (DB mode) the set_numbers of a set are 1..n: no gap, no duplicate
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLASSES = ['attacker', 'support'];
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s_-]+/g, '-');
// The set a finish is printed in: its own set (tierDetails[finish].set), else the home set of the card.
const finishSet = (c, f) => c.tierDetails?.[f]?.set || c.set;
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

/**
 * The pure check. Input:
 *   cards     the cards.json list      vocab   tag-vocab.json      inProgress  set ids that are in progress
 *   art       null (not checked) or (id, finish) => boolean         only        a set id: check only it, strictly
 *   db        null or { sets: [{id, pullable}], cards: [{key, rarity, set_id, set_number, image_url}] }
 * Returns { sets: [{ id, cards, strict, status, counts, findings }], defects, failing, artChecked }.
 */
export function checkSets({ cards, vocab, inProgress = [], art = null, only = null, db = null, strictAll = false }) {
  const findings = [];
  const add = (set, card, rule, msg) => findings.push({ set, card, rule, msg });
  const dbSets = db ? new Map(db.sets.map((s) => [s.id, s])) : null;
  const rows = new Map(); // `${key}|${finish}` -> row
  if (db) for (const r of db.cards) rows.set(`${r.key}|${r.rarity}`, r);

  for (const c of cards) {
    const set = c.set || '(none)';
    if (!c.set) add(set, c.id, 'set', 'the card has no set');
    else if (dbSets && !dbSets.has(c.set)) add(set, c.id, 'set-db', `the set ${c.set} is not in card_sets`);
    for (const f of c.finishes || []) {
      const fs = finishSet(c, f);
      const fset = fs || '(none)';
      // a tier of another set: that set must exist too (the home set was checked above)
      if (fs && fs !== c.set && dbSets && !dbSets.has(fs)) add(fset, c.id, 'set-db', `the set ${fs} of the ${f} tier is not in card_sets`);
      const row = rows.get(`${c.id}|${f}`);
      if (db && fs && dbSets.has(fs)) {
        if (!row) add(fset, c.id, 'set-db', `finish ${f} has no cards row (not pushed)`);
        else if (row.set_id !== fs) add(fset, c.id, 'set-db', `finish ${f} is in set ${row.set_id} in the database, not ${fs}`);
      }
      if (art || db) {
        const has = (art && art(c.id, f)) || Boolean(row && row.image_url);
        if (!has) add(fset, c.id, 'art', `finish ${f} has no art`);
      }
    }
    // tags
    const t = c.tags || {};
    if (!CLASSES.includes(t.class)) add(set, c.id, 'tag', `class "${t.class ?? ''}" is not ${CLASSES.join(' or ')}`);
    if (!t.type || norm(t.type) !== norm(c.type)) add(set, c.id, 'tag', `tag type "${t.type ?? ''}" does not match the card type "${c.type ?? ''}"`);
    if (list(t.origin).length === 0) add(set, c.id, 'tag', 'origin is empty');
    for (const facet of ['origin', 'genre', 'realm', 'traits']) {
      const have = new Set((vocab.facets[facet]?.values || []).map((v) => v.slug));
      for (const v of list(t[facet])) if (!have.has(String(v))) add(set, c.id, 'tag', `${facet} value "${v}" is not in the library`);
    }
    const subj = new Set((vocab.facets.subject?.values || []).map((v) => norm(v.label)));
    if (c.genre && !subj.has(norm(c.genre))) add(set, c.id, 'tag', `subject line "${c.genre}" is not in the library`);
  }

  // numbers (DB mode): per home set, 1..n
  if (db) {
    const bySet = new Map();
    for (const r of db.cards) {
      if (!bySet.has(r.set_id)) bySet.set(r.set_id, []);
      bySet.get(r.set_id).push(r.set_number);
    }
    for (const [sid, nums0] of bySet) {
      const nums = [...nums0].sort((a, b) => a - b);
      const seen = new Set();
      for (const n of nums) { if (seen.has(n)) add(sid, null, 'number', `the number ${n} is used twice`); seen.add(n); }
      const max = nums.length ? nums[nums.length - 1] : 0;
      const gaps = [];
      for (let n = 1; n <= max; n++) if (!seen.has(n)) gaps.push(n);
      if (gaps.length) add(sid, null, 'number', `gap in the numbers: ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? ', ...' : ''}`);
    }
  }

  const setsOf = (c) => [...new Set([c.set || '(none)', ...(c.finishes || []).map((f) => finishSet(c, f) || '(none)')])];
  const ids = [...new Set([...cards.flatMap(setsOf), ...findings.map((f) => f.set)])].sort();
  const sets = ids.filter((id) => !only || id === only).map((id) => {
    const mine = findings.filter((f) => f.set === id);
    const counts = { set: 0, 'set-db': 0, art: 0, tag: 0, number: 0 };
    for (const f of mine) counts[f.rule] += 1;
    const pullable = Boolean(dbSets && dbSets.get(id)?.pullable);
    const strict = Boolean(only) || strictAll || pullable || !inProgress.includes(id);
    const status = mine.length === 0 ? 'OK' : strict ? 'DEFECT' : 'IN PROGRESS';
    return { id, cards: cards.filter((c) => setsOf(c).includes(id)).length, strict, status, counts, findings: mine };
  });
  const defects = sets.reduce((n, s) => n + s.findings.length, 0);
  return { sets, defects, failing: sets.some((s) => s.status === 'DEFECT'), artChecked: Boolean(art || db) };
}

export function formatReport(res) {
  const out = [];
  const pad = (s, n) => String(s).padEnd(n);
  out.push(`${pad('set', 8)}${pad('cards', 7)}${pad('set', 5)}${pad('set-db', 8)}${pad('art', 5)}${pad('tag', 5)}${pad('number', 8)}status`);
  for (const s of res.sets) out.push(`${pad(s.id, 8)}${pad(s.cards, 7)}${pad(s.counts.set, 5)}${pad(s.counts['set-db'], 8)}${pad(s.counts.art, 5)}${pad(s.counts.tag, 5)}${pad(s.counts.number, 8)}${s.status}`);
  if (!res.artChecked) out.push('(art: not checked, there is no art folder and no database)');
  for (const s of res.sets) {
    if (!s.findings.length) continue;
    out.push('', `${s.id} (${s.status}${s.strict ? '' : ', not counted'}):`);
    for (const f of s.findings) out.push(`  [${f.rule}] ${f.card ?? '(set)'}: ${f.msg}`);
  }
  out.push('', res.failing ? 'RESULT: FAIL (a set that must be clean has defects)' : 'RESULT: OK');
  return out.join('\n');
}

// ---- the real inputs ----
function artFinder(artDir) {
  if (!existsSync(artDir)) return null;
  const files = readdirSync(artDir);
  let sources = {};
  try { sources = JSON.parse(readFileSync(join(artDir, '_sources.json'), 'utf8')); } catch { /* none */ }
  const file = (id, slot) => files.some((n) => n.startsWith(`${id}-${slot}.`));
  return (id, slot) => { const s = (sources[id] || {})[slot]; return s ? file(s.fromId, s.fromSlot) : file(id, slot); };
}

async function readLocalDb() {
  const file = process.env.LOCALDB_ENV || join(process.env.TEMP || '/tmp', 'localdb.env');
  const env = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  const get = async (path) => {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `${from}-${from + 999}` } });
      if (!r.ok) throw new Error(`local db ${path}: ${r.status} ${await r.text()}`);
      const page = await r.json();
      all.push(...page);
      if (page.length < 1000) return all;
    }
  };
  const sets = await get('card_sets?select=id,pullable&order=id');
  const cards = (await get('cards?select=rarity,set_id,set_number,image_url,subject:subjects(key)&order=id')).map((r) => ({ key: r.subject?.key, rarity: r.rarity, set_id: r.set_id, set_number: r.set_number, image_url: r.image_url }));
  return { sets, cards };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const only = args.includes('--set') ? args[args.indexOf('--set') + 1] : null;
  const cards = JSON.parse(readFileSync(join(root, 'cards.json'), 'utf8'));
  const vocab = JSON.parse(readFileSync(join(root, 'tag-vocab.json'), 'utf8'));
  const inProgress = JSON.parse(readFileSync(join(root, 'sets-in-progress.json'), 'utf8')).sets;
  const db = process.env.LOCALDB === '1' ? await readLocalDb() : null;
  const res = checkSets({ cards, vocab, inProgress, art: artFinder(join(root, 'art')), only, db, strictAll: args.includes('--strict-all') });
  console.log(formatReport(res));
  process.exit(res.failing ? 1 : 0);
}
