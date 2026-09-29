/**
 * Sync each card's type, tags and Hunt ability from cards.json to its subject (the DB
 * trigger re-flattens tag_slugs from tags). push.js writes these only on a full render.
 *   node scripts/push-abilities.mjs          write
 *   node scripts/push-abilities.mjs --dry    show what would change, write nothing
 * cards.json is the source of truth. Every ability is checked against the kinds the
 * engine has (hunt_attack / hunt_support) first, so a typo cannot reach the players.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supabase } from '../src/supabase.js';

const DRY = process.argv.includes('--dry');
const canon = (v) => JSON.stringify(v ?? null, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
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
if (bad.length) { console.error('Invalid:\n  ' + bad.join('\n  ')); process.exit(1); }

const { data: subs, error } = await supabase.from('subjects').select('id, key, type, tags, ability');
if (error) { console.error(error.message); process.exit(1); }
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
