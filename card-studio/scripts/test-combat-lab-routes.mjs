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
 * The DB proof (nothing written on the local copy) is scripts/test-combat-lab-nowrite.mjs.
 */
import express from 'express';
import { combatLabRouter, parseFight, activeOf, shapeFight, snapDiff, fightSql, v1Sql } from '../src/combat-lab-routes.js';
import { loadConfig } from '../v2sim/util.mjs';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 400)}`); };
const queries = [];
const local = {
  async sql(q) {
    queries.push(q);
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
const blocks = queries.filter((q) => /^set statement_timeout/.test(q));
check('L4 one fight = ONE DO block that ends with RAISE (rolled back) on the local copy', r.status === 200 && j.ok && blocks.length === 1
  && /\ndo \$t\$/.test(blocks[0]) && /raise exception 'RES %', res;\nend \$t\$;$/.test(blocks[0]) && !/\b(insert|update|delete)\s/i.test(blocks[0]), [r.status, j.error, blocks.length]);
const f = parseFight(HUNT);
const sql = fightSql(f, [{ card_id: 7, rarity: 'normal', stars: 1, cp_mod: 1, level: 0, points: {}, role: 'striker', blocks: [{ k: 'hit', x: 1.4 }] }]);
check('L4 the fight block calls the real v2 functions and writes no table', ['card_combat_v2(', 'combat_v2_hunt_boss(', 'combat_v2_next(', 'combat_v2_card_act(', 'combat_v2_enemy_act(',
  'combat_v2_turn_order(', 'hunt_boss_v2_card('].every((x) => sql.includes(x)) && !/\b(insert into|update \w+ set|delete from)\b/i.test(sql), sql.slice(0, 200));
const v1 = v1Sql({ ...f, player: "tst_o'brien" }, [7, 8]);
check('L5 the v1 side: a test member, a private test boss row, the member id quoted, rolled back', v1.includes("'tst_v2lab_cmp'") && v1.includes("'tst_o''brien'")
  && v1.includes("insert into hunts (name, tier") && /raise exception 'RES %'/.test(v1) && !/from hunts where/.test(v1), v1.slice(0, 200));

// L5
r = await post('/compare', { player: 'tst_player_1', mode: 'dungeon', monster: 'goblin', kind: 'guardian' });
check('L5 compare is for the Hunt only (400 for the Dungeon)', r.status === 400, r.status);

// L6
const cfg = loadConfig();
const own = activeOf(cfg, { subject_key: 'tst-a', type: 'Character', ability_v2: { role: 'medic', name: 'Tst Mend', blocks: [{ k: 'heal', v: 0.2 }] } });
const ph1 = activeOf(cfg, { subject_key: 'tst-b', type: 'Character', ability: { effect: 'shield' }, ability_v2: null });
const ph2 = activeOf(cfg, { subject_key: 'tst-b', type: 'Character', ability: { effect: 'shield' }, ability_v2: null });
check('L6 ability_v2 first; else the placeholder of the role (warden for shield), the same template for the same subject',
  own.source === 'ability_v2' && own.role === 'medic' && own.name === 'Tst Mend' && ph1.source === 'placeholder' && ph1.role === 'warden' && ph1.template === ph2.template && cfg.v2_templates[ph1.template].role === 'warden', { own, ph1 });

// L7
const snap = (hp, max, down = false, st = {}) => [hp, max, down, st, 0, false];
const raw = { cap: 40, start: { 'card:1': snap(100, 100), 'enemy:0': snap(1000, 1000) }, fight: { end: 'cap', actions: 3, clock: 40, log: [
  { event: 'act', n: 1, clock: 1, actor: { side: 'card', id: '1' }, action: 'active', hits: [{ target: { side: 'enemy', id: 0 }, dmg: 150, crit: true, miss: false }],
    pre: { 'card:1': snap(100, 100), 'enemy:0': snap(1000, 1000) }, post: { 'card:1': snap(100, 100), 'enemy:0': snap(850, 1000, false, { poison: 2 }) } },
  { event: 'act', n: 2, clock: 2, actor: { side: 'enemy', id: 0 }, move: 'strike', ticks: [{ side: 'enemy', id: 0, status: 'poison', dmg: 20 }],
    pre: { 'card:1': snap(100, 100), 'enemy:0': snap(830, 1000, false, { poison: 2 }) }, post: { 'card:1': snap(0, 100, true), 'enemy:0': snap(840, 1000, false, { poison: 2 }) } },
  { event: 'cap', clock: 40, pre: { 'card:1': snap(0, 100, true), 'enemy:0': snap(840, 1000, false, { poison: 2 }) } }], final: { 'card:1': snap(0, 100, true), 'enemy:0': snap(840, 1000, false, { poison: 2 }) } } };
const s = shapeFight(raw);
check('L7 totals from the diffs: damage 170 (150 hit + 20 tick), enemy heal 10, net 160, 1 crit, 1 card down, result step cap',
  s.totals.damage === 170 && s.totals.enemy_heal === 10 && s.totals.net === 160 && s.totals.crits === 1 && s.totals.cards_down === 1 && s.totals.result === 'step cap'
  && s.totals.by_card['card:1'] === 150 && s.events.some((e) => e.kind === 'step') && s.events.filter((e) => e.kind !== 'step').length === 2, s.totals);
const d = snapDiff({ 'enemy:0': snap(10, 10, false, { mark: true, chill: 1 }) }, { 'enemy:0': snap(0, 10, true, { chill: 2 }) });
check('L7 snapDiff: HP, a new stack, a dropped status, down', d.length === 1 && d[0].down && d[0].add.chill === 2 && d[0].drop[0] === 'mark' && d[0].hp[1] === 0, d);

srv.close();
console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
