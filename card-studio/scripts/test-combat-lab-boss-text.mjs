import './localdb-guard.mjs';
/**
 * The Boss panel of the Admin "Combat v2 Lab" shows each mechanic with the boss's OWN numbers (hunt_boss_v2_card: the boss params over the base
 * numbers), never the global balance value. Example: the Rage-Quit Warlord keeps the full Ironhide (enemy_v2.bosses.warlord.params.ironhide.crit_x
 * = 0), while the global v2_enemy.mechanics.ironhide.crit_x is 0.7 (the Mythic Netcode and Maw keep 0.7).
 *   LOCALDB=1 LOCALDB_ENV=<copy env> node --import ./scripts/localdb-preload.mjs scripts/test-combat-lab-boss-text.mjs     must PASS
 *   MUTATE=global_numbers ...   the page lines read the global numbers (enemy_mechanics + balance): must FAIL
 *   MUTATE=all ...              the baseline (must PASS), then each mutation, in one run
 * Through the real router (POST /fight, the real v2 SQL on the LOCAL copy, rolled back), for every named boss of hunt_bosses_v2 x Normal, Heroic, Mythic:
 *   T1 each line of the Boss panel has no "{" and equals the card text filled with the card's own numbers (this test's own formatter)
 *   T2 the Warlord's Ironhide line says 0% at every tier; the Mythic Ironhide of Netcode and Maw says 70%
 * The member: the member of the local copy with the most cards (never printed).
 */
import express from 'express';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { localCopy } from '../src/admin-write.js';
import { assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-lab-boss-text.mjs');

const MUT = {
  // the defect of PR #465 before the fix: the boss lines filled from the global numbers (enemy_mechanics + balance_path), not from the boss card
  global_numbers: ['lines: i === 0 && raw.boss_card ? bossLines(raw.boss_card) : unitLines(e, raw.mechanics)', 'lines: unitLines(e, raw.mechanics)'],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)   ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(16)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
// the module under test (with the planted fault in a temporary copy beside it, removed at the end)
const SRC = fileURLToPath(new URL('../src/combat-lab-routes.js', import.meta.url));
let modPath = SRC, tmp = null;
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE]; const src = readFileSync(SRC, 'utf8');
  if (!m || src.split(m[0]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match the module exactly once`);
  tmp = SRC.replace(/combat-lab-routes\.js$/, '.mut-combat-lab-routes.js'); writeFileSync(tmp, src.split(m[0]).join(m[1])); modPath = tmp;
}
const { combatLabRouter } = await import(`file:///${modPath.replace(/\\/g, '/')}`);
if (tmp) rmSync(tmp, { force: true });

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 700)}`); };
// this test's own formatter (independent of the module): a whole number of 1 or more, or a "{x} times" factor, stays a number; else a percent
const fmt = (v, times) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : times || (Number.isInteger(v) && v >= 1) ? String(v) : `${Math.round(v * 1000) / 10}%`);
const own = (text, nums) => text.replace(/\{([a-z0-9_]+)\}( times)?/g, (x, leaf, times) => `${fmt(nums[leaf], !!times)}${times || ''}`);

const local = localCopy(process.env);
const [pick] = await local.sql(`select p.id from players p join player_cards pc on pc.player_id = p.id group by p.id order by count(*) desc, p.id limit 1`);
const bosses = (await local.sql(`select key from hunt_bosses_v2 order by ord`)).map((x) => x.key);
const app = express(); app.use(express.json());
app.use('/api/admin/combat-lab', combatLabRouter({ local, env: { ADMIN_VIEW: '1' } }));
const srv = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
const base = `http://127.0.0.1:${srv.address().port}/api/admin/combat-lab`;

const bad = [], warlord = [], ironhide = {}; let cases = 0, lines = 0;
for (const key of bosses) {
  for (const tier of ['Normal', 'Heroic', 'Mythic']) {
    const [{ c: card }] = await local.sql(`select hunt_boss_v2_card('${key}', '${tier}') as c`);
    const r = await (await fetch(`${base}/fight`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-write': '1' },
      body: JSON.stringify({ player: pick.id, mode: 'hunt', cards: 'auto', boss: key, tier, start_hp: 1, level: 0, seed: 3 }) })).json();
    cases++;
    if (!r.ok) { bad.push(`${key} ${tier}: ${r.error}`); continue; }
    const got = r.enemies[0].lines || [];
    if (got.length !== card.signature.length) bad.push(`${key} ${tier}: ${got.length} lines, the card has ${card.signature.length}`);
    card.signature.forEach((s, i) => {
      lines++;
      const want = own(s.text, s.numbers), line = got[i]?.text ?? '';
      if (line.includes('{') || line !== want) bad.push(`${key} ${tier} ${s.key}: "${line}" (want "${want}")`);
      if (s.key === 'ironhide') { (ironhide[`${key} ${tier}`] = line); if (key === 'warlord') warlord.push(line); }
    });
  }
}
srv.close();
check(`T1 ${cases} boss x tier fights through POST /fight, ${lines} mechanic lines: no "{", each = the card text with the card's own numbers`, bad.length === 0 && cases === bosses.length * 3 && cases >= 48, bad.slice(0, 6));
const say = (k) => ironhide[k] || '(no Ironhide line)';
check(`T2 the Warlord's Ironhide says 0% at every tier ("${warlord[0] || '-'}"); the Mythic Ironhide of Netcode and Maw says 70%`,
  warlord.length === 3 && warlord.every((l) => l.includes('have 0% of their crit chance')) && say('netcode Mythic').includes('have 70% of their crit chance') && say('maw Mythic').includes('have 70% of their crit chance'),
  { warlord, netcode: say('netcode Mythic'), maw: say('maw Mythic') });
console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
process.exitCode = fails ? 1 : 0;
