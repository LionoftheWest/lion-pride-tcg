import './localdb-guard.mjs';
/**
 * The fight viewer of the Admin "Combat v2 Lab" (src/combat-lab-routes.js) WRITES NOTHING: a Hunt fight, a Dungeon fight and a v1 / v2 compare on the
 * LOCAL copy, through the real router, and the row counts and sums of the member, ledger, Hunt, Dungeon, balance and admin tables are the same after.
 *   LOCALDB=1 LOCALDB_ENV=<copy env> node --import ./scripts/localdb-preload.mjs scripts/test-combat-lab-nowrite.mjs     must PASS
 * The member: the member of the local copy with the most cards (never printed: no member data in the output). The fights use the real v2 SQL functions.
 * Invariants:
 *   W1 the Hunt fight answers (a named boss, an action log with card and boss actions, totals)
 *   W2 the Dungeon fight answers (a guardian, an action log, a result)
 *   W3 the compare answers (v1 hunt_attack on a private test boss, v2 totals)
 *   W4 after the three: every count and sum of 22 tables is the same as before (players, player_cards, the 3 ledgers, hunts, hunt_hits, hunt_squads,
 *      hunt_card_hp, hunt_combat_log, hunt_events, combat_actions, dungeon_runs, dungeon_log, balance, balance_log, settings, settings_log,
 *      admin_actions, gift_claims, daily_claims, card_plays)
 */
import express from 'express';
import { combatLabRouter } from '../src/combat-lab-routes.js';
import { localCopy } from '../src/admin-write.js';
import { assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-lab-nowrite.mjs');

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 600)}`); };
const local = localCopy(process.env);
const TABLES = ['players', 'player_cards', 'pack_ledger', 'shard_ledger', 'card_ledger', 'hunts', 'hunt_hits', 'hunt_squads', 'hunt_card_hp', 'hunt_combat_log', 'hunt_events',
  'combat_actions', 'dungeon_runs', 'dungeon_log', 'balance', 'balance_log', 'settings', 'settings_log', 'admin_actions', 'gift_claims', 'daily_claims', 'card_plays'];
// one row: the count of each table (a missing table = null), and the sums that an update would move
const state = async () => (await local.sql(`select jsonb_build_object(${TABLES.map((t) => `'${t}', (select case when to_regclass('public.${t}') is null then null else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.${t}', false, true, '')))[1]::text::bigint end)`).join(', ')},
  'sum_players', (select jsonb_build_array(sum(pack_balance), sum(shard_balance)) from players), 'sum_cards', (select jsonb_build_array(sum(quantity), sum(ascension)) from player_cards),
  'balance_md5', (select md5(string_agg(key || value::text, ',' order by key)) from balance), 'max_hunt', (select max(id) from hunts)) as s`))[0].s;

const [pick] = await local.sql(`select p.id from players p join player_cards pc on pc.player_id = p.id group by p.id order by count(*) desc, p.id limit 1`);
if (!pick) { console.log('FAIL the local copy has no member with cards'); console.log('1 of 1 FAILED'); process.exit(1); }
const [boss] = await local.sql(`select key from hunt_bosses_v2 order by ord limit 1`);
const [mon] = await local.sql(`select key from dungeon_monsters_v2 order by key limit 1`);

const app = express(); app.use(express.json());
app.use('/api/admin/combat-lab', combatLabRouter({ local, env: { ADMIN_VIEW: '1' } }));
const srv = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
const base = `http://127.0.0.1:${srv.address().port}/api/admin/combat-lab`;
const post = async (path, body) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-write': '1' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };

const s0 = await state();
const t0 = Date.now();
const hunt = await post('/fight', { player: pick.id, mode: 'hunt', cards: 'auto', boss: boss.key, tier: 'Heroic', start_hp: 1, level: 10, seed: 11 });
const kinds = (r) => new Set((r.events || []).map((e) => e.kind));
check(`W1 the Hunt fight answers: ${hunt.squad?.length} cards vs a named boss, ${hunt.totals?.actions} actions, ${hunt.totals?.result}, damage ${hunt.totals?.net}`,
  hunt.status === 200 && hunt.ok && hunt.squad?.length === 8 && hunt.boss_card && kinds(hunt).has('card') && kinds(hunt).has('enemy') && hunt.totals.net > 0, { status: hunt.status, error: hunt.error });
const dng = await post('/fight', { player: pick.id, mode: 'dungeon', cards: 'auto', monster: mon.key, kind: 'guardian', floor: 3, room: 5, foes: 1, level: 10, seed: 12 });
check(`W2 the Dungeon fight answers: ${dng.squad?.length} cards vs a guardian, ${dng.totals?.actions} actions, ${dng.totals?.result}`,
  dng.status === 200 && dng.ok && dng.squad?.length >= 1 && kinds(dng).has('card') && ['won', 'lost', 'step cap'].includes(dng.totals?.result), { status: dng.status, error: dng.error });
const cmp = await post('/compare', { player: pick.id, mode: 'hunt', cards: 'auto', boss: boss.key, tier: 'Heroic', start_hp: 1, level: 10, seed: 11 });
check(`W3 the compare answers: v1 damage ${cmp.v1?.damage} in ${cmp.v1?.attacks} attacks, v2 damage ${cmp.v2?.net} in ${cmp.v2?.actions} actions`,
  cmp.status === 200 && cmp.ok && cmp.v1?.attacks > 0 && cmp.v2?.actions > 0, { status: cmp.status, error: cmp.error });
const s1 = await state();
const diff = Object.keys({ ...s0, ...s1 }).filter((key) => JSON.stringify(s0[key]) !== JSON.stringify(s1[key]));
check(`W4 nothing written: ${TABLES.filter((t) => s0[t] != null).length} tables (counts), the member and card sums, the balance md5 and the last Hunt id are the same (${((Date.now() - t0) / 1000).toFixed(1)} s for the 3 runs)`,
  diff.length === 0 && TABLES.filter((t) => s0[t] != null).length >= 18, { diff, before: Object.fromEntries(diff.map((d) => [d, s0[d]])), after: Object.fromEntries(diff.map((d) => [d, s1[d]])) });
srv.close();
console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
process.exitCode = fails ? 1 : 0;
