/**
 * The golden test of the Dungeon and the Gauntlet (docs/foundations.md F-3 item 7). It is the twin of combat-golden.mjs (the Hunt).
 *
 * It plays a fixed set of seeded Dungeon and Gauntlet fights on the LOCAL copy (setseed) and writes a transcript of each fight: every
 * result of dungeon_attack / dungeon_support / dungeon_pass_turn / dungeon_choose / dungeon_auto_rounds, a digest of the run state after
 * each action, the end of the run and the ledgers. Every fight starts with the real dungeon_start / gauntlet_start and is undone right after
 * it runs. The same fights run twice on the code that is installed (the transcripts must be equal: the fights are repeatable). Then a
 * candidate migration is installed and the same fights run again: the test FAILS on the first difference. Nothing is kept: the final
 * RAISE rolls everything back.
 *
 *   node scripts/dungeon-golden.mjs               (with LOCALDB=1)    the code vs itself (repeatable)
 *   CANDIDATE=<file.sql> ...                                          the code vs the candidate ("the candidate matches the live code exactly")
 *   BASE=<file.sql> CANDIDATE=<file.sql> ...                          the BASE text is installed first (inside the rolled-back block) and plays the
 *                                                                     "live" fights: a migration that is already applied is compared with the text before it
 *   DUMP=1                                                            print the coverage numbers
 *   GOLDEN_SEEDS=2                                                    fewer seeds for each scenario (default 3)
 *
 * What the fights cover (the PASS line says it, and the test fails when one of these is missing from the transcripts):
 *   - each foe kind (fight, horde, elite, miniboss, guardian), each of the 13 Dungeon elements, each of the 10 monsters (their move pools),
 *     each of the 7 foe passives
 *   - each support effect (heal, shield, empower, weaken, expose, stun, smite, cleanse), each attack effect (focus, pierce, execute, rampage,
 *     lifesteal), the refusals (cooldown, stunned, stun immunity), the pass of a turn, poison and area hits, the 40-round cap is not hit
 *   - a whole run: floor_done, the doors and chests (dungeon_choose), the guardian pay-out, the retreat, the real generated day
 *   - the Gauntlet: the weekly squad with 0 stars and no stat points. A member that owns the cards at 5 stars with stat points plays the
 *     same fights with the same seed: the two transcripts must be the same (the "0-star rule"; ZEROSTAR DIFF fails the test)
 */
import { runBlock, sqlLit, assertLocal } from './lab-lib.mjs';
import { installHelpers, PLAN } from './lab-sql.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
assertLocal('dungeon-golden.mjs');

const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const cand = process.env.CANDIDATE ? strip(readFileSync(process.env.CANDIDATE, 'utf8')) : '';
const baseSql = process.env.BASE ? strip(readFileSync(process.env.BASE, 'utf8')) : '';
if (baseSql.includes('$b$')) throw new Error('the BASE file must not contain $b$');
if (cand.includes('$c$')) throw new Error('the candidate must not contain $c$');
// Finish room (dungeon_finish_room.sql, D-200): a NEW function. The fights with the 'finish' policy call it, so every request installs it after the base text (the base
// code has no such function, and it replaces no live function, so the transcripts of all other fights are not affected).
const FINISH_FILE = process.env.FINISH_SQL || fileURLToPath(new URL('../../tcg-bot/supabase/dungeon_finish_room.sql', import.meta.url));
const finishSql = strip(readFileSync(FINISH_FILE, 'utf8'));
if (finishSql.includes('$q$')) throw new Error('the Finish room file must not contain $q$');
const SEEDS_N = Number(process.env.GOLDEN_SEEDS || 3);
const SEEDS = [0.11, 0.53, -0.37, 0.77, -0.91].slice(0, SEEDS_N);

