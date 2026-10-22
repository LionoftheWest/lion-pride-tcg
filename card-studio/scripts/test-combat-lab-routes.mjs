/**
 * Test of card-studio/src/combat-lab-routes.js (the Admin "Combat v2 Lab") with a MOCK local copy (no database):
 *   node scripts/test-combat-lab-routes.mjs
 * Invariants:
 *   L1 the flag: ADMIN_VIEW not 1 = every route 404 and nothing is called
 *   L2 a POST needs JSON and X-Admin-Write: 1 (else 403, nothing is called)
 *   L3 a bad fight request is refused (400) before any query: mode, squad size, a card twice, a quote in a key, a tier, a member id
 *   L4 every fight runs as ONE DO block that ends with RAISE (rolled back) on the LOCAL copy, with the member id as a quoted literal
 *   L5 the compare is for the Hunt only (400 for the Dungeon), and its v1 side fights a PRIVATE test boss with a test member (never a live boss row)
 *   L6 the active: subjects.ability_v2 when the card has one, else the simulator placeholder of its role (the same template for the same subject)
 *   L7 the log and the totals come from the state diffs only: damage, enemy heals, crits, misses, downs and the result
 *   L8 the page module (public/admin/combat-lab.js) parses as an ES module (a syntax error there gives a blank page that no other test sees)
 *   L9 a mechanic text: every {leaf} is filled from the given numbers (0 -> 0%, 0.7 -> 70%, a count, "{x} times"), never a "{"
 *   L10 Auto v2 (PR E8): every card choice of the fight comes from combat_v2_auto and the log carries it; the Hunt squad "auto" is ONE rolled-back
 *       block of combat_v2_autopick (pickSql: the named boss's mechanics and Weak to role, the tier boss with none), and its order is the fight order
 *   L11 the Power number (PR E9): the fight block reads card_power_v2 and combat_v2_squad_value (SQL only), guarded by to_regprocedure
 *   L12 the L1/L2 report (GET /l12, plan 19.5): read-only, no database query; no run = report null; a bad file = an error, never a crash; the rows
 *       carry the numbers of the summary and the price numbers of today (frozen_share x payoff, share.area_payoff); numbers only (no card key)
 * The DB proof (nothing written on the local copy) is scripts/test-combat-lab-nowrite.mjs.
 */
import express from 'express';
import { combatLabRouter, l12Report, parseFight, activeOf, shapeFight, snapDiff, fightSql, v1Sql, fillMech, bossLines, pickSql } from '../src/combat-lab-routes.js';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, HERE as V2SIM } from '../v2sim/util.mjs';
import { measureL12, l12Summary } from '../v2sim/lab12.mjs';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 400)}`); };
const queries = [];
const local = {
  async sql(q) {
    queries.push(q);
    if (/^set statement_timeout/.test(q) && q.includes('combat_v2_autopick(')) throw new Error('ERROR: P0001: RES {"ids": [7], "rows": [{"id": 7, "role": "striker", "off": 10, "ans": 1, "weak": 1.5, "pair": 1, "base": 15, "score": 15}], "passes": 1}');
    if (/^set statement_timeout/.test(q)) { const e = new Error(`ERROR: P0001: RES {"squad": [], "enemies": [], "fight": {"end": "cap", "log": [], "final": {}}}`); throw e; }
    if (q.includes("key = 'dungeon') as dungeon")) return [{ dungeon: 5 }];
    if (q.includes('from player_cards pc join cards c')) return [{ card_id: 7, name: 'Tst Card', rarity: 'normal', stars: 1, quantity: 1, subject_key: 'tst-subject', type: 'Character', cp_mod: 1, ability: null, ability_v2: null }];
    if (q.includes("key = 'v2_level'")) return [{ v2_level: { max_level: 30, points_per_level: 1 }, v2_stats: { max_per_stat: 10 } }];
    if (q.includes('card_combat_v2(x->>') && q.startsWith('do $t$')) throw new Error('ERROR: P0001: RES {"r": [{"cp": 30, "text": "Hit the target."}]}');
    return [];
  },
  async info() { return { configured: true, reachable: true, file: 'localdb2.env' }; },
};
const start = (env) => new Promise((res) => { const app = express(); app.use(express.json()); app.use('/api/admin/combat-lab', combatLabRouter({ local, env })); const srv = app.listen(0, '127.0.0.1', () => res(srv)); });
const W = { 'content-type': 'application/json', 'x-admin-write': '1' };
const HUNT = { player: 'tst_player_1', mode: 'hunt', cards: 'auto', boss: 'warlord', tier: 'Heroic', start_hp: 1, level: 0, seed: 7 };

// L1
let srv = await start({});
let base = `http://127.0.0.1:${srv.address().port}/api/admin/combat-lab`;
let r = await fetch(`${base}/setup`); const r2 = await fetch(`${base}/fight`, { method: 'POST', headers: W, body: JSON.stringify(HUNT) });
check('L1 ADMIN_VIEW off: every route 404, nothing is called', r.status === 404 && r2.status === 404 && queries.length === 0, [r.status, r2.status, queries.length]);
srv.close();

