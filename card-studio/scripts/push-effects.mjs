/**
 * Sync each card's boon/prank/neutral effect from cards.json to subjects.effect.
 *   node scripts/push-effects.mjs          write
 *   node scripts/push-effects.mjs --dry    show what would change, write nothing
 * cards.json is the source of truth (the portal edits it). A card without an
 * `effect` clears subjects.effect. Every effect is checked against the
 * effect_primitives registry first, so a typo cannot reach the players.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supabase } from '../src/supabase.js';

const DRY = process.argv.includes('--dry');
// jsonb stores keys in its own order, so compare with sorted keys.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const cards = JSON.parse(readFileSync(fileURLToPath(new URL('../cards.json', import.meta.url)), 'utf8'));

const { data: prims, error: pe } = await supabase.from('effect_primitives').select('primitive');
if (pe) { console.error('Cannot read effect_primitives (is card_effects.sql applied?):', pe.message); process.exitCode = 1; }
else {
  const known = new Set(prims.map((p) => p.primitive));
  const bad = [];
  for (const c of cards) {
    const e = c.effect;
    if (!e) continue;
    if (!known.has(e.primitive)) bad.push(`${c.id}: unknown primitive "${e.primitive}"`);
    if (!e.name) bad.push(`${c.id}: no name`);
    if (!(Number(e.cooldown_h) > 0)) bad.push(`${c.id}: cooldown_h must be > 0`);
    if (e.base && typeof e.base !== 'object') bad.push(`${c.id}: base must be an object`);
  }
  if (bad.length) { console.error('Invalid effects:\n  ' + bad.join('\n  ')); process.exitCode = 1; }
  else {
    const { data: subs, error: se } = await supabase.from('subjects').select('id, key, effect');
    if (se) { console.error(se.message); process.exitCode = 1; }
    else {
      const byKey = new Map(subs.map((s) => [s.key, s]));
      let changed = 0, missing = 0;
      for (const c of cards) {
        const s = byKey.get(c.id);
        if (!s) { if (c.effect) missing++; continue; }
        const want = c.effect || null;
        if (canon(want) === canon(s.effect ?? null)) continue;
        changed++;
        console.log(`${DRY ? '[dry] ' : ''}${c.id}: ${s.effect?.primitive || '-'} -> ${want?.primitive || '-'}${want ? ` (${want.name})` : ''}`);
        if (!DRY) {
          const { error } = await supabase.from('subjects').update({ effect: want }).eq('id', s.id);
          if (error) { console.error(`  FAILED ${c.id}: ${error.message}`); process.exitCode = 1; }
        }
      }
      console.log(`${changed} changed${DRY ? ' (dry run, nothing written)' : ''}; ${missing} card(s) with an effect are not pushed to Supabase yet.`);
    }
  }
}