// --- Facts of the local copy (card ids, monsters, passives) -------------------------------------------------------
// The squads are chosen by effect: the lowest card id of the "normal" rarity with that effect. Same database = same squads.
const facts = JSON.parse(await runBlock(String.raw`do $t$ begin raise exception 'RESULT:%', jsonb_build_object(
  'atk', (select jsonb_object_agg(e, id) from (select s.ability->>'effect' e, min(c.id) id from cards c join subjects s on s.id = c.subject_id
          where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'kind' = 'attack' group by 1) z),
  'sup', (select jsonb_object_agg(e, id) from (select s.ability->>'effect' e, min(c.id) id from cards c join subjects s on s.id = c.subject_id
          where c.rarity = 'normal' and s.type not in ('Character', 'Creature') and s.ability->>'kind' = 'support' group by 1) z),
  'monsters', (select jsonb_agg(key order by key) from dungeon_monsters),
  'elements', (select to_jsonb(dungeon_foe_elements())),
  'passives', (select to_jsonb(passives_for('foe')))
)::text; end $t$;`));
for (const e of ['execute', 'lifesteal', 'rampage', 'focus', 'pierce']) if (!facts.atk[e]) throw new Error(`no normal attacker with the effect ${e}`);
for (const e of ['stun', 'heal', 'weaken', 'expose', 'shield', 'empower', 'smite', 'cleanse']) if (!facts.sup[e]) throw new Error(`no normal support with the effect ${e}`);
if (facts.elements.length !== 13) throw new Error(`the Dungeon has ${facts.elements.length} foe elements, the golden test expects 13`);

// 3 attackers + 2 supports for each squad (the Gauntlet has this shape; the Dungeon squad is 5 cards).
const SQUADS = [
  { name: 'A', atk: ['execute', 'lifesteal', 'rampage'], sup: ['stun', 'heal'] },
  { name: 'B', atk: ['focus', 'pierce', 'execute'], sup: ['weaken', 'expose'] },
  { name: 'C', atk: ['rampage', 'pierce', 'lifesteal'], sup: ['shield', 'empower'] },
  { name: 'D', atk: ['focus', 'lifesteal', 'execute'], sup: ['smite', 'cleanse'] },
  { name: 'E', atk: ['lifesteal'], sup: ['heal', 'shield', 'empower', 'cleanse'] },   // one attacker, four supports: a stun leaves no attacker, the turn passes
].map((s) => {
  const atk = s.atk.map((e) => facts.atk[e]), sup = s.sup.map((e) => facts.sup[e]);
  const cards = [...atk, ...sup];
  if (new Set(cards).size !== 5) throw new Error(`squad ${s.name} has a repeated card`);
  // Squad A: the stun card has 15 Haste points (its cooldown 5 becomes 2, so the stun immunity of 2 rounds refuses a second stun).
  // The stars and stat points of the member's copies: a variety, so that each stat that a fight reads is in some fight.
  const builds = { [atk[0]]: { asc: 1, pts: { vitality: 3 } }, [atk[1]]: { asc: 2, pts: { attack: 3, precision: 3 } }, [sup[0]]: s.name === 'A' ? { asc: 5, pts: { haste: 15 } } : { asc: 1, pts: { haste: 3 } }, [sup[1]]: { asc: 1, pts: { potency: 3 } } };
  return { ...s, cards, builds };
});
// A member that owns every card of a squad at 5 stars with stat points (the Gauntlet must ignore them).
const richBuilds = (sq) => Object.fromEntries(sq.cards.map((c) => [c, { asc: 5, pts: { attack: 3, vitality: 3, precision: 3, potency: 3, haste: 3 } }]));

