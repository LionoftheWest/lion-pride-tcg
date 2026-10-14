/**
 * Dungeon balance measuring tool (new players on floor 1, the Guardian heal). LOCAL copy only. No game change.
 *
 *   LAB_LOCK_OWNER=<name> LOCALDB=1 node scripts/dungeon-balance.mjs [--options today,gentle1,...] [--quick|--big] [--candidate file.sql] [--out dir]
 *
 * Each OPTION is a set of balance values (scripts/dungeon-balance-options.json: {name, finding, note, patch: [[key, "{path,in,value}", json], ...]}).
 * For every option the tool plays the same seeded fights and runs. Every request is one undone block: the candidate migration (the
 * functions that read the keys) is installed first, then the option's balance patch (through the real balance triggers, so a value
 * outside the limits is refused), then the fights. Nothing stays on the local copy. The tool never calculates combat: every number
 * comes from the real fight functions (see scripts/lab-sql.mjs).
 *
 * It measures, for a 0-star, a 1-star and a 3-star squad of NORMAL cards (what a new member owns; 3 to 4 attackers, the rest supports):
 *   - the win rate of one room by foe kind (fight, horde, elite, miniboss, guardian) on floors 1 and 2
 *   - whole runs on generated days (the Auto button): the floor reached, how many runs pass floor 1, the Shards of a run
 *   - the findings of the Lab: LOCK (a foe heals as much as all damage in a fight of 12+ rounds), LOOP (the round limit),
 *     and for the Guardian the heal as a share of the damage the squad dealt
 */
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { installHelpers, PLAN } from './lab-sql.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
assertLocal('dungeon-balance.mjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = opt('out', join(HERE, '..', 'out', 'dungeon-balance'));
const QUICK = flag('quick');
const CANDIDATE = opt('candidate', process.env.CANDIDATE || '');
const CAND = CANDIDATE ? readFileSync(CANDIDATE, 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '') : '';
if (CAND.includes('$m$')) throw new Error('the candidate file must not contain $m$');
const OPTIONS = JSON.parse(readFileSync(opt('option-file', join(HERE, 'dungeon-balance-options.json')), 'utf8'));
const wanted = opt('options', OPTIONS.map((o) => o.name).join(',')).split(',');
const LIMIT_S = Number(process.env.LAB_LIMIT_S || 45);
const SIZE = QUICK ? { fights: 4, runs: 4, stress: 6 } : flag('big') ? { fights: 40, runs: 90, stress: 60 } : { fights: 24, runs: 36, stress: 40 };
const STARS = [0, 1, 3];
const KINDS = ['fight', 'horde', 'elite', 'miniboss', 'guardian'];
const FLOORS = [1, 2];
const ROOM = { fight: 2, horde: 3, elite: 3, miniboss: 4, guardian: 5 };
const T0 = Date.now();
const log = (m) => console.error(`[bal ${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s] ${m}`);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => `${(x * 100).toFixed(0)}%`;

// --- the option prelude: the candidate migration, then the balance patch ------------------------------------------------------
function prelude(o) {
  const patch = (o.patch || []).map(([k, path, v]) => `update public.balance set value = jsonb_set(value, '${path}', '${JSON.stringify(v)}'::jsonb) where key = '${k}';`).join('\n  ');
  return `${CAND ? 'execute $m$' + CAND + '$m$;' : ''}\n  ${patch ? 'execute $p$' + patch + '$p$;' : ''}`;
}
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
      size = Math.max(1, Math.min(60, Math.floor(20 / per))); i += part.length;
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

// --- the squads: NORMAL cards only (a new member), random but the same for every option --------------------------------------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const seeds = (n, o = 0) => Array.from({ length: n }, (_, i) => Number((((i + 1) * 0.6180339887 + o * 0.37) % 1 * 1.8 - 0.9).toFixed(4)));
const arrLit = (a) => `array[${a.join(',')}]::bigint[]`;
const buildsLit = (ids, stars) => (stars ? `${sqlLit(Object.fromEntries(ids.map((id) => [id, { asc: stars, pts: {} }])))}::jsonb` : `'{}'::jsonb`);
const runExpr = (seed, squad, floors, policy, opts, stars) =>
  `pg_temp.lab_dungeon_run(${seed}, 'daily', ${arrLit(squad)}, ${buildsLit(squad, stars)}, ${floors ?? 'null'}, '${policy}', ${sqlLit(opts)}::jsonb)`;

const cards = await rows(`select c.id, s.type, s.ability->>'kind' ak from cards c join subjects s on s.id = c.subject_id where c.rarity::text = 'normal' order by c.id`);
const atk = cards.filter((c) => c.type === 'Character' || c.type === 'Creature'), sup = cards.filter((c) => !(c.type === 'Character' || c.type === 'Creature') && c.ak === 'support');
const rnd = rng(0xD06E0);
const pickN = (arr, k) => { const c = [...arr], out = []; while (out.length < k && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0].id); return out; };
const squadList = (n) => Array.from({ length: n }, () => { const k = 3 + Math.floor(rnd() * 2); return [...pickN(atk, k), ...pickN(sup, 5 - k)]; });
const SQUADS = squadList(Math.max(SIZE.fights, SIZE.runs));

