/**
 * Sync each card's type, tags and Hunt ability from cards.json to its subject (the DB
 * trigger re-flattens tag_slugs from tags). push.js writes these only on a full render.
 *   node scripts/push-abilities.mjs          write
 *   node scripts/push-abilities.mjs --dry    show what would change, write nothing
 * cards.json is the source of truth. Every ability is checked against the kinds the
 * engine has (hunt_attack / hunt_support) first, so a typo cannot reach the players.
 *
 * Combat v2 (PR T1, plan 12.1): a batch file of the studio ability builder -> subjects.ability_v2.
 *   node scripts/push-abilities.mjs --v2 <batch.json> [--dry]
 * A batch file is {rows: [{key, role, ability: {name, blocks, silver?}}]} (the builder writes it; the default folder is the PRIVATE
 * <repo parent>/discord-card-ideas/batches, or ABILITY_V2_BATCH_DIR: a batch holds unreleased card designs, never this repo). Every row is
 * checked with ability_v2_check on the TARGET database first: one refused row = nothing is written. Then each subject whose ability_v2 differs
 * is written ({role, name, blocks, silver}); the trigger subjects_ability_v2_check checks it again. After a push, --dry shows 0 changes.
 * The measured active factor of the Hunt auto-pick (plan 20.10): --factors <file> (the PRIVATE file of node card-studio/v2sim/run.mjs factors --set1,
 * <batch>.factors.json beside the batch) adds pick_factor to each support row that has one ({role, name, blocks, silver, pick_factor}). The file is
 * checked against the batch first (v2sim/factors.mjs: a changed active, an attacker row, a key not in the batch or a factor outside 0.5 to 2 = nothing
 * is written). The factor belongs to the active: a push without --factors writes no pick_factor (the pick uses 1).
 * Without LOCALDB=1 (and the preload) the target is LIVE.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supabase } from '../src/supabase.js';
import { readFactors } from '../v2sim/factors.mjs';

const DRY = process.argv.includes('--dry');
const canon = (v) => JSON.stringify(v ?? null, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
// (process.exitCode, not process.exit: an exit while fetch sockets close crashes node on Windows)
if (process.argv.includes('--v2')) process.exitCode = await pushV2(process.argv[process.argv.indexOf('--v2') + 1]);
else await pushV1();

async function pushV1() {
  const cards = JSON.parse(readFileSync(fileURLToPath(new URL('../cards.json', import.meta.url)), 'utf8'));

  const TYPES = ['Character', 'Creature', 'Moment', 'Item', 'Place'];
  const ATTACK = ['focus', 'pierce', 'execute', 'lifesteal', 'rampage'];
  const SUPPORT = ['weaken', 'heal', 'expose', 'cleanse', 'stun', 'shield', 'smite', 'empower'];
  const bad = [];
  for (const c of cards) {
    if (c.type != null && !TYPES.includes(c.type)) bad.push(`${c.id}: unknown type "${c.type}"`);
    const a = c.ability;
    if (!a) continue;
    if (!a.name) bad.push(`${c.id}: ability without a name`);
    if (a.kind === 'attack') {
      if (!ATTACK.includes(a.effect)) bad.push(`${c.id}: unknown attack effect "${a.effect}"`);
      if (!['Character', 'Creature'].includes(c.type)) bad.push(`${c.id}: an attack ability on a ${c.type} (only Characters and Creatures attack)`);
      if (a.effect !== 'pierce' && !(Number(a.amount) > 0 && Number(a.amount) <= 1)) bad.push(`${c.id}: attack amount must be 0..1`);
      if (a.effect === 'execute' && !(Number(a.threshold) > 0 && Number(a.threshold) < 1)) bad.push(`${c.id}: execute needs a threshold 0..1`);
    } else if (a.kind === 'support') {
      if (!SUPPORT.includes(a.effect)) bad.push(`${c.id}: unknown support effect "${a.effect}"`);
      if (['Character', 'Creature'].includes(c.type)) bad.push(`${c.id}: a support ability on an attacker`);
      if (!a.target || !(Number(a.cooldown) >= 1)) bad.push(`${c.id}: support needs a target and a cooldown >= 1`);
    } else bad.push(`${c.id}: ability kind must be attack or support`);
  }
  if (bad.length) { console.error('Invalid:\n  ' + bad.join('\n  ')); process.exitCode = 1; return; }

  const { data: subs, error } = await supabase.from('subjects').select('id, key, type, tags, ability');
  if (error) { console.error(error.message); process.exitCode = 1; return; }
  const byKey = new Map(subs.map((s) => [s.key, s]));
  let changed = 0, missing = 0;
  for (const c of cards) {
    const s = byKey.get(c.id);
    if (!s) { missing += 1; continue; }
    const want = { type: c.type ?? null, tags: c.tags ?? {}, ability: c.ability ?? null };
    const diff = Object.keys(want).filter((k) => canon(s[k]) !== canon(want[k]));
    if (!diff.length) continue;
    changed += 1;
    console.log(`${DRY ? 'would update' : 'update'} ${c.id}: ${diff.join(', ')}${diff.includes('ability') ? ` (${s.ability?.name || '-'} -> ${c.ability?.name || '-'})` : ''}`);
    if (DRY) continue;
    const { error: ue } = await supabase.from('subjects').update(want).eq('id', s.id);
    if (ue) { console.error(`  failed: ${ue.message}`); process.exitCode = 1; }
  }
  console.log(`${changed} subject(s) ${DRY ? 'would change' : 'changed'}; ${missing} card(s) without a subject.`);
}

// ---- combat v2: a batch file of the ability builder -> subjects.ability_v2 (PR T1)
async function pushV2(file) {
  if (!file || file.startsWith('--')) { console.error('usage: node scripts/push-abilities.mjs --v2 <batch.json> [--factors <file>] [--dry]'); return 1; }
  const fi = process.argv.indexOf('--factors'); const ffile = fi >= 0 ? process.argv[fi + 1] : null;
  if (fi >= 0 && (!ffile || ffile.startsWith('--'))) { console.error('usage: --factors <file> (the factors file of run.mjs factors --set1)'); return 1; }
  let batch;
  try { batch = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`the batch file does not read: ${e.message}`); return 1; }
  const rows = Array.isArray(batch?.rows) ? batch.rows : null;
  if (!rows || !rows.length) { console.error('the batch file has no rows ({rows: [{key, role, ability}]})'); return 1; }
  const bad = [];
  const seen = new Set();
  for (const [i, r] of rows.entries()) {
    if (!r || typeof r.key !== 'string' || typeof r.role !== 'string' || !r.ability || typeof r.ability !== 'object') { bad.push(`row ${i + 1}: needs key, role and ability`); continue; }
    if (seen.has(r.key)) bad.push(`row ${i + 1}: the key ${r.key} is twice in the batch`);
    seen.add(r.key);
    const ability = { name: r.ability.name, blocks: r.ability.blocks, ...(r.ability.silver ? { silver: r.ability.silver } : {}) };
    const { data, error } = await supabase.rpc('ability_v2_check', { p_role: r.role, p_ability: ability });
    if (error) { console.error(`ability_v2_check failed: ${error.message} (is combat_v2_ability_builder.sql applied?)`); return 1; }
    if (!data.ok) bad.push(`row ${i + 1} (${r.key}): ${data.errors.join('; ')}`);
  }
  if (bad.length) { console.error(`Refused (nothing written):\n  ${bad.join('\n  ')}`); return 1; }
  // the measured active factors (plan 20.10): checked against the batch before any write
  let factors = {};
  if (ffile) {
    const fr = readFactors(ffile, rows);
    if (fr.errors.length) { console.error(`Refused (nothing written): the factors file does not match the batch\n  ${fr.errors.join('\n  ')}`); return 1; }
    factors = fr.factors;
    console.log(`factors: ${Object.keys(factors).length} of ${fr.supports} support row(s) have a pick_factor; ${fr.missing} have none (the pick uses 1).`);
  } else console.log('factors: none (no --factors): no pick_factor is written (the pick uses 1).');
  const { data: subs, error } = await supabase.from('subjects').select('id, key, ability_v2');
  if (error) { console.error(error.message); return 1; }
  const byKey = new Map(subs.map((s) => [s.key, s]));
  let changed = 0, missing = 0, failed = 0;
  for (const r of rows) {
    const s = byKey.get(r.key);
    if (!s) { missing += 1; continue; }
    const want = { role: r.role, name: r.ability.name, blocks: r.ability.blocks, ...(r.ability.silver ? { silver: r.ability.silver } : {}),
      ...(factors[r.key] !== undefined ? { pick_factor: factors[r.key] } : {}) };
    if (canon(s.ability_v2) === canon(want)) continue;
    changed += 1;
    console.log(`${DRY ? 'would update' : 'update'} ${r.key}: ability_v2 (${s.ability_v2?.name || '-'} -> ${want.name})`);
    if (DRY) continue;
    const { error: ue } = await supabase.from('subjects').update({ ability_v2: want }).eq('id', s.id);
    if (ue) { console.error(`  failed: ${ue.message}`); failed += 1; }
  }
  console.log(`${changed} subject(s) ${DRY ? 'would change' : 'changed'}; ${missing} row(s) without a subject.`);
  return failed ? 1 : 0;
}