// --- The scenarios ---------------------------------------------------------------------------------------------
const room = (type, foes) => `jsonb_build_object('type', '${type}', 'foes', ${foes})`;
const arr = (xs) => `jsonb_build_array(${xs.join(', ')})`;
const foe = (kind, floor, roomNo, el, mon, pass, tag) => `pg_temp.lab_foe('${kind}', ${floor}, ${roomNo}, ${el ? `'${el}'` : 'null'}, ${mon ? `'${mon}'` : 'null'}, ${pass ? `'${pass}'` : 'null'}, '${tag}')`;
const none = `'[]'::jsonb`;
const one = (r) => arr([arr([r])]);   // one floor, one room
const scen = [];   // {id, mode, sq, floors (an SQL expression or null), policy, opts, pair}
const E = facts.elements, M = facts.monsters, P = facts.passives;
E.forEach((el, i) => scen.push({ id: `element ${el}`, mode: 'daily', sq: SQUADS[i % 4], policy: 'script',
  floors: one(room('fight', arr([foe('fight', 1 + (i % 3), 1, el, M[i % M.length], null, `e${i}a`), foe('fight', 1 + (i % 3), 1, E[(i + 1) % E.length], M[(i + 3) % M.length], null, `e${i}b`)]))) }));
scen.push({ id: 'horde of 4', mode: 'daily', sq: SQUADS[1], policy: 'script', floors: one(room('horde', arr([0, 1, 2, 3].map((k) => foe('horde', 2, 1, E[k * 3 % E.length], null, null, `h${k}`))))) });
P.forEach((p, i) => scen.push({ id: `elite ${p}`, mode: 'daily', sq: SQUADS[i % 4], policy: 'script', floors: one(room('elite', arr([foe('elite', 2, 1, null, null, p, `el${i}`)]))) }));
[0, 1, 2].forEach((i) => scen.push({ id: `miniboss ${P[i * 2]}`, mode: 'daily', sq: SQUADS[(i + 1) % 4], policy: 'script', floors: one(room('miniboss', arr([foe('miniboss', 3, 1, null, null, P[i * 2], `mb${i}`)]))) }));
[0, 1, 2].forEach((i) => scen.push({ id: `guardian ${E[i * 4]}`, mode: 'daily', sq: SQUADS[(i + 2) % 4], policy: 'script', floors: one(room('guardian', arr([foe('guardian', 2, 5, E[i * 4], null, null, `g${i}`)]))) }));
M.forEach((m, i) => scen.push({ id: `monster ${m}`, mode: 'daily', sq: SQUADS[i % 4], policy: 'script',
  floors: one(room('fight', arr([foe('fight', 1, 1, null, m, null, `m${i}a`), foe('fight', 1, 1, null, m, null, `m${i}b`)]))) }));
// One attacker and four supports against the stunners (squid, yeti): the attacker is stunned, the turn passes (dungeon_pass_turn).
['squid', 'yeti'].forEach((m, k) => scen.push({ id: `lone attacker vs ${m}`, mode: 'daily', sq: SQUADS[4], policy: 'script',
  floors: one(room('horde', arr([0, 1, 2].map((j) => foe('horde', 1, 1, null, m, null, `lo${k}${j}`))))) }));
// Four fights with the Auto button (dungeon_auto_rounds).
[0, 4, 8, 12].forEach((i, k) => scen.push({ id: `auto element ${E[i]}`, mode: 'daily', sq: SQUADS[k], policy: 'auto',
  floors: one(room('fight', arr([foe('fight', 1, 1, E[i], M[k], null, `au${k}a`), foe('fight', 1, 1, E[(i + 5) % 13], M[(k + 4) % M.length], null, `au${k}b`)]))) }));
// Finish room (dungeon_finish_room): the same kind of fights with ONE call for each fight room (a horde, a guardian, a pass inside the room, the real day and week included).
[0, 4, 8, 12].forEach((i, k) => scen.push({ id: `finish element ${E[i]}`, mode: 'daily', sq: SQUADS[k], policy: 'finish',
  floors: one(room('fight', arr([foe('fight', 1, 1, E[i], M[k], null, `fi${k}a`), foe('fight', 1, 1, E[(i + 5) % 13], M[(k + 4) % M.length], null, `fi${k}b`)]))) }));