const guardEmpty = (kind, floor, i) => `jsonb_build_array(jsonb_build_array(jsonb_build_object('type', '${kind}', 'foes', public.dungeon_room_foes('bal|${kind}|${floor}|${i}', ${floor}, ${ROOM[kind]}, '${kind}'))))`;

// --- one option ---------------------------------------------------------------------------------------------------------------
async function measure(o) {
  const fcells = [];
  for (const stars of STARS) for (const kind of KINDS) for (const floor of FLOORS) for (let i = 0; i < SIZE.fights; i++) fcells.push({ stars, kind, floor, i, ids: SQUADS[i % SQUADS.length], sd: seeds(1, 7 + i)[0] });
  const fres = await calls(o, fcells.map((c) => runExpr(c.sd, c.ids, guardEmpty(c.kind, c.floor, c.i), 'script', { max_calls: 250, fight_only: true }, c.stars)));
  const by = {};
  fcells.forEach((c, n) => {
    const r = fres[n]; if (!r || r.timeout || r.start_error) { (by.bad ??= []).push(c); return; }
    const key = `${c.stars}|${c.kind}|${c.floor}`; const a = (by[key] ??= { n: 0, win: 0, rounds: [], lock: 0, loop: 0, healshare: [], timeout: 0 });
    a.n++; a.win += (r.stop === 'room_done' || r.ended_by === 'cleared') ? 1 : 0; a.rounds.push(r.rounds_max);
    if (r.facts?.foe_heal > 0 && r.facts.foe_heal >= r.facts.foe_dmg && r.rounds_max >= 12) a.lock++;
    if (['round_cap', 'max_calls'].includes(r.stop) || r.timeout) a.loop++;
    if (r.facts?.foe_dmg > 0) a.healshare.push(r.facts.foe_heal / r.facts.foe_dmg);
  });
  // Guardian stress: many Guardian fights on floors 1 to 5 (the LOCK and the round limit are rare, so they need many fights)
  const gcells = [];
  for (const stars of STARS) for (const floor of [1, 2, 3, 4, 5]) for (let i = 0; i < SIZE.stress; i++) gcells.push({ stars, floor, i, ids: SQUADS[i % SQUADS.length], sd: seeds(1, 90 + i)[0] });
  const gres = await calls(o, gcells.map((c) => runExpr(c.sd, c.ids, guardEmpty('guardian', c.floor, 1000 + c.i), 'script', { max_calls: 250, fight_only: true }, c.stars)));
  const gby = {};
  gcells.forEach((c, n) => {
    const r = gres[n]; const a = (gby[`${c.stars}|${c.floor}`] ??= { n: 0, win: 0, rounds: [], lock: 0, loop: 0, share: [], maxr: 0 });
    if (!r || r.timeout || r.start_error) { a.loop += r?.timeout ? 1 : 0; return; }
    a.n++; a.win += (r.stop === 'room_done' || r.ended_by === 'cleared') ? 1 : 0; a.rounds.push(r.rounds_max); a.maxr = Math.max(a.maxr, r.rounds_max);
    if (r.facts?.foe_heal > 0 && r.facts.foe_heal >= r.facts.foe_dmg && r.rounds_max >= 12) a.lock++;
    if (['round_cap', 'max_calls'].includes(r.stop)) a.loop++;
    if (r.facts?.foe_dmg > 0) a.share.push(r.facts.foe_heal / r.facts.foe_dmg);
  });
  const runCells = [];
  for (const stars of STARS) for (let i = 0; i < SIZE.runs; i++) runCells.push({ stars, i, ids: SQUADS[i % SQUADS.length], sd: seeds(1, 40 + i)[0] });
  // the room types of each generated day (to say in which room a run ended)
  const lay = await request(o, Array.from({ length: SIZE.runs }, (_, i) => `(select jsonb_agg((select jsonb_agg(r->>'type') from jsonb_array_elements(f) r)) from jsonb_array_elements(public.dungeon_generate(date '2031-03-01' + ${i * 3 + 1}) -> 'floors') f)`));
  const rres = await calls(o, runCells.map((c) => runExpr(c.sd, c.ids, `(public.dungeon_generate(date '2031-03-01' + ${c.i * 3 + 1}) -> 'floors')`, 'auto', { max_calls: 120 }, c.stars)));
  const runs = {};
  runCells.forEach((c, n) => {
    const r = rres[n]; if (!r || r.timeout || r.start_error) return;
    const a = (runs[c.stars] ??= { n: 0, floors: [], shards: [], lock: 0, loop: 0, rounds: [] });
    a.n++; a.floors.push(r.floor); a.shards.push(r.shards); a.rounds.push(r.rounds_max);
    const dt = r.ended_by === 'cleared' ? 'cleared' : (lay[c.i]?.[r.floor - 1]?.[r.room - 1] ?? '?');
    a.ended = a.ended || {}; a.ended[`f${r.floor}:${dt}`] = (a.ended[`f${r.floor}:${dt}`] || 0) + 1;
    if (r.facts?.foe_heal > 0 && r.facts.foe_heal >= r.facts.foe_dmg && r.rounds_max >= 12) a.lock++;
    if (['round_cap', 'max_calls'].includes(r.stop)) a.loop++;
  });
  const res = { name: o.name, finding: o.finding, note: o.note, patch: o.patch || [], rooms: [], runs: [], bad_fights: (by.bad || []).length };
  for (const stars of STARS) for (const kind of KINDS) {
    const a1 = by[`${stars}|${kind}|1`], a2 = by[`${stars}|${kind}|2`];
    const row = { stars, kind };
    for (const [f, a] of [[1, a1], [2, a2]]) row[`f${f}`] = a ? { n: a.n, win: r2(a.win / a.n), rounds: r2(mean(a.rounds)), lock: a.lock, loop: a.loop, heal_share: a.healshare.length ? r2(mean(a.healshare)) : null } : null;
    res.rooms.push(row);
  }
  for (const stars of STARS) { const a = runs[stars]; if (a) res.runs.push({ stars, n: a.n, floor_mean: r2(mean(a.floors)), floor_max: Math.max(...a.floors), past_floor1: r2(a.floors.filter((f) => f >= 2).length / a.n), past_floor2: r2(a.floors.filter((f) => f >= 3).length / a.n), ended: a.ended, shards_mean: r2(mean(a.shards)), lock: a.lock, loop: a.loop }); }
  res.stress = Object.entries(gby).map(([k, a]) => { const [stars, floor] = k.split('|').map(Number); return { stars, floor, n: a.n, win: r2(a.win / Math.max(1, a.n)), rounds: r2(mean(a.rounds)), rounds_max: a.maxr, lock: a.lock, loop: a.loop, heal_share: a.share.length ? r2(mean(a.share)) : null, heal_share_max: a.share.length ? r2(Math.max(...a.share)) : null }; });
  res.guardian_lock = res.stress.reduce((s, r) => s + r.lock, 0);
  res.guardian_loop = res.stress.reduce((s, r) => s + r.loop, 0);
  res.lock_all = res.guardian_lock + res.rooms.filter((r) => r.kind !== 'guardian').reduce((s, r) => s + (r.f1?.lock || 0) + (r.f2?.lock || 0), 0) + res.runs.reduce((s, r) => s + r.lock, 0);
  res.loop_all = res.guardian_loop + res.rooms.filter((r) => r.kind !== 'guardian').reduce((s, r) => s + (r.f1?.loop || 0) + (r.f2?.loop || 0), 0) + res.runs.reduce((s, r) => s + r.loop, 0);
  return res;
}

