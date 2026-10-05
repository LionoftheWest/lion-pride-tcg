// Compare two G3 result folders cell by cell (a speed change must not change what the check finds).
//   node compare.mjs <dirA> <dirB>
// A cell's defects are compared by rule and place (evaluate.mjs defectsOf), not by pixel amounts.
// Exit 1 when a cell is in one folder only, or when a cell's defect sets differ.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defectsOf } from './evaluate.mjs';
import { EXPANDED } from './screens.mjs';

const [A, B] = process.argv.slice(2);
const load = (d) => Object.fromEntries(readdirSync(d).filter((f) => f.endsWith('.json') && f !== 'defects.json').map((f) => [f, JSON.parse(readFileSync(join(d, f), 'utf8'))]));
const a = load(A), b = load(B);
const exp = (set, r) => set[`${r.browser}-${EXPANDED}-${r.screen}-base.json`];
const keys = (set, r) => new Set(defectsOf(r, exp(set, r)).map((x) => `${x.rule} ${x.where}`));
let diff = 0, same = 0;
for (const f of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
  if (!a[f] || !b[f]) { console.log(`ONLY IN ${a[f] ? A : B}: ${f}`); diff++; continue; }
  const ka = keys(a, a[f]), kb = keys(b, b[f]);
  const onlyA = [...ka].filter((k) => !kb.has(k)), onlyB = [...kb].filter((k) => !ka.has(k));
  if (onlyA.length || onlyB.length) { diff++; console.log(`DIFF ${f}\n  only A: ${onlyA.slice(0, 4).join(' | ')}\n  only B: ${onlyB.slice(0, 4).join(' | ')}`); } else same++;
}
console.log(`${same} cells the same, ${diff} different`);
process.exit(diff ? 1 : 0);