scen.push({ id: 'finish horde of 4', mode: 'daily', sq: SQUADS[2], policy: 'finish', floors: one(room('horde', arr([0, 1, 2, 3].map((k) => foe('horde', 2, 1, E[k * 3 % E.length], null, null, `fh${k}`))))) });
scen.push({ id: 'finish guardian', mode: 'daily', sq: SQUADS[0], policy: 'finish', floors: one(room('guardian', arr([foe('guardian', 3, 5, E[2], null, null, 'fg0')]))) });
scen.push({ id: 'finish lone attacker vs squid (a pass inside the room)', mode: 'daily', sq: SQUADS[4], policy: 'finish',
  floors: one(room('horde', arr([0, 1, 2].map((j) => foe('horde', 1, 1, null, 'squid', null, `fs${j}`))))) });
// A room that the squad loses (a monster with 100000 attack) and a room that cannot end (a monster with 100 million HP and 1 attack: the round limit, balance dungeon.round_cap).
const strong = (kind, floor, roomNo, tag, patch) => `(${foe(kind, floor, roomNo, null, null, null, tag)} || '${patch}'::jsonb)`;
scen.push({ id: 'finish lost room', mode: 'daily', sq: SQUADS[1], policy: 'finish', floors: one(room('fight', arr([strong('fight', 1, 1, 'fl0', '{"atk": 100000}')]))) });
scen.push({ id: 'finish round limit', mode: 'daily', sq: SQUADS[2], policy: 'finish', floors: one(room('fight', arr([strong('fight', 1, 1, 'fr0', '{"hp": 100000000, "max": 100000000, "atk": 1}')]))) });
// A journey: two floors, all room types (the doors, the chests, the rest room, the guardian pay-out, the next floor, the retreat).
const journey = (k) => arr([
  arr([room('fight', arr([foe('fight', 1, 1, E[k], null, null, `j${k}a`)])), room('choice', none), room('rest', none), room('treasure', none), room('guardian', arr([foe('guardian', 1, 5, null, null, null, `j${k}g`)]))]),
  arr([room('fight', arr([foe('fight', 2, 1, E[k + 4], null, null, `j${k}b`)])), room('horde', arr([foe('horde', 2, 2, null, null, null, `j${k}h1`), foe('horde', 2, 2, null, null, null, `j${k}h2`), foe('horde', 2, 2, null, null, null, `j${k}h3`), foe('horde', 2, 2, null, null, null, `j${k}h4`)])),
       room('elite', arr([foe('elite', 2, 3, null, null, null, `j${k}e`)])), room('rest', none), room('guardian', arr([foe('guardian', 2, 5, null, null, null, `j${k}g2`)]))]),
]);
SQUADS.slice(0, 4).forEach((sq, k) => {
  scen.push({ id: `journey ${sq.name} finish, retreat at floor 1`, mode: 'daily', sq, policy: 'finish', floors: journey(k + 3), opts: { max_calls: 200, retreat_floor: 1 } });
  scen.push({ id: `journey ${sq.name} script`, mode: 'daily', sq, policy: 'script', floors: journey(k), opts: { max_calls: 400, retreat_floor: 0 } });
  scen.push({ id: `journey ${sq.name} auto, retreat at floor 1`, mode: 'daily', sq, policy: 'auto', floors: journey(k + 6), opts: { max_calls: 200, retreat_floor: 1 } });
});
// The real generated day: a full run of a 30-floor Dungeon, the first 250 calls.
SQUADS.slice(0, 2).forEach((sq) => scen.push({ id: `real day ${sq.name}`, mode: 'daily', sq, policy: 'script', floors: null, opts: { max_calls: 250 } }));
// The Gauntlet: a fixed layout, and the 0-star pair (a member with 5 stars and stat points vs a member with none: the same fights).
const gfloor = (k) => arr([arr([room('fight', arr([foe('fight', 1, 1, E[k], M[k], null, `ga${k}a`), foe('fight', 1, 1, E[k + 2], M[k + 2], null, `ga${k}b`)])), room('rest', none), room('elite', arr([foe('elite', 1, 3, null, null, null, `ga${k}e`)])),
  room('horde', arr([foe('horde', 1, 4, null, null, null, `ga${k}h1`), foe('horde', 1, 4, null, null, null, `ga${k}h2`), foe('horde', 1, 4, null, null, null, `ga${k}h3`), foe('horde', 1, 4, null, null, null, `ga${k}h4`)])), room('guardian', arr([foe('guardian', 1, 5, null, null, null, `ga${k}g`)]))])]);
