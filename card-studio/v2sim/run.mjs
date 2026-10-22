// run.mjs - the v2sim CLI.
//   node card-studio/v2sim/run.mjs <experiment|all> [--runs N] [--seed S] [--config file.json] [--patch '{"v2_x": {...}}'] [--tag name]
// Experiments: fairness, shapes, survival, stat-weights, speed, statuses, archetypes, pp, targets, teams, monsters (--tier Mythic), shares, auto and answers (PR E8,
// auto.mjs), power and powerpick (PR E9, power.mjs), lab12 (the Combat Lab L1 and L2, lab12.mjs; --seeds K) and
// lab12prices (the price effect of the L1/L2 variants; after lab12); all = every experiment except targets, teams,
// monsters, shares, auto, answers, power, powerpick, lab12 and lab12prices.
// Reports go to card-studio/out/v2sim/<experiment>[-tag].md (out/ is not committed). targets also writes <...>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPERIMENTS } from './experiments.mjs';
import { targets } from './targets.mjs';
import { teams } from './teams.mjs';
import { monsters } from './monsters.mjs';
import { shares } from './shares.mjs';
import { autoLab, answersExperiment, pairOf } from './auto.mjs';
import { powerLab, powerPickLab } from './power.mjs';
import { lab12, lab12prices } from './lab12.mjs';
import { HERE, loadConfig, patch } from './util.mjs';

const ALL = { ...EXPERIMENTS, targets, teams, monsters, shares, auto: autoLab, answers: answersExperiment, power: (c, o) => powerLab(c, { ...o, pairOf }), powerpick: powerPickLab, lab12, lab12prices };
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const name = args[0];
if (!name || (name !== 'all' && !ALL[name])) {
  console.log(`usage: node run.mjs <${Object.keys(ALL).join('|')}|all> [--runs N] [--seed S] [--config file] [--patch json] [--tag name] [--tier Heroic|Mythic]`);
  process.exit(name ? 1 : 0);
}
let cfg = loadConfig(opt('config'));
if (opt('patch')) cfg = patch(cfg, JSON.parse(opt('patch')));
const runs = opt('runs') ? Number(opt('runs')) : undefined, seed = opt('seed') ? Number(opt('seed')) : 1;
const tag = opt('tag') ? `-${opt('tag')}` : '';
const outDir = join(HERE, '..', 'out', 'v2sim'); mkdirSync(outDir, { recursive: true });
const list = name === 'all' ? Object.keys(EXPERIMENTS) : [name];
for (const n of list) {
  const t0 = Date.now();
  const r = ALL[n](cfg, { ...(runs ? { runs } : {}), seed, ...(opt('tier') ? { tier: opt('tier') } : {}), ...(opt('seeds') ? { seeds: Number(opt('seeds')) } : {}) });
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  const md = r.md + `\n---\nRun: \`node card-studio/v2sim/run.mjs ${n}${runs ? ` --runs ${runs}` : ''} --seed ${seed}${opt('tier') ? ` --tier ${opt('tier')}` : ''}${opt('seeds') ? ` --seeds ${opt('seeds')}` : ''}${opt('patch') ? ` --patch '${opt('patch')}'` : ''}\`, ${s} s.\n\n## Headline\n\n` + r.head.map(h => `- ${h}`).join('\n') + '\n';
  writeFileSync(join(outDir, `${n}${tag}.md`), md);
  if (r.data) writeFileSync(join(outDir, `${n}${tag}.json`), JSON.stringify(r.data, null, 1));
  console.log(`\n## ${n} (${s} s) -> out/v2sim/${n}${tag}.md`); for (const h of r.head) console.log(`- ${h}`);
}
