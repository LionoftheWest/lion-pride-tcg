// Every boss name the weekly spawn can pick must map to a rigged model boss, and
// every model boss must have a bestiary entry. Reads the newest spawn_hunt migration. Run: node tools/check-boss-names.mjs
import { readFileSync } from 'node:fs';
import { modelFor, MODEL_BOSSES } from '../src/boss-models.js';
import { BOSS_LIST } from '../src/boss-meta.js';

const sql = readFileSync(new URL('../../tcg-bot/supabase/hunt_kerrigan_boss.sql', import.meta.url), 'utf8');
const arr = sql.match(/c_names text\[\] := array\[([\s\S]*?)\];/)[1];
const names = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]);
let bad = 0;
const seen = new Set();
for (const n of names) {
  const k = modelFor(n);
  if (!k) { console.log(`FAIL no model for "${n}"`); bad++; continue; }
  if (seen.has(k)) { console.log(`FAIL two names map to ${k}`); bad++; }
  seen.add(k);
  console.log(`ok  ${n} -> ${k}`);
}
for (const k of Object.keys(MODEL_BOSSES)) {
  if (!seen.has(k)) { console.log(`FAIL model ${k} is never spawned`); bad++; }
  if (!BOSS_LIST.some((b) => b.arch === k)) { console.log(`FAIL model ${k} has no bestiary entry`); bad++; }
}
// The procedural archetypes must still resolve to themselves, not to a model.
for (const b of BOSS_LIST.filter((x) => !MODEL_BOSSES[x.arch])) {
  if (modelFor(`arch:${b.arch} ${b.title}`)) { console.log(`FAIL procedural ${b.arch} resolves to a model`); bad++; }
}
console.log(bad ? `${bad} FAILED` : `PASS ${names.length} names`);
process.exit(bad ? 1 : 0);