SQUADS.slice(0, 4).forEach((sq, k) => {
  scen.push({ id: `gauntlet ${sq.name} script (0-star pair)`, mode: 'gauntlet', sq, policy: 'script', floors: gfloor(k), opts: { max_calls: 300 }, pair: true });
  scen.push({ id: `gauntlet ${sq.name} auto (0-star pair)`, mode: 'gauntlet', sq, policy: 'auto', floors: gfloor(k + 5), opts: { max_calls: 150 }, pair: true });
});
// The real week of the Gauntlet (the weekly squad of gauntlet_squad, the week's floors).
SQUADS.slice(0, 2).forEach((sq, k) => scen.push({ id: `gauntlet ${sq.name} finish (0-star pair)`, mode: 'gauntlet', sq, policy: 'finish', floors: gfloor(k + 7), opts: { max_calls: 150 }, pair: true }));
scen.push({ id: 'real week script', mode: 'gauntlet', sq: null, policy: 'script', floors: null, opts: { max_calls: 250 } });
scen.push({ id: 'real week finish', mode: 'gauntlet', sq: null, policy: 'finish', floors: null, opts: { max_calls: 120 } });
scen.push({ id: 'real day finish A', mode: 'daily', sq: SQUADS[0], policy: 'finish', floors: null, opts: { max_calls: 200 } });
scen.push({ id: 'real week auto', mode: 'gauntlet', sq: null, policy: 'auto', floors: null, opts: { max_calls: 120 } });

// One SQL expression for each fight. fl[k] holds the floors of scenario k (built inside the request, after the code under test is installed).
const fights = [];
scen.forEach((s, k) => SEEDS.forEach((seed) => fights.push({ s, k, seed })));
const squadSql = (s) => (s.sq ? `array[${s.sq.cards.join(',')}]::bigint[]` : `'{}'::bigint[]`);
const run = (f, builds) => `pg_temp.lab_dungeon_run(${f.seed}, '${f.s.mode}', ${squadSql(f.s)}, ${sqlLit(builds)}::jsonb, ${f.s.floors ? `fl[${f.k + 1}]` : 'null'}, '${f.s.policy}', ${sqlLit({ log: true, fight_only: !/journey|real/.test(f.s.id), ...(f.s.opts || {}) })}::jsonb)`;
const text = (expr) => `pg_temp.lab_text(${expr})`;
const fightExpr = (f) => {
  const own = f.s.sq ? (f.s.pair ? richBuilds(f.s.sq) : f.s.sq.builds) : {};
  if (!f.s.pair) return text(run(f, own));
  // the 0-star pair: the same fight with a member that owns the squad at 5 stars + stat points, and with a member that owns it at 0
  return `(select a.l || case when a.l is distinct from b.l then 'ZEROSTAR DIFF' else 'ZEROSTAR same' end || chr(10) from (select ${text(run(f, own))} l) a, (select ${text(run(f, {}))} l) b)`;
};