srv = await start({ ADMIN_VIEW: '1' });
base = `http://127.0.0.1:${srv.address().port}/api/admin/combat-lab`;
const post = (path, body, headers = W) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

// L2
r = await post('/fight', HUNT, { 'content-type': 'application/json' });
const r3 = await fetch(`${base}/fight`, { method: 'POST', headers: { 'x-admin-write': '1', 'content-type': 'text/plain' }, body: 'x' });
check('L2 a POST with no X-Admin-Write or no JSON = 403, nothing is called', r.status === 403 && r3.status === 403 && queries.length === 0, [r.status, r3.status, queries.length]);

// L3
const bad = [
  { ...HUNT, mode: 'arena' }, { ...HUNT, cards: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { ...HUNT, cards: [3, 3] }, { ...HUNT, boss: "warlord'; drop table players; --" },
  { ...HUNT, tier: 'Legend' }, { ...HUNT, player: "x' or '1'='1" }, { ...HUNT, start_hp: 2 }, { ...HUNT, level: -1 },
  { player: 'tst_player_1', mode: 'dungeon', monster: 'gob lin', kind: 'guardian' }, { player: 'tst_player_1', mode: 'dungeon', monster: 'goblin', kind: 'guardian', cards: [1, 2, 3, 4, 5, 6] },
];
const before = queries.length;
const codes = [];
for (const b of bad) codes.push((await post('/fight', b)).status);
const sqlRun = queries.slice(before).filter((q) => /^set statement_timeout/.test(q)).length;
check('L3 10 bad requests are refused (400); no fight block runs', codes.every((c) => c === 400) && sqlRun === 0, { codes, sqlRun });
let threw = 0;
for (const b of bad) { try { parseFight(b); } catch { threw++; } }
check('L3 parseFight refuses the same 10 requests', threw === bad.length, threw);

// L4
queries.length = 0;
r = await post('/fight', HUNT); const j = await r.json();
const blocks = queries.filter((q) => /^set statement_timeout/.test(q) && q.includes('v2lab_fight'));
const picks = queries.filter((q) => /^set statement_timeout/.test(q) && q.includes('combat_v2_autopick('));
check('L10 the Hunt squad "auto" = ONE rolled-back block of combat_v2_autopick before the fight', picks.length === 1 && /raise exception 'RES %', combat_v2_autopick\(/.test(picks[0])
  && !/\b(insert into|update \w+ set|delete from)\b/i.test(picks[0]), picks.map((q) => q.slice(0, 120)));
check('L4 one fight = ONE DO block that ends with RAISE (rolled back) on the local copy', r.status === 200 && j.ok && blocks.length === 1
  && /\ndo \$t\$/.test(blocks[0]) && /raise exception 'RES %', res;\nend \$t\$;$/.test(blocks[0]) && !/\b(insert|update|delete)\s/i.test(blocks[0]), [r.status, j.error, blocks.length]);
const f = parseFight(HUNT);
const sql = fightSql(f, [{ card_id: 7, rarity: 'normal', stars: 1, cp_mod: 1, level: 0, points: {}, role: 'striker', blocks: [{ k: 'hit', x: 1.4 }] }]);
check('L4 the fight block calls the real v2 functions and writes no table', ['card_combat_v2(', 'combat_v2_hunt_boss(', 'combat_v2_next(', 'combat_v2_auto(', 'combat_v2_card_act(', 'combat_v2_enemy_act(',
  'combat_v2_turn_order(', 'hunt_boss_v2_card('].every((x) => sql.includes(x)) && !/\b(insert into|update \w+ set|delete from)\b/i.test(sql), sql.slice(0, 200));
check('L10 the fight takes every card choice from Auto v2 (combat_v2_auto: use, target, ally) and logs it (no simple policy left)',
  /dec := combat_v2_auto\(s, r->'actor', p_b, null\);/.test(sql) && sql.includes("jsonb_build_object('use', dec->'use', 'target', dec->'target', 'ally', dec->'ally')")
  && sql.includes("'auto', jsonb_build_object('use', dec->'use', 'why', dec->'why')") && !/use := coalesce\(\(u->>'charge'\)/.test(sql), sql.slice(0, 120));
check('L11 the Power number (PR E9): the fight block reads card_power_v2 for each card and combat_v2_squad_value for the squad (SQL; no power math in JS), each call guarded by to_regprocedure (a copy with no E9 functions shows no Power)',
  sql.includes("pw := card_power_v2(cc, x->'blocks', null);") && sql.includes('sv := combat_v2_squad_value(pws, null, null);')
  && sql.includes("to_regprocedure('public.card_power_v2(jsonb, jsonb, jsonb)') is not null") && sql.includes("'squad_value', sv"), sql.slice(0, 200));
const ps = pickSql({ ...f, size: 8 }, [{ card_id: 7, rarity: 'normal', stars: 1, cp_mod: 1, level: 0, points: {}, role: 'striker', blocks: [] }]);
const pt = pickSql({ ...f, boss: null, size: 8 }, [{ card_id: 7, rarity: 'normal', stars: 1, cp_mod: 1, level: 0, points: {}, role: 'striker', blocks: [] }]);
check('L10 pickSql: the named boss gives its mechanics and Weak to role (combat_v2_hunt_boss), the tier boss none; the cap is the squad size; rolled back',
  ps.includes("combat_v2_hunt_boss('Heroic', 'warlord'") && !pt.includes('combat_v2_hunt_boss(') && /combat_v2_autopick\(pool, [^\n]*, 8, b, null\);/.test(ps)
  && ps.includes("'crt', cc->'stats'->'crt'") && ps.includes("'spd', cc->'stats'->'spd'") && ps.includes("'pick_factor', x->'pick_factor'"), ps.slice(0, 200));
const v1 = v1Sql({ ...f, player: "tst_o'brien" }, [7, 8]);
check('L5 the v1 side: a test member, a private test boss row, the member id quoted, rolled back', v1.includes("'tst_v2lab_cmp'") && v1.includes("'tst_o''brien'")
  && v1.includes("insert into hunts (name, tier") && /raise exception 'RES %'/.test(v1) && !/from hunts where/.test(v1), v1.slice(0, 200));

// L5
r = await post('/compare', { player: 'tst_player_1', mode: 'dungeon', monster: 'goblin', kind: 'guardian' });
check('L5 compare is for the Hunt only (400 for the Dungeon)', r.status === 400, r.status);

// L6
const cfg = loadConfig();
const own = activeOf(cfg, { subject_key: 'tst-a', type: 'Character', ability_v2: { role: 'medic', name: 'Tst Mend', blocks: [{ k: 'heal', v: 0.2 }], pick_factor: 1.07 } });
const ph1 = activeOf(cfg, { subject_key: 'tst-b', type: 'Character', ability: { effect: 'shield' }, ability_v2: null });
const ph2 = activeOf(cfg, { subject_key: 'tst-b', type: 'Character', ability: { effect: 'shield' }, ability_v2: null });
check('L6 ability_v2 first (with its pick_factor, plan 20.10); else the placeholder of the role (warden for shield, no pick_factor), the same template for the same subject',
  own.source === 'ability_v2' && own.role === 'medic' && own.name === 'Tst Mend' && own.pick_factor === 1.07 && ph1.pick_factor === null && ph1.source === 'placeholder' && ph1.role === 'warden' && ph1.template === ph2.template && cfg.v2_templates[ph1.template].role === 'warden', { own, ph1 });

// L7
const snap = (hp, max, down = false, st = {}) => [hp, max, down, st, 0, false];
const raw = { cap: 40, start: { 'card:1': snap(100, 100), 'enemy:0': snap(1000, 1000) }, fight: { end: 'cap', actions: 3, clock: 40, log: [
  { event: 'act', n: 1, clock: 1, actor: { side: 'card', id: '1' }, action: 'active', hits: [{ target: { side: 'enemy', id: 0 }, dmg: 150, crit: true, miss: false }],
    auto: { use: true, why: 'ready' }, target: { side: 'enemy', id: 0 }, ally: { side: 'card', id: 1 },
    pre: { 'card:1': snap(100, 100), 'enemy:0': snap(1000, 1000) }, post: { 'card:1': snap(100, 100), 'enemy:0': snap(850, 1000, false, { poison: 2 }) } },
  { event: 'act', n: 2, clock: 2, actor: { side: 'enemy', id: 0 }, move: 'strike', ticks: [{ side: 'enemy', id: 0, status: 'poison', dmg: 20 }],
    pre: { 'card:1': snap(100, 100), 'enemy:0': snap(830, 1000, false, { poison: 2 }) }, post: { 'card:1': snap(0, 100, true), 'enemy:0': snap(840, 1000, false, { poison: 2 }) } },
  { event: 'cap', clock: 40, pre: { 'card:1': snap(0, 100, true), 'enemy:0': snap(840, 1000, false, { poison: 2 }) } }], final: { 'card:1': snap(0, 100, true), 'enemy:0': snap(840, 1000, false, { poison: 2 }) } } };
const s = shapeFight(raw);
check('L7 totals from the diffs: damage 170 (150 hit + 20 tick), enemy heal 10, net 160, 1 crit, 1 card down, result step cap',
  s.totals.damage === 170 && s.totals.enemy_heal === 10 && s.totals.net === 160 && s.totals.crits === 1 && s.totals.cards_down === 1 && s.totals.result === 'step cap'
  && s.totals.by_card['card:1'] === 150 && s.events.some((e) => e.kind === 'step') && s.events.filter((e) => e.kind !== 'step').length === 2, s.totals);
const d = snapDiff({ 'enemy:0': snap(10, 10, false, { mark: true, chill: 1 }) }, { 'enemy:0': snap(0, 10, true, { chill: 2 }) });
const ce = s.events.find((e) => e.kind === 'card');
check('L10 the log carries the Auto v2 choice of a card action (why, target, ally)', ce?.auto?.why === 'ready' && ce.auto.target === 'enemy:0' && ce.auto.ally === 'card:1', ce);
check('L7 snapDiff: HP, a new stack, a dropped status, down', d.length === 1 && d[0].down && d[0].add.chill === 2 && d[0].drop[0] === 'mark' && d[0].hp[1] === 0, d);

// L8
const tmpMod = join(mkdtempSync(join(tmpdir(), 'cl-page-')), 'combat-lab.mjs');
copyFileSync(fileURLToPath(new URL('../public/admin/combat-lab.js', import.meta.url)), tmpMod);
const chk = spawnSync(process.execPath, ['--check', tmpMod], { encoding: 'utf8' });
check('L8 public/admin/combat-lab.js parses as an ES module', chk.status === 0, (chk.stderr || '').slice(0, 300));
// L9
const t9 = [fillMech('cards have {crit_x} of their crit chance', { crit_x: 0 }), fillMech('cards have {crit_x} of their crit chance', { crit_x: 0.7 }),
  fillMech('Every {every} actions', { every: 3 }), fillMech('deals {x} times the damage for {dur} steps', { x: 1.4, dur: 2 }), fillMech('heals {heal}', { heal: 0.004 }),
  fillMech('{a.b} and {gone}', { a: { b: 0.5 } })];
const bl = bossLines({ signature: [{ key: 'ironhide', label: 'Ironhide', mythic: true, text: 'cards have {crit_x} of their crit chance', numbers: { crit_x: 0 } }] });
check('L9 fillMech: 0% / 70% / a count / "1.4 times" / 0.4% / a nested leaf, a missing leaf is "?", never a "{"; bossLines uses the card numbers',
  JSON.stringify(t9) === JSON.stringify(['cards have 0% of their crit chance', 'cards have 70% of their crit chance', 'Every 3 actions', 'deals 1.4 times the damage for 2 steps', 'heals 0.4%', '50% and ?'])
  && bl[0].text === 'cards have 0% of their crit chance' && bl[0].mythic, { t9, bl });

srv.close();

// L12 the L1/L2 report (a synthetic measurement: the test fixture teams and cards, never the private Set 1 actives)
{
  const dir = mkdtempSync(join(tmpdir(), 'cl-l12-'));
  const SYN = JSON.parse(readFileSync(join(V2SIM, 'teams-test-fixture.json'), 'utf8'));
  const M = measureL12(cfg, { runs: 1, seeds: 2, seed: 3, teamList: SYN.teams.slice(0, 3), actives: SYN.cards, standard: false });
  const S = l12Summary(M);
  const good = join(dir, 'lab12.json'), bad = join(dir, 'bad.json'), none = join(dir, 'none.json');
  writeFileSync(good, JSON.stringify({ measure: M, summary: S })); writeFileSync(bad, '{"measure": 1}');
  const at = async (file, env = { ADMIN_VIEW: '1' }) => { const app = express(); app.use('/api/admin/combat-lab', combatLabRouter({ local, env, l12File: file }));
    const sv = await new Promise((ok) => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
    try { const rr = await fetch(`http://127.0.0.1:${sv.address().port}/api/admin/combat-lab/l12`); return { status: rr.status, j: await rr.json().catch(() => null) }; } finally { sv.close(); } };
  queries.length = 0;
  const off = await at(good, {}), g = await at(good), b = await at(bad), z = await at(none);
  check('L12 ADMIN_VIEW off: /l12 is 404', off.status === 404, off.status);
  const rows = g.j?.report?.rows || [];
  const R = cfg.v2_pp.ref;
  const att = rows.find((x) => x.label.startsWith('Attackers, squad with a control partner'));
  const pool = rows.find((x) => x.id === 'L2' && x.label.startsWith('Dungeon run + horde'));
  check('L12 the report: rows of L1 and L2 with the summary numbers (mean, lowest, highest seed of each policy) and the price numbers of today',
    g.status === 200 && g.j.ok && rows.length >= 10 && rows.some((x) => x.id === 'L2') && att && Math.abs(att.now - R.frozen_share * R.payoff) < 1e-12
    && pool.now === cfg.ability_v2.share.area_payoff && att.by.autov2?.mean === S.autov2.l1.all.attacker.control.mean && att.by.best?.hi === S.best.l1.all.attacker.control.hi
    && g.j.report.seeds.join() === '3,4' && g.j.report.policies.join() === 'best,autov2', { status: g.status, n: rows.length, att, pool });
  check('L12 numbers only: no card key or card text in the answer', !/syn-|s1.|"blocks"|"active"/.test(JSON.stringify(g.j)), JSON.stringify(g.j).slice(0, 200));
  check('L12 a bad file = report null with an error; no file = report null, the run command; never a crash',
    b.status === 200 && b.j.report === null && /no measure/.test(b.j.error) && z.status === 200 && z.j.report === null && z.j.error === null && /run.mjs lab12/.test(z.j.run) && l12Report(none, cfg) === null, { b: b.j, z: z.j });
  check('L12 the report reads no database (no query)', queries.length === 0, queries.map((q) => q.slice(0, 60)));
}
console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
