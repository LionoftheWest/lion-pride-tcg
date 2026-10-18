// run.mjs - the v2sim CLI.
//   node card-studio/v2sim/run.mjs <experiment|all> [--runs N] [--seed S] [--config file.json] [--patch '{"v2_x": {...}}']
// Experiments: fairness, shapes, survival, stat-weights, speed, statuses, archetypes, pp, all.
// Reports go to card-studio/out/v2sim/<experiment>.md (out/ is not committed).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPERIMENTS } from './experiments.mjs';
import { HERE, loadConfig, patch } from './util.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const name = args[0];
if (!name || (name !== 'all' && !EXPERIMENTS[name])) {
  console.log(`usage: node run.mjs <${Object.keys(EXPERIMENTS).join('|')}|all> [--runs N] [--seed S] [--config file] [--patch json]`);
  process.exit(name ? 1 : 0);
}
let cfg = loadConfig(opt('config'));
if (opt('patch')) cfg = patch(cfg, JSON.parse(opt('patch')));
const runs = opt('runs') ? Number(opt('runs')) : undefined, seed = opt('seed') ? Number(opt('seed')) : 1;
const outDir = join(HERE, '..', 'out', 'v2sim'); mkdirSync(outDir, { recursive: true });
const list = name === 'all' ? Object.keys(EXPERIMENTS) : [name];
for (const n of list) {
  const t0 = Date.now();
  const r = EXPERIMENTS[n](cfg, { ...(runs ? { runs } : {}), seed });
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  const md = r.md + `\n---\nRun: \`node card-studio/v2sim/run.mjs ${n}${runs ? ` --runs ${runs}` : ''} --seed ${seed}${opt('patch') ? ` --patch '${opt('patch')}'` : ''}\`, ${s} s.\n\n## Headline\n\n` + r.head.map(h => `- ${h}`).join('\n') + '\n';
  writeFileSync(join(outDir, `${n}.md`), md);
  console.log(`\n## ${n} (${s} s) -> out/v2sim/${n}.md`); for (const h of r.head) console.log(`- ${h}`);
}