/** The markers that the transcripts must contain (JavaScript regular expressions). */
const COVERAGE = [];
for (const e of facts.elements) COVERAGE.push(new RegExp(`\\b${e[0].toUpperCase()}${e.slice(1)} `));   // the foe name starts with its element
for (const p of facts.passives) COVERAGE.push(new RegExp(`"${p}"`));
for (const k of ['fight', 'horde', 'elite', 'miniboss', 'guardian']) COVERAGE.push(new RegExp(`\\{${k},`));
for (const m of facts.monsters) COVERAGE.push(new RegExp(`,${m},`));
for (const e of ['stun', 'heal', 'weaken', 'expose', 'shield', 'empower', 'smite', 'cleanse']) COVERAGE.push(new RegExp(`"effect": "${e}"`));
for (const k of ['strike', 'slam', 'drain', 'stun', 'heavy', 'flurry', 'poison', 'regenerate', 'guard', 'enrage', 'curse', 'cataclysm', 'charging', 'stunned']) COVERAGE.push(new RegExp(`"action": "${k}"`));
for (const m of ['"error": "cooldown"', '"error": "stunned"', '"error": "boss_stun_immune"', '"outcome": "crit"', '"outcome": "miss"', '"outcome": "blocked"', '"double": true', '"kill": true', '"heal": [1-9]',
  '^P0 ', '^CHOOSE0 ', '^CHOOSE1 ', '^AUTO ', '^FINISH ', '"outcome": "won"', '"outcome": "lost"', '"outcome": "limit"', '^RETREAT ', 'ZEROSTAR same', 'RUN over cleared', 'RUN over fell', 'RUN over retreat', 'RUN active']) COVERAGE.push(new RegExp(m, 'm'));

/** Play some fights (indexes into `fights`) on the code that the request installs first. Returns their transcripts. */
async function play(idxs, installSql) {
  const ks = [...new Set(idxs.map((i) => fights[i].k))];
  const floors = ks.filter((k) => scen[k].floors).map((k) => `fl[${k + 1}] := ${scen[k].floors};`).join('\n  ');
  const body = `${PLAN}
do $t$
declare fl jsonb[] := array_fill(null::jsonb, array[${scen.length}]); o text[] := '{}'; i int;
begin
  ${installHelpers()}
  ${installSql ? 'execute $p$' + installSql + '$p$;' : ''}
  execute $q$${finishSql}$q$;
  ${floors}
  for i in 1..${idxs.length} loop o := o || (case i
      ${idxs.map((fi, i) => `when ${i + 1} then ${fightExpr(fights[fi])}`).join('\n      ')}
    end); end loop;
  raise exception 'RESULT:%', to_jsonb(o)::text;
end $t$;`;
  return JSON.parse(await runBlock(body));
}
/** All fights, in chunks that fit the time limit of one request (about 55 s). */
async function playAll(installSql) {
  const out = [], CHUNK = Number(process.env.GOLDEN_CHUNK || 12);
  for (let i = 0; i < fights.length; i += CHUNK) out.push(...await play(fights.slice(i, i + CHUNK).map((_, j) => i + j), installSql));
  return out;
}
const firstDiff = (a, b) => {
  const l1 = a.split('\n'), l2 = b.split('\n');
  let j = 0; while (j < Math.max(l1.length, l2.length) - 1 && l1[j] === l2[j]) j++;
  return { j: j + 1, prev: l1[j - 1] ?? '', one: l1[j] ?? '', two: l2[j] ?? '' };
};
const name = (i) => `${fights[i].s.id} (seed ${fights[i].seed})`;
const fail = (msg) => { console.log(msg); process.exitCode = 1; };