mkdirSync(OUT, { recursive: true });
const all = [];
for (const name of wanted) {
  const o = OPTIONS.find((x) => x.name === name); if (!o) throw new Error(`no option ${name}`);
  log(`option ${name} ...`);
  const t = Date.now(); const m = await measure(o); m.seconds = Math.round((Date.now() - t) / 1000); all.push(m);
  log(`option ${name} done in ${m.seconds} s: guardian LOCK ${m.guardian_lock}, LOOP ${m.guardian_loop}`);
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(m, null, 1));
}
// the table
const md = [`# Dungeon balance options (${new Date().toISOString().slice(0, 10)}, local copy; ${SIZE.fights} fights per cell, ${SIZE.runs} runs per squad level; squads of normal cards)`, ''];
for (const m of all) {
  md.push(`## ${m.name}${m.finding ? ` (${m.finding})` : ''}`, '', m.note || '', '', m.patch.length ? 'Patch: ' + m.patch.map((p) => `${p[0]}${p[1]}=${JSON.stringify(p[2])}`).join(', ') : 'No patch (the code today).', '');
  md.push('Room win rate (floor 1 / floor 2), rounds, Guardian heal share (foe heal / damage dealt to it):', '', '| Stars | Kind | Win f1 | Win f2 | Rounds f1/f2 | LOCK | LOOP | Heal share f2 |', '|---|---|---|---|---|---|---|---|');
  for (const r of m.rooms) md.push(`| ${r.stars} | ${r.kind} | ${pct(r.f1.win)} | ${pct(r.f2.win)} | ${r.f1.rounds}/${r.f2.rounds} | ${r.f1.lock + r.f2.lock} | ${r.f1.loop + r.f2.loop} | ${r.f2.heal_share ?? '-'} |`);
  md.push('', `Guardian stress (${SIZE.stress} fights in each row): LOCK = the Guardian healed as much as all damage in a fight of 12+ rounds. LOOP = the round limit.`, '', '| Stars | Floor | Won | Rounds (max) | LOCK | LOOP | Heal share (max) |', '|---|---|---|---|---|---|---|');
  for (const r of m.stress) md.push(`| ${r.stars} | ${r.floor} | ${pct(r.win)} | ${r.rounds} (${r.rounds_max}) | ${r.lock} | ${r.loop} | ${r.heal_share} (${r.heal_share_max}) |`);
  md.push('', 'Whole runs (generated days, Auto):', '', '| Stars | Runs | Mean floor | Best floor | Past floor 1 | Past floor 2 | Shards a run | LOCK | LOOP |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of m.runs) md.push(`| ${r.stars} | ${r.n} | ${r.floor_mean} | ${r.floor_max} | ${pct(r.past_floor1)} | ${pct(r.past_floor2)} | ${r.shards_mean} | ${r.lock} | ${r.loop} |`);
  for (const r of m.runs) md.push('', `Where the ${r.stars}-star runs ended: ` + Object.entries(r.ended || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} x${v}`).join(', '));
  md.push('', `Guardian LOCK ${m.guardian_lock}, Guardian LOOP ${m.guardian_loop}; all LOCK ${m.lock_all}, all LOOP ${m.loop_all}; fights that did not start ${m.bad_fights}. Time ${m.seconds} s.`, '');
}
writeFileSync(join(OUT, 'report.md'), md.join('\n')); writeFileSync(join(OUT, 'report.json'), JSON.stringify(all, null, 1));
console.log(md.join('\n'));
