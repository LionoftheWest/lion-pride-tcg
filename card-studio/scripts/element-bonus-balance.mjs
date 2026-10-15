/**
 * Element bonus measuring tool (F-3, rule A). LOCAL copy only. No game change, nothing stays on the copy.
 *
 *   LAB_LOCK_OWNER=<name> LOCALDB=1 node scripts/element-bonus-balance.mjs --candidate ../tcg-bot/supabase/f3_element_bonus.sql [--options today,b115,...] [--runs 14] [--quick] [--out dir]
 *
 * Each OPTION is a set of balance values for combat.element_bonus and combat.element_penalty. For every option the tool plays the SAME seeded
 * whole runs (the real generated days, the Auto button) with the real fight functions. Every request is one undone block: the candidate
 * migration first, then the option's patch (through the real balance trigger: a value outside the limits is refused), then the runs.
 * The tool never calculates combat. It only chooses the squads.
 *
 * Squad shapes (all NORMAL cards, 0, 1 and 3 stars, the same cards for every option):
 *   stack     2 random attackers + 3 random supports (support stacking)
 *   mixed     3 random attackers + 2 random supports
 *   control   4 random attackers + 1 random support
 *   covered   4 attackers of 4 DIFFERENT elements, chosen one by one to beat the foes of the day that the squad does not beat yet (the Auto pick has a choice)
 *   matched   4 attackers chosen FOR THE DAY (the 4 attackers whose element beats the most foes of floors 1 to 8 of that day, less the foes that beat it)
 *             + the same support as "control". Control and matched have the same shape: the difference is only the element choice.
 * The Hunt is not measured: the rule does not apply to it (a Hunt boss has no element), so its damage is the same for every option
 * (combat-golden.mjs with the bonus at 1.25 proves it, see docs/combat-lab.md).
 */
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { installHelpers, PLAN } from './lab-sql.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
assertLocal('element-bonus-balance.mjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = opt('out', join(HERE, '..', 'out', 'element-bonus'));
const CANDIDATE = opt('candidate', process.env.CANDIDATE || '');
if (!CANDIDATE) throw new Error('--candidate <f3_element_bonus.sql[,f3_auto_elements.sql]> is required (the migration is not applied on the local copy)');
// --candidate may list several files (comma): they run in that order, inside every undone request.
const strip1 = (f) => readFileSync(f, 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '').replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const CAND = CANDIDATE.split(',').map(strip1).join('\n');
if (CAND.includes('$m$')) throw new Error('the candidate file must not contain $m$');
const OPTIONS = [
  { name: 'today',     bonus: 1,    penalty: 1,    note: 'Bonus 1, penalty 1: no change (today).' },
  { name: 'b115',      bonus: 1.15, penalty: 1,    note: 'Bonus x1.15.' },
  { name: 'b125',      bonus: 1.25, penalty: 1,    note: 'Bonus x1.25.' },
  { name: 'b150',      bonus: 1.5,  penalty: 1,    note: 'Bonus x1.5.' },
  { name: 'b125-auto', bonus: 1.25, penalty: 1, auto: true, note: 'Bonus x1.25 and the Auto button picks the attacker by element (combat.auto_elements = true).' },
  { name: 'p085',      bonus: 1,    penalty: 0.85, note: 'Penalty x0.85 only (the target beats the attacker).' },
  { name: 'b125-p085', bonus: 1.25, penalty: 0.85, note: 'Bonus x1.25 and penalty x0.85.' },
];
const wanted = opt('options', OPTIONS.map((o) => o.name).join(',')).split(',');
const LIMIT_S = Number(process.env.LAB_LIMIT_S || 45);
const QUICK = flag('quick');
const DAYS = Number(opt('runs', QUICK ? 4 : 14));
const STARS = [0, 1, 3];
const SHAPES = ['stack', 'mixed', 'control', 'matched', 'covered'];
const T0 = Date.now();
const log = (m) => console.error(`[el ${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s] ${m}`);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => `${(x * 100).toFixed(0)}%`;

const prelude = (o) => `execute $m$${CAND}$m$;
  execute $p$update public.balance set value = value || '${JSON.stringify({ element_bonus: o.bonus, element_penalty: o.penalty, ...(CAND.includes('auto_elements') ? { auto_elements: !!o.auto } : {}) })}'::jsonb where key = 'combat';$p$;`;
async function request(o, exprs, timeoutS = LIMIT_S) {
  const body = `${PLAN} set local statement_timeout = '${timeoutS}s';
do $t$
declare o jsonb[] := '{}';
begin
  ${installHelpers()}
  ${prelude(o)}
  ${exprs.map((e) => `o := o || coalesce(${e}, '{"null_result": true}'::jsonb);`).join('\n  ')}
  raise exception 'RESULT:%', to_jsonb(o)::text;
end $t$;`;
  return JSON.parse(await runBlock(body));
}
const isTimeout = (e) => /statement timeout|Query read timeout/i.test(String(e.message));
async function calls(o, exprs) {
  const out = []; let size = 2, i = 0;
  while (i < exprs.length) {
    const part = exprs.slice(i, i + size), t = Date.now();
    try {
      out.push(...await request(o, part));
      const per = Math.max(0.005, (Date.now() - t) / 1000 / part.length);
      size = Math.max(1, Math.min(40, Math.floor(20 / per))); i += part.length;
    } catch (e) {
      if (!isTimeout(e)) throw e;
      if (part.length === 1) { out.push({ timeout: true }); i++; } else size = Math.max(1, Math.floor(part.length / 2));
    }
  }
  return out;
}
async function rows(sql) {
  const j = await runBlock(`do $t$ begin raise exception 'RESULT:%', (select coalesce(jsonb_agg(z), '[]'::jsonb) from (${sql}) z)::text; end $t$;`);
  return JSON.parse(j);
}

// --- the facts: the cards, the pairs, the foe elements of each generated day -----------------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const seeds = (n, o = 0) => Array.from({ length: n }, (_, i) => Number((((i + 1) * 0.6180339887 + o * 0.37) % 1 * 1.8 - 0.9).toFixed(4)));
const arrLit = (a) => `array[${a.join(',')}]::bigint[]`;
const buildsLit = (ids, stars) => (stars ? `${sqlLit(Object.fromEntries(ids.map((id) => [id, { asc: stars, pts: {} }])))}::jsonb` : `'{}'::jsonb`);
const runExpr = (seed, squad, day, stars) =>
  `pg_temp.lab_dungeon_run(${seed}, 'daily', ${arrLit(squad)}, ${buildsLit(squad, stars)}, (public.dungeon_generate(date '2031-03-01' + ${day * 3 + 1}) -> 'floors'), 'auto', ${sqlLit({ max_calls: 120 })}::jsonb)`;

const cards = await rows(`select c.id, s.type, s.ability->>'kind' ak, card_element(s.tag_slugs) el from cards c join subjects s on s.id = c.subject_id where c.rarity::text = 'normal' order by c.id`);
const pairs = await rows(`select beater, target from element_counters where not proposal`);
const isAtk = (c) => c.type === 'Character' || c.type === 'Creature';
const atk = cards.filter(isAtk), sup = cards.filter((c) => !isAtk(c) && c.ak === 'support');
const dayFoes = await rows(`select d.i, (select coalesce(jsonb_agg(f->>'element'), '[]'::jsonb) from jsonb_array_elements(g.floors) with ordinality fl(v, n), jsonb_array_elements(fl.v) rm, jsonb_array_elements(rm->'foes') f where fl.n <= 8) els
  from generate_series(0, ${DAYS - 1}) d(i), lateral (select public.dungeon_generate(date '2031-03-01' + d.i * 3 + 1) -> 'floors' floors) g`);
const beats = (a, b) => pairs.some((p) => p.beater === a && p.target === b);
const rnd = rng(0xE1E3);
const pickN = (arr, k) => { const c = [...arr], out = []; while (out.length < k && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
const squads = [];   // squads[day] = { stack, mixed, control, matched }
for (let d = 0; d < DAYS; d++) {
  const foes = (dayFoes.find((x) => x.i === d)?.els || []).filter(Boolean);
  const stack = [...pickN(atk, 2), ...pickN(sup, 3)].map((c) => c.id);
  const mixed = [...pickN(atk, 3), ...pickN(sup, 2)].map((c) => c.id);
  const oneSup = pickN(sup, 1);
  const control = [...pickN(atk, 4), ...oneSup].map((c) => c.id);
  // the matched attackers: the net count of foes that the card's element beats, less the foes that beat it (the squad shape is chosen, not the fight)
  const score = (c) => (c.el ? foes.reduce((s, f) => s + (beats(c.el, f) ? 1 : 0) - (beats(f, c.el) ? 1 : 0), 0) : -99);
  const matched = [...[...atk].sort((a, b) => score(b) - score(a) || a.id - b.id).slice(0, 4), ...oneSup].map((c) => c.id);
  // covered: 4 attackers of 4 DIFFERENT elements, chosen one by one for the foes of the day: each step takes the element that beats the most foes not yet beaten by the squad (so the Auto button has a choice for each foe)
  const els = [...new Set(atk.map((c) => c.el).filter(Boolean))]; const beaten = new Set(); const pickedEls = [];
  for (let k = 0; k < 4; k++) { let best = null, bs = -1; for (const e of els) { if (pickedEls.includes(e)) continue; const s = foes.reduce((n, f) => n + (!beaten.has(f) && beats(e, f) ? 1 : 0), 0); if (s > bs) { bs = s; best = e; } } if (!best) break; pickedEls.push(best); foes.forEach((f) => { if (beats(best, f)) beaten.add(f); }); }
  const covered = [...pickedEls.map((e) => atk.find((c) => c.el === e)), ...oneSup].map((c) => c.id);
  squads.push({ stack, mixed, control, matched, covered, foes: foes.length });
}

async function measure(o) {
  const cells = [];
  for (const stars of STARS) for (const shape of SHAPES) for (let d = 0; d < DAYS; d++) cells.push({ stars, shape, d, ids: squads[d][shape], sd: seeds(1, 40 + d)[0] });
  const res = await calls(o, cells.map((c) => runExpr(c.sd, c.ids, c.d, c.stars)));
  const by = {};
  cells.forEach((c, n) => {
    const r = res[n]; if (!r || r.timeout || r.start_error) { (by.bad ??= []).push(c); return; }
    const a = (by[`${c.stars}|${c.shape}`] ??= { floors: [], shards: [], viol: 0, calls: [] });
    a.floors.push(r.floor); a.shards.push(r.shards); a.calls.push(r.calls); a.viol += (r.viol || []).length;
  });
  const rowsOut = [];
  for (const stars of STARS) for (const shape of SHAPES) {
    const a = by[`${stars}|${shape}`]; if (!a) continue;
    rowsOut.push({ stars, shape, n: a.floors.length, floor_mean: r2(mean(a.floors)), floor_max: Math.max(...a.floors), past1: r2(a.floors.filter((f) => f >= 2).length / a.floors.length),
      past3: r2(a.floors.filter((f) => f >= 4).length / a.floors.length), shards_mean: r2(mean(a.shards)), viol: a.viol });
  }
  return { name: o.name, bonus: o.bonus, penalty: o.penalty, note: o.note, rows: rowsOut, bad: (by.bad || []).length };
}

mkdirSync(OUT, { recursive: true });
const all = [];
for (const name of wanted) {
  const o = OPTIONS.find((x) => x.name === name); if (!o) throw new Error(`no option ${name}`);
  log(`option ${name} ...`);
  const t = Date.now(); const m = await measure(o); m.seconds = Math.round((Date.now() - t) / 1000); all.push(m);
  log(`option ${name} done in ${m.seconds} s (${m.bad} runs did not play)`);
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(m, null, 1));
}
const md = [`# Element bonus options (${new Date().toISOString().slice(0, 10)}, local copy; ${DAYS} generated days, the same squads and seeds for every option; normal cards)`, '',
  'Win = the run passes floor 1 (reaches floor 2). Deep = the run reaches floor 4 or deeper. Squad shapes: stack 2A+3S, mixed 3A+2S, control 4A+1S (random attackers), covered 4A+1S (4 attackers of 4 different elements chosen to beat the foes of the day), matched 4A+1S (attackers chosen for the foes of the day, the same support as control).', ''];
for (const stars of STARS) {
  md.push(`### ${stars}-star squads`, '', '| Option | Shape | Mean floor | Best | Win | Deep | Shards a run |', '|---|---|---|---|---|---|---|');
  for (const m of all) for (const r of m.rows.filter((x) => x.stars === stars)) md.push(`| ${m.name} | ${r.shape} | ${r.floor_mean} | ${r.floor_max} | ${pct(r.past1)} | ${pct(r.past3)} | ${r.shards_mean} |`);
  md.push('');
}
md.push('### Matched minus control (same shape, 4A+1S): the value of choosing the attackers for the foes', '', '| Option | Stars | Mean floor spread | Win spread | Shards spread |', '|---|---|---|---|---|');
for (const m of all) for (const stars of STARS) for (const sh of ['matched', 'covered']) { const a = m.rows.find((x) => x.stars === stars && x.shape === sh), b = m.rows.find((x) => x.stars === stars && x.shape === 'control'); if (a && b) md.push(`| ${m.name} ${sh} | ${stars} | ${r2(a.floor_mean - b.floor_mean)} | ${r2((a.past1 - b.past1) * 100)} points | ${r2(a.shards_mean - b.shards_mean)} |`); }
md.push('');
writeFileSync(join(OUT, 'report.md'), md.join('\n')); writeFileSync(join(OUT, 'report.json'), JSON.stringify(all, null, 1));
console.log(md.join('\n'));