const t0 = Date.now();
// GOLDEN_CACHE=<file>: the transcripts of the base run (already checked: repeatable, clean, covering) are kept in a file, so that a test that compares many candidates
// (scripts/test-golden-mutations.mjs) makes them once. Delete the file when the database or the code changes.
const CACHE = process.env.GOLDEN_CACHE;
const cached = CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : null;
const base = cached ?? await playAll(baseSql);
const again = cached ?? (process.env.GOLDEN_NOAGAIN ? base : await playAll(baseSql));
console.error(`[golden] ${fights.length} fights, ${cached ? 'the base run is from the cache' : '2 runs'}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (let i = 0; i < fights.length; i++) if (base[i] !== again[i]) {
  const d = firstDiff(base[i], again[i]);
  fail(`NOT REPEATABLE at fight ${i + 1} (${name(i)}) line ${d.j}: the same seed gives two answers\nPREV: ${d.prev.slice(0, 500)}\nRUN1: ${d.one.slice(0, 2500)}\nRUN2: ${d.two.slice(0, 2500)}`);
  process.exit();
}
// The base run must be clean: an SQL error, a broken limit or a 0-star difference in the live code is not a "golden" answer.
for (let i = 0; i < fights.length; i++) {
  const t = base[i];
  const bad = /ZEROSTAR DIFF/.test(t) ? 'ZEROSTAR DIFF: stars or stat points changed a Gauntlet fight (the 0-star rule is broken)'
    : /"error": "SQL [^"]*"/.test(t) ? `SQL ERROR in the base run: ${t.match(/"error": "SQL [^"]*"/)[0]}`
    : /VIOL \[[^\]]/.test(t) ? `INVARIANT broken in the base run: ${t.match(/VIOL (\[[^\n]*)/)[1]}`
    : /START_ERROR/.test(t) ? `a fight did not start in the base run: ${t.slice(0, 400)}` : '';
  if (bad) { fail(`${bad}\nat fight ${i + 1}: ${name(i)}`); process.exit(); }
}
const gaps = COVERAGE.filter((re) => !base.some((t) => re.test(t)));
const lines = base.reduce((a, t) => a + t.split('\n').length, 0);
if (process.env.DUMP) console.log(COVERAGE.map((re) => `${re.source}: ${base.filter((t) => re.test(t)).length}`).join('\n'));
if (gaps.length) { fail(`COVERAGE GAP, no fight shows: ${gaps.map((g) => g.source).join(', ')}`); process.exit(); }
if (CACHE && !cached) writeFileSync(CACHE, JSON.stringify(base));
if (cand) {
  const c = await playAll(cand);
  console.error(`[golden] with the candidate: ${((Date.now() - t0) / 1000).toFixed(0)} s in all`);
  if (process.env.GOLDEN_LIST === '1') {
    // GOLDEN_LIST=1: do not stop at the first difference. Count the different fights by mode and say whether the candidate breaks the 0-star rule.
    const by = {}; let any = 0;
    fights.forEach((f, i) => { const m = f.s.mode + (f.s.pair ? ' (0-star pair)' : ''); by[m] ??= [0, 0]; by[m][1]++; if (base[i] !== c[i]) { by[m][0]++; any++; } });
    console.log(`DIFFERENT FIGHTS: ${any} of ${fights.length}; by mode: ${Object.entries(by).map(([m, [d, n]]) => `${m} ${d}/${n}`).join(', ')}`);
    console.log(`candidate ZEROSTAR DIFF lines: ${c.filter((t) => /ZEROSTAR DIFF/.test(t)).length}`);
    process.exitCode = any ? 1 : 0;
    process.exit();
  }
  for (let i = 0; i < fights.length; i++) if (base[i] !== c[i]) {
    const d = firstDiff(base[i], c[i]);
    fail(`DIFF at fight ${i + 1} (${name(i)}) line ${d.j}\nPREV: ${d.prev.slice(0, 500)}\nLIVE: ${d.one.slice(0, 2500)}\nCAND: ${d.two.slice(0, 2500)}`);
    process.exit();
  }
}
console.log(`PASS ${fights.length} fights, ${lines} lines, ${cand ? 'the candidate matches the live code exactly' : 'the fights are repeatable (each ran twice with the same seed)'}`);
if (process.env.SHOW) console.log(base[Number(process.env.SHOW)]);
